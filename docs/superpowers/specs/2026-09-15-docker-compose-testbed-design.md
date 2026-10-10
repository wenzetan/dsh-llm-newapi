# Docker Compose 测试环境（testbed）设计

- 日期：2026-09-15
- 状态：待评审（Draft for review）
- 适用仓库：`dsh-llm-newapi`（本文件）
- 姊妹文档：`dsh-quota-panel/docs/superpowers/specs/2026-09-15-docker-compose-testbed-design.md`（同构，按该仓库定制断言）
- 前置约定：本设计不修改现有 CI 的 `build` / `plugin-check` / `boot` / `release` 任务

---

## 1. 问题

当前验证层级有两条腿，各有明确缺口：

| 层 | 现状 | 缺口 |
| --- | --- | --- |
| 单元/组合 | `npm test`（vitest + `host-compat.mjs` + `smoke.mjs`）在开发者机器上跑 | 只能跑在开发者本机的那一个宿主版本上；`host-compat.mjs` 的兼容性门禁实际只覆盖单一 pin |
| 真实启动 | CI 的 `boot` job：隔离 `DSH_HOME` + 装 tarball + 真实 `dsh web` + 认证 + 客户端清单 + RPC 探针 | 只在 GitHub runner 上、只覆盖单一宿主版本、单进程、不覆盖插件共存 |

在开发机上补这两条腿会污染宿主环境，原因已实测（见第 3 节）：`dsh` 每次启动都写 `$DSH_HOME`，宿主 `3080` 端口被正在运行的 GUI 占用，宿主 npm cache 目录只读。

目标是把这两条腿搬进容器：**宿主零改动**、可覆盖多个宿主版本、可覆盖插件组合、本地可复现。

---

## 2. 目标与非目标

### 目标

1. 每个仓库自带一份 `testbed/`，`docker compose run --rm testbed` 即可跑完本仓库的源码层与真实宿主启动层校验。
2. 宿主配置通过**只读**挂载进入容器（整份 `$DSH_HOME`），容器内所有写入落在容器可写层与命名卷。
3. 宿主版本矩阵支持"支持线 + 滚动跟随 npm `latest`"，默认集合为 `latest` + `next` 去重。
4. 插件组合支持"单插件默认 + 可选叠加对端插件"。
5. 失败可定位：每格独立日志、明确判红关键词、非零退出码与汇总表。

### 非目标

1. **不做**真实浏览器 E2E（headless Chrome 驱动真实 GUI）：本轮显式排除。
2. **不做**真实上游调用（真实 NewAPI 网关 / 真实额度端点）：本轮显式排除；凭据虽挂载进容器，但不用于主动外呼断言。
3. **不接 CI**：本轮只服务本地开发调试。现有 CI 任务一律不动。
4. **不承诺安全隔离**：见第 11 节。

---

## 3. 关键事实（全部为实测，构成本设计的硬约束）

| 事实 | 证据 | 对设计的影响 |
| --- | --- | --- |
| `dsh` 启动即写 `$DSH_HOME` | `dsh web --help` 在宿主失败：`EROFS: read-only file system, open '/root/.dsh/profiles/web/cordis.yml'`（`prepareProfile`） | `DSH_HOME` 必须可写，因此必须隔离；挂载的宿主 `$DSH_HOME` 只能只读 + 容器内复制 |
| 宿主 `$DSH_HOME` 共 976 MB，配置部分约 15 MB | `du -sh`：`profiles` 9M、`sessions` 90M、`browser-sessions` 339M、`dsh-browser` 487M、`change-ledger` 50M | 白名单复制可行；会话/浏览器数据不进容器 |
| 宿主 web profile 的 `node_modules` 内绝对路径符号链接数为 0 | `find ... -type l -lname '/*' \| wc -l` → 0 | profile 可跨机复制而不断链（`preserve` 模式的前提） |
| 宿主 `127.0.0.1:3080` 已被占用 | `ss -ltnp` | 容器端口映射必须换端口（默认 `13080`） |
| 宿主 dsh 版本 `0.1.5-rc.1`；CI dev pin `0.1.5-rc.2` | 全局包 `package.json`；两个仓库 CI `npm install -g @deepseek-ai/dsh@0.1.5-rc.2` | 矩阵的两个真实锚点 |
| npm dist-tags：`latest` = `0.1.5-rc.1`，`next` = `0.1.5-rc.2` | `npm view @deepseek-ai/dsh dist-tags` | "滚动跟随 latest" 的解析基准 |
| 宿主 `~/.npm/_cacache` 只读 | `npm view` 失败：`EROFS ... /root/.npm/_cacache/tmp/***` | 容器内用命名卷做 npm cache 是附带收益 |
| 本机 60 个镜像中无任何 node 镜像 | `docker images` | 首次构建需拉 `node:24-bookworm-slim` |
| `dsh plugin ...` 是转发给 **pnpm** | `dsh --help`：`manage a profile's plugins by forwarding the remaining arguments to pnpm` | 镜像必须包含 pnpm；`preserve` 模式存在 npm/pnpm 布局混用风险（第 10 节） |
| 本仓库源码体积小、依赖体积大 | `src`+`lib`+`test` < 1 MB；`node_modules` 122 MB | 容器内复制源码 + 重装依赖，而非复制 `node_modules` |
| 插件树加载失败有两种历史形态 | 本项目 `docs/development.md` 记录：0.1.5 线上 `connection.rpc.handle()` 抛 `cannot get property "webServer" without inject` 且被吞掉，表现为浏览器 405 | 判红关键词固定为 `plugin tree failed to load` 与 `without inject` |

