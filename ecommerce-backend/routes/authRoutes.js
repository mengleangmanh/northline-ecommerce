import { Router } from 'express'
import passport from 'passport'

import {
  register,
  login,
  logoutAll,
  getMe,
  updateProfile,
  listUsers,
  listProviders,
  socialSuccess,
  socialFailure,
  safeRedirect,
} from '../controllers/authController.js'
import { protect, challengeAuth } from '../middleware/authMiddleware.js'
import { admin } from '../middleware/adminMiddleware.js'
import { isProviderEnabled } from '../config/passport.js'
import { authLimiter, registerLimiter } from '../middleware/securityMiddleware.js'
import {
  twoFactorStatus,
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  verifyTwoFactor,
  regenerateRecoveryCodes,
} from '../controllers/twoFactorController.js'

const router = Router()

/**
 * Public, and rate limited.
 *
 * These two are the most attacked endpoints on any site, so they get their own
 * budgets rather than relying on the global one. authLimiter only counts
 * failures, so a legitimate person is never blocked no matter how often they
 * sign in.
 */
router.post('/register', registerLimiter, register)
router.post('/login', authLimiter, login)
router.get('/providers', listProviders)

/**
 * Wires up the two-request dance that every OAuth login is:
 *
 *   GET /api/auth/<provider>           -> 302 to Google/Facebook
 *   GET /api/auth/<provider>/callback  -> they send the browser back here
 *
 * Both are plain browser navigations, not fetch/axios calls. An OAuth login
 * has to leave your site and come back, and XHR cannot follow a redirect to
 * another origin.
 */
function mountProvider(name, scope) {
  if (!isProviderEnabled(name)) {
    router.get(`/${name}`, (_req, res) =>
      res.status(503).json({
        message: `${name} sign-in is not configured on this server`,
      }),
    )
    return
  }

  // Step 1 - send the user off to the provider.
  router.get(`/${name}`, authLimiter, (req, res, next) => {
    passport.authenticate(name, {
      scope,
      session: false,
      // `state` survives the round trip untouched. safeRedirect() strips
      // anything that is not a path on our own site, so this cannot be turned
      // into an open redirect that leaks the token to another domain.
      state: safeRedirect(req.query.redirect),
      ...(name === 'google' ? { prompt: 'select_account' } : {}),
    })(req, res, next)
  })

  // Step 2 - the provider sends them back with a code, passport swaps it for a
  // profile, and our verify callback finds or creates the user.
  router.get(`/${name}/callback`, (req, res, next) => {
    passport.authenticate(name, { session: false }, (err, user) => {
      if (err || !user) return socialFailure(req, res, err)
      req.user = user
      return socialSuccess(req, res)
    })(req, res, next)
  })
}

mountProvider('google', ['profile', 'email'])
mountProvider('facebook', ['email'])

// Private - any signed-in user
router.get('/me', protect, getMe)
router.put('/me', protect, updateProfile)

// Ends every session for this account, including the one making the request.
router.post('/logout-all', protect, logoutAll)

/**
 * Two-factor authentication.
 *
 * /verify is the odd one out: it uses challengeAuth, not protect, because the
 * person calling it is halfway through signing in and has no access token yet.
 * It carries authLimiter for the same reason /login does - six digits is only
 * a million combinations, and the per-account lockout in the User model is the
 * second half of that defence.
 *
 * Everything else is a settings change and needs a full session.
 */
router.post('/2fa/verify', authLimiter, challengeAuth, verifyTwoFactor)

router.get('/2fa/status', protect, twoFactorStatus)
router.post('/2fa/setup', protect, authLimiter, setupTwoFactor)
router.post('/2fa/enable', protect, authLimiter, enableTwoFactor)
router.post('/2fa/disable', protect, authLimiter, disableTwoFactor)
router.post('/2fa/recovery-codes', protect, authLimiter, regenerateRecoveryCodes)

// Admin only. `protect` must come first so req.user exists for `admin`.
router.get('/users', protect, admin, listUsers)

export default router
