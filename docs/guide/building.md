---
title: 从源码构建
description: 构建 Felis 所需的工具链，以及构建后端、面板、镜像和插件并运行测试的方法。
---

# 从源码构建 {#building}

本页说明从源码构建 Felis 所需的工具链，以及构建后端二进制、Web 面板、容器镜像和发布资产、运行测试的方法。面向开发者。本地开发流程和提交前需要通过的检查见[贡献指南](/reference/contributing)。

## 工具链要求 {#requirements}

| 工具 | 版本 | 用途 |
| --- | --- | --- |
| Go | 1.27.2（`go.mod` 中的 `go` 指令） | 构建 `felis` 二进制，运行 Go 测试 |
| Node.js 与 npm | Node.js 22（与 `Dockerfile` 中的 `node:22` 一致） | 构建和测试面板（`panel/`，依赖由 `panel/package-lock.json` 锁定） |
| JDK | 25 | 构建并测试 Velocity、Paper、Limbo 插件；Paper 需要 Java 25 工具链 |
| JDK | 17 | 构建 Fabric、Forge、NeoForge 模组 |
| Docker | 支持 BuildKit；构建多架构发布资产时需要 buildx 和 QEMU（binfmt） | 构建容器镜像和发布资产 |
| Gradle | 无需单独安装 | 每个插件模块自带固定版本和校验和的 Gradle wrapper |

运行 Felis 需要 Linux 主机；后端单元测试和面板开发可以在 macOS 或 Linux 上进行。

## 后端 {#backend}

在仓库根目录构建 `felis` 二进制：

```bash
go build -o felis ./cmd/felis
./felis help
```

