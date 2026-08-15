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

更新：重跑第 1 步后重启即可。锁定版本改用 tag 引用：`github:wenzetan/dsh-llm-newapi#v0.5.7`。

**方式 B：Release tarball（免 GitHub 克隆）**

```sh
dsh plugin --profile web add \
  https://github.com/wenzetan/dsh-llm-newapi/releases/download/v0.5.7/dsh-llm-newapi-0.5.7.tgz
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

> **安装时的 missing peer 警告是预期行为，可忽略**：`react`/`cordis`/`dsh-llm`/`dsh-settings`/`schemastery` 等运行时由 dsh 宿主 app 提供，插件声明为 `peerDependencies` 正是要求“不要装自己的副本”；profile 的 `autoInstallPeers: false` 让 pnpm 静态报 missing。所有 dsh 插件安装时都会出现这行 WARN（dsh-at-file 等同款），安装成功不受影响。切勿手动安装该列表或开启 autoInstallPeers——会导致 cordis 服务双实例、插件静默失效。

装好后：设置面板出现「NewAPI」页 → 填 API key 与网关地址（含 `/v1`）→「获取模型」拉取并勾选 chat 模型（embedding / rerank / ranker 自动过滤）→ 保存。模型选择器（composer）即出现 `newapi` 路由的模型。

## 配置（cordis.yml entry config；装机后 settings.yaml `llm-newapi:` 段热更新覆盖）

```yaml
- id: llm-newapi
  name: dsh-llm-newapi
  config:
    baseURL: http://gw.local:3000/v1   # 含 /v1 前缀；缺省回退 env NEWAPI_BASE_URL → 占位符
    # models:                          # 建议性目录；默认空，用「获取模型」拉取 /models
    #   - id: deepseek-chat
    #     contextWindow: 65536
    # modelExcludePatterns:            # 发现时的 chat-only 过滤（整体替换默认）
    #   - embed                        #   默认 ['embed','rerank','ranker']（大小写不敏感 id 子串）
    #   - rerank                       #   置 [] 关闭过滤；多能力 id（bge-m3）需自行补充
    # defaultContextWindow: 128000     # 目录未覆盖时的上下文容量
    # maxTokens: 8192                  # 缺省不发 max_tokens，用各上游默认
