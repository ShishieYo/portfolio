import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "../src/shared/validation/defaultRules";
import { validateReport } from "../src/shared/validation/engine";
import { emptyLine } from "../src/shared/validation/helpers";
import { DEMO_RECORDS } from "../src/shared/demoData";
import type { RuleDef } from "../src/shared/types";
import { demoReport, env, ids, run, validReport } from "./helpers";

describe("baseline", () => {
  it("accepts a completely correct report with no issues", () => {
    const r = run(validReport());
    expect(r.issues).toEqual([]);
    expect(r.status).toBe("VALID");
  });
});

describe("required fields", () => {
  it("flags every missing required header field with the exact field path", () => {
    const rep = validReport();
    rep.header.entityName = "";
    rep.header.certificationDate = "";
    rep.header.preparedByName = "  ";
    const r = run(rep);
    const paths = r.issues.filter((i) => ["RAAF-REQ-001", "RAAF-REQ-002"].includes(i.ruleId)).map((i) => i.fieldPath);
    expect(paths).toEqual(["header.entityName", "header.certificationDate", "header.preparedByName"]);
    expect(r.status).toBe("ERROR");
  });

  it("flags a line without a form name and a line with neither beginning nor receipt", () => {
    const rep = validReport();
    rep.lines[0]!.formName = "";
    rep.lines[1]!.beginning = { qty: null, from: null, to: null };
    rep.lines[1]!.ending = { qty: 0, from: 0, to: 0 };
    const r = run(rep);
    expect(r.issues.find((i) => i.ruleId === "RAAF-LINE-001")).toMatchObject({ fieldPath: "lines.0.formName", lineNo: 1, section: "lines" });
    expect(r.issues.find((i) => i.ruleId === "RAAF-LINE-002")).toMatchObject({ fieldPath: "lines.1.beginning.qty" });
  });

  it("requires at least one line and all control totals", () => {
    const rep = validReport();
    rep.lines = [];
    rep.totals.endingQty = null;
    const r = run(rep);
    expect(ids(r)).toContain("RAAF-REQ-005");
    expect(r.issues.find((i) => i.ruleId === "RAAF-REQ-004")?.fieldPath).toBe("totals.endingQty");
  });

  it("treats a missing attesting officer as a warning, not an error", () => {
    const rep = validReport();
    rep.header.notedByName = "";
    const r = run(rep);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ ruleId: "RAAF-REQ-003", severity: "WARNING", fieldPath: "header.notedByName" });
    expect(r.status).toBe("WARNING");
  });
});

describe("date validation", () => {
  it("rejects impossible calendar dates and malformed months", () => {
    const rep = validReport();
    rep.header.certificationDate = "2025-02-30";
    rep.header.period = "2025-13";
    const r = run(rep);
    expect(ids(r)).toEqual(expect.arrayContaining(["RAAF-DATE-001", "RAAF-DATE-002"]));
    // downstream date rules must not pile on once the format is invalid
    expect(ids(r)).not.toContain("RAAF-DATE-005");
  });

  it("rejects future dates", () => {
    const rep = validReport();
    rep.header.period = "2026-04";
    rep.header.certificationDate = "2026-04-30";
    const r = run(rep);
    expect(ids(r)).toEqual(expect.arrayContaining(["RAAF-DATE-003", "RAAF-DATE-004"]));
  });

  it("errors when certified before the period starts, warns when certified before it ends", () => {
    const early = validReport();
    early.header.certificationDate = "2024-12-31";
    expect(ids(run(early))).toContain("RAAF-DATE-005");

    const midMonth = validReport();
    midMonth.header.certificationDate = "2025-01-20";
    const r = run(midMonth);
    expect(ids(r)).toEqual(["RAAF-DATE-006"]);
    expect(r.status).toBe("WARNING");
  });
});

