/**
 * Register a {@link NewApiAdapter} for the `newapi` provider route on
 * `ctx.llm`, with connection facts resolved per request instead of frozen at
 * load: the plugin reads its own volatile config references (the profile
 * patch and the web settings page write them through the settings service)
 * and resolves the API key through the optional credential seam
 * (`ctx.credentials`), so a changed base URL, catalog, or key reaches the
 * very next request without re-applying the plugin, while an in-flight stream
 * keeps the facts it started with. The one registration-captured fact — the
 * retry policy — re-registers the route in place when it changes. The plugin
 * also serves model discovery for the `llm-newapi` settings namespace by
 * interrogating `GET {baseURL}/models`.
 * @module dsh-llm-newapi
 */

import type { Context, VolatileSnapshot } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmError, resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import llmManifest from '@deepseek-ai/dsh-llm/package.json' with { type: 'json' }
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
// Type-only: pulls the cordis Context merge that adds the `settings`
// service (ctx.settings.configure) into this program.
import type {} from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MODEL_EXCLUDE_PATTERNS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  NewApiAdapter,
  normalizeBaseUrl,
  PKG,
} from './adapter.ts'
import type { NewApiCatalogModel, NewApiConnectionOptions } from './adapter.ts'
import type { ModelsDevParamsRequest, ProviderHints } from './types.ts'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'

export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MODEL_EXCLUDE_PATTERNS,
  DEFAULT_PROVIDER_HINTS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  matchModelsDev,
  modelNameFromId,
  NewApiAdapter,
  normalizeBaseUrl,
  PKG,
} from './adapter.ts'
export { serializeRequest } from './serialize.ts'
export type { NewApiAdapterOptions, NewApiCatalogModel, NewApiConnectionOptions } from './adapter.ts'
export type * from './types.ts'

const MINIMUM_DSH_VERSION = '0.2.0-rc.2'

type SemverIdentifier = number | string
interface ParsedSemver {
  core: [number, number, number]
  prerelease?: SemverIdentifier[]
}

function parseSemver(version: string): ParsedSemver | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(version)
  if (match === null) return undefined
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  const prerelease = match[4]?.split('.').map(part => /^\d+$/u.test(part) ? Number(part) : part)
  return prerelease === undefined ? { core: [major, minor, patch] } : { core: [major, minor, patch], prerelease }
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  const [leftMajor, leftMinor, leftPatch] = left.core
  const [rightMajor, rightMinor, rightPatch] = right.core
  for (const difference of [leftMajor - rightMajor, leftMinor - rightMinor, leftPatch - rightPatch]) {
    if (difference !== 0) return difference
  }
  if (left.prerelease === undefined) return right.prerelease === undefined ? 0 : 1
  if (right.prerelease === undefined) return -1
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === undefined) return rightPart === undefined ? 0 : -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    if (typeof leftPart === 'number' && typeof rightPart === 'number') return leftPart - rightPart
    if (typeof leftPart === 'number') return -1
    if (typeof rightPart === 'number') return 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

function isSupportedHostVersion(version: string): boolean {
  const actual = parseSemver(version)
  const minimum = parseSemver(MINIMUM_DSH_VERSION)
  return actual !== undefined && minimum !== undefined && compareSemver(actual, minimum) >= 0
}

const hostLlmVersion = typeof llmManifest.version === 'string' ? llmManifest.version : 'unknown'
if (!isSupportedHostVersion(hostLlmVersion)) {
  throw new Error(
    `dsh-llm-newapi requires dsh >= ${MINIMUM_DSH_VERSION} ` +
    `(host ships @deepseek-ai/dsh-llm ${hostLlmVersion}); ` +
    `upgrade the host: npm install -g @deepseek-ai/dsh@${MINIMUM_DSH_VERSION}`,
  )
}

/** Compare JSON-compatible values structurally without requiring a new host package. */
function deepEqualJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((entry, index) => deepEqualJson(entry, right[index]))
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  if (keys.length !== Object.keys(rightRecord).length) return false
  return keys.every(key => key in rightRecord && deepEqualJson(leftRecord[key], rightRecord[key]))
}

export const name = 'llm-newapi'
export const inject = ['llm']

