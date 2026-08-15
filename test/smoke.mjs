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
import LlmRuntime, { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
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

// ── Block D: discovery ordering, display names, and the models.dev match ──
{
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FakeCredentials, { newapi: 'key-d' })
  await mountPlugin(ctx)

  // Discovery sorts by id and derives routed display names from the last path segment.
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    object: 'list',
    data: [
      { id: 'zhipu/glm-5.3' },
      { id: 'deepseek-chat' },
      { id: 'qwen/qwen-max', name: 'Qwen Max' },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  let discovered
  try {
    discovered = await ctx.llm.discoverModels('llm-newapi', { provider: 'newapi' })
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.deepEqual(discovered.map(m => m.id), ['deepseek-chat', 'qwen/qwen-max', 'zhipu/glm-5.3'])
  assert.equal(discovered.find(m => m.id === 'zhipu/glm-5.3').name, 'GLM 5.3[zhipu]')
  assert.equal(discovered.find(m => m.id === 'qwen/qwen-max').name, 'Qwen Max')

  // Name generation from ids: last / segment with the verbatim prefix in
  // brackets, dashes to spaces, first letters capitalized with brand
  // spellings, and a lone trailing letter reads as a size marker.
  const { modelNameFromId } = plugin
  assert.equal(modelNameFromId('deepseek-chat'), 'DeepSeek Chat')
  assert.equal(modelNameFromId('qwen3-32b'), 'Qwen3 32B')
  assert.equal(modelNameFromId('glm-4.5-air'), 'GLM 4.5 Air')
  assert.equal(modelNameFromId('zhipu/glm-4-flash'), 'GLM 4 Flash[zhipu]')
  assert.equal(modelNameFromId('llama-3.1-70b'), 'Llama 3.1 70B')
  assert.equal(modelNameFromId('deepseek-ai/deepseek-v4-flash'), 'DeepSeek V4 Flash[deepseek-ai]')
  assert.equal(modelNameFromId('openai/gpt-4o'), 'GPT 4o[openai]')

  // matchModelsDev: verbatim and last-segment keys, several providers kept;
  // effort-shaped reasoning_options surface as reasoningEfforts (nulls drop).
  const api = {
    qwen: { models: { 'qwen-max': { limit: { context: 262144, output: 32768 }, reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', null] }] } } },
    alibaba: { models: { 'qwen-max': { name: 'Qwen Max (DashScope)', limit: { context: 131072 }, reasoning_options: [{ type: 'toggle' }] } } },
    empty: {},
  }
  assert.deepEqual(plugin.matchModelsDev(api, 'qwen/qwen-max'), [
    { provider: 'qwen', contextWindow: 262144, maxTokens: 32768, reasoningEfforts: ['low', 'medium', 'high'] },
    { provider: 'alibaba', name: 'Qwen Max (DashScope)', contextWindow: 131072 },
  ])
  assert.deepEqual(plugin.matchModelsDev(api, 'unknown-model'), [])

  // A catalog row with efforts offers the selector, and an explicit effort
  // rides the wire as reasoning_effort.
  const resolveModelAdapter = new plugin.NewApiAdapter({
    options: () => ({
      baseURL: 'http://gw.local:3000/v1',
      apiKeyRef: 'newapi',
      models: [{ id: 'qwen3-32b', reasoningEfforts: ['low', 'high'] }],
      modelExcludePatterns: [],
      defaultContextWindow: 128_000,
      streamIdleTimeoutMs: 300_000,
      retryPolicy: resolveRetryPolicy(undefined, 'smoke'),
    }),
    resolveApiKey: async () => 'smoke-key',
  })
  const resolved = await resolveModelAdapter.resolveModel('newapi', 'qwen3-32b')
  assert.deepEqual(resolved.reasoning?.efforts.map(effort => effort.id), ['low', 'high'])
  const wired = plugin.serializeRequest({ model: 'qwen3-32b', messages: [], system: undefined, tools: undefined, reasoningEffort: 'high' })
  assert.equal(wired.reasoning_effort, 'high')
  assert.equal('reasoning_effort' in plugin.serializeRequest({ model: 'qwen3-32b', messages: [] }), false)

  // The settings write point refuses an enabled proxy with a non-http(s) url.
  await ctx.plugin(MemorySettings, {})
  await assert.rejects(
    ctx.settings.update(settingsNamespace('llm-newapi'), { proxy: { enabled: true, url: 'ftp://x' } }),
    (error) => error.message.includes('proxy.url must be an http(s) URL'),
  )
}

// ── Block E: the models-dev RPC channel registers once connection starts ──
{
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  // The plugin mounts BEFORE the connection service — exactly the ordering
  // that silently skipped the channel when it was read with an eager ctx.get.
  await mountPlugin(ctx)

  const registered = []
  class FakeConnection extends Service {
    constructor(child) { super(child, 'connection') }
    get rpc() {
      return {
        handle: (channel, handler, options) => {
          registered.push({ channel, handler, options })
          return () => Promise.resolve()
        },
      }
    }
  }
  await ctx.plugin(FakeConnection)

  // The inject scope ran as soon as the service appeared.
  assert.equal(registered.length, 1)
  assert.equal(registered[0].channel, '/llm-newapi')
  assert.equal(registered[0].options.authority, 'loopback')

  // Unknown endpoints answer the error envelope without any network use.
  const answer = await registered[0].handler('nope', {}, new AbortController().signal)
  assert.equal(answer.ok, false)
  assert.match(answer.error.message, /unknown endpoint nope/)

  // A failing catalog download answers the error envelope too — a thrown
  // handler would surface as an opaque HTTP 500 at the transport.
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('fetch failed', { cause: new Error('connect ENETUNREACH') }) }
  let failure
  try {
    failure = await registered[0].handler('models-dev-params', { modelIds: ['x'] }, new AbortController().signal)
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(failure.ok, false)
  assert.match(failure.error.message, /models\.dev catalog fetch failed/)
  assert.match(failure.error.message, /ENETUNREACH/)
  assert.match(failure.error.message, /enable the proxy/)
}

// ── Block F: a dead proxy names the proxy, not the direct route ──
{
  const adapter = new plugin.NewApiAdapter({
    options: () => ({
      baseURL: 'http://gw.local:3000/v1',
      apiKeyRef: 'newapi',
      models: [],
      modelExcludePatterns: [],
      defaultContextWindow: 128_000,
      streamIdleTimeoutMs: 300_000,
      retryPolicy: resolveRetryPolicy(undefined, 'smoke'),
    }),
    resolveApiKey: async () => 'smoke-key',
  })
  // Loopback port 1 has no listener: the ProxyAgent connect is refused
  // deterministically without any real network egress.
  await assert.rejects(
    adapter.fetchModelsDevParams(
      { modelIds: ['deepseek-chat'], proxyUrl: 'http://127.0.0.1:1' },
      new AbortController().signal,
    ),
    (error) => error.code === 'TRANSPORT'
      && error.message.includes('models.dev catalog fetch failed')
      && error.message.includes('the proxy at http://127.0.0.1:1 is unreachable')
      && !error.message.includes('enable the proxy'),
  )
}

console.log('smoke: llm-newapi registrations, chat-only discovery, credentials-service key, settings validation, ordering, display names, models.dev matching, deferred RPC channel, and dead-proxy diagnostics OK')
