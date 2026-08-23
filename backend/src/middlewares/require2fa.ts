import { Request, Response, NextFunction } from 'express';
import { TwoFactorError, verifySecondFactor } from '../services/twoFactorService.js';
import { query } from '../config/database.js';

/**
 * Step-up check for sensitive operations (payouts, withdrawals).
 *
 * Accounts without 2FA pass straight through; accounts with 2FA enabled must
 * present a fresh code in the `x-2fa-token` header. The code is consumed on
 * success, so replaying the same header on a second request is rejected.
 *
 * Must run after `authenticateJWT` — the account comes from the verified JWT,
 * never from a client-supplied wallet address.
 */
export const require2FA = async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const result = await query('SELECT is_2fa_enabled FROM users WHERE id = $1', [userId]);

    if (result.rows.length === 0 || !result.rows[0].is_2fa_enabled) {
      return next();
    }

    const token = req.headers['x-2fa-token'];
    if (typeof token !== 'string' || token.length === 0) {
      return res.status(401).json({
        error: 'This operation requires a 2FA code in the x-2fa-token header',
        code: 'TWO_FACTOR_REQUIRED',
      });
    }

    await verifySecondFactor(userId, token);
    return next();
  } catch (error) {
    if (error instanceof TwoFactorError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }

    console.error('2FA step-up check failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
