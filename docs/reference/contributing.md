---
title: 贡献指南
---

# 贡献指南 {#felis-contributor-guide}

本文说明如何运行、测试和理解项目。修改应尽量小，并与当前代码保持一致。

## 项目结构 {#project-shape}

Felis 是基于 Kubernetes 的 Minecraft 服务器控制平面。仓库分为四个主要部分：

- `cmd/felis/`：单一 Go CLI 二进制，分发 `api`、`operator`、`migrate`、`reaper`、`restore`、`manifests`、`breakGlass` 等子命令。
- `internal/`：API 处理器、存储迁移、Kubernetes 清单渲染、operator 协调、构建、备份、恢复及相关业务逻辑。
- `panel/`：React/Vite Web 控制面板。
- `plugins/`：Velocity、Paper、Fabric、Forge、NeoForge 的 Minecraft 侧插件和模组。

代码按职责拆分。优先修改实际负责该行为的最小模块，避免增加宽泛抽象或重写周边代码。

## 界面文案 {#interface-copy}

界面文案须采用书面文档风格，客观、简洁、准确：说明当前状态、原因或影响，以及可执行的操作。只描述已确认的事实，避免口语化表达、拟人化表述和缺乏依据的耗时估计。中文说明应使用“执行”“选择”“查看”“配置”等明确动词，操作名称须与界面实际标签一致。中英文文案须保持相同的含义和正式程度。应更新现有翻译条目，避免新增重复的消息或组件。

## 面板视觉风格 {#panel-visual-style}

复用 `PageHeader`、`Card` 系列组件，以及共享的表单和按钮组件。卡片标题、边框、圆角、间距和保存页脚遵循共享定义，避免在单个页面中重新定义这些样式。浅色主题使用白色卡片背景、克制的语义色和 16px 功能图标。保存操作使用 `CardFooter`，交互控件使用 `Button`。表单标签使用共享的 `Label` 样式和 8px 字段间距；单行控件使用共享的 36px 高度。多行字段和确认项复用 `Textarea` 与 `Checkbox`。页面专用的控件类只用于调整布局、代码字体或语义校验状态。表格、控制台、紧凑统计和状态消息可保留适合其内容的间距和颜色。保留共享的页面边距和底部间距。

## 本地开发 {#local-development}

大部分日常开发可在 macOS 或 Linux 上完成，不需要完整集群。完整产品依赖 Postgres 和 Kubernetes，单元测试与前端开发可以本地运行。

建议准备：

- 与 `go.mod` 一致的 Go 版本。
- `panel/` 所需的 Node.js 和 npm。
- 插件开发所需的 JDK/Gradle（可选）。
- 安装 Docker、k3s 和 Postgres 的干净 Linux 虚拟机或服务器，供集成测试使用（可选）。

检查工具版本：

```bash
go version
node --version
npm --version
java -version
```

## 后端命令 {#backend-commands}

在仓库根目录运行：

```bash
cd /path/to/Felis
```

运行全部 Go 测试：

```bash
go test ./...
```

运行指定包的测试：

```bash
go test ./internal/api
go test ./cmd/felis
```

隔离测试使用内存替身。业务存储 SQL 则单独针对真实 Postgres 验证，必须使用名称包含 `pgint` 的临时数据库。测试工具会删除并重建 schema，再重放内嵌迁移：

```bash
FELIS_TEST_PG_URL='postgres://felis:***@127.0.0.1:5432/felis_pgint?sslmode=disable' \
  go test -tags pgint ./internal/pgint/ -v
```

修改 `internal/api/pgrepo.go`、`internal/submit`、`internal/build`、`internal/dbbackup` 中涉及 SQL 的代码后，应运行此测试。替身描述接口约定，这套测试负责发现替身与真实查询之间的偏差。`felis db backup` 和 `restore` 测试还需要与服务器大版本一致的 `pg_dump`、`pg_restore`、`psql`。服务器在容器中时，可像生产的 felis-postgres 一样在容器内执行：

```bash
FELIS_TEST_PG_EXEC='docker exec -i <container>' FELIS_TEST_PG_URL=... go test -tags pgint ./internal/pgint/
```

构建 CLI：

```bash
go build -o /tmp/felis-dev ./cmd/felis
/tmp/felis-dev help
```

在不连接集群的情况下渲染 Kubernetes 清单：

```bash
/tmp/felis-dev manifests \
  --felis-image registry.felis.svc:5000/felis:dev \
  --velocity-cidr 10.0.0.5/32
```

`felis api`、`felis operator`、`felis migrate up`、`felis reaper` 是实际运行命令，需要 Postgres 和／或 Kubernetes 配置，不适合作为快速本地迭代的起点。

## 前端命令 {#frontend-commands}

进入前端工作目录：

```bash
cd /path/to/Felis/panel
```

安装依赖：

```bash
npm ci
```

连接 `http://localhost:8080` 上的真实后端：

```bash
npm run dev
```

使用本地模拟 API：

```bash
npm run dev:mock
```

