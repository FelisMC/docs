---
title: 从源码构建
---

# 从源码构建 {#从源码构建}

本项目基于 Go 与 Node.js 开发：

```bash
# 后端（Go 1.26+）
go build -o felis ./cmd/felis

# 前端（Node.js 22+）
cd panel
npm ci
npm run build

# Docker 镜像
docker build -t felis:custom .
```

开发环境、测试和插件构建步骤见[贡献指南](/reference/contributing)。

---

原文：[README.md](https://github.com/FelisMC/Felis/blob/main/README.md)、[CONTRIBUTING.md](https://github.com/FelisMC/Felis/blob/main/CONTRIBUTING.md)。
