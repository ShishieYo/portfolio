// Runs the API (auto-restarting) and the Vite dev server together; Ctrl+C stops both.
import { spawn } from "node:child_process";

const run = (name, args) => {
  const child = spawn("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
  child.on("exit", (code) => {
    console.log(`[${name}] exited with ${code}`);
    process.exit(code ?? 1);
  });
  return child;
};

const children = [run("api", ["tsx", "watch", "src/server/index.ts"]), run("web", ["vite"])];
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => children.forEach((c) => c.kill(sig)));
