import { Op } from 'sequelize'
import { sequelize } from '../config/db.js'
import Product from '../models/Product.js'
import Category from '../models/Category.js'
import Review from '../models/Review.js'
import User from '../models/User.js'
import { CartItem } from '../models/Cart.js'
import { OrderItem } from '../models/Order.js'
import { uniqueSlug } from '../utils/slugify.js'
import { asyncHandler } from '../middleware/errorMiddleware.js'

// Whitelist of sort options. Never interpolate req.query into SQL.
const SORTS = {
  newest: [['createdAt', 'DESC']],
  oldest: [['createdAt', 'ASC']],
  priceAsc: [['priceCents', 'ASC']],
  priceDesc: [['priceCents', 'DESC']],
  rating: [['ratingAvg', 'DESC']],
  name: [['name', 'ASC']],
}

// Accepts "12", "12.5" or "" and returns cents, or null when not a number.
function toCents(value) {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

const isAdmin = req => Boolean(req.user && req.user.role === 'admin')

// GET /api/products?search=&category=&min=&max=&sort=&page=&limit=&inStock=
export const getProducts = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12))
  const where = {}

  // Admins can see unpublished drafts, customers cannot.
  if (!isAdmin(req)) where.published = true

  const search = String(req.query.search || '').trim()
  if (search) {
    // Search the name, the brand and the description, not just the name.
    where[Op.or] = [
      { name: { [Op.like]: `%${search}%` } },
      { brand: { [Op.like]: `%${search}%` } },
      { description: { [Op.like]: `%${search}%` } },
    ]
  }

  if (req.query.inStock === 'true') where.stock = { [Op.gt]: 0 }

  const min = toCents(req.query.min)
  const max = toCents(req.query.max)
  if (min !== null || max !== null) {
    where.priceCents = {}
    if (min !== null) where.priceCents[Op.gte] = min
    if (max !== null) where.priceCents[Op.lte] = max
  }

  const categoryInclude = {
    model: Category,
    as: 'category',
    attributes: ['id', 'name', 'slug'],
  }
  if (req.query.category) {
    categoryInclude.where = { slug: String(req.query.category) }
    categoryInclude.required = true
  }

  const { rows, count } = await Product.findAndCountAll({
    where,
    include: [categoryInclude],
    order: SORTS[req.query.sort] || SORTS.newest,
    limit,
    offset: (page - 1) * limit,
    distinct: true,
  })

  res.json({
    products: rows,
    page,
    pages: Math.max(1, Math.ceil(count / limit)),
    total: count,
    limit,
  })
})

// GET /api/products/:slug
export const getProductBySlug = asyncHandler(async (req, res) => {
  const product = await Product.findOne({
    where: { slug: req.params.slug },
    include: [
      { model: Category, as: 'category', attributes: ['id', 'name', 'slug'] },
      {
        model: Review,
        as: 'reviews',
        required: false,
        include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
      },
    ],
    order: [[{ model: Review, as: 'reviews' }, 'createdAt', 'DESC']],
  })

  if (!product) return res.status(404).json({ message: 'Product not found' })
  if (!product.published && !isAdmin(req)) {
    return res.status(404).json({ message: 'Product not found' })
  }

  res.json(product)
})

// POST /api/products  (admin)
export const createProduct = asyncHandler(async (req, res) => {
  const { description, image, brand, categoryId, published } = req.body
  const name = String(req.body.name || '').trim()

  if (!name || !categoryId) {
    return res.status(400).json({ message: 'Name and category are required' })
  }

  // Check the category up front so the admin gets a clear 400 instead of a
  // raw foreign key error.
  const category = await Category.findByPk(categoryId)
  if (!category) return res.status(400).json({ message: 'That category does not exist' })

  const priceCents = Math.max(0, Math.round(Number(req.body.priceCents) || 0))
  const stock = Math.max(0, Math.round(Number(req.body.stock) || 0))

  const product = await Product.create({
    name,
    slug: await uniqueSlug(Product, name),
    description,
    priceCents,
    stock,
    image,
    brand,
    categoryId: category.id,
    published: published !== false,
  })

  res.status(201).json(product)
})

// PUT /api/products/:id  (admin)
export const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByPk(req.params.id)
  if (!product) return res.status(404).json({ message: 'Product not found' })

  if (req.body.categoryId !== undefined) {
    const category = await Category.findByPk(req.body.categoryId)
    if (!category) return res.status(400).json({ message: 'That category does not exist' })
    product.categoryId = category.id
  }

  for (const field of ['description', 'image', 'brand', 'published']) {
    if (req.body[field] !== undefined) product[field] = req.body[field]
  }

  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim()
    if (!name) return res.status(400).json({ message: 'Name cannot be empty' })
    product.name = name
    product.slug = await uniqueSlug(Product, name, product.id)
  }

  if (req.body.priceCents !== undefined) {
    const price = Number(req.body.priceCents)
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ message: 'Price must be a positive number of cents' })
    }
    product.priceCents = Math.round(price)
  }

  if (req.body.stock !== undefined) {
    const stock = Number(req.body.stock)
    if (!Number.isFinite(stock) || stock < 0) {
      return res.status(400).json({ message: 'Stock cannot be negative' })
    }
    product.stock = Math.round(stock)
  }

  await product.save()
  res.json(product)
})

// DELETE /api/products/:id  (admin)
// A product can sit in somebody's cart and in old orders. Clean the cart rows
// out and detach the order lines first, otherwise MySQL refuses the delete
// with a foreign key error.
export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByPk(req.params.id)
  if (!product) return res.status(404).json({ message: 'Product not found' })

  await sequelize.transaction(async t => {
    await CartItem.destroy({ where: { productId: product.id }, transaction: t })
    // Order items keep their own name and price snapshot, so history survives.
    await OrderItem.update(
      { productId: null },
      { where: { productId: product.id }, transaction: t },
    )
    await product.destroy({ transaction: t })
  })

  res.json({ message: 'Product deleted' })
})
