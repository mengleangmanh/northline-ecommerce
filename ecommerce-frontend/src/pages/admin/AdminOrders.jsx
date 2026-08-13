import { useEffect, useState } from 'react'
import * as orderService from '../../services/orderService.js'
import Loader from '../../components/Loader.jsx'
import { money } from '../../components/ProductCard.jsx'
import { STATUS_COLOR } from '../OrderConfirmation.jsx'

const STATUSES = ['PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']

export default function AdminOrders() {
  const [orders, setOrders] = useState([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(null)

  async function load() {
    setLoading(true)
    try {
      setOrders(await orderService.getAllOrders(filter ? { status: filter } : {}))
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  async function setStatus(number, status) {
    setError(null)
    try {
      const updated = await orderService.updateOrderStatus(number, status)
      setOrders(list => list.map(o => (o.number === number ? { ...o, status: updated.status } : o)))
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <Loader label="Loading orders..." />

  return (
    <>
      <div className="section-head">
        <h1>Orders</h1>
        <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="note note-red">{error}</div>}

      {orders.length === 0 ? (
        <p className="muted">No orders match that filter.</p>
      ) : (
        <div className="panel flush">
          <table className="dtable">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Placed</th>
                <th>Total</th>
                <th>Status</th>
                <th>Move to</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id}>
                  <td>
                    <button type="button" className="link" onClick={() => setOpen(open === o.id ? null : o.id)}>
                      {o.number}
                    </button>
                    {open === o.id && (
                      <ul className="mini-list">
                        {o.items?.map(i => (
                          <li key={i.id}>
                            {i.nameSnapshot} <span className="muted-xs">x{i.quantity}</span>
                          </li>
                        ))}
                        <li className="muted-xs">
                          {o.address}, {o.city}, {o.country}
                        </li>
                      </ul>
                    )}
                  </td>
                  <td>
                    {o.user?.name || o.fullName}
                    <span className="muted-xs block">{o.email}</span>
                  </td>
                  <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                  <td>{money(o.totalCents)}</td>
                  <td>
                    <span className={`badge ${STATUS_COLOR[o.status] || 'badge-grey'}`}>{o.status}</span>
                  </td>
                  <td>
                    <select
                      value=""
                      onChange={e => e.target.value && setStatus(o.number, e.target.value)}
                      aria-label={`Change status of ${o.number}`}
                    >
                      <option value="">Change...</option>
                      {STATUSES.map(s => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
