/**
 * models.dev parameter-lookup shapes for the browser half. Structurally the
 * same as the host's `types.ts` entries (the RPC payload crosses the wire as
 * plain JSON), mirrored here because the client program compiles with
 * `rootDir: src/client` and cannot import across the directory boundary.
 */

/** One models.dev provider match for a gateway model id. */
export interface ModelsDevMatch {
  /** models.dev provider id the entry lives under (e.g. `qwen`, `alibaba`). */
  provider: string
  /** Human-readable name from the catalog entry, when present. */
  name?: string
  /** Combined request/response context capacity (`limit.context`). */
  contextWindow?: number
  /** Per-request output cap (`limit.output`). */
  maxTokens?: number
  /** Supported reasoning-effort ids (`reasoning_options` type `effort`). */
  reasoningEfforts?: string[]
  /** True when this match's provider is the model's official vendor. */
  official?: boolean
}

/** Request payload of the `models-dev-params` RPC endpoint. */
export interface ModelsDevParamsRequest {
  /** Gateway model ids to look up, verbatim. */
  modelIds: string[]
  /** Forward-proxy URL to route the api.json download through, when enabled. */
  proxyUrl?: string
}

/** Response payload of the `models-dev-params` RPC endpoint. */
export interface ModelsDevParamsResponse {
  /** Per requested id: every provider entry that matched it, in catalog order. */
  models: Array<{ id: string; matches: ModelsDevMatch[] }>
}
