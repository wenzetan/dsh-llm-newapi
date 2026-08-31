/**
 * Host-line compatibility gate for the built plugin (issue #3).
 *
 * The host alpha line (dsh 0.1.2-alpha) ships an `@deepseek-ai/dsh-llm` whose
 * export surface drifted from the rc line: `CallId` was renamed to
 * `ToolCallId`. A static named import of a drifted symbol makes the whole
 * `llm-newapi` loader entry die at ESM link time (`SyntaxError: … does not
 * provide an export named 'CallId'`) — before any provider code runs.
 *
 * Three blocks:
 *  A. Export gate (always): every `@deepseek-ai/dsh-llm` named runtime import
 *     in the built host entry `lib/index.js` must exist on BOTH the
 *     workspace-resolved rc surface (live import — the line we build and
 *     typecheck against) and the checked-in alpha surface snapshot
 *     (test/fixtures/dsh-llm-alpha-*.exports.json). Subpath imports of the
 *     package are rejected: only the root entry is covered by the snapshot.
 *  B. Alpha link fixture (always, offline): a scratch `node_modules` layout
 *     shadows `@deepseek-ai/dsh-llm` with a stub exposing exactly the alpha
 *     snapshot names (universal dummies), while every other dependency
 *     resolves to the real workspace packages. A child node process must
 *     import the copied plugin entry cleanly — this reproduces the issue #3
 *     failure mode (link-time SyntaxError) without network access.
 *  C. Snapshot drift guard (dev-only): when the real alpha tarball extract is
 *     present (`.tmp-alpha/package`, fetched during investigation / by
 *     regenerating the snapshot), its export statement is re-parsed and must
 *     match the checked-in snapshot, so the fixture cannot silently rot.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILT_ENTRY = join(ROOT, 'lib', 'index.js')
const SNAPSHOT_PATH = join(ROOT, 'test', 'fixtures', 'dsh-llm-alpha-0.1.2-alpha.2.exports.json')
const SCRATCH = join(ROOT, 'test', '.tmp-host-alpha')
const REAL_ALPHA_EXTRACT = join(ROOT, '.tmp-alpha', 'package', 'lib', 'index.js')

/** Parse `import { A, B as C } from "@deepseek-ai/dsh-llm"` occurrences. */
function namedImportsFrom(source, specifier) {
  const re = new RegExp(`import\\s*\\{([^}]+)\\}\\s*from\\s*["']${specifier.replace(/[/\\]/g, '\\$&')}["']`, 'g')
  const symbols = new Map()
  let match
  while ((match = re.exec(source))) {
    for (const part of match[1].split(',')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const [original] = trimmed.split(/\s+as\s+/)
      if (original && !symbols.has(original)) symbols.set(original, [])
      if (original) symbols.get(original).push(re.lastIndex)
    }
  }
  return symbols
}

/** Export names of the real alpha tarball extract, statically parsed. */
function parseExportStatement(path) {
  const source = readFileSync(path, 'utf8')
  const statements = [...source.matchAll(/export\s*\{([^}]+)\}/g)]
  assert.ok(statements.length > 0, `${path}: no export statement found`)
  const names = statements
    .flatMap(statement => statement[1].split(','))
    .map(name => name.trim())
    .filter(Boolean)
    .map(name => name.split(/\s+as\s+/)[0].trim())
  return new Set(names.filter(name => name !== 'default'))
}

// ── Block A: export gate — runtime imports ⊆ rc surface ∩ alpha surface ──
{
  assert.ok(existsSync(BUILT_ENTRY), 'lib/index.js is missing — run npm run build:host first')
  const built = readFileSync(BUILT_ENTRY, 'utf8')

  const subpaths = built.match(/["']@deepseek-ai\/dsh-llm\/[^"']+["']/g) ?? []
  assert.deepEqual(subpaths, [],
    'subpath imports of @deepseek-ai/dsh-llm are not covered by the compatibility snapshot; import from the package root only')

  const imported = namedImportsFrom(built, '@deepseek-ai/dsh-llm')
  assert.ok(imported.size > 0, 'no @deepseek-ai/dsh-llm named imports found in lib/index.js — gate would pass vacuously')

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
  const alpha = new Set(snapshot.exports)
  const rc = new Set(Object.keys(await import('@deepseek-ai/dsh-llm')))

  const missing = { rc: [], alpha: [] }
  for (const symbol of [...imported.keys()].sort()) {
    if (!rc.has(symbol)) missing.rc.push(symbol)
    if (!alpha.has(symbol)) missing.alpha.push(symbol)
  }
  assert.deepEqual(missing.rc, [],
    `lib/index.js imports @deepseek-ai/dsh-llm symbols absent from the workspace-resolved rc line (${[...rc].length} exports) — the build target drift requires a source change`)
  assert.deepEqual(missing.alpha, [],
    `lib/index.js imports @deepseek-ai/dsh-llm symbols absent from the host alpha line ${snapshot.version} (${[...alpha].length} exports) — this is exactly the issue #3 failure: the loader entry dies at ESM link time on alpha hosts`)
}

