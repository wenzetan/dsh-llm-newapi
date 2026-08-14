/**
 * Register a {@link NewApiAdapter} for the `newapi` provider route on
 * `ctx.llm`, with connection facts resolved per request instead of frozen at
 * load: the plugin layers its `cordis.yml` entry config under the optional
 * `llm-newapi` user-settings section (`ctx.settings`) and resolves the API
 * key through the optional credential seam (`ctx.credentials`), so a changed
 * base URL, catalog, or key reaches the very next request without restarting
 * anything, while an in-flight stream keeps the facts it started with. The
 * one registration-captured fact — the retry policy — re-registers the route
 * in place when it changes. The plugin also serves model discovery for the
 * `llm-newapi` settings namespace by interrogating `GET {baseURL}/models`.
 * @module dsh-llm-newapi
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmError, resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
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
import type { ModelsDevParamsRequest } from './types.ts'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'

export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MODEL_EXCLUDE_PATTERNS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  matchModelsDev,
  NewApiAdapter,
  normalizeBaseUrl,
  PKG,
} from './adapter.ts'
export type { NewApiAdapterOptions, NewApiCatalogModel, NewApiConnectionOptions } from './adapter.ts'
export type * from './types.ts'

export const name = 'llm-newapi'
export const inject = ['llm']

const NS = settingsNamespace('llm-newapi')
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
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-newapi` settings-section shape. Every field is optional in
 * yml: `baseURL` falls back to $NEWAPI_BASE_URL from a trusted environment
 * layer, then the placeholder {@link DEFAULT_BASE_URL} — a request against
 * the placeholder fails as TRANSPORT at first use, naming the endpoint to
 * fix. The API key is not a config value at all: it lives in the
 * credentials store under the fixed reference `newapi` (the web settings
 * page writes it), and a request without any stored key fails with
 * `MISSING_CREDENTIAL`, not at plugin load.
 */
export interface Config {
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
  /**
   * Forward proxy for the models.dev catalog download performed by the
   *「更新模型信息」action: disabled by default; when enabled, that one
   * request is routed through `proxy.url` (a plain HTTP forward proxy).
   * Gateway traffic is untouched.
   */
  proxy?: ProxyConfig
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
})

/** Default forward proxy: the conventional Clash port on loopback. */
export const DEFAULT_PROXY_URL = 'http://127.0.0.1:7890'

const proxySchema: z<ProxyConfig> = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(DEFAULT_PROXY_URL),
})

export const Config: z<Config> = z.object({
  baseURL: z.string(),
  models: z.array(catalogModel).default([]),
  modelExcludePatterns: z.array(z.string()).default([...DEFAULT_MODEL_EXCLUDE_PATTERNS]),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  proxy: proxySchema.default({ enabled: false, url: DEFAULT_PROXY_URL }),
  retryPolicy: RetryPolicySchema,
})

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
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    }
  })
}

/**
 * The one explicit resolve step from raw config to validated connection
 * facts. Programmatic construction may bypass Schemastery normalization, so
 * every default and bound is re-judged here — for the composition entry at
 * load (fail loud) and for each settings snapshot at its first use.
 * @param config - raw plugin config or resolved settings snapshot.
 * @param environment - this run's environment layers, or `undefined` outside
 * the product CLI. A trusted layer may supply the gateway endpoint.
 * @returns validated connection facts plus the credential reference.
 */
export function resolveAdapterOptions(config: Config, environment?: ReturnType<typeof launchEnvironmentOf>): ResolvedNewApiOptions {
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
    retryPolicy: resolveRetryPolicy(config.retryPolicy, `${PKG}: retryPolicy`),
    ...config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens },
  }
}

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastGood: ResolvedNewApiOptions | undefined
  const options = (): ResolvedNewApiOptions => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx))
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      // Static composition resolves before anything registers, so this branch
      // only sees a live settings snapshot failing a beyond-schema bound:
      // keep serving the last good facts and say so once per bad snapshot.
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error(`${PKG}: keeping the last good configuration after an invalid settings section`)
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

  const adapter = new NewApiAdapter({ options, resolveApiKey })
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
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below.
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  let registeredPolicy = options().retryPolicy
  const ensureRegistrationFacts = (): void => {
    const policy = options().retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    // The registry captures the retry policy at registration, so it is the one
    // fact per-request resolution cannot refresh. `replace` re-reads it in one
    // synchronous registry section: disposing and re-registering instead would
    // publish an empty route set between the two, and an observer that reacted
    // to it would see this provider disappear and come back.
    registration.replace([PROVIDER])
    registeredPolicy = policy
  }
  // Model discovery for the settings namespace this plugin owns: the Models
  // page interrogates the gateway's /models with the draft's endpoint and
  // one-shot credential, or the current snapshot's facts.
  ctx.llm.registerModelDiscovery(NS, request => adapter.discoverModels(request))

  // Host-side endpoint for the「更新模型信息」action: the browser names
  // the gateway model ids (and optionally the proxy draft) and the host
  // downloads https://models.dev/api.json — no cross-origin fetch happens in
  // the browser, and a plain HTTP forward proxy works because Node performs
  // the request. Registered through ctx.inject so it waits for the connection
  // service and re-runs if that service reloads — an eager ctx.get here read
  // undefined while the web app had not started the service yet, silently
  // skipping the route (the browser then met the SPA fallback's 405).
  ctx.inject(['connection'], (cctx) => {
    const connection = cctx.get('connection') as HostConnectionHandle
    cctx.effect(() => connection.rpc.handle(
      '/llm-newapi',
      (endpoint: string, payload: unknown, signal: AbortSignal) => {
        if (endpoint !== 'models-dev-params') {
          return Promise.resolve({
            ok: false as const,
            error: { code: 'internal' as const, message: `llm-newapi: unknown endpoint ${endpoint}`, details: {} },
          })
        }
        const request = payload as ModelsDevParamsRequest
        return adapter.fetchModelsDevParams(request, signal)
          .then(value => ({ ok: true as const, value }))
      },
      { authority: 'loopback' },
    ), 'llm-newapi: models-dev RPC channel')
  })

  installSettingsSection(ctx, NS, Config, config, {
    // Refuse an unserviceable section where it is written: without this a
    // schema-valid value the adapter cannot serve (a non-http(s) baseURL,
    // an empty exclude-pattern entry) stores with a success notice and
    // then silently keeps the last good facts at every request.
    validate: (value) => {
      resolveAdapterOptions(value, launchEnvironmentOf(ctx))
    },
    setSource: (source) => {
      current = source
    },
    onChange: ensureRegistrationFacts,
  })
}
