# dsh-llm-newapi 设计

> 版本：v0.1（首个落盘草稿）
> 前置研究：本工作区 `ARCHITECTURE.md` / `PLUGIN-PATTERNS.md` + 官方 `llm-deepseek` 源码精读（2026-08）
> 依赖：dsh 官方 `dsh-llm` seam，**零核心修改**

---

## 1. 目标

为 DeepSeek Harness 增加 LLM 供应商 **NewAPI**：

- 供应商 route id：`newapi`
- 显示名称：`NewAPI`
- 形态：LLM Provider 插件（`dsh-llm` capability seam 的 Service Provider 角色）

NewAPI 是自托管的 OpenAI 兼容 API 网关（one-api 分支）：一个部署聚合并转发任意上游模型，对外统一暴露 OpenAI 协议（`POST {baseURL}/chat/completions`、`GET {baseURL}/models`，baseURL 含 `/v1` 前缀）。

## 2. Seam 分析结论：只写 Provider 一个角色

`dsh-llm` 的三角色中，其余两个官方已提供，本插件零接触：

| 角色 | 包 | 本插件关系 |
|---|---|---|
| Service Definition | `@deepseek-ai/dsh-llm`（`LlmRuntime` / `LlmAdapter`） | 仅依赖 |
| **Service Provider** | **本包 `dsh-llm-newapi`** | **实现 `LlmAdapter`，注册 `newapi` 路由** |
| Consumer | `dsh-agent-loop`、Web Models 页 | 零修改即可见新路由 |

Provider 侧四个注册面（全部经 `ctx.effect()` 随 fiber 释放，HMR 安全）：

```ts
ctx.llm.registerConfigurableProviders([{ provider: 'newapi', displayName: 'NewAPI',
  settingsNs: NS, settingsPath: [], declared: true }])
ctx.llm.registerAdapter(['newapi'], adapter)          // 唯一必需
ctx.llm.registerModelDiscovery(NS, discover)          // Models 页「探测端点」按钮
installSettingsSection(ctx, NS, Config, config, {...}) // settings.yaml 热更新分层
```

`declared: true`：该路由完全由配置声明（网关部署，插件不内置任何模型事实）——正是 `LlmConfigurableProvider.declared` 字段文档描述的场景。

## 3. 与 `llm-deepseek` 的关系：骨架同源，五处实质差异

NewAPI 与 DeepSeek 官方端点同为 OpenAI 兼容 chat-completions + SSE，故 transport 骨架（fetch + eventsource-parser + idleWatchdog、serialize/translate/sse 分层、per-request 连接快照、last-good 设置回退）全部沿用官方实现。实质差异：

| # | 维度 | llm-deepseek | dsh-llm-newapi（本插件） | 理由 |
|---|---|---|---|---|
| 1 | baseURL | 可选，默认公共 API | **必填**（config 或 `NEWAPI_BASE_URL`，缺则 load 时 fail-loud；规范化去尾 `/`、校验 http(s)） | 每个NewAPI部署地址不同，无公共默认可言 |
| 2 | thinking/effort | 顶层 `thinking` + `reasoning_effort` | **不发送任何推理控制字段**；`resolveModel` 不声明 `reasoning` 元数据 | DeepSeek 专属字段；异构上游轻则忽略重则 400。不声明 efforts ⇒ `resolveCallConfig` 在 I/O 前拒绝显式 effort，天然闭环 |
| 3 | 模型目录 | 内置 V4 Flash/Pro | **默认空目录**（`models` config 可选配）+ **`GET /v1/models` 端点探测**（seam 的 `registerModelDiscovery` 正是为网关设计） | 网关模型集因部署而异；`/models` 是 NewAPI 原生能力 |
| 4 | 遥测头 | `x-deepseek-harness-user-id` / session-id / compact | **只发 mandatory `attributionHeaders()`（User-Agent）**+ auth/accept/content-type | 第三方网关不应收到 harness 匿名 id；attribution 契约（不可抑制）仍遵守 |
| 5 | maxTokens 默认 | 256,000 | **无默认**：`maxTokens` config 缺省则不上 wire、不 materialize `defaultMaxTokens` | 异构上游各有自身默认，统一数值必错某家 |

沿用不变的关键行为（都有官方实证注释背书）：

- **每请求一次连接解析**：`options()` thunk + `resolveApiKey(connection)` 从同一快照取 key——端点与密钥永不跨代配对；in-flight 流不受配置变更影响。
- **注册期捕获的唯一事实**是 retryPolicy：变更时 `registration.replace(['newapi'])` 原子换路由（不能 dispose+重注册，会发布空路由窗口）。
- **凭证**：`ctx.get('credentials')` seam 优先，无 seam 回退 launch environment；缺 key 抛 `MISSING_CREDENTIAL`（load 不失败，首个请求失败）。
- **序列化细节**：assistant 无文本 turn 回放 `content: ""`（绝不 null，部分网关 400）；`reasoning_content` 仅在 tool-call turn 回传（上游为 DeepSeek 系模型时的 passback 契约；其余 OpenAI 兼容端点忽略未知字段，实测安全）；tool 空输出回放 `'(no output)'`。
- **流协议**：`[DONE]` 哨兵必须到达否则 `STREAM_CLOSED`；usage/finish 全部延迟到 `[DONE]` 后发出；`stop` 且零 block ⇒ `EMPTY_RESPONSE` 错误 finish。`reasoning_content` delta（上游 R1 系模型经 NewAPI 透传）→ reasoning block，翻译层原样支持。
- **usage 映射**：`prompt_tokens` 含缓存命中，减去 `prompt_tokens_details.cached_tokens`（OpenAI 兼容拼法）保持 harness 不相交计数约定。
- **错误映射**：401/403→`AUTH`、429→`RATE_LIMIT`、400→`INVALID_REQUEST`（配额/上下文超限文案识别）、5xx→`SERVER`、`retry-after` 头解析为 `providerRetryAfterMs`。

