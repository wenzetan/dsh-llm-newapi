# Docker Compose 测试环境（testbed）实施计划 — dsh-llm-newapi

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本仓库新增自包含的 `testbed/`，用 Docker Compose 在容器内跑通源码层（L1）与真实宿主启动层（L2）校验，支持多宿主版本与插件组合，且宿主环境零改动。

**Architecture:** 单个 `node:24-bookworm-slim` 镜像（`ARG DSH_VERSION` 决定容器内 dsh 版本）+ 单 service compose 模板（全部行为由环境变量驱动）+ 六步 entrypoint（只读断言 → 播种 `$DSH_HOME` → 暂存源码 → 构造 profile → L1 → L2）+ 一个矩阵脚本遍历"宿主版本 × 插件组合"。宿主的 `$DSH_HOME` 与仓库源码都以**只读**方式挂载进容器，一切写入落在容器可写层与命名卷。

**Tech Stack:** Docker / Docker Compose v2、Node.js 24、pnpm（`dsh plugin` 转发目标）、bash、Node 内建模块（`matrix.mjs` 不引入任何依赖）。

**Spec:** `docs/superpowers/specs/2026-09-15-docker-compose-testbed-design.md`

## Global Constraints

- 基础镜像固定 `node:24-bookworm-slim`（与 CI 的 node 24 对齐）；镜像内安装 `pnpm` 与 `@deepseek-ai/dsh@${DSH_VERSION}`。
- 新增文件只位于 `testbed/`，另在 `.gitignore` 追加一行 `testbed/.out/`；**不改动**现有 CI 任务、`package.json` 脚本与 `src/`。
- 宿主 `$DSH_HOME`（默认 `/root/.dsh`）与仓库源码（`..`）一律**只读**挂载；entrypoint 必须在启动时断言两者不可写，否则立即失败退出。
- 容器端口映射固定为 `127.0.0.1:${HOST_PORT:-13080}:3080`——宿主 `3080` 正被 GUI 占用，绝不占用。
- 默认值：`DSH_VERSION=0.1.5-rc.2`（本仓库 CI dev pin）、`PROFILE_MODE=minimal`、`HOST_PORT=13080`、`GRID_LABEL=local`、`STEPS=all`。
- 产物流水：`testbed/.out/<version>-<combo>.log`；日志前缀 `[testbed][<version>][<combo>][<step>]`。
- 退出码：单格 0 = 全绿 / 非零 = 失败；矩阵 0 = 全部格绿 / 1 = 存在失败格。
- 插件运行时依赖零增长：`package.json` 的 `dependencies` 与 `peerDependencies` 保持不变。
- 宿主侧 `docker` 的状态目录 `/root/.docker` 在开发沙箱下只读：所有宿主侧 `docker compose` 调用必须在 `testbed/` 目录内使用仓库内的可写配置目录（`export DOCKER_CONFIG="$PWD/.docker-config"`）。该目录**不得**存放任何凭据文件，且必须被 `.gitignore` 忽略。
- 基础镜像获取：当 daemon 的 registry mirror 不可用或 `docker.io` 直连超时时，允许从可信镜像站预取后**按原名打本地标签**（`Dockerfile` 的 `FROM` 始终保持官方名），并在 README 记录来源与 digest；不得把第三方镜像站写进 `FROM`。
- 本轮不做浏览器 E2E、不做真实上游调用、不接 CI。
- 注释、README、提交信息使用中文说明 + 英文技术标识（与本仓库双语文档传统一致）。

## File Structure

| 文件 | 职责 |
| --- | --- |
| `testbed/Dockerfile` | 构建带 node 24 + pnpm + 指定版本 dsh 的镜像；`ARG DSH_VERSION`/`ARG NPM_REGISTRY` |
| `testbed/compose.yaml` | 单 service 模板：镜像构建、环境变量、只读挂载、命名卷、端口、host-gateway |
| `testbed/entrypoint.sh` | 六步流程；支持 `STEPS` 分步执行与 `--check-image` 自检 |
| `testbed/probes/boot-probe.sh` | L2 探针：认证、首页、boot 图、RPC 通道、日志卫生 |
| `testbed/probes/preserve-seed.mjs` | `preserve` 模式：从宿主 profile 读出 `dsh.profile.bundles` 行 |
| `testbed/matrix.mjs` | 版本/组合解析、逐格执行、宿主零改动快照、汇总表 |
| `testbed/.empty/.gitkeep` | 未提供 `COMPANION_HOST_DIR` 时的占位只读挂载点 |
| `testbed/.env.example` | 宿主侧变量示例（Linux / Windows 各一段） |
| `testbed/README.md`、`testbed/README.zh-CN.md` | 双语用法与排查 |
| `.gitignore` | 追加 `testbed/.out/` |

**任务依赖**：Task 1 → 2 → 3 → 4 → {5, 6} → 7 → 8 → 9。Task 5 与 Task 6 可互换顺序，但都必须在 Task 4 之后。

---

### Task 1: 镜像骨架与 compose service

**Files:**
- Create: `testbed/Dockerfile`
- Create: `testbed/compose.yaml`
- Create: `testbed/.empty/.gitkeep`
- Create: `testbed/.env.example`
- Create: `testbed/entrypoint.sh`（仅自检分支，后续任务扩展）

**Interfaces:**
- Consumes: 无
- Produces: 镜像自检入口 `entrypoint.sh --check-image`（打印 node/pnpm/dsh 版本）；compose service 名 `testbed`；环境变量契约 `DSH_VERSION` / `PROFILE_MODE` / `COMPANION` / `COMPANION_HOST_DIR` / `DSH_HOME_HOST` / `HOST_PORT` / `GRID_LABEL` / `STEPS`

- [ ] **Step 1: 写 `testbed/Dockerfile`**

```dockerfile
# testbed 镜像：node 24（与 CI 一致）+ pnpm（dsh plugin 转发 pnpm）+ 指定版本的 dsh。
# 刻意不写 `# syntax=docker/dockerfile:1`：本文件只用标准 Dockerfile 语法，而该行会让每次构建
# 都去 registry 解析一次 frontend 镜像——在本机（mirror 不可用）实测每次要等 60 秒超时。
# NPM_REGISTRY 可覆盖：若 @deepseek-ai/* 命中 registry 的 stale-packument（EINTEGRITY），
# 按 CI 的经验改用镜像源，例如 https://registry.npmmirror.com。
FROM node:24-bookworm-slim

ARG DSH_VERSION=0.1.5-rc.2
ARG NPM_REGISTRY=https://registry.npmjs.org

ENV DSH_VERSION=${DSH_VERSION} \
    DSH_HOME=/work/dsh-home \
    DEBIAN_FRONTEND=noninteractive

# curl 供探针使用；ca-certificates 供 HTTPS；git 供 pnpm 解析 git 依赖。
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g --no-audit --no-fund --registry="${NPM_REGISTRY}" \
      pnpm "@deepseek-ai/dsh@${DSH_VERSION}" \
 && dsh --version \
 && pnpm --version

WORKDIR /work
COPY entrypoint.sh /usr/local/bin/testbed-entrypoint
RUN chmod +x /usr/local/bin/testbed-entrypoint

ENTRYPOINT ["/usr/local/bin/testbed-entrypoint"]
```

- [ ] **Step 2: 写 `testbed/compose.yaml`**

```yaml
# testbed：单 service 模板。宿主 $DSH_HOME 与仓库源码都只读挂载；写入只落在
# 容器可写层与命名卷。宿主 3080 被 GUI 占用，这里固定映射到 13080 起。
name: dsh-testbed-llm-newapi

