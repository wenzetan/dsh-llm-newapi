# dsh-llm-newapi

为 [DeepSeek Harness (dsh)](../deepseek-harness) 增加 LLM 供应商 **NewAPI** 的插件。

- 供应商 route id：`newapi`
- 显示名称：`NewAPI`
- 形态：LLM Provider 插件——实现 `@deepseek-ai/dsh-llm` 的 `LlmAdapter` seam；NewAPI 为 OpenAI 兼容网关（`POST {baseURL}/chat/completions`、`GET {baseURL}/models`，baseURL 含 `/v1`）

设计决策与差异分析见 [DESIGN.md](DESIGN.md)；参考实现 `deepseek-harness/packages/llm/llm-deepseek`。

## 挂载

```yaml
# cordis.patch.yml（随包分发，dsh --profile 补丁层）
- insert:
    - id: llm-newapi
      name: dsh-llm-newapi
```

## 配置（cordis.yml entry config；装机后 settings.yaml `llm-newapi:` 段热更新覆盖）

```yaml
- id: llm-newapi
  name: dsh-llm-newapi
  config:
    baseURL: http://gw.local:3000/v1   # 含 /v1 前缀；缺省回退 env NEWAPI_BASE_URL → 占位符
    # apiKeyEnv: NEWAPI_API_KEY        # 凭证引用，经 credentials seam 每请求解析
    # models:                          # 建议性目录；默认空，用「获取模型」拉取 /models
    #   - id: deepseek-chat
    #     contextWindow: 65536
    # modelExcludePatterns:            # 发现时的 chat-only 过滤（整体替换默认）
    #   - embed                        #   默认 ['embed','rerank','ranker']（大小写不敏感 id 子串）
    #   - rerank                       #   置 [] 关闭过滤；多能力 id（bge-m3）需自行补充
    # defaultContextWindow: 128000     # 目录未覆盖时的上下文容量
    # maxTokens: 8192                  # 缺省不发 max_tokens，用各上游默认
```

**模型发现**：`GET {baseURL}/models`，只采纳可服务 chat-completions 的模型——embedding / rerank / ranker 家族按命名约定过滤（可配）。

**Web 设置页（已实现）**：插件为双面包——浏览器半经 `dsh.client` manifest 被 dsh web 运行时动态发现（`ClientModuleRegistry` 扫描组合插件行），向 `settings.section` 多贡献 slot 注册自己的「NewAPI」设置页：API key、baseURL、模型列表与「获取模型」按钮（发现经 host 半过滤，只采纳 chat 模型）。**零 dsh 修改**。注意这是设置面板中独立的「NewAPI」页（dsh 契约：功能自有设置页，加设置不改 shell），不嵌在官方 Models 页内部。

## 构建与测试

```sh
npm install && npm run build   # host: tsc 类型 + esbuild → lib/index.js；client: closure-factory → lib/client.js
npm test                       # cordis 实挂载 smoke：注册面 + chat-only 过滤 + fiber 释放
```

## 状态

v0.2：双面包完成——host 半（adapter + chat-only 过滤发现）+ 浏览器半（NewAPI 设置页 + 获取模型）；typecheck / build / smoke 全绿。已知 npm rc 缺口用 overrides stub（见 DESIGN §8）。
