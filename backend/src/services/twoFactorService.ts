/**
 * TOTP-based two-factor authentication for privileged (admin) accounts.
 *
 * Enrolment is a two-step handshake: `startSetup` stores a *pending* secret and
 * hands back a QR code, and `confirmSetup` only promotes that secret — and only
 * then issues recovery codes — once the admin proves possession of the
 * authenticator. An abandoned setup therefore never enables 2FA.
 *
 * Secrets are encrypted at rest, recovery codes are stored as single-use
 * hashes, accepted TOTP codes are burned so they cannot be replayed, and
 * repeated failures lock verification for a cool-off period.
 */

import crypto from 'crypto';
import { authenticator } from '@otplib/preset-default';
import QRCode from 'qrcode';
import { query } from '../config/database.js';
import { config } from '../config/env.js';
import { UserRole } from '../types/auth.js';

/** Number of recovery codes handed out when 2FA is enabled. */
export const RECOVERY_CODE_COUNT = 8;

/** Length of the TOTP time step, in seconds. Matches the otplib default. */
const TOTP_STEP_SECONDS = 30;

/** Steps of clock drift tolerated on either side of the current one. */
const TOTP_WINDOW = 1;

/** Consecutive failures before verification is locked for this account. */
const MAX_FAILED_ATTEMPTS = 5;

/** How long verification stays locked once the failure limit is hit. */
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Roles allowed to enrol in 2FA — the admin-level roles. `EMPLOYER` is included
 * because it is the role that actually carries admin privileges across the
 * codebase (payroll, employees, schedules, assets).
 */
export const TWO_FACTOR_ROLES: UserRole[] = ['ADMIN', 'EMPLOYER'];

/**
 * Alphabet for recovery codes: Crockford base32 minus the characters that are
 * easy to confuse when a code is read off a screen and typed back in.
 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const ENCRYPTION_PREFIX = 'v1';

/**
 * otplib instance with an explicit drift window. `clone` keeps the preset's
 * crypto plugins, which a bare `create` would drop.
 */
const totp = authenticator.clone({
  step: TOTP_STEP_SECONDS,
  window: TOTP_WINDOW,
});

export class TwoFactorError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'TwoFactorError';
  }
}

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  setupPending: boolean;
  recoveryCodesRemaining: number;
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrCode: string;
}

// ─── Encryption at rest ──────────────────────────────────────────────────────

function encryptionKey(): Buffer {
  const material = config.TWO_FACTOR_ENCRYPTION_KEY || config.JWT_SECRET;
  // The key material is an arbitrary-length passphrase; hash it down to the
  // 32 bytes AES-256 requires.
  return crypto.createHash('sha256').update(material).digest();
}

function encryptSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTION_PREFIX,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

function decryptSecret(stored: string): string {
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_PREFIX) {
    throw new TwoFactorError(
      'Stored 2FA secret is unreadable. Re-run 2FA setup.',
      500,
      'SECRET_UNREADABLE'
    );
  }

  const [, iv, tag, ciphertext] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

// ─── Codes ───────────────────────────────────────────────────────────────────

/** `true` when the value looks like a TOTP code, without touching any secret. */
export function isTotpCodeShaped(code: unknown): code is string {
  return typeof code === 'string' && /^\d{6}$/.test(code.trim());
}

/**
 * Generates {@link RECOVERY_CODE_COUNT} distinct recovery codes formatted as
 * `XXXXX-XXXXX`. Randomness comes from `crypto.randomBytes`, mapped onto the
 * alphabet by rejection sampling so every character stays uniformly likely.
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const chars: string[] = [];
    while (chars.length < 10) {
      for (const byte of crypto.randomBytes(16)) {
        // 256 is not a multiple of 32, but 32 divides 256 exactly, so a plain
        // mask over the low 5 bits is already uniform.
        chars.push(RECOVERY_ALPHABET[byte & 0x1f]);
        if (chars.length === 10) break;
      }
    }
    codes.add(`${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`);
  }
  return [...codes];
}

/** Strips formatting so `abcde-fghij` and `ABCDEFGHIJ` hash identically. */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

// ─── Lockout ─────────────────────────────────────────────────────────────────

/**
 * Rejects the request when the account is in its brute-force cool-off.
 *
 * The decision comes from `isLocked`, which the database computes with its own
 * clock — never from comparing the timestamp here. A bare `TIMESTAMP` column
 * comes back through node-pg parsed as local time, so on a server whose
 * timezone is not UTC a JS-side comparison would put the lock in the past and
 * silently let brute-force attempts through. The timestamp is used only to tell
 * the caller how long is left.
 */
function assertNotLocked(isLocked: boolean, lockedUntil: Date | string | null): void {
  if (!isLocked) return;

  const remainingMs = lockedUntil ? new Date(lockedUntil).getTime() - Date.now() : 0;
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));

  throw new TwoFactorError(
    `Too many failed 2FA attempts. Try again in ${seconds} seconds.`,
    429,
    'TWO_FACTOR_LOCKED'
  );
}

