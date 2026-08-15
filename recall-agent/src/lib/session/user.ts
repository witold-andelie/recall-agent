import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import { query } from "@/lib/db/pool";
import { sessionSecret } from "@/lib/env";
import { hashPassword, verifyPassword } from "@/lib/session/password";
import type { SessionUser } from "@/lib/types";

const COOKIE = "recall_session";
const DAYS = 30;

type UserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  is_anonymous: boolean;
  password_hash: Buffer | null;
};

function hashToken(token: string): Buffer {
  return createHash("sha256")
    .update(`${sessionSecret()}:${token}`)
    .digest();
}

function toSession(row: UserRow, isNew: boolean): SessionUser {
  return {
    userId: row.id,
    isNew,
    email: row.email,
    displayName: row.display_name,
    isAnonymous: row.is_anonymous,
  };
}

async function loadUser(userId: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(
    `
    SELECT id, email, display_name, is_anonymous, password_hash
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId],
  );
  return rows[0] ?? null;
}

async function setSessionCookie(userId: string): Promise<void> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  if (existing) {
    await query(
      `UPDATE auth_sessions SET expires_at = now() WHERE token_hash = $1 AND expires_at > now()`,
      [hashToken(existing)],
    );
  }

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + DAYS * 864e5);
  await query(
    `
    INSERT INTO auth_sessions (user_id, token_hash, expires_at)
    VALUES ($1, $2, $3)
    `,
    [userId, hashToken(token), expires.toISOString()],
  );
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function getOrCreateUser(): Promise<SessionUser> {
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
      const user = await loadUser(rows[0].user_id);
      if (user) return toSession(user, false);
    }
  }

  const { rows: users } = await query<UserRow>(
    `
    INSERT INTO users (display_name, is_anonymous)
    VALUES ('Guest', true)
    RETURNING id, email, display_name, is_anonymous, password_hash
    `,
  );
  const user = users[0];
  await setSessionCookie(user.id);
  return toSession(user, true);
}

export async function requireUserId(): Promise<string> {
  const { userId } = await getOrCreateUser();
  return userId;
}

export async function registerCurrentUser(opts: {
  email: string;
  password: string;
  displayName: string | null;
}): Promise<SessionUser | { error: string; status: number }> {
  const session = await getOrCreateUser();
  if (!session.isAnonymous || session.email) {
    return { error: "already registered — sign in instead", status: 409 };
  }

  const taken = await query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1 LIMIT 1`,
    [opts.email],
  );
  if (taken.rows[0]) {
    return { error: "email already in use", status: 409 };
  }

  const passwordHash = await hashPassword(opts.password);
  const displayName =
    opts.displayName || opts.email.split("@")[0].slice(0, 80);

  try {
    const { rows } = await query<UserRow>(
      `
      UPDATE users
      SET
        email = $2,
        password_hash = $3,
        is_anonymous = false,
        display_name = $4,
        last_seen_at = now()
      WHERE id = $1 AND is_anonymous = true AND email IS NULL
      RETURNING id, email, display_name, is_anonymous, password_hash
      `,
      [session.userId, opts.email, passwordHash, displayName],
    );
    if (!rows[0]) {
      return { error: "could not claim this guest session", status: 409 };
    }
    return toSession(rows[0], false);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/unique|duplicate/i.test(msg)) {
      return { error: "email already in use", status: 409 };
    }
    throw e;
  }
}

export async function loginUser(opts: {
  email: string;
  password: string;
}): Promise<SessionUser | { error: string; status: number }> {
  const { rows } = await query<UserRow>(
    `
    SELECT id, email, display_name, is_anonymous, password_hash
    FROM users
    WHERE email = $1
    LIMIT 1
    `,
    [opts.email],
  );
  const user = rows[0];
  if (!user?.password_hash) {
    return { error: "invalid email or password", status: 401 };
  }
  const stored = Buffer.isBuffer(user.password_hash)
    ? user.password_hash
    : Buffer.from(user.password_hash);
  const ok = await verifyPassword(opts.password, stored);
  if (!ok) {
    return { error: "invalid email or password", status: 401 };
  }

  await query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [user.id]);
  await setSessionCookie(user.id);
  return toSession(user, false);
}

export async function logoutCurrentSession(): Promise<void> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  if (existing) {
    await query(
      `UPDATE auth_sessions SET expires_at = now() WHERE token_hash = $1`,
      [hashToken(existing)],
    );
  }
  jar.set(COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}
