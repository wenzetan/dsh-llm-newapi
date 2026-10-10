> 🚧 **归档通知**
>
> 本仓库已停止维护，即将归档。  
> 作者的使用场景已从 NewAPI 迁移到 OmniRoute。两边需要的插件能力有差异：在本项目里实现 OmniRoute 的需求，既担心与面向 NewAPI 的行为冲突，也有额外的维护成本，因此本项目停在最后一个发布版本。  
> 最后一个发布版本是 `0.2.0-rc.2-v0.1`（对应 dsh `0.2.0-rc.2`）：锁住该宿主仍可继续使用，但不再有修复、新版本，也不再跟进新的 dsh 宿主。

# dsh-llm-newapi

[English](README.md) | **中文**

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）中使用你的 NewAPI 网关。插件提供独立的 **NewAPI 设置页**，支持保存密钥、获取模型列表、补充模型参数，以及文本与工具调用的流式响应，无需修改 dsh。

## 先选对版本

**宿主版本与插件版本需要配套。** 状态核对于 2026-10-04。

| dsh 宿主 | 插件版本线 | npm 通道 | 状态 |
| --- | --- | --- | --- |
| `0.1.5-rc.3` | `0.1.5-rc.3-v0.3` | — | 已发布，该线已冻结 |
| `0.1.7-rc.1` | `0.1.7-rc.1-v0.x` | — | 已发布，无法在 0.2.0 宿主上运行 |
| **`0.2.0-rc.2`** | **`0.2.0-rc.2-v0.x`** | **`latest`** | **当前主推线** |

0.2.0 线的首个 tag 发布后 `latest` 才从 0.1.7 切换过来；切换前请用 `dist-tags` 查询实际指向。

同一宿主线上的版本号只递增最后一段（`-v0.1` → `-v0.2` → …），因此主推线用 `v0.x` 表示；查询各通道当前指向的精确版本：

```sh
npm view dsh-llm-newapi dist-tags --json
```

### 版本号规则

插件版本跟随上游宿主，格式为 `<dsh 版本>-v<本插件序号>`，只有最后一段是本插件自己的序号：

| 场景 | dsh 版本 | 插件版本（npm） | Git 标签 / Release |
| --- | --- | --- | --- |
| 上游 RC | `0.2.0-rc.2` | `0.2.0-rc.2-v0.1` | `v0.2.0-rc.2-v0.1` |
| 同一宿主线上的后续插件改动 | `0.2.0-rc.2` | `0.2.0-rc.2-v0.2` | `v0.2.0-rc.2-v0.2` |
| 上游正式版 | `0.2.0` | `0.2.0-v0.1` | `v0.2.0-v0.1` |
| 宿主换线（序号重新开始） | `0.2.0-rc.3` | `0.2.0-rc.3-v0.1` | `v0.2.0-rc.3-v0.1` |

- npm 的版本字段不能带前导 `v`，所以包版本写作 `0.2.0-rc.2-v0.1`，而 Git 标签与 GitHub Release 是 `v0.2.0-rc.2-v0.1`。
- **通道分工**：npm `latest` 指向当前主推宿主线的版本（现为 0.2.0 线）；`next` 保留给其他线或未来的预览发布。宿主线升格或切换时，改 CI 里的 `LATEST_LINE` 一行即可；0.2.0 出现正式版（`v0.2.0-v0.x`）后同样进入 `latest`。
- **更早的 `0.8.x` 系列**（对应 dsh `0.1.1-rc.2`、`0.1.2-rc.1` 宿主线）已移除 tag，并在 npm 上标记为 deprecated，不再维护。

### 兼容性与升级

`0.2.0-rc.2-v0.x` 支持 **dsh `0.2.0-rc.2` 宿主线**，并会明确拒绝 `0.1.7` 及更早宿主并提示升级；`0.1.7-rc.1` 用户使用 `0.1.7-rc.1-v0.x`。兼容性以宿主线而非单个补丁号为准：`0.2.0-rc` 线内的接缝面是固定的，该线后续再切 RC 同样适用——只要导出面一致；`npm run test:host` 会把已安装的导出面与入库快照逐一比对，不一致时直接报错，而不是默认放行。详见[适配评估](docs/2026-10-04-dsh-0.2.0-rc.2-assessment.md)。

两个版本线都是 GitHub Pre-release（插件当前没有正式版）。dsh 与插件各自的 `latest` 含义不同，不要假设它们能配套——请按上表选择宿主线，并用 `dist-tags` 查询当前精确版本。

## 安装：使用指定版本

需要 Node.js、npm 和 pnpm；本仓库 CI 使用 Node.js 24。宿主通过 npm 安装，插件从 npm registry 安装到 dsh 的 `web` profile。

### 当前主推组合（dsh `0.2.0-rc.2`，npm `latest`）

```sh
npm install -g @deepseek-ai/dsh@0.2.0-rc.2
npm install -g pnpm
dsh plugin --profile web add --save-exact "dsh-llm-newapi@$(npm view dsh-llm-newapi dist-tags.latest)"
```

### 上一个宿主组合（dsh `0.1.7-rc.1`）