async function recordFailure(userId: number): Promise<void> {
  // A failure after a lockout has expired starts a fresh count, so serving one
  // cool-off does not leave the account a single mistake away from the next.
  await query(
    `UPDATE users
        SET two_factor_failed_attempts = CASE
              WHEN two_factor_locked_until IS NOT NULL AND two_factor_locked_until <= NOW() THEN 1
              ELSE two_factor_failed_attempts + 1
            END,
            two_factor_locked_until = CASE
              WHEN two_factor_locked_until IS NOT NULL AND two_factor_locked_until <= NOW() THEN NULL
              WHEN two_factor_failed_attempts + 1 >= $2
              THEN NOW() + ($3 || ' milliseconds')::interval
              ELSE two_factor_locked_until
            END
      WHERE id = $1`,
    [userId, MAX_FAILED_ATTEMPTS, String(LOCKOUT_MS)]
  );
}

async function clearFailures(userId: number): Promise<void> {
  await query(
    `UPDATE users
        SET two_factor_failed_attempts = 0,
            two_factor_locked_until = NULL
      WHERE id = $1`,
    [userId]
  );
}

// ─── TOTP verification ───────────────────────────────────────────────────────

/**
 * Checks `code` against `secret` and, on success, burns the time step it used
 * so the same code cannot be presented twice.
 */
async function consumeTotpCode(userId: number, code: string, secret: string): Promise<boolean> {
  let delta: number | null;
  try {
    delta = totp.checkDelta(code.trim(), secret);
  } catch {
    // A malformed secret or code makes otplib throw; treat it as a failure
    // rather than surfacing anything about the stored secret.
    return false;
  }

  if (delta === null) return false;

  const step = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + delta;

  // Accept only if this step is newer than the last one spent. The condition
  // lives in the UPDATE so two concurrent requests cannot both win.
  const result = await query(
    `UPDATE users
        SET totp_last_used_step = $2
      WHERE id = $1
        AND (totp_last_used_step IS NULL OR totp_last_used_step < $2)
      RETURNING id`,
    [userId, step]
  );

  return (result.rowCount ?? 0) === 1;
}

/**
 * Consumes an unused recovery code. The `used_at IS NULL` guard is part of the
 * UPDATE, so a code can only ever be redeemed once even under concurrency.
 */
