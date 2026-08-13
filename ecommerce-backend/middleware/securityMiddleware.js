import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

/**
 * Everything that hardens the HTTP layer, in one place.
 *
 * The ordering in server.js matters more than people expect. These run before
 * the routes so that a request which is going to be rejected is rejected
 * before it touches the database.
 */

const isProduction = process.env.NODE_ENV === 'production'

/**
 * Security headers.
 *
 * Most of these tell the *browser* to enforce something. They cost nothing and
 * close off whole categories of attack, but only for browser traffic - they do
 * nothing against a script hitting your API directly. That is what the rate
 * limiting and validation below are for.
 */
export const securityHeaders = helmet({
  /**
   * Content Security Policy: the browser refuses to load scripts from
   * anywhere not listed here. This is the difference between an XSS bug being
   * "an attacker can run JavaScript on your site" and "an attacker can run
   * JavaScript that cannot phone home".
   *
   * These directives assume Express is serving the built React app. If your
   * frontend is hosted separately (Vercel, Netlify, nginx) set the equivalent
   * headers there too - a header on the API does not protect the pages.
   */
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"], // nobody may iframe the site - stops clickjacking
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      // Vite extracts CSS to a file, but styled components and many UI
      // libraries inject inline styles. Inline *styles* are far lower risk
      // than inline scripts.
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Product images come from picsum/unsplash in the seed data, and social
      // avatars come from Google and Facebook.
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", ...(process.env.API_URL ? [process.env.API_URL] : [])],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  },

  /**
   * HSTS: after the first visit over HTTPS the browser refuses to use plain
   * HTTP for this domain at all, even if the user types http:// or clicks an
   * old link. That closes the window where an attacker on the same wifi can
   * intercept the initial redirect and strip the TLS.
   *
   * Only in production. Sending this from localhost will pin your own machine
   * to HTTPS for every project on localhost, which is a genuinely annoying
   * thing to have to undo in chrome://net-internals.
   */
  hsts: isProduction
    ? { maxAge: 63072000, includeSubDomains: true, preload: true }
    : false,

  // Do not leak the full URL of your site to third parties in the Referer
  // header. Order confirmation URLs contain order numbers.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

  // Product images need to be loadable from the frontend origin.
  crossOriginResourcePolicy: { policy: 'cross-origin' },

  // helmet already removes X-Powered-By: Express. No reason to tell people
  // which framework and version to look up CVEs for.
})

/**
 * Force HTTPS in production.
 *
 * Behind a load balancer or Heroku/Render/Railway, the connection from the
 * proxy to your app is plain HTTP, so req.secure is false even when the user
 * is on HTTPS. X-Forwarded-Proto is what tells you the truth - which is why
 * server.js sets `trust proxy`.
 */
export function requireHttps(req, res, next) {
  if (!isProduction) return next()
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next()
  return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`)
}

/**
 * A general ceiling on requests per IP. Deliberately loose - this is here to
 * stop scraping and accidental infinite loops in someone's frontend code, not
 * to stop a determined attacker. Note that a page load fires several requests
 * at once, so this needs headroom.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProduction ? 600 : 5000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down and try again shortly.' },
})

/**
 * The important one. Login and register get a tight budget.
 *
 * skipSuccessfulRequests means a person who logs in correctly ten times in a
 * row is never blocked - only *failures* count. That is what makes this safe
 * to set aggressively: the only people who hit the limit are the ones guessing.
 *
 * This is per-IP, so it slows down one attacker hammering one account. The
 * per-account lockout in the User model handles the other shape of attack:
 * many IPs against one account. You need both.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    message: 'Too many failed attempts from this address. Please wait 15 minutes and try again.',
  },
})

// Account creation. Stops someone scripting a thousand signups.
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many accounts created from this address. Please try again later.' },
})

// Anything that writes. Reviews, orders, cart changes.
export const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProduction ? 100 : 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many changes in a short time. Please wait a moment.' },
})

/**
 * HTTP parameter pollution.
 *
 * Express turns `?sort=price&sort=name` into an array, and with the extended
 * query parser `?sort[$ne]=x` into an object. Controllers written for a string
 * then behave in ways nobody tested - at best a crash, at worst a filter that
 * silently matches everything.
 *
 * This flattens repeated query parameters to the last value. Add any
 * legitimately-repeatable parameter to the allow list.
 */
const REPEATABLE = new Set(['tag', 'tags', 'id', 'ids', 'category'])

export function preventParameterPollution(req, _res, next) {
  if (!req.query) return next()

  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value) && !REPEATABLE.has(key)) {
      req.query[key] = value[value.length - 1]
    }
  }
  next()
}

/**
 * Strip keys that only exist to confuse a query builder or poison an object.
 *
 * `__proto__` and `constructor` in a request body are prototype pollution
 * attempts. `$gt`, `$ne` and friends are NoSQL injection - harmless against
 * Sequelize, but there is no reason to let them through and this file may
 * outlive the current database choice.
 */
const FORBIDDEN_KEY = /^(\$|__proto__$|constructor$|prototype$)/

function scrub(value, depth = 0) {
  if (depth > 10 || value === null || typeof value !== 'object') return value

  if (Array.isArray(value)) {
    value.forEach(item => scrub(item, depth + 1))
    return value
  }

  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEY.test(key)) {
      delete value[key]
    } else {
      scrub(value[key], depth + 1)
    }
  }
  return value
}

export function sanitizeRequest(req, _res, next) {
  if (req.body) scrub(req.body)
  if (req.query) scrub(req.query)
  if (req.params) scrub(req.params)
  next()
}

/**
 * Block requests whose Content-Type is not what the API accepts.
 *
 * This is quiet but useful. A cross-site form post cannot set Content-Type to
 * application/json without triggering a CORS preflight, which your CORS config
 * will refuse. So requiring JSON on writes is a meaningful second line of
 * defence against CSRF, on top of the token not being in a cookie.
 */
export function requireJsonBody(req, res, next) {
  const method = req.method.toUpperCase()
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return next()

  // A body-less POST is fine (logout, for example).
  const length = Number(req.headers['content-length'] || 0)
  if (length === 0) return next()

  if (!req.is('application/json')) {
    return res.status(415).json({ message: 'This endpoint only accepts application/json' })
  }
  return next()
}

export default {
  securityHeaders,
  requireHttps,
  globalLimiter,
  authLimiter,
  registerLimiter,
  writeLimiter,
  preventParameterPollution,
  sanitizeRequest,
  requireJsonBody,
}
