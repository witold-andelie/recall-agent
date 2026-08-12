/**
 * Cookie-aware two-turn chat smoke test against local dev server.
 */
const base = process.env.BASE_URL || "http://localhost:3000";

async function chat(message, cookie, threadId) {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ message, threadId }),
  });

  const setCookie = res.headers.getSetCookie?.() || [];
  // Node fetch may expose raw set-cookie differently
  const raw = res.headers.get("set-cookie");
  let nextCookie = cookie;
  if (raw) {
    nextCookie = raw.split(",").map((p) => p.split(";")[0]).join("; ");
    // prefer recall_session only
    const m = raw.match(/recall_session=[^;]+/);
    if (m) nextCookie = m[0];
  }
  for (const c of setCookie) {
    const m = c.match(/recall_session=[^;]+/);
    if (m) nextCookie = m[0];
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  const events = text
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const meta = events.find((e) => e.type === "meta");
  const done = events.find((e) => e.type === "done");
  const tokens = events
    .filter((e) => e.type === "token")
    .map((e) => e.text)
    .join("");
  const warn = events.filter((e) => e.type === "warn" || e.type === "error");

  return {
    cookie: nextCookie,
    threadId: meta?.threadId || threadId,
    memories: meta?.memories || done?.memoriesUsed || [],
    writes: done?.memoryWrites || [],
    reply: tokens,
    warn,
  };
}

const t1 = await chat(
  "I prefer concise answers. I work in TypeScript on AWS.",
);
console.log("TURN1 writes:", t1.writes);
console.log("TURN1 reply:", t1.reply.slice(0, 200));
console.log("cookie:", t1.cookie);

const t2 = await chat(
  "What do you know about my preferences and work stack?",
  t1.cookie,
  t1.threadId,
);
console.log("TURN2 hits:", t2.memories.map((m) => ({
  score: m.hybrid_score,
  content: m.content,
})));
console.log("TURN2 reply:", t2.reply.slice(0, 400));
console.log("TURN2 warn:", t2.warn);

if (!t2.memories.length) {
  console.error("FAIL: expected hybrid memory hits on turn 2");
  process.exit(1);
}
console.log("E2E OK");
