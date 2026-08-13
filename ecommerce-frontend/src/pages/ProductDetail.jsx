import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as productService from '../services/productService.js'
import { useCart } from '../context/CartContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import Loader from '../components/Loader.jsx'
import { money } from '../components/ProductCard.jsx'

export default function ProductDetail() {
  const { slug } = useParams()
  const { add, error: cartError, clearError } = useCart()
  const { isAuthenticated, user } = useAuth()

  const [product, setProduct] = useState(null)
  const [quantity, setQuantity] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [added, setAdded] = useState(false)

  const [review, setReview] = useState({ rating: 5, comment: '' })
  const [reviewError, setReviewError] = useState(null)

  useEffect(() => {
    setLoading(true)
    clearError()
    productService
      .getProduct(slug)
      .then(p => {
        setProduct(p)
        setQuantity(1)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  async function addToCart() {
    await add(product, quantity)
    setAdded(true)
    setTimeout(() => setAdded(false), 2500)
  }

  async function submitReview(e) {
    e.preventDefault()
    setReviewError(null)
    try {
      await productService.createReview(product.id, review)
      const fresh = await productService.getProduct(slug)
      setProduct(fresh)
      setReview({ rating: 5, comment: '' })
    } catch (err) {
      setReviewError(err.message)
    }
  }

  if (loading) return <Loader full label="Loading product..." />
  if (error) return <div className="container section"><div className="note note-red">{error}</div></div>
  if (!product) return null

  const out = product.stock < 1
  const alreadyReviewed = product.reviews?.some(r => r.user?.id === user?.id)

  return (
    <div className="container section">
      <nav className="crumbs">
        <Link to="/products">Products</Link>
        {product.category && (
          <>
            <span>/</span>
            <Link to={`/products?category=${product.category.slug}`}>{product.category.name}</Link>
          </>
        )}
        <span>/</span>
        <span className="muted">{product.name}</span>
      </nav>

      <div className="detail">
        <div className="detail-media">
          {product.image ? <img src={product.image} alt={product.name} /> : <div className="card-media-empty" />}
        </div>

        <div className="detail-info">
          <span className="muted-xs">{product.brand}</span>
          <h1>{product.name}</h1>

          {product.ratingCount > 0 && (
            <span className="muted">
              {Number(product.ratingAvg).toFixed(1)} out of 5 from {product.ratingCount} review
              {product.ratingCount === 1 ? '' : 's'}
            </span>
          )}

          <div className="price">{money(product.priceCents)}</div>
          <p>{product.description}</p>

          <div className="stock-line">
            {out ? (
              <span className="badge badge-red">Sold out</span>
            ) : product.stock <= 5 ? (
              <span className="badge badge-orange">Only {product.stock} left</span>
            ) : (
              <span className="badge badge-green">In stock</span>
            )}
          </div>

          {cartError && <div className="note note-red">{cartError}</div>}
          {added && <div className="note note-green">Added to your cart. <Link to="/cart">View cart</Link></div>}

          <div className="buy-row">
            <div className="qty">
              <button type="button" onClick={() => setQuantity(q => Math.max(1, q - 1))} aria-label="Decrease">
                −
              </button>
              <input
                type="number"
                min="1"
                max={product.stock || 1}
                value={quantity}
                onChange={e => setQuantity(Math.max(1, Math.min(product.stock, Number(e.target.value) || 1)))}
                aria-label="Quantity"
              />
              <button
                type="button"
                onClick={() => setQuantity(q => Math.min(product.stock, q + 1))}
                disabled={quantity >= product.stock}
                aria-label="Increase"
              >
                +
              </button>
            </div>

            <button type="button" className="btn" disabled={out} onClick={addToCart}>
              {out ? 'Sold out' : 'Add to cart'}
            </button>
          </div>
        </div>
      </div>

      <section className="section">
        <h2>Reviews</h2>

        {product.reviews?.length ? (
          <ul className="reviews">
            {product.reviews.map(r => (
              <li key={r.id}>
                <div className="review-head">
                  <strong>{r.user?.name || 'Customer'}</strong>
                  <span className="stars">{'★'.repeat(r.rating)}</span>
                  <span className="muted-xs">{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
                <p>{r.comment}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No reviews yet.</p>
        )}

        {!isAuthenticated ? (
          <p className="muted">
            <Link to="/login">Sign in</Link> to leave a review. Only verified buyers can review.
          </p>
        ) : alreadyReviewed ? (
          <p className="muted">You have already reviewed this product.</p>
        ) : (
          <form className="review-form" onSubmit={submitReview}>
            <h3>Write a review</h3>
            {reviewError && <div className="note note-red">{reviewError}</div>}

            <label>
              Rating
              <select
                value={review.rating}
                onChange={e => setReview(r => ({ ...r, rating: Number(e.target.value) }))}
              >
                {[5, 4, 3, 2, 1].map(n => (
                  <option key={n} value={n}>
                    {n} star{n === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Comment
              <textarea
                rows={4}
                value={review.comment}
                onChange={e => setReview(r => ({ ...r, comment: e.target.value }))}
                placeholder="What did you think?"
              />
            </label>

            <button type="submit" className="btn">
              Post review
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
