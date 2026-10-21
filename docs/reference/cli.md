---
title: 命令行参考
description: 面向运维人员的全部 felis 子命令：用法、主要参数、所需权限及其影响。
---

# 命令行参考 {#cli}

本页说明运维人员在 Felis 主机上使用的 `felis` 子命令：各命令的作用、用法、主要参数及默认值、是否需要 root，以及会更改或重启哪些组件。需要组合多条命令的操作步骤见各条目链接的运维页面。

## 通用约定 {#conventions}

- 安装器将二进制安装到 `/usr/local/bin/felis`。`felis -h` 列出全部子命令，`felis <command> -h` 显示单个命令的参数。
- 参数可使用一个或两个短横线：`-yes` 与 `--yes` 等价。参数写在子命令及其动词之后，例如 `felis db restore -yes <bundle>`。
- 多数命令需要读取 `/etc/felis`、`/var/lib/felis` 下仅 root 可读的状态或 k3s 管理员 kubeconfig，须以 `sudo` 运行。需要 root 的命令以其他用户运行时会给出提示并以状态码 1 退出。
- 会中断玩家或替换数据的命令先输出执行计划，加上 `-yes` 后才实际更改：`backup-now`、`restore-host`、`rotate-token`、`domain set` 和 `offsite take-over`。`db restore` 未加 `-yes` 时只输出备份包内容并停止。
- `-config` 默认为 `/etc/felis/felis.toml`，它是指向 `/etc/felis/felis.host.toml` 的链接，见[主机文件](/reference/configuration#host-files)。
- 退出状态：成功为 0；失败或检查发现问题为 1；用法错误为 2。使用其他状态码的命令在条目中单独列出。
- 所有者可在面板中执行其中许多操作。面板将操作交给 `felis-node-control.service`，由它运行相同的命令，见[在面板中执行主机操作](/operations/#panel-host-operations)。

::: tip 提示
部分发行版的 `sudo` 使用的 `secure_path` 不含 `/usr/local/bin`。如 `sudo felis` 提示 `command not found`，改为执行 `sudo /usr/local/bin/felis …`。
:::

## 命令一览 {#overview}

| 命令 | 用途 | root | 面板对应位置 |
| --- | --- | --- | --- |
| [`felis setup`](#setup) | 必要时安装主机，配置访问方式和上传存储，创建首位所有者 | 是 | 部分功能：「平台设置 → 访问与安全」 |
| [`felis breakGlass`](#break-glass) | 无所有者能够登录时使用的应急控制台 | 是 | 无 |
| [`felis version`](#version) | 显示二进制版本 | 否 | 无 |
| [`felis start`](#start) | 按顺序启动本主机设为开机启动的全部 Felis 服务，并等待控制面就绪 | 是 | 无 |
| [`felis status`](#status) | 概览平台状态 | 是 | 「维护与备份 → 状态」 |
| [`felis doctor`](#doctor) | 执行一次全部健康检查 | 是 | 「维护与备份 → 诊断」 |
| [`felis support-bundle`](#support-bundle) | 收集已脱敏的诊断归档 | 是 | 「维护与备份 → 诊断」 |
| [`felis backup-now`](#backup-now) | 立即备份所有世界 | 是 | 「维护与备份 → 备份」 |
| [`felis db`](#db) | 备份、校验、列出、检查、删除和恢复数据库备份包；导出审计日志 | 是 | 「维护与备份 → 备份」 |
| [`felis migrate up`](#migrate) | 应用待执行的数据库迁移 | 是 | 「恢复数据库」的一部分 |
| [`felis offsite`](#offsite) | 查看、检查和取回异地副本 | 是 | 「维护与备份 → 异地副本」 |
| [`felis restore-host`](#restore-host) | 从异地副本重建本主机 | 是 | 「维护与备份 → 异地副本」 |
| [`felis update`](#update) | 检查版本并应用经审阅的更新 | `--apply` 时需要 | 「维护与备份 → 版本更新」（仅检查） |
| [`felis domain`](#domain) | 检查或迁移根域名 | 是 | 「平台设置 → 访问与安全」 |
| [`felis rotate-token`](#rotate-token) | 替换安装器生成的凭据 | 是 | 「平台设置 → 访问与安全」 |
| [`felis converge`](#converge) | 补全旧服务器规格缺少的字段 | 是 | 「平台设置 → 访问与安全」 |
| [`felis server-migrate`](#server-migrate) | 将已停止的世界迁移到其他节点 | 是 | 服务器页面的「停服迁移」 |
| [`felis node`](#node) | 接入、批准和更新节点 | 是 | 「平台设置 → 分布式」 |
| [`felis ha`](#ha) | 判断主机主导节点；将控制面卷迁移到副本存储 | 是 | 「平台设置 → 分布式」 |

## 安装与访问 {#setup-and-access}

### felis setup {#setup}

运行首次设置控制台。它是一个终端向导，用于配置面板访问方式和上传存储，并创建首位所有者。

```bash
sudo felis setup [-config path]
```

- 在尚未安装 Felis 的主机上，先运行二进制内置的安装器，再进入向导。如需选择发布渠道或设置安装器变量，应改为运行安装器，见[安装与部署](/guide/deployment#install)。
- 向导依次完成预检、连接方式（直接访问、自有反向代理或 Cloudflare Tunnel）、上传存储（本地磁盘或 S3 兼容存储桶）和首位所有者。汇总界面还可配置邮件中继。
- 创建所有者后输出一次性链接，用于登记邮箱并创建 Passkey，有效期 30 分钟。浏览器步骤尚未完成时再次执行 `sudo felis setup` 会签发新链接；已拥有登录凭证的账户不会被重置。
- 登录空间和大厅系统服务器不存在时予以创建。已有系统服务器保持其期望状态；登录空间或大厅启动失败不影响面板设置。
- 在已安装的主机上运行时显示状态界面，可在其中修改连接方式、上传存储和邮件中继。未做修改即退出不会更改任何内容。
- 该命令使用已安装的二进制，不升级 Felis，升级见[升级](/operations/upgrade#update)。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-config` | `/etc/felis/felis.toml` | 配置文件。 |
| `-dev` | — | 不接受。发布渠道由安装器选择（`FELIS_VERSION_BOOTSTRAP=dev`）。 |

**更改内容**：`[auth]` 配置项与 Cloudflare 隧道配置（`/etc/felis/cloudflared.yml`）；`[registry]` 中的上传存储配置，存储桶凭据写入 `/etc/felis/uploads-s3-access-key` 和 `/etc/felis/uploads-s3-secret-key`；`[smtp]` 邮件中继，其密码写入 `/etc/felis/smtp-password`；所有者账户。修改访问方式或存储时 felis-api 会重启。

**root**：需要。

**面板**：访问方式和上传存储位于「平台设置 → 访问与安全」；邮件中继位于「平台设置 → 通知与保留 → 邮件服务」。首位所有者只能在此创建。

**另见**：[设置向导](/guide/deployment#setup-wizard)、[访问方式](/operations/access#access-methods)。

### felis breakGlass {#break-glass}

打开本地应急控制台，在没有所有者能够登录时恢复访问。

```bash
sudo felis breakGlass [-config path]
```

控制台提供四项操作：

| 操作 | 作用 |
| --- | --- |
| **Provision or reset the Owner account** | 创建或重置所有者，输出一次性设置链接，并重新启用本地会话登录。 |
| **Add an Operator account** | 新增一个管理员账户，不改变全局登录设置。 |
| **Halt a running server** | 停止一台服务器。 |
| **Back up a world now (Sync)** | 归档一台服务器的世界。 |

已存在管理人员账户时，控制台会询问由哪个账户执行应急操作，并通过面板中保存的邮件中继（未保存时使用 `[smtp]`）向该账户已验证的邮箱发送六位验证码。验证码 10 分钟内有效，输错五次即失效。无法发送或无法验证验证码时（账户不存在、无已验证邮箱、无邮件中继、邮件被拒收），操作者可输入 `OVERRIDE`，本次运行即记录为未经验证的 root 越权操作，并附原因。

每次运行都会写入一条来源为 `break-glass` 的审计记录，动作为 `break_glass.recovery`、`break_glass.root_override` 或 `break_glass.operator_create`。

**root**：需要。

**面板**：无。该控制台按设计在没有面板时也能使用。

**另见**：[应急访问](/operations/access#break-glass)。

### felis version {#version}

显示二进制的版本、构建所用的 Go 版本与平台，以及已知时的源码修订号。

```bash
felis version
```

**root**：不需要。该命令不更改任何内容。

## 启动 {#starting}

### felis start {#start}

按顺序启动本主机设为开机启动的全部 Felis 服务，用于服务被停止或启动失败后恢复平台，效果与主机重启后的自动启动相同。

```bash
sudo felis start [-timeout 10m] [-systemd-dir dir]
```

- 先启动集群（主控节点为 `k3s`，工作节点为 `k3s-agent`）并等待节点就绪，再启动副本存储（`iscsid`）、控制节点虚拟地址（`keepalived`）、主机任务服务、游戏代理、Felis-nano、Cloudflare 隧道以及 Felis 的定时器。
- 只启动设为开机启动的单元，已停用的单元（例如未使用的隧道）保持停用。已在运行的单元不受影响，命令可以重复执行。
- 在主控节点上等待控制命名空间中的全部 Deployment 就绪，并列出每个 Deployment 的就绪副本数。
- 有部分未能启动时，命令逐项列出并给出查看日志的命令，以非零状态退出。
- `-timeout`（默认 10 分钟）限定等待集群与控制面的总时长；`-systemd-dir`（默认 `/etc/systemd/system`）指定安装器单元所在目录。

**root**：需要。

**面板**：无。

**另见**：[平台服务未运行](/operations/troubleshooting#services-down)。

## 状态与诊断 {#status-and-diagnostics}

### felis status {#status}

概览平台状态：发布版本和节点、控制面工作负载、游戏代理、每台服务器的在线玩家和最新世界备份、数据库备份和异地副本、主机磁盘和内存，以及未处理的看门狗告警。

```bash
sudo felis status [-systemd-dir dir]
```

- 不更改任何内容。集群、PostgreSQL 等某一部分不可用时显示为不可用，其余部分照常输出。
- `-systemd-dir`（默认 `/etc/systemd/system`）指定安装器 unit 所在目录，命令从中读取看门狗 unit 的设置。

**root**：需要。

**面板**：「维护与备份 → 状态」。

**另见**：[诊断](/operations/monitoring#diagnostics)。

### felis doctor {#doctor}

执行一次全部健康检查，按领域分组输出结果，并给出进一步排查的位置。

```bash
sudo felis doctor [-systemd-dir dir]
```

- 使用 `felis-watchdog.service` 的设置执行看门狗的全部检查，另加只有主机能做的检查：失败或已停止的 systemd unit、不再触发的定时器，以及无人接收的告警。
- 检查领域包括：配置、Kubernetes 集群、PostgreSQL、游戏代理、数据库备份、异地副本、构建扫描数据库、磁盘空间、内存、k3s 证书、节点地址、时钟、systemd unit 与定时器、告警。
- 不发送邮件，不发送心跳，也不改变看门狗的状态，可随时运行。
- 退出状态：全部检查通过为 0，发现任何问题为 1。

**root**：需要。

**面板**：「维护与备份 → 诊断 → 健康检查」。

**另见**：[诊断](/operations/monitoring#diagnostics)、[故障排查](/operations/troubleshooting#first-steps)。

### felis support-bundle {#support-bundle}

将状态、doctor 输出、日志和集群状态收集为一个已脱敏的 `tar.gz` 文件，供求助时提供。

```bash
sudo felis support-bundle [-o dir] [-log-lines n] [-since duration] [-server-logs]
```

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-o` | `/var/lib/felis/support` | 输出目录，不存在时以权限 0700 创建。 |
| `-log-lines` | `2000` | 每个 Pod 日志和每个 unit 日志保留的末尾行数。 |
| `-since` | `48h` | 读取每个 unit 日志的时间范围。 |
| `-server-logs` | 关 | 同时收集游戏服务器自身的日志，其中包含玩家名、IP 地址和聊天内容。 |
| `-systemd-dir` | `/etc/systemd/system` | 安装器 unit 所在目录。 |

- 归档以权限 0600 写入。归档不包含任何 Secret、ConfigMap、配置文件内容、数据库或世界，并从所收集的内容中移除主机密钥文件中的每个值。
- 归档内的 `MANIFEST.txt` 列出其包含的内容和被移除的内容。发送前应通读：脱敏能识别本机已知的密钥和常见的密钥记录方式，以其他方式记录的密钥会保留在归档中。

**root**：需要。

**面板**：「维护与备份 → 诊断 → 支持包」，经浏览器下载。

**另见**：[支持包](/operations/monitoring#support-bundle)。

## 备份与数据库 {#backups-and-database}

### felis backup-now {#backup-now}

逐台归档所有用户服务器（或指定服务器）的世界，并等待每个归档完成。

```bash
sudo felis backup-now [-yes] [-stop] [server ...]
```

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-yes` | 关 | 执行备份。未指定时只输出计划，不做更改。 |
| `-stop` | 关 | 先停止运行中的服务器再备份，而非在线备份。其玩家会断开连接，服务器保持停止状态。 |
| `-config` | `/etc/felis/felis.toml` | 配置文件。 |

- 运行中的服务器以在线方式备份：复制世界期间游戏暂停保存，玩家保持在线。
- 正在启动或停止的服务器会被跳过，指定 `-stop` 时除外。
- 不包括登录空间和大厅。
- felis-api 须处于运行状态：备份通过其内部接口发起。

```bash
sudo felis backup-now                  # 输出计划
sudo felis backup-now -yes             # 备份所有世界，运行中的服务器在线备份
sudo felis backup-now -yes survival    # 备份一台服务器
```

::: warning 注意
`-stop` 会断开玩家连接，并使服务器保持停止状态。备份完成后在面板中重新启动它们。
:::

**root**：需要，该命令读取集群的运维令牌。

**面板**：「维护与备份 → 备份 → 立即备份世界」。

**另见**：[立即备份所有世界](/operations/backup#backup-now)。

### felis db {#db}

备份、校验、列出、检查、删除和恢复控制面数据库备份包，并导出审计日志。

```text
felis db backup       [-config path] [-dir dir] [-label name] [-keep n] [-state-dir dir] [-no-servers] [-metrics-file path]
felis db restore      [-config path] [-dir dir] [-yes] [-force] [-no-safety-backup] <bundle>
felis db verify       [-dir dir] <bundle>
felis db delete       [-dir dir] <bundle>
felis db list         [-dir dir]
felis db check        [-dir dir] [-max-age 26h]
felis db audit-export [-config path] [-since date] [-until date] [-out file]
```

`-dir` 为备份包目录，默认 `/var/lib/felis/db-backups`。`<bundle>` 可以是路径，也可以是该目录中备份包的名称。

每个备份包是一个名为 `felis-db-<UTC 时间戳>-<label>.tar` 的文件，旁边附有 `.sha256` 文件。备份包包含数据库转储、`/etc/felis` 中的每个文件以及每个 MinecraftServer 对象。

::: danger 危险
备份包包含 `/etc/felis` 中保存的全部密钥，应按保护 `/etc/felis` 本身的标准保护备份包。
:::

| 动词 | 作用 |
| --- | --- |
| `backup` | 写入一个新备份包。`-label` 默认为 `manual`，手动备份包永不清理。`-keep` 指定该标签保留的备份包数量，默认值为 `daily` 14、`pre-migrate` 10、`pre-restore` 5、`offsite` 1。`-state-dir`（默认 `/etc/felis`，`""` 表示不包含）指定纳入的主机状态。`-no-servers` 不包含 MinecraftServer 对象。`-metrics-file` 指定成功后重写的 node-exporter 文本文件。备份包写入时缺少 MinecraftServer 对象则以状态码 1 退出。 |
| `restore` | 用备份包内容替换数据库中的每张表。未指定 `-yes` 时只输出备份包内容并停止。默认先为当前数据库创建 `pre-restore` 备份包，指定 `-no-safety-backup` 时跳过；有其他客户端连接时拒绝执行，指定 `-force` 时除外。 |
| `verify` | 校验备份包的校验和，并输出创建时间、Felis 版本、schema 版本、行数统计和成员文件。 |
| `delete` | 删除备份包及其 `.sha256` 文件。最新的一份备份包是最近的恢复点，不能删除。异地存储桶中的副本不受影响。 |
| `list` | 列出备份包及其标签、大小和创建至今的时长。 |
| `check` | 最新的 `daily` 备份包不存在或早于 `-max-age`（默认 `26h`）时以状态码 1 退出。 |
| `audit-export` | 以 JSON Lines 格式按时间从旧到新输出审计记录。`-since`（含）和 `-until`（不含）接受日期（`2026-01-31`，UTC 零点）或 RFC 3339 时间点。`-out` 指定的文件以权限 0600 创建，且不会覆盖已有文件；未指定时输出到标准输出。 |

恢复备份包：

```bash
sudo k3s kubectl -n felis scale deployment felis-api felis-operator --replicas=0
sudo felis db restore -yes felis-db-<stamp>-<label>.tar
sudo felis migrate up     # 回退到写入该备份包的发布版时跳过此步
sudo k3s kubectl -n felis scale deployment felis-api felis-operator --replicas=1
```

::: warning 注意
`db restore` 替换整个数据库。felis-api 缩容期间，面板和 API 不可用。
:::

`felis-db-backup.timer` 每天在 `FELIS_DB_BACKUP_TIME` 指定的时间运行 `felis db backup -label daily`。

**root**：需要，备份包目录和主机配置仅 root 可读。

**面板**：「维护与备份 → 备份」：立即备份、校验、恢复和删除备份包、设置每日备份计划、导出审计日志。

**另见**：[数据库备份包](/operations/backup#database-backups)、[恢复数据库](/operations/backup#restore-database)、[审计日志](/guide/administration#audit-log)。

### felis migrate up {#migrate}

应用待执行的数据库迁移。

```bash
sudo felis migrate up [-config path] [-backup-dir dir] [-no-backup]
```

- 迁移在数据库锁保护下执行，且只向前推进。
- 数据库已有数据且存在待执行迁移时，先在 `-backup-dir`（默认 `/var/lib/felis/db-backups`）中写入 `pre-migrate` 备份包；该备份失败则不应用任何迁移。`-no-backup` 跳过此备份。
- 安装器每次运行都会执行此命令。执行 `felis db restore` 后，按其输出提示手动运行。
- 动词 `up` 必须写在所有参数之前。

**root**：需要。

**面板**：「维护与备份 → 备份」中「恢复数据库」的一部分。

## 异地副本 {#offsite-copy}

### felis offsite {#offsite}

将世界归档、数据库备份包、用户镜像和上传的构建上下文在本机加密后复制到 S3 兼容存储桶，并可从中取回。

```text
felis offsite sync          [-config path] [-archive-dir dir] [-db-dir dir] [-registry host:port|off] [-uploads-dir dir] [-status-file path]
felis offsite status        [-config path] [-status-file path]
felis offsite list          [-config path]
felis offsite fetch-db      [-config path | -endpoint url -bucket name [-region r] [-prefix p]] [-dir dir] latest|<bundle>
felis offsite fetch-worlds  [-config path] [-archive-dir dir]
felis offsite fetch-images  [-config path] [-registry host:port] [-at version]
felis offsite fetch-uploads [-config path] [-uploads-dir dir] [-at version]
felis offsite check-key     [-config path]
felis offsite take-over     [-config path] [-status-file path] [-yes]
felis offsite keygen
```

除 `keygen` 外，各动词从 `[offsite]` 指定的环境变量（默认为 `FELIS_OFFSITE_ACCESS_KEY`、`FELIS_OFFSITE_SECRET_KEY` 和 `FELIS_OFFSITE_KEY`）读取存储桶凭据和加密密钥，未设置的变量从 `-env-file`（默认 `/etc/felis/offsite.env`）读取。

| 动词 | 作用 |
| --- | --- |
| `sync` | 执行一次复制。`felis-offsite.timer` 每小时运行一次；如需立即复制，执行 `sudo systemctl start felis-offsite.service`。 |
| `status` | 输出存储桶、密钥 ID、最近一次尝试、最近一次成功和最近一次错误、存储桶内容以及等待复制的内容。未配置异地副本、从未成功、最近一次成功早于 12 小时、最近一次运行被拒绝或本机处于待机状态时以状态码 1 退出。 |
| `list` | 按从新到旧列出存储桶中的数据库备份包、镜像清单和上传清单。 |
| `fetch-db` | 下载并解密一个数据库备份包（`latest` 或 `list` 中的名称），写入 `-dir`（默认 `/var/lib/felis/db-backups`）。在尚未安装的主机上，以 `-endpoint` 和 `-bucket`（需要时加 `-region`、`-prefix`）代替配置文件。 |
| `fetch-worlds` | 将数据库记录的世界归档取回到归档卷，并报告存储桶中没有副本的归档。 |
| `fetch-images` | 将用户镜像推回镜像仓库。`-at` 选择 `list` 中较早的仓库索引。 |
| `fetch-uploads` | 恢复上传的构建上下文。`-at` 选择 `list` 中较早的上传索引。 |
| `check-key` | 报告当前密钥是否为存储桶对象的加密密钥，不写入任何内容。对象由其他密钥加密时以状态码 3 退出，此时 `sync` 拒绝在存储桶中写入或清理任何内容。 |
| `take-over` | 报告写入存储桶的主机。未指定 `-yes` 时不写入任何内容：其他主机正在写入且本机从未写入时以状态码 4 退出，其他主机从本机接管了存储桶时以状态码 5 退出。指定 `-yes` 时本机成为写入者，另一台主机在其下次运行时停止复制。 |
| `keygen` | 输出一个新的加密密钥。 |

::: danger 危险
加密密钥应保存在本主机以外的地方。存储桶中只有加密后的对象，没有密钥便无法读取。
:::

**root**：需要。

**面板**：「维护与备份 → 异地副本」：配置、修改或关闭异地副本，立即复制，列出存储桶内容，检查和显示密钥，接管存储桶。

**另见**：[异地副本](/operations/backup#offsite)、[异地副本变量](/reference/configuration#offsite-variables)。

### felis restore-host {#restore-host}

从异地副本重建一台刚完成安装的主机：数据库、用户镜像、上传文件、服务器以及各服务器的最新世界。

```bash
sudo felis restore-host [-yes] [-bundle name] [-take-over] [-force]
```

指定 `-yes` 时按以下顺序执行：

1. 从存储桶取回最新的数据库备份包，或 `-bundle` 指定的备份包。
2. 将用户镜像推回镜像仓库，并恢复上传文件。
3. 用备份包覆盖新安装的数据库，并执行迁移。
4. 恢复用户服务器，保持停止状态。
5. 取回世界归档，并为每台服务器恢复其最新备份。
6. 指定 `-take-over` 时，将本机设为存储桶的写入者。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-yes` | 关 | 执行重建。未指定时只输出步骤，不做更改。 |
| `-bundle` | 最新 | `felis offsite list` 中的备份包名称。 |
| `-take-over` | 关 | 重建完成后将本机设为存储桶的写入者。在演练机上不要指定。 |
| `-force` | 关 | 在已有服务器的安装上执行恢复。 |
| `-dir` | `/var/lib/felis/restore-host` | 保存取回的备份包和进度记录的目录。 |
| `-config` | `/etc/felis/felis.toml` | 配置文件。存储桶及其密钥取自其中的 `[offsite]` 设置。 |

- 每完成一步都会记录，中断后再次运行会从停止处继续。数据库只恢复一次，再次运行不会用备份包覆盖此后写入的数据。
- 未指定 `-take-over` 时本机处于待机状态，不向存储桶复制任何内容。
- 以下两项需由运维人员完成：将域名指向新主机（`felis domain set`），以及恢复 Cloudflare 隧道（`felis setup`）。地址变化后，在旧地址注册的 Passkey 失效，相应用户需用邮件验证码登录并注册新的 Passkey。
- 向安装器提供 `FELIS_RESTORE_FROM_OFFSITE=1` 时，安装器会自动运行此命令。

::: danger 危险
重建会替换本安装的数据库。`-force` 会替换已有服务器的安装。
:::

**root**：需要。

**面板**：「维护与备份 → 异地副本 → 从异地副本重建」，需输入确认词。

**另见**：[重建主机](/operations/backup#rebuild-host)、[迁移到其他主机](/operations/backup#move-host)。

## 版本更新 {#updates}

### felis update {#update}

检查已安装版本和可用版本；指定 `--apply` 时安装经审阅的 Felis 目标版本。

```bash
sudo felis update [组件选择参数] [--version vX.Y.Z | --ref <commit-or-tag> | --dev] [--all]
sudo felis update --apply (--version vX.Y.Z --expect-commit <sha> | --ref <sha>) [--now] [--all] [--force]
```

- 未指定 `--apply` 时不做任何更改：报告各组件的已安装版本、最新版本和维护窗口，解析 Felis 目标版本，下载目标版本的安装器并检查语法，然后输出应执行的完整 `--apply` 命令。
- `--apply` 先检查维护窗口，备份数据库、`/etc/felis` 和 MinecraftServer 规格，再次检查维护窗口，然后运行目标版本的安装器并校验安装后的二进制。备份失败时更新中止，不应用任何更改。
- 应用更新的范围包括：felis 二进制、felis-api、felis-operator 和内嵌面板、平台清单、Velocity 及 Felis 插件、登录空间和大厅镜像，以及发布版固定的 JRE 和 PostgreSQL。用户服务器镜像保持固定。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--panel`、`--self`、`--velocity`、`--plugins`、`--k3s`、`--cloudflared`、`--jre`、`--postgres` | — | 仅报告这些组件。应用时总是协调整个平台组件包。 |
| `--mc` | — | 仅报告 Minecraft。服务器的 Minecraft 版本由其镜像决定。 |
| `--all` | 关 | 同时包含发布版固定的 k3s 和 cloudflared 升级。 |
| `--version` | 最新 | 已发布的稳定版本，例如 `v0.2.0`。 |
| `--ref` | — | 精确的提交、标签或分支，从源码构建。 |
| `--dev` | 关 | `main` 分支的最新提交。 |
| `--apply` | 关 | 应用目标版本。 |
| `--expect-commit` | — | 与 `--apply` 一起使用：目标不是该完整 40 位提交 SHA 时拒绝执行。 |
| `--now` | 关 | 与 `--apply` 一起使用：立即开始一次性手动维护，而不使用已配置的维护窗口。 |
| `--force` | 关 | 重新安装相同版本，或允许明确请求的降级。不会绕过维护窗口、备份或兼容性检查。 |
| `--record` | 关 | 保存检查结果供面板「版本更新」标签页显示。`felis-update-check.timer` 每天以此方式运行。 |
| `--check` | 开 | 仅检查。 |
| `--config` | `/etc/felis/felis.toml` | 用于读取维护窗口和执行备份的主机配置。 |
| `--velocity-jar` | `/opt/felis/velocity/velocity.jar` | 已安装的 Velocity jar。 |

`--version`、`--ref` 和 `--dev` 只能指定其一。`--apply` 不能与 `--check` 或 `--record` 同时使用。`FELIS_REPO_URL` 指定其他仓库，`FELIS_GITHUB_TOKEN`（属于密钥）用于访问私有 fork；输出的应用命令会保留这两个变量。

```bash
sudo felis update                     # 最新稳定版本；不安装任何内容
sudo felis update --all               # 同时规划固定版本的 k3s 和 cloudflared 升级
sudo felis update --version v0.2.0    # 查看指定发布版
sudo felis update --apply --version v0.2.0 --expect-commit <full-sha>   # 按检查输出的命令执行
```

::: warning 注意
应用更新可能重启 felis-api、游戏代理和系统服务器，应在维护窗口内执行。
:::

**root**：`--apply` 需要。检查也应以 `sudo` 运行，以便读取维护窗口。

**面板**：「维护与备份 → 版本更新」显示组件版本、维护窗口和应执行的命令。应用更新仍在命令行执行。

**另见**：[升级](/operations/upgrade#update)、[维护窗口](/operations/upgrade#maintenance-window)、[组件版本](/operations/upgrade#component-versions)。

## 域名与凭据 {#domain-and-credentials}

### felis domain {#domain}

将安装迁移到新的根域名，或检查承载域名的每一处位置。

```bash
sudo felis domain set [-yes] <new-root-domain>
sudo felis domain check
```

- `set` 更新主机上承载根域名的每一处位置：配置文件、面板证书、集群 Secret、游戏代理的 `felis-link.properties` 和登录空间的设置，然后重启读取这些内容的组件。未指定 `-yes` 时输出计划：每处位置、其新值以及此次变更的代价。
- `check` 每处位置输出一行，只要有一处尚未更新即以状态码 1 退出。它还会解析各 DNS 名称，并将 Cloudflare 隧道的主机名与新名称比对。
- `set` 可重复执行：再次运行只更改尚未更新的部分。
- 在 `[auth]` 中手动设置的面板或管理控制台主机名保持不变。安装器生成的自签名证书会为新名称重新签发；运维人员自有的证书若不覆盖新名称，命令会在做任何更改之前停止。
- 迁移后，`<root>`、`console.<root>`、`op.console.<root>` 和 `*.<root>` 须解析到本主机；服务器地址变为 `<name>.<new root>`；所有用户需重新登录；绑定旧面板主机名的 Passkey 失效。面板经隧道提供时，需重新执行 `felis setup` 的 Cloudflare 步骤。

::: warning 注意
`domain set -yes` 会重启 felis-api 和游戏代理，所有玩家都会断开连接。
:::

**root**：需要。

**面板**：「平台设置 → 访问与安全 → 访问方式与域名」。

**另见**：[更换根域名](/operations/access#change-domain)。

### felis rotate-token {#rotate-token}

替换安装器生成的一项凭据，并重启读取它的组件。

```bash
sudo felis rotate-token [-yes] <credential>
```

| 凭据 | 含义 | 重启内容 |
| --- | --- | --- |
| `velocity` | 游戏代理访问内部 API 的令牌 | felis-api。本机上的代理从文件读取新令牌并保持玩家在线；60 秒内仍未读取时才会被重启。 |
| `limbo` | 登录空间的令牌 | felis-api 和登录空间 Pod；此时正在登录的玩家需要重新连接。 |
| `build` | 构建 Job 获取构建上下文所用的令牌 | felis-api；此时正在获取上下文的构建会失败，可重新提交。 |
| `ops` | `felis backup-now` 使用的令牌 | felis-api。 |
| `registry` | 镜像仓库的写入令牌（platform、build、prune） | 镜像仓库和 felis-api；此时正在推送的构建会失败，镜像拉取会重试。 |
| `forwarding` | Velocity 转发密钥 | 所有运行中的服务器（各自保存世界）和游戏代理；所有在线玩家断开连接。世界正被备份、恢复或文件操作占用的服务器保持运行，在该操作结束后停止并重新启动之前，玩家无法加入。 |
| `db` | 数据库角色的密码 | felis-api；此时正在连接的备份、恢复或文件 Job 会失败，可重新执行。仅适用于安装器部署的 felis-postgres。 |

- 新值先写入 `/etc/felis/secrets.env`，因此即使后续步骤失败，之后运行安装器也会将其应用到各处。随后写入承载它的 Secret 和文件，最后重启读取旧值的组件。
- 未指定 `-yes` 时输出将更改的内容及其造成的中断。
- 游戏代理运行在其他主机上时，`velocity` 和 `forwarding` 的计划会说明需要复制到该主机的值。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-yes` | 关 | 执行轮换。未指定时只输出计划，不做更改。 |
| `-secrets-env` | `/etc/felis/secrets.env` | 安装器的密钥文件。 |
| `-link-properties` | `/opt/felis/velocity/plugins/felis-link/felis-link.properties` | 游戏代理的插件设置（仅 `velocity`）。 |
| `-forwarding-secret` | `/opt/felis/velocity/forwarding.secret` | 游戏代理的转发密钥文件（仅 `forwarding`）。 |
| `-config` | `/etc/felis/felis.toml` | 配置文件。 |

::: warning 注意
轮换 `forwarding` 会重启所有运行中的服务器，并断开所有玩家的连接。
:::

**root**：需要。

**面板**：「平台设置 → 访问与安全 → 凭据轮换」。

**另见**：[轮换凭据](/operations/access#rotate-credentials)。

## 服务器 {#servers}

### felis converge {#converge}

补全新版本新增、而已安装服务器缺少的规格字段。

```bash
sudo felis converge [-user-rcon] [-config path]
```

- 登录空间或正式大厅不存在时，按 `felis setup` 的方式创建，并复制其 Pod 挂载的 Secret。
- 对登录空间和大厅，补全缺少的字段（如 `spec.rcon`、`spec.startup.healthHTTPPort`），并补回缺少的派生设置。已有值的字段从不覆盖。
- 为每台没有空闲设置的用户服务器设置默认的空闲停止：无玩家 600 秒后停止。
- 列出未启用 RCON 的用户服务器。`-user-rcon` 为这些服务器启用 RCON，更改在各服务器下次启动时生效。
- 应在镜像就位后（即安装器运行之后）执行。镜像不开放 RCON 的服务器在此更改后会停留在 `Starting`，直到被标记为 `Failed`；使用 `-user-rcon` 前应检查用户自带的镜像。
- 有服务器未能更新时以状态码 1 退出。

**root**：需要。

**面板**：「平台设置 → 访问与安全 → 系统服务器补全」。

### felis server-migrate {#server-migrate}

在分布式模式下，将已停止的用户服务器的世界迁移到另一个已批准的节点。

```bash
sudo felis server-migrate start  -name <server> -target-node <node>
sudo felis server-migrate status -name <server> [-id <operation-id>]
sudo felis server-migrate retry  -name <server> -id <operation-id>
sudo felis server-migrate abort  -name <server> -id <operation-id>
```

- 服务器须处于停止状态。目标节点须在线、已批准且未被隔离；主控节点也可作为目标。
- 阶段依次为 `backing_up`、`restoring`、`switching` 和 `succeeded`。迁移成功后服务器不会自动启动，应检查世界后手动启动。
- `abort` 仅适用于尚未切换的失败操作，服务器保留在源节点。
- 主机上有节点操作正在运行时，该命令拒绝执行。命令以 JSON 输出操作信息。
- 该命令与迁移数据库的 `felis migrate` 是两个独立的命令。

**root**：需要。

**面板**：服务器页面的「停服迁移」。

**另见**：[停服迁移](/guide/distributed#migrate-server)。

## 节点与高可用 {#nodes-and-ha}

### felis node {#node}

接入、批准和更新分布式部署中的节点，并安装其主机防火墙。

```text
felis node list
felis node token    -name <node> -out <file> [-ttl 10m]
felis node join     -name <node> -server https://<controller>:6443 -token-file <file> -registry-ip <ip> -peers <cidrs> -external-ip <ip>
felis node approve  -name <node> -ssh-target <ssh-host> -image <felis-image>
felis node firewall -peers <cidrs> -controller-ip <address> [-controller] [-controller-peers <cidrs>] [-dry-run]
felis node upgrade
felis node join-controller
```

| 动词 | 运行位置 | 作用 |
| --- | --- | --- |
| `list` | 主控节点 | 以 JSON 输出执行节点列表。 |
| `token` | 主控节点 | 为一个工作节点生成引导令牌，写入新建的仅 root 可读文件，不在终端显示。`-ttl` 默认 `10m`，最长 `1h`。 |
| `join` | 工作节点 | 通过安装器的工作节点模式将本机接入为工作节点。工作节点不需要服务器令牌、管理员 kubeconfig、数据库或镜像仓库写入凭据。 |
| `approve` | 主控节点 | 通过 SSH 执行准入检查，SSH 账户须能执行 `sudo -n`。任何检查失败都会使节点保持隔离。批准过程会删除指定的缓存镜像并重新拉取，因此应在节点运行游戏负载之前执行。 |
| `firewall` | 每个节点 | 按给定的精确对等地址（`/32` 或 `/128`）安装主机隔离防火墙。在主控节点上加 `-controller`；`-dry-run` 只输出脚本，不安装。 |
| `upgrade` | 工作节点 | 由主控节点的节点操作经 SSH 启动，将 felis 和 k3s-agent 更新到主控节点的版本。 |
| `join-controller` | 新主控节点 | 由节点操作启动，将新主控节点加入集群的内嵌 etcd。 |

::: warning 注意
`upgrade` 会重启工作节点上的 k3s-agent。执行前先停止该节点上的服务器。
:::

**root**：需要。

**面板**：「平台设置 → 分布式 → 节点操作」。

**另见**：[添加工作节点](/guide/distributed#add-workers)、[网络隔离](/guide/distributed#isolation)。

### felis ha {#ha}

主控高可用在主机侧的命令：判断由哪个主控节点运行主机的集群级任务，以及将控制面卷迁移到副本存储。

```text
felis ha leader [-or-unreachable] [-q]
felis ha migrate-storage -node <node> -image <felis-image> [flags]
```

- `leader` 在主机主导节点上以状态码 0 退出，在其他节点上以 1 退出。主机主导节点是运行 PostgreSQL Pod 的主控节点；只有一个主控节点时始终是该节点。数据库备份、异地复制、版本检查和构建工具同步只在主导节点上运行，其定时器用此命令判断。`-or-unreachable` 在无法查询集群时也以 0 退出，使看门狗仍能运行并报告该问题。`-q` 不输出任何内容。
- `migrate-storage` 将数据库目录、上传文件、镜像仓库、世界归档和系统服务器的世界逐个迁移到副本 StorageClass `felis-replicated`，并保留原有的卷。进度保存在 `/var/lib/felis/ha-migrate`，再次运行只复制尚未完成的部分。启用主控高可用时由安装器运行；迁移期间登录空间和大厅暂停，面板短暂不可用。

**root**：需要。

**面板**：「平台设置 → 分布式 → 节点操作 → 启用主控高可用」。

**另见**：[主控高可用](/guide/distributed#controller-ha)。

## 内部子命令 {#internal}

以下子命令由服务、定时器、Job 或安装器运行，日常运维无需手动执行。

| 子命令 | 运行者 |
| --- | --- |
| `api` | felis-api Deployment。 |
| `operator` | felis-operator Deployment。 |
| `reaper` | 每日运行的 reaper CronJob：世界清理和备份保留。 |
| `watchdog` | `felis-watchdog.timer`，每两分钟一次；`felis-watchdog-failed.service` 运行 `watchdog -unit-failed`。`-dry-run` 输出全部检查结果和应发送的邮件，但不发送。 |
| `node-control` | `felis-node-control.service`，即面板使用的主机操作服务。 |
| `nano` | Felis-nano 安装中的 `felis-nano.service`。 |
| `panel-settings` | 安装器的汇总输出：显示面板中是否保存了邮件中继和心跳（`yes` 或 `no`，从不显示具体值）。 |
| `mirror-build-tools` | `felis-build-tools.timer`：将构建和扫描工具及其数据库、服务器使用的 Java 运行时镜像复制到镜像仓库。`-only` 指定单项，例如 `runtime-java21`。 |
| `artifact-cache` | felis-artifacts Deployment：服务端软件的下载缓存。 |
| `install-self`、`install-server`、`launch` | 使用服务端软件的服务器 Pod：复制 felis 二进制、安装服务端、启动服务器。 |
| `bootstrap-assets`、`pin-images`、`image-bundle`、`manifests` | 安装器和发布版构建。 |
| `apply` | 开发用途：直接创建 MinecraftServer 对象，不创建对应的数据库记录。 |
| `backup`、`restore`、`stage-world`、`files`、`export`、`fetch-context`、`scan-gate`、`push-image` | 控制面创建的 Job 和 init 容器。 |
| `egress-gate`、`init-forwarding`、`init-volume`、`registry-gate`、`archive-serve`、`node-probe` | init 容器、sidecar 和准入探测。 |
| `ha copy-volume` | `felis ha migrate-storage` 的复制 Job。 |

### 定时运行 {#scheduled-runs}

| 定时器 | 命令 | 计划 |
| --- | --- | --- |
| `felis-watchdog.timer` | `felis watchdog` | 开机 3 分钟后开始，每 2 分钟一次 |
| `felis-offsite.timer` | `felis offsite sync` | 每小时一次，随机延迟最多 10 分钟 |
| `felis-db-backup.timer` | `felis db backup -label daily` | `FELIS_DB_BACKUP_TIME`（默认 `*-*-* 03:30:00`），随机延迟最多 15 分钟 |
| `felis-update-check.timer` | `felis update --record` | 每天 05:30，随机延迟最多 30 分钟 |
| `felis-build-tools.timer` | `felis mirror-build-tools` | 每天 04:00 和 16:00，随机延迟最多 1 小时 |

在主控高可用部署中，这些定时器只在主机主导节点上运行（见 [`felis ha`](#ha)）。无法查询集群以确定主导节点时，看门狗也会在其他主控节点上运行，以便报告该故障。
