import { useEffect, useState } from "react";
import type { AuditRow, Page } from "../../shared/api";
import { api } from "../api";
import { Alert, Loading, Pager, errorText, formatDateTime } from "../components/ui";

export function AuditLogPage() {
  const [filters, setFilters] = useState({ user: "", action: "", record: "", from: "", to: "" });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<AuditRow> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.audit({ ...applied, page }).then(setData).catch((e) => setError(errorText(e))); }, [applied, page]);

  return (
    <div>
      <div className="page-head"><h1>Audit log</h1></div>
      <p className="muted">Append-only: entries cannot be changed or deleted, even by administrators.</p>
      <form className="filters card" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(filters); }}>
        <div><label htmlFor="au">User</label><input id="au" value={filters.user} onChange={(e) => setFilters({ ...filters, user: e.target.value })} placeholder="username" /></div>
        <div><label htmlFor="aa">Action</label><input id="aa" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} placeholder="e.g. record.update" /></div>
        <div><label htmlFor="ar">Record</label><input id="ar" value={filters.record} onChange={(e) => setFilters({ ...filters, record: e.target.value })} placeholder="RAAF-000001" /></div>
        <div><label htmlFor="af">From</label><input id="af" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
        <div><label htmlFor="at">To</label><input id="at" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
        <div className="filter-actions"><button className="btn primary">Filter</button></div>
      </form>
      {error && <Alert>{error}</Alert>}
      {!data ? <Loading /> : (
        <div className="card flush">
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Date / time</th><th>User</th><th>Action</th><th>Record</th><th>Field</th><th>Old value</th><th>New value</th></tr></thead>
              <tbody>
                {data.items.map((x) => (
                  <tr key={x.id}>
                    <td className="nowrap">{formatDateTime(x.at)}</td><td>{x.username}</td><td><code>{x.action}</code></td>
                    <td className="nowrap">{x.record_ref ?? x.entity_id ?? ""}</td><td>{x.field}</td>
                    <td className="wrap-cell">{x.old_value}</td><td className="wrap-cell">{x.new_value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
