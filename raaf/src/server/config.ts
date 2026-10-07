import { resolve } from "node:path";

export interface ServerConfig {
  port: number;
  production: boolean;
  databasePath: string;
  sessionTtlHours: number;
  timezone: string;
  seedDemoData: boolean;
  adminUsername: string;
  adminPassword: string;
  clientDir?: string;
}

/** Read configuration from the environment (and an optional local .env file). Throws on bad values. */
export function loadConfig(): ServerConfig {
  try {
    process.loadEnvFile(".env");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const env = process.env;
  const production = env.NODE_ENV === "production";
  const int = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
    return n;
  };
  return {
    port: int("PORT", 3000),
    production,
    databasePath: env.DATABASE_PATH || "./data/raaf.db",
    sessionTtlHours: int("SESSION_TTL_HOURS", 12),
    timezone: env.APP_TIMEZONE || "Asia/Manila",
    seedDemoData: env.SEED_DEMO_DATA ? env.SEED_DEMO_DATA === "true" : !production,
    adminUsername: env.ADMIN_USERNAME || "admin",
    adminPassword: env.ADMIN_PASSWORD ?? "",
    clientDir: production ? resolve(import.meta.dirname, "client") : undefined,
  };
}
