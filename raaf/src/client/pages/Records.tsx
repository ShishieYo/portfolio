import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Page, RecordSummary } from "../../shared/api";
import { periodLabel } from "../../shared/validation/helpers";
import { api } from "../api";
import { useAuth } from "../auth";
import { Alert, Loading, Pager, ValidationBadge, WorkflowBadge, errorText, formatDateTime } from "../components/ui";

const SORT_COLUMNS: { key: string; label: string }[] = [
  { key: "ref", label: "Reference" },
  { key: "entity", label: "Entity" },
  { key: "period", label: "Month" },
  { key: "validation", label: "Validation" },
  { key: "workflow", label: "Status" },
  { key: "user", label: "Encoded by" },
  { key: "updated", label: "Last updated" },
];

export function RecordsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Page<RecordSummary> | null>(null);
  const [users, setUsers] = useState<{ id: string; displayName: string }[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState(params.get("q") ?? "");

  const get = (k: string) => params.get(k) ?? "";
  const sort = get("sort") || "updated";
  const dir = get("dir") || "desc";
  const page = Number(get("page")) || 1;
  const query = params.toString();

  useEffect(() => {
    api.records({ q: get("q"), from: get("from"), to: get("to"), workflow: get("workflow"), validation: get("validation"), user: get("user"), sort, dir, page, pageSize: 20 })
      .then((d) => { setData(d); setError(""); })
      .catch((e) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (can("record:read:all")) api.userOptions().then(setUsers).catch((e) => setError(errorText(e)));
  }, [can]);

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!("page" in patch)) next.delete("page");
    setParams(next);
  };
  const sortBy = (key: string) => set({ sort: key, dir: sort === key && dir === "desc" ? "asc" : "desc" });

  return (
    <div>
      <div className="page-head">
        <h1>Records</h1>
        {can("record:create") && <Link className="btn primary" to="/records/new">+ New RAAF</Link>}
      </div>

      <form className="filters card" onSubmit={(e) => { e.preventDefault(); set({ q: search.trim() }); }} role="search">
        <div>
          <label htmlFor="q">Search</label>
          <input id="q" type="search" placeholder="Ref, entity, month, form" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label htmlFor="from">Month from</label>
          <input id="from" type="month" value={get("from")} onChange={(e) => set({ from: e.target.value })} />
        </div>
        <div>
          <label htmlFor="to">Month to</label>
          <input id="to" type="month" value={get("to")} onChange={(e) => set({ to: e.target.value })} />
        </div>
        <div>
          <label htmlFor="validation">Validation result</label>
          <select id="validation" value={get("validation")} onChange={(e) => set({ validation: e.target.value })}>
            <option value="">All</option><option value="VALID">✅ Valid</option><option value="WARNING">⚠️ Warning</option>
            <option value="ERROR">❌ Error</option><option value="PENDING">⏳ Not validated</option>
          </select>
        </div>
        <div>
          <label htmlFor="workflow">Status</label>
          <select id="workflow" value={get("workflow")} onChange={(e) => set({ workflow: e.target.value })}>
            <option value="">All</option><option value="DRAFT">Draft</option><option value="FOR_REVIEW">🔵 For review</option>
            <option value="APPROVED">Approved</option><option value="VOID">Void</option>
          </select>
        </div>
        {can("record:read:all") && (
          <div>
            <label htmlFor="user">Encoded by</label>
            <select id="user" value={get("user")} onChange={(e) => set({ user: e.target.value })}>
              <option value="">Anyone</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </div>
        )}
        <div className="filter-actions">
          <button className="btn primary">Search</button>
          <button type="button" className="btn" onClick={() => { setSearch(""); setParams(new URLSearchParams()); }}>Clear</button>
        </div>
      </form>

      {error && <Alert>{error}</Alert>}
      {!data ? <Loading /> : (
        <div className="card flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {SORT_COLUMNS.map((c) => (
                    <th key={c.key} aria-sort={sort === c.key ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                      <button className="th-btn" onClick={() => sortBy(c.key)}>{c.label}{sort === c.key ? (dir === "asc" ? " ▲" : " ▼") : ""}</button>
                    </th>
                  ))}
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && <tr><td colSpan={8} className="muted center">No records match these filters.</td></tr>}
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap"><Link to={`/records/${r.id}`}><b>{r.refNo}</b></Link></td>
                    <td>{r.entityName}</td>
                    <td className="nowrap">{periodLabel(r.period)}</td>
                    <td><ValidationBadge status={r.validationStatus} /></td>
                    <td><WorkflowBadge status={r.workflowStatus} /></td>
                    <td>{r.createdByName}</td>
                    <td className="nowrap muted">{formatDateTime(r.updatedAt)}</td>
                    <td className="nowrap">
                      {r.errorCount !== null ? <><span title="Errors">❌ {r.errorCount}</span> <span title="Warnings">⚠️ {r.warningCount}</span></> : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set({ page: String(p) })} />
        </div>
      )}
    </div>
  );
}
