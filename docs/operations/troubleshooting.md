---
title: 故障排查
description: 根据观察到的现象定位 Felis 故障原因，确认原因并加以解决。
---

# 故障排查 {#troubleshooting}

本文帮助运维人员诊断并解决 Felis 主机上的故障。先执行「首先检查」中的步骤，了解整台主机的状态，再转到与所观察现象相符的条目。每个条目说明现象、原因、确认方法和解决办法。条目按领域分组：服务器、玩家与路由、面板与登录、内部 API、账号关联、构建与镜像、主机、备份与数据库、邮件，以及文件与计划任务。文末的[快速索引](#quick-reference)将常见现象对应到相应条目。

::: info 说明
本文中的命令均在 Felis 主机上以 root 身份执行。`kubectl` 命令使用 k3s 自带的版本（`sudo k3s kubectl …`），因为集群管理员凭据 `/etc/rancher/k3s/k3s.yaml` 仅 root 可读。游戏服务器运行在 `minecraft` 命名空间，控制面运行在 `felis` 命名空间。
:::

## 首先检查 {#first-steps}

排查具体现象之前，先检查整台主机的状态。本节命令均为只读操作：不修改任何内容，也不发送邮件，可随时执行。Owner 也可在面板中执行相同的检查。

### 查看平台状态 {#check-status}

```bash
sudo felis status
```

`felis status` 汇总输出平台状态：发布版本、节点及其 kubelet、各控制面 Deployment（就绪副本、镜像、重启次数）、游戏代理（`felis-velocity` 单元及游戏端口能否接受连接）、每台服务器的目标状态、阶段、玩家数和最新世界备份、最新数据库备份包、异地副本、磁盘与内存，以及看门狗尚未关闭的告警。

某个组件停止时，输出会标明该组件不可用，其余部分照常输出。k3s 停止时，集群一行显示 `unreachable (...)`，服务器显示 `unknown while the cluster is unreachable`。PostgreSQL 停止时，备份列显示 `?`，表格下方说明原因。

### 运行健康检查 {#run-doctor}

```bash
sudo felis doctor
```

`felis doctor` 使用看门狗自身的配置执行看门狗的全部检查，并补充只有主机才能发现的问题：失败的 Felis 单元、已停止的 `k3s` 或 `felis-velocity`、不再触发的定时器、无人接收的告警（未配置邮件中继，或没有已验证邮箱的 Owner）以及不可用的心跳 URL。命令按领域逐行输出：`✓` 正常、`!` 警告、`✗` 严重、`-` 未检查并附原因。每项发现都指明下一步的检查位置：

```text
✓  configuration
✓  Kubernetes cluster
✗  PostgreSQL
     critical postgres: PostgreSQL is unreachable: sign-in, the panel and server management fail
              → k3s kubectl -n felis get pods -l app.kubernetes.io/component=postgres; k3s kubectl -n felis logs deploy/felis-postgres --tail=100 (...)
-  off-site copy: not checked, not configured
...
1 problem(s): 1 critical, 0 warning(s)
```

发现问题时命令以状态码 1 退出，否则以 0 退出，可用于脚本。该命令不发送邮件，也不改变看门狗的状态；看门狗按自身的周期发送未关闭的告警。各项检查的说明见[监控与告警](/operations/monitoring#diagnostics)。

### 生成支持包 {#create-support-bundle}

向他人求助时，请附上支持包：

```bash
sudo felis support-bundle
```

支持包写入 `/var/lib/felis/support/felis-support-<host>-<time>.tar.gz`，权限为 0600；`-o DIR` 可写入其他目录。支持包包含 `felis status` 和 `felis doctor` 的输出、不含凭据的配置摘要、Felis 单元及其日志（默认 `-since 48h`、`-log-lines 2000`），以及控制面、构建和服务器命名空间的状态、事件和近期日志。游戏服务器日志包含玩家名称、IP 地址和聊天内容，仅在指定 `-server-logs` 时收集。

支持包从不收集 Secret、ConfigMap、配置文件内容、数据库和世界，并从收集的全部内容中移除凭据。包内的 `MANIFEST.txt` 列出已收集的内容、已移除的内容以及未能收集的内容。

::: warning 注意
发送支持包之前务必通读其内容。脱敏规则无法识别的格式中写出的机密会保留在支持包中。
:::

完整内容见[支持包](/operations/monitoring#support-bundle)。

### 查看日志 {#logs}

| 组件 | 命令 |
| --- | --- |
| 面板与 API（`felis-api`） | `sudo k3s kubectl -n felis logs deploy/felis-api` |
| operator（服务器生命周期） | `sudo k3s kubectl -n felis logs deploy/felis-operator` |
| 数据库 | `sudo k3s kubectl -n felis logs deploy/felis-postgres` |
| 单台游戏服务器 | `sudo k3s kubectl -n minecraft logs <server>-0`，或面板中该服务器的控制台 |
| 登录空间与大厅 | `sudo k3s kubectl -n minecraft logs login-0`、`sudo k3s kubectl -n minecraft logs lobby-0` |
| 游戏代理（Velocity） | `sudo journalctl -u felis-velocity` |
| 看门狗 | `sudo journalctl -u felis-watchdog` |
| 从面板发起的主机操作 | `sudo journalctl -u felis-node-control` |
| k3s | `sudo journalctl -u k3s` |

为 `kubectl logs` 添加 `--tail=200`，或为 `journalctl` 添加 `-n 200`，即可只查看最近的日志。

### 使用面板 {#panel-diagnostics}

Owner 无需登录主机终端即可执行相同的检查：

- 「维护与备份 → 状态」显示主机状态（`felis status`）和看门狗尚未关闭的告警。
- 「维护与备份 → 诊断」包含「健康检查」卡片（`felis doctor`，选择「执行健康检查」）和「支持包」卡片（`felis support-bundle`，选择「生成支持包」；仅在问题涉及服务器时勾选「包含游戏服务器日志」）。支持包通过浏览器下载。

每项主机任务都需要重新验证身份，并记入审计日志；同一时间只运行一项主机任务。面板无法连接主机时（例如 `felis-node-control` 已停止），请使用上述命令。全部操作及其命令行对应方式见[从面板执行主机操作](/operations/#panel-host-operations)。

## 平台服务未运行 {#services-down}

主机重启后平台没有完全恢复，或 `felis status`、`felis doctor` 显示 k3s、游戏代理等单元未运行时，执行：

```bash
sudo felis start
```

命令先启动集群并等待节点就绪，再启动其余设为开机启动的服务与定时器，最后等待控制面的全部 Deployment 就绪，并逐项输出结果。已在运行的服务不受影响。仍有部分未能启动时，按输出中给出的命令查看对应日志，详见 [felis start](/reference/cli#start)。

## 服务器 {#server-problems}

### 服务器一直处于「启动中」 {#server-stuck-starting}

面板长时间显示「启动中」，或玩家在大厅等待，始终未被传送到目标服务器。

短时间处于「启动中」属于正常情况。启动未成功时，每 2 秒重新检查一次，直到两项时限之一耗尽，随后服务器进入「启动失败」（见[服务器显示「启动失败」](#server-failed)）。原本处于「运行中」的服务器连续三次就绪检查失败后，会回到「启动中」。

**原因**

就绪检查即一次 RCON 连接与登录：RCON 接受密码时，服务器即视为就绪。operator 将服务器尚未就绪的原因记录在其状态条件中：

| 原因 | 含义 | 重新检查间隔 |
| --- | --- | --- |
| `PodNotReady` | 游戏 Pod 尚未开放游戏端口 | 2 秒 |
| `SpecChanged` | Pod 未就绪期间服务器配置发生变化，operator 已按新配置重建 Pod | 2 秒 |
| `AutoRestart` / `StartRetried` | 超时的启动已通过重建 Pod 重试，由系统自动发起或由「重试启动」发起 | 2 秒 |
| `ServiceAddressPending` | 服务器的 Service 尚未分配集群地址 | 2 秒 |
| `RconSecretUnavailable` | 存放 RCON 密码的 Secret 不存在，或缺少引用的键 | 10 秒 |
| `RconNotReachable` | RCON 检查无法连接或无法登录 | 2 秒 |

**排查**

1. 在面板中打开该服务器的控制台。启动期间，控制台显示当前阶段（「正在等待资源与调度」「正在准备文件与拉取镜像」「正在启动 Minecraft 并检查就绪状态」）；启动受阻时显示原因：可调度内存不足、镜像拉取失败或容器退出。
2. 读取条件原因及消息：

   ```bash
   sudo k3s kubectl -n minecraft get minecraftserver <server> -o jsonpath='{.status.conditions}'
   ```

3. 原因为 `PodNotReady` 时，检查 Pod 及其日志：

   ```bash
   sudo k3s kubectl -n minecraft describe pod <server>-0
   sudo k3s kubectl -n minecraft logs <server>-0
   ```

4. 服务器停留在「启动中」的时间超过时限，却始终未进入「启动失败」时，说明 operator 未在处理该服务器。查看 operator 日志：

   ```bash
   sudo k3s kubectl -n felis logs deploy/felis-operator --tail=200
   ```

**解决**

原因为 `PodNotReady` 时，根据 `describe pod` 的输出处理：

| 现象 | 原因 | 解决办法 |
| --- | --- | --- |
| Pod 为 `Pending`，事件显示 `Unschedulable` 或内存不足 | 节点可用内存不足 | 降低该服务器的内存配置、停止其他服务器或增加容量 |
| `ImagePullBackOff` 或 `ErrImagePull` | 镜像引用错误、标签不存在或镜像仓库不可达 | 修正镜像，见[游戏镜像](#game-images)和[镜像仓库错误](#registry-errors)。即使服务器已启动失败，修改服务器配置即可恢复：operator 会替换卡住的 Pod，服务器回到「启动中」，原因为 `SpecChanged`，时限重新计算，重试次数归零 |
| 存储卷声明为 `Pending`（`sudo k3s kubectl -n minecraft get pvc`） | 存储类不存在，或没有存储类能提供所请求的容量 | 修正存储类或容量 |
| 游戏端口开放前容器反复重启 | 服务端程序、插件或启动脚本出错 | 查看容器日志，修正服务器配置、插件或镜像 |
| 卡在某个 `Init:` 步骤，或日志中出现 `AccessDeniedException` / `Permission denied` | 游戏服务器以 uid/gid 1000 运行，并移除全部 capability。每次启动前，`prepare-data` 初始化容器将世界文件交给 1000:1000 | 查看 `sudo k3s kubectl -n minecraft logs <server>-0 -c prepare-data`：输出修改的条目数，并列出最多 20 个未能修改的条目。在 `/data`、`/tmp` 之外写入数据的镜像须重新构建，将状态保存在 `/data` 下 |
| 每次启动都在最后一个 `Init:` 步骤等待约 30 秒 | `egress-gate` 初始化容器等待服务器的网络隔离生效 | 查看 `sudo k3s kubectl -n minecraft logs <server>-0 -c egress-gate`。`is unreachable after …; the egress lock is in effect` 为正常结果。`still answers after 30s; starting anyway` 表示网络策略未生效（CNI 不支持 NetworkPolicy，或 k3s 以 `--disable-network-policy` 启动），或者允许游戏服务器访问的私网范围（`--server-egress-allow-cidr`）覆盖了节点。请将该范围缩小到服务器实际需要访问的主机 |
| `FailedCreate … violates PodSecurity "baseline"` | `minecraft` 命名空间强制执行 `baseline` Pod 安全标准，被拒绝的 Pod 是在 Felis 之外创建或修改的 | 执行 `sudo k3s kubectl get events -n minecraft --field-selector reason=FailedCreate` 查看违规字段，并撤销该修改 |

原因为 `RconSecretUnavailable` 时，消息会指明问题：

- `rcon.secretRef.name and .key are required when rcon is enabled`：已启用 RCON，但 `spec.rcon.secretRef` 中的 Secret 名称或键为空。
- `secret "<name>" has no key "<key>"`：Secret 存在，但缺少该键。

创建包含所引用键的 Secret，或修正 `spec.rcon.secretRef`。对于 Felis 创建且启用 RCON 的服务器，operator 会创建名为 `<server>-rcon` 的 Secret。确认该键有值：

```bash
sudo k3s kubectl -n minecraft get secret <secret> -o jsonpath='{.data.<key>}' | base64 -d | wc -c
```

原因为 `RconNotReachable` 时，消息为连接错误：

- `rcon: authentication failed`：Secret 中的密码与服务器的 `rcon.password` 不一致，请使两者一致。
- `connection refused` 或 `i/o timeout`：服务器尚未开放 RCON 端口、`server.properties` 中未启用 RCON，或镜像监听的端口不是 25575（`spec.rcon.port` 只接受该端口）。

每次 RCON 检查的超时固定为 5 秒。整个启动过程的时限是另一项设置（见[服务器显示「启动失败」](#server-failed)）。

operator 未在处理服务器时，先恢复 operator；相关告警见[监控与告警](/operations/monitoring#alerts)。

### 服务器显示「启动失败」 {#server-failed}

面板显示「启动超时·重试中」或「启动失败」。尝试加入的玩家看到 `「<server>」启动失败，自动重试也已用完。服主可以在面板查看日志后重新启动。`。看门狗会报告启动失败的用户服务器。

**原因**

| 原因 | 含义 |
| --- | --- |
| `StartupTimeout` | Pod 未在 `spec.startup.timeoutSeconds`（默认 300 秒）内开放游戏端口 |
| `ReadinessTimeout` | RCON 未在 `spec.startup.readinessTimeoutSeconds`（默认 300 秒）内接受密码 |
| `InvalidSpec` | 无法构建服务器的工作负载，通常因为 `spec.storage.size` 不是有效的容量值：`invalid storage size "<value>": <parse error>` |

两项时限都从发起启动的时刻开始计算，未设置或设为 0 时均为 300 秒。

超时后，operator 通过重建 Pod 重试启动，最多 3 次，每次分别在时限届满后等待 1、2、4 分钟再尝试。在此期间，面板显示「启动超时·重试中」及已使用的重试次数，加入的玩家会排队等待下一次尝试。重试次数用完后，或原因为 `InvalidSpec` 时，服务器保持「启动失败」，直到有人处理；玩家加入不会触发新的尝试。

**排查**

1. 在面板中打开该服务器的控制台，查看启动日志和报告的错误。
2. 读取状态条件：

   ```bash
   sudo k3s kubectl -n minecraft get minecraftserver <server> -o jsonpath='{.status.conditions}'
   ```

3. 原因为超时时，按[服务器一直处于「启动中」](#server-stuck-starting)排查：原因相同，只是问题修复前时限已经耗尽。

**解决**

1. 修复原因：镜像、内存、配置或 RCON。
2. 在服务器控制台选择「重试启动」。该操作将重试次数归零，并立即重新启动服务器。修改服务器配置同样会替换卡住的 Pod。
3. 原因为 `InvalidSpec` 时，将 `spec.storage.size` 设为 `10Gi` 等有效值（`10 GB` 无效）。下次协调时服务器即离开失败状态。
4. 服务器能够正常启动、但需要超过 300 秒时（例如大型整合包），在服务器资源上调大 `spec.startup.timeoutSeconds` 和 `spec.startup.readinessTimeoutSeconds`。

### 服务器无法停止 {#server-wont-stop}

选择「停止」后，服务器仍为「运行中」或「停止中」，或面板显示「状态已过期」。

**原因**

- **有玩家在线。** 停止有玩家的服务器之前，operator 向所有在线玩家发送一条黄色聊天提示，等待 30 秒，发送最后一条提示，然后停止服务器并保存世界。30 秒内再次启动服务器会取消停止，并通知玩家。空服、未启用 RCON 的服务器，以及玩家数读取或提示发送失败的服务器会立即停止。
- **不停服备份正在复制世界。** operator 等待复制结束后再关闭服务器，最长约六分钟。
- **游戏正在保存。** Pod 退出前，服务器显示「停止中」；世界越大，耗时越长。
- **面板无法连接控制 API。** 控制台将状态标记为「状态已过期」，显示最后一次读取的时间，并自动重试。此时显示的状态仅供参考；显示为启动中或运行中，不能证明游戏进程仍然健康。
- **游戏进程或 operator 无响应**，普通停止无法完成。

**排查**

```bash
sudo k3s kubectl -n minecraft get minecraftserver <server> -o jsonpath='{.spec.desiredState} {.status.phase}{"\n"}'
sudo k3s kubectl -n minecraft get pods -l felis.lolicon.best/server=<server>,felis.lolicon.best/component=server -o wide
sudo k3s kubectl -n minecraft get events --field-selector involvedObject.name=<server>
```

出现 `StopNotice` 事件表示 30 秒提示期正在进行。

**解决**

1. 等待提示期和关闭时的保存完成。Pod 退出后，「停止中」变为「已停止」。
2. 普通停止无响应时，Owner 在服务器控制台选择「更多操作 → 应急停止」，输入服务器名称并重新验证身份。应急停止先保存停止意图（`desiredState=Stopped`），再将服务器的 StatefulSet 缩容至零，绕过游戏的 RCON 和 operator。正常的终止宽限期照常适用，不删除任何世界，但游戏尚未保存的更改可能丢失。副本目标仍大于零，或游戏 Pod 仍在运行或退出时，面板显示「停止中」。缩容失败时，停止意图保持已保存状态，面板提示结果未确认。
3. 控制 API 本身离线时，在控制台页面展开「主机侧应急停止步骤」，在主机上依次执行其中的命令。部署使用其他命名空间时，替换其中的 `minecraft`：

   ```bash
   sudo k3s kubectl patch minecraftserver <server> -n minecraft --type=merge -p '{"spec":{"desiredState":"Stopped"}}'
   sudo k3s kubectl scale statefulset <server> -n minecraft --replicas=0
   sudo k3s kubectl get pods -n minecraft -l felis.lolicon.best/server=<server>,felis.lolicon.best/component=server -o wide
   ```

4. 节点离线时，检查该节点及其容器运行时。Pod 仍在终止或所在节点不可达时，游戏进程可能仍在运行。
5. 应急停止因权限错误失败时，应用当前的平台更新，更新会安装应急停止所需的权限（见[升级](/operations/upgrade#update)）。

::: danger 危险
不要通过强制删除世界、Pod 或存储卷声明来解决控制连接丢失的问题。强制删除 Pod 不能证明游戏进程已经退出。
:::

### 服务器无人时不自动停止 {#idle-stop}

从面板创建的服务器在无人在线 600 秒后停止，下次有玩家加入时唤醒。登录空间和大厅从不因空闲而停止。服务器无人在线却持续运行，或玩家数始终显示为 0，原因如下。

**原因**

- 「编辑服务器配置 → 空闲自动停服」设为「从不」。
- 服务器创建于空闲自动停服成为默认设置之前，没有空闲设置。
- 服务器未启用 RCON。玩家数来自 RCON 就绪检查执行的 `list` 命令；没有 RCON 时玩家数从未读取，始终为 0，空闲自动停服也不会执行。
- 服务器的 `list` 回复格式无法识别，例如插件改写了 `/list`，或回复经过翻译。无法读取的玩家数视为未知，不会当作零：服务器继续运行，面板显示「在线人数读取失败，空闲停服已暂停。读取恢复后将继续判断。」，`PlayersCounted` 条件为 `False`，原因为 `ListUnreadable`。
- 服务器就绪不足 3 分钟。在此期间玩家数为零不会开始倒计时，以免仍在进入的玩家被停服。
- 不停服备份正在复制世界。复制期间 operator 不会因空闲停止服务器。

**排查**

```bash
sudo k3s kubectl -n minecraft get minecraftserver <server> -o jsonpath='{.spec.idle}{"\n"}{.spec.rcon.enabled}{"\n"}'
sudo k3s kubectl -n minecraft get minecraftserver <server> -o jsonpath='{.status.conditions[?(@.type=="PlayersCounted")]}'
```

在面板中该服务器的控制台执行 `list`，查看服务器的回复。Felis 可读取以下格式：

- `There are 3 of a max of 20 players online`（原版、Paper、Fabric、Forge）
- `There are 3/20 players online`（1.12 及 Bukkit）
- `There are 3 out of maximum 20 players online`（EssentialsX）

**解决**

1. 在「编辑服务器配置」中将「空闲自动停服」设为 1 分钟到 24 小时之间的时长。
2. 对于在空闲自动停服或 RCON 成为默认设置之前创建的服务器，执行系统服务器补全：`sudo felis converge` 为没有空闲设置的服务器设定默认值 600 秒，`sudo felis converge -user-rcon` 为旧用户服务器启用 RCON。启用 RCON 之前请阅读[系统服务器字段](#system-server-fields)：镜像没有 RCON 监听器的服务器启用后将无法启动。
3. 恢复受支持的 `list` 回复，例如移除插件对该消息的改写或翻译。

### 操作提示世界正被占用 {#world-busy}

唤醒、恢复、备份、下载或文件修改返回 `409 maintenance_in_progress`，面板显示「世界正在执行恢复、备份、导出、文件下载、文件修改或回收操作。请等待操作结束后重试。导出和下载需等待浏览器完成传输。」；或面板显示「此操作需要修改世界卷，运行中的服务器独占挂载该卷。请先完全停止服务器。」（`409 not_stopped`）。

**原因**

同一时间只有一项操作可以占用服务器的世界。恢复、备份、世界下载或文件修改会占用世界，直到对应的 Job 完成；读取和列出文件不占用世界。世界被占用期间，该服务器的所有唤醒（来自面板或玩家加入）及其他世界操作都会被拒绝。operator 遵循同样的规则：不启动该服务器，`Ready` 条件显示 `MaintenanceInProgress`，直到 Job 结束。

占用世界的可能是：

1. 该服务器尚未完成的 Job：恢复、备份、文件修改，或在下载结束前的世界下载。
2. 服务器上的准入锁 `felis.lolicon.best/maintenance=<kind>@<time>`，覆盖从准入操作到创建 Job 之间的间隙。felis-api 在此间隙中停止时，该锁最多两分钟后失效，下次唤醒会将其清除。
3. 正在归档空闲世界的世界清理。它以 `reap@<time>` 写入同一把锁并每 30 秒刷新一次；拒绝消息中注明 `the idle-world reaper`，玩家加入触发的唤醒返回 `409 world_reclaiming`。

面板已显示「已停止」却返回 `409 not_stopped`，说明游戏 Pod 仍在关闭并保存。

**排查**

```bash
sudo k3s kubectl -n minecraft get jobs -l felis.lolicon.best/server=<server>
sudo k3s kubectl -n minecraft get minecraftserver <server> -o jsonpath='{.metadata.annotations}'
sudo k3s kubectl -n minecraft get pods -l felis.lolicon.best/server=<server>
```

服务器的「备份与恢复」页面也会列出近期的备份、恢复和导出任务及其结果。

**解决**

1. 等待 Job 完成。确实卡住的 Job 会被其自身的时限（`activeDeadlineSeconds`）终止。
2. 如需立即释放世界，删除该 Job：

   ```bash
   sudo k3s kubectl -n minecraft delete job <job>
   ```

   ::: warning
   删除 Job 会丢弃其正在写入的内容。
   :::

3. 移除过期的准入锁：

   ```bash
   sudo k3s kubectl -n minecraft annotate minecraftserver <server> felis.lolicon.best/maintenance-
   ```

   移除 `reap@` 锁也会取消本次世界清理：世界清理保留该世界，次日再试（见[世界清理](/operations/backup#world-cleanup)）。
4. 对于 `not_stopped`，待该服务器的 Pod 列表为空后重试。

### 登录空间或正式大厅不存在 {#system-servers-missing}

**原因**

- 登录空间与正式大厅由安装向导创建。安装向导未完成，或系统服务器已被删除时，两者均不存在，玩家无法通过游戏代理进入。

**排查**

「登录与大厅」页面提示登录空间或正式大厅尚未创建。在主机上执行：

```bash
sudo k3s kubectl -n minecraft get minecraftservers login lobby
```

**解决**

1. 以所有者身份在「登录与大厅」页面选择「重新创建」。该任务也可在「平台设置 → 访问与安全 → 系统服务器补全」中执行。
2. 或在主机上执行：

   ```bash
   sudo felis converge
   ```

缺失的服务器将按安装时配置的镜像创建，并自动启动。

## 玩家与路由 {#player-problems}

### 玩家无法进入服务器 {#players-cannot-join}

每个新连接都先经过游戏代理（Velocity）和登录空间，再按玩家进入策略进入大厅或目标服务器。其中任何一步出错，玩家都无法进入。

**原因**

| 玩家看到的现象 | 原因 |
| --- | --- |
| 连接失败或超时 | 游戏代理未运行，或游戏端口不可达 |
| `请先完成登录，再加入服务器。` | 玩家尚未在登录空间完成登录 |
| `登录验证暂时不可用，请稍后重试。` | 代理无法连接 felis-api |
| `大厅暂时不可用，请稍后再试。` | 大厅未运行，或未在代理中注册 |
| `正在启动「<server>」——就绪后会自动把你传送过去。`，但始终没有传送 | 服务器未能就绪，见[服务器一直处于「启动中」](#server-stuck-starting) |
| 提示服务器无法启动 | 唤醒被拒绝，见[进服唤醒被拒绝](#wake-refused) |
| 玩家进入大厅而非目标服务器，或连接被拒绝 | 路由已禁用，或玩家进入策略将连接引向其他位置 |

玩家看到的提示随游戏语言显示为中文或英文。等待服务器启动的玩家每分钟收到一条进度提示。felis-api 连续 120 秒无响应时，代理将等待中的玩家移出队列；无论如何，等待最长一小时。

**排查**

1. 执行 `sudo felis status`，查看游戏代理一行（`felis-velocity` 单元及游戏端口能否接受连接）以及登录空间和大厅的状态。
2. 查看代理的状态和日志：

   ```bash
   sudo systemctl status felis-velocity
   sudo journalctl -u felis-velocity -n 200
   ```

3. 查找 `Felis routing ready: rootDomain=…, login=…, lobby=…` 一行。出现以 `Felis routing DISABLED` 开头的行时，见[路由已禁用](#routing-disabled)。
4. 代理日志中出现 `server list refresh failed` 或 `server list refresh still failing`，说明代理无法连接 felis-api，见[内部 API 错误](#internal-api-errors)。
5. 检查登录空间和大厅：

   ```bash
   sudo k3s kubectl -n minecraft get minecraftserver login lobby
   ```

6. 在「平台设置 → 玩家进入」中检查玩家进入策略。

**解决**

1. 代理未运行时，执行 `sudo systemctl restart felis-velocity` 启动代理。持续失败时查看其日志。日志中出现较长的垃圾回收停顿或 `OutOfMemoryError` 时，需要更大的堆内存：在「平台设置 → 访问与安全」的「游戏代理」卡片中调大「内存上限」。代理随即重启，所有玩家断开连接。
2. 玩家尚未完成登录时，按[玩家接入](/guide/players#joining)中的步骤操作并关联账号。
3. 代理无法连接 felis-api 时，恢复 felis-api（见[面板操作报错](#panel-errors)）和内部 API（见[内部 API 错误](#internal-api-errors)）。
4. 登录空间或大厅未运行时，按普通服务器处理：见[服务器一直处于「启动中」](#server-stuck-starting)和[服务器显示「启动失败」](#server-failed)。
5. 检查玩家进入策略（见[玩家进入策略](/guide/players#entry-policy)）。进入方式为「按域名进入」且未设置默认目标时，要求网页登录的连接进入大厅，其余连接被拒绝。保存的更改在 15 秒内到达代理，并作用于新连接。

### 进服唤醒被拒绝 {#wake-refused}

玩家加入已停止的服务器时，代理让玩家等待，并请求 felis-api 唤醒服务器。felis-api 依次检查服务器的自动启动策略、每台服务器的唤醒冷却时间和运行服务器上限。只有 operator 的 RCON 检查成功后，服务器才视为就绪；代理每 2 秒查询一次服务器状态，就绪后将玩家传送过去。

**原因与解决**

| 返回 | 玩家看到的提示 | 原因 | 解决办法 |
| --- | --- | --- | --- |
| `403 forbidden` | `你无权启动「<server>」。` | 自动启动策略为「仅所有者」且玩家不是所有者，或为「唤醒名单」且玩家没有唤醒权限 | 在服务器的「唤醒名单」中授予该玩家唤醒权限、由所有者启动服务器，或在「编辑服务器配置」中修改策略（见[自动启动](/guide/servers#autostart)） |
| `409 maintenance_in_progress` | `「<server>」正在维护（回档、备份或改文件），请稍后再试。` | 其他操作正在占用世界 | 等待操作完成，见[操作提示世界正被占用](#world-busy) |
| `409 world_reclaiming` | `「<server>」闲置太久，世界正在归档回收，现在不能启动。` | 世界清理正在归档空闲世界，完成后服务器以空世界释放 | 旧世界保留在归档中，见[世界清理](/operations/backup#world-cleanup) |
| `409 server_retiring` | `「<server>」已被放弃或正在删除，不能启动。` | 所有者已放弃该服务器，或管理员正在删除它；在下一次每日清理之前保持停止 | 在面板中撤销该请求，服务器即可再次启动 |
| `409 start_failed` | `「<server>」启动失败，自动重试也已用完。` | 上一次启动失败，自动重试已用完 | 见[服务器显示「启动失败」](#server-failed) |
| `429 cooldown` | 无提示，玩家继续等待 | 该服务器的唤醒已在进行中 | 无需处理 |
| `503 at_capacity` | `集群当前已满——「<server>」暂时无法启动。请稍后再试。` | 已达到运行服务器上限 | 停止其他服务器，或提高上限 |
| 其他返回 | `现在无法启动「<server>」。请稍后再试。` | 代理日志记录 `Felis: wake <server> failed (status=…)` | 查看代理日志，见[内部 API 错误](#internal-api-errors) |

Owner 在「平台设置 → 玩家进入」的「启动与唤醒策略」卡片中设置运行服务器上限和唤醒冷却时间：

- 「同时运行的服务器上限（0–10000）」：0 表示不限制。该上限适用于面板启动、游戏内唤醒和计划任务启动；系统服务始终可以启动。上限在准入时检查，因此并发请求可能短暂超出上限；降低上限不会停止正在运行的服务器。能否实际调度服务器仍取决于可用内存。
- 「唤醒冷却时间（0–3600 秒）」：同一服务器两次被接受的唤醒请求之间的最短间隔；0 表示关闭冷却。

保存的值无需重启即对所有 API 副本生效。

### 路由已禁用 {#routing-disabled}

玩家可以连接，但无法通过域名进入服务器，玩家加入时也不会唤醒任何服务器。代理日志中出现以下任一行：

```text
Felis routing DISABLED: the proxy is in offline mode (online-mode=false). Domain autostart and the allowlist trust Mojang-verified UUIDs; refusing to route on spoofable identities. /link remains available. Set online-mode=true to enable routing.
```

```text
Felis routing DISABLED: no root-domain configured. Add 'root-domain=' to felis-link.properties (or set FELIS_ROOT_DOMAIN) to enable host-based routing. /link remains available.
```

**原因**

- 唤醒、认领和唤醒名单信任经 Mojang 验证的 Minecraft 身份。离线模式的代理会接受伪造的身份，因此 Felis 插件拒绝路由。自动启动策略等服务器端设置无法使离线代理变得安全，这一检查由代理执行。
- 插件没有根域名，因此没有可供路由的域名。

两种情况下 `/link` 均可继续使用。

**排查**

```bash
sudo journalctl -u felis-velocity | grep 'Felis routing'
sudo grep -n 'online-mode' /opt/felis/velocity/velocity.toml
sudo grep -n 'root-domain' /opt/felis/velocity/plugins/felis-link/felis-link.properties
```

**解决**

1. 重新运行安装器（见[安装与部署](/guide/deployment#install)）。安装器管理这两个文件：在 `velocity.toml` 中写入 `online-mode = true`，在 `felis-link.properties` 中写入根域名，文件变化时重启代理。重启代理会断开所有玩家。
2. 对于其他主机上的代理，在其 `velocity.toml` 中设置 `online-mode = true`，在其 `felis-link.properties` 中设置 `root-domain=<根域名>`（或设置环境变量 `FELIS_ROOT_DOMAIN`），然后重启代理。
3. 确认代理日志中出现 `Felis routing ready`。

根域名本身发生变化时，按[更改根域名](/operations/access#change-domain)操作。

## 面板与登录 {#panel-problems}

### 面板操作报错 {#panel-errors}

API 以错误码和消息返回错误（`{"error":{"code","message","request_id"}}`），面板为常见错误码显示翻译后的提示。

**原因**

| 面板提示 | 返回 | 原因 |
| --- | --- | --- |
| 「会话已过期——请重新登录。」 | `401 unauthorized` | 没有有效会话。会话有效期为 12 小时；工作人员会话无操作 30 分钟后也会结束。在其他设备退出登录或撤销会话同样会结束会话 |
| 「当前账户无权执行此操作。」 | `403 forbidden` | 账户角色不允许该操作，或在运维控制台以外请求了管理操作（见[管理页面返回 403](#admin-console-forbidden)） |
| 「此操作需要近期身份验证。请使用 Passkey 或邮箱验证码重新验证身份。」 | `403 reauth_required` | 敏感操作要求在最近 5 分钟内验证过身份 |
| 「登录服务当前不可用。」 | `503 auth_unavailable` | 会话存储 PostgreSQL 不可达 |
| 「服务暂时不可用，请稍后重试。」 | `5xx` | felis-api 或其依赖的组件已停止或正在重启 |
| 「操作失败，服务器出现内部错误。请联系管理员查看日志。请求编号：…」 | `500 internal` | 意外错误，详情仅记录在 felis-api 日志中 |
| 「无法连接 Felis，可能由于网络中断或 Cloudflare Access 会话过期。…」 | 无响应 | 浏览器无法连接面板，或 Cloudflare Access 会话已过期 |
| 「主机节点执行服务不可用。请检查主控上的 felis-node-control.service。」 | `503 node_control_unavailable` | 执行主机操作的服务已停止 |
| 「节点维护正在执行，暂不允许启动服务器或创建另一项节点任务。」 | `409 node_operation_busy` | 有主机或节点任务正在运行。同一时间只运行一项任务；使控制面暂时不可用的任务（数据库恢复、整机重建、凭据轮换、域名迁移）运行期间，启动服务器的请求会被拒绝 |

**排查**

1. 内部错误：在 felis-api 日志中搜索面板显示的请求编号。日志行格式为 `api: <METHOD> <path>: unmapped error (request_id=<id>): <error>`：

   ```bash
   sudo k3s kubectl -n felis logs deploy/felis-api | grep '<request-id>'
   ```

2. 服务不可用：检查控制面：

   ```bash
   sudo felis status
   sudo k3s kubectl -n felis get pods
   ```

3. 主机操作：检查主机服务：

   ```bash
   sudo systemctl status felis-node-control
   sudo journalctl -u felis-node-control -n 100
   ```

**解决**

- **会话已过期**：重新登录。会话只属于一个域名，在运维控制台登录不会同时登录玩家控制台。
- **无权执行**：使用具有所需角色的账户（见[角色](/guide/administration#roles)），或按[管理页面返回 403](#admin-console-forbidden)打开运维控制台。
- **需要身份验证**：使用 Passkey 或邮箱验证码确认身份后重新操作。
- **登录服务不可用**：恢复数据库，见[数据库不可用](#database-unavailable)。
- **服务不可用或内部错误**：查看 felis-api 日志，并执行 `sudo felis doctor` 查看各组件的状态。
- **无法连接**：刷新页面；使用 Cloudflare Access 时重新登录 Access。面板的访问方式见[访问方式](/operations/access#access-methods)。
- **主机节点执行服务不可用**：执行 `sudo systemctl restart felis-node-control` 重启该服务。
- **节点维护正在执行**：等待当前任务完成。任务的阶段和日志显示在发起它的面板位置。

### 管理页面返回 403 {#admin-console-forbidden}

工作人员账户已登录，但管理页面和操作提示「当前账户无权执行此操作。」。

**原因**

Felis 根据请求的域名识别运维控制台：`admin_hostname`，默认为 `op.console.<根域名>`。裸 IP 地址只有在安装时明确指定的情况下才视为运维控制台：`<ip>.nip.io` 或 `<ip>.sslip.io` 根域名中内嵌的地址（`felis setup` 输出的本地面板地址），或设置为该地址的 `admin_hostname`。其他地址（包括回环地址）均按玩家控制台处理。因此，工作人员账户通过 SSH 隧道访问 `https://127.0.0.1:30443` 时，管理接口返回 403。

在运维控制台上，没有工作人员角色的账户发出的所有请求都会被拒绝，返回 403。

**排查**

将浏览器地址栏中的域名与「平台设置 → 访问与安全」中「访问方式与域名」卡片的「管理控制台域名」字段进行比较。

**解决**

1. 通过域名打开运维控制台。使用 SSH 隧道时，在本机 `/etc/hosts` 中添加一条记录，将该域名指向隧道的本地地址；脚本调用可使用 `curl --resolve`。
2. 或者，在配置的 `[auth]` 段中将 `admin_hostname` 设为实际使用的 IP 地址（见[配置参考](/reference/configuration#felis-toml)）。

### 无法登录 {#sign-in-problems}

**原因与解决**

| 提示 | 返回 | 原因 | 解决办法 |
| --- | --- | --- | --- |
| 「Owner 账户未初始化，登录不可用」 | — | 尚未创建 Owner | 在主机上执行 `sudo felis setup`，打开其输出的一次性设置链接（见[初始化向导](/guide/deployment#setup-wizard)） |
| 「设置链接无效或已被使用」 | — | 一次性设置链接已过期或已使用 | 再次执行 `sudo felis setup` 获取新链接 |
| 「当前部署已禁用本地登录，请通过组织的安全入口访问控制台。」 | `403 local_auth_disabled` | 平台设置 `local_auth_enabled` 关闭或缺失。创建首个 Owner 时会开启该设置。关闭期间，已有会话同样会被拒绝 | 执行 `sudo felis breakGlass` 创建或恢复 Owner，该操作会开启本地登录（见[应急访问](/operations/access#break-glass)） |
| 「登录请求已触发限流，请等待限流解除后重试。」 | `429 rate_limited` | 同一客户端地址发出的登录请求过多 | 按 `Retry-After` 响应头给出的时间等待。所有人同时受影响时，见[所有人同时被限流](#sign-in-rate-limited) |
| 「邮件服务未配置，无法发送验证码。…」 | `503 mail_unavailable` | 面板和配置文件中均未配置邮件中继 | 使用 Passkey 登录，玩家也可使用游戏绑定码登录。配置邮件中继（见[邮件中继](/operations/monitoring#mail-relay)） |
| 「邮件发送已触发限流，…」 | `429 mail_rate_limited` | 整个安装的邮件额度已用完，即「每小时发信上限」（默认每小时 120 封） | 见[邮件问题](#mail-problems) |
| 「验证码邮件发送失败——…」 | `502 mail_undeliverable` | 邮件中继拒绝了该邮件 | 见[邮件问题](#mail-problems) |
| 「验证码错误次数过多，请重新获取验证码。」 | `429 otp_locked` | 当前验证码的尝试次数已用完 | 重新获取验证码 |
| 「24 小时内验证码错误次数已达上限，此账号的邮箱验证码暂时停用，…」 | `429 otp_account_locked` | 该账户 24 小时内输错验证码 10 次 | 使用 Passkey，或见[账户的邮箱验证码被锁定](#email-code-locked) |
| 「该账户为管理员账户——请使用管理员登录。」 | `403 staff_account` | 工作人员账户（Admin 和 Owner）不能在玩家控制台使用邮箱验证码登录 | 在运维控制台登录 |
| 「登录服务当前不可用。」 | `503 auth_unavailable` | PostgreSQL 不可达 | 见[数据库不可用](#database-unavailable) |
| 「等待游戏内批准…」一直不结束 | — | 管理员登录需要一位在游戏内在线的管理员批准 | 见[管理员登录等待批准](#operator-sign-in) |

Passkey 与面板域名绑定。面板域名变更后，用户须重新注册 Passkey。

### 所有人同时被限流 {#sign-in-rate-limited}

所有用户同时收到「登录请求已触发限流」。

**原因**

每个客户端地址最多可同时发出 20 次登录请求，每分钟补充 20 次，由全部登录端点共享；IPv6 客户端按 /64 共享一个限额。一个人登录需要三到四次请求，因此该限制通常只影响脚本。Felis 从 `[auth] client_ip_header` 指定的请求头读取客户端地址；未指定请求头时，使用 TCP 对端地址。此时在反向代理或隧道之后，所有访客共用代理的地址和同一个限额。

**排查**

felis-api 启动时会记录限流所依据的地址：

```bash
sudo k3s kubectl -n felis logs deploy/felis-api | grep 'sign-in rate limit keys on'
```

在代理之后出现 `felis api: sign-in rate limit keys on the TCP peer ([auth] client_ip_header unset)`，即可确认原因。被拒绝的请求计入 `felis_rate_limited_total{scope="auth_door"}`；连续 10 分钟每分钟拒绝超过 10 次时触发 `FelisSignInFlood` 告警（见[指标](/operations/monitoring#metrics)）。

**解决**

1. 在「平台设置 → 访问与安全」的「访问方式与域名」卡片或 `felis setup` 中，选择与面板实际访问路径相符的访问方式（见[访问方式](/operations/access#access-methods)）。「自有反向代理」按 `X-Forwarded-For` 最右侧的一项（即代理追加的一项）限流；「Cloudflare Tunnel」按 `CF-Connecting-IP` 限流。
2. 使用自有反向代理时，通过防火墙限制面板端口只允许该代理访问，否则直接访问的调用方可以在请求头中填写任意地址。
3. 使用 Cloudflare 时，还可以在边缘拦截洪水请求：在 Security → WAF → Rate limiting rules 中，匹配面板和运维控制台域名下以 `/api/v1/auth/` 开头的 URI 路径，按 IP 计数，每 10 秒超过 30 次请求时阻断 10 秒。

### 账户的邮箱验证码被锁定 {#email-code-locked}

用户输入了正确的验证码仍被拒绝，或收到「24 小时内验证码错误次数已达上限，此账号的邮箱验证码暂时停用」。

**原因**

同一账户 24 小时内输错邮箱验证码 10 次（累计发给该账户的所有验证码），该账户的邮箱验证码登录即被锁定，直到首次输错后满 24 小时。公开登录对已锁定账户的回复与验证码错误完全相同，账户所有者会收到一封锁定通知邮件。邮箱验证、账户迁移等已登录状态下的验证步骤返回 `429 otp_account_locked`。Passkey 登录不受影响。

**排查**

每次锁定都以 `auth.otp.locked` 记入审计日志，并计入 `felis_auth_otp_lockouts_total{purpose}`（告警 `FelisOTPAccountLocked`）。查询方法见[查找登录失败记录](#sign-in-audit)。

**解决**

1. 使用 Passkey 登录，或等待锁定结束。
2. 确认是账户所有者自己误操作导致锁定后，如需提前解锁，删除该账户的错误验证码记录：

   ```bash
   sudo k3s kubectl -n felis exec deploy/felis-postgres -c postgres -- psql -U postgres felis -c \
     "DELETE FROM otp_failure_windows WHERE user_id = (SELECT id FROM users WHERE username = '<name>');"
   ```

### 查找登录失败记录 {#sign-in-audit}

每次被拒绝的登录都会在审计日志中写入一条 `auth.<door>.failed` 记录，`reason` 为 `bad_code`、`no_account`、`staff_account`、`not_staff`、`bad_assertion` 等。每轮限流中的首次拒绝写入 `auth.rate_limited`，并记录来源地址。记录包含 `actor_user_id`（账户，用于归属）、`client_ip`（与限流所依据的地址相同）和 `user_agent`。

```bash
sudo k3s kubectl -n felis exec deploy/felis-postgres -c postgres -- psql -U postgres felis -c "
  SELECT created_at, action, actor, client_ip, payload->>'reason' AS reason
  FROM audit_logs
  WHERE action LIKE 'auth.%' AND created_at > now() - interval '1 hour'
  ORDER BY created_at DESC LIMIT 50;"
```

被拒绝的登录同时计入 `felis_auth_failures_total{door,reason}`；15 分钟内超过 30 次时触发 `FelisSignInFailures` 告警。审计记录写入失败时，操作本身仍会成功，felis-api 记录 `audit: lost ...`，并触发 `FelisAuditWriteFailing` 告警；原因几乎总是数据库（见[数据库不可用](#database-unavailable)）。审计记录的保留与导出见[审计日志](/guide/administration#audit-log)。

### 管理员登录等待批准 {#operator-sign-in}

在运维控制台使用「管理员登录」时，页面一直停留在「等待游戏内批准…」。

**原因**

管理员登录需要两个因素：发送到工作人员邮箱的验证码，以及一位在游戏内在线的管理员的批准。只有关联到工作人员账户的 Minecraft 账号可以批准。登录请求在短时间后过期。

**解决**

1. 请一位在游戏内在线的管理员执行 `/felis web op approve <code>`。该命令显示请求所属的账户；管理员执行 `/felis web op approve <code> <account>` 并写明账户名即可批准。
2. 改用 Passkey 登录，Passkey 登录无需游戏内批准。
3. 没有任何工作人员账户能够登录时，在主机上执行 `sudo felis breakGlass` 恢复访问（见[应急访问](/operations/access#break-glass)）。

## 内部 API 与游戏插件 {#internal-api}

### 游戏插件无法访问内部 API {#internal-api-errors}

游戏代理、登录空间、构建 Job 和 `felis backup-now` 调用 felis-api 的内部 API（端口 8081，路由位于 `/api/v1/internal/` 下）。内部 API 通过 ClusterIP Service `felis-api-internal` 访问，与面板使用的 `felis-api` Service（端口 443）相互独立，且从不暴露在节点上。每个调用方使用各自的 Bearer 令牌认证，每条路由只服务 OpenAPI 文档中为其列出的调用方（见 [API 参考](/reference/api#authentication)）。

| 调用方 | `felis` 中的 Secret（键 `token`） | API 环境变量 | 调用方读取位置 |
| --- | --- | --- | --- |
| 游戏代理（`velocity`） | `felis-service-token` | `FELIS_SERVICE_TOKEN` | `/opt/felis/velocity/plugins/felis-link/felis-link.properties` 中的 `service-token` |
| 登录空间（`limbo`） | `felis-limbo-token`，`minecraft` 中有副本 | `FELIS_LIMBO_TOKEN` | 登录 Pod 的环境变量 `FELIS_SERVICE_TOKEN` |
| 构建 Job（`build`） | `felis-build-token`，构建命名空间中有副本 | `FELIS_BUILD_TOKEN` | 构建 Job 的下载步骤 |
| `felis backup-now`（`ops`） | `felis-ops-token` | `FELIS_OPS_TOKEN` | 每次运行时从 Secret 读取 |

安装器将四个令牌生成到 `/etc/felis/secrets.env`（`SERVICE_TOKEN`、`LIMBO_TOKEN`、`BUILD_TOKEN`、`OPS_TOKEN`），并在每次运行时应用。审计日志以来源 `internal:<caller>` 记录内部操作。

内部 API 出错时，代理记录 `server list refresh failed …; keeping current registrations`，并沿用最后一次收到的服务器列表继续路由；玩家看到 `登录验证暂时不可用，请稍后重试。`；登录空间记录 `FelisLimbo: link status poll failed`；构建在获取构建上下文时失败。

**原因**

| 现象 | 原因 |
| --- | --- |
| 调用无法建立连接，没有 HTTP 状态码 | `felis-api-internal` Service 不存在或不再选中 API Pod，或 felis-api 已停止 |
| 某个调用方的所有调用都返回 `401` | 该调用方的令牌未设置，或与 API 的副本不一致 |
| `403 wrong_caller` | 令牌有效，但属于该路由不服务的调用方，例如构建令牌访问代理路由 |
| felis-api Pod 停留在 `CreateContainerConfigError` | `felis` 中缺少四个令牌 Secret 之一 |
| felis-api 拒绝启动并提示 `the X and Y tokens are the same value; each caller needs its own` | 两个调用方的令牌相同 |

**排查**

1. 查看代理的统计行和刷新记录：

   ```bash
   sudo journalctl -u felis-velocity | grep -E 'Felis: last 10 min|server list refresh'
   ```

   代理在每个有活动的 10 分钟记录一行统计，例如 `Felis: last 10 min: felis-api calls=412 (no answer=0, 4xx=3, 5xx=0, retried=0), …`。`no answer` 持续增加说明到内部 API 的路径中断：Service、网络策略或 API Pod。`busy refusals` 或 `join-events dropped` 大于零说明 felis-api 的响应速度跟不上代理 8 个线程的处理能力。
2. 检查 Service，输出中应包含集群 IP 和端口 8081：

   ```bash
   sudo k3s kubectl -n felis get svc felis-api-internal
   ```

3. 查找未设置的令牌。felis-api 启动时为每个未设置的令牌记录一行，例如 `felis api: warning: FELIS_LIMBO_TOKEN unset — the internal face turns the limbo caller away`：

   ```bash
   sudo k3s kubectl -n felis logs deploy/felis-api | grep 'unset'
   ```

4. 将调用方的令牌与对应 Secret 比较，以代理为例：

   ```bash
   sudo k3s kubectl -n felis get secret felis-service-token -o jsonpath='{.data.token}' | base64 -d; echo
   sudo grep '^service-token=' /opt/felis/velocity/plugins/felis-link/felis-link.properties
   ```

5. 登录空间：查看其日志：

   ```bash
   sudo k3s kubectl -n minecraft logs login-0 | grep 'link status poll'
   ```

**解决**

1. Service 缺失、Secret 缺失或令牌不一致时，重新运行安装器（见[安装与部署](/guide/deployment#install)）。安装器会应用 Service、四个 Secret 以及各调用方持有的令牌副本。
2. 对于其他主机上的代理，将其 `felis-link.properties` 中的 `service-token` 设为 Secret `felis/felis-service-token` 中的值；插件在数秒内读取新值。
3. 出现 `wrong_caller` 时，按上表为调用方配置其自己的令牌。
4. 两个令牌相同时，轮换其中一个：

   ```bash
   sudo felis rotate-token <kind>
   sudo felis rotate-token -yes <kind>
   ```

   不带 `-yes` 时，命令只输出将要修改的内容及其造成的中断。各类轮换会重启哪些组件见[凭据轮换](/operations/access#rotate-credentials)。

## 账号关联与认领 {#account-linking}

### 关联或认领失败 {#account-link-errors}

玩家在游戏内执行 `/link` 获取一次性绑定码，然后在「账户」页面「Minecraft 关联」卡片的「绑定码」字段中输入，并选择「关联」，即可关联 Minecraft 账号。绑定码由 8 个字符组成（字母和数字，不含 I、O、0、1），有效期 10 分钟，只能使用一次；不区分大小写，忽略首尾空格。认领无主服务器需要已关联的账号和足够的配额（见[账号关联](/guide/players#account-linking)）。

**原因与解决**

| 返回 | 面板提示 | 原因 | 解决办法 |
| --- | --- | --- | --- |
| `400 invalid_code` | 「绑定码无效或已过期，请重新获取。」 | 绑定码不存在，或已超过 10 分钟 | 再次执行 `/link`，在 10 分钟内输入新的绑定码 |
| `409 already_linked` | 「该 Minecraft 账户已关联至其他用户。」 | 该 Minecraft 账号已关联到另一个面板账户。绑定码保持有效，正确的账户仍可使用 | 使用持有该关联的账户登录，或请管理员在「管理 → 用户管理」中检查相关账户 |
| `412 not_linked` | 「请先关联 Minecraft 账户（账户页 → 关联）。」 | 认领和所有者操作需要已关联的 Minecraft 账号 | 先关联账号 |
| `403 quota_exceeded` | 「服务器数量已达配额上限。」 | 认领后将超出账户在服务器数、CPU、内存或存储方面的配额 | 由管理员提高配额（见[配额](/guide/administration#quotas)） |
| `409 already_claimed` | 「该服务器已被其他账户认领。」 | 其他账户先完成了认领；同一服务器只有一个账户能认领成功 | 刷新服务器列表 |
| `409 server_retiring` | 「服务器已进入放弃或删除流程，将在下一次每日回收时处理。…」 | 服务器正在被放弃或删除 | 在面板中撤销该请求 |
| `404 not_found` | 「请求的内容不存在或已被删除，请刷新后重试。」 | 服务器不存在 | 刷新服务器列表 |
| `400 bad_request`、`400 bad_mc_uuid` | 「请求未被接受：…」「Minecraft UUID 格式无效。…」 | 游戏插件发出的请求缺少 UUID、绑定码为空、UUID 无效，或认证源不是 `mojang` 或 `thirdparty` | 确认游戏插件与已安装的 Felis 版本一致 |

在运行 Felis 模组的独立服务器上，服务器处于离线模式时，`/link` 回复 `此服务器未开启正版验证，不能在这里绑定`。在 Felis 代理之后，`/link` 由代理提供。

**排查**

成功的关联和认领以 `account.link` 和 `claim` 记入审计日志。失败时查看 felis-api 日志和代理日志：

```bash
sudo k3s kubectl -n felis logs deploy/felis-api --tail=200
sudo journalctl -u felis-velocity -n 200
```

游戏内执行 `/link` 本身失败时，检查内部 API（见[内部 API 错误](#internal-api-errors)）。

## 构建与镜像 {#builds-images}

本节条目涉及「构建流水线」中的镜像构建、平台镜像仓库以及服务器运行的游戏镜像。

### 镜像构建失败 {#build-failures}

**原因**

构建以 Job 形式运行在 `felis-build` 命名空间中。构建 Pod 依次执行 `egress-gate`、`context-fetch`、`kaniko`、`trivy`、`sbom` 和 `scan-gate` 步骤，全部成功后才执行最后的 `push` 步骤，因此被扫描拦截的镜像不会进入镜像仓库。构建错误会指明失败的步骤及其最后几行输出、超出的期限或扫描结论。

| 错误或状态 | 原因 |
| --- | --- |
| `the scan blocked the image: 1 CRITICAL, 1 HIGH (CVE-…, …)` | 漏洞或泄露机密的严重级别包含在 `[registry] scan_fail_on` 中（默认 `CRITICAL`）。 |
| 构建卡住，随后拉取基础镜像或软件包失败 | 构建 Pod 只能访问集群 DNS、内部镜像仓库和 API 内部接口，所有来自互联网的下载均被阻止。 |
| `felis fetch-context: … it changed after approval; refusing to build` | 上传的构建上下文与管理员审批时的摘要不一致。 |
| 审批时返回 `409 context_changed` | 提交者在审阅之后重新上传了文件。 |
| 上传返回 `507 uploads_full` 或 `403 submission_quota_exceeded` | 已上传的构建上下文超出 `user_uploads_max_bytes`（默认所有用户合计 4Gi）、单个用户的 2 GiB，或会使上传卷剩余空间低于 10%。单个上下文受 `context_max_bytes` 限制（默认 1Gi）。 |
| 提交返回 `400` 和 `must target the internal registry "…", not "…"` | 镜像引用指向内部镜像仓库之外。 |
| `push` 返回 `403` | 目标仓库位于 `felis/` 或 `mirror/` 下，这两个前缀保留给平台使用。 |
| `push` 返回 `401` | `felis-build` 命名空间中的 `felis-registry-push` Secret 缺失或已过期。 |
| 构建 Pod 状态为 `Evicted` | 构建占用的磁盘超过 `build_disk_limit`（默认 `12Gi`），包括解压的上下文、解包的基础镜像和镜像 tar 包。 |
| `the build namespace's NetworkPolicy is not enforced` | 集群未执行 NetworkPolicy（CNI 不支持，或 k3s 以 `--disable-network-policy` 启动）。 |
| `scan-gate` 以退出码 2 结束 | 扫描报告缺失或无法读取，构建按失败处理。 |

构建使用的 ServiceAccount `felis-build` 和 `felis-restore` 在任何位置都没有 Role，因此它们发出的所有 Kubernetes API 请求都会被拒绝。这是构建隔离的一部分，应保持它们没有任何权限。

**排查**

1. 在面板中打开「构建流水线」，在失败的构建上选择「扫描与日志」。该页面显示扫描结论和最多 100 条发现（拦截项排在前面），已接受为已知风险的发现标记为「已接受」，并提供 Trivy 报告和 SBOM 下载。
2. 查看每个步骤的输出：

   ```bash
   sudo k3s kubectl -n felis-build get jobs,pods
   sudo k3s kubectl -n felis-build logs job/<build-job> --all-containers --prefix
   sudo k3s kubectl -n felis-build describe pod <build-pod>
   ```

管理员也可以通过 API 读取相同的扫描数据：`GET /api/v1/images/build/{id}/scan`、`GET /api/v1/images/build/{id}/scan/report` 和 `GET /api/v1/images/build/{id}/sbom`。`404 scan_not_found` 表示构建在扫描前已停止；`404 scan_document_not_kept` 表示报告或 SBOM 超出每个镜像可保留的 6 MiB，扫描结论和发现始终保留。

**解决**

- **扫描拦截**：升级镜像中存在漏洞的组件后重新构建。如需将某项发现接受为已知风险，将其 ID（CVE 或 GHSA 编号，或 `aws-access-key-id` 等机密规则 ID）加入 `[registry] scan_accept`；已接受的发现仍会统计和列出。没有修复版本的漏洞仅在 `scan_fail_unfixed = true` 时拦截。将 `HIGH` 加入 `scan_fail_on` 后，所有基于平台 `felis/paper` 镜像的构建都会被拦截，因为其上游 `paper.jar` 含有五项可修复的 HIGH 级发现，接受这些 ID 后才能继续构建：

  ```toml
  [registry]
  scan_fail_on = ["CRITICAL", "HIGH"]
  scan_accept = ["CVE-2021-35515", "CVE-2021-35516", "CVE-2021-35517", "CVE-2021-36090", "CVE-2025-67030"]
  ```

  每次更换基础镜像时，应重新审查已接受的 ID。
- **下载被阻止**：让 Dockerfile 基于内部镜像仓库中的镜像（例如平台的 `felis/paper`），并将构建所需的全部文件放入上传的上下文。
- **上下文已变化**：下载并审阅新上传的文件，然后重新审批。如果在面板之外审阅（命令行下载或其他浏览器），应将所审阅文件的 `sha256sum` 与审阅页面显示的摘要进行比较。
- **上传配额**：删除已拒绝的提交，或提高 `user_uploads_max_bytes`。被拒绝提交的上传文件在判定 7 天后删除。
- **推送返回 `401`**：重新运行安装器，安装器会重新创建推送 Secret。**推送返回 `403`**：选择 `felis/` 和 `mirror/` 之外的仓库。
- **被驱逐**：提高 `build_disk_limit`，并保证节点剩余磁盘空间高于该值。
- **NetworkPolicy 未执行**：恢复集群的 NetworkPolicy 执行能力。

修改 `[registry]` 中的配置项时，须同时编辑两个配置文件并重新加载 API。felis-api 从 `felis-config` Secret 读取配置，仅重启无法使修改生效。

1. 在 `/etc/felis/felis.host.toml` 和 `/etc/felis/felis.pod.toml` 中修改该配置项。
2. 重新生成 Secret 并重启 felis-api：

   ```bash
   sudo k3s kubectl -n felis create secret generic felis-config \
     --from-file=felis.toml=/etc/felis/felis.pod.toml --dry-run=client -o yaml | sudo k3s kubectl apply -f -
   sudo k3s kubectl -n felis rollout restart deployment/felis-api
   ```

::: tip 提示
扫描结果反映构建当天的漏洞库，已准入的镜像之后不会再次扫描。如需重新扫描，先执行 `sudo felis mirror-build-tools -only trivy-db` 更新漏洞库，再以相同上下文发起新的构建。
:::

### 构建 Pod 无法启动 {#build-pods-not-starting}

**原因**

构建 Pod 运行 Kaniko 和 Trivy，Trivy 需要读取漏洞库和 Java 库。构建命名空间无法访问互联网，因此这四项都来自内部镜像仓库中的副本：

| 工具 | 镜像仓库中的副本 |
| --- | --- |
| Kaniko | `mirror/kaniko-executor:v1.24.0` |
| Trivy | `mirror/trivy:0.74.0` |
| 漏洞库 | `mirror/trivy-db:2` |
| Java 库 | `mirror/trivy-java-db:1` |

安装器通过 `felis mirror-build-tools` 复制这些副本，`felis-build-tools.timer` 在每天 04:00 和 16:00 更新它们。复制需要能够访问 gcr.io、ghcr.io 和 mirror.gcr.io。

| 症状 | 原因 |
| --- | --- |
| 构建一直处于「排队中」 | 已有 `[registry] max_concurrent_builds` 个构建正在运行（默认 2，最多 6）。排队的构建按提交先后启动。 |
| `mirror/kaniko-executor` 或 `mirror/trivy` 出现 `ImagePullBackOff` | 首次复制尚未完成，或安装时主机无法访问互联网。 |
| 扫描失败并提示 `failed to download vulnerability DB` | 缺少 `mirror/trivy-db:2`。 |
| 看门狗提示 `the vulnerability DB was last refreshed … ago` | 定时任务执行失败（网络、镜像仓库停止或磁盘已满）。连续三天没有成功执行时看门狗发出警告；扫描仍会拦截，但依据的是旧的漏洞公告。 |
| 设置 `build_user_namespaces = "on"` 后没有构建能够启动 | 节点无法运行 `hostUsers: false` 的 Pod。用户命名空间需要 Kubernetes 1.33 或更高版本、containerd 2.x，以及支持 idmapped mount 的内核（5.19 或更高版本；RHEL 和 CentOS Stream 9 内核已包含回移补丁）。 |

**排查**

```bash
sudo k3s kubectl -n felis-build get pods
journalctl -u felis-build-tools -n 50
sudo cat /var/lib/felis/build-tools/status.json
sudo k3s kubectl -n felis logs deploy/felis-api | grep 'build pods run'
```

felis-api 启动时在日志中说明构建 Pod 是否使用用户命名空间：`build pods run in a user namespace (hostUsers: false)` 或 `build pods run without a user namespace: …`。

**解决**

1. 主机能够访问 gcr.io、ghcr.io 和 mirror.gcr.io 后，重新复制工具：

   ```bash
   sudo felis mirror-build-tools                  # 全部构建工具与运行时
   sudo felis mirror-build-tools -only trivy-db   # 单项
   ```

2. 隔离网络中的主机：在可访问互联网的机器上获取这四个镜像，通过端口转发以 `platform` 用户身份按上表名称推送到镜像仓库：

   ```bash
   sudo k3s kubectl -n felis port-forward svc/registry 5000:5000
   # platform 用户的密码
   sudo k3s kubectl -n felis get secret felis-registry-auth -o jsonpath='{.data.platform}' | base64 -d
   ```

   推送目标为 `localhost:5000/mirror/<名称>:<标签>`。两个数据库应按需要的漏洞公告时效定期重复推送。定时任务能够访问上游之前，看门狗警告会一直保留。
3. 如果设置 `build_user_namespaces = "on"` 后构建无法启动，将其改回 `"auto"`（默认值，仅在节点支持时启用用户命名空间）或 `"off"`，修改方法见[镜像构建失败](#build-failures)。

::: info 说明
Kaniko v1.24.0 是上游的最后一个版本，不再获得安全修复。如需使用仍在维护的分支，将其镜像复制到 `mirror/` 下，并将 `[registry] kaniko_image` 设置为该镜像。
:::

### 镜像仓库推送或拉取失败 {#registry-errors}

**原因**

平台镜像仓库以 `registry` Deployment 运行在 `felis` 命名空间中，镜像地址形如 `registry.felis.svc:5000/<仓库>:<标签>`。节点通过回环端口 `127.0.0.1:5000` 拉取镜像，`/etc/rancher/k3s/registries.yaml` 将镜像仓库名称映射到该端口；端口和该文件缺一不可。读取无需凭证，所有写入都需要 `felis-registry-auth` Secret 中的令牌。

| 症状 | 原因 |
| --- | --- |
| 镜像仓库 Pod 无法启动，其存储卷一直处于 `Pending` | 集群没有默认 StorageClass。 |
| 写入返回 `503` 和 `Retry-After`，拉取正常 | 每日垃圾回收正在占用只读窗口。安装器和构建推送会等待窗口结束。 |
| 推送超大镜像层时进程被终止 | 镜像仓库内存耗尽（上限为 2Gi）。 |
| 磁盘压力或镜像垃圾回收后拉取失败 | `registries.yaml` 缺失或被修改，或镜像仓库已停止。 |
| 推送返回 `401` | 凭证缺失或错误。`felis-registry-auth` Secret 缺失时，镜像仓库变为只读。 |
| 平台镜像和用户镜像全部丢失 | 镜像仓库存储卷已丢失。 |
| 安装器在隔离网络主机上提示 `could not pull …` | 镜像仓库和 PostgreSQL 镜像来自 Docker Hub，并按摘要固定。 |

**排查**

```bash
sudo k3s kubectl -n felis get pods -l app.kubernetes.io/component=registry
sudo k3s kubectl -n felis get pvc registry
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000/healthz   # 预期为 200
sudo cat /etc/rancher/k3s/registries.yaml
sudo k3s kubectl -n felis logs deploy/registry -c registry-gc
```

匿名的 `GET /v2/` 请求返回 `401`，属于正常现象。

**解决**

- **存储卷 `Pending`**：将一个 StorageClass 设为集群默认。
- **垃圾回收期间返回 `503`**：等待窗口结束。如需立即执行回收，删除其标记文件并重启镜像仓库 Pod：

  ```bash
  sudo k3s kubectl -n felis exec deploy/registry -c registry-gc -- rm -f /var/lib/registry/.felis-last-gc
  sudo k3s kubectl -n felis rollout restart deploy/registry
  ```

- **拉取失败**：`registries.yaml` 必须将 `registry.felis.svc:5000` 映射到 `http://127.0.0.1:5000`。文件缺失或被修改时，重新运行安装器。
- **凭证**：`sudo felis rotate-token -yes registry` 替换镜像仓库令牌，并重启镜像仓库和 felis-api。参见[轮换凭证](/operations/access#rotate-credentials)。
- **存储卷丢失**：重新运行安装器，安装器会重新推送全部平台镜像。已配置[异地副本](/operations/backup#offsite)时，`sudo felis offsite fetch-images` 会按原摘要恢复用户镜像；该命令只推送缺失的内容，中断后再次运行的开销很小。未配置异地副本时，从已批准的提交重新构建用户镜像，其上传的上下文保留在上传卷中。固定到镜像仓库中已不存在的摘要的服务器无法拉取镜像，须由管理员为其选择当前镜像（参见[游戏镜像](#game-images)）。
- **隔离网络中的 `could not pull`**：将发布版附件复制到主机后安装（[离线安装](/guide/deployment#offline-install)）。没有附件时，在可联网的机器上按主机架构获取同一摘要的镜像，用 containerd 导出后在主机上导入：

  ```bash
  # 在可访问互联网的机器上执行；$ref 为警告中给出的带摘要的完整引用
  sudo ctr images pull --platform linux/amd64 "$ref"
  sudo ctr images export --platform linux/amd64 image.tar "$ref"
  # 在 Felis 主机上执行
  sudo k3s ctr images import image.tar
  ```

  ARM 主机使用 `linux/arm64`。`docker save` 会改写镜像清单，导出的副本将无法匹配摘要。导入后重新运行安装器，安装器会识别该镜像并将其固定，防止被镜像垃圾回收清除。

### 创建服务器或更换镜像被拒绝 {#game-images}

**原因**

游戏镜像使用可被安装器移动的标签，例如 `registry.felis.svc:5000/felis/paper:demo`。服务器创建时固定到当时该标签对应的摘要，因此始终运行同一个构建。每次运行安装器还会以后续运行不会改写的版本标签推送每个游戏构建，格式为 `<Minecraft 版本>-<镜像 ID 的 12 位十六进制>`（例如 `felis/paper:26.2-3f9c0a1b2c4d`）。连续 24 小时没有被任何服务器或白名单条目引用的构建会被镜像仓库删除；每个 `felis/` 仓库最新的 5 个构建始终保留。

| 消息 | 原因 | 解决 |
| --- | --- | --- |
| `image_not_in_registry` | 白名单中的标签从未推送到内部镜像仓库，或已被删除。 | 推送或重新构建该镜像后重试。 |
| `registry_unavailable` | felis-api 无法访问 `registry.felis.svc:5000`。 | 检查镜像仓库 Pod，并确认 `felis-registry-ingress` NetworkPolicy 仍允许 felis-api 访问。 |
| `the registry no longer holds build …` | 镜像指向的摘要已被镜像仓库清理。 | 选择当前标签。需要保留的构建，将其版本标签加入白名单。 |
| `409 image_change_unconfirmed` | 通过 API 更换镜像时未携带 `"confirmImageChange": true`。 | 备份世界后携带确认字段重新提交。 |
| 安装器提示 `could not pin every user server` | 镜像仓库停止，或服务器引用的标签已从镜像仓库丢失。 | 修复镜像仓库，并在启动这些服务器前执行 `sudo felis pin-images`。标签已丢失的服务器保留其裸标签，直到管理员为其选择新镜像。 |
| 安装器提示 `could not pin the login system server`（或 lobby） | 推送后镜像仓库未及时响应。 | 镜像仓库 Pod 就绪后重新运行安装器。 |
| 运行安装器期间某台运行中的服务器重启了一次 | 安装器将其固定到正在运行的构建。 | 无需处理，每台服务器只会发生一次。 |

**排查**

```bash
sudo k3s kubectl -n felis get pods -l app.kubernetes.io/component=registry
sudo k3s kubectl -n minecraft get minecraftserver <name> -o jsonpath='{.spec.image}'
```

`spec.image` 指明服务器运行的确切构建（`@sha256:` 之后的摘要）。

**解决**

将世界迁移到更新的构建或 Minecraft 版本：

1. 备份世界。Minecraft 加载区块时会升级区块格式，旧版本无法再打开这些区块。
2. 打开「编辑服务器配置」并选择镜像。重新选择当前标签会将服务器更新到该标签的最新构建。
3. 勾选「我已备份世界，确认更换镜像」并保存。

如需回退，重新设置之前的构建（审计日志为每次更换记录 `image_from` 和 `image_to`），并恢复升级前的备份。回退的前提是镜像仓库中仍保留旧构建。默认标签移动后，如需继续以指定 Minecraft 版本创建服务器，将该版本标签加入白名单（[镜像](/guide/administration#images)）。

### 服务端软件安装失败 {#software-install}

使用服务端软件的服务器在启动前安装服务端，安装失败时服务器停留在「启动中」，时限耗尽后显示「启动失败」。首次启动需要访问下载站；之后的启动只校验已下载的文件。

**排查**

```bash
sudo k3s kubectl -n minecraft logs <server>-0 -c install-server
sudo k3s kubectl -n felis logs deploy/felis-artifacts --tail=50
```

| 消息 | 原因 | 解决 |
| --- | --- | --- |
| `fetch <路径>: … content does not match its published digest` | 下载内容与官方公布的哈希值不一致，文件损坏或被替换。 | 重试启动。每次都出现时，报告该问题。 |
| `fetch <路径>: HTTP 403`、`HTTP 5xx` 或超时 | 节点无法访问下载站，或下载站暂时不可用。缓存日志中对应 `artifact download failed`。 | 确认节点可以访问互联网后重试启动。 |
| `software: <地址> answered HTTP …` | 首次安装时无法读取版本信息。 | 稍后重试启动。已安装的服务器不受影响。 |
| `the custom jar <路径> is not in the server's files yet` | 自定义 jar 尚未上传。 | 在服务器文件中上传 jar，或在「编辑服务器配置」中更正路径。 |
| `the forge installer failed`（或 neoforge） | 官方安装器运行失败，常见原因是无法访问其 Maven 仓库或内存不足。安装器使用服务器的内存上限。 | 查看日志中安装器的输出；内存不足时调大服务器内存。 |
| `a forwarding mod (Modrinth …) for <核心> <版本> not found` | Modrinth 已不再提供创建服务器时可用的转发组件。 | 更换游戏版本，或报告该问题。 |

下载缓存不可用时，服务器直接从官方来源下载，安装不会因此失败。

### Java 运行时不可用 {#runtime-unavailable}

创建服务器或更换服务端软件时提示 `runtime_unavailable`，或服务器 Pod 拉取 `mirror/eclipse-temurin` 镜像时出现 `ImagePullBackOff`。

**原因**

服务端软件运行在集群内镜像仓库中的 Java 运行时镜像上。安装器与 `felis-build-tools.timer` 通过 `felis mirror-build-tools` 从 Docker Hub 复制这些镜像，复制尚未完成或主机无法访问 Docker Hub 时，运行时不可用。

| Java 版本 | 镜像仓库中的副本 | `-only` 名称 |
| --- | --- | --- |
| 8 | `mirror/eclipse-temurin:8-jre` | `runtime-java8` |
| 17 | `mirror/eclipse-temurin:17-jre` | `runtime-java17` |
| 21 | `mirror/eclipse-temurin:21-jre` | `runtime-java21` |
| 25 | `mirror/eclipse-temurin:25-jre` | `runtime-java25` |

**解决**

主机能够访问 Docker Hub 后，复制运行时：

```bash
sudo felis mirror-build-tools                          # 构建工具与全部运行时
sudo felis mirror-build-tools -only runtime-java21     # 单个运行时
```

### 安装发布版时在主机上构建镜像 {#host-build-fallback}

**原因**

安装发布版时，安装器从发布版附件获取镜像和 Velocity 插件，并按发布版的 `SHA256SUMS` 逐一校验。某个附件无法使用时，安装器会指明该附件及原因，改为在主机上用 Docker 构建该镜像；此时镜像仓库和 PostgreSQL 镜像从 Docker Hub 拉取。每次下载最多尝试三次，间隔五秒；传输速度持续一分钟低于 1 KiB/s 时会中断并重试。

**排查**

查看安装器在构建前输出的消息：

| 消息 | 含义 | 解决 |
| --- | --- | --- |
| `release vX publishes no SHA256SUMS … building them on this host instead` | 发布版没有附件，或附件仍在上传。 | 对于新发布版，等发布页面列出 `SHA256SUMS` 后重新运行。 |
| `SHA256SUMS lists no <file>` 或 `could not download <file> from release vX` | 发布版缺少该附件。 | 稍后重新运行。在此之前主机构建的结果同样正确。 |
| `downloaded <file> hashes to …, but release vX's SHA256SUMS says …` | 下载内容损坏，或附件已被替换。 | 重新运行。每次都出现相同的不匹配时，说明附件本身有问题，应报告。 |
| `the release's image listing … is malformed` | `felis-images-linux-<arch>.txt` 无法解析。 | 报告该问题。所有镜像都会在主机上构建。 |
| `the release's registry image is …, but this installer runs …` | 安装器与发布版版本不一致。 | 运行该发布版标签对应的安装器；`felis update --panel` 会输出相应命令。 |
| `k3s containerd holds no <image> from <tar>` | tar 包中没有列表所指摘要的镜像。 | `sudo k3s ctr images ls \| grep felis` 显示已导入的内容。报告该问题。 |
| `FELIS_ARTIFACT_DIR: …`，安装停止 | 附件目录中的文件缺失或校验失败。从目录安装时不会回退到主机构建。 | 从发布版重新复制所指文件后重新运行。 |

构建插件时，`[felis] Downloading <file> (<host>)` 标明每项 Gradle 依赖下载，进行中的下载每十秒报告一次进度。`no new data for …; waiting for the download` 表示该下载已有三十秒没有收到新数据；Gradle 自身的超时和重试机制保持不变。

**解决**

在主机上构建约需要 `/var/lib/containerd` 下 8 GiB 空间（Docker 已有构建缓存时约 2 GiB）。空间不足时，安装会在安装 Docker 之前停止：

```
building here what the release did not supply takes about … MiB under /var/lib/containerd, and … has … MiB free; nothing has been built
```

可以等附件能够下载后重新运行、释放空间，或设置 `FELIS_PREFLIGHT=warn` 强制构建。中途停止的安装会将已下载的文件保留在 `/var/lib/felis/artifacts`，下次运行复用其中仍与 `SHA256SUMS` 一致的文件。

## 系统服务器与配置 {#configuration}

本节条目涉及未在现有服务器上生效的设置、空闲自动停服，以及已删除服务器遗留的世界卷。

### 新版本引入的设置未应用到现有服务器 {#system-server-fields}

**原因**

安装器只在登录空间和大厅服务器不存在时创建它们，已存在的服务器保持不变。因此，新版本为它们新增的字段在较早的安装中保持未设置：大厅可能缺少 RCON（控制台无响应，在线人数始终为 0），登录空间可能缺少 HTTP 就绪检查。在空闲自动停服成为默认设置之前创建的用户服务器没有空闲设置，无人时不会停止。在 RCON 成为默认设置之前创建的用户服务器控制台无响应、在线人数始终为 0、无法不停服备份，也不会空闲停服。

部分字段仅在满足条件时生效：

| 字段 | 行为 |
| --- | --- |
| `spec.startup.timeoutSeconds` | 启动允许的时间。`0` 或未设置时为 300 秒；超时后服务器进入 `Failed`，原因为 `StartupTimeout`。 |
| `spec.startup.readinessTimeoutSeconds` | 等待 RCON 探测期间整个启动过程的期限，从发出启动请求开始计算。`0` 或未设置时为 300 秒；超时后服务器进入 `Failed`，原因为 `ReadinessTimeout`。 |
| `spec.idle.autoStopEnabled`、`spec.idle.emptySecondsBeforeStop` | 仅在 `spec.rcon.enabled` 开启时生效，因为在线人数通过 RCON 读取。`emptySecondsBeforeStop: 0` 表示关闭空闲停服。 |

**排查**

```bash
sudo k3s kubectl -n minecraft get minecraftserver \
  -o custom-columns=NAME:.metadata.name,RCON:.spec.rcon.enabled,IDLE:.spec.idle.autoStopEnabled
```

**解决**

在镜像就绪之后（即运行安装器或完成更新之后）执行以下操作。如果服务器镜像不提供相应监听，启用 RCON 或就绪检查会使该服务器停留在 `Starting`，直到被标记为 `Failed`。

1. 补全系统服务器缺失的字段，并为较早的用户服务器设置默认的空闲自动停服（无人在线 600 秒后停止）：

   ```bash
   sudo felis converge
   ```

   已是最新状态的服务器显示 `already converged`。已设置的值不会被覆盖，因此管理员关闭的空闲停服保持关闭。不带 `-user-rcon` 时，该命令列出缺少 RCON 的用户服务器，但不修改它们。
2. 为从未设置过 RCON 的较早用户服务器启用 RCON：

   ```bash
   sudo felis converge -user-rcon
   ```

   每台服务器获得与新建服务器相同的 RCON 配置，修改在其下次启动时生效。Felis 自带的 Paper 和大厅镜像支持 RCON；对于用户构建的镜像，执行前应确认其支持 RCON。已明确设置 RCON（开启或关闭）的服务器不会被修改。

面板中也可执行相同操作：「平台设置 → 访问与安全 → 系统服务器补全」，第 2 步对应「为旧用户服务器启用 RCON」，然后选择「执行补全」。

### 删除服务器后世界卷仍然保留 {#world-volume-kept}

**原因**

世界卷的生命周期长于其 MinecraftServer 对象。直接删除该对象（例如使用 `kubectl`）会保留世界卷，以同名重新创建的服务器会挂载同一个世界。世界清理（闲置回收）是唯一会删除世界卷的进程，并且只在备份校验通过后删除。在面板中放弃或删除的服务器，由下一次每日世界清理归档并删除世界卷，这需要配置世界根目录（`FELIS_WORLDS_HOST_PATH`，参见[世界清理](/operations/backup#world-cleanup)）。世界卷存在期间会占用该名称：以此名称创建新服务器时返回 `409 world_volume_exists`。

**排查**

列出服务器已不存在的世界卷：

```bash
comm -23 \
  <(sudo k3s kubectl -n minecraft get pvc -l felis.lolicon.best/server -o jsonpath='{range .items[*]}{.metadata.labels.felis\.lolicon\.best/server}{"\n"}{end}' | sort) \
  <(sudo k3s kubectl -n minecraft get minecraftservers -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | sort)
```

**解决**

仅在确认不再需要该世界时删除世界卷：

```bash
sudo k3s kubectl -n minecraft delete pvc world-<name>-0
```

::: danger 危险
删除世界卷不可撤销。除非存在该世界的归档，否则世界将永久丢失。
:::

## 主机问题 {#host-problems}

本节条目涉及磁盘、主机地址、k3s 证书和系统时钟。系统日志为持久化存储，`journalctl -b -1` 可查看上次重启之前的日志。

### 磁盘写满时 Pod 被驱逐或镜像丢失 {#disk-full-symptoms}

**原因**

磁盘写满时，kubelet 首先驱逐游戏服务器 Pod。控制面 Pod（felis-api、operator、世界清理和镜像仓库）使用 `system-cluster-critical` 优先级类，不会被驱逐；kubelet 会为它们记录 `Eviction manager: cannot evict a critical pod`。随后 kubelet 可能清除未被使用的镜像。备份同样会停止：会使归档文件系统剩余空间低于 10% 的备份将失败，并提示 `not enough free disk for the archive`。

常见症状：

- 登录空间或大厅被驱逐，玩家无法进服。
- 驱逐之后 Pod 停留在 `ImagePullBackOff`。
- 看门狗发送邮件 `node … reports DiskPressure: the kubelet is evicting pods` 或 `the filesystem holding … is …% free`（剩余低于 15% 时为警告，低于 5% 时为严重）。
- 释放空间后，节点的 `DiskPressure: True` 最多还会保持约 5 分钟，等待调度的 Pod 也随之等待。

**排查**

```bash
df -h / /var/lib/rancher /var/lib/felis
sudo k3s kubectl describe node | grep -A 8 Conditions
sudo k3s kubectl get pods -A | grep -v Running
```

占用空间最多的通常是 k3s 的镜像（`sudo k3s ctr images ls -q`）以及 `/var/lib/rancher/k3s/storage` 下的世界卷和备份卷。

**解决**

1. 按[从满盘状态恢复](/operations/storage#disk-full)释放空间或扩容磁盘。
2. 镜像会自动恢复：所有平台镜像同时保存在平台镜像仓库中，节点在下次尝试时从镜像仓库拉回已清除的镜像。删除停留在 `ImagePullBackOff` 的 Pod 可立即重试。
3. 如果仍然拉取失败，按[镜像仓库推送或拉取失败](#registry-errors)检查镜像仓库 Pod、`http://127.0.0.1:5000/healthz` 和 `registries.yaml`。
4. 两处都不存在的镜像，重新运行安装器。安装器会从主机的 Docker 镜像存储重新构建或导入镜像，并推送到镜像仓库，因此应保留该存储作为恢复副本。

### 主机地址发生变化 {#host-address-changed}

**原因**

安装与安装时的 IP 地址绑定。k3s 节点、网络策略、面板证书和默认的 `<ip>.nip.io` 根域名都使用该地址。主机失去该地址后（DHCP 租约变化、虚拟机迁移），集群和游戏代理仍使用旧地址，面板也无法通过原名称访问。安装时如果检测到地址来自 DHCP 租约，安装器会发出警告。

**排查**

看门狗报告 `host-address`（严重，持续 5 分钟后发送）：`this host no longer holds <ip>, the address the install was made on (it has: …)`。

```bash
ip -brief address
journalctl -u felis-watchdog -n 40
```

**解决**

1. 为主机恢复原地址：在路由器上设置 DHCP 保留，或配置静态地址。使用 NetworkManager 时（例如 Rocky Linux）：

   ```bash
   sudo nmcli con mod <connection> ipv4.method manual ipv4.addresses <ip>/<prefix> ipv4.gateway <gateway> ipv4.dns <dns>
   sudo nmcli con up <connection>
   ```

2. 重启 felis-api 和游戏代理：

   ```bash
   sudo k3s kubectl -n felis rollout restart deploy/felis-api
   sudo systemctl restart felis-velocity
   ```

将安装迁移到新地址需要在恢复的备份上重新安装，参见[迁移到其他主机](/operations/backup#move-host)。使用默认 `<ip>.nip.io` 根域名时，在新地址上运行后执行 `sudo felis domain set <new-ip>.nip.io`（[更改根域名](/operations/access#change-domain)）。

::: info 说明
修改主机名不会造成影响。安装器在 `/etc/rancher/k3s/config.yaml.d/50-felis.yaml` 中固定了 k3s 节点名（`node-name:`），所有本地存储卷都绑定到该名称。可通过 `sudo k3s kubectl get node -o jsonpath='{.items[0].metadata.annotations.k3s\.io/node-args}'` 检查。
:::

### k3s 证书即将过期 {#k3s-certificates}

**原因**

k3s 自行签发的客户端和服务端证书（API 服务器、kubelet、管理员 kubeconfig、etcd）有效期为 365 天，CA 证书有效期为十年。k3s 只在启动时续签客户端和服务端证书，重新签发已过期或将在 120 天内过期的证书。在此期间因重启或 k3s 升级而重启过 k3s 的主机会自动完成续签。连续一年未重启 k3s 的主机会在证书过期当天失去 API 服务器和节点，面板将无法启动、停止或备份服务器。重启不会续签 CA 证书。

**排查**

看门狗将最早过期的证书报告为 `k3s-certs`：过期前 30 天发出警告，最后 7 天及过期后为严重。提示信息会说明重启能否续签该证书。

```bash
sudo k3s certificate check --output table
```

**解决**

1. 重启 k3s 后再次检查，已续签的证书有效期恢复为约一年：

   ```bash
   sudo systemctl restart k3s
   sudo k3s certificate check --output table
   ```

   重启只停止 k3s 本身：游戏服务器、PostgreSQL 和控制面继续运行，API 服务器在一分钟内恢复。`k3s-killall.sh` 会停止所有容器，不应用于此操作。
2. 如需在 120 天窗口之前续签全部客户端和服务端证书（例如与维护时段对齐）：

   ```bash
   sudo systemctl stop k3s && sudo k3s certificate rotate && sudo systemctl start k3s
   ```

3. CA 证书需要执行 `k3s certificate rotate-ca`，并按 [k3s 证书文档](https://docs.k3s.io/cli/certificate)中的步骤操作。

面板自身的证书（`/etc/felis/panel-tls.crt`）不在此检查范围内，参见[面板 TLS 证书](/operations/access#tls)。`felis watchdog -k3s-cert-dirs ""` 可关闭证书检查。

### 系统时钟未同步 {#clock}

**原因**

登录验证码和会话依据系统时钟过期，S3 拒绝签名时间偏差超过 15 分钟的异地副本上传，时钟偏差过大时证书校验也会失败。除非设置 `FELIS_MANAGE_TIME_SYNC=0`，安装器会开启 NTP（`timedatectl set-ntp true`，没有 NTP 客户端时安装 chrony）。防火墙丢弃出站 UDP 123 端口的流量时，时钟将无法同步。

**排查**

看门狗报告 `clock`（警告，持续 30 分钟后发送）。

```bash
timedatectl          # 预期为 "System clock synchronized: yes" 和 "NTP service: active"
chronyc sources
```

**解决**

1. 开启 NTP：

   ```bash
   sudo timedatectl set-ntp true
   ```

2. 放行到时间服务器的出站 UDP 123 端口。
3. 检查 `chronyc sources`，直到选中某个时间源且 `timedatectl` 显示时钟已同步。

## 备份与数据库 {#backups-database}

本节条目涉及世界备份、世界清理、下载、控制面数据库及其备份，以及异地副本。恢复与重建步骤见[备份与恢复](/operations/backup)。

### 世界备份被拒绝或失败 {#backup-failures}

**原因**

备份以 Job 形式运行，归档服务器的整个数据卷。已停止的服务器按原样归档；运行中的服务器进行不停服备份，复制世界期间暂停存档。备份开始前，felis-api 会检查 `[archive]` 或「备份与审计保留」卡片中设置的限制。

| 返回或消息 | 原因 | 解决 |
| --- | --- | --- |
| `429 backup_cooldown` | 每台服务器在冷却窗口内只能由所有者发起一次备份（`manual_cooldown`，默认 10 分钟）。 | 等待 `Retry-After` 指定的时间后重试。管理员不受此限制。 |
| `507 backup_store_full` | 现有备份总量已达到备份存储上限（`max_local_bytes`）。 | 删除不再需要的备份，或提高上限。管理员不受此限制。 |
| `not enough free disk for the archive` | 归档会使归档文件系统剩余空间低于 10%。 | 释放磁盘空间（[从满盘状态恢复](/operations/storage#disk-full)）。 |
| `409 not_stopped`，`the server is starting or stopping; back it up once it is running or stopped` | 服务器正处于状态切换中。 | 服务器运行或停止后重试。 |
| `503 live_backup_console` | 游戏未通过 RCON 响应 `save-off` 或 `save-all flush`：RCON 未开启或无法连接。 | 重试；在服务器停止后备份；或通过 `sudo felis converge -user-rcon` 开启 RCON（[新版本引入的设置未应用到现有服务器](#system-server-fields)）。 |
| `409 maintenance_in_progress` | 恢复、另一次备份、文件修改、世界下载或世界清理正在占用世界，或服务器正在重启。 | 该操作结束后重试。 |
| `409 not_stopped`，`stop the server before backing up its world` | 当前 felis-api 无法备份运行中的服务器。 | 先停止服务器。 |
| 删除备份时返回 `409 restore_in_progress` | 恢复操作可能正在读取该归档。 | 等待恢复完成。 |
| 备份被标记为「已损坏」 | 回读归档时校验和不一致。 | 该备份无法恢复，保留至过期，也可以手动删除。 |

定时备份（每日恢复点）遵循相同的限制。备份存储已满期间，felis-api 记录 `scheduled backups paused`，不启动任何定时备份；失败的定时备份在 `scheduled_every` 的四分之一时间后重试（默认 6 小时）。felis-api 缺少 `FELIS_IMAGE` 或 `FELIS_BACKUP_PVC` 时，启动日志会记录 `scheduled backups off (needs the backup executor)`。

**排查**

1. 打开服务器的「备份与恢复」页面。「最近操作」列出每次备份、恢复、定时备份和下载，以及其 Job 退出时的错误。
2. 列出作用于该服务器世界的 Job，并查看失败 Job 的日志：

   ```bash
   sudo k3s kubectl -n minecraft get jobs -l felis.lolicon.best/server=<name>
   sudo k3s kubectl -n minecraft logs job/<job>
   ```

**解决**

按表中的原因处理。不停服备份还需要同一节点上至少与世界大小相当的临时空间；复制步骤拒绝启动时，释放该空间。维护前如需备份所有世界，使用 `felis backup-now`（[备份所有世界](/operations/backup#backup-now)）。

### 世界清理 Job 失败 {#world-cleanup-failed}

**原因**

世界清理每天在 `minecraft` 命名空间中以 Job 形式运行一次。所有安装都会由它删除过期备份并回读校验归档。配置世界根目录后，它还会归档并删除闲置超过 15 天的世界，并执行在面板中放弃或删除服务器的请求。没有经过确认的备份时世界不会被删除，因此运行失败时世界保持不变。汇总行中以下任一计数大于零时，本次运行失败（退出码 1）：`skipped`（处理失败的服务器）、`expire_failed`（无法删除的过期备份）、`corrupt`（校验失败、已标记为「已损坏」的归档）或 `verify_failed`（无法读取的归档，下次运行重试）。Job 会重试两次。

**排查**

看门狗发送邮件 `world reaper Job … failed`；连续 26 小时没有成功运行时还会发送 `the world reaper has not succeeded for …`；对应的 Prometheus 告警为 `FelisWorldJobFailed`。查看日志，重点关注汇总行上方的错误：

```bash
sudo k3s kubectl -n minecraft get jobs | grep felis-reaper
sudo k3s kubectl -n minecraft logs job/<felis-reaper-job>
```

汇总行示例：

```
felis reaper: evaluated=12 reaped=1 released=0 deleted=0 awaiting_offsite=0 awaiting_stop=0 warned=2 skipped=0 store_full=0 evicted=0 expired=3 expire_failed=0 verified=6 corrupt=0 verify_failed=0 swept=0 orphan_archives=0
```

| 计数 | 含义 |
| --- | --- |
| `store_full` | 因备份存储已满而保留的世界。 |
| `awaiting_stop` | 尚未停止、留待下次运行处理的闲置服务器。某台服务器持续数天停留在此，说明它在被反复启动，或有 Job 一直占用其世界。 |
| `awaiting_offsite` | 已归档、但需等待异地副本确认后才删除的世界。超过一天仍大于零，说明异地副本同步失败。 |
| `orphan_archives` | 没有任何备份记录指向的归档。超过保留期限后删除，每次运行会列出前几个归档的路径。 |
| `evaluated=0` | 未配置世界根目录（`FELIS_WORLDS_HOST_PATH`）。运行只删除过期备份并校验归档；闲置世界既不归档也不释放，在面板中放弃或删除的服务器会一直等待处理。 |

**解决**

1. 修复汇总行上方指出的错误。每天都处理失败的服务器会保留其世界，并在原因修复之前每天使 Job 失败。
2. `store_full`：释放备份存储空间或提高其上限。
3. `awaiting_offsite`：参见[异地副本停止同步](#offsite-stopped)。
4. 世界是否闲置依据玩家进服记录判断。游戏代理无法上报进服事件时，正在游玩的世界也可能在 15 天后被判定为闲置，参见[玩家无法进服](#players-cannot-join)和[内部 API 错误](#internal-api-errors)。无主服务器在清理前不会收到提醒邮件；需要保留的服务器应认领，或通过 `spec.reaperExempt: true` 设为豁免。保留期限和提醒说明见[世界清理](/operations/backup#world-cleanup)。

### 备份或世界下载失败 {#download-failures}

**原因**

下载会启动一个 `felis-export` Job，经 felis-api 将归档流式传输到浏览器。导出世界需要服务器已停止，并在下载结束前一直占用世界，在此期间服务器无法启动。

| 返回或消息 | 原因 |
| --- | --- |
| `429 export_busy` | 达到限制：每个用户同时只能有一个导出，全平台同时最多两个，每个用户每小时最多六个。 |
| `410 export_expired` | Job 未在 10 分钟内连接到 felis-api。 |
| `503 export_unavailable` | felis-api 缺少 `FELIS_IMAGE` 或 `FELIS_BACKUP_PVC`，启动时记录 `world export disabled`。 |
| `409 not_stopped`、`409 no_world_volume` | 导出世界需要服务器已停止且存在世界卷。 |
| `409 backup_corrupt` | 归档与记录的校验和不一致，下载会提前中断。 |
| `felis-api answered 410 Gone: this export has expired …` | 下载就绪后 90 秒内没有被打开（标签页已关闭，或浏览器阻止了下载）。 |
| `felis-api answered 410 Gone: the download ended before the archive did …` | 浏览器取消了下载或连接中断。 |
| `felis-api answered 404 Not Found: no such export` | 导出开始后 felis-api 已重启，或下载凭证已失效。 |

**排查**

失败原因会作为 Job 的最后一行显示在服务器「备份与恢复」页面的「最近操作」中。

**解决**

1. 排除原因后重新发起导出，并保持标签页打开，直到浏览器保存完文件。
2. Job 始终未连接到 felis-api 的世界导出会占用世界，直到 Job 的两小时期限结束。可立即释放：

   ```bash
   sudo k3s kubectl -n minecraft delete job -l app.kubernetes.io/managed-by=felis-export,felis.lolicon.best/server=<name>
   ```

### 数据库备份过期或不完整 {#database-backup-overdue}

**原因**

`felis-db-backup.timer` 每天在 `FELIS_DB_BACKUP_TIME`（默认 `*-*-* 03:30:00`，另加最多 15 分钟随机延迟）执行 `felis db backup`。所有检查都以最新的每日备份包为准，期限为 26 小时；较新的手动、升级前或异地备份包可用于恢复，但不会解除告警，因为每日定时任务仍未恢复。常见原因：

- felis-postgres 未运行：`kubectl exec` 找不到运行中的 Pod，或提示 `pg_dump: … connection refused`（[数据库不可用](#database-unavailable)）。
- `k3s: executable file not found`：运行 `felis` 时 `PATH` 中没有 `/usr/local/bin`，其他位置也没有 k3s。
- 备份目录所在磁盘已满。写了一半的文件会被删除，之前的备份包保持完好。
- `pg_dump: server version mismatch`：外部数据库的版本高于主机上的客户端工具。

集群连续三次未响应 MinecraftServer 对象的导出时，备份包为「不完整」。该备份包仍包含数据库，但从它恢复不会恢复任何服务器；此时 `felis db backup` 以退出码 1 结束。升级时出现 `pre-migration backup failed, nothing applied` 的原因与此相同，此时不会应用任何迁移。

**排查**

「维护与备份 → 备份」中的「控制面数据库备份」卡片显示「已过期」「从未备份」或「不完整」，并给出修复命令。看门狗会发送邮件通知所有者。在主机上执行：

```bash
sudo felis db check                                   # 失败时以退出码 1 结束并说明原因
sudo felis db list                                    # 列出每个备份包及其时间
sudo systemctl status felis-db-backup.timer
sudo journalctl -u felis-db-backup -n 50 --no-pager
```

对应的 Prometheus 告警为 `FelisDBBackupStale` 和 `FelisDBBackupMetricMissing`。node-exporter 的 textfile 采集器未读取 `FELIS_DB_BACKUP_METRICS` 所在目录（默认 `/var/lib/node_exporter/textfile_collector/felis_db_backup.prom`）时，会触发后者。

**解决**

1. 按日志中的原因修复。外部数据库版本不一致时，安装对应版本的 `postgresql` 客户端软件包。
2. 立即执行每日备份，告警随之解除：

   ```bash
   sudo systemctl start felis-db-backup.service
   ```

3. 备份包「不完整」时，等 `sudo k3s kubectl get minecraftservers -A` 能够正常返回后，执行 `sudo felis db backup`。

计划、保留和恢复说明见[数据库备份](/operations/backup#database-backups)。

### 异地副本停止同步 {#offsite-stopped}

**原因**

`felis-offsite.timer` 每小时将世界归档、数据库备份包、用户镜像和上传文件复制到存储桶。看门狗和「异地副本」标签页（显示「需要处理」）会报告以下状态：

| 消息 | 原因 |
| --- | --- |
| `the off-site copy last completed … ago` | 连续 12 小时没有完成同步（网络、凭证、存储桶或时钟问题）。邮件会附上最后一次错误。 |
| `the off-site copy has never completed; …` | 首次同步尚未成功。 |
| `the off-site copy has stopped: the bucket's objects are sealed with another key, …` | `/etc/felis/offsite.env` 中的密钥与写入存储桶时使用的密钥不同，例如重新安装时生成了新密钥。安装器结束时显示 `OFF-SITE COPY STOPPED`。 |
| `the off-site copy has stopped: <host> took the bucket over, …` | 另一台主机执行了 `felis offsite take-over`。 |
| `this host was built from another host's backup and copies nothing into the off-site bucket: …` | 本机从备份包恢复而来，在另一台主机写入存储桶期间处于待命状态。 |
| 安装器结束时显示 `NO OFF-SITE COPY` | 未配置存储桶。 |

上行链路无法在“10 分钟加上按 512 KiB/s 计算的传输时间”内发送完成的对象会单独失败，保持待同步状态，并在下一轮重试。

**排查**

```bash
sudo felis offsite status        # 最近运行、错误、存储桶内容和待同步项；12 小时没有完成同步时以退出码 1 结束
sudo felis offsite check-key     # offsite.env 中的密钥是否与存储桶一致
sudo journalctl -u felis-offsite -n 50 --no-pager
systemctl list-timers felis-offsite.timer
```

`status` 中的 `missing:` 行是已被手动从存储卷删除的归档，这些归档已无内容可复制。`not whole:` 列出同步期间从镜像仓库丢失的镜像。

**解决**

- **临时故障**：修复网络、凭证或时钟（[系统时钟未同步](#clock)），然后执行 `sudo systemctl start felis-offsite.service` 或在卡片上选择「立即同步」。
- **密钥不一致**：将 `/etc/felis/offsite.env` 中的 `FELIS_OFFSITE_KEY` 设置为存储桶的密钥后执行一次同步；或将 `[offsite]` 指向空的存储桶或前缀并重新运行安装器（[加密密钥](/operations/backup#offsite-key)）。
- **被误接管**（例如被演练用的机器接管）：在生产主机上执行 `sudo felis offsite take-over -yes`。
- **重建后处于待命状态**：确认本机永久替代旧主机后，执行 `sudo felis offsite take-over -yes`（[整机重建](/operations/backup#rebuild-host)）。
- **定时任务缺失**：重新运行安装器。

### 数据库不可用 {#database-unavailable}

**原因**

控制面数据库以 `felis-postgres` Deployment 运行，数据位于主机的 `/var/lib/felis/postgres`。数据库不可用时，登录、面板和服务器管理均会失败。

| 症状 | 原因 | 解决 |
| --- | --- | --- |
| `postgres` 出现 `ImagePullBackOff` 或 `ErrImagePull` | 节点无法访问 Docker Hub，且本地没有副本。 | 按[镜像仓库推送或拉取失败](#registry-errors)中的方法导入镜像。 |
| `CreateContainerConfigError`，`secret "felis-postgres" not found` | 超级用户 Secret 已丢失。 | 重新运行安装器，安装器会创建新的 Secret。 |
| 日志显示 `/var/lib/postgresql/18/docker` 上的 `Permission denied` | 数据目录失去了属主（uid 999），或在 SELinux enforcing 模式下失去了 `container_file_t` 标签。 | 重新运行安装器，或执行 `sudo chown -R 999:999 /var/lib/felis/postgres` 和 `sudo restorecon -R /var/lib/felis/postgres`。 |
| 日志显示 `database files are incompatible with server` | 数据由另一个 PostgreSQL 大版本创建。 | 按 [PostgreSQL 大版本升级](/operations/upgrade#postgresql-major)操作。 |
| `Pending`，`Insufficient memory` | 节点没有足够资源容纳该 Pod。 | 释放节点内存。 |
| felis-api 处于 `CrashLoopBackOff`，提示 `database schema is newer than this felis build: …` | felis-api 被回滚到迁移数据库之前的版本。 | 恢复升级时生成的 `pre-migrate` 备份包（[回滚](/operations/upgrade#rollback)）。 |
| `database schema is behind this felis build` | 缺少数据库迁移。 | 执行 `sudo felis migrate up -config /etc/felis/felis.host.toml`。 |
| felis-api 日志出现 `audit: lost …`，告警 `FelisAuditWriteFailing` | 无法写入审计记录，几乎都是 PostgreSQL 故障所致。 | 按下文检查数据库。 |
| 请求变慢；出现 `canceling statement due to statement timeout` | 请求在排队等待 25 个连接池连接之一，或某条语句超过 15 秒。 | 通过 `pg_stat_activity` 查找慢查询或锁。 |

安装器在 10 分钟内未等到数据库就绪时停止，提示 `felis-postgres did not become ready` 并输出 Pod 事件。看门狗在 3 分钟后发送 `PostgreSQL is unreachable: …`。

**排查**

```bash
sudo k3s kubectl -n felis get pods -l app.kubernetes.io/component=postgres -o wide
sudo k3s kubectl -n felis describe deploy/felis-postgres | tail -n 30
sudo k3s kubectl -n felis logs deploy/felis-postgres --tail=60
```

以超级用户身份手动查询数据库：

```bash
sudo k3s kubectl -n felis exec -it deploy/felis-postgres -c postgres -- psql -U postgres felis
```

```sql
SELECT pid, state, wait_event, query FROM pg_stat_activity;
```

**解决**

按表中的方法处理。如需撤销误操作或恢复受损数据，按[恢复数据库](/operations/backup#restore-database)恢复数据库备份包。

## 邮件与告警 {#mail-alerts}

### 邮件无法送达 {#mail-problems}

**原因**

登录验证码、邮箱验证和身份确认邮件、世界清理提醒、看门狗告警以及应急登录验证码都通过同一个邮件中继发送。在面板「邮件服务」卡片中保存的中继优先于 `felis setup` 写入 `felis.toml` 的 `[smtp]` 中继。

| 症状 | 原因 | 解决 |
| --- | --- | --- |
| `503 mail_unavailable` | 未配置邮件中继，只能使用 Passkey 登录。 | 配置邮件中继（见下文）。 |
| `429 mail_rate_limited`，告警 `FelisMailBudgetExhausted` | 每小时发信额度已用完（`[smtp] max_per_hour` 或「每小时发信上限」，默认 120，其中四分之一可一次性发出）。 | 查看 `felis_rate_limited_total` 判断是否存在请求洪泛。如果登录请求真实有效，将上限提高到中继允许的值。 |
| `502 mail_undeliverable`，告警 `FelisMailDeliveryFailing` | 中继拒绝了邮件。 | 在 felis-api 日志中查看中继给出的原因。 |
| `smtp: <host>:<port> does not offer STARTTLS`，或卡片显示 `smtp_tls` | 中继使用 465 以外的端口且不支持 STARTTLS。 | 使用 465 端口或支持 STARTTLS 的中继（见下文）。 |
| `smtp_unreachable` | 无法连接中继；端口不是 25、465、587 或 2525；或地址解析为链路本地、未指定或组播地址。 | 更正主机和端口。 |
| `smtp_auth` | 中继拒绝了凭证。 | 更正用户名和密码。 |
| `smtp_sender_refused`、`smtp_recipient_refused` | 中继拒绝了发件人或收件人。 | 使用邮件服务商已授权的发件地址，并检查收件地址。 |
| `409 mail_settings_changed` | 卡片加载后中继设置已被修改。 | 重新加载后再保存。 |
| 安装结束时显示 `NO ALERT MAIL`，告警只写入系统日志 | 没有邮件中继，或没有已验证邮箱的所有者。 | 配置邮件中继并验证所有者的邮箱。 |
| 世界清理日志出现 `reaper: warning suppressed — no warner wired` | 没有邮件中继，或服务器所有者没有已验证的邮箱。 | 配置邮件中继。提醒窗口未结束时，待发送的提醒会在下一次每日运行时发出。 |

**排查**

1. 打开「平台设置 → 通知与保留」。「邮件服务」卡片显示当前生效的中继：「面板设置」「安装时的设置」或「未配置」。
2. 选择「发送测试邮件」。该操作按当前填写的设置向所有者的已验证邮箱发送一封测试邮件，并指出失败的阶段。每次测试都计入每小时发信额度。
3. 查看面板不显示的中继原始错误：

   ```bash
   sudo k3s kubectl -n felis logs deploy/felis-api | grep -i smtp
   journalctl -u felis-watchdog -n 40
   sudo felis doctor
   ```

**解决**

1. 在「邮件服务」卡片中填写中继，选择「检查并保存」。Felis 会先向发件地址发送一封自检邮件，中继接受后才保存。发件人须为不带显示名称的纯邮箱地址。
2. 也可以执行 `sudo felis setup` 配置邮件。在其中保存会写入 `[smtp]`，同时清除面板中保存的中继，使 setup 中填写的中继生效。中继密码应通过 `felis setup` 修改；手动编辑 `felis-smtp` Secret 只在下次运行安装器之前有效。
3. 通过可信网络访问且不支持 STARTTLS 的中继，可在卡片上关闭「要求加密连接」，或在 `/etc/felis/felis.toml` 和 `/etc/felis/felis.pod.toml` 的 `[smtp]` 中设置 `require_tls = false`。
4. 如需接收告警邮件，在「账户 → 邮箱验证」中验证所有者的邮箱地址。

登录限流和账户锁定见[登录问题](#sign-in-problems)。邮件中继、看门狗和心跳的说明见[邮件中继](/operations/monitoring#mail-relay)、[看门狗](/operations/monitoring#watchdog)和[心跳](/operations/monitoring#heartbeat)。

## 文件与计划任务 {#files-schedules}

### 文件管理拒绝修改或上传 {#file-manager-errors}

**原因**

「服务器文件」页面仅向服务器所有者和管理员开放，且只能在服务器完全停止时使用。浏览目录和读取文件不占用世界。每项修改（保存、新建文件或文件夹、重命名、删除、上传、解压）都会运行一个 Job，并在其结束前占用世界，在此期间的唤醒或另一项修改会返回 `409 maintenance_in_progress`。

| 状态码 | 错误码 | 含义 | 解决 |
| --- | --- | --- | --- |
| `409` | `not_stopped` | 游戏 Pod 仍然存在，通常正在完成关服存档。 | 等 `sudo k3s kubectl -n minecraft get pods -l felis.lolicon.best/server=<name>` 无输出后重试。 |
| `409` | `maintenance_in_progress` | 另一项修改、备份、恢复或世界清理正在占用世界。 | 该操作结束后重试。 |
| `409` | `file_exists` | 新建文件、文件夹、重命名或上传的目标路径已存在内容。 | 更换名称；上传时可选择「替换」。 |
| `409` | `file_changed` | 编辑器读取文件后，文件已被修改。 | 选择「载入最新内容」或「仍然覆盖」。 |
| `400` | `bad_path` | 路径超出世界卷，或会移动 `server.properties`、`config`、`config/paper-global.yml`，或读取 `config/paper-global.yml`。 | 这三项须保持原名；`paper-global.yml` 包含所有服务器共用的转发密钥。 |
| `404` | `not_found` | 路径或新文件夹的上级目录已不存在。 | 选择「刷新」。 |
| `413` | `too_large` | 读取超过 1 MiB、保存超过 256 KiB，或单次请求上传超过 64 MiB。 | 大文件应整体上传，不在编辑器中修改。面板会自动分片上传超过 64 MiB 的文件。 |
| `411` | `length_required` | 上传请求缺少 `Content-Length`。 | 通过面板上传，或使用 `curl -T`。 |
| `400` | `upload_incomplete` | 请求体在声明的长度之前结束，未做任何修改。 | 重试。 |
| `507` | `upload_staging_full` | 暂存该上传会使 felis-api 的暂存文件系统剩余空间低于 10%。 | 释放上传卷的空间。 |
| `507` | `volume_full` | 世界卷已满，原文件保持不变。 | 删除服务器不再需要的文件，或扩容存储卷。 |
| `504` | `files_timeout` | felis-api 等待 90 秒后停止等待。 | Job 可能仍会完成（见下文）。 |
| `503` | `files_unavailable` | felis-api 未配置文件 Job 执行器或上传暂存。 | 检查 felis-api 的启动日志。 |
| `404` | `upload_not_found` | 大文件上传会话已不存在：已取消、已完成、闲置 6 小时，或 felis-api 已重启。 | 重新上传该文件。 |
| `429` | `too_many_uploads` | 该账户已有 4 个大文件上传正在进行。 | 完成或取消其中一个。 |
| `429` | `export_busy` | 下载限制：每个用户同时两个，全平台同时四个，每个用户每小时 30 个。 | 稍后重试。 |

分片上传过程中出现的 `upload_offset_mismatch`、`upload_busy` 和 `409 upload_incomplete` 由面板自动处理并续传。解压 `.zip` 时会在写入任何内容之前检查所有条目，失败时不做任何修改：`archive_unsafe`（条目超出目标文件夹）、`archive_symlink`（条目为链接）、`type_conflict`（压缩包中的文件与服务器上的文件夹同名，或相反）、`archive_invalid`（条目大小与压缩包声明不符）和 `volume_full`。未选择替换时，会覆盖现有文件的压缩包以 `file_exists` 结束并附带文件列表，面板会显示该列表供确认。文件夹不能直接上传，应压缩为 `.zip` 上传后解压。

**排查**

```bash
sudo k3s kubectl -n minecraft get jobs -l felis.lolicon.best/server=<name>,app.kubernetes.io/managed-by=felis-files
sudo k3s kubectl -n minecraft get jobs -l felis.lolicon.best/server=<name>,felis.lolicon.best/files-async=true
sudo k3s kubectl -n minecraft logs job/<job>
```

已结束的 Job 及其日志保留两分钟；没有结果就失败的大文件上传或解压，其日志保留 30 分钟。Job 无法获取暂存的上传文件或字节不一致时，日志会说明原因。

**解决**

按表中的错误码处理。出现 `files_timeout` 后，Job 会继续运行到自身两分钟的期限，修改仍可能完成，并在结束前一直占用世界。Job 消失后选择「刷新」，确认修改是否已生效。大文件上传和解压在后台运行，最长 2 小时，关闭页面后仍会继续；失败时显示上表中的错误码，或显示 `job_failed` 及 Job 的状态（超过 2 小时为 `DeadlineExceeded`）。

### 计划任务被跳过、错过或失败 {#schedule-errors}

**原因**

felis-api 每 15 秒检查一次计划任务，并在「计划任务」页面记录每次执行的结果。控制台命令、重启和停止只在服务器运行时执行，启动只在服务器停止时执行。运行中的服务器以不停服方式备份；无法不停服备份时，先停止服务器，备份后再启动。每个步骤都有期限：Pod 须在 15 分钟内停止，备份 Job 须在 45 分钟内结束，启动有 15 分钟。无法完成的重启或备份，如果服务器原本在运行，仍会重新启动服务器。

| 结果 | 详情 | 解决 |
| --- | --- | --- |
| 已跳过 | `the server has a new owner since this schedule was saved; save it again to use it` | 服务器所有者已变更，任务已自动关闭。新所有者检查任务后重新保存即可启用。 |
| 已跳过 | `the server was not running`、`the server was already stopped`、`the server was already running`、`the server has no world yet`、`the server is being given up or deleted`、`the server no longer exists`；启动任务还可能为 `the cluster is at its running-server cap` 或 `the world is busy with …` | 本次执行没有可操作的对象，下次执行时会再次尝试。 |
| 错过 | `felis-api was not running at the scheduled time` | felis-api 在预定时间之后停止运行超过 10 分钟。本次执行被放弃，下次执行照常进行。 |
| 失败 | `felis-api stopped in the middle of this run` | 执行期间 felis-api 重启。确认服务器处于预期状态。 |
| 失败 | `the server did not stop within 15 minutes` | 参见[服务器无法停止](#server-wont-stop)。备份未执行。 |
| 失败 | `another operation kept the world busy for 15 minutes` | 恢复、文件修改或另一次备份占用了世界。 |
| 失败 | `the backup failed: …`、`the backup did not finish within 45 minutes`、`the backup store is full; ask an administrator to free space` | 参见[世界备份被拒绝或失败](#backup-failures)。「备份与恢复」页面显示对应的 Job。 |
| 失败 | `could not start the server again: …` | 服务器已停止但无法重新启动（达到运行服务器上限、服务器正在被放弃，或 15 分钟后世界仍被占用）。原因排除后在面板中启动服务器。 |
| 失败 | `the server console could not be reached`、`the console is not configured`、`the command failed: …` | RCON 无法连接或未开启。参见[服务器卡在启动中](#server-stuck-starting)和[新版本引入的设置未应用到现有服务器](#system-server-fields)。 |

执行进行中的任务无法编辑、删除或再次执行（`409 schedule_running`）。

**排查**

每个任务行显示最近一次的结果和详情。审计日志将每次完成的执行记录为 `schedule.run`，包含结果和详情（[审计日志](/guide/administration#audit-log)）。

**解决**

按表中的详情处理。以下时间规则可解释执行时间与预期不符的情况：

- 夏令时切换时被跳过的时间点会提前一小时执行；重复出现的时间点只在第一次执行。
- 主机无法识别的时区按 UTC 执行。
- 「立即执行」会立刻开始一次执行，对已关闭的任务同样有效，且不改变下次计划的执行时间。
- 删除服务器会删除其计划任务；同名新建的服务器没有任何计划任务。

## 快速索引 {#quick-reference}

| 症状 | 参见 |
| --- | --- |
| 从何处开始：状态、健康检查、支持包、日志 | [首先检查](#first-steps) |
| 主机重启后平台未恢复；k3s、游戏代理等服务未运行 | [平台服务未运行](#services-down) |
| 服务器卡在 `Starting`；`PodNotReady`、`RconNotReachable` | [服务器卡在启动中](#server-stuck-starting) |
| 服务器处于 `Failed`；`StartupTimeout`、`ReadinessTimeout` | [服务器进入 Failed](#server-failed)、[新版本引入的设置未应用到现有服务器](#system-server-fields) |
| 服务器无法停止 | [服务器无法停止](#server-wont-stop) |
| 「登录与大厅」页面提示登录空间或正式大厅尚未创建 | [登录空间或正式大厅不存在](#system-servers-missing) |
| 服务器无人时不停止；在线人数始终为 0；`PlayersCounted` 为 `False` | [服务器无人时不自动停止](#idle-stop) |
| 玩家无法进服或被送到错误位置；唤醒被拒绝 | [玩家无法进服](#players-cannot-join) |
| 路由未启用 | [路由未启用](#routing-disabled) |
| 面板返回 401 或 403 | [面板错误](#panel-errors) |
| 登录被拒绝：`rate_limited`、`otp_account_locked` | [登录问题](#sign-in-problems) |
| 游戏代理或插件访问内部 API 返回 401 | [内部 API 错误](#internal-api-errors) |
| 账号绑定或认领错误 | [账号绑定错误](#account-link-errors) |
| 构建失败；扫描拦截；`context_changed`；`uploads_full` | [镜像构建失败](#build-failures) |
| 构建一直「排队中」；`mirror/kaniko-executor` 出现 `ImagePullBackOff`；`failed to download vulnerability DB` | [构建 Pod 无法启动](#build-pods-not-starting) |
| 镜像仓库推送或拉取失败；写入返回 `503`；隔离网络主机提示 `could not pull …` | [镜像仓库推送或拉取失败](#registry-errors) |
| `image_not_in_registry`、`registry_unavailable`、`image_change_unconfirmed`；将世界迁移到更新的 Minecraft 版本 | [创建服务器或更换镜像被拒绝](#game-images) |
| 使用服务端软件的服务器启动失败；`install-server` 日志报错 | [服务端软件安装失败](#software-install) |
| `runtime_unavailable`；`mirror/eclipse-temurin` 出现 `ImagePullBackOff` | [Java 运行时不可用](#runtime-unavailable) |
| 安装发布版时在主机上构建镜像 | [安装发布版时在主机上构建镜像](#host-build-fallback) |
| 大厅控制台无响应；较早的服务器缺少 RCON 或空闲停服；`felis converge` | [新版本引入的设置未应用到现有服务器](#system-server-fields) |
| `409 world_volume_exists`；删除服务器后世界卷仍在 | [删除服务器后世界卷仍然保留](#world-volume-kept) |
| Pod 被驱逐；`DiskPressure`；文件系统告警 | [磁盘写满时 Pod 被驱逐](#disk-full-symptoms)、[从满盘状态恢复](/operations/storage#disk-full) |
| 看门狗报告 `host-address`；地址变化后面板无法访问 | [主机地址发生变化](#host-address-changed) |
| 看门狗报告 `k3s-certs` | [k3s 证书即将过期](#k3s-certificates) |
| 看门狗报告 `clock`；S3 拒绝异地副本上传 | [系统时钟未同步](#clock) |
| `backup_cooldown`、`backup_store_full`、`live_backup_console`、`not enough free disk for the archive` | [世界备份被拒绝或失败](#backup-failures) |
| 世界清理 Job 失败；`awaiting_stop`；备份被标记为「已损坏」 | [世界清理 Job 失败](#world-cleanup-failed) |
| 下载被拒绝或中断：`export_busy`、`export_expired`、`export_unavailable` | [备份或世界下载失败](#download-failures) |
| 数据库备份「已过期」「从未备份」或「不完整」；`FelisDBBackupStale`；`pre-migration backup failed, nothing applied` | [数据库备份过期或不完整](#database-backup-overdue) |
| `the off-site copy last completed … ago`；`OFF-SITE COPY STOPPED`；`awaiting_offsite` 持续大于 0 | [异地副本停止同步](#offsite-stopped) |
| `felis-postgres did not become ready`；`database schema is newer than this felis build` | [数据库不可用](#database-unavailable) |
| 撤销误操作；恢复数据库 | [恢复数据库](/operations/backup#restore-database) |
| 主机已丢失 | [整机重建](/operations/backup#rebuild-host) |
| 升级出现问题 | [回滚](/operations/upgrade#rollback) |
| `mail_unavailable`、`mail_rate_limited`、`smtp_tls`；`NO ALERT MAIL` | [邮件无法送达](#mail-problems) |
| 看门狗告警邮件；`NO HEARTBEAT` | [看门狗](/operations/monitoring#watchdog)、[心跳](/operations/monitoring#heartbeat) |
| 没有管理员能够登录 | [应急访问](/operations/access#break-glass) |
| 服务器文件：修改、上传或解压被拒绝 | [文件管理拒绝修改或上传](#file-manager-errors) |
| 计划任务显示已跳过、错过或失败 | [计划任务被跳过、错过或失败](#schedule-errors) |
| 工作节点离线，其上的服务器停止运行 | [故障切换](/guide/distributed#failover) |
