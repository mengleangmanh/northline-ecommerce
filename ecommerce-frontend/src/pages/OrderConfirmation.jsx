import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as orderService from "../services/orderService.js";
import Loader from "../components/Loader.jsx";
import { money } from "../components/ProductCard.jsx";

export const STATUS_COLOR = {
  PENDING: "badge-orange",
  PAID: "badge-blue",
  PROCESSING: "badge-blue",
  SHIPPED: "badge-blue",
  DELIVERED: "badge-green",
  CANCELLED: "badge-red",
};

// This component serves two routes:
//   /order/:number  a single order, shown right after checkout
//   /orders         the customer's own order history
export default function OrderConfirmation({ list = false }) {
  const { number } = useParams();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    const request = list
      ? orderService.getMyOrders()
      : orderService.getOrder(number).then((o) => [o]);

    request
      .then(setOrders)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [list, number]);

  async function cancel(orderNumber) {
    try {
      const updated = await orderService.cancelOrder(orderNumber);
      setOrders((list_) =>
        list_.map((o) =>
          o.number === updated.number ? { ...o, status: updated.status } : o,
        ),
      );
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <Loader full label="Loading orders..." />;
  if (error)
    return (
      <div className="container section">
        <div className="note note-red">{error}</div>
      </div>
    );

  if (list && orders.length === 0) {
    return (
      <div className="container section">
        <div className="empty">
          <h1>No orders yet</h1>
          <p className="muted">When you place an order it will appear here.</p>
          <Link to="/products" className="btn">
            Browse products
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container section">
      {!list && (
        <div className="confirm-head">
          <span className="tick" aria-hidden="true">
            ✓
          </span>
          <h1>Thank you, your order is in</h1>
          <p className="muted">
            A confirmation has been sent to {orders[0]?.email}.
          </p>
        </div>
      )}

      {list && <h1>My orders</h1>}

      {orders.map((order) => (
        <article className="order-card" key={order.id}>
          <header className="order-head">
            <div>
              <strong>{order.number}</strong>
              <span className="muted-xs">
                {" "}
                placed {new Date(order.createdAt).toLocaleDateString()}
              </span>
            </div>
            <span
              className={`badge ${STATUS_COLOR[order.status] || "badge-grey"}`}
            >
              {order.status}
            </span>
          </header>

          <ul className="order-items">
            {order.items?.map((item) => (
              <li key={item.id}>
                {item.image ? (
                  <img src={item.image} alt="" />
                ) : (
                  <div className="cart-thumb-empty" />
                )}
                <span className="order-item-name">
                  {item.nameSnapshot}
                  <span className="muted-xxs"> x{item.quantity}</span>
                </span>
                <span>{money(item.priceCents * item.quantity)}</span>
              </li>
            ))}
          </ul>

          <div className="order-foot">
            <div className="order-address">
              <span className="muted-xs">Shipping to</span>
              <span>
                {order.fullName}, {order.address}, {order.city}{" "}
                {order.postalCode}, {order.country}
              </span>
            </div>

            <dl className="order-totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{money(order.subtotalCents)}</dd>
              </div>
              <div>
                <dt>Shipping</dt>
                <dd>
                  {order.shippingCents === 0
                    ? "Free"
                    : money(order.shippingCents)}
                </dd>
              </div>
              <div>
                <dt>Tax</dt>
                <dd>{money(order.taxCents)}</dd>
              </div>
              <div className="total">
                <dt>Total</dt>
                <dd>{money(order.totalCents)}</dd>
              </div>
            </dl>
          </div>

          {["PENDING", "PAID", "PROCESSING"].includes(order.status) && (
            <button
              type="button"
              className="link-danger"
              onClick={() => cancel(order.number)}
            >
              Cancel this order
            </button>
          )}
        </article>
      ))}

      <div className="confirm-actions">
        <Link to="/products" className="btn">
          Keep shopping
        </Link>
        {!list && (
          <Link to="/orders" className="btn btn-ghost">
            See all my orders
          </Link>
        )}
      </div>
    </div>
  );
}
