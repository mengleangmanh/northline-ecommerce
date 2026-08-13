import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import * as orderService from '../../services/orderService.js'
import { useAuth } from '../../context/AuthContext.jsx'
import Loader from '../../components/Loader.jsx'
import { money } from '../../components/ProductCard.jsx'

// Shared shell for every admin page. AdminProducts and AdminOrders render
// into the <Outlet />.
export function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function signOut() {
    logout()
    navigate('/')
  }

  return (
    <div className="admin">
      <aside className="admin-nav">
        <div className="admin-brand">
          <strong>Northline</strong>
          <span className="muted-xs">Admin</span>
        </div>

        <nav>
          <NavLink to="/admin" end>
            Dashboard
          </NavLink>
          <NavLink to="/admin/products">Products</NavLink>
          <NavLink to="/admin/orders">Orders</NavLink>
        </nav>

        <div className="admin-foot">
          <span className="muted-xs">{user?.email}</span>
          <Link to="/">Back to store</Link>
          {/* An admin needs a way out without going back to the store first. */}
          <button type="button" className="link-danger" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    orderService.getStats().then(setStats).catch(err => setError(err.message))
  }, [])

  if (error) return <div className="note note-red">{error}</div>
  if (!stats) return <Loader label="Loading dashboard..." />

  return (
    <>
      <h1>Dashboard</h1>

      <div className="stat-grid">
        <div className="stat">
          <span className="muted-xs">Revenue</span>
          <strong>{money(stats.revenueCents)}</strong>
          <span className="muted-xs">Paid orders only</span>
        </div>
        <div className="stat">
          <span className="muted-xs">Orders</span>
          <strong>{stats.orderCount}</strong>
        </div>
        <div className="stat">
          <span className="muted-xs">Products</span>
          <strong>{stats.productCount}</strong>
        </div>
        <div className="stat">
          <span className="muted-xs">Customers</span>
          <strong>{stats.userCount}</strong>
        </div>
      </div>

      <section className="panel">
        <h2>Recent orders</h2>
        {stats.recent.length === 0 ? (
          <p className="muted">No orders yet.</p>
        ) : (
          <div className="panel flush">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent.map(o => (
                  <tr key={o.id}>
                    <td>
                      <Link to="/admin/orders">{o.number}</Link>
                    </td>
                    <td>{o.user?.name || o.fullName}</td>
                    <td>{o.status}</td>
                    <td>{money(o.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Low stock</h2>
        {stats.lowStock.length === 0 ? (
          <p className="muted">Everything is well stocked.</p>
        ) : (
          <ul className="stock-list">
            {stats.lowStock.map(p => (
              <li key={p.id}>
                <span>{p.name}</span>
                <span className={p.stock === 0 ? 'badge badge-red' : 'badge badge-orange'}>
                  {p.stock} left
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