模拟开发服务器启动时会输出账号、绑定码和重置命令。没有运行 Go API 和集群时，可用它开发前端。

常用前端检查：

```bash
npm run typecheck
npm test
npm run build
```

## 模拟 API {#mock-api}

前端模拟 API 位于 `panel/dev/`，仅由 `npm run dev:mock` 加载。模拟逻辑不得进入生产代码或业务组件。

在前端目录运行：

```bash
cd /path/to/Felis/panel
npm run dev:mock
```

当前模拟账号：

| 用户名 | 密码 | 场景 |
| --- | --- | --- |
| `owner` | `devpassword` | 已绑定的管理员 |
| `user` | `devpassword` | 未绑定的普通用户 |
| `linked` | `devpassword` | 已绑定的普通用户 |
| `setup` | `devpassword` | 首次登录需要修改密码的管理员 |

模拟 Minecraft 绑定码：

```text
LINK1234
```

重置模拟状态：

```bash
curl -X POST http://127.0.0.1:5173/api/v1/__mock/reset
```

模拟规则：

- 模拟专用逻辑保留在 `panel/dev/`。
- `panel/src/` 不得导入模拟代码。
- 响应结构与 `panel/src/lib/types.ts` 和 Go API 处理器保持一致。
- 使用真实错误码，不能只覆盖成功情况。
- 不得将模拟数据呈现为生产实时数据。

## 完整集成环境 {#full-integration-environment}

在 Linux 主机的仓库根目录运行集成和部署命令：

```bash
cd /path/to/Felis
```

设置 TUI 面向干净的 Linux 主机，不适合普通 macOS 开发机：

```bash
sudo felis setup
```

常用覆盖配置：

```bash
export FELIS_REPO_URL=<your fork url>
export FELIS_REF=<your branch>          # pins the build; overrides the channel below
export FELIS_IMAGE=felis:dev
export FELIS_ROOT_DOMAIN=<node-ip>.nip.io
```

安装器默认使用最新的**已发布 GitHub release**。开发分支需要显式选择；私有 fork 还需要用于查询发布版和克隆的令牌：

```bash
export FELIS_VERSION_BOOTSTRAP=dev      # build main instead of the newest release
export FELIS_GITHUB_TOKEN=<token>       # private forks only: read access to the fork
```

首次 `vX.Y.Z` 标签发布前，也需使用 `dev`；没有发布版时默认通道无法解析，安装器会停止并提示此选项。

