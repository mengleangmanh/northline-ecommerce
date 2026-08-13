import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import Loader from './Loader.jsx'

// Wraps routes that need a signed-in user.
// <ProtectedRoute adminOnly /> additionally requires role === 'admin'.
//
// This is convenience, not security. The API checks the token on every
// request, so hiding a route here does not protect the data by itself.
export default function ProtectedRoute({ adminOnly = false, children }) {
  const { isAuthenticated, isAdmin, loading } = useAuth()
  const location = useLocation()

  // Wait for the token check to finish, otherwise a refresh on /account would
  // bounce the user to /login for a split second.
  if (loading) return <Loader full label="Checking your session..." />

  if (!isAuthenticated) {
    // Remember where they were headed so login can send them back.
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to="/" replace />
  }

  return children ? children : <Outlet />
}
