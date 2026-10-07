import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DashboardData } from "../../shared/api";
import { periodLabel } from "../../shared/validation/helpers";
import { api } from "../api";
import { Alert, Loading, ValidationBadge, WorkflowBadge, errorText, formatDateTime } from "../components/ui";
import type { ValidationStatus, WorkflowStatus } from "../../shared/types";

export function DashboardPage() {
  const [d, setD] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.dashboard().then(setD).catch((e) => setError(errorText(e))); }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!d) return <Loading />;

  const tiles = [
    { to: "/records", label: "Total records", value: d.total, cls: "" },
    { to: "/records?validation=VALID", label: "✅ Valid", value: d.valid, cls: "valid" },
    { to: "/records?validation=WARNING", label: "⚠️ With warnings", value: d.warning, cls: "warning" },
    { to: "/records?validation=ERROR", label: "❌ With errors", value: d.error, cls: "error" },
    { to: "/records?workflow=FOR_REVIEW", label: "🔵 For review", value: d.forReview, cls: "review" },
    { to: "/records?validation=PENDING", label: "⏳ Pending validation", value: d.pending, cls: "pending" },
    { to: "/records?validation=ERROR", label: "Duplicates detected", value: d.duplicates, cls: d.duplicates ? "error" : "" },
    { to: "/records?workflow=APPROVED", label: "Approved for reporting", value: d.approved, cls: "valid" },
  ];
  const seg = [
    { n: d.valid, cls: "valid", label: "Valid" },
    { n: d.warning, cls: "warning", label: "Warning" },
    { n: d.error, cls: "error", label: "Error" },
    { n: d.pending, cls: "pending", label: "Not validated" },
  ];

  return (
    <div>
      <h1>Dashboard</h1>
      <div className="tiles">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className={`tile ${t.cls}`}>
            <span className="tile-value">{t.value}</span>
            <span className="tile-label">{t.label}</span>
          </Link>
        ))}
        <div className={`tile ${d.successRate === null ? "" : d.successRate >= 80 ? "valid" : d.successRate >= 50 ? "warning" : "error"}`}>
          <span className="tile-value">{d.successRate === null ? "—" : `${d.successRate}%`}</span>
          <span className="tile-label">Validation success rate</span>
          <span className="tile-note">valid ÷ validated records</span>
        </div>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Validation results</h2>
          {d.total === 0 ? <p className="muted">No records yet.</p> : (
            <>
              <div className="stackbar" role="img" aria-label={seg.map((s) => `${s.label}: ${s.n}`).join(", ")}>
                {seg.filter((s) => s.n > 0).map((s) => <span key={s.label} className={s.cls} style={{ flexGrow: s.n }} title={`${s.label}: ${s.n}`}>{s.n}</span>)}
              </div>
              <ul className="legend">{seg.map((s) => <li key={s.label}><i className={s.cls} /> {s.label} <b>{s.n}</b></li>)}</ul>
            </>
          )}
          <h2>Recently updated</h2>
          <table className="table compact">
            <tbody>
              {d.recent.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/records/${r.id}`}>{r.refNo}</Link></td>
                  <td>{r.entityName}<br /><small className="muted">{periodLabel(r.period)}</small></td>
                  <td><ValidationBadge status={r.validationStatus as ValidationStatus} /> <WorkflowBadge status={r.workflowStatus as WorkflowStatus} /></td>
                  <td className="muted nowrap">{formatDateTime(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>Most common validation issues</h2>
          {d.topIssues.length === 0 ? <p className="muted">No issues found in validated records.</p> : (
            <table className="table compact">
              <thead><tr><th>Rule</th><th>Example</th><th className="num">Records</th><th className="num">Total</th></tr></thead>
              <tbody>
                {d.topIssues.map((i) => (
                  <tr key={`${i.ruleId}${i.severity}`}>
                    <td className="nowrap"><span aria-hidden="true">{i.severity === "ERROR" ? "❌" : "⚠️"}</span> <code>{i.ruleId}</code></td>
                    <td>{i.sample}</td>
                    <td className="num">{i.records}</td>
                    <td className="num">{i.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