services:
  testbed:
    build:
      context: .
      args:
        DSH_VERSION: "${DSH_VERSION:-0.1.5-rc.2}"
        NPM_REGISTRY: "${NPM_REGISTRY:-https://registry.npmjs.org}"
    image: "dsh-testbed-llm-newapi:${DSH_VERSION:-0.1.5-rc.2}"
    environment:
      DSH_VERSION: "${DSH_VERSION:-0.1.5-rc.2}"
      PROFILE_MODE: "${PROFILE_MODE:-minimal}"
      COMPANION: "${COMPANION:-}"
      GRID_LABEL: "${GRID_LABEL:-local}"
      STEPS: "${STEPS:-all}"
    volumes:
      - "${DSH_HOME_HOST:-/root/.dsh}:/host-dsh-home:ro"
      - "..:/plugin-src:ro"
      - "${COMPANION_HOST_DIR:-./.empty}:/companion-src:ro"
      - "npm-cache:/root/.npm"
      - "pnpm-store:/root/.local/share/pnpm/store"
    ports:
      - "127.0.0.1:${HOST_PORT:-13080}:3080"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    working_dir: /work

volumes:
  npm-cache:
  pnpm-store:
```

- [ ] **Step 3: 写 `testbed/.empty/.gitkeep`（空文件）与 `testbed/.env.example`**

```dotenv
# testbed 宿主侧变量示例。复制为 testbed/.env 后按需修改；不要提交 .env。
#
# Linux / macOS：
DSH_HOME_HOST=/root/.dsh
# Windows（Docker Desktop）：
# DSH_HOME_HOST=C:/Users/<you>/.dsh
#
# 互不相同的宿主端口（GUI 占用 3080，故从 13080 起）：
HOST_PORT=13080
# 镜像源：遇到 @deepseek-ai/* 的 EINTEGRITY 时改用镜像
# NPM_REGISTRY=https://registry.npmmirror.com
```

- [ ] **Step 4: 写 `testbed/entrypoint.sh` 骨架（本任务只实现自检分支）**

```bash
#!/usr/bin/env bash
# testbed entrypoint：在容器内构造隔离的 DSH_HOME，依次跑 L1（源码层）与 L2（真实宿主层）。
# 宿主侧只读挂载：/host-dsh-home（整份 $DSH_HOME）、/plugin-src（本仓库源码）、/companion-src（可选对端）。
set -euo pipefail

DSH_VERSION="${DSH_VERSION:?DSH_VERSION is required}"
GRID_LABEL="${GRID_LABEL:-local}"
PROFILE_MODE="${PROFILE_MODE:-minimal}"
COMPANION="${COMPANION:-}"
STEPS="${STEPS:-all}"

STATE=/work/dsh-home
PREFIX="[testbed][${DSH_VERSION}][${GRID_LABEL}]"

log() { printf '%s[%s] %s\n' "$PREFIX" "$1" "$2"; }
die() { log fail "$1"; exit 1; }

# want <step>：STEPS 为 all 或显式包含该步时返回 0
want() {
	case ",${STEPS}," in
		*,all,* | *,"$1",*) return 0 ;;
		*) return 1 ;;
	esac
}

check_image() {
	log image "node $(node -v) / npm $(npm -v)"
	log image "pnpm $(pnpm --version)"
	log image "dsh $(dsh --version)"
}

main() {
	if [ "${1:-}" = "--check-image" ]; then
		check_image
		return 0
	fi
	die "entrypoint 尚未实现完整流程（见后续任务）"
}

main "$@"
```

- [ ] **Step 5: 构建并自检镜像**

Run:
```bash
cd testbed && docker compose run --rm --build testbed --check-image
```
Expected: 三行 `[testbed][0.1.5-rc.2][local][image] …`，分别打印 node 版本（v24.x）、pnpm 版本、dsh 版本；退出码 0。

- [ ] **Step 6: 验证版本参数真的生效（反例）**

Run:
```bash
cd testbed && DSH_VERSION=0.1.5-rc.1 docker compose run --rm --build testbed --check-image
```
Expected: 第四行打印的 dsh 版本为 `0.1.5-rc.1`（而非默认的 `0.1.5-rc.2`）——证明 `ARG`/`image` 标签与运行时版本联动。

- [ ] **Step 7: 提交**

```bash
git add testbed/Dockerfile testbed/compose.yaml testbed/.empty/.gitkeep testbed/.env.example testbed/entrypoint.sh
git commit -m "test(testbed): 容器镜像骨架与 compose 单 service 模板"
```

---

### Task 2: 只读断言与 DSH_HOME 播种

**Files:**
- Modify: `testbed/entrypoint.sh`（新增 `assert_readonly`、`seed_home`，接入 `STEPS`）
- Create: `testbed/.gitignore`（忽略 `.out/`、`.env`、`.docker-config/`）
- Create: `testbed/.docker-config/.gitkeep`（宿主侧 docker CLI 的可写状态目录；**不含任何凭据文件**）

**Interfaces:**
- Consumes: Task 1 的 `PREFIX` / `log` / `die` / `want` / `check_image`
- Produces: 容器内可用的 `$STATE`（`/work/dsh-home`）与函数 `assert_readonly`、`seed_home`；后续任务在 `main` 的步骤序列里插入自己的函数

- [ ] **Step 1: 记录基线（当前骨架对"可写挂载"毫无反应）**

`docker compose run -v` **无法**覆盖 compose 里已声明的 `/plugin-src:ro`（同 target 时 service 定义胜出，Compose v5.3.1 已实测），因此构造"可写挂载"这一反例条件必须用裸 `docker run`：

```bash
cd testbed && docker build -t dsh-testbed-llm-newapi:0.1.5-rc.2 .
docker run --rm \
  -v /root/.dsh:/host-dsh-home:ro \
  -v "$PWD/.empty:/plugin-src:rw" \
  -e DSH_VERSION=0.1.5-rc.2 \
  dsh-testbed-llm-newapi:0.1.5-rc.2
```
Expected: 此刻 entrypoint 只有自检分支，无参数时 `die`（退出码非 0）且**与挂载可写无关**——记下这一点：实现断言之前，可写挂载不会被拒绝。

- [ ] **Step 2: 实现 `assert_readonly` 与 `seed_home`**

把 `testbed/entrypoint.sh` 的 `main` 之前插入以下两个函数，并替换 `main`：

```bash
assert_readonly() {
	local m
	for m in /host-dsh-home /plugin-src; do
		[ -d "$m" ] || die "缺少只读挂载：$m"
		if touch "$m/.testbed-write-probe" 2>/dev/null; then
			rm -f "$m/.testbed-write-probe"
			die "$m 可写——拒绝运行（会污染宿主）。请确认 compose 使用 :ro 挂载"
		fi
	done
	log assert "宿主挂载确认为只读"
}

# 只复制配置类文件；会话/浏览器/账本数据一律不进容器。
seed_home() {
	rm -rf "$STATE"
	mkdir -p "$STATE"
	local f d
	for f in settings.yaml .credentials.yaml pet.json; do
		[ -e "/host-dsh-home/$f" ] && cp -a "/host-dsh-home/$f" "$STATE/$f"
	done
	for d in skills storages; do
		[ -d "/host-dsh-home/$d" ] && cp -a "/host-dsh-home/$d" "$STATE/$d"
	done
	if [ -e "$STATE/.credentials.yaml" ]; then
		# credentials-local 拒绝 owner 之外可读的文件（默认 umask 给 644），
		# 权限过宽会让整棵插件树加载失败——CI 的 boot job 里记着这个坑。
		chmod 600 "$STATE/.credentials.yaml"
		log seed "凭据已播种（mode 600）"
	fi
	log seed "DSH_HOME 就绪：$STATE"
}

main() {
	if [ "${1:-}" = "--check-image" ]; then
		check_image
		return 0
	fi
	want assert && assert_readonly
	want seed && seed_home
	log done "所选步骤完成：STEPS=${STEPS}"
}

