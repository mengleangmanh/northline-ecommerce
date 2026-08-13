import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import * as authService from '../services/authService.js'

/**
 * Account settings, and the home of two-factor authentication.
 *
 * Enrolment is a small state machine rather than one form, because the steps
 * genuinely depend on each other: you cannot show a QR code before the server
 * has minted a secret, and you must not switch 2FA on until a real code has
 * come back from the phone.
 *
 *   idle -> confirming password -> showing QR -> verifying code -> codes shown
 */
export default function Account() {
  const { user, logout } = useAuth()

  const [status, setStatus] = useState(null)
  const [stage, setStage] = useState('idle')
  const [setupData, setSetupData] = useState(null)
  const [recoveryCodes, setRecoveryCodes] = useState(null)

  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  const needsPassword = user?.hasPassword !== false

  useEffect(() => {
    authService.getTwoFactorStatus().then(setStatus).catch(() => {})
  }, [])

  function reset() {
    setStage('idle')
    setSetupData(null)
    setRecoveryCodes(null)
    setPassword('')
    setCode('')
    setError(null)
  }

  async function run(fn) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const beginSetup = () =>
    run(async () => {
      setSetupData(await authService.setupTwoFactor(password))
      setPassword('')
      setStage('scan')
    })

  const confirmSetup = () =>
    run(async () => {
      const res = await authService.enableTwoFactor(code)
      setRecoveryCodes(res.recoveryCodes)
      setCode('')
      setStage('codes')
      setStatus(await authService.getTwoFactorStatus())
    })

  const turnOff = () =>
    run(async () => {
      await authService.disableTwoFactor(password, code)
      reset()
      setNotice('Two-factor authentication is off.')
      setStatus(await authService.getTwoFactorStatus())
    })

  const newCodes = () =>
    run(async () => {
      const res = await authService.regenerateRecoveryCodes(password, code)
      setRecoveryCodes(res.recoveryCodes)
      setPassword('')
      setCode('')
      setStage('codes')
      setStatus(await authService.getTwoFactorStatus())
    })

  function copyCodes() {
    navigator.clipboard?.writeText(recoveryCodes.join('\n'))
    setNotice('Backup codes copied to your clipboard.')
  }

  function downloadCodes() {
    const body = [
      'Northline backup codes',
      `Account: ${user?.email}`,
      `Issued: ${new Date().toLocaleString()}`,
      '',
      'Each code works once. Keep them somewhere you can reach',
      'WITHOUT your phone.',
      '',
      ...recoveryCodes,
    ].join('\n')

    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'northline-backup-codes.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="container account-page">
      <h1>Your account</h1>

      <section className="panel">
        <h2>Profile</h2>
        <dl className="kv">
          <dt>Name</dt>
          <dd>{user?.name}</dd>
          <dt>Email</dt>
          <dd>{user?.email}</dd>
          <dt>Role</dt>
          <dd>{user?.role === 'admin' ? 'Administrator' : 'Customer'}</dd>
        </dl>
        <button className="btn btn-ghost" onClick={logout}>
          Sign out
        </button>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Two-factor authentication</h2>
          <span className={status?.enabled ? 'pill pill-green' : 'pill pill-grey'}>
            {status?.enabled ? 'On' : 'Off'}
          </span>
        </div>

        <p className="muted">
          A six-digit code from an app on your phone, on top of your password. It means a
          stolen or reused password is not enough on its own to get into your account.
        </p>

        {error && <div className="note note-red">{error}</div>}
        {notice && <div className="note note-green">{notice}</div>}

        {/* ---------------- Off, and not yet started ---------------- */}
        {!status?.enabled && stage === 'idle' && (
          <div className="stack">
            {needsPassword && (
              <label>
                Confirm your password
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
            )}
            <button className="btn" onClick={beginSetup} disabled={busy}>
              {busy ? 'Preparing...' : 'Turn on two-factor authentication'}
            </button>
          </div>
        )}

        {/* ---------------- Scan the QR ---------------- */}
        {stage === 'scan' && setupData && (
          <div className="stack">
            <ol className="steps">
              <li>
                Install an authenticator app if you do not have one - Google Authenticator,
                Microsoft Authenticator, Authy and 1Password all work.
              </li>
              <li>Scan this code, or type the key in by hand.</li>
              <li>Enter the six digits it shows.</li>
            </ol>

            {setupData.qrDataUrl ? (
              <img className="qr" src={setupData.qrDataUrl} alt="QR code for your authenticator app" />
            ) : (
              <div className="note note-orange">
                The QR image could not be generated on the server, so type the key in
                manually instead. It works exactly the same.
              </div>
            )}

            <div className="secret-box">
              <span className="muted-xs">Setup key</span>
              <code>{setupData.secretFormatted}</code>
            </div>

            <label>
              Code from your app
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </label>

            <div className="row-gap">
              <button className="btn" onClick={confirmSetup} disabled={busy || code.length < 6}>
                {busy ? 'Checking...' : 'Verify and turn on'}
              </button>
              <button className="btn btn-ghost" onClick={reset} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ---------------- Recovery codes, shown once ---------------- */}
        {stage === 'codes' && recoveryCodes && (
          <div className="stack">
            <div className="note note-orange">
              <strong>Save these now.</strong> This is the only time they will be shown. If
              you lose your phone, these codes are the only way back into your account.
            </div>

            <ul className="code-grid">
              {recoveryCodes.map(c => (
                <li key={c}>
                  <code>{c}</code>
                </li>
              ))}
            </ul>

            <div className="row-gap">
              <button className="btn btn-ghost" onClick={copyCodes}>
                Copy
              </button>
              <button className="btn btn-ghost" onClick={downloadCodes}>
                Download
              </button>
              <button className="btn" onClick={() => { reset(); setNotice('Two-factor authentication is on.') }}>
                I have saved them
              </button>
            </div>
          </div>
        )}

        {/* ---------------- On ---------------- */}
        {status?.enabled && stage === 'idle' && (
          <div className="stack">
            <p className="muted-xs">
              {status.recoveryCodesLeft} backup code{status.recoveryCodesLeft === 1 ? '' : 's'}{' '}
              remaining.
              {status.recoveryCodesLeft <= 2 && ' Worth generating a fresh set.'}
            </p>
            <div className="row-gap">
              <button className="btn btn-ghost" onClick={() => setStage('regen')}>
                New backup codes
              </button>
              <button className="btn btn-ghost btn-danger" onClick={() => setStage('off')}>
                Turn off
              </button>
            </div>
          </div>
        )}

        {/* ---------------- Disable / regenerate: both re-authenticate ---------------- */}
        {(stage === 'off' || stage === 'regen') && (
          <div className="stack">
            <p className="muted-xs">
              {stage === 'off'
                ? 'Confirm it is really you before turning this off.'
                : 'Generating new codes cancels your old ones.'}
            </p>

            {needsPassword && (
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
            )}

            <label>
              Code from your app
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={11}
                value={code}
                onChange={e => setCode(e.target.value)}
              />
            </label>

            <div className="row-gap">
              <button
                className={stage === 'off' ? 'btn btn-danger' : 'btn'}
                onClick={stage === 'off' ? turnOff : newCodes}
                disabled={busy}
              >
                {busy ? 'Working...' : stage === 'off' ? 'Turn off' : 'Generate new codes'}
              </button>
              <button className="btn btn-ghost" onClick={reset} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
