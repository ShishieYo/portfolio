import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError, type ZodType } from "zod";
import { permissionsFor } from "../shared/permissions";
import type { Role } from "../shared/types";
import { normalizeName } from "../shared/validation/helpers";
import {
  LoginLimiter, SESSION_COOKIE, authenticate, createSession, destroySession, hashPassword, purgeExpiredSessions,
  readCookie, requirePermission, requireUser, verifyPassword,
} from "./auth";
import { logAudit } from "./audit";
import { getDashboard } from "./dashboard";
import type { Db } from "./db";
import { nowIso, transaction } from "./db";
import { HttpError, badRequest, conflict, notFound } from "./errors";
import { reportingLabel, toCsv, toXlsx } from "./exports";
import { createRecord, getDetail, getReadable, getSummary, listRecords, listRuns, getRunIssues, loadReport, updateRecord } from "./records";
import { loadRules, updateRule } from "./rules";
import {
  createRecordSchema, loginSchema, noteSchema, ruleUpdateSchema, settingsSchema, updateRecordSchema, userCreateSchema, userUpdateSchema,
} from "./schema";
import { getSettings, saveSettings } from "./settings";
import { runValidation, todayIn } from "./validation";
import { approveRecord, returnRecord, submitRecord, voidRecord } from "./workflow";

export interface AppConfig {
  sessionTtlHours: number;
  secureCookies: boolean;
  /** IANA timezone used for "today" in date checks */
  timezone: string;
  /** Built client to serve (production). Omit in dev, where Vite serves it. */
  clientDir?: string;
}

