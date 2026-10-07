import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ValidationStatus, WorkflowStatus } from "../../shared/types";

export const VALIDATION_UI: Record<ValidationStatus, { icon: string; label: string; cls: string }> = {
  VALID: { icon: "✅", label: "Valid", cls: "valid" },
  WARNING: { icon: "⚠️", label: "Warning", cls: "warning" },
  ERROR: { icon: "❌", label: "Error", cls: "error" },
  PENDING: { icon: "⏳", label: "Not validated", cls: "pending" },
};

export const WORKFLOW_UI: Record<WorkflowStatus, { icon: string; label: string; cls: string }> = {
  DRAFT: { icon: "✏️", label: "Draft", cls: "pending" },
  FOR_REVIEW: { icon: "🔵", label: "For review", cls: "review" },
  APPROVED: { icon: "✔️", label: "Approved", cls: "valid" },
  VOID: { icon: "🚫", label: "Void", cls: "void" },
};

export const ValidationBadge = ({ status, stale }: { status: ValidationStatus; stale?: boolean }) => {
  const s = VALIDATION_UI[status];
  return <span className={`badge ${s.cls}`}><span aria-hidden="true">{s.icon}</span> {s.label}{stale ? " (edited)" : ""}</span>;
};

export const WorkflowBadge = ({ status }: { status: WorkflowStatus }) => {
  const s = WORKFLOW_UI[status];
  return <span className={`badge ${s.cls}`}><span aria-hidden="true">{s.icon}</span> {s.label}</span>;
};

const dateTime = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });
export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));

export function Alert({ kind = "error", children }: { kind?: "error" | "warning" | "info" | "success"; children: ReactNode }) {
  return <div className={`alert ${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <p className="muted" role="status">{what}…</p>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  return (
    <div className="pager">
      <span>{from}–{Math.min(page * pageSize, total)} of {total}</span>
      <button className="btn small" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Previous</button>
      <span>Page {page} of {pages}</span>
      <button className="btn small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</button>
    </div>
  );
}

/** Modal that asks for a note. The note is mandatory when `minLength` > 0. */
export function NoteDialog({ title, label, confirm, minLength, onCancel, onConfirm, busy }: {
  title: string; label: string; confirm: string; minLength: number; busy: boolean;
  onCancel: () => void; onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const valid = note.trim().length >= minLength;
  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title">{title}</h2>
        <label htmlFor="dlg-note">{label}{minLength > 0 ? " (required)" : " (optional)"}</label>
        <textarea id="dlg-note" ref={ref} rows={4} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={() => onConfirm(note)} disabled={!valid || busy}>{busy ? "Working…" : confirm}</button>
        </div>
      </div>
    </div>
  );
}

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong");
