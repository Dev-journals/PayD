import pool from './database.js';

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(56) UNIQUE,
  email VARCHAR(255) UNIQUE,
  name VARCHAR(255),
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  role VARCHAR(20) DEFAULT 'EMPLOYEE' CHECK (role IN ('EMPLOYER', 'EMPLOYEE', 'ADMIN')),
  refresh_token TEXT,
  totp_secret TEXT,
  totp_pending_secret TEXT,
  is_2fa_enabled BOOLEAN DEFAULT FALSE,
  two_factor_enabled_at TIMESTAMPTZ,
  totp_last_used_step BIGINT,
  two_factor_failed_attempts INTEGER NOT NULL DEFAULT 0,
  two_factor_locked_until TIMESTAMPTZ,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS social_identities (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_id)
);
`;

async function initDb() {
  try {
    await pool.query(schema);
    console.log('Database schema initialized');
  } catch (err) {
    console.error('Error initializing database schema:', err);
  } finally {
    await pool.end();
  }
}

await initDb();
