#!/usr/bin/env node
import 'dotenv/config'
import { sequelize, connectDB } from '../config/db.js'
import { encrypt, isEncrypted } from '../utils/crypto.js'

/**
 * Encrypts personal data that is already sitting in the database as plain
 * text.
 *
 * Run once, after 04-security-hardening.sql has widened the columns:
 *
 *   npm run encrypt:existing
 *   npm run encrypt:existing -- --dry-run
 *
 * A fresh database does not need this at all - anything written after the
 * model change is encrypted on the way in.
 *
 * This uses raw SQL rather than the Sequelize models on purpose. The models
 * now have setters that encrypt automatically, so reading a row and saving it
 * back through the model would encrypt the ciphertext a second time and the
 * value would be lost. Raw queries bypass the getters and setters entirely.
 */

const DRY_RUN = process.argv.includes('--dry-run')

// table -> the columns on it that are now encrypted in the model.
const TARGETS = {
  users: ['phone', 'address'],
  orders: ['phone', 'address', 'postal_code'],
}

async function encryptTable(table, columns) {
  const list = columns.map(c => `\`${c}\``).join(', ')
  const [rows] = await sequelize.query(`SELECT id, ${list} FROM \`${table}\``)

  let changed = 0
  let skipped = 0

  for (const row of rows) {
    const updates = {}

    for (const column of columns) {
      const value = row[column]

      // Empty stays empty - encrypting null would turn "no phone number" into
      // a value, and the column would stop being searchable for absence.
      if (value === null || value === undefined || value === '') continue

      // Already done. This is what makes the script safe to re-run, and safe
      // to interrupt half way through.
      if (isEncrypted(value)) {
        skipped += 1
        continue
      }

      updates[column] = encrypt(value)
    }

    const keys = Object.keys(updates)
    if (!keys.length) continue

    if (!DRY_RUN) {
      const setClause = keys.map(k => `\`${k}\` = ?`).join(', ')
      await sequelize.query(`UPDATE \`${table}\` SET ${setClause} WHERE id = ?`, {
        replacements: [...keys.map(k => updates[k]), row.id],
      })
    }

    changed += 1
  }

  console.log(
    `  ${table}: ${changed} row(s) ${DRY_RUN ? 'would be' : ''} encrypted, ${skipped} field(s) already encrypted`,
  )

  return changed
}

async function run() {
  await connectDB()

  if (DRY_RUN) console.log('\nDRY RUN - nothing will be written.\n')
  else console.log('\nEncrypting existing personal data...\n')

  let total = 0
  for (const [table, columns] of Object.entries(TARGETS)) {
    total += await encryptTable(table, columns)
  }

  console.log(`\nDone. ${total} row(s) touched.`)

  if (!DRY_RUN && total > 0) {
    console.log(
      '\nBack up ENCRYPTION_KEY somewhere safe now. Losing it means these\n' +
        'columns can never be read again - there is no recovery, that is the\n' +
        'entire point of encryption.\n',
    )
  }

  await sequelize.close()
}

run().catch(err => {
  console.error('\nMigration failed:', err.message)
  console.error('\nDid you run database/04-security-hardening.sql first? The columns')
  console.error('have to be widened before ciphertext will fit in them.')
  process.exit(1)
})
