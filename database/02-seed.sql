-- ---------------------------------------------------------------------------
-- ecommerce-project - demo data
-- Run 01-schema.sql first, then this file.
--
-- ABOUT THE PASSWORDS
-- The API compares passwords with bcrypt, so the users table must hold a
-- bcrypt hash and not plain text. SQL cannot produce one, so generate the two
-- hashes first, from the backend folder:
--
--   node -e "console.log(require('bcryptjs').hashSync('quiet-river-8842', 12))"
--   node -e "console.log(require('bcryptjs').hashSync('steady-anchor-7715', 12))"
--
-- Paste them into the two SET lines further down - one place, not scattered
-- through the INSERT.
--
-- IF YOU SKIP THIS STEP the two accounts are still created, but bcrypt can
-- never match a malformed hash, so every login attempt fails with "Invalid
-- email or password" and nothing tells you why. The data looks perfectly fine
-- in phpMyAdmin. This is the single most common way to get stuck here.
--
-- EASIER: skip this file entirely and run `npm run seed` in the backend. It
-- inserts exactly the same data and hashes the passwords in Node, so there is
-- nothing to paste and nothing to get wrong. Use `npm run seed:fresh` to wipe
-- first. That is the recommended path.
-- ---------------------------------------------------------------------------

USE `ecommerce`;

-- ---------------------------------------------------------------------------
-- Clear out any existing demo data.
--
-- DELETE, not TRUNCATE. MySQL refuses to truncate a table that a foreign key
-- points at, whatever the data actually is:
--
--   #1701 - Cannot truncate a table referenced in a foreign key constraint
--
-- SET FOREIGN_KEY_CHECKS = 0 is the usual advice and it is not dependable
-- here: phpMyAdmin has an "Enable foreign key checks" box, ticked by default,
-- which switches them straight back on for the session - so the SET above the
-- TRUNCATE silently does nothing.
--
-- DELETE has no such restriction. The order below is child-before-parent, so
-- no row is ever removed while another row still refers to it and the checks
-- can stay on, which is where you want them.
--
-- If you added the later migrations, deleting users also clears recovery_codes
-- (ON DELETE CASCADE) and blanks security_events.user_id (ON DELETE SET NULL)
-- on its own. Those tables are deliberately not named here so this file still
-- runs on a database where 04 and 05 have not been applied yet.
-- ---------------------------------------------------------------------------

DELETE FROM `order_items`;
DELETE FROM `orders`;
DELETE FROM `cart_items`;
DELETE FROM `carts`;
DELETE FROM `reviews`;
DELETE FROM `products`;
DELETE FROM `categories`;
DELETE FROM `users`;

-- DELETE leaves the auto-increment counter where it was, so a re-seed would
-- start products at 13, 25, 37... The rows below set ids explicitly, so reset
-- the counters to keep the two in step.
ALTER TABLE `order_items` AUTO_INCREMENT = 1;
ALTER TABLE `orders`      AUTO_INCREMENT = 1;
ALTER TABLE `cart_items`  AUTO_INCREMENT = 1;
ALTER TABLE `carts`       AUTO_INCREMENT = 1;
ALTER TABLE `reviews`     AUTO_INCREMENT = 1;
ALTER TABLE `products`    AUTO_INCREMENT = 1;
ALTER TABLE `categories`  AUTO_INCREMENT = 1;
ALTER TABLE `users`       AUTO_INCREMENT = 1;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
-- ===========================================================================
-- PASTE THE TWO BCRYPT HASHES HERE. Nothing else in this file needs editing.
-- A real hash is 60 characters and starts with $2a$12$ or $2b$12$.
-- ===========================================================================
SET @demo_hash  = '$2a$12$PASTE_THE_quiet-river-8842_HASH_HERE';
SET @admin_hash = '$2a$12$PASTE_THE_steady-anchor-7715_HASH_HERE';

INSERT INTO `users` (`id`, `name`, `email`, `password`, `role`, `city`, `country`) VALUES
  (1, 'Demo Customer', 'demo@northline.dev',  @demo_hash,  'customer', 'Phnom Penh', 'Cambodia'),
  (2, 'Store Admin',   'admin@northline.dev', @admin_hash, 'admin',    'Phnom Penh', 'Cambodia');

-- Every signed-in user needs a cart row. The API creates one on demand, but
-- seeding them keeps the data tidy.
INSERT INTO `carts` (`id`, `user_id`) VALUES (1, 1), (2, 2);

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
INSERT INTO `categories` (`id`, `name`, `slug`, `description`) VALUES
  (1, 'Audio',   'audio',   'Headphones, speakers and anything that makes a noise'),
  (2, 'Desk',    'desk',    'Keyboards, lamps and desk accessories'),
  (3, 'Home',    'home',    'Small things that make a room better'),
  (4, 'Apparel', 'apparel', 'Everyday clothing and footwear'),
  (5, 'Bags',    'bags',    'Backpacks, wallets and carry');

-- ---------------------------------------------------------------------------
-- Products - prices are in cents, so 12900 is $129.00
-- ---------------------------------------------------------------------------
INSERT INTO `products`
  (`name`, `slug`, `description`, `price_cents`, `stock`, `image`, `brand`, `published`, `category_id`)
