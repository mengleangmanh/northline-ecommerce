import crypto from 'node:crypto'
import { DataTypes, Op } from 'sequelize'
import { sequelize } from '../config/db.js'
import User from './User.js'
import { blindIndex } from '../utils/crypto.js'

/**
 * Single-use backup codes for people who lose their phone.
 *
 * These are not optional politeness. Turn on 2FA without them and the first
 * person to drop their phone in a river is locked out of their account
 * permanently, with no way back except you editing the database by hand. Every
 * service that does 2FA properly issues these at the same moment it turns 2FA
 * on, and this one refuses to enable 2FA without showing them.
 */

// 10 characters from a 32-character alphabet = 50 bits of entropy per code.
const CODE_LENGTH = 10
const CODE_COUNT = 10

/**
 * Crockford base32: no I, L, O or U.
 *
 * I/1 and O/0 are removed because these get read off a printout and typed in
 * months later, usually in a hurry. U is removed because dropping it means a
 * random code can never spell an unfortunate word.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const RecoveryCode = sequelize.define(
  'RecoveryCode',
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },

    /**
     * The code is never stored. This is a keyed HMAC of it.
     *
     * Not bcrypt: hashing ten codes at cost 12 would take ten seconds, and
     * bcrypt's slowness exists to protect low-entropy human passwords. These
     * are 50 random bits, so there is nothing to slow down - an attacker
     * cannot guess their way through 2^50 codes against a rate-limited API.
     *
     * Not a bare SHA-256 either. Someone holding a stolen dump could work
     * through 2^50 hashes offline given enough hardware. Keying the hash with
     * BLIND_INDEX_KEY, which lives in the environment rather than the
     * database, means the dump alone is not enough to try even one guess.
     */
    codeHash: { type: DataTypes.STRING(64), allowNull: false },

    // Set the moment a code is spent. The row is kept rather than deleted so
    // "a backup code was used on your account" stays auditable.
    usedAt: { type: DataTypes.DATE, allowNull: true },
    usedIp: { type: DataTypes.STRING(45), allowNull: true },
  },
  {
    tableName: 'recovery_codes',
    updatedAt: false,
    indexes: [
      { name: 'ix_recovery_codes_user', fields: ['user_id'] },
      { name: 'ix_recovery_codes_hash', fields: ['code_hash'] },
    ],
  },
)

User.hasMany(RecoveryCode, { foreignKey: 'userId', onDelete: 'CASCADE' })
RecoveryCode.belongsTo(User, { foreignKey: 'userId' })

/** Human-friendly shape: 3f9k2-qw8xz */
function formatCode(raw) {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`.toLowerCase()
}

/**
 * Strip everything a person might add while typing one in - spaces, the dash,
 * capitals - so the comparison only sees the meaningful characters.
 */
export function normaliseCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
}

function randomCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH)
  let out = ''

  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // Modulo bias is negligible here: 256 % 32 === 0, so every character in a
    // 32-letter alphabet is exactly equally likely.
    out += ALPHABET[bytes[i] % ALPHABET.length]
  }

  return out
}

/**
 * Issue a fresh set, destroying any that already existed.
 *
 * Replacing rather than adding is deliberate. If someone regenerates their
 * codes because they think the old printout was seen, leaving the old ones
 * working would defeat the entire exercise.
 *
 * Returns the plaintext codes. This is the only moment they exist in readable
 * form anywhere - once this function returns, nothing can recover them.
 */
export async function issueRecoveryCodes(userId, count = CODE_COUNT) {
  await RecoveryCode.destroy({ where: { userId } })

  const plain = []
  const rows = []

  for (let i = 0; i < count; i += 1) {
    const raw = randomCode()
    plain.push(formatCode(raw))
    rows.push({ userId, codeHash: blindIndex(raw) })
  }

  await RecoveryCode.bulkCreate(rows)

  return plain
}

/**
 * Spend a recovery code. Returns true if it was valid and unused.
 *
 * The lookup is by hash, so the code itself is never compared in the
 * application - the database index does the work and there is no string
 * comparison to time.
 */
export async function consumeRecoveryCode(userId, input, ip) {
  const cleaned = normaliseCode(input)
  if (cleaned.length !== CODE_LENGTH) return false

  const row = await RecoveryCode.findOne({
    where: { userId, codeHash: blindIndex(cleaned), usedAt: { [Op.is]: null } },
  })

  if (!row) return false

  row.usedAt = new Date()
  row.usedIp = ip ? String(ip).slice(0, 45) : null
  await row.save()

  return true
}

/** How many are left, so the UI can nag before they run out. */
export async function countUnusedCodes(userId) {
  return RecoveryCode.count({ where: { userId, usedAt: { [Op.is]: null } } })
}

RecoveryCode.CODE_COUNT = CODE_COUNT

export default RecoveryCode
