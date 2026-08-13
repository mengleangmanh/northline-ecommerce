import crypto from 'node:crypto'

/**
 * Time-based one-time passwords (RFC 6238), the six-digit codes that Google
 * Authenticator, Authy, 1Password and Microsoft Authenticator all produce.
 *
 * Written against Node's built-in crypto rather than pulling in `otplib` or
 * `speakeasy`. The whole algorithm is about forty lines - it is an HMAC, a
 * truncation and a modulo - and the test vectors at the bottom of RFC 6238
 * let you prove an implementation correct in a way you cannot easily do with
 * a dependency. One less package in the supply chain for an auth-critical
 * path is worth having.
 *
 * How it works, briefly:
 *
 *   1. Both sides share a random secret, handed over once as a QR code.
 *   2. Divide the current Unix time by 30 to get a "step" number. Both sides
 *      compute the same step, without ever talking to each other.
 *   3. HMAC-SHA1 the step with the secret, take 4 bytes from a position the
 *      hash itself picks, mod 1,000,000.
 *
 * Nothing is transmitted, so there is nothing to intercept. This is why TOTP
 * beats SMS codes, which travel over a network that can be redirected with a
 * convincing phone call to a mobile carrier.
 */

const DIGITS = 6
const STEP_SECONDS = 30

/**
 * SHA-1 looks alarming here, but this is the one place it is still correct.
 *
 * SHA-1 is broken for *collision resistance* - you can construct two documents
 * with the same hash. TOTP does not depend on that property at all; it uses
 * SHA-1 inside HMAC, where only pre-image resistance matters, and that is
 * still intact. More practically: RFC 6238 specifies SHA-1 as the default and
 * every authenticator app assumes it. Choosing SHA-256 here would produce
 * codes that Google Authenticator silently gets wrong.
 */
const ALGORITHM = 'sha1'

// RFC 4648 base32. Authenticator apps expect secrets in this alphabet.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buffer) {
  let bits = 0
  let value = 0
  let output = ''

  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  // Whatever is left over, padded out to a full 5-bit group.
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }

  // Deliberately no '=' padding. Some authenticator apps mishandle it.
  return output
}

export function base32Decode(input) {
  // People retyping a secret by hand add spaces, lowercase it, and confuse 0
  // with O and 1 with I. Fix all of that rather than rejecting them.
  const cleaned = String(input)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/=+$/, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')

  let bits = 0
  let value = 0
  const bytes = []

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error('That is not a valid base32 secret')

    value = (value << 5) | index
    bits += 5

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }

  return Buffer.from(bytes)
}

/**
 * A new shared secret.
 *
 * 20 bytes = 160 bits, which is what RFC 4226 recommends and exactly the
 * block size HMAC-SHA1 works in. Going bigger gains nothing, because HMAC
 * hashes any longer key down to this length anyway.
 */
export function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes))
}

/** Which 30-second step a moment in time falls into. */
export function currentStep(timestamp = Date.now()) {
  return Math.floor(timestamp / 1000 / STEP_SECONDS)
}

/**
 * The code for one specific step. This is HOTP (RFC 4226) with the counter
 * set to a time step, which is all TOTP actually is.
 */
export function codeForStep(secret, step, digits = DIGITS) {
  const key = base32Decode(secret)

  // The counter goes in as an 8-byte big-endian integer.
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))

  const hmac = crypto.createHmac(ALGORITHM, key).update(counter).digest()

  /**
   * "Dynamic truncation". The low 4 bits of the final byte choose where in the
   * hash to read from, so the 4 bytes used vary unpredictably per code. This
   * is what stops an attacker who collects many codes from learning about a
   * fixed slice of the HMAC output.
   */
  const offset = hmac[hmac.length - 1] & 0x0f

  const binary =
    ((hmac[offset] & 0x7f) << 24) | // mask the sign bit - some languages have no unsigned int
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)

  return String(binary % 10 ** digits).padStart(digits, '0')
}

/** The code for right now. Used in tests and for the setup preview. */
export function generateCode(secret, timestamp = Date.now()) {
  return codeForStep(secret, currentStep(timestamp))
}

/**
 * Check a submitted code.
 *
 * Returns the step it matched, or null. The step matters: the caller stores it
 * and refuses to accept the same step twice, so a code shoulder-surfed or
 * captured by a proxy cannot be replayed within its 30-second life.
 *
 * `window: 1` also accepts the previous and next step, giving a 90-second
 * span. That sounds sloppy but it is the standard setting, and it is there for
 * a real reason: phone clocks drift, and people start typing a code at second
 * 29. Widening it further trades security for very little extra comfort.
 */
export function verifyCode(secret, token, { window = 1, timestamp = Date.now() } = {}) {
  const cleaned = String(token || '').replace(/[\s-]/g, '')
  if (!/^\d{6}$/.test(cleaned)) return null

  const now = currentStep(timestamp)

  for (let drift = -window; drift <= window; drift += 1) {
    const step = now + drift
    if (timingSafeEqualString(codeForStep(secret, step), cleaned)) {
      return step
    }
  }

  return null
}

/**
 * Compare without leaking, through timing, how many leading digits were right.
 * With only a million possible codes, a digit-by-digit oracle would make
 * guessing dramatically cheaper.
 */
function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/**
 * The otpauth:// URI that goes into the QR code.
 *
 * The label convention is "Issuer:account", with the issuer repeated as a
 * parameter. Both are needed: older apps read the label, newer ones read the
 * parameter, and getting it wrong means every account in the user's app is
 * called "Unknown".
 */
export function otpauthUri({ secret, account, issuer = 'Northline' }) {
  const label = encodeURIComponent(`${issuer}:${account}`)

  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })

  return `otpauth://totp/${label}?${params.toString()}`
}

/** Groups the secret into blocks of four, for people typing it in by hand. */
export function formatSecretForDisplay(secret) {
  return secret.replace(/(.{4})/g, '$1 ').trim()
}

export const TOTP_DIGITS = DIGITS
export const TOTP_STEP_SECONDS = STEP_SECONDS

export default { generateSecret, generateCode, verifyCode, otpauthUri }
