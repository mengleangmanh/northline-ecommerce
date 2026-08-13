-- ---------------------------------------------------------------------------
-- ecommerce-project - database schema
-- MySQL 5.7+ / MariaDB 10.4+ (the version XAMPP ships)
--
-- Run this in phpMyAdmin (SQL tab) or from the shell:
--   mysql -u root -p < 01-schema.sql
--
-- These tables match the Sequelize models exactly, so you can either create
-- them here by hand or let the API create them with sequelize.sync().
-- If you run this file first, set DB_SYNC_ALTER=false in the backend .env so
-- Sequelize leaves your tables alone.
-- ---------------------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS `ecommerce`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `ecommerce`;

-- Drop in reverse dependency order so re-running the file is safe.
SET FOREIGN_KEY_CHECKS = 0;
-- These two are created by 04 and 05, but they reference `users`, so they
-- have to go first or a re-run leaves foreign keys pointing at a table
-- that no longer exists.
DROP TABLE IF EXISTS `recovery_codes`;
DROP TABLE IF EXISTS `security_events`;
DROP TABLE IF EXISTS `order_items`;
DROP TABLE IF EXISTS `orders`;
DROP TABLE IF EXISTS `cart_items`;
DROP TABLE IF EXISTS `carts`;
DROP TABLE IF EXISTS `reviews`;
DROP TABLE IF EXISTS `products`;
DROP TABLE IF EXISTS `categories`;
DROP TABLE IF EXISTS `users`;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------------
-- users
-- The password column holds a bcrypt hash, never the raw password, and is
-- NULL for people who signed up through Google or Facebook.
-- ---------------------------------------------------------------------------
CREATE TABLE `users` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(120) NOT NULL,
  `email`          VARCHAR(190) NOT NULL,
  -- NULL for accounts created with Google or Facebook. Those people never
  -- chose a password here, so there is nothing to store. Do not be tempted to
  -- put a fake hash in instead: a fake hash is still a real password.
  `password`       VARCHAR(255) DEFAULT NULL,
  `role`           ENUM('customer','admin') NOT NULL DEFAULT 'customer',
  -- Which front door the account came through.
  `provider`       ENUM('local','google','facebook') NOT NULL DEFAULT 'local',
  -- The provider's own stable id for the person. Returning users are matched
  -- on this, never on the email address, because people change their email.
  `provider_id`    VARCHAR(191) DEFAULT NULL,
  `avatar`         VARCHAR(255) DEFAULT NULL,
  -- Google and Facebook only release addresses they have already confirmed,
  -- so social signups start verified and email/password signups do not.
  `email_verified` TINYINT(1) NOT NULL DEFAULT 0,
  `phone`          VARCHAR(40)  DEFAULT NULL,
  `address`        VARCHAR(255) DEFAULT NULL,
  `city`           VARCHAR(120) DEFAULT NULL,
  `country`        VARCHAR(80)  DEFAULT NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  -- Stops one Google account being attached to two rows. Local accounts all
  -- have provider_id = NULL, and MySQL counts every NULL as distinct, so this
  -- never blocks ordinary signups.
  UNIQUE KEY `uq_users_provider_account` (`provider`, `provider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
CREATE TABLE `categories` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(80)  NOT NULL,
  `slug`        VARCHAR(80)  NOT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categories_name` (`name`),
  UNIQUE KEY `uq_categories_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- products
-- Money is an integer number of cents. 12900 means $129.00.
-- rating_avg and rating_count are recalculated by the API after each review.
-- ---------------------------------------------------------------------------
CREATE TABLE `products` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`         VARCHAR(180) NOT NULL,
  `slug`         VARCHAR(200) NOT NULL,
  `description`  TEXT,
  `price_cents`  INT NOT NULL DEFAULT 0,
  `stock`        INT NOT NULL DEFAULT 0,
  `image`        VARCHAR(255) DEFAULT NULL,
  `brand`        VARCHAR(120) DEFAULT NULL,
  `published`    TINYINT(1) NOT NULL DEFAULT 1,
  `rating_avg`   FLOAT NOT NULL DEFAULT 0,
  `rating_count` INT NOT NULL DEFAULT 0,
  `category_id`  INT UNSIGNED NOT NULL,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_products_slug` (`slug`),
  KEY `ix_products_category_published` (`category_id`, `published`),
  KEY `ix_products_price` (`price_cents`),
  CONSTRAINT `fk_products_category`
    FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- reviews - one per customer per product
-- ---------------------------------------------------------------------------
CREATE TABLE `reviews` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rating`     INT NOT NULL,
  `comment`    TEXT,
  `product_id` INT UNSIGNED NOT NULL,
  `user_id`    INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reviews_product_user` (`product_id`, `user_id`),
  KEY `ix_reviews_user` (`user_id`),
  CONSTRAINT `fk_reviews_product`
    FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_reviews_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ck_reviews_rating` CHECK (`rating` BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- carts - exactly one open cart per user
-- ---------------------------------------------------------------------------
CREATE TABLE `carts` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_carts_user` (`user_id`),
  CONSTRAINT `fk_carts_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- cart_items - the unique key is what stops the same product appearing twice
-- ---------------------------------------------------------------------------
CREATE TABLE `cart_items` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `quantity`   INT NOT NULL DEFAULT 1,
  `cart_id`    INT UNSIGNED NOT NULL,
  `product_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cart_items_cart_product` (`cart_id`, `product_id`),
  KEY `ix_cart_items_product` (`product_id`),
  CONSTRAINT `fk_cart_items_cart`
    FOREIGN KEY (`cart_id`) REFERENCES `carts` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cart_items_product`
    FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ck_cart_items_quantity` CHECK (`quantity` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- orders - the delivery details are snapshotted at checkout, so changing your
-- profile later never rewrites an old order.
-- ---------------------------------------------------------------------------
CREATE TABLE `orders` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `number`         VARCHAR(20) NOT NULL,
  `status`         ENUM('PENDING','PAID','PROCESSING','SHIPPED','DELIVERED','CANCELLED')
                   NOT NULL DEFAULT 'PENDING',
  `email`          VARCHAR(190) NOT NULL,
  `full_name`      VARCHAR(120) NOT NULL,
  `phone`          VARCHAR(40)  DEFAULT NULL,
  `address`        VARCHAR(255) NOT NULL,
  `city`           VARCHAR(120) NOT NULL,
  `postal_code`    VARCHAR(30)  DEFAULT NULL,
  `country`        VARCHAR(80)  NOT NULL,
  `ship_method`    ENUM('standard','express') NOT NULL DEFAULT 'standard',
  `payment_method` VARCHAR(40) NOT NULL DEFAULT 'cod',
  `subtotal_cents` INT NOT NULL DEFAULT 0,
  `shipping_cents` INT NOT NULL DEFAULT 0,
  `tax_cents`      INT NOT NULL DEFAULT 0,
  `total_cents`    INT NOT NULL DEFAULT 0,
  `paid_at`        DATETIME DEFAULT NULL,
  `user_id`        INT UNSIGNED NOT NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orders_number` (`number`),
  KEY `ix_orders_user_created` (`user_id`, `created_at`),
  KEY `ix_orders_status` (`status`),
  CONSTRAINT `fk_orders_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- order_items - name_snapshot and price_cents are copies, on purpose.
-- product_id is nullable so deleting a product never destroys history.
-- ---------------------------------------------------------------------------
CREATE TABLE `order_items` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name_snapshot` VARCHAR(180) NOT NULL,
  `price_cents`   INT NOT NULL,
  `quantity`      INT NOT NULL,
  `image`         VARCHAR(255) DEFAULT NULL,
  `order_id`      INT UNSIGNED NOT NULL,
  `product_id`    INT UNSIGNED DEFAULT NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_order_items_order` (`order_id`),
  KEY `ix_order_items_product` (`product_id`),
  CONSTRAINT `fk_order_items_order`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_order_items_product`
    FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_order_items_quantity` CHECK (`quantity` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
