/**
 * Host-line compatibility gate for the built plugin.
 *
 * The plugin builds and typechecks against the dsh 0.1.5 seam
 * (`@deepseek-ai/dsh-llm` 0.1.5 line). A static named runtime import of a
 * symbol the HOST's dsh-llm does not export makes the whole `llm-newapi`
 * loader entry die at ESM link time (`SyntaxError: … does not provide an
 * export named 'X'`) — before any provider code runs. This gate pins that
 * contract: the built entry may only import dsh-llm symbols that exist on
 * the workspace-resolved surface AND on the checked-in 0.1.5-line surface
 * snapshot (captured from the published package), so a rename on either side
 * is caught here instead of in a booting host.
 *
 * Four blocks:
 *  A. Export gate (always): every `@deepseek-ai/dsh-llm` named runtime import
 *     in the built host entry `lib/index.js` must exist on BOTH the
 *     workspace-resolved surface (live import — the line we build and
 *     typecheck against) and the checked-in 0.1.5-line surface snapshot
 *     (test/fixtures/dsh-llm-0.1.5.exports.json). The sole permitted
 *     subpath is the package.json version probe exported by both host lines.
 *  B. Surface link fixture (always, offline): a scratch `node_modules` layout
 *     shadows `@deepseek-ai/dsh-llm` with a stub exposing exactly the
 *     snapshot names (universal dummies), while every other dependency
 *     resolves to the real workspace packages. A child node process must
 *     import the copied plugin entry cleanly — this reproduces the
 *     link-time SyntaxError failure mode without network access.
 *  C. Old-host rejection fixture (always, offline): the same copied entry
 *     sees a 0.1.2-rc.1 package version — the previous supported host line,
 *     which rc.2 deliberately drops — and must fail with the explicit
 *     minimum-version and upgrade guidance, never a raw resolver error.
 *  D. Snapshot drift guard (always, offline): the installed
 *     @deepseek-ai/dsh-llm must be a version recorded as sharing the checked-in
 *     surface, and its named exports must equal the snapshot exactly. Upstream
 *     re-cuts an RC with identical code, so membership is per version while the
 *     surface is per host line; an unlisted version fails loudly instead of
 *     passing on a guess. This block cannot be skipped.
 *  E. Rejected-host link guard (always, offline): the built entry's
 *     `@deepseek-ai/dsh-llm` imports must ALSO exist on the older 0.1.2-rc.1
 *     surface. The version guard lives inside the entry, so it only produces
 *     its friendly upgrade message if the module links first; a 0.1.5-only
 *     import would instead surface a raw ESM SyntaxError on that host.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILT_ENTRY = join(ROOT, 'lib', 'index.js')
const SNAPSHOT_PATH = join(ROOT, 'test', 'fixtures', 'dsh-llm-0.1.5.exports.json')
/** The host line this plugin now REJECTS, kept to protect that rejection's quality. */
const REJECTED_SNAPSHOT_PATH = join(ROOT, 'test', 'fixtures', 'dsh-llm-0.1.2-rc.1.exports.json')
const SCRATCH = join(ROOT, 'test', '.tmp-host-surface')

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
    `lib/index.js imports @deepseek-ai/dsh-llm symbols absent from the pinned 0.1.5-line host surface (captured from ${snapshot.capturedFrom}, ${[...host].length} exports) — the loader entry would die at ESM link time on such a host`)
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
    // Any version sharing the recorded surface works; the captured one keeps
    // this fixture independent of whatever the workspace happens to install.
    version: snapshot.capturedFrom,
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
    assert.fail(`plugin entry fails to load against the ${snapshot.capturedFrom} surface stub:\n${detail.trim()}`)
  }
  assert.match(stdout, /^PLUGIN-LINK-OK \d+/, 'plugin linked and evaluated against the host surface stub')
  rmSync(SCRATCH, { recursive: true, force: true })
}

