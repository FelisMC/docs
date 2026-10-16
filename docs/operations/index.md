---
title: 运维概览
description: Felis 主机上运行的组件、日常运维任务，以及在面板和命令行中执行主机操作的方式。
---

# 运维概览 {#operations}

本页面向负责 Felis 主机的运维人员，说明主机上运行哪些组件、数据存放在何处、需要定期执行哪些任务，以及哪些主机操作可在面板中完成、哪些只能在命令行执行。安装步骤见[安装与部署](/guide/deployment#install)，主机规格见[环境要求](/guide/requirements#sizing)。

## 主机组件 {#components}

默认安装为单节点：安装器在主机上安装 k3s，并在其中运行控制面、数据库、镜像仓库和游戏服务器；游戏代理作为 systemd 服务直接运行在主机上。多机部署见[多机部署与高可用](/guide/distributed#overview)，整体架构见[系统架构](/reference/architecture#components)。

| 组件 | 运行方式 | 作用 |
| --- | --- | --- |
| k3s | `k3s.service` | 承载下列容器化组件的 Kubernetes 集群 |
| felis-api | `felis` 命名空间中的 Deployment `felis-api` | Web 面板、公开 API，以及游戏插件使用的内部 API |
| felis-operator | Deployment `felis-operator` | 启动、停止和监视游戏服务器（MinecraftServer 资源） |
| PostgreSQL | Deployment `felis-postgres` | 控制面数据库，数据位于主机 `/var/lib/felis/postgres` |
| 镜像仓库 | Deployment `registry` | 集群内镜像仓库，保存平台镜像、游戏镜像和用户构建的镜像 |
| 登录空间与大厅 | `minecraft` 命名空间中的 MinecraftServer `login`（Limbo）和 `lobby`（Paper） | 玩家进服后的登录空间和正式大厅 |
| 游戏服务器 | `minecraft` 命名空间中的 MinecraftServer | 用户创建的服务器 |
| 构建任务 | `felis-build` 命名空间中的 Job | 根据投稿构建服务器镜像 |
| 游戏代理（Velocity） | `felis-velocity.service` | 在游戏端口接收玩家连接并转发到各服务器 |
| 主机操作服务 | `felis-node-control.service` | 以 root 身份执行面板发起的主机任务 |
| Cloudflare 连接器 | `cloudflared-felis.service` | 仅在访问方式为 Cloudflare Tunnel 时存在 |

主机上的主要数据位置如下。各目录的大小和增长情况见[存储与磁盘](/operations/storage#disk-layout)。

| 路径 | 内容 |
| --- | --- |
| `/etc/felis` | 配置与机密：`felis.host.toml`（`felis.toml` 为指向它的链接）、`felis.pod.toml`、`secrets.env`、`offsite.env`、面板 TLS 证书与私钥、`host-settings.env`、隧道配置 `cloudflared.yml` |
| `/var/lib/felis` | 数据库集群（`postgres/`）、数据库备份包（`db-backups/`）、主机任务记录（`node-control/`）、看门狗状态（`watchdog/`）、支持包（`support/`） |
| `/var/lib/rancher/k3s` | k3s 数据、世界卷（`storage/`）、世界归档、镜像仓库和容器镜像 |
| `/opt/felis` | Velocity、Java 运行时和构建工具 |
| `/usr/local/bin/felis` | `felis` 命令，面板已内嵌其中 |

管理员 kubeconfig `/etc/rancher/k3s/k3s.yaml` 仅 root 可读，在主机上使用 `sudo k3s kubectl` 执行 kubectl 命令。

## 服务与定时任务 {#services}

除上表中的常驻服务外，安装器还设置以下定时任务：

| 单元 | 运行时间 | 作用 |
| --- | --- | --- |
| `felis-watchdog.timer` | 每 2 分钟一次，开机 3 分钟后首次运行 | 健康检查、告警邮件和外部心跳，见[看门狗](/operations/monitoring#watchdog) |
| `felis-watchdog-failed.service` | 看门狗运行失败时 | 报告看门狗自身的故障 |
| `felis-db-backup.timer` | 每天 `FELIS_DB_BACKUP_TIME`（默认 03:30，随机延迟最多 15 分钟）；错过时在开机后补执行 | 创建数据库备份包，见[数据库备份](/operations/backup#database-backups) |
| `felis-offsite.timer` | 每小时，仅在配置异地副本后存在 | 将备份加密复制到存储桶，见[异地副本](/operations/backup#offsite) |
| `felis-update-check.timer` | 每天约 05:30；错过时在开机后补执行 | 记录组件版本检查结果，见[组件版本](/operations/upgrade#component-versions) |
| `felis-build-tools.timer` | 每天 04:00 和 16:00 | 将 kaniko、Trivy 及其漏洞库复制到集群内镜像仓库，供镜像构建使用 |
| 世界清理 CronJob（k3s 内） | 每天 | 删除过期的世界备份；启用闲置世界回收时，还会归档并删除闲置的世界，见[世界清理](/operations/backup#world-cleanup) |

查看服务与定时任务的状态：

```bash
systemctl list-timers 'felis-*'
systemctl status k3s felis-velocity felis-node-control
sudo k3s kubectl -n felis get pods
```

面板「维护与备份 → 状态」的「服务与定时任务」部分显示相同的信息。

### 控制面重启期间 {#api-restarts}

felis-api 以单副本运行，更新策略为 Recreate：旧 Pod 停止后才启动新 Pod。重新运行安装器更新 API、节点重启或 Pod 崩溃时，API 在新 Pod 就绪前不可用，通常持续数秒。在此期间：

- 已在服务器中的玩家不受影响，游戏服务器继续运行。
- 离开登录空间或通过服务器地址进服的玩家，若 felis-api 在最近 10 分钟内确认过其账号关联，则允许进入；其他玩家会收到登录验证暂时不可用的提示。
- 登录空间对新登录最多重试 60 秒，并提示玩家正在重试，因此较短的重启只会延迟登录。
- 唤醒、停止服务器、`/link` 和面板操作等待 API 恢复。
- 若游戏代理在此期间重启，它按 `/opt/felis/velocity/plugins/felis-link/last-servers.json` 中缓存的服务器列表路由，直到每 15 秒一次的列表刷新成功。

API 中断较久时，代理日志依次出现 `server list refresh failed ... keeping current registrations` 和 `still failing: ...`，恢复后出现 `server list refresh recovered after ...`。看门狗在 `deployment/felis-api` 持续不可用 5 分钟后发送告警。

## 日常运维 {#routine-tasks}

| 任务 | 频率 | 位置 |
| --- | --- | --- |
| 查看平台状态、未解除的告警和磁盘占用 | 每天 | 仪表盘的「平台状态」栏；「维护与备份 → 状态」 |
| 确认告警邮件可以送达：已配置邮件中继，且所有者邮箱已验证 | 安装后一次，之后在变更邮件设置时 | [告警邮件](/operations/monitoring#alerts)、[邮件中继](/operations/monitoring#mail-relay) |
| 配置外部心跳，以便主机整体失联时收到通知 | 安装后一次 | [外部心跳](/operations/monitoring#heartbeat) |
| 配置异地副本，并将加密密钥保存在主机之外 | 安装后一次 | [异地副本](/operations/backup#offsite)、[加密密钥](/operations/backup#offsite-key) |
| 检查数据库备份和异地副本是否按时完成 | 每周，或依赖看门狗告警 | [数据库备份](/operations/backup#database-backups) |
| 查看可用更新，并在维护窗口内应用 | 每月或随发布版 | [升级](/operations/upgrade#update) |
| 在备用主机上演练整机重建 | 每个发布版一次 | [整机重建](/operations/backup#rebuild-host) |
| 具备主机权限的人员离开后轮换凭据 | 按需 | [轮换凭据](/operations/access#rotate-credentials) |
| 在审计记录超过保留期前导出 | 按保留期 | [导出审计日志](/operations/monitoring#audit-export) |

## 在面板中执行主机操作 {#panel-host-operations}

日常运行所需的主机操作，所有者可在管理控制台的「维护与备份」（`/admin/updates`）和「平台设置」（`/admin/platform`）中执行。面板将每项操作交给 `felis-node-control.service`，由该服务以 root 身份运行与命令行相同的 `felis` 命令或安装器步骤。felis-api 本身不具备特权。

### 任务规则 {#task-rules}

- 同一时刻只运行一项主机任务。前一项完成前，新的请求返回 `409 node_operation_busy`（`a host task is already running`），面板提示「主机正在执行其他任务，完成后方可操作。」
- 主机服务只接受固定的操作清单，并校验每项参数，不提供通用的命令执行。
- 会中断玩家或面板的操作须先确认。恢复数据库备份包须输入备份包名称；从异地副本重建须输入确认词「重建」。
- 每项任务和每次下载都需要重新验证身份（Passkey 或邮件验证码，验证结果有效 5 分钟），并以 `platform.host.*` 记入审计日志；节点操作记为 `platform.node.*`。
- 在面板中输入的密钥和令牌（存储桶密钥、异地加密密钥、Cloudflare API 令牌）只传给执行器，不会出现在任务记录、任务日志或 API 响应中。
- 每项任务的阶段、日志和结果在面板中持续可查，记录保存在 `/var/lib/felis/node-control`。面板连接中断不会终止任务。每项操作有各自的时限，从 1 分钟（启动异地复制）到 12 小时（整机重建）不等。
- 数据库恢复、整机重建、凭据轮换和更换域名运行期间，API 拒绝启动、维护或迁移服务器，与节点操作期间相同。

### 操作对照表 {#operation-table}

| 操作 | 面板位置 | 命令行 |
| --- | --- | --- |
| 主机状态：磁盘、内存、服务与定时任务、游戏代理 | 「维护与备份 → 状态」→「主机状态」 | `felis status` |
| 查看看门狗告警；计划维护期间暂停告警邮件 1、4 或 24 小时 | 「维护与备份 → 状态」→「主机状态」→「看门狗告警」：「暂停告警邮件」「恢复告警邮件」 | `/run/felis/watchdog-quiet-until` |
| 立即备份数据库 | 「维护与备份 → 备份」→「控制面数据库备份」→「立即备份」 | `felis db backup` |
| 校验、恢复和删除数据库备份包 | 「维护与备份 → 备份」→「本机数据库备份」→「校验」「恢复」、删除图标 | `felis db verify`、`felis db restore`、`felis db delete`、`felis migrate up` |
| 每日数据库备份时间和保留数量 | 「维护与备份 → 备份」→「本机数据库备份」→「每日备份计划」 | `FELIS_DB_BACKUP_TIME`、`FELIS_DB_BACKUP_KEEP`，重新运行安装器 |
| 立即备份世界，不停服或先停止服务器 | 「维护与备份 → 备份」→「立即备份世界」 | `felis backup-now` |
| 导出审计日志 | 「维护与备份 → 备份」→「导出审计日志」 | `felis db audit-export` |
| 配置、更换或关闭异地副本 | 「维护与备份 → 异地副本」→「配置」「更换存储桶」「关闭异地副本」 | `FELIS_OFFSITE_*`，重新运行安装器 |
| 立即复制；列出存储桶内容；校验密钥；接管存储桶 | 「维护与备份 → 异地副本」→「立即同步」「列出存储桶内容」「校验密钥」「接管存储桶」 | `systemctl start felis-offsite.service`、`felis offsite list`、`felis offsite check-key`、`felis offsite take-over` |
| 显示异地加密密钥 | 「维护与备份 → 异地副本」→「显示密钥」 | `/etc/felis/offsite.env` |
| 从异地副本重建本主机 | 「维护与备份 → 异地副本」→「从异地副本重建」 | `felis restore-host` |
| 健康检查 | 「维护与备份 → 诊断」→「健康检查」→「执行健康检查」 | `felis doctor` |
| 生成支持包并经浏览器下载 | 「维护与备份 → 诊断」→「支持包」→「生成支持包」 | `felis support-bundle` |
| 查看组件版本；设置维护窗口 | 「维护与备份 → 版本更新」→「组件版本」「配置维护窗口」 | `felis update`（只读检查）；维护窗口只能在面板中设置 |
| 访问方式：直接访问、自有反向代理、Cloudflare Tunnel | 「平台设置 → 访问与安全」→「访问方式与域名」→「应用访问方式」 | `felis setup` 的访问方式步骤 |
| 检查和更换根域名 | 「平台设置 → 访问与安全」→「访问方式与域名」→「根域名」：「检查当前域名」「更换域名」 | `felis domain check`、`felis domain set` |
| 上传存储：本机或兼容 S3 的存储桶 | 「平台设置 → 访问与安全」→「上传存储」→「应用存储设置」 | `felis setup` 的存储步骤 |
| 凭据轮换 | 「平台设置 → 访问与安全」→「凭据轮换」→「轮换」 | `felis rotate-token` |
| 游戏代理的内存上限 | 「平台设置 → 访问与安全」→「游戏代理」→「内存上限」「应用」 | `FELIS_VELOCITY_XMX`，重新运行安装器 |
| 系统服务器补全 | 「平台设置 → 访问与安全」→「系统服务器补全」→「执行补全」 | `felis converge`（勾选「为旧用户服务器启用 RCON」时为 `felis converge -user-rcon`） |
| 邮件中继 | 「平台设置 → 通知与保留」→「邮件服务」 | `felis setup` 的邮件步骤（`felis.toml` 中的 `[smtp]`） |
| 外部心跳地址 | 「平台设置 → 通知与保留」→「监控心跳」 | `FELIS_WATCHDOG_HEARTBEAT_URL`，重新运行安装器 |
| 服务器的转发方式 | 服务器控制台页 →「转发方式」 | MinecraftServer 上的 `felis.lolicon.best/forwarding` 标签 |
| 节点操作，包括主控高可用的浮动地址 | 「平台设置 → 分布式」→「节点操作」 | `felis node …`、`FELIS_HA_VIP*`，重新运行安装器 |

::: warning 注意
恢复数据库、整机重建、凭据轮换、更换域名、更改访问方式和上传存储都会重启面板或中断玩家连接。执行前阅读对应页面的说明，例如[恢复数据库](/operations/backup#restore-database)和[更换根域名](/operations/access#change-domain)。
:::

在面板中修改、由安装器管理的设置（数据库备份计划与保留数量、游戏代理内存上限）保存在 `/etc/felis/host-settings.env`。之后运行安装器或 `felis update` 时以其为默认值，因此所有者的选择在升级后保留；某次运行显式设置的环境变量仍然优先。面板以重新配置模式运行安装器来应用此类修改（`FELIS_INSTALL_MODE=reconfigure`，由 `FELIS_RECONFIGURE` 指定涉及的部分），只重写相应的单元。设置的优先级见[配置参考](/reference/configuration#panel-settings-precedence)。

仪表盘向所有者显示一行「平台状态」：未解除的告警、最新数据库备份、异地副本状态和剩余空间最少的磁盘，并链接到对应的标签页。

## 仅在命令行执行的操作 {#command-line-only}

以下操作不在面板中提供：

- **安装及重新运行安装器**，包括新主机的首次安装，以及使用 `FELIS_RESTORE_FROM_OFFSITE=1` 重建丢失的主机。面板在安装完成后才存在。
- **`felis setup`**：创建首位所有者。在此之前无人能够登录面板。
- **`felis breakGlass`**：在没有所有者能够登录时恢复访问，因此不依赖面板，见[应急访问](/operations/access#break-glass)。
- **版本变更**：`felis update --apply` 和为新发布版运行安装器。「版本更新」标签页报告可用版本并给出命令；应用新版本会替换面板和主机服务所运行的程序，见[升级](/operations/upgrade#update)。
- **卸载**，见[卸载与重装](/operations/uninstall#uninstall)。
- **由服务单元和安装器运行的命令**，例如 `felis api`、`felis operator`、`felis watchdog`、`felis ha leader` 和 `felis ha migrate-storage`。
- **主机操作服务本身**。`felis-node-control` 停止时，面板无法执行任何主机任务，须在主机上检查并重启：

```bash
systemctl status felis-node-control
journalctl -u felis-node-control -n 50 --no-pager
sudo systemctl restart felis-node-control
```

各命令的完整用法见[命令行参考](/reference/cli#status)。
