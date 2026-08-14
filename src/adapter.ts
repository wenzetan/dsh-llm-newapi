/**
 * `NewApiAdapter`: fetch + SSE against a NewAPI (OpenAI-compatible) gateway,
 * emitting harness StreamChunks. The adapter is transport-only: connection
 * facts arrive through a thunk resolved once per operation and the bearer
 * token through a per-request resolver, so the registering plugin owns
 * validation, layering, and credential policy. No reasoning-control fields
 * are emitted and no harness telemetry headers are sent: the mandatory
 * attribution `User-Agent` is the only product identity on the wire.
 *
 * @module dsh-llm-newapi/adapter
 */

import {
  assertUsableApiKey,
  attributionHeaders,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  isContextWindowExceededError,
  isQuotaExceededError,
  LlmAdapter,
  LlmError,
  ProviderRequestId,
  QUOTA_EXCEEDED_CODE,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmDiscoveredModel,
  LlmModelDiscoveryRequest,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { ProxyAgent } from 'undici'
import { serializeRequest } from './serialize.ts'
import { parseSse } from './sse.ts'
import { translate } from './translate.ts'
import type {
  ModelsDevApi,
  ModelsDevMatch,
  ModelsDevModel,
  ModelsDevParamsRequest,
  ModelsDevParamsResponse,
  WireError,
  WireModelList,
} from './types.ts'

/** Prefix for adapter-raised diagnostics. */
export const PKG = 'llm-newapi'

/**
 * Default case-insensitive id substrings excluding non-chat models from
 * discovery. NewAPI gateways aggregate every enabled channel into
 * `GET /models` — embedding (`text-embedding-*`) and rerank (`*rerank*`,
 * `*reranker*`) families among them — and the OpenAI listing shape carries
 * no capability metadata, so chat-compatibility filtering is naming-convention
 * based. Name heuristics cannot catch every multi-capability id (`bge-m3`
 * embeds and reranks under a bare name); `modelExcludePatterns` in config
 * replaces this list for deployments that know better, and an empty array
 * disables filtering entirely.
 */
export const DEFAULT_MODEL_EXCLUDE_PATTERNS: readonly string[] = ['embed', 'rerank', 'ranker']

/** One optional model entry advertised by this adapter. */
export interface NewApiCatalogModel {
  /** Wire model id accepted by the configured gateway. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Optional selector detail for deployments with similar model variants. */
  description?: string
  /** Known combined request/response context capacity; omitted when deployment metadata is unavailable. */
  contextWindow?: number
  /** Per-request output cap for this model; omission falls back to the profile's {@link NewApiConnectionOptions.maxTokens}. */
  maxTokens?: number
}

/**
 * Validated connection facts for one operation. The plugin's
 * `resolveAdapterOptions` is the one explicit resolve step producing this
 * shape; the adapter trusts it and re-reads it per operation, which is what
 * makes a configuration change reach the next request without re-registration.
 */
export interface NewApiConnectionOptions {
  /** Gateway base including the `/v1` prefix; `/chat/completions` and `/models` are appended. */
  baseURL: string
  /**
   * Credential reference of this same resolution, resolved per request.
   * Travelling with the endpoint is the point: a request can never pair one
   * generation's URL with another generation's secret. The reference is the
   * fixed id `newapi` — the web settings page owns the value, and a literal
   * key is not a configuration value.
   */
  apiKeyRef: CredentialRef
  /** Advisory models exposed to discovery consumers; requests remain unrestricted. */
  models: readonly NewApiCatalogModel[]
  /**
   * Case-insensitive id substrings excluding discovered models that cannot
   * serve chat completions; the hand-curated {@link models} catalog is never
   * filtered. Defaults to {@link DEFAULT_MODEL_EXCLUDE_PATTERNS}; an empty
   * array means no filtering.
   */
  modelExcludePatterns: readonly string[]
  /** Positive context capacity used when the selected model has no exact value. */
  defaultContextWindow: number
  /** Default per-request output cap; when absent, no cap is materialized or sent. */
  maxTokens?: number
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs: number
  /**
   * Forward proxy for the models.dev catalog download; present only while
   * the proxy setting is enabled, so its absence means a direct fetch.
   */
  proxyUrl?: string
  /** Provider-owned model-request retry policy, already resolved. */
  retryPolicy: ResolvedRetryPolicy
}

/** Constructor options for {@link NewApiAdapter}: the operation-local resolution hooks the plugin owns. */
export interface NewApiAdapterOptions {
  /** Current validated connection facts; called once per operation. */
  options: () => NewApiConnectionOptions
  /**
   * Resolve the bearer token for the connection facts of one request. The
   * snapshot is passed in — never re-read — so the key can only ever come
   * from the same resolution as the endpoint it is sent to. Throws `LlmError`
   * `MISSING_CREDENTIAL` when the credentials store holds no value.
   */
  resolveApiKey: (connection: NewApiConnectionOptions) => Promise<string>
}

/** Default maximum idle interval while an adapter stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
/** Default context capacity when neither the catalog nor config names one. */
export const DEFAULT_CONTEXT_WINDOW = 128_000
const STREAM_IDLE_TIMEOUT_CODE = 'LLM_STREAM_IDLE_TIMEOUT'

/** The public, provider-agnostic model catalog this feature reads. */
export const MODELS_DEV_API_URL = 'https://models.dev/api.json'
/** One-shot download budget for the catalog fetch. */
const MODELS_DEV_TIMEOUT_MS = 30_000

/**
 * One provider entry from the catalog, narrowed to what the feature fills.
 * @param provider - models.dev provider id the entry lives under.
 * @param entry - the catalog model entry.
 * @returns the match, or `undefined` when the entry carries no capacity fact.
 */
function modelsDevMatch(provider: string, entry: ModelsDevModel): ModelsDevMatch | undefined {
  const contextWindow = entry.limit?.context
  const maxTokens = entry.limit?.output
  if (contextWindow === undefined && maxTokens === undefined) return undefined
  return {
    provider,
    ...entry.name !== undefined && entry.name.length > 0 ? { name: entry.name } : {},
    ...contextWindow !== undefined ? { contextWindow } : {},
    ...maxTokens !== undefined ? { maxTokens } : {},
  }
}

/**
 * Find every catalog entry one gateway model id can mean. A gateway id is
 * matched verbatim first; a routed id (`qwen/qwen-max`) is additionally
 * matched by its last path segment, because catalog keys carry no vendor
 * prefix. Multiple providers can serve the same key — that ambiguity is
 * exactly what the caller asks the user to resolve.
 * @param api - the parsed models.dev catalog.
 * @param id - a gateway model id.
 * @returns every match, deduplicated by provider, in catalog order.
 */
export function matchModelsDev(api: ModelsDevApi, id: string): ModelsDevMatch[] {
  const keys = new Set<string>([id])
  const slash = id.lastIndexOf('/')
  if (slash !== -1 && slash < id.length - 1) keys.add(id.slice(slash + 1))
  const matches: ModelsDevMatch[] = []
  const seen = new Set<string>()
  for (const [provider, catalog] of Object.entries(api)) {
    const models = catalog?.models
    if (models === undefined || typeof models !== 'object') continue
    for (const key of keys) {
      const entry = models[key]
      if (entry === undefined || typeof entry !== 'object') continue
      const match = modelsDevMatch(provider, entry)
      if (match === undefined || seen.has(provider)) continue
      seen.add(provider)
      matches.push(match)
    }
  }
  return matches
}

/**
 * Normalize a user-supplied gateway base: trim, drop trailing slashes, and
 * require an absolute http(s) URL. Failing here — at the explicit resolve
 * step — names the setting to fix instead of surfacing later as an opaque
 * fetch failure.
 * @param raw - the configured or drafted base URL.
 * @returns the normalized base with no trailing slash.
 */
export function normalizeBaseUrl(raw: string): string {
  const base = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) {
    throw new Error(`${PKG}: baseURL must be an absolute http(s) URL including the /v1 prefix, e.g. http://gw.local:3000/v1 (got: ${raw.trim()})`)
  }
  return base
}

