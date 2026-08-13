import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import SocialAuthButtons from '../components/SocialAuthButtons.jsx'

export default function Login() {
  const { login, completeTwoFactor } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()

  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState(null)
  const [wrongDoor, setWrongDoor] = useState(null)
  const [busy, setBusy] = useState(false)

  /**
   * The 2FA challenge token, held in React state and nowhere else.
   *
   * Deliberately not localStorage. This token proves the password step
   * succeeded, so leaving it on disk would mean walking away from a shared
   * computer at the code prompt leaves a usable half-credential behind. In
   * state it dies with the tab, and the server expires it after five minutes
   * regardless.
   */
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)

  // ProtectedRoute stores where the user was heading before the redirect.
  const target = location.state?.from?.pathname || '/'

  function change(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  function land(user) {
    navigate(user.role === 'admin' && target === '/' ? '/admin' : target, { replace: true })
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setWrongDoor(null)
    setBusy(true)
    try {
      const result = await login(form.email, form.password)

      // The password was accepted but the account has a second factor. No
      // token has been issued yet - only a short-lived challenge.
      if (result?.twoFactorRequired) {
        setChallenge(result.challengeToken)
        setForm(f => ({ ...f, password: '' }))
        return
      }

      land(result)
    } catch (err) {
      // 409 means the address exists but belongs to a Google/Facebook account
      // with no password. Show the message and nudge them to the right button
      // instead of letting them retype a password they never set.
      if (err.status === 409) setWrongDoor(err.message)
      else setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { user, recoveryCodesLeft } = await completeTwoFactor(code, challenge)

      if (useRecovery && recoveryCodesLeft <= 2) {
        // Not fatal, but they should know before they run out entirely.
        window.alert(
          `That backup code has been used. You have ${recoveryCodesLeft} left - ` +
            'generate a fresh set from your account page.',
        )
      }
      land(user)
    } catch (err) {
      // The challenge itself expired or was cancelled: send them back to the
      // password step rather than leaving them stuck on a dead form.
      if (err.restart || err.status === 423) {
        setChallenge(null)
        setCode('')
      }
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function fill(email, password) {
    setForm({ email, password })
  }

  /* ---------------------- Second step: the code ---------------------- */
  if (challenge) {
    return (
      <div className="container auth-wrap">
        <form className="auth-card" onSubmit={submitCode}>
          <h1>Two-step verification</h1>
          <p className="muted">
            {useRecovery
              ? 'Enter one of the backup codes you saved when you turned this on.'
              : 'Enter the six-digit code from your authenticator app.'}
          </p>

          {error && <div className="note note-red">{error}</div>}

          <label>
            {useRecovery ? 'Backup code' : 'Authentication code'}
            <input
              // autoFocus is right here and almost nowhere else: this screen
              // exists for exactly one input and the user is already holding
              // their phone.
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

          <p className="muted center">
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setChallenge(null)
                setCode('')
                setError(null)
              }}
            >
              Back to sign in
            </button>
          </p>
        </form>
      </div>
    )
  }

  /* ---------------------- First step: the password ---------------------- */
  return (
    <div className="container auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to see your cart and order history.</p>

        {params.get('expired') && (
          <div className="note note-orange">Your session expired. Please sign in again.</div>
        )}
        {error && <div className="note note-red">{error}</div>}
        {wrongDoor && <div className="note note-orange">{wrongDoor}</div>}

        {/* Above the form, because the whole point of a social button is that
            it is faster than typing. Burying it below the fields defeats it. */}
        <SocialAuthButtons redirectTo={target} disabled={busy} />

        <label>
          Email
          <input
            type="email"
            name="email"
            value={form.email}
            onChange={change}
            required
            autoComplete="email"
          />
        </label>

        <label>
          Password
          <input
            type="password"
            name="password"
            value={form.password}
            onChange={change}
            required
            autoComplete="current-password"
          />
        </label>

        <button type="submit" className="btn btn-block" disabled={busy}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>

        <p className="muted center">
          No account yet? <Link to="/register">Create one</Link>
        </p>

        <div className="demo-box">
          <span className="muted-xs">Demo accounts from the seed script</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => fill('demo@northline.dev', 'quiet-river-8842')}
          >
            Customer: demo@northline.dev
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => fill('admin@northline.dev', 'steady-anchor-7715')}
          >
            Admin: admin@northline.dev
          </button>
        </div>
      </form>
    </div>
  )
}
