# database/

Five plain SQL files, in case you would rather create the tables yourself than
let Sequelize do it.

| File | What it does | Required? |
|---|---|---|
| `01-schema.sql` | Creates the database and all eight base tables with their keys, indexes and foreign keys | Yes |
| `02-seed.sql` | Fills in demo users, categories, products, one order and one review | Optional |
| `03-add-social-login.sql` | Adds the Google / Facebook columns (`provider`, `provider_id`, `avatar`, `email_verified`) | Yes |
| `04-security-hardening.sql` | Adds lockout, `token_version`, widened ciphertext columns, and the `security_events` audit table | Yes |
| `05-two-factor.sql` | Adds the 2FA columns and the `recovery_codes` table | Yes |

**Run them in numerical order.** Only `02-seed.sql` is skippable — the other
four each add columns the application reads at runtime. Skip `04` and the first
sign-in fails with `Unknown column 'token_version' in field list`.

## Running them twice is safe

`03`, `04` and `05` each check `information_schema` before every `ADD COLUMN`
and skip the ones already present, so re-running a file does nothing instead of
stopping with `#1060 - Duplicate column name`. You can paste any of them into
phpMyAdmin as many times as you like.

The one file that is *not* safe to re-run casually is `02-seed.sql`: it deletes
the existing demo rows first and rewrites them. That is intentional, but it
means any orders you placed while testing will be gone.

## Using them in phpMyAdmin

1. Start **Apache** and **MySQL** in the XAMPP control panel.
2. Open `http://localhost/phpmyadmin`.
3. Click the **SQL** tab, paste `01-schema.sql`, press **Go**.
4. Repeat for `03`, `04` and `05`.
5. For `02-seed.sql`, generate the two bcrypt hashes first (see the banner at
   the top of that file) and paste them into the two `SET @..._hash` lines.
6. In `ecommerce-backend/.env`, set `DB_SYNC_ALTER=false` so Sequelize does not
   try to alter the tables you just made by hand.

Leave phpMyAdmin's **Enable foreign key checks** box ticked. These files are
written to be correct with it on — that box silently overrides any
`SET FOREIGN_KEY_CHECKS = 0` in a pasted script, which is why `02-seed.sql`
uses `DELETE` in child-to-parent order rather than `TRUNCATE`.

## Using them from the command line

```bash
cd ecommerce-project/database
mysql -u root -p < 01-schema.sql
mysql -u root -p ecommerce < 03-add-social-login.sql
mysql -u root -p ecommerce < 04-security-hardening.sql
mysql -u root -p ecommerce < 05-two-factor.sql
mysql -u root -p ecommerce < 02-seed.sql   # optional, needs the hashes
```

On a default XAMPP install the root password is empty, so just press Enter.

## Or skip all of them

```bash
cd ecommerce-backend
npm run seed          # add --fresh, or use npm run seed:fresh, to wipe first
```

That creates every table through the models and **hashes the demo passwords for
you**, so there is nothing to paste and nothing to get wrong. This is the
recommended route. The SQL files exist so you can read the schema in one place,
show it in a portfolio, or hand it to someone who only speaks SQL.

Demo accounts either way:

| Email | Password | Role |
|---|---|---|
| `demo@northline.dev` | `quiet-river-8842` | customer |
| `admin@northline.dev` | `steady-anchor-7715` | admin |

## The tables

`01-schema.sql` creates these eight:

```
users ──< carts ──< cart_items >── products >── categories
  │                                   │
  ├──< orders ──< order_items >───────┤
  └──< reviews >──────────────────────┘
```

`04` adds `security_events` (audit log, `ON DELETE SET NULL` so records survive
account deletion) and `05` adds `recovery_codes` (2FA backup codes,
`ON DELETE CASCADE`).

## If something goes wrong

| Error | Meaning |
|---|---|
| `#1060 Duplicate column name` | Shouldn't happen any more. If it does, you are running an older copy of `03`/`04`/`05`. |
| `#1701 Cannot truncate a table referenced in a foreign key constraint` | Same — an older `02-seed.sql`. |
| `errno: 150` on `security_events` | A signedness mismatch: `users.id` must be `INT UNSIGNED`. Run `DROP TABLE IF EXISTS security_events;` and re-run `04`. |
| `Unknown column 'token_version'` | `04` never ran. |
| Login always fails for the demo accounts | `02-seed.sql` ran with the placeholder hashes still in it. Use `npm run seed` instead. |
