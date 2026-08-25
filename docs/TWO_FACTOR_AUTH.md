# Two-Factor Authentication for Admin Accounts

PayD admin accounts hold elevated privileges — payroll execution, employee management, organization settings — so they can be protected with a TOTP second factor (RFC 6238), compatible with Google Authenticator, 1Password, Aegis, and any other standard authenticator app.

## Who can enrol

Enrolment endpoints are limited to the privileged roles: `ADMIN` and `EMPLOYER`. `EMPLOYER` is the role that actually carries admin privileges throughout the codebase (payroll, employees, schedules, assets), and `ADMIN` is now a usable role — migration `029` widened the `users.role` CHECK constraint, which previously rejected it.

The account being modified always comes from the verified JWT, never from the request body, so no caller can enrol or disable 2FA on someone else's account.

## Enrolment is a two-step handshake

Setup never enables 2FA on its own. The secret is parked in `users.totp_pending_secret` and is only promoted to `users.totp_secret` once a code from the authenticator is verified, so an abandoned setup leaves the account exactly as it was.

```
POST /api/auth/2fa/setup      → { qrCode, otpauthUrl, secret }   (2FA still off)
POST /api/auth/2fa/verify     → { recoveryCodes: [8 codes] }     (2FA now on)
```

The eight recovery codes are returned exactly once, by `/2fa/verify`. Only their SHA-256 hashes are stored.

## Login requires the second factor

`POST /api/auth/login` does not issue a session for an account with 2FA enabled. It returns a short-lived (5 minute) challenge token instead, which is exchanged for a real session only alongside a valid code:

```
POST /api/auth/login              → { requires2fa: true, challengeToken }
POST /api/auth/2fa/authenticate   → { accessToken, refreshToken, ... }
```

The OAuth callbacks (`/auth/google/callback`, `/auth/github/callback`) follow the same rule — an admin with 2FA enabled is redirected to `/auth-callback?requires2fa=1&challengeToken=…` rather than handed a token, so signing in with a social provider cannot sidestep the second factor.

Challenge tokens are signed with `JWT_SECRET` like access tokens, so they carry a `typ` claim to keep them apart. `authenticateJWT` rejects any token whose `typ` is not `access`, which stops a challenge token being replayed against the rest of the API. Tokens minted before `typ` existed are still accepted.

## Endpoints

| Method | Path                          | Auth              | Purpose                                              |
| ------ | ----------------------------- | ----------------- | ---------------------------------------------------- |
| `POST` | `/api/auth/2fa/setup`         | JWT + admin role  | Start enrolment; returns QR code and otpauth URL      |
| `POST` | `/api/auth/2fa/verify`        | JWT + admin role  | Confirm a code, enable 2FA, return 8 recovery codes   |
| `POST` | `/api/auth/2fa/disable`       | JWT + admin role  | Disable 2FA; requires a current TOTP code             |
| `GET`  | `/api/auth/2fa/status`        | JWT               | Enrolment state and unused recovery-code count        |
| `POST` | `/api/auth/2fa/authenticate`  | challenge token   | Second step of login; returns access/refresh tokens   |

`/2fa/authenticate` accepts either a 6-digit TOTP code or a recovery code in the `code` field. Everything else accepts TOTP codes only.

Disabling deliberately refuses recovery codes: a leaked recovery code should let its owner back in, not let anyone strip the second factor off the account.

## Step-up for sensitive operations

`require2FA` (applied to the SEP-31 and SEP-24 payment routes) lets accounts without 2FA through and requires a fresh code in the `x-2fa-token` header from accounts that have it enabled. The code is consumed on use, so the same header cannot be replayed on a second request; a caller making back-to-back sensitive requests needs a new code for each.

## Security properties

- **Secrets encrypted at rest.** TOTP secrets are stored as AES-256-GCM ciphertext (`v1.<iv>.<tag>.<ciphertext>`), keyed by `TWO_FACTOR_ENCRYPTION_KEY` and falling back to `JWT_SECRET` for local development. Set a dedicated key in production.
- **Recovery codes are single-use hashes.** Codes live in `user_recovery_codes` as SHA-256 hashes and are redeemed by an `UPDATE … WHERE used_at IS NULL`, so a code cannot be redeemed twice even under concurrent requests.
- **TOTP codes are single-use.** `users.totp_last_used_step` records the highest time step already spent; a code is accepted only when its step is strictly greater, which closes the replay window a code would otherwise have for the rest of its 30-second period.
- **Clock drift.** One step (30 seconds) either side of the current one is accepted.
- **Brute-force lockout.** Five consecutive failures lock verification for 15 minutes; a success clears the counter, and an expired lockout restarts the count rather than leaving the account one mistake from the next. Whether an account is currently locked is decided by Postgres (`two_factor_locked_until > NOW()`), never by comparing the timestamp in Node — `two_factor_locked_until` is `TIMESTAMPTZ` for the same reason. A bare `TIMESTAMP` comes back through node-pg parsed as local time, which on a server east of UTC lands in the past and silently disables the lockout entirely.
- **Nothing sensitive is logged.** Secrets, recovery codes, and submitted codes never reach the logs, and failures are reported as a generic `INVALID_CODE` so they do not distinguish "wrong code" from "no such enrolment".

## Configuration

| Variable                    | Default              | Purpose                                          |
| --------------------------- | -------------------- | ------------------------------------------------ |
| `TWO_FACTOR_ENCRYPTION_KEY` | falls back to `JWT_SECRET` | Key material for encrypting TOTP secrets   |
| `TWO_FACTOR_ISSUER`         | `PayD`               | Issuer name shown in the authenticator app       |

## Migration notes

Migration `029_admin_two_factor_auth.sql`:

- widens the `users.role` CHECK constraint to include `ADMIN`;
- adds `totp_pending_secret`, `two_factor_enabled_at`, `totp_last_used_step`, `two_factor_failed_attempts`, `two_factor_locked_until` (the timestamp columns are `TIMESTAMPTZ`, see the lockout note above);
- creates `user_recovery_codes` and drops the plaintext `users.recovery_codes` array;
- clears any pre-existing plaintext `totp_secret`, since those predate encryption at rest. Affected admins re-run setup from **Settings → Two-Factor Authentication**.
