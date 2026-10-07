import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { openDb } from "../src/server/db";
import { DEMO_PASSWORD, seedDatabase } from "../src/server/seed";
import { todayIn } from "../src/server/validation";
import type { RaafReport } from "../src/shared/types";
import { validReport } from "./helpers";

const H = { "X-Requested-With": "raaf-web" };
const TZ = "Asia/Manila";

const db = openDb(":memory:");
seedDatabase(db, { demo: true, adminUsername: "admin", adminPassword: "", today: todayIn(TZ) });
const app = createApp(db, { sessionTtlHours: 1, secureCookies: false, timezone: TZ });

async function login(username: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").set(H).send({ username, password: DEMO_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

let encoder1: ReturnType<typeof request.agent>;
let encoder2: ReturnType<typeof request.agent>;
let reviewer: ReturnType<typeof request.agent>;
let admin: ReturnType<typeof request.agent>;

beforeAll(async () => {
  [encoder1, encoder2, reviewer, admin] = await Promise.all([login("encoder1"), login("encoder2"), login("reviewer1"), login("admin")]);
});

/** A correct report for an entity/month that does not exist in the demo data. */
function freshReport(period = "2025-09"): RaafReport {
  const r = validReport();
  r.header.entityName = "PRC REGION 3, ZAMBALES";
  r.header.period = period;
  r.header.certificationDate = "2025-10-02";
  return r;
}

const create = (agent: typeof encoder1, report: RaafReport, key = crypto.randomUUID()) =>
  agent.post("/api/records").set(H).send({ idempotencyKey: key, report });

describe("authentication", () => {
  it("rejects anonymous access and bad credentials", async () => {
    expect((await request(app).get("/api/records")).status).toBe(401);
    const bad = await request(app).post("/api/auth/login").set(H).send({ username: "encoder1", password: "wrong-password" });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe("Incorrect username or password");
  });

  it("blocks state-changing requests without the CSRF header", async () => {
    const res = await encoder1.post("/api/records").send({});
    expect(res.status).toBe(403);
  });

  it("sets an httpOnly session cookie and returns the user's permissions", async () => {
    const res = await request(app).post("/api/auth/login").set(H).send({ username: "reviewer1", password: DEMO_PASSWORD });
    expect(String(res.headers["set-cookie"])).toMatch(/raaf_session=.*HttpOnly/i);
    expect(res.body).toMatchObject({ role: "reviewer" });
    expect(res.body.permissions).toContain("record:review");
    expect(res.body.permissions).not.toContain("record:create");
    expect(JSON.stringify(res.body)).not.toMatch(/hash/i);
  });

  it("locks out repeated failed sign-ins", async () => {
    let last = 0;
    for (let i = 0; i < 9; i++) last = (await request(app).post("/api/auth/login").set(H).send({ username: "lockme", password: "nope" })).status;
    expect(last).toBe(429);
  });
});

describe("demo data and dashboard", () => {
  it("each demo record has the documented validation status", async () => {
    const res = await admin.get("/api/records?pageSize=50&sort=ref&dir=asc");
    const byRef = res.body.items.map((r: { validationStatus: string; workflowStatus: string }) => `${r.validationStatus}/${r.workflowStatus}`);
    expect(byRef).toEqual(["VALID/APPROVED", "VALID/FOR_REVIEW", "ERROR/DRAFT", "WARNING/DRAFT", "ERROR/DRAFT", "ERROR/DRAFT", "ERROR/DRAFT"]);
    expect(res.body.items[0].readyForReporting).toBe(true);
    expect(res.body.items[1].readyForReporting).toBe(false);
  });

  it("reports the dashboard figures", async () => {
    const d = (await admin.get("/api/dashboard")).body;
    expect(d).toMatchObject({ total: 7, valid: 2, warning: 1, error: 4, pending: 0, forReview: 1, approved: 1, duplicates: 1, successRate: 28.6 });
    expect(d.topIssues.length).toBeGreaterThan(0);
    expect(d.topIssues[0]).toHaveProperty("ruleId");
  });

  it("the duplicate demo record is flagged against the original", async () => {
    const list = (await admin.get("/api/records?pageSize=50&sort=ref&dir=asc")).body.items;
    const dup = (await admin.get(`/api/records/${list[6].id}`)).body;
    expect(dup.validation.issues.find((i: { ruleId: string }) => i.ruleId === "RAAF-DUP-001").message).toContain("RAAF-000001");
  });
});

describe("encode -> validate -> correct -> revalidate -> review -> approve", () => {
  it("runs the whole workflow", async () => {
    // 1. save an incomplete draft (drafts may be incomplete)
    const draft = freshReport();
    draft.header.certificationDate = "";
    draft.totals.endingQty = draft.totals.endingQty! + 5;
    draft.lines[0]!.ending.qty = 99;
    const created = await create(encoder1, draft);
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(created.body).toMatchObject({ workflowStatus: "DRAFT", validationStatus: "PENDING", version: 1, refNo: expect.stringMatching(/^RAAF-\d{6}$/) });

    // 2. validate: errors point at the exact fields
    const v1 = await encoder1.post(`/api/records/${id}/validate`).set(H);
    expect(v1.status).toBe(200);
    expect(v1.body.validationStatus).toBe("ERROR");
    const paths = v1.body.validation.issues.map((i: { fieldPath: string }) => i.fieldPath);
    expect(paths).toEqual(expect.arrayContaining(["header.certificationDate", "lines.0.ending.qty", "totals.endingQty"]));

    // 3. an errored record cannot be submitted
    const blocked = await encoder1.post(`/api/records/${id}/submit`).set(H);
    expect(blocked.status).toBe(422);

    // 4. fix and save: the edit invalidates the earlier result
    const fixed = freshReport();
    const saved = await encoder1.put(`/api/records/${id}`).set(H).send({ expectedVersion: 1, report: fixed });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ version: 2, validationStatus: "PENDING" });
    expect(saved.body.validation.stale).toBe(true);

    // 5. revalidate: now valid, and the history keeps both runs
    const v2 = await encoder1.post(`/api/records/${id}/validate`).set(H);
    expect(v2.body.validationStatus).toBe("VALID");
    expect(v2.body.validation.stale).toBe(false);
    const history = (await encoder1.get(`/api/records/${id}/validations`)).body;
    expect(history.map((h: { status: string }) => h.status)).toEqual(["VALID", "ERROR"]);
    const oldRun = (await encoder1.get(`/api/records/${id}/validations/${history[1].id}`)).body;
    expect(oldRun.issues.length).toBeGreaterThan(0);

    // 6. not "ready for reporting" yet: draft exports are stamped
    const draftCsv = await encoder1.get(`/api/records/${id}/export.csv`);
    expect(draftCsv.text).toContain("DRAFT / UNVALIDATED");
    expect(draftCsv.headers["content-disposition"]).toContain("_DRAFT");

    // 7. submit; the encoder cannot approve their own record or anyone's
    expect((await encoder1.post(`/api/records/${id}/submit`).set(H)).body.workflowStatus).toBe("FOR_REVIEW");
    expect((await encoder1.post(`/api/records/${id}/approve`).set(H).send({})).status).toBe(403);

    // 8. reviewer approves
    const approved = await reviewer.post(`/api/records/${id}/approve`).set(H).send({});
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ workflowStatus: "APPROVED", validationStatus: "VALID", readyForReporting: true, reviewedByName: "Rina Reviewer" });

    // 9. approved reports export as validated; approved records are locked
    const csv = await reviewer.get(`/api/records/${id}/export.csv`);
    expect(csv.text).toContain("VALIDATED - READY FOR REPORTING");
    expect(csv.text.startsWith("﻿")).toBe(true);
    const xlsx = await reviewer.get(`/api/records/${id}/export.xlsx`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe("PK"); // a real zip/xlsx container
    expect((await encoder1.put(`/api/records/${id}`).set(H).send({ expectedVersion: 2, report: fixed })).status).toBe(409);

    // 10. reviewer returns it for correction; it is a draft again
    const returned = await reviewer.post(`/api/records/${id}/return`).set(H).send({ note: "Please recheck line 3" });
    expect(returned.body).toMatchObject({ workflowStatus: "DRAFT", readyForReporting: false });
  });

  it("editing a record that is for review sends it back to draft and clears the approval path", async () => {
    const id = (await create(encoder1, freshReport("2025-08"))).body.id;
    await encoder1.post(`/api/records/${id}/submit`).set(H);
    const edited = freshReport("2025-08");
    edited.header.fundCluster = "01";
    const res = await encoder1.put(`/api/records/${id}`).set(H).send({ expectedVersion: 1, report: edited });
    expect(res.body).toMatchObject({ workflowStatus: "DRAFT", validationStatus: "PENDING", version: 2 });
  });

  it("a record with warnings needs a written acknowledgement to approve", async () => {
    const warn = freshReport("2025-07");
    warn.header.notedByName = "";
    const id = (await create(encoder1, warn)).body.id;
    expect((await encoder1.post(`/api/records/${id}/submit`).set(H)).body.validationStatus).toBe("WARNING");
    expect((await reviewer.post(`/api/records/${id}/approve`).set(H).send({})).status).toBe(422);
    const ok = await reviewer.post(`/api/records/${id}/approve`).set(H).send({ note: "Regional Director to sign on paper copy" });
    expect(ok.body).toMatchObject({ workflowStatus: "APPROVED", validationStatus: "WARNING", readyForReporting: true, reviewNote: "Regional Director to sign on paper copy" });
  });

  it("re-validates at approval time and refuses if the data has since become invalid", async () => {
    const id = (await create(encoder1, freshReport("2025-06"))).body.id;
    await encoder1.post(`/api/records/${id}/submit`).set(H);
    // a second report for the same entity + month appears while the first awaits review
    await create(encoder2, freshReport("2025-06"));
    const res = await reviewer.post(`/api/records/${id}/approve`).set(H).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/validation errors/);
  });
});

