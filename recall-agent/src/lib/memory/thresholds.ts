import { query } from "@/lib/db/pool";

export const DEFAULT_L2_SKIP = 0.35;
export const DEFAULT_L2_UPDATE = 0.7;

const MIN_N = 6;
const CACHE_MS = 60_000;

export type DedupeThresholds = {
  l2Skip: number;
  l2Update: number;
  source: "default" | "user" | "global";
  skip_n: number;
  update_n: number;
  add_n: number;
};

type CalibRow = {
  skip_n: number;
  update_n: number;
  add_n: number;
  skip_p80: number | null;
  update_p50: number | null;
  add_p20: number | null;
};

const cache = new Map<string, { at: number; value: DedupeThresholds }>();

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function fromRow(
  row: CalibRow | undefined,
  source: DedupeThresholds["source"],
): DedupeThresholds | null {
  if (!row) return null;
  const skip_n = Number(row.skip_n) || 0;
  const update_n = Number(row.update_n) || 0;
  const add_n = Number(row.add_n) || 0;
  if (skip_n + update_n + add_n < MIN_N * 2) return null;

  let l2Skip = DEFAULT_L2_SKIP;
  let l2Update = DEFAULT_L2_UPDATE;

  if (skip_n >= MIN_N && row.skip_p80 != null) {
    l2Skip = clamp(Number(row.skip_p80), 0.12, 0.55);
  }
  if (update_n >= MIN_N && row.update_p50 != null) {
    l2Update = Number(row.update_p50);
  }
  if (add_n >= MIN_N && row.add_p20 != null) {
    const addFloor = Number(row.add_p20);
    l2Update = l2Update < addFloor ? (l2Update + addFloor) / 2 : l2Update;
  }
  if (l2Update <= l2Skip) l2Update = l2Skip + 0.08;
  l2Update = clamp(l2Update, l2Skip + 0.05, 1.4);

  return { l2Skip, l2Update, source, skip_n, update_n, add_n };
}

const CALIB_SQL = `
SELECT
  count(*) FILTER (WHERE action = 'SKIP')::int AS skip_n,
  count(*) FILTER (WHERE action = 'UPDATE')::int AS update_n,
  count(*) FILTER (WHERE action = 'ADD')::int AS add_n,
  percentile_disc(0.80) WITHIN GROUP (ORDER BY sim_l2)
    FILTER (WHERE action = 'SKIP') AS skip_p80,
  percentile_disc(0.50) WITHIN GROUP (ORDER BY sim_l2)
    FILTER (WHERE action = 'UPDATE') AS update_p50,
  percentile_disc(0.20) WITHIN GROUP (ORDER BY sim_l2)
    FILTER (WHERE action = 'ADD') AS add_p20
FROM memory_extraction_log
WHERE sim_l2 IS NOT NULL AND sim_l2 >= 0
  AND ($1::uuid IS NULL OR user_id = $1::uuid)
`;

export async function getDedupeThresholds(
  userId?: string,
): Promise<DedupeThresholds> {
  const key = userId || "global";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let resolved: DedupeThresholds = {
    l2Skip: DEFAULT_L2_SKIP,
    l2Update: DEFAULT_L2_UPDATE,
    source: "default",
    skip_n: 0,
    update_n: 0,
    add_n: 0,
  };

  try {
    if (userId) {
      const { rows } = await query<CalibRow>(CALIB_SQL, [userId]);
      const user = fromRow(rows[0], "user");
      if (user) resolved = user;
    }
    if (resolved.source === "default") {
      const { rows } = await query<CalibRow>(CALIB_SQL, [null]);
      const global = fromRow(rows[0], "global");
      if (global) resolved = global;
    }
  } catch {
    // keep defaults if the view/table is missing mid-migrate
  }

  cache.set(key, { at: Date.now(), value: resolved });
  return resolved;
}
