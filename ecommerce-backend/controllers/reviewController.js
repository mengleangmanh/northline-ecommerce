import { sequelize } from '../config/db.js'
import Review from '../models/Review.js'
import Product from '../models/Product.js'
import User from '../models/User.js'
import Order, { OrderItem } from '../models/Order.js'
import { asyncHandler } from '../middleware/errorMiddleware.js'
import { stripTags } from '../utils/sanitize.js'

// A review only counts once the order has actually been paid for.
const BOUGHT_STATUSES = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED']

// Recompute the cached average on the product after any review change.
async function refreshRating(productId, t) {
  const [row] = await Review.findAll({
    where: { productId },
    attributes: [
      [sequelize.fn('AVG', sequelize.col('rating')), 'avg'],
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    raw: true,
    transaction: t,
  })

  await Product.update(
    {
      // MySQL returns AVG as a string, and an unrounded 4.333333 looks wrong
      // in the interface.
      ratingAvg: Math.round((Number(row?.avg) || 0) * 100) / 100,
      ratingCount: Number(row?.count) || 0,
    },
    { where: { id: productId }, transaction: t },
  )
}

function validRating(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
}

// GET /api/reviews/product/:productId
export const getProductReviews = asyncHandler(async (req, res) => {
  const productId = Number(req.params.productId)
  if (!Number.isInteger(productId)) {
    return res.status(400).json({ message: 'Invalid product id' })
  }

  const reviews = await Review.findAll({
    where: { productId },
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
    order: [['createdAt', 'DESC']],
  })
  res.json(reviews)
})

// POST /api/reviews/product/:productId
export const createReview = asyncHandler(async (req, res) => {
  const productId = Number(req.params.productId)
  if (!Number.isInteger(productId)) {
    return res.status(400).json({ message: 'Invalid product id' })
  }

  const rating = validRating(req.body.rating)
  if (rating === null) {
    return res.status(400).json({ message: 'Rating must be a whole number from 1 to 5' })
  }

  const product = await Product.findByPk(productId)
  if (!product) return res.status(404).json({ message: 'Product not found' })

  const already = await Review.findOne({ where: { productId, userId: req.user.id } })
  if (already) return res.status(409).json({ message: 'You already reviewed this product' })

  // Only verified buyers may review.
  const bought = await OrderItem.findOne({
    where: { productId },
    include: [
      {
        model: Order,
        as: 'order',
        required: true,
        where: { userId: req.user.id, status: BOUGHT_STATUSES },
      },
    ],
  })
  if (!bought) {
    return res.status(403).json({ message: 'You can only review products you have bought' })
  }

  const created = await sequelize.transaction(async t => {
    const review = await Review.create(
      { productId, userId: req.user.id, rating, comment: stripTags(req.body.comment, 2000) },
      { transaction: t },
    )
    await refreshRating(productId, t)
    return review
  })

  // Send it back with the author attached so the interface can render it
  // immediately without a second request.
  const withUser = await Review.findByPk(created.id, {
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
  })

  res.status(201).json(withUser)
})

// PUT /api/reviews/:id  - author or admin
export const updateReview = asyncHandler(async (req, res) => {
  const review = await Review.findByPk(req.params.id)
  if (!review) return res.status(404).json({ message: 'Review not found' })
  if (review.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Not your review' })
  }

  if (req.body.rating !== undefined) {
    const rating = validRating(req.body.rating)
    if (rating === null) {
      return res.status(400).json({ message: 'Rating must be a whole number from 1 to 5' })
    }
    review.rating = rating
  }
  if (req.body.comment !== undefined) review.comment = stripTags(req.body.comment, 2000)

  await sequelize.transaction(async t => {
    await review.save({ transaction: t })
    await refreshRating(review.productId, t)
  })

  res.json(review)
})

// DELETE /api/reviews/:id  - author or admin
export const deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findByPk(req.params.id)
  if (!review) return res.status(404).json({ message: 'Review not found' })
  if (review.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Not your review' })
  }

  const productId = review.productId
  await sequelize.transaction(async t => {
    await review.destroy({ transaction: t })
    await refreshRating(productId, t)
  })

  res.json({ message: 'Review deleted' })
})
