/**
 * Password rules, following NIST SP 800-63B rather than the older "one
 * uppercase, one number, one symbol" advice.
 *
 * The modern guidance is deliberately different from what most sites still do:
 *
 *   - Length beats complexity. `correct horse battery staple` is far stronger
 *     than `P@ssw0rd`, and people can actually remember it.
 *   - Check against known-bad passwords. This is the single most effective
 *     rule, because real attacks use lists of leaked passwords, not brute
 *     force over the whole keyspace.
 *   - Do not force composition rules. They push people towards predictable
 *     substitutions (a -> @, o -> 0) that attackers already account for.
 *   - Do not force rotation. It makes people pick weaker passwords and add a
 *     counter on the end.
 *   - Allow long passwords and every character, including spaces and emoji.
 */

export const MIN_LENGTH = 10
export const MAX_LENGTH = 200 // bcrypt silently truncates past 72 bytes anyway

// The passwords that actually show up in credential-stuffing attacks. A real
// deployment should check against the Have I Been Pwned range API instead,
// which covers about a billion leaked passwords without sending the password
// anywhere - see the note at the bottom of this file.
const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssword', 'p@ssw0rd',
  '12345678', '123456789', '1234567890', '123123123', '111111111', '000000000',
  'qwertyuiop', 'qwerty123', 'asdfghjkl', '1q2w3e4r5t', 'zaq12wsx',
  'iloveyou', 'princess1', 'sunshine1', 'football1', 'baseball1',
  'letmein123', 'welcome123', 'admin123', 'administrator', 'changeme',
  'trustno1', 'superman1', 'starwars1', 'monkey123', 'dragon123',
  'abc12345', 'abcd1234', 'test1234', 'demo1234', 'user1234',
  'whatever1', 'freedom1', 'computer1', 'internet1', 'samsung1',
])

function hasLongRun(value) {
  // aaaaaaaaaa or 1111111111
  return /(.)\1{5,}/.test(value)
}

function hasSequence(value) {
  const lower = value.toLowerCase()
  const runs = 'abcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i + 5 <= runs.length; i += 1) {
    const forward = runs.slice(i, i + 5)
    const backward = forward.split('').reverse().join('')
    if (lower.includes(forward) || lower.includes(backward)) return true
  }
  return false
}

/**
 * Returns an error message, or null when the password is acceptable.
 *
 * `context` should carry the person's email and name. Reusing your own email
 * address as your password is common and is the first thing an attacker tries,
 * so it gets rejected even though it may be long and "complex".
 */
export function checkPassword(password, context = {}) {
  const value = String(password ?? '')

  if (value.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters. A short phrase you will remember works well.`
  }
  if (value.length > MAX_LENGTH) {
    return `Password must be ${MAX_LENGTH} characters or fewer`
  }
  if (value.trim().length === 0) {
    return 'Password cannot be only spaces'
  }

  const lower = value.toLowerCase()

  if (COMMON.has(lower)) {
    return 'That password appears in lists of leaked passwords. Please choose another.'
  }
  if (hasLongRun(value)) {
    return 'Password cannot be the same character repeated'
  }
  if (hasSequence(value)) {
    return 'Password cannot contain a long run like "abcdef" or "12345"'
  }

  // Reusing the email local-part or the display name.
  const emailLocal = String(context.email || '').split('@')[0].toLowerCase()
  if (emailLocal.length >= 3 && lower.includes(emailLocal)) {
    return 'Password cannot contain your email address'
  }

  const name = String(context.name || '').toLowerCase().trim()
  if (name.length >= 3 && lower.includes(name)) {
    return 'Password cannot contain your name'
  }

  if (lower.includes('northline')) {
    return 'Password cannot contain the name of the site'
  }

  return null
}

/**
 * A rough 0-4 score for the strength meter in the UI. This is guidance for the
 * person choosing a password, not a gate - checkPassword() is the gate.
 */
export function scorePassword(password) {
  const value = String(password ?? '')
  if (!value) return 0

  let score = 0
  if (value.length >= 10) score += 1
  if (value.length >= 14) score += 1
  if (value.length >= 20) score += 1

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/, /\s/].filter(re => re.test(value)).length
  if (classes >= 3) score += 1

  if (COMMON.has(value.toLowerCase()) || hasLongRun(value) || hasSequence(value)) score = 0

  return Math.min(score, 4)
}

/**
 * Optional upgrade: check the password against Have I Been Pwned.
 *
 * This uses k-anonymity - only the first five characters of the SHA-1 hash
 * ever leave your server, and the API returns every hash suffix starting with
 * those five characters. Your users' passwords are never sent anywhere, not
 * even hashed in full. Roughly 800 million leaked passwords, for free.
 *
 * Wire it into checkPassword() when you are ready to depend on an outbound
 * call at signup time. Fail *open* on a network error: an unreachable third
 * party should never stop someone signing up.
 */
export async function isBreached(password) {
  const { createHash } = await import('node:crypto')
  const hash = createHash('sha1').update(String(password)).digest('hex').toUpperCase()
  const prefix = hash.slice(0, 5)
  const suffix = hash.slice(5)

  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return false

    const body = await res.text()
    return body
      .split('\n')
      .some(line => line.split(':')[0]?.trim() === suffix)
  } catch {
    return false // fail open
  }
}

export default { checkPassword, scorePassword, isBreached, MIN_LENGTH, MAX_LENGTH }
