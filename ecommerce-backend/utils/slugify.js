// Turns "Aera Wireless Headphones" into "aera-wireless-headphones".
export function slugify(input = '') {
  return String(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180)
}

// Makes sure the slug is not already taken. "mug" becomes "mug-2", then
// "mug-3", and so on. Pass the row's own id when updating so a product does
// not collide with itself.
export async function uniqueSlug(Model, name, ignoreId = null) {
  const base = slugify(name) || 'item'
  let candidate = base
  let n = 1

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found = await Model.findOne({ where: { slug: candidate }, attributes: ['id'] })
    if (!found || (ignoreId && found.id === Number(ignoreId))) return candidate
    n += 1
    candidate = `${base}-${n}`
  }
}

export default slugify
