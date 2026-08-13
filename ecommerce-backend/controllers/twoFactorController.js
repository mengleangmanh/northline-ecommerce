import User from '../models/User.js'
import { asyncHandler } from '../middleware/errorMiddleware.js'
import generateToken from '../utils/generateToken.js'
import { publicUser } from './authController.js'
import { logSecurityEvent, SECURITY_EVENTS } from '../models/SecurityEvent.js'
import {
  generateSecret,
  verifyCode,
  otpauthUri,
  formatSecretForDisplay,
} from '../utils/totp.js'
import {
  issueRecoveryCodes,
  consumeRecoveryCode,
  countUnusedCodes,
} from '../models/RecoveryCode.js'
import Cart from '../models/Cart.js'

const ISSUER = process.env.TOTP_ISSUER || 'Northline'

/**
 * Render the enrolment URI as a scannable QR image.
 *
 * Imported dynamically inside a try/catch rather than at the top of the file,
 * so that a missing `qrcode` package degrades to "type this secret in by hand"
 * instead of crashing the server on boot. Manual entry is always offered
 * anyway - some people use a desktop authenticator with no camera.
 */
async function renderQr(uri) {
  try {
    const QRCode = await import('qrcode')
    return await (QRCode.default || QRCode).toDataURL(uri, {
      margin: 1,
      width: 240,
      color: { dark: '#2c2c2b', light: '#ffffff' },
    })
  } catch {
    return null
  }
}

/**
 * Re-check the password before changing anything about 2FA.
 *
 * Without this, a stolen access token is enough to bind an attacker's own
 * authenticator app to someone else's account, or to switch 2FA off entirely -
 * which would make the whole feature decorative. Every security setting worth
 * having asks for the password again at the moment it changes.
 *
 * Accounts created through Google or Facebook have no password to check. They
 * are protected by the provider's own login instead, which is the trade you
 * accept by offering social sign-in at all.
 */
async function confirmPassword(user, password) {
  if (!user.hasPassword()) return { ok: true }

  if (!password) {
    return { ok: false, status: 400, message: 'Enter your password to change this setting' }
  }
  if (!(await user.matchPassword(String(password)))) {
    return { ok: false, status: 401, message: 'That password is not correct' }
  }

  return { ok: true }
}

// GET /api/auth/2fa/status
export const twoFactorStatus = asyncHandler(async (req, res) => {
  res.json({
    enabled: req.user.twoFactorEnabled,
    confirmedAt: req.user.twoFactorConfirmedAt,
    recoveryCodesLeft: req.user.twoFactorEnabled ? await countUnusedCodes(req.user.id) : 0,
  })
})

/**
 * POST /api/auth/2fa/setup
 *
 * Generates a secret and stores it, but does NOT switch 2FA on. Nothing about
 * how this account logs in changes until a working code proves the phone and
 * the server agree.
 *
 * That ordering is the whole safety of enrolment. Turning 2FA on at this point
 * and asking for a code afterwards would lock out anyone who mistyped the
 * secret, scanned the wrong QR, or closed the tab.
 */
export const setupTwoFactor = asyncHandler(async (req, res) => {
  const user = await User.scope('withPassword').findByPk(req.user.id)

  if (user.twoFactorEnabled) {
    return res.status(409).json({
      message: 'Two-factor authentication is already on. Turn it off first if you want to move it to a new phone.',
    })
  }

  const check = await confirmPassword(user, req.body.password)
  if (!check.ok) return res.status(check.status).json({ message: check.message })

  // A brand new secret every time someone starts setup. Reusing a half-
  // finished one would mean an abandoned attempt - possibly on a shared or
  // compromised machine - stays valid indefinitely.
  const secret = generateSecret()

  user.twoFactorSecret = secret
  user.twoFactorEnabled = false
  user.twoFactorLastStep = null
  await user.save()

  const uri = otpauthUri({ secret, account: user.email, issuer: ISSUER })

  res.json({
    secret,
    // Grouped in fours for anyone typing it in by hand.
    secretFormatted: formatSecretForDisplay(secret),
    uri,
    qrDataUrl: await renderQr(uri),
  })
})

/**
 * POST /api/auth/2fa/enable
 *
 * The code proves three things at once: the secret transferred correctly, the
 * phone's clock is close enough to the server's, and the person setting this
 * up is holding the device.
 */
export const enableTwoFactor = asyncHandler(async (req, res) => {
  const user = await User.scope('withPassword').findByPk(req.user.id)

  if (user.twoFactorEnabled) {
    return res.status(409).json({ message: 'Two-factor authentication is already on' })
  }
  if (!user.twoFactorSecret) {
    return res.status(400).json({ message: 'Start the setup again - there is no pending secret' })
  }

  const step = verifyCode(user.twoFactorSecret, req.body.code)

  if (step === null) {
    await user.registerFailedTwoFactor()
    logSecurityEvent(SECURITY_EVENTS.TWOFA_FAIL, req, { userId: user.id, detail: 'during setup' })

    return res.status(400).json({
      message: 'That code is not right. Check your phone\u2019s clock is set automatically, then try the next code.',
    })
  }

  user.twoFactorEnabled = true
  user.twoFactorConfirmedAt = new Date()
  user.twoFactorLastStep = step
  user.twoFactorFailedCount = 0
  await user.save()

  /**
   * Recovery codes are issued in the same breath as switching 2FA on, and
   * this is the only time they are ever readable. They are stored as keyed
   * hashes, so if the user closes this screen without saving them, nothing on
   * the server can show them again - only regenerate a new set.
   */
  const recoveryCodes = await issueRecoveryCodes(user.id)

  logSecurityEvent(SECURITY_EVENTS.TWOFA_ENABLED, req, { userId: user.id })

  res.json({
    enabled: true,
    recoveryCodes,
    message: 'Two-factor authentication is on. Save these backup codes somewhere safe.',
  })
})

