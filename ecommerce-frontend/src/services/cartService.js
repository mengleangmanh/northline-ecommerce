import api from './api.js'

export const getCart = () => api.get('/cart').then(r => r.data)

export const addToCart = (productId, quantity = 1) =>
  api.post('/cart', { productId, quantity }).then(r => r.data)

export const updateCartItem = (itemId, quantity) =>
  api.put(`/cart/${itemId}`, { quantity }).then(r => r.data)

export const removeCartItem = itemId => api.delete(`/cart/${itemId}`).then(r => r.data)

export const clearCart = () => api.delete('/cart').then(r => r.data)

// Called once, right after login, to push the guest cart up to the server.
export const mergeCart = items => api.post('/cart/merge', { items }).then(r => r.data)

export default { getCart, addToCart, updateCartItem, removeCartItem, clearCart, mergeCart }