```sh
npm install -g @deepseek-ai/dsh@0.1.7-rc.1
npm install -g pnpm
dsh plugin --profile web add --save-exact dsh-llm-newapi@0.1.7-rc.1-v0.3
```

选择一组执行即可。主推组合通过 `dist-tags` 取当前版本，因此不需要手抄版本号；0.1.7 线固定为 `0.1.7-rc.1-v0.3`。`--save-exact` 将插件依赖记录为精确版本，避免后续依赖更新时自动切换版本。插件安装使用 `dsh plugin`，它会管理对应 profile；单独全局安装 `dsh-llm-newapi` 不会完成这个步骤。

### 确认插件已启用

检查 `$DSH_HOME/profiles/web/package.json`；未设置 `DSH_HOME` 时，默认在用户目录的 `.dsh/profiles/web/package.json`。

在 `dsh.profile.bundles` 数组中确认包含 `dsh-llm-newapi`。新版 dsh 会自动登记声明了 bundle 的插件；旧版或已有 profile 若缺少该项，手动追加一次，保留其他项。以下只是需要检查的 JSON 片段，**不要覆盖整个文件**：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-llm-newapi"
      ]
    }
  }
}
```

确认安装结果后，重启 dsh web：

```sh
dsh --version
dsh plugin --profile web list dsh-llm-newapi
dsh web
```

## 第一次使用

1. 打开 dsh Web 的设置，进入 **NewAPI**。
2. 填写网关地址，例如 `https://your-gateway.example/v1`，以及 API 密钥。地址应包含 `/v1`，不要填写完整的 `/chat/completions` 路径。
3. 点击 **获取模型**，勾选需要的模型，再点 **添加所选**。
4. 按需点击 **从models.dev获取模型信息**，核对上下文窗口、输出上限和思考等级，选择覆盖或仅填空白。
5. 点击 **保存**，在对话的模型选择器中选择 `newapi` 路由下的模型。

“获取模型”查询的是你的网关，决定哪些模型可用；models.dev 是公共参数目录，只帮助补充参数，不能证明网关支持某个模型或能力。应用参数后仍需保存。

## 能力与使用边界

| 功能 | 行为 |
| --- | --- |
| 文本、思考内容与工具调用 | 支持流式接收；显式思考等级以 `reasoning_effort` 发送 |
| 图片输入 | 当前适配器声明只支持文本，不提供图片输入能力 |
| 获取模型 | 从 `/models` 获取，按名称排除 `embed`、`rerank`、`ranker`；这不是实际能力检测 |
| 模型参数 | 可手动编辑，也可从 models.dev 匹配；应以网关实际能力为准 |
| API 密钥 | 在设置页保存，不回显；输入框留空表示保留已有密钥 |
| 多个网关 | 当前只提供一个 `newapi` 路由和一套网关配置 |

## 升级与常见问题

升级前先核对版本表，停止正在运行的 dsh Web，并备份自己的 dsh 配置及会话数据。安装目标宿主和指定插件版本后，保留原有 bundle 项并重新启动；插件继续使用原来的 `newapi` 凭据引用，配置改由 profile 的 Cordis patch 保存（见[配置说明](docs/configuration.md)）。

上游 dsh `0.1.7` 会把会话格式从 V3 迁移到 V4（工具结果提升为 tool 角色消息、消息来源更名等），迁移后的会话不能由旧宿主直接读取。退回旧宿主时不能只更换 npm 版本，需参考[上游迁移说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/session/session-format-v3-to-v4/README.zh.md)。

| 问题 | 先检查 |
| --- | --- |
| 设置里没有 NewAPI | 是否安装在 `web` profile、bundle 是否登记、是否已重启、宿主版本是否配套 |
| 提示缺少密钥 | 在 NewAPI 设置页填写并保存；插件不读取 `NEWAPI_API_KEY` |
| 无法获取模型 | 地址是否包含 `/v1`，密钥是否可用，网关是否支持 `/models` |
| 模型列表为空 | 网关返回的模型是否被名称过滤；可手动添加确认支持 chat-completions 的模型 |
| models.dev 下载失败 | 检查网络和代理；设置页的代理仅覆盖该目录下载，dsh 还会通过 `dsh-http-proxy` 应用宿主环境代理 |
| 安装出现 missing peer 警告 | dsh 会提供宿主依赖；若安装和启动成功，不必为这些提示补装另一套宿主包。实际启动错误需另行排查 |

## 进一步阅读

- [配置与排障](docs/configuration.md)：配置字段、模型参数匹配、代理与保存失败处理。
- [开发与 RC 发布](docs/development.md)：本地构建、测试范围和发布前检查。
- [实现设计](DESIGN.md)：代码入口、数据流和关键设计决策。
- [0.1.7-rc.1 适配评估](docs/2026-09-24-dsh-0.1.7-rc.1-assessment.md)：版本盘点、破坏性变更与验证结论。
- [0.1.5-rc.1 适配评估](docs/2026-09-10-dsh-0.1.5-rc.1-assessment.md)：历史快照。
- [发布记录](https://github.com/wenzetan/dsh-llm-newapi/releases)：已发布版本的变更和下载附件。
