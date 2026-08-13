#!/usr/bin/env node
import crypto from 'node:crypto'

/**
 * Generates the secrets this project needs.
 *
 *   node scripts/generate-keys.js
 *   npm run keys
 *
 * Why generate them rather than typing something in: a key you invent yourself
 * is not random. "MySuperSecretKey2026!" has maybe 40 bits of real entropy
 * because the pattern is predictable. crypto.randomBytes uses the operating
 * system's cryptographic random source and gives you the full 256 bits.
 *
 * Print these once, paste them into .env, and do not commit them. If you leak
 * ENCRYPTION_KEY you cannot rotate it without re-encrypting every row, so
 * treat it with more care than the others.
 */

const hex = bytes => crypto.randomBytes(bytes).toString('hex')
const b64 = bytes => crypto.randomBytes(bytes).toString('base64url')

console.log(`
# ---------------------------------------------------------------------------
# Generated ${new Date().toISOString()}
# Copy these into ecommerce-backend/.env
#
# WARNING: changing ENCRYPTION_KEY later makes every already-encrypted row
# unreadable. Generate it once, back it up somewhere safe (a password manager
# is fine), and leave it alone.
# ---------------------------------------------------------------------------

# Signs JSON Web Tokens. Changing this signs everyone out - which is exactly
# what you want if you ever think it has leaked.
JWT_SECRET=${b64(48)}

# Encrypts personal data in the database. 32 bytes, as hex. AES-256 needs
# exactly this length.
ENCRYPTION_KEY=${hex(32)}

# Keys the searchable hashes of encrypted columns. Kept separate from
# ENCRYPTION_KEY so that leaking one does not automatically hand over both
# capabilities.
BLIND_INDEX_KEY=${hex(32)}

# Signs cookies.
COOKIE_SECRET=${b64(32)}
`)
