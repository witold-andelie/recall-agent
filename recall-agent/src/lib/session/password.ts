import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCb);
const KEYLEN = 32;
const SALTLEN = 16;

export async function hashPassword(password: string): Promise<Buffer> {
  const salt = randomBytes(SALTLEN);
  const hash = (await scrypt(password, salt, KEYLEN)) as Buffer;
  return Buffer.concat([salt, hash]);
}

export async function verifyPassword(
  password: string,
  stored: Buffer,
): Promise<boolean> {
  if (!stored || stored.length < SALTLEN + KEYLEN) return false;
  const salt = stored.subarray(0, SALTLEN);
  const expected = stored.subarray(SALTLEN, SALTLEN + KEYLEN);
  const hash = (await scrypt(password, salt, KEYLEN)) as Buffer;
  if (hash.length !== expected.length) return false;
  return timingSafeEqual(hash, expected);
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function parseUsernamePassword(body: {
  username?: string;
  password?: string;
  displayName?: string;
}):
  | { username: string; password: string; displayName: string | null }
  | { error: string } {
  const username = normalizeUsername(body.username || "");
  const password = body.password ?? "";
  const displayName = body.displayName?.trim().slice(0, 80) || null;
  if (!/^[a-z][a-z0-9_]{2,31}$/.test(username)) {
    return {
      error: "username must be 3–32 chars, start with a letter, and use a-z 0-9 _",
    };
  }
  if (password.length < 8 || password.length > 128) {
    return { error: "password must be 8–128 characters" };
  }
  return { username, password, displayName };
}
