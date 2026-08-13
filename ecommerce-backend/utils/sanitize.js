/**
 * Input cleaning.
 *
 * Two different jobs get confused constantly, so to be clear about which one
 * this file does:
 *
 *   SQL injection is *not* handled here. Sequelize parameterises every query,
 *   which is what actually prevents it. Escaping strings by hand would be a
 *   step backwards. The one place to stay alert is sequelize.query() with
 *   string concatenation - never do that, use replacements.
 *
 *   XSS is handled here, plus by React. React escapes everything it renders,
 *   so `<script>` in a review comment shows up as literal text, not as a
 *   script. That protection disappears the moment anyone uses
 *   dangerouslySetInnerHTML. Stripping tags on the way in is defence in depth
 *   for that day.
 */

// Characters that have no business being in a form field. Control characters
// can be used to hide text, break log files, or smuggle content past filters.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

// Zero-width and direction-override characters. The right-to-left override in
// particular can make "gnp.exe" render as "exe.png".
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g

/**
 * Clean a plain-text field: trim, drop control and invisible characters, and
 * cap the length so nobody can post a megabyte into a VARCHAR.
 */
export function cleanText(value, maxLength = 1000) {
  if (value === null || value === undefined) return value

  return String(value)
    .replace(CONTROL_CHARS, '')
    .replace(INVISIBLE, '')
    .trim()
    .slice(0, maxLength)
}

/**
 * Strip HTML tags from user text.
 *
 * This is for fields that should never contain markup at all - names, review
 * comments, addresses. It removes tags rather than escaping them, so the
 * stored value stays readable.
 *
 * If you ever want to *allow* some HTML (a rich-text product description, say)
 * do not extend this function. Use a real sanitiser such as DOMPurify with
 * jsdom, or sanitize-html. Allow-listing HTML correctly is genuinely hard and
 * a hand-rolled regex will be bypassed.
 */
export function stripTags(value, maxLength = 2000) {
  if (value === null || value === undefined) return value

  return cleanText(
    String(value)
      // Remove whole script/style blocks including their contents.
      .replace(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, '')
      // Remove any remaining tag.
      .replace(/<\/?[a-z][^>]*>/gi, '')
      // Neutralise leftover angle brackets.
      .replace(/[<>]/g, ''),
    maxLength,
  )
}

/**
 * Escape text for safe inclusion in HTML you build yourself - an order
 * confirmation email, for example. React does this automatically; a template
 * literal in a mail body does not.
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  )
}

export function cleanEmail(value) {
  return cleanText(value, 190).toLowerCase()
}

/**
 * Force a value to a safe integer, or null.
 *
 * Query strings are always strings, and `Number('12abc')` is NaN while
 * `parseInt('12abc')` is 12. Neither is what you want for an id. This is
 * strict on purpose.
 */
export function toInt(value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) return null
  return n
}

/**
 * Guard against a subtle one: Express query parsing turns `?id=1&id=2` into an
 * array, and `?id[$gt]=` into an object. Code that expects a string then gets
 * something it never planned for. This forces a single string or null.
 */
export function toSingleString(value) {
  if (Array.isArray(value)) return null
  if (value !== null && typeof value === 'object') return null
  if (value === undefined || value === null) return null
  return String(value)
}

export default {
  cleanText,
  stripTags,
  escapeHtml,
  cleanEmail,
  toInt,
  toSingleString,
}
