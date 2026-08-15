"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";

type Mode = "signin" | "register" | "password";

export function AuthControls() {
  const { user, loading, login, register, logout } = useAuth();
  const [open, setOpen] = useState<Mode | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismissFromBackdrop = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("auth_error");
    if (!authError) return;
    queueMicrotask(() => {
      setOpen("signin");
      setError(authError);
    });
    params.delete("auth_error");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState({}, "", next);
  }, []);

  function close() {
    setOpen(null);
    setPassword("");
    setPassword2("");
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
          username,
          password,
          displayName: displayName.trim() || undefined,
        });
        close();
        return;
      }
      if (open === "signin") {
        await login({ username, password });
        close();
        return;
      }
      if (open === "password") {
        const res = await fetch("/api/auth/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentPassword: password,
            newPassword: password2,
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error || "change failed");
        close();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "auth failed");
      setBusy(false);
    }
  }

  const label = user?.isAnonymous
    ? "Guest"
    : user?.displayName || user?.username || "Signed in";

  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className="hidden max-w-[160px] truncate select-text text-slate-400 sm:inline"
        title={user?.username || user?.userId || ""}
      >
        {loading ? "…" : label}
      </span>
      {user && !user.isAnonymous ? (
        <>
          <button
            type="button"
            onClick={() => {
              setOpen("password");
              setError(null);
            }}
            className="rounded-md px-2.5 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            Password
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md px-2.5 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            Sign out
          </button>
        </>
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
          onPointerDown={(e) => {
            dismissFromBackdrop.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (window.getSelection()?.toString()) {
              dismissFromBackdrop.current = false;
              return;
            }
            if (dismissFromBackdrop.current && e.target === e.currentTarget) {
              close();
            }
            dismissFromBackdrop.current = false;
          }}
        >
          <form
            className="w-full max-w-sm select-text rounded-xl border border-slate-700 bg-slate-950 p-4 shadow-xl"
            onPointerDown={() => {
              dismissFromBackdrop.current = false;
            }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => void onSubmit(e)}
          >
            <h2 className="mb-1 text-sm font-semibold text-slate-100">
              {open === "register"
                ? "Create username"
                : open === "password"
                  ? "Change password"
                  : "Sign in"}
            </h2>
            <p className="mb-4 text-[11px] leading-relaxed text-slate-500">
              {open === "register"
                ? "Username and password only. No email check."
                : open === "password"
                  ? "For accounts that have a password (not Google-only)."
                  : "Username + password, or continue with Google."}
            </p>
            {open !== "password" && (
              <>
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
                    Username
                  </span>
                  <input
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-600/40"
                    autoComplete="username"
                    minLength={3}
                    maxLength={32}
                    pattern="[A-Za-z][A-Za-z0-9_]{2,31}"
                  />
                </label>
              </>
            )}
            <label className="mb-3 block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
                {open === "password" ? "Current password" : "Password"}
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
            {open === "password" && (
              <label className="mb-3 block">
                <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">
                  New password
                </span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-emerald-600/40"
                  autoComplete="new-password"
                />
              </label>
            )}
            {error && (
              <p className="mb-3 rounded-md border border-orange-900/50 bg-orange-950/40 px-2 py-1.5 text-[11px] text-orange-200">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2">
              {open !== "password" && (
                <a
                  href="/api/auth/google"
                  className="rounded-md border border-slate-600 px-3 py-1.5 text-center text-sm text-slate-200 hover:bg-slate-800"
                >
                  Continue with Google
                </a>
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
                  {busy ? "…" : "Continue"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
