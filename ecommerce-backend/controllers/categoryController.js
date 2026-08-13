import Category from '../models/Category.js'
import Product from '../models/Product.js'
import { uniqueSlug } from '../utils/slugify.js'
import { asyncHandler } from '../middleware/errorMiddleware.js'

// GET /api/categories
export const getCategories = asyncHandler(async (_req, res) => {
  const categories = await Category.findAll({ order: [['name', 'ASC']] })
  res.json(categories)
})

// GET /api/categories/:slug
export const getCategoryBySlug = asyncHandler(async (req, res) => {
  const category = await Category.findOne({
    where: { slug: req.params.slug },
    include: [
      { model: Product, as: 'products', where: { published: true }, required: false },
    ],
  })
  if (!category) return res.status(404).json({ message: 'Category not found' })
  res.json(category)
})

// POST /api/categories  (admin)
export const createCategory = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim()
  if (!name) return res.status(400).json({ message: 'Name is required' })

  const duplicate = await Category.findOne({ where: { name } })
  if (duplicate) return res.status(409).json({ message: 'A category with that name already exists' })

  const category = await Category.create({
    name,
    description: req.body.description,
    slug: await uniqueSlug(Category, name),
  })
  res.status(201).json(category)
})

// PUT /api/categories/:id  (admin)
export const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findByPk(req.params.id)
  if (!category) return res.status(404).json({ message: 'Category not found' })

  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim()
    if (!name) return res.status(400).json({ message: 'Name cannot be empty' })
    category.name = name
    category.slug = await uniqueSlug(Category, name, category.id)
  }
  if (req.body.description !== undefined) category.description = req.body.description

  await category.save()
  res.json(category)
})

// DELETE /api/categories/:id  (admin)
export const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findByPk(req.params.id)
  if (!category) return res.status(404).json({ message: 'Category not found' })

  const count = await Product.count({ where: { categoryId: category.id } })
  if (count > 0) {
    return res.status(409).json({
      message: `${count} product(s) still use this category. Move them first.`,
    })
  }

  await category.destroy()
  res.json({ message: 'Category deleted' })
})