## 4. 配置面（Config = cordis.yml entry config = settings section 形状）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `baseURL` | string | —（必填，或 env `NEWAPI_BASE_URL`） | 网关地址，**含 `/v1`**，如 `http://gw.local:3000/v1`；去尾 `/`、须 http(s) |
| `apiKeyEnv` | string | `NEWAPI_API_KEY` | 凭证引用（credential-ref role），每请求经 credentials seam 解析 |
| `models` | catalog[] | `[]` | 建议性目录：`id` + 可选 `name/description/contextWindow/maxTokens` |
| `defaultContextWindow` | int>0 | `128,000` | 目录未覆盖该模型时的上下文容量（部署事实，须按上游调） |
| `maxTokens` | int>0 | —（无默认） | 缺省不发 `max_tokens`，让各上游自带默认生效 |
| `streamIdleTimeoutMs` | int>0 | `300,000` | 单次流读挂起上限（watchdog） |
| `retryPolicy` | RetryPolicySchema | 官方默认 | 供应商侧重试策略 |

显式 resolve 步骤 `resolveAdapterOptions(config, env)` 是唯一默认值/边界判定点（load 时与每个 settings 快照首用时各跑一次；坏快照保 last-good 并 log 一次）。

## 5. 文件结构

```
dsh-llm-newapi/
├── package.json          # peerDeps: dsh-llm/cordis/credentials/settings/launch-environment/timeout
├── tsconfig.json         # strict + NodeNext，rootDir src → outDir lib
├── cordis.patch.yml      # --profile 挂载补丁（插入一行插件）
├── src/
│   ├── index.ts          # name/inject/Config/resolveAdapterOptions/apply：四注册面 + 凭证解析
│   ├── adapter.ts        # NewApiAdapter：stream + providerInfo + listModels/resolveModel + discoverModels
│   ├── serialize.ts      # harness Message[] → wire messages/request（无推理字段）
│   ├── translate.ts      # SSE payloads → StreamChunk（状态机与官方相同）
│   ├── sse.ts            # SSE 字节流 → data payloads（[DONE] 契约）
│   └── types.ts          # wire 类型（OpenAI 兼容 + /models 列表响应）
```

## 6. 挂载方式

```yaml
# cordis.patch.yml（dsh --profile 补丁层，随包分发）
- insert:
    - id: llm-newapi
      name: dsh-llm-newapi
```

或在用户自有 raw cordis.yml 里直接一行 `- id: llm-newapi / name: dsh-llm-newapi`。entry config 直接写 `baseURL` 等；装机后 settings.yaml 的 `llm-newapi:` 段覆盖 entry（热更新）。

## 7. 模型发现（discoverModels）

Models 页编辑草稿时经 `ctx.llm.discoverModels('llm-newapi', { baseURL?, apiKey?, provider?, signal })` 调用：

1. 端点取 `request.baseURL`（草稿）否则当前快照；两者皆空 → `INVALID_DISCOVERY`（由 seam 抛）。
2. 凭证取 `request.apiKey`（一次性，harness 不存储）否则按快照走 `resolveApiKey`。
3. `GET {base}/models`，Bearer + attribution，解析 `{ data: [{ id }] }`（OpenAI models.list 形状，NewAPI 原生支持）。
4. 返回 `LlmDiscoveredModel[]`，用配置目录中同 id 条目增补 `contextWindow/maxTokens`（探测响应本身只有 id）。

## 8. 已知取舍与后续（v0.1 范围外）

- **不变量伴侣包（`./invariant`）**：仓库内 `verify-package-invariants` 门禁约束 `packages/*/*`，外部插件不在其列；若日后入仓需补。
- **图片输入**：chat-completions 路线声明 `inputModalities: ['text']`（负能力），序列化层显式拒绝 image block——与官方 adapter 同立场。
- **多路由 profile**：单路由 `newapi` + settings 段内多 profile（`settingsPath` 深入）可支持同进程多网关；v0.1 单路由，`AdapterRegistrationHandle.replace([])` 已为空路由保留合法语义。
- **上游自适应推理控制**：若上游全是 DeepSeek 系，可在 v0.1 后加可选 `compat: 'deepseek'` 开关恢复 `thinking`/`reasoning_effort` 字段；默认关闭。
- **构建验证**：本脚手架未经 `npm install` + `tsc` 实编（沙箱 npm 缓存只读）；代码与官方 `llm-deepseek` 逐段同源，差异点已在 §3 列尽，安装依赖后应一次通过。
