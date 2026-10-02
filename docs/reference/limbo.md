---
title: 登录服镜像
---

# 登录服镜像 {#login-limbo-image-loohp-limbo-felis-limbo}

**登录服**是常驻的认证网关。在 `felis.toml` 的 `[velocity] login_image` 中指定镜像后，`felis setup` 会将它配置为系统服务（`DesiredState=Running`，不参与世界回收）。每个新连接首先到达这里；它也是唯一安全的回退目的地，后端停服或启动时均回退到这里，不能绕过认证。

> **仅代码验证。** Go CI 不构建此镜像。镜像会编译 `plugins/limbo` 插件，以及通过源码目录引用的共享绑定核心 `plugins/shared`，再与 LOOHP/Limbo 发布版一起打包。

## 插件的功能 {#what-the-plugin-does}

`felis-limbo` 负责就绪检查和游戏内登录流程。

### 就绪检查 {#readiness}

LOOHP/Limbo 没有 RCON，不能使用 Felis 通常的 RCON 就绪探测（规范 §5）。仅检查 TCP 会在套接字刚绑定时就误报就绪。插件提供 HTTP 就绪端点，只有服务器完成第一次 tick 后才返回 `200`。`login` MinecraftServer 设置 `spec.startup.healthHTTPPort: 8080`，Pod 的 HTTP readinessProbe，以及禁用 RCON 时 operator 的就绪判定，均使用这个信号。

- 端点：`:8080` 上的 `GET /healthz`，可用 `FELIS_HEALTH_PORT` 覆盖。
- 首次 tick 前返回 `503 starting`，之后返回 `200 ok`。
- 失败时拒绝放行：端点无法绑定时不会进入就绪状态，operator 将网关保持在 `Starting`，不会宣告未启动的网关可用。

### 游戏内登录（规范 §B3） {#in-game-login-spec-§b3}

到达登录服的玩家已由上游 Velocity 的 online-mode 验证 UUID，但尚未绑定 Web 账号。玩家加入后，插件在 tick 线程之外执行以下流程：

1. 检查用户名冲突**黑名单**，断开被禁止的抢占者 UUID；真正的 Mojang 玩家使用另一 UUID，不受影响。
2. 通过 felis-api 内部接口，为已验证的 UUID 生成一次性**绑定码**。
3. 打开一本包含 `console.<root_domain>` 可点击链接的**书**，并在聊天中发送绑定码；提示玩家在**系统浏览器**中完成操作，避免使用不支持 Passkey/WebAuthn 的微信、QQ 内置浏览器。Web 入口也会检查此限制，见 `internal/panel`。
4. **轮询** `link/status/{uuid}`，玩家在 Web 控制台兑换绑定码后，通过 `bungeecord:main` 上的 BungeeCord `Connect` 插件消息将其**传送**到大厅。
5. 命中黑名单、生成绑定码或网络传输失败、登录窗口超时，均**断开连接**；认证失败时不予放行。

配置通过部署时的输入提供，不编译进插件。首次运行会在插件数据目录生成 `felis-link.properties` 模板，环境变量优先于该文件：

| 环境变量 | 含义 | 默认值 |
| --- | --- | --- |
| `FELIS_API_BASE_URL` | felis-api **内部**接口基础 URL | 登录必需 |
| `FELIS_SERVICE_TOKEN` | 内部服务令牌（机密） | 登录必需 |
| `FELIS_ROOT_DOMAIN` | 部署域名，用于构造 `https://console.<zone>` | 登录必需 |
| `FELIS_LOBBY_SERVER` | 传送目标的 Velocity 服务器名 | `lobby` |
| `FELIS_LOGIN_TIMEOUT_SECONDS` | 登录窗口，限制为 30–3600 秒 | `600` |
| `FELIS_HEALTH_PORT` | 就绪端口 | `8080` |
| `FELIS_API_CONNECT_TIMEOUT_SECONDS` | felis-api 连接超时，1–120 秒 | `10` |
| `FELIS_API_REQUEST_TIMEOUT_SECONDS` | felis-api 请求超时，1–120 秒 | `10` |

缺少 API 配置**或**根域名时，登录流程保持**关闭**，插件仅执行就绪检查，与其他 Felis 插件的安全降级行为一致。因此，未配置的镜像仍可启动，但生产部署必须提供配置才能完成认证。传送还要求 Velocity 启用 BungeeCord 插件消息通道（代理的 `bungee-plugin-message-channel`）。

## 构建 {#build}

LOOHP/Limbo 没有官方镜像，也没有发布版 zip。它的 CI（`ci.loohpjames.com/job/Limbo`）每次构建分别发布 `target/Limbo-<ver>.jar` 和 `spawn.schem` 两个文件，镜像通过这两个 URL 组装。不包含 `server.properties`，Limbo 会在首次运行时生成默认配置：

```
docker build -f deploy/limbo/Dockerfile \
  --build-arg LIMBO_JAR_URL=https://ci.loohpjames.com/job/Limbo/<n>/artifact/target/Limbo-<ver>.jar \
  --build-arg LIMBO_SCHEM_URL=https://ci.loohpjames.com/job/Limbo/<n>/artifact/spawn.schem \
  --build-arg LIMBO_VERSION=<maven-api-version> \
  -t felis-limbo:demo .
```

