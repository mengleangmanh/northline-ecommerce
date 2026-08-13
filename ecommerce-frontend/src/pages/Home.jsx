import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as productService from '../services/productService.js'
import ProductCard from '../components/ProductCard.jsx'
import { Skeleton } from '../components/Loader.jsx'

export default function Home() {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      productService.getProducts({ limit: 8, sort: 'newest' }),
      productService.getCategories(),
    ])
      .then(([list, cats]) => {
        setProducts(list.products)
        setCategories(cats)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <div>
            <span className="eyebrow">New season</span>
            <h1>Things worth keeping on your desk</h1>
            <p className="lead">
              A small, carefully picked catalogue. Free shipping on orders over $100.
            </p>
            <div className="hero-actions">
              <Link to="/products" className="btn">
                Shop everything
              </Link>
              <Link to="/products?category=audio" className="btn btn-ghost">
                Browse audio
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="container section">
        <h2>Shop by category</h2>
        <div className="chips">
          {categories.map(c => (
            <Link key={c.id} to={`/products?category=${c.slug}`} className="chip">
              {c.name}
            </Link>
          ))}
        </div>
      </section>

      <section className="container section">
        <div className="section-head">
          <h2>Latest arrivals</h2>
          <Link to="/products">View all</Link>
        </div>

        {error && <div className="note note-red">{error}</div>}
        {loading ? (
          <Skeleton count={8} />
        ) : (
          <div className="grid">
            {products.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

      <section className="container section perks">
        <div className="perk">
          <strong>Free shipping over $100</strong>
          <span className="muted">Standard delivery in three to five days.</span>
        </div>
        <div className="perk">
          <strong>Thirty day returns</strong>
          <span className="muted">Unused and in the original packaging.</span>
        </div>
        <div className="perk">
          <strong>Real support</strong>
          <span className="muted">help@northline.dev, answered by a person.</span>
        </div>
      </section>
    </>
  )
}
