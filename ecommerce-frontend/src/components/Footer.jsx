import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <div className="logo">Northline</div>
          <p className="muted">
            A small demo store built with React, Express, Sequelize and MySQL.
          </p>
        </div>

        <div>
          <h4>Shop</h4>
          <Link to="/products">All products</Link>
          <Link to="/products?category=audio">Audio</Link>
          <Link to="/products?category=desk">Desk</Link>
          <Link to="/products?category=apparel">Apparel</Link>
        </div>

        <div>
          <h4>Account</h4>
          <Link to="/login">Sign in</Link>
          <Link to="/register">Create account</Link>
          <Link to="/cart">Cart</Link>
        </div>

        <div>
          <h4>Help</h4>
          <a href="mailto:help@northline.dev">help@northline.dev</a>
          <span className="muted">Mon to Fri, 9am to 6pm</span>
        </div>
      </div>

      <div className="container footer-bottom">
        <span className="muted">© {new Date().getFullYear()} Northline. Demo project.</span>
        <span className="muted">Prices in USD</span>
      </div>
    </footer>
  )
}
