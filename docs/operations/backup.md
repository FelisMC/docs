---
title: 备份与恢复
description: Felis 如何备份世界与控制面数据库、保存加密的异地副本，以及重建或迁移主机。
---

# 备份与恢复 {#backup}

本页面向所有者和主机管理员，说明世界备份及其保留策略、世界恢复、世界回收、异地副本、控制面数据库备份包、重建故障主机以及迁移到另一台主机。服务器所有者管理自身服务器备份的方法见[管理服务器](/guide/servers#server-backups)。

## 概览 {#overview}

Felis 分别保护三类数据：

| 数据 | 保护方式 | 主机上的位置 | 异地副本 |
| --- | --- | --- | --- |
| 世界（每台服务器的完整数据卷） | 世界备份：手动备份、不停服备份、每日恢复点、回收归档 | `felis-backups` 卷 | 一小时内 |
| 控制面数据库与主机状态（账户、Passkey、服务器归属、配额、审计日志、归档索引、`/etc/felis`） | 数据库备份包：每日、每次升级迁移前、每次恢复前 | `/var/lib/felis/db-backups` | 一小时内 |
| 用户镜像与投稿上传内容 | 异地副本 | `registry` 卷与 `felis-uploads` 卷 | 每小时 |

未配置异地副本时，所有备份与其保护的数据位于同一磁盘，该磁盘丢失即两者同时丢失。

大多数操作有两个入口：面板中由所有者在「维护与备份 → 备份」和「维护与备份 → 异地副本」执行；主机上以 root 运行 `felis` 命令。每个面板任务都要求重新完成身份验证，并记入审计日志，详见[在面板中运维主机](/operations/#panel-host-operations)。各命令的说明见[命令行参考](/reference/cli#backup-now)。

### 生产环境检查清单 {#checklist}

- 配置异地副本（见[异地副本](#offsite)）。未配置时，安装器结束时提示 `NO OFF-SITE COPY`。
- 将异地加密密钥保存在密码管理器等主机以外的位置（见[加密密钥](#offsite-key)）。
- 没有存储桶时，至少在主机之外保存一份数据库备份包。备份包内含 `secrets.env`，重建时需要它读取其余数据（见[不使用存储桶](#no-bucket)）。
- 在备用机器上演练一次重建（见[演练重建](#rehearsal)）。
- 将 `sudo felis offsite status` 和 `sudo felis db check` 接入监控，或依赖看门狗邮件。异地副本或最新每日备份包过期时，两条命令均以非零状态退出。

## 世界备份 {#world-backups}

### 备份包含的内容 {#backup-contents}

世界备份是服务器完整数据卷（即服务器挂载于 `/data` 的卷）的压缩归档，包括世界目录、`server.properties`、插件与模组、配置、jar、依赖库、日志和缓存。恢复时，数据卷内容被归档替换，备份之后新增的文件会被删除，因此配置和插件的改动也会一并回滚。

标准 Paper 服务器的体积主要来自依赖库和缓存：尚未积累世界数据的新实例约为 170 MB。规划归档存储时应按完整数据卷计算（见[存储与磁盘](/operations/storage#disk-layout)）。

每个归档都按写入时记录的 sha256 校验。每日回收任务回读最多十个过去一周内未校验过的归档。校验失败的归档在服务器备份页面标记为「已损坏」，无法用于恢复。

### 备份类型 {#backup-kinds}

| 类型（面板标签） | 创建方式 | 默认保留 |
| --- | --- | --- |
| 「手动备份」 | 服务器备份页面的「立即备份」、面板的「立即备份世界」、`felis backup-now` | 每台服务器 5 份，30 天 |
| 「定时备份」 | felis-api 生成的每日恢复点；执行备份动作的计划任务 | 每台服务器 7 份，90 天 |
| 「恢复前快照」 | 勾选安全快照的恢复操作 | 每台服务器最近 3 份 |
| 「闲置自动回收」、「放弃或删除时归档」 | 世界回收，在移除世界之前创建 | 90 天 |

多机部署中还会出现「故障切换副本」类型的备份，见[多机部署与高可用](/guide/distributed#failover)。

### 手动备份 {#manual-backups}

服务器已停止时，备份 Job 按原样归档世界卷；服务器运行中时，执行不停服备份（见[不停服备份](#live-backups)）。手动备份受 `felis.toml` 中以下 `[archive]` 键或所有者在面板中保存的数值限制（见[保留策略](#retention)）：

| 键 | 默认值 | 作用 |
| --- | --- | --- |
| `manual_retention` | `30d` | 手动备份的过期时间。 |
| `manual_keep` | `5` | 每台服务器保留的手动备份数。每次备份完成后，Job 删除更早的备份并输出 `removed older backup …`。 |
| `manual_cooldown` | `10m` | 每台服务器在每个时间窗口内只允许所有者发起一次备份，下一次返回 `429 backup_cooldown` 及 `Retry-After`。设为 `0s` 取消冷却。 |

现有备份总量达到备份存储上限（`max_local_bytes`）时，所有者发起的备份返回 `507 backup_store_full`。管理员、`felis backup-now` 和应急控制台不受冷却时间和存储上限限制。无论由谁发起，若写入归档后归档文件系统的可用空间将低于 10%，备份 Job 拒绝写入，并以 `not enough free disk for the archive` 失败。备份或恢复失败时，错误信息显示在服务器备份页面的「最近操作」中。

## 不停服备份 {#live-backups}

备份运行中的服务器时，服务器保持运行。对运行中服务器执行「立即备份」、运行中世界的每日恢复点、计划任务的备份以及 `felis backup-now`，均采用不停服备份：

1. felis-api 仅接受处于运行且就绪状态、世界未被其他操作占用的服务器。
2. 通过 RCON 关闭存档（`save-off`），并将内存中的全部数据写入磁盘（`save-all flush`，大型世界最多允许 2 分钟）。
3. 备份 Job 将世界复制到同一节点上的临时卷。在 XFS 和 Btrfs 上，每个文件通过 reflink 克隆，无论世界大小，复制几乎瞬间完成。临时卷的可用空间小于世界占用空间时，复制不会开始。
4. 复制一结束，felis-api 立即重新开启存档（`save-on`）。归档、sha256 计算和回读均基于副本进行，游戏照常运行。

玩家保持在线。存档仅在复制期间暂停，数 GB 的世界通常只需几秒，最长 5 分钟：届时仍未完成的复制被放弃，存档随即恢复。备份前已关闭存档的服务器，备份后保持关闭。

限制：

- 暂停期间发生崩溃时，自刷新以来的改动会丢失，与两次自动存档之间发生崩溃的情况相同。
- 复制期间重启的游戏会在关闭时存档，该副本可能不一致，因此被放弃。
- 在游戏存档系统之外写入的插件数据库（SQLite、H2）按复制时刻的状态复制。
- 不停服备份需要 RCON。在 RCON 成为默认设置之前创建的用户服务器，可通过 `sudo felis converge -user-rcon`，或在「平台设置 → 访问与安全 → 系统服务器补全」中勾选「为旧用户服务器启用 RCON」来启用。

除上述流程外，不停服备份与普通备份相同：使用同一 Job，适用相同的冷却时间、存储上限、保留份数和可用空间检查，审计日志记为 `backup.create`（或 `backup.scheduled`），附带 `{"live":true}`。不停服备份被拒绝时，返回信息会说明原因：

| 返回 | 原因 | 处理 |
| --- | --- | --- |
| `409 not_stopped`，`the server is starting or stopping; back it up once it is running or stopped` | 服务器处于状态切换中。 | 待状态稳定后重试。 |
| `503 live_backup_console` | 游戏未通过 RCON 响应 `save-off` 或 `save-all flush`：RCON 未开启或无法连接。 | 重试；或在服务器停止后备份；或按上文开启 RCON。 |
| `409 maintenance_in_progress` | 其他操作占用该世界、正在重启，或另一个不停服备份仍在复制。 | 待其结束后重试。 |
| `409 not_stopped`，`stop the server before backing up its world` | 当前 felis-api 无法备份运行中的服务器。 | 先停止服务器。 |

## 每日恢复点 {#restore-points}

每天都有人游玩的世界不会进入闲置状态，世界回收也就不会为其归档。因此，对于自所有者上一份完好定时备份以来有人加入过的每个已有所有者的世界，当该备份的时间超过 `scheduled_every` 时，felis-api 会创建一份定时备份。运行中的世界以不停服方式备份，全天运行的服务器同样能获得每日恢复点。

| `[archive]` 键 | 默认值 | 作用 |
| --- | --- | --- |
| `scheduled_every` | `1d` | 世界最新定时备份超过此时间后创建下一份。设为 `0s` 关闭每日恢复点。 |
| `scheduled_keep` | `7` | 每台服务器、每位所有者保留的定时备份数。 |
| `scheduled_retention` | `90d` | 定时备份的过期时间。 |

- felis-api 每 2 分钟检查一次，在全平台范围内同一时间只启动一个定时备份，并且仅在没有其他备份或恢复 Job 运行时启动。尚无任何恢复点的世界优先。此类备份进行期间，唤醒已停止服务器的玩家会看到维护提示，待备份完成后即可重试。
- 正在启动或停止的服务器，以及世界被其他操作占用的服务器，等待后续检查。备份失败或游戏未响应控制台时，在 `scheduled_every` 的四分之一（默认 6 小时）之后重试。失败记录显示在「最近操作」中，名称为「定时备份」。
- 备份存储达到上限期间不启动任何恢复点；felis-api 记录 `scheduled backups paused`，空间恢复后记录 `resumed`。
- 恢复点按所有者计数。前任所有者期间创建的备份不计为新所有者世界的恢复点，新所有者的备份也不会清理它。
- 恢复点不会触发所有者的 `manual_cooldown`，与手动备份一样复制到异地，并在审计日志中记为 `backup.scheduled`，操作者为 `scheduler`。
- 恢复点依赖备份执行器。缺少 `FELIS_IMAGE` 或 `FELIS_BACKUP_PVC` 时，felis-api 启动时记录 `scheduled backups off (needs the backup executor)`。

在面板中修改 `scheduled_every` 后，下一次检查即生效，无需重启。

## 保留策略 {#retention}

所有者在「平台设置 → 通知与保留 → 备份与审计保留」中设置备份与审计记录的保留策略。此处保存的数值覆盖 `felis.toml` 中 `[archive]` 和 `[audit]` 的对应键：

| 面板字段 | 覆盖的键 | 取值范围 |
| --- | --- | --- |
| 「手动备份」：「每台服务器保留份数」 | `manual_keep` | 1–100 |
| 「手动备份」：「保留天数」 | `manual_retention` | 1–3650 天 |
| 「手动备份」：「两次备份的最短间隔（分钟）」 | `manual_cooldown` | 0–1440（0 表示不限制） |
| 「定时还原点」：「间隔（小时）」 | `scheduled_every` | 0–720（0 表示关闭） |
| 「定时还原点」：「每台服务器保留份数」 | `scheduled_keep` | 1–100 |
| 「定时还原点」：「保留天数」 | `scheduled_retention` | 1–3650 天 |
| 「存储与审计」：「已移除世界的归档保留天数」 | `retention`，适用于世界回收写入的全部归档 | 1–3650 天 |
| 「存储与审计」：「备份存储上限（GiB）」 | `max_local_bytes` | 0–1048576（0 表示不限制） |
| 「存储与审计」：「审计记录保留天数」 | `[audit] retention` | 0（永久保留），或 30–3650 天 |

- 选择「保存保留设置」后生效。felis-api 立即应用；备份 Job 在启动时读取，世界回收在下一次每日运行时读取。
- 尚未保存策略时，卡片显示 `felis.toml` 中的数值，并按卡片单位取整。「恢复为安装时设置」丢弃已保存的数值，重新使用 `felis.toml`。
- 世界回收的提醒时间偏移 `warn_before` 只能在 `felis.toml` 中设置。
- 已保存的策略无法读取时，继续使用 `felis.toml`：felis-api 记录 `felis.toml stands`，备份 Job 和世界回收记录 `the panel's retention policy is unreadable, [archive] stands`。
- 保存和清除都要求重新完成身份验证。卡片加载后策略已被他人修改时，保存返回 `409 conflict`。对应的审计动作为 `platform.archive_policy` 和 `platform.archive_policy.clear`。

备份存储达到上限时，世界回收在归档闲置世界之前先腾出空间：首先按时间从旧到新删除所有者的手动备份，然后删除已确认存在异地副本的回收归档。已移除世界的唯一副本保留至其保留期满。仍无足够空间时，该闲置世界予以保留。

## 恢复与导出世界 {#restore-worlds}

服务器所有者和管理员在服务器页面的「服务器 → （服务器） → 备份与恢复」中恢复、下载和删除备份，操作步骤见[管理服务器](/guide/servers#server-backups)。与运维相关的要点如下：

- 「恢复此备份」会停止服务器、断开其玩家，并用备份覆盖整个数据卷。勾选「先为当前世界做安全快照（推荐）」时，先创建恢复前快照，快照成功后才执行恢复；恢复该快照即可撤销此次恢复。已损坏的备份无法恢复。
- 「下载备份」以 `.tar.gz` 文件提供归档，并按记录的 sha256 校验；校验不一致时下载会被截断。「导出世界」打包当前世界，要求服务器已停止；下载结束前服务器无法启动。
- 每位用户同一时间最多进行一个导出，全平台最多两个，每位用户每小时最多六个；超出时返回 `429 export_busy` 及 `Retry-After`。下载准备就绪后，浏览器须在 90 秒内开始下载。
- 恢复、备份、导出或文件修改占用世界期间，该服务器的唤醒及其他世界操作均返回 `409 maintenance_in_progress`。

::: danger 危险
未勾选安全快照的恢复会永久覆盖当前世界。没有其他备份的数据无法找回。
:::

### 删除备份 {#delete-backup}

「删除备份」会立即将备份从所有列表和恢复选项中移除。归档文件在下一次每日回收运行时删除，异地副本在下一次同步时删除。管理员可删除任意备份；普通用户只能删除自己曾拥有的世界的备份。恢复任务可能正在读取该归档时，删除返回 `409 restore_in_progress`。审计动作为 `backup.delete`，记录备份 ID、原所有者和大小。

在下一次回收运行之前，管理员可使用审计记录中的备份 ID 撤销删除。同时清除 `offsite_at`，若异地副本已被删除，下一次同步会重新复制：

```bash
sudo k3s kubectl -n felis exec deploy/felis-postgres -c postgres -- psql -U postgres felis -c \
  "UPDATE world_backups SET status = 'present', expires_at = now() + interval '30 days', offsite_at = NULL
   WHERE id = '<backup id>' AND status = 'expired'"
```

::: danger 危险
世界回收写入的归档可能是已移除世界仅存的副本。回收任务删除该归档后，数据无法找回。
:::

## 备份全部世界 {#backup-now}

世界只存在于其数据卷中，异地副本只保存其归档。在扩容磁盘、将数据迁移到其他磁盘或迁移到另一台主机等可能丢失数据卷的操作之前，应归档全部世界。

在面板中：

1. 打开「维护与备份 → 备份」。
2. 在「立即备份世界」的「备份范围」中选择「全部用户服务器」或「指定服务器」。
3. 仅在归档后不允许世界再发生变化时，开启「先停止运行中的服务器」。
4. 选择「开始备份」。

在主机上：

```bash
sudo felis backup-now                    # the plan; nothing changes
sudo felis backup-now -yes               # archive every world, one at a time; running servers live
sudo felis backup-now -yes -stop         # stop the running servers first and leave them stopped
sudo felis backup-now -yes alpha bravo   # only these servers
```

- **执行计划**列出每台用户服务器及本次的处理方式：`back up`（已停止）、`back up while it runs (saving pauses for the copy)`（运行且就绪）、`stop, then back up`（运行中，且指定了 `-stop`）、`skip: starting or stopping (run again later, or pass -stop)`，或 `skip: no world volume (never started, nothing to save)`。没有可归档的世界时输出 `Nothing to back up.`。
- **每个归档都是普通的手动备份**，不受所有者冷却时间和存储上限限制，在审计日志中记为 `backup.create`，来源为 `internal:ops`。
- **每个归档计入 `manual_keep`**：已有该数量手动备份的服务器会删除最旧的一份，执行计划会注明。需要保留这些旧备份时，先提高上限。
- **已停止的服务器优先处理。** 每个备份完成后（`alpha: archived in 42s`）才开始下一个。
- **运行中的服务器以不停服方式备份。** 控制台无响应（RCON 未开启）的运行中服务器备份失败；可改用 `-stop`，或先开启其 RCON。
- **`-stop` 在备份前停止每台运行中的服务器。** 玩家会被断开，服务器保持停止（`Left stopped: …`）。正在启动或停止的服务器也会被纳入。10 分钟后仍未停止的服务器计为失败，任务继续处理下一台。
- **felis-api 无法连接时任务结束**（`Stopped: nothing more can be backed up until felis-api answers`）。按 Ctrl-C 在当前步骤完成后结束；已启动的备份 Job 会运行至结束。
- **归档在每小时异地同步之前一直保存在主机上。** 有归档产生时，执行 `sudo systemctl start felis-offsite.service` 立即发送；`sudo felis offsite status` 显示仍在等待的内容。

全部有数据卷的世界均归档成功时，命令以 0 退出；有备份失败、跳过了正在启动或停止的服务器或任务被中断时以 1 退出；指定的名称不是用户服务器时以 2 退出。

::: warning 注意
使用 `-stop`（「先停止运行中的服务器」）时，所有运行中服务器上的玩家都会被断开，服务器在从面板重新启动前保持停止。
:::

## 世界回收 {#world-cleanup}

世界回收（reaper）是每天运行一次的 Kubernetes CronJob。它始终维护归档存储；启用后，还会归档并移除闲置超过 15 天的世界。

### 归档存储维护 {#store-maintenance}

每次运行：

- 删除已过期的备份，以及已删除备份的归档；
- 回读最多十个过去一周内未校验过的归档，将校验不一致的标记为已损坏；
- 删除中断归档的残留文件（超过六小时的 `*.partial` 文件），以及没有备份记录指向且时间超过 `retention` 的已完成归档。

### 移除闲置世界 {#idle-worlds}

闲置世界移除由安装变量 `FELIS_WORLDS_HOST_PATH` 启用。在安装器部署的 k3s 上，带 `FELIS_WORLDS_HOST_PATH=/var/lib/rancher/k3s/storage` 重新运行安装器即可（见[安装与部署](/guide/deployment#install)）。未设置时，安装器提示 `idle-world retention is off`，回收任务只维护归档存储，运行摘要显示 `evaluated=0`。

启用闲置世界移除后：

- 只有服务器超过 15 天无人加入时，其世界才会被移除。15 天的期限固定不变。有玩家加入或服务器被认领时，计时重新开始。
- 所有者在移除前 3 天和前 1 天（`warn_before`）通过邮件中继收到提醒邮件，发往其已验证的邮箱（见[邮件中继](/operations/monitoring#mail-relay)）。未配置中继时不发送提醒；提醒仅在实际送达后才记为已发送。没有所有者的服务器不会收到提醒，但仍会被移除。
- 系统服务器（`spec.reaperExempt=true`）永不移除。
- 仍在运行的服务器会被要求停止，留待下一次运行处理。世界先在维护锁下归档，维护锁期间服务器无法启动。归档失败或备份存储已满时，世界予以保留。
- 配置了异地副本时，世界还会保留到其归档确认存在于存储桶中为止。此时任务记录 `world archived, kept until the archive's off-site copy is confirmed`，并在之后的运行中移除该世界。
- 归档保留 `retention` 指定的时间：默认 90 天，对应面板中的「已移除世界的归档保留天数」。

::: warning 注意
闲置计时依赖游戏代理向 felis-api 报告玩家加入。加入事件未送达时，每天都有人游玩的世界也会在 15 天后满足移除条件。启用闲置世界移除前，应确认加入事件正常上报（见[指标](/operations/monitoring#metrics)），并认领或豁免需要保留的无所有者服务器。
:::

### 运行结果与失败 {#cleanup-failures}

每次运行以一行摘要结束：

```
felis reaper: evaluated=12 reaped=1 released=0 deleted=0 awaiting_offsite=0 awaiting_stop=0 warned=2 skipped=0 store_full=0 evicted=0 expired=3 expire_failed=0 verified=6 corrupt=0 verify_failed=0 swept=0 orphan_archives=0
```

`skipped`、`expire_failed`、`corrupt` 或 `verify_failed` 大于零，或清理未能完成时，Job 失败。世界数据不受影响；看门狗发送 `world reaper Job … failed` 邮件，连续 26 小时没有成功运行时还会报告 `the world reaper has not succeeded for …`。Job 会重试两次，每次重试均可安全重复执行。查看摘要上方的错误信息：

```bash
kubectl -n minecraft logs job/<the failed felis-reaper-… Job>
```

`awaiting_offsite` 持续一天以上大于零，表示异地副本同步失败，应检查 `sudo felis offsite status`。`awaiting_stop` 持续数日不清零，表示有程序反复启动该服务器，或有 Job 一直占用其世界。其他原因见[故障排查](/operations/troubleshooting#backup-failures)。

## 异地副本 {#offsite}

异地副本将世界归档、数据库备份包、用户镜像和投稿上传内容发送到兼容 S3 的存储桶（AWS S3、Cloudflare R2、Backblaze B2、MinIO 等）。所有内容在主机上加密，只能用该主机的加密密钥读取。

### 配置异地副本 {#offsite-configure}

在面板中：

1. 打开「维护与备份 → 异地副本」，选择「配置」（已配置存储桶时为「更换存储桶」）。
2. 填写「服务地址」「存储桶」「访问密钥 ID」和「访问密钥」。可选填写「区域」「对象前缀」（可让多套安装共用一个存储桶）和「存储桶保留的数据库备份数」（默认 30）。更换存储桶时，两项密钥均留空则保留当前凭据。
3. 「加密密钥（可选）」留空则生成新密钥。若存储桶中已有此前主机的副本，填写原密钥。
4. 选择「保存并检查」。该任务将 `[offsite]` 写入主机配置、安装每小时定时任务，并对照存储桶校验密钥。
5. 在「加密密钥」卡片中选择「显示密钥」或「复制密钥」，将密钥保存在主机以外的位置。

安装时，可向安装器提供存储桶：

```bash
FELIS_OFFSITE_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
FELIS_OFFSITE_BUCKET=felis-backups \
FELIS_OFFSITE_ACCESS_KEY=... FELIS_OFFSITE_SECRET_KEY=... \
  bash deploy/bootstrap.sh          # or the curl | sudo bash one-liner
```

可选变量为 `FELIS_OFFSITE_REGION`、`FELIS_OFFSITE_PREFIX` 和 `FELIS_OFFSITE_DB_KEEP`（默认 30）。安装器将 `[offsite]` 写入 `felis.toml`，并将凭据和生成的加密密钥保存在 `/etc/felis/offsite.env`（权限 0600）。

在命令行更换存储桶时，编辑 `/etc/felis/felis.host.toml` 中的 `[offsite]`（新凭据写入 `offsite.env`），然后重新运行安装器。更换存储桶时保持同一密钥，旧副本仍可读取。

### 加密密钥 {#offsite-key}

存储桶中只保存加密对象（AES-256-GCM，按 64 KiB 分段）。没有密钥无法读取。

- 安装器生成的密钥只在终端显示一次，且不写入安装器的输出，因此安装日志中不会出现密钥。没有终端时，安装器输出从 `offsite.env` 读取密钥的命令。
- 面板在「加密密钥」卡片中显示密钥（「显示密钥」「复制密钥」）。在主机上，密钥为 `/etc/felis/offsite.env` 中的 `FELIS_OFFSITE_KEY`。
- 存储桶记录加密所用的密钥：唯一以明文保存的对象 `felis-key-id` 保存密钥 ID（即 `felis offsite status` 输出中的 `key id:` 行），可标识密钥而不泄露密钥本身。
- 之后再次运行安装器会保留该密钥，并拒绝与 `offsite.env` 中不一致的 `FELIS_OFFSITE_KEY`。

主机密钥与存储桶密钥不一致时（例如重装时丢失了 `offsite.env` 并生成了新密钥），每次同步都会在复制或清理任何内容之前停止：安装器以 `OFF-SITE COPY STOPPED` 结束，`felis offsite status` 以 1 退出，面板提示密钥不一致，看门狗立即通知所有者。处理方法：将 `/etc/felis/offsite.env` 中的 `FELIS_OFFSITE_KEY` 改为存储桶的密钥，再执行 `sudo systemctl start felis-offsite.service`；或为 `[offsite]` 指定空的存储桶或前缀，然后重新运行安装器。

::: danger 危险
请将加密密钥保存在密码管理器或其他主机以外的位置。主机与密钥同时丢失时，存储桶中的任何内容都无法恢复。
:::

### 复制的内容 {#offsite-contents}

`felis-offsite.timer` 每小时运行一次 `felis offsite sync`，另有最多 10 分钟的随机延迟。每次同步：

- 复制所有尚未复制的世界归档，随后创建并发送一份列出这些归档的新数据库备份包（标签 `offsite`），确保存储桶中的最新备份包可以恢复其中的全部归档；
- 复制存储桶中缺少的最新数据库备份包，保留 `db_keep` 份（默认 30）；
- 复制平台镜像仓库中的用户镜像：`felis/` 和 `mirror/` 以外的全部仓库，以及服务器或白名单条目按摘要固定的平台镜像修订。镜像列表按版本保存 14 天，误删的镜像在两周内仍可恢复；
- 上传内容保存在本机时，复制投稿上传内容（见[上传存储](/operations/storage#upload-storage)）。上传列表按版本保存 14 天；
- 世界备份被删除且保留期已过时，从存储桶删除对应归档。存储桶中没有任何备份记录对应的归档，在超过最长归档保留期后删除。

存储桶中已存在且大小正确的对象不会重复发送，因此中断的同步可以续传。每个对象有独立的时间限制，即 10 分钟加上按 512 KiB/s 计算的传输时间（10 GiB 约 6 小时）；在此时间内未能发送的对象在下一次同步时重试，本次同步的其余部分照常进行。世界回收只在闲置世界的归档进入存储桶之后才移除该世界。

### 检查同步状态 {#offsite-status}

「异地副本」卡片显示同步状态（「同步正常」或「需要处理」）、「最近成功同步」和最近一次错误。「立即同步」启动一次同步，「校验密钥」对照存储桶校验密钥，「列出存储桶内容」列出存储桶中的备份包、镜像列表和上传列表。

在主机上：

```bash
sudo felis offsite status        # last run, errors, what the bucket holds, what waits
sudo felis offsite list          # the bundles, image lists and upload lists in the bucket, newest first
sudo felis offsite check-key     # whether offsite.env holds the key the bucket was sealed with
sudo journalctl -u felis-offsite -n 50 --no-pager
sudo systemctl start felis-offsite.service   # run one now
```

12 小时内没有完成任何同步时，`status` 以 1 退出。`missing:` 行列出数据库有记录、但数据卷中已不存在的归档，这些归档已无内容可复制。12 小时内没有完成同步时，看门狗通知所有者；存储桶拒绝本机密钥或存储桶被其他主机接管时，立即通知。

### 写入存储桶的主机 {#take-over}

同一时间只有一台主机写入存储桶。每次同步都会重写 `felis-writer`，其中记录该主机。由备份恢复的主机拥有存储桶的密钥和凭据，发现存储桶中记录的是另一台主机后进入待命状态：同步时不复制也不清理任何内容，`felis offsite status` 显示正在写入的主机并以 1 退出，面板提示另一台主机正在写入此存储桶、本机处于待命状态。写入主机在最近 3 小时内运行过时，看门狗暂停待命主机的告警邮件。

要让本机成为写入存储桶的主机，在「异地副本」卡片中选择「接管存储桶」，或执行：

```bash
sudo felis offsite take-over          # names the host the bucket names now
sudo felis offsite take-over -yes
sudo systemctl start felis-offsite.service
```

不带 `-yes` 时，命令显示存储桶记录的主机及其最近写入时间，并以 4 退出。被替代的主机从下一次同步起不再复制，其 `status` 以 1 退出，其看门狗通知所有者 `the off-site copy has stopped`。演练机误接管存储桶时，在生产主机上执行 `sudo felis offsite take-over -yes` 收回。

::: warning 注意
仅在本机永久替代原写入主机时接管存储桶。原主机在下一次同步时即停止复制。
:::

### 关闭异地副本 {#offsite-disable}

在「异地副本」卡片中选择「关闭异地副本」并确认。每小时同步停止，新备份只保存在本机。存储桶中已有的副本和 `/etc/felis/offsite.env` 中的加密密钥会保留。在命令行中，删除 `/etc/felis/felis.host.toml` 中的 `[offsite]` 段，然后重新运行安装器。

### 不使用存储桶 {#no-bucket}

自行定期将数据库备份包目录连同 `.sha256` 校验文件复制到主机之外：

```bash
rsync -a root@felis-host:/var/lib/felis/db-backups/ /backups/felis-db/
```

在目标端执行 `sha256sum -c` 可确认副本完整。此方法仅覆盖数据库。世界归档位于 `/var/lib/rancher/k3s/storage/` 下 `felis-backups` 卷的目录，镜像仓库的镜像位于 `registry` 卷的目录（`*_felis_registry`），上传内容位于 `felis-uploads` 卷的目录（`*_felis_felis-uploads`）。

## 数据库备份 {#database-backups}

控制面数据库以 `felis-postgres` Deployment 运行在 k3s 中，数据位于 `/var/lib/felis/postgres`。它保存世界以外的全部数据：账户、Passkey、Minecraft 账号绑定、服务器归属、配额、审计日志，以及将每个世界归档映射到其所有者的索引。数据库丢失会使所有世界归档失去归属。

### 备份包的创建时机 {#bundle-schedule}

- **每日**：`felis-db-backup.timer` 在 `FELIS_DB_BACKUP_TIME`（默认 `*-*-* 03:30:00`，另有最多 15 分钟随机延迟）运行 `felis db backup`；主机在该时间关机时，开机后补做。安装器在安装过程中创建第一份备份包。
- **每次升级迁移前**：数据库已有数据且有待执行的迁移时，`felis migrate up` 先创建 `pre-migrate` 备份包；该备份失败时不执行任何迁移（`pre-migration backup failed, nothing applied`）。`FELIS_PRE_MIGRATE_BACKUP=0` 可跳过此快照，设置后安装器会给出警告；仅在快照无法执行且已有其他备份时使用，例如外部数据库版本高于主机上的 `pg_dump`。
- **每次恢复前**：为即将被替换的数据库创建 `pre-restore` 备份包。
- **复制了世界归档的异地同步之后**：创建 `offsite` 备份包。
- **按需**：在「维护与备份 → 备份」的「控制面数据库备份」卡片中选择「立即备份」，或执行 `sudo felis db backup`（标签 `manual`）。

在面板中修改每日计划：在「维护与备份 → 备份」的「每日备份计划」卡片中设置「备份时间」（以主机时钟为准）和「保留的每日备份数」（1–365），然后选择「保存计划」。保存后会重写定时任务并立即执行一次备份。这些数值保存在 `/etc/felis/host-settings.env`，之后的安装器运行和更新都会沿用。在命令行中，带 `FELIS_DB_BACKUP_TIME`（任意 systemd 日历表达式，例如每 6 小时一次的 `*-*-* 00/6:30:00`）和相应的 `FELIS_DB_BACKUP_KEEP` 重新运行安装器。缩短间隔可减小数据库的数据丢失窗口；每小时异地同步会在一小时内取走每份备份包。

### 备份包内容与保留 {#bundle-contents}

备份包写入 `FELIS_DB_BACKUP_DIR`（默认 `/var/lib/felis/db-backups`，权限 0700，位于 `/var/lib/rancher` 之外，k3s 重装不会删除它）。每份备份包命名为 `felis-db-<UTC stamp>-<label>.tar`，旁边有一个 `sha256sum` 格式的 `.sha256` 校验文件：

| 成员 | 内容 |
| --- | --- |
| `MANIFEST.json` | 版本、数据库架构版本、`pg_dump --version`、各成员的 sha256。 |
| `db.dump` | `felis` 数据库的 `pg_dump --format=custom` 导出。 |
| `state/etc/felis/...` | `/etc/felis` 中的全部文件：`secrets.env`（数据库密码、转发密钥、调用方令牌和镜像仓库令牌）、`felis.host.toml`、`felis.pod.toml`、`offsite.env`（存储桶凭据和加密密钥）、`smtp-password`、`uploads-s3-access-key` 和 `uploads-s3-secret-key`、面板 TLS 证书与私钥，以及安装器的标记文件。不包含 `bootstrap.done`。 |
| `k8s/minecraftservers.json` | 全部 MinecraftServer，可直接用于 `kubectl apply`。 |

按标签分别保留：`daily` 14 份（`FELIS_DB_BACKUP_KEEP`），`pre-migrate` 10 份，`pre-restore` 5 份，`offsite` 1 份，`manual` 永不自动清理。

::: danger 危险
备份包包含整套安装的全部机密，包括异地加密密钥。备份包及其副本应与 `/etc/felis` 同等保护。
:::

创建备份包时集群无响应，备份包会在缺少 `k8s/minecraftservers.json` 的情况下写入，从该备份包恢复时无法重建任何服务器。此时 `felis db backup` 以 1 退出，面板卡片显示「不完整」，该备份包为最新时看门狗会通知所有者。待 `sudo k3s kubectl get minecraftservers -A` 恢复响应后，重新执行 `sudo felis db backup`。

### 检查时效与校验备份包 {#verify-bundle}

最新每日备份包缺失或超过 26 小时时，「控制面数据库备份」卡片变为红色，`sudo felis db check` 因同样原因以 1 退出，看门狗通知所有者。较新的手动、`pre-migrate` 或 `offsite` 备份包可用于恢复，但不会清除该告警，因为每日定时任务仍处于停止状态。

```bash
sudo felis db list                                   # every bundle with its age
sudo felis db check                                  # exits 1 when the newest daily bundle is stale
sudo systemctl status felis-db-backup.timer          # enabled? next run?
sudo journalctl -u felis-db-backup -n 50 --no-pager   # why the last run failed
sudo systemctl start felis-db-backup.service         # run the daily backup now; clears the alarm
```

校验备份包：在「本机数据库备份」卡片中选择对应备份包旁的「校验」，或执行：

```bash
sudo felis db verify felis-db-20260924T033012Z-daily.tar   # bare names resolve in the backup dir
sha256sum -c felis-db-20260924T033012Z-daily.tar.sha256    # on a copy, without felis
```

`verify` 检查校验文件、按清单核对每个成员，并确认没有缺失或未列出的成员，不会改动数据库。数据库本身不可用时，见[故障排查](/operations/troubleshooting#database-unavailable)。

### 删除备份包 {#delete-bundle}

写入新备份包时，各类备份包按数量自动清理；手动备份包一直保留，直到手动删除。要删除备份包，在「本机数据库备份」卡片中选择其旁的删除图标并确认，或执行：

```bash
sudo felis db delete felis-db-20260924T033012Z-manual.tar
```

该备份包及其 `.sha256` 文件将从本机删除。最新的一份备份包是最近的恢复点，不能删除。异地存储桶中的副本不受影响。

## 恢复数据库 {#restore-database}

恢复操作用备份包的内容替换所有数据表，用于在原主机上撤销误操作。世界数据卷和归档不在备份包中，保持不变；备份包创建之后新建的服务器保留其世界数据卷，但会失去所有者记录。回滚升级请按[回滚](/operations/upgrade#rollback)操作。

::: danger 危险
备份包创建之后写入数据库的全部内容都会丢失，包括新账户、归属变更和审计记录。恢复期间面板与 operator 停止运行，完成后所有用户需重新登录。恢复操作事先创建的 `pre-restore` 备份包可用于撤销本次恢复。
:::

在面板中：

1. 打开「维护与备份 → 备份」。
2. 在「本机数据库备份」中选择对应备份包旁的「恢复」。
3. 输入备份包名称确认，然后选择「恢复」。

该任务校验备份包、停止面板与 operator、恢复数据库（事先创建 `pre-restore` 备份包）、执行当前版本的迁移，然后重新启动面板与 operator。

在主机上：

```bash
kubectl -n felis scale deployment felis-api felis-operator --replicas=0
sudo felis db restore -yes felis-db-20260924T033012Z-daily.tar
sudo felis migrate up -config /etc/felis/felis.host.toml
kubectl -n felis scale deployment felis-api felis-operator --replicas=1
```

- 不带 `-yes` 时，`restore` 打印备份包内容并以 2 退出。
- 存在其他数据库连接时拒绝执行（`other clients are connected to the database (N)`），并打印缩容命令。确认连接空闲时，可用 `-force` 强制执行。
- 重放在单个事务中完成。任何失败都会回滚，数据库保持原样（`rolled back, the database is unchanged`）。
- 撤销恢复时，恢复其输出中指明的 `pre-restore` 备份包。
- `migrate up` 将较旧备份包的数据库架构升级到当前运行的版本。启动时不会自动迁移，因此只有回退到创建该备份包的版本时才跳过此步骤。

## 从异地副本重建主机 {#rebuild-host}

主机或其磁盘丢失后，全新安装加上异地存储桶即可恢复 Felis。重建需要异地副本（或从原主机复制出的备份包）；从存储桶恢复时还需要原主机的加密密钥。

### 可恢复的内容 {#rebuild-scope}

| 数据 | 恢复来源 | 最多损失 |
| --- | --- | --- |
| 控制面数据库 | 存储桶中的最新备份包 | 该备份包之后的变更：按每日定时任务计算，最多一天加一小时 |
| 主机状态（`/etc/felis`） | 每份备份包内 | 同数据库 |
| MinecraftServer 对象 | 每份备份包内 | 同数据库 |
| 世界归档 | 存储桶 | 最近一小时内写入的归档 |
| 实时世界 | 仅以其最新归档的形式 | 该世界最新归档之后的全部变化 |
| 用户镜像 | 存储桶 | 最近一小时内推送的镜像 |
| 投稿上传内容 | 存储桶 | 最近一小时内的上传 |
| Cloudflare Tunnel 连接器 | 配置在每份备份包内；`felis setup` 的 Cloudflare 步骤重新创建连接器 | 无；隧道、DNS 记录和 Access 应用保存在 Cloudflare |
| 平台镜像、Velocity、JRE、构建工具、k3s | 安装器重新安装 | 无 |

世界的当前状态只存在于其数据卷中。自上次恢复点以来有人游玩的世界，通常有一份不早于 `scheduled_every`（默认一天）的恢复点。从未归档过的世界恢复后为空世界。世界最新归档的时间（显示在服务器备份页面）即该世界的恢复点。

重建耗时主要取决于传输：先在空白主机上运行安装器，再恢复数据库（数秒至数分钟），然后按存储桶的下载速度传输镜像、上传内容和世界归档。`sudo felis offsite status` 显示存储桶中的数据量。

### 一条命令完成重建 {#rebuild-one-command}

在新主机上，向安装器提供原安装的存储桶、凭据和密钥（原安装设置过 `FELIS_OFFSITE_REGION` 和 `FELIS_OFFSITE_PREFIX` 时一并提供），并请求重建：

```bash
FELIS_OFFSITE_ENDPOINT=https://s3.example.com FELIS_OFFSITE_BUCKET=felis-backups \
FELIS_OFFSITE_ACCESS_KEY=... FELIS_OFFSITE_SECRET_KEY=... FELIS_OFFSITE_KEY=... \
FELIS_RESTORE_FROM_OFFSITE=1 FELIS_RESTORE_TAKE_OVER=1 \
  bash deploy/bootstrap.sh          # or the curl | sudo bash one-liner
```

- 缺少上述五个 `FELIS_OFFSITE_*` 值中的任意一个时，安装器拒绝 `FELIS_RESTORE_FROM_OFFSITE=1`；在已安装 Felis 的主机上同样拒绝。
- `FELIS_RESTORE_BUNDLE` 指定比最新备份包更早的备份包（`felis-db-<stamp>-<label>.tar`，见 `felis offsite list`）。
- 演练机不要设置 `FELIS_RESTORE_TAKE_OVER`。
- 安装完成后、输出摘要和打开设置控制台之前，安装器运行 `felis restore-host -yes`，因此设置控制台能找到原安装的所有者。
- 重建中途停止时，安装器输出 `the rebuild stopped before it finished; fix the cause above and run: sudo felis restore-host -yes`。该命令从停止处继续；安装时设置了 `FELIS_RESTORE_TAKE_OVER=1` 时，追加 `-take-over`。

### 重建已安装的主机 {#restore-host}

已完成安装且尚无服务器的主机，可在面板中或用 `felis restore-host` 重建。

在面板中：

1. 在「维护与备份 → 异地副本」中配置原存储桶，并在「加密密钥（可选）」中填写原主机的密钥（见[配置异地副本](#offsite-configure)）。本机发现存储桶中记录的原主机后进入待命状态。
2. 在「从异地副本重建」中，「数据库备份（可选）」留空则使用最新备份包，也可填写「列出存储桶内容」中显示的备份包名称。
3. 保持「完成后接管存储桶」开启；若本机仅用于演练且原主机继续运行，则关闭此项。
4. 仅当本安装已有服务器且允许替换其数据时，开启「覆盖现有服务器」。
5. 选择「开始重建」，输入「重建」确认。

在主机上以 root 执行：

```bash
sudo felis restore-host                      # the steps; nothing changes
sudo felis restore-host -yes                 # rebuild, leaving the bucket to the old host
sudo felis restore-host -yes -take-over      # rebuild, then make this host write the bucket
```

该命令按[手动重建](#rebuild-manual)的步骤执行，直至接管存储桶：

| 步骤 | 作用 | 对应手动步骤 |
| --- | --- | --- |
| `fetch_db` | 用 `felis offsite fetch-db` 将最新备份包（或 `-bundle <name>` 指定的备份包）取到 `/var/lib/felis/restore-host` | 1 |
| `images` | `felis offsite fetch-images` | 4 |
| `uploads` | `felis offsite fetch-uploads -adopt-volume`：新主机尚未设置 S3 上传存储时，先改为本机卷存放 | 5 |
| `database` | 将 felis-api 和 felis-operator 缩容至 0，执行 `felis db restore -yes -no-safety-backup` 和 `felis migrate up`，再恢复两者，并最多等待 felis-api 5 分钟 | 6 |
| `servers` | 应用备份包中的 `k8s/minecraftservers.json`：仅用户服务器，每台均为 `Stopped`，并去除原集群的节点分配、卷声明名称、锁和进行中标记 | 6 |
| `system_servers` | `felis converge`：创建本安装缺少的登录空间和大厅（小内存配置只有登录空间） | 6 |
| `worlds` | `felis offsite fetch-worlds` | 7 |
| `restore_worlds` | 通过 felis-api 为每台服务器恢复最新的完好备份，并等待其恢复 Job（每台最多 2 小时）；没有备份的服务器保持空世界 | 7 |
| `take_over` | `felis offsite take-over -yes`，仅在指定 `-take-over` 时执行 | 8 |

- **可续跑。** 每步完成后记录在 `/var/lib/felis/restore-host/state.json`，中途中断的运行（SSH 断开、存储桶超时）可从停止处继续。数据库只恢复一次，重跑不会覆盖重建后的安装此后写入的内容。
- **仅限全新安装。** 执行数据库步骤前，若数据库中已有服务器则拒绝执行；`-force` 会覆盖恢复。
- **失败的世界会重试。** 恢复失败的服务器连同原因列出，该步骤失败；下次运行只重试尚未恢复的服务器。
- **本机保留自身的主机状态。** 该命令不放回旧的 `/etc/felis`：安装器已生成新的机密，本机保留自己的根域名、`[smtp]` 中继、上传存储桶密钥和隧道配置。所有者在面板中保存的邮件中继、保留策略和心跳随数据库一并恢复。如需同时沿用原主机的状态，在运行安装器之前按[手动重建](#rebuild-manual)第 2 步放回。
- **运行结束时**输出每个世界来自哪份备份，以及剩余的手动步骤：第 9 步（邮件）、第 10 步（将域名指向本机并执行 `felis domain set`；或保留本机地址，此时在旧地址注册的 Passkey 失效，相关用户需通过邮件验证码登录并重新注册），第 11 步（Cloudflare 隧道），未指定 `-take-over` 时还有第 8 步。接管后执行 `sudo systemctl start felis-offsite.service`，可在每小时定时任务之前发送本机的首份副本。

参数：`-yes`（不带时只打印步骤，不做任何修改）、`-bundle <name>`、`-take-over`、`-force`、`-dir`（默认 `/var/lib/felis/restore-host`）和 `-config`（默认 `/etc/felis/felis.toml`）。数据库尚未恢复时，以不同的 `-bundle` 重跑会改用该备份包；数据库恢复后，重跑会拒绝并指出数据库来源的备份包。删除 `/var/lib/felis/restore-host/state.json` 可重新开始。

::: danger 危险
`-force`（「覆盖现有服务器」）会用异地副本替换当前安装的数据库和服务器，当前安装原有的全部内容都会丢失。
:::

### 手动重建 {#rebuild-manual}

以下编号步骤说明 `felis restore-host` 执行的具体操作，也用于在没有存储桶时从原主机复制出的备份包重建，以及完成该命令未能完成的步骤。请保持以下顺序：主机状态在安装器之前放回，使安装器沿用原有机密和存储桶；镜像在数据库之前恢复，使恢复的服务器能找到其固定的镜像摘要；世界在服务器之后恢复，因为恢复需要目标服务器；邮件在迁移域名之前检查，因为 Passkey 失效后需要通过邮件验证码登录。

1. 获取最新备份包。从存储桶获取时，可在任何能访问存储桶的机器上，使用相同或更新版本的任意 `felis` 二进制（发布版附件 `felis-linux-<arch>` 可单独运行）：

   ```bash
   export FELIS_OFFSITE_ACCESS_KEY=... FELIS_OFFSITE_SECRET_KEY=... FELIS_OFFSITE_KEY=...
   sudo -E felis offsite fetch-db -endpoint https://s3.example.com -bucket felis-backups \
        [-region ...] [-prefix ...] latest
   ```

   该命令将备份包写入 `/var/lib/felis/db-backups`（可用 `-dir` 修改），完成校验后显示备份包名称、创建时间、创建时的版本与数据库架构，以及其中的账户数和服务器数。继续之前请核对这些信息。密钥错误时提示 `object does not decrypt with this key`，不写入任何文件。自行复制的备份包，用 `sha256sum -c felis-db-....tar.sha256` 检查。

   `latest` 指最新备份包；但若最新备份包中没有服务器且最多只有一个账户，而更早的备份包内容更多，则不采用它。这种备份包来自尚未恢复数据就接管了存储桶的重建主机，因此 `fetch-db latest` 拒绝它，并列出最多三个更早的备份包及其数量。此时用备份包名称代替 `latest` 获取所需的备份包；`felis offsite list` 列出全部备份包。

2. **在安装之前**放回原主机的状态，使安装器沿用相同的数据库密码、调用方令牌、转发密钥、邮件中继密码、上传存储桶密钥，以及带凭据和密钥的 `[offsite]` 存储桶：

   ```bash
   sudo install -d -m 0700 /etc/felis
   sudo tar -xpf felis-db-....tar -C / --strip-components=1 state/etc/felis
   ```

3. 按首次安装的方式运行安装器（见[安装与部署](/guide/deployment#install)）。安装器使用恢复的密码创建空数据库并执行迁移；发现恢复的配置中有 `[offsite]` 后重新开启每小时同步，识别到另一台主机正在写入存储桶，于是保持待命直至第 8 步，并以 `OFF-SITE COPY ON STANDBY` 结束。

4. 将用户镜像推回新的镜像仓库：

   ```bash
   sudo felis offsite fetch-images
   ```

   该命令恢复存储桶中最新的镜像列表（更早的列表用 `-at <stamp>` 指定，`felis offsite list` 可查看），按摘要校验每个清单和镜像层，只推送镜像仓库缺少的内容。恢复的镜像按新推送处理，保留 24 小时；请在此期间完成数据库步骤，使恢复的服务器和白名单条目继续引用这些镜像。若新主机已接管存储桶并记录了其空的镜像仓库，`fetch-images` 会拒绝该最新列表，并提示应通过 `-at` 指定的版本；`fetch-uploads` 同理。

5. 恢复投稿上传内容：

   ```bash
   sudo felis offsite fetch-uploads
   ```

   该命令将最新上传列表（更早的列表用 `-at <stamp>` 指定）中的每个上传写入 `felis-uploads` 卷，逐个核对 sha256，已存在的上传保持不变。旧主机从未有过上传内容时，存储桶中没有上传列表，命令报告无需恢复并正常结束。只有使用本机卷存放上传内容的主机才会把上传复制到存储桶；`felis restore-host` 在新主机尚未设置 S3 上传存储时，先将其改为本机卷存放，再写回上传内容。

6. 恢复数据库并重建服务器：

   ```bash
   kubectl -n felis scale deployment felis-api felis-operator --replicas=0
   sudo felis db restore -yes -no-safety-backup /var/lib/felis/db-backups/felis-db-....tar
   sudo felis migrate up -config /etc/felis/felis.host.toml
   kubectl -n felis scale deployment felis-api felis-operator --replicas=1
   tar -xOf felis-db-....tar k8s/minecraftservers.json | kubectl apply -f -
   ```

   `tar` 提示 `Not found in archive` 时，表示该备份包缺少 MinecraftServer 对象。获取 `felis offsite list` 中未标注 `no MinecraftServer objects` 的最新备份包，改为应用其中的 `k8s/minecraftservers.json`；该备份包未列出的服务器无法恢复。

7. 将世界归档取回归档卷：

   ```bash
   sudo felis offsite fetch-worlds
   ```

   该命令获取恢复后的数据库中记录为存在、而归档卷中缺少的全部归档；归档卷尚未被使用时会先创建 `felis-backups` 卷，并列出在存储桶中找不到的归档。随后在服务器备份页面从归档恢复各个世界（见[恢复与导出世界](#restore-worlds)）。

8. 让本机成为写入存储桶的主机，并发送首份副本（见[写入存储桶的主机](#take-over)）：

   ```bash
   sudo felis offsite take-over          # names the host the bucket names now
   sudo felis offsite take-over -yes
   sudo systemctl start felis-offsite.service
   ```

   演练机跳过此步骤。

9. 原主机配置过邮件中继时，确认本机能够发送邮件。执行 `sudo felis setup`，在状态页按 `e`（configure email），重新输入密码后保存预填的中继。保存时会向 From 地址发送一封测试邮件，邮件送达后才写入配置。按发件地址放行的中继，或列出原主机地址的 SPF 记录，会拒绝本机或使邮件进入垃圾箱，应在其中加入新地址。所有者在面板中保存的中继已在第 6 步随数据库恢复，并处于生效状态；面板可访问后，在「平台设置 → 通知与保留 → 邮件服务」中使用「发送测试邮件」检查。没有任何中继且所有者无法登录时，使用 `sudo felis breakGlass` 恢复访问（见[应急访问](/operations/access#break-glass)）。

10. 安装的域名仍指向原主机时，将其迁移到本机。安装器沿用了备份包中的根域名（日志显示 `(reusing the installed domain)`）。

    - 默认的 `<旧地址>.nip.io` 域名始终解析到原地址，需要迁移：

      ```bash
      sudo felis domain set <new-address>.nip.io       # the plan
      sudo felis domain set -yes <new-address>.nip.io
      sudo felis domain check
      ```

      执行计划会统计将失效的 Passkey；相关用户通过邮件验证码登录后重新注册。详见[更换根域名](/operations/access#change-domain)。
    - 自有域名保持不变，将其记录指向新地址：`<root>`、`*.<root>`、`console.<root>` 和 `op.console.<root>`；由 Cloudflare 隧道提供面板时，只需修改 `<root>` 和 `*.<root>`。继续之前，用 `dig +short <name>` 逐一确认。

11. 原主机通过 Cloudflare 隧道提供面板时，恢复连接器。本机运行连接器之前，面板域名返回 Cloudflare 1033 错误。执行 `sudo felis setup`，在状态页按 `n`（change connection），选择 Cloudflare Tunnel + Access。在第一个界面按 `i` 安装 cloudflared，按 `l` 执行 `cloudflared tunnel login`；两者完成后按 `enter` 打开表单。填写 API 令牌和账户 ID，以及与原来相同的允许身份、域名和隧道名称（隧道名称默认为 `felis`）。该步骤按名称找到现有隧道和 Access 应用，安装并启动 `cloudflared-felis`，隧道可用后关闭面板的 NodePort。使用不同的隧道名称会新建第二条隧道，之后应在 Cloudflare 控制台删除旧隧道。演练机跳过此步骤。

### 检查重建结果 {#rebuild-checks}

允许玩家进入之前：

```bash
sudo felis db check                     # the database answers and has a fresh bundle
kubectl get minecraftservers -A         # every server the bundle held
kubectl -n minecraft get pods           # servers pull their pinned images (no ImagePullBackOff)
sudo felis offsite status               # the hourly copy runs from this host again
sudo felis domain check                 # every name, the certificate and the tunnel on the new address
```

通过面板域名访问面板：

1. 使用原有账户登录。账户和 Passkey 随数据库恢复，第 10 步统计为失效的 Passkey 除外。
2. 退出登录，再以邮件验证码登录一个能收取邮件的所有者账户。验证码送达即证明 felis-api 能够通过中继投递邮件。
3. 打开一台已恢复服务器的备份页面，确认归档已列出，恢复最新的一份，启动服务器并通过 `<name>.<root>` 加入。

### 演练重建 {#rehearsal}

每个版本在备用机器上演练一次，是确认安装恢复时间的可靠方法。记录 `sudo felis offsite status` 显示的存储桶数据量以及存储桶的下载速度。

- 重建时不要接管存储桶：运行不带 `-take-over` 的 `felis restore-host`、不设置 `FELIS_RESTORE_TAKE_OVER` 的安装器、关闭「完成后接管存储桶」的面板重建，或跳过第 8 步和第 11 步的手动步骤。
- 备用机器发现存储桶中记录的生产主机后进入待命状态：不向存储桶复制任何内容，不清理其中的内容；生产主机持续写入期间，也不向其恢复的数据库中的所有者发送邮件。
- 不要改动 Cloudflare 隧道：在生产隧道上增加第二个连接器会分走部分真实访问。通过备用机器自身的地址访问（第 10 步将其迁移到 `nip.io` 域名）。此时 `felis domain check` 的隧道检查项会失败，这在演练机上属于预期结果。
- 按[检查重建结果](#rebuild-checks)确认：以邮件验证码登录，恢复一个世界并加入。

::: warning 注意
演练机不得接管存储桶。一旦接管，生产主机会停止复制；此时在生产主机上执行 `sudo felis offsite take-over -yes` 收回存储桶。
:::

## 迁移到另一台主机 {#move-host}

计划迁移即在原主机仍可提供最终副本的情况下执行重建。迁移需要异地存储桶，世界归档经由存储桶传送到新主机。从第 1 步开始平台停止服务，直到新主机提供服务为止。

::: warning 注意
第 1 步会断开所有玩家，此后原主机上的服务器均无法启动。
:::

1. **在原主机上**停止一切会改变世界的操作，然后发送最终副本：

   ```bash
   sudo install -d -m 0755 /run/felis
   echo $(( $(date +%s) + 4 * 3600 )) | sudo tee /run/felis/watchdog-quiet-until
   sudo systemctl stop felis-velocity                                   # no joins, so no server wakes
   sudo felis backup-now -yes -stop                                     # every world archived; the servers stay stopped
   sudo k3s kubectl -n felis scale deploy/felis-operator --replicas=0   # nothing starts a server from here on
   sudo felis db backup                                                 # a bundle that lists those archives
   sudo systemctl start felis-offsite.service
   sudo felis offsite status                                            # again until nothing waits
   ```

   请保持此顺序。新主机按恢复后的数据库所列出的归档获取数据，因此数据库备份必须在最后一个归档之后创建。`backup-now` 使用 `-stop`，确保归档后世界不再变化。`backup-now` 需要 operator 停止服务器，因此在其之后才停止 operator。静默标记使看门狗在接下来 4 小时内不因代理和 operator 停止而通知所有者；在「维护与备份 → 状态」中使用「暂停告警邮件」效果相同（见[暂停告警邮件](/operations/monitoring#hold-alerts)）。

2. **在新主机上**从存储桶重建：运行安装器，同时提供 `FELIS_RESTORE_FROM_OFFSITE=1`、`FELIS_RESTORE_TAKE_OVER=1`、原安装的 `FELIS_OFFSITE_*` 设置和 `FELIS_OFFSITE_KEY`（见[一条命令完成重建](#rebuild-one-command)），或从第 1 步开始按[手动重建](#rebuild-manual)操作。两种方式取得的最新备份包都是原主机刚刚发送的那份。接管使新主机成为写入存储桶的主机，此后原主机不再复制。一条命令的方式不会带入原主机的 `/etc/felis`，除非事先放置到位（手动重建第 2 步），因此新主机在执行 `felis domain set` 之前保留自身的根域名。手动重建的第 10、11 步用于迁移域名和隧道。

3. **在宣布迁移完成之前检查新主机**：以邮件验证码登录，恢复一个世界并加入，并确认 `sudo felis offsite status` 显示较新的 `last success`，且没有待命提示。

4. **退役原主机。** 原主机保存着存储桶之外每个世界的最后副本，因此先连同磁盘关机保留数日，并禁用其服务，确保开机后不会自动启动任何内容：

   ```bash
   sudo systemctl disable k3s felis-velocity felis-watchdog.timer felis-offsite.timer \
       felis-db-backup.timer felis-update-check.timer felis-build-tools.timer
   sudo poweroff
   ```

   之后卸载（见[卸载与重装](/operations/uninstall#uninstall)）或清空该主机。
