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
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmDiscoveredModel, LlmModelDiscoveryRequest, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { CredentialRef } from '@deepseek-ai/dsh-credentials';
import type { ModelsDevApi, ModelsDevMatch, ModelsDevParamsRequest, ModelsDevParamsResponse, ProviderHints, WireError } from './types.js';
/** Prefix for adapter-raised diagnostics. */
export declare const PKG = "llm-newapi";
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
export declare const DEFAULT_MODEL_EXCLUDE_PATTERNS: readonly string[];
/** One optional model entry advertised by this adapter. */
export interface NewApiCatalogModel {
    /** Wire model id accepted by the configured gateway. */
    id: string;
    /** Selector label; defaults to {@link id}. */
    name?: string;
    /** Optional selector detail for deployments with similar model variants. */
    description?: string;
    /** Known combined request/response context capacity; omitted when deployment metadata is unavailable. */
    contextWindow?: number;
    /** Per-request output cap for this model; omission falls back to the profile's {@link NewApiConnectionOptions.maxTokens}. */
    maxTokens?: number;
    /** Supported reasoning-effort ids; presence offers the effort selector. */
    reasoningEfforts?: string[];
}
/**
 * Validated connection facts for one operation. The plugin's
 * `resolveAdapterOptions` is the one explicit resolve step producing this
 * shape; the adapter trusts it and re-reads it per operation, which is what
 * makes a configuration change reach the next request without re-registration.
 */
export interface NewApiConnectionOptions {
    /** Gateway base including the `/v1` prefix; `/chat/completions` and `/models` are appended. */
    baseURL: string;
    /**
     * Credential reference of this same resolution, resolved per request.
     * Travelling with the endpoint is the point: a request can never pair one
     * generation's URL with another generation's secret. The reference is the
     * fixed id `newapi` — the web settings page owns the value, and a literal
     * key is not a configuration value.
     */
    apiKeyRef: CredentialRef;
    /** Advisory models exposed to discovery consumers; requests remain unrestricted. */
    models: readonly NewApiCatalogModel[];
    /**
     * Case-insensitive id substrings excluding discovered models that cannot
     * serve chat completions; the hand-curated {@link models} catalog is never
     * filtered. Defaults to {@link DEFAULT_MODEL_EXCLUDE_PATTERNS}; an empty
     * array means no filtering.
     */
    modelExcludePatterns: readonly string[];
    /** Positive context capacity used when the selected model has no exact value. */
    defaultContextWindow: number;
    /** Default per-request output cap; when absent, no cap is materialized or sent. */
    maxTokens?: number;
    /** Maximum provider idle time while one stream read is outstanding. */
    streamIdleTimeoutMs: number;
    /**
     * Forward proxy for the models.dev catalog download; present only while
     * the proxy setting is enabled, so its absence means a direct fetch.
     */
    proxyUrl?: string;
    /** Match-shaping hints for the models.dev params lookup. */
    providerHints: ProviderHints;
    /** Provider-owned model-request retry policy, already resolved. */
    retryPolicy: ResolvedRetryPolicy;
}
/** Constructor options for {@link NewApiAdapter}: the operation-local resolution hooks the plugin owns. */
export interface NewApiAdapterOptions {
    /** Current validated connection facts; called once per operation. */
    options: () => NewApiConnectionOptions;
    /**
     * Resolve the bearer token for the connection facts of one request. The
     * snapshot is passed in — never re-read — so the key can only ever come
     * from the same resolution as the endpoint it is sent to. Throws `LlmError`
     * `MISSING_CREDENTIAL` when the credentials store holds no value.
     */
    resolveApiKey: (connection: NewApiConnectionOptions) => Promise<string>;
    /**
     * Name the provider route that officially serves a model id, so a
     * multi-provider catalog match can put the vendor's own facts first.
     * Sourced from the routes registered on `ctx.llm` (the built-in
     * catalogs); absent when no route claims the id.
     */
    officialProviderOf?: (modelId: string) => Promise<string | undefined>;
}
/** Default maximum idle interval while an adapter stream read is outstanding. */
export declare const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000;
/** Default context capacity when neither the catalog nor config names one. */
export declare const DEFAULT_CONTEXT_WINDOW = 128000;
/** The public, provider-agnostic model catalog this feature reads. */
export declare const MODELS_DEV_API_URL = "https://models.dev/api.json";
/**
 * Built-in family-prefix hints: which catalog provider a model family's
 * official facts live under. GLM deliberately maps to `zai` (Z.ai, the
 * international official) rather than `zhipuai` — both carry identical ids.
 * Deployments override or extend via the `providerHints` config.
 */
