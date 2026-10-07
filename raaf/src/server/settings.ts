import { SETTING_KEYS } from "./schema";
import type { Actor } from "./audit";
import { logAudit } from "./audit";
import type { Db } from "./db";
import { transaction } from "./db";

export type Settings = Record<(typeof SETTING_KEYS)[number], string>;

export function getSettings(db: Db): Settings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, map.get(k) ?? ""])) as Settings;
}

export function saveSettings(db: Db, actor: Actor, next: Settings): Settings {
  return transaction(db, () => {
    const before = getSettings(db);
    const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    for (const k of SETTING_KEYS) {
      if (before[k] === next[k]) continue;
      upsert.run(k, next[k]);
      logAudit(db, actor, { action: "setting.update", entityType: "setting", entityId: k, field: k, oldValue: before[k], newValue: next[k] });
    }
    return getSettings(db);
  });
}
