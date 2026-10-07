import { useEffect, useState, type FormEvent } from "react";
import type { UserRow } from "../../shared/api";
import { ROLES } from "../../shared/permissions";
import { api } from "../api";
import { Alert, Loading, errorText, formatDateTime } from "../components/ui";

export function UsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ username: "", displayName: "", password: "", role: "encoder" });
  const reload = () => api.users().then(setUsers).catch((e) => setError(errorText(e)));
  useEffect(() => { void reload(); }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try { await api.createUser(form); setForm({ username: "", displayName: "", password: "", role: "encoder" }); await reload(); } catch (err) { setError(errorText(err)); }
  };
  const patch = async (id: string, p: Parameters<typeof api.updateUser>[1]) => {
    setError("");
    try { await api.updateUser(id, p); await reload(); } catch (err) { setError(errorText(err)); }
  };
  const resetPassword = (u: UserRow) => {
    const password = window.prompt(`New password for ${u.username} (at least 10 characters):`);
    if (password) void patch(u.id, { password });
  };

  if (!users) return error ? <Alert>{error}</Alert> : <Loading />;
  return (
    <div>
      <div className="page-head"><h1>Users</h1></div>
      {error && <Alert>{error}</Alert>}
      <div className="card flush">
        <table className="table">
          <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Active</th><th>Created</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? "" : "disabled-row"}>
                <td><b>{u.username}</b></td><td>{u.displayName}</td>
                <td><select aria-label={`Role of ${u.username}`} value={u.role} onChange={(e) => void patch(u.id, { role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></td>
                <td>{u.active ? "Yes" : "No"}</td><td className="muted nowrap">{formatDateTime(u.createdAt)}</td>
                <td className="nowrap">
                  <button className="btn small" onClick={() => void patch(u.id, { active: !u.active })}>{u.active ? "Deactivate" : "Activate"}</button>{" "}
                  <button className="btn small" onClick={() => resetPassword(u)}>Reset password</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="card" onSubmit={create}>
        <h2>Add a user</h2>
        <div className="form-grid">
          <div className="field"><label htmlFor="nu">Username</label><input id="nu" required pattern="[a-zA-Z0-9._-]{3,40}" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
          <div className="field"><label htmlFor="nn">Full name</label><input id="nn" required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></div>
          <div className="field"><label htmlFor="np">Initial password (10+ characters)</label><input id="np" type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div className="field"><label htmlFor="nr">Role</label><select id="nr" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
        </div>
        <button className="btn primary">Create user</button>
      </form>
    </div>
  );
}
