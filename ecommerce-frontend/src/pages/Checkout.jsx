import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCart } from '../context/CartContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import * as orderService from '../services/orderService.js'
import { money } from '../components/ProductCard.jsx'

const SHIPPING = { standard: 500, express: 1500 }
const FREE_SHIPPING_OVER = 10000

export default function Checkout() {
  const { items, subtotalCents, refresh } = useCart()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    fullName: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    address: user?.address || '',
    city: user?.city || '',
    postalCode: '',
    country: user?.country || '',
    shipMethod: 'standard',
    paymentMethod: 'cod',
  })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Estimates only. The server recalculates from its own prices, so a tampered
  // total in the browser changes nothing.
  const shippingCents = subtotalCents >= FREE_SHIPPING_OVER ? 0 : SHIPPING[form.shipMethod]
  const taxCents = Math.round(subtotalCents * 0.1)
  const totalCents = subtotalCents + shippingCents + taxCents

  function change(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const order = await orderService.createOrder(form)
      await refresh() // the server emptied the cart, so pull the empty one down
      navigate(`/order/${order.number}`, { replace: true })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  if (items.length === 0) {
    return (
      <div className="container section">
        <div className="empty">
          <h1>Nothing to check out</h1>
          <p className="muted">Your cart is empty.</p>
          <Link to="/products" className="btn">
            Browse products
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="container section">
      <h1>Checkout</h1>

      {error && <div className="note note-red">{error}</div>}

      <form className="checkout" onSubmit={submit}>
        <div className="checkout-main">
          <fieldset>
            <legend>Contact</legend>
            <label>
              Full name
              <input name="fullName" value={form.fullName} onChange={change} required autoComplete="name" />
            </label>
            <label>
              Email
              <input type="email" name="email" value={form.email} onChange={change} required autoComplete="email" />
            </label>
            <label>
              Phone
              <input name="phone" value={form.phone} onChange={change} autoComplete="tel" />
            </label>
          </fieldset>

          <fieldset>
            <legend>Shipping address</legend>
            <label>
              Street address
              <input name="address" value={form.address} onChange={change} required autoComplete="street-address" />
            </label>
            <div className="two-col">
              <label>
                City
                <input name="city" value={form.city} onChange={change} required autoComplete="address-level2" />
              </label>
              <label>
                Postal code
                <input name="postalCode" value={form.postalCode} onChange={change} autoComplete="postal-code" />
              </label>
            </div>
            <label>
              Country
              <input name="country" value={form.country} onChange={change} required autoComplete="country-name" />
            </label>
          </fieldset>

          <fieldset>
            <legend>Delivery</legend>
            <label className="radio">
              <input
                type="radio"
                name="shipMethod"
                value="standard"
                checked={form.shipMethod === 'standard'}
                onChange={change}
              />
              <span>
                <strong>Standard</strong> three to five days — {money(SHIPPING.standard)}
              </span>
            </label>
            <label className="radio">
              <input
                type="radio"
                name="shipMethod"
                value="express"
                checked={form.shipMethod === 'express'}
                onChange={change}
              />
              <span>
                <strong>Express</strong> one to two days — {money(SHIPPING.express)}
              </span>
            </label>
          </fieldset>

          <fieldset>
            <legend>Payment</legend>
            <label className="radio">
              <input
                type="radio"
                name="paymentMethod"
                value="cod"
                checked={form.paymentMethod === 'cod'}
                onChange={change}
              />
              <span>
                <strong>Cash on delivery</strong> pay the courier
              </span>
            </label>
            <label className="radio">
              <input
                type="radio"
                name="paymentMethod"
                value="bank"
                checked={form.paymentMethod === 'bank'}
                onChange={change}
              />
              <span>
                <strong>Bank transfer</strong> details sent by email
              </span>
            </label>
            <p className="muted-xs">
              No card processing in this demo. Add Stripe or ABA PayWay later and mark the order PAID
              from the webhook.
            </p>
          </fieldset>
        </div>

        <aside className="summary">
          <h2>Your order</h2>

          <ul className="summary-lines">
            {items.map(line => (
              <li key={line.id}>
                <span>
                  {line.product.name} <span className="muted-xs">x{line.quantity}</span>
                </span>
                <span>{money(line.lineTotalCents)}</span>
              </li>
            ))}
          </ul>

          <div className="row">
            <span>Subtotal</span>
            <span>{money(subtotalCents)}</span>
          </div>
          <div className="row">
            <span>Shipping</span>
            <span>{shippingCents === 0 ? 'Free' : money(shippingCents)}</span>
          </div>
          <div className="row">
            <span>Tax</span>
            <span>{money(taxCents)}</span>
          </div>
          <div className="row total">
            <strong>Total</strong>
            <strong>{money(totalCents)}</strong>
          </div>

          <button type="submit" className="btn btn-block" disabled={busy}>
            {busy ? 'Placing order...' : `Place order — ${money(totalCents)}`}
          </button>

          <Link to="/cart" className="btn btn-ghost btn-block">
            Back to cart
          </Link>
        </aside>
      </form>
    </div>
  )
}