main "$@"
```

- [ ] **Step 3: 验证正常路径**

Run:
```bash
cd testbed && STEPS=assert,seed docker compose run --rm --build testbed
```
Expected:
```
[testbed][0.1.5-rc.2][local][assert] 宿主挂载确认为只读
[testbed][0.1.5-rc.2][local][seed] 凭据已播种（mode 600）
[testbed][0.1.5-rc.2][local][seed] DSH_HOME 就绪：/work/dsh-home
[testbed][0.1.5-rc.2][local][done] 所选步骤完成：STEPS=assert,seed
```
退出码 0。

- [ ] **Step 4: 验证反例——可写挂载必须被拒绝**

```bash
cd testbed && docker run --rm \
  -v /root/.dsh:/host-dsh-home:ro \
  -v "$PWD/.empty:/plugin-src:rw" \
  -e DSH_VERSION=0.1.5-rc.2 \
  dsh-testbed-llm-newapi:0.1.5-rc.2; echo "exit=$?"
```
Expected: 输出 `…[fail] /plugin-src 可写——拒绝运行（会污染宿主）。请确认 compose 使用 :ro 挂载`，`exit=1`。（Compose v5.3.1 下 `run -v` 覆盖同 target 的 `:ro` 无效，故用裸 `docker run`。）

- [ ] **Step 5: 验证宿主配置文件确实没被改**

Run:
```bash
find /root/.dsh -maxdepth 1 -newermt '-2 minutes' -not -name '.*' -not -path '/root/.dsh/sessions*' -not -path '/root/.dsh/storages*' -not -path '/root/.dsh/change-ledger*'
```
Expected: 无输出（`settings.yaml`、`profiles/`、`.credentials.yaml` 的时间戳都没变）。

- [ ] **Step 5b: 创建宿主侧 docker 配置目录与 `testbed/.gitignore`**

写 `testbed/.gitignore`：

```gitignore
# testbed 运行产物与本地配置
.out/
.env
# 忽略 docker CLI 状态目录内容，但保留占位文件（否则同一步无法提交它）
.docker-config/*
!.docker-config/.gitkeep
```

并创建 `testbed/.docker-config/.gitkeep`（0 字节）。该目录只为让 docker CLI 有一个**可写**状态目录（本会话下 `/root/.docker` 只读）；**不得**把 `~/.docker/config.json` 或任何含凭据的文件复制进来。

验证（同时验证该目录可用）：

```bash
cd testbed && export DOCKER_CONFIG="$PWD/.docker-config" && docker compose run --rm --build testbed --check-image
```
Expected: 三行 `[testbed][…][local][image] …`，退出码 0。

- [ ] **Step 6: 提交**

```bash
git add testbed/entrypoint.sh testbed/.gitignore testbed/.docker-config/.gitkeep
git commit -m "test(testbed): 只读断言、DSH_HOME 播种与宿主 docker 配置目录"
```

---

### Task 3: 源码暂存与 L1（含产物新鲜度）

**Files:**
- Modify: `testbed/entrypoint.sh`（新增 `stage_sources`、`lib_digest`、`run_l1`）

**Interfaces:**
- Consumes: Task 2 的 `STATE` / `seed_home`
- Produces: `/work/plugin`（源码副本，不含 `node_modules` / `.git` / `.tmp-*`）；函数 `stage_sources`、`lib_digest`、`run_l1`

- [ ] **Step 1: 新增函数并接入 `main`**

在 `testbed/entrypoint.sh` 的 `seed_home` 之后插入：

```bash
# 复制源码时必须排除 node_modules（122 MB）与 .tmp-*（本仓库的缓存/试验目录）；
# 刻意不复制 .git：因此产物新鲜度检查不能用 git diff，改用内容哈希。
stage_sources() {
	rm -rf /work/plugin
	mkdir -p /work/plugin
	tar -C /plugin-src \
		--exclude=./node_modules --exclude=./.git --exclude='./.tmp-*' \
		-cf - . | tar -C /work/plugin -xf -
	[ -f /work/plugin/package.json ] || die "源码暂存失败：/work/plugin/package.json 不存在"
	log stage "源码已暂存：/work/plugin"
}

lib_digest() {
	find lib -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
}

run_l1() {
	cd /work/plugin
	log l1 "npm ci"
	npm ci --no-audit --no-fund
	log l1 "typecheck（host + client 两套 tsconfig）"
	npm run typecheck
	local before after
	before="$(lib_digest)"
	log l1 "build"
	npm run build
	after="$(lib_digest)"
	if [ "$before" != "$after" ]; then
		die "lib/ 与全新构建不一致：产物过期，请在本地 npm run build 后提交重建的 lib/（等价于 CI 的 committed artifacts are current）"
	fi
	log l1 "产物新鲜度：lib/ 内容哈希与全新构建一致"
	log l1 "test:client（vitest）"
	npm run test:client
	log l1 "test:host（host-compat，对齐容器内实际安装的 dsh-llm）"
	npm run test:host
	log l1 "smoke（真实 Cordis 组合）"
	node test/smoke.mjs
	log l1 "全部通过"
}
```

并把 `main` 改为：

```bash
main() {
	if [ "${1:-}" = "--check-image" ]; then
		check_image
		return 0
	fi
	want assert && assert_readonly
	want seed && seed_home
	want stage && stage_sources
	want l1 && run_l1
	log done "所选步骤完成：STEPS=${STEPS}"
}

main "$@"
```

- [ ] **Step 2: 运行 L1（首次会下载依赖，约数分钟）**

Run:
```bash
cd testbed && STEPS=assert,seed,stage,l1 docker compose run --rm --build testbed
```
Expected: 依次出现 `[stage] 源码已暂存`、`[l1] 产物新鲜度：lib/ 内容哈希与全新构建一致`、vitest 24 个用例通过、`host-compat: …`、`smoke: …`，最后 `[l1] 全部通过`；退出码 0。

- [ ] **Step 3: 验证产物新鲜度能红（反例）**

在宿主机上临时追加一行到 `lib/index.js`（不改 `src/`）——源码副本由宿主目录复制而来，这一改动会被带进容器，正是该断言要抓的情形：

```bash
printf '\n// testbed freshness probe\n' >> lib/index.js
cd testbed && STEPS=assert,seed,stage,l1 docker compose run --rm --build testbed; echo "exit=$?"
git checkout -- lib/index.js
```
Expected: 输出 `…[fail] lib/ 与全新构建不一致：产物过期…`，`exit=1`；`git checkout` 还原后重跑 Step 2 回到全绿。（因为源码副本是从宿主目录复制的，宿主的临时改动会被带进容器——这正是该断言要抓的情形。）

- [ ] **Step 4: 确认下游依赖确实按容器内宿主人版本运行**

在 Step 2 的输出中确认这一行：
```
host-compat: snapshot matches the installed published dsh-llm 0.1.5-rc.2 (surface shared by 0.1.5-rc.1, 0.1.5-rc.2)
```
Expected: 版本号与 `DSH_VERSION` 一致。再跑一次 `DSH_VERSION=0.1.5-rc.1`：若 `surfaceSharedBy` 已列出该版本则同样通过；若未列出，输出会失败并提示比对导出面——这属于该门禁的设计行为，不要为了让矩阵变绿而改动 fixture。

- [ ] **Step 5: 提交**

```bash
git add testbed/entrypoint.sh
git commit -m "test(testbed): 源码暂存与 L1（typecheck/产物新鲜度/vitest/host-compat/smoke）"
```

---

### Task 4: profile 构造（minimal）与装配断言

**Files:**
- Modify: `testbed/entrypoint.sh`（新增 `pack_plugin`、`register_bundle_rows`、`build_profile_minimal`、`dump_profile`）

**Interfaces:**
- Consumes: Task 3 的 `/work/plugin`
- Produces: `/work/dist/*.tgz`（`npm pack` 产物）；容器内 `$DSH_HOME/profiles/web`（可直接 `dsh web`）；函数 `build_profile`、`dump_profile`

- [ ] **Step 1: 新增函数并接入 `main`**

在 `run_l1` 之后插入：

```bash
pack_plugin() {
	cd /work/plugin
	rm -rf /work/dist
	mkdir -p /work/dist
	npm pack --pack-destination /work/dist >/dev/null
	TARBALL="$(ls /work/dist/*.tgz | head -1)"
	[ -n "$TARBALL" ] || die "npm pack 未产出 tarball"
	log pack "已打包：$(basename "$TARBALL")"
	export TARBALL
}

# bundles 行决定 dsh 启动时装载哪些 bundle 层。CI 里这一步是手工补写的，
# 这里同样显式写入并打印，避免"装了但没注册"的假绿。
register_bundle_rows() {
	node -e '
		const fs = require("node:fs")
		const path = process.argv[1]
		const rows = process.argv.slice(2)
		const pkg = JSON.parse(fs.readFileSync(path, "utf8"))
		pkg.dsh ??= {}
		pkg.dsh.profile ??= {}
		pkg.dsh.profile.bundles ??= ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]
		for (const row of rows) if (!pkg.dsh.profile.bundles.includes(row)) pkg.dsh.profile.bundles.push(row)
		fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n")
		console.log("bundles: " + pkg.dsh.profile.bundles.join(", "))
	' "$STATE/profiles/web/package.json" dsh-llm-newapi
}

build_profile() {
	case "$PROFILE_MODE" in
		minimal)
			log profile "PROFILE_MODE=minimal：空 profile + 安装本仓库 tarball"
			dsh plugin --profile web add "$TARBALL"
			;;
		preserve)
			die "PROFILE_MODE=preserve 尚未实现（见 Task 5）"
			;;
		*)
			die "未知 PROFILE_MODE：$PROFILE_MODE"
			;;
	esac
	[ -f "$STATE/profiles/web/package.json" ] || die "dsh plugin add 未生成 $STATE/profiles/web/package.json"
	register_bundle_rows
}

# 装配断言：组合树里必须出现本插件行。
dump_profile() {
	dsh --profile web --dump-config > /work/dump-config.txt 2>&1 \
		|| die "dsh --dump-config 失败，见 /work/dump-config.txt"
	grep -q "dsh-llm-newapi" /work/dump-config.txt \
		|| die "组合树中没有 dsh-llm-newapi 行（patch 层未生效）"
	log profile "装配断言通过：组合树包含 dsh-llm-newapi"
}
```

并把 `main` 改为：

```bash
main() {
	if [ "${1:-}" = "--check-image" ]; then
		check_image
		return 0
	fi
	want assert && assert_readonly
	want seed && seed_home
	want stage && stage_sources
	want l1 && run_l1
	want pack && pack_plugin
	want profile && build_profile
	want profile && dump_profile
	log done "所选步骤完成：STEPS=${STEPS}"
}
```

同时把 `TARBALL=""` 加入文件顶部变量区，并把 `export TARBALL` 保留在 `pack_plugin` 内。

- [ ] **Step 2: 运行到装配断言**

Run:
```bash
cd testbed && STEPS=assert,seed,stage,l1,pack,profile docker compose run --rm --build testbed
```
Expected:
```
… [pack] 已打包：dsh-llm-newapi-0.8.6-rc.3.tgz
… bundles: @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, dsh-llm-newapi
… [profile] 装配断言通过：组合树包含 dsh-llm-newapi
```
退出码 0。

- [ ] **Step 3: 验证装配断言能红（反例）**

**不能**用"删掉 `register_bundle_rows` 调用"来做这个对照：`dsh plugin --profile web add` 在本宿主版本上**自己**就会把包名写进 `dsh.profile.bundles`，所以删掉该调用后装配断言依然绿（`register_bundle_rows` 只是幂等兜底 + 打印）。有效的变异点是**装完之后把 profile 里的那一行剥掉**：

```bash
cd testbed && docker compose run --rm --build --entrypoint bash testbed -lc '
  set -e
  STEPS=assert,seed,stage,l1,pack,profile /usr/local/bin/testbed-entrypoint >/dev/null
  node -e "
    const fs = require(\"node:fs\")
    const p = process.env.DSH_HOME + \"/profiles/web/package.json\"
    const pkg = JSON.parse(fs.readFileSync(p, \"utf8\"))
    pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((r) => r !== \"dsh-llm-newapi\")
    fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + \"\\n\")
    console.log(\"mutated bundles:\", pkg.dsh.profile.bundles.join(\", \"))
  "
  STEPS=none . /usr/local/bin/testbed-entrypoint
  dump_profile
'; echo "exit=$?"
```
Expected: 先打印 `mutated bundles: …`（不含 `dsh-llm-newapi`），随后以 `[fail] 组合树中没有 dsh-llm-newapi 行（patch 层未生效）` 结束、`exit=1` —— 失败落在 `dump_profile` 的 grep 分支，证明 bundles 行正是"组合树出现该插件行"的因。

（`STEPS=none` 让 entrypoint 只定义函数、不执行任何步骤，因此可以在同一个容器里直接调用 `dump_profile`。`set -e` 保证变异未生效时会立刻暴露，而不是悄悄走到断言。）
- [ ] **Step 4: 提交**

```bash
git add testbed/entrypoint.sh
git commit -m "test(testbed): minimal profile 构造、npm pack 与装配断言"
```

---

### Task 5: `preserve` 模式实测（spec 第 10 节的风险收敛）

**Files:**
- Create: `testbed/probes/preserve-seed.mjs`
- Modify: `testbed/entrypoint.sh`（实现 `build_profile` 的 `preserve` 分支）

**Interfaces:**
- Consumes: Task 4 的 `TARBALL` / `register_bundle_rows`
- Produces: `preserve-seed.mjs`（stdout 每行一个宿主 profile 的 bundle 行，已剔除 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 与 `dsh-llm-newapi` 自身）

- [ ] **Step 1: 写 `testbed/probes/preserve-seed.mjs`**

```js
// 读出宿主 web profile 的 bundle 行，供 preserve 模式在容器内重建同一组合。
// 用法：node preserve-seed.mjs <宿主的 profiles/web/package.json>
import { readFileSync } from 'node:fs'

const [, , manifestPath] = process.argv
const SELF = 'dsh-llm-newapi'
const BASE = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
const rows = pkg?.dsh?.profile?.bundles ?? []
for (const row of rows) {
	if (BASE.includes(row) || row === SELF) continue
	console.log(row)
}
```

- [ ] **Step 2: 实现 `preserve` 分支**

把 `testbed/entrypoint.sh` 里 `build_profile` 的 `preserve` 分支替换为：

```bash
		preserve)
			log profile "PROFILE_MODE=preserve：先还原宿主 profile 的 bundle 行"
			local host_manifest=/host-dsh-home/profiles/web/package.json
			[ -f "$host_manifest" ] || die "preserve 需要宿主 profile：$host_manifest 不存在"
			local rows
			rows="$(node /usr/local/bin/../probes/preserve-seed.mjs "$host_manifest" || true)"
			if [ -n "$rows" ]; then
				while IFS= read -r row; do
					[ -n "$row" ] || continue
					log profile "还原第三方行：$row"
					dsh plugin --profile web add "$row" || log profile "警告：还原 $row 失败（依赖网络或上游包）"
				done <<< "$rows"
			fi
			log profile "安装本仓库 tarball（覆盖发行版行）"
			dsh plugin --profile web add "$TARBALL"
			;;
```

同时把 `preserve-seed.mjs` 拷进镜像：在 `testbed/Dockerfile` 的 `COPY entrypoint.sh …` 之后追加

```dockerfile
COPY probes /usr/local/bin/probes
```

并把上面的调用路径改为绝对路径 `/usr/local/bin/probes/preserve-seed.mjs`。

- [ ] **Step 3: 实测 preserve 是否会因 npm/pnpm 布局混用而失败**

Run:
```bash
cd testbed && STEPS=assert,seed,stage,l1,pack,profile \
  PROFILE_MODE=preserve DSH_VERSION=0.1.5-rc.1 docker compose run --rm --build testbed
```
Expected（两种结果都必须被记录下来，二选一）：
- **成功**：出现 `bundles: …` 与 `[profile] 装配断言通过`，退出码 0 → 在 `testbed/README.zh-CN.md`（Task 9）把 `preserve` 记为可用模式。
- **失败**：在 `testbed/README.zh-CN.md` 的"已知限制"里写明失败原文（命令、错误行、宿主 profile 布局），并把失败当作**结论**而非待办——默认仍是 `minimal`。

- [ ] **Step 4: 提交**

```bash
git add testbed/probes/preserve-seed.mjs testbed/entrypoint.sh testbed/Dockerfile
git commit -m "test(testbed): preserve 模式实现与实测（记录 npm/pnpm 混用结论）"
```

---

### Task 6: L2 探针与阴性对照 A（RPC 通道）

**Files:**
- Create: `testbed/probes/boot-probe.sh`
- Modify: `testbed/entrypoint.sh`（新增 `run_l2`）

**Interfaces:**
- Consumes: Task 4 的 profile；`$STATE`（`DSH_HOME`）
- Produces: `run_l2`；`/work/dsh-web.log`；探针退出码语义：0 = 全绿，非零 =失败

- [ ] **Step 1: 写 `testbed/probes/boot-probe.sh`**

```bash
#!/usr/bin/env bash
# L2 探针：真实 dsh web 启动 + 浏览器会话 + 首页 + boot 图 + RPC 通道 + 日志卫生。
# 认证流程与两个仓库 CI 的 boot job 一致：一次性 token 换会话 cookie（0.1.5 起强制）。
set -euo pipefail

PORT="${PORT:-3080}"
LOG="${LOG:-/work/dsh-web.log}"
COOKIE="${COOKIE:-/work/cookies.txt}"
BODY=/work/probe-body.txt
TAG="[testbed][${DSH_VERSION}][${GRID_LABEL}][l2]"

say() { printf '%s %s\n' "$TAG" "$1"; }
die() { printf '%s [fail] %s\n' "$TAG" "$1"; [ -f "$LOG" ] && tail -40 "$LOG"; exit 1; }

rm -f "$COOKIE"
dsh web > "$LOG" 2>&1 &
WEB_PID=$!
trap 'kill "$WEB_PID" 2>/dev/null || true' EXIT

# 1) 等 token → 会话 cookie
code=""
for _ in $(seq 1 90); do
	kill -0 "$WEB_PID" 2>/dev/null || die "dsh web 启动过程中退出"
	token="$(grep -o 'token=[A-Za-z0-9_-]*' "$LOG" 2>/dev/null | head -1 | cut -d= -f2 || true)"
	if [ -n "$token" ]; then
		curl -s -c "$COOKIE" -b "$COOKIE" -o /dev/null "http://127.0.0.1:${PORT}/?token=${token}" || true
		if [ -s "$COOKIE" ]; then
			code="$(curl -s -b "$COOKIE" -o /work/index.html -w '%{http_code}' "http://127.0.0.1:${PORT}/" || true)"
			[ "$code" = "200" ] && break
		fi
	fi
	sleep 1
done
[ "$code" = "200" ] || die "首页未就绪（最后 HTTP ${code:-none}）"
say "认证与会话建立完成，首页 200"

# 2) 浏览器半边进入 boot 图
grep -q 'dsh-llm-newapi/client.js' /work/index.html \
	|| die "boot 图中缺少 dsh-llm-newapi/client.js 引用"
say "boot 图包含客户端 bundle"

# 3) RPC 通道真实应答（unknown-endpoint 探针，避免依赖第三方目录下载）
rpc_code="$(curl -s -b "$COOKIE" -o "$BODY" -w '%{http_code}' -X POST \
	"http://127.0.0.1:${PORT}/llm-newapi/ci-probe" \
	-H 'content-type: application/json' \
	-d '{"type":"client-request","rpcId":"testbed-probe","method":"ci-probe","payload":{}}' || true)"
[ "$rpc_code" = "200" ] || die "RPC 通道 /llm-newapi 非 200（HTTP $rpc_code；405 = SPA 回退，说明通道未注册）"
node -e '
	const fs = require("node:fs")
	const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
	if (body.type !== "server-response" || body.rpcId !== "testbed-probe") throw new Error("响应形状不符：" + JSON.stringify(body))
	if (body.result?.ok !== false || !String(body.result?.error?.message ?? "").includes("unknown endpoint ci-probe")) throw new Error("unknown-endpoint 语义不符：" + JSON.stringify(body))
' "$BODY" || die "RPC 响应校验失败"
say "RPC 通道应答正确（HTTP 200 + unknown-endpoint 语义）"

# 4) 日志卫生：两次真实事故的形态
if grep -qE 'plugin tree failed to load|without inject' "$LOG"; then
	die "日志出现插件加载失败特征"
fi
say "日志卫生通过"
say "L2 全部通过"
```

- [ ] **Step 2: 在 `entrypoint.sh` 里接入 `run_l2`**

在 `dump_profile` 之后插入：

```bash
run_l2() {
	log l2 "启动真实 dsh web 并执行探针"
	bash /usr/local/bin/probes/boot-probe.sh || die "L2 探针失败，日志：/work/dsh-web.log"
}
```

并把 `main` 改为（新增最后一行）：

```bash
	want l2 && run_l2
```

- [ ] **Step 3: 跑通 L2**

Run:
```bash
cd testbed && docker compose run --rm --build testbed; echo "exit=$?"
```
Expected: 依次出现 `[l2] 认证与会话建立完成，首页 200`、`boot 图包含客户端 bundle`、`RPC 通道应答正确`、`日志卫生通过`、`L2 全部通过`、`exit=0`。

- [ ] **Step 4: 阴性对照 A——去掉通道注册必须变红**

Run:
```bash
cd testbed && docker compose run --rm --build --entrypoint bash testbed -lc '
  set -e
  STEPS=assert,seed,stage,l1,pack,profile /usr/local/bin/testbed-entrypoint
  target="$(readlink -f "$DSH_HOME/profiles/web/node_modules/dsh-llm-newapi/lib/index.js")"
  echo "破坏目标：$target"
  # 实际注册调用是别名 `registrar.register(`（src/index.ts:481-488、lib/index.js:1016）：
  # 早期写法的 `connection.register(` 在源码与产物中都不存在，照抄只会得到"对照无效"。
  grep -q "registrar\.register(" "$target" || { echo "阴性对照无效：目标里没有 registrar.register("; exit 2; }
  # 中和副作用，而不是改名成不存在的函数：改名会抛 TypeError 让插件树整体加载失败，
  # 红会落在断言 2（boot 图）而不是 brief 指定的 405 形态（已实测：断言 1/2 保持绿）。
  sed -i "s/registrar\.register(/(() => Promise.resolve())(/g" "$target"
  grep -q "() => Promise.resolve())(" "$target" || { echo "阴性对照无效：替换未生效"; exit 2; }
  STEPS=l2 /usr/local/bin/testbed-entrypoint
'; echo "exit=$?"
```
Expected: 末尾失败行为 `[l2] RPC 通道 /llm-newapi 非 200（HTTP 405；405 = SPA 回退，说明通道未注册）`，整体 `exit=1`——复现历史事故形态，证明该断言不是恒绿。若打印 `阴性对照无效：…` 且 `exit=2`，说明破坏点没选对（源码里实际的注册调用名不同），此时按实际名字调整 `grep`/`sed` 模式后重跑，**不能把"没红"当成通过**。

破坏必须落在**已安装进 profile 的副本**（`$DSH_HOME/profiles/web/node_modules/…`）上，而不是 `/work/plugin`：L2 启动的是 profile 里由 tarball 安装的那份代码，改 `/work/plugin` 不会影响它。`readlink -f` 用来解析 pnpm 的符号链接，避免 `sed -i` 把链接本身替换掉。宿主仓库文件依旧不受影响。

- [ ] **Step 5: 提交**

```bash
git add testbed/probes/boot-probe.sh testbed/entrypoint.sh
git commit -m "test(testbed): L2 启动探针（认证/首页/boot 图/RPC/日志卫生）+ 通道缺失阴性对照"
```

---

### Task 7: 组合格与阴性对照 B（浏览器半边）

**Files:**
- Modify: `testbed/entrypoint.sh`（`COMPANION` 支持）
- Modify: `testbed/probes/boot-probe.sh`（组合断言）
- Create: `testbed/probes/expectations.companion.json`（记录组合期望的插件名与客户端 bundle 名）

**Interfaces:**
- Consumes: Task 6 的探针
- Produces: `COMPANION` 生效路径：`/work/companion` 源码副本 + 装入 profile 的对端 tarball

- [ ] **Step 1: 写 `testbed/probes/expectations.companion.json`**

```json
{
  "self": "dsh-llm-newapi",
  "companion": "dsh-quota-panel",
  "clientBundles": ["dsh-llm-newapi/client.js", "dsh-quota-panel/client.js"],
  "rpcProbes": [
    { "path": "/llm-newapi/ci-probe", "method": "ci-probe" },
    { "path": "/api/dsh-quota-panel/specs", "method": "dsh-quota-panel/specs", "expect": "ok" }
  ]
}
```

- [ ] **Step 2: 在 `entrypoint.sh` 里支持对端**

把 `stage_sources` 的末尾追加：

```bash
	if [ -n "$COMPANION" ]; then
		[ -f /companion-src/package.json ] || die "COMPANION=$COMPANION 但 /companion-src 不是插件源码（检查 COMPANION_HOST_DIR）"
		rm -rf /work/companion
		mkdir -p /work/companion
		# 与 self 相反：对端的 prepack 就是构建（tsc），因此必须保留它的 node_modules；
		# 排除掉会让 npm pack 报 `tsc: not found`（实测 exit 127）。
		tar -C /companion-src \
			--exclude=./.git --exclude='./.tmp-*' \
			-cf - . | tar -C /work/companion -xf -
		[ -x /work/companion/node_modules/.bin/tsc ] || die "对端缺少 node_modules/.bin/tsc：暂存对端时必须保留其 node_modules（对端的 prepack 会构建）"
		log stage "对端源码已暂存：/work/companion（$COMPANION）"
	fi
```

在 `pack_plugin` 之后追加：

```bash
pack_companion() {
	[ -n "$COMPANION" ] || return 0
	cd /work/companion
	log pack "打包对端：$COMPANION"
	npm pack --pack-destination /work/dist >/dev/null
	COMPANION_TARBALL="$(ls -t /work/dist/*.tgz | head -1)"
	[ -n "$COMPANION_TARBALL" ] || die "对端 npm pack 未产出 tarball"
}
```

并在 `build_profile` 的两种模式里，于安装本仓库 tarball **之后**追加：

```bash
	if [ -n "$COMPANION" ]; then
		log profile "安装对端：$COMPANION"
		dsh plugin --profile web add "$COMPANION_TARBALL"
		register_bundle_rows_companion
	fi
```

其中 `register_bundle_rows_companion` 与 `register_bundle_rows` 同构，只把最后的包名参数换成 `"$COMPANION"`；为避免重复代码，把 `register_bundle_rows` 改为接受任意个包名（它已经是 `process.argv.slice(2)`，因此 `register_bundle_rows dsh-llm-newapi` 与 `register_bundle_rows "$COMPANION"` 都可直接调用）——把调用点改成传参形式。

- [ ] **Step 3: 在 `boot-probe.sh` 里追加组合断言**

在"日志卫生"之前插入：

```bash
# 组合格：两个客户端 bundle 必须同时进入 boot 图，两个 RPC 通道都必须应答。
if [ -n "${COMPANION:-}" ]; then
	grep -q "dsh-llm-newapi/client.js" /work/index.html || die "组合格缺少 dsh-llm-newapi 客户端 bundle"
	grep -q "${COMPANION}/client.js" /work/index.html || die "组合格缺少 ${COMPANION} 客户端 bundle"
	say "组合格：两个客户端 bundle 均在 boot 图中"

	c1="$(curl -s -b "$COOKIE" -o /work/c1.json -w '%{http_code}' -X POST \
		"http://127.0.0.1:${PORT}/llm-newapi/ci-probe" -H 'content-type: application/json' \
		-d '{"type":"client-request","rpcId":"combo-self","method":"ci-probe","payload":{}}' || true)"
	[ "$c1" = "200" ] || die "组合格：/llm-newapi 通道非 200（HTTP $c1）"

	c2="$(curl -s -b "$COOKIE" -o /work/c2.json -w '%{http_code}' -X POST \
		"http://127.0.0.1:${PORT}/api/dsh-quota-panel/specs" -H 'content-type: application/json' \
		-d '{"type":"client-request","rpcId":"combo-peer","method":"dsh-quota-panel/specs","payload":{}}' || true)"
	[ "$c2" = "200" ] || die "组合格：/dsh-quota-panel 通道非 200（HTTP $c2）"
	node -e '
		const fs = require("node:fs")
		const self = JSON.parse(fs.readFileSync("/work/c1.json", "utf8"))
		const peer = JSON.parse(fs.readFileSync("/work/c2.json", "utf8"))
		if (self.rpcId !== "combo-self") throw new Error("自身通道返回了别的响应：" + JSON.stringify(self))
		if (peer.rpcId !== "combo-peer") throw new Error("对端通道返回了别的响应：" + JSON.stringify(peer))
	' || die "组合格：通道响应串扰"
	say "组合格：两个 RPC 通道各自应答，无覆盖"
fi
```

- [ ] **Step 4: 跑通组合格**

Run:
```bash
cd testbed && COMPANION=dsh-quota-panel COMPANION_HOST_DIR="$PWD/../../dsh-quota-panel" \
  GRID_LABEL=self+quota docker compose run --rm --build testbed; echo "exit=$?"
```
Expected: 出现 `组合格：两个客户端 bundle 均在 boot 图中`、`组合格：两个 RPC 通道各自应答，无覆盖`，`exit=0`。

- [ ] **Step 5: 阴性对照 B——破坏客户端入口必须变红**

Run:
```bash
cd testbed && docker compose run --rm --build --entrypoint bash testbed -lc '
  set -e
  STEPS=assert,seed,stage,l1,pack,profile /usr/local/bin/testbed-entrypoint
  target="$(readlink -f "$DSH_HOME/profiles/web/node_modules/dsh-llm-newapi/lib/client.js")"
  echo "破坏目标：$target"
  [ -f "$target" ] || { echo "阴性对照无效：profile 里没有 client.js"; exit 2; }
  mv "$target" "$target.disabled"
  STEPS=l2 /usr/local/bin/testbed-entrypoint
'; echo "exit=$?"
```
Expected: `exit=1`，失败行为 `[l2] boot 图中缺少 dsh-llm-newapi/client.js 引用`。与对照 A 同理：破坏的是 **profile 内已安装的副本**（`readlink -f` 解析 pnpm 符号链接），而不是 `/work/plugin`；若打印 `阴性对照无效：…` 与 `exit=2`，说明破坏点没选对。

- [ ] **Step 6: 提交**

```bash
git add testbed/entrypoint.sh testbed/probes/boot-probe.sh testbed/probes/expectations.companion.json
git commit -m "test(testbed): 组合格（COMPANION 叠加）与浏览器半边阴性对照"
```

---

### Task 8: 矩阵脚本（版本解析、遍历、宿主零改动快照、汇总）

**Files:**
- Create: `testbed/matrix.mjs`

**Interfaces:**
- Consumes: 全部前置任务的可运行 compose service
- Produces: `node testbed/matrix.mjs [--versions a,b] [--combos self,self+companion] [--jobs N] [--check-host]`；退出码 0 = 全部格绿 / 1 = 存在失败格

- [ ] **Step 1: 写 `testbed/matrix.mjs`**

```js
// 矩阵编排：解析宿主版本集合（默认 latest + next 去重）与组合，逐格执行单 service，
// 期间对宿主 $DSH_HOME 做白名单快照，结束时打印汇总表。
// 只用 Node 内建模块。
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const outDir = join(here, '.out')
const dockerConfig = join(here, '.docker-config')
mkdirSync(dockerConfig, { recursive: true })
const SELF = 'dsh-llm-newapi'
const DEFAULT_PORT = 13080

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
	const i = argv.indexOf(name)
	return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const combos = argOf('--combos', 'self').split(',').map((s) => s.trim()).filter(Boolean)
const jobs = Number(argOf('--jobs', '1'))
const checkHost = !argv.includes('--no-check-host')

// 版本解析：显式给出则原样使用（并打印来源）；否则解析 dist-tags 的 latest + next 去重。
function resolveVersions() {
	const explicit = argOf('--versions', '')
	if (explicit) return { source: `显式 --versions`, versions: explicit.split(',').map((s) => s.trim()).filter(Boolean) }
	const cacheDir = join(tmpdir(), 'dsh-testbed-npm-cache')
	const r = spawnSync('npm', ['view', '@deepseek-ai/dsh', 'dist-tags', '--json', '--cache', cacheDir], { encoding: 'utf8' })
	if (r.status !== 0) {
		console.error('[matrix] 无法解析 dist-tags，请显式给出 --versions。stderr:\n' + (r.stderr || ''))
		process.exit(1)
	}
	const tags = JSON.parse(r.stdout)
	const versions = [...new Set([tags.latest, tags.next].filter(Boolean))]
	return { source: `dist-tags（latest=${tags.latest}, next=${tags.next}）`, versions }
}

// 宿主白名单快照：只看配置类文件，排除会持续变化的 sessions/storages/browser-*/change-ledger。
const HOST_TARGET = process.env.DSH_HOME_HOST || '/root/.dsh'
function hostSnapshot() {
	const entries = []
	const walk = (rel) => {
		const abs = join(HOST_TARGET, rel)
		if (!existsSync(abs)) return
		const st = statSync(abs)
		if (st.isDirectory()) {
			for (const name of readdirSync(abs).sort()) {
				if (rel === 'profiles' && name === 'node_modules') continue
				walk(join(rel, name))
			}
			return
		}
		entries.push(`${rel}\t${st.size}\t${st.mtimeMs}`)
	}
	for (const rel of ['settings.yaml', '.credentials.yaml', 'pet.json', 'skills', 'profiles']) walk(rel)
	return entries.join('\n')
}

