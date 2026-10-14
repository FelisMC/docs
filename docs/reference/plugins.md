---
title: 服务端插件
description: Felis 的 Velocity、Limbo、Paper 插件与加载器模组：功能、Minecraft 版本、构建、依赖校验与部署。
---

# 服务端插件 {#plugins}

本页说明仓库 `plugins/` 目录中的 Java 插件与模组：各模块的功能、支持的 Minecraft 版本、身份信任模型、游戏代理的路由行为、大厅菜单，以及构建、依赖校验和手动部署方法。面向开发者和需要手动部署插件的运维人员。安装器会自动构建并部署游戏代理、登录空间和大厅所需的插件。

## 概览 {#overview}

| 模块 | 平台 | 编译依赖 | Jar | 由安装器构建 |
| --- | --- | --- | --- | --- |
| `velocity/` | Velocity 代理插件 | velocity-api 3.5.1（Java 21 字节码） | `felis-velocity-0.1.0.jar` | 是 |
| `limbo/` | LOOHP/Limbo 插件（登录空间） | Limbo API 2026.0.3-ALPHA（Java 17 字节码） | `felis-limbo-0.1.0.jar` | 是 |
| `paper/` | Paper 插件（正式大厅） | paper-api 26.3.build.40-alpha | `felis-paper-0.1.0.jar` | 是 |
| `fabric/` | Fabric 服务器模组 | MC 1.20.1 / fabric-loader 0.16.5 / fabric-api 0.92.2+1.20.1 | `felis-fabric-0.1.0.jar` | 否 |
| `forge/` | Forge 服务器模组 | MC 1.20.1 / Forge 47.3.0 | `felis-forge-0.1.0.jar` | 否 |
| `neoforge/` | NeoForge 服务器模组 | MC 1.20.4 / NeoForge 20.4.251 | `felis-neoforge-0.1.0.jar` | 否 |
| `shared/` | 不单独构建 | — | 源码编入各模块 | 仅源码 |

各模块的作用：

