ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS auth_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose       STRING NOT NULL,
  token_hash    BYTES NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (purpose IN ('verify', 'reset'))
);

CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose_idx
  ON auth_tokens (user_id, purpose, created_at DESC);