---

## 4. 架构

### 4.1 目录结构（本仓库新增，除 `.gitignore` 外不改动现有文件）

```
dsh-llm-newapi/
├─ testbed/
│  ├─ Dockerfile          # node:24-bookworm-slim + ARG DSH_VERSION + pnpm + dsh
│  ├─ compose.yaml        # 单 service 模板，全部行为由 env 驱动
│  ├─ .env.example        # DSH_HOME_HOST 等宿主侧变量示例（Linux 与 Windows 各一份注释）
│  ├─ entrypoint.sh       # 第 5 节的六步
│  ├─ matrix.mjs          # 版本/组合遍历 + 汇总表（第 6 节）
│  ├─ probes/
│  │  ├─ boot-probe.sh    # 认证 + 首页 + boot 图 + RPC + 日志关键词断言
│  │  └─ expectations.json
│  ├─ README.md           # 英文用法
│  ├─ README.zh-CN.md     # 中文用法（与本仓库双语 README 传统一致）
│  └─ .out/               # 运行产物，gitignore
└─ .gitignore             # 追加 testbed/.out/
```

### 4.2 compose 服务（单 service 模板）

```yaml
services:
  testbed:
    build:
      context: .
      args: { DSH_VERSION: "${DSH_VERSION:-0.1.5-rc.2}" }
    environment:
      DSH_VERSION: "${DSH_VERSION:-0.1.5-rc.2}"
      PROFILE_MODE: "${PROFILE_MODE:-minimal}"      # minimal | preserve
      COMPANION: "${COMPANION:-}"                   # 叠加的对端插件名，空 = 单插件
      GRID_LABEL: "${GRID_LABEL:-local}"            # 日志与产物命名
    volumes:
      - "${DSH_HOME_HOST:-/root/.dsh}:/host-dsh-home:ro"
      - "..:/plugin-src:ro"
      - "${COMPANION_HOST_DIR:-/dev/null}:/companion-src:ro"
      - "npm-cache:/root/.npm"
      - "pnpm-store:/root/.local/share/pnpm/store"
    ports:
      - "127.0.0.1:${HOST_PORT:-13080}:3080"
    extra_hosts:
      - "host.docker.internal:host-gateway"

volumes:
  npm-cache:
  pnpm-store:
```

### 4.3 环境变量契约

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `DSH_VERSION` | `0.1.5-rc.2` | 容器内安装的宿主版本；同时是镜像构建参数 |
| `PROFILE_MODE` | `minimal` | `minimal`：空 profile + 装本仓库 tarball（与现有 CI `boot` 同路）；`preserve`：先还原宿主 profile 的 `dsh.profile.bundles` 行，再用本仓库 tarball 覆盖被测行 |
| `COMPANION` | 空 | 需要叠加的插件包名（如 `dsh-quota-panel`）；非空时必须同时提供 `COMPANION_HOST_DIR` |
| `COMPANION_HOST_DIR` | `/dev/null` | 对端插件源码目录的宿主绝对路径（只读挂载到 `/companion-src`） |
| `DSH_HOME_HOST` | `/root/.dsh` | 宿主 `$DSH_HOME` 绝对路径；Windows 示例 `C:/Users/<you>/.dsh` |
| `HOST_PORT` | `13080` | 容器 `3080` 映射到的宿主端口 |
| `GRID_LABEL` | `local` | 该格在日志与 `testbed/.out/` 中的标识 |

