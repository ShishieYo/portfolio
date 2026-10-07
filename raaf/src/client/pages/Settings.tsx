import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { Alert, Loading, errorText } from "../components/ui";

const FIELDS: [string, string][] = [
  ["defaultEntityName", "Default entity name"], ["defaultFundCluster", "Default fund cluster"],
  ["defaultPreparedByName", "Prepared by (name)"], ["defaultPreparedByTitle", "Prepared by (designation)"],
  ["defaultCheckedByName", "Checked by (name)"], ["defaultCheckedByTitle", "Checked by (designation)"],
  ["defaultAttestedByName", "Attested by (name)"], ["defaultAttestedByTitle", "Attested by (designation)"],
  ["defaultNotedByName", "Noted by (name)"], ["defaultNotedByTitle", "Noted by (designation)"],
];

export function SettingsPage() {
  const [s, setS] = useState<Record<string, string> | null>(null);
  const [forms, setForms] = useState<string[]>([]);
  const [newForm, setNewForm] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { Promise.all([api.settings(), api.forms()]).then(([a, b]) => { setS(a); setForms(b); }).catch((e) => setError(errorText(e))); }, []);
  if (!s) return error ? <Alert>{error}</Alert> : <Loading />;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(""); setMsg("");
    try { setS(await api.saveSettings(s)); setMsg("Settings saved."); } catch (err) { setError(errorText(err)); }
  };
  const addForm = async (e: FormEvent) => {
    e.preventDefault();
    setError(""); setMsg("");
    try { const { name } = await api.addForm(newForm); setForms((f) => [...f, name].sort()); setNewForm(""); setMsg(`${name} added to the catalog.`); } catch (err) { setError(errorText(err)); }
  };

  return (
    <div>
      <div className="page-head"><h1>Settings</h1></div>
      {error && <Alert>{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}
      <form className="card" onSubmit={save}>
        <h2>Defaults for new reports</h2>
        <div className="form-grid">
          {FIELDS.map(([k, label]) => <div className="field" key={k}><label htmlFor={k}>{label}</label><input id={k} maxLength={200} value={s[k] ?? ""} onChange={(e) => setS({ ...s, [k]: e.target.value })} /></div>)}
        </div>
        <button className="btn primary">Save settings</button>
      </form>
      <form className="card" onSubmit={addForm}>
        <h2>Accountable forms catalog ({forms.length})</h2>
        <p className="muted">Form names on a report are checked against this catalog so the same form is always spelled the same way.</p>
        <div className="field"><label htmlFor="nf">Add a form</label><input id="nf" value={newForm} onChange={(e) => setNewForm(e.target.value)} required minLength={2} maxLength={100} /></div>
        <button className="btn">Add to catalog</button>
        <details><summary>Show catalog</summary><ul className="columns">{forms.map((f) => <li key={f}>{f}</li>)}</ul></details>
      </form>
    </div>
  );
}
