import type { RaafReport, RuleDef, ValidationEnv, ValidationIssue, ValidationResult } from "../types";
import { EVALUATORS, type Finding } from "./evaluators";
import { fieldLabel } from "../fieldLabels";
import { isBlankLine, lineFieldLabel, sectionOf } from "./helpers";

const interpolate = (template: string, vars: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));

export const emptyEnv = (today: string): ValidationEnv => ({
  today,
  formCatalog: [],
  knownEntities: [],
  otherReports: [],
  previousReport: null,
  hasEarlierReports: false,
});

function toIssue(rule: RuleDef, report: RaafReport, f: Finding, lineIndex: number | undefined): ValidationIssue {
  const idx = f.lineIndex ?? lineIndex;
  const fieldPath = idx === undefined ? f.field : f.field === "lines" ? "lines" : `lines.${idx}.${f.field}`;
  const vars: Record<string, string | number> = { label: fieldLabel(fieldPath), ...f.vars };
  if (idx !== undefined) {
    vars.line = idx + 1;
    vars.field = lineFieldLabel(f.field);
    vars.form = report.lines[idx]?.formName.trim() || "(no form name)";
  }
  return {
    ruleId: rule.id,
    severity: rule.severity,
    fieldPath,
    lineNo: idx === undefined ? null : idx + 1,
    section: sectionOf(fieldPath),
    message: interpolate(rule.message, vars),
    resolution: interpolate(rule.resolution, vars),
    source: "rule",
  };
}

/**
 * Pure and deterministic: the same report, rules and env always give the same result.
 * The server runs this as the source of truth; the browser runs it for live feedback.
 */
export function validateReport(report: RaafReport, rules: RuleDef[], env: ValidationEnv): ValidationResult {
  const issues: ValidationIssue[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const evaluate = EVALUATORS[rule.type];
    if (!evaluate) throw new Error(`Rule ${rule.id} has unknown type "${rule.type}"`);

    if (rule.scope === "line") {
      report.lines.forEach((line, index) => {
        if (rule.type !== "blank_line" && isBlankLine(line)) return;
        for (const f of evaluate({ rule, target: line, report, env })) issues.push(toIssue(rule, report, f, index));
      });
    } else {
      for (const f of evaluate({ rule, target: report, report, env })) issues.push(toIssue(rule, report, f, undefined));
    }
  }

  const errorCount = issues.filter((i) => i.severity === "ERROR").length;
  const warningCount = issues.length - errorCount;
  return { status: errorCount ? "ERROR" : warningCount ? "WARNING" : "VALID", errorCount, warningCount, issues };
}
