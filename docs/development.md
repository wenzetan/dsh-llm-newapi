# 开发与 RC 发布

[返回 README](../README.zh-CN.md) · [配置指南](configuration.md) · [实现设计](../DESIGN.md)

本文面向维护者。当前包版本为 `0.8.6-rc.2`，适配 dsh `0.1.5` 单宿主线；本地非 Web 验证已完成，真实宿主 Web 验证与发布尚未执行。本轮保持 RC，不执行正式版晋升。

开发依赖与 CI 的固定宿主都使用 **`0.1.5-rc.2`**，而 peer 下限与运行时最低版本仍是 **`0.1.5-rc.1`**。这两个数字不同是有意的：pin 表示我们构建和验证所针对的版本，下限表示插件仍愿意接受的最低版本。`0.1.5-rc.1` 与 `0.1.5-rc.2` 发布的是同一份 `lib/**` 代码，插件在两者下构建出的产物逐字节相同，因此保留较低的下限没有代价。若将来某个补丁版本改变了导出面，`surfaceSharedBy` 不再包含它，门禁会失败——此时应按下文流程处理，而不是直接抬低下限。

## 本地构建

使用 Node.js 24，与 CI 保持一致。在仓库根目录执行：

```sh
npm ci
npm run typecheck
npm run build
npm test
```

`npm ci` 复现锁文件依赖。调整依赖时再使用 `npm install` 更新锁文件，不要用浮动 npm 标签替代宿主版本的固定值。

构建生成 `lib/index.js`、`lib/client.js` 和类型声明。**源码改动后需要提交对应的 `lib/` 产物**，因为从 GitHub 安装的用户会使用这些文件。CI 会重建并检查产物是否与提交一致。

## 本地加载插件

先完成构建，再把仓库链接到开发用的 web profile。使用真实绝对路径，例如：

```sh
dsh plugin --profile web add "link:D:/Projects/Github/dsh-llm-newapi"
```

macOS / Linux 可使用自己的绝对目录，例如 `link:/home/me/dsh-llm-newapi`。确认 bundle 登记后重启 dsh Web；不要把上述示例路径当成固定安装位置。

需检查实际分发包时：

```sh
npm pack
```

`prepack` 会先构建。用输出的 `.tgz` 绝对路径替换 `link:` 参数，可验证发布包安装。应使用隔离的 `DSH_HOME`，避免与日常设置和会话混用。

## 每项测试能证明什么

| 命令或检查 | 能验证什么 |
| --- | --- |
| `npm run typecheck` | 宿主与客户端类型是否匹配开发依赖 |
| `npm run build` | 宿主、浏览器 JS 和类型声明能否生成 |
| `npm run test:client` | NewAPI 设置组件的交互、远程调用和状态处理 |
| `npm run test:host` | 真实 workspace 的 LLM 导出、入库快照、离线链接与旧宿主拒绝诊断 |
| `node test/smoke.mjs` | 真实 Cordis 组合下的注册、设置与网关替身行为 |
| CI `plugin-check` | 插件清单、补丁与包结构的静态检查 |
| CI `boot` | 在隔离环境安装 tarball，启动真实 Web，检查认证流程、客户端加载清单和自有 RPC 响应 |

`npm test` 依次执行客户端测试、宿主兼容检查和组合测试。它不会自动操作真实浏览器，也不会请求真实网关。启动页的客户端加载清单中出现插件，只能说明插件已被发现，不能证明设置页已经在浏览器中正常运行。

`npm run cache:models-dev` 可刷新开发用的公共目录缓存。缓存缺失时，对真实目录的可选检查会跳过，不影响普通 smoke；不要把这种跳过描述为完整外部服务验证。

## 适配新宿主时的顺序

1. 核对上游固定标签的源码与实际 npm 包，确定哪些插件调用受影响。
2. 更新开发依赖和锁文件，审查 peer 范围及旧的 dependency overrides。
3. 更新宿主导出快照与 CI 的固定宿主版本。若保留旧版本支持，同时测试旧、新两组。
4. 运行类型、构建、测试和打包检查，提交生成产物。
5. 用同一 tarball 验证真实宿主启动、设置页加载、凭据与配置保存、模型发现和文本/工具调用。
6. 更新双语 README 的版本状态、指定版本安装命令和已知限制。

注意 npm 的 prerelease 范围：`>=0.1.2-rc.1` 不会自动接受 `0.1.5-rc.1`，因此本插件改用 `>=0.1.5-rc.1 <0.1.6` 明确锁定新宿主线。最低版本 guard、peer 元数据与“已验证版本”表是三个不同层面的约束，不能互相替代。详细依据见[本次适配评估](2026-09-10-dsh-0.1.5-rc.1-assessment.md)。

