import { Router } from 'express'
import {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  mergeCart,
} from '../controllers/cartController.js'
import { protect } from '../middleware/authMiddleware.js'

const router = Router()

// Every cart route is private. Guests keep their cart in localStorage on the
// front end and merge it into the server cart when they sign in.
router.use(protect)

router.get('/', getCart)
router.post('/', addToCart)
router.post('/merge', mergeCart)
router.delete('/', clearCart)
router.put('/:itemId', updateCartItem)
router.delete('/:itemId', removeCartItem)

export default router