function runGrid(version, combo, port) {
	const env = {
		...process.env,
		DSH_VERSION: version,
		GRID_LABEL: `${version.replace(/[^0-9A-Za-z._-]/g, '_')}-${combo}`,
		HOST_PORT: String(port),
		// 本会话下 /root/.docker 只读：用仓库内可写目录作为 docker CLI 状态目录
		DOCKER_CONFIG: dockerConfig,
	}
	if (combo === 'self+companion') {
		env.COMPANION = 'dsh-quota-panel'
		env.COMPANION_HOST_DIR = join(repoRoot, '..', 'dsh-quota-panel')
	}
	const logPath = join(outDir, `${env.GRID_LABEL}.log`)
	const r = spawnSync('docker', ['compose', 'run', '--rm', '--build', 'testbed'], {
		cwd: here, env, encoding: 'utf8',
	})
	writeFileSync(logPath, (r.stdout || '') + (r.stderr || ''))
	return { grid: env.GRID_LABEL, ok: r.status === 0, logPath }
}

const { source, versions } = resolveVersions()
mkdirSync(outDir, { recursive: true })
console.log(`[matrix] 版本来源：${source}`)
console.log(`[matrix] 版本集合：${versions.join(', ')}`)
console.log(`[matrix] 组合：${combos.join(', ')}`)

