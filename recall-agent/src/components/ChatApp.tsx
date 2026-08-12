"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Nav } from "./Nav";

type Hit = {
  id: string;
  kind: string;
  content: string;
  hybrid_score: number;
  score_vec: number;
  score_txt: number;
  score_recency: number;
  score_usage: number;
  hit_count: number;
};

type Write = {
  action: string;
  memoryId: string | null;
  content: string;
  kind: string;
  l2: number | null;
};

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function ChatApp() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [writes, setWrites] = useState<Write[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch("/api/auth", { method: "POST" });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setError(null);
    setWrites([]);

    const tempUserId = `local-user-${Date.now()}`;
    setMessages((m) => [...m, { id: tempUserId, role: "user", content: text }]);
    const tempAsstId = `local-asst-${Date.now()}`;
    setMessages((m) => [...m, { id: tempAsstId, role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, message: text }),
      });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: {
            type: string;
            text?: string;
            threadId?: string;
            memories?: Hit[];
            memoryWrites?: Write[];
            message?: string;
          };
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }

          if (evt.type === "meta") {
            if (evt.threadId) setThreadId(evt.threadId);
            if (evt.memories) setHits(evt.memories);
          } else if (evt.type === "token" && evt.text) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAsstId
                  ? { ...m, content: m.content + evt.text }
                  : m,
              ),
            );
          } else if (evt.type === "done") {
            if (evt.memoryWrites) setWrites(evt.memoryWrites);
            if (evt.memories) setHits(evt.memories);
          } else if (evt.type === "error") {
            throw new Error(evt.message || "stream error");
          } else if (evt.type === "warn") {
            setError(evt.message || "warning");
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "send failed");
      setMessages((prev) =>
        prev.filter((m) => m.id !== tempAsstId || m.content.length > 0),
      );
    } finally {
      setBusy(false);
    }
  }, [busy, input, threadId]);

  return (
    <div className="flex min-h-screen flex-col">
      <Nav active="chat" />
      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-0 md:grid-cols-[1fr_320px]">
        {/* Chat column */}
        <main className="flex min-h-[70vh] flex-col border-r border-slate-800/80">
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6">
            {messages.length === 0 && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
                <p className="mb-2 text-base font-medium text-slate-200">
                  Persistent memory, not a bolt-on cache
                </p>
                <p>
                  Say something durable (preferences, facts, task state). Recall
                  stores it in CockroachDB with hybrid retrieval — vector +
                  PostgreSQL full-text — then uses it on the next turn.
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  Try: &quot;I prefer concise answers and I use TypeScript at
                  work.&quot; Then ask: &quot;What do you know about me?&quot;
                </p>
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-emerald-700/30 text-emerald-50 ring-1 ring-emerald-600/40"
                      : "bg-slate-900 text-slate-100 ring-1 ring-slate-700"
                  }`}
                >
                  {m.content || (busy ? "…" : "")}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {error && (
            <div className="mx-4 mb-2 rounded-lg border border-orange-900/50 bg-orange-950/40 px-3 py-2 text-xs text-orange-200">
              {error}
            </div>
          )}

          <div className="border-t border-slate-800 p-4">
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                placeholder="Message Recall…"
                className="min-h-[52px] flex-1 resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-500/0 placeholder:text-slate-600 focus:ring-2 focus:ring-emerald-600/40"
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || !input.trim()}
                className="rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-40 hover:bg-emerald-500"
              >
                Send
              </button>
            </div>
          </div>
        </main>

        {/* Memory panel */}
        <aside className="flex flex-col gap-4 bg-slate-950/40 p-4 text-sm">
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-teal-400">
              Memory hits (this turn)
            </h2>
            {hits.length === 0 ? (
              <p className="text-xs text-slate-500">No memories retrieved yet.</p>
            ) : (
              <ul className="space-y-2">
                {hits.map((h) => (
                  <li
                    key={h.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                        {h.kind}
                      </span>
                      <span className="font-mono text-[10px] text-teal-300">
                        {h.hybrid_score.toFixed(3)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-200">{h.content}</p>
                    <div className="mt-1.5 grid grid-cols-2 gap-1 font-mono text-[10px] text-slate-500">
                      <span>vec {h.score_vec.toFixed(2)}</span>
                      <span>txt {h.score_txt.toFixed(2)}</span>
                      <span>rec {h.score_recency.toFixed(2)}</span>
                      <span>use {h.score_usage.toFixed(2)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-purple-300">
              New writes (dedupe)
            </h2>
            {writes.length === 0 ? (
              <p className="text-xs text-slate-500">
                Writes appear after the assistant replies.
              </p>
            ) : (
              <ul className="space-y-2">
                {writes.map((w, i) => (
                  <li
                    key={`${w.memoryId}-${i}`}
                    className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          w.action === "ADD"
                            ? "bg-emerald-900/60 text-emerald-300"
                            : w.action === "UPDATE"
                              ? "bg-amber-900/50 text-amber-200"
                              : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {w.action}
                      </span>
                      <span className="text-[10px] uppercase text-slate-500">
                        {w.kind}
                      </span>
                    </div>
                    <p className="text-xs text-slate-200">{w.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
