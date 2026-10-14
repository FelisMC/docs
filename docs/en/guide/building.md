---
title: Build from source
---

# Build from source {#从源码构建}

Felis is built with Go and Node.js:

```bash
# Backend (Go 1.27+)
go build -o felis ./cmd/felis

# Frontend (Node.js 22+)
cd panel
npm ci
npm run build

# Docker image
docker build -t felis:custom .
```

See [Contributing](/en/reference/contributing) for the development environment, tests and plugin builds.