describe("data integrity", () => {
  it("a retried create with the same idempotency key does not create a second record", async () => {
    const key = crypto.randomUUID();
    const a = await create(encoder1, freshReport("2025-05"), key);
    const b = await create(encoder1, freshReport("2025-05"), key);
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.body.id).toBe(a.body.id);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM raaf_records WHERE idempotency_key = ?").get(key) as { n: number }).n;
    expect(count).toBe(1);
  });

  it("refuses to silently overwrite: a stale save is a 409 and changes nothing", async () => {
    const id = (await create(encoder1, freshReport("2025-04"))).body.id;
    const first = freshReport("2025-04");
    first.header.fundCluster = "A";
    expect((await encoder1.put(`/api/records/${id}`).set(H).send({ expectedVersion: 1, report: first })).status).toBe(200);
    const stale = freshReport("2025-04");
    stale.header.fundCluster = "B";
    const res = await encoder1.put(`/api/records/${id}`).set(H).send({ expectedVersion: 1, report: stale });
    expect(res.status).toBe(409);
    expect((await encoder1.get(`/api/records/${id}`)).body.report.header.fundCluster).toBe("A");
  });

  it("stamps creator, modifier and times, and audits field-level old/new values", async () => {
    const created = await create(encoder1, freshReport("2025-03"));
    const id = created.body.id as string;
    const edited = freshReport("2025-03");
    edited.header.fundCluster = "101";
    edited.lines[0]!.remarks = "checked";
    await encoder1.put(`/api/records/${id}`).set(H).send({ expectedVersion: 1, report: edited });
    const rec = (await encoder1.get(`/api/records/${id}`)).body;
    expect(rec).toMatchObject({ createdByName: "Elena Encoder", updatedByName: "Elena Encoder" });
    expect(new Date(rec.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(rec.createdAt).getTime());

    const audit = (await encoder1.get(`/api/records/${id}/audit`)).body as { action: string; field: string | null; old_value: string | null; new_value: string | null; username: string }[];
    const change = audit.find((a) => a.field === "header.fundCluster")!;
    expect(change).toMatchObject({ action: "record.update", old_value: "", new_value: "101", username: "encoder1" });
    expect(audit.find((a) => a.field === "lines.0.remarks")).toMatchObject({ old_value: "", new_value: "checked" });
    expect(audit.some((a) => a.action === "record.create")).toBe(true);
  });

  it("the audit log is append-only at the database level", () => {
    expect(() => db.exec("UPDATE audit_logs SET username = 'x'")).toThrow(/append-only/);
    expect(() => db.exec("DELETE FROM audit_logs")).toThrow(/append-only/);
  });

  it("a saved edit that changes nothing does not bump the version", async () => {
    const id = (await create(encoder1, freshReport("2025-02"))).body.id;
    const res = await encoder1.put(`/api/records/${id}`).set(H).send({ expectedVersion: 1, report: freshReport("2025-02") });
    expect(res.body.version).toBe(1);
  });

  it("rejects malformed input server-side regardless of the client", async () => {
    const bad = freshReport() as unknown as { lines: { beginning: { qty: unknown } }[] };
    bad.lines[0]!.beginning.qty = "forty";
    const res = await create(encoder1, bad as unknown as RaafReport);
    expect(res.status).toBe(400);
    expect((await encoder1.post("/api/records").set(H).send({ idempotencyKey: "short", report: {} })).status).toBe(400);
  });
});

