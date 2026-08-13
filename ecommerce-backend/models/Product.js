import { DataTypes } from 'sequelize'
import { sequelize } from '../config/db.js'
import Category from './Category.js'

const Product = sequelize.define(
  'Product',
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(180), allowNull: false },
    slug: { type: DataTypes.STRING(200), allowNull: false, unique: true },
    description: { type: DataTypes.TEXT },
    // Money is stored as an integer number of cents. Never use FLOAT for money.
    priceCents: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    stock: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    image: { type: DataTypes.STRING(255) },
    brand: { type: DataTypes.STRING(120) },
    published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    ratingAvg: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    ratingCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  {
    tableName: 'products',
    indexes: [{ fields: ['category_id', 'published'] }],
  },
)

Category.hasMany(Product, { foreignKey: { name: 'categoryId', allowNull: false }, as: 'products' })
Product.belongsTo(Category, { foreignKey: { name: 'categoryId', allowNull: false }, as: 'category' })

export default Product
