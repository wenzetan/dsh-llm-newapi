/**
 * Bundle the host half into lib/index.js (ESM, dependencies external — the
 * runtime provides them through the plugin package's own node_modules).
 * Types come from tsc (emitDeclarationOnly); this script owns the JavaScript
 * and rewrites the declaration emit's `.ts` specifiers (see below).
 */
import { build } from 'esbuild'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: 'lib/index.js',
  sourcemap: true,
  packages: 'external',
})

console.log('dsh-llm-newapi: wrote lib/index.js')

// The sources import siblings with explicit `.ts` extensions
// (allowImportingTsExtensions), and rewriteRelativeImportExtensions does not
// apply to declaration-only emit — the .d.ts files would keep pointing at
// `./x.ts`, which does not exist next to them and breaks type resolution for
// consumers of the published entry. Rewrite relative `.ts` specifiers to
// `.js`: TypeScript resolves `./x.js` to `./x.d.ts` next to it.
const TYPES_DIR = 'lib/types'
const SPECIFIER = /((?:from|import)\s*\(?\s*)'(\.{1,2}\/[^']+?)\.ts'/g
for (const name of await readdir(TYPES_DIR)) {
  if (!name.endsWith('.d.ts')) continue
  const file = join(TYPES_DIR, name)
  const source = await readFile(file, 'utf8')
  const rewritten = source.replace(SPECIFIER, "$1'$2.js'")
  if (rewritten !== source) {
    await writeFile(file, rewritten)
    console.log(`dsh-llm-newapi: rewrote .ts specifiers in ${file}`)
  }
}