describe("authorization", () => {
  it("encoders only see their own records; others look non-existent", async () => {
    const mine = (await encoder1.get("/api/records?pageSize=100")).body.items as { createdBy: string }[];
    expect(new Set(mine.map((r) => r.createdBy)).size).toBe(1);
    const theirs = (await admin.get("/api/records?pageSize=100&sort=ref&dir=asc")).body.items.find((r: { createdByName: string }) => r.createdByName === "Eddie Encoder");
    expect((await encoder1.get(`/api/records/${theirs.id}`)).status).toBe(404);
    expect((await encoder1.put(`/api/records/${theirs.id}`).set(H).send({ expectedVersion: 1, report: freshReport() })).status).toBe(404);
  });

  it("reviewers can read everything but cannot create or edit", async () => {
    const all = (await reviewer.get("/api/records?pageSize=100")).body.total;
    expect(all).toBeGreaterThan(7);
    expect((await create(reviewer, freshReport("2024-12"))).status).toBe(403);
    const id = (await reviewer.get("/api/records?pageSize=1&validation=ERROR")).body.items[0].id;
    expect((await reviewer.put(`/api/records/${id}`).set(H).send({ expectedVersion: 1, report: freshReport() })).status).toBe(403);
  });

  it("admin-only endpoints are closed to other roles", async () => {
    for (const agent of [encoder1, reviewer]) {
      expect((await agent.get("/api/audit")).status).toBe(403);
      expect((await agent.get("/api/users")).status).toBe(403);
      expect((await agent.put("/api/rules/RAAF-REQ-003").set(H).send({})).status).toBe(403);
      expect((await agent.put("/api/settings").set(H).send({})).status).toBe(403);
    }
    expect((await admin.get("/api/audit")).status).toBe(200);
  });

  it("an administrator cannot approve a record they encoded", async () => {
    const id = (await create(admin, freshReport("2024-11"))).body.id;
    expect((await admin.post(`/api/records/${id}/submit`).set(H)).body.workflowStatus).toBe("FOR_REVIEW");
    expect((await admin.post(`/api/records/${id}/approve`).set(H).send({})).status).toBe(403);
  });

  it("voiding needs a reason and frees the month for a replacement report", async () => {
    const a = (await create(encoder2, freshReport("2024-10"))).body.id;
    const b = (await create(encoder2, freshReport("2024-10"))).body.id;
    expect((await encoder2.post(`/api/records/${b}/validate`).set(H)).body.validationStatus).toBe("ERROR");
    expect((await encoder2.post(`/api/records/${a}/void`).set(H).send({ note: "" })).status).toBe(400);
    expect((await encoder2.post(`/api/records/${a}/void`).set(H).send({ note: "Encoded twice by mistake" })).body.workflowStatus).toBe("VOID");
    expect((await encoder2.post(`/api/records/${b}/validate`).set(H)).body.validationStatus).toBe("VALID");
  });
});

