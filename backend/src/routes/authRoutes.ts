import { Router } from 'express';
import passport from 'passport';
import { AuthController } from '../controllers/authController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { authorizeRoles } from '../middlewares/rbac.js';
import { TWO_FACTOR_ROLES } from '../services/twoFactorService.js';

const router = Router();

router.post('/login', AuthController.login);
router.post('/refresh', AuthController.refresh);

// ── Two-factor authentication ──────────────────────────────────────────────
//
// Enrolment endpoints are account settings, so they run on the caller's own
// session and are limited to the privileged roles the feature targets. The
// account is always taken from the verified JWT, never from the request body,
// so nobody can enrol or disable 2FA on someone else's account.

// Second step of login: exchanges the challenge issued by /login for a session.
// Unauthenticated by design — the challenge token is the credential.
router.post('/2fa/authenticate', AuthController.authenticate2fa);

router.get('/2fa/status', authenticateJWT, AuthController.status2fa);

router.post(
  '/2fa/setup',
  authenticateJWT,
  authorizeRoles(...TWO_FACTOR_ROLES),
  AuthController.setup2fa
);
router.post(
  '/2fa/verify',
  authenticateJWT,
  authorizeRoles(...TWO_FACTOR_ROLES),
  AuthController.verify2fa
);
router.post(
  '/2fa/disable',
  authenticateJWT,
  authorizeRoles(...TWO_FACTOR_ROLES),
  AuthController.disable2fa
);

// Google Auth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login' }),
  AuthController.oauthCallback
);

// GitHub Auth
router.get('/github', passport.authenticate('github', { scope: ['user:email'] }));

router.get(
  '/github/callback',
  passport.authenticate('github', { session: false, failureRedirect: '/login' }),
  AuthController.oauthCallback
);

export default router;
