import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { RecordDetail, RunInfo } from "../../shared/api";
import type { AuditRow } from "../../shared/api";
import type { Section, ValidationIssue } from "../../shared/types";
import { GROUPS } from "../../shared/types";
import { periodLabel } from "../../shared/validation/helpers";
import { api } from "../api";
import { Alert, Loading, NoteDialog, ValidationBadge, WorkflowBadge, errorText, formatDateTime } from "../components/ui";

type Tab = "results" | "lines" | "history" | "audit";
type Dialog = "approve" | "return" | "void" | null;

const SECTION_TITLE: Record<Section, string> = { header: "Report details", lines: "Accountable forms", totals: "Control totals", certification: "Certification" };

function Banner({ r }: { r: RecordDetail }) {
  if (r.readyForReporting) {
    return <Alert kind="success"><b>✅ Validated — ready for reporting.</b> Approved by {r.reviewedByName}{r.reviewedAt && ` on ${formatDateTime(r.reviewedAt)}`}.{r.validationStatus === "WARNING" && ` Reviewed with warnings: “${r.reviewNote}”`}</Alert>;
  }
  if (r.workflowStatus === "VOID") return <Alert kind="warning"><b>🚫 Void — not for reporting.</b> Reason: {r.voidReason}</Alert>;
  if (r.workflowStatus === "FOR_REVIEW") return <Alert kind="info"><b>🔵 For review.</b> Passed validation and is waiting for a reviewer. It is not yet ready for reporting.</Alert>;
  if (r.validationStatus === "PENDING") return <Alert kind="warning"><b>Draft / unvalidated.</b> Not ready for reporting. Run validation to check this record.</Alert>;
  if (r.validationStatus === "ERROR") return <Alert kind="error"><b>Draft with validation errors.</b> Not ready for reporting. Fix the errors below and revalidate.</Alert>;
  return <Alert kind="warning"><b>Draft.</b> Validation {r.validationStatus === "VALID" ? "passed" : "passed with warnings"}; submit it for review to make it ready for reporting.</Alert>;
}