const before = checkHost ? hostSnapshot() : ''
const results = []
let port = DEFAULT_PORT
for (const version of versions) {
	for (const combo of combos) {
		console.log(`\n[matrix] === ${version} × ${combo}（端口 ${port}）===`)
		results.push(runGrid(version, combo, port))
		port += jobs > 1 ? 1 : 1
	}
}
const after = checkHost ? hostSnapshot() : ''

console.log('\n[matrix] 汇总')
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.grid}  ${r.ok ? '' : '→ ' + r.logPath}`)

let hostOk = true
if (checkHost && before !== after) {
	hostOk = false
	const beforeSet = new Set(before.split('\n'))
	const changed = after.split('\n').filter((l) => l && !beforeSet.has(l))
	console.error('\n[matrix] 宿主 $DSH_HOME 发生变化（本测试承诺零改动）：')
	for (const line of changed.slice(0, 20)) console.error('  ' + line)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n[matrix] ${results.length - failed.length}/${results.length} 格通过；宿主零改动：${hostOk ? '是' : '否'}`)
process.exit(failed.length === 0 && hostOk ? 0 : 1)
```

- [ ] **Step 2: 跑通两版本 × self**

Run:
```bash
cd testbed && node matrix.mjs
```
Expected: 打印解析到的版本（当前 `0.1.5-rc.1`、`0.1.5-rc.2`）、两行 `PASS`、末行 `2/2 格通过；宿主零改动：是`，退出码 0；`testbed/.out/` 下生成两个日志。

- [ ] **Step 3: 验证矩阵能红（反例）**

Run:
```bash
cd testbed && node matrix.mjs --versions 0.1.5-rc.1,0.1.5-rc.99 ; echo "exit=$?"
```
Expected: `0.1.5-rc.99` 格 `FAIL`（镜像构建阶段 npm 找不到该版本），`1/2 格通过`，`exit=1`。

- [ ] **Step 4: 验证宿主零改动检测真的有效（反例）**

Run:
```bash
cd testbed && cp /tmp/testbed-host-probe /dev/null 2>/dev/null; \
  touch /root/.dsh/settings.yaml 2>/dev/null || echo "（宿主 DSH_HOME 只读，跳过写入式反例）"; \
  node matrix.mjs --versions 0.1.5-rc.2