describe("configurable rules", () => {
  it("an administrator can change a rule's severity and the next validation obeys it", async () => {
    const report = freshReport("2024-09");
    report.header.attestedByName = "";
    const id = (await create(encoder1, report)).body.id;
    expect((await encoder1.post(`/api/records/${id}/validate`).set(H)).body.validationStatus).toBe("WARNING");

    const rule = (await admin.get("/api/rules")).body.find((r: { id: string }) => r.id === "RAAF-REQ-003");
    const put = (patch: object) => admin.put("/api/rules/RAAF-REQ-003").set(H).send({ severity: rule.severity, enabled: true, message: rule.message, resolution: rule.resolution, condition: rule.condition, ...patch });

    expect((await put({ severity: "ERROR" })).status).toBe(200);
    expect((await encoder1.post(`/api/records/${id}/validate`).set(H)).body.validationStatus).toBe("ERROR");

    expect((await put({ enabled: false })).status).toBe(200);
    expect((await encoder1.post(`/api/records/${id}/validate`).set(H)).body.validationStatus).toBe("VALID");

    await put({ severity: "WARNING", enabled: true });
    const audit = (await admin.get("/api/audit?action=rule.update")).body.items as { field: string; old_value: string; new_value: string }[];
    expect(audit.find((a) => a.field === "severity" && a.new_value === "ERROR")?.old_value).toBe("WARNING");
  });
});