### 4.4 网络

- 容器 → 宿主服务（如宿主 NewAPI 网关 `127.0.0.1:20128`）：通过 `host.docker.internal`（`host-gateway`）。
- 容器 → 公网（`npm ci`、`npm pack`、`pnpm install`）：默认 bridge 出网；无网络时 L1/L2 无法完成，脚本以明确错误退出而非静默跳过。
- 宿主 → 容器：仅 `127.0.0.1:${HOST_PORT}` 一个端口，且只绑回环。

---

## 5. entrypoint 执行流程（六步）

1. **断言只读**：确认 `/host-dsh-home` 与 `/plugin-src` 所在挂载点不可写；不可写性不成立则立即失败（防止"测试"污染宿主）。
2. **播种 `$DSH_HOME`**：容器内 `DSH_HOME=/work/dsh-home`；从 `/host-dsh-home` 白名单复制 `settings.yaml`、`.credentials.yaml`、`skills/`、`storages/`（仅用于复现宿主持久化状态，不含会话历史）、`pet.json`；`chmod 600 .credentials.yaml`（quota 仓库 CI 注释记录的坑：凭据文件权限过宽会导致整棵插件树加载失败）。不复制 `sessions/`、`attachments/`、`browser-*`、`change-ledger/`、`profiles/*/node_modules`。
3. **暂存源码**：`cp -a /plugin-src/. /work/plugin/`（排除 `node_modules`、`.git`、`.tmp-*`）；`COMPANION` 非空时同样暂存 `/companion-src` 到 `/work/companion`；随后 `npm ci`。
4. **构造 profile**：按 `PROFILE_MODE` 执行（见 4.3）。被测插件一律以 **`npm pack` 产物**安装（`prepack` 会构建，等价于用户真实安装路径）。装完补写 `dsh.profile.bundles` 行并打印实际行列表。
5. **L1（源码层）**：`npm run typecheck` → `npm run test:client` → `npm run test:host` → `node test/smoke.mjs`。
6. **L2（真实宿主层）**：`dsh web` 后台启动 → 从日志抓一次性 token 换会话 cookie → 执行 `probes/boot-probe.sh` → 无论成败都 dump 日志尾部到 `testbed/.out/${GRID_LABEL}.log` → 以该格结论退出。

任一步失败：立即停止该格后续步骤，输出带前缀的失败摘要，退出码非 0。

---

## 6. 矩阵语义（`matrix.mjs`）

- **版本解析**：`--versions` 可显式给出；默认 `latest,next` 经 `npm view @deepseek-ai/dsh dist-tags` 解析后**去重**（当前结果：`0.1.5-rc.1`、`0.1.5-rc.2`）。支持线（本仓库 peer 下限 `>=0.1.5-rc.1 <0.1.6`）通过 `--versions 0.1.5-rc.1,0.1.5-rc.2` 显式固定，用于回归。
- **组合解析**：`--combos self,self+companion`；`self` 恒在，`self+companion` 需要 `COMPANION_HOST_DIR`。
- **执行**：每格 `docker compose run --rm --build`（`--build` 保证 `DSH_VERSION` 变更时镜像层同步）。
- **产物**：`testbed/.out/<version>-<combo>.log`，逐格 tee。
- **汇总**：末尾打印 `版本 × 组合` 的 PASS/FAIL 表格、失败格日志路径、总耗时；存在失败格时退出码 1。
- **并发**：默认串行（宿主端口与内存有限）；`--jobs N` 时为每格分配递增 `HOST_PORT`。

---

## 7. 本仓库的 L1 / L2 断言

### L1（源码层）

