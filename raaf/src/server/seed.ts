import { randomUUID } from "node:crypto";
import { DEMO_ENTITY, DEMO_RECORDS } from "../shared/demoData";
import { FORM_CATALOG } from "../shared/formCatalog";
import type { Role } from "../shared/types";
import type { AuthUser } from "./auth";
import { hashPassword } from "./auth";
import { logAudit } from "./audit";
import type { Db } from "./db";
import { nowIso, transaction } from "./db";
import { createRecord } from "./records";
import { seedRules } from "./rules";
import { runValidation } from "./validation";
import { approveRecord, submitRecord } from "./workflow";

/** Demo accounts are public (listed in the README). Only created when SEED_DEMO_DATA=true. */
export const DEMO_PASSWORD = "Demo@RAAF2025";
const DEMO_USERS: { username: string; displayName: string; role: Role }[] = [
  { username: "admin", displayName: "System Administrator", role: "admin" },
  { username: "encoder1", displayName: "Elena Encoder", role: "encoder" },
  { username: "encoder2", displayName: "Eddie Encoder", role: "encoder" },
  { username: "reviewer1", displayName: "Rina Reviewer", role: "reviewer" },
];

export interface SeedOptions {
  demo: boolean;
  adminUsername: string;
  adminPassword: string;
  today: string;
}

function insertUser(db: Db, username: string, displayName: string, role: Role, password: string): string {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, username, display_name, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)").run(
    id, username, displayName, hashPassword(password), role, nowIso(),
  );
  logAudit(db, { id: null, username: "system" }, { action: "user.create", entityType: "user", entityId: id, newValue: `${username} (${role})` });
  return id;
}

export function seedDatabase(db: Db, opts: SeedOptions): void {
  transaction(db, () => {
    seedRules(db);
    const addForm = db.prepare("INSERT OR IGNORE INTO form_catalog (name) VALUES (?)");
    FORM_CATALOG.forEach((n) => addForm.run(n));

    const noUsers = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n === 0;
    if (noUsers) {
      if (opts.demo) {
        for (const u of DEMO_USERS) insertUser(db, u.username, u.displayName, u.role, DEMO_PASSWORD);
      } else {
        if (opts.adminPassword.length < 12) throw new Error("ADMIN_PASSWORD (at least 12 characters) is required to create the first administrator when SEED_DEMO_DATA is not true");
        insertUser(db, opts.adminUsername, "Administrator", "admin", opts.adminPassword);
      }
    }
    if (opts.demo && noUsers) {
      db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultEntityName', ?), ('defaultPreparedByName', 'JUAN D. CRUZ'), ('defaultPreparedByTitle', 'COR Custodian')").run(DEMO_ENTITY);
    }
  });

  const recordCount = (db.prepare("SELECT COUNT(*) AS n FROM raaf_records").get() as { n: number }).n;
  if (!opts.demo || recordCount > 0) return;

  // Demo records go through the real services so their validation history, workflow and audit trail are genuine.
  const user = (username: string): AuthUser => {
    const r = db.prepare("SELECT id, username, display_name AS displayName, role FROM users WHERE username = ?").get(username) as AuthUser | undefined;
    if (!r) throw new Error(`Demo user ${username} is missing`);
    return r;
  };
  const reviewer = user("reviewer1");
  for (const demo of DEMO_RECORDS) {
    const creator = user(demo.creator);
    const { row } = createRecord(db, creator, structuredClone(demo.report), `seed-${demo.key}`);
    if (demo.stage === "validated") runValidation(db, creator, row.id, opts.today);
    else {
      submitRecord(db, creator, row.id, opts.today);
      if (demo.stage === "approved") approveRecord(db, reviewer, row.id, "", opts.today);
    }
  }
}
