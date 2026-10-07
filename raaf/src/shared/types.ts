export type Severity = "ERROR" | "WARNING";

/** Result of the latest validation run. PENDING = never validated, or edited since. */
export type ValidationStatus = "PENDING" | "VALID" | "WARNING" | "ERROR";

/** Where a record is in the encode -> review -> report workflow. */
export type WorkflowStatus = "DRAFT" | "FOR_REVIEW" | "APPROVED" | "VOID";

export type Role = "admin" | "encoder" | "reviewer";

/** A serial-numbered batch: quantity plus inclusive serial range. */
export interface Serial {
  qty: number | null;
  from: number | null;
  to: number | null;
}

export type GroupName = "beginning" | "receipt" | "issue" | "ending";
export const GROUPS: readonly GroupName[] = ["beginning", "receipt", "issue", "ending"];

export interface RaafLine {
  formName: string;
  formNumber: string;
  faceValue: number | null;
  beginning: Serial;
  receipt: Serial;
  issue: Serial;
  ending: Serial;
  remarks: string;
}

export interface RaafHeader {
  entityName: string;
  fundCluster: string;
  /** Reporting month, YYYY-MM */
  period: string;
  /** YYYY-MM-DD */
  certificationDate: string;
  preparedByName: string;
  preparedByTitle: string;
  checkedByName: string;
  checkedByTitle: string;
  attestedByName: string;
  attestedByTitle: string;
  notedByName: string;
  notedByTitle: string;
}

/** Control totals typed in by the encoder and cross-checked against the lines. */
export interface RaafTotals {
  lineCount: number | null;
  beginningQty: number | null;
  receiptQty: number | null;
  issueQty: number | null;
  endingQty: number | null;
}

export interface RaafReport {
  header: RaafHeader;
  totals: RaafTotals;
  lines: RaafLine[];
}

export interface RuleDef {
  id: string;
  name: string;
  /** header: evaluated once on the report. line: once per line. record: evaluator walks the lines itself. */
  scope: "header" | "line" | "record";
  type: string;
  /** Fields the rule is about (documentation + default focus target). Paths are relative to the scope. */
  fields: string[];
  /** Type-specific parameters, see evaluators.ts */
  condition: Record<string, unknown>;
  severity: Severity;
  /** May contain {placeholders} filled by the evaluator, plus {line} and {form} for line findings. */
  message: string;
  resolution: string;
  enabled: boolean;
}

export type Section = "header" | "lines" | "totals" | "certification";

export interface ValidationIssue {
  ruleId: string;
  severity: Severity;
  /** Absolute path, e.g. "header.period" or "lines.3.beginning.qty" */
  fieldPath: string;
  /** 1-based line number for line-level issues */
  lineNo: number | null;
  section: Section;
  message: string;
  resolution: string;
  /** Rule-based findings are deterministic. "ai" is reserved for the optional AI-assisted review. */
  source: "rule" | "ai";
}

export interface ValidationResult {
  status: Exclude<ValidationStatus, "PENDING">;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
}

/** Data from outside the report that cross-record rules need. Empty on the client. */
export interface ValidationEnv {
  /** YYYY-MM-DD */
  today: string;
  formCatalog: string[];
  knownEntities: string[];
  /** Other non-void reports with the same entity + period (self excluded). */
  otherReports: { id: string; refNo: string }[];
  /** Report for the month before this one, same entity */
  previousReport: { refNo: string; report: RaafReport } | null;
  /** True when the entity has any report from an earlier month */
  hasEarlierReports: boolean;
}
