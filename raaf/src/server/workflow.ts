import type { AuthUser } from "./auth";
import { logAudit } from "./audit";
import type { Db } from "./db";
import { nowIso, transaction } from "./db";
import { badRequest, conflict, forbidden, unprocessable } from "./errors";
import { actionsFor, getReadable } from "./records";
import { runValidation } from "./validation";

type WorkflowRow = ReturnType<typeof getReadable>;

function setWorkflow(db: Db, user: AuthUser, row: WorkflowRow, status: string, extra: { note?: string; reviewed?: boolean; voidReason?: string } = {}): void {
  const now = nowIso();
  db.prepare(
    `UPDATE raaf_records SET workflow_status = ?, updated_at = ?, updated_by = ?,
       reviewed_by = CASE WHEN ? THEN ? ELSE reviewed_by END,
       reviewed_at = CASE WHEN ? THEN ? ELSE reviewed_at END,
       review_note = COALESCE(?, review_note), void_reason = COALESCE(?, void_reason)
     WHERE id = ?`,
  ).run(status, now, user.id, extra.reviewed ? 1 : 0, user.id, extra.reviewed ? 1 : 0, now, extra.note ?? null, extra.voidReason ?? null, row.id);
  logAudit(db, user, {
    action: `record.${status.toLowerCase()}`, entityType: "record", entityId: row.id, recordId: row.id, recordRef: row.ref_no,
    field: "workflowStatus", oldValue: row.workflow_status, newValue: extra.note ? `${status}: ${extra.note}` : status,
  });
}

/** Encoder hands a validated record to a reviewer. Errors block submission. */
export function submitRecord(db: Db, user: AuthUser, id: string, today: string) {
  return transaction(db, () => {
    const row = getReadable(db, user, id);
    if (!actionsFor(user, row).submit) throw row.workflow_status === "DRAFT" ? forbidden() : conflict("Only a draft can be submitted for review");
    const result = runValidation(db, user, id, today);
    if (result.status === "ERROR") throw unprocessable("The record has validation errors and cannot be submitted. Fix them and revalidate.", { errorCount: result.errorCount });
    setWorkflow(db, user, row, "FOR_REVIEW");
    return result;
  });
}

/** Reviewer approves: re-validates against current data first, and a record with warnings needs a written acknowledgement. */
export function approveRecord(db: Db, user: AuthUser, id: string, note: string, today: string) {
  return transaction(db, () => {
    const row = getReadable(db, user, id);
    if (row.workflow_status !== "FOR_REVIEW") throw conflict("Only a record that is for review can be approved");
    if (!actionsFor(user, row).approve) throw forbidden(row.created_by === user.id ? "You cannot approve a record you encoded" : undefined);
    const result = runValidation(db, user, id, today);
    if (result.status === "ERROR") throw unprocessable("The record now has validation errors (the data it depends on may have changed) and cannot be approved.", { errorCount: result.errorCount });
    if (result.status === "WARNING" && note.trim().length < 5) {
      throw unprocessable(`The record has ${result.warningCount} warning(s). Enter a review note acknowledging them to approve.`);
    }
    setWorkflow(db, user, row, "APPROVED", { note: note.trim(), reviewed: true });
    return result;
  });
}

export function returnRecord(db: Db, user: AuthUser, id: string, note: string) {
  transaction(db, () => {
    const row = getReadable(db, user, id);
    if (!actionsFor(user, row).return) throw forbidden();
    if (note.trim().length < 5) throw badRequest("Explain what needs to be corrected (at least 5 characters)");
    setWorkflow(db, user, row, "DRAFT", { note: note.trim(), reviewed: true });
  });
}

export function voidRecord(db: Db, user: AuthUser, id: string, reason: string) {
  transaction(db, () => {
    const row = getReadable(db, user, id);
    if (!actionsFor(user, row).void) throw forbidden();
    if (reason.trim().length < 5) throw badRequest("Enter the reason for voiding (at least 5 characters)");
    setWorkflow(db, user, row, "VOID", { voidReason: reason.trim() });
  });
}
