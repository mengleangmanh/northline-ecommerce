import api from './api.js'

export const register = payload => api.post('/auth/register', payload).then(r => r.data)

export const login = payload => api.post('/auth/login', payload).then(r => r.data)

export const getMe = () => api.get('/auth/me').then(r => r.data)

export const updateProfile = payload => api.put('/auth/me', payload).then(r => r.data)

export const listUsers = () => api.get('/auth/users').then(r => r.data)

// Which social buttons this server can actually handle. Returns e.g.
// ['google'] if you have only filled in the Google keys so far.
export const getProviders = () =>
  api
    .get('/auth/providers')
    .then(r => r.data.providers || [])
    .catch(err => {
      console.error('Failed to fetch auth providers:', err)
      return []
    })

/**
 * The URL the browser should *navigate* to in order to start a social login.
 *
 * Note this returns a URL for window.location rather than something to fetch.
 * An OAuth login has to physically leave your site, visit Google, and come
 * back. axios cannot do that: XHR will not follow a redirect to another origin,
 * and Google refuses to be loaded in an iframe. A full page navigation is the
 * only way, and it is why this is a plain <a href> in the UI.
 */
export function socialLoginUrl(provider, redirectTo = '/') {
  // OAuth requires a full page navigation to the backend. The Vite dev proxy
  // only intercepts fetch/XHR, so a relative /api path would 404 during a real
  // browser redirect. In development we must point directly at the backend.
  const raw = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api')
  const trimmed = raw.trim().replace(/\/+$/, '')
  const base = trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`
  return `${base}/auth/${provider}?redirect=${encodeURIComponent(redirectTo)}`
}

/* ==========================================================================
 * Two-factor authentication
 * ======================================================================== */

export const getTwoFactorStatus = () => api.get('/auth/2fa/status').then(r => r.data)

// Step one of enrolment: ask the server for a secret and a QR code. This does
// not switch anything on yet.
export const setupTwoFactor = password =>
  api.post('/auth/2fa/setup', { password }).then(r => r.data)

// Step two: prove the authenticator app is working. Returns the recovery
// codes, which the server will never show again.
export const enableTwoFactor = code =>
  api.post('/auth/2fa/enable', { code }).then(r => r.data)

export const disableTwoFactor = (password, code) =>
  api.post('/auth/2fa/disable', { password, code }).then(r => r.data)

export const regenerateRecoveryCodes = (password, code) =>
  api.post('/auth/2fa/recovery-codes', { password, code }).then(r => r.data)

/**
 * The second half of a login.
 *
 * The challenge token is passed explicitly rather than read from localStorage,
 * because at this moment the user is not signed in and there is nothing in
 * localStorage to read. The token is deliberately kept in React state only -
 * writing a half-authenticated credential to disk would leave it behind on a
 * shared computer if the person walked away at the code prompt.
 */
export const verifyTwoFactor = (code, challengeToken) =>
  api
    .post(
      '/auth/2fa/verify',
      { code },
      { headers: { Authorization: `Bearer ${challengeToken}` } },
    )
    .then(r => r.data)

export default {
  register,
  login,
  getMe,
  updateProfile,
  listUsers,
  getProviders,
  socialLoginUrl,
  getTwoFactorStatus,
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  regenerateRecoveryCodes,
  verifyTwoFactor,
}
