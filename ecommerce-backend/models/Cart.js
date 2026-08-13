import { DataTypes } from 'sequelize'
import { sequelize } from '../config/db.js'
import User from './User.js'
import Product from './Product.js'

// One open cart per user.
const Cart = sequelize.define(
  'Cart',
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  },
  { tableName: 'carts' },
)

export const CartItem = sequelize.define(
  'CartItem',
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      validate: { min: 1 },
    },
  },
  {
    tableName: 'cart_items',
    // The same product can only appear once per cart.
    indexes: [{ unique: true, fields: ['cart_id', 'product_id'] }],
  },
)

User.hasOne(Cart, { foreignKey: { name: 'userId', allowNull: false }, as: 'cart', onDelete: 'CASCADE' })
Cart.belongsTo(User, { foreignKey: { name: 'userId', allowNull: false }, as: 'user' })

Cart.hasMany(CartItem, { foreignKey: { name: 'cartId', allowNull: false }, as: 'items', onDelete: 'CASCADE' })
CartItem.belongsTo(Cart, { foreignKey: { name: 'cartId', allowNull: false }, as: 'cart' })

// If a product is deleted, the rows sitting in people's carts go with it.
Product.hasMany(CartItem, { foreignKey: { name: 'productId', allowNull: false }, as: 'cartItems', onDelete: 'CASCADE' })
CartItem.belongsTo(Product, { foreignKey: { name: 'productId', allowNull: false }, as: 'product' })

export default Cart