### 登记新的宿主补丁版本

`test/fixtures/dsh-llm-0.1.5.exports.json` 的 `surfaceSharedBy` 列出实测与快照共享同一导出面的版本。上游常以完全相同的代码重切 RC，所以按补丁号判定兼容会误报。遇到未列出的版本时，宿主兼容门禁会失败并提示比对导出面，步骤是：

1. 下载新旧两个版本的实际 npm 包，逐个文件比对，确认 `lib/**` 是否一致。
2. 用新版本安装依赖，运行 `npm run typecheck`、`npm run build` 和 `npm test`，并确认重建后的 `lib/` 无漂移。
3. 若导出面一致，把该版本加入 `surfaceSharedBy`；若不一致，重新生成快照并按新宿主线处理。
4. 若该版本成为开发与 CI 的默认 pin，同时更新 `package.json`、CI 的固定宿主和 README 的版本表。

## 本次发布约定

| 项目 | 要求 |
| --- | --- |
| 包版本与标签 | `0.8.6-rc.2` / `v0.8.6-rc.2` |
| GitHub Release | Pre-release |
| npm dist-tag | `next` |
| npm / Git `latest` | 继续保持 `0.8.4` |
| 已有 rc.1 | 保留原标签和发布包，不覆盖 |

完成适配后再更新包版本与锁文件。候选提交必须通过构建、插件规范检查和真实启动检查，并验证浏览器与网关的实际行为。合入 main 后，从已经确认的提交创建 RC 标签；标签工作流负责打包与发布。**本次不要填写 workflow_dispatch 的 `rc_tag` 晋升输入。**

当前进度：包版本、锁文件、宿主导出快照、CI 固定宿主、最低版本 guard 与生成产物均已更新，本地非 Web 验证（`npm ci`、typecheck、构建、测试、打包与包内容检查）已通过。真实宿主 tarball 安装、Web 启动与浏览器验证仍未执行，因此 rc.2 仍是“本地已验证、待发布”。

锁文件说明：旧锁把 `@deepseek-ai/dsh-*` 固定在 0.1.2-rc.1，与 0.1.5-rc.1 的 peer 要求冲突，npm 直接增量求解会报 `ERESOLVE`。因此本次只替换锁文件中的 dsh 子树（19 个包条目加根条目），其余条目原样保留，再由 `npm install --package-lock-only` 校验一致性——它接受了该结果且未改动依赖版本。这样 `undici`、`zod`、`rolldown`、`postcss` 等与本次迁移无关的依赖都停留在 0.1.2 时期的版本，没有被动升级。

锁文件中另有两类非人为变更需要知道：一是 npm 对旧锁本身就会做的规范化，会移除 `vitest/node_modules/@esbuild/*` 与 `vitest/node_modules/esbuild`（在未改动的旧锁上执行 `npm install` 同样发生，与本次升级无关）；二是 `use-sync-external-store` 被移除，因为 `dsh-client-ui-renderer` 在 0.1.5-rc.1 已不再依赖它，这是升级的正确结果。

发布工作流只有在配置了 `NPM_TOKEN` 时才会发布 npm，因此 GitHub Release 成功不等于 npm 包已可安装。发布后核对：

```sh
npm view dsh-llm-newapi@0.8.6-rc.2 version
npm view dsh-llm-newapi dist-tags --json
```

同时检查 Release 的 Pre-release 标记、tarball 内版本和标签提交。只有这些检查完成后，README 才能将 rc.2 从“本地已验证、待发布”改为“已发布”。

仓库保留了人工晋升正式版的流程，但它不属于本轮操作。该流程要求 main 与待晋升 RC 指向同一提交，再生成稳定版本提交；如果 main 已有新提交，应重新发布并验证新的 RC，不能跳过必需检查。

## 其他安装来源

需要复现 GitHub 版本时可指定标签。下例使用当前最新的已发布标签 `v0.8.6-rc.1`；rc.2 目前尚未打标签，因此它的 GitHub 安装方式要等标签创建后才可用：

```sh
dsh plugin --profile web add "github:wenzetan/dsh-llm-newapi#v0.8.6-rc.1"
```

也可从对应 [Release](https://github.com/wenzetan/dsh-llm-newapi/releases) 获取 `.tgz`，再用 `dsh plugin --profile web add` 安装下载文件的绝对路径。日常使用优先采用 README 中的 npm 精确版本命令。

## 历史文档

[rc.1 发布计划](superpowers/plans/2026-09-07-pr4-0.8.6-rc.1-release.md) 是 2026-09-07 的执行记录，不是本轮操作清单。历史功能与修复见 [Releases](https://github.com/wenzetan/dsh-llm-newapi/releases)；当前行为以源码和现行指南为准。
