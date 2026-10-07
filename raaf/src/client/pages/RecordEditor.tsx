import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { RecordDetail, RecordSummary } from "../../shared/api";
import { fieldLabel } from "../../shared/fieldLabels";
import type { RaafHeader, RaafLine, RaafReport, RaafTotals, RuleDef, Section, ValidationIssue } from "../../shared/types";
import { emptyEnv, validateReport } from "../../shared/validation/engine";
import { carryForward, emptyLine, isBlankLine, nextPeriod, periodLabel, previousPeriod, sectionOf } from "../../shared/validation/helpers";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { CATALOG_LIST_ID, LineGrid, parseWhole, setLineField } from "../components/LineGrid";
import { IssuesPanel, type PanelIssue } from "../components/IssuesPanel";
import { Alert, Loading, ValidationBadge, WorkflowBadge, errorText } from "../components/ui";

const SECTIONS: { id: Section; title: string }[] = [
  { id: "header", title: "1. Report details" },
  { id: "lines", title: "2. Accountable forms" },
  { id: "totals", title: "3. Control totals" },
  { id: "certification", title: "4. Certification" },
];

/** Rule types that only make sense once the user has finished typing, so they stay quiet until Validate is run. */
const QUIET_UNTIL_VALIDATED = new Set(["required", "any_present", "min_lines", "blank_line"]);
const CROSS_RECORD = new Set(["duplicate_report", "previous_carryover", "previous_uncarried", "previous_missing", "known_value"]);

const todayLocal = () => new Date().toLocaleDateString("en-CA");

