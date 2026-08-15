/**
 * Next.js "output: standalone" cannot use `next start`.
 * Copy static assets next to server.js and run it (Render sets PORT).
 */
import { cpSync, existsSync } from "fs";
import { spawn } from "child_process";
import path from "path";

const candidates = [
  path.join(".next", "standalone"),
  path.join(".next", "standalone", "recall-agent"),
];
const standalone = candidates.find((dir) =>
  existsSync(path.join(dir, "server.js")),
);
if (!standalone) {
  console.error("standalone server.js not found; run npm run build first");
  process.exit(1);
}

const staticSrc = path.join(".next", "static");
const staticDest = path.join(standalone, ".next", "static");
if (existsSync(staticSrc)) {
  cpSync(staticSrc, staticDest, { recursive: true });
}
if (existsSync("public")) {
  cpSync("public", path.join(standalone, "public"), { recursive: true });
}

const child = spawn(process.execPath, ["server.js"], {
  cwd: standalone,
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
