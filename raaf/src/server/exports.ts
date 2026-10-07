import ExcelJS from "exceljs";
import type { RaafReport } from "../shared/types";
import { GROUPS } from "../shared/types";
import { periodLabel } from "../shared/validation/helpers";
import type { RecordSummary } from "../shared/api";

/** What the exported report says about itself. Anything not approved is stamped as unvalidated. */
export function reportingLabel(s: Pick<RecordSummary, "workflowStatus" | "readyForReporting" | "validationStatus">): string {
  if (s.readyForReporting) return "VALIDATED - READY FOR REPORTING";
  if (s.workflowStatus === "VOID") return "VOID - NOT FOR REPORTING";
  if (s.workflowStatus === "FOR_REVIEW") return "FOR REVIEW - NOT YET APPROVED";
  return "DRAFT / UNVALIDATED - NOT FOR REPORTING";
}

/** Stop spreadsheet apps from running a cell as a formula. */
const safe = (v: string): string => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? String(v) : safe(String(v));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const cap = (g: string) => `${g[0]!.toUpperCase()}${g.slice(1)}`;
const LINE_HEADERS = [
  "Line", "Name of Form", "Number", "Face Value",
  ...GROUPS.flatMap((g) => [`${cap(g)} Quantity`, `${cap(g)} From`, `${cap(g)} To`]),
  "Remarks",
];

const lineValues = (l: RaafReport["lines"][number], i: number) => [
  i + 1, l.formName, l.formNumber, l.faceValue, ...GROUPS.flatMap((g) => [l[g].qty, l[g].from, l[g].to]), l.remarks,
];

export function toCsv(summary: RecordSummary, r: RaafReport): string {
  const rows: unknown[][] = [
    ["Professional Regulation Commission"],
    ["REPORT OF ACCOUNTABILITY FOR ACCOUNTABLE FORMS (Board Certificates)"],
    ["Reference", summary.refNo],
    ["Status", reportingLabel(summary)],
    ["Entity", r.header.entityName],
    ["For the month of", periodLabel(r.header.period)],
    ["Fund Cluster", r.header.fundCluster],
    ["Certification date", r.header.certificationDate],
    [],
    LINE_HEADERS,
    ...r.lines.map(lineValues),
    [],
    ["Control totals", "", "", "", r.totals.beginningQty, "", "", r.totals.receiptQty, "", "", r.totals.issueQty, "", "", r.totals.endingQty],
    ["Number of lines", r.totals.lineCount],
    [],
    ["Prepared by", r.header.preparedByName, r.header.preparedByTitle],
    ["Checked by", r.header.checkedByName, r.header.checkedByTitle],
    ["Attested", r.header.attestedByName, r.header.attestedByTitle],
    ["Noted by", r.header.notedByName, r.header.notedByTitle],
  ];
  // BOM so Excel opens UTF-8 correctly.
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export async function toXlsx(summary: RecordSummary, r: RaafReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RAAF Online";
  const ws = wb.addWorksheet(r.header.period || "RAAF");
  const bold = { bold: true };
  ws.addRow(["Professional Regulation Commission"]).font = { bold: true, size: 13 };
  ws.addRow(["REPORT OF ACCOUNTABILITY FOR ACCOUNTABLE FORMS (Board Certificates)"]).font = bold;
  ws.addRow([`For the month of ${periodLabel(r.header.period)}`]);
  const status = ws.addRow([reportingLabel(summary)]);
  status.font = { bold: true, color: { argb: summary.readyForReporting ? "FF0B6B2E" : "FFB42318" } };
  ws.addRow([]);
  ws.addRow(["Entity Name:", r.header.entityName, "", "", "", "", "", "", "", "", "", "Fund Cluster:", r.header.fundCluster]);
  ws.addRow(["Reference:", summary.refNo]);
  ws.addRow([]);
  const groupRow = ws.addRow(["Accountable Forms", "", "", "", "Beginning Balance", "", "", "Receipt", "", "", "Issue", "", "", "Ending Balance"]);
  groupRow.font = bold;
  const head = ws.addRow(["Line", "Name of Form", "Number", "Face Value", "Quantity", "From", "To", "Quantity", "From", "To", "Quantity", "From", "To", "Quantity", "From", "To", "Remarks"]);
  head.font = bold;
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F2" } }; c.border = { bottom: { style: "thin" } }; });
  r.lines.forEach((l, i) => ws.addRow(lineValues(l, i)));
  const totalRow = ws.addRow(["", "TOTAL", "", "", r.totals.beginningQty, "", "", r.totals.receiptQty, "", "", r.totals.issueQty, "", "", r.totals.endingQty]);
  totalRow.font = bold;
  ws.addRow([]);
  ws.addRow(["Prepared by:", r.header.preparedByName, r.header.preparedByTitle]);
  ws.addRow(["Checked by:", r.header.checkedByName, r.header.checkedByTitle]);
  ws.addRow(["Attested:", r.header.attestedByName, r.header.attestedByTitle]);
  ws.addRow(["Noted by:", r.header.notedByName, r.header.notedByTitle]);
  ws.columns.forEach((c, i) => { c.width = i === 1 ? 40 : i === 16 ? 30 : 12; });
  // Text cells are written as strings by exceljs, so a leading "=" cannot become a formula; guard anyway for consistency with CSV.
  ws.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === "string" && /^[=+\-@]/.test(cell.value)) cell.value = safe(cell.value); }));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
