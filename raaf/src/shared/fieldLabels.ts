/** Human-readable names for header and totals fields, used in messages and the form. */
export const FIELD_LABELS: Record<string, string> = {
  "header.entityName": "Entity name",
  "header.fundCluster": "Fund cluster",
  "header.period": "Reporting month",
  "header.certificationDate": "Certification date",
  "header.preparedByName": "Prepared by (name)",
  "header.preparedByTitle": "Prepared by (designation)",
  "header.checkedByName": "Checked by (name)",
  "header.checkedByTitle": "Checked by (designation)",
  "header.attestedByName": "Attested by (name)",
  "header.attestedByTitle": "Attested by (designation)",
  "header.notedByName": "Noted by (name)",
  "header.notedByTitle": "Noted by (designation)",
  "totals.lineCount": "Total number of lines",
  "totals.beginningQty": "Total beginning balance",
  "totals.receiptQty": "Total receipts",
  "totals.issueQty": "Total issued",
  "totals.endingQty": "Total ending balance",
  lines: "Accountable forms",
};

export const fieldLabel = (path: string): string => FIELD_LABELS[path] ?? path;
