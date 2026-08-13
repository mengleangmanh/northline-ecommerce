# Deploying Northline to Vercel

One Vercel project. One domain. The React build is served as static files, and
the entire Express API runs as a single serverless function mounted at `/api`.

The database is the one thing that cannot live on Vercel, so it goes on Railway.

```
https://your-app.vercel.app/        ->  ecommerce-frontend/dist   (static)
https://your-app.vercel.app/api/*   ->  api/index.js              (function)
                                             |
                                             v
                                       Railway MySQL
```

## Why one origin is the good option, not just the convenient one

Splitting the front end and the API across two hosts means the browser makes
cross-origin requests, which means a CORS allow-list to maintain and, if you
ever move to cookie auth, `SameSite=None; Secure` - the setting that exists
specifically to permit cross-site cookies, and the one every tracker also uses.

Same-origin removes that whole category of problem. `/api/orders` is just a path
on the site the user is already on. No preflight, no third-party cookie,
nothing to configure.

---

## What was already changed for you

These edits are in the repository. You do not need to make them.

| File | Change | Why |
| --- | --- | --- |
| `package.json` (new, root) | Backend dependencies + `vercel-build` script | Vercel installs only the **root** manifest for the function |
| `api/index.js` (new) | Imports the Express app, `export default app` | The serverless entry point |
| `vercel.json` (new) | Build command, output directory, rewrites | Declares one static site plus one function |
| `.gitignore` (new, root) | Ignores `.env`, `.vercel/`, `dist/` | Keeps secrets and build output out of git |
| `.env.vercel.example` (new) | Every variable you must set, annotated | A checklist for the dashboard |
| `database/06-create-app-user.sql` (new) | A non-root database user | `server.js` refuses to run as root in production |
| `ecommerce-backend/server.js` | `listen()` and `sync()` gated on `!VERCEL`; lazy DB connect; health check reports DB state | A function has no startup phase |
| `ecommerce-backend/config/db.js` | Pool max 2 on serverless, cached on `globalThis`, no `process.exit` | Prevents connection exhaustion |

Nothing was changed for local development. `npm run dev` in each folder behaves
exactly as before, because every new branch is behind `process.env.VERCEL`,
which Vercel sets and your laptop does not.

### One thing you should know about your own code

There is **no file upload** in this project. `Product.image` is a `STRING(255)`
holding a URL, set from the request body. No multer, no disk write, nothing
touching the filesystem.

That matters because Vercel's filesystem is read-only and ephemeral, so an
upload feature would have needed rewriting onto blob storage. Yours does not.
If you add real image uploads later, that is when `@vercel/blob` becomes
necessary.

---

## Step 1 - The database on Railway

1. Create a MySQL service on Railway. Wait for the status to read **Active**;
   while it says *Deploying*, the connection details are not final.
2. **Settings -> Networking -> enable public networking.** Vercel sits outside
   Railway's private network, so the internal hostname is unreachable. You get a
   proxy host and a port - **the port is not 3306.**

   Which variable goes where, from the service's **Variables** tab:

   | Railway variable | Use it for |
   | --- | --- |
   | `RAILWAY_TCP_PROXY_DOMAIN` | `DB_HOST` |
   | `RAILWAY_TCP_PROXY_PORT`   | `DB_PORT` |
   | `MYSQLDATABASE` (`railway`) | `DB_NAME` |
   | `MYSQLPASSWORD`            | `DB_PASSWORD` |
   | `MYSQLHOST`                | **nothing - private network** |
   | `MYSQLPORT` (`3306`)       | **nothing - private port** |

   `MYSQLHOST` and `MYSQLPORT` look like the obvious choices and are the wrong
   ones. If your port is 3306, you copied the internal value.

   Everything you need is also in `MYSQL_PUBLIC_URL`, in one line:

   ```
   mysql://USER:PASSWORD@HOST:PORT/DATABASE
   ```

3. Confirm the credentials work **before** involving Vercel:

```bash
cd ecommerce-backend
DB_HOST=<proxy-host> DB_PORT=<proxy-port> DB_NAME=railway \
DB_USER=root DB_PASSWORD=<root-password> \
DB_SSL=true DB_SSL_REJECT_UNAUTHORIZED=false \
node test-db.mjs
```