describe("search, filter, sort and paging", () => {
  it("filters by text, validation result, workflow, period and user", async () => {
    expect((await admin.get("/api/records?q=TARLAC")).body.items.map((r: { entityName: string }) => r.entityName)).toEqual(["PRC REGION 3, TARLAC"]);
    expect((await admin.get("/api/records?q=OPTOMETRSIT")).body.total).toBe(1); // matches a form name inside the lines
    expect((await admin.get("/api/records?validation=WARNING")).body.items.every((r: { validationStatus: string }) => r.validationStatus === "WARNING")).toBe(true);
    expect((await admin.get("/api/records?workflow=APPROVED&q=PAMPANGA")).body.items.every((r: { workflowStatus: string }) => r.workflowStatus === "APPROVED")).toBe(true);
    const range = (await admin.get("/api/records?from=2025-03&to=2025-03&q=PRC")).body.items;
    expect(range.every((r: { period: string }) => r.period === "2025-03")).toBe(true);
    const users = (await admin.get("/api/user-options")).body as { id: string; displayName: string }[];
    const eddie = users.find((u) => u.displayName === "Eddie Encoder")!;
    expect((await admin.get(`/api/records?user=${eddie.id}&pageSize=100`)).body.items.every((r: { createdByName: string }) => r.createdByName === "Eddie Encoder")).toBe(true);
  });

  it("pages and sorts", async () => {
    const p1 = (await admin.get("/api/records?pageSize=3&page=1&sort=period&dir=asc&q=PRC")).body;
    const p2 = (await admin.get("/api/records?pageSize=3&page=2&sort=period&dir=asc&q=PRC")).body;
    expect(p1.items).toHaveLength(3);
    expect(p1.total).toBeGreaterThan(3);
    expect(p1.items[0].period <= p1.items[2].period).toBe(true);
    expect(p2.items[0].id).not.toBe(p1.items[0].id);
  });

  it("treats LIKE wildcards in the search box literally", async () => {
    expect((await admin.get("/api/records?q=%25")).body.total).toBe(0);
  });
});
