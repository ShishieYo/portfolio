import type { RaafHeader, RaafLine, RaafReport, Serial } from "./types";
import { carryForward, emptyLine, isBlankLine } from "./validation/helpers";

/* All names and serial numbers below are invented sample data. */

const range = (from: number, to: number): Serial => ({ qty: to - from + 1, from, to });
const clone = <T,>(v: T): T => structuredClone(v);

/** Build a consistent line; the issue (if any) is taken from the start of the opening range. */
function mkLine(formName: string, opts: { beginning?: [number, number]; receipt?: [number, number]; issued?: number }): RaafLine {
  const line = emptyLine();
  line.formName = formName;
  if (opts.beginning) line.beginning = range(...opts.beginning);
  if (opts.receipt) line.receipt = range(...opts.receipt);
  const src = line.beginning.qty ? line.beginning : line.receipt;
  const issued = opts.issued ?? 0;
  if (issued > 0) line.issue = range(src.from!, src.from! + issued - 1);
  line.ending = issued === src.qty ? { qty: 0, from: 0, to: 0 } : range(src.from! + issued, src.to!);
  return line;
}

const withIssue = (l: RaafLine, issued: number): RaafLine => mkLine(l.formName, { beginning: [l.beginning.from!, l.beginning.to!], issued });

function withTotals(header: RaafHeader, lines: RaafLine[]): RaafReport {
  const active = lines.filter((l) => !isBlankLine(l));
  const sum = (pick: (l: RaafLine) => number | null) => active.reduce((a, l) => a + (pick(l) ?? 0), 0);
  return {
    header,
    lines,
    totals: {
      lineCount: active.length,
      beginningQty: sum((l) => l.beginning.qty),
      receiptQty: sum((l) => l.receipt.qty),
      issueQty: sum((l) => l.issue.qty),
      endingQty: sum((l) => l.ending.qty),
    },
  };
}

export const DEMO_ENTITY = "PRC REGION 3, PAMPANGA";

const header = (period: string, certificationDate: string, entityName = DEMO_ENTITY): RaafHeader => ({
  entityName,
  fundCluster: "",
  period,
  certificationDate,
  preparedByName: "JUAN D. CRUZ",
  preparedByTitle: "COR Custodian",
  checkedByName: "MARIA L. SANTOS",
  checkedByTitle: "OIC, Licensure and Registration Division",
  attestedByName: "ANA P. REYES",
  attestedByTitle: "COA Auditor",
  notedByName: "RAMON T. DELA PENA",
  notedByTitle: "Regional Director",
});

const OPENING: RaafLine[] = [
  mkLine("ARCHITECT", { beginning: [31001, 31050], issued: 5 }),
  mkLine("CHEMIST", { beginning: [5001, 5012] }),
  mkLine("CIVIL ENGINEER", { beginning: [90201, 90420] }),
  mkLine("NURSE", { beginning: [500001, 500150], issued: 6 }),
  mkLine("PHARMACIST", { beginning: [35101, 35140], issued: 40 }),
  mkLine("PHARMACIST", { beginning: [36001, 36060], issued: 8 }),
  mkLine("PROFESSIONAL TEACHERS - SECONDARY", { beginning: [610001, 610800] }),
  mkLine("PROFESSIONAL TEACHERS - SECONDARY", { receipt: [611001, 611500], issued: 4 }),
];

const jan = withTotals(header("2025-01", "2025-02-03"), OPENING);

const feb = withTotals(
  header("2025-02", "2025-03-04"),
  carryForward(jan.lines).map((l) => (l.formName === "NURSE" ? withIssue(l, 10) : l.formName === "ARCHITECT" ? withIssue(l, 3) : l)),
);

/** Consistency errors: beginning does not match February's ending, certified before the month began, ending serials wrong. */
const marLines = carryForward(feb.lines);
const marChemist = marLines.find((l) => l.formName === "CHEMIST")!;
marChemist.beginning = range(5001, 5014); // February ended with 12 (5001-5012)
marChemist.ending = range(5001, 5014);
const marNurse = marLines.find((l) => l.formName === "NURSE")!;
const nurseIssued = mkLine("NURSE", { beginning: [marNurse.beginning.from!, marNurse.beginning.to!], issued: 5 });
nurseIssued.ending = range(nurseIssued.ending.from! + 1, nurseIssued.ending.to!); // ending serials skip a number
marLines[marLines.indexOf(marNurse)] = nurseIssued;
const mar = withTotals(header("2025-03", "2025-02-28"), marLines);

