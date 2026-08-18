/**
 * Composition smoke test: mount LlmRuntime + this plugin through real
 * cordis Contexts (no network), then assert the provider-side surface —
 * route registration, configurable-provider directory entry, chat-only
 * discovery filtering over a stubbed gateway listing, credential resolution
 * through the credentials service only (no environment fallback), and the
 * settings write point refusing sections the adapter cannot serve.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
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

  // matchModelsDev: exact keys first; built-in family hints flag the
  // official vendor's entry (glm→zai over zhipuai, claude→anthropic,
  // kimi→moonshotai, mimo→xiaomi), and a NEAR key inside the hinted vendor
  // matches a version the catalog does not carry yet.
  const api = {
    qwen: { models: { 'qwen-max': { limit: { context: 262144, output: 32768 }, reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', null] }] } } },
    alibaba: { models: { 'qwen-max': { name: 'Qwen Max (DashScope)', limit: { context: 131072 }, reasoning_options: [{ type: 'toggle' }] } } },
    zai: { models: { 'glm-5': { limit: { context: 200000, output: 131072 } } } },
    zhipuai: { models: { 'glm-5': { limit: { context: 200000, output: 131072 } } } },
    anthropic: { models: { 'claude-sonnet-5': { limit: { context: 200000, output: 64000 } } } },
    moonshotai: { models: { 'kimi-k3': { limit: { context: 256000, output: 65536 } } } },
    xiaomi: { models: { 'mimo-v2.5-pro': { limit: { context: 131072, output: 32768 } } } },
    digitalocean: { models: { 'mimo-v2.5-pro': { limit: { context: 131072, output: 32768 } } } },
    empty: {},
  }
  // qwen-max: the built-in qwen→alibaba hint leads with the official
  // vendor's entry; qwen's own catalog entry follows in exact-key order.
  const qwenMatches = plugin.matchModelsDev(api, 'qwen/qwen-max')
  assert.deepEqual(qwenMatches.map(m => m.provider), ['alibaba', 'qwen'])
  assert.equal(qwenMatches[0].official, true)
  assert.deepEqual(plugin.matchModelsDev(api, 'qwen-max')[1].reasoningEfforts, ['low', 'medium', 'high'])
  // glm-5.3 (not carried): only the hinted vendor's NEAR key (zai glm-5)
  // matches — near-matching stays inside the official vendor by design, so
  // zhipuai's same-id glm-5 is not dragged in as noise.
  const glm = plugin.matchModelsDev(api, 'glm-5.3')
  assert.equal(glm.length, 1)
  assert.equal(glm[0].provider, 'zai')
  assert.equal(glm[0].official, true)
  // claude-* → anthropic; kimi-* → moonshotai; mimo-* → xiaomi (flagged).
  assert.equal(plugin.matchModelsDev(api, 'claude-sonnet-5')[0].provider, 'anthropic')
  assert.equal(plugin.matchModelsDev(api, 'claude-sonnet-5')[0].official, true)
  assert.equal(plugin.matchModelsDev(api, 'kimi-k3')[0].provider, 'moonshotai')
  const mimo = plugin.matchModelsDev(api, 'mimo-v2.5-pro')
  assert.equal(mimo[0].provider, 'xiaomi')
  assert.equal(mimo[0].official, true)
  assert.equal(mimo[1].provider, 'digitalocean')
  // Deployment hints override: an exact-id hint reroutes to another vendor.
  const rerouted = plugin.matchModelsDev(api, 'glm-5.3', { models: { 'glm-5.3': 'zhipuai' } })
  assert.equal(rerouted.length, 1)
  assert.equal(rerouted[0].provider, 'zhipuai')
  assert.equal(rerouted[0].official, true)
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
  // No preset → the highest declared rung becomes the default.
  assert.equal(resolved.reasoning?.defaultEffort, 'high')
  const presetAdapter = new plugin.NewApiAdapter({
    options: () => ({
      baseURL: 'http://gw.local:3000/v1',
      apiKeyRef: 'newapi',
      models: [{ id: 'm1', reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' }],
      modelExcludePatterns: [],
      defaultContextWindow: 128_000,
      streamIdleTimeoutMs: 300_000,
      retryPolicy: resolveRetryPolicy(undefined, 'smoke'),
    }),
    resolveApiKey: async () => 'smoke-key',
  })
  // A preset inside the declared list wins over the highest rung.
  assert.equal((await presetAdapter.resolveModel('newapi', 'm1')).reasoning?.defaultEffort, 'low')
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

// ── Block H: registry-official matches lead when no hint applies ──
{
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FakeCredentials, { newapi: 'key-h' })
  // A built-in-style route that officially serves gwmax-1 — a bare id under
  // no built-in family prefix, so the registry channel (not the hint list)
  // is what can flag it.
  const officialAdapter = new plugin.NewApiAdapter({
    options: () => ({
      baseURL: 'http://official.local/v1',
      apiKeyRef: 'newapi',
      models: [{ id: 'gwmax-1' }],
      modelExcludePatterns: [],
      defaultContextWindow: 128_000,
      streamIdleTimeoutMs: 300_000,
      retryPolicy: resolveRetryPolicy(undefined, 'smoke'),
    }),
    resolveApiKey: async () => 'unused',
  })
  await ctx.plugin({ inject: ['llm'], apply: (c) => { c.llm.registerAdapter(['zeta'], officialAdapter) } })
  await mountPlugin(ctx)

  const channels = []
  class FakeConnectionH extends Service {
    constructor(child) { super(child, 'connection') }
    get rpc() {
      return {
        handle: (channel, handler) => {
          channels.push(handler)
          return () => Promise.resolve()
        },
      }
    }
  }
  await ctx.plugin(FakeConnectionH)

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    alpha: { models: { 'gwmax-1': { limit: { context: 131_072 } } } },
    zeta: { models: { 'gwmax-1': { limit: { context: 262_144, output: 32_768 } } } },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  let answer
  try {
    answer = await channels[0]('models-dev-params', { modelIds: ['gwmax-1'] }, new AbortController().signal)
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(answer.ok, true)
  const [first, second] = answer.value.models[0].matches
  // The registry-official route's provider leads and carries the flag;
  // catalog order (alpha first here) only orders the rest.
  assert.equal(first.provider, 'zeta')
  assert.equal(first.official, true)
  assert.equal(first.contextWindow, 262_144)
  assert.equal(second.provider, 'alpha')
  assert.equal(second.official, undefined)
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

// ── Block G: empty-string tool-call id/name deltas never clobber the call (issue #1) ──
// The qcplay gateway (glm-5.3) repeats `id`/`function.name` on every
// continuation delta as EMPTY strings instead of omitting the fields; a
// presence-only check overwrote the first delta's real tool name with '',
// so every tool call died as `unknown tool`. The stream path is exercised
// end to end — adapter.stream → fetch stub → parseSse → translate.
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

  // Verbatim issue shapes: real id/name only on the first delta, empty
  // strings on every continuation (one delta also repeats an empty id).
  const deltas = [
    { index: 0, id: 'call_5f62a3f002704343bf16a3d7', type: 'function', function: { name: 'get_time', arguments: '{"' } },
    { index: 0, type: 'function', function: { name: '', arguments: 'tz' } },
    { index: 0, id: '', type: 'function', function: { name: '', arguments: '":"Asia/Shanghai"}' } },
  ]
  const sse = [
    ...deltas.map(delta => `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [delta] } }] })}\n\n`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  let chunks
  try {
    chunks = []
    for await (const chunk of adapter.stream({
      model: 'glm-5.3',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'what time is it in Shanghai?' }] }],
    })) chunks.push(chunk)
  } finally {
    globalThis.fetch = originalFetch
  }

  const ended = chunks.filter(chunk => chunk.type === 'block-end')
  assert.equal(ended.length, 1)
  const block = ended[0].block
  assert.equal(block.type, 'tool-call')
  // The first delta's real identity survives the empty-string continuations.
  assert.equal(block.id, 'call_5f62a3f002704343bf16a3d7')
  assert.equal(block.name, 'get_time')
  assert.equal(block.arguments, '{"tz":"Asia/Shanghai"}')
  // No emitted delta ever carried the empty name: it would surface in the
  // composer's live tool-call rendering before the block ends.
  for (const chunk of chunks) {
    if (chunk.type === 'tool-call-delta') assert.ok(chunk.name !== '', 'delta name must not degrade to empty')
  }
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls')
}

// ── Block H (optional): real-catalog check against the local dev cache ──
// .cache/models-dev.api.json (npm run cache:models-dev, gitignored) carries
// the catalog's real field shapes; when present, matchModelsDev is exercised
// against it so schema drift in models.dev surfaces here first. Absent, the
// block skips — CI never has the cache.
{
  const CACHE = new URL('../.cache/models-dev.api.json', import.meta.url)
  if (!existsSync(CACHE)) {
    console.log('smoke: models.dev dev-cache absent — real-catalog check skipped (npm run cache:models-dev to enable)')
  } else {
    const api = JSON.parse(readFileSync(CACHE, 'utf8'))
    const { matchModelsDev } = plugin
    const gpt = matchModelsDev(api, 'openai/gpt-5.1')
    assert.ok(gpt.length >= 1, 'openai/gpt-5.1 matches the cached catalog')
    assert.ok(gpt.some(match => match.reasoningEfforts?.includes('low') && match.reasoningEfforts.includes('high')),
      'effort-shaped reasoning_options surface as reasoningEfforts')
    const chat = matchModelsDev(api, 'deepseek/deepseek-chat')
    assert.equal(chat[0].contextWindow, 1_000_000)
    const air = matchModelsDev(api, 'zhipuai/glm-4.5-air')
    assert.equal(air[0].maxTokens, 98_304)
    console.log('smoke: models.dev dev-cache check OK (real catalog shapes verified)')
  }
}

console.log('smoke: llm-newapi registrations, chat-only discovery, credentials-service key, settings validation, ordering, display names, models.dev matching, deferred RPC channel, dead-proxy diagnostics, and empty-string tool-call delta hardening OK')
