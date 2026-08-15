ALTER TABLE users ADD COLUMN IF NOT EXISTS username STRING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub STRING;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq
  ON users (username)
  WHERE username IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_uq
  ON users (google_sub)
  WHERE google_sub IS NOT NULL;

UPDATE users
SET username = lower(replace(split_part(email, '@', 1), '.', '_'))
WHERE username IS NULL
  AND email IS NOT NULL
  AND is_anonymous = false;
