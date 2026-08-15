"use client";

import { useCallback, useEffect, useState } from "react";
import { Nav } from "./Nav";
import { useAuth } from "./AuthProvider";

type LineageLink = {
  id: string;
  rel: string;
  role: "from" | "to";
  content: string;
  valid_to: string | null;
  confidence: number;
};

type MemoryRow = {
  id: string;
  kind: string;
  content: string;
  importance?: number;
  hit_count: number;
  hybrid_score?: number;
  last_used_at?: string | null;
  updated_at?: string;
  valid_to?: string | null;
  lineage?: LineageLink[];
  skip_count?: number;
};

export function MemoryBrowser() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [mode, setMode] = useState<string>("list");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState("fact");
  const [history, setHistory] = useState(false);

  const load = useCallback(async (query?: string) => {
    const url = query?.trim()
      ? `/api/memories?q=${encodeURIComponent(query.trim())}`
      : `/api/memories${history ? "?history=1" : ""}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "load failed");
      setRows(data.memories || []);
      setMode(data.mode || "list");
      setError(null);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
      setLoading(false);
    }
  }, [history]);

  useEffect(() => {
    if (!user?.userId) return;
    let cancelled = false;
    fetch("/api/memories")
      .then((res) => res.json().then((data) => ({ res, data })))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "load failed");
        setRows(data.memories || []);
        setMode(data.mode || "list");
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "load failed");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.userId]);

  async function onDelete(id: string) {
    const res = await fetch(`/api/memories?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) void load(q);
  }

  async function onAdd() {
    const content = draft.trim();
    if (!content) return;
    const res = await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, kind }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "create failed");
      return;
    }
    setDraft("");
    void load(q);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Nav active="memory" />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <h1 className="mb-1 text-xl font-semibold text-slate-100">
          Memory Browser
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          List or hybrid-search this account&apos;s current memories. UPDATE
          keeps the old row with <code>valid_to</code> and links{" "}
          <code>supersedes</code>. Deletes take effect on the next answer.
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load(q);
            }}
            placeholder="Hybrid search (vector + full-text)…"
            className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-600/40"
          />
          <button
            type="button"
            onClick={() => void load(q)}
            className="rounded-lg bg-teal-700 px-3 py-2 text-sm text-white hover:bg-teal-600"
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => {
              setQ("");
              void load();
            }}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-900"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !history;
              setHistory(next);
              void fetch(`/api/memories${next ? "?history=1" : ""}`)
                .then((res) => res.json().then((data) => ({ res, data })))
                .then(({ res, data }) => {
                  if (!res.ok) throw new Error(data.error || "load failed");
                  setRows(data.memories || []);
                  setMode(data.mode || "list");
                  setQ("");
                })
                .catch((e) => {
                  setError(e instanceof Error ? e.message : "load failed");
                });
            }}
            className={`rounded-lg border px-3 py-2 text-sm ${
              history
                ? "border-amber-800 bg-amber-950/40 text-amber-200"
                : "border-slate-700 text-slate-300 hover:bg-slate-900"
            }`}
          >
            {history ? "Hiding expired" : "Show expired"}
          </button>
        </div>

        <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Add memory manually
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
            >
              <option value="fact">fact</option>
              <option value="preference">preference</option>
              <option value="task_state">task_state</option>
            </select>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="English memory content…"
              className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-600/40"
            />
            <button
              type="button"
              onClick={() => void onAdd()}
              className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white hover:bg-emerald-600"
            >
              Add
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-orange-900/50 bg-orange-950/40 px-3 py-2 text-xs text-orange-200">
            {error}
          </div>
        )}

        <div className="mb-2 text-xs text-slate-500">
          {loading ? "Loading…" : `${rows.length} memories · mode=${mode}`}
        </div>

        <ul className="space-y-2">
          {rows.map((m) => (
            <li
              key={m.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3"
            >
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                    {m.kind}
                  </span>
                  {m.valid_to && (
                    <span className="rounded bg-amber-950 px-1.5 py-0.5 text-[10px] uppercase text-amber-200">
                      expired
                    </span>
                  )}
                  {!!m.skip_count && (
                    <span className="font-mono text-[10px] text-slate-500">
                      skips={m.skip_count}
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-slate-500">
                    hits={m.hit_count}
                  </span>
                  {typeof m.hybrid_score === "number" && (
                    <span className="font-mono text-[10px] text-teal-300">
                      hybrid={m.hybrid_score.toFixed(3)}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-100">{m.content}</p>
                <LineageList row={m} />
              </div>
              <button
                type="button"
                onClick={() => void onDelete(m.id)}
                className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-red-800 hover:text-red-300"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

function lineageLabel(link: LineageLink): string {
  if (link.rel === "supersedes" && link.role === "from") return "Replaces";
  if (link.rel === "supersedes" && link.role === "to") return "Replaced by";
  if (link.rel === "duplicates") return "Duplicate of";
  if (link.rel === "derived_from" && link.role === "from") return "Derived from";
  if (link.rel === "derived_from" && link.role === "to") return "Related";
  return link.rel;
}

function LineageList({ row }: { row: MemoryRow }) {
  const links = row.lineage || [];
  if (!links.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {links.map((link) => (
        <li
          key={`${link.rel}-${link.role}-${link.id}`}
          className="text-[11px] leading-snug text-slate-500"
        >
          <span className="mr-1 rounded bg-slate-800 px-1 py-0.5 uppercase text-slate-400">
            {lineageLabel(link)}
          </span>
          {link.content}
        </li>
      ))}
    </ul>
  );
}
