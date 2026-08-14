import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useCart } from '../context/CartContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'

export default function Navbar() {
  const { user, isAuthenticated, isAdmin, logout } = useAuth()
  const { count } = useCart()
  const { isDark, toggle: toggleTheme } = useTheme()
  const navigate = useNavigate()

  const [menuOpen, setMenuOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [search, setSearch] = useState('')
  const accountRef = useRef(null)

  // Close the account dropdown on an outside click or Escape.
  useEffect(() => {
    function onClick(e) {
      if (accountRef.current && !accountRef.current.contains(e.target)) setAccountOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        setAccountOpen(false)
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  function onSearch(e) {
    e.preventDefault()
    navigate(search.trim() ? `/products?search=${encodeURIComponent(search.trim())}` : '/products')
    setMenuOpen(false)
  }

  function signOut() {
    logout()
    setAccountOpen(false)
    setMenuOpen(false)
    navigate('/')
  }

  return (
    <header className="nav">
      <div className="container nav-inner">
        <Link to="/" className="logo">
          Northline
        </Link>

        <form className="nav-search" onSubmit={onSearch} role="search">
          <input
            type="search"
            placeholder="Search products"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search products"
          />
          <button type="submit" className="btn btn-sm">
            Search
          </button>
        </form>

        <nav className={menuOpen ? 'nav-links open' : 'nav-links'}>
          <NavLink to="/products" onClick={() => setMenuOpen(false)}>
            Shop
          </NavLink>

          {isAdmin && (
            <NavLink to="/admin" onClick={() => setMenuOpen(false)}>
              Admin
            </NavLink>
          )}

          <NavLink to="/cart" className="nav-cart" onClick={() => setMenuOpen(false)}>
            Cart
            {count > 0 && <span className="pill">{count}</span>}
          </NavLink>

          {/* aria-pressed rather than a label change, so a screen reader hears
              the state instead of a button whose name keeps moving. */}
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-pressed={isDark}
            aria-label="Dark mode"
            title={isDark ? 'Switch to light' : 'Switch to dark'}
          >
            {isDark ? (
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4.2" />
                <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20.5 14.6A8.6 8.6 0 1 1 9.4 3.5a6.9 6.9 0 0 0 11.1 11.1z" />
              </svg>
            )}
          </button>

          {!isAuthenticated ? (
            <>
              <NavLink to="/login" onClick={() => setMenuOpen(false)}>
                Sign in
              </NavLink>
              <Link to="/register" className="btn btn-sm" onClick={() => setMenuOpen(false)}>
                Create account
              </Link>
            </>
          ) : (
            <div className="account" ref={accountRef}>
              <button
                type="button"
                className="account-trigger"
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                onClick={() => setAccountOpen(o => !o)}
              >
                <span className="avatar" aria-hidden="true">
                  {user.name.charAt(0).toUpperCase()}
                </span>
                <span className="account-name">{user.name.split(' ')[0]}</span>
              </button>

              {accountOpen && (
                <div className="account-menu" role="menu">
                  <div className="account-head">
                    <strong>{user.name}</strong>
                    <span className="muted-xs">{user.email}</span>
                  </div>

                  <Link to="/account" role="menuitem" onClick={() => setAccountOpen(false)}>
                    Account settings
                  </Link>
                  <Link to="/orders" role="menuitem" onClick={() => setAccountOpen(false)}>
                    My orders
                  </Link>
                  {isAdmin && (
                    <Link to="/admin" role="menuitem" onClick={() => setAccountOpen(false)}>
                      Admin dashboard
                    </Link>
                  )}

                  {/* Every signed-in surface needs a visible way out. */}
                  <button type="button" className="menu-danger" role="menuitem" onClick={signOut}>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </nav>

        <button
          type="button"
          className="burger"
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(o => !o)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
    </header>
  )
}
