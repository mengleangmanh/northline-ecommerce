-- ===========================================================================
-- 04-security-hardening.sql
--
-- Run this AFTER 01-schema.sql, 02-seed.sql and 03-add-social-login.sql.
--
-- This file is NOT optional. 01-schema.sql creates the base tables only;
-- the lockout, token_version and audit-log columns live here, and the
-- application reads them on every login. Skipping this file gives you
-- "Unknown column 'token_version' in field list" the first time anyone
-- signs in.
--
--   Windows:    C:\xampp\mysql\bin\mysql -u root ecommerce < 04-security-hardening.sql
--   phpMyAdmin: select the `ecommerce` database, Import tab, choose this file
--
-- SAFE TO RUN TWICE.
-- Each ADD COLUMN below asks information_schema whether it has already been
-- applied and turns itself into a no-op (`DO 0`) if so, so a second run will
-- not stop with "#1060 - Duplicate column name". PREPARE/EXECUTE are ordinary
-- statements, so this still pastes straight into phpMyAdmin - no DELIMITER
-- change and no stored procedure needed.
--
-- The new columns are appended to the end of `users` rather than positioned
-- with AFTER. Column order is cosmetic, and leaving it out means this file no
-- longer depends on 03 having run first.
-- ===========================================================================

USE `ecommerce`;

-- ---------------------------------------------------------------------------
-- 1. Widen the columns that are about to hold ciphertext.
--
-- This is the step people forget, and the failure is confusing: MySQL
-- truncates the value silently in non-strict mode, and you get a row that
-- will never decrypt again. A 12-character phone number becomes roughly 100
-- characters once you add the random IV, the GCM authentication tag and
-- base64 encoding. Leave generous headroom.
--
-- MODIFY re-applies cleanly, so these need no guard.
-- ---------------------------------------------------------------------------

ALTER TABLE `users`
  MODIFY COLUMN `phone`   VARCHAR(255) NULL,
  MODIFY COLUMN `address` VARCHAR(512) NULL;

ALTER TABLE `orders`
  MODIFY COLUMN `phone`       VARCHAR(255) NULL,
  MODIFY COLUMN `address`     VARCHAR(512) NOT NULL,
  MODIFY COLUMN `postal_code` VARCHAR(255) NULL;

-- ---------------------------------------------------------------------------
-- 2. Account lockout and token invalidation.
--
-- token_version is the trick that makes "sign out everywhere" possible with
-- stateless JWTs. Every token carries the version it was issued under; bump
-- the column and every token minted before that instant stops verifying.
-- Without it a stolen token stays valid until it expires and there is
-- genuinely nothing you can do about it, not even changing the password.
--
-- VARCHAR(45) for the IP because that is the longest possible IPv6 address in
-- text form, including an IPv4-mapped suffix. IPv4-sized columns are a classic
-- source of bugs the day your host enables IPv6.
-- ---------------------------------------------------------------------------

-- users.token_version
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'token_version') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD COLUMN `token_version` INT NOT NULL DEFAULT 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- users.failed_login_count
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'failed_login_count') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD COLUMN `failed_login_count` INT NOT NULL DEFAULT 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- users.locked_until
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'locked_until') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD COLUMN `locked_until` DATETIME NULL');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- users.last_login_at
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'last_login_at') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD COLUMN `last_login_at` DATETIME NULL');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- users.last_login_ip
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'last_login_ip') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD COLUMN `last_login_ip` VARCHAR(45) NULL');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- users.password_changed_at
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'password_changed_at') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD COLUMN `password_changed_at` DATETIME NULL');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 3. Security audit log.
--
-- Separate from application logs on purpose. When you are trying to work out
-- what happened during an incident you do not want the answer buried in
-- request noise, and you want rows that outlive a container restart.
--
-- Note what is NOT stored: no passwords, no tokens, no full card details.
-- An audit log is a high-value target precisely because it is complete, so
-- it should contain the minimum needed to reconstruct events.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `security_events` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- INT UNSIGNED, not INT. It must match users.id exactly, including
  -- signedness, or MySQL refuses to create the foreign key (errno 150).
  `user_id`    INT UNSIGNED    NULL,
  `event`      VARCHAR(60)  NOT NULL,
  `ip`         VARCHAR(45)  NULL,
  `user_agent` VARCHAR(255) NULL,
  `detail`     VARCHAR(500) NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_security_events_user` (`user_id`, `created_at`),
  KEY `idx_security_events_type` (`event`, `created_at`),
  KEY `idx_security_events_ip`   (`ip`, `created_at`),
  CONSTRAINT `fk_security_events_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ON DELETE SET NULL rather than CASCADE: if someone deletes their account,
-- the record that a suspicious login happened should survive. It just stops
-- pointing at a person.

-- ---------------------------------------------------------------------------
-- 4. Backfill sensible values for rows that already exist.
-- ---------------------------------------------------------------------------

UPDATE `users`
   SET `password_changed_at` = COALESCE(`password_changed_at`, `created_at`)
 WHERE `password` IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Create a database user that is not root.
--
-- XAMPP gives you root with no password, which is fine on your laptop and
-- catastrophic anywhere else. The application does not need to create
-- databases, drop tables, or read the mysql.user table - so do not give it
-- permission to. If the app is ever compromised, the blast radius is limited
-- to the data it legitimately touches.
--
-- Uncomment, change the password, and update DB_USER / DB_PASSWORD in .env.
-- ---------------------------------------------------------------------------

-- CREATE USER IF NOT EXISTS 'northline_app'@'localhost'
--   IDENTIFIED BY 'put-a-long-random-password-here';
--
-- GRANT SELECT, INSERT, UPDATE, DELETE
--   ON `ecommerce`.* TO 'northline_app'@'localhost';
--
-- -- Deliberately NOT granted: DROP, ALTER, CREATE, GRANT OPTION, FILE.
-- -- Run migrations as root by hand instead. Note this means you must also
-- -- set DB_SYNC_ALTER=false in .env, because Sequelize's alter mode needs
-- -- ALTER permission.
--
-- FLUSH PRIVILEGES;

-- ---------------------------------------------------------------------------
-- 6. Verify
-- ---------------------------------------------------------------------------

SELECT '04 applied - lockout, token_version and audit log present' AS status;

-- SHOW COLUMNS FROM `users`;
-- SHOW COLUMNS FROM `security_events`;
