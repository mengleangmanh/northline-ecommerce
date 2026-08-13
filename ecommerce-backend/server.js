import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'

import { connectDB, sequelize } from './config/db.js'

// Importing the models registers them and their associations with Sequelize
// before sync() runs. Order matters: each model imports the ones it points at.
import './models/User.js'
import './models/Category.js'
import './models/Product.js'
import './models/Review.js'
import './models/Cart.js'
import './models/Order.js'
import './models/SecurityEvent.js'
import './models/RecoveryCode.js'

// Must come after the models, because the strategies use the User model.
import passport, { enabledProviders } from './config/passport.js'

import authRoutes from './routes/authRoutes.js'
import productRoutes from './routes/productRoutes.js'
import categoryRoutes from './routes/categoryRoutes.js'
import cartRoutes from './routes/cartRoutes.js'
import orderRoutes from './routes/orderRoutes.js'
import reviewRoutes from './routes/reviewRoutes.js'

import { notFound, errorHandler } from './middleware/errorMiddleware.js'
import {
  securityHeaders,
  requireHttps,
  globalLimiter,
  writeLimiter,
  preventParameterPollution,
  sanitizeRequest,
  requireJsonBody,
} from './middleware/securityMiddleware.js'

// ---------------------------------------------------------------------------
// Boot checks. Fail loudly at startup rather than on the first request that
// happens to need the missing thing.
// ---------------------------------------------------------------------------

/**
 * Running as a Vercel serverless function rather than a long-lived server.
 * Vercel sets VERCEL=1 automatically, in builds and in every invocation.
 */
const isServerless = Boolean(process.env.VERCEL)

/**
 * Configuration problems, collected rather than acted on immediately.
 *
 * On a real server, exiting here is the right behaviour: you see the message in
 * your terminal and fix your .env before anything else happens.
 *
 * In a serverless function it is the wrong behaviour and produces a genuinely
 * confusing failure. process.exit() during module import kills the process
 * before it can respond to anything, and the platform reports
 * FUNCTION_INVOCATION_FAILED - a 500 with no reason attached. The actual cause
 * never reaches you.
 *
 * So the problems are collected, printed to the runtime logs, and turned into a
 * 503 that says what is wrong.
 */
const bootProblems = []

for (const key of ['DB_NAME', 'DB_USER', 'JWT_SECRET', 'ENCRYPTION_KEY']) {
  if (!process.env[key]) {
    bootProblems.push(`Missing ${key} - run \`npm run keys\` to generate the secrets`)
  }
}

if (process.env.NODE_ENV === 'production') {
  // The things that are merely untidy in development and dangerous in
  // production.
  const problems = bootProblems

  // Guard the string checks. Previously the loop above had already exited if
  // JWT_SECRET was missing, so .length was safe. Now that nothing exits early,
  // an unset JWT_SECRET would throw a TypeError here - which on serverless is
  // the very crash this rewrite is meant to remove.
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) problems.push('JWT_SECRET is too short - needs 32+ characters')
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.includes('change-me')) problems.push('JWT_SECRET is still the placeholder')
  if (!process.env.DB_PASSWORD) problems.push('DB_PASSWORD is empty')
  if (process.env.DB_USER === 'root') problems.push('DB_USER is root - create a limited user with database/06-create-app-user.sql')
  if (process.env.DB_SYNC_ALTER === 'true') problems.push('DB_SYNC_ALTER must be false in production')
  if (process.env.SQL_LOG === 'true') problems.push('SQL_LOG must be false in production')

}

if (bootProblems.length) {
  console.error('Configuration problems:')
  bootProblems.forEach(p => console.error(`  - ${p}`))

  if (!isServerless) {
    console.error('Refusing to start. Fix the above in .env, then try again.')
    process.exit(1)
  }

  console.error('Serverless: staying alive so /api can answer 503 with a reason.')
}

const app = express()
const PORT = process.env.PORT || 5000

/**
 * Behind a proxy - nginx, Render, Railway, Heroku, Cloudflare - the socket
 * this app sees belongs to the proxy, so req.ip would be the proxy's address
 * for every visitor. Rate limiting would then treat the whole internet as one
 * client and lock everyone out together.
 *
 * The number is how many proxies to trust. Setting `true` instead trusts
 * whatever any client claims in X-Forwarded-For, which lets an attacker spoof
 * an address and walk straight around the rate limiter.
 */
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1))

// Do not advertise the framework. Minor, but free.
app.disable('x-powered-by')

// ---------------------------------------------------------------------------
// Security middleware. Order matters - each of these should get the chance to
// reject a request before anything more expensive runs.
// ---------------------------------------------------------------------------

app.use(requireHttps) // production only, no-op locally
app.use(securityHeaders) // helmet: CSP, HSTS, frame options, referrer policy