async function consumeRecoveryCode(userId: number, code: string): Promise<boolean> {
  const result = await query(
    `UPDATE user_recovery_codes
        SET used_at = NOW()
      WHERE user_id = $1
        AND code_hash = $2
        AND used_at IS NULL
      RETURNING id`,
    [userId, hashRecoveryCode(code)]
  );

  return (result.rowCount ?? 0) === 1;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

interface UserTwoFactorRow {
  id: number;
  wallet_address: string | null;
  email: string | null;
  role: string;
  is_2fa_enabled: boolean;
  totp_secret: string | null;
  totp_pending_secret: string | null;
  two_factor_enabled_at: Date | null;
  two_factor_locked_until: Date | null;
  /** Computed by the database, using the database's clock. */
  is_locked: boolean;
}

async function loadUser(userId: number): Promise<UserTwoFactorRow> {
  const result = await query(
    `SELECT id, wallet_address, email, role, is_2fa_enabled, totp_secret,
            totp_pending_secret, two_factor_enabled_at, two_factor_locked_until,
            (two_factor_locked_until IS NOT NULL AND two_factor_locked_until > NOW())
              AS is_locked
       FROM users
      WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new TwoFactorError('User not found', 404, 'USER_NOT_FOUND');
  }

  return result.rows[0] as UserTwoFactorRow;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getStatus(userId: number): Promise<TwoFactorStatus> {
  const user = await loadUser(userId);
  const remaining = await query(
    'SELECT COUNT(*)::int AS count FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL',
    [userId]
  );

  return {
    enabled: Boolean(user.is_2fa_enabled),
    enabledAt: user.two_factor_enabled_at
      ? new Date(user.two_factor_enabled_at).toISOString()
      : null,
    setupPending: !user.is_2fa_enabled && Boolean(user.totp_pending_secret),
    recoveryCodesRemaining: remaining.rows[0]?.count ?? 0,
  };
}

/**
 * Step 1 of enrolment: mint a secret, store it as *pending*, and return the
 * otpauth URL plus a QR code for the authenticator app. 2FA stays disabled.
 */
export async function startSetup(userId: number): Promise<TwoFactorSetup> {
  const user = await loadUser(userId);

  if (user.is_2fa_enabled) {
    throw new TwoFactorError(
      '2FA is already enabled. Disable it before enrolling a new device.',
      409,
      'ALREADY_ENABLED'
    );
  }

  const secret = totp.generateSecret();
  const accountName = user.email || user.wallet_address || `user-${user.id}`;
  const otpauthUrl = totp.keyuri(accountName, config.TWO_FACTOR_ISSUER, secret);
  const qrCode = await QRCode.toDataURL(otpauthUrl);

  // A fresh setup restarts the handshake: any earlier pending secret and any
  // stale lockout are discarded.
  await query(
    `UPDATE users
        SET totp_pending_secret = $2,
            two_factor_failed_attempts = 0,
            two_factor_locked_until = NULL
      WHERE id = $1`,
    [userId, encryptSecret(secret)]
  );

  return { secret, otpauthUrl, qrCode };
}

/**
 * Step 2 of enrolment: verify a code from the pending secret, then enable 2FA
 * and issue exactly {@link RECOVERY_CODE_COUNT} recovery codes. The plaintext
 * codes are returned once here and never stored or logged.
 */
export async function confirmSetup(userId: number, code: string): Promise<string[]> {
  const user = await loadUser(userId);

  if (user.is_2fa_enabled) {
    throw new TwoFactorError('2FA is already enabled', 409, 'ALREADY_ENABLED');
  }

  if (!user.totp_pending_secret) {
    throw new TwoFactorError('Start 2FA setup before verifying a code', 400, 'SETUP_NOT_STARTED');
  }

  assertNotLocked(user.is_locked, user.two_factor_locked_until);

  if (!isTotpCodeShaped(code)) {
    await recordFailure(userId);
    throw new TwoFactorError('Invalid 2FA code', 401, 'INVALID_CODE');
  }

  const verified = await consumeTotpCode(userId, code, decryptSecret(user.totp_pending_secret));
  if (!verified) {
    await recordFailure(userId);
    throw new TwoFactorError('Invalid 2FA code', 401, 'INVALID_CODE');
  }

  const recoveryCodes = generateRecoveryCodes();

  await query(
    `UPDATE users
        SET totp_secret = totp_pending_secret,
            totp_pending_secret = NULL,
            is_2fa_enabled = TRUE,
            two_factor_enabled_at = NOW(),
            two_factor_failed_attempts = 0,
            two_factor_locked_until = NULL
      WHERE id = $1`,
    [userId]
  );

  // Re-enrolment starts from a clean set; codes from a previous enrolment are
  // meaningless once the secret changes.
  await query('DELETE FROM user_recovery_codes WHERE user_id = $1', [userId]);
  await query(
    `INSERT INTO user_recovery_codes (user_id, code_hash)
     SELECT $1, UNNEST($2::text[])`,
    [userId, recoveryCodes.map(hashRecoveryCode)]
  );

  return recoveryCodes;
}

/**
 * Verifies a second factor for an account that already has 2FA enabled. Accepts
 * either a TOTP code or one of the recovery codes, each usable only once.
 */
export async function verifySecondFactor(
  userId: number,
  code: string
): Promise<{ usedRecoveryCode: boolean }> {
  const user = await loadUser(userId);

  if (!user.is_2fa_enabled || !user.totp_secret) {
    throw new TwoFactorError('2FA is not enabled for this account', 400, 'NOT_ENABLED');
  }

  assertNotLocked(user.is_locked, user.two_factor_locked_until);

  if (typeof code !== 'string' || code.trim().length === 0) {
    await recordFailure(userId);
    throw new TwoFactorError('Invalid 2FA code', 401, 'INVALID_CODE');
  }

  // A six-digit value is a TOTP code; anything else is treated as a recovery
  // code, so the two never fall back onto each other.
  const usedRecoveryCode = !isTotpCodeShaped(code);
  const verified = usedRecoveryCode
    ? await consumeRecoveryCode(userId, code)
    : await consumeTotpCode(userId, code, decryptSecret(user.totp_secret));

  if (!verified) {
    await recordFailure(userId);
    throw new TwoFactorError('Invalid 2FA code', 401, 'INVALID_CODE');
  }

  await clearFailures(userId);
  return { usedRecoveryCode };
}

/**
 * Disables 2FA. Requires a current TOTP code — recovery codes are deliberately
 * not accepted here, so a leaked recovery code cannot strip the second factor.
 */
export async function disable(userId: number, code: string): Promise<void> {
  const user = await loadUser(userId);

  if (!user.is_2fa_enabled || !user.totp_secret) {
    throw new TwoFactorError('2FA is not enabled for this account', 400, 'NOT_ENABLED');
  }

  assertNotLocked(user.is_locked, user.two_factor_locked_until);

  if (!isTotpCodeShaped(code)) {
    await recordFailure(userId);
    throw new TwoFactorError('Invalid 2FA code', 401, 'INVALID_CODE');
  }

  const verified = await consumeTotpCode(userId, code, decryptSecret(user.totp_secret));
  if (!verified) {
    await recordFailure(userId);
    throw new TwoFactorError('Invalid 2FA code', 401, 'INVALID_CODE');
  }

  await query(
    `UPDATE users
        SET is_2fa_enabled = FALSE,
            totp_secret = NULL,
            totp_pending_secret = NULL,
            two_factor_enabled_at = NULL,
            totp_last_used_step = NULL,
            two_factor_failed_attempts = 0,
            two_factor_locked_until = NULL
      WHERE id = $1`,
    [userId]
  );

  await query('DELETE FROM user_recovery_codes WHERE user_id = $1', [userId]);
}

export const twoFactorService = {
  RECOVERY_CODE_COUNT,
  getStatus,
  startSetup,
  confirmSetup,
  verifySecondFactor,
  disable,
};

export default twoFactorService;
