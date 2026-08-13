import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import SocialAuthButtons from '../components/SocialAuthButtons.jsx'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState(null)
  const [wrongDoor, setWrongDoor] = useState(null)
  const [busy, setBusy] = useState(false)

  function change(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setWrongDoor(null)

    // Check on the client for a fast message, but the API checks again. Client
    // validation is for kindness, server validation is for safety.
    if (form.password.length < 8) return setError('Password must be at least 8 characters')
    if (form.password !== form.confirm) return setError('The two passwords do not match')

    setBusy(true)
    try {
      await register(form.name, form.email, form.password)
      navigate('/', { replace: true })
    } catch (err) {
      // 409 with a provider means "you already signed up with Google".
      if (err.status === 409) setWrongDoor(err.message)
      else setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>Create your account</h1>
        <p className="muted">It takes about ten seconds.</p>

        {error && <div className="note note-red">{error}</div>}
        {wrongDoor && <div className="note note-orange">{wrongDoor}</div>}

        {/* Same component as the sign-in page. With OAuth there is no separate
            "sign up" call: the first time someone approves your app we create
            the account, and every time after that we just sign them in. One
            button covers both, which is why the label says "Continue with". */}
        <SocialAuthButtons redirectTo="/" disabled={busy} />

        <label>
          Full name
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={change}
            required
            autoComplete="name"
          />
        </label>

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
            minLength={8}
            autoComplete="new-password"
          />
          <span className="muted-xs">At least 8 characters</span>
        </label>

        <label>
          Confirm password
          <input
            type="password"
            name="confirm"
            value={form.confirm}
            onChange={change}
            required
            autoComplete="new-password"
          />
        </label>

        <button type="submit" className="btn btn-block" disabled={busy}>
          {busy ? 'Creating account...' : 'Create account'}
        </button>

        <p className="muted center">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  )
}
