import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

/**
 * The landing strip for social logins.
 *
 * Google/Facebook -> our API -> here. The API puts the result in the URL
 * *fragment*:
 *
 *   /auth/callback#token=eyJhbGci...&redirect=%2Fcheckout
 *   /auth/callback#challenge=eyJhbGci...&redirect=%2Fcheckout
 *   /auth/callback#error=You%20cancelled%20the%20sign-in.
 *
 * The fragment is used rather than a normal ?query on purpose. Browsers never
 * send the part after the # to any server, and it is stripped from the Referer
 * header, so the token cannot end up in someone's access logs or be leaked to
 * the next site the user visits. The trade-off is that React Router's
 * useSearchParams cannot see it, so we parse window.location.hash by hand.
 *
 * The `challenge` case is the one that matters for security: an account with
 * 2FA switched on gets a challenge token here instead of a real one, and has
 * to enter a code before anything is issued. Without that branch, signing in
 * with Google would walk straight past the second factor.
 */
export default function AuthCallback() {
  const { loginWithToken, completeTwoFactor } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState(null)

  const [challenge, setChallenge] = useState(null)
  const [redirectTo, setRedirectTo] = useState('/')
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [busy, setBusy] = useState(false)

  // React 18 StrictMode runs effects twice in development. Without this guard
  // the token would be exchanged twice and the second run would find an
  // already-scrubbed URL and report a bogus failure.
  const handled = useRef(false)

  function land(user, redirect) {
    // Admins who did not ask for a particular page land on the dashboard,
    // matching what the email login already does.
    navigate(user.role === 'admin' && redirect === '/' ? '/admin' : redirect, { replace: true })
  }

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const token = params.get('token')
    const challengeToken = params.get('challenge')
    const failure = params.get('error')
    const redirect = params.get('redirect') || '/'

    // Wipe the fragment straight away so the token is not left sitting in the
    // address bar, in the back/forward history, or in a screenshot.
    window.history.replaceState(null, '', window.location.pathname)

    setRedirectTo(redirect)

    if (failure) {
      setError(failure)
      return
    }

    // 2FA is on for this account: stop here and ask for the code.
    if (challengeToken) {
      setChallenge(challengeToken)
      return
    }

    if (!token) {
      setError('That sign-in link was incomplete. Please try again.')
      return
    }

    loginWithToken(token)
      .then(user => land(user, redirect))
      .catch(err => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submitCode(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { user } = await completeTwoFactor(code, challenge)
      land(user, redirectTo)
    } catch (err) {
      if (err.restart || err.status === 423) setChallenge(null)
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !challenge) {
    return (
      <div className="container auth-wrap">
        <div className="auth-card">
          <h1>Sign-in failed</h1>
          <div className="note note-red">{error}</div>
          <Link className="btn btn-block" to="/login">
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  if (challenge) {
    return (
      <div className="container auth-wrap">
        <form className="auth-card" onSubmit={submitCode}>
          <h1>Two-step verification</h1>
          <p className="muted">
            {useRecovery
              ? 'Enter one of your saved backup codes.'
              : 'Almost there. Enter the six-digit code from your authenticator app.'}
          </p>

          {error && <div className="note note-red">{error}</div>}

          <label>
            {useRecovery ? 'Backup code' : 'Authentication code'}
            <input
              autoFocus
              autoComplete="one-time-code"
              inputMode={useRecovery ? 'text' : 'numeric'}
              maxLength={useRecovery ? 11 : 6}
              placeholder={useRecovery ? 'xxxxx-xxxxx' : '000000'}
              value={code}
              onChange={e =>
                setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))
              }
            />
          </label>

          <button type="submit" className="btn btn-block" disabled={busy || !code}>
            {busy ? 'Checking...' : 'Verify'}
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={() => {
              setUseRecovery(v => !v)
              setCode('')
              setError(null)
            }}
          >
            {useRecovery ? 'Use my authenticator app instead' : 'I do not have my phone'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="container auth-wrap">
      <div className="auth-card center">
        <div className="spinner" aria-hidden="true" />
        <h1>Signing you in</h1>
        <p className="muted">One moment while we finish setting up your account.</p>
      </div>
    </div>
  )
}
