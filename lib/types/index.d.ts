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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import type { NewApiCatalogModel, NewApiConnectionOptions } from './adapter.js';
export { DEFAULT_CONTEXT_WINDOW, DEFAULT_MODEL_EXCLUDE_PATTERNS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, matchModelsDev, NewApiAdapter, normalizeBaseUrl, PKG, } from './adapter.js';
export type { NewApiAdapterOptions, NewApiCatalogModel, NewApiConnectionOptions } from './adapter.js';
export type * from './types.js';
export declare const name = "llm-newapi";
export declare const inject: string[];
/** Placeholder gateway base used when neither config nor environment names one. */
export declare const DEFAULT_BASE_URL = "https://newapi.example.com/v1";
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
    baseURL?: string;
    /** Advisory models shown by discovery consumers; defaults to none — a gateway's model set is deployment-specific. */
    models?: NewApiCatalogModel[];
    /**
     * Case-insensitive id substrings excluding discovered models that cannot
     * serve chat completions (embedding, rerank, ranker families). Replaces the
     * default {@link DEFAULT_MODEL_EXCLUDE_PATTERNS} list; an empty array
     * disables filtering. The hand-curated {@link models} catalog is unaffected.
     */
    modelExcludePatterns?: string[];
    /** Positive context capacity used when the selected model has no exact value (default 128,000). */
    defaultContextWindow?: number;
    /** Default per-request output cap; omission sends no cap and lets each upstream default apply. */
    maxTokens?: number;
    /** Maximum gateway idle time while one stream read is outstanding (default five minutes). */
    streamIdleTimeoutMs?: number;
    /**
     * Forward proxy for the models.dev catalog download performed by the
     *「更新模型信息」action: disabled by default; when enabled, that one
     * request is routed through `proxy.url` (a plain HTTP forward proxy).
     * Gateway traffic is untouched.
     */
    proxy?: ProxyConfig;
    /** Provider-owned model-request retry policy; omission uses normal defaults. */
    retryPolicy?: RetryPolicyConfig;
}
/** Forward-proxy settings for the models.dev catalog download. */
export interface ProxyConfig {
    /** Whether the proxy is used; defaults to false. */
    enabled?: boolean;
    /** Proxy URL; presets default to `http://127.0.0.1:7890`. */
    url?: string;
}
/** Default forward proxy: the conventional Clash port on loopback. */
export declare const DEFAULT_PROXY_URL = "http://127.0.0.1:7890";
export declare const Config: z<Config>;
/**
 * One resolution's complete request facts. Connection and credential facts
 * are one value on purpose: a snapshot the resolver rejects keeps the whole
 * previous generation, so a request can never pair a stale endpoint with a
 * newer key.
 */
export type ResolvedNewApiOptions = NewApiConnectionOptions;
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
export declare function resolveAdapterOptions(config: Config, environment?: ReturnType<typeof launchEnvironmentOf>): ResolvedNewApiOptions;
export declare function apply(ctx: Context, config: Config): void;
