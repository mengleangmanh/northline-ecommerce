import User from '../models/User.js'
import { verifyToken } from '../utils/generateToken.js'
import { logSecurityEvent, SECURITY_EVENTS } from '../models/SecurityEvent.js'

/**
 * Pull the bearer token out of the Authorization header.
 *
 * Strict on purpose. "bearer", "Bearer  x" with two spaces, or a token with
 * whitespace in it are all rejected rather than trimmed into shape - being
 * lenient about credential parsing is how you end up with two components
 * disagreeing about what the token actually is.
 */
function bearerToken(req) {
  const header = req.headers.authorization
  if (typeof header !== 'string') return null

  const parts = header.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) return null

  return parts[1]
}

/**
 * Gate for every private route.
 *
 * Three things are checked, in this order:
 *
 *   1. The signature, expiry, issuer and audience, with the algorithm pinned.
 *      verifyToken() handles this.
 *   2. That the user still exists. Deleting an account must take effect at
 *      once, not when the token happens to expire.
 *   3. That the token's version still matches the account's. This is what
 *      makes "sign out everywhere" and "invalidate on password change" work.
 *
 * The role is read from the database row, never from the token. A token minted
 * while someone was an admin must stop granting admin the moment you demote
 * them.
 */
export async function protect(req, res, next) {
  const token = bearerToken(req)

  if (!token) {
    return res.status(401).json({ message: 'Not authorised, no token' })
  }

  let decoded
  try {
    decoded = verifyToken(token)
  } catch (err) {
    // Distinguish only between "expired" and everything else. An expired token
    // is a normal event the front end should react to by sending the person to
    // the login page; anything else is worth an audit row.
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Your session has expired. Please sign in again.', expired: true })
    }

    logSecurityEvent(SECURITY_EVENTS.TOKEN_REJECTED, req, { detail: err.message })
    return res.status(401).json({ message: 'Not authorised, token failed' })
  }

  /**
   * Refuse a half-finished login everywhere except the 2FA endpoint.
   *
   * This single check is what makes two-factor authentication real. The
   * challenge token is issued once the password is right but before the code
   * is, and if any ordinary route accepted it, an attacker with a stolen
   * password would simply ignore the code prompt and carry on.
   */
  if (decoded.scp === '2fa') {
    return res.status(401).json({
      message: 'Finish signing in with your authentication code first.',
      twoFactorRequired: true,
    })
  }

  // `sub` is the standard claim. The `id` fallback keeps tokens issued by the
  // previous version of this file working until they expire.
  const userId = decoded.sub || decoded.id
  const user = await User.findByPk(userId)

  if (!user) {
    return res.status(401).json({ message: 'User no longer exists' })
  }

  if ((decoded.ver ?? 0) !== user.tokenVersion) {
    return res.status(401).json({
      message: 'This session was ended. Please sign in again.',
      expired: true,
    })
  }

  if (user.isLocked()) {
    return res.status(423).json({ message: 'This account is temporarily locked.' })
  }

  req.user = user
  req.tokenId = decoded.jti
  return next()
}

/**
 * The opposite gate: accepts ONLY a challenge token.
 *
 * Used by the 2FA verification endpoint, which by definition is reached by
 * someone who is not yet signed in. A full access token is rejected here too,
 * so this route cannot be used to mint fresh tokens indefinitely.
 */
export async function challengeAuth(req, res, next) {
  const token = bearerToken(req)
  if (!token) {
    return res.status(401).json({ message: 'No sign-in in progress. Please start again.' })
  }

  let decoded
  try {
    decoded = verifyToken(token)
  } catch (err) {
    const expired = err.name === 'TokenExpiredError'
    return res.status(401).json({
      message: expired
        ? 'That took too long. Please enter your password again.'
        : 'Sign-in could not be verified. Please start again.',
      restart: true,
    })
  }

  if (decoded.scp !== '2fa') {
    return res.status(401).json({ message: 'Wrong kind of token for this step.' })
  }

  const user = await User.scope('withPassword').findByPk(decoded.sub)
  if (!user) return res.status(401).json({ message: 'User no longer exists' })

  // The version check applies here too - if the account signed out everywhere
  // between the two halves of this login, the challenge must die with it.
  if ((decoded.ver ?? 0) !== user.tokenVersion) {
    return res.status(401).json({ message: 'This sign-in was cancelled. Please start again.', restart: true })
  }

  if (user.isLocked()) {
    return res.status(423).json({
      message: `Too many attempts. Locked for ${user.lockMinutesRemaining()} more minute(s).`,
    })
  }

  req.user = user
  return next()
}

/**
 * Attaches the user when a token is present, but never blocks the request.
 * For endpoints that behave differently for guests - showing a personalised
 * price, say - without requiring anyone to sign in.
 */
export async function optionalAuth(req, _res, next) {
  const token = bearerToken(req)
  if (!token) return next()

  try {
    const decoded = verifyToken(token)
    const user = await User.findByPk(decoded.sub || decoded.id)

    // Apply the same version check. A revoked token must not quietly keep
    // working just because this route tolerates anonymous access.
    req.user = user && (decoded.ver ?? 0) === user.tokenVersion ? user : null
  } catch {
    req.user = null
  }

  return next()
}

export default protect