/** Warnings only: misspelt form, unusually large receipt, certified before month end, officers not yet named. */
const aprLines = [
  ...carryForward(mar.lines),
  mkLine("OPTOMETRSIT", { receipt: [20001, 32000], issued: 2 }),
];
const apr = withTotals(header("2025-04", "2025-04-28"), aprLines);
apr.header.attestedByName = "";
apr.header.attestedByTitle = "";
apr.header.notedByName = "";
apr.header.notedByTitle = "";

/** Math errors: quantity vs serial range, ending vs beginning + receipt - issue, and control totals. */
const tarlacLines = [
  mkLine("ARCHITECT", { beginning: [41001, 41040], issued: 4 }),
  mkLine("CHEMIST", { beginning: [6001, 6010], issued: 2 }),
  mkLine("NURSE", { beginning: [510001, 510100], issued: 10 }),
  mkLine("PHYSICIAN", { beginning: [70001, 70060], issued: 7 }),
];
tarlacLines[0]!.ending.qty = 37; // 40 - 4 = 36
tarlacLines[1]!.beginning.qty = 11; // 6001-6010 is 10 serials
const tarlac = withTotals(header("2025-03", "2025-04-02", "PRC REGION 3, TARLAC"), tarlacLines);
tarlac.totals.endingQty = tarlac.totals.endingQty! + 10;
tarlac.totals.issueQty = tarlac.totals.issueQty! - 3;

/** Missing data: required fields, a nameless line, an incomplete serial range, no control totals. */
const bulacanLines = [
  mkLine("ARCHITECT", { beginning: [51001, 51030], issued: 3 }),
  mkLine("NURSE", { beginning: [520001, 520100], issued: 12 }),
  mkLine("", { beginning: [80001, 80020], issued: 2 }),
  mkLine("DENTIST", { beginning: [91001, 91016] }),
];
bulacanLines[3]!.beginning.to = null;
const bulacan = withTotals(header("2025-02", "", "PRC REGION 3, BULACAN"), bulacanLines);
bulacan.header.preparedByName = "";
bulacan.header.checkedByTitle = "";
bulacan.totals = { lineCount: null, beginningQty: null, receiptQty: null, issueQty: null, endingQty: null };

/** A second report for the same entity and month as `jan`, with a repeated line and an overlapping serial range. */
const dupLines = clone(OPENING);
dupLines.push(clone(OPENING[0]!));
dupLines.push(mkLine("NURSE", { beginning: [500100, 500200] }));
const dup = withTotals(header("2025-01", "2025-02-05"), dupLines);

export interface DemoRecord {
  key: string;
  description: string;
  creator: "encoder1" | "encoder2";
  /** How far the seed takes the record through the workflow. */
  stage: "approved" | "for_review" | "validated";
  report: RaafReport;
}

/** Order matters: later records are validated against earlier ones. */
export const DEMO_RECORDS: DemoRecord[] = [
  { key: "valid", description: "Valid: a completely correct report (approved)", creator: "encoder1", stage: "approved", report: jan },
  { key: "valid-review", description: "Valid: correct report carried forward from January, awaiting review", creator: "encoder1", stage: "for_review", report: feb },
  { key: "consistency", description: "Consistency errors: conflicts with February and with itself", creator: "encoder1", stage: "validated", report: mar },
  { key: "warning", description: "Warning: technically valid but needs human review", creator: "encoder1", stage: "validated", report: apr },
  { key: "math", description: "Mathematical errors: totals and quantities do not reconcile", creator: "encoder2", stage: "validated", report: tarlac },
  { key: "missing", description: "Missing data: required fields and control totals not filled in", creator: "encoder2", stage: "validated", report: bulacan },
  { key: "duplicate", description: "Duplicate: same entity and month as the January report, repeated and overlapping lines", creator: "encoder2", stage: "validated", report: dup },
];

