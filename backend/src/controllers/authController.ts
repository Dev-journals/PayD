import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { query } from '../config/database.js';
import {
  generateRefreshToken,
  generateToken,
  generateTwoFactorChallengeToken,
  verifyTwoFactorChallengeToken,
} from '../services/authService.js';
import {
  RECOVERY_CODE_COUNT,
  TwoFactorError,
  confirmSetup,
  disable as disableTwoFactor,
  getStatus,
  startSetup,
  verifySecondFactor,
} from '../services/twoFactorService.js';

/**
 * Translates a {@link TwoFactorError} into its HTTP response. Anything else is
 * reported as a generic 500 so internal details never reach the client.
 */
function sendTwoFactorError(res: express.Response, error: unknown) {
  if (error instanceof TwoFactorError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }

  console.error('2FA operation failed:', error);
  return res.status(500).json({ error: 'Internal server error' });
}

/** Issues an access/refresh pair and persists the refresh token. */
async function issueSession(user: {
  id: number;
  wallet_address: string | null;
  email?: string | null;
  organization_id: number | null;
  role: string;
}) {
  const accessToken = generateToken(user);
  const refreshToken = generateRefreshToken(user);

  await query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, user.id]);

  return { accessToken, refreshToken };
}

export class AuthController {
  /**
   * POST /api/auth/2fa/setup
   * Starts enrolment for the authenticated admin: mints a secret, stores it as
   * pending, and returns the QR code to scan. 2FA is not enabled until the
   * admin confirms a code via `/2fa/verify`.
   */
  static async setup2fa(req: express.Request, res: express.Response) {
    try {
      const { secret, otpauthUrl, qrCode } = await startSetup(req.user!.id);
      return res.json({ qrCode, otpauthUrl, secret });
    } catch (error) {
      return sendTwoFactorError(res, error);
    }
  }

  /**
   * POST /api/auth/2fa/verify
   * Completes enrolment for the authenticated admin. On success 2FA is enabled
   * and the recovery codes are returned — this is the only time they are shown.
   */
  static async verify2fa(req: express.Request, res: express.Response) {
    const { token, code } = req.body ?? {};
    const submitted = code ?? token;

    if (!submitted) {
      return res.status(400).json({ error: 'Missing 2FA code' });
    }

    try {
      const recoveryCodes = await confirmSetup(req.user!.id, submitted);
      return res.json({
        success: true,
        enabled: true,
        recoveryCodes,
        recoveryCodeCount: RECOVERY_CODE_COUNT,
        message: '2FA enabled. Store these recovery codes somewhere safe — they are shown once.',
      });
    } catch (error) {
      return sendTwoFactorError(res, error);
    }
  }

  /**
   * POST /api/auth/2fa/disable
   * Turns 2FA off for the authenticated admin. Requires a current TOTP code;
   * recovery codes are not accepted for this operation.
   */
  static async disable2fa(req: express.Request, res: express.Response) {
    const { token, code } = req.body ?? {};
    const submitted = code ?? token;

    if (!submitted) {
      return res.status(400).json({ error: 'Missing 2FA code' });
    }

    try {
      await disableTwoFactor(req.user!.id, submitted);
      return res.json({ success: true, enabled: false, message: '2FA disabled' });
    } catch (error) {
      return sendTwoFactorError(res, error);
    }
  }

  /**
   * GET /api/auth/2fa/status
   * Reports enrolment state for the authenticated user. Never exposes the
   * secret or any recovery code.
   */
  static async status2fa(req: express.Request, res: express.Response) {
    try {
      return res.json(await getStatus(req.user!.id));
    } catch (error) {
      return sendTwoFactorError(res, error);
    }
  }

