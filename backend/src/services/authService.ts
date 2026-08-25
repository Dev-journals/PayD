import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

/**
 * Token kinds carried in the `typ` claim.
 *
 * A challenge token is handed out after a password/wallet check when the
 * account still owes a second factor. It is signed with the same secret as an
 * access token, so `typ` is what keeps the two apart: `authenticateJWT` rejects
 * anything that is not an access token, which stops a challenge token from
 * being replayed against the rest of the API.
 */
export const TOKEN_TYPE_ACCESS = 'access';
export const TOKEN_TYPE_2FA_CHALLENGE = '2fa_challenge';

/** How long an admin has to enter their TOTP code before re-authenticating. */
export const TWO_FACTOR_CHALLENGE_TTL = '5m';

export interface TwoFactorChallengeClaims {
  id: number;
  typ: typeof TOKEN_TYPE_2FA_CHALLENGE;
}

export const generateToken = (user: any) => {
  return jwt.sign(
    {
      id: user.id,
      walletAddress: user.wallet_address ?? user.walletAddress ?? null,
      email: user.email ?? null,
      organizationId: user.organization_id ?? user.organizationId ?? null,
      role: user.role,
      typ: TOKEN_TYPE_ACCESS,
    },
    config.JWT_SECRET,
    { expiresIn: '1h' }
  );
};

export const generateRefreshToken = (user: any) => {
  return jwt.sign({ id: user.id }, config.JWT_REFRESH_SECRET, { expiresIn: '7d' });
};

/**
 * Issues the short-lived token that binds the second-factor step to the
 * identity that just completed the first factor. It grants no API access.
 */
export const generateTwoFactorChallengeToken = (userId: number) => {
  return jwt.sign({ id: userId, typ: TOKEN_TYPE_2FA_CHALLENGE }, config.JWT_SECRET, {
    expiresIn: TWO_FACTOR_CHALLENGE_TTL,
  });
};

/**
 * Verifies a challenge token and returns the user id it was minted for, or
 * `null` when the token is missing, expired, tampered with, or of another kind.
 */
export const verifyTwoFactorChallengeToken = (token: unknown): number | null => {
  if (typeof token !== 'string' || token.length === 0) return null;

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as Partial<TwoFactorChallengeClaims>;
    if (decoded?.typ !== TOKEN_TYPE_2FA_CHALLENGE || typeof decoded.id !== 'number') {
      return null;
    }
    return decoded.id;
  } catch {
    return null;
  }
};
