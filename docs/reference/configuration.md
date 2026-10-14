---
title: 配置参考
description: 安装器环境变量、felis.toml 的配置节与配置项、/etc/felis 下的文件，以及面板设置的优先级。
---

# 配置参考 {#configuration}

本页列出运维人员可在 Felis 主机上进行的全部设置：安装器读取的环境变量、`felis.toml` 的配置节与配置项、`/etc/felis` 下的文件，以及面板中保存的设置及其优先级。适用于安装、配置和维护主机的运维人员。

## 设置的存放位置 {#overview}

Felis 主机的配置分为三层：

- **安装器变量**（`FELIS_*`）：安装器每次运行时读取。其中多数会记录到所生成的文件中，之后的运行会保留其结果。
- **主机文件**：`/etc/felis` 下的配置文件 `felis.toml`，以及保存凭据和安装器记录的文件。
- **面板中保存的设置**：存放在数据库中。面板与主机文件配置同一项内容时，以面板的值为准，见[面板设置与优先级](#panel-settings-precedence)。

## 安装器变量 {#installer-variables}

### 传递变量 {#passing-variables}

将每个变量写在安装命令的 `sudo` 一行中：

```bash
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh \
  | sudo FELIS_VERSION_BOOTSTRAP=dev FELIS_VELOCITY_XMX=2G bash
```

`sudo` 会重置环境变量，在 `sudo` 之前 export 的变量不会传到安装器。应像上例一样写在 `sudo` 一行中，或先 export 再执行 `sudo -E bash`。

只在首次安装时生效、或之后的运行无需再次指定即可保留的变量，均在其说明中注明。重跑安装器会复用 `/etc/felis/secrets.env` 中生成的凭据，并保留已安装的根域名。

### 安装模式与渠道 {#install-source-variables}

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FELIS_INSTALL_MODE` | 在终端上询问，否则为 `full` | `full` 安装完整平台。`nano` 只安装 Felis-nano，即 Yggdrasil `hasJoined` 多路复用器，不含 k3s 和 PostgreSQL。在运行 Felis-nano 且未安装完整平台的主机上，默认值为 `nano`。 |
| `FELIS_VERSION_BOOTSTRAP` | `release` | `release` 从最新发布版的资产安装，每个资产都按该发布版的 `SHA256SUMS` 校验。`dev` 从源码构建 `main` 分支的最新提交。重跑时须再次指定渠道。 |
| `FELIS_RELEASE` | 最新发布版 | 指定一个已发布的版本标签（`v1.2.3`），以其资产代替最新版安装。应使用同一标签的安装器。这是回退到较早发布版的方式。 |
| `FELIS_REF` | — | 指定要从源码构建的分支、标签或提交，优先于渠道设置。 |
| `FELIS_ARTIFACT_DIR` | — | 存放某个发布版资产的目录的绝对路径。Felis 二进制、镜像和插件从该目录安装，不下载也不构建 Felis 自身的任何内容；文件缺失或校验不符时安装停止。不能与 `FELIS_REF` 或 `FELIS_SKIP_FETCH` 同时使用。 |
| `FELIS_SKIP_FETCH` | — | 直接构建 `/opt/felis/src` 中已有的源码树，不重新获取。 |
| `FELIS_REPO_URL` | `https://github.com/FelisMC/Felis.git` | 构建所用、以及查询发布版所用的 Git 仓库。 |
| `FELIS_GITHUB_TOKEN` | — | GitHub 令牌，仅在从私有 fork 安装时需要。属于密钥。 |
| `FELIS_FORCE_UPDATE` | — | 设为 `1` 时，即使版本相同也重新安装二进制。 |
| `FELIS_IMAGE` | `registry.felis.svc:5000/felis/felis:<version>` | 控制面镜像引用。集群内镜像仓库以外的镜像按原样使用，不会复制到镜像仓库。 |

另见[发布渠道](/guide/deployment#channels)和[使用预先下载的资产安装](/guide/deployment#offline-install)。

### 网络与域名 {#network-variables}

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FELIS_ROOT_DOMAIN` | `<node-ip>.nip.io` | 安装的根域名。仅首次安装生效：重跑时保留已安装的域名，指定不同的值会使安装停止。迁移域名使用 [`felis domain set`](/reference/cli#domain)。 |
| `FELIS_PANEL_NODEPORT` | `30443` | 内置 HTTPS 面板和 API 的 NodePort。 |
| `FELIS_GAME_PORT` | `25565` | 游戏代理接受玩家连接的端口。不是 `25565` 时，面板会在服务器地址中显示该端口。 |

另见[网络与端口](/guide/requirements#network)。

### 访问与 Cloudflare {#access-variables}

访问方式（直接访问、自有反向代理或 Cloudflare Tunnel 加 Access）没有对应的安装器变量，应在设置向导或「平台设置 → 访问与安全」中选择，见[访问方式](/operations/access#access-methods)。与 Cloudflare 相关的安装器变量用于控制 `cloudflared` 二进制：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FELIS_CLOUDFLARED_VERSION` | `2026.9.1` | 主机上没有 cloudflared 时安装的版本。已安装的 cloudflared 只在 `FELIS_UPGRADE_DEPS=1` 时更新到该版本。 |
| `FELIS_CLOUDFLARED_SHA256` | 默认版本已固定 | 该版本在本机架构下的 sha256。使用其他版本时必须提供。 |

### 组件版本 {#component-variables}

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FELIS_K3S_VERSION` | `v1.36.4+k3s1` | 全新安装时使用的 k3s 版本。已安装的 k3s 保持不变，`FELIS_UPGRADE_DEPS=1` 时除外。 |
| `FELIS_UPGRADE_DEPS` | `0` | 设为 `1` 时，将已安装的 k3s 和 cloudflared 更新到固定版本（k3s 每次只升一个次版本，且从不降级），并让 `cloudflared-felis` 以新二进制重启。 |
| `FELIS_JRE_VERSION` | `25` | 游戏代理所用的 Temurin 主版本。默认版本的构建和摘要已固定；其他主版本按 Adoptium 发布的摘要校验。 |
| `FELIS_GO_VERSION` | `1.27.2` | 构建 Felis-nano 二进制所用的 Go 工具链版本。 |
| `FELIS_GO_SHA256` | 默认版本已固定 | 该 Go 版本在本机架构下的 sha256。使用其他版本时必须提供。 |

另见[组件版本](/operations/upgrade#component-versions)。

### 存储与备份 {#storage-variables}

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FELIS_BACKUP_PVC` | `felis-backups` | 世界归档卷。设为空值会禁用世界备份，备份接口随之返回 503。 |
| `FELIS_ARCHIVE_LOCAL_PATH` | `/var/lib/felis/archives` | 该卷在备份 Job 中的挂载路径，写入 `[archive] local_path`。 |
| `FELIS_WORLDS_HOST_PATH` | 未设置 | 存放世界卷的节点目录（安装器部署的 k3s 上为 `/var/lib/rancher/k3s/storage`）。设置后，每日运行的 reaper 还会先归档、再删除空闲 15 天的世界；未设置时从不删除世界，reaper 只移除过期备份。见[世界清理](/operations/backup#world-cleanup)。 |
| `FELIS_REGISTRY_STORAGE` | `10Gi` | 镜像仓库卷申请的容量。仅首次安装生效；k3s local-path 存储不强制该容量。 |
| `FELIS_UPLOADS_STORAGE` | `5Gi` | 上传卷申请的容量。仅首次安装生效，不强制。 |
| `FELIS_BACKUP_STORAGE` | `10Gi` | 世界归档卷申请的容量。仅首次安装生效，不强制。 |
| `FELIS_DB_BACKUP_DIR` | `/var/lib/felis/db-backups` | 数据库备份包目录。 |
| `FELIS_DB_BACKUP_TIME` | `*-*-* 03:30:00` | 每日数据库备份的 systemd 日历表达式，定时器另加最多 15 分钟的随机延迟。可在面板中设置。 |
| `FELIS_DB_BACKUP_KEEP` | `14` | 保留的每日备份包数量。可在面板中设置。 |
| `FELIS_DB_BACKUP_METRICS` | `/var/lib/node_exporter/textfile_collector/felis_db_backup.prom` | 每次每日备份后重写的 node-exporter 文本文件。 |
| `FELIS_PRE_MIGRATE_BACKUP` | `1` | 设为 `0` 时，应用待执行迁移前不创建迁移前备份包。仅在无法创建该备份包且另有备份时使用。 |

另见[数据库备份包](/operations/backup#database-backups)和[磁盘布局](/operations/storage#disk-layout)。

### 异地副本 {#offsite-variables}

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FELIS_OFFSITE_ENDPOINT` | — | S3 兼容存储的 `https://host[:port]`。指定存储桶时必须提供。 |
| `FELIS_OFFSITE_BUCKET` | — | 存储桶名称。设置后即启用异地副本。 |
| `FELIS_OFFSITE_REGION` | — | 存储桶所在区域。 |
| `FELIS_OFFSITE_PREFIX` | — | 对象键前缀，使一个存储桶可存放多个安装的副本。 |
| `FELIS_OFFSITE_DB_KEEP` | `30` | 存储桶中保留的最新数据库备份包数量。 |
| `FELIS_OFFSITE_ACCESS_KEY` | — | 存储桶访问密钥。属于密钥，保存在 `/etc/felis/offsite.env`。 |
| `FELIS_OFFSITE_SECRET_KEY` | — | 存储桶私有密钥。属于密钥，保存在 `/etc/felis/offsite.env`。 |
| `FELIS_OFFSITE_KEY` | 自动生成 | 加密密钥，格式同 `felis offsite keygen` 的输出。属于密钥。不存在时由安装器生成，并只在终端显示一次。重跑时如提供与 `offsite.env` 中不同的密钥，安装器会拒绝。 |
| `FELIS_RESTORE_FROM_OFFSITE` | — | 设为 `1` 时，安装完成后运行 `felis restore-host`，从异地副本重建这台新主机。需要同时提供 `FELIS_OFFSITE_ENDPOINT`、`FELIS_OFFSITE_BUCKET`、`FELIS_OFFSITE_ACCESS_KEY`、`FELIS_OFFSITE_SECRET_KEY` 和 `FELIS_OFFSITE_KEY`。 |
| `FELIS_RESTORE_BUNDLE` | 最新备份包 | 用于重建的备份包名称（`felis-db-<stamp>-<label>.tar`），取自 `felis offsite list`。 |
| `FELIS_RESTORE_TAKE_OVER` | — | 设为 `1` 时，重建完成后由本机写入存储桶。在演练机上不要设置。 |

这些值不能包含引号、反斜杠或换行。重跑时不提供这些变量，则保留现有的 `[offsite]` 配置节和 `offsite.env`。另见[异地副本](/operations/backup#offsite)和[加密密钥](/operations/backup#offsite-key)。

::: danger
`FELIS_OFFSITE_KEY` 应保存在本主机以外的地方。没有它，存储桶中的任何内容都无法读取。
:::

### 游戏组件与代理 {#game-stack-variables}

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FELIS_GAME_STACK` | `pinned` | `pinned` 安装发布版固定的 Limbo、Paper、LuckPerms 和 Velocity 构建，每个都按其 sha256 校验。`latest` 每次运行都解析上游的最新构建，并在主机上构建游戏镜像。 |
| `FELIS_VELOCITY_VERSION` | 固定版本 | 指定其他 Velocity 版本时，安装该版本的最新构建。 |
| `FELIS_VELOCITY_XMX` | `1G` | 游戏代理的最大堆内存，格式为 `<n>M` 或 `<n>G`，最小 `256M`。每次运行都会读取；修改会重启代理，所有玩家断开连接。可在面板中设置。 |
| `FELIS_VELOCITY_FORK_JAR` | — | Felis-Legacy Velocity fork 构建的路径，用于代替官方 Velocity 作为代理安装。 |
| `FELIS_VELOCITY_FORK_JAR_SHA256` | — | 该 jar 的 sha256。设置 jar 时必须提供；不一致时安装停止。 |
| `FELIS_LEGACY_FORWARDING_SERVERS` | `legacy18` | 以逗号分隔的服务器列表，这些服务器始终通过握手地址接收玩家身份；设为旧式转发的服务器另外加入。见[转发方式](/guide/servers#forwarding-mode)。 |
| `FELIS_LIMBO_IMAGE`、`FELIS_LOBBY_IMAGE`、`FELIS_PAPER_IMAGE` | `registry.felis.svc:5000/felis/limbo:demo`、`…/lobby:demo`、`…/paper:demo` | 登录空间、大厅和 Paper 基础镜像的引用。 |
| `FELIS_NANO_LISTEN` | 已安装的 felis-nano 所用地址，否则为 `127.0.0.1:8081` | Felis-nano 的监听地址。如需为其他主机上的代理提供服务，设为内网地址。 |
| `FELIS_NANO_PROXY_CIDR` | — | 允许访问非回环地址上的 Felis-nano 的代理，以带前缀长度的地址表示（例如 `10.0.0.7/32`）。主机防火墙只对该来源开放端口。 |

代理堆内存的规划见[容量规划](/guide/requirements#sizing)。

### 监控 {#monitoring-variables}

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FELIS_WATCHDOG_HEARTBEAT_URL` | — | 看门狗每次运行时访问的心跳地址，写入 `/etc/felis/watchdog-heartbeat-url`（权限 0600）。设为 `off` 时删除该文件；重跑时不提供此变量则保留。应视为密钥：地址的路径就是该检查的密钥。面板中保存的心跳优先。 |

另见[外部心跳](/operations/monitoring#heartbeat)。

### 分布式与高可用 {#distributed-variables}

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FELIS_DISTRIBUTED` | `0`；重跑时自动识别已有的分布式主控节点 | 设为 `1` 时在主控节点上启用分布式模式。 |
| `FELIS_NODE_EXTERNAL_IP` | — | 本节点固定的外部地址。 |
| `FELIS_PEER_CIDRS` | 上次安装的列表 | 以逗号分隔的精确对等地址（`/32` 或 `/128`）。重跑时不提供则保留 `/etc/felis/node-peers` 中的列表。 |
| `FELIS_CONTROLLER_HA` | — | 设为 `1` 时启用主控高可用，须同时设置 `FELIS_DISTRIBUTED=1`。之后的运行通过 `/etc/felis/ha.env` 保持该设置。 |
| `FELIS_HA_VIP` | — | 可选的 IPv4 浮动地址，带前缀长度，例如 `192.0.2.50/24`。 |
| `FELIS_HA_VIP_INTERFACE` | 承载节点地址的网络接口 | 浮动地址所在的网络接口。 |
| `FELIS_HA_VRID` | `51` | VRRP 虚拟路由器 ID，范围 1–255。 |
| `FELIS_LONGHORN_VERSION` | `v1.8.1` | 为副本存储安装的 Longhorn 版本。 |

安装器的工作节点、主控加入和重新配置模式由 [`felis node`](/reference/cli#node)、节点操作和面板启动，这些模式所需的变量由它们自行设置。另见[多机部署与高可用](/guide/distributed#overview)。

### 预检与设置 {#preflight-variables}

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FELIS_PREFLIGHT` | `strict` | `strict` 在发现任何预检问题时停止，并列出全部问题。`warn` 只报告问题并继续安装，用于预检判断有误的主机。 |
| `FELIS_NO_SETUP` | — | 设为 `1` 时，完整安装在输出汇总后结束。未设置时，在终端上运行且尚无所有者的安装会接着进入 `felis setup`。 |
| `FELIS_MANAGE_TIME_SYNC` | `1` | 设为 `0` 时不管理主机时钟。默认情况下安装器启用 NTP（无其他可用方式时安装 chrony），并等待时钟同步。 |
| `FELIS_MANAGE_JOURNAL` | `1` | 设为 `0` 时不管理 journald。默认情况下安装器将系统日志设为持久保存。 |
| `FELIS_JOURNAL_MAX_USE` | `1G` | 持久日志的容量上限，格式为 `<n>K`、`<n>M` 或 `<n>G`。 |
| `PKG_LOCK_TIMEOUT` | `900` | 等待软件包管理器锁的秒数。 |

另见[安装前检查](/guide/requirements#preflight)。

## felis.toml {#felis-toml}

平台配置是一个 TOML 文件，由安装器写入两份：

- `/etc/felis/felis.host.toml`：主机副本，供主机上的命令读取，通过回环端口连接数据库。
- `/etc/felis/felis.pod.toml`：Pod 副本，保存在 `felis-config` Secret 中，供控制面读取。

`/etc/felis/felis.toml` 是指向主机副本的链接，也是所有 `felis` 命令 `-config` 参数的默认值。

### 编辑规则 {#editing-rules}

- 安装器每次运行都会重新生成两份副本，并保留运维人员可编辑的配置节和配置项：`[auth]`、`[smtp]`、`[[auth_source]]`、`[offsite]`，以及下文列出的 `[registry]`、`[registry.s3]` 和 `[archive]` 中由运维人员设置的配置项。其他修改都会被覆盖。
- 修改设置时，编辑 `/etc/felis/felis.host.toml`，然后重跑安装器，由它将修改同步到 Pod 副本并使之生效。
- 不接受未知配置项。拼写错误的配置项会使所有读取该文件的命令停止，并报告 `config: unknown keys in <file>: <key>`。
- 时间跨度写作 `90d`（天）、`3mo`（每月按 30 天计）或 `12h`、`10m` 等时长。容量使用 `Gi`、`Mi`、`Ki`、`G`、`M`、`K` 后缀，或直接写字节数。
- `[database] url` 中包含数据库密码，因此两份副本都仅 root 可读。其他凭据都不写入该文件：以 `_ref` 结尾的配置项指定保存凭据值的环境变量名。

### [auth] {#auth}

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `panel_hostname` | `console.<root domain>` | 面板的主机名。 |
| `admin_hostname` | `op.console.<root domain>` | 管理控制台的主机名。 |
| `access_jwt_aud` | — | Cloudflare Access 应用的 audience，由 `felis setup` 的 Cloudflare 步骤写入。设置后，访问者地址从 `CF-Connecting-IP` 读取。 |
| `client_ip_header` | — | 边缘写入访问者地址的请求头：经 Cloudflare 隧道时为 `CF-Connecting-IP`，经自有反向代理时为 `X-Forwarded-For`。按客户端计算的登录限流依据该地址。留空时使用连接本身的地址；设置了 `access_jwt_aud` 时使用 `CF-Connecting-IP`。 |

这些配置项由 `felis setup` 和面板中的访问方式修改写入。`felis domain set` 会迁移采用默认名称的主机名，手动设置的主机名保持不变。

### [smtp] {#smtp}

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `host` | — | 邮件中继主机。没有中继时不发送登录验证码，只能使用 Passkey 登录。 |
| `port` | `587` | `587` 使用 STARTTLS；`465` 使用隐式 TLS。 |
| `from` | — | 发件地址。设置了 `host` 时必须提供。 |
| `username` | — | 认证用户名。留空表示中继无需认证。 |
| `password_ref` | `FELIS_SMTP_PASSWORD`（由 `felis setup` 写入） | 保存中继密码的环境变量名。密码本身保存在 `/etc/felis/smtp-password` 和 `felis-smtp` Secret 中。 |
| `max_per_hour` | `120` | API 每小时发送邮件的全局上限，应不高于中继自身的限额。 |
| `require_tls` | 开启；中继位于本机时关闭 | 中继端口不是 465 且不提供 STARTTLS 时拒绝发送。 |

在「平台设置 → 通知与保留 → 邮件服务」中保存的中继优先于 `[smtp]`。另见[邮件中继](/operations/monitoring#mail-relay)。

### [[auth_source]] {#auth-source}

每个 `[[auth_source]]` 表对应一个第三方 Yggdrasil 认证源。Mojang 为内置认证源，始终最先校验；其余认证源按书写顺序依次校验。全新安装默认包含 LittleSkin。

| 配置项 | 说明 |
| --- | --- |
| `tag` | 该认证源玩家 UUID 的永久命名空间。须唯一，不能包含 `:`，不能为 `mojang`。修改它（包括只改大小写）会使该认证源的所有玩家获得新的 UUID。 |
| `prefix` | 1–4 个字母或数字，不区分大小写时须唯一。玩家名与某个 Mojang 账户重名时加在名称前，例如 `LS_steve`。 |
| `url` | 完整的 `hasJoined` 地址。须使用 `https://`；仅 localhost、回环地址或内网 IP 可使用 `http://`。不能包含查询字符串或片段。 |
| `api_url` | 可选的 API 根地址，用于 `hasJoined` 路径不标准的认证源，供按名称或 UUID 查询角色时使用。 |

```toml
[[auth_source]]
tag = "littleskin"
prefix = "LS"
url = "https://littleskin.cn/api/yggdrasil/sessionserver/session/minecraft/hasJoined"
```

面板的「平台 → 认证源」页面首次使用时会导入此列表。所有者在该页面保存列表后，以面板中的列表为准。Felis-nano 始终读取 `felis.toml`。另见[认证源](/guide/players#auth-sources)。

### [offsite] {#offsite}

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `endpoint` | — | 存储服务的 `https://host[:port]`，不含路径。仅可信网络中的存储可使用 `http://`。 |
| `bucket` | — | 存储桶名称。未设置即不启用异地副本。 |
| `region` | — | 存储桶所在区域。 |
| `prefix` | — | 对象键前缀，不能包含 `..`。 |
| `access_key_ref` | `FELIS_OFFSITE_ACCESS_KEY` | 保存访问密钥的环境变量名。 |
| `secret_key_ref` | `FELIS_OFFSITE_SECRET_KEY` | 保存私有密钥的环境变量名。 |
| `key_ref` | `FELIS_OFFSITE_KEY` | 保存加密密钥的环境变量名。 |
| `db_keep` | `30` | 存储桶中保留的最新数据库备份包数量。 |

安装器根据 `FELIS_OFFSITE_*` 变量写入该配置节，并将密钥保存在 `/etc/felis/offsite.env`。更换存储桶时，编辑该配置节（更换凭据时同时编辑 `offsite.env`）并重跑安装器。关闭异地副本时，删除该配置节并重跑安装器。面板的「维护与备份 → 异地副本」可完成相同操作。

### [archive] {#archive}

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `retention` | `90d` | 已移除世界（因空闲被回收、被释放或被删除）的归档保留时长。 |
| `warn_before` | `["3d", "1d"]` | 空闲世界被回收前多久向其所有者发送提醒邮件。启用世界清理时，世界在空闲 15 天后被回收。 |
| `max_local_bytes` | 无上限 | 备份存储的软上限，例如 `"50Gi"`。达到上限时，所有者备份和定时恢复点暂停，reaper 提前移除最早的所有者备份和已有异地副本的备份。 |
| `manual_retention` | `30d` | 所有者备份的保留时长。 |
| `manual_keep` | `5` | 每台服务器保留的所有者备份数量，超出时先删除最早的。 |
| `manual_cooldown` | `10m` | 同一台服务器两次所有者备份之间的最短间隔。管理员不受此限制。 |
| `scheduled_every` | `1d` | 为自上次恢复点以来有人游玩的世界创建恢复点的间隔。`"0s"` 表示关闭。 |
| `scheduled_keep` | `7` | 每台服务器保留的恢复点数量。 |
| `scheduled_retention` | `90d` | 每个恢复点的保留时长。 |

面板中的「备份与审计保留」卡片会覆盖本表中除 `warn_before` 以外的全部配置项。另见[世界备份](/operations/backup#world-backups)和[每日恢复点](/operations/backup#restore-points)。

### [audit] {#audit}

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `retention` | `365d` | 审计记录的保留时长。`"forever"` 表示保留全部记录；最短为 `30d`。需要保留更久的记录应先用 `felis db audit-export` 导出。 |

面板中的「备份与审计保留」卡片会覆盖该配置项。另见[审计日志](/guide/administration#audit-log)。

### [registry] {#registry}

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `user_uploads_context` | 由存储步骤设置 | 上传的构建上下文的存放位置：本地磁盘为 `/var/lib/felis/uploads`，或为 `s3://<bucket>[/<prefix>]`。由 `felis setup` 的存储步骤或面板的「上传存储」卡片写入。 |
| `user_uploads_max_bytes` | `4Gi` | 所有用户上传上下文的总容量。每个用户另有 2 GiB 的额度。 |
| `context_max_bytes` | `1Gi` | 单个构建上下文的最大容量。 |
| `max_concurrent_builds` | `2` | 同时运行的构建数量，范围 1–6，超出的构建排队。 |
| `build_cpu_limit` | `2` | 每个构建容器的 CPU 上限。 |
| `build_mem_limit` | `4Gi` | 每个构建容器的内存上限。 |
| `build_disk_limit` | `12Gi` | 构建 Pod 的临时存储上限。 |
| `build_user_namespaces` | `auto` | 是否在用户命名空间中运行构建 Pod：`auto` 在 felis-api 启动时确认节点支持后启用，`on` 始终启用，`off` 始终不启用。 |
| `build_runtime_class` | — | 构建 Pod 使用的 RuntimeClass，例如 gVisor 或 Kata。留空时使用节点的默认运行时。 |
| `scan_fail_on` | `["CRITICAL"]` | 阻止镜像通过的漏洞级别：`CRITICAL`、`HIGH`、`MEDIUM`、`LOW`、`UNKNOWN`。 |
| `scan_fail_unfixed` | `false` | 同时阻止尚无修复版本的漏洞。 |
| `scan_accept` | — | 作为已知风险接受的漏洞 ID 和密钥规则 ID。它们仍列在扫描结果中，但不会阻止镜像。 |
| `kaniko_image`、`trivy_image` | 集群内镜像仓库中的副本 | 构建和扫描工具的镜像。仅在需要使用其他工具构建时设置。 |
| `trivy_db_repository` | `<registry>/mirror/trivy-db:2` | 漏洞数据库所在的仓库。 |
| `trivy_java_db_repository` | `<registry>/mirror/trivy-java-db:1` | Java 数据库所在的仓库。 |

另见[上传存储](/operations/storage#upload-storage)和[构建流水线与审核提交](/guide/administration#submissions)。

### [registry.s3] {#registry-s3}

`user_uploads_context` 为 `s3://` 位置时使用。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `endpoint` | — | S3 兼容存储的地址。 |
| `region` | — | 存储所在区域。 |
| `access_key_ref` | `FELIS_UPLOADS_S3_ACCESS_KEY`（由存储步骤写入） | 保存访问密钥的环境变量名。 |
| `secret_key_ref` | `FELIS_UPLOADS_S3_SECRET_KEY`（由存储步骤写入） | 保存私有密钥的环境变量名。 |

密钥本身保存在 `/etc/felis/uploads-s3-access-key`、`/etc/felis/uploads-s3-secret-key` 和 `felis-uploads-s3` Secret 中。

### 由安装器管理的配置项 {#installer-owned}

以下配置项由安装器在每次运行时设置。如需修改，使用此处列出的安装器变量或命令。

| 配置节 | 配置项 | 取值 |
| --- | --- | --- |
| `[server]` | `listen` | `0.0.0.0:8080`。 |
| `[server]` | `root_domain` | 根域名。使用 [`felis domain set`](/reference/cli#domain) 修改。 |
| `[database]` | `url` | 连接地址，包含数据库密码。使用 [`felis rotate-token db`](/reference/cli#rotate-token) 更换密码。 |
| `[database]` | `deployment` | `felis/felis-postgres`，仅主机副本包含：`felis db` 在该 Pod 中运行 PostgreSQL 工具。 |
| `[k8s]` | `namespace` | `minecraft`，游戏服务器所在的命名空间。 |
| `[velocity]` | `login_image`、`lobby_image` | 登录空间和大厅的镜像（`FELIS_LIMBO_IMAGE`、`FELIS_LOBBY_IMAGE`）。 |
| `[velocity]` | `game_port` | `FELIS_GAME_PORT`。 |
| `[velocity]` | `game_version` | 登录空间和大厅镜像构建时对应的 Minecraft Java 版版本。面板据此显示玩家所需的客户端版本；为空时显示为未知。 |
| `[registry]` | `url`、`build_namespace` | `registry.felis.svc:5000` 和 `felis-build`。 |
| `[archive]` | `store`、`local_path` | `tarLocal`（唯一支持的存储方式）和 `FELIS_ARCHIVE_LOCAL_PATH`。 |

## 主机文件 {#host-files}

### /etc/felis 下的文件 {#etc-felis}

`/etc/felis` 仅 root 可读。每个数据库备份包都包含其中文件的副本，`bootstrap.done` 除外。

| 文件 | 内容 | 写入者 | 是否为密钥 |
| --- | --- | --- | --- |
| `felis.host.toml` | 配置的主机副本，编辑可保留的配置节时修改此文件。 | 安装器 | 包含数据库密码 |
| `felis.toml` | 指向 `felis.host.toml` 的链接，所有命令 `-config` 的默认值。 | 安装器 | — |
| `felis.pod.toml` | 配置的 Pod 副本，保存在 `felis-config` Secret 中，每次运行都重新生成。 | 安装器 | 包含数据库密码 |
| `secrets.env` | 生成的凭据：数据库密码，游戏代理、登录空间、构建和运维操作访问内部 API 的令牌，Velocity 转发密钥，以及镜像仓库写入令牌。每次重跑都复用。 | 安装器、`felis rotate-token` | 是 |
| `offsite.env` | 异地副本的存储桶凭据和加密密钥，权限 0600。 | 安装器、面板 | 是 |
| `smtp-password` | 邮件中继密码。 | `felis setup` | 是 |
| `uploads-s3-access-key`、`uploads-s3-secret-key` | 上传存储桶的凭据。 | `felis setup`、面板 | 是 |
| `watchdog-heartbeat-url` | 心跳地址，权限 0600。 | 安装器 | 是：路径即该检查的密钥 |
| `host-settings.env` | 在面板中保存的安装器设置：`FELIS_DB_BACKUP_TIME`、`FELIS_DB_BACKUP_KEEP`、`FELIS_VELOCITY_XMX`。 | 面板 | — |
| `panel-tls.crt`、`panel-tls.key` | 面板的 TLS 证书和私钥。安装器签发有效期 825 天的自签名证书。 | 安装器、`felis domain set` | 私钥是 |
| `cloudflared.yml` | Cloudflare 隧道配置。 | `felis setup` 的 Cloudflare 步骤、面板 | — |
| `ha.env` | 主控高可用设置，供之后的安装器运行和更新沿用。 | 安装器 | — |
| `ha-vrrp-pass` | 浮动地址的 VRRP 密码。 | 安装器 | 是 |
| `node-peers` | `felis node firewall` 最近一次安装的对等地址列表。 | `felis node firewall` | — |
| `node-firewall.sh`、`control-firewall.sh` | 主机隔离防火墙脚本。 | `felis node firewall` | — |
| `archive-transfer.key` | 分布式模式下节点间传输归档所用的密钥。 | 安装器 | 是 |
| `bootstrap.done` | 标记安装已完成。 | 安装器 | — |
| `system-server-images`、`velocity.fingerprint`、`previous-felis-image` | 安装器的记录：登录空间和大厅的构建、游戏代理上次启动所依据的内容，以及用于回退的上一个控制面镜像。 | 安装器 | — |

::: danger
标记为密钥的文件以及每个数据库备份包都可用于完全控制本安装。切勿将其复制到不可信的位置，也切勿把其内容粘贴到求助信息中；[`felis support-bundle`](/reference/cli#support-bundle) 会自动移除这些值。
:::

卸载时默认保留 `/etc/felis`，指定 `--purge` 时一并删除，见[卸载](/operations/uninstall#uninstall)。

### 其他主机路径 {#other-paths}

| 路径 | 内容 |
| --- | --- |
| `/run/felis/watchdog-quiet-until` | Unix 时间戳，在此之前看门狗不发送邮件，也不发送失败心跳。安装器在有意重启服务时写入；在面板中暂停告警时也会写入。见[暂停告警邮件](/operations/monitoring#hold-alerts)。 |
| `/var/lib/felis/watchdog/state.json` | 看门狗在两次运行之间保存的状态，仅 root 可读，其中缓存了中继密码。 |
| `/var/lib/felis/db-backups` | 数据库备份包（`FELIS_DB_BACKUP_DIR`）。 |
| `/var/lib/felis/postgres` | felis-postgres 的数据库集群。 |
| `/var/lib/felis/offsite/status.json` | 最近一次异地复制的结果，供 `felis offsite status` 和看门狗读取。 |
| `/var/lib/felis/offsite/host-id` | 本机作为存储桶写入者的 ID，不包含在任何备份包中。 |
| `/var/lib/felis/restore-host` | `felis restore-host` 取回的备份包和进度记录。 |
| `/var/lib/felis/support` | 支持包。 |
| `/var/lib/felis/node-control` | 从面板启动的主机任务和节点操作的记录。 |
| `/opt/felis/velocity/plugins/felis-link/felis-link.properties` | 游戏代理 Felis 插件的设置，包含其访问内部 API 的令牌。属于密钥。 |
| `/opt/felis/velocity/forwarding.secret` | 游戏代理的转发密钥。属于密钥。 |
| `/etc/rancher/k3s/k3s.yaml` | k3s 管理员 kubeconfig，仅 root 可读。使用 `sudo k3s kubectl`。 |

## 面板设置与优先级 {#panel-settings-precedence}

所有者可在面板中修改若干主机设置。以下规则决定实际生效的值。

### 面板值优先于主机文件 {#panel-overrides}

在面板中保存的设置优先于 `felis.toml` 或主机文件中的同一设置。所有使用该设置的进程都从数据库读取面板中的值。移除面板中的值后，主机上的值重新生效。

| 设置 | 面板位置 | 覆盖的内容 | 恢复为主机值 |
| --- | --- | --- | --- |
| 邮件中继 | 「平台设置 → 通知与保留 → 邮件服务」 | `[smtp]` | 「恢复为安装时的设置」 |
| 心跳 | 「平台设置 → 通知与保留 → 监控心跳」 | `/etc/felis/watchdog-heartbeat-url` | 「移除心跳地址」 |
| 备份与审计保留 | 「平台设置 → 通知与保留 → 备份与审计保留」 | `[archive]` 的 `retention`、`max_local_bytes`、`manual_*`、`scheduled_*`；`[audit] retention` | 「恢复为安装时设置」 |
| 认证源 | 「平台 → 认证源」 | `[[auth_source]]` | — |

- 邮件中继立即生效，无需重启，适用于 felis-api、看门狗、reaper 的提醒邮件和应急控制台的验证码。
- 保留设置在 felis-api 中立即生效，在备份 Job 和 reaper 中于下次运行时生效。
- 心跳在看门狗下次运行时生效。
- 认证源在下次游戏登录和角色查询时生效，无需重启。Felis-nano 继续读取 `felis.toml` 中的 `[[auth_source]]`。

### 在面板中保存的安装器设置 {#host-settings}

部分设置属于安装器，但可在面板中修改。面板将其保存在 `/etc/felis/host-settings.env`，并只针对受影响的 unit 运行安装器来应用修改。

| 设置 | 面板位置 | 安装器变量 |
| --- | --- | --- |
| 每日备份时间 | 「维护与备份 → 备份 → 每日备份计划」 | `FELIS_DB_BACKUP_TIME` |
| 保留的每日备份数 | 「维护与备份 → 备份 → 每日备份计划」 | `FELIS_DB_BACKUP_KEEP` |
| 游戏代理内存上限 | 「平台设置 → 访问与安全 → 游戏代理」 | `FELIS_VELOCITY_XMX` |

之后每次运行安装器和 `felis update` 都以这些值为默认值，因此所有者的选择在升级后保留。在某次安装器运行中显式指定的变量只对该次运行优先，且不会修改 `host-settings.env`：

```bash
# host-settings.env 中为 FELIS_VELOCITY_XMX=2G。本次运行使用 3G，之后的运行重新使用 2G。
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh \
  | sudo FELIS_VELOCITY_XMX=3G bash
```

::: warning
保存每日备份计划时会立即执行一次备份。修改代理内存上限（无论通过面板还是安装器）都会重启游戏代理，所有玩家断开连接。
:::

### 面板写入主机文件的修改 {#panel-host-writes}

面板中的主机操作与命令行写入相同的文件，因此以最近一次修改为准，无论修改来自何处：

- 访问方式（`[auth]`、`cloudflared.yml`），等同于 `felis setup` 的连接步骤；
- 上传存储（`[registry]`、`[registry.s3]` 和上传存储桶的密钥文件），等同于 `felis setup` 的存储步骤；
- 根域名，通过 `felis domain set`；
- 异地副本（`[offsite]` 和 `offsite.env`），等同于带 `FELIS_OFFSITE_*` 运行安装器；
- 凭据轮换，通过 `felis rotate-token`。

部分设置只存在于面板中，没有对应的文件或变量：玩家进入策略、启动与唤醒策略、故障切换，以及 `felis update --apply` 检查的维护窗口。另见[平台设置](/guide/administration#platform-settings)和[维护窗口](/operations/upgrade#maintenance-window)。

### 优先级顺序 {#precedence-order}

对于[面板值优先于主机文件](#panel-overrides)中列出的设置，优先级从高到低为：

1. 面板中保存的值。
2. `felis.toml` 或主机文件中的值。
3. 内置默认值。

对于[在面板中保存的安装器设置](#host-settings)，优先级从高到低为：

1. 本次安装器运行中显式指定的变量。
2. 面板中保存的值，存放在 `/etc/felis/host-settings.env`。
3. 安装器的默认值。