const NS = 'llm-newapi'
/**
 * Fixed credential reference for the gateway API key. Deliberately not an
 * environment-variable-style name: the inherited process environment is the
 * credentials service's read-only top layer, so an `NEWAPI_API_KEY`-style
 * ref would let a stray exported variable shadow the web-stored key and lock
 * the settings input read-only. `newapi` names the route, and the web
 * settings page is the one configuration surface for the value.
 */
const API_KEY_REF = 'newapi'
/** Environment variable naming this provider's endpoint, honored only from trusted layers. */
const BASE_URL_ENV = 'NEWAPI_BASE_URL'
/** Placeholder gateway base used when neither config nor environment names one. */
export const DEFAULT_BASE_URL = 'https://newapi.example.com/v1'
/** The single provider route this plugin owns. */
const PROVIDER = 'newapi'

/**
 * Plugin config values, validated by the same-named schemastery schema and
 * doubling as the `llm-newapi` settings-section shape. Every field is
 * optional in yml: `baseURL` falls back to $NEWAPI_BASE_URL from a trusted
 * environment layer, then the placeholder {@link DEFAULT_BASE_URL} — a
 * request against the placeholder fails as TRANSPORT at first use, naming the
 * endpoint to fix. The API key is not a config value at all: it lives in the
 * credentials store under the fixed reference `newapi` (the web settings
 * page writes it), and a request without any stored key fails with
 * `MISSING_CREDENTIAL`, not at plugin load.
 *
 * This is the plain-value shape a composition entry or programmatic caller
 * writes; the running plugin reads the schema-derived {@link Config} whose
 * volatile fields are references (see {@link snapshotConfig}).
 */
export interface NewApiConfig {
  /** Gateway base including the `/v1` prefix; defaults to $NEWAPI_BASE_URL from a trusted layer, then the placeholder `https://newapi.example.com/v1`. */
  baseURL?: string
  /** Advisory models shown by discovery consumers; defaults to none — a gateway's model set is deployment-specific. */
  models?: NewApiCatalogModel[]
  /**
   * Case-insensitive id substrings excluding discovered models that cannot
   * serve chat completions (embedding, rerank, ranker families). Replaces the
   * default {@link DEFAULT_MODEL_EXCLUDE_PATTERNS} list; an empty array
   * disables filtering. The hand-curated {@link models} catalog is unaffected.
   */
  modelExcludePatterns?: string[]
  /** Positive context capacity used when the selected model has no exact value (default 128,000). */
  defaultContextWindow?: number
  /** Default per-request output cap; omission sends no cap and lets each upstream default apply. */
  maxTokens?: number
  /** Maximum gateway idle time while one stream read is outstanding (default five minutes). */
  streamIdleTimeoutMs?: number
  /** Forward proxy for the models.dev catalog download performed by the「更新模型信息」action. */
  proxy?: ProxyConfig
  /**
   * Match-shaping hints for the models.dev params lookup: family prefixes
   * and exact ids name which catalog provider counts as official (leading
   * match, flagged). Built-in families (glm→zai, gpt→openai, claude→
   * anthropic, …) apply first; these entries override and extend them.
   */
  providerHints?: ProviderHints
  /** Provider-owned model-request retry policy; omission uses normal defaults. */
  retryPolicy?: RetryPolicyConfig
}

/** Forward-proxy settings for the models.dev catalog download. */
export interface ProxyConfig {
  /** Whether the proxy is used; defaults to false. */
  enabled?: boolean
  /** Proxy URL; presets default to `http://127.0.0.1:7890`. */
  url?: string
}

const catalogModel: z<NewApiCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  reasoningEfforts: z.array(z.string()),
  defaultReasoningEffort: z.string(),
})

/** Default forward proxy: the conventional Clash port on loopback. */
export const DEFAULT_PROXY_URL = 'http://127.0.0.1:7890'

/**
 * Report a resolver error as a schema issue. The settings write point
 * validates the full Config through this schema before persisting, so an
 * unserviceable value has to fail here to be refused instead of stored.
 * Schemastery calls a transform callback with the value only, so the issue
 * carries no path; every message below already names its field.
 * @param error - the resolver error, whose message already names the field.
 * @returns a ValidationError carrying that message.
 */
function asValidationError(error: unknown): Error {
  return new z.ValidationError(error instanceof Error ? error.message : String(error), { path: [] })
}

/** A configured base URL: blank passes (resolved later), a typed value must already be usable. */
const baseURLField = z.transform(z.string(), (value) => {
  if (value.trim().length === 0) return value
  try {
    normalizeBaseUrl(value)
  } catch (error) {
    throw asValidationError(error)
  }
  return value
})

