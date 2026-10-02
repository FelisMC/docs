# Felis 文档站

Felis 的中英文文档，基于 VitePress，支持全文搜索、阅读设置和 Mermaid 图表。

[简体中文](https://docs.felismc.com/) · [English](https://docs.felismc.com/en/) · [官网](https://felismc.com/)

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

文档放在 `docs/`，导航与侧栏在 `docs/.vitepress/config.mts`，主题样式在 `docs/.vitepress/theme/style.css`。

## 中英文内容

中文页面位于 `docs/`，英文页面位于 `docs/en/`，例如 `docs/guide/deployment.md` 对应 `docs/en/guide/deployment.md`。语言切换保留当前文章和章节，导航、侧栏、搜索与阅读设置随语言切换。搜索索引按语言划分。

直接在本仓库修改文档，并同步更新两种语言，命令、配置键、错误码和验证标记保持一致。标题末尾的 `{#章节标识}` 在对应页面中使用同一值；翻译标题时保留该标识，避免旧链接和语言切换后的章节定位失效。OpenAPI、许可证和图片由两种语言共用 `docs/public/` 下的原件。
