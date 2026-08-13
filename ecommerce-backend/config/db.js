import fs from 'node:fs'
import { Sequelize } from 'sequelize'
import dotenv from 'dotenv'

dotenv.config()

/**
 * Encryption in transit, between this app and MySQL.
 *
 * On your laptop the app and the database talk over the loopback interface
 * and never touch a network, so TLS buys you nothing and DB_SSL should stay
 * off. The moment the database lives on another machine - a managed MySQL, a
 * separate container host, anything with a network in between - the login
 * credentials and every row you fetch cross that network. Without TLS they
 * cross it in the clear.
 *
 * rejectUnauthorized is the setting that actually matters. With it false, the
 * connection is encrypted but unauthenticated: you have no idea whether you
 * are talking to your database or to something that intercepted the
 * connection, which defeats most of the point. Only turn it off if your
 * provider uses a self-signed certificate, and prefer supplying their CA file
 * through DB_SSL_CA instead.
 */
function sslOptions() {
  if (process.env.DB_SSL !== 'true') return undefined

  const ssl = {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
  }

  if (process.env.DB_SSL_CA) {
    ssl.ca = fs.readFileSync(process.env.DB_SSL_CA, 'utf8')
  }

  if (!ssl.rejectUnauthorized) {
    console.warn(
      'DB_SSL_REJECT_UNAUTHORIZED=false - the database connection is encrypted but the server identity is NOT verified. Do not ship this.',
    )
  }

  return ssl
}

/**
 * Are we running as a serverless function rather than a long-lived server?
 *
 * Vercel sets VERCEL=1 in every build and every function invocation. This one
 * flag drives three different decisions below, because a serverless container
 * is short-lived, may be one of many, and has nobody watching a terminal.
 */
const isServerless = Boolean(process.env.VERCEL)

function createSequelize() {
  return new Sequelize(
  process.env.DB_NAME || 'ecommerce',
  process.env.DB_USER || 'root',
  process.env.DB_PASSWORD || '',
  {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    dialect: 'mysql',

    /**
     * Never log SQL in production. Query logs contain the values you bound to
     * the statement, which means email addresses and anything else in a WHERE
     * clause ends up in a log file that is backed up, shipped to a log service
     * and read by people who do not need to see it.
     */
    logging:
      process.env.SQL_LOG === 'true' && process.env.NODE_ENV !== 'production'
        ? console.log
        : false,

    define: {
      underscored: true,
      freezeTableName: false,
    },

    dialectOptions: {
      ssl: sslOptions(),
      connectTimeout: 10000,
      // Refuse to let the driver run two statements in one call. Sequelize
      // parameterises everything, so injection should be impossible anyway -
      // but if a raw query ever slips through, this is the difference between
      // a leaked row and a dropped table. It is off by default in mysql2;
      // being explicit documents the intent.
      multipleStatements: false,
    },

    /**
     * Pool size is the one setting that must change for serverless.
     *
     * On a normal server there is one process, so one pool of ten connections
     * is correct. On Vercel there may be dozens of containers at once, and each
     * would build its own pool of ten. Thirty containers x ten = three hundred
     * connections against a database that allows perhaps twenty, and you get
     * ER_CON_COUNT_ERROR under exactly the traffic you were hoping for.
     *
     * Two per container, evicted quickly, is the shape that works.
     */
    pool: {
      max: Number(process.env.DB_POOL_MAX || (isServerless ? 2 : 10)),
      min: 0,
      idle: isServerless ? 5000 : 10000,
      acquire: isServerless ? 15000 : 30000,
      evict: 5000,
    },
  },
  )
}

/**
 * Cache the instance on globalThis.
 *
 * A serverless container is reused between invocations when it stays warm, but
 * module state can be re-evaluated. Hanging the Sequelize instance off
 * globalThis means a warm container reuses the existing pool instead of opening
 * a fresh one on every request - which is the difference between a fast API and
 * one that exhausts its connection limit.
 *
 * On a normal server this branch runs exactly once and changes nothing.
 */
const globalForDb = globalThis

if (!globalForDb.__ecommerceSequelize) {
  globalForDb.__ecommerceSequelize = createSequelize()
}

export const sequelize = globalForDb.__ecommerceSequelize

export async function connectDB() {
  try {
    await sequelize.authenticate()

    const mode = process.env.DB_SSL === 'true' ? 'TLS' : 'plain (local)'
    console.log(`MySQL connected: ${process.env.DB_NAME} over ${mode}`)
  } catch (err) {
    console.error('MySQL connection failed:', err.message)

    if (isServerless) {
      /**
       * Do not exit on serverless. There is no operator watching a terminal,
       * and killing the process only means the next invocation starts from
       * nothing - it fixes neither a wrong password nor an unreachable host.
       * Throw instead, and let server.js turn it into a 503 with a message.
       */
      throw err
    }

    console.error('Is XAMPP MySQL running? Does the database exist?')
    process.exit(1)
  }
}

export default sequelize
