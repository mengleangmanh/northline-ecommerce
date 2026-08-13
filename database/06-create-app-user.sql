-- ---------------------------------------------------------------------------
-- 06-create-app-user.sql
--
-- Creates a limited database user for the deployed application.
--
-- WHY THIS EXISTS
--
-- Railway hands you the `root` account. server.js refuses to start in
-- production with DB_USER=root, and that check is not being awkward for the
-- sake of it: root can DROP the database. The application never needs to.
-- If an SQL injection bug ever slips past Sequelize's parameterisation, the
-- difference between root and the user below is the difference between a
-- leaked row and an empty database.
--
-- Notice which grants are missing: no CREATE, no ALTER, no DROP. The schema is
-- applied by 01-05 as root, and DB_SYNC_ALTER=false means the app never tries
-- to change a table at runtime. So the app user cannot reshape the database
-- even by accident.
--
-- HOW TO RUN IT (Railway)
--
--   1. Railway -> your MySQL service -> Settings -> Networking -> enable
--      public networking. Note the proxy host and port.
--   2. Change the password below. Generate one:  openssl rand -hex 24
--   3. Connect as root and run this file:
--
--      mysql -h <proxy-host> -P <proxy-port> -u root -p<root-password> \
--            railway < database/06-create-app-user.sql
--
--   4. Put the username and new password into Vercel as DB_USER / DB_PASSWORD.
--
-- Run 01-schema.sql, 03-, 04- and 05- as root BEFORE this file. Skip
-- 02-seed.sql entirely - it contains the demo accounts, and
-- admin@example.com / admin123 must never exist on a public site. Use
-- `npm run seed` instead, which goes through the model hooks that hash
-- passwords and encrypt personal data.
-- ---------------------------------------------------------------------------

-- CHANGE THE PASSWORD on the line below before running. It appears once.
-- '%' rather than 'localhost': Vercel's functions connect from addresses that
-- change, so there is no single host to pin. The password and TLS are what
-- protect this account, not its source address.
CREATE USER IF NOT EXISTS 'ecommerce_app'@'%'
  IDENTIFIED BY 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';

-- Read and write rows. Nothing structural.
-- `railway` is Railway's default database name. If yours differs, change it in
-- all three places here and in DB_NAME on Vercel.
GRANT SELECT, INSERT, UPDATE, DELETE ON `railway`.* TO 'ecommerce_app'@'%';

-- Needed because the order code runs inside transactions with row locks
-- (SELECT ... FOR UPDATE in the oversell guard).
GRANT LOCK TABLES ON `railway`.* TO 'ecommerce_app'@'%';

FLUSH PRIVILEGES;

-- Confirm what you just granted. Read the output - if you see ALL PRIVILEGES,
-- something went wrong.
SHOW GRANTS FOR 'ecommerce_app'@'%';
