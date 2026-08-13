/**
 * check-google-oauth.mjs
 *
 * Asks Google whether your Google sign-in setup is actually usable, without
 * opening a browser.
 *
 *   cd ecommerce-backend
 *   node check-google-oauth.mjs
 *
 * Why this exists: passport.js can only see whether the credentials LOOK
 * right. It cannot know whether the client still exists in the Google console,
 * or whether your redirect URI was ever registered. Only Google knows that,
 * and normally it only tells you in the middle of a login attempt, on an error
 * page several clicks away from the mistake.
 *
 * This script starts the same authorisation request the login button would
 * start, stops before any human has to log in, and reads Google's answer.
 */

import 'dotenv/config'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'

// Error codes Google can put on its error page, and what each one means for you.
const KNOWN_ERRORS = {
  deleted_client: {
    title: 'The OAuth client was deleted',
    detail:
      'GOOGLE_CLIENT_ID refers to a client that no longer exists. Either the client\n' +
      '  itself was deleted, or the whole Google Cloud project was. Create a new client\n' +
      '  and copy BOTH new values - a new client always issues a new secret.',
  },
  disabled_client: {
    title: 'The OAuth client is disabled',
    detail: 'Re-enable it in the Google console, or create a new one.',
  },
  invalid_client: {
    title: 'Google does not recognise this client ID',
    detail:
      'Usually a typo, a truncated paste, or a value from a different project.\n' +
      '  Compare it character by character with the console.',
  },
  redirect_uri_mismatch: {
    title: 'The redirect URI is not registered',
    detail:
      'The client exists, but this exact callback address is not in its list of\n' +
      '  Authorised redirect URIs. Add it in the console - exactly, including http\n' +
      '  vs https, the port, and no trailing slash.',
  },
  admin_policy_enforced: {
    title: 'A Workspace admin policy is blocking this app',
    detail: 'Use a personal Gmail account, or ask the admin to allow the app.',
  },
  org_internal: {
    title: 'The app is restricted to one organisation',
    detail: 'Set the audience to External on the Google Auth Platform screen.',
  },
  access_denied: {
    title: 'Google refused the request',
    detail:
      'Most often the app is in Testing mode and the signing-in account is not\n' +
      '  listed under Audience -> Test users.',
  },
}

function heading(text) {
  console.log(`\n${text}`)
  console.log('-'.repeat(text.length))
}

function pass(msg) {
  console.log(`  PASS  ${msg}`)
}

function fail(msg) {
  console.log(`  FAIL  ${msg}`)
}

function info(msg) {
  console.log(`        ${msg}`)
}

/**
 * Build the exact callback address passport.js will use.
 * This mirrors config/passport.js so the two can never drift apart.
 */
function callbackUrl() {
  const base = (process.env.API_URL || `http://localhost:${process.env.PORT || 5000}`).replace(
    /\/+$/,
    '',
  )
  return `${base}/api/auth/google/callback`
}

function checkShape(clientId, clientSecret) {
  let ok = true

  if (!clientId) {
    fail('GOOGLE_CLIENT_ID is not set in .env')
    ok = false
  } else if (clientId !== clientId.trim()) {
    fail('GOOGLE_CLIENT_ID has a leading or trailing space')
    ok = false
  } else if (!clientId.endsWith('.apps.googleusercontent.com')) {
    fail('GOOGLE_CLIENT_ID does not end with .apps.googleusercontent.com')
    info('That suffix is always present. Something else got pasted.')
    ok = false
  } else {
    pass(`GOOGLE_CLIENT_ID looks well formed (project number ${clientId.split('-')[0]})`)
  }

  if (!clientSecret) {
    fail('GOOGLE_CLIENT_SECRET is not set in .env')
    ok = false
  } else if (/\s/.test(clientSecret)) {
    fail('GOOGLE_CLIENT_SECRET contains a space or line break')
    ok = false
  } else if (clientSecret.length < 20) {
    fail(`GOOGLE_CLIENT_SECRET is only ${clientSecret.length} characters - looks truncated`)
    ok = false
  } else {
    pass('GOOGLE_CLIENT_SECRET looks well formed')
    if (!clientSecret.startsWith('GOCSPX-')) {
      info('Note: it does not start with GOCSPX-. Recent secrets always do.')
    }
  }

  return ok
}

