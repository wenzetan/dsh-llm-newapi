# 开发与 RC 发布

[返回 README](../README.zh-CN.md) · [配置指南](configuration.md) · [实现设计](../DESIGN.md)

本文面向维护者。当前包版本为 `0.8.6-rc.1`；下一次目标发布为 **`0.8.6-rc.2`**，用于适配 dsh `0.1.5-rc.1`。本轮保持 RC，不执行正式版晋升。

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

注意 npm 的 prerelease 范围：`>=0.1.2-rc.1` 不会自动接受 `0.1.5-rc.1`。最低版本 guard、peer 元数据与“已验证版本”表是三个不同层面的约束，不能互相替代。详细依据见[本次适配评估](2026-09-10-dsh-0.1.5-rc.1-assessment.md)。

## 本次发布约定

| 项目 | 要求 |
| --- | --- |
| 包版本与标签 | `0.8.6-rc.2` / `v0.8.6-rc.2` |
| GitHub Release | Pre-release |
| npm dist-tag | `next` |
| npm / Git `latest` | 继续保持 `0.8.4` |
| 已有 rc.1 | 保留原标签和发布包，不覆盖 |

完成适配后再更新包版本与锁文件。候选提交必须通过构建、插件规范检查和真实启动检查，并验证浏览器与网关的实际行为。合入 main 后，从已经确认的提交创建 RC 标签；标签工作流负责打包与发布。**本次不要填写 workflow_dispatch 的 `rc_tag` 晋升输入。**

发布工作流只有在配置了 `NPM_TOKEN` 时才会发布 npm，因此 GitHub Release 成功不等于 npm 包已可安装。发布后核对：

```sh
npm view dsh-llm-newapi@0.8.6-rc.2 version
npm view dsh-llm-newapi dist-tags --json
```

同时检查 Release 的 Pre-release 标记、tarball 内版本和标签提交。只有这些检查完成后，README 才能将 rc.2 从“计划发布”改为“已发布”。

仓库保留了人工晋升正式版的流程，但它不属于本轮操作。该流程要求 main 与待晋升 RC 指向同一提交，再生成稳定版本提交；如果 main 已有新提交，应重新发布并验证新的 RC，不能跳过必需检查。

## 其他安装来源

需要复现 GitHub 版本时可指定标签：

```sh
dsh plugin --profile web add "github:wenzetan/dsh-llm-newapi#v0.8.6-rc.1"
```

也可从对应 [Release](https://github.com/wenzetan/dsh-llm-newapi/releases) 获取 `.tgz`，再用 `dsh plugin --profile web add` 安装下载文件的绝对路径。日常使用优先采用 README 中的 npm 精确版本命令。

## 历史文档

[rc.1 发布计划](superpowers/plans/2026-09-07-pr4-0.8.6-rc.1-release.md) 是 2026-09-07 的执行记录，不是本轮操作清单。历史功能与修复见 [Releases](https://github.com/wenzetan/dsh-llm-newapi/releases)；当前行为以源码和现行指南为准。
