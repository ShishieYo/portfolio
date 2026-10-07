import { memo, useCallback, useMemo, useState } from "react";
import type { GroupName, RaafLine, ValidationIssue } from "../../shared/types";
import { GROUPS } from "../../shared/types";
import { normalizeName } from "../../shared/validation/helpers";

export const CATALOG_LIST_ID = "form-catalog";
const KEYS = ["qty", "from", "to"] as const;
const COLS = 4 + GROUPS.length * 3 + 2;
const GROUP_TITLE: Record<GroupName, string> = { beginning: "Beginning balance", receipt: "Receipt", issue: "Issue", ending: "Ending balance" };

/** Digits only; blank means "not entered" (null). */
export const parseWhole = (raw: string): number | null => {
  const digits = raw.replace(/\D/g, "").slice(0, 12);
  return digits === "" ? null : Number(digits);
};

export function parseDecimal(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const [whole = "", ...rest] = cleaned.split(".");
  const value = rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
  return value === "" || value === "." ? null : Number(value);
}

export function setLineField(line: RaafLine, path: string, value: string | number | null): RaafLine {
  const [a, b] = path.split(".") as [keyof RaafLine, string | undefined];
  if (!b) return { ...line, [a]: value };
  return { ...line, [a]: { ...(line[a] as object), [b]: value } };
}

const worst = (issues: ValidationIssue[]): "error" | "warning" | "" =>
  issues.some((i) => i.severity === "ERROR") ? "error" : issues.length ? "warning" : "";

interface RowProps {
  line: RaafLine;
  index: number;
  issues: ValidationIssue[];
  issueKey: string;
  hidden: boolean;
  onChange: (index: number, path: string, value: string | number | null) => void;
  onRemove: (index: number) => void;
  onDuplicate: (index: number) => void;
}

function moveFocus(e: React.KeyboardEvent<HTMLInputElement>, index: number, path: string) {
  const delta = e.key === "Enter" ? (e.shiftKey ? -1 : 1) : e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
  if (!delta) return;
  const next = document.querySelector<HTMLInputElement>(`[data-field="lines.${index + delta}.${path}"]`);
  if (next) {
    e.preventDefault();
    next.focus();
    next.select();
  }
}

const LineRow = memo(function LineRow({ line, index, issues, hidden, onChange, onRemove, onDuplicate }: RowProps) {
  const byField = new Map<string, ValidationIssue[]>();
  for (const i of issues) byField.set(i.fieldPath, [...(byField.get(i.fieldPath) ?? []), i]);
  const fieldProps = (path: string) => {
    const fi = byField.get(`lines.${index}.${path}`) ?? [];
    return {
      "data-field": `lines.${index}.${path}`,
      className: worst(fi),
      "aria-invalid": fi.some((i) => i.severity === "ERROR") || undefined,
      title: fi.map((i) => i.message).join("\n") || undefined,
    };
  };
  const num = (path: string, label: string, parse = parseWhole) => {
    const [g, k] = path.split(".") as [GroupName, string];
    const value: number | null = (path.includes(".") ? (line[g] as unknown as Record<string, number | null>)[k] : line[path as "faceValue"]) ?? null;
    return (
      <input
        {...fieldProps(path)}
        inputMode={parse === parseWhole ? "numeric" : "decimal"}
        aria-label={`Line ${index + 1} ${label}`}
        value={value ?? ""}
        onChange={(e) => onChange(index, path, parse(e.target.value))}
        onKeyDown={(e) => moveFocus(e, index, path)}
        onFocus={(e) => e.target.select()}
        onBlur={() => {
          // Save typing: when From and To are known and the quantity is blank, fill it in.
          if (k === "to" && line[g].qty === null && line[g].from !== null && value !== null && value >= line[g].from!) {
            onChange(index, `${g}.qty`, value - line[g].from! + 1);
          }
        }}
      />
    );
  };

  return (
    <>
      <tr className={`line ${worst(issues)}`} hidden={hidden}>
        <th scope="row" className="ln">{index + 1}</th>
        <td className="c-name">
          <input
            {...fieldProps("formName")}
            list={CATALOG_LIST_ID}
            aria-label={`Line ${index + 1} name of form`}
            value={line.formName}
            onChange={(e) => onChange(index, "formName", e.target.value.toUpperCase())}
            onBlur={(e) => onChange(index, "formName", normalizeName(e.target.value))}
            autoComplete="off"
          />
        </td>
        <td className="c-sm"><input {...fieldProps("formNumber")} aria-label={`Line ${index + 1} form number`} value={line.formNumber} maxLength={50} onChange={(e) => onChange(index, "formNumber", e.target.value)} /></td>
        <td className="c-sm">{num("faceValue", "face value", parseDecimal)}</td>
        {GROUPS.flatMap((g) => KEYS.map((k) => <td key={`${g}${k}`} className={k === "qty" ? "grp-start" : ""}>{num(`${g}.${k}`, `${GROUP_TITLE[g]} ${k === "qty" ? "quantity" : k}`)}</td>))}
        <td className="c-rem"><input {...fieldProps("remarks")} aria-label={`Line ${index + 1} remarks`} value={line.remarks} maxLength={500} onChange={(e) => onChange(index, "remarks", e.target.value)} onKeyDown={(e) => moveFocus(e, index, "remarks")} /></td>
        <td className="row-actions">
          <button type="button" className="icon-btn" title="Duplicate line" aria-label={`Duplicate line ${index + 1}`} onClick={() => onDuplicate(index)}>⧉</button>
          <button type="button" className="icon-btn" title="Remove line" aria-label={`Remove line ${index + 1}`} onClick={() => onRemove(index)}>✕</button>
        </td>
      </tr>
      {issues.length > 0 && (
        <tr className="line-issues" hidden={hidden}>
          <td />
          <td colSpan={COLS - 1}>
            <ul>{issues.map((i, n) => <li key={n} className={i.severity === "ERROR" ? "error" : "warning"}><span aria-hidden="true">{i.severity === "ERROR" ? "❌" : "⚠️"}</span> {i.message}</li>)}</ul>
          </td>
        </tr>
      )}
    </>
  );
}, (a, b) => a.line === b.line && a.issueKey === b.issueKey && a.hidden === b.hidden && a.index === b.index && a.onChange === b.onChange);

