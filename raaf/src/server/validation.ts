import type { RaafReport, ValidationEnv, ValidationResult } from "../shared/types";
import { validateReport } from "../shared/validation/engine";
import { previousPeriod } from "../shared/validation/helpers";
import type { AuthUser } from "./auth";
import { logAudit } from "./audit";
import type { Db } from "./db";
import { nowIso, transaction } from "./db";
import { conflict } from "./errors";
import { getReadable, loadReport, loadRow } from "./records";
import { loadRules } from "./rules";

/** Today in the organisation's timezone (YYYY-MM-DD), used for "not in the future" checks. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Gather everything outside the report that the cross-record rules need. */
export function buildEnv(db: Db, recordId: string, report: RaafReport, today: string): ValidationEnv {
  const row = loadRow(db, recordId)!;
  const live = "workflow_status != 'VOID'";
  const otherReports = db
    .prepare(`SELECT id, ref_no AS refNo FROM raaf_records WHERE entity_key = ? AND period = ? AND id != ? AND ${live} ORDER BY seq`)
    .all(row.entity_key, row.period, recordId) as { id: string; refNo: string }[];

  const prev = previousPeriod(row.period);
  const prevRow = prev
    ? (db.prepare(`SELECT * FROM raaf_records WHERE entity_key = ? AND period = ? AND id != ? AND ${live} ORDER BY (workflow_status = 'APPROVED') DESC, seq DESC LIMIT 1`).get(row.entity_key, prev, recordId) as Parameters<typeof loadReport>[1] | undefined)
    : undefined;

  const hasEarlierReports = !!db.prepare(`SELECT 1 FROM raaf_records WHERE entity_key = ? AND period < ? AND id != ? AND ${live} LIMIT 1`).get(row.entity_key, row.period, recordId);

  return {
    today,
    formCatalog: (db.prepare("SELECT name FROM form_catalog ORDER BY name").all() as { name: string }[]).map((r) => r.name),
    knownEntities: (db.prepare(`SELECT DISTINCT entity_name FROM raaf_records WHERE ${live} AND id != ?`).all(recordId) as { entity_name: string }[]).map((r) => r.entity_name),
    otherReports,
    previousReport: prevRow ? { refNo: prevRow.ref_no, report: loadReport(db, prevRow) } : null,
    hasEarlierReports,
  };
}

/**
 * Validate the stored record, persist the run (with every issue) and update the record's status.
 * Rule-based only. An AI-assisted review would add its own run/issues with source = 'ai'.
 */
export function runValidation(db: Db, user: AuthUser, recordId: string, today: string): ValidationResult & { runId: number } {
  return transaction(db, () => {
    const row = getReadable(db, user, recordId);
    if (row.workflow_status === "VOID") throw conflict("A void record cannot be validated");
    const report = loadReport(db, row);
    const result = validateReport(report, loadRules(db), buildEnv(db, recordId, report, today));
    const now = nowIso();

    const runId = Number(
      db.prepare("INSERT INTO validation_runs (record_id, record_version, status, error_count, warning_count, run_at, run_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(recordId, row.version, result.status, result.errorCount, result.warningCount, now, user.id).lastInsertRowid,
    );
    const ruleTypes = new Map(loadRules(db).map((r) => [r.id, r.type]));
    const insert = db.prepare(
      `INSERT INTO validation_issues (run_id, rule_id, rule_type, severity, field_path, line_no, section, message, resolution, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const i of result.issues) insert.run(runId, i.ruleId, ruleTypes.get(i.ruleId) ?? "", i.severity, i.fieldPath, i.lineNo, i.section, i.message, i.resolution, i.source);

    db.prepare("UPDATE raaf_records SET validation_status = ?, validated_version = ?, validated_at = ? WHERE id = ?").run(result.status, row.version, now, recordId);
    logAudit(db, user, {
      action: "record.validate", entityType: "record", entityId: recordId, recordId, recordRef: row.ref_no,
      field: "validationStatus", oldValue: row.validation_status, newValue: `${result.status} (${result.errorCount} errors, ${result.warningCount} warnings)`,
    });
    return { ...result, runId };
  });
}