```
Expected: 若宿主 `$DSH_HOME` 可写，`touch` 使快照变化，末行显示 `宿主零改动：否` 且退出码 1；若当前会话对宿主只读（本机实为只读），`touch` 失败，此步以打印说明结束——此时以 Task 2 Step 5 的 `find -newermt` 结果作为宿主零改动的证据。

- [ ] **Step 5: 提交**

```bash
git add testbed/matrix.mjs
git commit -m "test(testbed): 矩阵脚本（版本解析/遍历/宿主零改动快照/汇总表）"
```

---

### Task 9: 双语文档、`.gitignore` 与端到端验收

**Files:**
- Create: `testbed/README.md`、`testbed/README.zh-CN.md`
- Modify: `.gitignore`（追加 `testbed/.out/`）

**Interfaces:**
- Consumes: Task 1–8 的全部命令与开关
- Produces: 用户可照着执行的文档；完成 spec 第 9 节的验收标准

- [ ] **Step 1: 追加 `.gitignore`**

`testbed/.gitignore`（Task 2 已建立）覆盖 `.out/`、`.env`、`.docker-config/`；本步只确认，不再往仓库根 `.gitignore` 重复添加：

```bash
cat testbed/.gitignore
git check-ignore -v testbed/.out/x testbed/.env testbed/.docker-config/x
```
Expected: 三行输出分别命中 `.out/`、`.env`、`.docker-config/` 三条规则；仓库根 `.gitignore` 保持未修改。

- [ ] **Step 2: 写 `testbed/README.zh-CN.md`**

内容必须覆盖：前置条件（Docker + Compose v2、可访问 registry、宿主 `$DSH_HOME` 路径）、首次构建、四个常用命令、宿主零改动如何验证、故障排查、已知限制。骨架：

````markdown
# testbed：容器化插件测试环境

在不影响宿主 DSH 环境的前提下，跑源码层（L1）与真实宿主启动层（L2）校验；
支持多宿主版本与插件共存组合。

## 前置条件
- Docker Engine + Compose v2
- 能访问 npm registry（或在 `.env` 里设 `NPM_REGISTRY`）
- 宿主 `$DSH_HOME`（默认 `/root/.dsh`）：只读挂载，容器内不会修改

## 首次构建
```sh
cd testbed
cp .env.example .env   # 按需修改 DSH_HOME_HOST / HOST_PORT
docker compose build
```

## 常用命令
```sh
# 1) 单格：默认宿主版本（CI dev pin 0.1.5-rc.2）跑完整 L1 + L2
docker compose run --rm --build testbed