```

**API 密钥**：不是配置项——固定存于 credentials store 的 `newapi` 引用下，唯一配置面是 web 设置页（写后立即生效，每请求解析）。插件不从任何环境变量读 key：credentials 服务的顶层只读层就是继承环境，`NEWAPI_API_KEY` 式引用会被环境里同名变量遮蔽并锁死前端输入框，故引用名固定为 `newapi`。无密钥时首个请求以 `MISSING_CREDENTIAL` 失败并指向设置页，不在装载时报错。

**模型发现**：`GET {baseURL}/models`，只采纳可服务 chat-completions 的模型——embedding / rerank / ranker 家族按命名约定过滤（可配）。

**Web 设置页**：浏览器半经 `dsh.client` manifest 被 dsh web 运行时动态发现（`ClientModuleRegistry` 扫描组合插件行），向 `settings.section` 多贡献 slot 注册（dsh 契约：功能自有设置页，加设置不改 shell）。注意这是设置面板中独立的「NewAPI」页，不嵌在官方 Models 页内部。输入框与按钮全部走 `--dsw-alias-*` 设计令牌（与官方 Models 页同配方），亮色 / 暗色主题自动适配。

**配置校验**：settings 写入点即拒绝适配器无法服务的段（如非 http(s) 的 baseURL、空过滤条目）——schema 表达不了的约束在写入时报错，不会「保存成功但静默沿用旧值」。

## 构建与测试（本仓开发）

```sh
npm install && npm run build   # host: tsc 类型 + esbuild → lib/index.js；client: closure-factory → lib/client.js
npm test                       # cordis 实挂载 smoke：注册面 + chat-only 过滤 + fiber 释放
```

改源码后须重跑 `npm run build` 并**提交 `lib/`**——`github:` 安装从提交的产物运行，CI 的「Committed artifacts are current」步骤会在产物过期时拒绝。

## 状态

v0.5.7：修复发布包类型入口——declaration emit 残留 `.ts` specifier（`rewriteRelativeImportExtensions` 不作用于 d.ts），消费者类型解析断裂；host 构建现把 `lib/types/*.d.ts` 相对 `.ts` 改写为 `.js`。补 `prepack` 脚本。CI 新增 dsh-plugin-check 合规门禁（清单协议 / patch 格式 / 构建陷阱，verdict 须 pass；本仓库实测从 fail 翻绿）。

v0.5.6：修复「更新模型信息」HTTP 500——下载失败（直连不可达 models.dev、代理失效等）此前以异常抛出，传输层把它映射成不透明的 500；现在 handler 返回错误信封，设置页直接显示底层原因（DNS/拒连/超时）与「启用代理」提示。同时修复代理路径的双 undici 问题：npm undici 的 ProxyAgent 会被 Node 内置 fetch 的品牌检查拒绝，代理请求改走 npm undici 自带的 fetch。

v0.5.4：CI boot 门禁稳定化——runner 补装 pnpm（profile 插件流程依赖它，裸 runner 缺失导致门禁首跑失败）；门禁三断言（:3080 就绪、client bundle 200、RPC 通道非 405）在 tag 构建上全程绿。

v0.5.3：修复生产安装丢 undici——undici 此前同时出现在 dependencies 与 devDependencies，`--omit=dev` 安装（CI 自包含门禁的干净目录）会把同名 devDep 整体剔除而非回退 prod 声明，导致打包产物在隔离环境下不可解析；从 devDependencies 移除后 CI 门禁转绿。CI 新增 boot 门禁：全局安装 dsh → 全新 DSH_HOME 用 `dsh plugin add` 装 tarball → 后台启动 `dsh web`，要求 ：3080 就绪、`/plugins/dsh-llm-newapi/client.js` 可取、`/llm-newapi/models-dev-params` 非 405。

v0.5.2：修复「更新模型信息」HTTP 405——RPC 通道此前在 apply 里用急切 `ctx.get('connection')` 读取，插件挂载早于 web app 启动 connection 服务时拿到 `undefined` 而静默跳过注册；改用 `ctx.inject(['connection'], …)` 等服务就绪再注册（服务重载自动重跑），并以 smoke 场景固定「插件先挂载、服务后启动」的时序。

v0.5.1：undici 从 peerDependencies 移入 dependencies（宿主不提供 undici，`autoInstallPeers: false` 下 peer 解析不到导致整个插件树加载失败）；CI 新增自包含门禁——`npm pack` 产物解包到干净目录只装生产依赖，host bundle 的所有非宿主提供 bare import 必须可解析。

v0.5：发现结果按 id 排序，`a/b` 形式 id 的显示名取最后一段（wire id 不变）；新增「更新模型信息」——浏览器把模型 id（与代理草稿）发给 host 半 RPC（`/llm-newapi` channel），由后端下载 `https://models.dev/api.json` 并按 id/末段匹配，返回 `limit.context`/`limit.output`；同名多供应商条目在结果面板由用户选择；应用时可选「覆盖」或「仅填空白」，未匹配行保持原值并计数提示。代理开关默认关闭、默认 `http://127.0.0.1:7890`，预置 7890/7897/10809 三个下拉项 + 自定义输入，启用状态与地址随设置段持久化（仅用于该下载，网关流量不走代理）。

v0.4：模型目录照官方 Models 页（`ModelListEditor`）重设计——每模型一张边框卡片（ID + 显示名称在行内），上下文窗口 / 输出上限折叠在行首 chevron 后，支持 K/M 缩写输入（`256K`→256000、`1M`→1000000）与逐字段输入缓冲；保存前本地校验（空 ID / 重复 ID / 容量不可解析即拒绝并点名行）；空状态提示与胶囊「添加模型」按钮；删除行时展开态与缓冲按行号重排。

v0.3：API key 改为纯前端配置（固定凭证引用 `newapi`，移除 `apiKeyEnv` 配置与 env 回退）；设置页改用 `--dsw-alias-*` 设计令牌，亮/暗主题自适应；settings 写入点增加 validate 拒绝；`WireAssistantMessage.content` 类型收紧为 `string`。host 半（adapter + chat-only 过滤发现）+ 浏览器半（NewAPI 设置页）双面包不变；typecheck / build / smoke 全绿；产物入库 + CI 同步校验 + Release tarball。已知 npm rc 缺口用 overrides stub（见 DESIGN §8）。