function modelInfo(provider: string, model: NewApiCatalogModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...model.description === undefined ? {} : { description: model.description },
    inputModalities: ['text'],
  }
}

/**
 * Display name for one gateway model id. Routed ids (`qwen/qwen-max`,
 * `openai/gpt-4o`) carry their vendor as a path prefix; the last segment is
 * what a person reads as the model name, while the full id stays the wire
 * value the gateway answers to.
 * @param id - the full gateway model id.
 * @param listed - the name the gateway listing itself supplied, if any.
 * @returns the listed name when present, else the id's last path segment.
 */
export function displayModelName(id: string, listed?: string): string {
  if (listed !== undefined && listed.length > 0) return listed
  const slash = id.lastIndexOf('/')
  return slash === -1 ? id : id.slice(slash + 1)
}

function providerRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1_000
    return Number.isFinite(delay) && delay > 0 ? delay : undefined
  }
  const delay = Date.parse(value) - Date.now()
  return Number.isFinite(delay) && delay > 0 ? delay : undefined
}

function requestId(headers: Headers): ReturnType<typeof ProviderRequestId> | undefined {
  const value = headers.get('x-request-id')
  return value === null || value.length === 0 ? undefined : ProviderRequestId(value)
}

/**
 * Map an HTTP status to a stable LlmError code.
 * @param status - status of a non-2xx gateway response.
 * @param error - parsed gateway error body, when available.
 * @returns the normalized harness error code.
 */
