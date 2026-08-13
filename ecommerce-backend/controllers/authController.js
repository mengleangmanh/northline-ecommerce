import bcrypt from 'bcryptjs'

import User from '../models/User.js'
import Cart from '../models/Cart.js'
import generateToken, { generateChallengeToken } from '../utils/generateToken.js'
import { asyncHandler } from '../middleware/errorMiddleware.js'
import { enabledProviders } from '../config/passport.js'
import { checkPassword } from '../utils/password.js'
import { cleanText, cleanEmail } from '../utils/sanitize.js'
import { logSecurityEvent, SECURITY_EVENTS } from '../models/SecurityEvent.js'

const CLIENT_URL = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')[0]
  .replace(/\/+$/, '')

export function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    phone: u.phone,
    address: u.address,
    city: u.city,
    country: u.country,
    provider: u.provider,
    avatar: u.avatar,
    emailVerified: u.emailVerified,
    hasPassword: Boolean(u.password),
    twoFactorEnabled: Boolean(u.twoFactorEnabled),
    lastLoginAt: u.lastLoginAt,
  }
}

const normaliseEmail = value => cleanEmail(value)

const PROVIDER_LABEL = { google: 'Google', facebook: 'Facebook', local: 'email and password' }

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * A throwaway hash to compare against when the email does not exist.
 *
 * Without this, a login for an unknown address returns in about a
 * millisecond, while a known address with the wrong password takes the ~800ms
 * bcrypt needs. Anyone can time the difference and use your login form to work
 * out which of a list of email addresses have accounts here. Doing the same
 * pointless work in both cases removes the signal.
 *
 * Built lazily so it does not add a second to server startup.
 */
let dummyHash = null
async function equaliseTiming(password) {
  if (!dummyHash) dummyHash = await bcrypt.hash('timing-equalisation-placeholder', 12)
  await bcrypt.compare(String(password || ''), dummyHash)
}

// ---------------------------------------------------------------------------
// Email + password
// ---------------------------------------------------------------------------

// POST /api/auth/register
export const register = asyncHandler(async (req, res) => {
  const name = cleanText(req.body.name, 120)
  const email = normaliseEmail(req.body.email)
  const { password } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required' })
  }
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ message: 'That email address does not look valid' })
  }

  const passwordProblem = checkPassword(password, { email, name })
  if (passwordProblem) {
    return res.status(400).json({ message: passwordProblem, field: 'password' })
  }

  const exists = await User.scope('withPassword').findOne({ where: { email } })
  if (exists) {
    if (!exists.password && exists.provider !== 'local') {
      return res.status(409).json({
        message: `That email already has an account created with ${PROVIDER_LABEL[exists.provider]}. Use that button to sign in.`,
        provider: exists.provider,
      })
    }
    return res.status(409).json({ message: 'That email is already registered' })
  }

  // The role is hard-coded. It is never read from the request body, because
  // `role: "admin"` in a signup payload is the single most common way a
  // hobby project gets taken over.
  const user = await User.create({ name, email, password, provider: 'local', role: 'customer' })
  await Cart.findOrCreate({ where: { userId: user.id } })

  logSecurityEvent(SECURITY_EVENTS.REGISTER, req, { userId: user.id })

  res.status(201).json({ user: publicUser(user), token: generateToken(user) })
})

