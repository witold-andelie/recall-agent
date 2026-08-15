export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!s || s === "dev" || s === "change-me-in-production") {
      throw new Error("SESSION_SECRET must be set to a long random value in production");
    }
  }
  return s || "dev";
}

export function instanceId(): string {
  return (
    process.env.INSTANCE_ID ||
    process.env.HOSTNAME ||
    `pid-${process.pid}`
  );
}

export function envInt(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(raw)));
}

/** Per-process pg pool. Total CRDB connections ≈ instances × this. */
export function databasePoolMax(): number {
  return envInt("DATABASE_POOL_MAX", 20, 2, 80);
}

export function databasePoolIdleMs(): number {
  return envInt("DATABASE_POOL_IDLE_MS", 30_000, 5_000, 300_000);
}

export function databasePoolConnectMs(): number {
  return envInt("DATABASE_POOL_CONNECT_MS", 10_000, 1_000, 60_000);
}

/** Concurrent /api/chat loops on this process (embed + stream + extract). */
export function chatMaxInflight(): number {
  return envInt("CHAT_MAX_INFLIGHT", 32, 1, 200);
}

export function chatSlotWaitMs(): number {
  return envInt("CHAT_SLOT_WAIT_MS", 15_000, 0, 120_000);
}
