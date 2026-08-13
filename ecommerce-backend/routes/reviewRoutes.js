import { Router } from 'express'
import {
  getProductReviews,
  createReview,
  updateReview,
  deleteReview,
} from '../controllers/reviewController.js'
import { protect } from '../middleware/authMiddleware.js'

const router = Router()

// Public
router.get('/product/:productId', getProductReviews)

// Private
router.post('/product/:productId', protect, createReview)
router.put('/:id', protect, updateReview)
router.delete('/:id', protect, deleteReview)

export default router