| 步骤 | 命令 | 判红 |
| --- | --- | --- |
| 类型 | `npm run typecheck` | 非零退出（host 与 client 两套 tsconfig 都跑） |
| 产物新鲜度 | `npm run build` 前后对 `lib/` 做 sha256 清单比对（**不使用 `git diff`**：容器内源码副本刻意不含 `.git`） | 构建后 `lib/` 发生变化 = 提交的产物过期，与 CI 的 "Committed artifacts are current" 等价 |
| 客户端组件 | `npm run test:client`（vitest） | 任一用例失败 |
| 宿主导出面 | `npm run test:host`（`host-compat.mjs`） | 与容器内实际安装的 `@deepseek-ai/dsh-llm` 导出面不一致；快照 `surfaceSharedBy` 未列出的版本会失败并提示比对 |
| 组合 | `node test/smoke.mjs` | 非零退出；`npm run cache:models-dev` 未跑时，真实目录检查按既有设计跳过（记录为 diagnostic，不算失败） |

> 容器化带来的直接收益：`host-compat.mjs` 从"只跑 CI 的单一 pin"变成"在矩阵的每个宿主版本上真跑"。

### L2（真实宿主层，`probes/boot-probe.sh`）

| 断言 | 内容 | 判红 |
| --- | --- | --- |
| 装配 | `dsh --dump-config` 组合树包含本插件行，且 patch 层生效 | 缺行 |
| 启动 | `dsh web` 进程存活至探针结束 | 提前退出 |
| 认证 | 日志中的 `token=` 换到会话 cookie（0.1.5 起强制） | 拿不到 cookie |
| 首页 | `GET /` → 200（带 cookie） | 非 200 |
| 浏览器半边 | boot 图（`window.__DSH_BOOT__` 所在页面）中出现 `dsh-llm-newapi/client.js` 引用 | 引用缺失 |
| RPC 通道 | `POST /llm-newapi/ci-probe`（unknown-endpoint 探针，避免依赖第三方目录下载）返回 `server-response` 且 `result.ok === false`、错误信息含 `unknown endpoint ci-probe`。通道路径以 `lib/index.js` 的实际注册为准；路径写错会落到 SPA 回退（405/404），断言因此变红，不会恒绿 | HTTP 405（SPA 回退 = 通道静默缺失）或响应形状不符 |
| 日志卫生 | `dsh web` 日志不含 `plugin tree failed to load`、`without inject` | 出现即红（两次真实事故的形态） |

### 组合格（`COMPANION=dsh-quota-panel`）追加断言

| 断言 | 判红 |
| --- | --- |
| boot 图中同时出现两个插件的 `client.js` | 缺任一 |
| 两个 RPC 通道各自可应答，互不覆盖 | 任一非 200 或返回到另一个通道 |
| 日志无 slot / service 重复注册警告 | 出现 |

断言分 `required`（判红）与 `diagnostic`（仅记录）。本仓库的 models.dev 真实目录检查属 diagnostic。

---

## 8. 跨仓库共享契约（两个仓库必须逐字一致）

| 项 | 约定 |
| --- | --- |
| 目录 | `testbed/`，位于仓库根 |
| service 名 | `testbed` |
| 文件 | `Dockerfile`、`compose.yaml`、`.env.example`、`entrypoint.sh`、`matrix.mjs`、`probes/`、README（双语） |
| 基础镜像 | `node:24-bookworm-slim`（与 CI 的 node 24 对齐） |
| 宿主版本默认值 | 各仓库跟自己的 CI 锚点一致（本仓库 `0.1.5-rc.2`，即 CI dev pin）；矩阵运行总是显式覆盖该值 |
| 对端叠加 | `COMPANION` + `COMPANION_HOST_DIR` |
| 端口 | 默认 `HOST_PORT=13080`，`--jobs` 时递增 |
| 产物 | `testbed/.out/<version>-<combo>.log`，且 `.gitignore` 忽略 `testbed/.out/` |
| 日志前缀 | `[testbed][<version>][<combo>][<step>]` |
| 退出码 | 0 = 该格全绿；非零 = 该格失败 |
| 矩阵退出码 | 0 = 全部格绿；1 = 存在失败格 |

契约只约束**命名与语义**，不共享代码：两个仓库各自实现，避免引入第三个真源。

---

## 9. 验收标准

