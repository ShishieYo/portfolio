import type { RaafLine, Section, Serial } from "../types";
import { GROUPS } from "../types";

export const emptySerial = (): Serial => ({ qty: null, from: null, to: null });

export const emptyLine = (): RaafLine => ({
  formName: "",
  formNumber: "",
  faceValue: null,
  beginning: emptySerial(),
  receipt: emptySerial(),
  issue: emptySerial(),
  ending: emptySerial(),
  remarks: "",
});

export const isBlank = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Number or null (blank / non-numeric -> null). */
export const toNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The workbook records a single issued serial as qty 1 with "to" left blank or 0.
 * Treat that as from = to so the range checks do not flag it.
 */
export function normalizeSerial(s: Serial): Serial {
  if (s.qty === 1 && s.from !== null && s.from > 0 && (s.to === null || s.to === 0)) {
    return { ...s, to: s.from };
  }
  return s;
}

const isZeroOrNull = (v: number | null) => v === null || v === 0;

/** A group with nothing (or only zeros) entered. */
export const isEmptyGroup = (s: Serial): boolean => isZeroOrNull(s.qty) && isZeroOrNull(s.from) && isZeroOrNull(s.to);

/** A group that is fully entered with a positive range. */
export function isUsableRange(s: Serial): boolean {
  const n = normalizeSerial(s);
  return n.qty !== null && n.qty > 0 && n.from !== null && n.from > 0 && n.to !== null && n.to > 0 && n.from <= n.to;
}

export const isBlankLine = (l: RaafLine): boolean =>
  isBlank(l.formName) && isBlank(l.formNumber) && isBlank(l.remarks) && GROUPS.every((g) => isEmptyGroup(l[g]));

/** Uppercase, trimmed, single-spaced: the canonical spelling used to compare names. */
export const normalizeName = (s: string): string => s.trim().replace(/\s+/g, " ").toUpperCase();

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length);
}

export function closestMatch(value: string, candidates: string[]): { match: string; score: number } | null {
  const v = normalizeName(value);
  let best: { match: string; score: number } | null = null;
  for (const c of candidates) {
    const score = similarity(v, normalizeName(c));
    if (!best || score > best.score) best = { match: c, score };
  }
  return best;
}

export function isValidDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const isValidMonth = (s: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function periodStart(period: string): string | null {
  return isValidMonth(period) ? `${period}-01` : null;
}

export function periodEnd(period: string): string | null {
  if (!isValidMonth(period)) return null;
  const [y, m] = period.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, "0")}`;
}

export function previousPeriod(period: string): string | null {
  if (!isValidMonth(period)) return null;
  const [y, m] = period.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function sectionOf(fieldPath: string): Section {
  if (fieldPath.startsWith("lines")) return "lines";
  if (fieldPath.startsWith("totals")) return "totals";
  const key = fieldPath.replace("header.", "");
  return /(By(Name|Title))$|^certificationDate$/.test(key) ? "certification" : "header";
}

export const MONTH_NAMES = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

export function periodLabel(period: string): string {
  if (!isValidMonth(period)) return period;
  const [y, m] = period.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

/** Next month's lines: every usable ending balance becomes the new beginning balance. */
export function carryForward(prev: RaafLine[]): RaafLine[] {
  return prev
    .filter((l) => !isBlankLine(l) && isUsableRange(l.ending))
    .map((l) => ({ ...emptyLine(), formName: l.formName, beginning: { ...l.ending }, ending: { ...l.ending } }));
}

export function nextPeriod(period: string): string | null {
  if (!isValidMonth(period)) return null;
  const [y, m] = period.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "beginning.qty" -> "beginning quantity", "issue.from" -> "issue From serial". Used as {field} in line messages. */
export function lineFieldLabel(path: string): string {
  const [a, b] = path.split(".");
  if (!b) return a === "formName" ? "form name" : a === "formNumber" ? "form number" : a === "faceValue" ? "face value" : (a ?? path);
  return `${a} ${b === "qty" ? "quantity" : b === "from" ? "From serial" : "To serial"}`;
}
