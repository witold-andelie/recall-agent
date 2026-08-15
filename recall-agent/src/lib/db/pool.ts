import { Pool, type QueryResultRow } from "pg";
import {
  databasePoolConnectMs,
  databasePoolIdleMs,
  databasePoolMax,
  instanceId,
} from "@/lib/env";
import { logEvent } from "@/lib/log";

const globalForPg = globalThis as unknown as { recallPool?: Pool };

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!globalForPg.recallPool) {
    const max = databasePoolMax();
    globalForPg.recallPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max,
      idleTimeoutMillis: databasePoolIdleMs(),
      connectionTimeoutMillis: databasePoolConnectMs(),
      ssl:
        process.env.DATABASE_SSL === "false"
          ? undefined
          : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" },
    });
    logEvent("db.pool", { instance: instanceId(), max });
  }
  return globalForPg.recallPool;
}

export function poolStats() {
  const pool = getPool();
  return {
    max: databasePoolMax(),
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return getPool().query<T>(text, params);
}

function isRetryableTxnError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  if (code === "40001") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /40001|restart transaction|serialization failure/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTransaction<T>(
  fn: (client: {
    query: <R extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: unknown[],
    ) => Promise<{ rows: R[]; rowCount: number | null }>;
  }) => Promise<T>,
): Promise<T> {
  const maxAttempts = 5;
  let backoffMs = 50;

  for (let attempt = 0; ; attempt++) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // connection may already be aborted
      }
      if (!isRetryableTxnError(e) || attempt + 1 >= maxAttempts) {
        throw e;
      }
      await sleep(backoffMs + Math.random() * 40);
      backoffMs = Math.min(backoffMs * 2, 2000);
    } finally {
      client.release();
    }
  }
}

/** Format a number[] as pgvector / CRDB VECTOR literal. */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
