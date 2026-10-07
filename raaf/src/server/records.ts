import { randomUUID } from "node:crypto";
import type { RaafLine, RaafReport, ValidationIssue, ValidationStatus, WorkflowStatus } from "../shared/types";
import type { RecordActions, RecordSummary, RunInfo } from "../shared/api";
import { can } from "../shared/permissions";
import { normalizeName } from "../shared/validation/helpers";
import type { AuthUser } from "./auth";
import { logAudit } from "./audit";
import type { Db } from "./db";
import { nowIso, transaction } from "./db";
import { conflict, forbidden, notFound } from "./errors";

/* ---------- row <-> model mapping ---------- */

interface RecordRow {
  id: string; seq: number; ref_no: string; entity_name: string; entity_key: string; fund_cluster: string; period: string;
  certification_date: string;
  prepared_by_name: string; prepared_by_title: string; checked_by_name: string; checked_by_title: string;
  attested_by_name: string; attested_by_title: string; noted_by_name: string; noted_by_title: string;
  total_line_count: number | null; total_beginning_qty: number | null; total_receipt_qty: number | null;
  total_issue_qty: number | null; total_ending_qty: number | null;
  workflow_status: WorkflowStatus; validation_status: ValidationStatus; validated_version: number | null; validated_at: string | null;
  version: number; reviewed_by: string | null; reviewed_at: string | null; review_note: string; void_reason: string;
  created_at: string; created_by: string; updated_at: string; updated_by: string;
}

const LINE_COLS = ["beg", "rec", "iss", "end"] as const;
const GROUP_OF = { beg: "beginning", rec: "receipt", iss: "issue", end: "ending" } as const;

const rowToLine = (r: Record<string, unknown>): RaafLine => {
  const serial = (p: (typeof LINE_COLS)[number]) => ({ qty: r[`${p}_qty`] as number | null, from: r[`${p}_from`] as number | null, to: r[`${p}_to`] as number | null });
  return {
    formName: r.form_name as string,
    formNumber: r.form_number as string,
    faceValue: r.face_value as number | null,
    beginning: serial("beg"),
    receipt: serial("rec"),
    issue: serial("iss"),
    ending: serial("end"),
    remarks: r.remarks as string,
  };
};

const rowToReport = (row: RecordRow, lines: RaafLine[]): RaafReport => ({
  header: {
    entityName: row.entity_name, fundCluster: row.fund_cluster, period: row.period, certificationDate: row.certification_date,
    preparedByName: row.prepared_by_name, preparedByTitle: row.prepared_by_title,
    checkedByName: row.checked_by_name, checkedByTitle: row.checked_by_title,
    attestedByName: row.attested_by_name, attestedByTitle: row.attested_by_title,
    notedByName: row.noted_by_name, notedByTitle: row.noted_by_title,
  },
  totals: {
    lineCount: row.total_line_count, beginningQty: row.total_beginning_qty, receiptQty: row.total_receipt_qty,
    issueQty: row.total_issue_qty, endingQty: row.total_ending_qty,
  },
  lines,
});

export function loadRow(db: Db, id: string): RecordRow | undefined {
  return db.prepare("SELECT * FROM raaf_records WHERE id = ?").get(id) as RecordRow | undefined;
}

export function loadReport(db: Db, row: RecordRow): RaafReport {
  const lines = (db.prepare("SELECT * FROM raaf_details WHERE record_id = ? ORDER BY line_no").all(row.id) as Record<string, unknown>[]).map(rowToLine);
  return rowToReport(row, lines);
}

const isReady = (r: Pick<RecordRow, "workflow_status" | "validation_status" | "validated_version" | "version">) =>
  r.workflow_status === "APPROVED" && r.validated_version === r.version && (r.validation_status === "VALID" || r.validation_status === "WARNING");

const SUMMARY_SQL = `
  SELECT r.*, cu.display_name AS created_by_name, uu.display_name AS updated_by_name, ru.display_name AS reviewed_by_name,
         vr.error_count AS error_count, vr.warning_count AS warning_count
  FROM raaf_records r
  JOIN users cu ON cu.id = r.created_by
  JOIN users uu ON uu.id = r.updated_by
  LEFT JOIN users ru ON ru.id = r.reviewed_by
  LEFT JOIN validation_runs vr ON vr.id = (SELECT MAX(id) FROM validation_runs WHERE record_id = r.id)`;