/** The models.dev download proxy; the URL is judged only while the proxy is enabled. */
const proxyField = z.transform(z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(DEFAULT_PROXY_URL),
}), (value): ProxyConfig => {
  // The inner schema has already normalized both fields; the nullable input
  // type only mirrors what validate() accepts.
  const enabled = value.enabled === true
  const url = typeof value.url === 'string' ? value.url : DEFAULT_PROXY_URL
  // Only judged while enabled: a stored disabled proxy with a stale URL
  // must not fail the whole section.
  if (enabled) {
    let protocol: string | undefined
    try {
      protocol = new URL(url).protocol
    } catch {
      // Reported below as the absolute-URL failure.
    }
    if (protocol === undefined) {
      throw asValidationError(new Error(`${PKG}: proxy.url must be an absolute URL (got: ${url})`))
    }
    if (!/^https?:$/.test(protocol)) {
      throw asValidationError(new Error(`${PKG}: proxy.url must be an http(s) URL (got: ${url})`))
    }
  }
  return { enabled, url }
})

/** The advisory catalog; the same entry checks the resolver re-judges at runtime. */
const modelsField = z.transform(z.array(catalogModel).default([]), (value) => {
  try {
    resolveModels(value)
  } catch (error) {
    throw asValidationError(error)
  }
  return value
})

/** Exclude patterns; an empty entry would filter nothing yet read as configured. */
const excludePatternsField = z.transform(
  z.array(z.string()).default([...DEFAULT_MODEL_EXCLUDE_PATTERNS]),
  (value) => {
    for (const pattern of value) {
      if (pattern.length === 0) {
        throw asValidationError(new Error(`${PKG}: modelExcludePatterns entries must be non-empty`))
      }
    }
    return value
  },
)

const configSchema = z.object({
  baseURL: baseURLField.volatile(),
  models: modelsField.volatile(),
  modelExcludePatterns: excludePatternsField.volatile(),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW).volatile(),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).volatile(),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS).volatile(),
  proxy: proxyField.volatile(),
  providerHints: z.object({
    defaults: z.object({}),
    models: z.object({}),
  }).volatile(),
  retryPolicy: RetryPolicySchema.volatile(),
})

/**
 * The plugin config schema. Every field is volatile: the settings form edits
 * them through the active profile patch, and the Loader commits a
 * volatile-only edit into the running config references without re-applying
 * the plugin, so the next resolution sees it. Field-level checks live here —
 * not only in the resolver — because the settings write point validates this
 * exact schema before persisting, and the resolver re-judges every bound for
 * programmatic construction.
 */
export const Config = configSchema

/**
 * The config a running plugin instance holds: schemastery replaced every
 * volatile field with a stable reference, updated in place by the Loader.
 * Read plain values through {@link snapshotConfig}; the exported
 * {@link NewApiConfig} is the plain-value shape callers write.
 */
export type Config = ReturnType<typeof configSchema>

/**
 * Restore the plain type of one volatile snapshot. At runtime a snapshot is
 * the schema output; the mapped `VolatileSnapshot` type only obscures array
 * methods and adds optionality, so this is a type-level recovery, not a
 * conversion.
 * @param snapshot - the reference's current snapshot, possibly absent.
 * @returns the same value typed as the schema output, possibly absent.
 */
function plain<T>(snapshot: VolatileSnapshot<T> | undefined): T | undefined {
  return snapshot as T | undefined
}

/**
 * Read the current plain values from the running config's volatile
 * references. The references are updated in place on a volatile-only commit,
 * so this always returns the latest committed generation without re-applying
 * the plugin.
 * @param config - the config object this plugin instance was applied with.
 * @returns the plain values the resolver consumes.
 */
