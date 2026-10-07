import type {
  AuditRow, DashboardData, Page, RecordDetail, RecordSummary, RunInfo, SessionUser, UserRow,
} from "../shared/api";
import type { RaafReport, RuleDef, ValidationIssue } from "../shared/types";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "X-Requested-With": "raaf-web", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? res.statusText, (data as { details?: unknown } | null)?.details);
  return data as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};

export interface RecordQuery {
  q?: string; from?: string; to?: string; workflow?: string; validation?: string; user?: string;
  sort?: string; dir?: string; page?: number; pageSize?: number;
}

export const api = {
  login: (username: string, password: string) => call<SessionUser>("POST", "/auth/login", { username, password }),
  logout: () => call<{ ok: true }>("POST", "/auth/logout"),
  me: () => call<SessionUser>("GET", "/auth/me"),

  dashboard: () => call<DashboardData>("GET", "/dashboard"),
  records: (q: RecordQuery) => call<Page<RecordSummary>>("GET", `/records${qs({ ...q })}`),
  userOptions: () => call<{ id: string; displayName: string }[]>("GET", "/user-options"),
  record: (id: string) => call<RecordDetail>("GET", `/records/${id}`),
  createRecord: (idempotencyKey: string, report: RaafReport) => call<RecordDetail>("POST", "/records", { idempotencyKey, report }),
  saveRecord: (id: string, expectedVersion: number, report: RaafReport) => call<RecordDetail>("PUT", `/records/${id}`, { expectedVersion, report }),
  validate: (id: string) => call<RecordDetail>("POST", `/records/${id}/validate`),
  submit: (id: string) => call<RecordDetail>("POST", `/records/${id}/submit`),
  approve: (id: string, note: string) => call<RecordDetail>("POST", `/records/${id}/approve`, { note }),
  returnRecord: (id: string, note: string) => call<RecordDetail>("POST", `/records/${id}/return`, { note }),
  voidRecord: (id: string, note: string) => call<RecordDetail>("POST", `/records/${id}/void`, { note }),
  runs: (id: string) => call<RunInfo[]>("GET", `/records/${id}/validations`),
  run: (id: string, runId: number) => call<{ run: RunInfo; issues: ValidationIssue[] }>("GET", `/records/${id}/validations/${runId}`),
  recordAudit: (id: string) => call<AuditRow[]>("GET", `/records/${id}/audit`),

  rules: () => call<RuleDef[]>("GET", "/rules"),
  updateRule: (id: string, edit: Pick<RuleDef, "severity" | "enabled" | "message" | "resolution" | "condition">) => call<RuleDef>("PUT", `/rules/${id}`, edit),
  forms: () => call<string[]>("GET", "/forms"),
  addForm: (name: string) => call<{ name: string }>("POST", "/forms", { name }),
  settings: () => call<Record<string, string>>("GET", "/settings"),
  saveSettings: (s: Record<string, string>) => call<Record<string, string>>("PUT", "/settings", s),

  users: () => call<UserRow[]>("GET", "/users"),
  createUser: (u: { username: string; displayName: string; password: string; role: string }) => call<UserRow>("POST", "/users", u),
  updateUser: (id: string, patch: { displayName?: string; role?: string; active?: boolean; password?: string }) => call<UserRow>("PUT", `/users/${id}`, patch),
  audit: (q: Record<string, string | number | undefined>) => call<Page<AuditRow>>("GET", `/audit${qs(q)}`),
};
