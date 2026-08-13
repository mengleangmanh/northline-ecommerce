/**
 * verify-ready.mjs
 *
 * Run this from the project root BEFORE you commit and push:
 *
 *     node verify-ready.mjs
 *
 * It answers one question: does the code on this computer contain the
 * serverless fix and the Vercel scaffolding? It cannot tell you anything
 * about what is deployed - only a git push does that.
 */

import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))

let failures = 0
let warnings = 0

const pass = msg => console.log(`  PASS  ${msg}`)
const fail = msg => {
  console.log(`  FAIL  ${msg}`)
  failures++
}
const warn = msg => {
  console.log(`  WARN  ${msg}`)
  warnings++
}

const read = rel => {
  const p = join(root, rel)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

console.log('\n1. The serverless crash fix\n')

const server = read('ecommerce-backend/server.js')
if (!server) {
  fail('ecommerce-backend/server.js not found - are you running this from the project root?')
} else {
  if (server.includes('bootProblems')) {
    pass('server.js collects boot problems instead of exiting')
  } else {
    fail('server.js is the OLD file. The overwrite did not land here. Extract the zip again.')
  }

  // Every process.exit must sit inside a !isServerless guard or the gated start().
  // A bare one at module scope is what produced FUNCTION_INVOCATION_FAILED.
  const lines = server.split('\n')
  const exits = lines
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /process\.exit\(/.test(line) && !/^\s*\*/.test(line))

  if (exits.length === 0) {
    pass('no process.exit calls at all')
  } else {
    // Indented exits are inside a block; a column-0 exit is at module scope.
    const bare = exits.filter(({ line }) => /^process\.exit\(/.test(line))
    if (bare.length === 0) {
      pass(`${exits.length} process.exit call(s), all inside a guard`)
    } else {
      fail(`process.exit at module scope on line(s) ${bare.map(e => e.n).join(', ')} - this crashes on Vercel`)
    }
  }

  if (/export default app/.test(server)) {
    pass('server.js exports the app for the serverless function')
  } else {
    fail('server.js has no `export default app` - api/index.js cannot import it')
  }
}

console.log('\n2. Vercel scaffolding\n')

const required = {
  'package.json': 'the root manifest Vercel installs for the function',
  'vercel.json': 'the build command and the /api rewrite',
  'api/index.js': 'the function entry point',
  '.gitignore': 'keeps .env out of git',
}

for (const [rel, why] of Object.entries(required)) {
  if (existsSync(join(root, rel))) pass(`${rel} - ${why}`)
  else fail(`${rel} is MISSING - ${why}`)
}

if (existsSync(join(root, 'package-lock.json'))) {
  const lock = read('package-lock.json')
  if (lock && !/"express"/.test(lock)) {
    fail('package-lock.json is a stale stub listing no packages - delete it')
  } else {
    pass('package-lock.json looks real')
  }
} else {
  pass('no stale root package-lock.json')
}

const rootPkg = read('package.json')
if (rootPkg) {
  const pkg = JSON.parse(rootPkg)
  for (const dep of ['express', 'sequelize', 'mysql2']) {
    if (pkg.dependencies?.[dep]) pass(`root package.json declares ${dep}`)
    else fail(`root package.json is missing ${dep} - the function will throw Cannot find module`)
  }
  if (pkg.type === 'module') pass('root package.json declares "type": "module"')
  else fail('root package.json must set "type": "module" - this project is ESM')
}

console.log('\n3. Secrets\n')

try {
  const tracked = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(f => /(^|\/)\.env$/.test(f.trim()))

  if (tracked.length === 0) {
    pass('no .env file is tracked by git')
  } else {
    fail(`git is tracking ${tracked.join(', ')} - your secrets will be published. Run: git rm --cached ${tracked[0]}`)
  }

  const history = execSync('git log --all --name-only --pretty=format:', { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(f => /(^|\/)\.env$/.test(f.trim()))

  if (history.length > 0) {
    warn('a .env file appears in git HISTORY. Adding it to .gitignore does not remove it. Rotate every key.')
  } else {
    pass('no .env in git history')
  }
} catch {
  warn('could not run git here - check manually that .env is not committed')
}

console.log('\n' + '-'.repeat(60))
if (failures === 0) {
  console.log(`\nReady to push.${warnings ? ` ${warnings} warning(s) above.` : ''}`)
  console.log('\n  git add -A')
  console.log('  git commit -m "Fix serverless crash"')
  console.log('  git push')
  console.log('\nThen open /api/health on the NEW deployment URL.')
  console.log('You want JSON. A bare 500 means the old code is still live.\n')
} else {
  console.log(`\n${failures} problem(s) must be fixed before pushing. Do not deploy yet.\n`)
}

process.exit(failures === 0 ? 0 : 1)
