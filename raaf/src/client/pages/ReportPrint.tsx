import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { RecordDetail } from "../../shared/api";
import { GROUPS } from "../../shared/types";
import { periodLabel } from "../../shared/validation/helpers";
import { api } from "../api";
import { Alert, Loading, errorText } from "../components/ui";

const label = (r: RecordDetail): string =>
  r.readyForReporting ? "VALIDATED — READY FOR REPORTING"
    : r.workflowStatus === "VOID" ? "VOID — NOT FOR REPORTING"
    : r.workflowStatus === "FOR_REVIEW" ? "FOR REVIEW — NOT YET APPROVED"
    : "DRAFT / UNVALIDATED — NOT FOR REPORTING";

export function ReportPrintPage() {
  const { id = "" } = useParams();
  const [r, setR] = useState<RecordDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.record(id).then(setR).catch((e) => setError(errorText(e))); }, [id]);
  if (error) return <Alert>{error}</Alert>;
  if (!r) return <Loading />;
  const { header: h, totals: t, lines } = r.report;
  const ready = r.readyForReporting;

  return (
    <div className="report-page">
      <div className="no-print actionbar">
        <Link className="btn" to={`/records/${r.id}`}>← Back to record</Link>
        <button className="btn primary" onClick={() => window.print()}>Print / Save as PDF</button>
        <a className="btn" href={`/api/records/${r.id}/export.csv`}>CSV</a>
        <a className="btn" href={`/api/records/${r.id}/export.xlsx`}>Excel</a>
      </div>

      <article className={`report ${ready ? "" : "unvalidated"}`}>
        <div className={`stamp ${ready ? "ok" : "bad"}`}>{label(r)}</div>
        <header>
          <p>Professional Regulation Commission</p>
          <h1>REPORT OF ACCOUNTABILITY FOR ACCOUNTABLE FORMS (Board Certificates)</h1>
          <p>For the month of <b>{periodLabel(h.period)}</b></p>
        </header>
        <div className="report-meta">
          <span>Entity Name: <b>{h.entityName}</b></span>
          <span>Fund Cluster: <b>{h.fundCluster || "______________"}</b></span>
          <span>Reference: <b>{r.refNo}</b></span>
        </div>
        <table className="report-table">
          <thead>
            <tr><th rowSpan={2}>Name of Form</th><th rowSpan={2}>Number</th>{GROUPS.map((g) => <th key={g} colSpan={3}>{{ beginning: "Beginning Balance", receipt: "Receipt", issue: "Issue", ending: "Ending Balance" }[g]}</th>)}</tr>
            <tr>{GROUPS.flatMap((g) => ["Quantity", "From", "To"].map((k) => <th key={g + k}>{k === "Quantity" ? "Qty" : k}</th>))}</tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{l.formName}</td><td>{l.formNumber}</td>
                {GROUPS.flatMap((g) => (["qty", "from", "to"] as const).map((k) => <td key={g + k} className="num">{l[g][k] || (l[g][k] === 0 && k === "qty" ? 0 : "")}</td>))}
              </tr>
            ))}
            <tr className="total"><td>TOTAL ({t.lineCount} lines)</td><td />
              <td className="num">{t.beginningQty}</td><td /><td /><td className="num">{t.receiptQty}</td><td /><td /><td className="num">{t.issueQty}</td><td /><td /><td className="num">{t.endingQty}</td><td /><td />
            </tr>
          </tbody>
        </table>
        <p className="center"><b>***Nothing Follows***</b></p>
        <p className="cert">I hereby certify that the foregoing is a true statement of all accountable forms received, issued and transferred by me during the period above-stated and that the beginning and ending balances are correct.</p>
        <div className="signatures">
          {([["Prepared by:", h.preparedByName, h.preparedByTitle], ["Checked by:", h.checkedByName, h.checkedByTitle], ["Attested:", h.attestedByName, h.attestedByTitle], ["Noted by:", h.notedByName, h.notedByTitle]] as const).map(([role, name, title]) => (
            <div key={role}><span>{role}</span><b>{name || " "}</b><small>{title}</small></div>
          ))}
        </div>
        <footer>Certification date: {h.certificationDate || "—"} · {label(r)} · {ready ? `Approved by ${r.reviewedByName}` : "Not approved"}</footer>
      </article>
    </div>
  );
}