// ── Block B: link the built plugin against an alpha-surface stub host ──
{
  rmSync(SCRATCH, { recursive: true, force: true })
  const stubPkgDir = join(SCRATCH, 'node_modules', '@deepseek-ai', 'dsh-llm')
  mkdirSync(stubPkgDir, { recursive: true })

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
  // Universal dummy: callable, constructable, extendable (class X extends …),
  // property-access chainable — good enough for module link AND top-level
  // evaluation; no alpha behavior is exercised by this block.
  writeFileSync(join(stubPkgDir, 'index.js'), [
    'const makeDummy = () => new Proxy(function dummy() {}, {',
    '  get: (_t, prop) => (prop === Symbol.toPrimitive ? () => "alpha-stub" : makeDummy()),',
    '  apply: () => makeDummy(),',
    '  construct: () => makeDummy(),',
    '})',
    'const d = makeDummy()',
    `export { ${snapshot.exports.map(name => `d as ${name}`).join(', ')} }`,
    'export default d',
    '',
  ].join('\n'))
  writeFileSync(join(stubPkgDir, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-llm',
    version: snapshot.version,
    type: 'module',
    main: 'index.js',
    exports: { '.': './index.js' },
  }, null, 2) + '\n')

  // The plugin itself is installed as a copy (not a symlink): module
  // resolution must see the stub dsh-llm first, then fall through to the real
  // workspace node_modules for every other dependency.
  const pluginDir = join(SCRATCH, 'node_modules', 'dsh-llm-newapi')
  mkdirSync(pluginDir, { recursive: true })
  cpSync(join(ROOT, 'package.json'), join(pluginDir, 'package.json'))
  cpSync(join(ROOT, 'lib'), join(pluginDir, 'lib'), { recursive: true })

  const entry = join(pluginDir, 'lib', 'index.js')
  const child = process.execPath
  let stdout = ''
  try {
    // A fresh child process is required: an ESM link failure in this process
    // would poison every later import of the same graph.
    stdout = execFileSync(child, ['-e',
      `import(${JSON.stringify(entry)}).then(m => console.log('PLUGIN-LINK-OK', Object.keys(m).length)).catch(e => { console.error(e.constructor.name + ': ' + e.message); process.exit(1) })`,
    ], { encoding: 'utf8', timeout: 60_000 })
  } catch (error) {
    const detail = (error.stdout ?? '') + (error.stderr ?? '')
    assert.fail(`plugin entry fails to load against the ${snapshot.version} surface stub (issue #3 mode):\n${detail.trim()}`)
  }
  assert.match(stdout, /^PLUGIN-LINK-OK \d+/, 'plugin linked and evaluated against the alpha surface stub')
  rmSync(SCRATCH, { recursive: true, force: true })
}

// ── Block C (dev-only): the checked-in snapshot matches the real tarball ──
{
  if (!existsSync(REAL_ALPHA_EXTRACT)) {
    console.log('host-compat: real alpha tarball extract absent — snapshot drift check skipped (dev-only block)')
  } else {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
    const real = parseExportStatement(REAL_ALPHA_EXTRACT)
    const snap = new Set(snapshot.exports)
    assert.deepEqual(
      { missingFromSnapshot: [...real].filter(n => !snap.has(n)).sort(), staleInSnapshot: [...snap].filter(n => !real.has(n)).sort() },
      { missingFromSnapshot: [], staleInSnapshot: [] },
      `test/fixtures/${SNAPSHOT_PATH.split('/').pop()} no longer matches the real ${snapshot.version} tarball — regenerate it`,
    )
    console.log('host-compat: snapshot matches the real alpha tarball extract')
  }
}

console.log('host-compat: export gate + alpha link fixture OK')
