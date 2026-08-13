import { DataTypes } from 'sequelize'
import { sequelize } from '../config/db.js'
import User from './User.js'
import Product from './Product.js'
import { encryptedField } from '../utils/crypto.js'

export const ORDER_STATUSES = [
  'PENDING',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
]

const Order = sequelize.define(
  'Order',
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    number: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    status: {
      type: DataTypes.ENUM(...ORDER_STATUSES),
      allowNull: false,
      defaultValue: 'PENDING',
    },
    // Contact and shipping, snapshotted at checkout time.
    email: { type: DataTypes.STRING(190), allowNull: false },
    fullName: { type: DataTypes.STRING(120), allowNull: false },
    // Encrypted at rest - see models/User.js for why these columns are wide.
    phone: encryptedField('phone', { length: 255 }),
    address: encryptedField('address', { length: 512, allowNull: false }),
    city: { type: DataTypes.STRING(120), allowNull: false },
    postalCode: encryptedField('postalCode', { length: 255 }),
    country: { type: DataTypes.STRING(80), allowNull: false },
    shipMethod: {
      type: DataTypes.ENUM('standard', 'express'),
      allowNull: false,
      defaultValue: 'standard',
    },
    paymentMethod: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'cod' },
    subtotalCents: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    shippingCents: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    taxCents: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    totalCents: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    paidAt: { type: DataTypes.DATE },
  },
  {
    tableName: 'orders',
    indexes: [{ fields: ['user_id', 'created_at'] }, { fields: ['status'] }],
  },
)

// Line items snapshot the name and price. If the product changes price or is
// deleted later, the order still shows what the customer actually paid.
export const OrderItem = sequelize.define(
  'OrderItem',
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    nameSnapshot: { type: DataTypes.STRING(180), allowNull: false },
    priceCents: { type: DataTypes.INTEGER, allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    image: { type: DataTypes.STRING(255) },
  },
  { tableName: 'order_items' },
)

User.hasMany(Order, { foreignKey: { name: 'userId', allowNull: false }, as: 'orders' })
Order.belongsTo(User, { foreignKey: { name: 'userId', allowNull: false }, as: 'user' })

Order.hasMany(OrderItem, { foreignKey: { name: 'orderId', allowNull: false }, as: 'items', onDelete: 'CASCADE' })
OrderItem.belongsTo(Order, { foreignKey: { name: 'orderId', allowNull: false }, as: 'order' })

// Deleting a product must never destroy order history, so the link is simply
// dropped and the name and price snapshot on the line item carries the order.
Product.hasMany(OrderItem, { foreignKey: { name: 'productId', allowNull: true }, as: 'orderItems', onDelete: 'SET NULL' })
OrderItem.belongsTo(Product, { foreignKey: { name: 'productId', allowNull: true }, as: 'product' })

export default Order
