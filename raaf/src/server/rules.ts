import type { RuleDef } from "../shared/types";
import { DEFAULT_RULES } from "../shared/validation/defaultRules";
import { RULE_TYPES } from "../shared/validation/evaluators";
import type { Actor } from "./audit";
import { logAudit } from "./audit";
import type { Db } from "./db";
import { nowIso, transaction } from "./db";
import { badRequest, notFound } from "./errors";

type RuleRow = { id: string; name: string; scope: RuleDef["scope"]; type: string; fields: string; condition: string; severity: RuleDef["severity"]; message: string; resolution: string; enabled: number };

const toRule = (r: RuleRow): RuleDef => ({
  id: r.id, name: r.name, scope: r.scope, type: r.type, fields: JSON.parse(r.fields) as string[],
  condition: JSON.parse(r.condition) as Record<string, unknown>, severity: r.severity, message: r.message, resolution: r.resolution, enabled: r.enabled === 1,
});

export function loadRules(db: Db): RuleDef[] {
  return (db.prepare("SELECT * FROM validation_rules ORDER BY sort_order").all() as RuleRow[]).map(toRule);
}

/** Insert any default rule that is not in the table yet. Never overwrites an administrator's edits. */
export function seedRules(db: Db): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO validation_rules (id, name, scope, type, fields, condition, severity, message, resolution, enabled, sort_order, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = nowIso();
  DEFAULT_RULES.forEach((r, i) =>
    insert.run(r.id, r.name, r.scope, r.type, JSON.stringify(r.fields), JSON.stringify(r.condition), r.severity, r.message, r.resolution, r.enabled ? 1 : 0, i, now),
  );
}

export interface RuleEdit {
  severity: RuleDef["severity"];
  enabled: boolean;
  message: string;
  resolution: string;
  condition: Record<string, unknown>;
}

export function updateRule(db: Db, actor: Actor, id: string, edit: RuleEdit): RuleDef {
  return transaction(db, () => {
    const row = db.prepare("SELECT * FROM validation_rules WHERE id = ?").get(id) as RuleRow | undefined;
    if (!row) throw notFound("Rule not found");
    if (!RULE_TYPES.includes(row.type)) throw badRequest(`Rule ${id} has unknown type ${row.type}`);
    const before = toRule(row);
    db.prepare("UPDATE validation_rules SET severity = ?, enabled = ?, message = ?, resolution = ?, condition = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(
      edit.severity, edit.enabled ? 1 : 0, edit.message, edit.resolution, JSON.stringify(edit.condition), nowIso(), actor.id, id,
    );
    const after = { ...before, ...edit };
    for (const field of ["severity", "enabled", "message", "resolution", "condition"] as const) {
      if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
        logAudit(db, actor, { action: "rule.update", entityType: "rule", entityId: id, field, oldValue: before[field], newValue: after[field] });
      }
    }
    return after;
  });
}
