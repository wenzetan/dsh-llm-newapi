/**
 * Build the browser half into lib/client.js as a closure-factory bundle:
 * `window.__ModuleLoader__.load({ id, factory: (require) => {...} })`, with
 * the loader module table supplying the platform externals (react, cordis,
 * the dsh-client-* shell modules). This mirrors the repository-internal
 * `clientBundle` tsdown preset (packages/client/tsdown.client.ts), which is
 * not published; the format contract lives in ClientModuleRegistry's
 * `/plugins/<id>/client.js` serving and the browser module loader.
 */
import { build } from 'esbuild'

const ID = 'dsh-llm-newapi'

/** Loader module-table specifiers: everything the bundle requires instead of inlining. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
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
