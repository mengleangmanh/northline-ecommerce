/**
 * Vercel serverless entry point for the whole API.
 *
 * Every request to /api/* is rewritten here by vercel.json, and Express does
 * its own routing from that point on. There is exactly one function rather
 * than one per route, which means one warm container, one connection pool and
 * one place for middleware - the same shape as the local server.
 *
 * Two things worth knowing:
 *
 * 1. This file is ESM because the project sets "type": "module". A CommonJS
 *    `module.exports = require(...)` would fail here.
 *
 * 2. Importing server.js does NOT start a listener. server.js only calls
 *    app.listen() when process.env.VERCEL is unset, so importing it on Vercel
 *    just builds the app and hands it back.
 */

import app from '../ecommerce-backend/server.js'

export default app
