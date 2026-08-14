var __knownSymbol = (name2, symbol) => (symbol = Symbol[name2]) ? symbol : Symbol.for("Symbol." + name2);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function") __typeError("Object expected");
    var dispose, inner;
    if (async) dispose = value[__knownSymbol("asyncDispose")];
    if (dispose === void 0) {
      dispose = value[__knownSymbol("dispose")];
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") __typeError("Object not disposable");
    if (inner) dispose = function() {
      try {
        inner.call(this);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  };
  var fail = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e);
  var next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    }
    if (hasError) throw error;
  };
  return next();
};

// src/index.ts
import z from "@deepseek-ai/schemastery";
import { assertUsableApiKey as assertUsableApiKey2, LlmError as LlmError5, resolveRetryPolicy, RetryPolicySchema } from "@deepseek-ai/dsh-llm";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { deepEqualJson, installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";

// src/adapter.ts
import {
  assertUsableApiKey,
  attributionHeaders,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  isContextWindowExceededError,
  isQuotaExceededError,
  LlmAdapter,
  LlmError as LlmError4,
  ProviderRequestId,
  QUOTA_EXCEEDED_CODE
} from "@deepseek-ai/dsh-llm";
import { idleWatchdog, timeoutOf } from "@deepseek-ai/dsh-timeout";
import { fetch as undiciFetch, ProxyAgent } from "undici";

// src/serialize.ts
import { contentHasImage, LlmError } from "@deepseek-ai/dsh-llm";
function flattenText(blocks) {
  return blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
}
function assertTextOnly(blocks) {
  if (contentHasImage(blocks)) {
    throw new LlmError("The NewAPI chat-completions adapter does not support image content.", "UNSUPPORTED_CONTENT");
  }
}
function serializeAssistant(message) {
  const text = flattenText(message.content);
  const reasoning = message.content.filter((block) => block.type === "reasoning").map((block) => block.text).join("");
  const toolCalls = message.content.filter((block) => block.type === "tool-call").map((block) => ({
    id: block.id,
    type: "function",
    function: { name: block.name, arguments: block.arguments }
  }));
  return {
    role: "assistant",
    // Text-less turns send "" — NEVER null. Pure tool-call turns: some
    // gateways reject null outright. Reasoning-ONLY turns (the model can
    // answer entirely in the reasoning channel): the wire API rejects
    // null-content/no-tool_calls assistant messages with a 400, and since
    // the message sits durably in the session log, a null here bricks every
    // later turn of that session.
    content: text,
    // DeepSeek-family upstream passback rule: reasoning_content must return
    // on tool-call turns; it is ignored on plain turns, so we drop it there
    // to save tokens.
    ...toolCalls.length > 0 && reasoning.length > 0 ? { reasoning_content: reasoning } : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {}
  };
}
function serializeMessages(messages) {
  const wire = [];
  for (const message of messages) {
    assertTextOnly(message.content);
    if (message.role === "system") {
      wire.push({ role: "system", content: flattenText(message.content) });
      continue;
    }
    if (message.role === "assistant") {
      wire.push(serializeAssistant(message));
      continue;
    }
    const toolResults = message.content.filter((block) => block.type === "tool-result");
    const text = flattenText(message.content);
    if (text.length > 0 || toolResults.length === 0) {
      wire.push({ role: "user", content: text });
    }
    for (const result of toolResults) {
      wire.push({
        role: "tool",
        tool_call_id: result.toolCallId,
        // Empty tool output still needs SOME content on the wire.
        content: flattenText(result.content) || "(no output)"
      });
    }
  }
  return wire;
}
function serializeRequest(options) {
  const messages = [];
  if (options.system !== void 0) {
    messages.push({ role: "system", content: options.system });
  }
  messages.push(...serializeMessages(options.messages));
  const tools = options.tools?.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...tools !== void 0 && tools.length > 0 ? { tools } : {},
    ...options.temperature !== void 0 ? { temperature: options.temperature } : {},
    ...options.maxTokens === void 0 ? {} : { max_tokens: options.maxTokens },
    ...options.stop !== void 0 ? { stop: options.stop } : {}
  };
}

// src/sse.ts
import { EventSourceParserStream } from "eventsource-parser/stream";
import { LlmError as LlmError2 } from "@deepseek-ai/dsh-llm";
var DONE = "[DONE]";
async function* parseSse(stream, onComment) {
  const events = stream.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream({ onComment }));
  for await (const { data } of events) {
    yield data;
    if (data === DONE) return;
  }
  throw new LlmError2("SSE stream ended without [DONE]", "STREAM_CLOSED");
}