Expect `CONNECTED` and `Tables: 0`. The script names the cause when it fails,
which Vercel will not - there you get only `FUNCTION_INVOCATION_FAILED`.

4. Apply the migrations as root, from the `database/` folder:

```bash
MYSQL="mysql -h <proxy-host> -P <proxy-port> -u root -p<root-password> railway"

$MYSQL < 01-schema.sql
$MYSQL < 03-add-social-login.sql
$MYSQL < 04-security-hardening.sql
$MYSQL < 05-two-factor.sql
```

On Windows, PowerShell has no `<` input redirect, so that Bash form fails. Run
`database/run-migrations-railway.ps1` instead - it prompts for the connection,
tests it, and stops on the first error. If the XAMPP client reports
`Authentication plugin 'caching_sha2_password' cannot be loaded`, that client is
MariaDB and cannot talk to MySQL 8; use Railway's **Data -> Query** tab, or
MySQL Workbench. Your app is unaffected - the `mysql2` driver handles it, which
is why `test-db.mjs` connects when `mysql.exe` will not.

**Do not run `02-seed.sql`.** It inserts `admin@example.com` / `admin123`. A
public site with a known admin password is not a site, it is an invitation. It
also writes passwords and personal fields directly, bypassing the model hooks
that hash and encrypt them - so those rows would be broken as well as unsafe.

5. Create the limited application user (edit the password inside the file first):

```bash
$MYSQL < 06-create-app-user.sql
```

6. Seed through the application, so the hooks run:

```bash
cd ecommerce-backend
# with the Railway DB_* values in your local .env, temporarily
npm run seed
```

### Foreign keys are not optional here

`OrderItem.productId` is nullable with `ON DELETE SET NULL`, which is what lets
you delete a product without destroying the order history referencing it - the
order keeps its own `nameSnapshot` and `priceCents`. A host without real foreign
keys breaks that silently. Railway runs standard MySQL, so it is fine.

---

## Step 2 - Deploy

1. Push to GitHub. **Check `.env` is not in the repository first:**

```bash
git status --porcelain | grep -i env          # only .example files
git log --all --name-only | grep -c ".env$"   # should print 0
```

   If `.env` was ever committed, adding it to `.gitignore` now does **not**
   remove it from history. Rotate every secret in it.

2. Import the repository in Vercel. Leave the framework preset alone -
   `vercel.json` specifies the build. **Set the root directory to the repository
   root**, not `ecommerce-frontend`.

3. Add every variable from `.env.vercel.example` under
   **Settings -> Environment Variables**. Generate fresh secrets:

```bash
cd ecommerce-backend && npm run keys
```

4. Deploy.

---

## Step 3 - Verify, in this order

Each step depends on the one before, so a failure tells you where to look.

1. `/api/health` returns JSON with `"database": "ok"`. If it says `unavailable`,
   the message names the cause and your `DB_*` values are wrong - the function
   itself is working.
2. The home page loads with products. Proves build, function and database
   together.
3. Register a new account. Proves writes and password hashing.
4. Sign in, then **hard-refresh on `/orders`**. A 404 here means the SPA rewrite
   is wrong.
5. Place an order. Proves the transaction and the oversell guard.
6. Sign in as admin and enrol in 2FA. Proves TOTP and the QR route.

---

## Two things to expect

**Cold starts.** After idle time the first request pays for the container
starting and the connection opening - a second or two. Then it is fast until it
idles out again.

**Every push deploys against the same live database.** There is no staging. A
migration run by hand affects the site immediately, and preview deployments read
production rows unless you give them their own variables.

---

## The one known limitation

Rate limiting uses `express-rate-limit` with in-memory counters. Each serverless
container keeps its own counts, so the effective limit is roughly your limit
multiplied by the number of live containers. It still stops a naive script and a
runaway loop in your own frontend, which is what it was written for. It will not
stop a distributed attempt at password guessing.

The fix is a shared counter - `@upstash/ratelimit` backed by Upstash Redis,
which has a free tier. It is not wired up here because it needs a new dependency
and a live Redis to test against, and shipping untested security code is worse
than shipping a documented limitation.

Keep it in proportion: the account lockout from `04-security-hardening.sql` is
stored in MySQL, not in memory, so it works correctly across containers. The
per-IP throttle is the weakened part, not the lockout.
