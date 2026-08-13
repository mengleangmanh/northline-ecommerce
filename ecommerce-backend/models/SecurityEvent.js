import { DataTypes } from 'sequelize'
import { sequelize } from '../config/db.js'

/**
 * An append-only record of things worth being able to reconstruct later:
 * logins, failures, lockouts, password changes, permission denials.
 *
 * Kept out of the normal application log on purpose. When you are working out
 * what happened at 3am you want a table you can query, not grep across
 * rotated files that a container restart threw away.
 *
 * What is deliberately never written here: passwords, tokens, session ids,
 * full card numbers. An audit log is attractive to an attacker precisely
 * because it is complete and long-lived, so it holds the minimum needed to
 * establish what happened and nothing that would help them do it again.
 */
const SecurityEvent = sequelize.define(
  'SecurityEvent',
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    // Must be UNSIGNED to match users.id, or the foreign key cannot be
    // created and sync() fails on a fresh database.
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    event: { type: DataTypes.STRING(60), allowNull: false },
    // 45 characters is the longest an IPv6 address can be in text form.
    ip: { type: DataTypes.STRING(45) },
    userAgent: { type: DataTypes.STRING(255) },
    detail: { type: DataTypes.STRING(500) },
  },
  {
    tableName: 'security_events',
    // Rows are never edited, so an updated_at column would be dead weight -
    // and a row that can be updated is not really an audit log.
    updatedAt: false,
    indexes: [
      { fields: ['user_id', 'created_at'] },
      { fields: ['event', 'created_at'] },
      { fields: ['ip', 'created_at'] },
    ],
  },
)

export const SECURITY_EVENTS = {
  LOGIN_OK: 'login.success',
  LOGIN_FAIL: 'login.failure',
  LOGIN_LOCKED: 'login.locked_out',
  LOGOUT_ALL: 'logout.all_devices',
  REGISTER: 'account.registered',
  SOCIAL_LINK: 'account.social_linked',
  SOCIAL_LOGIN: 'login.social',
  PASSWORD_CHANGE: 'password.changed',
  EMAIL_CHANGE: 'email.changed',
  ADMIN_DENIED: 'authz.admin_denied',
  TOKEN_REJECTED: 'token.rejected',
  TWOFA_ENABLED: '2fa.enabled',
  TWOFA_DISABLED: '2fa.disabled',
  TWOFA_OK: '2fa.success',
  TWOFA_FAIL: '2fa.failure',
  RECOVERY_USED: '2fa.recovery_code_used',
  RECOVERY_REGENERATED: '2fa.recovery_codes_regenerated',
}

/**
 * Write an audit row.
 *
 * Never throws and is never awaited by the caller in a way that can fail the
 * request. Logging that a login happened must not be able to stop the login
 * from happening - if the audit table is full or locked, that is an operations
 * problem, not a reason to lock every customer out of the site.
 */
export async function logSecurityEvent(event, req, { userId = null, detail = null } = {}) {
  try {
    await SecurityEvent.create({
      userId,
      event,
      ip: req?.ip ? String(req.ip).slice(0, 45) : null,
      userAgent: req?.headers?.['user-agent']
        ? String(req.headers['user-agent']).slice(0, 255)
        : null,
      detail: detail ? String(detail).slice(0, 500) : null,
    })
  } catch (err) {
    console.error('Could not write security event:', event, err.message)
  }
}

export default SecurityEvent