export declare const DEFAULT_PROVIDER_HINTS: Readonly<ProviderHints>;
/**
 * Find every catalog entry one gateway model id can mean, official first.
 * Matching keys are the id and, for routed ids (`z-ai/glm-4.7`), its last
 * path segment — catalog keys carry no vendor prefix. Within the hinted
 * provider a NEAR key (catalog key contains the id or vice versa) also
 * matches, so a catalog not yet carrying the exact version still yields
 * the family's facts. Order: hinted provider's match first (flagged), then
 * exact-key matches in catalog order, then the rest.
 * @param api - the parsed models.dev catalog.
 * @param id - a gateway model id.
 * @param hints - deployment hints; `undefined` uses only the built-ins.
 * @returns matches, deduplicated by provider, hinted one leading.
 */
export declare function matchModelsDev(api: ModelsDevApi, id: string, hints?: ProviderHints): ModelsDevMatch[];
/**
 * Normalize a user-supplied gateway base: trim, drop trailing slashes, and
 * require an absolute http(s) URL. Failing here — at the explicit resolve
 * step — names the setting to fix instead of surfacing later as an opaque
 * fetch failure.
 * @param raw - the configured or drafted base URL.
 * @returns the normalized base with no trailing slash.
 */
export declare function normalizeBaseUrl(raw: string): string;
/**
 * Derive a human display name from a gateway model id when the listing
 * supplied none: take the last `/` segment (routed ids carry their vendor
 * as a path prefix), turn `-` into spaces, and capitalize each word's first
 * letter — except brand words, which keep their own spelling (`glm` → GLM,
 * `gpt` → GPT, `deepseek` → DeepSeek). A lone trailing letter reads as a
 * size marker and goes uppercase too. A routed id appends its verbatim
 * prefix in brackets: `deepseek-ai/deepseek-v4-flash` →
 * `DeepSeek V4 Flash[deepseek-ai]`.
 * @param id - the full gateway model id.
 * @returns the generated display name.
 */
export declare function modelNameFromId(id: string): string;
/**
 * Display name for one gateway model id: the name the gateway listing
 * supplied when it has one, else {@link modelNameFromId} over the id. The
 * full id always stays the wire value the gateway answers to.
 * @param id - the full gateway model id.
 * @param listed - the name the gateway listing itself supplied, if any.
 * @returns the listed name when present, else the generated name.
 */
export declare function displayModelName(id: string, listed?: string): string;
/**
 * Map an HTTP status to a stable LlmError code.
 * @param status - status of a non-2xx gateway response.
 * @param error - parsed gateway error body, when available.
 * @returns the normalized harness error code.
 */
export declare function httpErrorCode(status: number, error?: WireError['error']): string;
/**
 * The NewAPI gateway adapter. One instance serves every model name it was
 * registered under (the harness model name IS the wire model name).
 *
 * One stable signal reaches both initial fetch and body reads. Caller aborts
 * map to `ABORTED`; the configured per-read idle watchdog maps to `TIMEOUT`.
 */
export declare class NewApiAdapter extends LlmAdapter {
    private readonly config;
    constructor(config: NewApiAdapterOptions);
    providerInfo(provider: string): LlmProviderInfo;
    providerRetryPolicy(_provider: string): ResolvedRetryPolicy;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    /**
     * Interrogate one gateway endpoint for the models it advertises, serving
     * the settings-namespace discovery the plugin registered. A draft being
     * edited supplies its own base and one-shot credential; otherwise both
     * come from the current connection snapshot.
     * @param request - the discovery draft (endpoint, protocol, credential, cancellation).
     * @returns the advertised models, deduplicated by the runtime, enriched
     *   with context/maxTokens facts from the configured catalog when ids match.
     */
    discoverModels(request: LlmModelDiscoveryRequest): Promise<readonly LlmDiscoveredModel[]>;
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
    fetchModelsDevParams(request: ModelsDevParamsRequest, signal: AbortSignal): Promise<ModelsDevParamsResponse>;
    /**
     * Registry-based official priority, complementing the hint-driven one
     * inside {@link matchModelsDev}: when the hints did NOT flag a match
     * official yet, a route registered on ctx.llm that officially serves the
     * id (bare, or the last segment of a routed id) still leads. Runs only
     * when nothing is flagged, so the two mechanisms never fight.
     * @param id - the gateway model id.
     * @param matches - every catalog match, hinted order already applied.
     * @returns matches with the registry-official one first, flagged.
     */
    private prioritizeOfficial;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    private request;
}
