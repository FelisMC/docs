---
title: 贡献指南
description: Felis 的仓库结构、本地开发流程、测试与检查、代码和界面规范、提交要求与品牌图标。
---

# 贡献指南 {#contributing}

本页说明如何参与 Felis 开发：仓库结构、本地开发流程、提交前需要通过的测试与检查、代码与界面文案规范、面板视觉风格、提交要求，以及品牌图标的维护方法。工具链版本和构建命令见[从源码构建](/guide/building)。

## 仓库结构 {#layout}

| 路径 | 内容 |
| --- | --- |
| `cmd/felis/` | `felis` 二进制的入口：全部子命令（如 `api`、`operator`、`migrate`、`reaper`、`setup`、`manifests`、`backup-now`、`db`、`update`）和安装向导 |
| `internal/` | 后端各包，见下表 |
| `api/openapi.yaml` | HTTP API 的 OpenAPI 定义，发布在 [/openapi.yaml](/openapi.yaml) |
| `panel/` | React 与 Vite Web 面板；`panel/dev/` 是本地模拟 API，`panel/e2e/` 是浏览器测试 |
| `plugins/` | Velocity、Limbo、Paper 插件与加载器模组，见[服务端插件](/reference/plugins) |
| `deploy/` | 安装器 `bootstrap.sh`、卸载脚本 `uninstall.sh`、系统服镜像的 Dockerfile（`limbo/`、`lobby/`、`paper/`）、游戏组件版本锁 `game-stack.lock`、告警规则 `alerts/`、CRD 定义 `crd/`、发布资产脚本和端到端测试脚本 |
| `assets/` | 品牌图标，见[品牌图标](#brand-icons) |
| `scripts/` | 开发辅助脚本，例如图标导出脚本 `generate-icons.cjs` |
| `Dockerfile` | 控制面镜像 |
| `bootstrap_asset.go` | 把安装器、CRD 和游戏镜像所需的源码嵌入 `felis` 二进制，供没有源码检出的安装流程使用 |
| `.github/workflows/` | `ci.yml`（拉取请求与 `main` 分支的检查）、`e2e.yml`（在全新主机上端到端安装）、`release.yml`（发布） |

`internal/` 中的主要包：

| 包 | 职责 |
| --- | --- |
| `internal/api` | HTTP 处理器、内外部接口的路由表、认证与访问等级 |
| `internal/operator` | 协调 `MinecraftServer` 资源，创建服务器的工作负载 |
| `internal/apis/felis` | `MinecraftServer` 自定义资源的类型定义 |
| `internal/platform` | 控制面集群对象：工作负载、RBAC、网络策略、高可用布局 |
| `internal/store` | 业务数据库与内嵌迁移 |
| `internal/nodecontrol` | 面板下发的主机任务与节点操作 |
| `internal/build`、`internal/submit` | 镜像构建与投稿 |
| `internal/backup`、`internal/backupjob`、`internal/restore`、`internal/dbbackup`、`internal/offsite` | 世界备份与恢复、数据库备份包、异地副本 |
| `internal/panel` | 内嵌的 Web 面板 |

代码按职责拆分。修改时优先改动实际负责该行为的最小模块，避免增加宽泛的抽象或重写周边代码。

## 本地开发 {#development}

大部分日常开发可以在 macOS 或 Linux 上完成，不需要完整集群。完整的产品依赖 PostgreSQL 和 Kubernetes，但单元测试和前端开发可以在本地运行。需要准备的工具见[工具链要求](/guide/building#requirements)。

### 后端 {#backend-development}

在仓库根目录构建命令行工具：

```bash
go build -o /tmp/felis-dev ./cmd/felis
/tmp/felis-dev help
```

不连接集群即可渲染 Kubernetes 清单：

```bash
/tmp/felis-dev manifests \
  --felis-image registry.felis.svc:5000/felis:dev \
  --velocity-cidr 10.0.0.5/32
```

`felis api`、`felis operator`、`felis migrate up` 和 `felis reaper` 是实际运行的服务命令，需要 PostgreSQL 或 Kubernetes 配置，不适合用于快速的本地迭代。

### 面板 {#panel-development}

在 `panel/` 目录安装依赖：

```bash
cd panel
npm ci
```

连接 `http://localhost:8080` 上运行的真实后端：

```bash
npm run dev
```

使用本地模拟 API：

```bash
npm run dev:mock
```

模拟服务器启动时会输出登录方式和重置命令。没有运行 Go API 和集群时，使用它开发前端。

### 模拟 API {#mock-api}

模拟 API 位于 `panel/dev/`，只由 `npm run dev:mock` 加载。模拟数据包含三个账户：`owner`（所有者，已绑定游戏角色）、`user`（普通用户，未绑定）和 `linked`（普通用户，已绑定）。登录方式均为免密码：

| 登录方式 | 输入 | 登录为 |
| --- | --- | --- |
| 邮箱验证码 | 任意邮箱，验证码 `123456` | `owner` |
| 绑定码 | `LINK1234` | `linked` |
| 通行密钥 | 任意断言 | `owner` |
| 管理员登录 | 任意邮箱，验证码 `123456`，约 9 秒后自动批准；以 `expire` 开头的邮箱在 20 秒后过期 | `owner` |

重置模拟状态：

```bash
curl -X POST http://127.0.0.1:5173/api/v1/__mock/reset
```

模拟代码须遵守以下规则：

- 模拟专用逻辑只放在 `panel/dev/`，`panel/src/` 不得导入模拟代码。
- 响应结构与 `panel/src/lib/types.ts` 和 Go API 处理器保持一致。
- 覆盖真实的错误码，不只模拟成功情况。
- 不把模拟数据呈现为生产环境的实时数据。新增功能时，后端尚无对应接口的，使用明确的占位提示。

### 集成环境 {#integration-environment}

完整的集成与验收环境使用一台干净的 Linux 虚拟机或可丢弃的服务器，普通编码和快速测试仍在本地完成。在该主机上以 `dev` 通道运行安装器，从 `main` 分支的源码构建：

```bash
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo FELIS_VERSION_BOOTSTRAP=dev bash
```

常用的开发变量：

| 变量 | 作用 |
| --- | --- |
| `FELIS_VERSION_BOOTSTRAP=dev` | 构建 `main` 分支（默认为最新的发布版） |
| `FELIS_REPO_URL` | 从指定的 git 地址（例如自己的 fork）构建，仅在通过 `curl` 直接运行安装脚本时有效 |
| `FELIS_REF` | 固定构建的分支、标签或提交，覆盖通道选择并强制从源码构建 |
| `FELIS_GITHUB_TOKEN` | 仅私有 fork 需要：对该 fork 有读权限的 GitHub 令牌 |

`sudo` 会重置环境变量，在 `sudo` 之前 `export` 的变量不会传给安装器。把变量写在 `sudo` 同一行，或使用 `sudo -E`。通道和安装器行为见[安装与部署](/guide/deployment#channels)，全部安装变量见[配置参考](/reference/configuration#installer-variables)。

`sudo felis setup` 只使用主机上已安装的二进制重新配置主机，不能切换通道；需要改用其他通道时，重新运行安装器并设置 `FELIS_VERSION_BOOTSTRAP`。

通道决定写入二进制的版本号，`felis update` 依据它与上游比较。测试更新相关功能时，通过安装器或 Dockerfile 的 `FELIS_VERSION` 构建参数构建；未写入版本号的 `go build` 产物显示 `dev`，并禁用更新报告。见[后端](/guide/building#backend)。

## 测试与检查 {#testing}

拉取请求和 `main` 分支上的持续集成（`.github/workflows/ci.yml`）运行以下检查，发布流程也会先运行同一组检查。提交拉取请求之前，在本地运行与改动相关的检查：

| 检查 | 命令 |
| --- | --- |
| Go 格式 | `gofmt -l .` 不得输出任何文件 |
| Go 静态检查 | `go vet ./...`；staticcheck（版本固定在 `ci.yml` 中） |
| Go 测试 | `go test -race ./...` |
| Go 漏洞检查 | `go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...` |
| PostgreSQL 集成测试 | `go test -race -tags pgint -count=1 ./internal/pgint/`，针对 PostgreSQL 13 和 18 |
| Shell 脚本 | 按各脚本的 shebang 检查语法；shellcheck 0.11.0（`-S warning`）；`deploy/` 中的 Shell 测试 |
| 告警规则 | `promtool check rules` 与 `promtool test rules` |
| 面板 | `npm test`、`npm run typecheck`、`npm run lint`、`npm run test:e2e` |
| API 类型 | `npm run gen:api` 后 `panel/src/lib/openapi.gen.ts` 不得有差异 |
| 插件 | `bash plugins/test.sh`（JDK 25） |
| 加载器模组 | `bash plugins/test-mods.sh`（JDK 17） |

各项测试的运行方法见[运行测试](/guide/building#tests)。另外注意：

- 修改 `api/openapi.yaml` 后执行 `npm run gen:api`，提交重新生成的 `panel/src/lib/openapi.gen.ts`。OpenAPI 定义中的路径、方法、接口面和访问等级必须与服务端路由表一致，否则 Go 测试失败。
- 修改涉及 SQL 的代码（如 `internal/api/pgrepo.go`、`internal/submit`、`internal/build`、`internal/dbbackup`）后，运行 PostgreSQL 集成测试。单元测试使用内存替身，集成测试负责发现替身与真实查询之间的偏差。
- 交付改动前至少运行与改动直接相关的最小检查集。无法运行某项相关检查时，在拉取请求中明确说明。

## 代码规范 {#code-standards}

遵循现有代码的写法，保持改动范围小、便于审查：

- 优先做最小改动，避免重写。
- 只有在消除真实的重复或表达明确的局部概念时，才引入新的抽象。
- 模拟代码不进入业务组件。
- 后端测试放在负责该行为的包中。
- 除非改动明确需要更新约定，否则保持公开 API 和持久化数据的结构不变。
- 不提交构建产物，例如 `panel/dist/`、`node_modules/`、Gradle 构建目录或本地二进制。

欢迎使用 AI 辅助开发，但贡献者须对结果负责。未经本人审阅、完全由 AI 生成的拉取请求不予接受；低质量的 AI 产出、忽视现有设计的大范围重写、未经验证的改动，以及作者无法解释的代码，同样不予接受。

## 界面文案 {#interface-copy}

界面文案须采用书面文档风格，客观、简洁、准确：说明当前状态、原因或影响，以及可执行的操作。只描述已确认的事实，避免口语化表达、拟人化表述和缺乏依据的耗时估计。中文说明使用“执行”“选择”“查看”“配置”等明确动词，操作名称须与界面上的实际标签一致。中英文文案须保持相同的含义和正式程度。

面板的界面文案位于 `panel/src/i18n/resources/zh-CN/` 和 `panel/src/i18n/resources/en-US/` 下按功能划分的 JSON 文件中。修改文案时同时更新两种语言；优先修改现有条目，避免新增重复的消息或组件。

## 面板视觉风格 {#panel-visual-style}

- 复用 `PageHeader`、`Card` 系列组件，以及共享的表单和按钮组件。卡片标题、边框、圆角、间距和保存页脚遵循共享定义，不在单个页面中重新定义这些样式。
- 浅色主题使用白色卡片背景、克制的语义色和 16px 功能图标。
- 保存操作使用 `CardFooter`，交互控件使用 `Button`。
- 表单标签使用共享的 `Label` 样式和 8px 字段间距；单行控件使用共享的 36px 高度。多行字段和确认项复用 `Textarea` 与 `Checkbox`。
- 页面专用的控件样式只用于调整布局、代码字体或语义校验状态。
- 表格、控制台、紧凑统计和状态消息可以保留适合其内容的间距和颜色。
- 保留共享的页面边距和底部间距。

## 提交 {#commits}

- 提交标题采用 `type(scope): 简述` 的单行格式，与仓库历史一致。常用类型有 `feat`、`fix`、`docs`、`refactor`、`test`、`build`、`style`；`scope` 是受影响的模块，例如 `api`、`panel`、`deploy`，可以省略。
- 每个提交只包含一项相关改动。
- 拉取请求说明改动内容和已运行的检查。

## 品牌图标 {#brand-icons}

品牌图标位于仓库的 `assets/icons/`，依据参考图手工描摹。矢量文件只使用路径、形状、渐变和遮罩，不嵌入位图。所有彩色导出都源自 `assets/felis-logo.svg`。

| 文件 | 用途 |
| --- | --- |
| `assets/felis-logo.svg` | 紧凑裁切的透明矢量母版，1040 × 640 |
| `assets/felis-logo.png` | 仓库首页使用的图片，保持 540 × 341 尺寸 |
| `assets/icons/felis-reference.svg` / `.png` | 参考图的 1254 × 1254 白底构图 |
| `assets/icons/felis-icon.svg` | 居中的方形透明图标 |
| `assets/icons/felis-app.svg` / `.png` | 浅绿色圆角应用图标，1024 × 1024 |
| `assets/icons/felis-app-dark.svg` / `.png` | 深绿色圆角应用图标，1024 × 1024 |
| `assets/icons/felis-maskable.svg` / `.png` | 不透明方形背景，猫脸位于中央安全圆内 |
| `assets/icons/felis-monochrome.svg` | 紧凑裁切的黑色单色版本，眼睛和鼻子镂空 |
| `assets/icons/felis-mask.svg` | 用于 Safari 固定标签页的方形单色版本 |
| `assets/icons/png/icon-{size}.png` | 透明图标：16、20、24、32、40、48、64、96、128、180、192、256、512、1024 px |
| `assets/icons/felis.ico` | Windows 多分辨率图标：16、24、32、48、64、128、256 px |
| `assets/icons/felis.icns` / `assets/icons/felis.iconset/` | macOS 图标，以及 16、32、128、256、512 pt 的 1× / 2× PNG |
| `assets/icons/preview.png` | 图标集预览图 |

Web 资源位于 `panel/public/`，由 `panel/index.html` 引用：SVG、ICO、PNG 格式的网站图标，180 px 的 Apple Touch Icon，Safari 固定标签页图标，以及 192 / 512 px 的常规与可遮罩图标。`site.webmanifest` 提供应用名称和图标信息，不提供离线缓存。

面板通过 `panel/src/assets/felis-logo.svg` 引用白色圆角方形图标：桌面侧栏和移动端导航中为 28 px，登录页和设置页页头中为 44 px。该图标沿用图标集中 `felis-app.svg` 的构图，使用白色背景；构建时以带内容哈希的文件名输出，重新导出时也会更新此文件。

网站图标单独向下偏移以对齐视觉中心，SVG、PNG、ICO 和 Safari 固定标签页图标的位置一致；应用图标保持原构图。

修改矢量母版后重新导出图标。导出需要 Node.js 和 `sharp`，macOS 的 ICNS 导出还会使用系统自带的 `iconutil`。在仓库根目录执行：

```sh
NODE_PATH=/path/to/node_modules node scripts/generate-icons.cjs
```

`NODE_PATH` 指向已安装 `sharp` 的 `node_modules` 目录。只重新导出网站图标时，在命令后添加 `--favicons-only`。导出工具不会给面板增加运行时依赖；在 macOS 以外的平台上，它仍会生成 ICNS 以外的格式和 `iconset`。
