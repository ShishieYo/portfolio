import type { GroupName, RaafLine, RaafReport, RuleDef, Serial, ValidationEnv } from "../types";
import { GROUPS } from "../types";
import {
  closestMatch,
  getPath,
  isBlank,
  isBlankLine,
  isEmptyGroup,
  isUsableRange,
  isValidDate,
  isValidMonth,
  normalizeName,
  normalizeSerial,
  periodEnd,
  periodStart,
  toNum,
} from "./helpers";

/** What an evaluator reports. The engine adds rule id, severity, message text and absolute paths. */
export interface Finding {
  /** Path relative to the evaluation target (the line for line-scope rules, the report otherwise). */
  field: string;
  /** For record-scope evaluators reporting on a specific line. Line-scope findings get this automatically. */
  lineIndex?: number;
  vars?: Record<string, string | number>;
}

export interface EvalContext {
  rule: RuleDef;
  /** The line (line scope) or the whole report. */
  target: unknown;
  report: RaafReport;
  env: ValidationEnv;
}

export type Evaluator = (ctx: EvalContext) => Finding[];

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const cond = (ctx: EvalContext) => ctx.rule.condition;

const lineGroup = (l: RaafLine, g: GroupName): Serial => l[g];

const activeLines = (report: RaafReport) =>
  report.lines.map((line, index) => ({ line, index })).filter(({ line }) => !isBlankLine(line));

const required: Evaluator = ({ rule, target }) =>
  rule.fields.filter((f) => isBlank(getPath(target, f))).map((field) => ({ field }));

/** At least one of the listed fields must be filled (0 counts as filled). */
const anyPresent: Evaluator = ({ rule, target }) =>
  rule.fields.some((f) => !isBlank(getPath(target, f))) ? [] : [{ field: rule.fields[0] ?? "" }];

const dateFormat: Evaluator = (ctx) => {
  const kind = str(cond(ctx).format, "date");
  return ctx.rule.fields.flatMap((field) => {
    const v = getPath(ctx.target, field);
    if (isBlank(v)) return [];
    const ok = typeof v === "string" && (kind === "month" ? isValidMonth(v) : isValidDate(v));
    return ok ? [] : [{ field, vars: { value: String(v) } }];
  });
};

const dateBounds: Evaluator = (ctx) => {
  const { notFuture, min } = cond(ctx);
  return ctx.rule.fields.flatMap((field) => {
    const v = getPath(ctx.target, field);
    if (typeof v !== "string" || !(isValidDate(v) || isValidMonth(v))) return [];
    const len = v.length;
    const today = ctx.env.today.slice(0, len);
    if (notFuture && v > today) return [{ field, vars: { value: v, limit: today } }];
    if (typeof min === "string" && v < min.slice(0, len)) return [{ field, vars: { value: v, limit: min } }];
    return [];
  });
};

/** `before` must not come after `after`. Paths may use derived.periodStart / derived.periodEnd. */
const chronological: Evaluator = (ctx) => {
  const resolve = (path: string): string | null => {
    if (path === "derived.periodStart") return periodStart(ctx.report.header.period);
    if (path === "derived.periodEnd") return periodEnd(ctx.report.header.period);
    const v = getPath(ctx.report, path);
    return typeof v === "string" && isValidDate(v) ? v : null;
  };
  const beforePath = str(cond(ctx).before);
  const afterPath = str(cond(ctx).after);
  const before = resolve(beforePath);
  const after = resolve(afterPath);
  if (!before || !after || before <= after) return [];
  return [{ field: afterPath.replace(/^report\./, ""), vars: { before, after } }];
};

const textFormat: Evaluator = (ctx) =>
  ctx.rule.fields.flatMap((field) => {
    const v = getPath(ctx.target, field);
    if (typeof v !== "string" || v.trim() === "") return [];
    return v === normalizeName(v) ? [] : [{ field, vars: { value: v, expected: normalizeName(v) } }];
  });

