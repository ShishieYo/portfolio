import { createApp } from "./app";
import { loadConfig } from "./config";
import { openDb } from "./db";
import { DEMO_PASSWORD, seedDatabase } from "./seed";
import { todayIn } from "./validation";

const config = loadConfig();
const db = openDb(config.databasePath);
seedDatabase(db, { demo: config.seedDemoData, adminUsername: config.adminUsername, adminPassword: config.adminPassword, today: todayIn(config.timezone) });

if (config.seedDemoData && config.production) {
  console.warn(`WARNING: demo accounts (password "${DEMO_PASSWORD}") exist on this deployment. Set SEED_DEMO_DATA=false and ADMIN_PASSWORD for real use.`);
}

const app = createApp(db, {
  sessionTtlHours: config.sessionTtlHours,
  secureCookies: config.production,
  timezone: config.timezone,
  clientDir: config.clientDir,
});

const server = app.listen(config.port, () => console.log(`RAAF Online listening on http://localhost:${config.port}`));

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
