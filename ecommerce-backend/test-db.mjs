/**
 * test-db.mjs - check a database connection from YOUR computer, before you
 * ever deploy. Run it from the ecommerce-backend folder:
 *
 *     node test-db.mjs
 *
 * It reads the same DB_* variables the app reads, so it proves the exact
 * credentials you are about to paste into Vercel actually work.
 *
 * To test Railway rather than your local XAMPP, pass the values inline:
 *
 *   Windows PowerShell:
 *     $env:DB_HOST="..."; $env:DB_PORT="..."; $env:DB_NAME="railway"
 *     $env:DB_USER="root"; $env:DB_PASSWORD="..."; $env:DB_SSL="true"
 *     $env:DB_SSL_REJECT_UNAUTHORIZED="false"; node test-db.mjs
 *
 *   Mac/Linux:
 *     DB_HOST=... DB_PORT=... DB_NAME=railway DB_USER=root DB_PASSWORD=... \
 *     DB_SSL=true DB_SSL_REJECT_UNAUTHORIZED=false node test-db.mjs
 */

import 'dotenv/config'
import mysql from 'mysql2/promise'

const cfg = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
}

const useSsl = String(process.env.DB_SSL).toLowerCase() === 'true'
if (useSsl) {
  cfg.ssl = {
    rejectUnauthorized:
      String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase() !== 'false',
  }
}

const mask = v => (v ? `set (${String(v).length} chars)` : 'EMPTY')

console.log('\nConnecting with:')
console.log(`  host      ${cfg.host}`)
console.log(`  port      ${cfg.port}`)
console.log(`  database  ${cfg.database || 'NOT SET'}`)
console.log(`  user      ${cfg.user || 'NOT SET'}`)
console.log(`  password  ${mask(cfg.password)}`)
console.log(`  ssl       ${useSsl ? `on (verify certificate: ${cfg.ssl.rejectUnauthorized})` : 'off'}`)

const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(cfg.host)
if (isLocal) {
  console.log(
    '\n  NOTE: this host is your own computer. Vercel cannot reach it.\n' +
      '        Fine for a local check, useless as a Vercel value.',
  )
}

/** Turn a driver error into the actual thing that is wrong. */
function explain(err) {
  switch (err.code) {
    case 'ECONNREFUSED':
      return isLocal
        ? 'Nothing is listening on that port here. Start MySQL in the XAMPP Control Panel.'
        : 'The server refused the connection. On Railway: Settings -> Networking -> enable public networking, then use the PROXY host and port (the port is not 3306).'
    case 'ETIMEDOUT':
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'The host name could not be reached. Check DB_HOST for a typo, and that you copied the public proxy host rather than the internal one.'
    case 'ER_ACCESS_DENIED_ERROR':
      return 'The server answered but rejected the username or password. Re-copy DB_USER and DB_PASSWORD. If you created ecommerce_app, confirm you ran 06-create-app-user.sql.'
    case 'ER_BAD_DB_ERROR':
      return `The server answered but has no database called "${cfg.database}". On Railway the database is usually named "railway", not "ecommerce".`
    case 'ER_NOT_SUPPORTED_AUTH_MODE':
      return 'The server wants an authentication plugin the driver refused. Usually means MySQL 8 with caching_sha2 and an old client - not expected here.'
    case 'HANDSHAKE_SSL_ERROR':
    case 'ERR_SSL_WRONG_VERSION_NUMBER':
      return 'TLS handshake failed. If the server has no TLS, set DB_SSL=false. If it uses a self-signed certificate, set DB_SSL=true and DB_SSL_REJECT_UNAUTHORIZED=false.'
    default:
      if (/self.signed certificate/i.test(err.message)) {
        return 'The certificate is self-signed. Set DB_SSL_REJECT_UNAUTHORIZED=false (Railway needs this).'
      }
      return 'Unrecognised error - the message above is the useful part.'
  }
}

let conn
try {
  conn = await mysql.createConnection({ ...cfg, connectTimeout: 10000 })
  console.log('\nCONNECTED\n')
} catch (err) {
  console.error(`\nFAILED: ${err.code || 'error'} - ${err.message}\n`)
  console.error(`  ${explain(err)}\n`)
  process.exit(1)
}

try {
  const [[ver]] = await conn.query(
    'SELECT VERSION() AS version, DATABASE() AS db, USER() AS whoami',
  )
  console.log(`  server    ${ver.version}`)
  console.log(`  database  ${ver.db}`)
  console.log(`  connected as ${ver.whoami}`)

  if (/mariadb/i.test(ver.version)) {
    console.log('\n  NOTE: this is MariaDB, not MySQL (XAMPP ships MariaDB).')
  }

  const [tables] = await conn.query(
    'SELECT table_name AS name, engine, table_rows AS rows_est FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name',
    [ver.db],
  )

  console.log(`\nTables: ${tables.length}`)
  if (tables.length === 0) {
    console.log('\n  The database is EMPTY. Run the migrations:')
    console.log('    01-schema.sql, 03-add-social-login.sql, 04-security-hardening.sql, 05-two-factor.sql')
    console.log('  Skip 02-seed.sql - use `npm run seed` instead.\n')
  } else {
    for (const t of tables) {
      const flag = t.engine === 'InnoDB' ? '' : `  <- engine is ${t.engine}, foreign keys will NOT work`
      console.log(`  ${t.name}${flag}`)
    }

    const names = tables.map(t => t.name.toLowerCase())
    const expected = ['users', 'products', 'categories', 'orders', 'order_items']
    const missing = expected.filter(e => !names.includes(e))
    if (missing.length) {
      console.log(`\n  MISSING tables: ${missing.join(', ')} - the schema is incomplete.`)
    }

    if (names.includes('products')) {
      const [[all]] = await conn.query('SELECT COUNT(*) AS n FROM products')
      const [[pub]] = await conn.query(
        'SELECT COUNT(*) AS n FROM products WHERE published = 1',
      )
      console.log(`\nProducts: ${all.n} total, ${pub.n} published`)

      if (all.n === 0) {
        console.log('\n  No products. Your shop will render but show nothing.')
        console.log('  Run: npm run seed\n')
      } else if (pub.n === 0) {
        console.log('\n  Products exist but none are published, so shoppers see an empty shop.\n')
      } else {
        console.log('  A shopper should see products.\n')
      }
    }
  }

  // The oversell guard runs inside a transaction and needs real row locking.
  const [[{ n: nonInnodb }]] = await conn.query(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND engine <> ?',
    [ver.db, 'InnoDB'],
  )
  if (nonInnodb > 0) {
    console.log(`WARNING: ${nonInnodb} table(s) are not InnoDB. Foreign keys and the`)
    console.log('         stock-oversell transaction will silently misbehave.\n')
  }

  if (String(cfg.user).toLowerCase() === 'root') {
    console.log('WARNING: you are connecting as root. The app refuses to start in')
    console.log('         production as root. Create the limited user first:')
    console.log('         database/06-create-app-user.sql\n')
  }

  if (!cfg.password) {
    console.log('WARNING: empty password. The app refuses to start in production\n         with no password.\n')
  }

  if (!isLocal && !useSsl) {
    console.log('WARNING: connecting to a remote database without TLS. Your password\n         and all data cross the internet in the clear. Set DB_SSL=true.\n')
  }

  console.log('These exact values will work from Vercel, provided the host is')
  console.log('reachable from the internet and not your own computer.\n')
} finally {
  await conn.end()
}
