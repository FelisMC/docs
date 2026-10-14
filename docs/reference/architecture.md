---
title: 系统架构
description: Felis 的组件构成、单机与多机部署布局，以及面板请求、玩家进服、主机运维和镜像构建的处理流程。
---

# 系统架构 {#architecture}

本页说明 Felis 由哪些组件构成、它们在单机和多机部署中的分布，以及主要请求在组件之间的流转方式。面向需要理解系统整体结构的运维人员和开发者。各组件的日常运维见[运维概览](/operations/)。

## 组件 {#components}

Felis 的控制面由一个 `felis` 二进制提供。该二进制包含 API、operator、命令行工具和内嵌的 Web 面板，以子命令区分角色，例如 `felis api`、`felis operator`、`felis reaper`。平台运行在 k3s 上，使用三个命名空间：`felis`（控制面）、`minecraft`（游戏服务器与系统服）和 `felis-build`（镜像构建任务）。

| 组件 | 运行形式 | 作用 |
| --- | --- | --- |
| felis-api | `felis` 命名空间中的 Deployment `felis-api`，单副本 | 提供内部接口、外部接口和 Web 面板；读写 PostgreSQL；创建备份、恢复、文件和构建任务。见 [API 参考](/reference/api) |
| felis-operator | Deployment `felis-operator` | 协调每台服务器的 `MinecraftServer` 自定义资源，创建并维护其 Pod、Service 和世界卷，并判断服务器是否就绪（通常通过 RCON） |
| PostgreSQL | Deployment `felis-postgres`，数据位于主机 `/var/lib/felis/postgres` | 保存账户、服务器归属、配额、审计日志和备份索引 |
| 镜像仓库 | Deployment `registry`，带访问控制边车 `registry-gate` | 存放控制面镜像、系统服镜像、构建产出的镜像，以及构建工具的镜像副本 |
| 世界清理 | CronJob `felis-reaper`（启用世界清理时） | 备份并移除长期闲置的世界。见[世界清理](/operations/backup#world-cleanup) |
| 游戏代理 | 主机上的 systemd 服务 `felis-velocity`（Velocity + Felis 代理插件） | 接受玩家连接，验证身份，按域名和玩家进入策略路由，唤醒休眠服务器 |
| 登录空间 | `minecraft` 命名空间中的系统服 `login`（Limbo + Felis 登录插件） | 为尚未绑定面板账户的玩家完成游戏内登录。见[登录空间镜像](/reference/limbo) |
| 正式大厅 | 系统服 `lobby`（Paper + Felis 大厅插件 + LuckPerms） | 玩家认证后的中转区，提供服务器菜单。见[大厅镜像](/reference/lobby) |
| 游戏服务器 | `minecraft` 命名空间中的 Pod 与世界卷，每台服务器一个 `MinecraftServer` 资源 | 运行用户的 Minecraft 服务器 |
| 镜像构建 | `felis-build` 命名空间中的 Job | 使用 Kaniko 构建投稿的整合包镜像，使用 Trivy 扫描 |
| 主机服务 | systemd 单元：`felis-node-control.service`、`felis-watchdog.timer`、`felis-db-backup.timer`、`felis-offsite.timer`、`felis-update-check.timer`、`felis-build-tools.timer`；使用 Cloudflare Tunnel 时还有 `cloudflared-felis` | 执行面板下发的主机任务、健康检查、数据库备份、异地副本、版本检查和构建工具镜像同步 |

各服务、定时器和数据目录的说明见[运维概览](/operations/#components)和[主机服务](/operations/#services)。

## 单机部署 {#single-node}

默认安装把全部组件放在一台主机上：

```text
玩家 ──TCP 25565──▶ felis-velocity（主机 systemd）
                     │  ├─▶ 登录空间 login ─┐
                     │  ├─▶ 正式大厅 lobby  ├─ k3s：minecraft 命名空间
                     │  └─▶ 游戏服务器 ─────┘
                     └─▶ felis-api 内部接口（ClusterIP felis-api-internal:8081）

浏览器 ──HTTPS──▶ 访问方式（直连 / 自有反向代理 / Cloudflare Tunnel）
                     └─▶ felis-api 外部接口与面板（NodePort，默认 30443）
                            ├─▶ PostgreSQL（felis-postgres）
                            └─▶ Kubernetes API ─▶ felis-operator ─▶ 游戏服务器 Pod
```

- **游戏入口**：游戏代理以 systemd 服务运行在主机上，监听公网游戏端口。它通过各后端 Service 可由主机路由的 ClusterIP 连接游戏服务器，通过 `felis-api-internal:8081` 访问内部接口。
- **面板入口**：外部接口与面板通过 NodePort 提供，默认端口 `30443`（`FELIS_PANEL_NODEPORT`）。访问方式决定它如何暴露到公网，见[访问与域名](/operations/access#access-methods)。
- **存储**：每台服务器的世界保存在节点 local-path 存储上的卷中；世界备份写入归档卷 `felis-backups`；PostgreSQL 的数据目录位于主机。磁盘布局见[存储与磁盘](/operations/storage#disk-layout)。
- **网络隔离**：游戏服务器的出站流量由网络策略 `felis-server-egress` 限制为 DNS 和公网，所有私有地址段都被排除。游戏服务器中只有登录空间可以访问内部接口（`felis-login-to-internal-api`）；构建任务通过自己的出站策略 `felis-build-egress` 访问内部接口。

## 多机部署 {#multi-node}

多机部署默认关闭，属于实验性功能。启用后，主控节点运行 felis-api、operator、k3s server、PostgreSQL、镜像仓库、归档服务 `felis-archive` 和系统服，游戏代理仍以 systemd 服务运行在主控上。工作节点只运行 k3s agent、游戏 Pod 和主控创建的维护任务。所有节点须与主控使用相同的 CPU 架构和 k3s 版本，节点之间通过 WireGuard 通信。

- **世界存放**：世界是所在节点 local-path 存储上的 ReadWriteOnce 卷。在节点之间移动世界需要先停服，再通过主控的归档服务执行迁移。
- **故障切换**：工作节点失联时，所有者可以把该节点上的世界按各服务器最新的完好备份恢复到其他节点，可以手动执行，也可以开启自动故障切换。运行在工作节点上的服务器按设定间隔生成不停服副本，以减少切换时丢失的进度。
- **控制面可用性**：未启用主控高可用时，主控是控制面和公共入口的单点；主控重启期间控制操作暂停，主控上的世界也无法故障切换。

部署步骤见[多机部署与高可用](/guide/distributed#overview)，当前限制见[已知限制](/reference/limitations)。

### 主控高可用 {#controller-ha}

主控高可用让控制面在多台主控之间转移：

- **集群状态**：k3s 使用嵌入式 etcd。etcd 需要多数成员在线，因此应部署三台或更多奇数台主控；三台主控可容忍一台失联。
- **控制面数据**：PostgreSQL、上传文件、镜像仓库、归档以及登录空间和正式大厅的世界保存在 Longhorn StorageClass `felis-replicated` 的复制卷上（3 个副本），Longhorn 只在主控上放置副本。
- **控制面工作负载**：felis-api、operator、PostgreSQL、镜像仓库、归档服务和世界清理只调度到主控，并与 PostgreSQL 运行在同一台主控上。该主控失联后，Pod 在约 30 秒的容忍期后被驱逐，复制卷挂载到另一台主控，控制面在那里重新启动。
- **避免重复执行**：felis-api 的后台循环由租约 `felis-api-loops` 保护，operator 由租约 `felis-operator` 保护。
- **主机定时任务**：数据库备份、异地副本、版本检查和构建工具同步只在当前运行 PostgreSQL 的主控（主机主节点）上执行，`felis ha leader` 判断本机是否为主机主节点。
- **入口**：每台主控都安装游戏代理。可选的 VRRP 浮动地址（keepalived）在主控之间漂移，并优先停留在主机主节点。

详见[主控高可用](/guide/distributed#controller-ha)。

## 运行流程 {#flows}

### 面板请求 {#panel-requests}

1. 浏览器经访问方式到达 felis-api 的外部接口；使用 Cloudflare Access 时，访问控制在边缘完成。
2. felis-api 验证会话 Cookie，并按操作的访问等级检查角色和请求域名。
3. felis-api 读写 PostgreSQL；涉及服务器状态的操作修改对应的 `MinecraftServer` 资源，或在集群中创建备份、恢复、文件等任务。
4. felis-operator 观察到资源变化后，创建、启动或停止服务器的 Pod，并回写状态。

### 玩家进服 {#player-join}

1. 玩家连接 `<服务器>.<root_domain>` 或根域名。游戏代理以 online-mode 运行，通过内部接口的会话验证向 Mojang 及已配置的认证源确认玩家身份。
2. 游戏代理按[玩家进入策略](/guide/players#entry-policy)决定去向。要求绑定面板账户时，新连接首先进入登录空间；尚未绑定的玩家在那里取得绑定码，并在面板完成绑定。
3. 绑定完成后，登录空间请求放行；游戏代理再次确认绑定状态，把玩家送往正式大厅或之前记住的目标服务器。
4. 目标服务器休眠时，游戏代理调用内部接口唤醒它，玩家在大厅等待；服务器就绪后，代理把玩家传送过去，并上报进服事件。

各步骤的消息顺序见[时序图](/reference/sequence-diagrams)，插件的行为见[服务端插件](/reference/plugins#velocity-routing)。

### 主机运维 {#host-operations}

所有者在面板中执行的主机操作（数据库备份与恢复、异地副本、整机重建、健康检查、诊断包、访问方式、根域名、凭据轮换等）按以下方式执行：

1. 面板调用 `owner` 等级的主机运维接口，要求近期完成身份复核。
2. felis-api 以非 root 身份运行，只以只读方式挂载 `felis-node-control.service` 的 Unix socket 目录，并通过它提交任务。
3. `felis-node-control.service` 以 root 运行，只接受固定的操作列表和经过校验的参数，调用与命令行相同的 `felis` 命令或安装器功能。
4. 任务状态和日志保存在 `/var/lib/felis/node-control`，每项任务记入审计日志。

完整的操作列表见[面板中的主机运维](/operations/#panel-host-operations)，接口说明见[主机运维接口](/reference/api#host-operations)。

### 镜像构建 {#image-builds}

1. 玩家在「我的提交」上传整合包，内容保存在上传存储中（本地磁盘或 S3 兼容存储）。
2. 管理员在「审核提交」中批准投稿。
3. felis-api 在 `felis-build` 命名空间创建构建任务。任务的初始化容器使用 `build` 服务令牌从内部接口读取构建上下文，Kaniko 构建镜像，Trivy 执行安全扫描。Kaniko 和 Trivy 镜像来自镜像仓库中的副本，由 `felis-build-tools.timer` 保持更新。
4. 构建产出的镜像推送到集群内镜像仓库，并加入镜像白名单，之后可在创建服务器时选用。

审核流程见[平台管理](/guide/administration#submissions)。
