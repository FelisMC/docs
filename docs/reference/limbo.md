---
title: 登录空间镜像
description: Felis 登录空间镜像的就绪检查、游戏内登录流程、配置、在面板中的自定义方法与镜像构建。
---

# 登录空间镜像 {#login-image}

本页说明 Felis 登录空间（系统服 `login`）使用的镜像：就绪检查、游戏内登录流程、玩家看到的提示、配置项、在面板中的自定义方法，以及自行构建镜像的步骤。面向管理员和需要定制登录空间的运维人员。

## 概览 {#overview}

登录空间是常驻的认证网关，镜像由 LOOHP/Limbo 和 Felis 登录插件（`felis-limbo`）组成。`felis.toml` 的 `[velocity] login_image` 指定镜像后，`felis setup` 把它创建为系统服：始终保持运行（`DesiredState=Running`），不参与空闲停服和世界清理。安装器会构建该镜像并完成配置。

[玩家进入策略](/guide/players#entry-policy)要求绑定面板账户时，每个新连接首先到达登录空间。它也是唯一安全的回退目的地：后端停止或启动时，玩家回到登录空间，认证不会被绕过。登录插件负责两项工作：就绪检查和游戏内登录。

## 就绪检查 {#readiness}

Limbo 没有 RCON，无法使用 Felis 通常的 RCON 就绪探测；仅检查 TCP 端口又会在套接字刚绑定时就报告就绪。登录插件因此提供一个 HTTP 就绪端点，只有服务器完成第一次 tick 后才返回成功。`login` 系统服的 Pod 就绪探测和 operator 的就绪判断都使用这个端点。

- 端点：端口 `8080` 上的 `GET /healthz`，可用 `FELIS_HEALTH_PORT` 修改端口。
- 第一次 tick 之前返回 `503 starting`，之后返回 `200 ok`。
- 端点无法绑定时永远不会进入就绪状态，operator 把登录空间保持在启动中，不会宣告尚未启动的网关可用。

## 登录流程 {#login-flow}

到达登录空间的玩家已由游戏代理以 online-mode 验证了 UUID，但尚未绑定面板账户。玩家加入后，插件在 tick 线程之外执行以下流程：

1. 检查用户名冲突黑名单，断开被禁止的 UUID 的连接。同名的正版玩家使用不同的 UUID，不受影响。
2. 通过 felis-api 内部接口，为已验证的 UUID 生成一次性绑定码。
3. 打开一本登录书，其中包含指向玩家控制台的可点击链接，并在聊天中发送绑定码。提示玩家在系统浏览器中完成登录：微信、QQ 等应用的内置浏览器不支持通行密钥。
4. 每秒查询一次绑定状态。玩家在面板中输入绑定码后，插件通过 `felis:control` 通道请求放行，并在玩家离开之前按退避间隔重发；游戏代理再次确认绑定状态后，把玩家送往正式大厅或之前记住的目标服务器。
5. 以下情况断开连接：命中黑名单、绑定码生成被拒绝、登录等待时间到期，或放行后 120 秒内仍未离开登录空间。认证失败时一律拒绝放行。

玩家加入时 felis-api 不可用（连接失败或返回 `5xx`）的，插件在 60 秒内按退避间隔重试，之后才拒绝玩家。重试期间插件同样请求放行：游戏代理保留最近 10 分钟内的绑定确认，因此几分钟前登录过的玩家在 felis-api 重启期间仍可通过，其他玩家被拒绝。

玩家进入策略把登录空间用作服务器启动时的等待区时，等待中的玩家不会收到绑定码，也不会开始登录计时；启动进度由游戏代理的等待队列控制。

### 玩家看到的提示 {#player-messages}

| 情况 | 提示 |
| --- | --- |
| 绑定完成 | `登录成功，正在进入大厅… / Signed in — sending you to the lobby…` |
| felis-api 繁忙，正在重试 | `登录服务繁忙，正在重试… / The login service is busy — retrying…` |
| felis-api 持续不可用 | `登录服务暂不可用，请稍后重连 / Login service unavailable, please reconnect shortly.` |
| 登录等待时间到期 | `登录超时，请重连 / Login timed out. Please reconnect.` |
| 放行后未能进入大厅 | `进入大厅失败，请重连 / Could not reach the lobby. Please reconnect.` |
| 命中用户名冲突黑名单 | `该用户名已被回收保护 / This username is under reclaim protection. Contact staff.` |

## 配置 {#configuration}

配置是部署时的输入，不编译进插件。首次运行时插件在数据目录生成 `felis-link.properties` 模板，环境变量优先于该文件：

| 环境变量 | 含义 | 默认值 |
| --- | --- | --- |
| `FELIS_API_BASE_URL` | felis-api 内部接口的基础 URL | 登录流程必需 |
| `FELIS_SERVICE_TOKEN` | 内部服务令牌（机密） | 登录流程必需 |
| `FELIS_PANEL_HOSTNAME` | 登录链接使用的玩家控制台域名 | `console.<FELIS_ROOT_DOMAIN>` |
| `FELIS_ROOT_DOMAIN` | 部署的根域名，未设置 `FELIS_PANEL_HOSTNAME` 时用于生成控制台域名 | — |
| `FELIS_LOBBY_SERVER` | 放行目标的 Velocity 服务器名称 | `lobby` |
| `FELIS_LOGIN_TIMEOUT_SECONDS` | 登录等待时间，限制在 30–3600 秒 | `600` |
| `FELIS_HEALTH_PORT` | 就绪端点端口 | `8080` |
| `FELIS_API_CONNECT_TIMEOUT_SECONDS` | 连接 felis-api 的超时，1–120 秒 | `10` |
| `FELIS_API_REQUEST_TIMEOUT_SECONDS` | felis-api 请求的超时，1–120 秒 | `10` |

缺少 API 配置，或既没有 `FELIS_PANEL_HOSTNAME` 也没有 `FELIS_ROOT_DOMAIN` 时，登录流程保持关闭，插件只提供就绪检查。未配置的镜像因此仍可启动，但不会认证玩家。

### 自动接入 {#wiring}

在 Felis 安装中，以上配置自动接入，无需手动设置：

- **非机密变量**：`felis setup` 把 `FELIS_API_BASE_URL`、`FELIS_ROOT_DOMAIN`、`FELIS_PANEL_HOSTNAME` 和 `FELIS_LOBBY_SERVER` 写入 `login` 系统服的环境变量。内部 API 地址根据控制面命名空间推导，默认命名空间为 `felis`；控制面命名空间改名后需要手动同步该地址。
- **服务令牌**：登录空间使用独立的 `limbo` 令牌（Secret `felis-limbo-token`），只能生成绑定码、查询绑定状态、检查黑名单和读取玩家进入策略。安装器把令牌复制到 `minecraft` 命名空间，`felis setup` 从控制面命名空间刷新该副本。operator 只向登录空间的 Pod 注入 `FELIS_SERVICE_TOKEN`，依据是保留名称 `login` 与标签 `felis.lolicon.best/system-role=login` 同时匹配，因此用户服务器无法通过取名获得令牌。执行 `sudo felis rotate-token -yes limbo` 可替换令牌并重启登录空间。令牌缺失时插件只提供就绪检查。
- **服务地址**：`FELIS_API_BASE_URL` 指向控制面命名空间中的 ClusterIP Service `felis-api-internal`（端口 `8081`）。它与外部 NodePort Service `felis-api`（端口 `443`）分开，内部接口不会发布到节点的外部地址。
- **网络策略**：`minecraft` 命名空间的出站流量由 `felis-server-egress` 限制为 DNS 和公网，游戏服务器默认无法访问内部接口。`felis-login-to-internal-api` 只开放登录空间 Pod 到 felis-api `8081` 端口的路径，匹配条件与令牌注入相同。

## 在面板中自定义 {#customize}

管理员在「管理 → 登录与大厅」中选择「登录空间」。设置可以在运行时保存，在下次启动或重启后生效；保存后选择「重启并应用」立即生效。

::: warning
重启或停止登录空间期间，新玩家无法加入；「重启并应用」会断开登录空间中所有玩家的连接。
:::

「登录提示与等待」部分可配置：

- 登录书标题、登录书作者、登录书页标题、登录链接文案、登录说明；
- 自动打开登录书；
- 登录等待时间（30–3600 秒）。部署中显式设置的环境变量 `FELIS_LOGIN_TIMEOUT_SECONDS` 优先于此处的设置。

绑定码、登录链接和聊天提示由系统生成并始终启用；认证流程和放行目标由系统维护，不属于可自定义项。设置保存在 `/data/felis-experience.json` 中。

更换场景和调整其他内容：

1. 停止登录空间。
2. 在文件管理中把自定义场景上传为根目录下的 `spawn.schem`；出生位置等设置在 Limbo 的 `server.properties` 中调整。
3. 需要时添加兼容 Limbo 的插件。Paper 世界 ZIP 和 Paper 插件无法在 Limbo 中使用。
4. 启动登录空间。

页面还提供运行日志、备份与恢复，以及镜像与资源设置。Limbo 不支持 RCON 命令，控制台只显示日志，配置需通过文件管理修改。使用自定义镜像时，必须保留 Felis 登录插件，并支持游戏代理使用的转发协议。

## 构建镜像 {#build}

安装器会自动构建登录空间镜像。LOOHP/Limbo 没有官方镜像，也没有发布压缩包；它的 CI（`ci.loohpjames.com/job/Limbo`）每个构建发布两个文件：服务器 jar `target/Limbo-<ver>.jar` 和默认出生点结构 `spawn.schem`。镜像由这两个文件组装，Limbo 在首次运行时生成默认的 `server.properties`。

在仓库根目录使用 `deploy/game-stack.lock` 中的版本构建：

```bash
. <(grep '^LIMBO_' deploy/game-stack.lock)
docker build -f deploy/limbo/Dockerfile \
  --build-arg LIMBO_JAR_URL="$LIMBO_JAR_URL" --build-arg LIMBO_JAR_SHA256="$LIMBO_JAR_SHA256" \
  --build-arg LIMBO_SCHEM_URL="$LIMBO_SCHEM_URL" --build-arg LIMBO_SCHEM_SHA256="$LIMBO_SCHEM_SHA256" \
  --build-arg LIMBO_VERSION="$LIMBO_VERSION" \
  -t felis-limbo:demo .
```

| 构建参数 | 说明 |
| --- | --- |
| `LIMBO_JAR_URL`、`LIMBO_JAR_SHA256` | 服务器 jar 及其 SHA-256，保存为 `Limbo.jar` |
| `LIMBO_SCHEM_URL`、`LIMBO_SCHEM_SHA256` | 默认出生点结构及其 SHA-256，保存为 `spawn.schem` 并作为出生点世界加载 |
| `LIMBO_VERSION` | 插件编译时使用的 Limbo Maven API 版本。它与带 CI 构建后缀的 jar 文件名不同，例如 `Limbo-2026.0.3-ALPHA-26.3.jar` 对应 Maven 版本 `2026.0.3-ALPHA` |

把镜像推送到集群内的镜像仓库，并在配置中引用它。在节点本机执行时，Docker 默认把 `127.0.0.1` 视为非安全仓库：

```bash
docker tag  felis-limbo:demo 127.0.0.1:5000/felis/limbo:demo
docker push 127.0.0.1:5000/felis/limbo:demo
```

在 `felis.toml` 中设置 `[velocity] login_image = "registry.felis.svc:5000/felis/limbo:demo"`，然后执行：

```bash
sudo felis setup
```

把镜像存放在镜像仓库中，kubelet 在镜像垃圾回收后才能重新拉取；只导入 containerd 的镜像被回收后无法恢复。镜像仓库按主机名之后的路径区分仓库，因此从另一台机器经 `kubectl -n felis port-forward svc/registry 5000:5000` 推送效果相同。

## 运行要求 {#runtime-requirements}

镜像入口脚本 `deploy/limbo/entrypoint.sh` 在每次启动时改写 `server.properties` 中的以下设置，其余设置保持不变：

| 设置 | 值 | 原因 |
| --- | --- | --- |
| `server-port` | `FELIS_GAME_PORT`，默认 `25565` | Limbo 默认使用 `30000`，而 Service、就绪探测和网络策略都使用 `25565`。不要单独修改 `FELIS_GAME_PORT` |
| `max-players` | `-1`（不限） | 未绑定的玩家最多在此等待十分钟，某台服务器停止时其玩家也会同时回到这里，人数上限会把玩家拒之门外 |
| `velocity-modern`、`forwarding-secrets` | `true`、转发密钥 | 登录空间只信任带有代理签名的玩家身份；`bungeecord` 和 `bungee-guard` 固定为 `false` |

转发密钥由 operator 注入为 `FELIS_FORWARDING_SECRET`。没有该密钥时镜像拒绝启动：未经签名验证的 UUID 会让任何人冒充任意 Minecraft 身份。游戏代理关闭了 BungeeCord 插件消息通道（`bungee-plugin-message-channel = false`），登录空间通过 `felis:control` 通道请求放行，游戏代理只接受来自登录空间的放行请求。
