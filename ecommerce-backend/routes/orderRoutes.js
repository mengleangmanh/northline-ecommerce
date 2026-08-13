import { Router } from 'express'
import {
  createOrder,
  getMyOrders,
  getOrderByNumber,
  cancelOrder,
  getAllOrders,
  updateOrderStatus,
  getStats,
} from '../controllers/orderController.js'
import { protect } from '../middleware/authMiddleware.js'
import { admin } from '../middleware/adminMiddleware.js'

const router = Router()

router.use(protect)

// Static paths must be declared before '/:number', otherwise Express would
// treat "mine" as an order number.
router.get('/mine', getMyOrders)
router.get('/stats/summary', admin, getStats)

router.post('/', createOrder)
router.get('/', admin, getAllOrders)

router.get('/:number', getOrderByNumber)
router.put('/:number/cancel', cancelOrder)
router.put('/:number/status', admin, updateOrderStatus)

export default router
