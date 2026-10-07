import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Alert, errorText } from "../components/ui";

export function LoginPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login card" onSubmit={submit}>
        <div className="brand-mark big" aria-hidden="true">R</div>
        <h1>RAAF Online</h1>
        <p className="muted">Report of Accountability for Accountable Forms<br />Encoding and Validation System</p>
        {error && <Alert>{error}</Alert>}
        <label htmlFor="u">Username</label>
        <input id="u" autoComplete="username" autoFocus required value={username} onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor="p">Password</label>
        <input id="p" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn primary block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="fineprint">Authorized personnel only. Activity on this system is logged.</p>
      </form>
    </div>
  );
}
