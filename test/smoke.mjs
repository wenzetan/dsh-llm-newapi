/**
 * Composition smoke test: mount LlmRuntime + this plugin through a real
 * cordis Context (no network), then assert the provider-side registrations —
 * route registration, configurable-provider directory entry, and chat-only
 * discovery filtering over a stubbed gateway listing.
 */
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as plugin from '../lib/index.js'

const ctx = new Context()
await ctx.plugin(LlmRuntime)
// The object-plugin shape the cordis Loader assembles from this package's
// named exports (name/inject/Config/apply).
const fiber = await ctx.plugin({
  name: plugin.name,
  inject: plugin.inject,
  Config: plugin.Config,
  apply: plugin.apply,
}, {})

// Route registered under the fixed id with the NewAPI display name.
assert.deepEqual(
  ctx.llm.listProviders().map(provider => ({ id: provider.id, name: provider.name })),
  [{ id: 'newapi', name: 'NewAPI' }],
)

// Directory entry: declared gateway route addressing the plugin namespace.
const directory = ctx.llm.listConfigurableProviders()
assert.equal(directory.length, 1)
assert.equal(directory[0].provider, 'newapi')
assert.equal(directory[0].displayName, 'NewAPI')
assert.equal(directory[0].settingsNs, 'llm-newapi')
assert.deepEqual(directory[0].settingsPath, [])
assert.equal(directory[0].declared, true)

// Discovery filters non-chat families by id convention over a stubbed listing.
const originalFetch = globalThis.fetch
let askedUrl = ''
let askedAuth = ''
globalThis.fetch = async (url, init) => {
  askedUrl = String(url)
  askedAuth = new Headers(init?.headers).get('authorization') ?? ''
  return new Response(JSON.stringify({
    object: 'list',
    data: [
      { id: 'deepseek-chat' },
      { id: 'text-embedding-3-large' },
      { id: 'bge-reranker-v2-m3' },
      { id: 'Qwen/Reranker-Flash' },
      { id: 'gemini-2.5-pro' },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}
let discovered
try {
  discovered = await ctx.llm.discoverModels('llm-newapi', {
    baseURL: 'http://gw.local:3000/v1/',
    apiKey: 'smoke-key',
  })
} finally {
  globalThis.fetch = originalFetch
}

// The trailing slash is normalized; the one-shot credential rode as bearer.
assert.equal(askedUrl, 'http://gw.local:3000/v1/models')
assert.equal(askedAuth, 'Bearer smoke-key')
assert.deepEqual(
  discovered.map(model => model.id),
  ['deepseek-chat', 'gemini-2.5-pro'],
)

// HMR safety: disposing the fiber removes the route and the directory entry.
await fiber.dispose()
assert.deepEqual(ctx.llm.listProviders(), [])
assert.deepEqual(ctx.llm.listConfigurableProviders(), [])
console.log('smoke: llm-newapi registrations, chat-only discovery, and fiber disposal OK')
