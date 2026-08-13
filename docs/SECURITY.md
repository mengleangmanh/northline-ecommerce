# Security

What this project protects, how, and — just as importantly — what it still
does not protect. Read the last two sections before you put this on the
internet.

---

## 1. Setup, in order

These steps have to happen in this sequence. Encrypting before widening the
columns will silently truncate ciphertext, and truncated ciphertext never
decrypts — the data is simply gone.

```bash
# 1. Install the two new packages
cd ecommerce-backend
npm install

# 2. Generate secrets and paste them into .env
npm run keys

# 3. Widen the columns and add the new ones
#    phpMyAdmin -> ecommerce -> SQL tab -> paste database/04-security-hardening.sql

# 4. Only if you already have real data in the database
npm run encrypt:existing -- --dry-run
npm run encrypt:existing

# 5. Start
npm run dev
```

A brand-new database skips steps 3 and 4 — `01-schema.sql` already has the
right columns, and anything written after this change is encrypted on the way
in.

### Back up `ENCRYPTION_KEY` before you write any real data

Put it in a password manager. Not in the repo, not only on the server. If the
server dies and the key dies with it, every phone number and address in the
database is permanently unreadable. There is no recovery procedure, no support
line, no clever trick. That is what encryption *means*, and it is the failure
mode that catches people out.

---

## 2. Encryption at rest

`utils/crypto.js` — **AES-256-GCM**, a fresh random 12-byte IV per value.

```
enc:v1:<iv-base64>:<tag-base64>:<ciphertext-base64>
```

GCM is *authenticated* encryption. It does not only hide the value, it detects
tampering: if someone with database access edits a single character of
ciphertext, decryption fails loudly instead of returning a plausible wrong
address. Plain AES-CBC would not catch that.

| Column | Encrypted? | Reason |
|---|---|---|
| `users.phone`, `users.address` | Yes | The fields that actually hurt someone if the database leaks |
| `orders.phone`, `orders.address`, `orders.postal_code` | Yes | Same data, second copy |
| `users.password` | No — **hashed**, bcrypt cost 12 | Passwords must never be decryptable, not even by you |
| `users.email` | No | Every login is `WHERE email = ?`, and you cannot search an encrypted column |
| `city`, `country` | No | Needed for shipping logic and reporting; not identifying on their own |

The encryption is transparent — `user.address` returns plain text. Sequelize
getters and setters do the work, so no controller had to change.

**What this defends against:** a stolen database dump, a leaked backup file, a
snooping DBA, a misconfigured phpMyAdmin. In all of those the attacker gets
ciphertext and no key.

**What it does not defend against:** anyone who can run your application code,
because the app must be able to decrypt to do its job. Application-level
encryption raises the cost of a database breach. It does not turn a server
breach into a non-event.

### Why not MySQL's built-in encryption?

InnoDB tablespace encryption protects the files on disk. But the database
decrypts transparently for anyone who can connect — so a leaked `DB_PASSWORD`,
an exposed phpMyAdmin, or a SQL injection all return plain text. Encrypting in
the application means the key never lives in the database at all. Use both if
you like; they stop different attacks.

---

## 3. Passwords

`utils/password.js`, following NIST SP 800-63B.

- Minimum **10 characters**, maximum 200.
- Blocked: a list of common passwords, long runs (`aaaaaa`), keyboard and
  alphabet sequences, and anything containing the person's own name or email.
- **No forced symbol/number/uppercase rules.** They are counterproductive:
  they push people to `Password1!` and to writing passwords down. Length is
  what matters.
- No forced rotation. NIST dropped that too — it just produces `Summer2026`
  followed by `Autumn2026`.
- Optional: `isBreached()` checks Have I Been Pwned using k-anonymity — only
  the first 5 characters of the hash ever leave the server, so the password
  itself is never transmitted. It fails open, so an outage cannot block
  signups.

Hashing is **bcrypt at cost 12**, up from 10. Each extra round doubles the
work an attacker has to do per guess.