# 2) 指定宿主版本
DSH_VERSION=0.1.5-rc.1 docker compose run --rm --build testbed

# 3) 叠加对端插件（共存验证）
COMPANION=dsh-quota-panel COMPANION_HOST_DIR=../../dsh-quota-panel \
  GRID_LABEL=self+quota docker compose run --rm --build testbed

# 4) 全矩阵（latest + next 去重 × self）
node matrix.mjs
```

## 宿主侧准备

本机下 `/root/.docker` 可能是只读的，docker CLI 需要一个**可写**状态目录：

```sh
export DOCKER_CONFIG="$PWD/.docker-config"   # 在 testbed/ 目录内执行
```

该目录由本仓库提供且已被忽略，**不要**把 `~/.docker/config.json` 复制进来（它可能含凭据）。`matrix.mjs` 会自动设置该变量。

## 基础镜像获取

`Dockerfile` 的 `FROM` 始终是官方的 `node:24-bookworm-slim`。若 daemon 的 registry mirror 不可用、`docker.io` 直连超时，可先预取再按原名打本地标签：

```sh
docker pull docker.m.daocloud.io/library/node:24-bookworm-slim
docker tag  docker.m.daocloud.io/library/node:24-bookworm-slim node:24-bookworm-slim
```

预取时记录 registry 下发的 digest 以便核对；不要把第三方镜像站写进 `FROM`。

## 宿主零改动如何验证
- 每次 `docker compose run` 前会断言 `/host-dsh-home` 与 `/plugin-src` 只读，可写即拒绝运行。
- `matrix.mjs` 运行前后对宿主配置做白名单快照（`settings.yaml`、`.credentials.yaml`、`pet.json`、`skills/`、`profiles/`），变化即判红。
- 手工复核：`find "$DSH_HOME" -maxdepth 1 -newermt '-5 minutes'`。

## 故障排查
| 现象 | 处理 |
| --- | --- |
| `@deepseek-ai/*` 报 EINTEGRITY | 在 `.env` 设 `NPM_REGISTRY=https://registry.npmmirror.com` 后重跑 |
| 端口被占用 | 设 `HOST_PORT=13081`（宿主 3080 是 GUI，永不用） |
| `can only be read by its owner` 类加载失败 | 容器内凭据权限：确认 `chmod 600` 生效（entrypoint 已处理），Windows 挂载下可能无法设权限 |
| 构建产物新鲜度判红 | 在宿主执行 `npm run build` 并提交重建的 `lib/` |
| 首次构建很慢 | 拉取 `node:24-bookworm-slim`；后续构建命中层缓存 |

## 已知限制
- 不做浏览器 E2E（真实 GUI 渲染），也不做真实上游调用。
- 这是本地开发测试环境，**不是安全沙箱**：容器会执行本仓库与对端插件源码，且能读到只读挂载的真实凭据。
- `PROFILE_MODE=preserve` 的实测结论：（在此写明 Task 5 的结果：可用 / 失败原文）
````

- [ ] **Step 3: 写 `testbed/README.md`（英文，内容与中文版等价）**

骨架与中文版逐节对应，标题用英文：`Prerequisites` / `First build` / `Common commands` / `How host-untouched is verified` / `Troubleshooting` / `Known limitations`。

- [ ] **Step 4: 端到端验收（spec 第 9 节的四条硬标准）**

Run:
```bash
cd testbed
node matrix.mjs                                   # ① 两版本 × self 全绿 + 宿主零改动：是
COMPANION=dsh-quota-panel COMPANION_HOST_DIR=../../dsh-quota-panel \
  GRID_LABEL=self+quota docker compose run --rm --build testbed   # ② 组合格绿
git -C .. status --short                          # ③ 只有预期的 testbed/ 与 .gitignore 变更
```
Expected: ① 末行 `2/2 格通过；宿主零改动：是`、退出码 0；② `L2 全部通过`；③ `git status` 只列出 `testbed/` 下的新文件与 `.gitignore` 的修改，没有 `src/`、`lib/`、`package.json` 的改动。

- [ ] **Step 5: 阴性对照复跑（确认还原后仍全绿）**

Run:
```bash
cd testbed && node matrix.mjs --versions 0.1.5-rc.2
```
Expected: `1/1 格通过；宿主零改动：是`——Task 6/7 的破坏实验都发生在容器内副本上，宿主仓库应完全未受影响。

- [ ] **Step 6: 提交**

```bash
git add testbed/README.md testbed/README.zh-CN.md .gitignore
git commit -m "test(testbed): 双语用法文档与 .gitignore（含 preserve 实测结论）"
```

---

### Task 10: 全球 / 中国双网络配置与本地 skill（2026-09 批准补充）

新增 `testbed/compose.china.yaml`、`.env.china.example`、`run.mjs`、网络配置测试与 `.dsh/skills/dsh-plugin-testbed-network/SKILL.md`；参数化 Dockerfile 的 Node/npm/apt/proxy 输入。全球 Compose 与 GitHub Actions 保持官方源；本地 skill 默认 `china`，复现 CI 显式 `global`。matrix 接受 `--network global|china` 并将模式纳入镜像/格标签/新鲜度。测试必须先 RED，覆盖 Compose 解析、全球无中国域、China 参数、stub Docker 入口/退出码；skill 以无指令代理选择不一致为 RED、fresh agents 为 GREEN。quota 侧先实现与审查，通过后向 PR #5 追加同构实现。

---

## Self-Review 记录

- **Spec 覆盖**：spec 第 4 节（目录/挂载/网络/环境变量）→ Task 1；第 5 节六步 → Task 2/3/4/6；第 2 节目标 3/4（版本与组合矩阵）→ Task 6/7/8；第 7 节 L1 与 L2 断言表 → Task 3/4/6/7；第 9 节验收标准 → Task 9 Step 4，其中阴性对照落在 Task 6 Step 4 与 Task 7 Step 5，宿主零改动落在 Task 2 Step 5 与 Task 8 Step 1/2；第 10 节 `preserve` 风险 → Task 5；第 11 节承诺（只读挂载、不占 3080、不动 CI、不跑真实上游）→ Global Constraints 与 Task 1/2。
- **占位符扫描**：无 TBD / TODO；每个代码步骤都给出可直接写入的完整文件或完整函数体；唯一"待实测填写"的位置是 `README` 里的 `preserve` 结论，它由 Task 5 的实测结果填入，属预期的实测产物而非占位。
- **类型/命名一致性**：`STATE`（`/work/dsh-home`）、`TARBALL`、`COMPANION_TARBALL`、`GRID_LABEL`、`STEPS`、`PREFIX` 在全部任务中同名同义；`register_bundle_rows` 在 Task 4 定义、Task 7 改为传参调用；探针路径 `/usr/local/bin/probes/` 在 Task 5 起统一。
- **Self-Review 修正记录（2 处，均已就地修复）**：① Task 5 的 `COPY probes` 必须放在 Task 5（`probes/` 那时才存在），Task 1 的 Dockerfile 不得引用它——已如此安排；② Task 6/7 的阴性对照原本破坏 `/work/plugin/lib/*`，但 L2 启动的是 profile 里由 tarball 安装的副本，破坏不会生效、对照会假绿——已改为 `readlink -f` 解析 pnpm 符号链接后破坏 `$DSH_HOME/profiles/web/node_modules/dsh-llm-newapi/lib/…` 内的真实文件，并加入"替换是否生效"的自检（未生效则 `exit=2` 明确报"对照无效"，而不是当作通过）。
- **与 spec 的两处细化**（有意为之）：使用 `testbed/.empty/` 占位目录替代 spec 中的 `/dev/null`（Docker 不能把字符设备挂到目录）；`GET /` 探针的 `boot` 图检查以服务端返回的首页 HTML 为准（无需启动浏览器即能证明 bundle 被引用）。
