"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";

type Mode = "signin" | "register";

export function AuthControls() {
  const { user, loading, login, register, logout } = useAuth();
  const [open, setOpen] = useState<Mode | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(null);
    setPassword("");
    setError(null);
    setBusy(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (open === "register") {
        await register({
          email,
          password,
          displayName: displayName.trim() || undefined,
        });
      } else {
        await login({ email, password });
      }
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "auth failed");
      setBusy(false);
    }
  }

  const label = user?.isAnonymous
    ? "Guest"
    : user?.displayName || user?.email || "Signed in";

  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className="hidden max-w-[160px] truncate text-slate-400 sm:inline"
        title={user?.email || user?.userId || ""}
      >
        {loading ? "…" : label}
      </span>
      {user && !user.isAnonymous ? (
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-md px-2.5 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          Sign out
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setOpen("signin");
              setError(null);
            }}
            className="rounded-md px-2.5 py-1 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen("register");
              setError(null);
            }}
            className="rounded-md bg-emerald-700/40 px-2.5 py-1 text-emerald-200 ring-1 ring-emerald-600/40 hover:bg-emerald-700/60"
          >
            Register
          </button>
        </>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={close}
        >
          <form
            className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-950 p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => void onSubmit(e)}
          >
            <h2 className="mb-1 text-sm font-semibold text-slate-100">
              {open === "register" ? "Claim this workspace" : "Sign in"}
            </h2>
            <p className="mb-4 text-[11px] leading-relaxed text-slate-500">
              {open === "register"
                ? "Keeps memories already written as this guest. Same email works on another browser."
                : "Return to your tenant — memories and threads stay on this account."}
            </p>
            {open === "register" && (
              <label className="mb-3 block">
                <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
                  Display name
                </span>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-600/40"
                  placeholder="Optional"
                  autoComplete="nickname"
                />
              </label>
            )}
            <label className="mb-3 block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
                Email
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-600/40"
                autoComplete="email"
              />
            </label>
            <label className="mb-3 block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
                Password
              </span>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-600/40"
                autoComplete={
                  open === "register" ? "new-password" : "current-password"
                }
              />
            </label>
            {error && (
              <p className="mb-3 rounded-md border border-orange-900/50 bg-orange-950/40 px-2 py-1.5 text-[11px] text-orange-200">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-md px-3 py-1.5 text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 hover:bg-emerald-500"
              >
                {busy
                  ? "…"
                  : open === "register"
                    ? "Create account"
                    : "Sign in"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