- `LIMBO_JAR_URL`（必需）：服务器 jar，保存为 `Limbo.jar`。
- `LIMBO_SCHEM_URL`（可选）：默认出生点结构，保存为 `spawn.schem`，并作为出生点世界加载。
- `LIMBO_VERSION`：插件编译时使用的 Limbo **Maven** API 版本（Gradle `-PlimboVersion`）。它与带 CI 构建后缀的 jar 文件名不同。例如，`Limbo-2026.0.2-ALPHA-26.2.jar` 对应 Maven 版本 `2026.0.2-ALPHA`；`-26.2` 这个 CI 后缀未发布到 Maven 仓库。

将镜像推送到集群内镜像仓库，并在配置中引用。在节点本机执行时，Docker 默认将 `127.0.0.1` 视为非安全仓库：

```
docker tag  felis-limbo:demo 127.0.0.1:5000/felis/limbo:demo
docker push 127.0.0.1:5000/felis/limbo:demo
# felis.toml → [velocity] login_image = "registry.felis.svc:5000/felis/limbo:demo"
sudo felis setup
```

镜像仓库按主机名之后的路径区分仓库，因此从另一台机器经 `kubectl -n felis port-forward svc/registry 5000:5000` 推送也是等价的。镜像须存放在仓库中，不能仅导入 containerd，这样 kubelet 在镜像垃圾回收后才能重新拉取。

## 端口（自动处理） {#ports-handled-for-you}

入口脚本 `deploy/limbo/entrypoint.sh` 每次启动都将 Limbo 的 `server-port` 固定为 `FELIS_GAME_PORT`，默认 **25565**，与 operator 的 `GamePort` 一致。LOOHP/Limbo 原本默认使用 `30000`，但 Velocity 的 NetworkPolicy、Service 和探测均使用 operator 的同一端口常量，导致无法访问。此操作是幂等的，持久化世界卷里的其他 `server.properties` 设置保持不变。除非同时调整 operator，否则**不要**覆盖 `FELIS_GAME_PORT`。

脚本还将 `max-players` 固定为 `-1`（不设上限，也是 Limbo 默认值）。未绑定玩家最多在网关等待十分钟，停服时所有玩家会同时回退到此处；若卷中保留人数限制，玩家会被拒之门外。

## 配置（由部署者负责） {#configure-deployer-s-responsibility}

镜像不会猜测**玩家身份转发**设置，沿用发布版默认值。部署者须使 Limbo 的转发设置与集群外 Velocity 一致，并在代理上启用 BungeeCord 插件消息通道，确保登录网关的 `Connect` 消息能将玩家送到大厅。

登录所需的 `FELIS_API_BASE_URL`、`FELIS_ROOT_DOMAIN`、`FELIS_LOBBY_SERVER`、`FELIS_SERVICE_TOKEN`（见上文[游戏内登录](#in-game-login-spec-§b3)）会自动接入，无须手动设置：

- 三个**非机密**变量由 `felis setup` 写入 `login` MinecraftServer 的 `spec.env`。`cmd/felis` 根据控制命名空间推导内部 API URL，根据 `felis.toml` 获取根域名。控制命名空间默认为 `felis`；改名后须手动同步内部 API URL。
- `FELIS_SERVICE_TOKEN` 是**机密**，不会写进 CRD。登录网关有独立的内部 API 令牌 `felis-limbo-token`，仅允许生成绑定码、轮询绑定状态和检查黑名单。安装器将它复制到 minecraft 命名空间，`felis setup` 会从控制命名空间刷新此副本。operator 根据保留名称 `login`，仅向登录 Pod 通过 `secretKeyRef` 注入 `FELIS_SERVICE_TOKEN`。`sudo felis rotate-token -yes limbo` 替换令牌并重启 Pod。令牌缺失时插件仅执行就绪检查，网关仍可启动，但暂不认证玩家。
- **Service**：登录 Pod 通过 `FELIS_API_BASE_URL` 访问控制命名空间里的 ClusterIP Service `felis-api-internal`，转发至 API Pod 的内部端口 `8081`。它与外部 NodePort `felis-api`（443）独立，避免将不经过零信任验证的内部接口发布到节点外部 IP。
- **NetworkPolicy**：minecraft 命名空间默认通过 `felis-server-egress` 限制出站访问，只允许 DNS 和公网，排除全部私有网段；普通游戏服务器无法访问内部 API。`felis-login-to-internal-api` 仅开放登录 Pod → felis-api:8081，要求同时匹配保留名称 `login` 和 setup 管理、operator 复制到 Pod 上的 `felis.lolicon.best/system-role=login` 标签。令牌注入也使用同一组条件，用户服务器不能仅通过取名来匹配。

`felis setup` 输出 Velocity 的网关和大厅配置，保证新连接首先进入 `login`。只有认证成功并由网关放行后，才能进入大厅或之前记住的用户后端。

---

来源：[deploy/limbo/README.md](https://github.com/FelisMC/Felis/blob/main/deploy/limbo/README.md)。
