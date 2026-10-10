# 刻意不写 `# syntax=docker/dockerfile:1`：本文件只用标准 Dockerfile 语法，而该行会让
# 每次 --build 都去 registry 解析一次 frontend 镜像（docker-image://docker/dockerfile:1）。
# 在本机（registry mirror 不可用）实测该解析每次固定 60.4s 超时才回落到内建 frontend，
# 是纯浪费。删掉后构建语义完全不变；若将来真的需要 BuildKit 新语法，再按需加回这一行。
# testbed 镜像：node 24（与 CI 一致）+ pnpm（dsh plugin 转发 pnpm）+ 指定版本的 dsh。
# NPM_REGISTRY 可覆盖：若 @deepseek-ai/* 命中 registry 的 stale-packument（EINTEGRITY），
# 按 CI 的经验改用镜像源，例如 https://registry.npmmirror.com。
FROM node:24-bookworm-slim

ARG DSH_VERSION=0.2.0-rc.2
ARG NPM_REGISTRY=https://registry.npmjs.org

ENV DSH_VERSION=${DSH_VERSION} \
    DSH_HOME=/work/dsh-home \
    DEBIAN_FRONTEND=noninteractive

# curl 供探针使用；ca-certificates 供 HTTPS；git 供 pnpm 解析 git 依赖。
# 某些受限出口（本机实测）容器内连不上 deb.debian.org，而 apt-get update 对
# "部分索引失败"仍返回 0，因此以 install 的实际失败触发回退：先按默认源安装，
# 失败则换 aliyun 镜像重试。默认源可用的环境走与原逻辑一致的路径。
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 || (sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' \
       /etc/apt/sources.list.d/debian.sources \
     && apt-get update \
     && apt-get install -y --no-install-recommends ca-certificates curl git) \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g --no-audit --no-fund --registry="${NPM_REGISTRY}" \
      pnpm "@deepseek-ai/dsh@${DSH_VERSION}" \
 && dsh --version \
 && pnpm --version

WORKDIR /work
COPY entrypoint.sh /usr/local/bin/testbed-entrypoint
RUN chmod +x /usr/local/bin/testbed-entrypoint

# 探针脚本：preserve 模式据此还原宿主 profile 的 bundle 行（见 entrypoint.sh）。
COPY probes /usr/local/bin/probes

# 构建配方指纹：把 (Dockerfile + entrypoint.sh) 的 sha256 写进镜像内文件 /etc/testbed-build-stamp，
# 由 entrypoint 的 --source-hash 以 `TESTBED_BUILD_STAMP=<值>` 打印出来，供 matrix.mjs 比对。
# 为什么需要：probes/ 与 entrypoint.sh 都进了镜像、可逐文件哈希，而 Dockerfile 本身进不了镜像；
# 只改 Dockerfile（例如换 node 基础镜像）时，守卫本来看不出"镜像没重建"。
# 算法必须与 matrix.mjs 的 buildStamp() 一致：按**固定顺序**（Dockerfile → entrypoint.sh）依次喂入
# "<名字>\0<内容>\0" 后整体 sha256；名字用 basename，顺序不做排序。
# 注意：RUN 的工作目录不是构建上下文，必须先把这两个源文件 COPY 进镜像再算，否则
# `cat Dockerfile` 会以 "No such file or directory" **静默**喂入空内容，让指纹恒等于空哈希
# （327f5b06…），与宿主永不相等 —— 表现为每格都判"陈旧"且 --no-cache 重建也不收敛。
COPY Dockerfile entrypoint.sh /tmp/testbed-stamp-src/
RUN cd /tmp/testbed-stamp-src \
 && stamp="$( { printf 'Dockerfile\0'; cat Dockerfile; printf '\0'; \
                  printf 'entrypoint.sh\0'; cat entrypoint.sh; printf '\0'; } \
                | sha256sum | cut -d' ' -f1 )"; \
    test -n "$stamp" && \
    printf 'TESTBED_BUILD_STAMP=%s\n' "$stamp" > /etc/testbed-build-stamp \
 && rm -rf /tmp/testbed-stamp-src \
 && cat /etc/testbed-build-stamp

ENTRYPOINT ["/usr/local/bin/testbed-entrypoint"]
