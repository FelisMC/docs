# Felis 文档站

基于 VitePress 默认主题，使用 Felis 黄绿色配色。参考 [Vdrias World Manual](https://github.com/vdriasworld/manual) 的插件选型，接入 Nólëbase 阅读增强与标题定位；使用 Mermaid 渲染主仓库的时序图。导航、搜索、代码复制和主题切换由 VitePress 提供。

## 本地开发

需要 Node.js 22+ 与 Bun 1.3.14。

```sh
bun install --frozen-lockfile
bun run docs:dev
```

```sh
bun run docs:build
bun run docs:preview
```

文档放在 `docs/`，导航与侧栏在 `docs/.vitepress/config.mts`，品牌色与样式在 `docs/.vitepress/theme/style.css`。入口直接显示带侧栏的文档正文，沿用 VitePress 默认主题。

## 中英文内容

仅提供简体中文与英文。中文页面沿用 `docs/` 下的现有路径，英文对应页面放在 `docs/en/`，例如 `docs/guide/deployment.md` 对应 `docs/en/guide/deployment.md`。VitePress 的语言菜单切换到同一篇文章，导航、侧栏、搜索与阅读增强菜单随语言切换。搜索索引按语言划分。

修改技术内容时同时更新两种语言，命令、配置键、错误码和验证标记保持一致。标题末尾的 `{#章节标识}` 在对应页面中使用同一值；翻译标题时保留该标识，避免旧链接和语言切换后的章节定位失效。OpenAPI、许可证和图片由两种语言共用 `docs/public/` 下的原件。

## 发布

使用 Bun 安装依赖和执行 VitePress 构建，产物目录为 `docs/.vitepress/dist`。

### Cloudflare Pages

连接本仓库后，填写以下构建设置：

| 设置 | 值 |
| --- | --- |
| 框架预设 | `VitePress`，随后覆盖下面的命令和输出目录 |
| 根目录 | 留空（仓库根目录） |
| 构建命令 | `bun install --frozen-lockfile && bun run docs:build` |
| 构建输出目录 | `docs/.vitepress/dist` |

生产环境和预览环境都添加以下环境变量：

| 变量 | 值 |
| --- | --- |
| `BUN_VERSION` | `1.3.14` |
| `NODE_VERSION` | `22` |
| `SKIP_DEPENDENCY_INSTALL` | `1` |

构建命令按 `bun.lock` 显式安装依赖，因此关闭 Pages 的自动依赖安装。`pages.dev` 或独立文档域名使用默认的 `/`，无需设置 `DOCS_BASE`。版本变量与跳过自动安装的设置参见 [Cloudflare 构建环境文档](https://developers.cloudflare.com/pages/configuration/build-image/)。

### 部署到子路径

如果使用 `https://felismc.github.io/docs/`，构建时设置 `DOCS_BASE=/docs/`：

```sh
DOCS_BASE=/docs/ bun run docs:build
```

## 内容来源

内容以 [Felis 主仓库](https://github.com/FelisMC/Felis) 为准，本次迁移基于本地提交 `2e4f118939aec47852c181f8043f8ab98c62014c`。两种语言保留原文的命令、限制与验证标记。入门内容分别使用 `README.md`、`README_EN.md`；技术文章的译文与对应原文保持相同结构和章节标识。

| 主仓库来源 | 文档站位置 |
| --- | --- |
| `README.md` | 认识 Felis、安装与部署、管理服务器、备份与恢复、从源码构建、开源协议 |
| `docs/operations.md` | `docs/operations/index.md` |
| `docs/troubleshooting.md` | `docs/operations/troubleshooting.md` |
| `docs/distributed.md` | `docs/guide/distributed.md` |
| `docs/sequence-diagrams.md` | `docs/reference/sequence-diagrams.md` |
| `docs/deferred-seams.md` | `docs/reference/deferred-seams.md` |
| `CONTRIBUTING.md` | `docs/reference/contributing.md` |
| `plugins/README.md` | `docs/reference/plugins.md` |
| `deploy/lobby/README.md`、`deploy/limbo/README.md` | `docs/reference/lobby.md`、`docs/reference/limbo.md` |
| `README.md`、`README_EN.md` | 中英文的 `reference/readme-en.md`（项目说明，保留原有地址） |
| `docs/openapi.yaml` | `docs/public/openapi.yaml`，由 API 定义页面提供下载 |
| `LICENSE` | `docs/public/LICENSE.txt` |

部署架构及入门页面摘取上述原文，并链接到完整手册。更新功能说明时先核对主仓库对应文章，保留其发布通道、实验性状态与验证边界，避免独立改写出另一套口径。每页末尾均链接到主仓库原文。

渲染适配：故障排查里跨行的行内代码已合并一处换行；时序图的文本分号使用 [Mermaid 要求的 `#59;` 转义](https://mermaid.js.org/syntax/sequenceDiagram.html#entity-codes-to-escape-characters)；数字开头的章节锚点按 VitePress 的格式添加 `_`，两种语言通过显式章节标识共享锚点。README 的居中品牌页眉改为普通 Markdown。
