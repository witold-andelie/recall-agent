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
  username: string | null;
  google_sub: string | null;
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
    username: row.username,
    displayName: row.display_name,
    isAnonymous: row.is_anonymous,
  };
}

const USER_COLS = `
  id, email, username, google_sub, display_name, is_anonymous, password_hash
`;

async function loadUser(userId: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(
    `SELECT ${USER_COLS} FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function setSessionCookie(userId: string): Promise<void> {
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
    RETURNING ${USER_COLS}
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
  username: string;
  password: string;
  displayName: string | null;
}): Promise<SessionUser | { error: string; status: number }> {
  const session = await getOrCreateUser();
  if (!session.isAnonymous) {
    return { error: "already registered — sign in instead", status: 409 };
  }

  const taken = await query<{ id: string }>(
    `SELECT id FROM users WHERE username = $1 LIMIT 1`,
    [opts.username],
  );
  if (taken.rows[0]) {
    return { error: "username already in use", status: 409 };
  }

  const passwordHash = await hashPassword(opts.password);
  const displayName = opts.displayName || opts.username;

  try {
    const { rows } = await query<UserRow>(
      `
      UPDATE users
      SET
        username = $2,
        password_hash = $3,
        is_anonymous = false,
        display_name = $4,
        last_seen_at = now()
      WHERE id = $1 AND is_anonymous = true
      RETURNING ${USER_COLS}
      `,
      [session.userId, opts.username, passwordHash, displayName],
    );
    if (!rows[0]) {
      return { error: "could not claim this guest session", status: 409 };
    }
    return toSession(rows[0], false);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/unique|duplicate/i.test(msg)) {
      return { error: "username already in use", status: 409 };
    }
    throw e;
  }
}

export async function loginUser(opts: {
  username: string;
  password: string;
}): Promise<SessionUser | { error: string; status: number }> {
  const { rows } = await query<UserRow>(
    `SELECT ${USER_COLS} FROM users WHERE username = $1 LIMIT 1`,
    [opts.username],
  );
  const user = rows[0];
  if (!user?.password_hash) {
    return { error: "invalid username or password", status: 401 };
  }
  const stored = Buffer.isBuffer(user.password_hash)
    ? user.password_hash
    : Buffer.from(user.password_hash);
  const ok = await verifyPassword(opts.password, stored);
  if (!ok) {
    return { error: "invalid username or password", status: 401 };
  }

  await query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [user.id]);
  await setSessionCookie(user.id);
  return toSession(user, false);
}

export async function loginWithGoogle(profile: {
  sub: string;
  email?: string | null;
  name?: string | null;
}): Promise<SessionUser | { error: string; status: number }> {
  const sub = profile.sub.trim();
  if (!sub) return { error: "google profile missing sub", status: 400 };

  const bySub = await query<UserRow>(
    `SELECT ${USER_COLS} FROM users WHERE google_sub = $1 LIMIT 1`,
    [sub],
  );
  if (bySub.rows[0]) {
    await query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [
      bySub.rows[0].id,
    ]);
    await setSessionCookie(bySub.rows[0].id);
    return toSession(bySub.rows[0], false);
  }

  const email = profile.email?.trim().toLowerCase() || null;
  if (email) {
    const byEmail = await query<UserRow>(
      `SELECT ${USER_COLS} FROM users WHERE email = $1 AND is_anonymous = false LIMIT 1`,
      [email],
    );
    if (byEmail.rows[0]) {
      await query(
        `
        UPDATE users
        SET google_sub = $2, last_seen_at = now()
        WHERE id = $1 AND google_sub IS NULL
        `,
        [byEmail.rows[0].id, sub],
      );
      const linked = await loadUser(byEmail.rows[0].id);
      if (linked) {
        await setSessionCookie(linked.id);
        return toSession(linked, false);
      }
    }
  }

  const session = await getOrCreateUser();
  const base =
    (email ? email.split("@")[0] : "guser")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/^[^a-z]+/, "g")
      .slice(0, 24) || "guser";
  let username = base.length >= 3 ? base : `g_${sub.slice(0, 10)}`;
  for (let i = 0; i < 8; i++) {
    const candidate = i === 0 ? username : `${base}_${i}`.slice(0, 32);
    const taken = await query<{ id: string }>(
      `SELECT id FROM users WHERE username = $1 LIMIT 1`,
      [candidate],
    );
    if (!taken.rows[0]) {
      username = candidate;
      break;
    }
    username = `g_${sub.slice(0, 8)}_${i}`;
  }

  try {
    const { rows } = await query<UserRow>(
      `
      UPDATE users
      SET
        google_sub = $2,
        email = COALESCE($3, email),
        username = COALESCE(username, $4),
        display_name = COALESCE(NULLIF(display_name, 'Guest'), $5, username, 'Google user'),
        is_anonymous = false,
        last_seen_at = now()
      WHERE id = $1 AND is_anonymous = true
      RETURNING ${USER_COLS}
      `,
      [
        session.userId,
        sub,
        email,
        username,
        profile.name?.slice(0, 80) || null,
      ],
    );
    if (rows[0]) return toSession(rows[0], false);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (!/unique|duplicate/i.test(msg)) throw e;
  }

  const { rows: created } = await query<UserRow>(
    `
    INSERT INTO users (username, email, google_sub, display_name, is_anonymous)
    VALUES ($1, $2, $3, $4, false)
    RETURNING ${USER_COLS}
    `,
    [username, email, sub, profile.name?.slice(0, 80) || username],
  );
  await setSessionCookie(created[0].id);
  return toSession(created[0], true);
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

export async function changePassword(opts: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ ok: true } | { error: string; status: number }> {
  const session = await getOrCreateUser();
  if (session.isAnonymous) {
    return { error: "register first", status: 401 };
  }
  const user = await loadUser(session.userId);
  if (!user?.password_hash) {
    return { error: "this account uses Google sign-in", status: 400 };
  }
  const stored = Buffer.isBuffer(user.password_hash)
    ? user.password_hash
    : Buffer.from(user.password_hash);
  if (!(await verifyPassword(opts.currentPassword, stored))) {
    return { error: "current password is wrong", status: 401 };
  }
  const next = await hashPassword(opts.newPassword);
  await query(`UPDATE users SET password_hash = $2, last_seen_at = now() WHERE id = $1`, [
    session.userId,
    next,
  ]);
  return { ok: true };
}