> **Worth knowing:** `bcryptjs` is pure JavaScript and roughly 3× slower than
> the native `bcrypt` package, so cost 12 costs about a second of CPU per
> login here. That is acceptable because logins are rate limited. If you ever
> get real traffic, switch to the native `bcrypt` package or to `argon2` —
> argon2id is what new projects should use.

### The demo passwords changed

`demo1234` and `admin1234` both fail the new rules — too short, and `demo1234`
is on the blocklist. They are now:

| Account | Password |
|---|---|
| `demo@northline.dev` | `quiet-river-8842` |
| `admin@northline.dev` | `steady-anchor-7715` |

Updated in `seed.js`, the login page's demo buttons, and `02-seed.sql`.

---

## 4. Tokens and sessions

`utils/generateToken.js`, `middleware/authMiddleware.js`.

- **HS256 pinned.** The algorithm is specified on verification, not read from
  the token. Trusting the token's own `alg` header is the classic JWT attack —
  an attacker sets `alg: none` and forges whatever they like.
- **Issuer and audience checked**, so a token minted for something else cannot
  open this.
- **12-hour expiry.**
- **`tokenVersion`.** Every token carries the version it was signed under. One
  `UPDATE` invalidates all of them at once.

That last one is the piece most tutorials leave out. A signed token is valid
until it expires and the server keeps no record of it, so "log out" is normally
just deleting your own copy — anyone who captured it still holds a working key.
`POST /api/auth/logout-all` bumps the version and genuinely ends every session.
A password change does it automatically, which is the whole point of changing
a password after a breach.

The role is always read from the database row, never from the token, so
demoting an admin takes effect on their very next request.

---

## 5. Brute force

Two layers, because they stop different attacks.

| | Limit |
|---|---|
| Login | 10 **failures** per IP per 15 min (successes are not counted) |
| Registration | 5 per IP per hour |
| Writes | 100 per IP per 15 min |
| Everything | 600 per IP per 15 min |
| Per account | 5 consecutive failures → locked 15 min |

Rate limiting stops one machine trying a thousand passwords. Account lockout
stops a botnet spreading those thousand attempts across a thousand addresses,
where each IP looks innocent. You need both.

Lockout has a real cost: someone can lock you out of your own account on
purpose by failing five times. Fifteen minutes keeps that annoying rather than
damaging — do not extend it to hours.

Login also does a **dummy bcrypt comparison when the email does not exist**.
Otherwise an unknown address returns in a millisecond and a real one takes a
second, and anyone can time the difference to discover which addresses have
accounts.

---

## 6. HTTP hardening

`middleware/securityMiddleware.js` (helmet + express-rate-limit).

- **Content-Security-Policy** — `script-src 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'`. The last one is what stops clickjacking.
- **HSTS**, 2 years, **production only**. Deliberately not on localhost: it is
  cached by the browser per hostname, and pinning `localhost` to HTTPS breaks
  every other project you run there.
- **HTTPS redirect** in production, honouring `X-Forwarded-Proto`.
- **CORS allow-list.** Never `*`, never reflecting the incoming Origin —
  either lets any site on the internet call this API as your signed-in user.
- **`Content-Type: application/json` required** on writes. Combined with CORS
  preflight this is a solid CSRF defence: a cross-site form post cannot set
  that header. (Bearer tokens in a header are not auto-attached by the browser
  the way cookies are, so CSRF is largely moot here anyway.)
- **NoSQL-operator stripping** and **parameter-pollution** defence.
- **100kb body limit** — the body is buffered into memory before your code
  runs, so a large limit is a cheap denial of service.

### Injection

- **SQL:** Sequelize parameterises every query. Values are sent separately
  from the statement, so a value can never become syntax. The one rule: if you
  ever write raw SQL, use `replacements`, never string concatenation.
- **XSS:** React escapes everything it renders. The real risk is
  `dangerouslySetInnerHTML` — this project does not use it, and you should not
  add it. Review comments are additionally run through `stripTags()` on the
  way in, as defence in depth.

---

## 7. Audit log

