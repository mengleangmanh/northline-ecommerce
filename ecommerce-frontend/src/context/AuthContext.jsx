import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import * as authService from '../services/authService.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // Read from localStorage on the first render so a refresh does not flash the
  // signed-out header before the user comes back.
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('user')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(Boolean(localStorage.getItem('token')))

  // Which social buttons this server can handle. Empty until the API answers,
  // so nothing flickers into view and then disappears.
  const [providers, setProviders] = useState([])

  // Confirm the stored token is still valid. If the server says no, api.js
  // has already cleared it.
  useEffect(() => {
    if (!localStorage.getItem('token')) {
      setLoading(false)
      return
    }
    authService
      .getMe()
      .then(fresh => {
        setUser(fresh)
        localStorage.setItem('user', JSON.stringify(fresh))
      })
      .catch(() => {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  // Ask once, on load, which providers are configured in the backend .env.
  useEffect(() => {
    authService.getProviders().then(setProviders)
  }, [])

  function persist({ user: nextUser, token }) {
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(nextUser))
    setUser(nextUser)
    return nextUser
  }

  async function login(email, password) {
    const result = await authService.login({ email, password })
    // When 2FA is on, the API returns { twoFactorRequired, challengeToken }
    // instead of { user, token }. Pass it through without persisting.
    if (result.twoFactorRequired) return result
    return persist(result)
  }

  async function register(name, email, password) {
    return persist(await authService.register({ name, email, password }))
  }

  /**
   * Complete a login that requires a second factor.
   *
   * Called from Login.jsx (email flow) and AuthCallback.jsx (social flow).
   * The challenge token proves the first factor succeeded; the code proves
   * the second. The API hands back { user, token } on success.
   */
  async function completeTwoFactor(code, challengeToken) {
    const result = await authService.verifyTwoFactor(code, challengeToken)
    persist(result)
    return result
  }

  /**
   * Finish a Google or Facebook login.
   *
   * The password flows get the user object and the token in one response. A
   * social login cannot: the browser comes back from Google with nothing but a
   * token in the URL. So we store the token first, then use it to fetch the
   * profile - two steps rather than one.
   */
  async function loginWithToken(token) {
    localStorage.setItem('token', token)
    try {
      const fresh = await authService.getMe()
      localStorage.setItem('user', JSON.stringify(fresh))
      setUser(fresh)
      return fresh
    } catch (err) {
      // Bad or expired token - do not leave it sitting in localStorage where
      // every later request would send it and get a 401.
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      setUser(null)
      throw err
    }
  }

  async function updateProfile(payload) {
    const fresh = await authService.updateProfile(payload)
    localStorage.setItem('user', JSON.stringify(fresh))
    setUser(fresh)
    return fresh
  }

  // Sign out. Reachable from the navbar menu, the account page and the admin
  // sidebar - every signed-in surface needs a visible way out.
  //
  // This only signs the user out of *our* store. It deliberately does not sign
  // them out of their Google or Facebook account, which is what people expect:
  // logging out of a shop should not log you out of Gmail.
  function logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }

  const value = useMemo(
    () => ({
      user,
      loading,
      providers,
      isAuthenticated: Boolean(user),
      isAdmin: user?.role === 'admin',
      login,
      register,
      loginWithToken,
      completeTwoFactor,
      updateProfile,
      logout,
    }),
    [user, loading, providers],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export default AuthContext
