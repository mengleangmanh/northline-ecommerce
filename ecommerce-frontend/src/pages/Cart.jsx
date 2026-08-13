import { Link, useNavigate } from 'react-router-dom'
import { useCart } from '../context/CartContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import CartItem from '../components/CartItem.jsx'
import { money } from '../components/ProductCard.jsx'

const FREE_SHIPPING_OVER = 10000

export default function Cart() {
  const { items, subtotalCents, count, error, clear } = useCart()
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()

  // Shown as an estimate only. The server recalculates everything at checkout.
  const shippingCents = subtotalCents >= FREE_SHIPPING_OVER || subtotalCents === 0 ? 0 : 500
  const taxCents = Math.round(subtotalCents * 0.1)
  const totalCents = subtotalCents + shippingCents + taxCents
  const away = FREE_SHIPPING_OVER - subtotalCents

  if (items.length === 0) {
    return (
      <div className="container section">
        <div className="empty">
          <h1>Your cart is empty</h1>
          <p className="muted">Once you add something it will show up here.</p>
          <Link to="/products" className="btn">
            Start shopping
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="container section">
      <div className="section-head">
        <h1>Your cart</h1>
        <button type="button" className="link-danger" onClick={clear}>
          Empty cart
        </button>
      </div>

      {error && <div className="note note-red">{error}</div>}
      {!isAuthenticated && (
        <div className="note note-blue">
          You are browsing as a guest. Your cart is saved in this browser and will move to your
          account when you <Link to="/login">sign in</Link>.
        </div>
      )}

      <div className="cart-layout">
        <div className="cart-lines">
          {items.map(line => (
            <CartItem key={line.id} line={line} />
          ))}
        </div>

        <aside className="summary">
          <h2>Summary</h2>

          <div className="row">
            <span>Subtotal ({count} items)</span>
            <span>{money(subtotalCents)}</span>
          </div>
          <div className="row">
            <span>Shipping</span>
            <span>{shippingCents === 0 ? 'Free' : money(shippingCents)}</span>
          </div>
          <div className="row">
            <span>Estimated tax</span>
            <span>{money(taxCents)}</span>
          </div>

          <div className="row total">
            <strong>Total</strong>
            <strong>{money(totalCents)}</strong>
          </div>

          {away > 0 && (
            <p className="muted-xs">Spend {money(away)} more for free shipping.</p>
          )}

          <button
            type="button"
            className="btn btn-block"
            onClick={() => navigate(isAuthenticated ? '/checkout' : '/login')}
          >
            {isAuthenticated ? 'Go to checkout' : 'Sign in to check out'}
          </button>

          <Link to="/products" className="btn btn-ghost btn-block">
            Keep shopping
          </Link>
        </aside>
      </div>
    </div>
  )
}
