import Cart, { CartItem } from '../models/Cart.js'
import Product from '../models/Product.js'
import { asyncHandler } from '../middleware/errorMiddleware.js'

const MAX_PER_LINE = 99

async function getOrCreateCart(userId) {
  const [cart] = await Cart.findOrCreate({ where: { userId } })
  return cart
}

// Always recompute totals from current product prices. Never trust a price
// sent by the browser.
async function loadCart(userId) {
  const cart = await getOrCreateCart(userId)

  const items = await CartItem.findAll({
    where: { cartId: cart.id },
    include: [{ model: Product, as: 'product' }],
    order: [['id', 'ASC']],
  })

  // A product can disappear or be unpublished while it sits in a cart. Drop
  // those rows instead of crashing on a null product.
  const stale = items.filter(i => !i.product || !i.product.published)
  if (stale.length) {
    await CartItem.destroy({ where: { id: stale.map(i => i.id) } })
  }

  const lines = items
    .filter(i => i.product && i.product.published)
    .map(i => ({
      id: i.id,
      quantity: i.quantity,
      product: i.product,
      lineTotalCents: i.product.priceCents * i.quantity,
      inStock: i.product.stock >= i.quantity,
    }))

  return {
    id: cart.id,
    items: lines,
    subtotalCents: lines.reduce((sum, l) => sum + l.lineTotalCents, 0),
    count: lines.reduce((n, l) => n + l.quantity, 0),
    removed: stale.length,
  }
}

// GET /api/cart
export const getCart = asyncHandler(async (req, res) => {
  res.json(await loadCart(req.user.id))
})

// POST /api/cart
export const addToCart = asyncHandler(async (req, res) => {
  const productId = Number(req.body.productId)
  if (!Number.isInteger(productId)) {
    return res.status(400).json({ message: 'A valid productId is required' })
  }

  const requested = Number(req.body.quantity ?? 1)
  if (!Number.isFinite(requested) || requested < 1) {
    return res.status(400).json({ message: 'Quantity must be at least 1' })
  }
  const qty = Math.min(MAX_PER_LINE, Math.round(requested))

  const product = await Product.findByPk(productId)
  if (!product || !product.published) {
    return res.status(404).json({ message: 'Product not found' })
  }
  if (product.stock < 1) {
    return res.status(409).json({ message: 'That product is out of stock' })
  }

  const cart = await getOrCreateCart(req.user.id)
  const existing = await CartItem.findOne({ where: { cartId: cart.id, productId } })
  const wanted = existing ? existing.quantity + qty : qty

  if (wanted > product.stock) {
    return res.status(409).json({ message: `Only ${product.stock} left in stock` })
  }

  if (existing) {
    existing.quantity = Math.min(MAX_PER_LINE, wanted)
    await existing.save()
  } else {
    await CartItem.create({ cartId: cart.id, productId, quantity: qty })
  }

  res.status(201).json(await loadCart(req.user.id))
})

// PUT /api/cart/:itemId
export const updateCartItem = asyncHandler(async (req, res) => {
  const qty = Number(req.body.quantity)
  if (!Number.isFinite(qty)) {
    return res.status(400).json({ message: 'Quantity must be a number' })
  }

  const cart = await getOrCreateCart(req.user.id)
  const item = await CartItem.findOne({
    where: { id: req.params.itemId, cartId: cart.id },
    include: [{ model: Product, as: 'product' }],
  })
  if (!item) return res.status(404).json({ message: 'Item not in your cart' })

  // Setting the quantity to zero is how the interface removes a line.
  if (qty < 1) {
    await item.destroy()
    return res.json(await loadCart(req.user.id))
  }
  if (!item.product) {
    await item.destroy()
    return res.status(404).json({ message: 'That product is no longer available' })
  }
  if (qty > item.product.stock) {
    return res.status(409).json({ message: `Only ${item.product.stock} left in stock` })
  }

  item.quantity = Math.min(MAX_PER_LINE, Math.round(qty))
  await item.save()
  res.json(await loadCart(req.user.id))
})

// DELETE /api/cart/:itemId
export const removeCartItem = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id)
  const deleted = await CartItem.destroy({
    where: { id: req.params.itemId, cartId: cart.id },
  })
  if (!deleted) return res.status(404).json({ message: 'Item not in your cart' })
  res.json(await loadCart(req.user.id))
})

// DELETE /api/cart
export const clearCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id)
  await CartItem.destroy({ where: { cartId: cart.id } })
  res.json(await loadCart(req.user.id))
})

// POST /api/cart/merge - guest cart from localStorage, merged after login
export const mergeCart = asyncHandler(async (req, res) => {
  const incoming = Array.isArray(req.body.items) ? req.body.items.slice(0, 100) : []
  const cart = await getOrCreateCart(req.user.id)

  for (const line of incoming) {
    const productId = Number(line?.productId)
    if (!Number.isInteger(productId)) continue

    const product = await Product.findByPk(productId)
    if (!product || !product.published || product.stock < 1) continue

    const existing = await CartItem.findOne({ where: { cartId: cart.id, productId } })
    const guestQty = Math.max(1, Math.round(Number(line.quantity) || 1))

    // Take the larger of the two rather than the sum, so signing in twice
    // does not keep stacking the same item up.
    const wanted = Math.max(existing?.quantity || 0, guestQty)
    const qty = Math.min(product.stock, MAX_PER_LINE, wanted)
    if (qty < 1) continue

    if (existing) {
      existing.quantity = qty
      await existing.save()
    } else {
      await CartItem.create({ cartId: cart.id, productId, quantity: qty })
    }
  }

  res.json(await loadCart(req.user.id))
})

export { loadCart }
