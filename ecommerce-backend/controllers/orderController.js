import { Op } from 'sequelize'
import { sequelize } from '../config/db.js'
import Order, { OrderItem, ORDER_STATUSES } from '../models/Order.js'
import Cart, { CartItem } from '../models/Cart.js'
import Product from '../models/Product.js'
import User from '../models/User.js'
import { asyncHandler } from '../middleware/errorMiddleware.js'

const SHIPPING = { standard: 500, express: 1500 }
const FREE_SHIPPING_OVER = 10000
const TAX_RATE = 0.1

// Orders only ever move forward through this list. CANCELLED is handled
// separately because it can happen from several points.
const FLOW = ['PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED']
const PAID_STATUSES = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED']
const CANCELLABLE = ['PENDING', 'PAID', 'PROCESSING']

// A timestamp alone repeats itself and collides once two orders land in the
// same millisecond, so add random characters and check the table.
async function nextOrderNumber(t) {
  const alphabet = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let suffix = ''
    for (let i = 0; i < 6; i += 1) {
      suffix += alphabet[Math.floor(Math.random() * alphabet.length)]
    }
    const number = `NL-${new Date().getFullYear()}${suffix}`
    const clash = await Order.findOne({
      where: { number },
      attributes: ['id'],
      transaction: t,
    })
    if (!clash) return number
  }
  throw new Error('Could not generate a unique order number')
}

// POST /api/orders
// The most important endpoint in the app. Everything happens inside one
// transaction: reserve stock, create the order, empty the cart. If any step
// throws, the whole thing rolls back and nothing is half-written.
export const createOrder = asyncHandler(async (req, res) => {
  const {
    fullName,
    email,
    phone,
    address,
    city,
    postalCode,
    country,
    shipMethod = 'standard',
    paymentMethod = 'cod',
  } = req.body

  const required = { fullName, email, address, city, country }
  for (const [field, value] of Object.entries(required)) {
    if (!String(value || '').trim()) {
      return res.status(400).json({ message: `${field} is required` })
    }
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim())) {
    return res.status(400).json({ message: 'That email address does not look valid' })
  }
  if (!SHIPPING[shipMethod]) {
    return res.status(400).json({ message: 'Invalid shipping method' })
  }

  try {
    const order = await sequelize.transaction(async t => {
      const cart = await Cart.findOne({ where: { userId: req.user.id }, transaction: t })
      const items = cart
        ? await CartItem.findAll({
            where: { cartId: cart.id },
            include: [{ model: Product, as: 'product' }],
            transaction: t,
          })
        : []

      const usable = items.filter(i => i.product && i.product.published)
      if (!usable.length) {
        throw Object.assign(new Error('Your cart is empty'), { status: 400 })
      }

      // Reserve stock with a conditional update. If two people buy the last
      // unit at the same time, one of them gets zero affected rows and fails
      // cleanly instead of the stock going negative.
      for (const item of usable) {
        const quantity = Number(item.quantity)
        const [affected] = await Product.update(
          { stock: sequelize.literal(`stock - ${quantity}`) },
          {
            where: { id: item.productId, stock: { [Op.gte]: quantity } },
            transaction: t,
          },
        )
        if (affected === 0) {
          throw Object.assign(new Error(`${item.product.name} just sold out`), { status: 409 })
        }
      }

      // Prices come from the database, never from the request body.
      const subtotalCents = usable.reduce(
        (sum, i) => sum + i.product.priceCents * i.quantity,
        0,
      )
      const shippingCents = subtotalCents >= FREE_SHIPPING_OVER ? 0 : SHIPPING[shipMethod]
      const taxCents = Math.round(subtotalCents * TAX_RATE)
      const totalCents = subtotalCents + shippingCents + taxCents

      const created = await Order.create(
        {
          number: await nextOrderNumber(t),
          userId: req.user.id,
          email: String(email).trim().toLowerCase(),
          fullName: String(fullName).trim(),
          phone,
          address,
          city,
          postalCode,
          country,
          shipMethod,
          paymentMethod,
          subtotalCents,
          shippingCents,
          taxCents,
          totalCents,
          status: 'PENDING',
        },
        { transaction: t },
      )

      await OrderItem.bulkCreate(
        usable.map(i => ({
          orderId: created.id,
          productId: i.productId,
          nameSnapshot: i.product.name,
          priceCents: i.product.priceCents,
          quantity: i.quantity,
          image: i.product.image,
        })),
        { transaction: t },
      )

      await CartItem.destroy({ where: { cartId: cart.id }, transaction: t })

      return created
    })

    const full = await Order.findByPk(order.id, {
      include: [{ model: OrderItem, as: 'items' }],
    })
    res.status(201).json(full)
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message })
    throw err
  }
})

// GET /api/orders/mine
export const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.findAll({
    where: { userId: req.user.id },
    include: [{ model: OrderItem, as: 'items' }],
    order: [['createdAt', 'DESC']],
  })
  res.json(orders)
})

