import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import { query } from "@/lib/db/pool";

const COOKIE = "recall_session";
const DAYS = 30;

function hashToken(token: string): Buffer {
  return createHash("sha256")
    .update(`${process.env.SESSION_SECRET || "dev"}:${token}`)
    .digest();
}

export async function getOrCreateUser(): Promise<{
  userId: string;
  isNew: boolean;
}> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;

  if (existing) {
    const tokenHash = hashToken(existing);
    const { rows } = await query<{ user_id: string }>(
      `
      SELECT user_id FROM auth_sessions
      WHERE token_hash = $1 AND expires_at > now()
      LIMIT 1
      `,
      [tokenHash],
    );
    if (rows[0]) {
      await query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [
        rows[0].user_id,
      ]);
      return { userId: rows[0].user_id, isNew: false };
    }
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + DAYS * 864e5);

  const { rows: users } = await query<{ id: string }>(
    `
    INSERT INTO users (display_name, is_anonymous)
    VALUES ('Guest', true)
    RETURNING id
    `,
  );
  const userId = users[0].id;

  await query(
    `
    INSERT INTO auth_sessions (user_id, token_hash, expires_at)
    VALUES ($1, $2, $3)
    `,
    [userId, tokenHash, expires.toISOString()],
  );

  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });

  return { userId, isNew: true };
}

export async function requireUserId(): Promise<string> {
  const { userId } = await getOrCreateUser();
  return userId;
}
