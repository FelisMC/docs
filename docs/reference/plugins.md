---
title: 服务端插件
---

# 服务端插件 {#felis-server-side-plugins}

这里收录 Felis 的集群内插件与边缘插件。Velocity 代理和三种加载器模组实现 §10 账号绑定流程的游戏内第一步：已在线的玩家（UUID 已由 Mojang 验证）执行 `/link`，插件请求 felis-api 为该 UUID 生成一次性绑定码，并显示在聊天中。玩家随后在 Web 控制台的**账号**页面输入绑定码，完成第二步，将 Minecraft 身份绑定到当前登录的账号。Web 端已实现。三种加载器模组仅用于开启 online-mode 的独立服务器，限制见下方警告。

**limbo** 模块无需玩家执行命令，就会调用同一 felis-api 接口。它作为登录网关，在未绑定的玩家进服时生成绑定码，并让玩家等待，直到完成兑换。**paper** 大厅模块不提供这两种绑定方式，详见下文。

**Velocity** 模块还实现了 §11 域名自动启动路由：识别各服务器子域名、动态注册后端、唤醒休眠目标，并让玩家等待至服务器就绪。它是完整的代理插件；功能与限制见下方 [Velocity 路由](#velocity-routing-§11)。Fabric / Forge / NeoForge 模组仅提供 `/link`。

**Paper** 模块提供 §12 的大厅界面。它**不提供** `/link`，也**不持有** felis-api 令牌，只绘制 `/menu`（以及 `/server`）箱子界面，并通过 `felis:control` 插件消息通道与 Velocity 通信。只有 Velocity 直接访问 felis-api。详见[大厅菜单](#lobby-menu-§12)。

| 模块 | 平台 | 编译依赖 | Jar | 由安装器构建 |
| --- | --- | --- | --- | --- |
| `velocity/` | Velocity 代理插件 | velocity-api 3.5.1（Java 21 字节码） | `felis-velocity-0.1.0.jar` | 是 |
| `limbo/` | LOOHP/Limbo 插件（登录服） | Limbo API 2026.0.3-ALPHA（Java 17 字节码） | `felis-limbo-0.1.0.jar` | 是 |
| `paper/` | Paper 服务器插件（大厅） | paper-api 26.3.build.40-alpha | `felis-paper-0.1.0.jar` | 是 |
| `fabric/` | Fabric 服务器模组 | MC 1.20.1 / fabric-loader 0.16.5 / fabric-api 0.92.2+1.20.1 | `felis-fabric-0.1.0.jar` | 否 |
| `forge/` | Forge 服务器模组 | MC 1.20.1 / Forge 47.3.0 | `felis-forge-0.1.0.jar` | 否 |
| `neoforge/` | NeoForge 服务器模组 | MC 1.20.4 / NeoForge 20.4.251 | `felis-neoforge-0.1.0.jar` | 否 |
| `shared/` | 不独立构建 | — | 源码编入各模块 | 仅源码 |

安装器使用的三种版本，与 `deploy/game-stack.lock` 中的固定构建一致：Velocity 的 `VELOCITY_VERSION`、Limbo 的 `LIMBO_VERSION` 和 Paper 的 `PAPER_JAR_URL`。编译依赖与锁文件不一致时，`go test .` 会失败；见[依赖校验](#dependency-verification)。

### Minecraft 版本 {#minecraft-versions}

| 模块 | 运行位置 | Minecraft |
| --- | --- | --- |
| `velocity` | Felis 代理（Velocity 3.5.1） | 代理接受的客户端版本：原生支持 26.3，旧版通过安装器部署的 ViaVersion 组件接入 |
| `limbo` | Felis 登录网关（Limbo） | 仅 26.3；Limbo 只支持锁文件 `MC_VERSION` 指定的单一协议 |
| `paper` | Felis 大厅（Paper 26.3） | 26.3，即锁文件的 `MC_VERSION` |
| `fabric` | 独立 Fabric 服务器 | 1.20.1（`fabric.mod.json` 声明 `~1.20.1`） |
| `forge` | 独立 Forge 服务器 | 1.20.1（`mods.toml` 声明 `[1.20.1,1.20.2)`） |
| `neoforge` | 独立 NeoForge 服务器 | 1.20.4（`mods.toml` 声明 `[1.20.4,1.20.5)`） |

Felis 网络本身运行 Minecraft 26.3。加载器模组面向较早的 1.20.x 模组生态，只用于网络之外的独立服务器；它们无法加载到 26.x 服务器，Felis 安装也不会加载它们。

“由安装器构建”指 `deploy/bootstrap.sh` 生成的产物，同一组源码也由 `bootstrap_asset.go` 嵌入 felis 二进制，供没有源码检出的 TUI 安装流程使用。**三种加载器模组不在其中**：安装完成后，不会出现 `felis-fabric` / `felis-forge` / `felis-neoforge` jar。它们需要从当前源码按[构建](#building)中的命令编译，并手动部署。账号绑定流程已实现，但安装器不负责部署这些模组。

> **加载器模组仅用于独立服务器。** Felis 网络中，代理的 `/link` 已覆盖所有后端，并优先于后端同名命令，因此用户游戏服务器无需安装模组。模组只在服务器设置 `online-mode=true` 时响应 `/link`；offline-mode 服务器可能位于代理之后（使用代理的 `/link`），也可能是未认证服务器，其 UUID 由客户端自行声明。
>
> **模组持有的令牌是真实凭据。** 它可以为任意指定 UUID 生成绑定码。因此，能读取服务器文件的人，包括运维人员、服务器上的插件或模组、备份副本的持有人，都能将尚未绑定的玩家 Minecraft 账号绑定到自己的 Web 账号。只在你信任运维人员的服务器上安装模组，并使用 `limbo` 令牌；它只开放 link-code、link-status 和 blacklist 路由。`velocity` 令牌还可以批准管理员登录，为任意玩家唤醒或认领服务器，应保留在代理主机上。`sudo felis rotate-token limbo` 用于替换泄露令牌：登录网关会重启并使用新值；模组的 `felis-link.properties` 需要手动更新，模组会在下一次调用时读取，无需重启。

## 各调用路径信任的身份 {#whose-identity-each-path-trusts}

只有 **Velocity 路径**能防止身份伪造。代理运行 `online-mode=true`（由安装器写入），Velocity 会向 Mojang 验证每次登录，下游均使用该登录身份：

- 代理自身的 `/link`、`/felis` 和 `/invite` 使用已验证连接的 UUID。
- 大厅的 `felis:control` 消息按其实际后端连接确定玩家身份，大厅填写的 `player` 字段会被忽略；见[大厅菜单](#lobby-menu-§12)。
- 登录网关和大厅在代理后运行 offline-mode，只接受携带 Velocity modern-forwarding 签名（共享转发密钥）的登录，因此绕过代理的客户端不能自行声明 UUID。

代理以 `online-mode=false` 启动时会拒绝路由，记录错误并关闭路由；其 `/link` 只能看到从名称生成的离线 UUID，与 Mojang 账号 UUID 不一致。

**加载器模组**不在这一保护范围内。模组信任自身服务器返回的 UUID（`getUUID()`），可信程度与服务器相同。服务器未开启 `online-mode=true` 时，模组拒绝 `/link`；服务器运维人员持有可为任意 UUID 生成绑定码的令牌，见上方警告。

## 架构 {#architecture}

各平台都是**独立的** Gradle 构建，分别有自己的 `settings.gradle`。加载器 Gradle 插件对 Gradle 版本的要求存在冲突，因此没有混用这些插件的根项目。平台无关的绑定核心位于 `shared/src/main/java`，由各模块通过以下配置引入：

```groovy
sourceSets { main { java { srcDir '../shared/src/main/java' } } }
```

核心包（`best.lolicon.felis.link`）**没有第三方依赖**，使用 JDK 的 `java.net.http.HttpClient` 和小型手写 JSON 解析器。因此无需合并依赖，每个 jar 都可独立使用。

- `LinkClient`：以 `Authorization: Bearer <service-token>` 和请求体 `{"mc_uuid":"<uuid>"}` 调用 `POST {apiBaseUrl}/api/v1/internal/account/link/code`；成功返回 `201 → {code, expires_at}`，否则使用 `{error:{code,message}}` 错误封装。
- `LinkConfigLoader`：读取 `FELIS_API_BASE_URL` / `FELIS_SERVICE_TOKEN`（环境变量优先），或首次运行时生成的带注释模板 `felis-link.properties`。**API 地址和服务令牌属于部署输入，不会编译进代码。** 两个可选配置限制每次调用，接受 1–120 的整数秒数，默认 10 秒：`connect-timeout-seconds` / `FELIS_API_CONNECT_TIMEOUT_SECONDS` 限制连接建立时间；`request-timeout-seconds` / `FELIS_API_REQUEST_TIMEOUT_SECONDS` 限制整个请求。其他值会导致配置加载失败，并指出对应键名。
- `FelisApiClient`：路由客户端。GET 因连接中断或 502/503/504 失败时，会在 100–400 毫秒的随机延迟后重试一次。GET 超时以及所有 POST（唤醒、认领、join-event、批准）都不会重试。

线程处理：命令在服务器线程执行，HTTP 请求交给单线程守护执行器，响应再切回服务器线程，缓慢的 felis-api 不会阻塞 tick 循环。配置缺失时，插件会加载，但不注册 `/link`，服务器仍正常运行。

三种模组均使用 **Mojang 官方映射**，因此 Fabric / Forge / NeoForge 的 MC 类名、方法名相同，命令处理器一致；只有 `@Mod`、事件总线和配置目录的适配代码随加载器不同。

## Velocity 路由（§11） {#velocity-routing-§11}

Velocity 位于面向玩家的集群外边缘，域名自动启动路由也在这里实现。除 `/link` 外，Velocity 插件还按子域名识别 Felis 服务器，将后端注册到 Velocity 的动态服务器注册表，并在每次进服时决定直接进入、唤醒休眠服务器后等待，或提示稍后重连。它通过 felis-api 的**内部**接口（服务令牌认证）执行 §9 唤醒和 §11 路由，并接收 §12 大厅菜单的 `felis:control` 插件消息，将消息转换为相同的唤醒、认领和状态调用。玩家身份取自连接，而不信任大厅自行声明的身份。见[大厅菜单](#lobby-menu-§12)。

路由受两个前置条件限制，**任何一个不满足都会安全关闭路由**，但 `/link` 仍可使用：

- **在线模式**：`velocity.toml` 中设置 `online-mode=true`。autostartPolicy 和白名单检查信任 Mojang 验证过的 UUID；离线模式下，插件拒绝根据可伪造的身份路由，并记录错误。
- **根域名**：部署域，例如 `mc.example.net`。这是部署域进入代理的唯一位置，**不会编译进代码**。未配置时，基于主机名的路由没有匹配依据，因此保持关闭。

启用路由后的行为：

| 功能 | 行为 |
| --- | --- |
| 后端注册表 | 每 15 秒轮询 `GET /api/v1/servers`，并同步 Velocity 动态注册表。轮询失败时**保留已有注册**，控制平面短暂不可用不会注销正在运行的后端。API 返回后端 Service 可由宿主机路由的 ClusterIP，避免宿主机上的代理依赖集群 DNS 名称。 |
| 进服（`PlayerChooseInitialServerEvent`） | 解析 `subdomain.<root-domain>` 并记住目标，但所有新连接仍首先进入 `login`。登录网关在认证后请求传送到大厅时，Velocity 重新检查绑定状态：记住的目标已就绪就直接进入；目标休眠时，从大厅发起唤醒并加入队列。 |
| 等待队列 | 每 2 秒执行一次定时处理，按不同目标服务器各查询一次状态。服务器正在启动，或处于 operator 重启退避期间的 Failed 时，玩家继续等待，每分钟收到进度提示。完成传送、玩家离线、放弃启动（`startGaveUp`）、服务器停止、连续 120 秒未收到 felis-api 响应，或达到一小时上限时，退出等待。 |
| 唤醒检查 | 按玩家 online-mode UUID 调用 `POST /api/v1/internal/servers/{name}/wake`。**403** 表示策略拒绝，告知玩家并结束；**429** 表示唤醒已在进行，继续等待。 |
| 服务器列表查询（`ProxyPingEvent`） | 从缓存的生命周期视图返回对应阶段的 MOTD（在线 / 启动中 / 休眠），**只读，不唤醒任何服务器**。通过后台查询已就绪后端来镜像其原生 MOTD，属于后续功能。 |
| 进服上报（`ServerConnectedEvent`） | 通过 `POST …/join-event` 上报实际进入 Felis 后端的事件，供回收器更新活跃时间，并自动将玩家加入服务器白名单。 |
| `/felis`、`/felis list` | 显示运维状态：online-mode、root-domain、大厅，以及已知服务器集合的 phase/ready 状态。 |
| `/felis lobby`、`/felis go <lobby>` | 将玩家从任意后端送回大厅，不唤醒服务器；已排队的等待仍会在目标就绪后传送玩家。命令放在 `/felis` 下，避免代理覆盖用户服务器自身的 `/lobby` 或 `/hub`。 |
| `/server` | 移除 Velocity 内置 `/server`，使命令传给后端：在大厅打开服务器菜单，在其他后端使用其自己的 `/server`。内置命令会向所有玩家列出登录网关、大厅和所有运行中的服务器。其他代理插件注册的 `/server` 保留。关闭路由时保留内置命令，因为此时它是切服入口。 |

Velocity 专用配置键也从 `felis-link.properties` 或环境变量读取，与 `/link` 相同，环境变量优先：

| 配置键 | 环境变量 | 含义 |
| --- | --- | --- |
| `root-domain` | `FELIS_ROOT_DOMAIN` | 路由域，例如 `mc.example.net`。未设置时关闭路由。 |
| `login-server` | `FELIS_LOGIN_SERVER` | 所有新连接必须通过的系统认证网关，默认 `login`。 |
| `lobby-server` | `FELIS_LOBBY_SERVER` | 后端唤醒期间使用的独立认证后等待服务器，默认 `lobby`，不得与 `login-server` 相同。 |

代理负载限制：felis-api 调用使用 8 个线程和 64 个等待槽。超过容量时立即拒绝请求：玩家收到“忙碌”提示，大厅消息得到 `busy` 错误，被丢弃的 join-event 记录为警告。这避免了 felis-api 缓慢时线程无限堆积。注册刷新（15 秒）和队列轮询（2 秒）在上一轮未结束时跳过本轮。操作命令（`/link`、`/felis claim`、迁移、管理员批准）共用每玩家限额：初始 5 次，此后每 5 秒补充 1 次。大厅的 felis:control 消息也按玩家限流，菜单状态响应会缓存。

代理健康记录：每个有活动的 10 分钟窗口输出一条 info 日志，内容为 `Felis: last 10 min: felis-api calls=… (no answer=…, 4xx=…, 5xx=…, retried=…), avg=… ms, max=… ms, busy refusals=…, join-events failed=…, join-events dropped=…, transfers failed=…, server-list refreshes failed=…, waiting now=…`，只统计当前窗口。从控制台执行 `/felis` 还会显示启动以来的 felis-api 调用次数、当前等待人数和累计失败次数。服务器列表刷新持续失败时，首次记录警告，之后每 5 分钟记录累计失败次数，恢复时输出 info 日志。登录网关对 link-status 轮询采用相同方式。

## 大厅菜单（§12） {#lobby-menu-§12}

`paper/` 模块实现 §27 场景 10 的大厅玩家界面：`/menu → 插件消息 → Velocity → API → 共享等待队列 → 就绪后连接`。它运行在 Paper 大厅服务器，用箱子界面代替命令行。`/menu`（别名 `/server`，路由启用时由代理透传）为代理路由的每台服务器显示一个格子，点击后可以唤醒、认领或进入后端。

**大厅只负责界面。** 它不持有 felis-api 令牌，不建立 HTTP 连接，也不维护等待队列。每个操作都是 `felis:control` 插件消息通道中的一帧，显示的所有状态也从该通道接收。只有 Velocity 的 `ControlChannel` 访问 felis-api。这一约束由构建**实际强制执行**：模块 `sourceSets` 的包含过滤器只编译 paper 包和三个编解码类，因此大厅 jar 恰好包含以下类：

```
best/lolicon/felis/link/Control.class        (channel framing)
best/lolicon/felis/link/ControlFrame.class   (the frame model)
best/lolicon/felis/link/Json.class           (codec)
best/lolicon/felis/paper/FelisPaperPlugin.class (+ $1)
best/lolicon/felis/paper/LobbyGuard.class
best/lolicon/felis/paper/MenuHolder.class
best/lolicon/felis/paper/MenuTiles.class     (+ $Kind, $Tile)
```

其中**不包含** `FelisApiClient`、`LinkClient` 或令牌配置类。编解码类若新增对 API 客户端的依赖，这里的编译就会失败，不会静默扩大大厅权限。

**消息帧。** 上行（大厅 → Velocity）包括 `ListRequest`、`WakeRequest`、`ClaimRequest` 和 `StatusQuery`；下行（Velocity → 大厅）包括 `ListUpdate`、`StatusUpdate`、`TransferReady` 和 `Error`。`/menu` 发送 `ListRequest`，代理根据实际路由的注册表返回 `ListUpdate`，列出所有用户服务器，因此在面板创建服务器后无需手动编辑大厅。列表优先显示玩家自己的服务器，并附带 felis-api 对当前玩家的判断：`owner`、`wake`、`owner_only`、`allowlist`、`retiring` 或 `start_failed`。该判断来自 `GET /api/v1/internal/player/menu-access/{uuid}`，每次打开菜单调用一次。felis-api 无法响应时，只返回名称，格子的操作交由实际唤醒请求判断。菜单先为每台服务器绘制灰色“加载中”格子，每页 45 个，底行是翻页箭头，再逐一发送 `StatusQuery`；代理通过 `StatusUpdate` 按阶段和归属更新格子。

**防伪造（§14）。** 大厅消息中的 `player` 字段**不可信**。Velocity 从插件消息实际到达的 `ServerConnection` 确定操作玩家及 UUID，服务端 autostartPolicy 和归属检查均使用该已验证身份。消息的 `server` 字段才是操作载荷，只指定点击了哪个格子。因此，即使大厅被完全控制，也无法冒充其他玩家或直接访问 API。

**按钮规则**：`MenuTiles` 根据最近的 `StatusUpdate` 和玩家访问判断，采用第一个匹配项。

| 格子状态 | 按钮 | 发出的消息 |
| --- | --- | --- |
| 已就绪（`ready`），任意访问判断 | **进入**（绿色） | `WakeRequest{server}` |
| 无主（`claimable`） | **认领并启动**（金色） | `ClaimRequest{server}` |
| `retiring` / `start_failed` / `owner_only` / `allowlist` | **无法启动**（灰色，说明中显示原因） | 不发送消息；在聊天中说明原因，菜单保持打开 |
| 其他情况（`owner`、`wake` 或没有访问判断） | **启动**（红色） | `WakeRequest{server}` |

玩家自己的服务器以 ★ 和“你的服务器”标记。状态行使用玩家语言显示运行中、启动中、停止中、已停止、启动失败或未知。“进入”和“启动”发送**相同**的 `WakeRequest` 消息：服务器已运行时，代理直接让玩家进入，任何已绑定的玩家都可加入。拒绝通过 `Error` 消息返回，例如 `not_linked` / `quota_exceeded` / `already_claimed`，并显示易懂的提示。这是认领、配额和策略失败向玩家反馈的位置。就绪状态通过 `TransferReady` 发送，随后代理连接玩家。

> **验证状态。** 该部分**代码完整，且已验证编译**：Paper jar 在 Java 25 工具链下构建成功；Velocity 端编译完整 shared 目录；消息编解码完成往返测试；Fabric / Forge / NeoForge 模组通过自带 wrapper 编译，并在真实独立服务器启动后注册 `/link`。这些检查均由 CI 执行。**尚未通过游戏客户端验证**：没有真实客户端通过整套服务进服，因此 §27 场景 10 在完成实际进服测试之前仍为 **FAIL（实际客户端未验证）**。不依赖客户端的代理边缘、子域名 MOTD、登录边界和后端注册已在真实部署上验证。

## 构建 {#building}

每个模块通过各自随源码提供的 Gradle wrapper 构建。所有 wrapper 都固定发行包 sha256（`distributionSha256Sum`），Gradle 下载被篡改或替换时，会在运行之前失败。各平台所需的 Gradle 版本不同，以下是实际验证过的要求：

| 模块 | Gradle | JDK | 原因 |
| --- | --- | --- | --- |
| `velocity` | 9.8.0 | 运行需要 ≥ 21，生成 Java 21 字节码 | 普通 `java` 插件；velocity-api 3.5.1 声明 `jvm.version = 21` |
| `paper` | 9.8.0 | **Java 25 工具链** | paper-api 26.3 是 Java 25 产物，模块声明 `JavaLanguageVersion.of(25)` 工具链 |
| `limbo` | 9.8.0 | 运行需要 ≥ 21，生成 Java 17 字节码 | 当前 LOOHP/Limbo 发布版使用 class-file major 65，编译 JDK 必须 ≥ 21 才能读取；`release 17` 字节码可运行于使用 Java 17+ 的 Limbo |
| `fabric` | 8.8 | 17 | loom 1.7.4 使用的 `Problems.forNamespace` 在 Gradle 9 被移除 |
| `forge` | 8.8 | 17 | ForgeGradle 6 仅支持 Gradle 8 |
| `neoforge` | 8.14 | 17 | NeoGradle 7.1.38 要求 Gradle API ≥ 8.14 |

安装器内置的 `velocity`、`paper`、`limbo` 插件在所有构建路径中均使用 Gradle 9.8.0：本地和 CI 使用 wrapper，大厅与登录服 Dockerfile、安装器的 Velocity 构建使用 `gradle:9.8.0-jdk25@sha256:…` 镜像。镜像、摘要或 wrapper 版本不一致时，`bootstrap_asset_test.go` 会失败。

```bash
# Velocity and Paper
plugins/velocity/gradlew -p plugins/velocity build
plugins/paper/gradlew    -p plugins/paper    build

# limbo compiles against the LOOHP/Limbo API release the login gate bundles, which has
# to be named: pass deploy/game-stack.lock's LIMBO_VERSION, exactly as bootstrap does.
plugins/limbo/gradlew -p plugins/limbo build -PlimboVersion="$(sed -n 's/^LIMBO_VERSION=//p' deploy/game-stack.lock)"

# Fabric / Forge / NeoForge. Nothing installs these; the jar you want is the one this
# produces.
plugins/fabric/gradlew   -p plugins/fabric   build
plugins/forge/gradlew    -p plugins/forge    build
plugins/neoforge/gradlew -p plugins/neoforge build
```

每个模组首次构建需要下载 Minecraft 并完成映射或反编译，因此可能耗时几分钟；后续构建较快。Jar 位于各模块的 `build/libs`。CI 执行两组检查：

- `bash plugins/test.sh` 使用 JDK 25，检查安装时部署的插件、编解码、邀请、服务器列表，以及基于真实 velocity-api 驱动 ServerRegistry、WaitingRouter、ControlChannel 的代理路由测试。仅运行路由测试可执行 `plugins/velocity/gradlew -p plugins/velocity routingTest`。它还运行基于真实 paper-api 驱动 LobbyMenu 的大厅菜单测试（`plugins/paper/gradlew -p plugins/paper lobbyTest`）、使用虚拟 tick 和 felis-api 桩驱动 LoginFlow 的登录网关测试（`plugins/limbo/gradlew -p plugins/limbo -PlimboVersion=<lock's LIMBO_VERSION> loginTest`），以及检查加载器模组共用 `/link` 的 ModLinkTest。
- `bash plugins/test-mods.sh` 使用 JDK 17，通过上述 wrapper 检查三种加载器模组。

### 依赖校验 {#dependency-verification}

所有依赖均使用精确版本。paper-api 对应 `deploy/game-stack.lock` 安装的 Paper 构建（`paper-26.3-40.jar` → `26.3.build.40-alpha`），Limbo 编译依赖锁文件的 `LIMBO_VERSION`，velocity-api 对应 `VELOCITY_VERSION`，ForgeGradle 固定为 `6.0.54`。安装器使用的三个模块还包含 `gradle/verification-metadata.xml`，记录构建解析的每个产物的 sha256，字节不一致时 Gradle 拒绝使用。Limbo API 校验项就是登录网关实际运行的 jar，其 sha256 与锁文件的 `LIMBO_JAR_SHA256` 一致。

`deploy/update-game-stack-lock.sh` 更新 Paper、Limbo 或 Velocity 后，需要同步固定版本，重新生成校验和，并检查差异：

```bash
# 1. set paper-api in plugins/paper/build.gradle to the new build (paper-<mc>-<n>.jar → <mc>.build.<n>-<channel>)
# 2. regenerate the three verification files (JDK 25) from an EMPTY Gradle home: with a
#    warm cache Gradle skips the BOMs and parent POMs it already holds, and the image
#    builds, which start empty, then refuse them
rm -f plugins/{velocity,paper,limbo}/gradle/verification-metadata.xml
export GRADLE_USER_HOME="$(mktemp -d)"
plugins/velocity/gradlew -p plugins/velocity --write-verification-metadata sha256 build
plugins/paper/gradlew    -p plugins/paper    --write-verification-metadata sha256 build
plugins/limbo/gradlew    -p plugins/limbo    --write-verification-metadata sha256 build \
  -PlimboVersion="$(sed -n 's/^LIMBO_VERSION=//p' deploy/game-stack.lock)"
unset GRADLE_USER_HOME
# 3. go test . fails until the pins, the checksums and the lock agree
```

加载器模组也固定插件、依赖版本和 wrapper 的 sha256，但不包含校验文件。loom、ForgeGradle 和 NeoGradle 使用自己的下载器获取和映射 Minecraft，并对照 Mojang 清单的哈希检查；这些 jar 不由安装器部署。

## 部署 {#deploying}

将对应 jar 放入服务器或代理的 mods / plugins 目录，启动一次生成 `config/felis-link.properties`（Velocity 为 `plugins/felis-link/…`），随后设置 `api-base-url` 和 `service-token`，或提供优先级更高的环境变量 `FELIS_API_BASE_URL` 和 `FELIS_SERVICE_TOKEN`。

令牌属于 felis-api 按调用方分配的内部令牌。Velocity 代理使用 `velocity` 令牌（Secret `felis/felis-service-token`），登录网关使用 `limbo` 令牌（`felis-limbo-token`），各自只可访问自己的路由，跨调用方路由返回 `403 wrong_caller`。加载器模组只在开启 online-mode 的独立服务器上使用 `limbo` 令牌，详见模块表后的警告。令牌应作为密钥保存；`sudo felis rotate-token <caller>` 可替换它。

从文件读取的令牌会跟随文件更新：代理或模组最多每秒重新读取一次，下一次调用 felis-api 时使用新 `service-token`，记录 `service-token reloaded from … (fingerprint …)`，保留已有玩家连接。环境变量 `FELIS_SERVICE_TOKEN` 中的令牌需重启进程才会改变。

**Velocity** 还需要在同一文件设置 `root-domain`（以及可选的 `lobby-server`），并确保 `velocity.toml` 中为 `online-mode=true`，才能启用 §11 路由。任一条件不满足时，代理仍提供 `/link`，但路由保持关闭，见 [Velocity 路由](#velocity-routing-§11)。插件 ID 固定为 `felis-link`，因此配置目录为 `plugins/felis-link/`；ID 在 0.1 → 0.2 jar 之间保持不变，旧配置可继续使用。

**Paper 大厅**无需配置令牌，也无需维护服务器列表：菜单显示代理实际路由的服务器，由代理通过 `felis:control` 发送。旧版本在 `plugins/FelisPaper/config.yml` 中留下的 `servers:` 列表会被忽略，插件会在启动时提示。大厅必须与后端位于同一 Velocity 代理之后，只通过代理的 `felis:control` 入口访问控制平面，因此不需要自己的 `api-base-url` 或 `service-token`。安装器将该 jar 构建并打包进大厅镜像；自行运行大厅时才需要手动安装。

---

原文：[plugins/README.md](https://github.com/FelisMC/Felis/blob/main/plugins/README.md)。