/**
 * CORS decides which other websites are allowed to read responses from this
 * API using the visitor's browser and their signed-in credentials.
 *
 * The dangerous mistake is `origin: '*'`, or reflecting back whatever Origin
 * arrives. That lets any site on the internet call your API as your logged-in
 * user. An explicit allow-list is the only safe form.
 */
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim().replace(/\/+$/, ''))
  .filter(Boolean)

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header at all means curl, Postman, or a server-to-server
      // call - not a browser, so there is no cross-site risk to prevent.
      if (!origin) return callback(null, true)
      if (allowedOrigins.includes(origin.replace(/\/+$/, ''))) return callback(null, true)

      return callback(new Error(`Origin ${origin} is not allowed by CORS`))
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }),
)

app.use(globalLimiter)

/**
 * 100kb is plenty for JSON that only ever carries form fields and a short
 * cart. The default is 100kb already; being explicit matters because a large
 * limit is a cheap denial of service - the body is buffered into memory before
 * any of your code runs. Raise it only for a route that genuinely needs it.
 */
app.use(express.json({ limit: '100kb' }))
app.use(express.urlencoded({ extended: false, limit: '100kb' }))

app.use(requireJsonBody)
app.use(preventParameterPollution)
app.use(sanitizeRequest)

if (process.env.NODE_ENV !== 'test') {
  // 'dev' is colourful and short. In production use a format without the
  // query string, so tokens or emails in a URL do not land in the log.
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))
}

// Passport needs initialize() only. There is no session middleware and no
// session store, because every strategy runs with { session: false } and we
// hand the browser our own JWT at the end of the flow.
app.use(passport.initialize())

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Health check. Deliberately declared BEFORE the database gate below, so it
 * still answers when the database is unreachable - which is exactly when you
 * need it. It reports the database separately instead of failing outright.
 */
app.get('/api/health', async (_req, res) => {
  let database = 'ok'

  try {
    await sequelize.authenticate()
  } catch (err) {
    database = `unavailable: ${err.message}`
  }

  res.json({
    status: bootProblems.length ? 'misconfigured' : 'ok',
    // The problem list names environment variables and their weaknesses, which
    // is exactly the sort of thing not to hand to a stranger. In production you
    // get the count and a pointer to the logs; locally you get the detail.
    configuration: bootProblems.length
      ? process.env.NODE_ENV === 'production'
        ? `${bootProblems.length} problem(s) - see the Vercel runtime logs for the list`
        : bootProblems
      : 'ok',
    database,
    runtime: isServerless ? 'serverless' : 'server',
    time: new Date().toISOString(),
    socialLogin: enabledProviders,
  })
})

/**
 * Lazy database connection, for serverless only.
 *
 * On a normal server, start() below connects once before the first request can
 * arrive. A serverless function has no startup phase at all - the first request
 * IS the startup - so the connection has to be established on demand.
 *
 * The promise is cached rather than the result, so a burst of simultaneous
 * requests in one cold container share a single authenticate() instead of each
 * opening its own. On failure the cache is cleared so the next request retries
 * rather than being stuck with a rejected promise forever.
 */
let dbReady = null

function ensureDatabase() {
  if (!dbReady) {
    dbReady = sequelize.authenticate().catch(err => {
      dbReady = null
      throw err
    })
  }

  return dbReady
}

app.use('/api', async (_req, res, next) => {
  if (!isServerless) return next()

  // Misconfigured beats unreachable: there is no point trying to connect with
  // credentials we already know are wrong.
  if (bootProblems.length) {
    return res.status(503).json({
      message:
        'The API is not configured correctly and cannot serve requests. Check the Vercel runtime logs, or open /api/health.',
    })
  }

  try {
    await ensureDatabase()
    next()
  } catch (err) {
    console.error('Database unavailable:', err.message)

    // 503, not 500. This is "try again", not "your request was wrong", and the
    // message names the likely cause without leaking the connection details.
    res.status(503).json({
      message: 'Database unavailable. Check the DB_* environment variables and that the database allows external connections.',
    })
  }
})

app.use('/api/auth', authRoutes)
app.use('/api/products', productRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/cart', writeLimiter, cartRoutes)
app.use('/api/orders', writeLimiter, orderRoutes)
app.use('/api/reviews', writeLimiter, reviewRoutes)

app.use('/api', (req, res) => {
  res.status(404).json({ message: `No API route for ${req.method} /api${req.url}` })
})

app.use(notFound)
app.use(errorHandler)

// ---------------------------------------------------------------------------

async function start() {
  await connectDB()

  await sequelize.sync({ alter: process.env.DB_SYNC_ALTER === 'true' })
  console.log('Tables are ready')

  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`)
    console.log(
      enabledProviders.length
        ? `Social sign-in enabled: ${enabledProviders.join(', ')}`
        : 'Social sign-in disabled (no provider keys in .env)',
    )
    console.log('Personal data encryption: AES-256-GCM, active')
  })
}

/**
 * Only start a listener when this is a real server.
 *
 * On Vercel this branch never runs. api/index.js imports the app and hands it
 * to the platform, which invokes it per request. Calling listen() there would
 * bind a port nothing is watching, and sync() would try to alter a live schema
 * on every cold start.
 */
if (!isServerless) {
  start().catch(err => {
    console.error('Failed to start server:', err)
    process.exit(1)
  })
}

export default app
