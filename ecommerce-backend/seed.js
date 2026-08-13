import 'dotenv/config'
import { connectDB, sequelize } from './config/db.js'

import User from './models/User.js'
import Category from './models/Category.js'
import Product from './models/Product.js'
import Review from './models/Review.js'
import Cart, { CartItem } from './models/Cart.js'
import Order, { OrderItem } from './models/Order.js'

// Run with:  npm run seed          keeps the tables, refills them
//            npm run seed:fresh    drops every table first
const FRESH = process.argv.includes('--fresh')

const categories = [
  { name: 'Audio', slug: 'audio', description: 'Headphones, speakers and everything that makes a sound' },
  { name: 'Desk', slug: 'desk', description: 'Keyboards, lamps and desk accessories' },
  { name: 'Home', slug: 'home', description: 'Small things that make a room feel finished' },
  { name: 'Apparel', slug: 'apparel', description: 'Everyday clothing and footwear' },
  { name: 'Bags', slug: 'bags', description: 'Backpacks, wallets and carry goods' },
]

// Prices are integer cents. 12900 means $129.00.
const products = [
  { name: 'Aera Wireless Headphones', slug: 'aera-wireless-headphones', category: 'audio', priceCents: 12900, stock: 24, brand: 'Aera', description: 'Over-ear wireless headphones with active noise cancelling and 30 hours of battery.' },
  { name: 'Loop Mechanical Keyboard', slug: 'loop-mechanical-keyboard', category: 'desk', priceCents: 8900, stock: 15, brand: 'Loop', description: 'A compact 75% mechanical keyboard with hot-swappable switches.' },
  { name: 'Nimbus Desk Lamp', slug: 'nimbus-desk-lamp', category: 'desk', priceCents: 5400, stock: 30, brand: 'Nimbus', description: 'Warm dimmable LED lamp with a weighted base and a USB-C port.' },
  { name: 'Terra Ceramic Mug', slug: 'terra-ceramic-mug', category: 'home', priceCents: 1800, stock: 80, brand: 'Terra', description: 'Hand-glazed stoneware mug, 350ml, dishwasher safe.' },
  { name: 'Pace Running Shoes', slug: 'pace-running-shoes', category: 'apparel', priceCents: 11000, stock: 12, brand: 'Pace', description: 'Lightweight daily trainers with a breathable knit upper.' },
  { name: 'Field Canvas Backpack', slug: 'field-canvas-backpack', category: 'bags', priceCents: 7600, stock: 18, brand: 'Field', description: 'Waxed canvas backpack with a padded 16 inch laptop sleeve.' },
  { name: 'Halo Smart Speaker', slug: 'halo-smart-speaker', category: 'audio', priceCents: 9900, stock: 9, brand: 'Halo', description: 'Room-filling smart speaker with voice control and multi-room audio.' },
  { name: 'Drift Linen Shirt', slug: 'drift-linen-shirt', category: 'apparel', priceCents: 6200, stock: 22, brand: 'Drift', description: 'Relaxed fit shirt in washed European linen.' },
  { name: 'Stack Notebook Set', slug: 'stack-notebook-set', category: 'desk', priceCents: 2400, stock: 60, brand: 'Stack', description: 'Three softcover notebooks, dotted, 90gsm paper.' },
  { name: 'Orbit Wall Clock', slug: 'orbit-wall-clock', category: 'home', priceCents: 4300, stock: 14, brand: 'Orbit', description: 'Silent sweep wall clock with an oak frame.' },
  { name: 'Sable Leather Wallet', slug: 'sable-leather-wallet', category: 'bags', priceCents: 3900, stock: 27, brand: 'Sable', description: 'Slim bifold in full grain leather that ages well.' },
  { name: 'Pulse Fitness Band', slug: 'pulse-fitness-band', category: 'audio', priceCents: 5900, stock: 0, brand: 'Pulse', description: 'Coming soon. Heart rate, sleep tracking and a seven day battery.', published: false },
]