发布版默认下载该标签由 CI 生成的二进制、镜像和 Velocity 插件，校验 `SHA256SUMS` 后导入；面板内嵌于同一二进制（`internal/panel`）。`dev` 克隆并编译源码。发布版附件缺失或校验失败时，仅对应组件回退到**同一标签**的本机构建，并输出警告；不会悄悄切换提交。设置 `FELIS_REF` 会强制源码路径。具体安装行为以[安装与部署](/guide/deployment)和[二进制与镜像来源](/operations/#where-the-binary-and-the-images-come-from)为准。

通道决定二进制里的版本戳（`felis version`），供 `felis update` 与上游比较：发布版使用标签，开发版使用 `<latest-tag>+g<short-sha>`；固定 `FELIS_REF` 跳过通道及标签查询，使用 `v0.0.0+g<short-sha>`。未设置版本戳的构建显示 `dev`，禁用更新报告；测试该路径时，应通过 `bootstrap.sh` 或 Dockerfile 的 `FELIS_VERSION` 构建参数设置版本，不要仅执行普通 `go build`。

设置流程包装主机初始化，随后在同一命令中完成所有者账号及可选 Cloudflare 边缘设置。调试安装器时，仍可直接运行 `deploy/bootstrap.sh` 做底层主机配置。

请使用虚拟机或可丢弃的 Linux 服务器作为集成、验收环境，普通编码和快速测试仍在本地完成。

## 插件开发 {#plugin-development}

插件说明见[服务端插件](/reference/plugins)，各模块保持独立 Gradle 构建：

```bash
# cwd: repository root
cd /path/to/Felis

bash plugins/velocity/gradlew -p plugins/velocity build
bash plugins/paper/gradlew -p plugins/paper build
bash plugins/fabric/gradlew -p plugins/fabric build
bash plugins/forge/gradlew -p plugins/forge build
bash plugins/neoforge/gradlew -p plugins/neoforge build
```

- 所有模块都使用各自的 Gradle wrapper，版本和校验和由模块固定。
- Java 和 Minecraft 版本要求以[插件版本表](/reference/plugins#minecraft-versions)为准；不要把各模块的工具链要求混为一谈。
- 首次构建会下载和重映射 Minecraft 依赖，可能较慢。

## 前端状态 {#frontend-status}

面板仍处于早期开发阶段。目前已提供服务器列表与状态、启停和认领、控制台/RCON、文件管理、账号绑定、白名单/封禁/OP/LuckPerms、计划任务及备份恢复等功能。当前功能范围以[项目说明](/reference/readme-en#features)与具体后端接口为准；模拟 API 仅用于本地前端开发。

新增功能时如实反映后端状态。没有实际端点时使用明确的占位提示，不能用假数据冒充实时数据；更完整的交互深度及组件、浏览器测试仍需持续完善。

## 国际化说明 {#i18n-notes}

这里讨论的是 **Felis 控制面板**的国际化，文档站的中英文切换是独立功能。面板尚未建立完整 i18n 系统，用户可见字符串多数仍内联于 TSX 或辅助函数。

优先覆盖：

- 根据稳定 API 错误码映射的错误消息。
- 导航标签、页面标题与主要操作。
- 阶段、状态标签。
- 空白、加载、错误状态。

建议从以下结构开始：

```text
panel/src/i18n/
  index.ts
  en.ts
  zh-CN.ts
```

先使用小型类型化词典。需要运行时切换语言、复数规则、外部翻译流程或更复杂本地化时，再引入 `i18next/react-i18next` 等库。

除非贡献者确有需要，否则不翻译代码注释、内部日志或模拟环境专用终端消息。

## 贡献规范 {#contribution-style}

沿用现有代码，修改范围小且便于审阅。

- 优先最小修改，避免重写。
- 新抽象应消除实际重复，或表达清晰的局部概念。
- 前端模拟代码不得进入业务组件。
- 后端测试靠近负责该行为的包。
- 保持公共 API 和持久化结构，除非修改明确要求更新约定。
- 不提交 `panel/dist/`、`node_modules/`、Gradle 构建目录或本地二进制等生成产物。

欢迎使用 AI 辅助，但贡献者负责最终结果。不能提交全部由 AI 生成、本人未审阅的 PR。低质量内容、大范围无视现有设计的重写、未验证修改，或作者无法解释的代码，不会被接受。

交付前执行最小且有意义的检查：

```bash
go test ./...
cd panel && npm run typecheck && npm test && npm run build
```

无法运行相关检查时，交付说明中须明确说明。

## 品牌图标 {#brand-icons}

品牌图标位于仓库的 `assets/icons/`，基于参考图片手工临摹。矢量文件仅使用路径、形状、渐变和蒙版，没有嵌入位图。所有彩色导出均来自 `assets/felis-logo.svg`。

| 文件 | 用途 |
| --- | --- |
| `assets/felis-logo.svg` | 1040 × 640 紧裁透明矢量原稿 |
| `assets/felis-logo.png` | README 用图，保留现有 540 × 341 尺寸 |
| `assets/icons/felis-reference.svg` / `.png` | 保留参考图的 1254 × 1254 白底构图 |
| `assets/icons/felis-icon.svg` | 居中的方形透明图标 |
| `assets/icons/felis-app.svg` / `.png` | 浅绿圆角应用图标，1024 × 1024 |
| `assets/icons/felis-app-dark.svg` / `.png` | 深绿圆角应用图标，1024 × 1024 |
| `assets/icons/felis-maskable.svg` / `.png` | 不透明方形背景，猫脸位于中心安全圆内 |
| `assets/icons/felis-monochrome.svg` | 紧裁黑色单色版，眼睛和鼻子镂空 |
| `assets/icons/felis-mask.svg` | 方形单色版，供 Safari 固定标签使用 |
| `assets/icons/png/icon-{size}.png` | 透明图标：16、20、24、32、40、48、64、96、128、180、192、256、512、1024 px |
| `assets/icons/felis.ico` | Windows 多分辨率图标：16、24、32、48、64、128、256 px |
| `assets/icons/felis.icns` / `assets/icons/felis.iconset/` | macOS 图标及 16、32、128、256、512 pt 的 1× / 2× PNG |
| `assets/icons/preview.png` | 图标套装预览 |

网页资源位于 `panel/public/`，由 `panel/index.html` 引用：SVG / ICO / PNG favicon、180 px Apple Touch Icon、Safari 固定标签图标，以及 192 / 512 px 普通和 maskable 图标。`site.webmanifest` 提供应用名称和图标元数据，不提供离线缓存。

面板通过 `panel/src/assets/felis-logo.svg` 引用白底圆角方形图标：桌面侧栏和手机导航使用 28 px，登录与初始化页头使用 44 px。该图标沿用套装中 `felis-app.svg` 的构图，底色改为白色。构建时生成带内容哈希的文件名，重新导出时会同步更新此文件。

标签页图标单独向下偏移，以对齐视觉中心；SVG、PNG、ICO 和 Safari 固定标签使用相同位置，应用图标保持原有构图。仅需重新导出标签页资源时，可在下方命令后加上 `--favicons-only`。

修改矢量原稿后可重新导出。导出需要 Node.js 和 `sharp`，macOS 的 ICNS 导出还使用系统自带的 `iconutil`。在仓库根目录运行：

```sh
NODE_PATH=/path/to/node_modules node scripts/generate-icons.cjs
```

`NODE_PATH` 指向已安装 `sharp` 的 `node_modules` 目录。导出工具不会增加面板的运行依赖；非 macOS 平台仍会生成其余格式和 `iconset`。
