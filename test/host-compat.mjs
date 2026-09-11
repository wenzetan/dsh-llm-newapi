/**
 * Host-line compatibility gate for the built plugin.
 *
 * The plugin builds and typechecks against the dsh 0.1.2-rc.1 seam
 * (`@deepseek-ai/dsh-llm` 0.1.2-rc.1). A static named runtime import of a
 * symbol the HOST's dsh-llm does not export makes the whole `llm-newapi`
 * loader entry die at ESM link time (`SyntaxError: … does not provide an
 * export named 'X'`) — before any provider code runs. This gate pins that
 * contract: the built entry may only import dsh-llm symbols that exist on
 * the workspace-resolved surface AND on the checked-in 0.1.2-rc.1 surface
 * snapshot (captured from the published package), so a rename on either side
 * is caught here instead of in a booting host.
 *
 * Four blocks:
 *  A. Export gate (always): every `@deepseek-ai/dsh-llm` named runtime import
 *     in the built host entry `lib/index.js` must exist on BOTH the
 *     workspace-resolved surface (live import — the line we build and
 *     typecheck against) and the checked-in 0.1.2-rc.1 surface snapshot
 *     (test/fixtures/dsh-llm-0.1.2-rc.1.exports.json). The sole permitted
 *     subpath is the package.json version probe exported by both host lines.
 *  B. Surface link fixture (always, offline): a scratch `node_modules` layout
 *     shadows `@deepseek-ai/dsh-llm` with a stub exposing exactly the
 *     snapshot names (universal dummies), while every other dependency
 *     resolves to the real workspace packages. A child node process must
 *     import the copied plugin entry cleanly — this reproduces the
 *     link-time SyntaxError failure mode without network access.
 *  C. Old-host rejection fixture (always, offline): the same copied entry
 *     sees a 0.1.1-rc.2 package version and must fail with the explicit
 *     minimum-version and upgrade guidance, never a raw resolver error.
 *  D. Snapshot drift guard (dev-only): when the real package extract is
 *     present (`.tmp-host/package`, fetched during investigation / by
 *     regenerating the snapshot), its export statement is re-parsed and must
 *     match the checked-in snapshot, so the fixture cannot silently rot.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILT_ENTRY = join(ROOT, 'lib', 'index.js')
const SNAPSHOT_PATH = join(ROOT, 'test', 'fixtures', 'dsh-llm-0.1.2-rc.1.exports.json')
const SCRATCH = join(ROOT, 'test', '.tmp-host-surface')
const REAL_HOST_EXTRACT = join(ROOT, '.tmp-host', 'package', 'lib', 'index.js')

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

/** Export names of the real host-package extract, statically parsed. */
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

// ── Block A: export gate — runtime imports ⊆ workspace surface ∩ host snapshot ──
{
  assert.ok(existsSync(BUILT_ENTRY), 'lib/index.js is missing — run npm run build:host first')
  const built = readFileSync(BUILT_ENTRY, 'utf8')

  const subpaths = built.match(/["']@deepseek-ai\/dsh-llm\/[^"']+["']/g) ?? []
  assert.deepEqual([...new Set(subpaths)], ['"@deepseek-ai/dsh-llm/package.json"'],
    'only the explicitly exported dsh-llm/package.json compatibility probe may use a subpath import')
  const llmManifest = await import('@deepseek-ai/dsh-llm/package.json', { with: { type: 'json' } })
  assert.equal(typeof llmManifest.default.version, 'string',
    'the workspace dsh-llm package.json must expose a version for the compatibility guard')

  const imported = namedImportsFrom(built, '@deepseek-ai/dsh-llm')
  assert.ok(imported.size > 0, 'no @deepseek-ai/dsh-llm named imports found in lib/index.js — gate would pass vacuously')

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
  const host = new Set(snapshot.exports)
  const workspace = new Set(Object.keys(await import('@deepseek-ai/dsh-llm')))

  const missing = { workspace: [], host: [] }
  for (const symbol of [...imported.keys()].sort()) {
    if (!workspace.has(symbol)) missing.workspace.push(symbol)
    if (!host.has(symbol)) missing.host.push(symbol)
  }
  assert.deepEqual(missing.workspace, [],
    `lib/index.js imports @deepseek-ai/dsh-llm symbols absent from the workspace-resolved surface (${[...workspace].length} exports) — the build target drift requires a source change`)
  assert.deepEqual(missing.host, [],
    `lib/index.js imports @deepseek-ai/dsh-llm symbols absent from the pinned host surface ${snapshot.version} (${[...host].length} exports) — the loader entry would die at ESM link time on such a host`)
}

