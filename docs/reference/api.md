---
title: API 定义
---

# API 定义 {#api-定义}

[下载完整 OpenAPI 3.1 定义](/openapi.yaml)。

这是 Felis Minecraft 编排平台控制平面的 API 定义。同一个二进制提供内部和外部两套接口。内部接口使用按调用方分配的服务令牌，处理 Velocity 与后端回调，不经过零信任访问；外部接口使用 `felis_session` Cookie，面向用户和控制面板，配置了 Cloudflare Access 时由边缘层执行访问控制。管理员级外部操作还需要运维控制台主机上的工作人员会话。各操作的接口侧和权限等级见 `x-felis-face` / `x-felis-tier`。

以下行为适用于所有操作，定义中不再逐项重复：

* 每个响应都包含 `X-Request-Id`（请求传入的值格式合法时沿用）、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer` 和 `Content-Security-Policy: default-src 'none'`。请求经过 TLS 边缘层（`X-Forwarded-Proto: https`）时，还会添加 `Strict-Transport-Security`。
* 不存在的路径返回 `404 not_found`；路径存在但请求方法不匹配时，返回 `405 method_not_allowed`，并附带 `Allow` 响应头。
* 浏览器从其他站点发起的 POST/PUT/PATCH/DELETE 请求，会在认证之前返回 `403 cross_site`。判定依据是 `Sec-Fetch-Site` 为 `same-site` 或 `cross-site`，或 `Origin` 的主机与请求主机不同。不发送这两个头的插件、脚本等调用方不受影响。
* JSON 请求体超过 1 MiB 时返回 `413 too_large`。请求体必须持续到达：30 秒之后，平均传输速度不足 16 KiB/s 时会关闭连接。
* 控制台和构建日志的事件流为每行附加 `id:`（Unix 秒）。EventSource 在一小时内携带 `Last-Event-ID` 重连时，会从该秒继续，而非重新读取末尾历史日志。服务端每分钟重新检查调用方；会话或权限失效时，用 `event: revoked` 结束事件流。事件流也会在 30 分钟后或服务端关闭时断开，客户端随后重连。

## 定义与验证范围 {#定义与验证范围}

`felis-api` 用 OpenAPI 3.1 描述两套接口，对应规范 §7、§14、§28 #7。同一个二进制提供内部、外部两个 `http.Handler`。每个操作通过 `x-felis-face` 区分接口侧（它是数组，因为 `/healthz` 同时属于两侧），通过 `x-felis-tier` 区分零信任等级：`public` / `service` / `app` / `admin`。

使用字段之前，需要区分自动验证和人工维护的范围：

* `{method, path}` 到 `{x-felis-face 集合, x-felis-tier}` 的映射由机器检查。`internal/api/openapi_test.go` 解析定义，与 `internal/api/api.go` 中构造处理器的 `internalAPIRoutes` / `externalAPIRoutes` 路由表执行严格双向一致性校验。新增、删除路由，或修改接口侧、权限等级而未同步定义时，`go test ./...` 会失败。
* 设置锁定会话仍可使用哪些操作（`x-felis-setup-allowed`），也会对照路由表中的 `SetupAllowed` 标记检查。
* 命名响应模型会与处理器实际编码的 Go 结构逐字段比较，见 `internal/api/openapi_parity_test.go`。
* 处理器测试发出的每个请求，在测试包运行后都会与定义核对，见 `internal/api/openapi_contract_test.go`：操作或 `x-felis-common-responses` 必须列出实际返回的状态码；JSON 响应必须满足对应模型，且不能携带模型未声明的属性；返回 2xx 的 JSON 请求必须满足 `requestBody`。测试未覆盖的状态码和请求、响应体仍由人工维护。

部署域（`RootDomain`，规范 §2）不会写入定义。`example.test` 是占位符，遵循禁止硬编码域名的约束。

---

原文：[docs/openapi.yaml](https://github.com/FelisMC/Felis/blob/main/docs/openapi.yaml)。
