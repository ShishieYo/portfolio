import type { RaafReport, ValidationIssue, ValidationStatus, WorkflowStatus } from "./types";
import type { Permission } from "./permissions";
import type { Role } from "./types";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  permissions: Permission[];
}

export interface RecordSummary {
  id: string;
  refNo: string;
  entityName: string;
  period: string;
  certificationDate: string;
  workflowStatus: WorkflowStatus;
  validationStatus: ValidationStatus;
  /** "Ready for reporting" requires an approved record whose approved version is the current one. */
  readyForReporting: boolean;
  version: number;
  errorCount: number | null;
  warningCount: number | null;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  updatedAt: string;
  updatedByName: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string;
  voidReason: string;
}

export interface RecordActions {
  edit: boolean;
  validate: boolean;
  submit: boolean;
  approve: boolean;
  return: boolean;
  void: boolean;
}

export interface RunInfo {
  id: number;
  recordVersion: number;
  status: Exclude<ValidationStatus, "PENDING">;
  errorCount: number;
  warningCount: number;
  runAt: string;
  runByName: string;
}

export interface RecordDetail extends RecordSummary {
  report: RaafReport;
  actions: RecordActions;
  /** Issues from the most recent run. stale = the record has been edited since. */
  validation: { run: RunInfo; stale: boolean; issues: ValidationIssue[] } | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardData {
  total: number;
  valid: number;
  warning: number;
  error: number;
  pending: number;
  forReview: number;
  approved: number;
  duplicates: number;
  /** Valid / validated records, as a percentage. null until something has been validated. */
  successRate: number | null;
  topIssues: { ruleId: string; severity: string; sample: string; count: number; records: number }[];
  recent: { id: string; refNo: string; entityName: string; period: string; validationStatus: string; workflowStatus: string; updatedAt: string }[];
}

export interface AuditRow {
  id: number;
  at: string;
  user_id: string | null;
  username: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  record_id: string | null;
  record_ref: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
}

export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  active: number;
  createdAt: string;
}