describe("numerical validation", () => {
  it("rejects negative, fractional and non-finite quantities", () => {
    const rep = validReport();
    rep.lines[0]!.issue = { qty: -1, from: 1.5, to: 3 };
    rep.lines[1]!.beginning.qty = Number.NaN;
    const r = run(rep);
    const num = r.issues.filter((i) => i.ruleId === "RAAF-NUM-001").map((i) => i.fieldPath);
    expect(num).toEqual(expect.arrayContaining(["lines.0.issue.qty", "lines.0.issue.from"]));
  });

  it("warns (not errors) on suspiciously large quantities", () => {
    const r = run(demoReport("warning"));
    const big = r.issues.find((i) => i.ruleId === "RAAF-NUM-002");
    expect(big).toMatchObject({ severity: "WARNING" });
    expect(big?.message).toContain("12000");
  });

  it("rejects a negative face value", () => {
    const rep = validReport();
    rep.lines[0]!.faceValue = -5;
    expect(ids(run(rep))).toContain("RAAF-NUM-005");
  });
});

describe("serial ranges", () => {
  it("flags a quantity that does not match its serial range", () => {
    const rep = validReport();
    rep.lines[1]!.beginning.qty = 13; // 5001-5012 is 12
    const r = run(rep);
    expect(r.issues.find((i) => i.ruleId === "RAAF-SER-003")).toMatchObject({ fieldPath: "lines.1.beginning.qty" });
    expect(r.issues.find((i) => i.ruleId === "RAAF-SER-003")?.message).toContain("cover 12");
  });

  it("accepts a single issued serial recorded with To left at 0 (as in the workbook)", () => {
    const rep = validReport();
    const l = rep.lines[0]!; // ARCHITECT: beginning 31001-31050, issue 5
    l.issue = { qty: 1, from: 31001, to: 0 };
    l.ending = { qty: 49, from: 31002, to: 31050 };
    rep.totals.issueQty = rep.totals.issueQty! - 4;
    rep.totals.endingQty = rep.totals.endingQty! + 4;
    expect(run(rep).issues).toEqual([]);
  });

  it("flags incomplete groups and reversed ranges", () => {
    const rep = validReport();
    rep.lines[1]!.receipt = { qty: 5, from: 100, to: null };
    rep.lines[2]!.beginning = { qty: 3, from: 90003, to: 90001 };
    const r = run(rep);
    expect(r.issues.find((i) => i.ruleId === "RAAF-SER-001")?.fieldPath).toBe("lines.1.receipt.to");
    expect(r.issues.find((i) => i.ruleId === "RAAF-SER-002")?.fieldPath).toBe("lines.2.beginning.to");
  });

  it("flags issued serials taken from outside the opening stock", () => {
    const rep = validReport();
    rep.lines[0]!.issue = { qty: 5, from: 31100, to: 31104 };
    expect(ids(run(rep))).toContain("RAAF-SER-004");
  });
});

describe("totals and subtotals", () => {
  it("balance equation: beginning + receipt - issue must equal ending", () => {
    const rep = demoReport("math");
    const r = run(rep);
    const bal = r.issues.find((i) => i.ruleId === "RAAF-BAL-001");
    expect(bal).toMatchObject({ severity: "ERROR", fieldPath: "lines.0.ending.qty", lineNo: 1 });
    expect(bal?.message).toBe("Line 1 (ARCHITECT): the ending balance is 37 but beginning + receipt - issue is 36.");
  });

  it("control totals must equal the sum of the lines", () => {
    const rep = validReport();
    rep.totals.endingQty! += 10;
    rep.totals.lineCount! += 1;
    const r = run(rep);
    const t = r.issues.filter((i) => i.ruleId.startsWith("RAAF-TOTAL"));
    expect(t.map((i) => i.ruleId).sort()).toEqual(["RAAF-TOTAL-004", "RAAF-TOTAL-005", "RAAF-TOTAL-006"]);
    expect(t.find((i) => i.ruleId === "RAAF-TOTAL-004")?.message).toContain("lines add up to");
  });

  it("does not count empty lines towards totals or line count", () => {
    const rep = validReport();
    rep.lines.push(emptyLine());
    const r = run(rep);
    expect(ids(r)).toEqual(["RAAF-LINE-003"]);
    expect(r.status).toBe("WARNING");
  });
});