const number: Evaluator = (ctx) => {
  const { integer, min, max } = cond(ctx) as { integer?: boolean; min?: number; max?: number };
  return ctx.rule.fields.flatMap((field) => {
    const v = getPath(ctx.target, field);
    if (isBlank(v)) return [];
    const vars = { value: String(v), min: min ?? "", max: max ?? "" };
    if (typeof v !== "number" || !Number.isFinite(v)) return [{ field, vars }];
    if (integer && !Number.isInteger(v)) return [{ field, vars }];
    if (min !== undefined && v < min) return [{ field, vars }];
    if (max !== undefined && v > max) return [{ field, vars }];
    return [];
  });
};

/** Checks on each quantity + serial-range group of a line. */
const serialGroup: Evaluator = (ctx) => {
  const check = str(cond(ctx).check);
  const line = ctx.target as RaafLine;
  const out: Finding[] = [];
  for (const g of GROUPS) {
    const s = normalizeSerial(lineGroup(line, g));
    if (check === "complete") {
      if (isEmptyGroup(s)) continue;
      const missing = (["qty", "from", "to"] as const).filter((k) => s[k] === null);
      if (missing.length) out.push({ field: `${g}.${missing[0]}`, vars: { group: g, missing: missing.join(", ") } });
    } else if (check === "order") {
      if (s.from !== null && s.to !== null && s.from > 0 && s.to > 0 && s.from > s.to)
        out.push({ field: `${g}.to`, vars: { group: g, from: s.from, to: s.to } });
    } else if (check === "qty") {
      if (s.qty === null || s.from === null || s.to === null) continue;
      const hasRange = s.from > 0 || s.to > 0;
      if (!hasRange && s.qty === 0) continue;
      if (s.from > s.to) continue;
      const expected = hasRange ? s.to - s.from + 1 : 0;
      if (s.qty !== expected) out.push({ field: `${g}.qty`, vars: { group: g, qty: s.qty, from: s.from, to: s.to, expected } });
    } else {
      throw new Error(`serial_group: unknown check "${check}" in rule ${ctx.rule.id}`);
    }
  }
  return out;
};

const sumTerms = (target: unknown, terms: string[]): { value: number; anyBlank: boolean } => {
  let value = 0;
  let anyBlank = false;
  for (const t of terms) {
    const sign = t.startsWith("-") ? -1 : 1;
    const v = toNum(getPath(target, t.replace(/^[+-]/, "")));
    if (v === null) anyBlank = true;
    else value += sign * v;
  }
  return { value, anyBlank };
};

/** left = sum of signed terms. Blank values count as 0 unless skipIfAnyBlank is set. */
const equation: Evaluator = (ctx) => {
  const { left, terms, skipIfAnyBlank } = cond(ctx) as { left: string; terms: string[]; skipIfAnyBlank?: boolean };
  const leftVal = toNum(getPath(ctx.target, left));
  const { value: expected, anyBlank } = sumTerms(ctx.target, terms);
  if (skipIfAnyBlank && (leftVal === null || anyBlank)) return [];
  const actual = leftVal ?? 0;
  return actual === expected ? [] : [{ field: left, vars: { actual, expected, formula: terms.join(" ").replace(/\+/g, "+ ").replace(/-/g, "- ") } }];
};

/** A reported control total must equal the sum (or count) over the non-blank lines. */
const sumEquals: Evaluator = (ctx) => {
  const { total, sum, count } = cond(ctx) as { total: string; sum?: string; count?: boolean };
  const reported = toNum(getPath(ctx.report, total));
  if (reported === null) return [];
  const lines = activeLines(ctx.report);
  const expected = count ? lines.length : lines.reduce((acc, { line }) => acc + (toNum(getPath(line, sum ?? "")) ?? 0), 0);
  return reported === expected ? [] : [{ field: total, vars: { actual: reported, expected } }];
};

