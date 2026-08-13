import { Link } from 'react-router-dom'
import { useCart } from '../context/CartContext.jsx'

export const money = cents => `$${(cents / 100).toFixed(2)}`

function Stars({ value = 0, count = 0 }) {
  const rounded = Math.round(value)
  return (
    <span className="stars" title={`${value.toFixed(1)} out of 5`}>
      {'★★★★★'.slice(0, rounded)}
      <span className="stars-empty">{'★★★★★'.slice(rounded)}</span>
      <span className="muted-xs"> ({count})</span>
    </span>
  )
}

export default function ProductCard({ product }) {
  const { add } = useCart()
  const out = product.stock < 1

  return (
    <article className="card">
      <Link to={`/products/${product.slug}`} className="card-media">
        {product.image ? (
          <img src={product.image} alt={product.name} loading="lazy" />
        ) : (
          <div className="card-media-empty" aria-hidden="true" />
        )}
        {out && <span className="badge badge-red">Sold out</span>}
        {!out && product.stock <= 5 && <span className="badge badge-orange">Only {product.stock} left</span>}
        {!product.published && <span className="badge badge-grey">Draft</span>}
      </Link>

      <div className="card-body">
        <span className="muted-xs">{product.category?.name || product.brand}</span>
        <Link to={`/products/${product.slug}`} className="card-title">
          {product.name}
        </Link>

        {product.ratingCount > 0 && (
          <Stars value={Number(product.ratingAvg)} count={product.ratingCount} />
        )}

        <div className="card-foot">
          <strong>{money(product.priceCents)}</strong>
          <button
            type="button"
            className="btn btn-sm"
            disabled={out}
            onClick={() => add(product, 1)}
          >
            {out ? 'Sold out' : 'Add to cart'}
          </button>
        </div>
      </div>
    </article>
  )
}
