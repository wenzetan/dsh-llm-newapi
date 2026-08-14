# dsh-llm-newapi

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）增加 LLM 供应商 **NewAPI** 的插件。**零 dsh 修改**。

- 供应商 route id：`newapi`
- 显示名称：`NewAPI`
- 形态：LLM Provider 插件——实现 `@deepseek-ai/dsh-llm` 的 `LlmAdapter` seam；NewAPI 为 OpenAI 兼容网关（`POST {baseURL}/chat/completions`、`GET {baseURL}/models`，baseURL 含 `/v1`）
- 双面包：host 半（adapter + 模型发现）+ 浏览器半（dsh web 设置面板中的「NewAPI」设置页，含「获取模型」）

设计决策与差异分析见 [DESIGN.md](DESIGN.md)；参考实现 `deepseek-harness/packages/llm/llm-deepseek`。

## 安装（dsh ≥ 0.1.0-rc）

构建产物（`lib/`）已提交入库——`github:` 简写从源码仓库安装（社区同款模式，如 dsh-at-file）；CI 校验产物与源码同步，`v*` tag 发布 `npm pack` tarball 到 Release（配置 `NPM_TOKEN` secret 时同时发 npm）。

**方式 A：GitHub 简写（推荐）**

```sh
# 1. 安装到 web profile（跟随 main 分支 HEAD）
dsh plugin --profile web add "github:wenzetan/dsh-llm-newapi"

# 2. 注册 bundle：编辑 $DSH_HOME/profiles/web/package.json
#    （默认 ~/.dsh/profiles/web/package.json），
#    在 dsh.profile.bundles 数组中加一行 "dsh-llm-newapi"

# 3. 重启 dsh web
```

更新：重跑第 1 步后重启即可。锁定版本改用 tag 引用：`github:wenzetan/dsh-llm-newapi#v0.2.0`。

**方式 B：Release tarball（免 GitHub 克隆）**

```sh
dsh plugin --profile web add \
  https://github.com/wenzetan/dsh-llm-newapi/releases/download/v0.2.0/dsh-llm-newapi-0.2.0.tgz
# 同方式 A 的第 2、3 步
```

**方式 C：npm（Release 流水线配置 NPM_TOKEN 后可用）**

```sh
dsh plugin --profile web add dsh-llm-newapi
# 同方式 A 的第 2、3 步
```

**方式 D：本地开发（link）**

```sh
git clone https://github.com/wenzetan/dsh-llm-newapi && cd dsh-llm-newapi
npm install && npm run build && npm test
dsh plugin --profile web add link:$(pwd)
# 同方式 A 的第 2、3 步；改码后重跑 npm run build、提交 lib/ 并重启 dsh web
```

装好后：设置面板出现「NewAPI」页 → 填 API key 与网关地址（含 `/v1`）→「获取模型」拉取并勾选 chat 模型（embedding / rerank / ranker 自动过滤）→ 保存。模型选择器（composer）即出现 `newapi` 路由的模型。

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

**Web 设置页**：浏览器半经 `dsh.client` manifest 被 dsh web 运行时动态发现（`ClientModuleRegistry` 扫描组合插件行），向 `settings.section` 多贡献 slot 注册（dsh 契约：功能自有设置页，加设置不改 shell）。注意这是设置面板中独立的「NewAPI」页，不嵌在官方 Models 页内部。

## 构建与测试（本仓开发）

```sh
npm install && npm run build   # host: tsc 类型 + esbuild → lib/index.js；client: closure-factory → lib/client.js
npm test                       # cordis 实挂载 smoke：注册面 + chat-only 过滤 + fiber 释放
```

改源码后须重跑 `npm run build` 并**提交 `lib/`**——`github:` 安装从提交的产物运行，CI 的「Committed artifacts are current」步骤会在产物过期时拒绝。

## 状态

v0.2：双面包完成——host 半（adapter + chat-only 过滤发现）+ 浏览器半（NewAPI 设置页 + 获取模型）；typecheck / build / smoke 全绿；产物入库 + CI 同步校验 + Release tarball。已知 npm rc 缺口用 overrides stub（见 DESIGN §8）。
