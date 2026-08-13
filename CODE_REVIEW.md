# Code review notes

Audit pass over the backend security path (`server.js`, `middleware/`,
`controllers/authController.js`, `models/User.js`, `utils/crypto.js`,
`utils/totp.js`, `config/passport.js`) and the frontend auth/API layer
(`services/api.js`, `services/authService.js`). Not a line-by-line review of
every file — focused on the parts where a mistake is expensive: auth, 2FA,
encryption, and the HTTP hardening layer.

## What's already solid

This is well above "tutorial project" quality in a few specific ways worth
naming, because they're easy to get wrong even in production code:

- **Timing-safe login.** `authController.js` runs a dummy bcrypt compare for
  unknown emails so a login attempt takes the same time whether the account
  exists or not — closes a real user-enumeration side channel most projects
  never think about.
- **2FA can't be bypassed by a stolen password.** The challenge token has a
  distinct `scp: '2fa'` claim, and `protect` explicitly refuses it while
  `challengeAuth` refuses anything else. Social login routes through the same
  check, so a linked Google/Facebook account can't skip 2FA either.
- **Token version, not just expiry, controls session validity.** Logout-all
  and password changes bump `tokenVersion`, which invalidates every
  outstanding token immediately rather than waiting for natural expiry — and
  the role is re-read from the database on every request rather than trusted
  from the JWT payload, so a demotion or ban takes effect on the next request.
- **Authenticated encryption, not just encryption.** `utils/crypto.js` uses
  AES-256-GCM with a per-value random IV specifically because it resists
  ciphertext tampering, not just AES in general — the comments show this was
  a deliberate choice, not a default.
- **Role is never trusted from client input.** Registration hard-codes
  `role: 'customer'` and profile updates don't accept a role field at all —
  the single most common way small projects get an accidental admin account.
- **CSRF story without cookies.** The token lives in `localStorage` and is
  attached via `Authorization` header rather than a cookie, which sidesteps
  CSRF by construction (see trade-off below) — and `requireJsonBody` adds a
  second layer against cross-site form posts.

## Worth fixing before this handles real user data

1. **JWT in `localStorage` is readable by any script on the page.**
   `services/api.js` reads the token from `localStorage` on every request.
   This is a reasonable, common trade-off — it avoids CSRF entirely and the
   CSP in `securityMiddleware.js` (`scriptSrc: ["'self'"]`) meaningfully
   reduces the XSS surface that would be needed to steal it — but it's a
   trade-off, not a free win: one successful script injection anywhere on the
   page (a compromised npm package, a misconfigured third-party widget) can
   exfiltrate the token directly. If this ever handles payment data or high-value
   accounts, revisit `httpOnly` cookies + a CSRF token as the pair.
2. **`ecommerce-backend/db.js` was a byte-for-byte duplicate of
   `config/db.js`, imported nowhere** — removed in this pass. Worth a quick
   grep (`grep -rn "require.*db.js\|from.*db.js"`) after any refactor to make
   sure nothing still points at the old path.
3. **No visible CSRF token or `SameSite` cookie policy is moot right now**
   since auth is header-based, not cookie-based — but if `docs/DEPLOY-VERCEL.md`'s
   suggestion to eventually move to cookie auth for the single-origin deploy
   is taken, CSRF protection needs to be added at that point, not assumed to
   already exist.
4. **`ENCRYPTION_KEY` loss is unrecoverable by design** (correctly documented
   in `docs/SECURITY.md`), but there's no visible key-rotation path in
   `utils/crypto.js` — the `enc:v1` prefix suggests one was planned. Worth
   deciding now (even if not built now) whether rotation will mean
   re-encrypting every row with a new key or supporting multiple key versions
   simultaneously, since retrofitting that later means touching every
   encrypted column.
5. **Rate limits are in-memory (`express-rate-limit` default store).** Fine
   for a single Vercel function instance; if this ever runs as multiple
   concurrent serverless instances or scales horizontally, each instance gets
   its own counter and the effective limit multiplies by instance count. A
   Redis-backed store fixes this when it matters.

## Minor / stylistic

- `check-google-oauth.mjs` and `test-db.mjs` live at the backend root next to
  `server.js` rather than in `scripts/` alongside `generate-keys.js` and
  `encrypt-existing.js`. They're wired into `package.json` (`check:google`,
  `check:db`), so moving them is a two-line change, not a blocker — just
  inconsistent with the rest of the ops-script organization.
- `authController.js` is 366 lines covering email/password, social login, and
  profile updates. It reads cleanly today because of the comments, but it's
  the natural next file to split (e.g. `profileController.js`) if 2FA or
  social login grows further.

## Not reviewed in this pass

Product/cart/order/review controllers, the admin panel components, and the
database migrations were not read in depth here — the audit prioritized the
auth and security-critical path. Worth a follow-up pass before launch,
particularly the order/checkout flow for price-tampering (does the server
recompute totals from `priceCents` server-side, or trust a client-submitted
total?) and the review controller for authorization (can a user edit/delete
another user's review?).
