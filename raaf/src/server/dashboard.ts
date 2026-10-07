import type { DashboardData } from "../shared/api";
import { can } from "../shared/permissions";
import type { AuthUser } from "./auth";
import type { Db } from "./db";

/** Counts are over the records the user may see; void records are excluded. */
export function getDashboard(db: Db, user: AuthUser): DashboardData {
  const own = can(user.role, "record:read:all") ? "" : "AND r.created_by = ?";
  const params = own ? [user.id] : [];
  const base = `FROM raaf_records r WHERE r.workflow_status != 'VOID' ${own}`;
  const count = (extra: string) => (db.prepare(`SELECT COUNT(*) AS n ${base} ${extra}`).get(...params) as { n: number }).n;

  const valid = count("AND r.validation_status = 'VALID'");
  const warning = count("AND r.validation_status = 'WARNING'");
  const error = count("AND r.validation_status = 'ERROR'");
  const validated = valid + warning + error;

  const latestRun = "SELECT MAX(id) FROM validation_runs WHERE record_id = r.id";
  const duplicates = (db.prepare(
    `SELECT COUNT(DISTINCT r.id) AS n ${base}
     AND r.validation_status != 'PENDING'
     AND EXISTS (SELECT 1 FROM validation_issues i WHERE i.run_id = (${latestRun}) AND i.rule_type IN ('duplicate_report','duplicate_lines'))`,
  ).get(...params) as { n: number }).n;

  const issues = db.prepare(
    `SELECT i.rule_id AS ruleId, i.severity AS severity, MIN(i.message) AS sample, COUNT(*) AS count, COUNT(DISTINCT r.id) AS records
     FROM raaf_records r JOIN validation_issues i ON i.run_id = (${latestRun})
     WHERE r.workflow_status != 'VOID' AND r.validation_status != 'PENDING' ${own}
     GROUP BY i.rule_id, i.severity ORDER BY records DESC, count DESC LIMIT 8`,
  ).all(...params) as DashboardData["topIssues"];

  const recent = db.prepare(
    `SELECT r.id, r.ref_no AS refNo, r.entity_name AS entityName, r.period, r.validation_status AS validationStatus, r.workflow_status AS workflowStatus, r.updated_at AS updatedAt
     ${base} ORDER BY r.updated_at DESC LIMIT 6`,
  ).all(...params) as DashboardData["recent"];

  return {
    total: count(""),
    valid, warning, error,
    pending: count("AND r.validation_status = 'PENDING'"),
    forReview: count("AND r.workflow_status = 'FOR_REVIEW'"),
    approved: count("AND r.workflow_status = 'APPROVED'"),
    duplicates,
    successRate: validated ? Math.round((valid / validated) * 1000) / 10 : null,
    topIssues: issues,
    recent,
  };
}
