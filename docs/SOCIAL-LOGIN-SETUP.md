# Google and Facebook sign-in - setup guide

Your store now supports three ways to create an account:

| Method | Password stored? | Email verified? |
| --- | --- | --- |
| Email + password | Yes, as a bcrypt hash | No |
| Continue with Google | No (`NULL`) | Yes |
| Continue with Facebook | No (`NULL`) | Yes, if Facebook releases it |

---

## 1. Install the new packages

```bash
cd ecommerce-backend
npm install passport passport-google-oauth20 passport-facebook
```

They are already listed in `package.json`, so a plain `npm install` works too.

---

## 2. Update the database

**Starting fresh?** Re-run `database/01-schema.sql` - it already has the new
columns.

**Keeping existing data?** Run the migration instead:

```bash
mysql -u root -p ecommerce < database/03-add-social-login.sql
```

Or paste it into the **SQL** tab in phpMyAdmin.

It makes four changes to `users`:

1. `password` becomes nullable - a Google user never picked one
2. adds `provider`, `provider_id`, `avatar`, `email_verified`
3. adds a unique index on `(provider, provider_id)`
4. marks every existing row as `provider = 'local'`

If you left `DB_SYNC_ALTER=true` in `.env`, Sequelize will also add these
columns by itself the next time you start the server.

---

## 3. Get your Google keys

1. Go to **console.cloud.google.com** and create (or pick) a project
2. **APIs & Services -> OAuth consent screen**
   - User type: **External**
   - Fill in app name, your support email, developer email, then **Save**
   - While the app is in *Testing*, only accounts you list under
     **Test users** can sign in. Add your own Gmail address there.
3. **APIs & Services -> Credentials -> Create credentials -> OAuth client ID**
   - Application type: **Web application**
   - **Authorised JavaScript origins:** `http://localhost:5173`
   - **Authorised redirect URIs:**
     `http://localhost:5000/api/auth/google/callback`
4. Copy the client ID and client secret into `ecommerce-backend/.env`:

```env
GOOGLE_CLIENT_ID=1234567890-abcdefg.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
```

> The redirect URI must match **exactly** - `http` not `https`, port `5000`
> (the API, not the front end), no trailing slash. A single character off gives
> you `Error 400: redirect_uri_mismatch`.

---

## 4. Get your Facebook keys

1. Go to **developers.facebook.com -> My Apps -> Create App**
   - Use case: **Authenticate and request data from users with Facebook Login**
   - App type: **Consumer**
2. In the left sidebar: **Facebook Login -> Settings**
   - **Valid OAuth Redirect URIs:**
     `http://localhost:5000/api/auth/facebook/callback`
   - Leave *Client OAuth Login* and *Web OAuth Login* switched on
3. **App settings -> Basic** - copy the App ID and App Secret into `.env`:

```env
FACEBOOK_APP_ID=1234567890123456
FACEBOOK_APP_SECRET=abcdef1234567890abcdef1234567890
```

4. While the app is in **Development** mode, only you and anyone added under
   **App roles -> Roles** can sign in. That is fine for building.

> Facebook normally requires HTTPS, but it makes an exception for
> `http://localhost`, so local development works without a certificate.

---

## 5. Check the rest of your `.env`

```env
CLIENT_URL=http://localhost:5173   # where React runs
API_URL=http://localhost:5000      # where Express runs - used to build the callback URL
```

Both matter. `API_URL` builds the redirect URI that Google sees, and
`CLIENT_URL` is where the user is sent once the login succeeds.

---

## 6. Run it

```bash
# terminal 1
cd ecommerce-backend && npm run dev

# terminal 2
cd ecommerce-frontend && npm run dev
```

On boot the API prints which providers it picked up:

```
API running on http://localhost:5000
Social sign-in enabled: google, facebook
```

If a provider is missing from that line, its keys are not in `.env` - and the
button will not be drawn on the front end either. That is deliberate: the React
app calls `GET /api/auth/providers` on load and only renders buttons the server
can actually handle.

---

## How the flow works

```
Browser                    Your API                     Google
   |                          |                            |
   |-- click the button ----->|                            |
   |   GET /api/auth/google   |                            |
   |                          |--- 302 to accounts.google -->
   |                                                       |
   |<---------- user signs in and clicks Allow ------------>|
   |                                                       |
   |<-- 302 back to /api/auth/google/callback?code=... -----|
   |                          |                            |
   |                          |-- swap code for profile --->|
   |                          |<-- id, email, name, photo --|
   |                          |                            |
   |                     find or create the user            |
   |                     sign our own JWT                   |
   |                          |                            |
   |<-- 302 to /auth/callback#token=eyJ... -----------------|
   |                          |                            |
   |-- GET /api/auth/me ----->|   (with the token)          |
   |<-- the user object ------|                            |
```

### Why the token is in the `#`, not the `?`

Anything after `#` in a URL is never sent to a server and is stripped out of
the `Referer` header. Putting the token there keeps it out of access logs and
out of the hands of the next site the user visits. `AuthCallback.jsx` reads it
and immediately wipes it from the address bar with `history.replaceState`.

### Why the buttons are `<a>` tags, not `fetch()` calls

An OAuth login has to physically leave your site. `axios` cannot follow a
redirect to another origin, and Google refuses to be loaded inside an iframe.
A real page navigation is the only option.

---

## Account linking

If `sokha@gmail.com` registers with a password today and clicks **Continue with
Google** tomorrow, they land in **the same account** - same cart, same order
history. The API links them on the email address, but only when Google confirms
it verified that address. Without that check, anyone could create a Google
account claiming your email and walk into your store account.

Going the other way, a Google-only user who tries the email form gets a clear
message - *"This account was created with Google"* - instead of
*"invalid password"* for a password they never set.

They can add a password any time from the account page. `PUT /api/auth/me` lets
someone with no password set one without proving an old one, and requires
`currentPassword` from everyone else.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `redirect_uri_mismatch` | The URI in the console does not match `API_URL` + `/api/auth/google/callback` exactly |
| Button does not appear | Keys missing from `.env`, or the API was not restarted after adding them |
| `503 google sign-in is not configured` | Same as above |
| Blank page at `/auth/callback` | Restart Vite - the new route needs a rebuild |
| `App not active` (Facebook) | Your Facebook account is not listed under **App roles** |
| Facebook user has a weird email | They signed up with a phone number. They get a `@users.noreply.local` placeholder and can change it on the account page |
| Everyone lands in the same account | You matched on email without the `provider_id` check - not possible with this code, but worth knowing |

---

## Going live

- Swap every `http://localhost:...` for your real HTTPS domain, in `.env` **and**
  in both provider consoles
- Submit the Google consent screen for verification (needed once you leave
  *Testing* mode)
- Switch the Facebook app from *Development* to *Live*
- Generate a fresh `JWT_SECRET`
- Set `DB_SYNC_ALTER=false` and manage schema changes with SQL files