async function run() {
  await connectDB()

  if (FRESH) {
    console.log('Dropping and recreating every table...')
    await sequelize.sync({ force: true })
  } else {
    await sequelize.sync()
    console.log('Clearing existing rows...')
    // Children first, parents last, or the foreign keys complain.
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0')
    for (const model of [OrderItem, Order, CartItem, Cart, Review, Product, Category, User]) {
      await model.destroy({ where: {}, truncate: true, force: true })
    }
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1')
  }

  // Users. Passwords are hashed by the model hook, so pass them in plain here.
  const admin = await User.create({
    name: 'Store Admin',
    email: 'admin@northline.dev',
    password: 'steady-anchor-7715',
    role: 'admin',
  })

  const demo = await User.create({
    name: 'Meng Leang',
    email: 'demo@northline.dev',
    password: 'quiet-river-8842',
    role: 'customer',
    phone: '+855 12 345 678',
    address: '14 Street 240',
    city: 'Phnom Penh',
    country: 'Cambodia',
  })

  await Cart.create({ userId: admin.id })
  const demoCart = await Cart.create({ userId: demo.id })

  // Categories
  const createdCategories = await Category.bulkCreate(categories)
  const bySlug = Object.fromEntries(createdCategories.map(c => [c.slug, c]))

  // Products
  const createdProducts = await Product.bulkCreate(
    products.map(p => ({
      name: p.name,
      slug: p.slug,
      description: p.description,
      priceCents: p.priceCents,
      stock: p.stock,
      brand: p.brand,
      published: p.published !== false,
      categoryId: bySlug[p.category].id,
      image: `https://picsum.photos/seed/${p.slug}/800/800`,
    })),
  )
  const productBySlug = Object.fromEntries(createdProducts.map(p => [p.slug, p]))

  // A couple of items already sitting in the demo customer's cart
  await CartItem.bulkCreate([
    { cartId: demoCart.id, productId: productBySlug['terra-ceramic-mug'].id, quantity: 2 },
    { cartId: demoCart.id, productId: productBySlug['nimbus-desk-lamp'].id, quantity: 1 },
  ])

  // One delivered order so the admin dashboard and the reviews are not empty
  const items = [
    { product: productBySlug['aera-wireless-headphones'], quantity: 1 },
    { product: productBySlug['stack-notebook-set'], quantity: 2 },
  ]
  const subtotalCents = items.reduce((sum, i) => sum + i.product.priceCents * i.quantity, 0)
  const shippingCents = subtotalCents >= 10000 ? 0 : 500
  const taxCents = Math.round(subtotalCents * 0.1)

  const order = await Order.create({
    number: 'NL-10000001',
    userId: demo.id,
    status: 'DELIVERED',
    email: demo.email,
    fullName: demo.name,
    phone: demo.phone,
    address: demo.address,
    city: demo.city,
    postalCode: '12000',
    country: demo.country,
    shipMethod: 'standard',
    paymentMethod: 'cod',
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents: subtotalCents + shippingCents + taxCents,
    paidAt: new Date(),
  })

  await OrderItem.bulkCreate(
    items.map(i => ({
      orderId: order.id,
      productId: i.product.id,
      nameSnapshot: i.product.name,
      priceCents: i.product.priceCents,
      quantity: i.quantity,
      image: i.product.image,
    })),
  )

  // A review is only allowed on something the user bought, which the order above satisfies.
  await Review.create({
    productId: productBySlug['aera-wireless-headphones'].id,
    userId: demo.id,
    rating: 5,
    comment: 'Battery really does last a full week of commuting. Very happy with these.',
  })

  await Product.update(
    { ratingAvg: 5, ratingCount: 1 },
    { where: { id: productBySlug['aera-wireless-headphones'].id } },
  )

  console.log('')
  console.log('Seed complete.')
  console.log(`  ${createdCategories.length} categories`)
  console.log(`  ${createdProducts.length} products`)
  console.log('  2 users, 1 order, 1 review')
  console.log('')
  console.log('Sign in with:')
  console.log('  admin@northline.dev / steady-anchor-7715   (admin)')
  console.log('  demo@northline.dev  / quiet-river-8842    (customer)')
  console.log('')

  await sequelize.close()
}

run().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
