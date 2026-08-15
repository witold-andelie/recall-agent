-- Incremental auth identity for existing clusters.
-- One statement per implicit transaction (CRDB schema-change guidance).
-- Guest rows keep email NULL; claimed emails are unique.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email STRING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash BYTES;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_lower;

ALTER TABLE users ADD CONSTRAINT users_email_lower CHECK (
  email IS NULL OR email = lower(email)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq
  ON users (email)
  WHERE email IS NOT NULL;