// GET /api/orders/:number
export const getOrderByNumber = asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    where: { number: req.params.number },
    include: [
      { model: OrderItem, as: 'items' },
      { model: User, as: 'user', attributes: ['id', 'name', 'email'] },
    ],
  })

  if (!order) return res.status(404).json({ message: 'Order not found' })

  // A customer may only read their own order. Without this check anyone could
  // walk the order numbers and read other people's addresses.
  if (order.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Not your order' })
  }

  res.json(order)
})

// PUT /api/orders/:number/cancel
export const cancelOrder = asyncHandler(async (req, res) => {
  const updated = await sequelize.transaction(async t => {
    const order = await Order.findOne({
      where: { number: req.params.number },
      include: [{ model: OrderItem, as: 'items' }],
      transaction: t,
    })
    if (!order) throw Object.assign(new Error('Order not found'), { status: 404 })
    if (order.userId !== req.user.id && req.user.role !== 'admin') {
      throw Object.assign(new Error('Not your order'), { status: 403 })
    }
    if (!CANCELLABLE.includes(order.status)) {
      throw Object.assign(new Error(`Cannot cancel an order that is ${order.status}`), {
        status: 409,
      })
    }

    // Put the reserved stock back, inside the same transaction as the status
    // change so the two can never disagree.
    for (const item of order.items) {
      if (!item.productId) continue
      await Product.update(
        { stock: sequelize.literal(`stock + ${Number(item.quantity)}`) },
        { where: { id: item.productId }, transaction: t },
      )
    }

    order.status = 'CANCELLED'
    await order.save({ transaction: t })
    return order
  }).catch(err => {
    if (err.status) {
      res.status(err.status).json({ message: err.message })
      return null
    }
    throw err
  })

  if (updated) res.json(updated)
})

// GET /api/orders  (admin)
export const getAllOrders = asyncHandler(async (req, res) => {
  const where = {}
  if (req.query.status) {
    if (!ORDER_STATUSES.includes(req.query.status)) {
      return res.status(400).json({ message: 'Unknown status' })
    }
    where.status = req.query.status
  }
  if (req.query.search) {
    where.number = { [Op.like]: `%${String(req.query.search).trim()}%` }
  }

  const orders = await Order.findAll({
    where,
    include: [
      { model: OrderItem, as: 'items' },
      { model: User, as: 'user', attributes: ['id', 'name', 'email'] },
    ],
    order: [['createdAt', 'DESC']],
    limit: Math.min(200, Number(req.query.limit) || 100),
  })
  res.json(orders)
})

// PUT /api/orders/:number/status  (admin)
export const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body
  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ message: 'Unknown status' })
  }

  const order = await Order.findOne({
    where: { number: req.params.number },
    include: [{ model: OrderItem, as: 'items' }],
  })
  if (!order) return res.status(404).json({ message: 'Order not found' })
  if (order.status === status) return res.json(order)

  if (status === 'CANCELLED') {
    // Cancelling from the admin side has to restore stock too, which the old
    // version did not do.
    if (!CANCELLABLE.includes(order.status)) {
      return res.status(409).json({ message: `Cannot cancel an order that is ${order.status}` })
    }
    await sequelize.transaction(async t => {
      for (const item of order.items) {
        if (!item.productId) continue
        await Product.update(
          { stock: sequelize.literal(`stock + ${Number(item.quantity)}`) },
          { where: { id: item.productId }, transaction: t },
        )
      }
      order.status = 'CANCELLED'
      await order.save({ transaction: t })
    })
    return res.json(order)
  }

  // Only allow moving forward through the flow.
  const from = FLOW.indexOf(order.status)
  const to = FLOW.indexOf(status)
  if (from === -1 || to === -1 || to < from) {
    return res.status(409).json({ message: `Cannot move from ${order.status} to ${status}` })
  }

  order.status = status
  if (PAID_STATUSES.includes(status) && !order.paidAt) order.paidAt = new Date()
  await order.save()

  res.json(order)
})

// GET /api/orders/stats/summary  (admin)
export const getStats = asyncHandler(async (_req, res) => {
  const [revenue, orderCount, openCount, cancelledCount, productCount, userCount, lowStock, recent] =
    await Promise.all([
      Order.sum('totalCents', { where: { status: PAID_STATUSES } }),
      Order.count({ where: { status: { [Op.ne]: 'CANCELLED' } } }),
      Order.count({ where: { status: ['PENDING', 'PAID', 'PROCESSING'] } }),
      Order.count({ where: { status: 'CANCELLED' } }),
      Product.count(),
      User.count({ where: { role: 'customer' } }),
      Product.findAll({
        where: { stock: { [Op.lte]: 5 } },
        order: [['stock', 'ASC']],
        limit: 10,
      }),
      Order.findAll({
        include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
        order: [['createdAt', 'DESC']],
        limit: 5,
      }),
    ])

  res.json({
    revenueCents: revenue || 0,
    orderCount,
    openCount,
    cancelledCount,
    productCount,
    userCount,
    lowStock,
    recent,
  })
})