`security_events` records logins, failures, lockouts, registrations, password
and email changes, token rejections and admin denials — with IP, user agent
and timestamp.

It never stores passwords, tokens, or card details. An audit log is a
high-value target precisely because it is complete.

```sql
-- Someone working through a list of accounts
SELECT ip, COUNT(*) c FROM security_events
WHERE event = 'login.failure' AND created_at > NOW() - INTERVAL 1 HOUR
GROUP BY ip HAVING c > 20 ORDER BY c DESC;
```

---

## 8. What is deliberately **not** done

I would rather you know the gaps than assume they are covered.

**Refresh-token rotation — designed, not built.** With one 12-hour token,
a stolen token works for up to 12 hours. The proper fix is a 15-minute access
token plus a long-lived refresh token in an `httpOnly` cookie, rotated on
every use, where reuse of an already-spent refresh token revokes the whole
family. That touches around eight files and I could not run it even once here
— no `npm install`, no network — so shipping it untested would have been worse
than shipping the honest version. `tokenVersion` gives you revocation today.
Build refresh tokens before you take real payments.

**Tokens live in `localStorage`, which is readable by any JavaScript on the
page.** If an XSS bug ever lands, the token is stolen. The CSP is the main
mitigation. An `httpOnly` cookie would be strictly better and comes free with
the refresh-token work above.

**Email addresses are not encrypted.** They are needed for login lookups. A
blind index would allow it — `blindIndex()` in `utils/crypto.js` is there
ready — but it is a bigger change than it looks.

**Login tells you when an account was created with Google.** That confirms the
address exists. It is a deliberate trade: the alternative leaves people
retyping a password they never set.

**Not implemented at all:** email verification for
local signups, password reset, CAPTCHA, key rotation tooling, a secrets
manager, WAF/DDoS protection. Payment is cash-on-delivery, so no card data is
handled — the moment you add Stripe, use their hosted checkout so card numbers
never touch your server and PCI compliance stays their problem.

---

## 9. Before you deploy

```
[ ] NODE_ENV=production          (the server refuses to start otherwise if
[ ] DB_SYNC_ALTER=false           any of the next few are wrong)
[ ] SQL_LOG=false
[ ] JWT_SECRET regenerated, 32+ chars, not the placeholder
[ ] ENCRYPTION_KEY backed up somewhere off the server
[ ] DB_PASSWORD set, DB_USER is not root
[ ] CLIENT_URL is your real domain, not localhost
[ ] HTTPS terminated in front of the app (Caddy, nginx, or the host)
[ ] TRUST_PROXY_HOPS matches your setup - never `true`
[ ] .env is not in git, and never was
[ ] Demo accounts deleted from the production database
[ ] npm audit --omit=dev is clean
```

The production boot check enforces the first six. It exits with a list rather
than starting in a bad state, because a server that starts insecure is worse
than one that does not start.


---

## Two-factor authentication

A password is a single secret. It can be phished, reused on a site that later
leaks, guessed if it is weak, or typed into a convincing copy of your login
page. Two-factor authentication accepts that a password will eventually be
known by the wrong person, and asks for something else as well: a six-digit
code from an app on the phone in your pocket.

### What was chosen, and what was not

**TOTP, not SMS.** Codes come from an authenticator app, not a text message.
SMS looks friendlier but the phone number is the weak point: a SIM swap - where
someone talks a mobile network into moving a number onto their own SIM - is a
well-worn attack that needs no technical skill at all. It has been used to
empty bank and crypto accounts repeatedly. TOTP has no phone number in it, and
nothing to social-engineer.

**No new dependency for the codes themselves.** `utils/totp.js` implements
RFC 6238 directly on Node's built-in `crypto`. It is about a hundred lines, and
it is verified against all eight official test vectors from the RFC. Pulling in
a package to do an HMAC and a modulo would have added supply-chain risk to the
one part of the system that must not be tampered with.

**HMAC-SHA1.** This looks alarming and is not. SHA-1 is broken for *collision*
resistance, which matters for signatures and certificates. Inside HMAC, only
pre-image resistance matters, and that is intact. More practically: every
authenticator app in the world assumes SHA-1, so choosing anything else means
the QR code does not work.

