import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','encoder','reviewer')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS form_catalog (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS validation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('header','line','record')),
  type TEXT NOT NULL,
  fields TEXT NOT NULL,
  condition TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('ERROR','WARNING')),
  message TEXT NOT NULL,
  resolution TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS raaf_records (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  ref_no TEXT NOT NULL UNIQUE,
  idempotency_key TEXT UNIQUE,
  entity_name TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  fund_cluster TEXT NOT NULL,
  period TEXT NOT NULL,
  certification_date TEXT NOT NULL,
  prepared_by_name TEXT NOT NULL, prepared_by_title TEXT NOT NULL,
  checked_by_name TEXT NOT NULL, checked_by_title TEXT NOT NULL,
  attested_by_name TEXT NOT NULL, attested_by_title TEXT NOT NULL,
  noted_by_name TEXT NOT NULL, noted_by_title TEXT NOT NULL,
  total_line_count NUMERIC, total_beginning_qty NUMERIC, total_receipt_qty NUMERIC,
  total_issue_qty NUMERIC, total_ending_qty NUMERIC,
  workflow_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (workflow_status IN ('DRAFT','FOR_REVIEW','APPROVED','VOID')),
  validation_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (validation_status IN ('PENDING','VALID','WARNING','ERROR')),
  validated_version INTEGER,
  validated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  void_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_records_period ON raaf_records(period);
CREATE INDEX IF NOT EXISTS idx_records_entity_period ON raaf_records(entity_key, period);
CREATE INDEX IF NOT EXISTS idx_records_status ON raaf_records(workflow_status, validation_status);
CREATE INDEX IF NOT EXISTS idx_records_created_by ON raaf_records(created_by);

CREATE TABLE IF NOT EXISTS raaf_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL REFERENCES raaf_records(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  form_name TEXT NOT NULL,
  form_number TEXT NOT NULL,
  face_value NUMERIC,
  beg_qty NUMERIC, beg_from NUMERIC, beg_to NUMERIC,
  rec_qty NUMERIC, rec_from NUMERIC, rec_to NUMERIC,
  iss_qty NUMERIC, iss_from NUMERIC, iss_to NUMERIC,
  end_qty NUMERIC, end_from NUMERIC, end_to NUMERIC,
  remarks TEXT NOT NULL,
  UNIQUE (record_id, line_no)
);

CREATE TABLE IF NOT EXISTS validation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL REFERENCES raaf_records(id),
  record_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('VALID','WARNING','ERROR')),
  error_count INTEGER NOT NULL,
  warning_count INTEGER NOT NULL,
  run_at TEXT NOT NULL,
  run_by TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_runs_record ON validation_runs(record_id, id);

CREATE TABLE IF NOT EXISTS validation_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  field_path TEXT NOT NULL,
  line_no INTEGER,
  section TEXT NOT NULL,
  message TEXT NOT NULL,
  resolution TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'rule'
);
CREATE INDEX IF NOT EXISTS idx_issues_run ON validation_issues(run_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  record_id TEXT,
  record_ref TEXT,
  field TEXT,
  old_value TEXT,
  new_value TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_record ON audit_logs(record_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(at);

-- The audit trail is append-only.
CREATE TRIGGER IF NOT EXISTS audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
`;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a write transaction; roll back if it throws. Joins the outer transaction when nested. */
export function transaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const nowIso = (): string => new Date().toISOString();