export function httpErrorCode(status: number, error?: WireError['error']): string {
  if (status === 401 || status === 403) return 'AUTH'
  const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(' ')
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE
    return 'INVALID_REQUEST'
  }
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

/**
 * The NewAPI gateway adapter. One instance serves every model name it was
 * registered under (the harness model name IS the wire model name).
 *
 * One stable signal reaches both initial fetch and body reads. Caller aborts
 * map to `ABORTED`; the configured per-read idle watchdog maps to `TIMEOUT`.
 */
export class NewApiAdapter extends LlmAdapter {
  constructor(private readonly config: NewApiAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'NewAPI' }
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.config.options().retryPolicy
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.config.options().models.map(model => modelInfo(provider, model)))
  }

  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const connection = this.config.options()
    const configured = connection.models.find(entry => entry.id === model)
    const defaultMaxTokens = configured?.maxTokens ?? connection.maxTokens
    return Promise.resolve({
      // The chat-completions wire route is text-only regardless of catalog
      // membership, so the uncatalogued fallback declares the same negative
      // capability — "unknown" here would let the host accept and persist
      // images the serializer must then reject.
      ...configured === undefined
        ? { provider, id: model, name: model, inputModalities: ['text' as const] }
        : modelInfo(provider, configured),
      context: { contextWindow: configured?.contextWindow ?? connection.defaultContextWindow },
      // No reasoning metadata: heterogeneous upstreams each own their
      // reasoning controls, so no effort selector is offered and explicit
      // efforts reject before provider I/O.
      ...defaultMaxTokens === undefined ? {} : { defaultMaxTokens },
    })
  }

  /**
   * Interrogate one gateway endpoint for the models it advertises, serving
   * the settings-namespace discovery the plugin registered. A draft being
   * edited supplies its own base and one-shot credential; otherwise both
   * come from the current connection snapshot.
   * @param request - the discovery draft (endpoint, protocol, credential, cancellation).
   * @returns the advertised models, deduplicated by the runtime, enriched
   *   with context/maxTokens facts from the configured catalog when ids match.
   */
  async discoverModels(request: LlmModelDiscoveryRequest): Promise<readonly LlmDiscoveredModel[]> {
    const connection = this.config.options()
    const base = request.baseURL !== undefined && request.baseURL.length > 0
      ? normalizeBaseUrl(request.baseURL)
      : connection.baseURL
    const apiKey = request.apiKey !== undefined
      ? assertUsableApiKey(request.apiKey, PKG, 'the draft credential')
      : await this.config.resolveApiKey(connection)
    let response: Response
    try {
      response = await fetch(`${base}/models`, {
        method: 'GET',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'accept': 'application/json',
          ...attributionHeaders(),
        },
        ...request.signal === undefined ? {} : { signal: request.signal },
      })
    } catch (error: unknown) {
      if (request.signal?.aborted) throw error
      throw new LlmError(`NewAPI model discovery request to ${base} failed`, 'TRANSPORT', { cause: error })
    }
    if (!response.ok) {
      let providerError: WireError['error']
      try {
        providerError = (await response.json() as WireError).error
      } catch {
        // Only swallow error-body parsing: the HTTP status still identifies
        // the failure, so malformed gateway JSON must not mask it.
      }
      const id = requestId(response.headers)
      throw new LlmError(
        providerError?.message ?? `NewAPI model discovery error (HTTP ${response.status})`,
        httpErrorCode(response.status, providerError),
        {
          status: response.status,
          ...id === undefined ? {} : { requestId: id },
        },
      )
    }
    let list: WireModelList
    try {
      list = await response.json() as WireModelList
    } catch {
      throw new LlmError(`NewAPI model discovery from ${base} returned a malformed body`, 'MALFORMED_RESPONSE')
    }
    const catalog = new Map(connection.models.map(model => [model.id, model]))
    const excludes = connection.modelExcludePatterns.map(pattern => pattern.toLowerCase())
    const models: LlmDiscoveredModel[] = []
    for (const entry of list.data ?? []) {
      if (typeof entry?.id !== 'string' || entry.id.length === 0) continue
      // A gateway listing cannot say what a model can serve; the id's naming
      // convention is the only signal, so non-chat families (embedding,
      // rerank) are dropped here rather than offered for adoption as chat
      // models that would fail every request.
      const id = entry.id.toLowerCase()
      if (excludes.some(pattern => id.includes(pattern))) continue
      const known = catalog.get(entry.id)
      models.push({
        id: entry.id,
        name: displayModelName(entry.id, entry.name),
        ...known?.contextWindow !== undefined ? { contextWindow: known.contextWindow } : {},
        ...known?.maxTokens !== undefined ? { maxTokens: known.maxTokens } : {},
      })
    }
    // Sorted by id: a gateway listing has no meaningful order of its own, and
    // a stable alphabetical one keeps the picker scannable across fetches.
    models.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    return models
  }

  /**
   * Download the models.dev catalog (optionally through the configured
   * forward proxy) and match every requested gateway id against it, serving
   * the `models-dev-params` RPC endpoint. Runs host-side on purpose: the
   * browser only names the ids and the proxy, so no cross-origin download
   * happens and the proxy is a plain HTTP forward proxy Node can use.
   * @param request - gateway model ids and an optional proxy URL.
   * @param signal - caller cancellation.
   * @returns per id: every provider entry that matched it (possibly several —
   *   the user resolves which provider's facts to adopt), possibly none.
   */
  async fetchModelsDevParams(
    request: ModelsDevParamsRequest,
    signal: AbortSignal,
  ): Promise<ModelsDevParamsResponse> {
    // The enabled-proxy setting travels with the connection snapshot; an
    // explicit per-request URL (the unsaved draft in the form) overrides it.
    const proxyUrl = request.proxyUrl !== undefined && request.proxyUrl.length > 0
      ? request.proxyUrl
      : this.config.options().proxyUrl
    const dispatcher = proxyUrl !== undefined
      ? new ProxyAgent(proxyUrl)
      : undefined
    let api: ModelsDevApi
    try {
      const response = await fetch(MODELS_DEV_API_URL, {
        headers: { accept: 'application/json', ...attributionHeaders() },
        signal: AbortSignal.any([signal, AbortSignal.timeout(MODELS_DEV_TIMEOUT_MS)]),
        ...dispatcher === undefined ? {} : { dispatcher } as RequestInit,
      })
      if (!response.ok) {
        throw new LlmError(
          `models.dev catalog fetch failed (HTTP ${response.status})`,
          httpErrorCode(response.status),
          { status: response.status },
        )
      }
      api = await response.json() as ModelsDevApi
    } catch (error: unknown) {
      if (error instanceof LlmError) throw error
      if (signal.aborted) throw error
      throw new LlmError('models.dev catalog fetch failed', 'TRANSPORT', { cause: error })
    } finally {
      void dispatcher?.close().catch(() => {})
    }
    return {
      models: request.modelIds.map(id => ({ id, matches: matchModelsDev(api, id) })),
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // One resolution per stream call: connection facts and the credential
    // freeze here and hold for this whole request, so an in-flight stream
    // never observes a configuration change and the next call re-resolves.
    // The key resolves *from this snapshot*, so an endpoint and the secret
    // sent to it can never come from different configuration generations.
    const connection = this.config.options()
    const apiKey = await this.config.resolveApiKey(connection)
    const consumer = new AbortController()
    const upstream = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    using watchdog = idleWatchdog(upstream, connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE)
    const iterator = this.request(
      options,
      watchdog.signal,
      connection,
      apiKey,
      () => { watchdog.pulse() },
    )[Symbol.asyncIterator]()
    let exhausted = false
    try {
      while (true) {
        const result = await watchdog.next(iterator)
        if (result.done) {
          exhausted = true
          return
        }
        yield result.value
      }
    } catch (error: unknown) {
      if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
        throw new LlmError(
          `NewAPI stream idle timeout after ${connection.streamIdleTimeoutMs}ms`,
          'TIMEOUT',
          { cause: error },
        )
      }
      if (options.signal?.aborted) {
        throw new LlmError('NewAPI request aborted by caller', 'ABORTED', { cause: error })
      }
      if (error instanceof LlmError) throw error
      throw new LlmError(`NewAPI stream from ${connection.baseURL} failed`, 'TRANSPORT', { cause: error })
    } finally {
      consumer.abort('NewAPI stream consumer stopped')
      if (!exhausted && iterator.return !== undefined) {
        try {
          await iterator.return()
        } catch (_abortedTransportTeardown) {
          // The consumer controller already owns termination; a return-time abort cannot add a second outcome.
        }
      }
    }
  }

  private async * request(
    options: GenerateOptions,
    signal: AbortSignal,
    connection: NewApiConnectionOptions,
    apiKey: string,
    onComment: () => void,
  ): AsyncIterable<StreamChunk> {
    const body = serializeRequest(options)
    // Prepared outside the try so the TRANSPORT label below covers exactly the
    // transport boundary, never a serialization failure.
    const payload = JSON.stringify(body)
    const headers = {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'accept': 'text/event-stream',
      // The mandatory product attribution; nothing per-request or per-user
      // rides on a third-party gateway request.
      ...attributionHeaders(),
    }

    let response: Response
    try {
      response = await fetch(`${connection.baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: payload,
        signal,
      })
    } catch (error: unknown) {
      // The outer stream distinguishes caller cancellation and watchdog expiry.
      if (signal.aborted) throw error
      // fetch wraps every transport failure (DNS, refused connection, TLS,
      // proxy) in a bare `TypeError: fetch failed` whose actionable detail
      // lives on `cause`. Wrapping with the endpoint and chaining the cause
      // lets `errorChain` render the full diagnosis at every reporting boundary.
      throw new LlmError(
        `NewAPI request to ${connection.baseURL} failed`,
        'TRANSPORT',
        { cause: error },
      )
    }

    if (!response.ok) {
      let message = `NewAPI error (HTTP ${response.status})`
      let providerError: WireError['error']
      try {
        const parsed = await response.json() as WireError
        providerError = parsed.error
        if (providerError?.message) message = providerError.message
      } catch {
        // Only swallow error-body parsing: the HTTP status still identifies the
        // failure, so malformed gateway JSON must not mask it.
      }
      const delay = providerRetryAfterMs(response.headers.get('retry-after'))
      const id = requestId(response.headers)
      throw new LlmError(message, httpErrorCode(response.status, providerError), {
        status: response.status,
        ...delay === undefined ? {} : { providerRetryAfterMs: delay },
        ...id === undefined ? {} : { requestId: id },
      })
    }
    if (!response.body) {
      throw new LlmError('NewAPI returned no response body', 'EMPTY_RESPONSE')
    }

    yield* translate(parseSse(response.body, onComment))
  }
}