/** The issue must come out of the opening stock, and the ending balance must be what is left. */
const serialContinuity: Evaluator = (ctx) => {
  const check = str(cond(ctx).check);
  if (check !== "issue" && check !== "ending") throw new Error(`serial_continuity: unknown check "${check}" in rule ${ctx.rule.id}`);
  const l = ctx.target as RaafLine;
  const hasBeg = !isEmptyGroup(l.beginning);
  const hasRec = !isEmptyGroup(l.receipt);
  if (hasBeg === hasRec) return [];
  const src = normalizeSerial(hasBeg ? l.beginning : l.receipt);
  if (!isUsableRange(src)) return [];
  const srcGroup = hasBeg ? "beginning" : "receipt";
  const issue = normalizeSerial(l.issue);
  const ending = normalizeSerial(l.ending);
  const from = src.from!;
  const to = src.to!;
  const out: Finding[] = [];
  let remainder: [number, number] | null = [from, to];

  if (isUsableRange(issue)) {
    const [if_, it] = [issue.from!, issue.to!];
    if (if_ < from || it > to) {
      if (check === "issue") out.push({ field: "issue.from", vars: { group: srcGroup, from, to, issueFrom: if_, issueTo: it } });
      return out;
    }
    if (if_ === from) remainder = it === to ? null : [it + 1, to];
    else if (it === to) remainder = [from, if_ - 1];
    else return out; // issued from the middle of the batch: cannot predict the remainder
  } else if (!isEmptyGroup(issue)) {
    return out; // incomplete issue is reported by the serial_group rules
  }

  if (check === "issue") return out;
  const endFrom = ending.from ?? 0;
  const endTo = ending.to ?? 0;
  const [expFrom, expTo] = remainder ?? [0, 0];
  if (endFrom !== expFrom) out.push({ field: "ending.from", vars: { actual: endFrom, expected: expFrom } });
  if (endTo !== expTo) out.push({ field: "ending.to", vars: { actual: endTo, expected: expTo } });
  return out;
};

const lineKey = (l: RaafLine): string =>
  [normalizeName(l.formName), ...GROUPS.flatMap((g) => [l[g].qty, l[g].from, l[g].to])].join("|");

const duplicateLines: Evaluator = ({ report }) => {
  const seen = new Map<string, number>();
  const out: Finding[] = [];
  for (const { line, index } of activeLines(report)) {
    const key = lineKey(line);
    const first = seen.get(key);
    if (first === undefined) seen.set(key, index);
    else out.push({ field: "formName", lineIndex: index, vars: { other: first + 1 } });
  }
  return out;
};

const serialOverlap: Evaluator = ({ report }) => {
  const byForm = new Map<string, { index: number; group: "beginning" | "receipt"; from: number; to: number; key: string }[]>();
  for (const { line, index } of activeLines(report)) {
    for (const group of ["beginning", "receipt"] as const) {
      const s = normalizeSerial(line[group]);
      if (!isUsableRange(s)) continue;
      const name = normalizeName(line.formName);
      const list = byForm.get(name) ?? [];
      list.push({ index, group, from: s.from!, to: s.to!, key: lineKey(line) });
      byForm.set(name, list);
    }
  }
  const out: Finding[] = [];
  for (const ranges of byForm.values()) {
    ranges.sort((a, b) => a.from - b.from || a.index - b.index);
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const [a, b] = [ranges[i]!, ranges[j]!];
        if (b.from > a.to) break;
        if (a.index === b.index || a.key === b.key) continue; // exact duplicates have their own rule
        const later = a.index > b.index ? a : b;
        const earlier = later === a ? b : a;
        out.push({ field: `${later.group}.from`, lineIndex: later.index, vars: { other: earlier.index + 1, from: later.from, to: later.to } });
      }
    }
  }
  return out;
};

const catalogLookup: Evaluator = (ctx) => {
  const catalog = ctx.env.formCatalog;
  if (!catalog.length) return [];
  const line = ctx.target as RaafLine;
  if (isBlank(line.formName)) return [];
  const norm = normalizeName(line.formName);
  if (catalog.some((c) => normalizeName(c) === norm)) return [];
  const best = closestMatch(line.formName, catalog);
  const hint = best && best.score >= 0.7 ? `Did you mean "${best.match}"?` : "Pick a form from the catalog or ask an administrator to add it.";
  return [{ field: "formName", vars: { value: line.formName, hint } }];
};

