import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as productService from '../services/productService.js'
import ProductCard from '../components/ProductCard.jsx'
import { Skeleton } from '../components/Loader.jsx'

export default function Products() {
  // The URL is the single source of truth for filters, so a filtered page can
  // be bookmarked, shared and survives a refresh.
  const [params, setParams] = useSearchParams()

  const [data, setData] = useState({ products: [], page: 1, pages: 1, total: 0 })
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const query = Object.fromEntries(params.entries())

  useEffect(() => {
    productService.getCategories().then(setCategories).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    productService
      .getProducts({ limit: 12, ...query })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
    // params.toString() changes whenever any filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()])

  function setParam(key, value) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page') // any filter change goes back to page one
    setParams(next)
  }

  function goToPage(page) {
    const next = new URLSearchParams(params)
    next.set('page', String(page))
    setParams(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="container section">
      <div className="section-head">
        <h1>{query.search ? `Results for "${query.search}"` : 'All products'}</h1>
        <span className="muted">{data.total} items</span>
      </div>

      <div className="filters">
        <select value={query.category || ''} onChange={e => setParam('category', e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.map(c => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>

        <select value={query.sort || 'newest'} onChange={e => setParam('sort', e.target.value)} aria-label="Sort by">
          <option value="newest">Newest</option>
          <option value="priceAsc">Price: low to high</option>
          <option value="priceDesc">Price: high to low</option>
          <option value="rating">Best rated</option>
          <option value="name">Name A to Z</option>
        </select>

        <input
          type="number"
          placeholder="Min $"
          value={query.min || ''}
          onChange={e => setParam('min', e.target.value)}
          aria-label="Minimum price"
        />
        <input
          type="number"
          placeholder="Max $"
          value={query.max || ''}
          onChange={e => setParam('max', e.target.value)}
          aria-label="Maximum price"
        />

        <label className="check">
          <input
            type="checkbox"
            checked={query.inStock === 'true'}
            onChange={e => setParam('inStock', e.target.checked ? 'true' : '')}
          />
          In stock only
        </label>

        {Object.keys(query).length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({})}>
            Clear filters
          </button>
        )}
      </div>

      {error && <div className="note note-red">{error}</div>}

      {loading ? (
        <Skeleton count={12} />
      ) : data.products.length === 0 ? (
        <div className="empty">
          <h3>Nothing matched those filters</h3>
          <p className="muted">Try a wider price range or clear the filters.</p>
        </div>
      ) : (
        <>
          <div className="grid">
            {data.products.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>

          {data.pages > 1 && (
            <div className="pager">
              <button type="button" disabled={data.page <= 1} onClick={() => goToPage(data.page - 1)}>
                Previous
              </button>
              <span className="muted">
                Page {data.page} of {data.pages}
              </span>
              <button type="button" disabled={data.page >= data.pages} onClick={() => goToPage(data.page + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