- **Velocity 插件**（插件 ID `felis-link`）是完整的代理插件：按子域名识别服务器，动态注册后端，唤醒休眠服务器并让玩家等待，按[玩家进入策略](/guide/players#entry-policy)路由，提供 `/link`、`/felis`、`/invite` 命令，并在游戏内批准管理员登录。它通过内部接口直接访问 felis-api，见 [Velocity 路由](#velocity-routing)。
- **Limbo 插件**把登录空间变成认证网关：提供就绪探测端点，并为尚未绑定的玩家生成绑定码、等待其在面板完成绑定，见[登录空间镜像](/reference/limbo)。
- **Paper 插件**提供正式大厅的 `/menu` 箱子界面和大厅保护规则。它不持有 felis-api 令牌，只通过 `felis:control` 插件消息通道与游戏代理通信，见[大厅菜单](#lobby-menu)。
- **Fabric、Forge、NeoForge 模组**只提供 `/link`，用于 Felis 网络之外、开启 online-mode 的独立服务器。

账号绑定的游戏内一步由 `/link` 完成：已在线的玩家执行 `/link`，插件请求 felis-api 为该玩家已验证的 UUID 生成一次性绑定码并显示在聊天中；玩家随后在面板的「账户」页面输入绑定码，完成绑定。登录空间无需玩家输入命令，进入时即生成绑定码。绑定流程见[玩家接入](/guide/players#account-linking)。

安装器使用的 Velocity、Limbo 和 Paper 版本与 `deploy/game-stack.lock` 中的固定版本一致：Velocity 对应 `VELOCITY_VERSION`，Limbo 对应 `LIMBO_VERSION`，Paper 对应 `PAPER_JAR_URL` 中的构建。编译依赖与锁文件不一致时，仓库的 Go 测试会失败，见[依赖校验](#dependency-verification)。

::: warning 加载器模组仅用于独立服务器
在 Felis 网络中，游戏代理的 `/link` 覆盖所有后端，并优先于后端自身的同名命令，因此用户的游戏服务器无需安装模组。模组只在服务器设置 `online-mode=true` 时响应 `/link`。安装器不会部署这些模组，需要按[构建](#building)中的命令自行编译并手动安装。
:::

::: danger 模组持有的令牌是真实凭据
模组的令牌可以为任意 UUID 生成绑定码。能读取该服务器文件的人（服务器运维人员、服务器上的任意插件或模组、备份副本的持有人）都可以把尚未绑定的玩家账号绑定到自己的面板账户。只在信任其运维人员的服务器上安装模组，并使用 `limbo` 令牌：它只开放绑定码、绑定状态和黑名单接口。`velocity` 令牌还能批准管理员登录、为任意玩家唤醒或认领服务器，只应保留在代理主机上。令牌泄露时，执行 `sudo felis rotate-token -yes limbo` 替换：登录空间会重启并使用新值；模组的 `felis-link.properties` 需要手动更新，模组在下一次调用时读取新值，无需重启。
:::

## Minecraft 版本 {#minecraft-versions}

| 模块 | 运行位置 | Minecraft |
| --- | --- | --- |
| `velocity` | Felis 游戏代理（Velocity 3.5.1） | 代理接受的客户端版本：原生支持 26.3，较早的客户端通过安装器部署的 ViaVersion 组件接入 |
| `limbo` | Felis 登录空间（Limbo） | 仅 26.3；Limbo 只支持锁文件 `MC_VERSION` 指定的单一协议 |
| `paper` | Felis 正式大厅（Paper 26.3） | 26.3，即锁文件的 `MC_VERSION` |
| `fabric` | 独立 Fabric 服务器 | 1.20.1（`fabric.mod.json` 声明 `~1.20.1`） |
| `forge` | 独立 Forge 服务器 | 1.20.1（`mods.toml` 声明 `[1.20.1,1.20.2)`） |
| `neoforge` | 独立 NeoForge 服务器 | 1.20.4（`mods.toml` 声明 `[1.20.4,1.20.5)`） |

Felis 网络本身运行 Minecraft 26.3。加载器模组面向 1.20.x 模组生态，只用于网络之外的独立服务器；它们无法加载到 26.x 服务器，Felis 安装也不会加载它们。

## 身份信任 {#identity}

只有经过游戏代理的路径能防止身份伪造。游戏代理以 `online-mode=true` 运行（由安装器写入），每次登录都经过 Mojang 或已配置认证源的验证，下游都使用这一已验证身份：

- 代理自身的 `/link`、`/felis` 和 `/invite` 使用已验证连接的 UUID。
- 大厅发出的 `felis:control` 消息按其实际到达的后端连接确定玩家身份，大厅填写的 `player` 字段被忽略，见[大厅菜单](#lobby-menu)。
- 登录空间和大厅在代理之后以 offline-mode 运行，只接受带有 Velocity modern forwarding 签名（共享转发密钥）的登录，绕过代理的客户端无法自行声明 UUID。

游戏代理以 `online-mode=false` 启动时会关闭路由并记录错误；此时 `/link` 只能看到由名称生成的离线 UUID，与正版账号的 UUID 不同。

加载器模组不在这一保护范围内。模组信任其服务器报告的 UUID，可信程度与该服务器相同：服务器未开启 `online-mode=true` 时，模组拒绝 `/link`；服务器运维人员持有可为任意 UUID 生成绑定码的令牌，见[概览](#overview)中的警告。

## 架构 {#architecture}

每个平台都是独立的 Gradle 构建，分别有自己的 `settings.gradle`；各加载器的 Gradle 插件对 Gradle 版本的要求互相冲突，因此没有统一的根项目。平台无关的核心代码位于 `shared/src/main/java`，各模块通过以下配置把它编入自身：

```groovy
sourceSets { main { java { srcDir '../shared/src/main/java' } } }
```

核心包 `best.lolicon.felis.link` 没有第三方依赖，使用 JDK 的 `java.net.http.HttpClient` 和一个小型 JSON 解析器，因此每个 jar 都可独立使用，无需合并依赖。

- **绑定客户端**：以 `Authorization: Bearer <service-token>` 和请求体 `{"mc_uuid":"<uuid>"}` 调用 `POST {apiBaseUrl}/api/v1/internal/account/link/code`。成功时返回 `201` 与 `{code, expires_at}`，失败时返回 `{error:{code,message}}` 错误结构。
- **配置加载**：读取环境变量 `FELIS_API_BASE_URL`、`FELIS_SERVICE_TOKEN`，或首次运行时生成的带注释模板 `felis-link.properties`，环境变量优先。API 地址和服务令牌属于部署输入，不编译进代码。两个可选配置限制每次调用的耗时，取 1–120 的整数秒，默认 10：`connect-timeout-seconds`（`FELIS_API_CONNECT_TIMEOUT_SECONDS`）限制建立连接的时间，`request-timeout-seconds`（`FELIS_API_REQUEST_TIMEOUT_SECONDS`）限制整个请求。其他取值会使配置加载失败，并指出对应的键名。
- **路由客户端**：GET 请求因连接中断或 `502`、`503`、`504` 失败时，在 100–400 毫秒的随机延迟后重试一次。超时的 GET 请求和所有 POST 请求（唤醒、认领、进服事件、批准）都不会重试。

命令在服务器线程执行，HTTP 请求交给单线程守护执行器，响应再切回服务器线程，因此 felis-api 响应缓慢不会阻塞 tick 循环。配置缺失时插件仍会加载，但不注册 `/link`，服务器照常运行。

三种模组都使用 Mojang 官方映射，因此 Fabric、Forge、NeoForge 中的类名和方法名一致，命令处理代码相同，只有模组声明、事件总线和配置目录的适配代码随加载器不同。

## Velocity 路由 {#velocity-routing}

游戏代理位于集群之外、面向玩家的边缘。除 `/link` 外，Velocity 插件按子域名识别 Felis 服务器，把后端注册到 Velocity 的动态服务器注册表，并在每次进服时决定直接进入、唤醒休眠服务器并等待，或提示玩家稍后重连。它通过 felis-api 的内部接口（服务令牌认证）完成唤醒和路由，并接收大厅和登录空间的 `felis:control` 消息，把它们转换为相同的唤醒、认领、状态和放行调用。

路由受两个前置条件限制。任一条件不满足时路由安全关闭，`/link` 仍可使用：

- **在线模式**：`velocity.toml` 中设置 `online-mode=true`。自动启动策略和白名单检查信任已验证的 UUID；离线模式下插件拒绝依据可伪造的身份路由，并记录错误。
- **根域名**：部署的根域名，例如 `mc.example.net`。这是根域名进入代理的唯一位置，不编译进代码；未配置时，基于主机名的路由没有匹配依据，保持关闭。

启用路由后的行为：

| 功能 | 行为 |
| --- | --- |
| 后端注册表 | 每 15 秒请求 `GET /api/v1/servers`，同步 Velocity 的动态注册表，同时刷新玩家进入策略。请求失败时保留已有注册和上一次的策略，控制面短暂不可用不会注销正在运行的后端。API 返回后端 Service 可由主机路由的 ClusterIP，代理无需依赖集群 DNS。 |
| 代理重启时 API 不可用 | 代理使用最近一次成功获取的服务器列表 `/opt/felis/velocity/plugins/felis-link/last-servers.json` 路由，直到刷新成功。 |
| 进服 | 解析 `<子域名>.<root-domain>` 并记住目标。要求绑定面板账户时，新连接首先进入 `login`；登录空间请求放行后，代理重新确认绑定状态：记住的目标已就绪时直接进入，目标休眠时从大厅发起唤醒并加入等待队列。felis-api 重启期间，最近 10 分钟内确认过绑定的玩家仍可通过。 |
| 等待队列 | 每 2 秒执行一轮，按不同目标服务器各查询一次状态。服务器正在启动，或处于 operator 重启退避期内的失败状态时，玩家继续等待，每分钟收到一次进度提示。完成传送、玩家离线、放弃启动、服务器被停止、连续 120 秒未收到 felis-api 响应，或达到一小时上限时，退出等待。 |
| 唤醒检查 | 以玩家的 online-mode UUID 调用 `POST /api/v1/internal/servers/{name}/wake`。`403` 表示策略拒绝，告知玩家并结束；`429` 表示唤醒已在进行，继续等待。 |
| 服务器列表查询 | 根据缓存的生命周期视图返回对应阶段的 MOTD（运行中、启动中、启动失败、休眠）和缓存的玩家人数。查询只读，不会唤醒任何服务器，也不会连接后端。 |
| 进服上报 | 通过 `POST …/join-event` 上报玩家实际进入 Felis 后端，供世界清理更新活跃时间，并把玩家自动加入服务器白名单。 |
| `/felis`、`/felis list` | 显示运维状态：在线模式、根域名、大厅，以及已知服务器的阶段和就绪状态。 |
| `/felis lobby`、`/felis go <lobby>` | 把玩家从任意后端送回大厅，不唤醒服务器；已排队的等待仍会在目标就绪后传送玩家。命令放在 `/felis` 下，避免覆盖用户服务器自己的 `/lobby` 或 `/hub`。 |
| `/server` | 移除 Velocity 内置的 `/server`，使命令传给后端：在大厅打开服务器菜单，在其他后端使用其自身的 `/server`。其他代理插件注册的 `/server` 保留。关闭路由时保留内置命令，因为此时它是切换服务器的入口。 |

其他命令：`/felis claim` 认领服务器，`/felis migrate` 用于账户迁移，`/felis web op approve` 在游戏内批准管理员登录，`/invite <player>` 邀请在线玩家来到自己所在的服务器，`/invite accept` 和 `/invite deny` 响应邀请。

Velocity 专用配置键与 `/link` 一样从 `felis-link.properties` 或环境变量读取，环境变量优先：

| 配置键 | 环境变量 | 含义 |
| --- | --- | --- |
| `root-domain` | `FELIS_ROOT_DOMAIN` | 路由使用的根域名，例如 `mc.example.net`。未设置时关闭路由 |
| `login-server` | `FELIS_LOGIN_SERVER` | 新连接必须经过的认证网关，默认 `login` |
| `lobby-server` | `FELIS_LOBBY_SERVER` | 认证后、后端唤醒期间使用的等待服务器，默认 `lobby`，不得与 `login-server` 相同 |
| `panel-hostname` | `FELIS_PANEL_HOSTNAME` | 玩家控制台域名，默认 `console.<root-domain>` |
| `admin-hostname` | `FELIS_ADMIN_HOSTNAME` | 管理控制台域名，默认 `op.console.<root-domain>` |

**负载限制**：felis-api 调用使用 8 个线程和 64 个等待槽。超过容量时立即拒绝：玩家收到“忙碌”提示，大厅消息得到 `busy` 错误，被丢弃的进服事件记录为警告。注册刷新（15 秒）和队列轮询（2 秒）在上一轮未结束时跳过本轮。操作类命令（`/link`、`/felis claim`、迁移、管理员批准）共用每名玩家的限额：初始 5 次，此后每 5 秒补充 1 次。大厅的 `felis:control` 消息也按玩家限流，菜单状态响应会缓存。

**健康日志**：每个有活动的 10 分钟窗口输出一条 info 日志，只统计该窗口：

```text
Felis: last 10 min: felis-api calls=… (no answer=…, 4xx=…, 5xx=…, retried=…), avg=… ms, max=… ms, busy refusals=…, join-events failed=…, join-events dropped=…, transfers failed=…, server-list refreshes failed=…, waiting now=…
```

在代理控制台执行 `/felis` 还会显示启动以来的 felis-api 调用次数、当前等待人数和累计失败次数。服务器列表刷新持续失败时，开始时记录一次警告，之后每 5 分钟记录累计失败次数，恢复时输出 info 日志。登录空间对绑定状态轮询采用相同方式。

## 大厅菜单 {#lobby-menu}

`paper/` 模块提供正式大厅的玩家界面。`/menu`（别名 `/server`，路由启用时由代理透传给大厅）打开箱子界面，为代理路由的每台服务器显示一个格子，点击后唤醒、认领或进入对应的后端。

**大厅只负责界面。** 大厅不持有 felis-api 令牌，不建立 HTTP 连接，也不维护等待队列。它的每个操作都是 `felis:control` 插件消息通道上的一帧，显示的所有状态也来自该通道；只有游戏代理访问 felis-api。这一点由构建保证：模块的源码包含规则只编译 paper 包，以及 `Control`、`ControlFrame`、`Json`、`ExperienceConfig` 四个共享类，大厅 jar 中没有 API 客户端或令牌配置类。共享类若新增对 API 客户端的依赖，大厅的编译会直接失败。

**消息帧。** 大厅发往代理的帧包括 `ListRequest`、`WakeRequest`、`ClaimRequest` 和 `StatusQuery`；代理发往大厅的帧包括 `ListUpdate`、`StatusUpdate`、`TransferReady` 和 `Error`。登录空间使用 `LoginRelease` 帧请求放行。代理只接受大厅和登录空间的 `felis:control` 消息，且各自只能发送属于自己的帧。

`/menu` 发送 `ListRequest`，代理根据实际路由使用的注册表返回 `ListUpdate`，列出所有用户服务器，因此在面板中创建服务器后无需编辑大厅。列表优先显示玩家自己的服务器，并附带 felis-api 对当前玩家的判断：`owner`、`wake`、`owner_only`、`allowlist`、`retiring` 或 `start_failed`。该判断来自 `GET /api/v1/internal/player/menu-access/{uuid}`，每次打开菜单调用一次；felis-api 无法响应时只返回服务器名称，格子的操作交由实际的唤醒请求判断。菜单先为每台服务器绘制灰色的“加载中”格子（每页 45 个，底行为翻页箭头），再为每台服务器发送 `StatusQuery`，代理以 `StatusUpdate` 按阶段和归属更新格子。

**防伪造。** 大厅消息中的 `player` 字段不被信任。代理根据插件消息实际到达的后端连接确定操作的玩家及其 UUID，服务端的自动启动策略和归属检查都基于这一已验证身份。消息的 `server` 字段只表示点击了哪个格子。因此，即使大厅被完全控制，也无法冒充其他玩家或直接访问 API。

**按钮规则**：根据最近一次 `StatusUpdate` 和玩家的访问判断，采用第一个匹配项。

| 格子状态 | 按钮 | 发出的消息 |
| --- | --- | --- |
| 已就绪（`ready`），任意访问判断 | **进入**（绿色） | `WakeRequest{server}` |
| 无主（`claimable`） | **认领并启动**（金色） | `ClaimRequest{server}` |
| `retiring`、`start_failed`、`owner_only`、`allowlist` | **无法启动**（灰色，说明中显示原因） | 不发送消息；在聊天中说明原因，菜单保持打开 |
| 其他情况（`owner`、`wake` 或没有访问判断） | **启动**（红色） | `WakeRequest{server}` |

玩家自己的服务器以 ★ 和“你的服务器”标记。状态行以玩家的语言显示运行中、启动中、停止中、已停止、启动失败或未知。“进入”和“启动”发送相同的 `WakeRequest`：服务器已在运行时，代理直接让玩家进入，任何已绑定的玩家都可以加入。拒绝以 `Error` 帧返回（例如 `not_linked`、`quota_exceeded`、`already_claimed`），并显示为易懂的提示，这是认领、配额和策略失败向玩家反馈的位置。服务器就绪时代理发送 `TransferReady`，随后传送玩家。

## 构建 {#building}

每个模块通过自带的 Gradle wrapper 构建。所有 wrapper 都固定发行包的 SHA-256（`distributionSha256Sum`），Gradle 下载被篡改或替换时会在运行前失败。各平台需要不同的 Gradle 版本：

| 模块 | Gradle | JDK | 原因 |
| --- | --- | --- | --- |
| `velocity` | 9.8.1 | 运行需要 21 或更高，生成 Java 21 字节码 | velocity-api 3.5.1 声明 `jvm.version = 21` |
| `paper` | 9.8.1 | Java 25 工具链 | paper-api 26.3 以 Java 25 产物发布，模块声明 `JavaLanguageVersion.of(25)` 工具链 |
| `limbo` | 9.8.1 | 运行需要 21 或更高，生成 Java 17 字节码 | 当前 LOOHP/Limbo 发布版的 class 文件版本为 65，编译用 JDK 必须为 21 或更高才能读取；`release 17` 字节码可在 Java 17 及以上的 Limbo 上运行 |
| `fabric` | 8.8 | 17 | loom 1.7.4 使用的 Gradle API 在 Gradle 9 中已移除 |
| `forge` | 8.8 | 17 | ForgeGradle 6 只支持 Gradle 8 |
| `neoforge` | 8.14 | 17 | NeoGradle 7.1.38 要求 Gradle API 8.14 或更高 |

安装器使用的三个插件在所有构建路径中都使用 Gradle 9.8.1：本地与 CI 使用 wrapper，大厅与登录空间的 Dockerfile 以及安装器的 Velocity 构建使用按摘要固定的 `gradle:9.8.1-jdk25` 镜像。

在仓库根目录执行：

```bash
# Velocity 与 Paper
plugins/velocity/gradlew -p plugins/velocity build
plugins/paper/gradlew    -p plugins/paper    build

# Limbo 必须指定登录空间所用的 Limbo API 版本，即 deploy/game-stack.lock 中的 LIMBO_VERSION
plugins/limbo/gradlew -p plugins/limbo build -PlimboVersion="$(sed -n 's/^LIMBO_VERSION=//p' deploy/game-stack.lock)"

# Fabric、Forge、NeoForge（安装器不部署，需要使用这里生成的 jar）
plugins/fabric/gradlew   -p plugins/fabric   build
plugins/forge/gradlew    -p plugins/forge    build
plugins/neoforge/gradlew -p plugins/neoforge build
```

生成的 jar 位于各模块的 `build/libs`。每个模组首次构建需要下载 Minecraft 并完成重映射或反编译，可能耗时数分钟，之后的构建较快。插件测试的运行方法见[从源码构建](/guide/building#tests)。

## 依赖校验 {#dependency-verification}

所有依赖都使用精确版本：paper-api 对应 `deploy/game-stack.lock` 安装的 Paper 构建（`paper-26.3-40.jar` 对应 `26.3.build.40-alpha`），Limbo 编译依赖锁文件的 `LIMBO_VERSION`，velocity-api 对应 `VELOCITY_VERSION`，ForgeGradle 固定为 `6.0.54`。安装器使用的三个模块还包含 `gradle/verification-metadata.xml`，记录构建解析的每个产物的 SHA-256，字节不一致时 Gradle 拒绝使用。其中 Limbo API 的条目就是登录空间实际运行的 jar，其 SHA-256 与锁文件的 `LIMBO_JAR_SHA256` 一致。

使用 `deploy/update-game-stack-lock.sh` 更新 Paper、Limbo 或 Velocity 后，同步更新固定版本，重新生成校验文件，并检查差异：

1. 把 `plugins/paper/build.gradle` 中的 paper-api 改为新构建（`paper-<mc>-<n>.jar` 对应 `<mc>.build.<n>-<channel>`）。
2. 使用 JDK 25，在空的 Gradle 目录中重新生成三个校验文件。使用已有缓存时，Gradle 会跳过已缓存的 BOM 和父 POM，而镜像构建从空目录开始，会拒绝这些未记录的产物。

   ```bash
   rm -f plugins/{velocity,paper,limbo}/gradle/verification-metadata.xml
   export GRADLE_USER_HOME="$(mktemp -d)"
   plugins/velocity/gradlew -p plugins/velocity --write-verification-metadata sha256 build
   plugins/paper/gradlew    -p plugins/paper    --write-verification-metadata sha256 build
   plugins/limbo/gradlew    -p plugins/limbo    --write-verification-metadata sha256 build \
     -PlimboVersion="$(sed -n 's/^LIMBO_VERSION=//p' deploy/game-stack.lock)"
   unset GRADLE_USER_HOME
   ```

3. 在仓库根目录执行 `go test .`。固定版本、校验文件和锁文件一致之前，测试会失败。

加载器模组同样固定插件版本、依赖版本和 wrapper 的 SHA-256，但不包含校验文件：loom、ForgeGradle 和 NeoGradle 通过各自的下载器获取并映射 Minecraft，并对照 Mojang 清单中的哈希检查。

## 部署 {#deploying}

安装器会自动部署 Velocity、Limbo 和 Paper 插件。以下步骤适用于手动部署，例如在独立服务器上安装加载器模组，或自行运行大厅：

1. 把对应的 jar 放入服务器或代理的 `mods` 或 `plugins` 目录。
2. 启动一次，生成 `config/felis-link.properties`（Velocity 为 `plugins/felis-link/felis-link.properties`）。
3. 设置 `api-base-url` 和 `service-token`，或提供优先级更高的环境变量 `FELIS_API_BASE_URL` 和 `FELIS_SERVICE_TOKEN`。

令牌是 felis-api 按调用方分配的内部令牌：游戏代理使用 `velocity` 令牌（Secret `felis/felis-service-token`），登录空间使用 `limbo` 令牌（`felis-limbo-token`），每个令牌只能访问自己的接口，用于其他调用方的接口时返回 `403 wrong_caller`。加载器模组只在开启 online-mode 的独立服务器上使用 `limbo` 令牌。令牌应作为机密保存，执行 `sudo felis rotate-token -yes <caller>` 可替换，见[命令行参考](/reference/cli#rotate-token)。

从文件读取的令牌会随文件更新：代理或模组最多每秒重新读取一次文件，从下一次调用 felis-api 起使用新的 `service-token`，记录 `service-token reloaded from … (fingerprint …)`，已连接的玩家不受影响。来自环境变量 `FELIS_SERVICE_TOKEN` 的令牌在进程重启前保持不变。

**Velocity**：还需在同一文件设置 `root-domain`（以及可选的 `lobby-server`），并确保 `velocity.toml` 中为 `online-mode=true`，才能启用路由。任一条件不满足时，代理仍提供 `/link`，但路由保持关闭，见 [Velocity 路由](#velocity-routing)。插件 ID 为 `felis-link`，因此配置目录为 `plugins/felis-link/`。安装器部署的代理配置位于 `/opt/felis/velocity/plugins/felis-link/felis-link.properties`。

**Paper 大厅**：无需设置令牌，也无需维护服务器列表。菜单显示代理实际路由的服务器，由代理通过 `felis:control` 发送；`plugins/FelisPaper/config.yml` 中的 `servers:` 列表会被忽略，插件在启动时给出提示。大厅必须与后端位于同一个 Velocity 代理之后，只通过代理访问控制面，因此不需要自己的 `api-base-url` 或 `service-token`。安装器把该插件打包进大厅镜像，见[大厅镜像](/reference/lobby)。