// src/translate.ts
import { CallId, EMPTY_RESPONSE_CODE, LlmError as LlmError3 } from "@deepseek-ai/dsh-llm";
function mapFinishReason(reason) {
  switch (reason) {
    case "stop":
      return { kind: "stop" };
    case "tool_calls":
      return { kind: "tool-calls" };
    case "length":
      return { kind: "max-tokens" };
    default:
      return {
        kind: "error",
        failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() }
      };
  }
}
function mapUsage(usage) {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  return {
    inputTokens: usage.prompt_tokens - (cacheRead ?? 0),
    outputTokens: usage.completion_tokens,
    ...cacheRead !== void 0 ? { cacheReadTokens: cacheRead } : {},
    ...reasoning !== void 0 ? { reasoningTokens: reasoning } : {}
  };
}
function closeBlock(block) {
  switch (block.kind) {
    case "text":
      return { type: "text", text: block.text };
    case "reasoning":
      return { type: "reasoning", text: block.text };
    case "tool-call":
      return {
        type: "tool-call",
        id: CallId(block.callId ?? ""),
        name: block.name ?? "",
        arguments: block.text
      };
  }
}
async function* translate(payloads) {
  let nextIndex = 0;
  let textBlock;
  let reasoningBlock;
  const toolBlocks = /* @__PURE__ */ new Map();
  const order = [];
  let pendingFinish;
  let pendingUsage;
  function open(kind) {
    const block = { index: nextIndex++, kind, text: "" };
    order.push(block);
    return block;
  }
  for await (const payload of payloads) {
    if (payload === DONE) {
      for (const block of order) {
        yield { type: "block-end", index: block.index, block: closeBlock(block) };
      }
      if (pendingUsage) yield { type: "usage", usage: pendingUsage };
      const reason = pendingFinish ?? { kind: "stop" };
      yield {
        type: "finish",
        reason: reason.kind === "stop" && order.length === 0 ? {
          kind: "error",
          failure: { message: "model returned a completed response with no content", code: EMPTY_RESPONSE_CODE }
        } : reason
      };
      return;
    }
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      throw new LlmError3(`malformed SSE payload: ${payload.slice(0, 120)}`, "MALFORMED_RESPONSE");
    }
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;
      const reasoning = delta?.reasoning_content;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        if (!reasoningBlock) {
          reasoningBlock = open("reasoning");
          yield { type: "block-start", index: reasoningBlock.index, blockType: "reasoning" };
        }
        reasoningBlock.text += reasoning;
        yield { type: "reasoning-delta", index: reasoningBlock.index, text: reasoning };
      }
      const content = delta?.content;
      if (typeof content === "string" && content.length > 0) {
        if (!textBlock) {
          textBlock = open("text");
          yield { type: "block-start", index: textBlock.index, blockType: "text" };
        }
        textBlock.text += content;
        yield { type: "text-delta", index: textBlock.index, text: content };
      }
      for (const call of delta?.tool_calls ?? []) {
        let block = toolBlocks.get(call.index);
        if (!block) {
          block = open("tool-call");
          toolBlocks.set(call.index, block);
          yield { type: "block-start", index: block.index, blockType: "tool-call" };
        }
        if (call.id !== void 0) block.callId = call.id;
        if (call.function?.name !== void 0) block.name = call.function.name;
        const fragment = call.function?.arguments ?? "";
        block.text += fragment;
        yield {
          type: "tool-call-delta",
          index: block.index,
          id: CallId(block.callId ?? ""),
          ...block.name !== void 0 ? { name: block.name } : {},
          argumentsDelta: fragment
        };
      }
      if (typeof choice.finish_reason === "string") {
        pendingFinish = mapFinishReason(choice.finish_reason);
      }
    }
    if (chunk.usage) pendingUsage = mapUsage(chunk.usage);
  }
  throw new LlmError3("SSE payload stream ended without [DONE]", "STREAM_CLOSED");
}

