import { useEffect, useState } from 'react'
import * as productService from '../../services/productService.js'
import Loader from '../../components/Loader.jsx'
import { money } from '../../components/ProductCard.jsx'

const BLANK = {
  name: '',
  description: '',
  priceCents: 0,
  stock: 0,
  brand: '',
  image: '',
  categoryId: '',
  published: true,
}

export default function AdminProducts() {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [editing, setEditing] = useState(null) // null = form closed
  const [form, setForm] = useState(BLANK)

  async function load() {
    setLoading(true)
    try {
      const [list, cats] = await Promise.all([
        productService.getProducts({ limit: 50 }),
        productService.getCategories(),
      ])
      setProducts(list.products)
      setCategories(cats)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function openNew() {
    setForm({ ...BLANK, categoryId: categories[0]?.id || '' })
    setEditing('new')
  }

  function openEdit(p) {
    setForm({
      name: p.name,
      description: p.description || '',
      priceCents: p.priceCents,
      stock: p.stock,
      brand: p.brand || '',
      image: p.image || '',
      categoryId: p.categoryId,
      published: p.published,
    })
    setEditing(p.id)
  }

  function change(e) {
    const { name, value, type, checked } = e.target
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  async function save(e) {
    e.preventDefault()
    setError(null)
    try {
      const payload = {
        ...form,
        priceCents: Math.round(Number(form.priceCents)),
        stock: Number(form.stock),
      }
      if (editing === 'new') await productService.createProduct(payload)
      else await productService.updateProduct(editing, payload)

      setEditing(null)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(p) {
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return
    try {
      await productService.deleteProduct(p.id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <Loader label="Loading products..." />

  return (
    <>
      <div className="section-head">
        <h1>Products</h1>
        <button type="button" className="btn btn-sm" onClick={openNew}>
          New product
        </button>
      </div>

      {error && <div className="note note-red">{error}</div>}

      {editing && (
        <form className="panel admin-form" onSubmit={save}>
          <h2>{editing === 'new' ? 'New product' : 'Edit product'}</h2>

          <div className="two-col">
            <label>
              Name
              <input name="name" value={form.name} onChange={change} required />
            </label>
            <label>
              Brand
              <input name="brand" value={form.brand} onChange={change} />
            </label>
          </div>

          <label>
            Description
            <textarea name="description" rows={3} value={form.description} onChange={change} />
          </label>

          <div className="two-col">
            <label>
              Price in cents
              <input type="number" name="priceCents" value={form.priceCents} onChange={change} required min="0" />
              <span className="muted-xs">{money(Number(form.priceCents) || 0)}</span>
            </label>
            <label>
              Stock
              <input type="number" name="stock" value={form.stock} onChange={change} required min="0" />
            </label>
          </div>

          <div className="two-col">
            <label>
              Category
              <select name="categoryId" value={form.categoryId} onChange={change} required>
                <option value="">Choose one</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Image URL
              <input name="image" value={form.image} onChange={change} placeholder="https://..." />
            </label>
          </div>

          <label className="check">
            <input type="checkbox" name="published" checked={form.published} onChange={change} />
            Published and visible to customers
          </label>

          <div className="form-actions">
            <button type="submit" className="btn">
              Save
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="panel flush">
        <table className="dtable">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Price</th>
              <th>Stock</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map(p => (
              <tr key={p.id}>
                <td>
                  <strong>{p.name}</strong>
                  <span className="muted-xs block">{p.slug}</span>
                </td>
                <td>{p.category?.name || '—'}</td>
                <td>{money(p.priceCents)}</td>
                <td>
                  <span className={p.stock === 0 ? 'badge badge-red' : p.stock <= 5 ? 'badge badge-orange' : ''}>
                    {p.stock}
                  </span>
                </td>
                <td>{p.published ? 'Live' : 'Draft'}</td>
                <td className="row-actions">
                  <button type="button" onClick={() => openEdit(p)}>
                    Edit
                  </button>
                  <button type="button" className="link-danger" onClick={() => remove(p)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
