import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'

/**
 * JSON Web Token creation and verification.
 *
 * The defaults in most tutorials are subtly unsafe. What is different here:
 *
 *   algorithms is pinned on verify. This is the big one. jsonwebtoken will
 *   otherwise trust the `alg` header inside the token itself - which the
 *   attacker controls. Set it to "none" and some versions accept an unsigned
 *   token as valid. Pinning the algorithm makes that impossible.
 *
 *   issuer and audience are set and checked. If you later run a second
 *   service that signs tokens with the same secret, a token minted for that
 *   service should not open this one.
 *
 *   ver carries the user's token_version. Bumping that column in the database
 *   invalidates every token already issued - a real logout, and the only way
 *   to revoke a stateless token before it expires.
 *
 *   jti gives each token a unique id, so a specific token can be denylisted
 *   and audit log entries can be tied together.
 */

const ALGORITHM = 'HS256'
const ISSUER = process.env.JWT_ISSUER || 'northline-api'
const AUDIENCE = process.env.JWT_AUDIENCE || 'northline-web'

// 12 hours. A shorter life limits how long a stolen token is useful, but with
// no refresh-token flow yet, going much below this means signing people out
// mid-shop. See SECURITY.md for the upgrade path.
const DEFAULT_TTL = '12h'

function secret() {
  const value = process.env.JWT_SECRET

  if (!value) {
    throw new Error('JWT_SECRET is not set - run `npm run keys` and paste it into .env')
  }
  if (value.length < 32) {
    throw new Error(
      'JWT_SECRET is too short. HS256 keys should be at least 32 characters of random data - run `npm run keys`.',
    )
  }
  if (value.includes('change-me')) {
    throw new Error('JWT_SECRET is still the placeholder from .env.example - run `npm run keys`')
  }

  return value
}

export function generateToken(user) {
  return jwt.sign(
    {
      role: user.role,
      ver: user.tokenVersion ?? 0,
      // Marks this as a full access token. See generateChallengeToken below
      // for why a token needs to say what it is allowed to do.
      scp: 'access',
    },
    secret(),
    {
      algorithm: ALGORITHM,
      // `sub` is the standard claim for "who this token is about". It has to
      // be a string to be spec-compliant.
      subject: String(user.id),
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_TTL,
      jwtid: crypto.randomUUID(),
    },
  )
}

/**
 * A half-authenticated token, issued between "your password was correct" and
 * "your 2FA code was correct".
 *
 * The login has to be split across two requests, and something must carry the
 * knowledge of who is halfway through. Sending the user id back to the browser
 * and trusting it on the second request would let anyone skip straight to the
 * code step for any account they like - so it is a signed token instead.
 *
 * Two things make it safe:
 *
 *   scp is '2fa', and the auth middleware refuses it everywhere else. Without
 *   that check this token would be a complete bypass of the feature: you would
 *   type a correct password, ignore the code prompt, and use the challenge
 *   token as a normal credential.
 *
 *   Five minutes. It only has to survive someone picking up their phone.
 */
export function generateChallengeToken(user) {
  return jwt.sign(
    { ver: user.tokenVersion ?? 0, scp: '2fa' },
    secret(),
    {
      algorithm: ALGORITHM,
      subject: String(user.id),
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: '5m',
      jwtid: crypto.randomUUID(),
    },
  )
}

export function verifyToken(token) {
  return jwt.verify(token, secret(), {
    algorithms: [ALGORITHM], // never trust the alg header in the token
    issuer: ISSUER,
    audience: AUDIENCE,
    clockTolerance: 5, // seconds, for minor clock drift between machines
  })
}

export default generateToken
