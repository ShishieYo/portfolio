import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { Loading } from "./components/ui";
import { AuditLogPage } from "./pages/AuditLog";
import { DashboardPage } from "./pages/Dashboard";
import { LoginPage } from "./pages/Login";
import { RecordEditorPage } from "./pages/RecordEditor";
import { RecordViewPage } from "./pages/RecordView";
import { RecordsPage } from "./pages/Records";
import { ReportPrintPage } from "./pages/ReportPrint";
import { RulesPage } from "./pages/Rules";
import { SettingsPage } from "./pages/Settings";
import { UsersPage } from "./pages/Users";

function Shell() {
  const { user, signOut, can } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">R</span>
            <span><strong>RAAF Online</strong><small>Report of Accountability for Accountable Forms</small></span>
          </Link>
          <div className="who">
            <span>{user.displayName} <em>({user.role})</em></span>
            <button className="btn small ghost" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/records">Records</NavLink>
          {can("record:create") && <NavLink to="/records/new">New RAAF</NavLink>}
          {can("rules:manage") && <NavLink to="/admin/rules">Validation rules</NavLink>}
          {can("users:manage") && <NavLink to="/admin/users">Users</NavLink>}
          {can("audit:read") && <NavLink to="/admin/audit">Audit log</NavLink>}
          {can("settings:manage") && <NavLink to="/admin/settings">Settings</NavLink>}
        </nav>
      </header>
      <main id="main" className="page"><Outlet /></main>
    </>
  );
}

export function App() {
  const { loading } = useAuth();
  if (loading) return <div className="page"><Loading /></div>;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Shell />}>
        <Route index element={<DashboardPage />} />
        <Route path="records" element={<RecordsPage />} />
        <Route path="records/new" element={<RecordEditorPage />} />
        <Route path="records/:id" element={<RecordViewPage />} />
        <Route path="records/:id/edit" element={<RecordEditorPage />} />
        <Route path="records/:id/report" element={<ReportPrintPage />} />
        <Route path="admin/rules" element={<RulesPage />} />
        <Route path="admin/users" element={<UsersPage />} />
        <Route path="admin/audit" element={<AuditLogPage />} />
        <Route path="admin/settings" element={<SettingsPage />} />
        <Route path="*" element={<div><h1>Page not found</h1><Link to="/">Back to the dashboard</Link></div>} />
      </Route>
    </Routes>
  );
}