1. `docker compose run --rm testbed` 在本仓库跑通 L1 + L2，且**宿主零改动**：运行前后 `git status` 干净、宿主 `$DSH_HOME` 无新增/修改文件、宿主 `3080` 上的 GUI 不受影响。
2. `node testbed/matrix.mjs` 在当前版本集合（`0.1.5-rc.1`、`0.1.5-rc.2`）× `self` 上输出汇总表并全绿。
3. `COMPANION_HOST_DIR=../dsh-quota-panel COMPANION=dsh-quota-panel` 时，`self+companion` 格跑通并通过追加断言。
4. **阴性对照（必做）**：人为注入一个缺陷后矩阵必须变红。至少验证两种：
   - 客户端半边：破坏 `lib/client.js` 的入口/名字（或临时把客户端构建产物改名），`L2 · 浏览器半边` 断言必须红；
   - RPC 通道：临时去掉 `connection.register(...)` 调用，`L2 · RPC 通道` 断言必须红（复现历史上的 405 形态）。
   对照实验结束后必须还原工作区，且还原后矩阵回到全绿。
5. `testbed/README.md`（英）与 `testbed/README.zh-CN.md`（中）覆盖：前置条件、首次构建、四个常用命令（单格、指定版本、叠加对端、全矩阵）、宿主机零改动的验证方法、故障排查（端口占用、镜像拉取、凭据权限）。
6. 插件运行时依赖零增长：`package.json` 的 `dependencies` / `peerDependencies` 不变；`matrix.mjs` 只用 Node 内建模块。

---

## 10. 风险与回退

| 风险 | 影响 | 缓解 / 回退 |
| --- | --- | --- |
| `preserve` 模式在 npm 布局的宿主 profile 上跑 pnpm（`dsh plugin` 转发 pnpm） | 可能导致 profile 依赖树混乱或安装失败 | 实施第一步先做这项实测；失败则该模式标记为 experimental 并保持默认 `minimal`（与现有 CI 同路，已验证） |
| 首次构建需拉 `node:24-bookworm-slim` | 无网络或 registry 不可达时无法启动 | 镜像预拉步骤写进 README；失败时给出明确错误与替代（`docker load` 离线导入） |
| 容器内 `npm ci` / `pnpm install` 依赖网络 | 断网环境下 L1/L2 不可用 | 明确报错；命名卷缓存降低重复开销；不静默跳过 |
| 宿主 `$DSH_HOME` 含真实凭据且被复制进容器 | 凭据在容器内对被测插件代码可见 | 见第 11 节：这是**接受的取舍**，写入文档而非隐藏；默认不主动外呼（不做 L4） |
| Windows（Docker Desktop）路径与权限 | 绑定挂载路径写法不同；`chmod 600` 语义不同 | `.env.example` 给出 Windows 示例；`chmod` 失败降级为警告并记录（quota 的权限守卫若因此触发，需在 README 说明） |
| 端口 `13080` 在本机被占用 | 容器起不来 | `HOST_PORT` 可覆盖；启动前检测并给出明确提示 |
| 版本集合随上游漂移 | 矩阵含义变化 | `matrix.mjs` 每次运行打印解析到的真实版本与解析来源（dist-tag / 显式） |

---

## 11. 明确承诺与明确不承诺

**承诺**：

- 宿主 `$DSH_HOME` 与仓库源码均以只读方式进入容器；所有写入发生在容器可写层与命名卷。
- 不占用宿主 `3080`；不动宿主任何配置文件。
- 不改动现有 CI 任务。

**不承诺**：

- 这不是安全沙箱。容器内会执行本仓库与对端插件的源码，且能读到只读挂载进来的真实凭据。它解决的是**环境污染与版本矩阵**问题，不是**不可信代码隔离**问题。不要用它运行来源不明的插件。

---

## 12. 全球 / 中国双网络配置（2026-09 补充，已批准）

GitHub Actions / 发布验证继续使用官方全球基线 `testbed/compose.yaml`；本地代理通过仓库内 skill 默认选择 `testbed/compose.china.yaml` 覆盖层。中国模式覆盖 Node 基础镜像、npm registry、临时 apt mirror 与可选代理，并使用独立 image / Compose project 标识。统一 Node 启动器和 matrix 的 `--network global|china` 参数生成 Compose 文件列表，未知模式失败关闭；项目 skill 只对本地 testbed 请求默认 China，复现 CI 时显式 global，不修改 CI 或存储凭据。两模式需分别验证 Compose 解析，全球配置不得出现中国镜像域，中国模式至少完成一次实际 build 或保留明确网络阻断证据。

本补充同样适用于 `dsh-quota-panel`，两仓库的 skill 与网络模式语义保持一致。

## 13. 未决问题

无。第 10 节的 `preserve` 模式风险以实际装配结果记录；双网络具体镜像站与 digest 由 README 和测试证据维护，不污染全球基线。
