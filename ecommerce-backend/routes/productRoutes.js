import { Router } from 'express'
import {
  getProducts,
  getProductBySlug,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../controllers/productController.js'
import { protect, optionalAuth } from '../middleware/authMiddleware.js'
import { admin } from '../middleware/adminMiddleware.js'

const router = Router()

// Public, but optionalAuth lets admins also see unpublished drafts.
router.get('/', optionalAuth, getProducts)
router.get('/:slug', optionalAuth, getProductBySlug)

// Admin only
router.post('/', protect, admin, createProduct)
router.put('/:id', protect, admin, updateProduct)
router.delete('/:id', protect, admin, deleteProduct)

export default router