const parse = <T>(schema: ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw badRequest("Invalid request", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return r.data;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const int = (v: unknown): number | undefined => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);
const idParam = (req: Request): string => String(req.params.id);

const publicUser = (u: { id: string; username: string; displayName: string; role: Role }) => ({
  id: u.id, username: u.username, displayName: u.displayName, role: u.role, permissions: permissionsFor(u.role),
});

export function createApp(db: Db, config: AppConfig) {
  const app = express();
  const limiter = new LoginLimiter();
  const today = () => todayIn(config.timezone);

  app.disable("x-powered-by");
  if (config.secureCookies) app.set("trust proxy", 1);

  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    next();
  });
  app.use("/api", express.json({ limit: "1mb" }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    // A custom header cannot be sent cross-site without a CORS preflight (which we never grant): CSRF defence.
    if (!["GET", "HEAD"].includes(req.method) && req.get("X-Requested-With") !== "raaf-web") return next(new HttpError(403, "Missing X-Requested-With header"));
    next();
  });
  app.use("/api", authenticate(db));

  const api = express.Router();
  app.use("/api", api);

  api.get("/health", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ ok: true });
  });

  /* ---- auth ---- */
  api.post("/auth/login", (req, res) => {
    const { username, password } = parse(loginSchema, req.body);
    const key = `${req.ip}|${username.toLowerCase()}`;
    if (limiter.isBlocked(key)) throw new HttpError(429, "Too many failed sign-in attempts. Try again in 15 minutes.");
    const user = db.prepare("SELECT * FROM users WHERE username = ? AND active = 1").get(username) as
      | { id: string; username: string; display_name: string; password_hash: string; role: Role }
      | undefined;
    // Always run a hash comparison so response time does not reveal whether the username exists.
    const ok = verifyPassword(password, user?.password_hash ?? "scrypt$00$00") && !!user;
    if (!ok || !user) {
      limiter.fail(key);
      logAudit(db, { id: null, username }, { action: "session.login_failed", entityType: "session" });
      throw new HttpError(401, "Incorrect username or password");
    }
    limiter.reset(key);
    purgeExpiredSessions(db);
    const { token, expiresAt } = createSession(db, user.id, config.sessionTtlHours);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: config.secureCookies, expires: expiresAt, path: "/" });
    logAudit(db, user, { action: "session.login", entityType: "session" });
    res.json(publicUser({ id: user.id, username: user.username, displayName: user.display_name, role: user.role }));
  });

  api.post("/auth/logout", (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) destroySession(db, token);
    if (req.user) logAudit(db, req.user, { action: "session.logout", entityType: "session" });
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  api.get("/auth/me", (req, res) => res.json(publicUser(requireUser(req))));

  /* ---- reference data ---- */
  api.get("/rules", (req, res) => {
    requireUser(req);
    res.json(loadRules(db));
  });
  api.put("/rules/:id", (req, res) => {
    const user = requirePermission(req, "rules:manage");
    const edit = parse(ruleUpdateSchema, req.body);
    res.json(updateRule(db, user, idParam(req), edit));
  });
  api.get("/forms", (req, res) => {
    requireUser(req);
    res.json((db.prepare("SELECT name FROM form_catalog ORDER BY name").all() as { name: string }[]).map((r) => r.name));
  });
  api.post("/forms", (req, res) => {
    const user = requirePermission(req, "rules:manage");
    const name = normalizeName(String((req.body as { name?: unknown })?.name ?? ""));
    if (name.length < 2 || name.length > 100) throw badRequest("Form name must be 2-100 characters");
    if (db.prepare("SELECT 1 FROM form_catalog WHERE name = ?").get(name)) throw conflict("That form is already in the catalog");
    db.prepare("INSERT INTO form_catalog (name) VALUES (?)").run(name);
    logAudit(db, user, { action: "catalog.add", entityType: "setting", entityId: name, newValue: name });
    res.status(201).json({ name });
  });
  api.get("/settings", (req, res) => {
    requireUser(req);
    res.json(getSettings(db));
  });
  api.put("/settings", (req, res) => {
    const user = requirePermission(req, "settings:manage");
    res.json(saveSettings(db, user, parse(settingsSchema, req.body)));
  });

  /* ---- dashboard ---- */
  api.get("/dashboard", (req, res) => res.json(getDashboard(db, requireUser(req))));

  /* ---- records ---- */
  api.get("/records", (req, res) => {
    const user = requireUser(req);
    const q = req.query;
    res.json(
      listRecords(db, user, {
        q: str(q.q), fromPeriod: str(q.from), toPeriod: str(q.to), workflow: str(q.workflow), validation: str(q.validation),
        userId: str(q.user), sort: str(q.sort), dir: str(q.dir), page: int(q.page), pageSize: int(q.pageSize),
      }),
    );
  });

  api.get("/user-options", (req, res) => {
    requirePermission(req, "record:read:all");
    res.json(db.prepare("SELECT DISTINCT u.id, u.display_name AS displayName FROM users u JOIN raaf_records r ON r.created_by = u.id ORDER BY u.display_name").all());
  });

  api.post("/records", (req, res) => {
    const user = requireUser(req);
    const { report, idempotencyKey } = parse(createRecordSchema, req.body);
    const { row, created } = createRecord(db, user, report, idempotencyKey);
    res.status(created ? 201 : 200).json(getDetail(db, user, row.id));
  });

  api.get("/records/:id", (req, res) => res.json(getDetail(db, requireUser(req), idParam(req))));

  api.put("/records/:id", (req, res) => {
    const user = requireUser(req);
    const { report, expectedVersion } = parse(updateRecordSchema, req.body);
    updateRecord(db, user, idParam(req), report, expectedVersion);
    res.json(getDetail(db, user, idParam(req)));
  });

  api.post("/records/:id/validate", (req, res) => {
    const user = requirePermission(req, "record:validate");
    runValidation(db, user, idParam(req), today());
    res.json(getDetail(db, user, idParam(req)));
  });

  api.get("/records/:id/validations", (req, res) => {
    const user = requireUser(req);
    getReadable(db, user, idParam(req));
    res.json(listRuns(db, idParam(req)));
  });
  api.get("/records/:id/validations/:runId", (req, res) => {
    const user = requireUser(req);
    getReadable(db, user, idParam(req));
    const run = listRuns(db, idParam(req)).find((r) => r.id === Number(req.params.runId));
    if (!run) throw notFound("Validation run not found");
    res.json({ run, issues: getRunIssues(db, run.id) });
  });

  api.post("/records/:id/submit", (req, res) => {
    const user = requireUser(req);
    submitRecord(db, user, idParam(req), today());
    res.json(getDetail(db, user, idParam(req)));
  });
  api.post("/records/:id/approve", (req, res) => {
    const user = requirePermission(req, "record:review");
    approveRecord(db, user, idParam(req), parse(noteSchema, req.body).note, today());
    res.json(getDetail(db, user, idParam(req)));
  });
  api.post("/records/:id/return", (req, res) => {
    const user = requirePermission(req, "record:review");
    returnRecord(db, user, idParam(req), parse(noteSchema, req.body).note);
    res.json(getDetail(db, user, idParam(req)));
  });
  api.post("/records/:id/void", (req, res) => {
    const user = requireUser(req);
    voidRecord(db, user, idParam(req), parse(noteSchema, req.body).note);
    res.json(getDetail(db, user, idParam(req)));
  });

  api.get("/records/:id/audit", (req, res) => {
    const user = requireUser(req);
    getReadable(db, user, idParam(req));
    res.json(db.prepare("SELECT * FROM audit_logs WHERE record_id = ? ORDER BY id DESC LIMIT 1000").all(idParam(req)));
  });

  const exportRecord = (kind: "csv" | "xlsx") => async (req: Request, res: Response) => {
    const user = requireUser(req);
    const row = getReadable(db, user, idParam(req));
    const summary = getSummary(db, row.id);
    const report = loadReport(db, row);
    const file = `${summary.refNo}_${report.header.period}${summary.readyForReporting ? "" : "_DRAFT"}`;
    logAudit(db, user, { action: `record.export_${kind}`, entityType: "record", entityId: row.id, recordId: row.id, recordRef: row.ref_no, newValue: reportingLabel(summary) });
    if (kind === "csv") {
      res.type("text/csv; charset=utf-8").attachment(`${file}.csv`).send(toCsv(summary, report));
    } else {
      res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").attachment(`${file}.xlsx`).send(await toXlsx(summary, report));
    }
  };
  api.get("/records/:id/export.csv", exportRecord("csv"));
  api.get("/records/:id/export.xlsx", exportRecord("xlsx"));

  /* ---- audit log (admin) ---- */
  api.get("/audit", (req, res) => {
    requirePermission(req, "audit:read");
    const where: string[] = [];
    const params: (string | number)[] = [];
    const q = req.query;
    if (str(q.user)) { where.push("username = ?"); params.push(str(q.user)!); }
    if (str(q.action)) { where.push("action = ?"); params.push(str(q.action)!); }
    if (str(q.record)) { where.push("record_ref = ?"); params.push(str(q.record)!); }
    if (str(q.from)) { where.push("at >= ?"); params.push(str(q.from)!); }
    if (str(q.to)) { where.push("at < ?"); params.push(`${str(q.to)}T23:59:59.999Z`); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const pageSize = 50;
    const page = Math.max(int(q.page) ?? 1, 1);
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM audit_logs ${clause}`).get(...params) as { n: number }).n;
    const items = db.prepare(`SELECT * FROM audit_logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
    res.json({ items, total, page, pageSize });
  });

  /* ---- users (admin) ---- */
  const userSelect = "SELECT id, username, display_name AS displayName, role, active, created_at AS createdAt FROM users";
  api.get("/users", (req, res) => {
    requirePermission(req, "users:manage");
    res.json(db.prepare(`${userSelect} ORDER BY username`).all());
  });
  api.post("/users", (req, res) => {
    const actor = requirePermission(req, "users:manage");
    const input = parse(userCreateSchema, req.body);
    if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(input.username)) throw conflict("That username is taken");
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO users (id, username, display_name, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)").run(
      id, input.username, input.displayName, hashPassword(input.password), input.role, nowIso(),
    );
    logAudit(db, actor, { action: "user.create", entityType: "user", entityId: id, newValue: `${input.username} (${input.role})` });
    res.status(201).json(db.prepare(`${userSelect} WHERE id = ?`).get(id));
  });
  api.put("/users/:id", (req, res) => {
    const actor = requirePermission(req, "users:manage");
    const input = parse(userUpdateSchema, req.body);
    const id = idParam(req);
    transaction(db, () => {
      const before = db.prepare(`${userSelect} WHERE id = ?`).get(id) as { displayName: string; role: string; active: number } | undefined;
      if (!before) throw notFound("User not found");
      if (id === actor.id && (input.active === false || (input.role && input.role !== "admin"))) throw badRequest("You cannot deactivate or demote your own account");
      if (input.displayName !== undefined) db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(input.displayName, id);
      if (input.role !== undefined && input.role !== before.role) {
        db.prepare("UPDATE users SET role = ? WHERE id = ?").run(input.role, id);
        logAudit(db, actor, { action: "user.update", entityType: "user", entityId: id, field: "role", oldValue: before.role, newValue: input.role });
      }
      if (input.active !== undefined && input.active !== (before.active === 1)) {
        db.prepare("UPDATE users SET active = ? WHERE id = ?").run(input.active ? 1 : 0, id);
        if (!input.active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
        logAudit(db, actor, { action: "user.update", entityType: "user", entityId: id, field: "active", oldValue: before.active === 1, newValue: input.active });
      }
      if (input.password) {
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(input.password), id);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
        logAudit(db, actor, { action: "user.password_reset", entityType: "user", entityId: id });
      }
    });
    res.json(db.prepare(`${userSelect} WHERE id = ?`).get(id));
  });

  api.use((_req, _res, next) => next(notFound("No such API endpoint")));

  /* ---- client (production) ---- */
  if (config.clientDir) {
    if (!existsSync(join(config.clientDir, "index.html"))) throw new Error(`Client build not found at ${config.clientDir}. Run "npm run build" first.`);
    app.use(express.static(config.clientDir, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(config.clientDir!, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, details: err.details });
    if (err instanceof ZodError) return void res.status(400).json({ error: "Invalid request" });
    if ((err as { type?: string }).type === "entity.parse.failed") return void res.status(400).json({ error: "Malformed JSON" });
    if ((err as { type?: string }).type === "entity.too.large") return void res.status(413).json({ error: "Request too large" });
    // Log the message only: request bodies may contain sensitive operational data.
    console.error("Unhandled error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

