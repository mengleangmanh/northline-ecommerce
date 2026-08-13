import { Route, Routes } from 'react-router-dom'

import Navbar from './components/Navbar.jsx'
import Footer from './components/Footer.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'

import Home from './pages/Home.jsx'
import Products from './pages/Products.jsx'
import ProductDetail from './pages/ProductDetail.jsx'
import Cart from './pages/Cart.jsx'
import Checkout from './pages/Checkout.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import AuthCallback from './pages/AuthCallback.jsx'
import OrderConfirmation from './pages/OrderConfirmation.jsx'

import AdminDashboard, { AdminLayout } from './pages/admin/AdminDashboard.jsx'
import AdminProducts from './pages/admin/AdminProducts.jsx'
import AdminOrders from './pages/admin/AdminOrders.jsx'

function NotFound() {
  return (
    <div className="container section">
      <div className="empty">
        <h1>Page not found</h1>
        <p className="muted">That link does not lead anywhere.</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <div className="app">
      <Navbar />

      <div className="app-body">
        <Routes>
          {/* Public */}
          <Route path="/" element={<Home />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:slug" element={<ProductDetail />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Where Google and Facebook drop the user after the API has signed
              them in. Public by necessity - they are not authenticated in this
              tab until this page has run. */}
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* Signed-in customers */}
          <Route element={<ProtectedRoute />}>
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/orders" element={<OrderConfirmation list />} />
            <Route path="/order/:number" element={<OrderConfirmation />} />
          </Route>

          {/* Admin only. The API checks the role again on every request. */}
          <Route element={<ProtectedRoute adminOnly />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="products" element={<AdminProducts />} />
              <Route path="orders" element={<AdminOrders />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>

      <Footer />
    </div>
  )
}