  /**
   * POST /api/auth/2fa/authenticate
   * Second step of login. Exchanges the challenge token from `/login` plus a
   * TOTP or recovery code for a real session.
   */
  static async authenticate2fa(req: express.Request, res: express.Response) {
    const { challengeToken, code, token } = req.body ?? {};
    const submitted = code ?? token;

    if (!challengeToken || !submitted) {
      return res.status(400).json({ error: 'Missing challenge token or 2FA code' });
    }

    const userId = verifyTwoFactorChallengeToken(challengeToken);
    if (userId === null) {
      return res.status(401).json({ error: 'Invalid or expired 2FA challenge. Log in again.' });
    }

    try {
      const { usedRecoveryCode } = await verifySecondFactor(userId, submitted);

      const result = await query(
        'SELECT id, wallet_address, email, organization_id, role FROM users WHERE id = $1',
        [userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const remaining = await query(
        'SELECT COUNT(*)::int AS count FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL',
        [userId]
      );

      const session = await issueSession(result.rows[0]);

      return res.json({
        success: true,
        ...session,
        usedRecoveryCode,
        recoveryCodesRemaining: remaining.rows[0]?.count ?? 0,
      });
    } catch (error) {
      return sendTwoFactorError(res, error);
    }
  }

  /**
   * POST /api/auth/login
   * Wallet-based login. When the account has 2FA enabled no session is issued;
   * the caller gets a short-lived challenge to complete at
   * `/api/auth/2fa/authenticate`.
   */
  static async login(req: express.Request, res: express.Response) {
    const { walletAddress } = req.body ?? {};
    if (!walletAddress) {
      return res.status(400).json({ error: 'Missing walletAddress' });
    }

    try {
      const result = await query(
        'SELECT id, wallet_address, email, organization_id, role, is_2fa_enabled FROM users WHERE wallet_address = $1',
        [walletAddress]
      );

      if (result.rows.length === 0) {
        // For demo purposes, auto-register as EMPLOYEE if not found
        // In production, this would be a separate registration flow
        const insertResult = await query(
          'INSERT INTO users (wallet_address, role) VALUES ($1, $2) RETURNING *',
          [walletAddress, 'EMPLOYEE']
        );
        return res.json({ accessToken: generateToken(insertResult.rows[0]) });
      }

      const user = result.rows[0];
      if (user.is_2fa_enabled) {
        return res.json({
          requires2fa: true,
          challengeToken: generateTwoFactorChallengeToken(user.id),
        });
      }

      return res.json(await issueSession(user));
    } catch (error: any) {
      console.error('Login failed:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Shared handler for the OAuth callbacks. Passport has already established
   * the first factor at this point, so an account with 2FA enabled is sent back
   * with a challenge instead of a session — otherwise an admin could sidestep
   * their second factor simply by signing in with Google or GitHub.
   */
  static oauthCallback(req: express.Request, res: express.Response) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const user = req.user as (express.User & { is_2fa_enabled?: boolean }) | undefined;

    if (!user) {
      return res.redirect(`${frontendUrl}/login?error=oauth_failed`);
    }

    if (user.is_2fa_enabled) {
      const challengeToken = generateTwoFactorChallengeToken(user.id);
      return res.redirect(
        `${frontendUrl}/auth-callback?requires2fa=1&challengeToken=${encodeURIComponent(challengeToken)}`
      );
    }

    return res.redirect(
      `${frontendUrl}/auth-callback?token=${encodeURIComponent(generateToken(user))}`
    );
  }

  /**
   * POST /api/auth/refresh
   * Refreshes access token using a valid refresh token.
   */
  static async refresh(req: express.Request, res: express.Response) {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) {
      return res.status(400).json({ error: 'Missing refresh token' });
    }

    try {
      const decoded = jwt.verify(refreshToken, config.JWT_REFRESH_SECRET) as { id: number };
      const result = await query(
        'SELECT id, wallet_address, email, organization_id, role, refresh_token FROM users WHERE id = $1',
        [decoded.id]
      );

      if (result.rows.length === 0 || result.rows[0].refresh_token !== refreshToken) {
        return res.status(401).json({ error: 'Invalid refresh token' });
      }

      return res.json({ accessToken: generateToken(result.rows[0]) });
    } catch (error) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
  }
}
