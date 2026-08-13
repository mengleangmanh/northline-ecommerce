import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import { Strategy as FacebookStrategy } from 'passport-facebook'

import User from '../models/User.js'
import Cart from '../models/Cart.js'

// Where Google and Facebook send the browser back to after the user clicks
// "Allow". This is the API's own address, not the front end's, and it has to
// match the redirect URI in the Google/Facebook console character for
// character - including http vs https and the trailing slash.
const API_URL = (process.env.API_URL || `http://localhost:${process.env.PORT || 5000}`).replace(
  /\/+$/,
  '',
)

// The front end asks for this list on load so it only draws buttons that will
// actually work. A Google button with no client id configured is just a 500
// error waiting to happen.
export const enabledProviders = []

export function isProviderEnabled(name) {
  return enabledProviders.includes(name)
}

/**
 * Turns "someone just proved they control a Google/Facebook account" into a
 * row in our users table. Three cases, checked in this order:
 *
 *   1. We have seen this exact provider account before -> sign them in.
 *   2. The email already belongs to an account here -> link the two. Without
 *      this, someone who registered with a password and later clicked
 *      "Continue with Google" would get a confusing duplicate account with an
 *      empty cart and no order history.
 *   3. Nobody matches -> create a new customer.
 */
async function findOrCreateSocialUser({
  provider,
  providerId,
  email,
  emailVerified,
  name,
  avatar,
}) {
  // --- 1. Already linked -------------------------------------------------
  let user = await User.scope('withPassword').findOne({ where: { provider, providerId } })

  if (user) {
    // Keep the display name and picture roughly in sync, but never overwrite
    // an address the customer typed themselves.
    if (name && user.name !== name) user.name = name
    if (avatar && user.avatar !== avatar) user.avatar = avatar
    await user.save()
    await Cart.findOrCreate({ where: { userId: user.id } })
    return user
  }

  // --- 2. Same email, existing account -> link ---------------------------
  if (email) {
    const existing = await User.scope('withPassword').findOne({ where: { email } })

    if (existing) {
      // Only link when the provider says it verified the address. If we linked
      // on an unverified email, anyone could create a Google account claiming
      // your address and walk straight into your store account. Google sends
      // email_verified for exactly this reason.
      if (!emailVerified) {
        const err = new Error(
          `${provider} has not verified that email address, so it cannot be linked to an existing account`,
        )
        err.status = 409
        throw err
      }

      // Already tied to the *other* social provider? Let them in, but do not
      // silently steal the link - keep the original provider on the row and
      // just record that this login succeeded.
      if (existing.provider === 'local') {
        existing.provider = provider
        existing.providerId = providerId
      }
      if (avatar && !existing.avatar) existing.avatar = avatar
      existing.emailVerified = true
      await existing.save()
      await Cart.findOrCreate({ where: { userId: existing.id } })
      return existing
    }
  }

  // --- 3. Brand new customer ---------------------------------------------
  // Facebook will not hand over an email if the person signed up with a phone
  // number, or if they untick the email permission. Rather than fail, park
  // them on a placeholder address they can change from the account page.
  const finalEmail = email || `${provider}_${providerId}@users.noreply.local`

  const created = await User.create({
    name: name || 'Customer',
    email: finalEmail,
    password: null, // no password: the provider vouches for them
    provider,
    providerId,
    avatar: avatar || null,
    emailVerified: Boolean(email && emailVerified),
    role: 'customer', // never let a social login mint an admin
  })

  await Cart.findOrCreate({ where: { userId: created.id } })
  return created
}

