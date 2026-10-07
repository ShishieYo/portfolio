import type { ReactNode } from "react";
import type { Section, ValidationIssue } from "../../shared/types";

const SECTION_TITLE: Record<Section, string> = { header: "Report details", lines: "Accountable forms", totals: "Control totals", certification: "Certification" };
const ORDER: Section[] = ["header", "lines", "totals", "certification"];

export interface PanelIssue extends ValidationIssue {
  crossRecord: boolean;
}

/** Issues grouped by form section; clicking one jumps to the field. */
export function IssuesPanel({ issues, onGo, header, footer }: { issues: PanelIssue[]; onGo: (path: string) => void; header?: ReactNode; footer?: ReactNode }) {
  const errors = issues.filter((i) => i.severity === "ERROR").length;
  const warnings = issues.length - errors;
  return (
    <aside className="issues card" aria-label="Validation issues">
      <h2>Validation issues</h2>
      {header}
      <p className="issue-counts" role="status">
        {issues.length === 0 ? <span className="valid-text">✅ No issues found</span> : (
          <><span className="error-text">❌ {errors} error{errors === 1 ? "" : "s"}</span> · <span className="warning-text">⚠️ {warnings} warning{warnings === 1 ? "" : "s"}</span></>
        )}
      </p>
      {ORDER.map((s) => {
        const list = issues.filter((i) => i.section === s);
        if (!list.length) return null;
        return (
          <section key={s}>
            <h3>{SECTION_TITLE[s]} <span className="count">{list.length}</span></h3>
            <ul>
              {list.map((i, n) => (
                <li key={`${i.ruleId}${i.fieldPath}${n}`}>
                  <button type="button" className={`issue ${i.severity === "ERROR" ? "error" : "warning"}`} onClick={() => onGo(i.fieldPath)}>
                    <span className="issue-msg"><span aria-hidden="true">{i.severity === "ERROR" ? "❌" : "⚠️"}</span> {i.message}</span>
                    <span className="issue-fix">{i.resolution}</span>
                    <span className="issue-meta"><code>{i.ruleId}</code>{i.crossRecord && " · checks other records"} · Go to field →</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {footer}
    </aside>
  );
}
