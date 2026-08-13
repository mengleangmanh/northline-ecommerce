-- ===========================================================================
-- 03 - Add Google and Facebook sign-in to an EXISTING database
--
-- Run this if you already created your tables from 01-schema.sql and have data
-- you want to keep. Starting completely fresh? Re-run 01-schema.sql instead -
-- it already contains all of these columns.
--
--   phpMyAdmin: select `ecommerce`, SQL tab, paste, Go
--   Shell:      mysql -u root -p ecommerce < 03-add-social-login.sql
--
-- SAFE TO RUN TWICE.
-- Every step below checks whether it has already been applied and skips itself
-- if so, so you will not get "#1060 - Duplicate column name" on a second run.
--
-- How the guard works, once, so the repetition below is readable:
--   information_schema.COLUMNS is MySQL's own catalogue of every column in
--   every table. We ask it whether the column already exists, build either the
--   real ALTER or the no-op `DO 0` as a string, and execute that string.
--   PREPARE/EXECUTE are ordinary statements, so this pastes into phpMyAdmin
--   as-is - no DELIMITER change, no stored procedure to create and clean up.
--
-- Note: the new columns are appended to the end of the table rather than
-- slotted in after `role`. Column order is cosmetic in SQL and dropping the
-- AFTER clause is what lets these files run in any order.
-- ===========================================================================

USE `ecommerce`;

-- ---------------------------------------------------------------------------
-- 1. The password column has to allow NULL.
--
-- Someone who signs up with Google never chooses a password here, so there is
-- genuinely nothing to store. A NOT NULL column would force us to invent a
-- fake hash, and a fake hash is a real password that someone might guess.
--
-- MODIFY is naturally repeatable - applying it twice just sets the same
-- definition again - so this one needs no guard.
-- ---------------------------------------------------------------------------

ALTER TABLE `users`
  MODIFY COLUMN `password` VARCHAR(255) NULL DEFAULT NULL;

-- ---------------------------------------------------------------------------
-- 2. Which front door the account came through, and the provider's own id.
--
-- Match returning users on provider_id, never on the email address: people
-- change their Gmail address, but this id is stable for the life of the
-- account.
-- ---------------------------------------------------------------------------

-- users.provider
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'provider') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD COLUMN `provider` ENUM(''local'',''google'',''facebook'') NOT NULL DEFAULT ''local''');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- users.provider_id
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'provider_id') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD COLUMN `provider_id` VARCHAR(191) DEFAULT NULL');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- users.avatar
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'avatar') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD COLUMN `avatar` VARCHAR(255) DEFAULT NULL');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- users.email_verified
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'email_verified') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD COLUMN `email_verified` TINYINT(1) NOT NULL DEFAULT 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 3. Stop one Google account being attached to two rows.
--
-- Every existing row has provider_id = NULL, and MySQL treats each NULL as
-- distinct, so this unique index never clashes with your email/password
-- accounts no matter how many there are.
--
-- Indexes live in information_schema.STATISTICS rather than COLUMNS.
-- ---------------------------------------------------------------------------

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND INDEX_NAME   = 'uq_users_provider_account') > 0,
  'DO 0',
  'ALTER TABLE `users` ADD UNIQUE KEY `uq_users_provider_account` (`provider`, `provider_id`)');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 4. Existing accounts were all created with a password, so mark them local.
--
-- This is what the DEFAULT already did, but being explicit makes the migration
-- safe to read six months from now. UPDATE is repeatable by nature.
-- ---------------------------------------------------------------------------

UPDATE `users`
   SET `provider` = 'local'
 WHERE `provider_id` IS NULL;

-- ---------------------------------------------------------------------------
-- Check it worked
-- ---------------------------------------------------------------------------

SELECT '03 applied - social login columns present' AS status;

-- SHOW COLUMNS FROM `users`;
-- SELECT id, name, email, provider, provider_id, email_verified,
--        (password IS NOT NULL) AS has_password
--   FROM `users`;
