import crypto from 'node:crypto'
import { DataTypes } from 'sequelize'

/**
 * Field-level encryption for personal data at rest.
 *
 * MySQL already protects the file on disk if you turn on tablespace
 * encryption, but that only helps if someone steals the hard drive. It does
 * nothing about a leaked database dump, an over-privileged admin, or a SQL
 * injection that reads the users table. Encrypting the sensitive columns
 * themselves means a stolen dump is a pile of ciphertext without the key,
 * which lives in the environment and never in the database.
 *
 * AES-256-GCM is used rather than AES-256-CBC because GCM is *authenticated*:
 * it produces a tag that proves the ciphertext has not been altered. With CBC
 * an attacker who can write to the database can flip bits in the ciphertext
 * and change the decrypted value in predictable ways. GCM makes that fail
 * loudly instead.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12 // 96 bits, the size GCM is designed around
const PREFIX = 'enc:v1'

let cachedKey = null
let cachedIndexKey = null

function encryptionKey() {
  if (cachedKey) return cachedKey

  const raw = process.env.ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is missing from .env - run `npm run keys` to generate one',
    )
  }

  const buf = Buffer.from(raw, 'hex')
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be 64 hex characters (32 bytes), got ${buf.length} bytes`,
    )
  }

  cachedKey = buf
  return buf
}

function indexKey() {
  if (cachedIndexKey) return cachedIndexKey
  const raw = process.env.BLIND_INDEX_KEY || process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('BLIND_INDEX_KEY is missing from .env')
  cachedIndexKey = Buffer.from(raw, 'hex')
  return cachedIndexKey
}

/**
 * Encrypt a value for storage.
 *
 * The IV is random per value and stored alongside the ciphertext. That is the
 * whole point: encrypting the same phone number twice must produce two
 * different strings, otherwise anyone reading the table can tell which rows
 * share a value without decrypting anything.
 *
 * Output format: enc:v1:<iv>:<tag>:<ciphertext>, all base64. The version tag
 * means you can change algorithm later and still read the old rows.
 */
export function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return plain

  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv)

  const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [PREFIX, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(
    ':',
  )
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:`)
}

/**
 * Decrypt a stored value.
 *
 * Anything that does not carry the enc:v1 prefix is passed straight through.
 * That is deliberate: it lets you add encryption to a table that already has
 * plaintext rows and migrate them in the background instead of in one
 * all-or-nothing step.
 */
export function decrypt(stored) {
  if (!isEncrypted(stored)) return stored

  const [, ivB64, tagB64, dataB64] = stored.split(':')

  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      encryptionKey(),
      Buffer.from(ivB64, 'base64'),
    )
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))

    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    // Wrong key, or the row was tampered with. Never return half-decrypted
    // rubbish and never crash the whole request over one bad field.
    console.error('Failed to decrypt a field - wrong ENCRYPTION_KEY, or the data was altered')
    return null
  }
}

/**
 * A Sequelize attribute that encrypts on the way in and decrypts on the way
 * out. The rest of the app never sees ciphertext - `user.phone` just works.
 *
 * Note the column has to be much wider than the plaintext. A 12-character
 * phone number becomes about 100 characters once you add the IV, the auth tag
 * and base64 overhead.
 */
export function encryptedField(name, { length = 512, allowNull = true } = {}) {
  return {
    type: DataTypes.STRING(length),
    allowNull,
    get() {
      return decrypt(this.getDataValue(name))
    },
    set(value) {
      this.setDataValue(name, encrypt(value))
    },
  }
}

/**
 * A blind index: a keyed hash you can put in a WHERE clause.
 *
 * Encrypted columns cannot be searched, because the same input encrypts to a
 * different string every time. If you ever need `WHERE phone = ?` on an
 * encrypted column, store this next to it and search on it instead.
 *
 * HMAC rather than a plain SHA-256, because a plain hash of a phone number is
 * trivially reversible - there are only so many phone numbers, and an attacker
 * with the dump can hash all of them. The key stops that.
 */
export function blindIndex(value) {
  if (value === null || value === undefined || value === '') return null
  return crypto
    .createHmac('sha256', indexKey())
    .update(String(value).trim().toLowerCase())
    .digest('hex')
}

/**
 * Compare two strings without leaking how much of them matched.
 *
 * A normal `===` stops at the first differing character, so the time it takes
 * reveals the length of the matching prefix. Over enough requests that is
 * enough to guess a token one character at a time. This always takes the same
 * time for a given length.
 */
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8')
  const bufB = Buffer.from(String(b ?? ''), 'utf8')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

// A URL-safe random string, for anything that needs to be unguessable.
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

export default { encrypt, decrypt, encryptedField, blindIndex, safeEqual, randomToken, sha256 }
