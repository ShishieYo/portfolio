// Consistent snapshot of the SQLite database, safe to run while the app is serving requests.
// Usage: npm run backup [-- <output-dir>]     (DATABASE_PATH defaults to ./data/raaf.db)
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

try { process.loadEnvFile(".env"); } catch (e) { if (e.code !== "ENOENT") throw e; }
const source = resolve(process.env.DATABASE_PATH || "./data/raaf.db");
const dir = resolve(process.argv[2] || "./backups");
mkdirSync(dir, { recursive: true });
const target = join(dir, `raaf-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);

const db = new DatabaseSync(source, { readOnly: true });
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
console.log(`Backup written to ${target}`);