// POST /api/auth/login
export const login = asyncHandler(async (req, res) => {
  const email = normaliseEmail(req.body.email)
  const password = String(req.body.password || '')

  const user = await User.scope('withPassword').findOne({ where: { email } })

  if (!user) {
    await equaliseTiming(password)
    logSecurityEvent(SECURITY_EVENTS.LOGIN_FAIL, req, { detail: 'unknown email' })
    return res.status(401).json({ message: 'Invalid email or password' })
  }

  // Check the lock before checking the password. Otherwise a locked account
  // still tells an attacker when they finally guess right.
  if (user.isLocked()) {
    logSecurityEvent(SECURITY_EVENTS.LOGIN_LOCKED, req, { userId: user.id })
    return res.status(423).json({
      message: `Too many failed attempts. This account is locked for ${user.lockMinutesRemaining()} more minute(s).`,
      lockedMinutes: user.lockMinutesRemaining(),
    })
  }

  // An account with no password at all cannot sign in here. Telling this
  // person "invalid email or password" would leave them retyping a password
  // they never set. This does confirm the address exists - a deliberate
  // trade of a little privacy for a lot of usability. See SECURITY.md.
  if (!user.password) {
    return res.status(409).json({
      message: `This account was created with ${PROVIDER_LABEL[user.provider]}. Use that button to sign in, or set a password from your account page afterwards.`,
      provider: user.provider,
    })
  }

  if (!(await user.matchPassword(password))) {
    await user.registerFailedLogin()
    logSecurityEvent(SECURITY_EVENTS.LOGIN_FAIL, req, {
      userId: user.id,
      detail: `attempt ${user.failedLoginCount}`,
    })
    return res.status(401).json({ message: 'Invalid email or password' })
  }

  /**
   * The password was right, but that is now only half a login.
   *
   * Note what is deliberately NOT sent back here: no access token, and no user
   * object. Handing over any part of the account before the second factor
   * would reduce 2FA to a suggestion that a determined client could ignore.
   * All the browser gets is a challenge token that is useless anywhere except
   * the verify endpoint, and dies in five minutes.
   *
   * The failed-attempt counter is cleared, because the password genuinely was
   * correct - but the login is not recorded yet. It has not happened.
   */
  if (user.hasTwoFactor()) {
    user.failedLoginCount = 0
    await user.save({ fields: ['failedLoginCount'], silent: true })

    return res.json({
      twoFactorRequired: true,
      challengeToken: generateChallengeToken(user),
      message: 'Enter the code from your authenticator app.',
    })
  }

  await user.registerSuccessfulLogin(req.ip)
  await Cart.findOrCreate({ where: { userId: user.id } })

  logSecurityEvent(SECURITY_EVENTS.LOGIN_OK, req, { userId: user.id })

  res.json({ user: publicUser(user), token: generateToken(user) })
})

/**
 * POST /api/auth/logout-all
 *
 * Real logout. Clearing localStorage in the browser only removes your own
 * copy of the token; anyone who captured it still holds a working credential
 * until it expires. Bumping token_version makes every token ever issued to
 * this account fail verification on the next request.
 *
 * Use this after "I think someone has my password", and offer it in the UI as
 * "sign out of all devices".
 */
export const logoutAll = asyncHandler(async (req, res) => {
  await req.user.revokeAllTokens()
  logSecurityEvent(SECURITY_EVENTS.LOGOUT_ALL, req, { userId: req.user.id })

  res.json({ message: 'Signed out on every device. Please sign in again.' })
})

// ---------------------------------------------------------------------------
// Social sign-in
// ---------------------------------------------------------------------------

// GET /api/auth/providers
export const listProviders = (_req, res) => {
  try {
    res.json({ providers: Array.isArray(enabledProviders) ? enabledProviders : [] })
  } catch (err) {
    res.status(500).json({ message: 'Failed to list providers' })
  }
}

/**
 * Only ever redirect to a path inside our own front end.
 *
 * Without this, `/api/auth/google?redirect=https://evil.example` would make
 * our own domain bounce the user - carrying a fresh token - to an attacker's
 * site. Anything that is not a simple "/path" becomes "/".
 */
export function safeRedirect(value) {
  const path = String(value || '')
  if (!path.startsWith('/')) return '/'
  if (path.startsWith('//')) return '/' // protocol-relative: //evil.example
  if (path.includes('\\')) return '/' // some browsers treat \ as /
  return path
}

/**
 * The final hop of a successful social login.
 *
 * The token goes in the URL fragment (after the #) rather than the query
 * string. Fragments are never sent to a server and are stripped from the
 * Referer header, so the credential stays inside the browser instead of
 * landing in access logs. The callback page reads it and scrubs it from the
 * address bar immediately.
 */
export function socialSuccess(req, res) {
  const target = safeRedirect(req.query.state)

  /**
   * Google and Facebook logins go through 2FA as well.
   *
   * Skipping it here would be a complete bypass: anyone who compromised the
   * linked Google account - or simply found the laptop already signed into
   * one - would walk straight past the second factor. A door is only as strong
   * as the weakest way in.
   */
  if (req.user.hasTwoFactor()) {
    const challengeParams = new URLSearchParams({
      challenge: generateChallengeToken(req.user),
      redirect: target,
    })
    return res.redirect(`${CLIENT_URL}/auth/callback#${challengeParams.toString()}`)
  }

  const token = generateToken(req.user)

  logSecurityEvent(SECURITY_EVENTS.SOCIAL_LOGIN, req, {
    userId: req.user.id,
    detail: req.user.provider,
  })

  const params = new URLSearchParams({ token, redirect: target })
  res.redirect(`${CLIENT_URL}/auth/callback#${params.toString()}`)
}

