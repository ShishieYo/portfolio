import type { Db } from "./db";
import { nowIso } from "./db";

export interface Actor {
  id: string;
  username: string;
}

export interface AuditEntry {
  action: string;
  entityType: "record" | "rule" | "user" | "setting" | "session";
  entityId?: string;
  recordId?: string;
  recordRef?: string;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

const asText = (v: unknown): string | null => (v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v));

export function logAudit(db: Db, actor: Actor | { id: null; username: string }, e: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit_logs (at, user_id, username, action, entity_type, entity_id, record_id, record_ref, field, old_value, new_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    nowIso(), actor.id, actor.username, e.action, e.entityType, e.entityId ?? null, e.recordId ?? null,
    e.recordRef ?? null, e.field ?? null, asText(e.oldValue), asText(e.newValue),
  );
}
