import { DataTypes } from 'sequelize'
import bcrypt from 'bcryptjs'
import { sequelize } from '../config/db.js'
import { encryptedField } from '../utils/crypto.js'

/**
 * How many rounds bcrypt does. Each extra round doubles the work.
 *
 * 10 was the sensible default a decade ago. Hardware has moved on, and the
 * whole point of a password hash is that it should be slow enough to make
 * guessing expensive. 12 is the current common recommendation.
 *
 * Be aware that bcryptjs is pure JavaScript and roughly 3x slower than the
 * native `bcrypt` package, so cost 12 here costs about a second of CPU per
 * login on a modest machine. That is fine because logins are rate limited,
 * but if you ever put this under real load, switch to the native `bcrypt`
 * package or to argon2id, which is what new projects should use.
 */
const BCRYPT_ROUNDS = 12

// Lock the account after this many consecutive failures.
const MAX_FAILED_LOGINS = 5
const LOCKOUT_MINUTES = 15

// Wrong TOTP codes in a row before the account locks.
const MAX_FAILED_2FA = 5

const User = sequelize.define(
  'User',
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(120), allowNull: false },

    // Deliberately NOT encrypted. Every login does `WHERE email = ?`, and you
    // cannot search an encrypted column - the same address encrypts to a
    // different string every time. The unique constraint would break too.
    // If you need to hide email addresses as well, keep this column and add a
    // blind index; see blindIndex() in utils/crypto.js.
    email: {
      type: DataTypes.STRING(190),
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },

    // NULL for accounts created through Google or Facebook. Those people never
    // chose a password here, so there is nothing to store.
    password: { type: DataTypes.STRING(255), allowNull: true },

    role: {
      type: DataTypes.ENUM('customer', 'admin'),
      allowNull: false,
      defaultValue: 'customer',
    },

    provider: {
      type: DataTypes.ENUM('local', 'google', 'facebook'),
      allowNull: false,
      defaultValue: 'local',
    },
    providerId: { type: DataTypes.STRING(191), allowNull: true },
    avatar: { type: DataTypes.STRING(255), allowNull: true },
    emailVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

    /**
     * Bumping this invalidates every token already issued to this person.
     *
     * This is the missing piece in most JWT tutorials. A signed token is valid
     * until it expires and the server has no memory of it, so "log out" is
     * normally just deleting it from the browser - anyone who copied it first
     * still has a working key. Every token carries the version it was signed
     * under, and the auth middleware compares it against this column, so one
     * UPDATE genuinely signs someone out everywhere.
     */
    tokenVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

    // Brute-force protection, per account rather than per IP.
    failedLoginCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lockedUntil: { type: DataTypes.DATE, allowNull: true },

    lastLoginAt: { type: DataTypes.DATE, allowNull: true },
    lastLoginIp: { type: DataTypes.STRING(45), allowNull: true },
    passwordChangedAt: { type: DataTypes.DATE, allowNull: true },

    /**
     * Two-factor authentication.
     *
     * The shared secret is encrypted at rest, and this is not decoration. A
     * TOTP secret is a permanent key: anyone holding it can generate valid
     * codes forever, from anywhere, silently. A leaked database with these in
     * plain text would hand over the second factor for every account at once
     * and nobody would ever know. It is arguably more sensitive than the
     * password column, because passwords at least are hashed and unusable.
     */
    twoFactorSecret: encryptedField('twoFactorSecret', { length: 255 }),
    twoFactorEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    twoFactorConfirmedAt: { type: DataTypes.DATE, allowNull: true },

    /**
     * The last 30-second step this account successfully used.
     *
     * Without it, a code stays valid for its whole window, so anyone who
     * shoulder-surfs six digits or intercepts them through a phishing proxy
     * can replay them within the minute. Refusing a step that has already been
     * spent makes each code genuinely one-time, which is what the acronym
     * promised.
     *
     * BIGINT because mysql2 returns it as a string - always wrap comparisons
     * in Number().
     */
    twoFactorLastStep: { type: DataTypes.BIGINT, allowNull: true },

    // Counted separately from password failures: someone who knows the
    // password but is guessing codes is a different, more alarming event.
    twoFactorFailedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

    /**
     * Encrypted at rest with AES-256-GCM.
     *
     * A home address and phone number are the parts of this table that would
     * actually hurt someone if the database leaked - far more than an order
     * history. The getter and setter mean the rest of the app never notices:
     * `user.address` returns plain text.
     *
     * The columns are much wider than the values they hold because ciphertext
     * carries a random IV and an authentication tag, then gets base64'd.
     */
    phone: encryptedField('phone', { length: 255 }),
    address: encryptedField('address', { length: 512 }),

    // Left in the clear: useful for shipping-cost logic and sales-by-region
    // reporting, and not sensitive on their own.
    city: { type: DataTypes.STRING(120) },
    country: { type: DataTypes.STRING(80) },
  },
  {
    tableName: 'users',
    defaultScope: { attributes: { exclude: ['password'] } },
    scopes: { withPassword: { attributes: {} } },
    indexes: [
      {
        name: 'uq_users_provider_account',
        unique: true,
        fields: ['provider', 'provider_id'],
      },
    ],
  },
)