type SummaryRow = RecordRow & { created_by_name: string; updated_by_name: string; reviewed_by_name: string | null; error_count: number | null; warning_count: number | null };

const toSummary = (r: SummaryRow): RecordSummary => ({
  id: r.id, refNo: r.ref_no, entityName: r.entity_name, period: r.period, certificationDate: r.certification_date,
  workflowStatus: r.workflow_status, validationStatus: r.validation_status, readyForReporting: isReady(r), version: r.version,
  errorCount: r.error_count, warningCount: r.warning_count,
  createdAt: r.created_at, createdBy: r.created_by, createdByName: r.created_by_name,
  updatedAt: r.updated_at, updatedByName: r.updated_by_name,
  reviewedByName: r.reviewed_by_name, reviewedAt: r.reviewed_at, reviewNote: r.review_note, voidReason: r.void_reason,
});

/* ---------- access control ---------- */

const canRead = (user: AuthUser, row: RecordRow) => can(user.role, "record:read:all") || row.created_by === user.id;
const isOwnerOrAny = (user: AuthUser, row: RecordRow) => can(user.role, "record:edit:any") || (row.created_by === user.id && can(user.role, "record:create"));

export function actionsFor(user: AuthUser, row: RecordRow): RecordActions {
  const open = row.workflow_status === "DRAFT" || row.workflow_status === "FOR_REVIEW";
  return {
    edit: open && isOwnerOrAny(user, row),
    validate: open && can(user.role, "record:validate") && canRead(user, row),
    submit: row.workflow_status === "DRAFT" && can(user.role, "record:submit") && isOwnerOrAny(user, row),
    approve: row.workflow_status === "FOR_REVIEW" && can(user.role, "record:review") && row.created_by !== user.id,
    return: (row.workflow_status === "FOR_REVIEW" || row.workflow_status === "APPROVED") && can(user.role, "record:review"),
    void: row.workflow_status !== "VOID" && can(user.role, "record:void") && isOwnerOrAny(user, row) && (row.workflow_status !== "APPROVED" || can(user.role, "record:edit:any")),
  };
}

/** Records the user may not read look like they do not exist. */
export function getReadable(db: Db, user: AuthUser, id: string): RecordRow {
  const row = loadRow(db, id);
  if (!row || !canRead(user, row)) throw notFound("Record not found");
  return row;
}

/* ---------- writes ---------- */

function writeLines(db: Db, recordId: string, lines: RaafLine[]): void {
  db.prepare("DELETE FROM raaf_details WHERE record_id = ?").run(recordId);
  const insert = db.prepare(
    `INSERT INTO raaf_details (record_id, line_no, form_name, form_number, face_value,
       beg_qty, beg_from, beg_to, rec_qty, rec_from, rec_to, iss_qty, iss_from, iss_to, end_qty, end_from, end_to, remarks)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  lines.forEach((l, i) =>
    insert.run(
      recordId, i + 1, l.formName, l.formNumber, l.faceValue,
      l.beginning.qty, l.beginning.from, l.beginning.to, l.receipt.qty, l.receipt.from, l.receipt.to,
      l.issue.qty, l.issue.from, l.issue.to, l.ending.qty, l.ending.from, l.ending.to, l.remarks,
    ),
  );
}

const headerParams = (r: RaafReport): (string | number | null)[] => [
  r.header.entityName.trim(), normalizeName(r.header.entityName), r.header.fundCluster, r.header.period, r.header.certificationDate,
  r.header.preparedByName, r.header.preparedByTitle, r.header.checkedByName, r.header.checkedByTitle,
  r.header.attestedByName, r.header.attestedByTitle, r.header.notedByName, r.header.notedByTitle,
  r.totals.lineCount, r.totals.beginningQty, r.totals.receiptQty, r.totals.issueQty, r.totals.endingQty,
];

export function createRecord(db: Db, user: AuthUser, report: RaafReport, idempotencyKey: string): { row: RecordRow; created: boolean } {
  if (!can(user.role, "record:create")) throw forbidden();
  return transaction(db, () => {
    const existing = db.prepare("SELECT * FROM raaf_records WHERE idempotency_key = ?").get(idempotencyKey) as RecordRow | undefined;
    if (existing) {
      // A double-click or retry: hand back the record from the first request, never create a second one.
      if (existing.created_by !== user.id) throw conflict("This submission key belongs to another user");
      return { row: existing, created: false };
    }
    const id = randomUUID();
    const seq = (db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM raaf_records").get() as { n: number }).n;
    const refNo = `RAAF-${String(seq).padStart(6, "0")}`;
    const now = nowIso();
    db.prepare(
      `INSERT INTO raaf_records (id, seq, ref_no, idempotency_key, entity_name, entity_key, fund_cluster, period, certification_date,
         prepared_by_name, prepared_by_title, checked_by_name, checked_by_title, attested_by_name, attested_by_title, noted_by_name, noted_by_title,
         total_line_count, total_beginning_qty, total_receipt_qty, total_issue_qty, total_ending_qty,
         created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, seq, refNo, idempotencyKey, ...headerParams(report), now, user.id, now, user.id);
    writeLines(db, id, report.lines);
    logAudit(db, user, { action: "record.create", entityType: "record", entityId: id, recordId: id, recordRef: refNo, newValue: `${report.header.entityName} ${report.header.period}, ${report.lines.length} lines` });
    return { row: loadRow(db, id)!, created: true };
  });
}