export function LineGrid({ lines, issues, onChange, onAdd, onRemove, onDuplicate, onlyIssues, find }: {
  lines: RaafLine[];
  issues: ValidationIssue[];
  onChange: RowProps["onChange"];
  onAdd: () => void;
  onRemove: RowProps["onRemove"];
  onDuplicate: RowProps["onDuplicate"];
  onlyIssues: boolean;
  find: string;
}) {
  const byLine = useMemo(() => {
    const m = new Map<number, ValidationIssue[]>();
    for (const i of issues) if (i.lineNo !== null) m.set(i.lineNo - 1, [...(m.get(i.lineNo - 1) ?? []), i]);
    return m;
  }, [issues]);
  const needle = normalizeName(find);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const remove = useCallback((i: number) => setConfirmIdx(i), []);

  return (
    <div className="table-wrap lines-wrap">
      <table className="lines">
        <thead>
          <tr>
            <th rowSpan={2}>#</th><th rowSpan={2} className="c-name">Name of form</th><th rowSpan={2}>Number</th><th rowSpan={2}>Face value</th>
            {GROUPS.map((g) => <th key={g} colSpan={3} className="grp-start">{GROUP_TITLE[g]}</th>)}
            <th rowSpan={2}>Remarks</th><th rowSpan={2}><span className="sr-only">Actions</span></th>
          </tr>
          <tr>{GROUPS.flatMap((g) => ["Qty", "From", "To"].map((k) => <th key={`${g}${k}`} className={k === "Qty" ? "grp-start" : ""}>{k}</th>))}</tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const li = byLine.get(i) ?? [];
            const hidden = (onlyIssues && li.length === 0) || (needle !== "" && !normalizeName(line.formName).includes(needle));
            return (
              <LineRow key={i} line={line} index={i} issues={li} issueKey={li.map((x) => x.ruleId + x.message).join("|")} hidden={hidden}
                onChange={onChange} onRemove={remove} onDuplicate={onDuplicate} />
            );
          })}
          {lines.length === 0 && <tr><td colSpan={COLS} className="muted center">No lines yet.</td></tr>}
        </tbody>
      </table>
      <div className="grid-foot">
        <button type="button" className="btn" data-field="lines" onClick={onAdd}>+ Add line</button>
        <span className="muted">Tip: Enter / ↑ ↓ move to the same column on the next / previous line.</span>
      </div>
      {confirmIdx !== null && (
        <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && setConfirmIdx(null)}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="rm-title">
            <h2 id="rm-title">Remove line {confirmIdx + 1}?</h2>
            <p>{lines[confirmIdx]?.formName || "(no form name)"} will be removed from this report when you save.</p>
            <div className="modal-actions">
              <button className="btn" autoFocus onClick={() => setConfirmIdx(null)}>Keep line</button>
              <button className="btn danger" onClick={() => { onRemove(confirmIdx); setConfirmIdx(null); }}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
