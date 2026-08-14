/**
 * Composition smoke test: mount LlmRuntime + this plugin through real
 * cordis Contexts (no network), then assert the provider-side surface —
 * route registration, configurable-provider directory entry, chat-only
 * discovery filtering over a stubbed gateway listing, credential resolution
 * through the credentials service only (no environment fallback), and the
 * settings write point refusing sections the adapter cannot serve.
 */
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SettingsProvider, { settingsNamespace } from '@deepseek-ai/dsh-settings'
import * as plugin from '../lib/index.js'

/** In-memory settings provider: the smallest real SettingsProvider subclass. */
class MemorySettings extends SettingsProvider {
  doc = {}

  constructor(ctx, options) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable() { return true }

  load() { return Promise.resolve(structuredClone(this.doc)) }

  async persist(ns, section) { this.doc[ns] = structuredClone(section) }
}

/** Minimal credentials service: resolve() only, from an in-memory store. */
class FakeCredentials extends Service {
  constructor(ctx, store) {
    super(ctx, 'credentials')
    this.store = store
  }

  resolve(ref) {
    return Promise.resolve(this.store[ref] === undefined
      ? undefined
      : { value: this.store[ref], source: 'store' })
  }
}

async function mountPlugin(ctx, config = {}) {
  return ctx.plugin({
    name: plugin.name,
    inject: plugin.inject,
    Config: plugin.Config,
    apply: plugin.apply,
  }, config)
}

/** Stub fetch to answer a models listing and record the request. */
function stubModelsListing() {
  const originalFetch = globalThis.fetch
  const asked = { url: '', auth: '' }
  globalThis.fetch = async (url, init) => {
    asked.url = String(url)
    asked.auth = new Headers(init?.headers).get('authorization') ?? ''
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
  return {
    asked,
    restore: () => { globalThis.fetch = originalFetch },
  }
}

// ── Block A: registration faces and chat-only discovery filtering ──
{
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const fiber = await mountPlugin(ctx)

  assert.deepEqual(
    ctx.llm.listProviders().map(provider => ({ id: provider.id, name: provider.name })),
    [{ id: 'newapi', name: 'NewAPI' }],
  )

  const directory = ctx.llm.listConfigurableProviders()
  assert.equal(directory.length, 1)
  assert.equal(directory[0].provider, 'newapi')
  assert.equal(directory[0].displayName, 'NewAPI')
  assert.equal(directory[0].settingsNs, 'llm-newapi')
  assert.deepEqual(directory[0].settingsPath, [])
  assert.equal(directory[0].declared, true)

  const { asked, restore } = stubModelsListing()
  let discovered
  try {
    discovered = await ctx.llm.discoverModels('llm-newapi', {
      baseURL: 'http://gw.local:3000/v1/',
      apiKey: 'smoke-key',
    })
  } finally {
    restore()
  }

  assert.equal(asked.url, 'http://gw.local:3000/v1/models')
  assert.equal(asked.auth, 'Bearer smoke-key')
  assert.deepEqual(
    discovered.map(model => model.id),
    ['deepseek-chat', 'gemini-2.5-pro'],
  )

  // HMR safety: disposing the fiber removes the route and the directory entry.
  await fiber.dispose()
  assert.deepEqual(ctx.llm.listProviders(), [])
  assert.deepEqual(ctx.llm.listConfigurableProviders(), [])
}

// ── Block B: the API key comes from the credentials service only ──
{
  // Without a credentials service there is no key anywhere: the request-time
  // failure names the settings page, not an environment variable.
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await mountPlugin(ctx)
  await assert.rejects(
    ctx.llm.discoverModels('llm-newapi', { baseURL: 'http://gw.local:3000/v1' }),
    (error) => error.code === 'MISSING_CREDENTIAL'
      && error.message.includes('NewAPI settings page')
      && !error.message.includes('export'),
  )

  // With the service holding the fixed 'newapi' reference, discovery rides
  // the stored value as the bearer token.
  const ctx2 = new Context()
  await ctx2.plugin(LlmRuntime)
  await ctx2.plugin(FakeCredentials, { newapi: 'stored-key' })
  await mountPlugin(ctx2)
  const { asked, restore } = stubModelsListing()
  try {
    const found = await ctx2.llm.discoverModels('llm-newapi', { provider: 'newapi' })
    assert.equal(found.length, 2)
  } finally {
    restore()
  }
  assert.equal(asked.auth, 'Bearer stored-key')
}

// ── Block C: the settings write point refuses unserviceable sections ──
{
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MemorySettings, {})
  await ctx.plugin(FakeCredentials, { newapi: 'block-c-key' })
  await mountPlugin(ctx)

  // A schema-valid but unserviceable baseURL rejects at the write, so it can
  // never store and silently pin the adapter to the last good facts.
  await assert.rejects(
    ctx.settings.update(settingsNamespace('llm-newapi'), { baseURL: 'not-a-url' }),
    (error) => error.message.includes('baseURL must be an absolute http(s) URL'),
  )

  // A serviceable section commits and the very next discovery uses it.
  await ctx.settings.update(settingsNamespace('llm-newapi'), { baseURL: 'http://settings-gw:9000/v1' })
  const { asked, restore } = stubModelsListing()
  try {
    const found = await ctx.llm.discoverModels('llm-newapi', { provider: 'newapi' })
    assert.equal(found.length, 2)
  } finally {
    restore()
  }
  assert.equal(asked.url, 'http://settings-gw:9000/v1/models')
}

console.log('smoke: llm-newapi registrations, chat-only discovery, credentials-service key, settings validation, and fiber disposal OK')
