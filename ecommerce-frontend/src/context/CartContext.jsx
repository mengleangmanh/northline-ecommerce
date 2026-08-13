import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as cartService from '../services/cartService.js'
import { useAuth } from './AuthContext.jsx'

const CartContext = createContext(null)
const GUEST_KEY = 'guestCart'

function readGuestCart() {
  try {
    return JSON.parse(localStorage.getItem(GUEST_KEY)) || []
  } catch {
    return []
  }
}

function writeGuestCart(lines) {
  localStorage.setItem(GUEST_KEY, JSON.stringify(lines))
}

export function CartProvider({ children }) {
  const { isAuthenticated, loading: authLoading } = useAuth()

  const [items, setItems] = useState([])
  const [subtotalCents, setSubtotalCents] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  function applyServerCart(cart) {
    setItems(cart.items || [])
    setSubtotalCents(cart.subtotalCents || 0)
  }

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return
    setLoading(true)
    try {
      applyServerCart(await cartService.getCart())
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  // When the user signs in, push whatever they collected as a guest up to the
  // server, then load the merged cart back down.
  useEffect(() => {
    if (authLoading) return

    if (!isAuthenticated) {
      const guest = readGuestCart()
      setItems(guest)
      setSubtotalCents(guest.reduce((s, l) => s + (l.product?.priceCents || 0) * l.quantity, 0))
      return
    }

    const guest = readGuestCart()
    const load = guest.length
      ? cartService.mergeCart(guest.map(l => ({ productId: l.product.id, quantity: l.quantity })))
      : cartService.getCart()

    load
      .then(cart => {
        applyServerCart(cart)
        localStorage.removeItem(GUEST_KEY)
      })
      .catch(err => setError(err.message))
  }, [isAuthenticated, authLoading])

  async function add(product, quantity = 1) {
    setError(null)

    if (!isAuthenticated) {
      const guest = readGuestCart()
      const existing = guest.find(l => l.product.id === product.id)
      const wanted = (existing?.quantity || 0) + quantity

      if (wanted > product.stock) {
        setError(`Only ${product.stock} left in stock`)
        return
      }
      if (existing) existing.quantity = wanted
      else guest.push({ id: `guest-${product.id}`, product, quantity })

      writeGuestCart(guest)
      setItems([...guest])
      setSubtotalCents(guest.reduce((s, l) => s + l.product.priceCents * l.quantity, 0))
      return
    }

    try {
      applyServerCart(await cartService.addToCart(product.id, quantity))
    } catch (err) {
      setError(err.message)
    }
  }

  async function update(itemId, quantity) {
    setError(null)

    if (!isAuthenticated) {
      let guest = readGuestCart()
      if (quantity < 1) guest = guest.filter(l => l.id !== itemId)
      else guest = guest.map(l => (l.id === itemId ? { ...l, quantity } : l))

      writeGuestCart(guest)
      setItems(guest)
      setSubtotalCents(guest.reduce((s, l) => s + l.product.priceCents * l.quantity, 0))
      return
    }

    try {
      applyServerCart(await cartService.updateCartItem(itemId, quantity))
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(itemId) {
    return update(itemId, 0)
  }

  async function clear() {
    if (!isAuthenticated) {
      writeGuestCart([])
      setItems([])
      setSubtotalCents(0)
      return
    }
    applyServerCart(await cartService.clearCart())
  }

  const value = useMemo(() => {
    const lines = items.map(l => ({
      ...l,
      lineTotalCents: l.lineTotalCents ?? (l.product?.priceCents || 0) * l.quantity,
    }))

    return {
      items: lines,
      subtotalCents,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      loading,
      error,
      add,
      update,
      remove,
      clear,
      refresh,
      clearError: () => setError(null),
    }
  }, [items, subtotalCents, loading, error, refresh])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>')
  return ctx
}

export default CartContext