// Hash on create and on any password change. Never store the raw password.
async function hashPassword(user) {
  if (user.changed('password') && user.password) {
    user.password = await bcrypt.hash(user.password, BCRYPT_ROUNDS)
    user.passwordChangedAt = new Date()
  }
}

User.beforeCreate(hashPassword)
User.beforeUpdate(hashPassword)

/**
 * Compare a submitted password against the stored hash.
 *
 * bcrypt.compare is already timing-safe, so there is no need to do anything
 * clever here. Note that it deliberately takes the same amount of work whether
 * the password is right or wrong.
 */
User.prototype.matchPassword = function (plain) {
  if (!this.password) return Promise.resolve(false)
  return bcrypt.compare(plain, this.password)
}

User.prototype.hasPassword = function () {
  return Boolean(this.password)
}

// Is this account currently locked out?
User.prototype.isLocked = function () {
  return Boolean(this.lockedUntil && this.lockedUntil.getTime() > Date.now())
}

User.prototype.lockMinutesRemaining = function () {
  if (!this.isLocked()) return 0
  return Math.ceil((this.lockedUntil.getTime() - Date.now()) / 60000)
}

/**
 * Count a failed attempt, and lock the account once there have been too many.
 *
 * Per-account locking and per-IP rate limiting solve different halves of the
 * same problem. Rate limiting stops one machine trying a thousand passwords.
 * This stops a botnet spreading those thousand attempts across a thousand
 * addresses, where each individual IP looks perfectly innocent.
 *
 * The tradeoff is that someone can lock a person out of their own account on
 * purpose, just by failing to log in five times. Fifteen minutes keeps that
 * annoying rather than damaging. Do not extend it to hours.
 */
User.prototype.registerFailedLogin = async function () {
  this.failedLoginCount += 1

  if (this.failedLoginCount >= MAX_FAILED_LOGINS) {
    this.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
    this.failedLoginCount = 0
  }

  // silent: true so this bookkeeping does not touch updated_at, and
  // individual fields so we never accidentally re-save a password.
  await this.save({ fields: ['failedLoginCount', 'lockedUntil'], silent: true })
}

User.prototype.registerSuccessfulLogin = async function (ip) {
  this.failedLoginCount = 0
  this.lockedUntil = null
  this.lastLoginAt = new Date()
  this.lastLoginIp = ip ? String(ip).slice(0, 45) : null

  await this.save({
    fields: ['failedLoginCount', 'lockedUntil', 'lastLoginAt', 'lastLoginIp'],
    silent: true,
  })
}

// Sign out of every device, everywhere, immediately.
User.prototype.revokeAllTokens = async function () {
  this.tokenVersion += 1
  await this.save({ fields: ['tokenVersion'], silent: true })
  return this.tokenVersion
}

/**
 * Is 2FA actually active? Both halves must be true.
 *
 * There is a window during setup where a secret exists but has not been
 * confirmed yet, and that account must still log in normally - otherwise a
 * failed setup locks someone out of their own account.
 */
User.prototype.hasTwoFactor = function () {
  return Boolean(this.twoFactorEnabled && this.twoFactorSecret)
}

/**
 * Reject a code that has already been used.
 *
 * Steps only ever move forwards, so anything at or below the last accepted
 * step is either a replay or a code from the drift window that was already
 * spent.
 */
User.prototype.isReplayedStep = function (step) {
  if (this.twoFactorLastStep === null || this.twoFactorLastStep === undefined) return false
  return Number(step) <= Number(this.twoFactorLastStep)
}

User.prototype.recordTwoFactorSuccess = async function (step) {
  this.twoFactorLastStep = step ?? null
  this.twoFactorFailedCount = 0
  await this.save({ fields: ['twoFactorLastStep', 'twoFactorFailedCount'], silent: true })
}

/**
 * A wrong code counts towards the same lockout as a wrong password.
 *
 * This matters more than it looks. Six digits is only a million
 * possibilities, and the drift window means about three are valid at any
 * moment - so an unlimited guesser needs roughly 300,000 attempts for even
 * odds. That is minutes of automated traffic. The lockout is what turns 2FA
 * from theatre into a real barrier.
 */
User.prototype.registerFailedTwoFactor = async function () {
  this.twoFactorFailedCount += 1

  if (this.twoFactorFailedCount >= MAX_FAILED_2FA) {
    this.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
    this.twoFactorFailedCount = 0
  }

  await this.save({ fields: ['twoFactorFailedCount', 'lockedUntil'], silent: true })
}

User.MAX_FAILED_LOGINS = MAX_FAILED_LOGINS
User.MAX_FAILED_2FA = MAX_FAILED_2FA
User.LOCKOUT_MINUTES = LOCKOUT_MINUTES

export default User