function snapshotConfig(config: Config): NewApiConfig {
  const baseURL = plain<string>(config.baseURL.get())
  const maxTokens = plain<number>(config.maxTokens.get())
  const providerHints = plain<ProviderHints>(config.providerHints.get())
  const retryPolicy = plain<RetryPolicyConfig>(config.retryPolicy.get())
  return {
    ...baseURL === undefined ? {} : { baseURL },
    models: plain<NewApiCatalogModel[]>(config.models.get()) ?? [],
    modelExcludePatterns:
      plain<string[]>(config.modelExcludePatterns.get()) ?? [...DEFAULT_MODEL_EXCLUDE_PATTERNS],
    defaultContextWindow: plain<number>(config.defaultContextWindow.get()) ?? DEFAULT_CONTEXT_WINDOW,
    ...maxTokens === undefined ? {} : { maxTokens },
    streamIdleTimeoutMs:
      plain<number>(config.streamIdleTimeoutMs.get()) ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    proxy: plain<ProxyConfig>(config.proxy.get()) ?? { enabled: false, url: DEFAULT_PROXY_URL },
    ...providerHints === undefined ? {} : { providerHints },
    ...retryPolicy === undefined ? {} : { retryPolicy },
  }
}

/**
 * One resolution's complete request facts. Connection and credential facts
 * are one value on purpose: a snapshot the resolver rejects keeps the whole
 * previous generation, so a request can never pair a stale endpoint with a
 * newer key.
 */
export type ResolvedNewApiOptions = NewApiConnectionOptions

/** Resolve, validate, and detach the advisory model catalog. */
function resolveModels(models: readonly NewApiCatalogModel[] | undefined): NewApiCatalogModel[] {
  const seen = new Set<string>()
  return (models ?? []).map((model) => {
    if (model.id.length === 0) throw new Error(`${PKG}: catalog model ids must be non-empty`)
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`${PKG}: catalog model "${model.id}" has an empty name`)
    }
    if (model.contextWindow !== undefined
      && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `${PKG}: catalog model "${model.id}" contextWindow must be a positive integer`,
      )
    }
    if (model.maxTokens !== undefined
      && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `${PKG}: catalog model "${model.id}" maxTokens must be a positive integer`,
      )
    }
    if (seen.has(model.id)) throw new Error(`${PKG}: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    for (const effort of model.reasoningEfforts ?? []) {
      if (effort.length === 0) throw new Error(`${PKG}: catalog model "${model.id}" has an empty reasoning effort`)
    }
    if (model.defaultReasoningEffort !== undefined
      && !(model.reasoningEfforts ?? []).includes(model.defaultReasoningEffort)) {
      throw new Error(
        `${PKG}: catalog model "${model.id}" default reasoning effort "${model.defaultReasoningEffort}" is not among its reasoning efforts`,
      )
    }
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      ...model.reasoningEfforts === undefined || model.reasoningEfforts.length === 0 ? {} : { reasoningEfforts: model.reasoningEfforts },
      ...model.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: model.defaultReasoningEffort },
    }
  })
}

/**
 * The one explicit resolve step from raw config to validated connection
 * facts. Programmatic construction may bypass Schemastery normalization, so
 * every default and bound is re-judged here — for the composition entry at
 * load (fail loud) and for each settings snapshot at its first use.
 * @param config - plain plugin config values (a composition entry, or a
 * {@link snapshotConfig} of the running volatile references).
 * @param environment - this run's environment layers, or `undefined` outside
 * the product CLI. A trusted layer may supply the gateway endpoint.
 * @returns validated connection facts plus the credential reference.
 */
export function resolveAdapterOptions(config: NewApiConfig, environment?: ReturnType<typeof launchEnvironmentOf>): ResolvedNewApiOptions {
  // Absent everywhere is the placeholder, not a load failure: the plugin stays
  // mountable so configuration surfaces can offer the route, and a request
  // against the placeholder fails as TRANSPORT at first use, naming the
  // endpoint to fix. A value someone actually typed must still be a usable
  // http(s) URL, which normalizeBaseUrl enforces below.
  const named = config.baseURL !== undefined && config.baseURL.trim().length > 0
    ? config.baseURL
    : environment?.get(BASE_URL_ENV)?.value
  const rawBase = named !== undefined && named.trim().length > 0 ? named : DEFAULT_BASE_URL
  const modelExcludePatterns = config.modelExcludePatterns ?? [...DEFAULT_MODEL_EXCLUDE_PATTERNS]
  for (const pattern of modelExcludePatterns) {
    if (pattern.length === 0) throw new Error(`${PKG}: modelExcludePatterns entries must be non-empty`)
  }
  if (config.defaultContextWindow !== undefined
    && (!Number.isInteger(config.defaultContextWindow) || config.defaultContextWindow <= 0)) {
    throw new Error(`${PKG}: defaultContextWindow must be a positive integer`)
  }
  if (config.maxTokens !== undefined
    && (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0)) {
    throw new Error(`${PKG}: maxTokens must be a positive safe integer`)
  }
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `${PKG}: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  const defaultContextWindow = config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW
  const proxyEnabled = config.proxy?.enabled === true
  const proxyUrlRaw = config.proxy?.url ?? DEFAULT_PROXY_URL
  if (proxyEnabled) {
    // Only judged while enabled: a stored disabled proxy with a stale URL
    // must not fail the whole section.
    try { new URL(proxyUrlRaw) } catch {
      throw new Error(`${PKG}: proxy.url must be an absolute URL (got: ${proxyUrlRaw})`)
    }
    if (!/^https?:$/.test(new URL(proxyUrlRaw).protocol)) {
      throw new Error(`${PKG}: proxy.url must be an http(s) URL (got: ${proxyUrlRaw})`)
    }
  }
  return {
    baseURL: normalizeBaseUrl(rawBase),
    apiKeyRef: credentialRef(API_KEY_REF),
    models: resolveModels(config.models),
    modelExcludePatterns,
    defaultContextWindow,
    streamIdleTimeoutMs,
    ...proxyEnabled ? { proxyUrl: proxyUrlRaw } : {},
    providerHints: {
      defaults: { ...config.providerHints?.defaults },
      models: { ...config.providerHints?.models },
    },
    retryPolicy: resolveRetryPolicy(config.retryPolicy, `${PKG}: retryPolicy`),
    ...config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens },
  }
}