/** Flatten a report to leaf path -> value so two versions can be diffed field by field. */
export function flatten(report: RaafReport): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const walk = (prefix: string, v: unknown) => {
    if (v !== null && typeof v === "object") for (const [k, child] of Object.entries(v)) walk(prefix ? `${prefix}.${k}` : k, child);
    else out.set(prefix, v);
  };
  walk("", report);
  return out;
}

export function diffReports(before: RaafReport, after: RaafReport): { field: string; oldValue: unknown; newValue: unknown }[] {
  const a = flatten(before);
  const b = flatten(after);
  const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const [x, y] = [a.get(key), b.get(key)];
    if (x !== y) changes.push({ field: key, oldValue: x, newValue: y });
  }
  return changes;
}

export function updateRecord(db: Db, user: AuthUser, id: string, report: RaafReport, expectedVersion: number): RecordRow {
  return transaction(db, () => {
    const row = getReadable(db, user, id);
    if (!actionsFor(user, row).edit) {
      if (row.workflow_status === "APPROVED" || row.workflow_status === "VOID") throw conflict(`A ${row.workflow_status.toLowerCase()} record cannot be edited`);
      throw forbidden();
    }
    // Optimistic concurrency: someone else saved since this user loaded the record.
    if (row.version !== expectedVersion) {
      throw conflict("This record was changed by someone else since you opened it. Reload to see their changes.", { currentVersion: row.version });
    }
    const changes = diffReports(loadReport(db, row), report);
    if (!changes.length) return row;

    const now = nowIso();
    db.prepare(
      `UPDATE raaf_records SET entity_name = ?, entity_key = ?, fund_cluster = ?, period = ?, certification_date = ?,
         prepared_by_name = ?, prepared_by_title = ?, checked_by_name = ?, checked_by_title = ?, attested_by_name = ?, attested_by_title = ?, noted_by_name = ?, noted_by_title = ?,
         total_line_count = ?, total_beginning_qty = ?, total_receipt_qty = ?, total_issue_qty = ?, total_ending_qty = ?,
         version = version + 1, validation_status = 'PENDING', workflow_status = 'DRAFT',
         reviewed_by = NULL, reviewed_at = NULL, updated_at = ?, updated_by = ?
       WHERE id = ?`,
    ).run(...headerParams(report), now, user.id, id);
    writeLines(db, id, report.lines);
    for (const c of changes) {
      logAudit(db, user, { action: "record.update", entityType: "record", entityId: id, recordId: id, recordRef: row.ref_no, field: c.field, oldValue: c.oldValue, newValue: c.newValue });
    }
    if (row.workflow_status === "FOR_REVIEW") {
      logAudit(db, user, { action: "record.workflow", entityType: "record", entityId: id, recordId: id, recordRef: row.ref_no, field: "workflowStatus", oldValue: "FOR_REVIEW", newValue: "DRAFT" });
    }
    return loadRow(db, id)!;
  });
}

