-- ===========================================================================
-- 05 - Two-factor authentication
--
-- Run after 04-security-hardening.sql.
-- phpMyAdmin -> ecommerce -> SQL tab -> paste -> Go
--
-- SAFE TO RUN TWICE.
-- Each ADD COLUMN checks information_schema first and becomes a no-op if the
-- column is already there, so you will not see "#1060 - Duplicate column name"
-- or "#1061 - Duplicate key name" on a second run. PREPARE/EXECUTE are plain
-- statements, so no DELIMITER change is needed to paste this into phpMyAdmin.
-- ===========================================================================

USE `ecommerce`;

-- ---------------------------------------------------------------------------
-- 1. The 2FA columns on users
-- ---------------------------------------------------------------------------

-- users.two_factor_secret
--
-- Encrypted with AES-256-GCM by the application, never written in the clear.
-- A TOTP secret is a permanent key: whoever holds it can mint valid codes
-- forever, from anywhere, without ever touching this server. In a leaked dump
-- that is worse than the password column, because passwords are at least
-- hashed and unusable as-is.
--
-- 255 chars for what is really a 32-character secret, because the stored value
-- is ciphertext: a random IV, an auth tag, and base64 overhead.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'two_factor_secret') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD COLUMN `two_factor_secret` VARCHAR(255) DEFAULT NULL');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- users.two_factor_enabled
--
-- Separate from the secret on purpose. During setup a secret exists but 2FA is
-- not on yet, and that account must still be able to log in normally -
-- otherwise abandoning setup half way locks someone out of their own account.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'two_factor_enabled') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD COLUMN `two_factor_enabled` TINYINT(1) NOT NULL DEFAULT 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- users.two_factor_confirmed_at
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'two_factor_confirmed_at') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD COLUMN `two_factor_confirmed_at` DATETIME DEFAULT NULL');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- users.two_factor_last_step
--
-- The last 30-second step this account successfully used, so the same code
-- cannot be presented twice. Without this a code is valid for its whole window
-- and can be replayed by anyone who watched it being typed.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'two_factor_last_step') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD COLUMN `two_factor_last_step` BIGINT DEFAULT NULL');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- users.two_factor_failed_count
--
-- Wrong codes in a row. Six digits is only a million possibilities, so
-- unlimited guessing would defeat the entire feature in minutes.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'two_factor_failed_count') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD COLUMN `two_factor_failed_count` INT NOT NULL DEFAULT 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 2. Recovery codes
--
-- Not optional. Enable 2FA without these and the first customer to lose their
-- phone is locked out permanently, with no way back except you editing rows by
-- hand at midnight. Every service that does 2FA properly hands these over at
-- the same moment it turns 2FA on.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `recovery_codes` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL,

  -- A keyed HMAC-SHA256 of the code, never the code itself.
  --
  -- Not bcrypt: these are 50 random bits, not a human-chosen password, so
  -- there is no weak guess to slow down - and hashing ten of them at cost 12
  -- would take ten seconds. Not a bare SHA-256 either, because someone with a
  -- stolen dump could grind 2^50 hashes offline. The key lives in the
  -- environment, so the dump on its own buys them nothing.
  `code_hash`  VARCHAR(64) NOT NULL,

  -- Kept rather than deleted once spent, so "a backup code was used on your
  -- account" remains answerable months later.
  `used_at`    DATETIME DEFAULT NULL,
  `used_ip`    VARCHAR(45) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `ix_recovery_codes_user` (`user_id`),
  KEY `ix_recovery_codes_hash` (`code_hash`),

  -- CASCADE here, unlike security_events. A spent recovery code belonging to
  -- a deleted account has no audit value and is just a stale secret.
  CONSTRAINT `fk_recovery_codes_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '05 applied - 2FA columns and recovery_codes present' AS status;

-- ---------------------------------------------------------------------------
-- 3. Useful checks
-- ---------------------------------------------------------------------------

-- Who has 2FA switched on, and how many backup codes they have left.
--
-- SELECT u.email,
--        u.two_factor_enabled,
--        u.two_factor_confirmed_at,
--        COUNT(r.id) - COUNT(r.used_at) AS codes_left
-- FROM users u
-- LEFT JOIN recovery_codes r ON r.user_id = u.id
-- GROUP BY u.id
-- ORDER BY u.two_factor_enabled DESC;

-- Confirm the secrets really are encrypted. Every non-null row should start
-- with "enc:v1:". If any shows a bare 32-character base32 string, something
-- wrote to the column without going through the model.
--
-- SELECT id, email, LEFT(two_factor_secret, 7) AS prefix
-- FROM users WHERE two_factor_secret IS NOT NULL;

-- Emergency: switch 2FA off for one person who has lost both their phone and
-- their backup codes. Verify who they are through some other channel first -
-- this is exactly the request an attacker makes.
--
-- UPDATE users
--    SET two_factor_enabled = 0,
--        two_factor_secret = NULL,
--        two_factor_last_step = NULL,
--        token_version = token_version + 1   -- ends their existing sessions
--  WHERE email = 'person@example.com';
-- DELETE FROM recovery_codes WHERE user_id = (SELECT id FROM users WHERE email = 'person@example.com');