/**
 * Start a real authorisation request and read what Google says.
 *
 * A healthy client sends us towards a sign-in or consent page. A broken one
 * sends us to /signin/oauth/error instead, and the reason is written into that
 * page - so we follow it and read it.
 */
async function askGoogle(clientId, redirectUri) {
  const url =
    `${AUTH_ENDPOINT}?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code&scope=${encodeURIComponent('profile email')}` +
    `&access_type=offline&prompt=select_account`

  const first = await fetch(url, { redirect: 'manual' })
  const location = first.headers.get('location') || ''

  const looksLikeError =
    location.includes('/signin/oauth/error') ||
    location.includes('authError=') ||
    location.includes('error=')

  if (!looksLikeError && (first.status === 302 || first.status === 303 || first.status === 200)) {
    return { ok: true }
  }

  // Google encrypts the reason into the URL, so read the page it points at.
  let body = ''
  try {
    const errorPage = await fetch(location.startsWith('http') ? location : url, {
      redirect: 'follow',
    })
    body = await errorPage.text()
  } catch {
    /* fall through to the generic message below */
  }

  const code = Object.keys(KNOWN_ERRORS).find(key => body.includes(key) || location.includes(key))

  return { ok: false, code, location, body }
}

async function main() {
  console.log('\nChecking Google sign-in against Google itself')
  console.log('='.repeat(60))

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()

  heading('1. The values in .env')

  if (!clientId && !clientSecret) {
    info('Both are blank, so the Google button is hidden and nothing is broken yet.')
    info('Paste a real pair into ecommerce-backend/.env, then run this again.')
    info('Get them at https://console.cloud.google.com/auth/clients')
    process.exit(1)
  }

  if (!checkShape(clientId, clientSecret)) {
    console.log('\nFix the above first - no point asking Google yet.\n')
    process.exit(1)
  }

  const redirectUri = callbackUrl()

  heading('2. The callback address')
  info(`passport.js will use: ${redirectUri}`)
  info('This exact string must appear in the client\'s Authorised redirect URIs.')
  if (redirectUri.startsWith('http://') && !redirectUri.includes('localhost')) {
    fail('A non-localhost callback must use https. Google rejects plain http.')
  }

  heading('3. What Google says')

  let result
  try {
    result = await askGoogle(clientId, redirectUri)
  } catch (err) {
    fail(`Could not reach Google: ${err.message}`)
    info('Check your internet connection, then run this again.')
    info('This is a problem with the check, not necessarily with your setup.')
    process.exit(2)
  }

  if (result.ok) {
    pass('Google accepted the client ID and this redirect URI.')
    console.log('\nThe setup is live. Start the API and use the button:')
    console.log('  npm run dev')
    console.log('  then open the login page and click Continue with Google\n')
    console.log('If sign-in still fails after this, the cause is on the consent screen -')
    console.log('usually your account missing from Audience -> Test users.\n')
    process.exit(0)
  }

  const known = result.code && KNOWN_ERRORS[result.code]

  if (known) {
    fail(`${result.code} - ${known.title}`)
    console.log(`\n  ${known.detail}\n`)
  } else {
    fail('Google rejected the request, but did not name a reason this script knows.')
    info(`It redirected to: ${result.location.slice(0, 120) || '(no location header)'}`)
    info('Open that address in a browser to see the message Google shows.')
  }

  console.log('Where to fix it: https://console.cloud.google.com/auth/clients')
  console.log('Check the project selector at the top matches the project you meant.\n')
  process.exit(1)
}

main()