function IssueList({ issues, link }: { issues: ValidationIssue[]; link: (path: string) => string | null }) {
  if (!issues.length) return <p className="valid-text">✅ No issues. All required fields are complete and every consistency check passed.</p>;
  return (
    <>
      {(["header", "lines", "totals", "certification"] as Section[]).map((s) => {
        const list = issues.filter((i) => i.section === s);
        if (!list.length) return null;
        return (
          <section key={s}>
            <h3>{SECTION_TITLE[s]} <span className="count">{list.length}</span></h3>
            <ul className="issue-list">
              {list.map((i, n) => {
                const to = link(i.fieldPath);
                const body = (
                  <>
                    <span className="issue-msg"><span aria-hidden="true">{i.severity === "ERROR" ? "❌" : "⚠️"}</span> {i.message}</span>
                    <span className="issue-fix">{i.resolution}</span>
                    <span className="issue-meta"><code>{i.ruleId}</code> · {i.severity === "ERROR" ? "Error" : "Warning"}{to && " · Go to field →"}</span>
                  </>
                );
                return <li key={n} className={`issue ${i.severity === "ERROR" ? "error" : "warning"}`}>{to ? <Link to={to}>{body}</Link> : <div>{body}</div>}</li>;
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}

export function RecordViewPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [r, setR] = useState<RecordDetail | null>(null);
  const [tab, setTab] = useState<Tab>("results");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [runs, setRuns] = useState<RunInfo[] | null>(null);
  const [pastRun, setPastRun] = useState<{ run: RunInfo; issues: ValidationIssue[] } | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);

  const load = useCallback(() => api.record(id).then((d) => { setR(d); setError(""); }).catch((e) => setError(errorText(e))), [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (tab === "history") api.runs(id).then(setRuns).catch((e) => setError(errorText(e)));
    if (tab === "audit") api.recordAudit(id).then(setAudit).catch((e) => setError(errorText(e)));
  }, [tab, id, r?.version, r?.validation?.run.id, r?.workflowStatus]);

  if (error && !r) return <Alert>{error}</Alert>;
  if (!r) return <Loading />;

  const act = async (fn: () => Promise<RecordDetail>, done: string) => {
    setBusy(true);
    setError("");
    try {
      setR(await fn());
      setNotice(done);
      setDialog(null);
    } catch (e) {
      setError(errorText(e));
      setDialog(null);
      void load();
    } finally {
      setBusy(false);
    }
  };

  const a = r.actions;
  const v = r.validation;
  const link = (path: string) => (a.edit ? `/records/${r.id}/edit?focus=${encodeURIComponent(path)}` : null);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{r.refNo}</h1>
          <p className="muted">{r.entityName} · For the month of {periodLabel(r.period)} · Version {r.version}</p>
        </div>
        <div className="head-badges"><ValidationBadge status={r.validationStatus} stale={!!v?.stale} /> <WorkflowBadge status={r.workflowStatus} /></div>
      </div>

      <Banner r={r} />
      {error && <Alert>{error}</Alert>}
      {notice && !error && <Alert kind="success">{notice}</Alert>}

      <div className="actionbar">
        {a.edit && <Link className="btn primary" to={`/records/${r.id}/edit`}>Edit</Link>}
        {a.validate && <button className="btn" disabled={busy} onClick={() => void act(() => api.validate(r.id), "Validation complete.")}>{r.validationStatus === "PENDING" ? "Run validation" : "Revalidate"}</button>}
        {a.submit && <button className="btn" disabled={busy} onClick={() => void act(() => api.submit(r.id), "Submitted for review.")}>Submit for review</button>}
        {a.approve && <button className="btn success" disabled={busy} onClick={() => setDialog("approve")}>Approve</button>}
        {a.return && <button className="btn" disabled={busy} onClick={() => setDialog("return")}>Return for correction</button>}
        <Link className="btn" to={`/records/${r.id}/report`}>Printable report</Link>
        <a className="btn" href={`/api/records/${r.id}/export.csv`}>CSV</a>
        <a className="btn" href={`/api/records/${r.id}/export.xlsx`}>Excel</a>
        {a.void && <button className="btn danger ghost" disabled={busy} onClick={() => setDialog("void")}>Void</button>}
      </div>

      <div className="meta card">
        <dl>
          <div><dt>Encoded by</dt><dd>{r.createdByName}<small>{formatDateTime(r.createdAt)}</small></dd></div>
          <div><dt>Last modified by</dt><dd>{r.updatedByName}<small>{formatDateTime(r.updatedAt)}</small></dd></div>
          <div><dt>Last validated</dt><dd>{v ? <>{v.run.runByName}<small>{formatDateTime(v.run.runAt)} (v{v.run.recordVersion})</small></> : "Never"}</dd></div>
          <div><dt>Reviewed by</dt><dd>{r.reviewedByName ?? "—"}<small>{r.reviewedAt ? formatDateTime(r.reviewedAt) : ""}</small></dd></div>
        </dl>
      </div>

      <div className="tabs" role="tablist">
        {([["results", "Validation results"], ["lines", `Forms (${r.report.lines.length})`], ["history", "Validation history"], ["audit", "Audit trail"]] as [Tab, string][]).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>

      <div className="card" role="tabpanel">
        {tab === "results" && (
          !v ? <p className="muted">This record has not been validated yet.</p> : (
            <>
              {v.stale && <Alert kind="warning">The record was edited after this validation ran, so these results may be out of date. Revalidate.</Alert>}
              <p><b>{v.run.status === "VALID" ? "✅ Valid" : v.run.status === "WARNING" ? "⚠️ Warning" : "❌ Error"}</b> — {v.run.errorCount} error(s), {v.run.warningCount} warning(s). Rule-based validation.</p>
              <IssueList issues={v.issues} link={link} />
            </>
          )
        )}

        {tab === "lines" && (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr><th rowSpan={2}>#</th><th rowSpan={2}>Name of form</th>{GROUPS.map((g) => <th key={g} colSpan={3} className="grp-start capitalize">{g}</th>)}<th rowSpan={2}>Remarks</th></tr>
                <tr>{GROUPS.flatMap((g) => ["Qty", "From", "To"].map((k) => <th key={g + k} className={k === "Qty" ? "grp-start" : ""}>{k}</th>))}</tr>
              </thead>
              <tbody>
                {r.report.lines.map((l, i) => {
                  const bad = v?.issues.some((x) => x.lineNo === i + 1 && x.severity === "ERROR");
                  const warn = v?.issues.some((x) => x.lineNo === i + 1);
                  return (
                    <tr key={i} className={bad ? "row-error" : warn ? "row-warning" : ""}>
                      <td>{i + 1}</td><td>{l.formName}</td>
                      {GROUPS.flatMap((g) => (["qty", "from", "to"] as const).map((k) => <td key={g + k} className={`num ${k === "qty" ? "grp-start" : ""}`}>{l[g][k] ?? ""}</td>))}
                      <td>{l.remarks}</td>
                    </tr>
                  );
                })}
                <tr className="total-row"><td /><td>TOTAL (reported)</td><td className="num grp-start">{r.report.totals.beginningQty}</td><td /><td /><td className="num grp-start">{r.report.totals.receiptQty}</td><td /><td /><td className="num grp-start">{r.report.totals.issueQty}</td><td /><td /><td className="num grp-start">{r.report.totals.endingQty}</td><td /><td /><td /></tr>
              </tbody>
            </table>
          </div>
        )}

        {tab === "history" && (
          !runs ? <Loading /> : runs.length === 0 ? <p className="muted">No validation has been run yet.</p> : (
            <>
              <table className="table compact">
                <thead><tr><th>When</th><th>Run by</th><th>Record version</th><th>Result</th><th className="num">Errors</th><th className="num">Warnings</th><th /></tr></thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td className="nowrap">{formatDateTime(run.runAt)}</td><td>{run.runByName}</td><td>v{run.recordVersion}</td>
                      <td><ValidationBadge status={run.status} /></td><td className="num">{run.errorCount}</td><td className="num">{run.warningCount}</td>
                      <td><button className="btn small" onClick={() => api.run(r.id, run.id).then(setPastRun).catch((e) => setError(errorText(e)))}>View issues</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pastRun && (
                <div className="past-run">
                  <h3>Run of {formatDateTime(pastRun.run.runAt)} (version {pastRun.run.recordVersion})</h3>
                  <IssueList issues={pastRun.issues} link={() => null} />
                </div>
              )}
            </>
          )
        )}

        {tab === "audit" && (
          !audit ? <Loading /> : (
            <div className="table-wrap">
              <table className="table compact">
                <thead><tr><th>Date / time</th><th>User</th><th>Action</th><th>Field</th><th>Old value</th><th>New value</th></tr></thead>
                <tbody>
                  {audit.map((x) => (
                    <tr key={x.id}>
                      <td className="nowrap">{formatDateTime(x.at)}</td><td>{x.username}</td><td><code>{x.action}</code></td>
                      <td>{x.field}</td><td className="wrap-cell">{x.old_value}</td><td className="wrap-cell">{x.new_value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {dialog === "approve" && (
        <NoteDialog title="Approve this report" busy={busy} minLength={r.validationStatus === "WARNING" ? 5 : 0} confirm="Approve"
          label={r.validationStatus === "WARNING" ? "This record has warnings. Note why they are acceptable" : "Review note"}
          onCancel={() => setDialog(null)} onConfirm={(note) => void act(() => api.approve(r.id, note), "Approved. The report is ready for reporting.")} />
      )}
      {dialog === "return" && (
        <NoteDialog title="Return for correction" busy={busy} minLength={5} confirm="Return to encoder" label="What needs to be corrected"
          onCancel={() => setDialog(null)} onConfirm={(note) => void act(() => api.returnRecord(r.id, note), "Returned to draft.")} />
      )}
      {dialog === "void" && (
        <NoteDialog title="Void this record" busy={busy} minLength={5} confirm="Void record" label="Reason for voiding"
          onCancel={() => setDialog(null)} onConfirm={(note) => void act(() => api.voidRecord(r.id, note), "Record voided.").then(() => navigate("/records"))} />
      )}
    </div>
  );
}