// ── Block B: link the built plugin against a host-surface stub ──
{
  rmSync(SCRATCH, { recursive: true, force: true })
  const stubPkgDir = join(SCRATCH, 'node_modules', '@deepseek-ai', 'dsh-llm')
  mkdirSync(stubPkgDir, { recursive: true })

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
  // Universal dummy: callable, constructable, extendable (class X extends …),
  // property-access chainable — good enough for module link AND top-level
  // evaluation; no host behavior is exercised by this block.
  writeFileSync(join(stubPkgDir, 'index.js'), [
    'const makeDummy = () => new Proxy(function dummy() {}, {',
    '  get: (_t, prop) => (prop === Symbol.toPrimitive ? () => "surface-stub" : makeDummy()),',
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
    exports: { '.': './index.js', './package.json': './package.json' },
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
      `import(${JSON.stringify(pathToFileURL(entry).href)}).then(m => console.log('PLUGIN-LINK-OK', Object.keys(m).length)).catch(e => { console.error(e.constructor.name + ': ' + e.message); process.exit(1) })`,
    ], { encoding: 'utf8', timeout: 60_000 })
  } catch (error) {
    const detail = (error.stdout ?? '') + (error.stderr ?? '')
    assert.fail(`plugin entry fails to load against the ${snapshot.version} surface stub:\n${detail.trim()}`)
  }
  assert.match(stdout, /^PLUGIN-LINK-OK \d+/, 'plugin linked and evaluated against the host surface stub')
  rmSync(SCRATCH, { recursive: true, force: true })
}

// ── Block C: an older host gets an actionable compatibility error ──
{
  const built = readFileSync(BUILT_ENTRY, 'utf8')
  assert.doesNotMatch(built, /from\s*["']@deepseek-ai\/dsh-util-values["']/u,
    'the compatibility guard must run before any dependency absent from dsh 0.1.1; keep deepEqualJson local')

  rmSync(SCRATCH, { recursive: true, force: true })
  const stubPkgDir = join(SCRATCH, 'node_modules', '@deepseek-ai', 'dsh-llm')
  mkdirSync(stubPkgDir, { recursive: true })

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
  writeFileSync(join(stubPkgDir, 'index.js'), [
    'const makeDummy = () => new Proxy(function dummy() {}, {',
    '  get: (_t, prop) => (prop === Symbol.toPrimitive ? () => "surface-stub" : makeDummy()),',
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
    version: '0.1.1-rc.2',
    type: 'module',
    main: 'index.js',
    exports: { '.': './index.js', './package.json': './package.json' },
  }, null, 2) + '\n')

  const pluginDir = join(SCRATCH, 'node_modules', 'dsh-llm-newapi')
  mkdirSync(pluginDir, { recursive: true })
  cpSync(join(ROOT, 'package.json'), join(pluginDir, 'package.json'))
  cpSync(join(ROOT, 'lib'), join(pluginDir, 'lib'), { recursive: true })

  const result = spawnSync(process.execPath, ['-e',
    `import(${JSON.stringify(pathToFileURL(join(pluginDir, 'lib', 'index.js')).href)}).catch(error => { console.error(error.constructor.name + ': ' + error.message); process.exit(1) })`,
  ], { encoding: 'utf8', timeout: 60_000 })
  const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`
  assert.notEqual(result.status, 0, 'an unsupported dsh 0.1.1 host must reject this plugin')
  assert.match(detail, /requires dsh >= 0\.1\.2-rc\.1/u,
    `old-host rejection must state the minimum supported dsh version:\n${detail.trim()}`)
  assert.match(detail, /npm install -g @deepseek-ai\/dsh@next/u,
    `old-host rejection must include an upgrade command:\n${detail.trim()}`)
  assert.doesNotMatch(detail, /ERR_MODULE_NOT_FOUND|Cannot find package/u,
    `old-host rejection must not leak a raw module-resolution failure:\n${detail.trim()}`)
  rmSync(SCRATCH, { recursive: true, force: true })
}

// ── Block D (dev-only): the checked-in snapshot matches the real tarball ──
{
  if (!existsSync(REAL_HOST_EXTRACT)) {
    console.log('host-compat: real host package extract absent — snapshot drift check skipped (dev-only block)')
  } else {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
    const real = parseExportStatement(REAL_HOST_EXTRACT)
    const snap = new Set(snapshot.exports)
    assert.deepEqual(
      { missingFromSnapshot: [...real].filter(n => !snap.has(n)).sort(), staleInSnapshot: [...snap].filter(n => !real.has(n)).sort() },
      { missingFromSnapshot: [], staleInSnapshot: [] },
      `test/fixtures/${SNAPSHOT_PATH.split('/').pop()} no longer matches the real ${snapshot.version} tarball — regenerate it`,
    )
    console.log('host-compat: snapshot matches the real host package extract')
  }
}

console.log('host-compat: export gate + host-surface link fixture OK')