function blankReport(settings: Record<string, string>): RaafReport {
  const today = new Date();
  const prev = previousPeriod(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`) ?? "";
  return {
    header: {
      entityName: settings.defaultEntityName ?? "", fundCluster: settings.defaultFundCluster ?? "", period: prev, certificationDate: "",
      preparedByName: settings.defaultPreparedByName ?? "", preparedByTitle: settings.defaultPreparedByTitle ?? "",
      checkedByName: settings.defaultCheckedByName ?? "", checkedByTitle: settings.defaultCheckedByTitle ?? "",
      attestedByName: settings.defaultAttestedByName ?? "", attestedByTitle: settings.defaultAttestedByTitle ?? "",
      notedByName: settings.defaultNotedByName ?? "", notedByTitle: settings.defaultNotedByTitle ?? "",
    },
    totals: { lineCount: null, beginningQty: null, receiptQty: null, issueQty: null, endingQty: null },
    lines: [emptyLine()],
  };
}

const computeTotals = (lines: RaafLine[]): RaafTotals => {
  const active = lines.filter((l) => !isBlankLine(l));
  const sum = (pick: (l: RaafLine) => number | null) => active.reduce((a, l) => a + (pick(l) ?? 0), 0);
  return { lineCount: active.length, beginningQty: sum((l) => l.beginning.qty), receiptQty: sum((l) => l.receipt.qty), issueQty: sum((l) => l.issue.qty), endingQty: sum((l) => l.ending.qty) };
};

export function RecordEditorPage() {
  const { id } = useParams();
  const isNew = id === undefined;
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { can } = useAuth();

  const [detail, setDetail] = useState<RecordDetail | null>(null);
  const [report, setReport] = useState<RaafReport | null>(null);
  const [rules, setRules] = useState<RuleDef[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [previous, setPrevious] = useState<RecordSummary[]>([]);
  const [section, setSection] = useState<Section>("header");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "validate" | "submit">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflictState, setConflictState] = useState(false);
  const [validatedOnce, setValidatedOnce] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [find, setFind] = useState("");
  const [focusTarget, setFocusTarget] = useState<{ path: string; n: number } | null>(null);
  const idemKey = useRef(crypto.randomUUID());
  const version = detail?.version ?? 0;

  /* ----- load ----- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [r, f] = await Promise.all([api.rules(), api.forms()]);
        if (cancelled) return;
        setRules(r);
        setCatalog(f);
        if (isNew) {
          const [settings, recent] = await Promise.all([api.settings(), api.records({ pageSize: 100, sort: "period", dir: "desc" })]);
          if (cancelled) return;
          setReport(blankReport(settings));
          setPrevious(recent.items.filter((x) => x.workflowStatus !== "VOID"));
        } else {
          const d = await api.record(id);
          if (cancelled) return;
          setDetail(d);
          setReport(d.report);
          setValidatedOnce(d.validation !== null);
          const focus = search.get("focus");
          if (focus) {
            setSection(focus === "lines" ? "lines" : sectionOf(focus));
            setFocusTarget({ path: focus, n: Date.now() });
          }
        }
      } catch (e) {
        if (!cancelled) setError(errorText(e));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ----- unsaved-changes guard ----- */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /* ----- editing ----- */
  const edit = useCallback((fn: (r: RaafReport) => RaafReport) => {
    setReport((r) => (r ? fn(r) : r));
    setDirty(true);
    setNotice("");
  }, []);
  const setHeader = (key: keyof RaafHeader, value: string) => edit((r) => ({ ...r, header: { ...r.header, [key]: value } }));
  const setTotal = (key: keyof RaafTotals, value: number | null) => edit((r) => ({ ...r, totals: { ...r.totals, [key]: value } }));
  const changeLine = useCallback((i: number, path: string, value: string | number | null) =>
    edit((r) => ({ ...r, lines: r.lines.map((l, n) => (n === i ? setLineField(l, path, value) : l)) })), [edit]);
  const addLine = () => edit((r) => ({ ...r, lines: [...r.lines, emptyLine()] }));
  const removeLine = useCallback((i: number) => edit((r) => ({ ...r, lines: r.lines.filter((_, n) => n !== i) })), [edit]);
  const duplicateLine = useCallback((i: number) => edit((r) => ({ ...r, lines: [...r.lines.slice(0, i + 1), structuredClone(r.lines[i]!), ...r.lines.slice(i + 1)] })), [edit]);

  /* ----- live validation: the same engine the server runs; cross-record rules need server data and run on Validate ----- */
  const live = useMemo(() => (report ? validateReport(report, rules, { ...emptyEnv(todayLocal()), formCatalog: catalog }) : null), [report, rules, catalog]);
  const ruleType = useMemo(() => new Map(rules.map((r) => [r.id, r.type])), [rules]);

  const issues: PanelIssue[] = useMemo(() => {
    const shown: ValidationIssue[] = (live?.issues ?? []).filter((i) => validatedOnce || !QUIET_UNTIL_VALIDATED.has(ruleType.get(i.ruleId) ?? ""));
    const fromServer = detail?.validation && !detail.validation.stale && !dirty ? detail.validation.issues : [];
    const seen = new Set(shown.map((i) => `${i.ruleId}|${i.fieldPath}|${i.message}`));
    const merged = [...shown, ...fromServer.filter((i) => !seen.has(`${i.ruleId}|${i.fieldPath}|${i.message}`))];
    return merged.map((i) => ({ ...i, crossRecord: CROSS_RECORD.has(ruleType.get(i.ruleId) ?? "") }));
  }, [live, detail, dirty, validatedOnce, ruleType]);

  const byPath = useMemo(() => {
    const m = new Map<string, ValidationIssue[]>();
    for (const i of issues) m.set(i.fieldPath, [...(m.get(i.fieldPath) ?? []), i]);
    return m;
  }, [issues]);
  const sectionCounts = useMemo(() => {
    const c: Record<Section, number> = { header: 0, lines: 0, totals: 0, certification: 0 };
    for (const i of issues) c[i.section]++;
    return c;
  }, [issues]);

  /* ----- navigate to a field from an issue ----- */
  const go = useCallback((path: string) => {
    setSection(path === "lines" ? "lines" : sectionOf(path));
    if (path.startsWith("lines")) { setOnlyIssues(false); setFind(""); }
    setFocusTarget({ path, n: Date.now() });
  }, []);
  useEffect(() => {
    if (!focusTarget || !report) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-field="${focusTarget.path}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "auto" });
      el.focus({ preventScroll: true });
      el.classList.add("flash");
      window.setTimeout(() => el.classList.remove("flash"), 1800);
    }, 60);
    return () => window.clearTimeout(t);
  }, [focusTarget, report, section]);

  /* ----- actions ----- */
  const save = useCallback(async (): Promise<RecordDetail | null> => {
    if (!report) return null;
    setBusy("save");
    setError("");
    try {
      let d: RecordDetail;
      if (isNew) {
        d = await api.createRecord(idemKey.current, report);
        setDirty(false);
        navigate(`/records/${d.id}/edit`, { replace: true });
      } else {
        d = await api.saveRecord(id!, version, report);
        setDetail(d);
        setDirty(false);
        setNotice(`Saved at ${new Date().toLocaleTimeString()}`);
      }
      setDetail(d);
      return d;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflictState(true);
      setError(errorText(e));
      return null;
    } finally {
      setBusy("");
    }
  }, [report, isNew, id, version, navigate]);

  const validate = async () => {
    if (!report) return;
    setValidatedOnce(true);
    let current = detail;
    if (dirty || isNew) {
      current = await save();
      if (!current) return;
    }
    setBusy("validate");
    setError("");
    try {
      const d = await api.validate(current!.id);
      setDetail(d);
      setReport(d.report);
      setNotice(d.validationStatus === "VALID" ? "Validation passed." : `Validation finished: ${d.validation?.run.errorCount} error(s), ${d.validation?.run.warningCount} warning(s).`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  };

  const submit = async () => {
    if (!detail) return;
    setBusy("submit");
    setError("");
    try {
      const d = await api.submit(detail.id);
      navigate(`/records/${d.id}`);
    } catch (e) {
      setValidatedOnce(true);
      setError(errorText(e));
      try { setDetail(await api.record(detail.id)); } catch { /* the original error is the useful one */ }
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (dirty && !busy) void save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, busy, save]);

  const loadPrevious = async (prevId: string) => {
    if (!prevId || !report) return;
    if (report.lines.some((l) => !isBlankLine(l)) && !window.confirm("Replace the lines already entered with the previous report's ending balances?")) return;
    try {
      const prev = await api.record(prevId);
      edit((r) => ({
        ...r,
        header: {
          ...r.header,
          entityName: r.header.entityName || prev.report.header.entityName,
          period: nextPeriod(prev.report.header.period) ?? r.header.period,
        },
        lines: carryForward(prev.report.lines),
      }));
      setNotice(`Beginning balances loaded from ${prev.refNo}. Now enter this month's receipts and issues.`);
    } catch (e) {
      setError(errorText(e));
    }
  };

  /* ----- render ----- */
  if (isNew && !can("record:create")) return <Alert>You do not have permission to create records.</Alert>;
  if (error && !report) return <Alert>{error}</Alert>;
  if (!report || !live) return <Loading />;
  if (detail && !detail.actions.edit) {
    return (
      <div>
        <Alert kind="warning">This record cannot be edited ({detail.workflowStatus === "APPROVED" ? "it is approved; ask a reviewer to return it first" : detail.workflowStatus === "VOID" ? "it is void" : "you do not have permission"}).</Alert>
        <Link to={`/records/${detail.id}`}>← Back to the record</Link>
      </div>
    );
  }

  const fp = (path: string) => {
    const fi = byPath.get(path) ?? [];
    return {
      id: path,
      "data-field": path,
      "aria-invalid": fi.some((i) => i.severity === "ERROR") || undefined,
      "aria-describedby": fi.length ? `${path}-issues` : undefined,
      className: fi.some((i) => i.severity === "ERROR") ? "error" : fi.length ? "warning" : "",
    };
  };
  // Plain render functions, not components: components declared inside render would remount (and lose focus) on every keystroke.
  const issuesList = (path: string) => {
    const fi = byPath.get(path);
    if (!fi?.length) return null;
    return <ul className="field-issues" id={`${path}-issues`}>{fi.map((i, n) => <li key={n} className={i.severity === "ERROR" ? "error" : "warning"}><span aria-hidden="true">{i.severity === "ERROR" ? "❌" : "⚠️"}</span> {i.message}</li>)}</ul>;
  };
  const row = (path: string, children: ReactNode) => (
    <div className="field" key={path}>
      <label htmlFor={path}>{fieldLabel(path)}</label>
      {children}
      {issuesList(path)}
    </div>
  );
  const text = (key: keyof RaafHeader & string, extra: Record<string, unknown> = {}) =>
    row(`header.${key}`, <input {...fp(`header.${key}`)} type="text" value={report.header[key]} maxLength={200} onChange={(e) => setHeader(key, e.target.value)} {...extra} />);
  const sums = computeTotals(report.lines);
  const totalField = (key: keyof RaafTotals, computed: number) =>
    row(`totals.${key}`, (
      <div className="total-input">
        <input {...fp(`totals.${key}`)} inputMode="numeric" value={report.totals[key] ?? ""} onChange={(e) => setTotal(key, parseWhole(e.target.value))} />
        <span className={`computed ${report.totals[key] === null ? "" : report.totals[key] === computed ? "ok" : "bad"}`} title="Sum of the lines">
          lines: <b>{computed}</b> {report.totals[key] === null ? "" : report.totals[key] === computed ? "✓" : "≠"}
        </span>
      </div>
    ));

  const idx = SECTIONS.findIndex((s) => s.id === section);
  const status = detail?.validationStatus ?? "PENDING";

  return (
    <div className="editor">
      <div className="page-head">
        <div>
          <h1>{isNew ? "New RAAF" : <>Encode {detail?.refNo}</>}</h1>
          {!isNew && detail && <p className="muted">{detail.entityName} · {periodLabel(detail.period)}</p>}
        </div>
        <div className="head-badges">
          {detail && <><ValidationBadge status={status} stale={detail.validation?.stale || dirty} /> <WorkflowBadge status={detail.workflowStatus} /></>}
          {dirty && <span className="badge warning">Unsaved changes</span>}
        </div>
      </div>

      <div className="actionbar">
        <button className="btn primary" onClick={() => void save()} disabled={!!busy || (!dirty && !isNew)}>{busy === "save" ? "Saving…" : "Save draft"}</button>
        <button className="btn" onClick={() => void validate()} disabled={!!busy}>{busy === "validate" ? "Validating…" : "Run validation"}</button>
        {detail?.actions.submit && <button className="btn" onClick={() => void submit()} disabled={!!busy || dirty}>Submit for review</button>}
        {detail && <Link className="btn ghost" to={`/records/${detail.id}`}>View record</Link>}
        <span className="muted hint">Ctrl+S saves. Drafts can be incomplete.</span>
      </div>

      {error && <Alert>{error} {conflictState && <button className="btn small" onClick={() => window.location.reload()}>Reload latest</button>}</Alert>}
      {notice && !error && <Alert kind="success">{notice}</Alert>}
      {detail?.reviewNote && detail.workflowStatus === "DRAFT" && <Alert kind="warning"><b>Returned by {detail.reviewedByName}:</b> {detail.reviewNote}</Alert>}

      <div className="editor-grid">
        <div className="editor-main">
          <nav className="steps" aria-label="Form sections">
            {SECTIONS.map((s) => (
              <button key={s.id} className={s.id === section ? "active" : ""} aria-current={s.id === section ? "step" : undefined} onClick={() => setSection(s.id)}>
                {s.title}
                {sectionCounts[s.id] > 0 && <span className={`count ${issues.some((i) => i.section === s.id && i.severity === "ERROR") ? "error" : "warning"}`}>{sectionCounts[s.id]}</span>}
              </button>
            ))}
          </nav>

          <datalist id={CATALOG_LIST_ID}>{catalog.map((c) => <option key={c} value={c} />)}</datalist>

          <section className="card" hidden={section !== "header"} aria-label="Report details">
            <h2>Report details</h2>
            <div className="form-grid">
              {text("entityName", { autoComplete: "off" })}
              {text("fundCluster")}
              {row("header.period", <input {...fp("header.period")} type="month" value={report.header.period} onChange={(e) => setHeader("period", e.target.value)} />)}
            </div>
            {isNew && previous.length > 0 && (
              <div className="field carry">
                <label htmlFor="carry">Start from a previous report (loads its ending balances as this month's beginning balances)</label>
                <select id="carry" defaultValue="" onChange={(e) => void loadPrevious(e.target.value)}>
                  <option value="">— none —</option>
                  {previous.map((p) => <option key={p.id} value={p.id}>{p.refNo} · {p.entityName} · {periodLabel(p.period)}</option>)}
                </select>
              </div>
            )}
          </section>

          <section className="card" hidden={section !== "lines"} aria-label="Accountable forms">
            <div className="section-head">
              <h2>Accountable forms</h2>
              <div className="toolbar">
                <label className="inline"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Only lines with issues</label>
                <input type="search" placeholder="Find a form…" aria-label="Find a form" value={find} onChange={(e) => setFind(e.target.value)} />
              </div>
            </div>
            {issuesList("lines")}
            <LineGrid lines={report.lines} issues={issues.filter((i) => i.section === "lines")} onChange={changeLine} onAdd={addLine} onRemove={removeLine} onDuplicate={duplicateLine} onlyIssues={onlyIssues} find={find} />
          </section>

          <section className="card" hidden={section !== "totals"} aria-label="Control totals">
            <div className="section-head">
              <h2>Control totals</h2>
              <button className="btn small" onClick={() => edit((r) => ({ ...r, totals: computeTotals(r.lines) }))}>Fill from lines</button>
            </div>
            <p className="muted">Enter the totals from your source documents. They are checked against the lines and against each other, so use “Fill from lines” only after you have verified the lines.</p>
            <div className="form-grid">
              {totalField("lineCount", sums.lineCount!)}
              {totalField("beginningQty", sums.beginningQty!)}
              {totalField("receiptQty", sums.receiptQty!)}
              {totalField("issueQty", sums.issueQty!)}
              {totalField("endingQty", sums.endingQty!)}
            </div>
          </section>

          <section className="card" hidden={section !== "certification"} aria-label="Certification">
            <h2>Certification and signatories</h2>
            <p className="muted">“I hereby certify that the foregoing is a true statement of all accountable forms received, issued and transferred by me during the period above-stated and that the beginning and ending balances are correct.”</p>
            <div className="form-grid">
              {row("header.certificationDate", <input {...fp("header.certificationDate")} type="date" max={todayLocal()} value={report.header.certificationDate} onChange={(e) => setHeader("certificationDate", e.target.value)} />)}
            </div>
            <div className="form-grid sign">
              {text("preparedByName")}{text("preparedByTitle")}
              {text("checkedByName")}{text("checkedByTitle")}
              {text("attestedByName")}{text("attestedByTitle")}
              {text("notedByName")}{text("notedByTitle")}
            </div>
          </section>

          <div className="step-nav">
            <button className="btn" disabled={idx === 0} onClick={() => setSection(SECTIONS[idx - 1]!.id)}>‹ Previous section</button>
            <button className="btn" disabled={idx === SECTIONS.length - 1} onClick={() => setSection(SECTIONS[idx + 1]!.id)}>Next section ›</button>
          </div>
        </div>

        <IssuesPanel
          issues={issues}
          onGo={go}
          header={<p className="muted small">Checked live as you type. “Run validation” also checks duplicates and last month’s balances on the server.</p>}
          footer={detail?.validation?.stale || dirty ? <p className="muted small">Server results are out of date. Save and run validation to refresh them.</p> : undefined}
        />
      </div>
    </div>
  );
}
