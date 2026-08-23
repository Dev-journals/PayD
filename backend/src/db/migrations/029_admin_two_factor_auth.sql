-- TOTP-based two-factor authentication for privileged (admin) accounts.
--
-- Replaces the first-pass 2FA columns added in 003_create_users_2fa.sql with a
-- design that keeps enrolment and activation separate, stores recovery codes as
-- single-use hashes instead of plaintext, and records enough state to reject
-- replayed TOTP codes and throttle brute-force attempts.

-- The application has always modelled an ADMIN role, but the original CHECK
-- constraint only allowed EMPLOYER/EMPLOYEE, so an admin row could never exist.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('EMPLOYER', 'EMPLOYEE', 'ADMIN'));

-- Secret captured during setup. It is only promoted to totp_secret once the
-- admin proves possession of the authenticator, so an abandoned setup can never
-- leave an account half-enrolled.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT;

-- totp_secret previously held a plaintext base32 secret; it now holds an
-- AES-256-GCM ciphertext, which needs more room than VARCHAR(255).
ALTER TABLE users ALTER COLUMN totp_secret TYPE TEXT;

-- TIMESTAMPTZ, not TIMESTAMP: node-pg parses a bare TIMESTAMP as *local* time,
-- so on a server whose timezone is not UTC the value comes back shifted. For
-- two_factor_locked_until that silently disables the brute-force lockout.
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled_at TIMESTAMPTZ;

-- Highest TOTP time step already spent by this user. A code is accepted only
-- when its step is strictly greater, which makes every code single-use.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_used_step BIGINT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_locked_until TIMESTAMPTZ;

-- Recovery codes move out of the plaintext users.recovery_codes array into
-- their own table so each code can be hashed and individually invalidated.
CREATE TABLE IF NOT EXISTS user_recovery_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, code_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_recovery_codes_user_id
  ON user_recovery_codes(user_id);

-- Unused codes are the only ones ever looked up during login.
CREATE INDEX IF NOT EXISTS idx_user_recovery_codes_unused
  ON user_recovery_codes(user_id, code_hash)
  WHERE used_at IS NULL;

-- Any code still sitting in the old array is plaintext and cannot be trusted.
ALTER TABLE users DROP COLUMN IF EXISTS recovery_codes;

-- Existing plaintext secrets predate encryption at rest, so enrolments are
-- reset rather than silently re-used. Affected admins re-run 2FA setup.
UPDATE users
SET totp_secret = NULL,
    totp_pending_secret = NULL,
    is_2fa_enabled = FALSE
WHERE totp_secret IS NOT NULL;