describe("duplicate detection", () => {
  it("flags a report for the same entity and month that already exists", () => {
    const r = run(validReport(), env({ otherReports: [{ id: "x", refNo: "RAAF-000001" }] }));
    expect(r.issues.find((i) => i.ruleId === "RAAF-DUP-001")).toMatchObject({ severity: "ERROR", fieldPath: "header.period" });
    expect(r.issues[0]!.message).toContain("RAAF-000001");
  });

  it("flags identical lines and overlapping serial ranges within a report", () => {
    const r = run(demoReport("duplicate"));
    expect(r.issues.find((i) => i.ruleId === "RAAF-DUP-002")).toMatchObject({ fieldPath: "lines.8.formName", lineNo: 9 });
    expect(r.issues.find((i) => i.ruleId === "RAAF-DUP-003")).toMatchObject({ lineNo: 10 });
  });

  it("does not treat the same serial numbers on different forms as overlapping", () => {
    const rep = validReport();
    const r = run(rep);
    expect(ids(r)).not.toContain("RAAF-DUP-003");
  });
});

describe("cross-field and cross-record consistency", () => {
  it("catches a beginning balance that differs from last month's ending", () => {
    const feb = demoReport("valid-review");
    const mar = demoReport("consistency");
    const r = run(mar, env({ previousReport: { refNo: "RAAF-000002", report: feb }, hasEarlierReports: true }));
    expect(r.issues.find((i) => i.ruleId === "RAAF-CONS-001")).toMatchObject({ lineNo: 2, fieldPath: "lines.1.beginning.qty" });
    expect(r.issues.find((i) => i.ruleId === "RAAF-CONS-003")?.message).toContain("CHEMIST");
  });

  it("passes when beginning balances equal the previous ending", () => {
    const feb = demoReport("valid-review");
    const jan = validReport();
    const r = run(feb, env({ previousReport: { refNo: "RAAF-000001", report: jan }, hasEarlierReports: true }));
    expect(r.issues).toEqual([]);
  });

  it("warns when there is a gap (earlier reports exist but the previous month is missing)", () => {
    const r = run(demoReport("valid-review"), env({ hasEarlierReports: true }));
    expect(ids(r)).toEqual(["RAAF-CONS-002"]);
  });

  it("flags ending serials that are not what remains of the stock", () => {
    const r = run(demoReport("consistency"));
    expect(r.issues.find((i) => i.ruleId === "RAAF-SER-005")).toMatchObject({ lineNo: 4, fieldPath: "lines.3.ending.from" });
  });

  it("flags form names missing from the catalog, suggesting the closest match", () => {
    const r = run(demoReport("warning"));
    const issue = r.issues.find((i) => i.ruleId === "RAAF-LINE-005");
    expect(issue?.message).toContain('Did you mean "OPTOMETRIST"?');
  });

  it("warns when the entity name differs only slightly from names used before", () => {
    const rep = validReport();
    rep.header.entityName = "PRC REGION 3, PAMPANGA.";
    const r = run(rep, env({ knownEntities: ["PRC REGION 3, PAMPANGA"] }));
    expect(ids(r)).toContain("RAAF-NAME-002");
  });
});

