import type { RuleDef } from "../types";

const GROUP_QTY = ["beginning.qty", "receipt.qty", "issue.qty", "ending.qty"];
const SERIAL_FIELDS = ["beginning", "receipt", "issue", "ending"].flatMap((g) => [`${g}.qty`, `${g}.from`, `${g}.to`]);
const TOTAL_FIELDS = ["totals.lineCount", "totals.beginningQty", "totals.receiptQty", "totals.issueQty", "totals.endingQty"];

type R = Omit<RuleDef, "enabled">;

/**
 * Default rule set, seeded into the validation_rules table on first start.
 * Administrators can change severity, wording, parameters and on/off in the UI;
 * adding a rule of an existing type is just another entry here (or a row in the DB).
 * See evaluators.ts for the condition parameters each type accepts.
 */
const RULES: R[] = [
  // ---- Required information -------------------------------------------------
  {
    id: "RAAF-REQ-001", name: "Report details complete", scope: "header", type: "required",
    fields: ["header.entityName", "header.period", "header.certificationDate"], condition: {}, severity: "ERROR",
    message: "{label} is required.",
    resolution: "Fill in the entity name, reporting month and certification date.",
  },
  {
    id: "RAAF-REQ-002", name: "Preparer and checker named", scope: "header", type: "required",
    fields: ["header.preparedByName", "header.preparedByTitle", "header.checkedByName", "header.checkedByTitle"], condition: {}, severity: "ERROR",
    message: "{label} is required.",
    resolution: "Enter the name and designation of the COR Custodian (Prepared by) and the Checked by officer.",
  },
  {
    id: "RAAF-REQ-003", name: "Attesting and noting officers named", scope: "header", type: "required",
    fields: ["header.attestedByName", "header.attestedByTitle", "header.notedByName", "header.notedByTitle"], condition: {}, severity: "WARNING",
    message: "{label} is not filled in.",
    resolution: "Enter the COA Auditor and Regional Director, or confirm they will be added before signing.",
  },
  {
    id: "RAAF-REQ-004", name: "Control totals entered", scope: "header", type: "required",
    fields: TOTAL_FIELDS, condition: {}, severity: "ERROR",
    message: "{label} is required.",
    resolution: "Enter every control total. Use \"Fill from lines\" to compute them, then verify against your source documents.",
  },
  {
    id: "RAAF-REQ-005", name: "At least one form line", scope: "record", type: "min_lines",
    fields: ["lines"], condition: { min: 1 }, severity: "ERROR",
    message: "The report has no accountable-form lines (minimum {min}).",
    resolution: "Add at least one line under Accountable Forms.",
  },
  {
    id: "RAAF-LINE-001", name: "Form name required", scope: "line", type: "required",
    fields: ["formName"], condition: {}, severity: "ERROR",
    message: "Line {line}: the name of the form is missing.",
    resolution: "Select the form from the catalog.",
  },
  {
    id: "RAAF-LINE-002", name: "Opening stock or receipt entered", scope: "line", type: "any_present",
    fields: ["beginning.qty", "receipt.qty"], condition: {}, severity: "ERROR",
    message: "Line {line} ({form}): neither a beginning balance nor a receipt is entered.",
    resolution: "Enter the beginning balance quantity, or the receipt quantity, for this line (0 is allowed).",
  },
  {
    id: "RAAF-LINE-003", name: "Empty line", scope: "line", type: "blank_line",
    fields: ["formName"], condition: {}, severity: "WARNING",
    message: "Line {line} is empty.",
    resolution: "Remove the empty line or fill it in.",
  },

  // ---- Dates ------------------------------------------------------------------
  {
    id: "RAAF-DATE-001", name: "Reporting month is a valid month", scope: "header", type: "date_format",
    fields: ["header.period"], condition: { format: "month" }, severity: "ERROR",
    message: "\"{value}\" is not a valid reporting month.",
    resolution: "Use the month picker (YYYY-MM).",
  },
  {
    id: "RAAF-DATE-002", name: "Certification date is a valid date", scope: "header", type: "date_format",
    fields: ["header.certificationDate"], condition: { format: "date" }, severity: "ERROR",
    message: "\"{value}\" is not a valid date.",
    resolution: "Use the date picker (YYYY-MM-DD).",
  },
  {
    id: "RAAF-DATE-003", name: "Reporting month not in the future", scope: "header", type: "date_bounds",
    fields: ["header.period"], condition: { notFuture: true, min: "2000-01" }, severity: "ERROR",
    message: "The reporting month {value} is outside the allowed range (not after {limit}, not before 2000-01).",
    resolution: "Correct the reporting month.",
  },
  {
    id: "RAAF-DATE-004", name: "Certification date not in the future", scope: "header", type: "date_bounds",
    fields: ["header.certificationDate"], condition: { notFuture: true, min: "2000-01-01" }, severity: "ERROR",
    message: "The certification date {value} is outside the allowed range (not after {limit}).",
    resolution: "A report cannot be certified on a future date. Correct the date.",
  },
  {
    id: "RAAF-DATE-005", name: "Certified after the period starts", scope: "header", type: "chronological",
    fields: ["header.certificationDate"], condition: { before: "derived.periodStart", after: "header.certificationDate" }, severity: "ERROR",
    message: "The certification date {after} is before the reporting period starts ({before}).",
    resolution: "Correct the certification date or the reporting month.",
  },
  {
    id: "RAAF-DATE-006", name: "Certified after the period ends", scope: "header", type: "chronological",
    fields: ["header.certificationDate"], condition: { before: "derived.periodEnd", after: "header.certificationDate" }, severity: "WARNING",
    message: "The report was certified on {after}, before the reporting month ended ({before}).",
    resolution: "Confirm the certification date is correct; an end-of-month report is normally certified on or after the last day.",
  },

  // ---- Names and consistency ------------------------------------------------
  {
    id: "RAAF-NAME-001", name: "Entity name spelling", scope: "header", type: "text_format",
    fields: ["header.entityName"], condition: {}, severity: "WARNING",
    message: "The entity name \"{value}\" has inconsistent capitalisation or spacing (expected \"{expected}\").",
    resolution: "Use uppercase with single spaces so the name matches other reports.",
  },
  {
    id: "RAAF-NAME-002", name: "Entity name matches earlier reports", scope: "header", type: "known_value",
    fields: ["header.entityName"], condition: { field: "header.entityName" }, severity: "WARNING",
    message: "The entity name \"{value}\" is not the same as \"{match}\" used in earlier reports.",
    resolution: "Use the exact name from earlier reports, or confirm this is a different entity.",
  },
  {
    id: "RAAF-LINE-004", name: "Form name spelling", scope: "line", type: "text_format",
    fields: ["formName"], condition: {}, severity: "WARNING",
    message: "Line {line}: the form name \"{value}\" has inconsistent capitalisation or spacing (expected \"{expected}\").",
    resolution: "Use uppercase with single spaces.",
  },
  {
    id: "RAAF-LINE-005", name: "Form is in the catalog", scope: "line", type: "catalog_lookup",
    fields: ["formName"], condition: {}, severity: "WARNING",
    message: "Line {line}: \"{value}\" is not in the accountable-forms catalog. {hint}",
    resolution: "Select the form from the catalog so the same form is always spelled the same way.",
  },

  // ---- Numbers --------------------------------------------------------------
  {
    id: "RAAF-NUM-001", name: "Quantities and serials are whole numbers", scope: "line", type: "number",
    fields: SERIAL_FIELDS, condition: { integer: true, min: 0 }, severity: "ERROR",
    message: "Line {line} ({form}): the {field} \"{value}\" is not a valid whole number of 0 or more.",
    resolution: "Enter a whole number, 0 or higher.",
  },
  {
    id: "RAAF-NUM-002", name: "Unusually large quantity", scope: "line", type: "number",
    fields: GROUP_QTY, condition: { max: 10000 }, severity: "WARNING",
    message: "Line {line} ({form}): the {field} of {value} is unusually large (more than {max}).",
    resolution: "Check for an extra digit. If the quantity is correct, leave a remark and proceed to review.",
  },
  {
    id: "RAAF-NUM-003", name: "Serial number out of range", scope: "line", type: "number",
    fields: ["beginning.from", "beginning.to", "receipt.from", "receipt.to", "issue.from", "issue.to", "ending.from", "ending.to"],
    condition: { max: 9999999 }, severity: "WARNING",
    message: "Line {line} ({form}): the {field} {value} has more than 7 digits.",
    resolution: "Check the serial number for an extra digit.",
  },
  {
    id: "RAAF-NUM-004", name: "Control totals are whole numbers", scope: "header", type: "number",
    fields: TOTAL_FIELDS, condition: { integer: true, min: 0 }, severity: "ERROR",
    message: "{label}: \"{value}\" is not a valid whole number of 0 or more.",
    resolution: "Enter a whole number, 0 or higher.",
  },
  {
    id: "RAAF-NUM-005", name: "Face value is not negative", scope: "line", type: "number",
    fields: ["faceValue"], condition: { min: 0 }, severity: "ERROR",
    message: "Line {line} ({form}): the {field} \"{value}\" is not valid.",
    resolution: "Enter 0 or a positive amount, or leave blank (board certificates have no face value).",
  },

  // ---- Serial ranges --------------------------------------------------------
  {
    id: "RAAF-SER-001", name: "Quantity and serial range complete", scope: "line", type: "serial_group",
    fields: SERIAL_FIELDS, condition: { check: "complete" }, severity: "ERROR",
    message: "Line {line} ({form}): the {group} quantity and serial range are incomplete (missing {missing}).",
    resolution: "Enter the quantity and both the From and To serial numbers, or clear the group.",
  },
  {
    id: "RAAF-SER-002", name: "Serial range in order", scope: "line", type: "serial_group",
    fields: ["beginning.to", "receipt.to", "issue.to", "ending.to"], condition: { check: "order" }, severity: "ERROR",
    message: "Line {line} ({form}): the {group} serial range runs backwards ({from} to {to}).",
    resolution: "The From serial must not be higher than the To serial.",
  },
  {
    id: "RAAF-SER-003", name: "Quantity matches serial range", scope: "line", type: "serial_group",
    fields: GROUP_QTY, condition: { check: "qty" }, severity: "ERROR",
    message: "Line {line} ({form}): the {group} quantity is {qty} but serials {from} to {to} cover {expected}.",
    resolution: "Make the quantity equal To - From + 1, or correct the serial numbers.",
  },
  {
    id: "RAAF-SER-004", name: "Issued serials come from the opening stock", scope: "line", type: "serial_continuity",
    fields: ["issue.from", "issue.to"], condition: { check: "issue" }, severity: "ERROR",
    message: "Line {line} ({form}): issued serials {issueFrom}-{issueTo} are outside the {group} range {from}-{to}.",
    resolution: "Issued serial numbers must come out of the beginning or received range on the same line.",
  },
  {
    id: "RAAF-SER-005", name: "Ending serials are what remains", scope: "line", type: "serial_continuity",
    fields: ["ending.from", "ending.to"], condition: { check: "ending" }, severity: "ERROR",
    message: "Line {line} ({form}): an ending serial is {actual} but the stock that remains implies {expected}.",
    resolution: "The ending range is the beginning/received range minus the issued serials. Correct the ending From/To.",
  },
  {
    id: "RAAF-BAL-001", name: "Beginning + receipt - issue = ending", scope: "line", type: "equation",
    fields: GROUP_QTY, condition: { left: "ending.qty", terms: ["+beginning.qty", "+receipt.qty", "-issue.qty"] }, severity: "ERROR",
    message: "Line {line} ({form}): the ending balance is {actual} but beginning + receipt - issue is {expected}.",
    resolution: "Recheck the beginning, receipt, issue and ending quantities for this line.",
  },

  // ---- Totals -----------------------------------------------------------------
  {
    id: "RAAF-TOTAL-001", name: "Beginning total matches lines", scope: "header", type: "sum_equals",
    fields: ["totals.beginningQty"], condition: { total: "totals.beginningQty", sum: "beginning.qty" }, severity: "ERROR",
    message: "{label} is reported as {actual} but the lines add up to {expected}.",
    resolution: "Correct the control total or the line quantities.",
  },
  {
    id: "RAAF-TOTAL-002", name: "Receipt total matches lines", scope: "header", type: "sum_equals",
    fields: ["totals.receiptQty"], condition: { total: "totals.receiptQty", sum: "receipt.qty" }, severity: "ERROR",
    message: "{label} is reported as {actual} but the lines add up to {expected}.",
    resolution: "Correct the control total or the line quantities.",
  },
  {
    id: "RAAF-TOTAL-003", name: "Issue total matches lines", scope: "header", type: "sum_equals",
    fields: ["totals.issueQty"], condition: { total: "totals.issueQty", sum: "issue.qty" }, severity: "ERROR",
    message: "{label} is reported as {actual} but the lines add up to {expected}.",
    resolution: "Correct the control total or the line quantities.",
  },
  {
    id: "RAAF-TOTAL-004", name: "Ending total matches lines", scope: "header", type: "sum_equals",
    fields: ["totals.endingQty"], condition: { total: "totals.endingQty", sum: "ending.qty" }, severity: "ERROR",
    message: "{label} is reported as {actual} but the lines add up to {expected}.",
    resolution: "Correct the control total or the line quantities.",
  },
  {
    id: "RAAF-TOTAL-005", name: "Line count matches lines", scope: "header", type: "sum_equals",
    fields: ["totals.lineCount"], condition: { total: "totals.lineCount", count: true }, severity: "ERROR",
    message: "{label} is reported as {actual} but {expected} lines are encoded.",
    resolution: "Correct the line count or add / remove lines.",
  },
  {
    id: "RAAF-TOTAL-006", name: "Control totals reconcile with each other", scope: "header", type: "equation",
    fields: ["totals.endingQty"],
    condition: { left: "totals.endingQty", terms: ["+totals.beginningQty", "+totals.receiptQty", "-totals.issueQty"], skipIfAnyBlank: true },
    severity: "ERROR",
    message: "The control totals do not reconcile: ending is {actual} but beginning + receipts - issued is {expected}.",
    resolution: "Recheck the four control totals against each other.",
  },

  // ---- Duplicates and history ----------------------------------------------------
  {
    id: "RAAF-DUP-001", name: "No duplicate report for the month", scope: "record", type: "duplicate_report",
    fields: ["header.period"], condition: {}, severity: "ERROR",
    message: "A report for this entity and month already exists ({ref}).",
    resolution: "Open the existing report instead, or void one of them.",
  },
  {
    id: "RAAF-DUP-002", name: "No duplicate lines", scope: "record", type: "duplicate_lines",
    fields: ["formName"], condition: {}, severity: "ERROR",
    message: "Line {line} ({form}) is identical to line {other}.",
    resolution: "Remove the duplicate line.",
  },
  {
    id: "RAAF-DUP-003", name: "Serial ranges do not overlap", scope: "record", type: "serial_overlap",
    fields: ["beginning.from", "receipt.from"], condition: {}, severity: "ERROR",
    message: "Line {line} ({form}): serials {from}-{to} overlap the range on line {other} of the same form.",
    resolution: "Each serial number can belong to only one batch. Correct the serial ranges.",
  },
  {
    id: "RAAF-CONS-001", name: "Beginning balance equals previous ending", scope: "record", type: "previous_carryover",
    fields: ["beginning.qty"], condition: {}, severity: "ERROR",
    message: "Line {line} ({form}): beginning balance {from}-{to} does not match any ending balance in the previous month's report ({prevRef}).",
    resolution: "Beginning balances must equal last month's ending balances. Correct this line or last month's report.",
  },
  {
    id: "RAAF-CONS-003", name: "Previous ending balances carried forward", scope: "record", type: "previous_uncarried",
    fields: ["header.period"], condition: {}, severity: "ERROR",
    message: "Last month's ending balance for {prevForm} ({from}-{to}, report {prevRef}) is not carried forward as a beginning balance.",
    resolution: "Add a line with this beginning balance, or correct last month's report.",
  },
  {
    id: "RAAF-CONS-002", name: "Previous month report on file", scope: "record", type: "previous_missing",
    fields: ["header.period"], condition: {}, severity: "WARNING",
    message: "There is no report on file for the previous month, so the beginning balances could not be verified.",
    resolution: "Encode the missing month first, or have a reviewer confirm the beginning balances.",
  },
];

export const DEFAULT_RULES: RuleDef[] = RULES.map((r) => ({ ...r, enabled: true }));
