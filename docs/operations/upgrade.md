---
title: 升级
description: 使用 felis update 检查和应用更新、设置维护窗口、管理组件版本、升级 PostgreSQL 大版本以及回滚失败的升级。
---

# 升级 {#upgrade}

本页面向运维人员，说明如何检查并应用 Felis 更新、更新期间会重启哪些组件、如何管理 Felis 之外的配套组件版本、如何跨越 PostgreSQL 大版本，以及升级失败后如何回滚。安装通道的区别见[安装与部署](/guide/deployment#channels)。

## 检查与应用更新 {#update}

`felis update` 默认只做检查，不修改主机。它报告各组件的已安装版本与上游可用版本，解析 Felis 的目标版本，下载与该目标匹配的安装器并检查其语法，最后打印一条明确的应用命令。

```bash
sudo felis update                        # 检查最新稳定发布版
sudo felis update --all                  # 同时规划发布版固定的 k3s 与 cloudflared 升级
sudo felis update --version v0.2.0       # 检查指定的已发布版本
sudo felis update --dev                  # 检查 main 分支的最新提交
sudo felis update --ref <commit-or-tag>  # 检查指定的源码版本
```

上游版本表仅供参考。应用时统一采用目标版本中相互兼容的固定版本，不会逐个安装各组件的上游最新版；用户服务器的游戏镜像保持不变。`--k3s`、`--cloudflared`、`--jre`、`--postgres` 等选项只缩小报告范围；应用任一核心组件都会收敛整个平台组件包。

应用更新：

1. 在「维护与备份 → 版本更新」设置[维护窗口](#maintenance-window)。
2. 执行检查，确认输出中的目标版本、完整提交、影响范围和重启影响。
3. 在维护窗口内原样执行检查打印的 `--apply` 命令。发布版的命令带 `--version <tag> --expect-commit <完整 SHA>`，标签被移动时拒绝执行；源码版本的命令带 `--ref <完整 SHA>`。

```bash
sudo felis update --apply --version v0.2.0 --expect-commit <完整 SHA>
```

应用过程依次执行以下步骤，任一步失败即停止：

1. 检查维护窗口。
2. 备份数据库、`/etc/felis` 和全部 MinecraftServer 资源，生成一个 `pre-migrate` 数据库备份包。备份失败时不做任何修改。
3. 再次检查维护窗口。
4. 运行目标版本的安装器，收敛 `felis` 命令、API、operator 与面板、清单与 RBAC、游戏插件、游戏代理和系统服务器镜像，并实时输出安装器进度。安装器的部署就绪检查决定更新是否成功。
5. 校验已安装的 `felis` 版本与目标一致。

其他选项：

- `--force` 重新安装同一版本，或允许有意降级 Felis；降级到更早的发布版时必须指定。它不会跳过维护窗口、备份或组件兼容性检查。
- `--all` 同时执行发布版固定的 k3s 和 cloudflared 升级，见[组件版本](#component-versions)。

`felis update -h` 中没有 `--apply` 的旧版 `felis` 须先运行一次安装器以获得此更新器。在已完成的安装上，`sudo felis setup` 只打开配置控制台，不能用于升级。

::: warning 注意
应用更新时，API、游戏代理和系统服务器可能重启：面板短暂不可用，代理重启会断开所有在线玩家。在维护窗口内、玩家较少时应用。
:::

### 更新期间的重启 {#restarts}

安装器只在组件运行的内容发生变化时重启它：

| 组件 | 重启条件 |
| --- | --- |
| 游戏代理 `felis-velocity` | 其单元、Java 运行时、`velocity.jar`、`velocity.toml`、转发密钥、felis-link 设置（插件自动重新读取的 `service-token` 除外）或插件 jar 发生变化，或服务未运行。指纹记录在 `/etc/felis/velocity.fingerprint`，删除该文件可强制重启。 |
| 登录空间与大厅的 Pod | 重新构建的 Limbo 或大厅镜像 ID 发生变化（记录在 `/etc/felis/system-server-images`）。安装器将该服务器的镜像固定到新摘要，由 operator 逐个更新 Pod；镜像仓库不可达时直接重建 Pod。 |
| felis-postgres | 发布版更换了 PostgreSQL 镜像或修改了 Pod，API 随之暂停数秒。 |
| felis-api、felis-operator、镜像仓库 Pod | 镜像标签发生变化（升级），或同版本重新运行时重新构建了镜像。 |

felis-api 和 felis-operator 均为单副本、Recreate 策略，升级期间面板和 API 暂停，通常为数秒，需要导入镜像时更久。新 Pod 无法启动（例如镜像缺失）时，安装器在 180 秒后报告部署失败，并打印 `kubectl describe` 诊断，其中可见 `ErrImagePull` 或 `ImagePullBackOff`。

平台升级不重启运行中的游戏服务器。游戏服务器的初始化容器也使用 Felis 镜像，运行中的服务器保留启动时的版本，下次启动时使用新版本。若发布版以其他方式修改了游戏 Pod，运行中的服务器会像编辑服务器设置后一样重启一次。

## 维护窗口 {#maintenance-window}

维护窗口决定 `felis update --apply` 何时可以执行。在「维护与备份 → 版本更新」的「配置维护窗口」中设置：

1. 选择「开始时间」和「结束时间」。时间按浏览器的本地时区选择和显示；结束时间必须晚于开始时间。
2. 选择「保存维护窗口」。「清除维护窗口」删除已设置的窗口。

窗口状态显示为「当前生效中」「已计划（未来）」「已过期（过去）」或「未设置」。

应用更新时，`felis update` 在备份前和安装前各读取一次窗口：

- 窗口未设置、尚未开始或已结束时，拒绝应用。
- `--apply --now` 显式开始一次临时维护，不使用已设置的窗口。
- 无法读取窗口时始终拒绝，`--now` 也不例外。
- `--force` 不会跳过窗口检查。
- 每日定时检查（`felis update --record`）从不应用更新。

直接运行安装器时不检查维护窗口，应自行安排在玩家较少的时段。

## 开发通道 {#dev-channel}

使用开发通道（`FELIS_VERSION_BOOTSTRAP=dev`）安装的主机跟随 main 分支，从源码构建。检查和应用开发版本：

```bash
sudo felis update --dev
```

检查打印 main 最新提交的完整 SHA，以及一条带 `--ref <完整 SHA>` 的应用命令，该命令固定为检查时的提交。`--apply --dev` 则在执行时重新解析 main 的最新提交，仅在有意如此时使用。

也可以直接重新运行安装器升级。重新运行会保留已安装的根域名，但须再次指定通道，否则安装器按默认的发布通道安装：

```bash
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo FELIS_VERSION_BOOTSTRAP=dev bash
```

源码构建需要在主机上构建镜像的资源，见[环境要求](/guide/requirements#preflight)。

## 组件版本 {#component-versions}

`felis-update-check.timer` 每天约 05:30 运行 `felis update --record`（错过时在开机后补执行），结果显示在面板「维护与备份 → 版本更新」的「组件版本」卡片中：每个组件的已安装版本和更新版本；有更新时给出 `sudo felis update --<组件>` 命令，该命令打印应用方法。Felis 不会自动应用任何更新。最近一次记录超过 26 小时未更新时，卡片显示「检查已逾期」，说明定时任务已停止：

```bash
systemctl list-timers felis-update-check.timer
journalctl -u felis-update-check -n 50 --no-pager
sudo felis update --record   # 立即记录一次检查
```

更新器复用安装器收敛 Felis 及其核心组件。安装器安装的其他组件按下表处理：

| 组件 | 重新运行安装器时 | 升级方式 |
| --- | --- | --- |
| Velocity、Limbo、Paper、LuckPerms | 跟随发布版的游戏组件锁定文件（`deploy/game-stack.lock`） | 发布版更新锁定文件后重新运行安装器或应用更新 |
| Temurin Java 运行时 | 安装器安装的运行时更新到固定的补丁版本；其他来源的运行时保持不变 | 重新运行安装器 |
| k3s | 保持现有版本 | `FELIS_UPGRADE_DEPS=1` 重新运行安装器，或 `felis update --all`：通过固定版本的安装脚本升级，每次只升一个 minor 版本，从不降级 |
| cloudflared | 保持现有版本 | `FELIS_UPGRADE_DEPS=1` 或 `felis update --all`：将 `/usr/local/bin/cloudflared` 替换为已校验 sha256 的固定版本并重启 `cloudflared-felis`；发行版软件包安装的 cloudflared 仍由包管理器维护 |
| PostgreSQL | 跟随发布版固定的镜像 | minor 版本随 Felis 发布版更新，重新运行时重启 felis-postgres，API 暂停数秒；major 版本见 [PostgreSQL 大版本升级](#postgresql-major) |
| Docker、git、nftables | 发行版软件包 | 包管理器 |

当前发布版固定的版本：

| 组件 | 固定版本 | 安装器变量 |
| --- | --- | --- |
| k3s | v1.36.4+k3s1 | `FELIS_K3S_VERSION` |
| cloudflared | 2026.9.1 | `FELIS_CLOUDFLARED_VERSION`；其他版本须同时提供 `FELIS_CLOUDFLARED_SHA256` |
| Temurin Java 运行时（游戏代理） | 25（25.0.4.1+1） | `FELIS_JRE_VERSION` |
| PostgreSQL | 18.6，官方 `postgres` 镜像按摘要固定 | — |

k3s 跨越多个 minor 版本时，安装器在修改前停止，并提示先将 `FELIS_K3S_VERSION` 设为下一个 minor 版本的最新发布。

游戏组件锁定文件固定登录空间、大厅、普通 Paper 镜像和游戏代理所用的上游构建及其 sha256，因此同一发布版在每台主机上构建出相同的镜像。`FELIS_GAME_STACK=latest` 改为在安装时解析上游最新构建并在主机上构建，`FELIS_VELOCITY_VERSION=<minor>` 安装指定 minor 版本的最新 Velocity 构建。已创建的服务器固定在创建时的镜像摘要上，不会随平台镜像变化；将世界迁移到新的 Minecraft 版本见[游戏镜像](/operations/troubleshooting#game-images)。

## PostgreSQL 大版本升级 {#postgresql-major}

felis-postgres 的数据库集群位于 `/var/lib/felis/postgres/<major>/docker`。发布版将镜像换到新的 major 版本时，安装器发现旧版本的集群后会在修改前停止，以免新服务器在旁边创建空集群。升级方法是在当前发布版上创建备份包，再恢复到新 major 版本的空集群中。

::: warning 注意
以下步骤会停止面板和全部服务器管理功能，直到恢复完成。在维护窗口内执行，并保留旧集群目录作为回退手段。
:::

1. 在当前运行的发布版上创建备份包，停止数据库，并将旧集群移开：

   ```bash
   b="$(sudo felis db backup -label pre-upgrade | sed -n 's/^felis db backup: wrote //p')"
   sudo k3s kubectl -n felis scale deploy/felis-postgres --replicas=0
   sudo mv /var/lib/felis/postgres/18 /var/lib/felis/postgres-18.old
   ```

2. 安装新发布版。它在新 major 版本上创建空集群并建立数据库结构：

   ```bash
   curl -fsSL <安装器地址> | sudo bash
   ```

3. 恢复数据，并将数据库结构迁移到新发布版：

   ```bash
   sudo k3s kubectl -n felis scale deploy/felis-api deploy/felis-operator --replicas=0
   sudo felis db restore -yes -no-safety-backup "$b"
   sudo felis migrate up -config /etc/felis/felis.host.toml
   sudo k3s kubectl -n felis scale deploy/felis-api deploy/felis-operator --replicas=1
   ```

新版本稳定运行一段时间后，删除 `/var/lib/felis/postgres-18.old`。需要回退时，将 felis-postgres 缩容到 0，把新 major 版本的目录移出 `/var/lib/felis/postgres`，将 `postgres-18.old` 移回为 `/var/lib/felis/postgres/18`，再重新运行旧发布版的安装器。备份包的内容与恢复规则见[恢复数据库](/operations/backup#restore-database)。

## 升级旧安装 {#older-installs}

### 补全旧安装的配置 {#refresh-old-install}

安装中有三部分保留创建时的状态，`felis setup` 和 `kubectl rollout restart` 都不会更新它们：felis-api 的 Deployment（后来新增的环境变量，例如 `FELIS_SMTP_PASSWORD`，在重新渲染前不存在）、大厅镜像（早期构建不含 LuckPerms，面板中的每次权限修改都返回 `luckperms_missing`），以及 MinecraftServer 资源（后来新增的字段保持为空）。按以下顺序更新，先更新镜像：

1. 重新运行安装器。它渲染并应用控制面配置，重新构建并导入登录空间和大厅镜像，并重建这两个 Pod；`felis setup` 写入的 `[smtp]` 中继保持不变。
2. 为系统服务器补全新增的字段，再为 RCON 成为默认设置之前创建的用户服务器启用 RCON：

   ```bash
   sudo felis converge
   sudo felis converge -user-rcon
   ```

   ::: warning 注意
   `-user-rcon` 要求服务器镜像开启 RCON 监听；镜像不支持 RCON 时，服务器可能无法启动。仅对支持 RCON 的镜像执行。用户服务器在下次启动时应用新的 RCON 设置。
   :::

面板中的对应操作是「平台设置 → 访问与安全」→「系统服务器补全」。检查各部分：

```bash
sudo k3s kubectl -n felis get deploy felis-api \
  -o jsonpath='{.spec.template.spec.containers[0].env[*].name}' | tr ' ' '\n' | grep SMTP
sudo k3s kubectl -n minecraft exec lobby-0 -- ls /data/plugins | grep -i luckperms
sudo k3s kubectl -n minecraft get minecraftserver \
  -o custom-columns=NAME:.metadata.name,RCON:.spec.rcon.enabled,IDLE:.spec.idle.autoStopEnabled
```

环境变量只携带邮件中继的密码，中继本身仍需配置，见[邮件中继](/operations/monitoring#mail-relay)。系统服务器字段的说明见[系统服务器配置](/operations/troubleshooting#system-server-fields)。

### 宿主机 PostgreSQL 迁入 k3s {#database-move}

早期发布版将数据库运行在安装器安装于宿主机的 PostgreSQL 上。首次在这类主机上重新运行包含 felis-postgres 的发布版时，安装器执行一次迁移：

1. 停止 felis-api、felis-operator 和主机定时任务，并在宿主机 `pg_hba.conf` 顶部加入规则，拒绝迁移连接之外对 `felis` 数据库的访问；原文件保存为 `pg_hba.conf.pre-pg-move`。
2. 创建 `pre-pg-move` 备份包，恢复到 felis-postgres，并比较两个服务器上每个表的行数。至此任何失败都会恢复 `pg_hba.conf` 和控制面，平台继续使用未改动的宿主机数据库。
3. 停止并禁用宿主机的 `postgresql` 服务（软件包和数据副本保留），写入 `/var/lib/felis/postgres-moved`。宿主机服务器还承载其他数据库时，服务保持运行，`felis` 副本只能经回环地址访问。

迁移后，主机配置通过 `127.0.0.1:15432` 连接 felis-postgres，`[database] deployment = "felis/felis-postgres"` 使 `felis db` 在 Pod 内运行 `pg_dump`、`psql` 和 `pg_restore`；Pod 使用 `felis-postgres.felis.svc:5432`。

回退到宿主机数据库（例如重新安装迁移前的发布版）：

```bash
sudo k3s kubectl -n felis scale deploy/felis-api deploy/felis-operator deploy/felis-postgres --replicas=0
hba="$(sudo -u postgres psql -XtAc 'SHOW hba_file' 2>/dev/null || echo /var/lib/pgsql/data/pg_hba.conf)"
sudo cp -p "${hba}.pre-pg-move" "$hba"
sudo systemctl enable --now postgresql
sudo rm /var/lib/felis/postgres-moved
curl -fsSL <该发布版的安装器地址> | sudo bash
```

`SHOW hba_file` 需要数据库正在运行；数据库停止时使用 EL 系发行版的默认路径，Debian 和 Ubuntu 的文件位于 `/etc/postgresql/<major>/main/`。迁移之后的写入只存在于 felis-postgres 中；需要保留时，先执行 `sudo felis db backup`，回退后再恢复到宿主机数据库。迁移稳定运行一段时间后，可删除宿主机上的旧副本：

```bash
sudo systemctl start postgresql; sudo -u postgres dropdb felis; sudo -u postgres dropuser felis
```

### 服务器资源校验 {#crd-validation}

每次运行安装器都会应用 `felis` 程序内嵌的 MinecraftServer CRD。API server 拒绝 operator 无法处理的取值：

| 字段 | 允许的取值 |
| --- | --- |
| `spec.rcon.port` | 未设置、`0` 或 `25575`；网络策略只开放 25575 |
| `spec.startup.timeoutSeconds`、`spec.startup.readinessTimeoutSeconds` | 0–86400 |
| `spec.startup.healthHTTPPort` | 0–65535 |
| `spec.lifecycle.terminationGracePeriodSeconds` | 0–3600 |
| `spec.idle.emptySecondsBeforeStop` | 0–604800（面板上限为 86400） |

`0` 均表示使用 operator 的默认值。在这些规则生效前保存的对象，越界值会保留到有人编辑该字段为止；operator 将负值视为默认值，过大的值按原值执行。用 `sudo k3s kubectl -n minecraft edit minecraftserver <name>` 手动修正。

## 回滚 {#rollback}

### 回滚控制面镜像 {#rollback-image}

每个发布版使用独立的镜像标签，例如 `felis/felis:v1.2.3`。升级结束时，安装器打印原来的标签，并记录在 `/etc/felis/previous-felis-image`。回滚到上一个版本的镜像：

```bash
sudo k3s kubectl -n felis rollout undo deployment/felis-api deployment/felis-operator
sudo k3s kubectl -n felis rollout status deploy/felis-api
```

镜像通常仍在节点上；被清理时由集群内镜像仓库重新提供，仓库始终保留最新的 5 个 `felis/felis` 标签和仍被游戏 Pod 使用的镜像。同版本重新运行会复用同一标签，此后的 `rollout undo` 仍会回到该标签。下一次运行安装器会再次应用其安装的版本。

`rollout undo` 只回滚镜像，升级执行过的数据库迁移仍然保留。

### 回滚损坏数据库的升级 {#rollback-database}

数据库迁移只能向前执行。升级前生成的 `pre-migrate` 备份包是回退的依据：`felis update --apply` 在安装前创建一份，安装器运行 `felis migrate up` 且有待执行的迁移时也会先创建一份。

::: danger 危险
恢复会以备份包替换整个数据库，备份包之后的数据库变更全部丢失。恢复前，系统会自动为当前数据库创建一份 `pre-restore` 备份包。
:::

1. 停止控制面，找到升级生成的备份包并恢复，然后回滚镜像：

   ```bash
   sudo k3s kubectl -n felis scale deployment felis-api felis-operator --replicas=0
   sudo felis db list | grep pre-migrate        # 最新的一份属于本次升级
   sudo felis db restore -yes <该备份包>
   sudo k3s kubectl -n felis rollout undo deploy/felis-api
   sudo k3s kubectl -n felis rollout undo deploy/felis-operator
   sudo k3s kubectl -n felis scale deployment felis-api felis-operator --replicas=1
   ```

   此时不要运行 `felis migrate up`：主机上的 `felis` 已是新版本，会重新应用正在回滚的迁移。

2. 用旧发布版自己的安装器和附件重新安装该版本，使主机与数据库一致（以 `v1.2.3` 为例）：

   ```bash
   curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/v1.2.3/deploy/bootstrap.sh \
     | sudo FELIS_RELEASE=v1.2.3 bash
   ```

   `FELIS_RELEASE` 使安装器安装指定的发布版；不设置时会再次安装最新版本并重新执行其迁移。它不能与 `FELIS_REF`、`FELIS_ARTIFACT_DIR`、`FELIS_SKIP_FETCH` 或 `FELIS_VERSION_BOOTSTRAP=dev` 同时使用，未发布的标签会在任何修改前停止安装。早于该变量的安装器会忽略它（`curl -fsSL <安装器地址> | grep -c FELIS_RELEASE` 输出 `0`），此时改用 `FELIS_REF=v1.2.3` 从源码构建该标签。

恢复的详细规则见[恢复数据库](/operations/backup#restore-database)。

### 数据库结构检查 {#schema-guard}

felis-api、世界清理、异地副本和 `felis migrate up` 会比较数据库记录的迁移与程序内置的迁移：

- 数据库由更新的发布版迁移过时，它们停止并报告 `database schema is newer than this felis build: it records migration 0026, and this build knows migrations up to 0025`。跨越迁移执行 `rollout undo` 后，felis-api 会处于 CrashLoopBackOff，直到恢复 `pre-migrate` 备份包。
- 数据库缺少迁移时，felis-api、世界清理和异地副本报告 `database schema is behind this felis build`，直到运行 `felis migrate up`；`felis setup` 的预检会自动应用缺少的迁移。

### 更新失败时 {#failed-update}

安装器较早替换 `/usr/local/bin/felis`（后续步骤运行新版本），并将旧版本保留为 `felis.prev`，直到新版本投入使用。在数据库迁移开始前失败时，安装器恢复旧版本，使主机定时任务和 `felis setup` 与仍在运行的数据库和控制面一致；重新运行可从此处继续。迁移开始后失败时保留新版本。

安装器失败可能已修改部分组件，数据库结构不会自动回滚。保留更新前的备份包，查看安装器输出后再重试，或按[回滚损坏数据库的升级](#rollback-database)回退。
