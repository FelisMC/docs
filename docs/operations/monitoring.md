---
title: 监控与告警
description: 主机状态与健康检查、支持包、看门狗及其告警邮件、邮件中继、外部心跳、指标与告警规则，以及审计日志导出。
---

# 监控与告警 {#monitoring}

本页面向运维人员，说明如何查看 Felis 主机的状态、生成支持包、看门狗检查哪些内容并如何发送告警、如何配置邮件中继和外部心跳、如何将 Felis 接入已有的 Prometheus，以及如何导出审计日志。按症状排查问题见[故障排查](/operations/troubleshooting#first-steps)。

每个完整安装都通过 `felis-watchdog.timer` 运行看门狗，无需额外的监控系统即可在出现问题时邮件通知所有者。下文的指标和告警规则供另行运行 Prometheus 的部署使用。

## 状态与健康检查 {#diagnostics}

以下两个命令在主机上以 root 运行，只读取状态，不修改任何内容，也不发送邮件，可随时执行。

**`sudo felis status`** 汇总整个平台：发布版本、节点及其 kubelet、各控制面 Deployment（就绪副本、镜像、Pod 重启次数）、游戏代理（`felis-velocity` 单元及游戏端口是否接受连接）、每台服务器的目标状态、阶段、玩家数和最新世界备份、最新数据库备份包和异地副本、受监视的磁盘和内存，以及看门狗未解除的告警。某一部分不可用时，其余部分照常输出：k3s 停止时集群一行显示 `unreachable (...)`，服务器显示 `unknown while the cluster is unreachable`；PostgreSQL 停止时备份列显示 `?`，表格下方说明原因。

**`sudo felis doctor`** 以 `felis-watchdog.service` 的配置运行看门狗的全部检查，并检查只有主机能看到的问题：失败的 Felis 单元、已停止的常驻服务（`k3s`、`felis-velocity`）、不再触发的定时任务、无法送达的告警（没有邮件中继，或没有已验证邮箱的所有者）以及不可用的心跳地址。它按领域逐行输出：`✓` 正常、`!` 警告、`✗` 严重、`-` 未检查及原因（例如未配置异地副本），每项发现都给出下一步排查位置：

```text
felis doctor on felis-1 at 2026-09-27 12:00 UTC
checks run as /etc/systemd/system/felis-watchdog.service runs them (config /etc/felis/felis.host.toml)

✓  configuration
✓  Kubernetes cluster
✗  PostgreSQL
     critical postgres: PostgreSQL is unreachable: sign-in, the panel and server management fail
              → k3s kubectl -n felis get pods -l app.kubernetes.io/component=postgres; k3s kubectl -n felis logs deploy/felis-postgres --tail=100 (...)
-  off-site copy: not checked, not configured
...
1 problem(s): 1 critical, 0 warning(s)
```

发现问题时退出码为 1，否则为 0，可用于脚本。`felis doctor` 不发送邮件、不发送心跳，也不改变看门狗的状态；它显示的告警由看门狗下一次正式运行按其延迟发送。缺少或无法读取 `felis-watchdog.service` 本身就是一项严重问题，此时检查使用看门狗的默认设置。

面板中的对应位置：

- 「维护与备份 → 状态」→「主机状态」显示磁盘、内存、看门狗告警、服务与定时任务和游戏代理的状态。
- 「维护与备份 → 诊断」→「健康检查」→「执行健康检查」运行 `felis doctor`，按「配置」「Kubernetes 集群」「PostgreSQL」「游戏代理」「数据库备份」「异地副本」「构建扫描数据库」「磁盘空间」「内存」「k3s 证书」「节点地址」「时钟」「服务与定时任务」「告警投递」分区显示结果。
- 仪表盘的「平台状态」栏显示未解除的告警、最新数据库备份、异地副本状态和剩余空间最少的磁盘。

## 支持包 {#support-bundle}

`sudo felis support-bundle` 将协助排查所需的信息收集到一个文件 `/var/lib/felis/support/felis-support-<主机>-<时间>.tar.gz`（权限 0600）中。

支持包包含：`status.txt` 和 `doctor.txt`、发布版本、配置摘要（名称与设置，不含凭据）、Felis 单元与定时任务、`df`、网络地址与内存、`/etc/felis` 下的文件名（不含内容）、每个 Felis 单元和 k3s 的日志、节点、卷和服务器，以及控制面、构建和服务器命名空间中的 Pod、Deployment、StatefulSet、Job、CronJob、Service、存储声明、网络策略和事件，还有每个控制面和构建容器日志的末尾（重启过的容器另含上一次运行的日志）。游戏服务器只收集初始化容器的日志。

支持包不包含任何 Secret 和 ConfigMap、配置文件的内容、数据库和世界。对于收集的内容，以下值会被移除：主机机密文件中的值（`secrets.env`、`offsite.env`、邮件中继与上传存储的密钥、心跳地址、转发密钥、游戏代理令牌、k3s 令牌）、数据库密码、Pod 和服务器的环境变量值、URL 中的密码、私钥、`Bearer`/`Basic` 凭据，以及日志或报告中以 `password=`、`token=`、`secret=` 等形式写出的值。包内的 `MANIFEST.txt` 列出收集了什么、移除了什么，以及未能收集的内容（例如 k3s 停止、日志已不存在）。

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `-o DIR` | `/var/lib/felis/support` | 写入支持包的目录，不存在时以 0700 权限创建 |
| `-since` | `48h` | 读取各单元日志的时间范围 |
| `-log-lines` | `2000` | 每个 Pod 日志和单元日志保留的末尾行数 |
| `-server-logs` | 关闭 | 同时收集游戏服务器自身的日志，其中包含玩家名称、IP 地址和聊天内容 |

面板中的对应位置是「维护与备份 → 诊断」→「支持包」：仅在问题涉及服务器时勾选「包含游戏服务器日志」，选择「生成支持包」，任务完成后选择「下载」。

::: warning 注意
发送支持包前务必阅读其内容。以上规则无法识别的格式写出的机密会保留在包中。
:::

## 看门狗 {#watchdog}

看门狗每 2 分钟检查一次主机，条件持续达到下表中的时长后发送告警邮件：

| 检查 | 持续多久后发送 | 严重度 |
| --- | --- | --- |
| 控制面 Deployment `felis-postgres`、`felis-api`、`felis-operator` 或 `registry` 不存在或没有可用的 Pod | 5 分钟 | 严重 |
| Kubernetes API 不可达（k3s 停止）；此时下列集群检查视为未知，保持原有状态 | 5 分钟 | 严重 |
| 登录空间应运行而未处于 `Running` | 10 分钟 | 严重 |
| 其他系统服务器（大厅）应运行而未处于 `Running` | 10 分钟 | 警告 |
| 用户服务器处于 `Failed` | 5 分钟 | 警告 |
| 最近 24 小时内有备份、恢复或世界清理任务失败 | 立即，仅一次 | 警告 |
| 世界清理 CronJob 超过 26 小时没有成功运行 | 立即 | 警告 |
| 节点 `NotReady`，或 kubelet 报告磁盘、内存或 PID 压力 | 5 分钟（压力为 2 分钟） | 严重 |
| PostgreSQL 不可达 | 3 分钟 | 严重 |
| 游戏代理在游戏端口拒绝连接 | 3 分钟 | 严重 |
| 最新的每日数据库备份包超过 26 小时或不存在；之后的手动或异地备份包不会解除此告警 | 10 分钟 | 严重 |
| 最新的数据库备份包缺少 MinecraftServer 资源 | 10 分钟 | 警告 |
| 已配置的异地副本 12 小时内没有成功完成，或已停止（存储桶使用另一把密钥加密、已被其他主机接管、本机处于待机状态） | 10 分钟 | 警告 |
| 镜像仓库中的构建扫描漏洞库超过 72 小时没有刷新 | 10 分钟 | 警告 |
| 受监视的文件系统可用空间低于 15%（低于 5% 时为严重） | 15 分钟（严重时 5 分钟） | 警告 |
| 主机可用内存低于 10% | 15 分钟 | 警告 |
| 主机不再持有安装时的 IP 地址 | 5 分钟 | 严重 |
| 系统时钟未经 NTP 同步 | 30 分钟 | 警告 |
| k3s 证书将在 30 天内到期（7 天内或已过期时为严重） | 立即 | 警告 |
| 看门狗自身的运行持续失败（`watchdog/run`） | 10 分钟 | 严重 |
| 看门狗状态文件无法解析并被移到一旁（`watchdog/state`） | 立即，仅一次 | 警告 |

受监视的文件系统包括 `/`、`/var/lib/rancher/k3s`、`/var/lib/felis` 和数据库备份目录所在的文件系统。地址、时钟和磁盘问题的处理见[故障排查](/operations/troubleshooting#host-address-changed)。

```bash
journalctl -u felis-watchdog -n 40          # 最近几次运行的每项检查
sudo felis watchdog -dry-run                # 立即运行检查但不发送邮件也不改变状态
systemctl list-timers felis-watchdog.timer  # 上次和下次运行时间
```

运行正常时日志为 `every check passed`；否则每项发现一行，发送邮件时记录邮件主题。在 shell 中执行的 `-dry-run` 使用命令的默认参数，不包括游戏代理和 IP 地址检查；服务单元带有 `-proxy-addr 127.0.0.1:<游戏端口>`、`-node-ip <安装时的地址>` 和安装时选择的磁盘列表，可用 `systemctl cat felis-watchdog` 查看。

### 看门狗自身故障 {#watchdog-failures}

`felis-watchdog.service` 设有 `OnFailure=felis-watchdog-failed.service`。一次运行失败时（崩溃、超过 3 分钟时限、`felis.toml` 无法加载），系统运行 `felis watchdog -unit-failed`，它：

- 立即向心跳的 `/fail` 地址报告 systemd 的结果，例如 `felis-watchdog.service failed: result exit-code, exit status 3`；安装器运行期间或本机处于待机状态时不报告。
- 记录 `watchdog/run`，运行持续失败 10 分钟后发送邮件。中继和收件人在 `felis.toml` 可加载时取自它，否则取自看门狗的缓存；上次成功运行缓存的面板中继优先于 `felis.toml`。第一次成功运行即解除该告警。

状态文件 `/var/lib/felis/watchdog/state.json` 无法解析时，被重命名为 `state.json.unreadable-<Unix 时间>`，运行从新的状态开始并发送一次 `watchdog/state`。新状态不含未解除告警的历史，因此仍然存在的问题会作为新问题再次发送。断电后或手动编辑后常出现这种情况；检查 `df -h /var/lib/felis` 后，可删除被移到一旁的副本。

状态文件无法写入时（`/var/lib/felis` 已满或只读），运行状态暂存在 `/run/felis/watchdog-state.json`（tmpfs，仅 root 可读），下一次运行读取两份中较新的一份，避免每 2 分钟重复发送同一告警。这类运行记录 `save state: ...; kept in /run/felis/watchdog-state.json until the host restarts`，退出码为 1 并报告心跳的 `/fail`；连续 5 次后发送一次 `watchdog/run`。状态文件恢复写入后，tmpfs 副本被删除；在此之前重启主机会丢失邮件历史，未解除的问题会再次作为新问题发送。

```bash
journalctl -u felis-watchdog-failed -n 20   # 失败回退报告和发送的内容
systemctl status felis-watchdog             # 失败运行的结果
```

## 告警邮件 {#alerts}

看门狗按以下规则发送邮件：

- **收件人**为所有已启用的所有者账号的已验证邮箱。所有者在「账户 → 邮箱验证」中验证邮箱。
- **中继**与登录验证码相同：优先使用所有者在面板中保存的中继（每次运行时从数据库读取），否则使用 `felis.toml` 的 `[smtp]`，见[邮件中继](#mail-relay)。
- **每次运行最多一封邮件**，汇总所有到期的内容：新问题、每个未解除问题的每日提醒，以及问题消失满 10 分钟后的解除通知。在延迟时间内自行恢复的问题不会发送；升级为严重的问题立即再次发送。
- **安装期间**不发送邮件：安装器写入 `/run/felis/watchdog-quiet-until`，退出时删除。
- **由另一台主机的备份重建的主机**（备用主机上的演练，或执行 `felis offsite take-over` 之前的重建主机），在异地存储桶记录的原主机过去 3 小时内仍在运行时不发送邮件：恢复的数据库中的所有者属于原主机，由原主机自己通知。此时日志记录 `this host stands by for host ...; holding this mail`。原主机停止运行后，待机状态本身会作为告警发送。
- **数据库或 API 不可用时**仍能发送：使用 `[smtp]` 中继时，密码从主机文件 `/etc/felis/smtp-password` 读取（缺少该文件时读取 Secret `felis-smtp`）；当前使用的中继、密码和收件人列表缓存在 `/var/lib/felis/watchdog/state.json`（仅 root 可读）。无法读取数据库的运行继续使用上次成功运行缓存的面板中继，仅当上次运行也使用 `[smtp]` 时才回退到 `[smtp]`。

没有中继或没有已验证邮箱的所有者时，告警只写入日志；配置了心跳时，有未送达的告警期间每次运行都报告心跳的 `/fail`。新安装默认处于此状态：安装结束时提示 `NO ALERT MAIL`，`sudo felis setup` 最后的状态卡片中 `alerts` 一行显示告警的去向（`mailed to <address> via <relay>`）或缺少的条件（以 `⚠` 标记）。在该卡片上按 `e` 配置邮件（或在面板中保存中继），再在面板中验证所有者的邮箱。`heartbeat` 一行显示心跳设置。该卡片和 `felis doctor` 都优先读取面板中保存的中继和心跳，未保存时读取 `felis.toml` 和心跳文件，与看门狗一致。

## 暂停告警邮件 {#hold-alerts}

计划内维护会让看门狗检测到预期中的停机。维护前暂停告警邮件，避免向所有者发送无意义的告警：

1. 打开「维护与备份 → 状态」→「主机状态」→「看门狗告警」。
2. 在「暂停时长」中选择 1、4 或 24 小时，选择「暂停告警邮件」。
3. 维护结束后选择「恢复告警邮件」，或等待暂停到期。

暂停期间，看门狗照常检查，告警仍列在面板中，但不发送邮件，也不报告心跳的 `/fail`。暂停的结束时间最长为 7 天之后。

在命令行中，暂停由文件 `/run/felis/watchdog-quiet-until` 控制，其内容为暂停结束时的 Unix 时间。该文件位于 tmpfs，主机重启后消失。

```bash
sudo install -d -m 0755 /run/felis
echo $(( $(date +%s) + 3600 )) | sudo tee /run/felis/watchdog-quiet-until   # 暂停 1 小时
sudo rm /run/felis/watchdog-quiet-until                                       # 恢复告警邮件
```

## 邮件中继 {#mail-relay}

邮件中继用于发送登录验证码、邮箱验证与身份确认验证码、通知、世界清理前的提醒、看门狗告警和应急控制台的验证码。中继有两个来源：

- 面板「平台设置 → 通知与保留」→「邮件服务」卡片中保存的中继，存储在 `platform_settings` 的 `smtp` 行中。
- `felis setup` 的邮件步骤写入 `felis.toml` 的 `[smtp]` 中继（安装时的设置）。

面板中保存的中继在所有发送方优先生效，无需重启：felis-api 最多每 15 秒读取一次，世界清理、看门狗和应急控制台在下次运行时读取。卡片显示当前生效的来源：「面板设置」「安装时的设置」或「未配置」。

在面板中配置中继：

1. 打开「平台设置 → 通知与保留」→「邮件服务」。
2. 填写「服务器地址」「端口」「发件地址」「用户名」「密码」和「每小时发信上限」，确认「要求加密连接」的设置。
3. 可选：选择「发送测试邮件」，通过当前填写的中继向所有者的已验证邮箱（没有时发往发件地址）发送一封邮件。
4. 选择「检查并保存」。Felis 先向发件地址发送一封自检邮件，中继接受后才保存；该检查不可跳过。

| 设置 | 规则 |
| --- | --- |
| 端口 | 仅限 25、465、587（STARTTLS，推荐）和 2525。felis-api 从集群内部连接中继，其他端口会被拒绝 |
| 发件地址 | 纯邮箱地址，不含显示名称；须为邮件服务商授权的发件身份，否则服务商会在投递时拒收 |
| 要求加密连接 | 默认开启。开启时，465 以外的端口上不提供 STARTTLS 的中继会被拒绝，本机中继也不例外。仅在通过可信内网连接邮件服务器时关闭 |
| 每小时发信上限 | 全安装共用的发信额度，替代 `[smtp] max_per_hour`；0 表示默认值 120，最多四分之一可以集中发送。应不高于邮件服务商的限额 |
| 密码 | 不会返回面板，也不写入审计日志；卡片只显示已保存，留空则保留原值。密码保存在数据库中，随数据库备份包及其加密的异地副本一并保存 |

检查失败时，错误指明所处阶段：`smtp_unreachable`、`smtp_tls`、`smtp_auth`、`smtp_sender_refused`、`smtp_recipient_refused`，其余为 `smtp_failed`。中继返回的原文只写入 felis-api 日志。felis-api 拒绝连接链路本地、未指定和组播地址（在 DNS 解析后检查），这类中继返回 `smtp_unreachable`。

「恢复为安装时的设置」清除面板中的中继，改用 `felis.toml` 中的 `[smtp]`；安装时未配置时，将无法发送邮件验证码。`felis setup` 的邮件页每次保存时也会清除面板中的中继，因此在其中输入的中继即为生效的中继。保存、清除和测试都需要重新验证身份；卡片加载后中继已被他人修改时，保存返回 `409 mail_settings_changed`。审计记录为 `smtp.updated` 和 `smtp.cleared`。

`[smtp]` 中继在 465 端口上从第一个字节起使用 TLS，在其他端口上要求 STARTTLS；中继不提供 STARTTLS 时发送失败，错误为 `smtp: <host>:<port> does not offer STARTTLS`。`[smtp]` 对本机中继（`localhost`、`127.0.0.0/8`、`::1`）不作此要求。对于通过可信链路访问、不提供 STARTTLS 的中继，在 `/etc/felis/felis.toml` 和 `/etc/felis/felis.pod.toml` 的 `[smtp]` 中设置 `require_tls = false`；重新运行安装器和 setup 的邮件页都会保留该设置。

::: warning 注意
没有任何中继时，邮件登录、管理控制台登录、邮箱验证以及敏感操作的邮件二次验证都返回 `503 mail_unavailable`，用户只能用 Passkey 登录，已验证的邮箱也不再算作重新验证身份的方式，看门狗告警只写入日志。安装后应尽快配置中继。
:::

发信问题的排查见[邮件与告警问题](/operations/troubleshooting#mail-problems)。

## 外部心跳 {#heartbeat}

主机关机、定时任务停止、看门狗在发信前崩溃，这些情况主机都无法自行报告。外部心跳弥补这一点：看门狗每次运行都访问外部监控服务（Healthchecks.io 或兼容其接口的服务）上的一个检查，心跳停止时由该服务发出通知。

1. 在监控服务上创建一个检查，周期 2 分钟，宽限期 10 分钟。
2. 将检查的心跳地址提供给看门狗，任选其一：
   - 面板「平台设置 → 通知与保留」→「监控心跳」：填写「心跳地址」，选择「保存心跳地址」。看门狗下一次运行时生效。
   - 主机：以 `FELIS_WATCHDOG_HEARTBEAT_URL=<心跳地址>` 重新运行安装器，地址写入 `/etc/felis/watchdog-heartbeat-url`（仅 root 可读，权限 0600）。

地址中的路径就是检查的密钥，因此面板、安装输出和日志只显示协议和主机名。面板中保存的地址优先于主机文件，每次运行从数据库读取并缓存在看门狗状态中，因此数据库停止期间和看门狗失败回退时仍会访问它。「移除心跳地址」清除面板中的地址，此后看门狗改用安装器写入的主机文件（如有）；监控服务会因心跳停止而告警，应同时在该服务中暂停此检查。保存和移除都需要重新验证身份，审计记录为 `platform.heartbeat` 和 `platform.heartbeat.clear`。

之后运行安装器时不设置该变量会保留主机文件，设为 `FELIS_WATCHDOG_HEARTBEAT_URL=off` 则删除它。面板和主机文件都没有心跳地址时，安装结束时提示 `NO HEARTBEAT`。

| 本次运行 | 心跳请求 |
| --- | --- |
| 告警已送达所有者（已发送，或没有到期告警） | `GET <地址>` |
| 有未解除的告警但无人可通知（没有中继或没有已验证邮箱）、邮件发送失败，或状态未能保存 | `POST <地址>/fail`，请求体包含原因和发现 |
| 安装器运行期间发生上述失败 | 不发送 |
| 本机为另一台主机的异地存储桶待机 | 不发送，由写入存储桶的主机发送 |

带查询字符串（`?`）的地址没有 `/fail` 端点，失败的运行不发送请求，由监控服务在宽限期结束后告警。请求超时（10 秒）或返回非 2xx 时，日志记录 `felis watchdog: heartbeat: ...`，运行的退出码仍由检查和邮件决定。

数据库备份包携带 `/etc/felis` 及其中的心跳文件，面板中保存的地址随数据库一并携带。由备份包重建的主机在执行 `felis offsite take-over` 前处于待机状态，不发送心跳；接管后使用同一个检查。

## 指标与告警规则 {#metrics}

### 指标 {#metric-list}

- `felis_servers_total`：受管服务器的数量。
- `felis_server_phase{server,role,phase,desired}`：每台服务器的当前阶段为 1。系统服务器的 `role` 为 `login` 或 `lobby`，用户服务器为空。`desired` 用于区分有意停止的服务器和启动失败的服务器。
- `felis_build_info{component,version}`：提供该指标的进程（`operator` 或 `api`）为 1；该指标缺失说明对应进程已停止。
- `felis_start_duration_seconds`：直方图，每次启动首次就绪时记录一次。永远无法完成的启动不产生样本，样本缺失本身就说明启动卡住。
- `felis_image_build_failures_total`：构建任务失败时递增。
- `felis_reaper_worlds_deleted_total`：世界卷在备份后被实际删除时递增；突然增长说明有世界超过了闲置期限，应确认玩家进服事件正常上报。
- `felis_http_requests_total{face,method,route,code}` 和 `felis_http_request_duration_seconds{face,route}`：按匹配的路由模式（例如 `/api/v1/servers/{name}/status`，没有匹配的路由时为 `unmatched`）统计每个 API 请求；`face` 为 `internal` 或 `external`。日志流计入请求数，但不计入延迟直方图。某一路由的 `code=~"5.."` 增加可将故障定位到单个处理器；`route="unmatched"` 增加通常是有人在扫描。
- felis-api 的 Go 运行时和进程指标（`go_*`、`process_*`）：goroutine、堆和打开的文件描述符。goroutine 只增不减通常意味着日志流或上传没有结束。
- `go_sql_*{db_name="felis"}`：API 的数据库连接池，上限 25 个连接，每个连接默认 `statement_timeout=15s`、`idle_in_transaction_session_timeout=60s`（`[database] url` 中已设置的值保留）。`go_sql_in_use_connections` 持续等于 `go_sql_max_open_connections` 且 `go_sql_wait_count_total` 增长，说明请求在排队等待连接，应检查慢查询或锁（`SELECT pid, state, wait_event, query FROM pg_stat_activity`）。被超时中止的语句记录 `canceling statement due to statement timeout`。
- 登录相关指标：`felis_mail_total`、`felis_rate_limited_total`、`felis_auth_otp_lockouts_total`、`felis_auth_failures_total`、`felis_sessions_revoked_total`、`felis_audit_write_failures_total`。

API 还为每个请求写一行 logfmt 访问日志，包含 `face`、`method`、`route`、`path`、`status`、`duration_ms`、`bytes`、`request_id`（每个错误响应中的 ID）和 `principal`（登录后的用户 ID）；成功的探测和指标采集不记录。

```bash
sudo k3s kubectl -n felis logs deploy/felis-api | grep 'msg=request' | grep 'status=5'
sudo k3s kubectl -n felis logs deploy/felis-api | grep 'request_id=<错误响应中的 ID>'
```

游戏插件的调用是 `face="internal"` 的指标，每种调用对应一个路由：

```text
sum by (route, code) (rate(felis_http_requests_total{face="internal", route="/api/v1/internal/servers/{name}/join-event"}[5m]))
sum by (route, code) (rate(felis_http_requests_total{face="internal", route="/api/v1/internal/servers/{name}/wake"}[5m]))
histogram_quantile(0.95, sum by (le, route) (rate(felis_http_request_duration_seconds_bucket{face="internal"}[5m])))
```

未到达 felis-api 的调用（被拒绝、重置或超时）不出现在上述指标中，由调用方计数。游戏代理每个活跃的 10 分钟输出一行统计，代理控制台的 `/felis` 命令显示启动以来的总数：

```bash
journalctl -u felis-velocity | grep 'Felis: last 10 min'
# Felis: last 10 min: felis-api calls=412 (no answer=0, 4xx=3, 5xx=0, retried=0), avg=18 ms, max=240 ms,
#   busy refusals=0, join-events failed=0, join-events dropped=0, transfers failed=0,
#   server-list refreshes failed=0, waiting now=0
journalctl -u felis-velocity | grep 'server list refresh'
sudo k3s kubectl -n minecraft logs login-0 | grep 'link status poll'
```

`no answer` 增加而 `felis_http_requests_total` 平稳，说明通往内部 API 的路径中断（网络策略、Service 或 API Pod）。`busy refusals` 或 `join-events dropped` 大于 0，说明 felis-api 的响应慢于代理 8 个线程的处理能力。服务器列表刷新或关联状态查询中断时，开始时记录警告，持续期间每 5 分钟报告一次失败次数，恢复时记录一条 info。

### 采集指标 {#scraping}

指标来自两个进程。两个 Service 都带有 `prometheus.io/scrape|port|path` 注解，支持按注解发现 Service 端点的 Prometheus 可直接采集：

- `felis-operator` 的 `:8080/metrics`（Service `felis-operator-metrics`）：`felis_servers_total`、`felis_server_phase`、`felis_start_duration_seconds`、`felis_build_info{component="operator"}`，以及 controller-runtime 的 `controller_runtime_reconcile_*` 和 `workqueue_*`。
- felis-api 内部接口的 `:8081/metrics`（Service `felis-api-internal`）：`felis_build_info{component="api"}`、`felis_http_*`、`go_*`/`process_*`、`go_sql_*`、`felis_image_build_failures_total` 和上述登录相关指标。与健康探测一样无需认证，仅在 ClusterIP 上提供，外部接口不提供该路径。
- `felis_reaper_worlds_deleted_total` 产生于一次性的世界清理 CronJob，它在采集间隔之前就已退出；没有 pushgateway 时无法采集，应改为查看清理 Pod 的日志或 `world_backups` 表。

数据库备份的时效指标 `felis_db_backup_last_success_timestamp_seconds` 由每日备份写入 `FELIS_DB_BACKUP_METRICS`（默认 `/var/lib/node_exporter/textfile_collector/felis_db_backup.prom`），须将 node-exporter 的 `--collector.textfile.directory` 指向该目录。

### 告警规则 {#alert-rules}

Felis 源码仓库的 `deploy/alerts/` 目录提供现成的规则，分为以下几组：

- **控制面**：`felis-operator` 或 `felis-api` 停止或未被采集（`FelisOperatorDown`、`FelisAPIDown`）。
- **服务器**：登录空间或其他系统服务器未运行（`FelisLoginGateDown`、`FelisSystemServerDown`），用户服务器处于 `Failed`（`FelisServerFailed`）。
- **operator 协调**：错误累积（`FelisReconcileErrors`），单次协调超过 3 分钟（`FelisReconcileStuck`）。协调超过 10 分钟时，operator 的存活探测会重启 Pod。
- **世界任务**（需要 kube-state-metrics）：备份、恢复或清理任务失败（`FelisWorldJobFailed`），世界清理 26 小时未成功（`FelisReaperStale`）。
- **构建与启动**：构建失败和启动缓慢。
- **节点**：磁盘和内存阈值，以及 kubelet 的 `DiskPressure` 状态。
- **数据库备份**：控制面数据库备份的时效（`FelisDBBackupStale`、`FelisDBBackupMetricMissing`，需要 node-exporter 的 textfile collector）。
- **登录滥用**：邮件额度、中继失败、限流、账号验证码锁定、登录拒绝率，以及审计记录丢失。

加载规则：

- 普通 Prometheus：将 `felis-alerts.yaml` 加入 `rule_files`，并可用 `promtool check rules felis-alerts.yaml` 检查规则。
- kube-prometheus-stack 或 prometheus-operator：执行 `kubectl apply -f felis-prometheusrule.yaml`，并将其 `release:` 标签调整为与所用规则选择器（ruleSelector）匹配。

## 导出审计日志 {#audit-export}

审计记录在超过保留期后被删除。保留期由 `felis.toml` 的 `[audit] retention` 决定，默认 `365d`，接受天数（`90d`）、以 30 天为一个月的月数（`18mo`）或 `forever`，不接受少于 `30d` 的值。所有者可在「平台设置 → 通知与保留」→「备份与审计保留」中以「审计记录保留天数」覆盖该值（0 表示永久保留，其余为 30 到 3650 天），felis-api 在下一次清理时应用。数据库备份包在其保留期内仍包含旧记录。审计日志的内容见[审计日志](/guide/administration#audit-log)。

在保留期结束前导出需要长期保存的记录：

```bash
sudo felis db audit-export -until 2026-01-01 -out /root/audit-2025.jsonl
```

`-since` 和 `-until` 接受日期（UTC 零点）或 RFC 3339 时间点，导出区间为 `[since, until)`。每行是一条以 JSON 表示的记录，按时间从旧到新排列。文件以 0600 权限创建，不会覆盖已有文件。

面板中的对应位置是「维护与备份 → 备份」→「导出审计日志」：选择「起始日期（含）」和「截止日期（不含）」（留空表示从最早或至最新的记录），然后选择「下载」。
