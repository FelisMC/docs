---
title: API 参考
description: Felis HTTP API 的接口面、认证方式、访问等级、通用行为与主要接口分组。
---

# API 参考 {#api}

本页说明 Felis HTTP API 的整体结构：两个接口面、认证方式、访问等级、所有操作共有的行为，以及主要接口分组。面向编写脚本、开发集成或参与 Felis 开发的读者。每个操作的参数、请求体与响应结构以 OpenAPI 文档为准。

## 概览 {#overview}

felis-api 由 `felis` 二进制提供，同时运行两个接口面：

| 接口面 | 调用方 | 访问位置 | 认证方式 |
| --- | --- | --- | --- |
| 内部接口 | 游戏代理、登录空间、镜像构建任务、文件与导出任务、主机上的部分 `felis` 命令 | 集群内 ClusterIP Service `felis-api-internal`，端口 `8081`，明文 HTTP | 按调用方分配的服务令牌；任务传输使用一次性令牌 |
| 外部接口 | Web 面板及使用会话的客户端 | 面板域名：玩家控制台 `console.<root_domain>` 与管理控制台 `op.console.<root_domain>` | `felis_session` 会话 Cookie 或 API 密钥 |

外部接口通过 NodePort Service `felis-api`（端口 `443`）提供，前面是安装时选择的访问方式，面板页面与 API 同域。内部接口不经过零信任认证，也不发布到节点的外部地址。游戏服务器的网络策略禁止访问它，只有登录空间例外；镜像构建任务通过自己的出站策略访问它；游戏代理在主机上通过 ClusterIP 连接。访问方式见[访问与域名](/operations/access#access-methods)。

完整的 OpenAPI 3.1 文档发布在 [/openapi.yaml](/openapi.yaml)，同时描述两个接口面。文档使用以下扩展字段：

| 字段 | 位置 | 含义 |
| --- | --- | --- |
| `x-felis-face` | 每个操作 | 所属接口面：`internal`、`external`，或两者（如 `/healthz`） |
| `x-felis-tier` | 每个操作 | 访问等级，见[访问等级](#access-tiers) |
| `x-felis-callers` | 内部接口操作 | 允许调用该操作的服务令牌调用方 |
| `x-felis-setup-allowed` | 外部接口操作 | 仍处于首次设置阶段的账户可以调用的操作，见[首次设置锁定](#setup-lockdown) |
| `x-felis-common-responses` | 文档顶层 | 在给定条件下任何操作都可能返回的响应，不在各操作下重复列出 |

文档中的服务器地址使用占位域名 `example.test`。实际部署中，外部接口位于面板域名下，内部接口只能在集群内访问。

## 认证 {#authentication}

### 服务令牌 {#service-tokens}

内部接口使用 `Authorization: Bearer <service-token>` 认证。每个调用方持有独立令牌，每个操作只接受 `x-felis-callers` 中列出的调用方：

| 调用方 | Secret（`felis` 命名空间） | 使用者 | 可访问的接口 |
| --- | --- | --- | --- |
| `velocity` | `felis-service-token` | 游戏代理插件 | 服务器列表、唤醒、认领、状态、进服事件、大厅菜单、管理员登录批准、账号绑定、黑名单、玩家进入策略 |
| `limbo` | `felis-limbo-token`，副本位于 `minecraft` 命名空间 | 登录空间 | 生成绑定码、查询绑定状态、黑名单、玩家进入策略 |
| `build` | `felis-build-token`，副本位于 `felis-build` 命名空间 | 镜像构建任务 | 读取投稿的构建上下文 |
| `ops` | `felis-ops-token` | 主机上的 `felis backup-now` 与 `felis restore-host` | 停服世界备份、整机重建时恢复世界 |

缺少令牌或令牌无效时返回 `401`；令牌有效但调用方不在该操作的列表中时返回 `403 wrong_caller`。审计日志以 `internal:<caller>` 记录内部调用的来源。执行 `sudo felis rotate-token -yes <caller>` 替换令牌，见[命令行参考](/reference/cli#rotate-token)。

### 会话 {#sessions}

外部接口接受会话 Cookie `felis_session` 或 API 密钥，后者见 [API 密钥](#api-keys)。Cookie 带有 `HttpOnly`、`Secure`、`SameSite=Lax` 属性，并且只对签发它的主机有效，因此管理控制台的会话不会发送到玩家控制台。服务端只保存 Cookie 的 SHA-256 摘要。

会话由以下免密码登录方式签发：

- 通行密钥（passkey）登录；
- 邮箱验证码登录；
- 游戏内绑定码登录；
- 管理员登录（在管理控制台发起，由已在游戏内的管理员批准）；
- 首次设置链接中的设置令牌（用于初始化第一个所有者）。

安装位于 Cloudflare Access 之后时，Access 在边缘执行，felis-api 不读取 Access 令牌。登录相关接口按来源地址限流，超出限制时返回 `429 rate_limited` 并附带 `Retry-After` 响应头。

### API 密钥 {#api-keys}

API 密钥让脚本以创建者本人的身份调用外部接口。请求头的格式为 `Authorization: Bearer felis_pat_…`：

```bash
curl -H "Authorization: Bearer $FELIS_API_KEY" https://console.example.com/api/v1/me/servers
```

- **开启条件**：所有者在平台设置中开启后才可创建与使用密钥，默认关闭，见[API 密钥](/guide/administration#api-keys)。关闭后所有已有密钥立即失效，重新开启后未过期也未撤销的密钥恢复可用。
- **身份**：密钥代表创建它的账户。同一请求同时带有会话 Cookie 与 API 密钥时返回 `401`。
- **会话限定的操作**：密钥不能用来管理密钥，使用 API 密钥管理 `/api/v1/account/api-tokens` 时返回 `403 session_required`。使用 API 密钥的请求也不能通过[身份复核](#reauthentication)，要求身份复核的操作同样返回 `403 session_required`。
- **有效期与数量**：普通密钥可不设有效期，设置时最长 365 天。每个账户最多 10 个密钥。
- **管理密钥**：管理员与所有者创建密钥时可设置 `admin: true`。管理密钥只在管理控制台域名下具有管理权限，必须设置不超过 90 天的有效期，创建时须完成身份复核。
- **存储与审计**：创建响应返回一次明文密钥，服务端只保存其 SHA-256 摘要。审计日志以 `api_key:<前缀>` 记录来源，前缀是密钥开头的 18 个字符。
- **跨站检查**：使用 API 密钥的请求不受[跨站写入](#common-behaviour)检查限制。

### 访问等级 {#access-tiers}

每个操作的 `x-felis-tier` 取以下值之一：

| 等级 | 接口面 | 要求 |
| --- | --- | --- |
| `public` | 内部、外部 | 无需认证。包括健康检查、指标、登录入口和退出登录 |
| `service` | 内部 | 有效的服务令牌，且调用方列在 `x-felis-callers` 中 |
| `app` | 外部 | 任意已登录账户。针对服务器的操作还检查归属 |
| `admin` | 外部 | 管理员或所有者的会话，且请求经管理控制台域名到达 |
| `owner` | 外部 | 所有者的会话，且请求经管理控制台域名到达 |

管理控制台只对工作人员开放：普通用户的会话从管理控制台域名发出的任何请求都返回 `403 forbidden`。管理员或所有者经玩家控制台域名登录时，只具有 `app` 等级的权限。角色说明见[平台管理](/guide/administration#roles)。

### 身份复核 {#reauthentication}

增加、删除或更改账户登录方式的操作，以及会改变主机或读取敏感数据的主机运维操作（见[主机运维接口](#host-operations)），要求会话在最近 5 分钟内证明过一个登录因素，否则返回 `403 reauth_required`。`GET /api/v1/account/reauth` 列出当前账户可用的复核方式。

- 以通行密钥、邮箱验证码、管理员登录或设置令牌登录时，会话即视为已复核；以绑定码登录不计入。
- 普通用户可使用通行密钥或邮箱验证码复核。
- 管理员和所有者使用通行密钥复核，或重新登录；单独的邮箱验证码对工作人员不构成复核因素。
- 使用 API 密钥的请求不能通过身份复核，返回 `403 session_required`。

### 首次设置锁定 {#setup-lockdown}

仍处于首次设置阶段的账户（例如尚未验证邮箱的新所有者）只能调用标记为 `x-felis-setup-allowed` 的操作，其余操作返回 `403 setup_required`。完成设置向导后限制解除，见[安装与部署](/guide/deployment#setup-wizard)。

## 通用行为 {#common-behaviour}

以下行为适用于所有操作，OpenAPI 文档不在各操作下重复说明：

- **响应头**：每个响应都包含 `X-Request-Id`（请求传入的值格式合法时沿用）、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer` 和 `Content-Security-Policy: default-src 'none'`。请求经过 TLS 边缘（`X-Forwarded-Proto: https`）时，还会添加 `Strict-Transport-Security`。
- **错误格式**：错误响应统一为 `{"error": {"code": "...", "message": "...", "request_id": "..."}}`。`code` 是稳定的机器可读代码；`request_id` 与 `X-Request-Id` 一致，可用于在服务端日志中查找对应记录。`500` 错误的详细信息只写入服务端日志。
- **路由**：不存在的路径返回 `404 not_found`；路径存在但方法不匹配时返回 `405 method_not_allowed`，并附带 `Allow` 响应头。
- **跨站写入**：浏览器从其他站点发起的 POST、PUT、PATCH、DELETE 请求在认证之前返回 `403 cross_site`。判定依据是 `Sec-Fetch-Site` 为 `same-site` 或 `cross-site`，或 `Origin` 的主机与请求主机不同。不发送这两个头的调用方（如插件和脚本）不受影响。
- **请求体**：JSON 请求体超过 1 MiB 时返回 `413 too_large`；需要 JSON 请求体的操作收到其他 `Content-Type` 时返回 `415 unsupported_media_type`。请求体必须持续到达：30 秒后平均速度低于 16 KiB/s 时，连接会被关闭。
- **事件流**：控制台和构建日志使用 Server-Sent Events，每行附带 `id:`（Unix 秒）。客户端在一小时内携带 `Last-Event-ID` 重连时，从该秒继续发送。服务端每分钟重新检查调用方，会话或权限失效时以 `event: revoked` 结束事件流。事件流在 30 分钟后或服务端关闭时断开，客户端随后重连即可。

## 接口分组 {#endpoints}

下表列出主要接口分组。路径中的 `{name}` 是服务器名称。

### 内部接口 {#internal-endpoints}

| 分组 | 路径 | 等级 | 说明 |
| --- | --- | --- | --- |
| 健康与指标 | `/healthz`、`/readyz`、`/metrics` | `public` | 存活与就绪探测；Prometheus 指标。`/healthz` 同时属于外部接口 |
| 会话验证 | `/session/minecraft/hasJoined` | `public` | 游戏代理的多来源会话验证：按优先级依次询问已配置的认证源，Mojang 优先 |
| 服务器生命周期 | `/api/v1/servers`、`/api/v1/internal/servers/{name}/…` | `service` | 服务器列表、唤醒、状态、认领、就绪回调、进服事件、大厅菜单数据 |
| 玩家 | `/api/v1/internal/player/…` | `service` | 菜单访问判断、用户名冲突黑名单 |
| 账号绑定 | `/api/v1/internal/account/…` | `service` | 生成绑定码、查询绑定状态、账户迁移 |
| 管理员登录 | `/api/v1/internal/op-login/…` | `service` | 列出待批准的管理员登录请求并在游戏内批准 |
| 玩家进入策略 | `/api/v1/internal/settings/entry-policy` | `service` | 游戏代理和登录空间读取当前策略 |
| 构建上下文 | `/api/v1/internal/submissions/{id}/context` | `service` | 构建任务读取投稿内容 |
| 主机命令 | `/api/v1/internal/servers/{name}/backup`、`…/restore` | `service` | 停服世界备份；整机重建时恢复世界 |
| 任务传输 | `/api/v1/internal/file-uploads/{id}`、`/api/v1/internal/file-browser/{id}`、`/api/v1/internal/exports/{id}` | `public` | 文件与导出任务使用一次性令牌传输数据 |

### 外部接口 {#external-endpoints}

| 分组 | 路径 | 等级 | 说明 |
| --- | --- | --- | --- |
| 登录 | `/api/v1/auth/…` | `public` | 通行密钥、邮箱验证码、管理员登录、绑定码、设置令牌、退出登录 |
| 当前用户 | `/api/v1/me`、`/api/v1/me/servers`、`/api/v1/me/server-quota` | `app` | 账户信息、本人的服务器与建服配额；在配额内创建与修改本人的服务器 |
| 服务端软件 | `/api/v1/software…` | `app` | 可选核心、游戏版本、构建与所需 Java 版本 |
| 账户 | `/api/v1/account/…` | `app` | 账号绑定、邮箱、通行密钥、身份复核、会话管理、API 密钥、账户迁移 |
| 服务器操作 | `/api/v1/servers/{name}/…` | `app` | 唤醒、停止、重启、认领、状态、退役、任务记录 |
| 启动设置 | `GET /api/v1/servers/{name}/startup-settings` | `app` | 本服服主与管理员读取 JVM 参数、启动参数、用户环境变量与停止命令 |
| 控制台与玩家 | `/api/v1/servers/{name}/console`、`…/command`、`…/access/…`、`…/allowlist` | `app` | 控制台事件流与 RCON 命令；白名单、封禁、踢出、OP、LuckPerms |
| 文件 | `/api/v1/servers/{name}/files…`、`…/file` | `app` | 浏览、编辑、上传（含分片上传）、下载、解压、重命名 |
| 备份与导出 | `/api/v1/backups`、`/api/v1/servers/{name}/backup`、`…/restore-backup`、`…/world/export`、`/api/v1/exports/…` | `app` | 世界备份列表、立即备份、恢复、导出与下载 |
| 计划任务 | `/api/v1/servers/{name}/schedules…` | `app` | 计划任务的增删改与立即执行 |
| 我的提交 | `/api/v1/me/submissions…` | `app` | 整合包投稿与上传 |
| 服务器管理 | `POST /api/v1/servers`、`PATCH /api/v1/servers/{name}`、`/api/v1/fleet`、`/api/v1/nodes`、`/api/v1/servers/{name}/migrations…` | `admin` | 创建与修改服务器、全平台服务器列表、执行节点、服务器迁移 |
| 镜像与构建 | `/api/v1/images`、`/api/v1/images/build…` | `admin` | 镜像白名单；构建、构建日志、取消、安全扫描与 SBOM |
| 审核提交 | `/api/v1/submissions…` | `admin` | 批准或拒绝投稿 |
| 用户管理 | `/api/v1/users…` | `owner` | 用户、配额、会话、通行密钥、游戏角色绑定 |
| 平台设置 | `/api/v1/settings/…`、`/api/v1/updates/…`、`/api/v1/platform/db-backup` | `owner` | 玩家进入策略、唤醒与归档策略、自助建服默认配额、心跳、故障切换、邮件中继、认证源、API 密钥开关、维护窗口、版本更新报告、数据库备份状态 |
| 故障切换 | `/api/v1/nodes/{node}/failover` | `owner` | 读取切换计划并对失联节点执行故障切换 |
| 紧急停止 | `POST /api/v1/servers/{name}/emergency-stop` | `owner` | 立即停止服务器 |
| 主机运维 | 见下文 | `owner` | 在主控主机上执行运维任务 |

### 服务器高级启动设置 {#server-startup-settings}

`GET /api/v1/servers/{name}/startup-settings` 仅允许该服务器的所有者与管理员读取，返回 `java_flags`、`args`、`env` 与 `stop_commands` 四个数组。`env` 的每项包含 `name` 与 `value`，空值以空字符串返回；平台托管的环境变量不包含在响应中。这些值不出现在公开服务器状态或服务器列表中。

服务器所有者通过 `PATCH /api/v1/me/servers/{name}` 修改，管理员通过 `PATCH /api/v1/servers/{name}` 修改，请求体使用相同的四个字段。省略字段或传入 `null` 保留原值，传入 `[]` 清空对应设置；环境变量的清空只移除用户设置，保留平台托管值。所有字段先校验，再一起保存；不符合限制时返回 `400 bad_startup_settings`。并发变更无法合并时返回 `409 conflict`，须重新读取后重试。高级启动设置的限制与生效时间见[高级启动设置](/guide/servers#startup-settings)。

### 额外端口 {#server-extra-ports}

服主使用 `PATCH /api/v1/me/servers/{name}`，管理员使用 `PATCH /api/v1/servers/{name}`，通过 `extraPorts` 数组设置额外端口，例如 `{"extraPorts":[{"protocol":"UDP","port":24454},{"protocol":"TCP","port":8123}]}`。每项只接受 `protocol`（`TCP` 或 `UDP`）与内部 `port`（1–65535），最多五项，同协议端口不可重复。托管游戏、RCON 和健康检查 TCP 端口返回 `400 bad_extra_ports`。客户端不能指定对外端口；省略或传入 `null` 保留原值，`[]` 清空。全部字段校验成功后一起保存，运行中修改不会重启游戏。

管理者状态与自己的服务器列表可返回 `extraPorts`，每项包含 `protocol`、`port`，以及确认应用后的 `nodePort` 和可用时的完整直连 `address`。`extraPortsPending` 表示尚未确认应用；未确认的外口和地址不会充作有效映射。公共状态不返回这些字段。地址使用节点对外 IP，不使用 Cloudflare Tunnel 域名。

账户删除或世界释放会等待端口撤销确认；清理未完成时保留所有权，HTTP 请求可返回 `409 extra_ports_pending`，稍后可重试。使用方式见[额外 TCP 与 UDP 端口](/guide/servers#extra-ports)。

### 磁盘用量 {#server-disk-usage}

服务器状态与列表中的 `disk` 仅对该服服主和管理员返回，包含 `usedBytes`、`limitBytes`、`sampledAt` 与 `stale`。没有成功采样时省略 `disk`；停止后的服务器仍可返回用量。`diskFull` 表示配额是否阻止启动，公共状态也可返回该标记，但不包含具体用量。

`stale: true` 不仅表示样本已过期，也可能表示清理后新样本已低于配额、仍在等待平台确认解除满额限制。启动限制以 `diskFull` 为准。

满额时，启动和重启接口返回 `409 disk_full`。已有的满额限制会保留到新的有效样本确认低于配额；采样失败或过期不能解除限制。正常停止、文件管理与下载继续可用。统计口径与更新延迟见[磁盘用量与配额](/guide/servers#disk-quota)。

### 主机运维接口 {#host-operations}

主机运维接口全部属于外部接口，等级为 `owner`。felis-api 把每项任务交给主机上的 root 服务 `felis-node-control.service`，由它执行与命令行相同的 `felis` 命令或安装器功能。面板中的对应位置和命令行等价操作见[运维概览](/operations/#panel-host-operations)。

| 方法与路径 | 用途 | 身份复核 |
| --- | --- | --- |
| `GET /api/v1/platform/host` | 主机概览：磁盘、内存、服务与定时器、未处理告警、数据库备份包、异地副本、主机设置 | 不需要 |
| `POST /api/v1/platform/host/quiet` | 在未来七天内的某个时间之前暂停看门狗邮件，或取消暂停 | 需要 |
| `POST /api/v1/platform/offsite/key` | 读取异地副本加密密钥 | 需要 |
| `GET /api/v1/platform/audit-export` | 导出审计日志 | 需要 |
| `GET /api/v1/settings/node-control` | 列出主机任务 | 不需要 |
| `POST /api/v1/settings/node-control/tasks` | 启动主机任务 | 需要 |
| `GET /api/v1/settings/node-control/tasks/{id}` | 读取任务阶段、错误和最近的执行日志 | 不需要 |
| `POST /api/v1/settings/node-control/tasks/{id}/retry` | 以失败任务为基础创建新的尝试 | 需要 |
| `GET /api/v1/settings/node-control/tasks/{id}/artifact` | 下载任务生成的文件，例如诊断包 | 需要 |

启动任务的请求体包含以下字段：

| 字段 | 说明 |
| --- | --- |
| `action` | 操作名称。节点操作包括 `enable`、`join`、`approve`、`upgrade`、`fence`、`unfence`、`enable-ha`、`join-controller`；主机任务包括 `db-backup`、`db-verify`、`db-delete`、`db-restore`、`offsite-sync`、`offsite-list`、`offsite-check-key`、`offsite-take-over`、`offsite-configure`、`offsite-disable`、`restore-host`、`backup-now`、`rotate-token`、`domain-check`、`domain-set`、`storage-configure`、`connection-configure`、`converge`、`doctor`、`support-bundle`、`host-settings`、`server-forwarding` |
| `confirmMaintenance` | 必填。所有节点操作，以及会断开玩家、重启面板或替换数据的主机任务，都必须为 `true` |
| `name`、`sshTarget`、`externalIP`、`peers` | 节点操作的参数：节点名称、已验证的 root SSH 目标、节点固定地址、额外的对等地址 |
| `params` | 操作自身的输入，随任务保存，例如备份包名称、域名或模式 |
| `secrets` | 操作所需的凭据，例如存储桶密钥或 API 令牌。只传给主机，不随任务保存，也不会返回；重试时需要重新提供 |

任务记录包含 `state`（`running`、`succeeded`、`failed`）、`stage`、`error`、最近 64 KiB 的 `log`、操作报告的数据 `result`，以及生成的文件 `artifact`。同一时间只运行一个任务，另一个任务运行期间再次启动会返回 `409`；主机服务不可用时返回 `503`。