::: info 说明
直接执行 `go build` 时，二进制中内嵌的是面板占位页，打开面板只显示 “Felis panel assets were not built into this binary.”。需要包含面板的完整二进制时，使用下文的容器镜像构建，或参考[面板](#panel)。
:::

**版本号**：`felis version` 显示的版本在链接时写入，`felis update` 用它与上游版本比较。未写入版本号的构建显示 `dev`，并禁用更新报告。构建时用 `-ldflags` 写入版本号：

```bash
go build -trimpath -ldflags "-s -w -X main.version=v0.0.0-dev" -o felis ./cmd/felis
```

安装器写入的版本号格式为：发布版使用标签（如 `v1.2.3`）；`dev` 通道使用 `<最新标签>+g<短提交号>`；指定 `FELIS_REF` 时使用 `v0.0.0+g<短提交号>`。

**交叉编译**：发布构建是静态链接、不依赖 CGO 的 Linux 二进制。在其他平台上为 Linux 构建：

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -o felis-linux-arm64 ./cmd/felis
```

**包含面板的完整二进制**：构建控制面镜像（见[镜像](#images)），再把二进制复制出来。从源码安装时，安装器也以这种方式取得主机上的 `felis`：

```bash
docker build --build-arg FELIS_VERSION=v0.0.0-dev -t felis:custom .
id="$(docker create felis:custom)"
docker cp "$id":/usr/local/bin/felis ./felis
docker rm "$id"
```

## 面板 {#panel}

面板是位于 `panel/` 的 React 与 Vite 应用：

```bash
cd panel
npm ci
npm run build
```

构建产物写入 `panel/dist`。构建控制面镜像时，Dockerfile 先构建面板，再把 `panel/dist` 复制到 `internal/panel/static`，由 Go 嵌入 `felis` 二进制，因此面板与外部接口由同一个进程提供。`internal/panel/static` 中提交的只是占位页，构建产物不应提交到仓库。

面板的开发服务器和模拟 API 见[本地开发](/reference/contributing#development)。

## 镜像 {#images}

| 镜像 | Dockerfile | 内容 |
| --- | --- | --- |
| 控制面 | `Dockerfile` | 面板与 `felis` 二进制，基于 distroless 镜像，二进制位于 `/usr/local/bin/felis` |
| 登录空间 | `deploy/limbo/Dockerfile` | LOOHP/Limbo 与 Felis 登录插件，见[登录空间镜像](/reference/limbo#build) |
| 正式大厅 | `deploy/lobby/Dockerfile` | Paper、Felis 大厅插件与 LuckPerms，见[大厅镜像](/reference/lobby#build) |
| 通用 Paper | `deploy/paper/Dockerfile` | 不含 Felis 插件的 Paper 服务器，作为平台推荐镜像供用户创建服务器 |

构建控制面镜像：

```bash
docker build --build-arg FELIS_VERSION=v0.0.0-dev -t felis:custom .
```

`FELIS_VERSION` 是写入二进制的版本号，省略时为 `dev`。所有基础镜像都按摘要固定。镜像使用非 `latest` 的标签，以便导入 k3s 的 containerd 后按 `IfNotPresent` 策略直接使用。

通用 Paper 镜像使用 `deploy/game-stack.lock` 中的 Paper 构建：

```bash
. <(grep '^PAPER_' deploy/game-stack.lock)
docker build -f deploy/paper/Dockerfile \
  --build-arg PAPER_JAR_URL="$PAPER_JAR_URL" --build-arg PAPER_JAR_SHA256="$PAPER_JAR_SHA256" \
  -t felis-paper:demo .
```

**发布资产**：`deploy/build-release-artifacts.sh` 构建一个发布版安装所需的全部文件，包括各架构的 `felis` 二进制（含面板）、控制面镜像包、游戏镜像包（登录空间、大厅、Paper）、基础镜像包（镜像仓库与 PostgreSQL）、镜像清单、`felis-velocity.jar` 和 `SHA256SUMS`：

```bash
deploy/build-release-artifacts.sh v0.0.0-dev /tmp/felis-assets
```

默认构建 `amd64` 和 `arm64`，可用 `FELIS_RELEASE_ARCHES` 指定架构。该脚本需要支持 buildx 的 Docker，构建非本机架构时还需要 binfmt 与 QEMU；不需要 Go。生成的目录可通过 `FELIS_ARTIFACT_DIR` 安装，见[从预下载资产安装](/guide/deployment#offline-install)。

插件的构建方法见[服务端插件](/reference/plugins#building)。

## 运行测试 {#tests}

**Go**：在仓库根目录执行。

```bash
gofmt -l .
go vet ./...
go test -race ./...
```

单独运行某个包的测试，例如 `go test ./internal/api`。

**PostgreSQL 集成测试**：业务存储层的 SQL 针对真实 PostgreSQL 验证。测试使用一个名称包含 `pgint` 的临时数据库，会删除并重建其 schema，再执行内嵌的迁移：

```bash
FELIS_TEST_PG_URL='postgres://felis:<password>@127.0.0.1:5432/felis_pgint?sslmode=disable' \
  go test -tags pgint ./internal/pgint/ -v
```

数据库备份与恢复的测试还会调用 `pg_dump`、`pg_restore` 和 `psql`，它们的大版本必须与服务器一致。PostgreSQL 运行在容器中时，通过 `FELIS_TEST_PG_EXEC` 在容器内执行这些工具：

```bash
FELIS_TEST_PG_EXEC='docker exec -i <container>' FELIS_TEST_PG_URL='…' \
  go test -tags pgint ./internal/pgint/
```

**Shell 脚本**：

```bash
sh deploy/bootstrap_test.sh
sh deploy/uninstall_test.sh
bash deploy/e2e_release_test.sh
bash deploy/e2e_upstream_test.sh
```

**告警规则**：使用 Prometheus 的 `promtool`：

```bash
promtool check rules deploy/alerts/felis-alerts.yaml
promtool test rules deploy/alerts/felis-alerts_test.yml
```

**面板**：在 `panel/` 目录执行。

```bash
npm test                # 组件与单元测试（Vitest）
npm run typecheck       # TypeScript 类型检查
npm run lint            # ESLint，不允许警告
npm run test:e2e        # 基于模拟 API 的浏览器测试（Playwright，使用本机安装的 Chrome）
```

**插件**：

```bash
bash plugins/test.sh        # JDK 25：Velocity、Paper、Limbo 插件的构建与测试
bash plugins/test-mods.sh   # JDK 17：Fabric、Forge、NeoForge 模组的构建
```

也可以单独运行某一组插件测试：

```bash
plugins/velocity/gradlew -p plugins/velocity routingTest
plugins/paper/gradlew    -p plugins/paper    lobbyTest
plugins/limbo/gradlew    -p plugins/limbo    loginTest \
  -PlimboVersion="$(sed -n 's/^LIMBO_VERSION=//p' deploy/game-stack.lock)"
```

持续集成运行的全部检查见[测试与检查](/reference/contributing#testing)。