describe("severity and multiple issues", () => {
  it("reports every problem on a record, not just the first", () => {
    const rep = validReport();
    rep.header.certificationDate = "";
    rep.lines[0]!.ending.qty = 99;
    rep.totals.issueQty = 1;
    rep.header.notedByName = "";
    const r = run(rep);
    expect(ids(r)).toEqual(expect.arrayContaining(["RAAF-REQ-001", "RAAF-BAL-001", "RAAF-TOTAL-003", "RAAF-REQ-003"]));
    expect(r.errorCount).toBeGreaterThanOrEqual(3);
    expect(r.warningCount).toBe(1);
    expect(r.errorCount + r.warningCount).toBe(r.issues.length);
    expect(r.status).toBe("ERROR");
  });

  it("status is WARNING when only warnings remain and VALID when nothing does", () => {
    expect(run(demoReport("warning")).status).toBe("WARNING");
    expect(run(validReport()).status).toBe("VALID");
  });

  it("honours a rule's configured severity and enabled flag", () => {
    const rep = validReport();
    rep.header.notedByName = "";
    const asError = DEFAULT_RULES.map((r): RuleDef => (r.id === "RAAF-REQ-003" ? { ...r, severity: "ERROR" } : r));
    expect(validateReport(rep, asError, env()).status).toBe("ERROR");
    const disabled = DEFAULT_RULES.map((r): RuleDef => (r.id === "RAAF-REQ-003" ? { ...r, enabled: false } : r));
    expect(validateReport(rep, disabled, env()).status).toBe("VALID");
  });

  it("a rule added as data (no code change) is evaluated", () => {
    const custom: RuleDef = {
      id: "RAAF-CUSTOM-001", name: "Fund cluster required", scope: "header", type: "required",
      fields: ["header.fundCluster"], condition: {}, severity: "ERROR",
      message: "Fund cluster is required.", resolution: "Enter the fund cluster.", enabled: true,
    };
    const r = validateReport(validReport(), [...DEFAULT_RULES, custom], env());
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ ruleId: "RAAF-CUSTOM-001", fieldPath: "header.fundCluster", section: "header" });
  });

  it("fails fast on an unknown rule type", () => {
    const bad: RuleDef = { ...DEFAULT_RULES[0]!, id: "BAD", type: "nope" };
    expect(() => validateReport(validReport(), [bad], env())).toThrow(/unknown type "nope"/);
  });
});

describe("revalidation after correction", () => {
  it("errors disappear once the data is fixed", () => {
    const rep = demoReport("math");
    const before = run(rep);
    expect(before.status).toBe("ERROR");

    rep.lines[0]!.ending.qty = 36;
    rep.lines[1]!.beginning.qty = 10;
    rep.lines[1]!.ending.qty = 8;
    rep.lines[1]!.ending = { qty: 8, from: 6003, to: 6010 };
    const withTotalsFixed = structuredClone(rep);
    const sum = (k: "beginning" | "receipt" | "issue" | "ending") => withTotalsFixed.lines.reduce((a, l) => a + (l[k].qty ?? 0), 0);
    withTotalsFixed.totals = { lineCount: withTotalsFixed.lines.length, beginningQty: sum("beginning"), receiptQty: sum("receipt"), issueQty: sum("issue"), endingQty: sum("ending") };

    const after = run(withTotalsFixed);
    expect(after.issues).toEqual([]);
    expect(after.status).toBe("VALID");
  });
});

describe("demo data behaves as documented", () => {
  const expected: Record<string, { status: string; mustInclude: string[] }> = {
    valid: { status: "VALID", mustInclude: [] },
    "valid-review": { status: "VALID", mustInclude: [] },
    consistency: { status: "ERROR", mustInclude: ["RAAF-DATE-005", "RAAF-SER-005", "RAAF-BAL-001"] },
    warning: { status: "WARNING", mustInclude: ["RAAF-LINE-005", "RAAF-NUM-002", "RAAF-DATE-006", "RAAF-REQ-003"] },
    math: { status: "ERROR", mustInclude: ["RAAF-BAL-001", "RAAF-SER-003", "RAAF-TOTAL-004", "RAAF-TOTAL-003", "RAAF-TOTAL-006"] },
    missing: { status: "ERROR", mustInclude: ["RAAF-REQ-001", "RAAF-REQ-002", "RAAF-REQ-004", "RAAF-LINE-001", "RAAF-SER-001"] },
    duplicate: { status: "ERROR", mustInclude: ["RAAF-DUP-002", "RAAF-DUP-003"] },
  };
  for (const rec of DEMO_RECORDS) {
    it(`${rec.key}`, () => {
      const r = run(structuredClone(rec.report));
      expect(r.status).toBe(expected[rec.key]!.status);
      expect(ids(r)).toEqual(expect.arrayContaining(expected[rec.key]!.mustInclude));
    });
  }
});