/* ---------- reads ---------- */

export interface ListFilters {
  q?: string;
  fromPeriod?: string;
  toPeriod?: string;
  workflow?: string;
  validation?: string;
  userId?: string;
  sort?: string;
  dir?: string;
  page?: number;
  pageSize?: number;
}

const SORTS: Record<string, string> = {
  updated: "r.updated_at", created: "r.created_at", period: "r.period", ref: "r.seq", entity: "r.entity_key",
  validation: "r.validation_status", workflow: "r.workflow_status", user: "cu.display_name",
};

export function listRecords(db: Db, user: AuthUser, f: ListFilters): { items: RecordSummary[]; total: number; page: number; pageSize: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (!can(user.role, "record:read:all")) {
    where.push("r.created_by = ?");
    params.push(user.id);
  }
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push(`(r.ref_no LIKE ? ESCAPE '\\' OR r.entity_name LIKE ? ESCAPE '\\' OR r.period LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM raaf_details d WHERE d.record_id = r.id AND d.form_name LIKE ? ESCAPE '\\'))`);
    params.push(like, like, like, like);
  }
  if (f.fromPeriod) { where.push("r.period >= ?"); params.push(f.fromPeriod); }
  if (f.toPeriod) { where.push("r.period <= ?"); params.push(f.toPeriod); }
  if (f.workflow) { where.push("r.workflow_status = ?"); params.push(f.workflow); }
  if (f.validation) { where.push("r.validation_status = ?"); params.push(f.validation); }
  if (f.userId) { where.push("r.created_by = ?"); params.push(f.userId); }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM raaf_records r JOIN users cu ON cu.id = r.created_by ${clause}`).get(...params) as { n: number }).n;
  const pageSize = Math.min(Math.max(f.pageSize ?? 20, 1), 100);
  const page = Math.max(f.page ?? 1, 1);
  const orderCol = SORTS[f.sort ?? "updated"] ?? SORTS.updated;
  const dir = f.dir === "asc" ? "ASC" : "DESC";
  const rows = db
    .prepare(`${SUMMARY_SQL} ${clause} ORDER BY ${orderCol} ${dir}, r.seq DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as unknown as SummaryRow[];
  return { items: rows.map(toSummary), total, page, pageSize };
}

export function getSummary(db: Db, id: string): RecordSummary {
  return toSummary(db.prepare(`${SUMMARY_SQL} WHERE r.id = ?`).get(id) as unknown as SummaryRow);
}

export function getRunIssues(db: Db, runId: number): ValidationIssue[] {
  return (db.prepare("SELECT * FROM validation_issues WHERE run_id = ? ORDER BY id").all(runId) as Record<string, unknown>[]).map((r) => ({
    ruleId: r.rule_id as string, severity: r.severity as "ERROR" | "WARNING", fieldPath: r.field_path as string,
    lineNo: r.line_no as number | null, section: r.section as ValidationIssue["section"],
    message: r.message as string, resolution: r.resolution as string, source: r.source as "rule" | "ai",
  }));
}

export function listRuns(db: Db, recordId: string): RunInfo[] {
  return (
    db.prepare(
      `SELECT vr.*, u.display_name AS run_by_name FROM validation_runs vr JOIN users u ON u.id = vr.run_by WHERE record_id = ? ORDER BY vr.id DESC`,
    ).all(recordId) as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as number, recordVersion: r.record_version as number, status: r.status as RunInfo["status"],
    errorCount: r.error_count as number, warningCount: r.warning_count as number, runAt: r.run_at as string, runByName: r.run_by_name as string,
  }));
}

export function getDetail(db: Db, user: AuthUser, id: string) {
  const row = getReadable(db, user, id);
  const runs = listRuns(db, id);
  const latest = runs[0];
  return {
    ...getSummary(db, id),
    report: loadReport(db, row),
    actions: actionsFor(user, row),
    /** Issues from the most recent run. stale = the record has been edited since. */
    validation: latest ? { run: latest, stale: latest.recordVersion !== row.version, issues: getRunIssues(db, latest.id) } : null,
  };
}