// ── Block C: an older host gets an actionable compatibility error ──
{
  const built = readFileSync(BUILT_ENTRY, 'utf8')
  assert.doesNotMatch(built, /from\s*["']@deepseek-ai\/dsh-util-values["']/u,
    'the compatibility guard must run before any dependency absent from the rejected 0.1.2 line; keep deepEqualJson local')

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
    version: '0.1.2-rc.1',
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
  assert.notEqual(result.status, 0, 'an unsupported dsh 0.1.2 host must reject this plugin')
  assert.match(detail, /requires dsh >= 0\.1\.5-rc\.1/u,
    `old-host rejection must state the minimum supported dsh version:\n${detail.trim()}`)
  assert.match(detail, /npm install -g @deepseek-ai\/dsh@0\.1\.5-rc\.1/u,
    `old-host rejection must include an exact upgrade command:\n${detail.trim()}`)
  assert.doesNotMatch(detail, /ERR_MODULE_NOT_FOUND|Cannot find package/u,
    `old-host rejection must not leak a raw module-resolution failure:\n${detail.trim()}`)
  rmSync(SCRATCH, { recursive: true, force: true })
}

// ── Block D (always): the checked-in snapshot matches the installed host package ──
// The snapshot records the *seam surface* of the 0.1.5 host line plus the
// versions known to share it, not a single patch version: upstream re-cuts an
// RC with identical code (0.1.5-rc.2 changed nothing but version references),
// and a version-equality assertion would reject that for no reason. Membership
// stays explicit on purpose — meeting an unlisted version must force someone to
// compare surfaces and record the result rather than silently pass.
{
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
  const manifest = await import('@deepseek-ai/dsh-llm/package.json', { with: { type: 'json' } })
  const installedVersion = manifest.default.version
  assert.ok(snapshot.surfaceSharedBy.includes(installedVersion),
    `the resolved @deepseek-ai/dsh-llm is ${installedVersion}, which is not among the versions recorded as sharing this surface (${snapshot.surfaceSharedBy.join(', ')}). Compare its export surface against the snapshot, then either add the version or regenerate the snapshot.`)

  // The runtime namespace adds `default` to the named surface; the snapshot
  // records the named exports only, because Block B re-declares `default`.
  const live = new Set(Object.keys(await import('@deepseek-ai/dsh-llm')))
  live.delete('default')
  const snap = new Set(snapshot.exports)
  assert.deepEqual(
    { missingFromSnapshot: [...live].filter(n => !snap.has(n)).sort(), staleInSnapshot: [...snap].filter(n => !live.has(n)).sort() },
    { missingFromSnapshot: [], staleInSnapshot: [] },
    `test/fixtures/${SNAPSHOT_PATH.split('/').pop()} no longer matches the installed ${installedVersion} package — regenerate it`,
  )
  console.log(`host-compat: snapshot matches the installed published dsh-llm ${installedVersion} (surface shared by ${snapshot.surfaceSharedBy.join(', ')})`)
}

// ── Block E (always, offline): the entry still links on the REJECTED host line ──
// The friendly "upgrade the host" message comes from the entry's own version
// guard, which only runs after the module graph links. If a 0.1.5-only symbol
// ever enters the entry's static imports, a real 0.1.2 host gets a raw
// `SyntaxError: does not provide an export named …` instead — exactly the
// failure mode this repository exists to avoid. Blocks B and C cannot catch
// that: both build their stub from the 0.1.5 surface.
{
  const built = readFileSync(BUILT_ENTRY, 'utf8')
  const imported = namedImportsFrom(built, '@deepseek-ai/dsh-llm')
  assert.ok(imported.size > 0, 'no @deepseek-ai/dsh-llm named imports found in lib/index.js — block would pass vacuously')

  const rejected = JSON.parse(readFileSync(REJECTED_SNAPSHOT_PATH, 'utf8'))
  const rejectedSurface = new Set(rejected.exports)
  const missing = [...imported.keys()].filter(symbol => !rejectedSurface.has(symbol)).sort()
  assert.deepEqual(missing, [],
    `lib/index.js imports ${missing.join(', ')}, absent from the rejected ${rejected.version} host surface — such a host would die at ESM link time with a raw SyntaxError instead of the version guard's upgrade message. Either avoid the import, or drop the promise that ${rejected.version} is rejected cleanly (README + Block C).`)
  console.log(`host-compat: entry still links on the rejected ${rejected.version} surface (${rejectedSurface.size} exports)`)
}

console.log('host-compat: export gate + host-surface link fixture OK')
