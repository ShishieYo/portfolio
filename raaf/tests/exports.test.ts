import { describe, expect, it } from "vitest";
import type { RecordSummary } from "../src/shared/api";
import { reportingLabel, toCsv } from "../src/server/exports";
import { validReport } from "./helpers";
import { run } from "./helpers";

const summary = (over: Partial<RecordSummary> = {}): RecordSummary => ({
  id: "x", refNo: "RAAF-000001", entityName: "E", period: "2025-01", certificationDate: "2025-02-01", workflowStatus: "DRAFT",
  validationStatus: "PENDING", readyForReporting: false, version: 1, errorCount: null, warningCount: null, createdAt: "", createdBy: "u",
  createdByName: "U", updatedAt: "", updatedByName: "U", reviewedByName: null, reviewedAt: null, reviewNote: "", voidReason: "", ...over,
});

describe("exports", () => {
  it("never labels an unapproved or invalid record as validated", () => {
    expect(reportingLabel(summary())).toMatch(/DRAFT \/ UNVALIDATED/);
    expect(reportingLabel(summary({ workflowStatus: "FOR_REVIEW", validationStatus: "VALID" }))).toMatch(/NOT YET APPROVED/);
    expect(reportingLabel(summary({ workflowStatus: "APPROVED", validationStatus: "ERROR", readyForReporting: false }))).toMatch(/NOT FOR REPORTING/);
    expect(reportingLabel(summary({ workflowStatus: "APPROVED", validationStatus: "VALID", readyForReporting: true }))).toBe("VALIDATED - READY FOR REPORTING");
  });

  it("neutralises spreadsheet formulas and quotes special characters in CSV", () => {
    const r = validReport();
    r.lines[0]!.formName = '=HYPERLINK("http://evil")';
    r.lines[0]!.remarks = 'said "ok", then left';
    const csv = toCsv(summary(), r);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"said ""ok"", then left"');
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });
});

describe("message wording", () => {
  it("names the exact field so two warnings on one line are distinguishable", () => {
    const r = validReport();
    r.lines[0]!.beginning = { qty: 12000, from: 1, to: 12000 };
    r.lines[0]!.ending = { qty: 12000, from: 1, to: 12000 };
    r.lines[0]!.issue = { qty: null, from: null, to: null };
    const msgs = run(r).issues.filter((i) => i.ruleId === "RAAF-NUM-002").map((i) => i.message);
    expect(msgs).toContain("Line 1 (ARCHITECT): the beginning quantity of 12000 is unusually large (more than 10000).");
    expect(msgs).toContain("Line 1 (ARCHITECT): the ending quantity of 12000 is unusually large (more than 10000).");
  });
});
