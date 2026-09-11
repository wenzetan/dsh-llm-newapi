# 配置与排障

[返回 README](../README.zh-CN.md) · [实现设计](../DESIGN.md)

日常使用只需在 Web 的 **NewAPI** 设置页填写地址、密钥和模型。本文供需要手动配置、调整模型参数或排查问题时查阅。

## 配置保存在哪里

| 内容 | 保存方式 |
| --- | --- |
| 网关地址、模型列表、models.dev 代理 | dsh 设置的 `llm-newapi` 段 |
| API 密钥 | dsh credentials store，固定引用名 `newapi` |
| 插件启用状态 | web profile 的 `package.json` → `dsh.profile.bundles` |

Web 设置会覆盖插件启动配置中的对应字段，保存后后续请求使用新值；正在进行的请求继续使用启动该请求时的配置。密钥不写入下方 YAML，也不通过 `NEWAPI_API_KEY` 读取。

## 手动配置示例

下面是 **settings.yaml 中的设置段**。编辑自己所用 dsh 实例的设置文件，并保留其他设置段。多数用户使用 Web 设置页即可，无需手动改文件。

```yaml
llm-newapi:
  baseURL: https://your-gateway.example/v1
  models:
    - id: your-chat-model
      name: 我的对话模型
      contextWindow: 128000
      maxTokens: 8192
  modelExcludePatterns:
    - embed
    - rerank
    - ranker
  defaultContextWindow: 128000
  streamIdleTimeoutMs: 300000
  proxy:
    enabled: false
    url: http://127.0.0.1:7890
```

请将模型 ID 与容量替换为网关实际值。这里的 `your-chat-model` 仅为示例。

若通过自定义 Cordis 启动配置提供默认值，将上述 `llm-newapi` 下的字段放在插件行的 `config` 中：

```yaml
- id: llm-newapi
  name: dsh-llm-newapi
  config:
    baseURL: https://your-gateway.example/v1
```

已有 bundle 会插入这条插件行，不要为了填配置再重复加载一次插件。

## 字段速查

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `baseURL` | 受信启动环境的 `NEWAPI_BASE_URL`，否则为占位地址 | 网关基础地址，包含 `/v1`；占位地址不能用于实际对话 |
| `models` | `[]` | 模型选择器中的目录，可在 Web 获取或手动新增 |
| `modelExcludePatterns` | `['embed', 'rerank', 'ranker']` | 获取模型时排除的 ID 子串，不区分大小写；整体替换默认值，`[]` 关闭过滤 |
| `defaultContextWindow` | `128000` | 模型未配置上下文容量时的回退值 |
| `maxTokens` | 不设置 | 全局输出上限；模型自己的 `maxTokens` 优先，均未设置则不发送 `max_tokens` |
| `streamIdleTimeoutMs` | `300000` 毫秒 | 等待下一段流数据的超时，不是整个回答的总时限 |
| `proxy.enabled` | `false` | 是否为 models.dev 下载显式指定代理 |
| `proxy.url` | `http://127.0.0.1:7890` | models.dev 使用的 HTTP 代理地址 |
| `providerHints` | 内置家族匹配规则 | 调整 models.dev 参数匹配的数据来源，见下文 |
| `retryPolicy` | 宿主默认策略 | 使用对应宿主版本 `RetryPolicySchema` 定义的字段 |

每个模型必须有唯一且非空的 `id`，可选字段为 `name`、`description`、`contextWindow`、`maxTokens`、`reasoningEfforts`、`defaultReasoningEffort`。容量必须为正整数。Web 容量输入框支持 `128K`、`1M`（分别为 128000、1000000），YAML 使用整数。

模型过滤只影响网关发现结果，不会删除手动配置的目录。名称过滤也无法识别所有非对话模型，例如 `bge-m3`；手动加入目录并不会使它获得 chat-completions 能力。

## 模型参数与思考等级

“获取模型”从网关读取可用 ID；“从models.dev获取模型信息”则在公共目录中匹配已有 ID，补充容量和思考等级。操作顺序是：**添加模型 → 查询参数 → 核对来源 → 应用 → 保存**。

匹配会优先考虑内置的家族供应商规则，例如 GPT → OpenAI、Claude → Anthropic、GLM → Z.ai。目录没有精确版本时，可能使用同供应商的近似型号。界面中的“官方”表示所选目录来源的优先级，不代表网关能力经过认证。无法匹配的条目保留原值。

需要调整匹配来源时，可在 `llm-newapi` 段加入：

```yaml
providerHints:
  defaults:
    glm: zhipuai
  models:
    tencent/Hunyuan-MT-7B: nano-gpt
```

`defaults` 按模型家族覆盖内置规则；`models` 按完整模型 ID 指定来源，优先级更高。供应商名称必须对应所使用目录中的实际条目。

思考等级只应配置网关接受的值。例如在某个模型条目中加入：

```yaml
reasoningEfforts: [low, medium, high]
defaultReasoningEffort: medium
```

预设值必须属于该模型的等级列表；未指定预设时，插件从声明列表中选择最高档。显式等级通过 `reasoning_effort` 发送，不会自动添加 DeepSeek 专属的 `thinking` 控制字段。

## 两种代理设置的区别

| 设置 | 影响范围 |
| --- | --- |
| 插件设置页中的代理 | 显式覆盖 models.dev 参数下载，不直接改动网关请求的代理配置 |
| dsh `0.1.5` 的启动环境代理 | 宿主通过全局 dispatcher 路由普通 fetch，包括网关请求及未指定插件代理的 models.dev 下载 |

因此，“关闭插件代理”不等于强制直连。新版宿主仍可能依据 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY` 路由请求，详见[上游代理说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/util/http-proxy/README.zh.md)。现有版本的某些下载错误提示仍使用“direct route”字样，需结合宿主配置判断。

## 常见故障

### 保存失败或配置看起来没有更新

先查看设置页的具体错误。空 ID、重复 ID、非法地址和错误的容量值都会被拒绝。设置修改基于读取时的 revision；如果配置同时在别处变更，重新加载后再编辑。

地址、模型等设置与密钥分两步保存，不是一个事务。如果密钥保存失败，其他设置可能已经写入；修复密钥问题后重试即可，不要据此判断所有修改都已回滚。

### 认证失败

`MISSING_CREDENTIAL` 表示尚未保存可用密钥；`AUTH` 通常表示网关拒绝密钥或权限不足。确认密钥属于当前地址对应的网关。输入框留空只保留原密钥，不执行删除。

### 请求失败、超时或工具调用出错

检查网关是否提供 `/chat/completions`，模型 ID 是否准确，以及该模型是否支持工具调用和所选思考等级。HTTP 429 常与限流有关，5xx 常与网关或上游有关；流长时间没有数据时会触发空闲超时。

反馈问题时附上 dsh 版本、插件版本、失败操作、模型 ID 和脱敏后的错误。不要附 API 密钥或 Web 启动链接中的认证 token。
