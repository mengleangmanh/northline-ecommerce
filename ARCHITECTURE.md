# Architecture

## Request flow (production)

```
Browser
  │
  ▼
Vercel edge
  ├─ /api/*  ───────────►  api/index.js  ───►  ecommerce-backend/server.js (Express app)
  │                                                    │
  │                                                    ▼
  │                                             Railway MySQL (Sequelize)
  │
  └─ /*      ───────────►  ecommerce-frontend/dist  (static React build)
```

`vercel.json` rewrites `/api/*` to the single serverless function in `api/`,
which imports the Express app from `ecommerce-backend/server.js` but never
calls `.listen()` on Vercel — `server.js` only starts a real listener when
`process.env.VERCEL` is unset, so the same file works locally (`npm run dev:api`)
and as a serverless import. Everything else falls through to the built SPA.

Locally, frontend and backend run as two separate processes (`npm run dev:web`,
`npm run dev:api`) talking over HTTP, with Vite proxying `/api` to port 5000.

## Backend layout

```
ecommerce-backend/
├── server.js          Express app: middleware order, model imports, route mounting
├── config/
│   ├── db.js           Sequelize connection
│   └── passport.js     Google/Facebook OAuth strategies
├── models/              Sequelize models — one file per table, associations declared at the bottom of each
├── controllers/         Route handlers — one file per resource
├── routes/               Express routers — map HTTP verbs + paths to controller functions
├── middleware/
│   ├── authMiddleware.js       protect / challengeAuth / optionalAuth
│   ├── securityMiddleware.js   Helmet, rate limiters, sanitization
│   ├── adminMiddleware.js      role check, runs after protect
│   └── errorMiddleware.js      404 handler + centralized error formatting
├── utils/                Password hashing, JWT, TOTP, field-level encryption, sanitization
└── scripts/               One-off ops scripts (key generation, encrypting existing rows)
```

Request path for a protected route: `securityHeaders → rate limiter → protect
(or challengeAuth) → controller`. `protect` re-reads the user's role from the
database on every request rather than trusting the JWT payload, so a role
change or account deletion takes effect immediately instead of waiting for
the token to expire.

## Auth model

Three token types, distinguished by a `scp` (scope) claim:

1. **Access token** — normal signed-in state. Required by `protect`.
2. **Challenge token** — issued after a correct password when 2FA is enabled,
   before the TOTP code is verified. Only `challengeAuth` accepts it; `protect`
   explicitly rejects it. This is what makes 2FA a real second factor rather
   than a suggestion the client could ignore.
3. Every token carries a `ver` claim matched against `user.tokenVersion`.
   Bumping `tokenVersion` (on logout-all or password change) invalidates every
   token issued before that moment, including ones already in a browser.

Social login (Google/Facebook) joins the same pipeline at `socialSuccess` —
it still routes through the 2FA check before minting a token, so a linked
social account can't be used to bypass 2FA on the underlying account.

## Data protection

`utils/crypto.js` encrypts specific PII columns (phone, address, city,
country) with AES-256-GCM at the Sequelize model level, so plaintext never
reaches the database. `ENCRYPTION_KEY` is required at boot and is not
recoverable if lost — see `docs/SECURITY.md` before writing real user data.

## Frontend layout

```
ecommerce-frontend/src/
├── main.jsx / App.jsx    Router + top-level providers
├── context/               AuthContext, CartContext, ThemeContext (React Context, no external state lib)
├── pages/                  One component per route; pages/admin/ for the admin panel
├── components/             Shared UI (Navbar, ProductCard, ProtectedRoute, ...)
└── services/                 One file per backend resource; all HTTP calls go through services/api.js
```

`ProtectedRoute` gates admin/account pages client-side; the actual
authorization boundary is still server-side (`protect` + `adminMiddleware`) —
the client-side gate is a UX convenience, not a security control.

## Database

MySQL via Sequelize. Numbered SQL files in `database/` are an alternative to
`sequelize.sync()` for people who'd rather create the schema by hand — see
`docs/DATABASE.md` for what each one does and the order to run them in.