/**
 * POST /api/auth/2fa/disable
 *
 * Deliberately requires both the password and a current code. Someone who has
 * walked up to an unlocked laptop has the session but not the phone, and
 * turning the second factor off is exactly the first thing they would try.
 */
export const disableTwoFactor = asyncHandler(async (req, res) => {
  const user = await User.scope('withPassword').findByPk(req.user.id)

  if (!user.twoFactorEnabled) {
    return res.status(400).json({ message: 'Two-factor authentication is not on' })
  }

  const check = await confirmPassword(user, req.body.password)
  if (!check.ok) return res.status(check.status).json({ message: check.message })

  const step = verifyCode(user.twoFactorSecret, req.body.code)
  const usedRecovery = step === null && (await consumeRecoveryCode(user.id, req.body.code, req.ip))

  if (step === null && !usedRecovery) {
    await user.registerFailedTwoFactor()
    return res.status(400).json({ message: 'That code is not right' })
  }

  user.twoFactorEnabled = false
  user.twoFactorSecret = null
  user.twoFactorConfirmedAt = null
  user.twoFactorLastStep = null
  user.twoFactorFailedCount = 0
  await user.save()

  // The unused backup codes are now pointless, and leaving live secrets lying
  // in a table is how they end up in a leak years later.
  await issueRecoveryCodes(user.id, 0)

  logSecurityEvent(SECURITY_EVENTS.TWOFA_DISABLED, req, { userId: user.id })

  res.json({ enabled: false, message: 'Two-factor authentication is off.' })
})

/**
 * POST /api/auth/2fa/verify
 *
 * The second half of a login. Reached with a challenge token, which proves the
 * password was already accepted, and returns a real access token.
 */
export const verifyTwoFactor = asyncHandler(async (req, res) => {
  const user = req.user // set by challengeAuth, loaded withPassword

  if (!user.hasTwoFactor()) {
    // Someone turned 2FA off in another tab mid-login. Nothing is wrong; just
    // finish the sign-in.
    return res.json({ user: publicUser(user), token: generateToken(user) })
  }

  const submitted = String(req.body.code || '').trim()
  if (!submitted) return res.status(400).json({ message: 'Enter your authentication code' })

  const step = verifyCode(user.twoFactorSecret, submitted)

  /**
   * Refuse a code that has already been spent.
   *
   * A valid code lives for up to 90 seconds across the drift window. Without
   * this check, six digits captured by a phishing proxy or read over a
   * shoulder can be replayed inside that window - which quietly removes the
   * "one-time" from one-time password.
   */
  if (step !== null && user.isReplayedStep(step)) {
    logSecurityEvent(SECURITY_EVENTS.TWOFA_FAIL, req, { userId: user.id, detail: 'replayed code' })
    return res.status(400).json({
      message: 'That code has already been used. Wait for your app to show the next one.',
    })
  }

  if (step !== null) {
    await user.recordTwoFactorSuccess(step)
  } else {
    // Not a valid code - it may still be a backup code. Checking this second
    // means a normal typo never burns one.
    const recovered = await consumeRecoveryCode(user.id, submitted, req.ip)

    if (!recovered) {
      await user.registerFailedTwoFactor()
      logSecurityEvent(SECURITY_EVENTS.TWOFA_FAIL, req, { userId: user.id })

      return res.status(401).json({ message: 'That code is not right' })
    }

    const left = await countUnusedCodes(user.id)
    logSecurityEvent(SECURITY_EVENTS.RECOVERY_USED, req, {
      userId: user.id,
      detail: `${left} left`,
    })

    res.set('X-Recovery-Codes-Left', String(left))
  }

  // The login is only complete now, so this is where it gets recorded.
  await user.registerSuccessfulLogin(req.ip)
  await Cart.findOrCreate({ where: { userId: user.id } })

  logSecurityEvent(SECURITY_EVENTS.TWOFA_OK, req, { userId: user.id })

  res.json({
    user: publicUser(user),
    token: generateToken(user),
    recoveryCodesLeft: await countUnusedCodes(user.id),
  })
})

/**
 * POST /api/auth/2fa/recovery-codes
 *
 * Issues a fresh set and destroys the old one. Regenerating has to invalidate
 * the previous batch: the usual reason for asking is that the old printout was
 * lost or seen by someone.
 */
export const regenerateRecoveryCodes = asyncHandler(async (req, res) => {
  const user = await User.scope('withPassword').findByPk(req.user.id)

  if (!user.twoFactorEnabled) {
    return res.status(400).json({ message: 'Turn on two-factor authentication first' })
  }

  const check = await confirmPassword(user, req.body.password)
  if (!check.ok) return res.status(check.status).json({ message: check.message })

  const step = verifyCode(user.twoFactorSecret, req.body.code)
  if (step === null) {
    await user.registerFailedTwoFactor()
    return res.status(400).json({ message: 'That code is not right' })
  }

  const recoveryCodes = await issueRecoveryCodes(user.id)

  logSecurityEvent(SECURITY_EVENTS.RECOVERY_REGENERATED, req, { userId: user.id })

  res.json({
    recoveryCodes,
    message: 'New backup codes issued. The old ones no longer work.',
  })
})
