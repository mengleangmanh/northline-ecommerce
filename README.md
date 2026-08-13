# Northline

A full-stack e-commerce app: React storefront + admin panel on the front end,
Express + Sequelize (MySQL) API on the back end, with social sign-in, email/
password auth, 2FA, and encrypted personal data.

Deployed as a single Vercel project — see [`docs/DEPLOY-VERCEL.md`](docs/DEPLOY-VERCEL.md).

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, React Router |
| Backend | Node.js, Express, Sequelize |
| Database | MySQL |
| Auth | JWT, Passport (Google/Facebook OAuth), TOTP 2FA |
| Hosting | Vercel (frontend + serverless API), Railway (MySQL) |

## Project layout

```
.
├── api/                  Vercel serverless entry point (wraps ecommerce-backend/server.js)
├── database/             Numbered SQL migrations, run in order (see docs/DATABASE.md)
├── docs/                 Security model, deployment, social login setup, design mockups
├── ecommerce-backend/    Express API (controllers, models, routes, middleware)
├── ecommerce-frontend/   React app (Vite)
├── package.json          Root scripts (dev:api, dev:web, vercel-build)
└── vercel.json           Routes /api/* to the serverless function, everything else to the SPA
```

`ecommerce-backend` and `ecommerce-frontend` are independent npm projects; the
root `package.json` just orchestrates them. Their folder names are load-bearing —
`vercel.json` and `api/index.js` reference `ecommerce-backend` by path, so don't
rename them without updating both.

## Quick start

```bash
# 1. Database — create it and run the migrations in database/, in order
#    (see docs/DATABASE.md)

# 2. Backend
cd ecommerce-backend
cp .env.example .env      # fill in DB credentials, JWT secret, ENCRYPTION_KEY
npm install
npm run keys               # generates JWT secret + encryption key if you don't have one
npm run dev                # http://localhost:5000

# 3. Frontend (new terminal)
cd ecommerce-frontend
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

Social login and 2FA are optional — the app runs without them. To enable
Google/Facebook sign-in, see [`docs/SOCIAL-LOGIN-SETUP.md`](docs/SOCIAL-LOGIN-SETUP.md).

## Docs

- [`docs/DATABASE.md`](docs/DATABASE.md) — what each migration does and the order to run them
- [`docs/SECURITY.md`](docs/SECURITY.md) — encryption at rest, account lockout, 2FA, what's *not* covered
- [`docs/SOCIAL-LOGIN-SETUP.md`](docs/SOCIAL-LOGIN-SETUP.md) — Google/Facebook OAuth app setup
- [`docs/DEPLOY-VERCEL.md`](docs/DEPLOY-VERCEL.md) — production deployment (Vercel + Railway)
- [`docs/design-preview/`](docs/design-preview/) — static HTML mockups of the storefront/admin UI
- [`CODE_REVIEW.md`](CODE_REVIEW.md) — audit notes: what's solid, what to fix before shipping

## A note on secrets

This repo's `.env` files and the Google OAuth client JSON are **not** included
here — only `.env.example` templates. Generate your own with `npm run keys`
(backend) and your own OAuth app credentials (see the social login doc). Never
commit a real `.env` or OAuth client secret file; both are in `.gitignore` for
that reason.
