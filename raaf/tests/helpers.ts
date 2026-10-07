import { DEFAULT_RULES } from "../src/shared/validation/defaultRules";
import { emptyEnv, validateReport } from "../src/shared/validation/engine";
import { DEMO_RECORDS } from "../src/shared/demoData";
import { FORM_CATALOG } from "../src/shared/formCatalog";
import type { RaafReport, ValidationEnv } from "../src/shared/types";

export const TODAY = "2026-03-15";

export const validReport = (): RaafReport => structuredClone(DEMO_RECORDS.find((r) => r.key === "valid")!.report);
export const demoReport = (key: string): RaafReport => structuredClone(DEMO_RECORDS.find((r) => r.key === key)!.report);

export const env = (over: Partial<ValidationEnv> = {}): ValidationEnv => ({ ...emptyEnv(TODAY), formCatalog: FORM_CATALOG, ...over });

export const run = (report: RaafReport, e: ValidationEnv = env()) => validateReport(report, DEFAULT_RULES, e);

export const ids = (r: ReturnType<typeof run>) => r.issues.map((i) => i.ruleId);