const knownValue: Evaluator = (ctx) => {
  const v = getPath(ctx.report, str(cond(ctx).field, ctx.rule.fields[0] ?? ""));
  if (typeof v !== "string" || v.trim() === "") return [];
  const known = ctx.env.knownEntities;
  if (!known.length || known.includes(v)) return [];
  const best = closestMatch(v, known);
  if (!best || best.score < 0.8) return [];
  return [{ field: ctx.rule.fields[0] ?? "", vars: { value: v, match: best.match } }];
};

const minLines: Evaluator = ({ rule, report }) => {
  const min = toNum(rule.condition.min) ?? 1;
  return activeLines(report).length >= min ? [] : [{ field: "lines", vars: { min } }];
};

const blankLine: Evaluator = ({ target }) => (isBlankLine(target as RaafLine) ? [{ field: "formName" }] : []);

const duplicateReport: Evaluator = ({ env }) =>
  env.otherReports.length ? [{ field: "header.period", vars: { ref: env.otherReports.map((r) => r.refNo).join(", ") } }] : [];

const previousMissing: Evaluator = ({ env }) =>
  !env.previousReport && env.hasEarlierReports ? [{ field: "header.period" }] : [];

const rangeKey = (l: RaafLine, g: GroupName) => {
  const s = normalizeSerial(l[g]);
  return `${normalizeName(l.formName)}|${s.qty}|${s.from}|${s.to}`;
};

const previousEndingLines = (env: ValidationEnv) =>
  env.previousReport ? env.previousReport.report.lines.filter((l) => !isBlankLine(l) && isUsableRange(l.ending)) : [];

/** Each beginning balance must be one of the previous month's ending balances. */
const previousCarryover: Evaluator = ({ report, env }) => {
  if (!env.previousReport) return [];
  const prevKeys = new Set(previousEndingLines(env).map((l) => rangeKey(l, "ending")));
  const out: Finding[] = [];
  for (const { line, index } of activeLines(report)) {
    if (!isUsableRange(line.beginning) || prevKeys.has(rangeKey(line, "beginning"))) continue;
    const s = normalizeSerial(line.beginning);
    out.push({ field: "beginning.qty", lineIndex: index, vars: { from: s.from!, to: s.to!, prevRef: env.previousReport.refNo } });
  }
  return out;
};

/** Each of the previous month's ending balances must show up as a beginning balance. */
const previousUncarried: Evaluator = ({ report, env }) => {
  if (!env.previousReport) return [];
  const begKeys = new Set(activeLines(report).filter(({ line }) => isUsableRange(line.beginning)).map(({ line }) => rangeKey(line, "beginning")));
  return previousEndingLines(env)
    .filter((l) => !begKeys.has(rangeKey(l, "ending")))
    .map((l) => {
      const s = normalizeSerial(l.ending);
      return { field: "header.period", vars: { prevForm: l.formName, from: s.from!, to: s.to!, prevRef: env.previousReport!.refNo } };
    });
};

export const EVALUATORS: Record<string, Evaluator> = {
  required,
  any_present: anyPresent,
  date_format: dateFormat,
  date_bounds: dateBounds,
  chronological,
  text_format: textFormat,
  number,
  serial_group: serialGroup,
  equation,
  sum_equals: sumEquals,
  serial_continuity: serialContinuity,
  duplicate_lines: duplicateLines,
  serial_overlap: serialOverlap,
  catalog_lookup: catalogLookup,
  known_value: knownValue,
  min_lines: minLines,
  blank_line: blankLine,
  duplicate_report: duplicateReport,
  previous_missing: previousMissing,
  previous_carryover: previousCarryover,
  previous_uncarried: previousUncarried,
};

export const RULE_TYPES = Object.keys(EVALUATORS);
