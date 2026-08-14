/**
 * Bundle the host half into lib/index.js (ESM, dependencies external — the
 * runtime provides them through the plugin package's own node_modules).
 * Types come from tsc (emitDeclarationOnly); this script owns the JavaScript.
 */
import { build } from 'esbuild'

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
