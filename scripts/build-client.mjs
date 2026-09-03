/**
 * Build the browser half into lib/client.js as a closure-factory bundle:
 * `window.__ModuleLoader__.load({ id, factory: (require) => {...} })`, with
 * the loader module table supplying the platform externals (react + jsx
 * runtime). This mirrors the repository-internal `clientBundle` tsdown
 * preset (packages/client/tsdown.client.ts) and the browser module loader
 * contract (packages/client/modules/src/client/manifest.ts) of the dsh
 * 0.1.2-rc.1 line.
 */
import { build } from 'esbuild'

const ID = 'dsh-llm-newapi'

/**
 * Loader module-table specifiers: everything the bundle requires instead of
 * inlining. dsh 0.1.2-rc.1: the browser module table provides the shell seed
 * words (react, react/jsx-runtime, react-dom, react-dom/client, cordis,
 * client-store, ui-slots, ui-primitives) — see packages/client/web/src/
 * platform.ts. The section imports every dsh type face (`.../client`,
 * `/types`) type-only, so those are erased at bundle time and never become
 * require calls; only react and the jsx runtime stay as runtime externals.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
]

await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  outfile: 'lib/client.js',
  sourcemap: true,
  legalComments: 'none',
  external: CLIENT_EXTERNALS,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  banner: {
    js: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      'var module = { exports: {} }; var exports = module.exports;',
    ].join('\n'),
  },
  footer: { js: 'return module.exports; } });' },
})

console.log(`${ID}: wrote lib/client.js`)