VALUES
  ('Aera Wireless Headphones', 'aera-wireless-headphones', 'Over-ear headphones with active noise cancelling and a 30 hour battery.', 12900, 24, 'https://picsum.photos/seed/aera-wireless-headphones/800/800', 'Aera', 1, 1),
  ('Loop Mechanical Keyboard', 'loop-mechanical-keyboard', 'A compact 75% keyboard with hot-swappable switches.', 8900, 15, 'https://picsum.photos/seed/loop-mechanical-keyboard/800/800', 'Loop', 1, 2),
  ('Nimbus Desk Lamp', 'nimbus-desk-lamp', 'Warm dimmable light with a weighted base that does not tip.', 5400, 30, 'https://picsum.photos/seed/nimbus-desk-lamp/800/800', 'Nimbus', 1, 2),
  ('Terra Ceramic Mug', 'terra-ceramic-mug', 'A 350ml stoneware mug, glazed by hand.', 1800, 80, 'https://picsum.photos/seed/terra-ceramic-mug/800/800', 'Terra', 1, 3),
  ('Pace Running Shoes', 'pace-running-shoes', 'Light everyday trainers with a breathable knit upper.', 11000, 12, 'https://picsum.photos/seed/pace-running-shoes/800/800', 'Pace', 1, 4),
  ('Field Canvas Backpack', 'field-canvas-backpack', 'Waxed canvas, 22 litres, fits a 16 inch laptop.', 7600, 18, 'https://picsum.photos/seed/field-canvas-backpack/800/800', 'Field', 1, 5),
  ('Halo Smart Speaker', 'halo-smart-speaker', 'A small room speaker with a surprisingly large sound.', 9900, 9, 'https://picsum.photos/seed/halo-smart-speaker/800/800', 'Halo', 1, 1),
  ('Drift Linen Shirt', 'drift-linen-shirt', 'Washed linen, relaxed fit, wears well in hot weather.', 6200, 22, 'https://picsum.photos/seed/drift-linen-shirt/800/800', 'Drift', 1, 4),
  ('Stack Notebook Set', 'stack-notebook-set', 'Three dot-grid notebooks with lay-flat binding.', 2400, 60, 'https://picsum.photos/seed/stack-notebook-set/800/800', 'Stack', 1, 2),
  ('Orbit Wall Clock', 'orbit-wall-clock', 'A silent sweep clock in brushed aluminium.', 4300, 14, 'https://picsum.photos/seed/orbit-wall-clock/800/800', 'Orbit', 1, 3),
  ('Sable Leather Wallet', 'sable-leather-wallet', 'Full grain leather, six card slots, no bulk.', 3900, 27, 'https://picsum.photos/seed/sable-leather-wallet/800/800', 'Sable', 1, 5),
  ('Pulse Fitness Band', 'pulse-fitness-band', 'Heart rate and sleep tracking. Currently a draft.', 5900, 0, 'https://picsum.photos/seed/pulse-fitness-band/800/800', 'Pulse', 0, 1);

-- ---------------------------------------------------------------------------
-- A sample delivered order for the demo customer, so the admin dashboard and
-- the order history are not empty on first run. It also unlocks the review
-- form, because only people who bought a product may review it.
-- ---------------------------------------------------------------------------
INSERT INTO `orders`
  (`id`, `number`, `status`, `email`, `full_name`, `phone`, `address`, `city`, `postal_code`, `country`,
   `ship_method`, `payment_method`, `subtotal_cents`, `shipping_cents`, `tax_cents`, `total_cents`, `paid_at`, `user_id`)
VALUES
  (1, 'NL-2026DEMO01', 'DELIVERED', 'demo@northline.dev', 'Demo Customer', '012 345 678',
   '17 Street 240', 'Phnom Penh', '12000', 'Cambodia',
   'standard', 'cod', 14700, 0, 1470, 16170, NOW(), 1);

INSERT INTO `order_items`
  (`order_id`, `product_id`, `name_snapshot`, `price_cents`, `quantity`, `image`)
VALUES
  (1, 1, 'Aera Wireless Headphones', 12900, 1, 'https://picsum.photos/seed/aera-wireless-headphones/800/800'),
  (1, 4, 'Terra Ceramic Mug',        1800,  1, 'https://picsum.photos/seed/terra-ceramic-mug/800/800');

-- ---------------------------------------------------------------------------
-- One review, with the product's cached rating updated to match.
-- The API keeps these two in step automatically after this point.
-- ---------------------------------------------------------------------------
INSERT INTO `reviews` (`rating`, `comment`, `product_id`, `user_id`) VALUES
  (5, 'Battery really does last the week. Very comfortable.', 1, 1);

UPDATE `products` p
SET p.`rating_avg` = ROUND((SELECT AVG(r.`rating`) FROM `reviews` r WHERE r.`product_id` = p.`id`), 2),
    p.`rating_count` = (SELECT COUNT(*) FROM `reviews` r WHERE r.`product_id` = p.`id`)
WHERE EXISTS (SELECT 1 FROM `reviews` r WHERE r.`product_id` = p.`id`);

-- Quick check that everything landed.
SELECT
  (SELECT COUNT(*) FROM `users`)      AS users,
  (SELECT COUNT(*) FROM `categories`) AS categories,
  (SELECT COUNT(*) FROM `products`)   AS products,
  (SELECT COUNT(*) FROM `orders`)     AS orders;
