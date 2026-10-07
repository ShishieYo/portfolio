import { Fragment, useEffect, useState } from "react";
import type { RuleDef } from "../../shared/types";
import { api } from "../api";
import { Alert, Loading, errorText } from "../components/ui";

function RuleEditor({ rule, onSaved }: { rule: RuleDef; onSaved: (r: RuleDef) => void }) {
  const [severity, setSeverity] = useState(rule.severity);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [message, setMessage] = useState(rule.message);
  const [resolution, setResolution] = useState(rule.resolution);
  const [condition, setCondition] = useState(JSON.stringify(rule.condition, null, 2));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setError("");
    setSaved(false);
    let parsed: unknown;
    try { parsed = JSON.parse(condition); } catch { return setError("Condition must be valid JSON."); }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return setError("Condition must be a JSON object.");
    try {
      onSaved(await api.updateRule(rule.id, { severity, enabled, message, resolution, condition: parsed as Record<string, unknown> }));
      setSaved(true);
    } catch (e) { setError(errorText(e)); }
  };

  return (
    <div className="rule-editor">
      <dl className="inline-dl">
        <div><dt>Type</dt><dd><code>{rule.type}</code></dd></div>
        <div><dt>Scope</dt><dd>{rule.scope}</dd></div>
        <div><dt>Fields</dt><dd>{rule.fields.map((f) => <code key={f}>{f}</code>)}</dd></div>
      </dl>
      {error && <Alert>{error}</Alert>}
      {saved && <Alert kind="success">Saved. The next validation run uses the new settings.</Alert>}
      <div className="form-grid">
        <div className="field"><label htmlFor={`sev-${rule.id}`}>Severity</label>
          <select id={`sev-${rule.id}`} value={severity} onChange={(e) => setSeverity(e.target.value as RuleDef["severity"])}><option value="ERROR">❌ Error (blocks submission)</option><option value="WARNING">⚠️ Warning (needs review)</option></select></div>
        <div className="field"><label className="inline"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Rule enabled</label></div>
      </div>
      <div className="field"><label htmlFor={`msg-${rule.id}`}>Message (placeholders like {"{line}"}, {"{form}"}, {"{expected}"} are filled in)</label>
        <textarea id={`msg-${rule.id}`} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
      <div className="field"><label htmlFor={`res-${rule.id}`}>Suggested resolution</label>
        <textarea id={`res-${rule.id}`} rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} /></div>
      <div className="field"><label htmlFor={`cond-${rule.id}`}>Condition (parameters for the “{rule.type}” rule type)</label>
        <textarea id={`cond-${rule.id}`} rows={4} className="mono" value={condition} onChange={(e) => setCondition(e.target.value)} spellCheck={false} /></div>
      <button className="btn primary" onClick={() => void save()}>Save rule</button>
    </div>
  );
}

export function RulesPage() {
  const [rules, setRules] = useState<RuleDef[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  useEffect(() => { api.rules().then(setRules).catch((e) => setError(errorText(e))); }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!rules) return <Loading />;
  const shown = rules.filter((r) => `${r.id} ${r.name} ${r.type}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <div className="page-head"><h1>Validation rules</h1></div>
      <p className="muted">Every check the system performs is a rule here. Changes apply to the next validation run; existing validation history is not rewritten. Changes are recorded in the audit log.</p>
      <input type="search" placeholder="Filter rules…" aria-label="Filter rules" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="card flush">
        <table className="table">
          <thead><tr><th>Rule ID</th><th>Name</th><th>Type</th><th>Severity</th><th>Enabled</th><th /></tr></thead>
          <tbody>
            {shown.map((r) => (
              <Fragment key={r.id}>
                <tr className={r.enabled ? "" : "disabled-row"}>
                  <td className="nowrap"><code>{r.id}</code></td><td>{r.name}</td><td><code>{r.type}</code></td>
                  <td>{r.severity === "ERROR" ? "❌ Error" : "⚠️ Warning"}</td><td>{r.enabled ? "Yes" : "No"}</td>
                  <td><button className="btn small" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "Close" : "Edit"}</button></td>
                </tr>
                {open === r.id && <tr><td colSpan={6}><RuleEditor rule={r} onSaved={(u) => setRules((all) => all!.map((x) => (x.id === u.id ? u : x)))} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