### How a login works now

```
POST /api/auth/login          email + password
  -> 200 { twoFactorRequired: true, challengeToken }     no access token
POST /api/auth/2fa/verify     Authorization: Bearer <challengeToken>
  -> 200 { user, token }                                 the real token
```

The challenge token is the interesting part. Something has to remember who is
halfway through a login across two requests. Sending back a user id and
trusting it would let anyone skip to the code step for any account they liked,
so it is a signed JWT instead - carrying `scp: '2fa'` and expiring in five
minutes.

That `scp` claim is load-bearing. `protect` rejects any token carrying it, so
the challenge token is useless on every route except `/2fa/verify`. Without
that single check the whole feature would be theatre: an attacker with a stolen
password would simply ignore the code prompt and use the challenge token as an
ordinary credential.

The browser keeps the challenge in React state, never `localStorage`. Walking
away from a shared computer at the code prompt should not leave a usable
half-credential on the disk.

### Social logins are covered too

Google and Facebook sign-ins go through the same challenge. This was not an
afterthought - skipping it would have been a complete bypass. Anyone who found
a laptop already signed into Gmail could have walked past the second factor
entirely. A door is only as strong as the weakest way in.

### Details that are easy to get wrong

**The secret is encrypted at rest.** `users.two_factor_secret` is stored with
the same AES-256-GCM helper as phone numbers and addresses. A TOTP secret is a
permanent key: whoever holds it can generate valid codes forever, from
anywhere, without ever touching this server. In a leaked dump that is arguably
worse than the password column, because passwords are at least hashed and
unusable as they stand.

**Codes are genuinely one-time.** A valid code lives for up to ninety seconds
once the drift window is included. `users.two_factor_last_step` records the
last step that was accepted, and anything at or below it is refused - so six
digits read over a shoulder or captured by a phishing proxy cannot be replayed
inside that window.

**Guessing is rate limited twice.** Six digits is only a million combinations,
and roughly three are valid at any moment because of drift, so an unlimited
guesser needs about 300,000 attempts for even odds - minutes of automated
traffic. `authLimiter` caps the request rate, and five wrong codes lock the
account for fifteen minutes through the same mechanism as wrong passwords.

**Enrolment cannot lock you out.** `/2fa/setup` stores a secret but leaves 2FA
*off*. Nothing changes until `/2fa/enable` receives a working code, which proves
the secret transferred correctly and the phone's clock agrees with the server's.
Abandoning setup half way is harmless.

**Turning it off needs the password and a code.** Someone who sits down at an
unlocked laptop has the session but not the phone, and disabling the second
factor is the first thing they would try.

### Recovery codes

Ten single-use codes, issued at the moment 2FA is switched on and shown exactly
once. These are not a nicety. Enable 2FA without them and the first customer to
drop their phone down a drain is locked out permanently, with no way back
except someone editing database rows by hand.

They are stored as keyed HMAC-SHA256 hashes, not bcrypt. There is no weak
human-chosen guess to slow down here - each code is fifty random bits - and
hashing ten of them at bcrypt cost 12 would take around ten seconds per login.
A bare SHA-256 would be wrong too, because fifty bits can be ground through
offline from a stolen dump. Keying the hash with `BLIND_INDEX_KEY`, which lives
in the environment rather than the database, means the dump alone buys nothing.

The login form checks the app code first and the recovery codes second, so an
ordinary typo never burns one.

### Setup

Run `database/05-two-factor.sql`, then `npm install` in `ecommerce-backend` to
pick up `qrcode`.

The QR renderer is imported dynamically inside a `try/catch`. If the package is
missing the setup screen shows the base32 key to type in by hand instead of
crashing - which is also the path used by anyone on a desktop authenticator
with no camera.

### Still not implemented

WebAuthn and passkeys, which would be the natural next step and are genuinely
phishing-proof in a way TOTP is not; trusted-device "remember this browser for
30 days"; and admin-enforced 2FA for staff accounts.
