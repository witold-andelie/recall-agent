/**
 * Local multi-instance without Docker: N `next start` + round-robin on :3000.
 * Usage (after npm run build):
 *   node scripts/multi-instance.mjs
 *   INSTANCES=3 node scripts/multi-instance.mjs
 */
import http from "http";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const n = Math.min(8, Math.max(2, Number(process.env.INSTANCES || 3)));
const publicPort = Number(process.env.PORT || 3000);
const basePort = Number(process.env.WORKER_BASE_PORT || 3001);
const poolMax = process.env.DATABASE_POOL_MAX || "16";
const inflight = process.env.CHAT_MAX_INFLIGHT || "24";

const kids = [];
for (let i = 0; i < n; i++) {
  const port = basePort + i;
  const child = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["next", "start", "-p", String(port)],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        INSTANCE_ID: String.fromCharCode(97 + i),
        DATABASE_POOL_MAX: poolMax,
        CHAT_MAX_INFLIGHT: inflight,
        PORT: String(port),
      },
    },
  );
  child.on("exit", (code) => {
    console.error(`worker :${port} exited ${code}`);
  });
  kids.push(child);
}

let rr = 0;
const server = http.createServer((req, res) => {
  const port = basePort + (rr++ % n);
  const p = http.request(
    {
      hostname: "127.0.0.1",
      port,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (pr) => {
      res.writeHead(pr.statusCode || 502, pr.headers);
      pr.pipe(res);
    },
  );
  p.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: "upstream", message: err.message }));
  });
  req.pipe(p);
});

server.listen(publicPort, () => {
  console.log(
    `recall lb :${publicPort} → ${n} workers :${basePort}–:${basePort + n - 1} (pool=${poolMax} inflight=${inflight})`,
  );
});

function shutdown() {
  server.close();
  for (const k of kids) k.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