export function socialFailure(req, res, err) {
  const reason =
    req.query.error === 'access_denied'
      ? 'You cancelled the sign-in.'
      : err?.message || 'That sign-in did not complete. Please try again.'

  const params = new URLSearchParams({ error: reason })
  res.redirect(`${CLIENT_URL}/auth/callback#${params.toString()}`)
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

// GET /api/auth/me
export const getMe = asyncHandler(async (req, res) => {
  const user = await User.scope('withPassword').findByPk(req.user.id)
  res.json(publicUser(user))
})

// PUT /api/auth/me
export const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.scope('withPassword').findByPk(req.user.id)
  if (!user) return res.status(404).json({ message: 'User not found' })

  const { name, phone, address, city, country, password, currentPassword, email } = req.body

  if (name !== undefined) {
    const next = cleanText(name, 120)
    if (!next) return res.status(400).json({ message: 'Name cannot be empty' })
    user.name = next
  }

  // These land in encrypted columns. Still cleaned first - encryption protects
  // the data at rest, it does nothing about what the value contains when it
  // comes back out and gets rendered.
  if (phone !== undefined) user.phone = cleanText(phone, 40)
  if (address !== undefined) user.address = cleanText(address, 255)
  if (city !== undefined) user.city = cleanText(city, 120)
  if (country !== undefined) user.country = cleanText(country, 80)

  // A Facebook signup with no email got a placeholder address, so that one
  // account type is allowed to correct it. Everyone else keeps their email.
  if (email !== undefined && user.email.endsWith('@users.noreply.local')) {
    const next = normaliseEmail(email)
    if (!EMAIL_PATTERN.test(next)) {
      return res.status(400).json({ message: 'That email address does not look valid' })
    }
    const taken = await User.findOne({ where: { email: next } })
    if (taken) return res.status(409).json({ message: 'That email is already registered' })

    user.email = next
    user.emailVerified = false
    logSecurityEvent(SECURITY_EVENTS.EMAIL_CHANGE, req, { userId: user.id })
  }

  // The role is deliberately not editable here. Letting a customer PUT their
  // own role is how accounts become admins by accident.

  let passwordChanged = false

  if (password) {
    const problem = checkPassword(password, { email: user.email, name: user.name })
    if (problem) return res.status(400).json({ message: problem, field: 'password' })

    // Changing an existing password requires proving you know the old one, so
    // a stolen token cannot quietly lock the real owner out. Someone who
    // signed up with Google has no old password and skips this - they are
    // adding one, not replacing one.
    if (user.password) {
      if (!currentPassword) {
        return res.status(400).json({ message: 'Enter your current password to change it' })
      }
      if (!(await user.matchPassword(String(currentPassword)))) {
        return res.status(401).json({ message: 'Your current password is not correct' })
      }
    }

    user.password = password // re-hashed by the beforeUpdate hook
    passwordChanged = true
  }

  await user.save()

  /**
   * Changing a password must end every other session.
   *
   * This is the whole point of a password change after a suspected breach. If
   * old tokens kept working, someone who already had one would still be signed
   * in and the change would have achieved nothing.
   *
   * That also invalidates the token the caller is holding right now, so issue
   * a fresh one and return it - otherwise the person changing their password
   * gets logged out for their trouble.
   */
  let token
  if (passwordChanged) {
    await user.revokeAllTokens()
    token = generateToken(user)
    logSecurityEvent(SECURITY_EVENTS.PASSWORD_CHANGE, req, { userId: user.id })
  }

  res.json({ ...publicUser(user), ...(token ? { token } : {}) })
})

// GET /api/auth/users  (admin)
export const listUsers = asyncHandler(async (_req, res) => {
  const users = await User.findAll({ order: [['createdAt', 'DESC']] })
  res.json(users.map(publicUser))
})
