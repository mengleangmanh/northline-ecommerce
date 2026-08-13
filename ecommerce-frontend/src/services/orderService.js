import api from './api.js'

export const createOrder = payload => api.post('/orders', payload).then(r => r.data)

export const getMyOrders = () => api.get('/orders/mine').then(r => r.data)

export const getOrder = number => api.get(`/orders/${number}`).then(r => r.data)

export const cancelOrder = number => api.put(`/orders/${number}/cancel`).then(r => r.data)

// Admin
export const getAllOrders = (params = {}) => api.get('/orders', { params }).then(r => r.data)

export const updateOrderStatus = (number, status) =>
  api.put(`/orders/${number}/status`, { status }).then(r => r.data)

export const getStats = () => api.get('/orders/stats/summary').then(r => r.data)

export default {
  createOrder,
  getMyOrders,
  getOrder,
  cancelOrder,
  getAllOrders,
  updateOrderStatus,
  getStats,
}