export function apply(ctx: Context, config: Config): void {
  let lastRaw: NewApiConfig | undefined
  let lastGood: ResolvedNewApiOptions | undefined
  let registration: AdapterRegistrationHandle | undefined
  let registeredPolicy: ResolvedNewApiOptions['retryPolicy'] | undefined
  const options = (): ResolvedNewApiOptions => {
    // Volatile references are updated in place, so every read re-snapshots;
    // the deep compare keeps one resolution per unchanged generation.
    const raw = snapshotConfig(config)
    if (lastGood !== undefined && deepEqualJson(raw, lastRaw)) return lastGood
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx))
      lastRaw = raw
      lastGood = next
      // The registry captures the retry policy at registration, so it is the
      // one fact per-request resolution cannot refresh. `replace` re-reads it
      // in one synchronous registry section: disposing and re-registering
      // instead would publish an empty route set between the two, and an
      // observer that reacted to it would see this provider disappear and
      // come back.
      if (registration !== undefined && !deepEqualJson(next.retryPolicy, registeredPolicy)) {
        registration.replace([PROVIDER])
        registeredPolicy = next.retryPolicy
      }
      return next
    } catch (error) {
      // The schema refuses unserviceable values at the write point, so this
      // branch only sees a generation that bypassed it (programmatic config,
      // an invalid environment-supplied baseURL): keep serving the last good
      // facts and say so once per bad generation.
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error(`${PKG}: keeping the last good configuration after an invalid configuration generation`)
      ctx.logger.error(error)
      return lastGood
    }
  }
  options()

  const resolveApiKey = async (connection: ResolvedNewApiOptions): Promise<string> => {
    // Every credential fact comes from the caller's snapshot, so a rejected
    // settings generation cannot leak its key onto the previous endpoint.
    // The credentials store is the only source: the web settings page owns
    // the value, and this plugin deliberately reads no environment variable
    // for it (a stray export must not shadow a web-configured key).
    const ref = connection.apiKeyRef
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, PKG, ref)
    }
    throw new LlmError(
      `${PKG}: no API key for provider route "${PROVIDER}"; configure it on the NewAPI`
        + ` settings page in dsh web (credentials reference "${ref}")`,
      'MISSING_CREDENTIAL',
    )
  }

  // Official-vendor index for the models.dev params panel: model id → the
  // provider route that serves it officially, read from every OTHER route
  // registered on ctx.llm (the built-in catalogs are the authority — e.g.
  // deepseek-v4-flash under the deepseek route). Rebuilt when the set of
  // routes changes; a route that fails to list models is no authority.
  let indexCache: { routes: string; byModel: Map<string, string> } | undefined
  const officialProviderOf = async (modelId: string): Promise<string | undefined> => {
    const routes = ctx.llm.listProviders().map(provider => provider.id).sort().join(',')
    if (indexCache === undefined || indexCache.routes !== routes) {
      const byModel = new Map<string, string>()
      for (const provider of ctx.llm.listProviders()) {
        if (provider.id === PROVIDER) continue
        try {
          for (const model of await ctx.llm.listModels(provider.id)) {
            byModel.set(model.id, provider.id)
          }
        } catch {
          // An unlistable route contributes nothing; other routes still can.
        }
      }
      indexCache = { routes, byModel }
    }
    return indexCache.byModel.get(modelId)
  }

  const adapter = new NewApiAdapter({ options, resolveApiKey, officialProviderOf })
  ctx.llm.registerConfigurableProviders([
    {
      provider: PROVIDER,
      displayName: 'NewAPI',
      settingsNs: NS,
      settingsPath: [],
      // The adapter knows this route only because configuration declared it:
      // a self-hosted gateway it ships nothing about.
      declared: true,
    },
  ])
  // Route effects bind to this apply fiber via the stable `ctx` reference.
  registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  registeredPolicy = options().retryPolicy
  // Model discovery for the settings namespace this plugin owns: the Models
  // page interrogates the gateway's /models with the draft's endpoint and
  // one-shot credential, or the current snapshot's facts. The runtime hands
  // caller cancellation as a separate signal.
  ctx.llm.registerModelDiscovery(NS, (request, signal) => adapter.discoverModels(request, signal))

  // Host-side endpoint for the「更新模型信息」action: the browser names
  // the gateway model ids (and optionally the proxy draft) and the host
  // downloads https://models.dev/api.json — no cross-origin fetch happens in
  // the browser, and a plain HTTP forward proxy works because Node performs
  // the request.
  //
  // The channel goes through the connection service's own `register(owner,
  // channel, handler)` rather than the `rpc.handle(channel, handler)` the
  // type advertises. On the 0.1.7 host line `handle` is still unusable: its
  // `rpc` getter captures `this.ctx`, and that captured context is the
  // connection service's own scope, which has no `webServer` injected.
  // `register` then evaluates `owner.webServer.register(route)`, cordis
  // answers `cannot get property "webServer" without inject`, and the throw is
  // swallowed by the effect — so the channel silently never appears and the
  // browser meets the SPA fallback's 405 (the boot check catches exactly
  // this). Passing our own inject-scope context as the owner fixes it, and
  // `register` is the very method `rpc.handle` delegates to. No upstream
  // plugin calls `rpc.handle`; `dsh-api-gateway` injects this same
  // `connection` + `webServer` pair for the work that does touch `webServer`.
  //
  // Both services are injected so registration waits for each to exist and
  // re-runs if either reloads.
  ctx.inject(['connection', 'webServer'], (cctx) => {
    const connection = cctx.get('connection') as HostConnectionHandle
    // The owner-taking overload is on the service prototype but not on
    // `HostConnectionHandle`, so the extra shape is declared here.
    const registrar = connection as unknown as {
      register(
        owner: unknown,
        channel: string,
        handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
      ): () => Promise<void>
    }
    cctx.effect(() => registrar.register(
      cctx,
      '/llm-newapi',
      (endpoint: string, payload: unknown, signal: AbortSignal) => {
        if (endpoint !== 'models-dev-params') {
          return Promise.resolve({
            ok: false as const,
            error: { code: 'internal' as const, message: `llm-newapi: unknown endpoint ${endpoint}`, details: {} },
          })
        }
        const request = payload as ModelsDevParamsRequest
        // Failures answer as the error envelope, never a thrown value: the
        // transport maps a thrown handler to an opaque HTTP 500, which hides
        // the actual reason (unreachable endpoint, dead proxy) from the
        // settings page that asked.
        return adapter.fetchModelsDevParams(request, signal)
          .then(value => ({ ok: true as const, value }))
          .catch((error: unknown) => ({
            ok: false as const,
            error: {
              code: 'internal' as const,
              message: error instanceof Error ? error.message : String(error),
              details: {},
            },
          }))
      },
    ), 'llm-newapi: models-dev RPC channel')
  })

  // Settings presentation policy (0.1.7 seam): configuration now projects
  // from this plugin's own profile entry, whose Config schema marks every
  // field volatile — the Loader commits a volatile-only edit into the running
  // references, and the write point validates the full Config before
  // persisting. This plugin ships its own Web page (the browser half registers
  // the `settings.section`), so it opts out of schema-generated pages; the
  // child names this plugin's fiber, and a late-loading or replaced Settings
  // service picks the policy up.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