// src/adapter.ts
var PKG = "llm-newapi";
var DEFAULT_MODEL_EXCLUDE_PATTERNS = ["embed", "rerank", "ranker"];
var DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
var DEFAULT_CONTEXT_WINDOW = 128e3;
var STREAM_IDLE_TIMEOUT_CODE = "LLM_STREAM_IDLE_TIMEOUT";
var MODELS_DEV_API_URL = "https://models.dev/api.json";
var MODELS_DEV_TIMEOUT_MS = 3e4;
function modelsDevMatch(provider, entry) {
  const contextWindow = entry.limit?.context;
  const maxTokens = entry.limit?.output;
  if (contextWindow === void 0 && maxTokens === void 0) return void 0;
  return {
    provider,
    ...entry.name !== void 0 && entry.name.length > 0 ? { name: entry.name } : {},
    ...contextWindow !== void 0 ? { contextWindow } : {},
    ...maxTokens !== void 0 ? { maxTokens } : {}
  };
}
function matchModelsDev(api, id) {
  const keys = /* @__PURE__ */ new Set([id]);
  const slash = id.lastIndexOf("/");
  if (slash !== -1 && slash < id.length - 1) keys.add(id.slice(slash + 1));
  const matches = [];
  const seen = /* @__PURE__ */ new Set();
  for (const [provider, catalog] of Object.entries(api)) {
    const models = catalog?.models;
    if (models === void 0 || typeof models !== "object") continue;
    for (const key of keys) {
      const entry = models[key];
      if (entry === void 0 || typeof entry !== "object") continue;
      const match = modelsDevMatch(provider, entry);
      if (match === void 0 || seen.has(provider)) continue;
      seen.add(provider);
      matches.push(match);
    }
  }
  return matches;
}
function normalizeBaseUrl(raw) {
  const base = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) {
    throw new Error(`${PKG}: baseURL must be an absolute http(s) URL including the /v1 prefix, e.g. http://gw.local:3000/v1 (got: ${raw.trim()})`);
  }
  return base;
}
function modelInfo(provider, model) {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...model.description === void 0 ? {} : { description: model.description },
    inputModalities: ["text"]
  };
}
function displayModelName(id, listed) {
  if (listed !== void 0 && listed.length > 0) return listed;
  const slash = id.lastIndexOf("/");
  return slash === -1 ? id : id.slice(slash + 1);
}
function providerRetryAfterMs(value) {
  if (value === null) return void 0;
  if (/^\d+$/.test(value)) {
    const delay2 = Number(value) * 1e3;
    return Number.isFinite(delay2) && delay2 > 0 ? delay2 : void 0;
  }
  const delay = Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? delay : void 0;
}
function requestId(headers) {
  const value = headers.get("x-request-id");
  return value === null || value.length === 0 ? void 0 : ProviderRequestId(value);
}
function httpErrorCode(status, error) {
  if (status === 401 || status === 403) return "AUTH";
  const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(" ");
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE;
  if (status === 429) return "RATE_LIMIT";
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE;
    return "INVALID_REQUEST";
  }
  if (status >= 500) return "SERVER";
  return `HTTP_${status}`;
}
var NewApiAdapter = class extends LlmAdapter {
  constructor(config) {
    super();
    this.config = config;
  }
  providerInfo(provider) {
    return { id: provider, name: "NewAPI" };
  }
  providerRetryPolicy(_provider) {
    return this.config.options().retryPolicy;
  }
  listModels(provider) {
    return Promise.resolve(this.config.options().models.map((model) => modelInfo(provider, model)));
  }
  resolveModel(provider, model, _signal) {
    const connection = this.config.options();
    const configured = connection.models.find((entry) => entry.id === model);
    const defaultMaxTokens = configured?.maxTokens ?? connection.maxTokens;
    return Promise.resolve({
      // The chat-completions wire route is text-only regardless of catalog
      // membership, so the uncatalogued fallback declares the same negative
      // capability — "unknown" here would let the host accept and persist
      // images the serializer must then reject.
      ...configured === void 0 ? { provider, id: model, name: model, inputModalities: ["text"] } : modelInfo(provider, configured),
      context: { contextWindow: configured?.contextWindow ?? connection.defaultContextWindow },
      // No reasoning metadata: heterogeneous upstreams each own their
      // reasoning controls, so no effort selector is offered and explicit
      // efforts reject before provider I/O.
      ...defaultMaxTokens === void 0 ? {} : { defaultMaxTokens }
    });
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
  async discoverModels(request) {
    const connection = this.config.options();
    const base = request.baseURL !== void 0 && request.baseURL.length > 0 ? normalizeBaseUrl(request.baseURL) : connection.baseURL;
    const apiKey = request.apiKey !== void 0 ? assertUsableApiKey(request.apiKey, PKG, "the draft credential") : await this.config.resolveApiKey(connection);
    let response;
    try {
      response = await fetch(`${base}/models`, {
        method: "GET",
        headers: {
          "authorization": `Bearer ${apiKey}`,
          "accept": "application/json",
          ...attributionHeaders()
        },
        ...request.signal === void 0 ? {} : { signal: request.signal }
      });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      throw new LlmError4(`NewAPI model discovery request to ${base} failed`, "TRANSPORT", { cause: error });
    }
    if (!response.ok) {
      let providerError;
      try {
        providerError = (await response.json()).error;
      } catch {
      }
      const id = requestId(response.headers);
      throw new LlmError4(
        providerError?.message ?? `NewAPI model discovery error (HTTP ${response.status})`,
        httpErrorCode(response.status, providerError),
        {
          status: response.status,
          ...id === void 0 ? {} : { requestId: id }
        }
      );
    }
    let list;
    try {
      list = await response.json();
    } catch {
      throw new LlmError4(`NewAPI model discovery from ${base} returned a malformed body`, "MALFORMED_RESPONSE");
    }
    const catalog = new Map(connection.models.map((model) => [model.id, model]));
    const excludes = connection.modelExcludePatterns.map((pattern) => pattern.toLowerCase());
    const models = [];
    for (const entry of list.data ?? []) {
      if (typeof entry?.id !== "string" || entry.id.length === 0) continue;
      const id = entry.id.toLowerCase();
      if (excludes.some((pattern) => id.includes(pattern))) continue;
      const known = catalog.get(entry.id);
      models.push({
        id: entry.id,
        name: displayModelName(entry.id, entry.name),
        ...known?.contextWindow !== void 0 ? { contextWindow: known.contextWindow } : {},
        ...known?.maxTokens !== void 0 ? { maxTokens: known.maxTokens } : {}
      });
    }
    models.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return models;
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
  async fetchModelsDevParams(request, signal) {
    const proxyUrl = request.proxyUrl !== void 0 && request.proxyUrl.length > 0 ? request.proxyUrl : this.config.options().proxyUrl;
    const dispatcher = proxyUrl !== void 0 ? new ProxyAgent(proxyUrl) : void 0;
    let api;
    try {
      const request_ = {
        headers: { accept: "application/json", ...attributionHeaders() },
        signal: AbortSignal.any([signal, AbortSignal.timeout(MODELS_DEV_TIMEOUT_MS)])
      };
      const response = dispatcher === void 0 ? await fetch(MODELS_DEV_API_URL, request_) : await undiciFetch(MODELS_DEV_API_URL, { ...request_, dispatcher });
      if (!response.ok) {
        throw new LlmError4(
          `models.dev catalog fetch failed (HTTP ${response.status})`,
          httpErrorCode(response.status),
          { status: response.status }
        );
      }
      api = await response.json();
    } catch (error) {
      if (error instanceof LlmError4) throw error;
      if (signal.aborted) throw error;
      const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : error instanceof Error ? `: ${error.message}` : "";
      throw new LlmError4(
        `models.dev catalog fetch failed${cause} \u2014 if the direct route cannot reach models.dev, enable the proxy`,
        "TRANSPORT",
        { cause: error }
      );
    } finally {
      void dispatcher?.close().catch(() => {
      });
    }
    return {
      models: request.modelIds.map((id) => ({ id, matches: matchModelsDev(api, id) }))
    };
  }
  async *stream(options) {
    var _stack = [];
    try {
      const connection = this.config.options();
      const apiKey = await this.config.resolveApiKey(connection);
      const consumer = new AbortController();
      const upstream = options.signal === void 0 ? consumer.signal : AbortSignal.any([options.signal, consumer.signal]);
      const watchdog = __using(_stack, idleWatchdog(upstream, connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE));
      const iterator = this.request(
        options,
        watchdog.signal,
        connection,
        apiKey,
        () => {
          watchdog.pulse();
        }
      )[Symbol.asyncIterator]();
      let exhausted = false;
      try {
        while (true) {
          const result = await watchdog.next(iterator);
          if (result.done) {
            exhausted = true;
            return;
          }
          yield result.value;
        }
      } catch (error) {
        if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== void 0) {
          throw new LlmError4(
            `NewAPI stream idle timeout after ${connection.streamIdleTimeoutMs}ms`,
            "TIMEOUT",
            { cause: error }
          );
        }
        if (options.signal?.aborted) {
          throw new LlmError4("NewAPI request aborted by caller", "ABORTED", { cause: error });
        }
        if (error instanceof LlmError4) throw error;
        throw new LlmError4(`NewAPI stream from ${connection.baseURL} failed`, "TRANSPORT", { cause: error });
      } finally {
        consumer.abort("NewAPI stream consumer stopped");
        if (!exhausted && iterator.return !== void 0) {
          try {
            await iterator.return();
          } catch (_abortedTransportTeardown) {
          }
        }
      }
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  async *request(options, signal, connection, apiKey, onComment) {
    const body = serializeRequest(options);
    const payload = JSON.stringify(body);
    const headers = {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
      "accept": "text/event-stream",
      // The mandatory product attribution; nothing per-request or per-user
      // rides on a third-party gateway request.
      ...attributionHeaders()
    };
    let response;
    try {
      response = await fetch(`${connection.baseURL}/chat/completions`, {
        method: "POST",
        headers,
        body: payload,
        signal
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new LlmError4(
        `NewAPI request to ${connection.baseURL} failed`,
        "TRANSPORT",
        { cause: error }
      );
    }
    if (!response.ok) {
      let message = `NewAPI error (HTTP ${response.status})`;
      let providerError;
      try {
        const parsed = await response.json();
        providerError = parsed.error;
        if (providerError?.message) message = providerError.message;
      } catch {
      }
      const delay = providerRetryAfterMs(response.headers.get("retry-after"));
      const id = requestId(response.headers);
      throw new LlmError4(message, httpErrorCode(response.status, providerError), {
        status: response.status,
        ...delay === void 0 ? {} : { providerRetryAfterMs: delay },
        ...id === void 0 ? {} : { requestId: id }
      });
    }
    if (!response.body) {
      throw new LlmError4("NewAPI returned no response body", "EMPTY_RESPONSE");
    }
    yield* translate(parseSse(response.body, onComment));
  }
};

// src/index.ts
var name = "llm-newapi";
var inject = ["llm"];
var NS = settingsNamespace("llm-newapi");
var API_KEY_REF = "newapi";
var BASE_URL_ENV = "NEWAPI_BASE_URL";
var DEFAULT_BASE_URL = "https://newapi.example.com/v1";
var PROVIDER = "newapi";
var catalogModel = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1)
});
var DEFAULT_PROXY_URL = "http://127.0.0.1:7890";
var proxySchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(DEFAULT_PROXY_URL)
});
var Config = z.object({
  baseURL: z.string(),
  models: z.array(catalogModel).default([]),
  modelExcludePatterns: z.array(z.string()).default([...DEFAULT_MODEL_EXCLUDE_PATTERNS]),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  proxy: proxySchema.default({ enabled: false, url: DEFAULT_PROXY_URL }),
  retryPolicy: RetryPolicySchema
});
function resolveModels(models) {
  const seen = /* @__PURE__ */ new Set();
  return (models ?? []).map((model) => {
    if (model.id.length === 0) throw new Error(`${PKG}: catalog model ids must be non-empty`);
    if (model.name !== void 0 && model.name.length === 0) {
      throw new Error(`${PKG}: catalog model "${model.id}" has an empty name`);
    }
    if (model.contextWindow !== void 0 && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `${PKG}: catalog model "${model.id}" contextWindow must be a positive integer`
      );
    }
    if (model.maxTokens !== void 0 && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `${PKG}: catalog model "${model.id}" maxTokens must be a positive integer`
      );
    }
    if (seen.has(model.id)) throw new Error(`${PKG}: duplicate catalog model "${model.id}"`);
    seen.add(model.id);
    return {
      id: model.id,
      ...model.name === void 0 ? {} : { name: model.name },
      ...model.description === void 0 ? {} : { description: model.description },
      ...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens }
    };
  });
}
function resolveAdapterOptions(config, environment) {
  const named = config.baseURL !== void 0 && config.baseURL.trim().length > 0 ? config.baseURL : environment?.get(BASE_URL_ENV)?.value;
  const rawBase = named !== void 0 && named.trim().length > 0 ? named : DEFAULT_BASE_URL;
  const modelExcludePatterns = config.modelExcludePatterns ?? [...DEFAULT_MODEL_EXCLUDE_PATTERNS];
  for (const pattern of modelExcludePatterns) {
    if (pattern.length === 0) throw new Error(`${PKG}: modelExcludePatterns entries must be non-empty`);
  }
  if (config.defaultContextWindow !== void 0 && (!Number.isInteger(config.defaultContextWindow) || config.defaultContextWindow <= 0)) {
    throw new Error(`${PKG}: defaultContextWindow must be a positive integer`);
  }
  if (config.maxTokens !== void 0 && (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0)) {
    throw new Error(`${PKG}: maxTokens must be a positive safe integer`);
  }
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `${PKG}: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`
    );
  }
  const defaultContextWindow = config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const proxyEnabled = config.proxy?.enabled === true;
  const proxyUrlRaw = config.proxy?.url ?? DEFAULT_PROXY_URL;
  if (proxyEnabled) {
    try {
      new URL(proxyUrlRaw);
    } catch {
      throw new Error(`${PKG}: proxy.url must be an absolute URL (got: ${proxyUrlRaw})`);
    }
    if (!/^https?:$/.test(new URL(proxyUrlRaw).protocol)) {
      throw new Error(`${PKG}: proxy.url must be an http(s) URL (got: ${proxyUrlRaw})`);
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
    ...config.maxTokens === void 0 ? {} : { maxTokens: config.maxTokens }
  };
}
function apply(ctx, config) {
  let current = () => config;
  let lastRaw;
  let lastGood;
  const options = () => {
    const raw = current();
    if (raw === lastRaw && lastGood !== void 0) return lastGood;
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx));
      lastRaw = raw;
      lastGood = next;
      return next;
    } catch (error) {
      if (lastGood === void 0) throw error;
      lastRaw = raw;
      ctx.logger.error(`${PKG}: keeping the last good configuration after an invalid settings section`);
      ctx.logger.error(error);
      return lastGood;
    }
  };
  options();
  const resolveApiKey = async (connection) => {
    const ref = connection.apiKeyRef;
    const credentials = ctx.get("credentials");
    if (credentials !== void 0) {
      const hit = await credentials.resolve(ref);
      if (hit !== void 0) return assertUsableApiKey2(hit.value, PKG, ref);
    }
    throw new LlmError5(
      `${PKG}: no API key for provider route "${PROVIDER}"; configure it on the NewAPI settings page in dsh web (credentials reference "${ref}")`,
      "MISSING_CREDENTIAL"
    );
  };
  const adapter = new NewApiAdapter({ options, resolveApiKey });
  ctx.llm.registerConfigurableProviders([
    {
      provider: PROVIDER,
      displayName: "NewAPI",
      settingsNs: NS,
      settingsPath: [],
      // The adapter knows this route only because configuration declared it:
      // a self-hosted gateway it ships nothing about.
      declared: true
    }
  ]);
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter);
  let registeredPolicy = options().retryPolicy;
  const ensureRegistrationFacts = () => {
    const policy = options().retryPolicy;
    if (deepEqualJson(policy, registeredPolicy)) return;
    registration.replace([PROVIDER]);
    registeredPolicy = policy;
  };
  ctx.llm.registerModelDiscovery(NS, (request) => adapter.discoverModels(request));
  ctx.inject(["connection"], (cctx) => {
    const connection = cctx.get("connection");
    cctx.effect(() => connection.rpc.handle(
      "/llm-newapi",
      (endpoint, payload, signal) => {
        if (endpoint !== "models-dev-params") {
          return Promise.resolve({
            ok: false,
            error: { code: "internal", message: `llm-newapi: unknown endpoint ${endpoint}`, details: {} }
          });
        }
        const request = payload;
        return adapter.fetchModelsDevParams(request, signal).then((value) => ({ ok: true, value })).catch((error) => ({
          ok: false,
          error: {
            code: "internal",
            message: error instanceof Error ? error.message : String(error),
            details: {}
          }
        }));
      },
      { authority: "loopback" }
    ), "llm-newapi: models-dev RPC channel");
  });
  installSettingsSection(ctx, NS, Config, config, {
    // Refuse an unserviceable section where it is written: without this a
    // schema-valid value the adapter cannot serve (a non-http(s) baseURL,
    // an empty exclude-pattern entry) stores with a success notice and
    // then silently keeps the last good facts at every request.
    validate: (value) => {
      resolveAdapterOptions(value, launchEnvironmentOf(ctx));
    },
    setSource: (source) => {
      current = source;
    },
    onChange: ensureRegistrationFacts
  });
}
export {
  Config,
  DEFAULT_BASE_URL,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MODEL_EXCLUDE_PATTERNS,
  DEFAULT_PROXY_URL,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  NewApiAdapter,
  PKG,
  apply,
  inject,
  matchModelsDev,
  name,
  normalizeBaseUrl,
  resolveAdapterOptions
};
//# sourceMappingURL=index.js.map
