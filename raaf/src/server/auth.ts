import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Permission } from "../shared/permissions";
import { can } from "../shared/permissions";
import type { Role } from "../shared/types";
import type { Db } from "./db";
import { nowIso } from "./db";
import { forbidden, unauthorized } from "./errors";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

export const SESSION_COOKIE = "raaf_session";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function createSession(db: Db, userId: string, ttlHours: number): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(sha256(token), userId, expiresAt.toISOString());
  return { token, expiresAt };
}

export function destroySession(db: Db, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function userFromToken(db: Db, token: string): AuthUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name AS displayName, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
    )
    .get(sha256(token), nowIso()) as AuthUser | undefined;
  return row ?? null;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export const authenticate = (db: Db) => (req: Request, _res: Response, next: NextFunction) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) req.user = userFromToken(db, token) ?? undefined;
  next();
};

export function requireUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requirePermission(req: Request, permission: Permission): AuthUser {
  const user = requireUser(req);
  if (!can(user.role, permission)) throw forbidden();
  return user;
}

/** Remove expired sessions. Cheap enough to run at login. */
export function purgeExpiredSessions(db: Db): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso());
}

/** In-memory brute-force limiter: 8 failed sign-ins per key per 15 minutes. */
export class LoginLimiter {
  private failures = new Map<string, number[]>();
  constructor(private max = 8, private windowMs = 15 * 60_000) {}

  private recent(key: string): number[] {
    const cutoff = Date.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    this.failures.set(key, list);
    return list;
  }
  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.max;
  }
  fail(key: string): void {
    this.recent(key).push(Date.now());
  }
  reset(key: string): void {
    this.failures.delete(key);
  }
}