// Passport hands the verify callback a `profile` shaped slightly differently
// per provider, so each strategy flattens it before the shared function runs.
function verify(mapProfile) {
  return async (_accessToken, _refreshToken, profile, done) => {
    try {
      done(null, await findOrCreateSocialUser(mapProfile(profile)))
    } catch (err) {
      done(err)
    }
  }
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------
/**
 * Why this exists.
 *
 * The old guard here was `if (clientId && clientSecret)`. A presence check is
 * not a validity check, and the difference caused two separate wasted evenings:
 *
 *   1. The example values from SOCIAL-LOGIN-SETUP.md were left in .env. They
 *      are non-empty, so the strategy registered, the button rendered, and the
 *      failure only surfaced at Google as "Error 401: invalid_client".
 *   2. A real client ID was left in .env after the client was deleted in the
 *      Google console. Same story, different error: "deleted_client".
 *
 * In both cases the app looked fine and Google did the complaining, several
 * clicks away from the actual mistake. So: check the shape here, refuse to
 * enable a provider we can already tell is broken, and say exactly why.
 *
 * This cannot detect a deleted or revoked client - only Google knows that.
 * Run `node check-google-oauth.mjs` for the live check.
 */
const PLACEHOLDER_HINTS = ['your-', 'your_', 'xxx', 'placeholder', 'change-me', 'example']

// The exact example values printed in SOCIAL-LOGIN-SETUP.md. These are the
// right shape, so no generic rule catches them - and they sat in .env for
// weeks precisely because they looked plausible. Name them explicitly.
const KNOWN_PLACEHOLDER_VALUES = new Set([
  '1234567890123456',
  'abcdef1234567890abcdef1234567890',
  '123456789012-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com',
])

function credentialProblems(rules) {
  const problems = []

  for (const { name, value, expect, test } of rules) {
    const raw = process.env[name]

    if (!raw) {
      problems.push(`${name} is not set`)
      continue
    }
    if (raw !== raw.trim()) {
      problems.push(`${name} has a leading or trailing space - check for a stray character when you pasted it`)
      continue
    }
    if (raw.startsWith('"') || raw.startsWith("'")) {
      problems.push(`${name} is wrapped in quotes - .env values take no quotation marks`)
      continue
    }
    if (
      KNOWN_PLACEHOLDER_VALUES.has(raw.toLowerCase()) ||
      PLACEHOLDER_HINTS.some(hint => raw.toLowerCase().includes(hint)) ||
      /^(\d)\1+$/.test(raw) ||
      /^1234567890/.test(raw)
    ) {
      problems.push(`${name} is still the example value from SOCIAL-LOGIN-SETUP.md, not a real credential`)
      continue
    }
    if (test && !test(raw)) {
      problems.push(`${name} is the wrong shape - ${expect}`)
    }
  }

  return problems
}

function reportProviderOff(label, problems, help) {
  console.warn(`\n${label} sign-in is OFF:`)
  problems.forEach(p => console.warn(`  - ${p}`))
  console.warn(`  ${help}`)
  console.warn('  The button stays hidden until this is fixed, which is deliberate:')
  console.warn('  a button that appears and then fails at the provider is worse than none.\n')
}

const googleProblems = credentialProblems([
  {
    name: 'GOOGLE_CLIENT_ID',
    expect: 'it must end with .apps.googleusercontent.com',
    test: v => v.endsWith('.apps.googleusercontent.com') && v.length > 30,
  },
  {
    name: 'GOOGLE_CLIENT_SECRET',
    expect: 'it should be one unbroken token, usually starting GOCSPX-',
    test: v => v.length >= 20 && !/\s/.test(v),
  },
])

if (googleProblems.length === 0) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${API_URL}/api/auth/google/callback`,
      },
      verify(profile => ({
        provider: 'google',
        providerId: profile.id,
        email: profile.emails?.[0]?.value?.toLowerCase() || null,
        // passport-google-oauth20 copies Google's email_verified onto the
        // email entry as `verified`, as a boolean or the string "true".
        emailVerified:
          profile.emails?.[0]?.verified === true || profile.emails?.[0]?.verified === 'true',
        name: profile.displayName || profile.name?.givenName || null,
        avatar: profile.photos?.[0]?.value || null,
      })),
    ),
  )
  enabledProviders.push('google')
} else {
  reportProviderOff(
    'Google',
    googleProblems,
    'Get a fresh pair at https://console.cloud.google.com/auth/clients',
  )
}

// ---------------------------------------------------------------------------
// Facebook
// ---------------------------------------------------------------------------
const facebookProblems = credentialProblems([
  {
    name: 'FACEBOOK_APP_ID',
    expect: 'it is 15 or 16 digits and nothing else',
    test: v => /^\d{13,17}$/.test(v),
  },
  {
    name: 'FACEBOOK_APP_SECRET',
    expect: 'it is exactly 32 hex characters - if yours is longer you copied the Client Token',
    test: v => /^[0-9a-f]{32}$/i.test(v),
  },
])

if (facebookProblems.length === 0) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: `${API_URL}/api/auth/facebook/callback`,
        // Facebook sends almost nothing by default. You have to name every
        // field you want, or profile.emails comes back undefined.
        profileFields: ['id', 'displayName', 'emails', 'photos'],
      },
      verify(profile => ({
        provider: 'facebook',
        providerId: profile.id,
        email: profile.emails?.[0]?.value?.toLowerCase() || null,
        // Facebook never returns an unconfirmed address, so anything we get
        // here is already verified on their side.
        emailVerified: Boolean(profile.emails?.[0]?.value),
        name: profile.displayName || null,
        avatar: profile.photos?.[0]?.value || null,
      })),
    ),
  )
  enabledProviders.push('facebook')
} else {
  reportProviderOff(
    'Facebook',
    facebookProblems,
    'Get these at developers.facebook.com -> App settings -> Basic',
  )
}

// No serializeUser/deserializeUser here on purpose. Those exist for session
// based logins, and this API is stateless - every strategy runs with
// { session: false } and we hand back our own JWT instead.

export default passport
