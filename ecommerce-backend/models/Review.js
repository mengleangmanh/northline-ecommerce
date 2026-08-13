import { DataTypes } from 'sequelize'
import { sequelize } from '../config/db.js'
import User from './User.js'
import Product from './Product.js'

const Review = sequelize.define(
  'Review',
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1, max: 5 },
    },
    comment: { type: DataTypes.TEXT },
  },
  {
    tableName: 'reviews',
    // One review per user per product.
    indexes: [{ unique: true, fields: ['product_id', 'user_id'] }],
  },
)

Product.hasMany(Review, { foreignKey: { name: 'productId', allowNull: false }, as: 'reviews', onDelete: 'CASCADE' })
Review.belongsTo(Product, { foreignKey: { name: 'productId', allowNull: false }, as: 'product' })

User.hasMany(Review, { foreignKey: { name: 'userId', allowNull: false }, as: 'reviews', onDelete: 'CASCADE' })
Review.belongsTo(User, { foreignKey: { name: 'userId', allowNull: false }, as: 'user' })

export default Review
