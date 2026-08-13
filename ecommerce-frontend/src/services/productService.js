import api from './api.js'

// params: { search, category, min, max, sort, page, limit, inStock }
export const getProducts = (params = {}) =>
  api.get('/products', { params }).then(r => r.data)

export const getProduct = slug => api.get(`/products/${slug}`).then(r => r.data)

export const createProduct = payload => api.post('/products', payload).then(r => r.data)

export const updateProduct = (id, payload) => api.put(`/products/${id}`, payload).then(r => r.data)

export const deleteProduct = id => api.delete(`/products/${id}`).then(r => r.data)

export const getCategories = () => api.get('/categories').then(r => r.data)

export const getReviews = productId =>
  api.get(`/reviews/product/${productId}`).then(r => r.data)

export const createReview = (productId, payload) =>
  api.post(`/reviews/product/${productId}`, payload).then(r => r.data)

export const deleteReview = id => api.delete(`/reviews/${id}`).then(r => r.data)

export default {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategories,
  getReviews,
  createReview,
  deleteReview,
}
