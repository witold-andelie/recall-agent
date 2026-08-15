"use client";

import Link from "next/link";
import { AuthControls } from "./AuthControls";

export function Nav({ active }: { active: "chat" | "memory" }) {
  return (
    <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-900/60 text-sm font-bold text-emerald-300 ring-1 ring-emerald-500/40">
          R
        </div>
        <div>
          <div className="text-sm font-semibold tracking-wide text-slate-100">
            Recall
          </div>
          <div className="text-xs text-slate-500">
            CockroachDB durable memory · hybrid SQL
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <nav className="flex gap-1 text-sm">
          <Link
            href="/"
            className={`rounded-md px-3 py-1.5 ${
              active === "chat"
                ? "bg-slate-800 text-emerald-300"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Chat
          </Link>
          <Link
            href="/memory"
            className={`rounded-md px-3 py-1.5 ${
              active === "memory"
                ? "bg-slate-800 text-teal-300"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Memory
          </Link>
        </nav>
        <AuthControls />
      </div>
    </header>
  );
}
