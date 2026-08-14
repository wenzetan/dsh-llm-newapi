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
    baseURL: http://gw.local:3000/v1   # 必填（或 env NEWAPI_BASE_URL），含 /v1 前缀
    # apiKeyEnv: NEWAPI_API_KEY        # 凭证引用，经 credentials seam 每请求解析
    # models:                          # 建议性目录；默认空，用 Models 页「探测」拉取 /models
    #   - id: deepseek-chat
    #     contextWindow: 65536
    # defaultContextWindow: 128000     # 目录未覆盖时的上下文容量
    # maxTokens: 8192                  # 缺省不发 max_tokens，用各上游默认
```

## 构建

```sh
npm install && npm run build   # tsc → lib/（peerDeps 指向 @deepseek-ai/dsh-* 与 cordis）
```

## 状态

v0.1 脚手架完成：src/ 六文件 + 配置 + 挂载补丁；与官方 adapter 逐段同源，差异点列于 DESIGN.md §3。
