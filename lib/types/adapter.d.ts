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
import type { WireError } from './types.ts';
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
     * generation's URL with another generation's secret. Configuration carries
     * only this name — a literal key is not a configuration value.
     */
    apiKeyEnv: CredentialRef;
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
     * `MISSING_CREDENTIAL` when no key is available anywhere.
     */
    resolveApiKey: (connection: NewApiConnectionOptions) => Promise<string>;
}
/** Default maximum idle interval while an adapter stream read is outstanding. */
export declare const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000;
/** Default context capacity when neither the catalog nor config names one. */
export declare const DEFAULT_CONTEXT_WINDOW = 128000;
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
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    private request;
}
