-- Sessions and login throttling.

-- Opaque server-side sessions rather than a self-contained token. A stolen or
-- retired session has to be revocable now, not when it expires, and a signed
-- token cannot be taken back.
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Only the hash is stored: a database dump must not hand over live sessions.
  -- SHA-256 is enough here because the token is 256 bits of randomness, not a
  -- guessable password.
  token_hash    text NOT NULL UNIQUE,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);

CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

-- Attempts are recorded in the database, not in process memory: throttling that
-- resets on every deploy protects nobody, and two instances would each keep their
-- own count.
CREATE TABLE login_attempts (
  id          bigserial PRIMARY KEY,
  email       text NOT NULL,
  ip          inet,
  succeeded   boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_attempts_email_idx ON login_attempts (lower(email), created_at DESC);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip, created_at DESC);
