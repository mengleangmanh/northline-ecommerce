import { Link } from 'react-router-dom'
import { useCart } from '../context/CartContext.jsx'
import { money } from './ProductCard.jsx'

export default function CartItem({ line }) {
  const { update, remove } = useCart()
  const product = line.product
  const max = product?.stock ?? 99

  return (
    <div className="cart-line">
      <Link to={`/products/${product.slug}`} className="cart-thumb">
        {product.image ? <img src={product.image} alt={product.name} /> : <div className="cart-thumb-empty" />}
      </Link>

      <div className="cart-info">
        <Link to={`/products/${product.slug}`} className="cart-name">
          {product.name}
        </Link>
        <span className="muted-xs">{money(product.priceCents)} each</span>
        {line.inStock === false && (
          <span className="note note-red">Only {product.stock} left, please lower the quantity</span>
        )}
      </div>

      <div className="qty">
        <button
          type="button"
          aria-label="Decrease quantity"
          onClick={() => update(line.id, line.quantity - 1)}
        >
          −
        </button>
        <input
          type="number"
          min="1"
          max={max}
          value={line.quantity}
          onChange={e => update(line.id, Math.max(1, Math.min(max, Number(e.target.value) || 1)))}
          aria-label={`Quantity of ${product.name}`}
        />
        <button
          type="button"
          aria-label="Increase quantity"
          disabled={line.quantity >= max}
          onClick={() => update(line.id, line.quantity + 1)}
        >
          +
        </button>
      </div>

      <strong className="cart-total">{money(line.lineTotalCents)}</strong>

      <button type="button" className="link-danger" onClick={() => remove(line.id)}>
        Remove
      </button>
    </div>
  )
}
