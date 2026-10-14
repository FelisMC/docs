---
title: 故障排查
---

# 故障排查 {#felis-troubleshooting-checklist}

本文对应规范 §28 #23，覆盖平台实际产生的故障。每个症状都对应明确的 `status.conditions` 原因、HTTP 错误码、日志或清单名称，便于从现象找到发出信号的代码路径。

## 如何阅读本文 {#how-to-read-this-document}

每项按「症状 → 可能原因 → 检查位置 → 修复」编排。`kubectl` 须在节点上以 root 运行（`sudo -i` 或 `sudo k3s kubectl …`），因为管理员 kubeconfig `/etc/rancher/k3s/k3s.yaml` 仅 root 可读，见 §13c。

- **[GO-TESTED]**：隔离的 `*_test.go` 覆盖该具体路径，CI 断言对应字符串或错误码。
- **[PG-TESTED]**：`internal/pgint` 的 `-tags pgint` 测试针对真实 Postgres 及随附迁移执行，命令见贡献指南。
- **[CODE-ONLY]**：路径和信号确实存在，但无对应单元测试；例如未由本仓库 Go 测试编译验证的 Velocity Java 插件。
- **[INTEGRATION-ONLY]**：症状来自 kubelet、Kaniko、containerd、Postgres 或网络，可在 `kubectl describe` / Pod 日志看到，未必写入 `MinecraftServer.status`。
- **[INERT]**：CRD 字段存在但无控制器读取，调整无效。**当前没有此类 CRD 字段**；最后的 `spec.storage.retainOnDelete` 已移除，原因见 §13。配置似乎无效时，通常是不满足生效条件，见 §12。

operator 不会自行生成父域名；路由身份为部署域名下的 `spec.subdomain`。示例使用 `<root-domain>`、`registry.<ns>.svc:<port>` 占位符。

本文中的多数 `felis` 命令也可由 Owner 在面板中执行：主机状态、看门狗告警及其邮件暂缓、数据库备份包、世界备份、异地副本、重建、`felis doctor`、诊断包、审计导出、访问方式、根域名、上传存储、凭据轮换和系统服务器补全。各项在面板中的位置见[运维手册第 9 节](/operations/#_9-running-the-host-from-the-panel-go-tested-sh-tested)。下文命令仍是权威参考，也是面板或 `felis-node-control` 停止运行时的唯一途径。

---

## 0. 首先检查：`felis status`、`felis doctor`、`felis support-bundle` {#_0-first-look-felis-status-felis-doctor-felis-support-bundle}

以下三个命令在节点以 root 运行，只读，不修改状态，也不发送邮件，可随时执行。

**`sudo felis status`** 汇总发布版、节点/kubelet、各控制平面 Deployment 的就绪副本、镜像和重启次数、`felis-velocity` 及游戏端口、每服目标状态/阶段/玩家数/最新世界备份、数据库备份包、异地副本、磁盘/内存，以及看门狗未关闭的告警。某部分不可用时仍打印其余内容：k3s 停止时显示 `unreachable (...)`、服务器显示 `unknown while the cluster is unreachable`；PostgreSQL 停止时备份列为 `?`，表下说明原因。[GO-TESTED: `TestStatusReport`, `TestStatusWithPartsDown`, `TestStatusClusterEdges`, `TestStatusBackups`, `TestStatusWatchdog`]

**`sudo felis doctor`** 使用 `felis-watchdog.service` 配置运行全部看门狗检查，另检查主机上的失败 unit、停止的长期服务（`k3s`、`felis-velocity`）、不再触发的定时器、无法送达的告警（无 SMTP 或无已验证邮箱的所有者）、不可用的心跳 URL。按领域逐行输出：`✓` 正常、`!` 警告、`✗` 严重、`-` 未检查并说明原因，例如未配置异地副本；每项给出下一检查位置：

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

发现问题时退出 1，否则 0，可用于脚本。它不发邮件、不发送心跳、不改变看门狗状态；告警由下次正式巡检按 §14 的延迟发送。缺少或无法读取 unit 本身就是严重问题，随后使用默认配置检查。[GO-TESTED: `TestDoctorReportsByArea`, `TestDoctorMailsPingsAndSavesNothing`, `TestDoctorWithoutUnitOrConfig`, `TestUnitFindings`, `TestPrintDoctorReport`]

**`sudo felis support-bundle`** 创建 `/var/lib/felis/support/felis-support-<host>-<time>.tar.gz`，权限 0600，`-o DIR` 可改目录。内容包括 `status.txt`、`doctor.txt`、发布版、无凭证的配置摘要、unit/定时器、`df`、地址/内存、`/etc/felis` 文件名（无内容）、Felis/k3s 日志（默认 `-since 48h`、`-log-lines 2000`）、节点/卷/服务器，以及控制平面、构建、服务器命名空间的 Pod、Deployment、StatefulSet、Job、CronJob、Service、PVC、网络策略和事件。收集控制平面及构建容器日志尾部，重启过的也收集前次日志。游戏服默认仅收集 initContainer 日志；其主日志含玩家名、IP、聊天，须显式 `-server-logs` 才加入。

诊断包排除全部 Secret、ConfigMap、配置文件内容、数据库和世界。收集内容会脱敏主机机密文件中的值（`secrets.env`、`offsite.env`、邮件/上传密钥、心跳 URL、转发密钥、代理及 k3s 令牌）、数据库密码、Pod/服务器环境变量、URL 密码、私钥、`Bearer`/`Basic` 凭证，以及 `password=`、`token=`、`secret=` 等日志值。`MANIFEST.txt` 列出已收集、已脱敏及未能收集的内容。**发送前务必检查诊断包**：规则不认识的日志格式可能仍含机密。[GO-TESTED: `TestSupportBundle` 在各来源植入 25 个机密并确认全部移除，`TestSupportBundleWithTheClusterDown`, `TestSupportBundleServerLogs`, `TestScrubber`]

---

## 1. 服务器卡在 `Starting`，无法进入 `Running` {#_1-server-is-stuck-in-starting-and-never-becomes-running}

启动未成功时，每 2 秒重新协调，直到启动或就绪时限耗尽并进入 `Failed`。Pod 未通过 TCP 就绪为 `StartupTimeout`，RCON 探测未成功为 `ReadinessTimeout`。`spec.startup.timeoutSeconds`、`spec.startup.readinessTimeoutSeconds` 未设置或为 0 时默认均为 **300 秒**，且都从 `status.startRequestedAt` 计算。[GO-TESTED: `TestReconcileRunning_StartupTimeoutConvertsToFailed`, `TestReconcileRunning_ReadinessTimeoutConvertsToFailed`]

偶尔看到 `Starting` 正常，单次探测失败不能让阶段反复变化（`TestReconcileRunning_RconProbeFailureStaysStarting`）。持续超过时限则可能根本未运行协调循环，先查看 operator 日志。底层原因应从 Pod 状态诊断。

先读取条件原因：

```
kubectl get minecraftserver <name> -o jsonpath='{.status.conditions}'
```

`markStarting` 向 `Ready=False`、`RconReached=False` 写入相同原因：

| 原因 | 含义 | 重试间隔 |
| --- | --- | --- |
| `PodNotReady` | `status.readyReplicas < 1`，Pod 尚未 TCP 就绪 | 2 秒 |
| `SpecChanged` | 未就绪时 spec 改变，operator 按新模板重建 Pod（§1a） | 2 秒 |
| `AutoRestart` / `StartRetried` | 自动或面板重试超时启动，重建 Pod | 2 秒 |
| `ServiceAddressPending` | 客户端 Service 尚无 ClusterIP | 2 秒 |
| `RconSecretUnavailable` | RCON 密钥缺失或格式错误 | 10 秒 |
| `RconNotReachable` | RCON 连接或认证失败 | 2 秒 |

上述原因集合为 [GO-TESTED]。

### 1a. `PodNotReady`：Pod 无法就绪 {#_1a-podnotready-—-pod-never-goes-ready}

operator 无法仅凭此原因区分**镜像损坏、PVC 未绑定、后端尚在启动**。[GO-TESTED] 覆盖信号发出；底层 Pod 原因属于 [INTEGRATION-ONLY]。进一步检查：

```
kubectl get pod -l app.kubernetes.io/name=<name>
kubectl describe pod <pod>     # look at Events + container State
```

- **`ImagePullBackOff` / `ErrImagePull`**：镜像引用错误、标签不存在或仓库不可达。operator 不校验 `spec.image`，直接写入容器。修正引用，或检查仓库和构建目标。即使已进入 `Failed` 且重试耗尽，修改 spec 仍可恢复：OrderedReady 不会滚动未就绪 Pod，因此 operator 自行删除旧模板的 `<name>-0`，StatefulSet 按新模板重建；阶段回到 `Starting`，原因 `SpecChanged`，重新计时并将重启预算归零，生成 `PodReplaced` 事件。[GO-TESTED: `TestSpecChangeReplacesAPodThatGaveUp`, `TestStalePodReplacement`]
- **PVC `Pending`**：`kubectl get pvc -l app.kubernetes.io/name=<name>`。不存在的 `spec.storage.storageClassName` 或无法满足的容量使 PVC 无法绑定。operator 不直接报 spec 错误，除非容量字符串格式无效（§2）；应修正存储类或容量。[INTEGRATION-ONLY]
- **就绪端口开放前反复崩溃**：检查容器日志，这是后端或入口脚本问题。
- **卡在 `Init:`，或出现 `AccessDeniedException` / `Permission denied`**：无论镜像声明何种 `USER`，游戏 Pod 均以 uid/gid **1000**（`naming.GameUID`）运行并移除全部 capability。`prepare-data` initContainer 使用 root 和仅 `CHOWN`、`DAC_OVERRIDE` 执行 `felis init-volume`，将旧 root 版本或恢复 Job 创建的世界条目交给 1000:1000。`kubectl logs <pod> -c prepare-data` 显示修改数及最多 20 个失败项。若镜像向 `/data`、`/tmp` 之外、预置为 root 所有的目录写状态，须重构镜像，将状态放在 `/data`。[GO-TESTED: `TestBuildStatefulSetRunsGameAsNonRoot`, `TestChownTreeHandsOverMismatchedEntries`；真实卷遍历为 INTEGRATION-ONLY]
- **每次启动最后一个 `Init:` 等约 30 秒**：`egress-gate`（`felis egress-gate`）等待 `felis-server-egress` 生效。kube-router 会在 Pod 启动后稍晚编程策略；无网关时，带服务器标签的 Pod 第一个请求曾能到达 API 内部接口。网关探测所有服务器都无权访问的 Kubernetes API Service，通常一秒内通过。检查 `kubectl logs <pod> -c egress-gate`：

  ```
  felis egress-gate: 10.43.0.1:443 is unreachable after 201ms (...); the egress lock is in effect
  felis egress-gate: 10.43.0.1:443 still answers after 30s; starting anyway. ...
  ```

  第二行表示整个等待期间探测都成功，可能 CNI 不执行 NetworkPolicy、k3s 使用 `--disable-network-policy`，或 `--server-egress-allow-cidr` 覆盖了 API Service 后面的节点，从而同时允许节点 PostgreSQL、Kubernetes API。缩窄 CIDR。游戏网关超时后警告并放行，而构建网关会拒绝。[GO-TESTED: `TestBuildStatefulSetGatesEgress`, `TestEgressGateFailOpenWaitsThenWarns`；k3s 实测：无网关时首请求到达 `felis-api-internal:8081`，有网关的三个 Pod 经约 200 ms 等待后首请求被拒；无策略选择的 Pod 在设定的 5 秒后警告并启动。]
- **StatefulSet/Job 出现 `FailedCreate … violates PodSecurity "baseline"`**：安装清单令 minecraft 命名空间强制 baseline（`pod-security.kubernetes.io/enforce=baseline`）。Felis 渲染的资源满足它；被拒的 Pod 通常由外部修改或创建，包含 hostPath、hostPort、privileged、额外 capability。`kubectl get events -n minecraft --field-selector reason=FailedCreate` 显示字段。[GO-TESTED: `TestObjects_MinecraftNamespaceEnforcesBaseline`]

### 1b. `RconSecretUnavailable`：RCON 密钥缺失或格式错误 {#_1b-rconsecretunavailable-—-rcon-secret-missing-or-malformed}

探测从 `spec.rcon.secretRef` 读取密码，消息直接显示原错误。这些分支为 [CODE-ONLY]：

- `rcon.secretRef.name and .key are required when rcon is enabled`：启用 RCON 但未填写 Secret 名或键。
- `secret "<name>" has no key "<key>"`：Secret 存在但没有对应键。

创建具有引用键的 Secret，或修正 `secretRef`，再验证：

```
kubectl get secret <secretRef.name> -o jsonpath='{.data.<key>}' | base64 -d | wc -c
```

### 1c. `RconNotReachable`：RCON 连接或认证失败 {#_1c-rconnotreachable-—-rcon-dial-or-auth-failed}

探测仅建立 TCP、完成 RCON 认证并立即关闭，**不会执行命令；认证成功就是就绪判定**。

- `rcon: authentication failed`：Secret 与后端 `rcon.password` 不一致，应同步。[GO-TESTED] 覆盖映射。
- `connection refused` / `i/o timeout`：端口尚未开放、`server.properties` 未启用 RCON，或镜像监听的不是 25575。CRD 的 `spec.rcon.port` 只允许该端口，见运维手册 §4。[INTEGRATION-ONLY]

单次探测超时在 `prober.go:45` 固定为 5 秒；协调上下文更早截止时会缩短。它不是 `spec.startup.readinessTimeoutSeconds`，后者是整个启动的期限，见 §12。

---

## 2. 服务器进入 `Failed` {#_2-server-is-in-failed}

先检查条件原因。`InvalidSpec` 表示无法构建 StatefulSet，常见原因是 **`spec.storage.size` 不是有效资源容量**：

```
invalid storage size "<value>": <parse error>
```

此时 `Ready=False`、`Provisioned=False` 均为 `InvalidSpec`。修正为 `10Gi` 等有效值，不能写 `10 GB`，下次协调即可离开此失败状态。[CODE-ONLY：该具体分支存在，协调测试通常使用有效容量。]

启动和 RCON 就绪超时也会产生 `StartupTimeout`、`ReadinessTimeout`，见 §1；不能将所有 `Failed` 都当作 spec 错误。失败时 `markFailed` 不清除 `status.endpoint`，曾运行的服务器可能保留旧 `endpoint.mode=direct`。代理必须同时确认 `phase=Running` 才能直连，见 §4。

---

## 3. 玩家无法进服或被传送到错误位置 {#_3-players-can-t-join-get-sent-to-the-wrong-place}

路由来自 `status.endpoint`：只有 `markRunningReady` 在 `Running` 且 RCON 就绪时写入 `mode=direct`、游戏地址；`markStarting`、`markStopping`、`markStopped` 均写 `mode=fallback`、`address=spec.fallbackServer`。因此只有 `Running` 才能直连。[GO-TESTED] 覆盖 direct/fallback 切换。

1. `spec.fallbackServer` 为空时，启动、停止期间没有回退目的地，须设为已注册的 Velocity 服务器名称。
2. `Failed` 后可能残留 direct，代理不能只看 endpoint，见 §2。

### 3a. 进服唤醒被拒绝、缓慢或受到限流 {#_3a-wake-on-join-is-refused-slow-or-rate-limited}

加入已停止服务器时，代理将玩家放在回退服并调用内部唤醒 API。检查顺序是 **autostartPolicy → 每服冷却 → 全局运行上限**。

| HTTP | 错误码 | 原因 | 处理 |
| --- | --- | --- | --- |
| `403` | `forbidden` | allowlist 未包含 UUID，或 ownerOnly 且非所有者 | 加入 UUID、认领服务器，或设为 public |
| `409` | `maintenance_in_progress` | 恢复、备份、文件修改占用世界卷（§3b） | 等待 Job 完成 |
| `409` | `world_reclaiming` | 空闲回收器正在归档；之后释放服务器并清空世界 | 旧世界保留在归档，不会排队等待加入 |
| `429` | 冷却限制 | 在配置的每服冷却时间内重复唤醒 | 等待冷却 |
| `503` | `at_capacity` | 达到 `MaxRunningServers` | 停止其他服务器或提高上限 |

Owner 可在「平台设置」中修改运行服务器上限和唤醒冷却。保存的值无需重启即对全部 API 副本生效；运行上限同样作用于计划任务的启动。设为 0 即关闭对应控制。运行上限仅在准入时检查，不做原子预留：并发请求可能短暂超出上限，调低上限也不会停止已在运行的服务器。

标记为 Starting 的服务器未必已启动 Java。控制台现在读取 Pod 调度和容器状态：`Unschedulable` / 内存不足表示正在等待资源，镜像拉取失败和容器退出会显示各自的原因。容器能够产生日志后才接入日志。状态请求 12 秒内未完成时，最后一次视图标记为过期，显示最后成功读取的时间，并在轮询互不重叠的前提下重试。不要根据过时的 Starting 标签或已断开的日志流判断游戏是否就绪。

[GO-TESTED: `handlers_internal_wake_test.go`、冷却及运行上限。] 就绪以 operator 的 RCON 探测为准，唤醒调用不代表已就绪；代理约每 2 秒轮询 `GET /api/v1/internal/servers/{name}/status`，`ready=true` 才传送。

Java 插件对 403 提示无权启动；对维护和回收的 409 提示原因且不入队；429 重新排队；其他错误提示稍后再试。此消费端为 **[CODE-ONLY]**，Go 的 `authorizeWakeByUUID` 和冷却错误码经过测试，两部分应分别判断。

### 3b. 唤醒、恢复、备份或文件修改返回 `maintenance_in_progress` {#_3b-wake-restore-backup-or-file-change-refused-with-maintenance-in-progress}

ReadWriteOnce 在单节点仍允许游戏 Pod 和恢复 Job 同时挂载，所以 API 按服务器串行化世界操作。恢复、备份、世界下载、文件修改占用卷，直到 Job 完成；期间唤醒和其他世界操作返回 `409 maintenance_in_progress`。文件读取和列表不占用。即使绕过 API 将 `desiredState` 改为 `Running`，operator 也不扩容 StatefulSet，`Ready` 显示 `MaintenanceInProgress`。

依次检查：

1. 未完成 Job：带 `felis.lolicon.best/server=<name>`，managed-by 为 `felis-restore`、`felis-backup`；或 `felis-files` 且 files-mode 不是 list/read（§18）；或 `felis-export` 且 export-mode 不是 backup（世界下载，占用至下载结束，§10）：

   ```sh
   kubectl -n minecraft get jobs -l felis.lolicon.best/server=<name>
   ```

   真正卡住的 Job 由 `activeDeadlineSeconds` 终止。手动 `kubectl -n minecraft delete job <job>` 立即释放世界，但可能破坏正在写入的数据。

2. MinecraftServer 的准入注解 `felis.lolicon.best/maintenance=<kind>@<RFC3339>`，覆盖准入到创建 Job 的几毫秒间隙。API 此时崩溃，最多保留两分钟；下次唤醒清除过期锁。手动移除：

   ```sh
   kubectl -n minecraft annotate minecraftserver <name> felis.lolicon.best/maintenance-
   ```

3. 空闲回收器（§10）无独立 Job，以 `reap@<RFC3339>` 注解占用世界，每 30 秒刷新。拒绝消息注明 `the idle-world reaper`。进程归档中崩溃后，锁在最后刷新两分钟后过期。手动去锁也会中止回收：删除世界前回收器检查锁，失去锁则保留世界，次日重试。

面板显示 `Stopped` 却返回 `409 not_stopped`，通常游戏 Pod 仍在终止并保存。等待 `kubectl -n minecraft get pods -l felis.lolicon.best/server=<name>` 无结果后重试。

停服后仍 `Running` 约 30 秒是玩家提醒窗口。目标状态改为 Stopped、RCON 未确认无人时，operator 通过 `tellraw @a` 发黄色提示，记录 `status.stopNoticeAt` 和 `StopNotice` 事件；30 秒 `StopNoticeWindow` 后发最后提示并缩容保存。窗口内再次启动会取消停服并通知玩家。空服、RCON 关闭、探测或广播失败时立即停止；无人自动停服不等待。

[GO-TESTED: `internal/maintenance`, `k8scluster_maintenance_test.go`, `handlers_maintenance_test.go`, operator `maintenance_test.go`, `stopnotice_test.go`]

---

## 4. 服务器已启动但路由未启用（online-mode 联动） {#_4-routing-is-disabled-even-though-servers-are-up-online-mode-coupling}

唤醒、认领、白名单信任 **Mojang 验证的 online-mode UUID**。代理 `online-mode=false` 时身份可伪造，Velocity 插件拒绝启用路由：

```
Felis routing DISABLED: the proxy is in offline mode (online-mode=false).
Domain autostart and the allowlist trust Mojang-verified UUIDs; refusing to
route on spoofable identities. /link remains available. Set online-mode=true to
enable routing.
```

[CODE-ONLY: `FelisVelocityPlugin.onProxyInitialize`。] `/link` 仍可绑定，但不会按域名自动启动。摘要显示 `routing: disabled (offline mode)` 或 `(no root-domain set)`。启用代理 online-mode，或按日志配置根域名。

`spec.autostartPolicy`、`spec.onlineMode` 只有在代理执行 `online-mode=true` 时才有相应身份保证；单独设置服务器字段不能使离线代理安全。

---

## 5. Web 面板返回 401 / 403（零信任 / Cloudflare Access） {#_5-web-panel-returns-401-403-zero-trust-cloudflare-access}

外部接口以登录生成的 `felis_session` Cookie 为凭证。Cloudflare Access 仅在边缘执行，API 不读取 `Cf-Access-Jwt-Assertion`；经其他方式到达源站的请求仍需登录，账号及角色始终来自 `users` 表。边缘设置通过 `felis_edge` nftables 将面板 NodePort 限于回环，流量经 cloudflared 到达，Access 位于管理控制台前方；可检查 `nft list table inet felis_edge`。错误结构为 `{"error":{"code","message","request_id"}}`。[GO-TESTED]

- `401 unauthorized`：无有效会话 Cookie。
- `403 forbidden`：已认证但无权限。例如 `IsAdmin()` 同时要求工作人员角色及访问管理控制台域名。

### 5a. 使用本地 IP 访问工作人员路由时返回 403 {#_5a-staff-routes-403-on-a-local-ip-url}

管理控制台按请求 host 识别，默认 `admin_hostname=op.console.<root_domain>`。裸 IP 仅在安装明确指定时算管理控制台：如 `<ip>.nip.io` / `<ip>.sslip.io` 内嵌的地址，或 admin_hostname 直接设置该 IP。其他地址包括回环均按玩家控制台处理，因此 SSH 隧道的 `https://127.0.0.1:30443` 即使登录工作人员也返回 403。应按域名访问，以 `/etc/hosts` 或 `curl --resolve` 指向隧道，或将 `[auth] admin_hostname` 设为实际使用 IP。[GO-TESTED]

### 5c. 本地密码登录失败或被静默拒绝 {#_5c-local-password-login-fails-or-is-silently-rejected}

本地会话使用 HttpOnly、Secure、SameSite=Lax、12 小时 TTL、仅当前主机的 `felis_session`。每请求实时读取 `platform_settings.local_auth_enabled`，缺失或不可解析均视为关闭。

- `local auth disabled`：设置为 false 或缺失；即使已有 Cookie 也直接拒绝。
- `invalid session: …`：会话哈希无效或伪造。

确实需要本地密码认证时，设 `local_auth_enabled=true`。[GO-TESTED：会话及二维码登录逻辑。]

---

## 6. 内部 API 拒绝 Velocity / 代理调用（服务令牌） {#_6-internal-api-rejects-velocity-proxy-callers-service-token}

内部接口 `--internal-addr :8081`、`/api/v1/internal/...` 不使用零信任认证，而以 `Authorization: Bearer <token>` 恒定时间比较。各调用方独立持有令牌；每路由只允许 `docs/openapi.yaml` 的 `x-felis-callers` 列出的调用方。

| 调用方 | Secret（键 `token`） | API 环境变量 | 调用方读取位置 | 路由 |
| --- | --- | --- | --- | --- |
| `velocity` | `felis/felis-service-token` | `FELIS_SERVICE_TOKEN` | 主机 `felis-link.properties` 的 `service-token` | 服务器列表、唤醒/认领/就绪/状态、加入事件、菜单、管理登录、迁移、重新认领、绑定码、黑名单 |
| `limbo` | `felis/felis-limbo-token`，minecraft 有副本 | `FELIS_LIMBO_TOKEN` | 登录 Pod 的 `FELIS_SERVICE_TOKEN` | 绑定码、绑定状态、黑名单 |
| `build` | `felis/felis-build-token`，felis-build 有副本 | `FELIS_BUILD_TOKEN` | 下载 initContainer 环境变量 | 投稿构建上下文 |
| `ops` | `felis/felis-ops-token` | `FELIS_OPS_TOKEN` | 每次从 Secret 读取 | 应急备份 |

安装器生成四项到 `/etc/felis/secrets.env`（`SERVICE_TOKEN`、`LIMBO_TOKEN`、`BUILD_TOKEN`、`OPS_TOKEN`），每次重跑应用。内部审计来源为 `internal:<caller>`。[GO-TESTED]

内部 ClusterIP Service `felis-api-internal:8081` 与外部 NodePort `felis-api:443` 独立，防止内部接口暴露到节点。控制节点的应急控制台解析该 ClusterIP 并连接 8081。

内部接口使用明文 HTTP。单节点时代理、登录 Pod、构建 Job 均在同节点，流量不离开主机；读取流量需要节点 root，root 本身也能读取磁盘令牌。网络策略只向登录 Pod（`felis-login-to-internal-api`）和构建 Job（`felis-build-egress`）开放；`felis-server-egress` 排除其他游戏服（含大厅）对私网及 8081 的访问。远程 Velocity 会将令牌放到网络上，所以代理应位于节点；跨主机内部调用需先建立相应传输保护。

- **无法连接，非 401**：检查 `kubectl -n felis get svc felis-api-internal` 的 ClusterIP、8081、selector。普通 `felis-api` 仅提供 443。
- **某调用方全部 401**：令牌缺失或与 API 不一致。启动日志按未设置项输出：

  ```
  felis api: warning: FELIS_LIMBO_TOKEN unset — the internal face turns the limbo caller away
  ```

  未设置令牌不会匹配任何值，也不会绕过认证。以代理为例检查：

  ```
  kubectl -n felis get secret felis-service-token -o jsonpath='{.data.token}' | base64 -d
  ```

- **`403 wrong_caller`**：令牌有效但属于其他调用方，例如构建令牌访问代理路由。按上表配置自己的令牌。
- **API Pod `CreateContainerConfigError`**：felis 中缺少四个 Secret 之一。重跑安装器，它在部署清单前应用 Secret。
- **两个令牌相同**：API 拒绝启动，提示 `the X and Y tokens are the same value; each caller needs its own`，应轮换其中一个。

### 轮换令牌 {#rotating-a-token}

`sudo felis rotate-token <kind>` 仅打印计划及中断影响；加 `-yes` 才轮换。始终先写 `/etc/felis/secrets.env`，后续失败时重跑安装器可将新值同步到各处。[GO-TESTED]

| 类型 | 替换内容 | 中断影响 |
| --- | --- | --- |
| `velocity` | `felis-service-token`、主机代理文件的 `service-token` | API 重启数秒；代理重新读取文件，保留玩家 |
| `limbo` | `felis-limbo-token` 及 minecraft 副本 | API 后登录 Pod 重启 |
| `build` | `felis-build-token` 及构建命名空间副本 | API 重启；正在获取上下文的构建失败，可重新投稿 |
| `ops` | `felis-ops-token` | API 重启 |
| `registry` | platform/build/prune 写令牌，`felis-registry-auth`、`felis-registry-push` | 仓库后 API 重启；当时推送失败，拉取会重试 |
| `forwarding` | `/opt/felis/velocity/forwarding.secret`、两命名空间的 `felis-forwarding-secret` | 运行中服务器保存并重启，代理重启，全部玩家断开 |
| `db` | PostgreSQL 角色密码、两个主机/Pod 配置 URL、两命名空间的 `felis-config` | API 重启；此时连接的备份/恢复/文件 Job 可能失败，可重试 |

- **velocity**：等待代理日志 `Felis: service-token reloaded from … (fingerprint <12 hex digits>)`。API 重启后 60 秒未出现时（旧插件），重启代理并断开玩家。保留文件修改时间，避免 domain check 误报过期。远程代理须手动将 `felis/felis-service-token` 值写入文件，数秒后读取。
- **forwarding**：被备份、恢复或文件修改占用的服务器不会重启，计划及输出注明；玩家在其重启前不能加入，维护后手动停启。下次安装器还会重启代理一次，因为记录早于轮换；升级本来也因新 jar 重启。远程代理须更新 forwarding secret 并重启。
- **db**：以 SCRAM-SHA-256 校验值传给 PostgreSQL，避免失败 SQL 记录明文。仅新密码连接成功后更新配置副本；失败则停止，重跑安装器按 secrets.env 恢复角色及副本一致。`[database] deployment` 未设置的外部数据库拒绝自动修改，须自行更改数据库及各 URL。`felis.pod.toml` 必须为独立文件，因为 Pod 使用不同地址。
- API 或仓库重启后旧值失效；未更新的调用方会被拒绝。

---

## 7. 账号绑定与认领 API 错误 {#_7-account-link-and-claim-api-errors}

来自 `handlers_account.go`、`handlers_internal.go`。[GO-TESTED]

| HTTP | 错误码 | 条件 |
| --- | --- | --- |
| `400` | `bad_request` | 缺少 mc_uuid、码为空，或 auth_source 不是 mojang/thirdparty |
| `400` | `invalid_code` | 绑定码未知或超过十分钟有效期，码长 8 位 |
| `409` | `already_linked` | MC UUID 已绑定**其他**用户 |
| `412` | `not_linked` | 未验证绑定的调用方执行认领/所有者操作 |
| `403` | `quota_exceeded` | 超过用户服务器配额 |
| `409` | `already_claimed` | `UPDATE … WHERE owner_id IS NULL` 未影响行 |
| `404` | `not_found` | 服务器或资源不存在 |

绑定码在游戏内通过 `POST /api/v1/internal/account/link/code` 生成，证明 UUID；在 Web 外部接口 `POST /api/v1/account/link/verify` 验证，证明用户。`409 already_linked` 回滚事务并**保留绑定码**，其他用户仍可使用。认领在 READ COMMITTED 下用条件 UPDATE 保证竞争安全：影响 1 行为 200，0 行为 409。处理器通过内存替身测试；真实数据库边界的验证范围另见 [集成边界](/reference/deferred-seams)。

---

## 8. 镜像构建失败（Kaniko，规范 §14/§16） {#_8-image-build-fails-kaniko-spec-§14-§16}

### 8a. 提交构建推送时返回 `400` {#_8a-build-push-rejected-at-submission-with-400}

构建前校验拒绝非内部仓库的推送目标：

```
must target the internal registry "<registry.<ns>.svc:<port>>", not "<your-target>"
```

修正镜像引用，指向 `cfg.Registry.URL`，见 §9。[GO-TESTED：validate 准入检查。]

### 8b. 构建 Job 的 ServiceAccount 无操作权限（按设计拒绝 RBAC 访问） {#_8b-build-job-s-serviceaccount-can-do-nothing-rbac-denial-by-design}

构建/恢复 Job 的 SA（felis-build 命名空间的 `felis-build`、`felis-restore`）在任何位置都**没有 Role 或 RoleBinding**。隔离依靠没有权限（规范 §16/§21）。命名空间 API 操作被拒是预期行为，不要为其授权。[GO-TESTED：渲染清单没有 Role。]

### 8c. 构建卡住，随后拉取基础镜像或软件包失败 {#_8c-build-hangs-then-fails-fetching-base-image-packages}

`felis-build-egress` 默认拒绝出站访问；包镜像 CIDR 通过 `--package-cidr` 显式放行，默认不配置互联网出口。[GO-TESTED] 覆盖策略结构。Kaniko 拉取未允许主机时卡住或失败是策略生效，具体日志来自 Kaniko/containerd，属于 [INTEGRATION-ONLY]。添加所需镜像 CIDR，或将基础镜像预存内部仓库。

### 8d. 构建进入 `Failed` 阶段 {#_8d-build-reaches-failed-phase}

`reconcileBuilds` 轮询 Job，并经 `writeBuildError` 将失败映射为构建 Failed。[GO-TESTED] 错误会指出失败步骤的末尾输出、期限或扫描结论。initContainer 顺序为 `egress-gate`、`context-fetch`、`kaniko`（仅构建 tar，不推送）、`trivy`（完整 JSON 报告）、`sbom`（转为 CycloneDX）、`scan-gate`（判断策略），最后运行 `push`。被扫描拦截的镜像不会进入仓库。检查各步骤：

```
kubectl logs -n felis-build job/<build-job> --all-containers --prefix
```

`push` 的 403 表示推送至平台保留的 `felis/`、`mirror/`（§9）；401 表示 felis-build 的 `felis-registry-push` 缺失或过期，应重跑安装器。

**扫描准入**：漏洞或泄露机密的严重度包含于 `[registry] scan_fail_on` 时拦截，默认 `CRITICAL`。无修复版本的漏洞默认只列出；`scan_fail_unfixed=true` 才拦截，避免因无法升级清除的漏洞阻断。错误示例：

```
the scan blocked the image: 1 CRITICAL, 1 HIGH (CVE-2026-12345, CVE-2025-24813)
```

`HIGH` 需主动开启：平台 `felis/paper` 镜像的上游 paper.jar 含五项可修复 HIGH（内嵌 commons-compress 1.5、plexus-utils 3.5.1）。开启后，所有以它为基础的构建都会被阻止，除非在 `scan_accept` 中接受相关已知风险：

```toml
scan_fail_on = ["CRITICAL", "HIGH"]
scan_accept = ["CVE-2021-35515", "CVE-2021-35516", "CVE-2021-35517", "CVE-2021-36090", "CVE-2025-67030"]
```

接受的 CVE、GHSA、其他公告 ID，或 `aws-access-key-id` 等机密规则 ID 不再阻断，但仍统计、列出，面板标为「已接受」，日志注明 ID。升级基础镜像时应重新审查此列表。

API 保存已完成构建的结论、最多 100 个发现（拦截项优先）、完整 Trivy 报告和 SBOM。面板「构建流水线 → 扫描与日志」提供查看及下载；管理员 API：

| 端点 | 返回 |
| --- | --- |
| `GET /api/v1/images/build/{id}/scan` | 结论和发现；扫描前停止或旧版未保存扫描时为 `404 scan_not_found` |
| `GET /api/v1/images/build/{id}/scan/report` | `<id>-trivy.json` |
| `GET /api/v1/images/build/{id}/sbom` | `<id>.cdx.json` |

报告/SBOM 经 scan-gate 容器日志送达 API，每镜像压缩后合计最多 6 MiB。超过时先丢 SBOM，再丢报告，日志说明；下载返回 `404 scan_document_not_kept`，结论及发现始终保留。scan-gate 退出 2 表示报告缺失或不可读，构建按失败关闭并说明原因。

扫描只反映构建当日漏洞库。已准入镜像不会因新 CVE 自动重扫；需用相同上下文发起新构建 `POST /api/v1/images/build`。数据库过旧时先 `felis mirror-build-tools -only trivy-db`，见 §8e。

### 8e. 构建 Pod 无法启动：执行器镜像与扫描数据库 {#_8e-build-pods-never-start-executor-images-and-the-scan-dbs}

构建运行 Kaniko、Trivy。Trivy 需要漏洞库，扫描 Java 产物（实际模组包均包含）还需 Java 库。构建命名空间无公网出口，因此四项都来自内部仓库 `mirror/`：

| 工具 | 上游 | 副本 |
| --- | --- | --- |
| kaniko | `gcr.io/kaniko-project/executor:v1.24.0@sha256:4e7a52dd…` | `mirror/kaniko-executor:v1.24.0` |
| trivy | `ghcr.io/aquasecurity/trivy:0.74.0@sha256:62b1e65e…` | `mirror/trivy:0.74.0` |
| 漏洞库 | `mirror.gcr.io/aquasec/trivy-db:2` | `mirror/trivy-db:2` |
| Java 库 | `mirror.gcr.io/aquasec/trivy-java-db:1` | `mirror/trivy-java-db:1` |

执行器按摘要固定（`internal/build/tools.go`），上游移动标签不会改变构建；数据库跟随标签。安装器执行 `felis mirror-build-tools` 复制四项，`felis-build-tools.timer` 每天 04:00、16:00 更新。三天无成功执行时看门狗警告；扫描仍然准入，但依据旧公告。

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `mirror/kaniko-executor`、`mirror/trivy` 的 `ImagePullBackOff` | 首次复制未完成或安装时无外网 | 查看 `journalctl -u felis-build-tools -n 50`；可访问 gcr.io、ghcr.io、mirror.gcr.io 后执行 `sudo felis mirror-build-tools` |
| `failed to download vulnerability DB` | 缺少 `mirror/trivy-db:2` | 同上 |
| `the vulnerability DB was last refreshed … ago` | 定时任务因网络、仓库或磁盘失败 | 查邮件及 `/var/lib/felis/build-tools/status.json`，手动重试 |

`-only trivy-db` 可只更新一项。复制仅包含节点架构，通过回环 hostPort，以 secrets.env 的 `platform` 令牌写入。

**隔离网络节点**无法下载：在有网机器获取上述四项，通过 `kubectl -n felis port-forward svc/registry 5000:5000` 以 platform 推至 `localhost:5000/mirror/...`；密码来自 `kubectl -n felis get secret felis-registry-auth -o jsonpath='{.data.platform}' | base64 -d`。数据库须定期重复同步。定时器仍不可达上游时警告会保留，这是准确状态。

**隔离网络中的平台镜像**：registry 和 PostgreSQL 按 `bootstrap.sh` 的 `REGISTRY_IMAGE`、`POSTGRES_IMAGE` 摘要运行。安装器从发布版 `felis-image-base-linux-<arch>.tar` 导入，缺少时拉取，再固定于 containerd，防止镜像 GC。最简方式是预拷发布版附件并用 `FELIS_ARTIFACT_DIR`（运维 §1）。无附件且提示 `could not pull …` 时，在有网机器按节点架构获取同一摘要，保留清单后导入：

```sh
# elsewhere: the reference as bootstrap.sh names it, e.g. docker.io/library/postgres:18.6-trixie@sha256:…
sudo ctr images pull --platform linux/arm64 "$ref"
sudo ctr images export --platform linux/arm64 image.tar "$ref"
# on the node:
sudo k3s ctr images import image.tar
```

`docker save` 会重写清单，不能匹配 Deployment 的摘要。导入后重跑安装器，它会识别并固定镜像。[CODE-ONLY]

**Kaniko 上游已于 2025 年 6 月归档**，最后版本 v1.24.0 不再获得安全修复。使用维护中的 fork 时，先复制到 mirror，再设置覆盖。其他 `[registry]` 键：

```toml
[registry]
url = "registry.felis.svc:5000"
build_namespace = "felis-build"
kaniko_image = ""                  # empty: the mirror/ copy above
trivy_image = ""
trivy_db_repository = ""
trivy_java_db_repository = ""
scan_fail_on = ["CRITICAL"]        # §8d: severities that block; any case; empty = CRITICAL
scan_fail_unfixed = false          # §8d: true blocks on vulnerabilities with no fixed release too
scan_accept = []                   # §8d: vulnerability or secret rule ids accepted as known risks; never block
build_cpu_limit = "2"
build_mem_limit = "4Gi"
build_disk_limit = "12Gi"          # §8f
build_user_namespaces = "auto"     # §8f: auto | on | off
build_runtime_class = ""           # §8f: e.g. "gvisor"
max_concurrent_builds = 2          # §8f: 1-6; later builds queue
user_uploads_max_bytes = "4Gi"     # every user's uploaded contexts together; 507 uploads_full past it
context_max_bytes = "1Gi"          # one uploaded context; empty = 1Gi (sent in 32 MiB parts, so the Cloudflare edge's 100 MB body cap does not bind)
```

修改必须同时写 `/etc/felis/felis.host.toml`（主机 CLI）和 `/etc/felis/felis.pod.toml`（API Secret 的来源），两者仅数据库 URL 不同。向导从 Pod 文件重新渲染 Secret，仅用 kubectl 修改现有 Secret 会在重新配置时丢失。单独重启 Deployment 不够，Pod 挂载 Secret 而非主机文件。先重新渲染，再滚动 API：

```sh
kubectl -n felis create secret generic felis-config \
  --from-file=felis.toml=/etc/felis/felis.pod.toml --dry-run=client -o yaml | kubectl apply -f -
kubectl -n felis rollout restart deployment/felis-api
```

未设置字段使用默认。Trivy 用 `--insecure` 访问内部 HTTP 仓库，读取不需凭证。仓库清理保留 API 解析的全部工具引用（§9）。

### 8f. 构建隔离模型与残余风险 {#_8f-build-isolation-model-and-residual-risk}

Dockerfile 的 RUN 在 Kaniko 容器中以 root 执行。Kaniko 是无守护进程构建器，**不是沙箱**；隔离来自外围 Pod：

| 层级 | 作用 | 位置 |
| --- | --- | --- |
| 管理员审批 | 审批前不构建 | 投稿流程 |
| 审阅字节绑定 | 绑定上下文 sha256；重传后审批失败，构建拒绝其他字节 | 投稿流程、fetch-context |
| 弱权限身份 | felis-build SA，无 Role、不挂载令牌 | §8b |
| 出站限制 | 仅集群 DNS、仓库、API 内部接口 | §8c |
| 出站网关 | 首个 initContainer 等待策略生效 | egress-gate |
| capability | 全部移除；Kaniko 仅取回 CHOWN、DAC_OVERRIDE、FOWNER 解包镜像 | jobspec |
| seccomp | Pod 使用运行时默认策略，不允许 unshare、mount、keyctl、bpf 等 | jobspec |
| 用户命名空间 | 开启后 Pod root 映射为节点无特权 UID | 下文 |
| 沙箱运行时 | 可选 gVisor、Kata RuntimeClass | 下文 |
| 凭证 | 仓库凭证仅在 push，服务令牌仅在 context-fetch | jobspec |
| 扫描准入 | push 前按 scan_fail_on 判断；拦截或不可读报告不入库 | §8d |
| 资源 | 各容器 CPU、内存、临时存储上限及执行期限；上下文最多 4 GiB 或 200000 条目 | jobspec、fetch-context |
| 命名空间兜底 | felis-build-limits 为无上限容器设 1 CPU / 1 GiB 内存 / 1 GiB 磁盘；quota 允许 8 个运行 Pod、禁止 PVC | 部署清单 |
| 并发 | max_concurrent_builds 默认 2、最高 6；其余 pending，按最早提交启动 | build.Builder |

**审阅字节**：每次上传记录归档 sha256，审阅页显示。下载携带 `X-Felis-Context-Sha256`，存储字节不匹配则 API 中断。审批提交 `expected_digest`；审阅后重传返回 `409 context_changed`，须下载并重新审阅。构建固定已审批摘要，`felis fetch-context --sha256` 校验接收字节，不一致则在 Kaniko 前失败：

```
felis fetch-context: the context's sha256 is 3f…, the approved digest is 9a…: it changed after approval; refusing to build
```

面板使用同会话下载文件的摘要审批。若在 CLI 或其他浏览器审阅，则使用列表摘要，须与实际审阅文件的 `sha256sum` 比较。摘要记录机制前上传的投稿须重新上传才能审批。

**出站网关**：CNI 在新 Pod 启动后稍晚编程策略。k3s/kube-router 的构建 Pod 最初约 0.7 秒曾可访问公网和 Kubernetes API。网关探测构建策略不允许的 Kubernetes API，拒绝连接后才结束，日志显示等待：

```
felis egress-gate: 10.43.0.1:443 is unreachable after 612ms (...); the egress lock is in effect
```

两分钟后仍成功则退出 1，构建失败，提示 `the build namespace's NetworkPolicy is not enforced`。应修复不支持策略的 CNI 或 `--disable-network-policy` 设置，不能关闭网关。

**用户命名空间**：`hostUsers:false` 将 Pod UID 0 映射为节点非特权 UID 范围。需要 Kubernetes ≥1.33、containerd 2.x、支持节点文件系统 idmapped mount 的内核（上游 5.19+；RHEL/CentOS Stream 9 有回移）。默认 `auto` 让 API 启动时运行 `userns-probe-*` Job，仅成功运行后开启，日志：

```
felis api: build pods run in a user namespace (hostUsers: false)
felis api: build pods run without a user namespace: this node cannot start a pod with hostUsers: false
```

`on` 强制开启，不支持的节点构建无法启动；`off` 始终关闭。

**沙箱运行时**：`build_runtime_class` 可指定 gVisor（runsc）、Kata。RuntimeClass 必须已安装（`kubectl get runtimeclass`）且实测 Kaniko 可运行。gVisor 需要默认 overlay2 rootfs，虚拟机上 Kata 需要嵌套虚拟化；未安装验证时留空。

**磁盘**：`build_disk_limit` 默认 `12Gi`，限制 Kaniko 可写层，并作为最大容器限制约束 Pod 总磁盘：上下文、解包基础镜像、镜像 tar。kubelet 在巡检中通过驱逐执行，越限后数秒内终止，describe 显示 Evicted。大模组包可提高，但节点空闲空间须超过上限。

**残余风险**：没有用户命名空间或沙箱时，构建以容器 root 共用游戏服/控制平面的内核。seccomp 与 capability 限制移除常见逃逸方式，但剩余系统调用可达的内核漏洞仍可能影响整台单节点平台。管理员须审批前阅读 Dockerfile 并下载上下文。探测不支持用户命名空间的节点，可优先升级至支持 idmapped mount 的内核。

---

## 9. 镜像仓库推送或拉取失败（规范 §15） {#_9-registry-push-pull-failures-spec-§15}

仓库在控制命名空间或 `--registry-namespace` 下，Deployment、Service、PVC 均名为 `registry`。

- **精确目标**：`registry.<ns>.svc:<port>`，端口来自 `--registry-port`，默认 5000，例如 `--felis-image registry.felis.svc:5000/felis:v1`。错误推送 URL 在构建准入返回 400（§8a）；运行时不可达（DNS/端口错误、PVC 未绑定、无默认 StorageClass）则产生推送或 kubelet 拉取错误，属于 [INTEGRATION-ONLY]。
- **存储**：RWO PVC 默认 10Gi，首次安装用 `FELIS_REGISTRY_STORAGE`，清单生成用 `--registry-storage`，挂载 `/var/lib/registry`，不指定 storageClassName，使用集群默认类。无默认类则 Pending。k3s local-path 只是节点目录，不强制容量，实际通过下文清理限制。上传卷默认 `FELIS_UPLOADS_STORAGE=5Gi`，归档卷默认 `FELIS_BACKUP_STORAGE=10Gi`，行为相同；重跑保留现有 PVC 大小，变量不同则警告。
- **上传上限**：单上下文 `context_max_bytes` 默认 1Gi，面板上传前检查。面板分片最多 32 MiB，暂存上传卷 `.parts/`，避开 Cloudflare 对超过 100 MB 请求体的 413；断线可从暂存长度恢复，24 小时未触碰则删除。暂存字节也计入预算。脚本整包 POST 仍受边缘 100 MB 限制。`s3:// user_uploads_context` 用 8 MiB 分片转发，任意大小上传只占 8 MiB 内存；S3 最多 10000 分片，约 78 GiB。
- **总预算**：`user_uploads_max_bytes` 默认全用户合计 4Gi、每用户 2 GiB，卷须保留 10% 空闲；越限返回 `507 uploads_full` 或 `403 submission_quota_exceeded`。拒绝投稿的文件在判决后七天删除，已批准的保留供重建。
- **未用镜像清理分两步**：API 每六小时删除无引用清单，日志 `registry prune finished … deleted=N`。保留白名单的标签/`:*`/摘要、服务器固定镜像、运行构建、控制平面、Kaniko/Trivy/数据库、最近 24 小时推送，以及各 felis/、mirror/ 仓库最新五个带标签构建。旧游戏构建须将版本标签加入白名单（§15b）。registry-gc sidecar 每日申请只读窗口，等待两分钟无写入，再运行 `registry garbage-collect` 清理无引用层。日志见 `kubectl -n felis logs deploy/registry -c registry-gc`。窗口内拉取正常，写入返回 503 和 Retry-After，安装器/构建推送等待；中途 gate 重启也保持只读至租约结束。立即清理可执行 `kubectl -n felis exec deploy/registry -c registry-gc -- rm -f /var/lib/registry/.felis-last-gc` 并重启 Pod。
- **仓库卷丢失**：重跑安装器恢复平台镜像。异地复制开启时，`sudo felis offsite fetch-images` 按原摘要恢复缺失用户镜像，可中断重跑。没有镜像副本时，可从批准投稿的上下文重建；GET submissions/{id}/context 提供内容，列表保留 context_ref/image_ref，管理员调用 `POST /api/v1/images/build`。固定旧摘要的服务器在仓库缺少它时仍拉取失败，需选择新镜像（§15b）。
- **节点拉取**：实测 containerd 直接访问 Service VIP 返回 Empty reply。Deployment 绑定 `127.0.0.1:<port>` hostPort，`/etc/rancher/k3s/registries.yaml` 将服务域名镜像到它。两部分必须同时保留，否则镜像 GC 后不能重新拉取。
- **内存**：仓库上限 2Gi，高于其他控制 Pod 的 256Mi；实测 475MB 层推送曾使 256Mi 模板 OOM（审计 #46）。巨大层需要内存余量。
- **写授权**：registry:2 只监听 Pod 回环；`registry-gate`（felis 镜像）持有端口和 hostPort。读取匿名，匿名 GET /v2/ 返回 401 Basic，以提示 Docker 推送时携带凭证。写入须 Basic 认证到 `felis-registry-auth`：platform 可写全部；build 通过 felis-build 中的 `felis-registry-push` 仅可写 felis/、mirror/ 之外，不能删除。Secret 缺失时仓库只读。令牌保存于 secrets.env；`sudo felis rotate-token -yes registry` 替换三个令牌并重启仓库及使用 prune 令牌的 API（§6）。
- **连接范围**：`felis-registry-ingress` 仅允许 felis-build 命名空间；Kubernetes 始终允许节点本机的 containerd 拉取、hostPort 推送。游戏服无法访问（felis-server-egress）。
- **GC 固定**：仓库自身的 registry:2 与 gate 的 felis 镜像不能依靠自己提供拉取。安装器在 containerd 标记 `io.cri-containerd.pinned=pinned`，防止 kubelet GC，检查 `k3s ctr images ls | grep pinned`。
- **摘要固定**：仓库使用 `docker.io/library/registry:2.8.3@sha256:a3d8aaa6…`，安装器通过 `k3s crictl pull` 缓存。隔离节点须用 containerd export 保留摘要：有网机器以 identities.go 的完整摘要 R 执行 `ctr images pull --all-platforms $R && ctr images export --all-platforms registry.tar $R`；节点 `k3s ctr images import --all-platforms registry.tar` 后重跑固定。docker save 重写清单，不能匹配摘要。
- **selector**：Service 仅选择 name + component=registry，有意不加 part-of=felis-control-plane，使 RCON peer 策略看不到仓库。不要增加该标签。

仓库清单渲染为 [GO-TESTED]，真实服务为 [CODE-ONLY/INTEGRATION-ONLY]。

---

## 10. 世界回收：误删与跳过备份（规范 §18） {#_10-world-reaper-false-deletes-and-skipped-backups-spec-§18}

回收器是**每日执行一次的 CronJob 批处理**，不是 operator 控制器。有归档存储的安装都会创建它。未设置 `FELIS_WORLDS_HOST_PATH` 时，执行 `felis reaper --retention-only`，只删除过期备份、回读校验和清理归档，不检查服务器，摘要 `evaluated=0`；安装器提示 `idle-world retention is off`。重跑时设置世界根目录才启用世界回收。[GO-TESTED: `TestRunRetentionTouchesNoWorld`, `TestReaperCronJob_Gating`, `TestReaperCronJob_RetentionOnlyShape`]

启用后，仅当 `now-last_active_at >15d` 才以 `inactive_15d` 回收。15 天在代码中固定，不能配置。`felis.toml [archive]` 可配置 `warn_before`、`retention`、`max_local_bytes`，手动备份的 manual_retention/keep/cooldown，以及定时备份的 scheduled_every/keep/retention。Owner 可在面板中覆盖其中除 `warn_before` 外的全部键（见下文「面板中设置的保留策略」）。

### 备份包含哪些数据 {#what-a-backup-contains}

备份打包服务器**整个 `/data` 卷**，包括世界、server.properties、插件/模组、配置、jar、库、日志、缓存，不只是 world 目录。恢复替换卷内容并移除备份后新增文件，因此也回滚配置和插件。默认 Paper 的库和缓存占主要大小，全新实例在世界增长前就约 170MB；不能只按世界文件规划归档 PVC。

### 删除之前必须先备份 {#the-backup-before-delete-invariant}

只有存在**已确认并写入数据库的备份**才删除世界，完整顺序有隔离 [GO-TESTED]：

0. 归档前世界必须静止。目标仍为 Running 的服务器先改 Stopped，留待下次执行；仍在停止、游戏 Pod 仍存在、或被其他维护操作占用时也延后，计入 awaiting_stop，不算失败。停服后持有 §3b 的维护锁，贯穿归档和删卷。失去锁或无法刷新时在 DeletePVC 前中止。[GO-TESTED: `TestHoldWorldStopsARunningServer`, `TestHoldWorldWaitsUntilQuiet`, `TestReapLostHoldKeepsWorld`；实测首次执行停服，第二次在 reap 锁下归档删除。]
1. `max_local_bytes>0` 时 ensureCapacity 优先按最旧顺序淘汰所有者手动备份，再淘汰已有确认异地副本的回收归档。已回收世界的唯一副本不会淘汰，直至 retention 到期。仍满则**保留世界**，计入 store_full。[GO-TESTED: `TestCapacityEvictionOrderSparesSoleCopies`；PG-TESTED: `TestManualBackupRationing`]
2. `Archiver.Archive` 失败：保留世界及 PVC。
3. 数据库 `InsertBackup` 失败：删除孤立归档，保留 PVC。
4. 配置 offsite 桶时，还须 `felis offsite sync` 上传并设置 world_backups.offsite_at。否则记录 `world archived, kept until the archive's off-site copy is confirmed`，计入 awaiting_offsite，保留 PVC；复制后的每日执行复用归档再删除。[GO-TESTED: `TestReapWaitsForOffsiteCopy`]
5. 锁仍持有时才执行 DeletePVC → ReleaseWorld → 审计 → 增加删除指标，再释放锁。

复用归档（异地复制后的下一次，或归档后中断重试）前必须完整回读并核对写入时 sha256。摘要不匹配则标记损坏、禁止恢复、创建新归档；无法读取则保留世界待下次。[GO-TESTED: `TestReapReadsBackReusedArchive`, `TestReapReplacesCorruptArchive`, `TestReapKeepsWorldWhenReadBackFails`]

缺少备份绝不会删除世界；配置桶后，仅有本地备份也不能删除。[GO-TESTED: `TestReapArchiveFailurePreservesWorld`, `TestReapInsertBackupFailurePreservesWorld`, `TestReapIdleWorldFullSequence`] awaiting_offsite 超过一天仍非零，检查 `sudo felis offsite status`（§16）。

### 回收 Job 失败 {#a-failed-reaper-job}

每次最后输出摘要：

```
felis reaper: evaluated=12 reaped=1 released=0 deleted=0 awaiting_offsite=0 awaiting_stop=0 warned=2 skipped=0 store_full=0 evicted=0 expired=3 expire_failed=0 verified=6 corrupt=0 verify_failed=0 swept=0 orphan_archives=0
```

released/deleted 分别计所有者或管理员释放、管理员删除的服务器，均先以 released 原因归档。skipped 计容量、归档、数据库或集群错误；豁免服、CRD 不存在的记录通常不计，待删除 CR 已消失但卷仍在则例外。store_full 是因存储满而保留的子集，expire_failed 是未能删除的过期备份。awaiting_stop 是尚未停妥留待下次的服务器，不使任务失败；持续数天可能有其他程序反复启动，或 Job 占用卷。

每次还维护归档存储：

- verified：回读匹配 sha256。每次最多校验十个过去一周未检查的归档，最早检查者优先。摘要不同或文件丢失计 corrupt，标记损坏并禁止恢复；无法读取计 verify_failed，下次重试。
- swept：清除超过六小时的 `*.partial`。orphan_archives：无数据库记录指向的已完成归档，保留至 retention 到期；输出列出前几个路径。

skipped、expire_failed、corrupt、verify_failed 非零，或清扫未完成，退出 1，Job 失败，世界仍安全。看门狗邮件提示 `world reaper Job … failed`，FelisWorldJobFailed 告警触发。Job backoffLimit 重试两次，重跑整个幂等批次。查看摘要前的错误：

```sh
kubectl -n minecraft logs job/<the failed felis-reaper-… Job>
```

反复失败的服每天保留并重试，因此 Job 每天失败直到修复；26 小时后还有 `the world reaper has not succeeded for …`。[GO-TESTED: `TestReportReaperRunFailsTheJob`, `TestExpiryFailureFailsTheRun`, `TestCapacityStillFullSkipsReap`]

### 按需备份（立即备份） {#on-demand-backups-back-up-now}

所有者的立即备份生成 manual，与世界和数据库位于同一存储和同一磁盘。已停止的服务器由 Job 直接归档世界卷；运行中的服务器执行不停服备份（下一节）。两种方式均受以下 `[archive]` 键或 Owner 在面板保存的值限制（见下文「面板中设置的保留策略」）：

| 键 | 默认值 | 作用 |
| --- | --- | --- |
| `manual_retention` | `30d` | 手动备份到期时间；回收归档使用 retention |
| `manual_keep` | `5` | 每服保留数量，每次完成删除旧备份，日志 removed older backup |
| `manual_cooldown` | `10m` | 所有者每服每窗口一次；再次调用返回 `429 backup_cooldown` 和 Retry-After，0s 关闭 |

已有备份达到 max_local_bytes 时，所有者收到 `507 backup_store_full`。管理员和应急控制台不受冷却及该总量上限，但任何调用方的 Job 都不能使归档文件系统空闲低于 10%，否则 `not enough free disk for the archive`。备份/恢复失败原因显示在备份页「最近操作」。[GO-TESTED: `TestBackupNow`, `TestCheckRoom`, `TestReaperConfigManualKeys`, `TestLatestJobsExplainsFailures`]

### 不停服备份：备份运行中的服务器 {#live-backups-backing-up-a-running-server}

备份运行中的服务器时，服务器保持运行。对运行中服务器的立即备份、运行中世界的定时恢复点（下文）、计划任务的备份（§19）以及 `felis backup-now` 均执行不停服备份。该方式参照 Proxmox VE 的 snapshot 模式，以游戏自身的存档机制代替文件系统快照：

1. felis-api 仅对运行且就绪、世界未被其他操作占用（§3b）的服务器受理备份。它将冻结状态与世界锁一并记录在 MinecraftServer 上（注解 `felis.lolicon.best/live-backup`，记录备份 Job 及被冻结的游戏 Pod），因此备份中途重启的 felis-api 仍会完成该备份。
2. 通过 RCON 关闭存档（`save-off`），并将内存中的全部数据写入磁盘（`save-all flush`，大型世界最多允许 2 分钟）。此后磁盘上的世界完整且保持不变。
3. 备份 Job 的 initContainer（`felis stage-world`）将只读挂载的世界复制到同一节点上的暂存卷。文件系统支持时（XFS、Btrfs），每个文件以 reflink 克隆，无论世界大小，复制几乎瞬间完成。暂存卷的空闲空间小于世界占用空间时，复制拒绝开始。
4. felis-api 每 2 秒检查一次，复制步骤退出后立即重新开启存档（`save-on`）。归档、sha256 计算和回读随后基于副本执行，游戏继续运行。

玩家只在复制期间看到存档暂停，数 GB 的世界只需数秒。存档最多关闭 5 分钟：届时仍未完成的复制会被丢弃，存档重新开启。备份前已关闭存档的服务器，备份后仍保持关闭。冻结有以下代价：

- 冻结期间崩溃会丢失刷写之后的变化，与两次自动存档之间发生崩溃的情况相同；冻结期间区块保持加载。operator 不会对被冻结的服务器执行无人自动停服；缩容前会在有限时间内等待冻结结束，避免停服时的存档落在复制过程中。
- 复制途中重启的游戏会在停止时存档，其副本可能不完整，因此被丢弃。
- 在存档机制之外写入的插件数据库（SQLite、H2）按复制时刻的状态复制，该时刻可能晚于刷写。

除此之外，不停服备份与普通备份相同：相同的 Job，与上文相同的冷却、总量上限和保留数量，相同的 10% 空闲磁盘检查，审计操作为 `backup.create`（或 `backup.scheduled`），payload 含 `{"live":true}`。拒绝时说明原因：

| 返回 | 原因 | 处理 |
| --- | --- | --- |
| `409 not_stopped`, `the server is starting or stopping; back it up once it is running or stopped` | 服务器处于状态切换中，既非运行且就绪，也非已停止 | 状态稳定后重试 |
| `503 live_backup_console` | 游戏未通过控制台响应 `save-off` 或 `save-all flush`：RCON 关闭（RCON 成为默认值之前创建的用户服，§12b）或不可达（§1c） | 重试；或停服后再备份；或用 `sudo felis converge -user-rcon` 开启其 RCON（§12b） |
| `409 maintenance_in_progress` | 其他操作占用世界、正在重启，或另一项不停服备份仍在复制 | 结束后重试（§3b） |
| `409 not_stopped`, `stop the server before backing up its world` | 当前 felis-api 无法备份运行中的服务器（无控制台，或备份执行器不支持不停服备份） | 先停服 |

[GO-TESTED: `TestLiveBackupFreezesCopiesAndThaws`, `TestLiveBackupLeavesSavingOffWhenItWasOff`, `TestLiveBackupUndoesAFailedStart`, `TestSettleLiveBackupDropsATornCopy`, `TestSettleLiveBackupKeepsTryingSaveOn`, `TestSettleLiveBackupRecoversAnUnrecordedJob`, `TestLiveBackupRefusesAServerInTransit`, `TestAcquireLiveBackupAdmitsOnlyARunningFreeServer`, `TestLiveBackupRecordLifecycle`, `TestLiveBackupProgressReadsTheCopyStep`, `TestBackupJobLiveCopiesBeforeArchiving`, `TestBackupLiveReturnsTheJobItCreated`, `TestStageWorldCopiesTheFrozenWorld`, `TestStageWorldRefusesWhatItCannotHold`]

### 删除单个备份 {#deleting-one-backup}

`DELETE /api/v1/backups/{id}` 立即使记录 expired、expires_at 设为当前时间，退出列表、恢复候选及 max_local_bytes 统计。管理员可删除任何备份；普通用户只能删除曾拥有世界的备份，否则 `404 no_backup`。仍有恢复 Job 读取或安全快照后尚待开始的恢复时，返回 `409 restore_in_progress`。审计 backup.delete 记录 ID、原所有者、大小。

物理归档在下次每日 retention 执行删除，expired 无论 expires_at 均删除；异地副本在删除后的同步移除。此前管理员可从审计取 ID 撤销；清 offsite_at 可使已删异地副本重新上传：

```sh
sudo k3s kubectl -n felis exec deploy/felis-postgres -c postgres -- psql -U postgres felis -c \
  "UPDATE world_backups SET status = 'present', expires_at = now() + interval '30 days', offsite_at = NULL
   WHERE id = '<backup id>' AND status = 'expired'"
```

[GO-TESTED: `TestDeleteBackup`, `TestExpiredBackupsDeleted`, `TestSyncExpiresOnlyPastRetention`；PG-TESTED: `TestOwnerDeletedBackup`]

### 下载备份或导出世界 {#downloading-a-backup-or-the-world-export}

备份行的 `POST /api/v1/servers/{name}/backups/{id}/export`、页首 `POST /api/v1/servers/{name}/world/export` 提供 tar.gz。备份权限与删除/恢复一致：管理员任意、用户只可下载曾拥有世界的备份，否则 404 no_backup；其他服务器备份为 403，损坏备份为 409 backup_corrupt。世界导出要求停服（409 not_stopped）、有卷（409 no_world_volume），下载结束前持维护锁。审计为 backup.export/world.export。

没有额外暂存。服务器命名空间的 felis-export Job，以 export-mode world/backup 标签只读挂载世界或备份卷，用一次性令牌 PUT 至 API 内部接口，API 直接流式送浏览器。面板轮询 `GET /api/v1/exports/{ticket}`，ready 后打开 download URL。票据仅属于申请用户、只可下载一次：

| 限制 | 时长 | 超时结果 |
| --- | --- | --- |
| Job 到达 API | 10 分钟 | `410 export_expired` |
| ready 后浏览器开启下载 | 90 秒 | Job 上传收到 410，票据消耗 |
| 传输中任一端无数据 | 2 分钟 | 切断下载 |
| Job 总期限 | 2 小时 | Kubernetes 终止 |

每用户最多一个、全平台两个并行导出，每用户每小时六次；越限为 `429 export_busy` 和 Retry-After。缺少 FELIS_IMAGE、FELIS_BACKUP_PVC 时为 503 export_unavailable，启动日志 world export disabled。

备份下载携带长度并验证原 sha256。最后一块在校验前保留，不匹配则截断，浏览器显示失败，Job 返回 409 backup_corrupt；不会即时标记备份损坏，由回收器下次回读标记。世界导出无长度和摘要，读取失败同样截断。

最近操作显示 Job 最后一行。到 API 前失败（如归档缺失）会结束面板等待；浏览器接管后可能出现：

- `410 Gone: this export has expired …`：90 秒内未开启下载，可能关页或浏览器拦截。
- `410 Gone: the download ended before the archive did …`：浏览器取消或中途断线。
- `404 Not Found: no such export`：API 重启或票据到期。票据只在内存，重新发起。

世界导出 Job 未到 API 时占用世界直至期限；`kubectl -n minecraft delete job -l app.kubernetes.io/managed-by=felis-export,felis.lolicon.best/server=<name>` 可立即释放。[GO-TESTED: `TestExportBackupGate`, `TestExportWorldGate`, `TestExportLimits`, `TestExportRendezvous`, `TestExportExpiry`, `TestExportStatusReportsFailedJob`, `TestExportRegistryRaces`, `TestExportBackupDigest`, `TestExportUploadPace`, `TestK8sExportJobs`, `TestExportJobIsolation`, `TestExportJobDefaults`, `TestCmdExportWorld`, `TestCmdExportBackup`, `TestCmdExportWiring`]

### 同时备份所有世界：`felis backup-now` {#every-world-at-once-felis-backup-now}

世界只存在卷中，异地存储仅保存归档。扩盘、独立盘迁移、主机迁移前（运维 §2、§5），先在节点归档全部世界：

```bash
sudo felis backup-now                    # the plan; nothing changes
sudo felis backup-now -yes               # archive every world, one at a time; running servers live
sudo felis backup-now -yes -stop         # stop the running servers first and leave them stopped
sudo felis backup-now -yes alpha bravo   # only these servers
```

命令以 root 读取 ops 令牌（§6），逐服调用内部 API。每份仍是普通 manual 备份，相同 Job 和 10% 空闲检查，审计 backup.create 来源 internal:ops、执行 sudo 用户为 actor；免所有者冷却和 max_local_bytes 上限。

- **计划**列出每台用户服务器的阶段及本次处理方式：`back up`（已停止）、`back up while it runs (saving pauses for the copy)`（运行且就绪）、`stop, then back up`（运行中且指定 `-stop`）、`skip: starting or stopping (run again later, or pass -stop)`、`skip: no world volume (never started, nothing to save)`。没有可归档项时以 `Nothing to back up.` 结束。
- **运行中的服务器以不停服方式备份**（见上文「不停服备份」）：玩家保持在线，游戏仅在复制世界期间暂停存档。每个请求在游戏刷写世界且 Job 已创建后返回，大型世界最多需要 2 分钟。控制台无响应（RCON 关闭，§12b）的运行中服务器备份失败；可改用 `-stop` 备份，或先开启其 RCON。
- **计入 manual_keep**：已到数量上限会删除最旧备份，计划提示；需要保留时先增加此值（或下文面板中的对应值）。
- **先处理停服项**，确认 API 能备份后才停其他服，等待每 Job 完成再下一个。
- **`-stop` 在备份前停止每台运行中的服务器**，即出现不停服备份之前每次运行的行为。玩家会断开，服务器保持停止（输出 `Left stopped: …`，须从面板启动）；正在启动或停止的服务器也一并处理。需要保证世界归档后不再变化时使用，例如迁移到另一主机前（运维 §5）。每次停服在审计日志写入 `break_glass.halt`。十分钟后仍未停止则计为失败，继续处理下一台。
- **API 不可达即终止**，提示暂不能继续。Ctrl-C 在当前步骤后停止，已开始的 Job 继续完成。
- 归档暂留节点，等待每小时异地同步；成功归档后打印 `sudo systemctl start felis-offsite.service`，可立即发送，status 查看待传内容。

运行结束时输出统计（`3 backed up, 1 skipped (starting or stopping).`）。全部有卷世界均已归档时退出 0；备份失败、跳过正在启动或停止的服务器（未加 `-stop`）或运行被中断时退出 1；指定的名称不是用户服务器时退出 2。[GO-TESTED: `TestBackupNowPlanChangesNothing`, `TestBackupNowPlanWithNothingToSave`, `TestBackupNowBacksUpEachWorldInTurn`, `TestBackupNowBacksUpRunningServersLive`, `TestListBackupNowWorlds`, `TestBackupNowStopsAtAnUnreachableAPI`, `TestBackupNowStopsWhenInterrupted`, `TestBackupNowNamedServers`]

### 定时备份（每日恢复点） {#scheduled-backups-daily-restore-points}

每天游玩的世界不会空闲 15 天，因此 API 另生成 scheduled：自所有者最后一个完好定时备份以来有人进入，且已达到 scheduled_every，就生成备份。无需 worlds root，使用与手动相同的 Job，只需 `FELIS_IMAGE`、`FELIS_BACKUP_PVC`；缺少任一项时启动日志 `scheduled backups off (needs the backup executor)`。在 felis.toml 或面板中将 `scheduled_every` 设为 `0s` 即关闭恢复点；API 每次检查都重新读取该值，因此面板中的修改无需重启。

| 键 | 默认值 | 作用 |
| --- | --- | --- |
| `scheduled_every` | `1d` | 最新定时备份的最小年龄，0s 关闭 |
| `scheduled_keep` | `7` | 按服务器和所有者保留数量 |
| `scheduled_retention` | `90d` | 到期时间 |

- **运行中的世界以不停服方式备份**。已停止的世界直接归档；运行中的世界执行不停服备份（见上文），仅在复制世界期间暂停存档，因此全天运行的服务器同样获得每日恢复点。正在启动或停止、或世界被其他操作占用的服务器等待后续检查。游戏未响应控制台（上文 `live_backup_console`）的服务器在 `scheduled_every` 的四分之一后重试。
- **集群同时一个**。每两分钟检查，无备份/恢复 Job 时启动，尚无恢复点者优先。期间世界被占用，玩家唤醒已停止的服务器时收到维护提示，完成后重试。
- **存储满暂停**。达到 max_local_bytes 不启动，日志 scheduled backups paused/resumed 各一次；10% 空闲检查仍生效。
- **失败重试**间隔为 scheduled_every 的四分之一，默认六小时，最近操作显示定时备份。
- **按所有者计数**。前所有者的归档不算新所有者恢复点，新所有者也不清理它。所有原因的保留数量均按备份所有者限制。
- 审计 backup.scheduled，actor scheduler，不启动 manual_cooldown；与 manual 一样异地复制、受 max_local_bytes 淘汰。

[GO-TESTED: `TestBackupScheduler`, `TestK8sScheduledBackupJobs`, `TestBackupJobRecordsAScheduledBackup`, `TestBackupPolicyPerReason`, `TestReaperConfigScheduledKeys`, `TestBackupSchedulerTakesARunningWorldLive`, `TestScheduledBackupsFollowThePolicy`；PG-TESTED: `TestScheduledBackupCandidates`, `TestExcessBackupsPerOwner`]

### 面板中设置的保留策略 {#retention-set-in-the-panel}

Owner 可在面板「平台设置 → 备份与审计保留」卡片设置备份和审计的保留策略，代替 `felis.toml` 中的设置。这些值存于 `platform_settings` 的一行（`archive_policy`），每项覆盖 `[archive]` 或 `[audit]` 的对应键：

| 面板字段（API 键） | 覆盖 | 取值范围 |
| --- | --- | --- |
| 手动备份：每台服务器保留份数（`manualKeep`） | `manual_keep` | 1–100 |
| 手动备份：保留天数（`manualRetentionDays`） | `manual_retention` | 1–3650 天 |
| 两次备份的最短间隔（分钟）（`manualCooldownMinutes`） | `manual_cooldown` | 0–1440（0：不限制） |
| 定时还原点：间隔（小时）（`scheduledEveryHours`） | `scheduled_every` | 0–720 小时（0：关闭） |
| 定时还原点：每台服务器保留份数（`scheduledKeep`） | `scheduled_keep` | 1–100 |
| 定时还原点：保留天数（`scheduledRetentionDays`） | `scheduled_retention` | 1–3650 天 |
| 已移除世界的归档保留天数（`releasedRetentionDays`） | `retention`，涵盖回收器写入的全部归档：闲置、释放和删除的世界 | 1–3650 天 |
| 备份存储上限（GiB）（`maxStoreGiB`） | `max_local_bytes` | 0–1048576 GiB（0：不限制） |
| 审计记录保留天数（`auditRetentionDays`） | `[audit] retention`（§17） | 0（保留全部记录），或 30–3650 天 |

保存策略之前，卡片显示 felis.toml 的等效值，并按卡片单位取整（存储上限向上取整为整数 GiB）。felis-api 保存后立即应用，所有副本在 15 秒内生效；备份 Job 在启动时读取策略，回收器在下次每日运行时读取。`warn_before` 仍保留在 felis.toml 中。「恢复为安装时设置」清除该行，felis.toml 重新生效。该行无法读取时 felis.toml 继续生效：felis-api 日志 `felis.toml stands`，备份 Job 和回收器日志 `the panel's retention policy is unreadable, [archive] stands`。异地副本清理桶中无备份记录的对象（§16）时，等待当前生效的三项保留期中最长者；面板保存了策略时以面板中的值为准。

保存和清除与其他敏感变更一样需要重新确认身份；卡片加载后策略已被修改时，保存返回 `409 conflict`。审计操作为 `platform.archive_policy` 和 `platform.archive_policy.clear`。API：`GET`、`PUT`、`DELETE /api/v1/settings/archive-policy`（Owner）。[GO-TESTED: `TestValidateBounds`, `TestFromConfigAndApplyRoundTrip`, `TestArchivePolicyRoutesAreOwnerOnly`, `TestArchivePolicyOverridesTheHostAndHandsItBack`, `TestArchivePolicyAsksForAFreshProof`, `TestBackupLimitsFollowThePolicy`, `TestScheduledBackupsFollowThePolicy`, `TestOffsiteSyncerSnapshotsAndSweeps`]

### 豁免条件（世界不会被回收） {#exemptions-world-never-reaped}

- `spec.reaperExempt=true`：完全跳过，如系统服。[GO-TESTED: `TestReapExemptServerNeverTouched`]
- CRD 不存在：日志 reaper: CRD missing, skipping。
- 空闲不超过 15 天：尚不符合条件。

### 回收前提醒（`warn_before` 时间偏移） {#pre-reap-warnings-the-warn-before-offsets}

有所有者的服在截止前三天/一天（archive.warn_before）通过 API 使用的同一中继向**已验证邮箱**发提醒：优先使用 Owner 在面板保存的中继（§17「面板中设置的邮件中继」），否则使用 `[smtp]`。回收器每次运行时从数据库读取面板中继 [CODE-ONLY]。warned_3d_at/warned_1d_at 仅记录成功投递：

- 面板和 `[smtp]` 均未配置中继，或所有者无已验证邮箱：日志 warning suppressed/no warner wired 或投递错误，不写时间戳，配置中继后仍可发送。
- 中继失败：日志记录，次日重试，直到回收移除候选。
- warned 统计已投递，不统计尝试。

使用 `[smtp]` 中继时，回收器在 minecraft 命名空间读取 felis-smtp、felis-config 的副本，secretKeyRef 不能跨空间。setup 邮件页刷新两个副本，安装后配置即可；仅改控制空间 Secret 不够。[GO-TESTED：已投递/重试/抑制矩阵；本地 SMTP 接收端实测完整流程。]

向导还将密码存到权限 0600 的 `/etc/felis/smtp-password`，上传页将桶密钥存到 uploads-s3-access-key、uploads-s3-secret-key。重装或从备份 state 重建会从空 k3s 数据库开始，因此每次安装均从这些主机文件应用两空间的 felis-smtp 及 felis-uploads-s3。主机文件优先，手改 Secret 只保留至下次安装，应通过 setup 修改。早期安装在首次重跑从 Secret 导出主机副本。SMTP 有 username 却两处都无密码，或 s3 上传缺密钥时，安装器警告并提示对应向导页面。[SH-TESTED: bootstrap_test.sh 的迁移、主机优先、两警告及 kubectl argv 不含值；GO-TESTED：权限及替换。]

### 实际存在的误删风险 {#genuine-false-delete-risk-vectors}

- **last_active_at 过期**：内部 join-event 调用 RecordJoin 维持活跃。加入事件未送到 API，活跃世界仍可能在 15 天后符合回收条件，这是最关键检查（§3a）。真实写入为 INTEGRATION-ONLY。认领也重置时间并清 warned_*，重新认领获得完整 15 天；FreshBackup 只计认领后的 inactive_15d 归档，避免复用前所有者世界。[PG-TESTED: `TestReclaimRestartsReaperClock`]
- **无所有者仍回收**：owner_id 为空不会预警，但 15 天后仍回收，需认领或豁免。[GO-TESTED: `TestReapUnownedServerStillReaped`]
- DeletePVC 幂等，缺失 PVC 不算错误。
- **空闲服卷已消失**：若有最近活动后的新回收归档，视为删除后中断，完成释放/审计/计数。无归档的无主服仅重置活跃时钟，避免每天重复计数；有主服因无世界可归档，只释放并审计一次。[GO-TESTED: `TestReapFinishesInterruptedReap`, `TestReapUnownedWithoutWorldRestartsClock`, `TestReapOwnedWithoutWorldReleases`]

仅实现 TarLocal（tar+gzip），VolumeSnapshot/Longhorn 返回 not implemented in this build。真实 PVC 删除和 Postgres 存储路径为 INTEGRATION-ONLY。

### 世界数据的读取位置（hostPath 解析） {#where-worlds-are-read-from-hostpath-resolution}

CronJob 经静态 PV 将 worlds-host-path 只读挂在 /worlds：名称 felis-worlds-root-`<digest>`、hostPath 类型 Directory、Retain，预绑定 minecraft 同名 PVC。PodSecurity baseline 禁止 Pod 内联 hostPath。更换世界根路径或 reaper-node 会生成新摘要 PV/PVC，旧对保留但不使用，可手动删除，Retain 不删目录。

resolveWorldDir 先查 `<root>/<pvc>`，再根据真实 PVC.spec.volumeName 查 `<root>/<pv-name>_<ns>_<pvc-name>`。不用 glob，避免将旧 PV 遗留目录误认为当前世界。默认 k3s 使用 `/var/lib/rancher/k3s/storage`。另外两项须由部署解决：

- **权限**：回收 Pod 以 root + DAC_OVERRIDE 运行。根目录是 0700 root:root，游戏文件属 UID 1000 或旧版 root，Paper level.dat 为 0600。旧 UID 1000/ACL 方式无法遍历读取，会报 permission denied。安装器不再给游戏 UID 1000 存储根访问权。预期回收却保留世界时，先查看 ERROR 中 resolver 的 lstat 原因。
- **节点**：多节点的世界只在卷所在节点。`--reaper-node` 同时固定 CronJob Pod 与 PV，单节点隐式固定。

---

## 11. 无人自动停服不触发，玩家数一直为 0 {#_11-idle-auto-stop-never-fires-player-count-always-shows-0}

面板或 `felis apply` 新建的服务器默认无人 600 秒后停服，下次加入唤醒。管理员在「编辑服务器 → 无人自动停服」修改或关闭。默认启用前创建的服没有 spec.idle，可用 `sudo felis converge` 补齐（§12b）。登录服和大厅无论 spec 如何都不自动停服。

```sh
kubectl get minecraftserver <name> -o jsonpath='{.spec.idle}'
```

自动停服和玩家计数都依赖 **spec.rcon.enabled**：

```sh
kubectl get minecraftserver <name> -o jsonpath='{.spec.rcon.enabled}'
```

RCON 就绪连接认证后运行 list，parseListReply 支持原版/Paper/Fabric/Forge 的 `There are 3 of a max of 20 players online`、1.12/Bukkit 的 `There are 3/20 players online`、EssentialsX 的 `There are 3 out of maximum 20 players online`（包含隐身玩家），移除 § 颜色码。禁用 RCON 则从未采样，永久 0 不代表无人。

无法读取的计数是**未知**，不会当成零：

```go
if players.Known && server.Spec.Idle.AutoStopEnabled && server.Spec.Idle.EmptySecondsBeforeStop > 0 {
```

未知时 status.players 保留上次真实值，不启动或清除空服计时，PlayersCounted=False、ListUnreadable。只启用 idle 而关闭 RCON 不会生效；插件改写或翻译 list 的格式也会阻止自动停服：

```sh
kubectl get minecraftserver <name> -o jsonpath='{.status.conditions[?(@.type=="PlayersCounted")]}'
# Reason ListUnreadable: run `list` in the server's panel console to see
# what the server actually answers.
```

恢复支持的 list 回复，例如取消该插件覆盖或此消息翻译。游戏服继续运行，仅自动停服等待。两字段都有仍无效，若为探测失败，服务器应显示 Starting/RconNotReachable，见 §1。

此路径曾有三项叠加缺陷，已在真实集群修复（auditfix21/22）：CRD 缺 status.emptySince 导致时间戳被裁剪、空闲服无 watch 事件重查计时、Role 缺 minecraftservers:patch。再次失效时按此顺序检查，每项已有测试：

```sh
# ① The stamp must persist — should print a timestamp, not an empty string,
#    a few seconds after a server goes Ready with zero players.
kubectl get minecraftserver <name> -o jsonpath='{.status.emptySince}'

# ② The operator must be able to write spec.desiredState (403 in the operator
#    log = missing patch grant on Role felis-operator).
kubectl auth can-i patch minecraftservers -n <ns> --as=system:serviceaccount:<ctl-ns>:felis-operator

# ③ A wake-up must be scheduled: while empty, expect whatever you set
#    as emptySecondsBeforeStop to elapse and the box to flip to Stopped without
#    any external action.
```

有玩家时 operator 每 30 秒重新探测，最后一人离开后在空服期限精确调度。空闲时日志安静正常，不必持续协调。回收器的 last_active_at 是独立的 Postgres 业务时钟，由加入事件刷新，只防世界回收，不负责停空服。

---

## 12. 配置字段似乎没有生效 {#_12-a-configuration-field-seems-to-be-ignored}

以下字段都有控制器读取，但须满足条件：

| 字段 | 预期 | 实际 |
| --- | --- | --- |
| `spec.startup.timeoutSeconds` | 启动失败时限 | startupTimedOut，reconciler.go:479、:126；未设置/0 默认 300 秒，随后 StartupTimeout |
| `spec.startup.readinessTimeoutSeconds` | 首次探测预算 | readinessTimedOut，:490、:157；默认 300 秒，随后 ReadinessTimeout；与单次连接的 5 秒不同 |
| `spec.idle.autoStopEnabled` | 空服自动停止 | :175 分支，但必须启用 RCON 提供计数 |
| `spec.idle.emptySecondsBeforeStop` | 空服宽限 | 同一分支，必须大于 0；0 表示关闭，不是立即停止 |

两个启动期限都从 status.startRequestedAt 起算；就绪期限不是 Pod 就绪后额外获得的时间，而是 RCON 分支使用的整个启动截止时间。

---

## 12b. 新字段未应用到已安装的系统服务器（`felis converge`） {#_12b-a-newer-field-never-reaches-an-already-installed-system-server-felis-converge}

setup 按不存在才创建处理 login/lobby，只更新其管理的配置派生环境变量，不重写已有 spec。新字段因此可能永远缺失：大厅无 RCON，控制台失效且人数 0；登录服无 healthHTTPPort。converge 显式补齐零值字段和缺失派生环境键，不覆盖已有 RCON 引用或调优：

```
sudo felis converge
```

**先部署新镜像再运行**。旧镜像没有 RCON/HTTP 监听，启用探测会使其停在 Starting，最终 Failed，所以此命令不在每次 setup 自动执行。已最新的系统服显示 already converged。

该命令也为从未设置 idle 的用户服添加无人 600 秒停止；管理员明确关闭的服仍有 duration，保持关闭，只有实际填充的服输出记录。

旧用户服完全未设置 RCON 时，控制台、人数、自动停服均失效。普通 converge 只列出，不修改；`-user-rcon` 才添加当前默认配置，使用 operator 创建的 `<name>-rcon` Secret：

```
sudo felis converge -user-rcon
kubectl -n minecraft get minecraftserver -o custom-columns=NAME:.metadata.name,RCON:.spec.rcon.enabled
```

这是显式选项，因为镜像必须根据 RCON_PASSWORD 打开监听。平台 paper/lobby 支持，用户自带镜像须先检查。有人明确设置过 RCON（开或关）的服不修改，新配置在下次启动生效。

---

## 13. 删除 MinecraftServer 后世界 PVC 仍然保留 {#_13-world-pvc-survives-after-i-deleted-the-minecraftserver}

这是预期行为。世界 PVC 来自 StatefulSet VolumeClaimTemplate，operator 明确设置 persistentVolumeClaimRetentionPolicy 在删除和缩容时均 Retain。没有 finalizer。删除 CR 会通过 ownerReference 回收 StatefulSet，保留 PVC；相同名称重建会挂载原世界。只有回收器在验证备份后删除世界卷（§10）。

旧卷占用名称，新建返回 `409 world_volume_exists`，防止旧世界交给新所有者。查看失去服务器的世界卷：

```
comm -23 \
  <(kubectl -n minecraft get pvc -l felis.lolicon.best/server -o jsonpath='{range .items[*]}{.metadata.labels.felis\.lolicon\.best/server}{"\n"}{end}' | sort) \
  <(kubectl -n minecraft get minecraftservers -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | sort)
```

回收名称前，若世界可能仍有价值，请先备份：

```
kubectl -n minecraft delete pvc world-<name>-0      # irreversible — the world is gone
```

spec.storage.retainOnDelete 曾在 CRD 中，但无人读取。冻结规范 v4.1 §5 要求「finalizer 清理 Service/StatefulSet/ConfigMap，PVC 按 retainOnDelete 处理」，两部分都未实现。该字段现已移除，本文记录与旧规范的明确差异。

实现它会新增跳过回收器备份验证的删世界路径，而其他资源本已由 ownerReference GC 清理。旧 CR 携带该字段仍可使用，下次写入 API server 会裁剪未知键；保留行为不变，因为它从未取决于此字段。

---

## 13b. 节点磁盘耗尽：保留哪些数据以及如何恢复 {#_13b-node-runs-out-of-disk-what-survives-and-how-to-recover}

磁盘满会使 kubelet 驱逐游戏 Pod，再 GC 未使用镜像。镜像现在有内部仓库来源，释放空间后可自动重新拉取。

**驱逐保护**：api、operator、reaper、registry 使用内置 system-cluster-critical（2e9）。kubelet 拒绝压力驱逐它们，日志 cannot evict a critical pod；默认优先级 0 的游戏服先被驱逐。磁盘剩 1.7G 的演练中 login/lobby 被驱逐，控制平面仍运行；修复前控制平面也会被驱逐。自定义 PriorityClass 上限 1e9，达不到关键阈值。内置类允许抢占，使无法调度的控制 Pod 可抢占游戏 Pod，确保管理面可部署。

**压力解除延迟**：释放空间后 DiskPressure=True 可能保持约五分钟，默认 eviction-pressure-transition-period=5m 防抖。等待调度不是节点卡死。

**镜像自动恢复**：压力下未用超过两分钟的镜像可能被 GC。平台镜像也在内部仓库，containerd 通过 registries.yaml 和回环 hostPort 重新拉取。删除卡住 Pod 可立即重试，也可等退避。

若仍失败：

1. `df -h /var/lib/rancher` 检查并释放空间，主要占用为 containerd 镜像及 storage 下的世界/备份。
2. 检查 `kubectl -n felis get pods -l app.kubernetes.io/component=registry`，节点 `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000/healthz` 应为 200，仅后方 registry:2 健康时返回。匿名 /v2/ 的 401 正常（§9）。
3. registries.yaml 须将 registry.felis.svc:5000 映射到 http://127.0.0.1:5000。缺失或改动时重跑安装器，内容不同才重写并重启 k3s。
4. 手建但未推送的镜像：启动 Docker，以 platform 登录（密码来自 felis-registry-auth 的 platform），再 `docker tag <ref> 127.0.0.1:5000/<repo>:<tag> && docker push 127.0.0.1:5000/<repo>:<tag>`。

两处都无镜像时重跑安装器重建/导入并镜像到仓库；单镜像可 `docker save felis:<tag> | k3s ctr images import -`。Docker 存储是有意保留的第二副本，不应随意当空闲空间删除。

## 13c. 主机地址、名称或时钟发生变化 {#_13c-the-host-s-address-name-or-clock-changed}

安装绑定原 IPv4，写入 k3s 节点、网络策略、证书和默认 nip.io 域名，没有自动重新寻址。DHCP 改地址或虚拟机迁移后，集群和代理仍指旧地址，旧面板域名失效。看门狗五分钟后报告 host-address 严重；安装时会警告租约地址。

恢复原地址：路由器 DHCP 保留或静态配置，Rocky 例如 `nmcli con mod <con> ipv4.method manual ipv4.addresses <ip>/<prefix> ipv4.gateway <gw> ipv4.dns <dns> && nmcli con up <con>`。然后重启 API 和代理。新地址迁移需从备份重装（运维 §5）；新地址运行后可 `sudo felis domain set <new-ip>.nip.io` 更换默认域名（§6）。

**节点名已固定**：local-path 卷按节点名绑定；旧安装随主机名变化会出现第二空节点、旧卷 Pending。现在 `/etc/rancher/k3s/config.yaml.d/50-felis.yaml` 的 node-name 固定名称，改主机名无影响。用 `sudo k3s kubectl get node -o jsonpath='{.items[0].metadata.annotations.k3s\.io/node-args}'` 检查。文件还设 write-kubeconfig-mode=0600，管理员配置仅 root 可读，使用 sudo k3s kubectl 或 sudo -E kubectl。

**时钟须同步**：验证码、会话、证书依赖时间；S3 拒绝超过 15 分钟偏差的签名。安装器开启 NTP，缺客户端时装 chrony，除非 FELIS_MANAGE_TIME_SYNC=0。持续未同步 30 分钟后警告 clock。timedatectl 应显示 System clock synchronized: yes、NTP service: active，另查 chronyc sources；出站 UDP 123 被拦会导致未同步。

系统日志在 journald.conf.d/50-felis.conf 持久化，默认限额 1G，可用 FELIS_JOURNAL_MAX_USE 改；journalctl -b -1 查看上次启动日志。

---

## 13d. k3s 证书在一年后过期 {#_13d-k3s-certificates-expire-after-a-year}

k3s 的客户端/服务证书（API server、kubelet、管理员配置、etcd 等）有效 365 天，CA 十年。只在 k3s 启动时，用原密钥续签已过期或剩余不超过 120 天的证书。在此窗口重启或升级 k3s 即自动续期；一年不重启可能导致 API server、节点失效，面板不能启停备份。CA 不由重启续期，需 k3s certificate rotate-ca 及 k3s 官方证书管理流程。

看门狗只读取 server/tls（含 etcd、kube-controller-manager、kube-scheduler）及 agent 下的 crt，不读取私钥，范围与 k3s certificate check 一致。最早到期证书报告 k3s-certs，提前 30 天警告、最后七天及过期严重，提示重启能否续签，CA 不能。`felis watchdog -k3s-cert-dirs ""` 关闭检查。[GO-TESTED: `TestCertFinding`；VM-VERIFIED：v1.36.4+k3s1 真实证书及前移时钟。]

检查和续签：

```sh
sudo k3s certificate check --output table   # every certificate, its expiry and residual time
sudo systemctl restart k3s                  # reissues the ones within 120 days of expiry
sudo k3s certificate check --output table   # the renewed ones show about a year again
```

k3s unit 的 KillMode=process 保留容器，重启 k3s 时游戏、数据库、控制面继续服务，API server 一分钟内恢复。[VM-VERIFIED：容器 ID 和重启数未变。] 不要用会停止全部容器的 k3s-killall.sh。

在 120 天窗口前提前续签，以配合维护时段：

```sh
sudo systemctl stop k3s && sudo k3s certificate rotate && sudo systemctl start k3s
```

面板自身 `/etc/felis/panel-tls.crt` 是另一证书，安装器自签有效 825 天，不在该检查范围。

---

## 14. 健康告警与诊断指标（规范 §23） {#_14-health-alerts-and-metrics-for-diagnosis-spec-§23}

完整安装通过 felis-watchdog.timer 运行看门狗，不需要监控栈即可邮件通知所有者。以下指标和规则供另有 Prometheus 的部署使用。

### 看门狗：哪些异常会邮件通知所有者 {#the-watchdog-what-mails-the-owners}

主机每两分钟检查：

| 检查 | 持续多久后通知 | 严重度 |
| --- | --- | --- |
| api/operator/registry Deployment 缺失或无可用 Pod | 5 分钟 | 严重 |
| Kubernetes API 不可达；其余集群检查记为未知并保留状态 | 5 分钟 | 严重 |
| 登录服应运行却未 Running | 10 分钟 | 严重 |
| 大厅等其他系统服应运行却未 Running | 10 分钟 | 警告 |
| 用户服 Failed | 5 分钟 | 警告 |
| 最近 24 小时备份/恢复/回收 Job 失败 | 立即，仅一次 | 警告 |
| 回收超过 26 小时无成功 | 立即 | 警告 |
| 节点 NotReady 或 Disk/Memory/PID 压力 | 2–5 分钟 | 严重 |
| PostgreSQL 不可达 | 3 分钟 | 严重 |
| 代理游戏端口拒绝连接 | 3 分钟 | 严重 |
| 最新 daily 数据库备份超过 26 小时或不存在；新 manual/offsite 不抵消 | 10 分钟 | 严重 |
| 文件系统空闲低于 15%；低于 5% 更严重 | 15 分钟；严重时 5 分钟 | 警告/严重 |
| 可用内存低于 10% | 15 分钟 | 警告 |
| 主机失去安装地址 | 5 分钟 | 严重 |
| 时钟未通过 NTP 同步 | 30 分钟 | 警告 |
| k3s 证书剩 30 天；剩七天或已过期更严重 | 立即 | 警告/严重 |
| 看门狗自身持续失败 watchdog/run | 10 分钟 | 严重 |
| 状态文件不可解析并被移开 watchdog/state | 立即，仅一次 | 警告 |

通知规则：

- 收件人为启用的所有者账号的已验证邮箱。中继与登录码相同：优先使用 Owner 在面板保存的中继（「平台设置 → 邮件服务」，§17），每次运行时从数据库读取，否则使用 `[smtp]`。
- 每次最多一封，汇总新问题、未解决问题的每日提醒、连续恢复十分钟后的解决通知。延迟前自愈不通知，升级为严重立即再次通知。
- 安装期间由 `/run/felis/watchdog-quiet-until` 抑制邮件，安装器退出时移除。
- 从另一主机备份重建、尚未接管的待机主机，在桶记录的原主机过去三小时仍运行时不发信，日志 holding this mail；原主机停止后待机也成为告警（§16）。[GO-TESTED: `TestMailHold`]
- 使用 `[smtp]` 中继时，密码优先从主机 `/etc/felis/smtp-password` 读取，API server 停止时也能读取，缺文件才读 `felis-smtp` Secret。当前使用的中继、其密码和收件人缓存在 root-only 的 `/var/lib/felis/watchdog/state.json`。无法读取数据库的运行继续使用上次成功运行缓存的面板中继，仅当上次运行也使用 `[smtp]` 时才回退到 `[smtp]`。因此 PostgreSQL 或 API server 停止时仍可通知。[GO-TESTED：API server 与 PostgreSQL 同时停止时使用主机缓存；`TestRelayForPrefersThePanelRelay`。]
- 无中继或已验证邮箱时仅写 journal；如配置心跳且有未送达告警则发送失败心跳。新安装提示 NO ALERT MAIL。setup 最后卡片的 alerts 行显示去向或缺失项，按 e 配邮件（或在面板保存中继），再在面板「账号 → 邮箱验证」验证；heartbeat 行显示检查。该卡片和 `felis doctor` 优先读取 Owner 在面板中保存的中继和心跳，未保存时回退到 `felis.toml` 和心跳文件，与看门狗一致。[SH-TESTED；GO-TESTED: `TestAlertRouteLines`, `TestHostAlertRoute`]

命令：

```bash
journalctl -u felis-watchdog -n 40          # every check of the latest runs
sudo felis watchdog -dry-run                # run the checks now; mail nothing, change nothing
systemctl list-timers felis-watchdog.timer  # when it last and next runs
```

健康时 every check passed，否则逐项日志并在发信时记录主题。shell 的 dry-run 使用默认值，不含代理或地址检查；unit 带 proxy-addr、node-ip、安装时磁盘列表，可用 systemctl cat felis-watchdog 查看。

### 心跳：如何发现整台主机失联 {#the-heartbeat-what-notices-the-host-itself-going-down}

主机关机、定时器停止、看门狗发信前崩溃无法自报。每次执行向 Healthchecks.io 或兼容服务发心跳，由外部服务在停止后通知。

1. 建检查，周期两分钟，宽限十分钟。
2. 在以下任一位置向看门狗提供该检查的 ping URL：
   - 面板「平台设置 → 监控心跳」卡片。看门狗下次运行即发送心跳。
   - 主机：重跑安装器，设置 `FELIS_WATCHDOG_HEARTBEAT_URL=<检查 URL>`，写入 `/etc/felis/watchdog-heartbeat-url`（root-only，0600）。

   URL 路径是检查的密钥，面板、安装输出和日志只显示协议/主机。

后续不设置变量会保留文件，设为 off 则删除。无心跳文件时提示 NO HEARTBEAT。[SH-TESTED: bootstrap_test.sh]

面板保存的 URL 存于 `platform_settings` 的一行（`watchdog_heartbeat`），优先于主机文件。每次运行从数据库读取并缓存在看门狗状态中，因此数据库停止期间的运行以及下文的失败回退仍会向它发送心跳。卡片上的「移除心跳地址」清除该行；此后看门狗改为向安装器写入的主机文件 URL 发送心跳（如有），监控服务上的检查会因心跳缺失而告警，直到在该服务中暂停此检查。保存和移除需要重新确认身份；审计操作为 `platform.heartbeat` 和 `platform.heartbeat.clear`。API：`GET`、`PUT`、`DELETE /api/v1/settings/heartbeat`（Owner）；`GET` 只返回是否已设置 URL 及其协议和主机。安装器结束摘要（通过 `felis panel-settings`）、setup 卡片的 `heartbeat` 行和 `felis doctor` 均计入面板保存的 URL，仅当面板和主机文件都没有 URL 时才警告。[GO-TESTED: `TestHeartbeatForPrefersThePanelURL`, `TestWatchdogUnitFailedPingsThePanelHeartbeat`, `TestHeartbeatSettingKeepsItsKeyPrivate`, `TestHeartbeatSettingAsksForAFreshProof`, `TestCheckAndRedact`]

| 执行结果 | 心跳 |
| --- | --- |
| 告警成功送达，或无到期告警 | GET 原 URL |
| 未送达告警、邮件失败、状态未保存 | POST URL/fail，正文含原因和发现 |
| 安装中的上述失败 | 不发送 |
| 为其他主机异地桶待机 | 不发送，由写桶主机发送 |

带查询字符串 ? 的 URL 无 fail 端点，失败时不发送，等待宽限耗尽。十秒超时或非 2xx 仅日志 heartbeat 错误，不改变检查/邮件决定的退出码。[GO-TESTED: `TestHeartbeatSend`, `TestWatchdogRunHeartbeat`]

备份包（§16）携带 /etc/felis 及心跳文件，面板保存的 URL 则随数据库一并携带。由备份包重建的主机在 `felis offsite take-over` 前处于待机状态，不发送心跳；接管后使用同一检查。

### 看门狗自身故障 {#when-the-watchdog-itself-fails}

unit 的 OnFailure=felis-watchdog-failed.service 在崩溃、三分钟期限、配置不可加载等失败时运行 `felis watchdog -unit-failed`：

- 立即将 systemd 结果发 fail 心跳，如 result exit-code, exit status 3；安装/待机时抑制。
- 记录 watchdog/run，持续十分钟后发邮件。中继和收件人在 `felis.toml` 可加载时取自它，否则取自看门狗缓存；Owner 在面板保存的中继（以上次成功运行的缓存为准）优先于 `felis.toml`。首次成功按普通告警恢复。

[VM-TESTED：systemd 252 将退出 3 传到回退服务，并向本地 fail POST，静默文件抑制；GO-TESTED: `TestWatchdogUnitFailedBrokenConfig`，六次两分钟间隔失败在十分钟用缓存发一封。]

状态 JSON 不可解析时改名 state.json.unreadable-`<unix time>`，从新状态开始并通知 watchdog/state。历史丢失使仍存在问题重新作为新告警发信。常见于断电或手改，查 df 后可删除移开的副本。[GO-TESTED: `TestRecoverState`]

状态文件不可写时，保存在 tmpfs `/run/felis/watchdog-state.json`，root-only；下次读取两个副本中较新者，避免两分钟重复发信。日志说明临时保存，退出 1 并发 fail；连续五次后发一次 watchdog/run。恢复写入后删 tmpfs 副本；此前重启会失去邮件历史，未解决问题重新通知。[GO-TESTED: `TestSaveStateOr`, `TestWatchdogRunStateThatDoesNotSave`, `TestWatchdogUnitFailedStateThatDoesNotSave`]

```bash
journalctl -u felis-watchdog-failed -n 20   # what the fallback reported and pinged
systemctl status felis-watchdog             # the failed run's result
```

### 指标 {#metrics}

排查时关注：

- `felis_servers_total`：受管服务器数。
- `felis_server_phase{server,role,phase,desired}`：当前阶段值为 1。role 为 login/lobby 或用户服空值，desired 区分主动停服和启动失败。
- `felis_build_info{component,version}`：对应 api/operator 进程值为 1，缺失说明进程或采集异常。
- `felis_start_duration_seconds`：首次就绪时记录 ReadySignalAt−StartRequestedAt。永不完成的启动没有样本，缺样本本身也是信号。
- `felis_image_build_failures_total`：构建 Job 失败数。
- `felis_reaper_worlds_deleted_total`：确认备份并实际删 PVC 后增加，突然增长须检查加入事件。
- `felis_http_requests_total{face,method,route,code}`、`felis_http_request_duration_seconds{face,route}`：按路由模式，而非原始路径统计；无匹配为 unmatched，face 为 internal/external。日志流计请求但不计延迟。单一路由 5xx 增加定位处理器，unmatched 增加可能是扫描。
- API 的 go_*、process_*：goroutine、堆、文件描述符，goroutine 只增不减可能是流或上传未结束。
- `go_sql_*{db_name="felis"}`：最多 25 连接，各连接默认 statement_timeout=15s、idle_in_transaction_session_timeout=60s，URL 已设置则保留。in_use 达 max_open 且 wait_count 增长表示等待连接，应查 `SELECT pid, state, wait_event, query FROM pg_stat_activity` 的慢查询/锁。超时日志 canceling statement due to statement timeout。

API 每请求写 logfmt：face、method、route、path、status、duration_ms、bytes、request_id、principal（登录后用户 ID）；成功探测和采集除外。

```bash
kubectl -n felis logs deploy/felis-api | grep 'msg=request' | grep 'status=5'
kubectl -n felis logs deploy/felis-api | grep 'request_id=<id from the error>'
```

插件请求在 internal 各路由中独立可见：

```promql
sum by (route, code) (rate(felis_http_requests_total{face="internal", route="/api/v1/internal/servers/{name}/join-event"}[5m]))
sum by (route, code) (rate(felis_http_requests_total{face="internal", route="/api/v1/internal/servers/{name}/wake"}[5m]))
histogram_quantile(0.95, sum by (le, route) (rate(felis_http_request_duration_seconds_bucket{face="internal"}[5m])))
```

未到 API 的拒绝、重置、超时不计 API 指标，由调用方计数。代理每活跃十分钟输出自己看到的 API 及失败，代理控制台 /felis 显示启动以来总量：

```bash
journalctl -u felis-velocity | grep 'Felis: last 10 min'
# Felis: last 10 min: felis-api calls=412 (no answer=0, 4xx=3, 5xx=0, retried=0), avg=18 ms, max=240 ms,
#   busy refusals=0, join-events failed=0, join-events dropped=0, transfers failed=0,
#   server-list refreshes failed=0, waiting now=0
journalctl -u felis-velocity | grep 'server list refresh'
kubectl -n minecraft logs login-0 | grep 'link status poll'
```

no answer 增加而 API 请求平稳，检查内部网络策略、Service、Pod。busy refusals/join-events dropped 非零说明 API 比代理八线程池可承受的更慢。刷新或绑定状态故障开始时警告，每五分钟报告计数，恢复时 info。

### 采集指标 {#scraping}

两个 Service 都带 prometheus.io/scrape|port|path 注解，支持注解发现的 Prometheus 可直接采集。

- operator 的 :8080/metrics，Service felis-operator-metrics：服务器数、阶段、启动时长、operator build_info，以及 controller_runtime_reconcile_* / workqueue_*。
- API 内部 :8081/metrics，Service felis-api-internal：api build_info、HTTP、Go/process、SQL 池、构建失败，以及 §17 的 felis_mail_total、felis_rate_limited_total、felis_auth_otp_lockouts_total、felis_auth_failures_total、felis_sessions_revoked_total、felis_audit_write_failures_total。与探测一样无认证，仅 ClusterIP，外部接口不提供。
- 回收删除数产生于一次性 CronJob，通常在采集前已退出；没有 pushgateway 则没有采集路径，应查 Pod 日志或 world_backups 表。

### 告警规则 {#alert-rules}

`deploy/alerts/` 提供：

- 控制面：FelisOperatorDown、FelisAPIDown，进程停止或未采集。
- 服务器：FelisLoginGateDown、FelisSystemServerDown、FelisServerFailed。
- 协调：FelisReconcileErrors；超过三分钟的 FelisReconcileStuck。operator liveness 在协调超过十分钟重启，readiness 等 informer 缓存同步。
- 世界 Job（需 kube-state-metrics）：FelisWorldJobFailed、26 小时未成功的 FelisReaperStale。
- 构建失败、慢启动；节点磁盘/内存阈值及 DiskPressure。
- 数据库备份时效（§16，需 node-exporter textfile collector）。
- 登录滥用（§17）：邮件预算、中继失败、限流、账号验证码锁、登录拒绝率及审计丢行。

普通 Prometheus 将 felis-alerts.yaml 加入 rule_files，并运行 `promtool check rules felis-alerts.yaml`、`promtool test rules felis-alerts_test.yml`；测试固定各规则触发时间。kube-prometheus-stack/prometheus-operator 用 `kubectl apply -f felis-prometheusrule.yaml`，release 标签须匹配 ruleSelector。

---

## 15. 控制平面升级与失败回滚 {#_15-control-plane-upgrades-and-rolling-back-a-bad-one}

`felis update` 只做检查，输出目标版本和明确的 `--apply` 命令。主机更新器从目标解析出的完整提交下载安装器，备份数据库和部署状态，再用该安装器协调 CLI、核心服务、插件和系统镜像。`--version`、`--ref`、`--dev`、`--all` 见运维 §4。应原样使用输出的命令，以保持已审阅的目标。执行更新需要处于有效的维护窗口或显式指定 `--now`；`--force` 不会跳过备份、无法读取的维护窗口或兼容性检查。

`felis update -h` 中没有 `--apply` 的主机仍需运行一次安装器（`curl -fsSL <installer URL> | sudo bash`）以获取新 CLI。在已完成的安装上，`sudo felis setup` 只打开配置控制台，不能用于升级。更新器复用与该安装器相同的校验和、镜像导入/构建及 rollout 检查。升级时需注意控制平面的两项特性：

- API/operator 均单副本 Recreate，无选主，重叠会竞争同集群；部署窗口面板/API 暂停，通常数秒，导入镜像可能更久。
- 新 Pod 无法启动时，180 秒后 rollout 失败并打印 describe，显示 ErrImagePull/ImagePullBackOff 等。

下载产物执行前检查：

| 产物 | 校验 |
| --- | --- |
| felis-linux-`<arch>` | 发布版 SHA256SUMS，不存在或不同则从同标签编译 |
| 镜像 tar、镜像清单、felis-velocity.jar | SHA256SUMS；清单每行是已知角色和摘要，导入后 containerd 须有对应摘要。失败回退本地（§15c），ARTIFACT_DIR 则停止 |
| k3s airgap 镜像 | 发布版 sha256sum-`<arch>`.txt，不匹配则由 k3s 从 Docker Hub 拉取 |
| k3s | 固定标签安装脚本，默认 v1.36.4+k3s1，脚本校验二进制 |
| cloudflared | 默认 2026.9.1 和固定 sha256，其他版本需 FELIS_CLOUDFLARED_SHA256 |
| Go 工具链 | 各架构固定 sha256，其他版本需 FELIS_GO_SHA256 |
| registry、PostgreSQL | registry:2.8.3@sha256:a3d8…、postgres:18.6-trixie@sha256:5a5a…，附件必须携带同名同摘要 |
| Limbo、spawn schematic、Paper、LuckPerms、Velocity | game-stack.lock 的构建及 sha256 |
| Temurin JRE | 25.0.4.1+1，各架构固定 sha256 |
| Felis/limbo/lobby/paper 的基础镜像 | 各 Dockerfile 摘要固定 |

公共仓库发布版还附签名构建来源证明。`gh attestation verify felis-linux-amd64 --repo FelisMC/Felis` 可查构建工作流和提交。

各发布版独立标签，如 felis/felis:v1.2.3；源码戳 v1.2.3+gabc1234 转为 v1.2.3-gabc1234，无版本为 demo。升级结束打印原标签，存入 `/etc/felis/previous-felis-image`。回滚：

```
kubectl -n felis rollout undo deployment/felis-api deployment/felis-operator
kubectl -n felis rollout status deploy/felis-api
```

rollout undo 返回前 ReplicaSet 的镜像标签。镜像通常仍在节点，GC 后可从仓库重拉；清理保留最新五个 felis/felis 标签及仍被游戏 Pod 引用的镜像。同版本重跑复用标签并重启，因此 undo 仍可能落在同标签；下次安装器会再次应用当前安装版本。

平台升级默认不动运行游戏服。其 initContainer 也使用 Felis 镜像，运行服保留旧版，下次启动获得新版本；若发布版另改游戏 Pod 模板，则会像编辑服务器一样重启一次。

**重跑的重启条件**：

| 组件 | 何时重启 |
| --- | --- |
| Velocity | unit、JRE、velocity.jar/toml、转发密钥、绑定配置（service-token 自动重读除外）、插件 jar 改变，或服务未运行。velocity.fingerprint 记录指纹，删除可强制 |
| login/lobby | 新镜像 ID 与 system-server-images 不同。安装器 pin-images --system 固定新摘要，operator 分别更新；仓库不可达则重建 Pod。BUILDX_NO_DEFAULT_ATTESTATIONS=1 避免构建时间证明令每次 ID 不同 |
| PostgreSQL | 固定镜像或 Pod 改变，API 暂停数秒；未改则不重启 |
| API/operator/registry gate 和 GC | 版本标签变化，或同版本重新构建 |

数据库在 k3s 内，发行版升级不改变其版本。major 与现有集群不同时安装器拒绝并提示导出恢复（运维 §4）。首次含 felis-postgres 的重跑迁入 k3s，移除旧 felis-postgres-firewall.service；Arch 的 pacman -Syu 在旧集群存在时保留宿主机 PostgreSQL 包，供回退。

undo 只回滚镜像，迁移仍在；数据库问题需恢复升级前 pre-migrate 包（§16）。

**Schema 检查**：API、reaper、offsite、migrate up 比较数据库迁移集合与内嵌集合。数据库更新时，旧构建拒绝并提示 schema is newer，例如数据库 0026、构建只到 0025；跨迁移 undo 会 CrashLoopBackOff，需恢复 pre-migrate。数据库落后时 API/reaper/offsite 拒绝，须 migrate up；setup preflight 会自行应用。[PG-TESTED]

**失败与主机二进制**：安装器早期替换 `/usr/local/bin/felis`，旧版留 felis.prev。迁移开始前失败会还原旧二进制，使定时器和 setup 与仍运行数据库/控制面匹配；迁移开始后保留新版。[VM-VERIFIED]

## 15b. 游戏镜像、固定构建与世界版本升级 {#_15b-game-images-pinned-builds-and-moving-a-world-to-a-newer-minecraft}

game-stack.lock 固定 Limbo CI/Minecraft、Paper、LuckPerms、Velocity 构建及 sha256。同发布版各主机使用相同构建，重跑不重复构建。`bash deploy/update-game-stack-lock.sh` 解析最新构建、计算摘要、改写 lock；--check 仅报告变化。

- FELIS_GAME_STACK=latest 在安装时选择最新上游，对无摘要产物计算哈希，警告不属于该发布版。
- FELIS_VELOCITY_VERSION=`<minor>` 选择该 minor 最新、仍内容寻址并校验的构建。
- FELIS_JRE_VERSION 选择 Java feature release，默认 25、固定 Temurin 25.0.4.1+1。安装器安装的 JRE 随重跑更新至固定补丁，其他供应商的保留。

默认游戏标签如 felis/paper:demo 可变，但服务器不会自动跟随。API 创建服务器时固定当时摘要；安装器在推新镜像前用 pin_user_server_images 固定旧裸标签服务器。摘要限定引用永远按原构建启动。login/lobby 每次更新也固定，可查 spec.image。

安装器另推不会重写的 `<Minecraft version>-<12 hex image id>` 标签，如 felis/paper:26.2-3f9c0a1b2c4d。将版本标签入白名单，可在 demo 变化后继续创建指定版本服务器。

升级现有世界须在「编辑服务器」选镜像并确认已备份；重选当前标签会更新到最新摘要。API PATCH 要求 confirmImageChange=true，否则 409 image_change_unconfirmed。先备份：新 Minecraft 加载会升级区块，旧版无法再打开。审计保存 image_from/image_to，回退时恢复旧构建及升级前备份。旧镜像必须仍在仓库：无服务器/白名单引用的构建 24 小时后可清理，各 felis 仓库最新五个保留（§9）。

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| image_not_in_registry | 白名单标签未推送或已删除 | 推送/重建后重试 |
| registry_unavailable | API 无法访问 registry.felis.svc:5000 | 检查仓库 Pod 及允许 API 的 registry-ingress |
| could not pin every user server | 仓库停机或标签丢失 | 修复后启动前执行 sudo felis pin-images；丢标签需管理员选新镜像 |
| could not pin the login system server / lobby | 推送后仓库未响应 | 安装器改重建 Pod，仅裸标签可得到新版；仓库 Ready 后重跑 |
| 重跑时运行服重启 | 首次将当前构建固定到摘要 | 每服发生一次，无需处理 |
| the registry no longer holds build … | 摘要无引用超过 24 小时被清理 | 选当前标签，需要保留的版本标签入白名单 |

## 15c. 安装发布版时仍在主机上构建 {#_15c-the-installer-builds-on-the-host-although-it-installs-a-release}

某附件不可用时安装器注明产物及原因，仅该镜像回退 Docker 构建，registry/PostgreSQL 改从 Docker Hub 拉取，不使用未校验内容 **[SH-TESTED]**。每下载三次，间隔五秒；持续一分钟低于 1 KiB/s 会中断重试。

发布版 preflight 不预留 Docker 构建空间，所以首次回退先检查 `/var/lib/containerd` 约 8 GiB；已有缓存时约 2 GiB。不足则在装 Docker 前停止，提示所需/可用 MiB、nothing has been built。可等待附件可用后重跑、释放空间，或 FELIS_PREFLIGHT=warn 强制构建 **[SH-TESTED]**。

主机构建的 Docker 输出保留在终端回滚缓冲区中。构建插件时，`[felis] Downloading <file> (<host>)` 标明每项 Gradle 依赖下载；进行中的下载每十秒报告字节数、速度和已用时间。仅当服务器提供总大小时才显示百分比。连续三十秒没有新数据时，该行显示 `no new data for …; waiting for the download`；这只报告等待状态，不改变 Gradle 的超时或重试行为。

| 消息 | 含义 | 处理 |
| --- | --- | --- |
| release vX publishes no SHA256SUMS | 老版无附件或仍上传 | 老版可正常回退；新版等待清单发布后重跑 |
| SHA256SUMS lists no `<file>` / could not download `<file>` | 部分附件缺失 | 稍后重跑，当前本机构建仍正确 |
| downloaded `<file>` hashes to … but … says … | 损坏或清单后替换 | 重跑重新获取；持续不匹配应报告附件问题 |
| image listing … is malformed | 镜像列表不可解析 | 报告，全部镜像本机构建 |
| release's registry image is … but installer runs … | base tar 摘要与脚本不同，版本不匹配 | 运行发布标签安装器，update --panel 给命令 |
| containerd holds no `<image>` from `<tar>` | 导入 tar 无指定摘要 | 查 sudo k3s ctr images ls，再报告 |
| FELIS_ARTIFACT_DIR: … 并停止 | 目录附件缺失或校验失败，不回退构建 | 重拷对应附件再运行 |

中途中断留下 `/var/lib/felis/artifacts`，重跑复用仍匹配校验和的 tar，镜像入库后删除目录。


## 16. 控制平面数据库备份与灾难恢复 {#_16-control-plane-database-backups-and-disaster-recovery}

API 的 PostgreSQL 保存世界之外的账号、Passkey、MC 绑定、归属、配额、审计，以及将归档映射至所有者的 world_backups 索引。丢失数据库会使世界归档失去归属。数据库在 k3s 的 felis-postgres 运行，集群目录在主机 `/var/lib/felis/postgres`；felis db 根据配置的 deployment 在 Pod 内执行 pg_dump/psql/pg_restore，备份包留在主机。

### 运行哪些任务，备份包存放在哪里 {#what-runs-and-where-the-bundles-go}

- felis-db-backup.timer 每日执行备份，FELIS_DB_BACKUP_TIME 默认 `*-*-* 03:30:00`，随机延迟最多 15 分钟，Persistent=true 补开机漏执行。安装时先创建首份，暴露管线错误。[CODE-ONLY；unit/timer 内容由 bootstrap_test.sh 验证。]
- 每次 migrate up 在已有数据且待迁移时先创建 pre-migrate；失败则不应用任何迁移，提示 pre-migration backup failed, nothing applied。[GO-TESTED]
- 恢复前创建 pre-restore，`-no-safety-backup` 可跳过。[GO-TESTED]

备份目录 FELIS_DB_BACKUP_DIR 默认 `/var/lib/felis/db-backups`，0700，位于 /var/lib/rancher 外，避免 k3s 重装删除。每份 felis-db-`<UTC stamp>`-`<label>`.tar 包含：

| 成员 | 内容 |
| --- | --- |
| MANIFEST.json | 版本、schema、pg_dump 版本、各成员 sha256 |
| db.dump | felis 数据库的 custom 格式导出 |
| state/etc/felis/... | /etc/felis 全部文件：DB/转发/调用方/仓库机密，两个配置和软链接、异地桶凭证/密钥、SMTP/上传密钥、面板证书，以及 system-server-images、velocity.fingerprint；有意排除 bootstrap.done |
| k8s/minecraftservers.json | 全部 MinecraftServer，移除 status/服务端元数据，可直接 apply；导出尝试三次、间隔十秒，仍失败则省略并在 manifest 说明 |

旁边有 sha256sum 格式的 .sha256。**备份包包含机密，须像 /etc/felis 一样保护**。保留数按标签独立：daily 默认 14（FELIS_DB_BACKUP_KEEP），pre-migrate 10，pre-restore 5，offsite 1，manual 永不自动清理。另有安装变量 FELIS_DB_BACKUP_TIME、METRICS、PRE_MIGRATE_BACKUP。

### 最近一次备份是否及时 {#is-the-newest-backup-fresh}

以下四处都检查最新 **daily** 是否在 26 小时内。新的 manual、pre-migrate、offsite 可恢复，但不清除此告警，因为每日管线仍停了。

- 面板「管理 → 维护与备份」显示最新备份类型/大小，daily 缺失或过期变红并给命令。来自 db_backup_last 设置，daily_at 是写入时磁盘最新 daily。
- `sudo felis db check` 失败退出 1；db list 显示全部年龄。
- 看门狗邮件通知。
- Prometheus 的 FelisDBBackupStale（严重）、FelisDBBackupMetricMissing（警告）读 felis_db_backup_last_success_timestamp_seconds。每日任务写至 FELIS_DB_BACKUP_METRICS，默认 `/var/lib/node_exporter/textfile_collector/felis_db_backup.prom`；node-exporter 的 textfile.directory 须指该目录，否则两小时后缺指标告警。

过期时检查：

```
sudo systemctl status felis-db-backup.timer          # enabled? next run?
sudo journalctl -u felis-db-backup -n 50 --no-pager   # why the last run failed
sudo systemctl start felis-db-backup.service         # run the daily backup now; clears the alarm
```

**缺 MinecraftServer 的包**仍保存数据库，但无法重建服务器。三次导出失败后命令先 wrote 再退出 1，timer 失败；卡片为黄色不完整并给原因/命令。该包为最新时看门狗报告 lacks the MinecraftServer objects；verify、offsite list/fetch-db 也注明。pre-migrate/pre-restore 同样可不含 CR，不阻止升级/恢复，因为回滚数据库不需要 CR。异地同步在世界归档后创建的包则拒绝不完整，下次重试。集群可回答 get minecraftservers -A 后手动备份。[GO-TESTED：dbbackup、CLI、watchdog、DBBackupCard.test.tsx。]

常见失败：Postgres 未运行（下节）、PATH 无 k3s、备份盘满（删除 partial，旧包保留）、外部数据库比主机 pg_dump 新导致 server version mismatch（安装匹配客户端）。

### felis-postgres 未运行或无法就绪 {#felis-postgres-is-not-running-or-never-became-ready}

安装器十分钟未就绪则停止，提示 felis-postgres did not become ready 并打印事件。检查：

```sh
sudo k3s kubectl -n felis get pods -l app.kubernetes.io/component=postgres -o wide
sudo k3s kubectl -n felis describe deploy/felis-postgres | tail -n 30
sudo k3s kubectl -n felis logs deploy/felis-postgres --tail=60
```

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| postgres 拉取失败 | Docker Hub 不可达且无缓存 | §8e 隔离节点平台镜像 |
| CreateContainerConfigError、Secret felis-postgres 不存在 | 超级用户 Secret 丢失 | 重跑创建；镜像仅初始化集群时读取，安装器/db 经 Pod socket 连接 |
| /var/lib/postgresql/18/docker Permission denied | hostPath UID 999 或 SELinux container_file_t 丢失 | 重跑修复；手动 chown -R 999:999 /var/lib/felis/postgres，restorecon -R 同路径 |
| database files are incompatible with server | 不同 major 创建的集群 | 运维 §4 的大版本升级 |
| Pending、Insufficient memory | 节点资源满 | §13b |

Pod 内通过 socket 以超级用户查询：

```sh
sudo k3s kubectl -n felis exec -it deploy/felis-postgres -c postgres -- psql -U postgres felis
```

迁入 k3s 前的宿主机副本仍保留，回退见运维 §4。

### 检查备份包 {#check-a-bundle}

```
sudo felis db verify felis-db-20260924T033012Z-daily.tar   # bare names resolve in the backup dir
sha256sum -c felis-db-20260924T033012Z-daily.tar.sha256    # on a copy, without felis
```

verify 检查旁边校验文件、manifest 各成员、无缺失或未列成员、manifest 位于首项，不操作数据库。

### 在原主机恢复（撤销误操作） {#restore-on-the-same-host-undo-a-mistake}

```
kubectl -n felis scale deployment felis-api felis-operator --replicas=0
sudo felis db restore -yes felis-db-20260924T033012Z-daily.tar
sudo felis migrate up -config /etc/felis/felis.host.toml
kubectl -n felis scale deployment felis-api felis-operator --replicas=1
```

- 不带 yes 只打印内容并退出 2。
- 存在其他连接时拒绝并打印缩容命令；force 可覆盖已知空闲连接。
- 在单事务内删除 felis 角色拥有内容并重放 dump，**任何失败回滚，数据库保持原样**，输出 psql/pg_restore 错误。[PG-TESTED]
- pre-restore 包保留恢复前数据库，恢复它可撤销本次恢复。
- migrate up 将旧包 schema 升到运行版本；启动时不自动迁移。只有回退到创建包的旧版时跳过，见下节。
- 只替换数据库，不改变世界 PVC 或归档；备份后新建的服保留卷但失去归属行。

### 回滚损坏数据库的升级 {#roll-back-an-upgrade-that-broke-the-database}

迁移只向前，回退用升级前 pre-migrate：

```
kubectl -n felis scale deployment felis-api felis-operator --replicas=0
sudo felis db list | grep pre-migrate                  # newest one is the upgrade's
sudo felis db restore -yes <that bundle>
kubectl -n felis rollout undo deploy/felis-api
kubectl -n felis rollout undo deploy/felis-operator
kubectl -n felis scale deployment felis-api felis-operator --replicas=1
```

此时**不要 migrate up**，主机仍是新版，会重新应用迁移。随后用同标签安装器和附件安装旧版：

```
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/v1.2.3/deploy/bootstrap.sh \
  | sudo FELIS_RELEASE=v1.2.3 bash
```

FELIS_RELEASE 显式选择旧发布版，避免又装最新并迁移。不能与 REF、ARTIFACT_DIR、SKIP_FETCH、dev 混用；未发布标签在任何修改前停止。[SH-TESTED] 早于该变量的安装器会忽略它，`curl -fsSL <URL> | grep -c FELIS_RELEASE` 为 0；改用 FELIS_REF=v1.2.3 从源码构建，较慢且需 §15c 资源。

### 整机灾难恢复：恢复内容及其来源 {#whole-host-disaster-recovery-what-comes-back-and-from-where}

主机/磁盘丢失后，从异地桶加全新安装恢复：

| 数据 | 主机位置 | 异地副本及恢复方法 | 最多损失 |
| --- | --- | --- | --- |
| 控制面数据库 | felis-postgres、/var/lib/felis/postgres | 各备份包一小时内复制，世界归档复制后再创建新包；fetch-db、db restore | 最新包后变化，默认一天加一小时 |
| 主机机密/配置/证书 | /etc/felis | 每包 state，tar 解出 | 同数据库 |
| MinecraftServer | k3s | 每包 k8s/minecraftservers.json，kubectl apply | 同数据库 |
| 世界归档（回收器、定时恢复点、立即备份、恢复前快照） | felis-backups 卷 | 一小时内复制，随后备份索引；fetch-worlds | 最近一小时归档 |
| 实时世界 | world-* 卷 | **仅归档**，从最新归档恢复 | 该世界最新归档之后全部变化 |
| 用户镜像 | registry 卷 | 每小时复制，镜像列表保留 14 天；fetch-images | 最近一小时推送 |
| 投稿上传 | felis-uploads 卷 | 每小时复制，列表保留 14 天；fetch-uploads | 最近一小时上传 |
| Cloudflare 连接器 | 配置、root 的登录证书/隧道凭证、unit | 配置入包，证书/凭证/unit 不复制；setup 的 Cloudflare 步骤重建 | 无，隧道/DNS/Access 在 Cloudflare |
| 平台镜像、代理、JRE、构建工具 | registry、/opt/felis | 不复制，安装器重新获取/构建和推送 | 无 |
| k3s 令牌/CA/存储/Secret/Deployment | /var/lib/rancher/k3s | 不复制，安装器新建单节点并从 /etc/felis 渲染 | 无 Felis 数据仅存在此处 |

**实时世界是缺口**。世界的当前状态只存在于其卷中；桶中只有回收器、定时恢复点、所有者立即备份或恢复前快照写入的归档。运行中的世界同样生成定时恢复点（§10），因此自上次恢复点后有人游玩的世界，通常有一份不早于 `scheduled_every`（默认一天）的恢复点。从未归档的世界恢复后为空。提醒所有者重要操作前备份，以备份页最新归档年龄为实际恢复点。

可缩短 FELIS_DB_BACKUP_TIME，如 `*-*-* 00/6:30:00` 每六小时，并配套 KEEP，每次安装都传入；异地复制一小时内收取。

恢复时间主要由传输决定：全新安装获取或构建平台镜像、数据库恢复数秒至数分钟，三个 fetch 按桶带宽移动 status 列出的镜像/上传/归档，跳过已存在项，可中断恢复。记录大小和下载速度，按每个发布版在备用机演练确认。备用机运行不带 `-take-over` 的 `felis restore-host`（下一节），或按下文手动步骤执行并跳过第 8、11 步，识别原主机后待机，不写/清桶，原主机持续写时不向其所有者发信。不能接入生产隧道，否则分担真实流量；通过自身地址访问（第 10 步）。

顺序必须保持：先恢复 state 使安装器复用机密/桶；先镜像后数据库，在清理器 24 小时宽限内恢复引用；CR 与所属数据库一同恢复；再恢复世界。移域名前检查邮件，因 Passkey 可能失效；域名在 CR apply 后更换，以更新登录服环境。

### 在新主机重建（原主机已丢失） {#rebuild-on-a-new-host-the-old-one-is-gone}

需要异地副本或自行拷出的包，桶副本还需加密密钥。

**一条命令完成：`felis restore-host`**。有异地副本时，安装器可自行重建全新主机。提供原安装的桶、凭证和密钥（原安装设置过 `FELIS_OFFSITE_REGION`、`FELIS_OFFSITE_PREFIX` 时一并提供），并请求重建：

```
FELIS_OFFSITE_ENDPOINT=https://s3.example.com FELIS_OFFSITE_BUCKET=felis-backups \
FELIS_OFFSITE_ACCESS_KEY=... FELIS_OFFSITE_SECRET_KEY=... FELIS_OFFSITE_KEY=... \
FELIS_RESTORE_FROM_OFFSITE=1 FELIS_RESTORE_TAKE_OVER=1 \
  bash deploy/bootstrap.sh          # or the curl | sudo bash one-liner
```

安装器在修改主机前先检查请求：缺少上述五个 `FELIS_OFFSITE_*` 值中的任一项时拒绝 `FELIS_RESTORE_FROM_OFFSITE=1`；在已安装 Felis 的主机上同样拒绝（`sudo felis restore-host -yes -force` 会替换此类安装的数据）。`FELIS_RESTORE_BUNDLE` 指定比最新包更早的包（`felis-db-<stamp>-<label>.tar`，见 `felis offsite list`）。演练机不要设置 `FELIS_RESTORE_TAKE_OVER`。安装完成后、输出摘要和打开 setup 控制台之前，安装器运行 `felis restore-host -yes`（根据上述变量附加 `-bundle` 和 `-take-over`），因此 setup 控制台能找到原安装的 Owner。重建中止时，安装器提示 `the rebuild stopped before it finished; fix the cause above and run: sudo felis restore-host -yes`；该命令从中止处继续（安装器带有 `-take-over` 时一并添加）。

已安装、`[offsite]` 配置指向原桶且尚无服务器的主机，可直接以 root 运行该命令：

```
sudo felis restore-host                      # the steps; nothing changes
sudo felis restore-host -yes                 # rebuild, leaving the bucket to the old host
sudo felis restore-host -yes -take-over      # rebuild, then make this host write the bucket
```

它按下文编号步骤执行至接管桶为止，每步运行该步骤所列的命令：

| `restore-host` 步骤 | 作用 | 对应手动步骤 |
| --- | --- | --- |
| `fetch_db` | 用 `felis offsite fetch-db` 将最新包（或 `-bundle <name>`）取到 `/var/lib/felis/restore-host` | 1 |
| `images` | `felis offsite fetch-images` | 4 |
| `uploads` | `felis offsite fetch-uploads` | 5 |
| `database` | 将 felis-api 和 felis-operator 缩至 0，执行 `felis db restore -yes -no-safety-backup`、`felis migrate up`，再恢复两者并最多等待 felis-api 5 分钟 | 6 |
| `servers` | 应用包中的 `k8s/minecraftservers.json`：仅用户服务器（新安装已自行创建登录服和大厅），每台均为 `Stopped`，并去除原集群的节点分配、卷声明名称、锁和进行中标记 | 6 |
| `worlds` | `felis offsite fetch-worlds` | 7 |
| `restore_worlds` | 通过 felis-api 为每台恢复的服务器恢复最新的完好备份，并等待其恢复 Job（每台最多 2 小时）；无备份的服务器保持空世界 | 7 |
| `take_over` | `felis offsite take-over -yes`，仅在指定 `-take-over` 时执行 | 8 |

- **可续跑**。每步完成后记录在 `/var/lib/felis/restore-host/state.json`，中途中断的运行（SSH 断开、桶超时）可从中止处继续。数据库只恢复一次：重跑不会再次恢复数据库，以免覆盖重建后的安装此后写入的内容。首次运行获取的包在后续运行中仍作为本次重建的包。
- **仅限全新安装**。数据库步骤前，若数据库已有服务器则拒绝；`-force` 会覆盖恢复。
- **失败的世界会重试**。恢复失败的服务器连同原因列出，该步骤失败；下次运行只重试尚未恢复的服务器。
- **主机状态保持本机所有**。它不放回旧 `/etc/felis`（第 2 步）：安装器已生成新机密，本机保留自己的根域名、`[smtp]` 中继、上传桶密钥和隧道配置。Owner 在面板保存的邮件中继、保留策略或心跳随数据库恢复。如需同时复用原主机状态，先按第 2 步放回，再带上述变量运行安装器。[CODE-ONLY]
- **运行结束时**输出每台服务器的世界来自哪份备份，以及剩余的手动步骤：第 9 步（邮件）、第 10 步（将域名指向本机并执行 `felis domain set`；或保留本机地址，此时在旧地址注册的 Passkey 失效，用户需通过邮件验证码登录并重新注册）、第 11 步（Cloudflare 隧道），未指定 `-take-over` 时还有第 8 步。接管后执行 `sudo systemctl start felis-offsite.service`，可在每小时定时器之前发送本机的首份副本。

参数：`-yes`（不加时只打印步骤，不做任何修改）、`-bundle <name>`、`-take-over`、`-force`、`-dir`（默认 `/var/lib/felis/restore-host`）和 `-config`（默认 `/etc/felis/felis.toml`）。数据库尚未恢复时，以不同的 `-bundle` 重跑会获取并使用该包；数据库恢复后，运行会拒绝并指出数据库来源的包（删除 `/var/lib/felis/restore-host/state.json` 可重新开始）。[GO-TESTED: `TestRestoreHostRunsTheRunbookOnce`, `TestRestoreHostTakesTheNamedBundle`, `TestRestoreHostResumesAfterAFailure`, `TestRestoreHostRefusesAnInstallWithServers`, `TestRestorableServersCleansTheOldCluster`, `TestNewestBundleAndBundleEntry`, `TestInternalRestoreRebuildsAWorld`] [SH-TESTED：安装器对 `FELIS_RESTORE_*` 变量的检查，`deploy/bootstrap_test.sh`] [CODE-ONLY：在真实主机上通过安装器完成整机重建]

**手动执行**。编号步骤是 `restore-host` 所执行操作的参考，也用于在没有桶时从原主机拷出的包重建，以及完成该命令未能完成的步骤。

1. 用相同或更新发布版的任意 felis 二进制（release 的二进制可单独运行），在能访问桶的机器获取最新包：

   ```
   export FELIS_OFFSITE_ACCESS_KEY=... FELIS_OFFSITE_SECRET_KEY=... FELIS_OFFSITE_KEY=...
   sudo -E felis offsite fetch-db -endpoint https://s3.example.com -bucket felis-backups \
        [-region ...] [-prefix ...] latest
   ```

   默认写 /var/lib/felis/db-backups，dir 可改；自动 verify 并显示时间、发布/schema、账号/服务器数，继续前核对。密钥错误提示 object does not decrypt with this key，已有记录时注明两密钥 ID，不写文件。自行复制的包用 sha256sum -c 检查。

   latest 默认最新，但若最新无服务器且最多一个账号，而旧包更多，则拒绝并列最多三个旧包。此情况常来自新主机在恢复前接管后上传的空库。用具体名称获取，offsite list 显示数量；按名取疑似空安装包会警告，旧版未记录数量显示 not recorded。

2. **安装前**放回旧 state，复用 DB 密码、调用方/转发令牌、邮件/上传密钥和 offsite.env：

   ```
   sudo install -d -m 0700 /etc/felis
   sudo tar -xpf felis-db-....tar -C / --strip-components=1 state/etc/felis
   ```

3. 按全新主机安装。包不含 bootstrap.done，创建用旧密码的空库并迁移；发现恢复配置的 offsite 后开启每小时复制，但识别另一写桶主机，保持待机，提示 OFF-SITE COPY ON STANDBY，直到第 8 步不写桶。

4. 恢复用户镜像：

   ```
   sudo felis offsite fetch-images
   ```

   默认最新镜像列表，at 可指定旧时间；以 platform 经回环端口，按摘要验证清单/层，只推缺失项。视为新推送，保留 24 小时，须在窗口内恢复数据库和白名单引用。

   若新主机已接管并记录空仓库，fetch-images 拒绝最新空列表并提示 at 版本；fetch-uploads 同理。

5. 恢复投稿上传：

   ```
   sudo felis offsite fetch-uploads
   ```

   按最新或 at 指定的列表写入 felis-uploads，使用控制面 UID，逐个核对 sha256，已存在者不动。

6. 恢复数据库和服务器：

   ```
   kubectl -n felis scale deployment felis-api felis-operator --replicas=0
   sudo felis db restore -yes -no-safety-backup /var/lib/felis/db-backups/felis-db-....tar
   sudo felis migrate up -config /etc/felis/felis.host.toml
   kubectl -n felis scale deployment felis-api felis-operator --replicas=1
   tar -xOf felis-db-....tar k8s/minecraftservers.json | kubectl apply -f -
   ```

   tar 报 Not found in archive，表示包没有 CR，fetch-db 已提示。选 offsite list 中最新且没有 no MinecraftServer objects 的包，仅从它 apply CR；其未列服务器无法恢复。

7. 恢复世界归档：

   ```
   sudo felis offsite fetch-worlds
   ```

   根据恢复的 world_backups 索引获取缺失归档，尚无备份卷时通过短期 felis-bind-felis-backups-* Pod 创建。列出桶中找不到的项。之后正常从归档恢复世界（§10、§13）。最新包索引覆盖桶归档，旧包未列后续归档，超过最长保留期限后同步会删除它们。

8. 接管桶并发送首份副本：

   ```
   sudo felis offsite take-over          # names the host the bucket names now
   sudo felis offsite take-over -yes
   sudo systemctl start felis-offsite.service
   ```

   无 yes 仅显示原主机及最近写入，退出 4；加 yes 记录当前主机，旧主机再运行也不写桶并提示被接管。**演练机跳过**。

9. 验证邮件。setup 状态页按 e，保存预填中继，重新输入密码（不显示存储值）；自测发至 From，未成功不写配置。按地址允许发件或 SPF 指旧 IP 时，先加入新地址，否则拒绝或进垃圾箱。Owner 在面板保存的中继已在第 6 步随数据库恢复，并处于生效状态；保存 setup 邮件页会以其中输入的中继替换它（§17）。面板可访问后，应改在「平台设置 → 邮件服务」使用「发送测试邮件」检查该中继。无中继且所有者无法登录时用 breakGlass（§17）。下一步可能使 Passkey 失效，邮件是恢复入口。

10. 域名仍指旧地址时迁移。安装器保留备份中的根域名，日志 reusing the installed domain。

    默认 `<旧地址>.nip.io` 必须更换：

      ```
      sudo felis domain set <new-address>.nip.io       # the plan
      sudo felis domain set -yes <new-address>.nip.io
      sudo felis domain check
      ```

    此步骤在 CR apply 后，以同步登录服 env。计划显示失效 Passkey 数，用户通过邮件登录再注册，其他影响见运维 §6。

    自有域名保留，修改 root、通配符、console、op.console 记录；隧道提供面板时只需改 root 和通配符。dig +short 逐项确认，domain check 只检查可解析，不要求特定 IP。计划迁移可提前降低 TTL。

11. 恢复 Cloudflare 边缘。包含 cloudflared.yml，但 root 登录证书 cert.pem、隧道 JSON、unit 未备份；无连接器时面板域名返回 1033。

    setup 状态页按 n，选 Tunnel + Access；首屏 i 安装 cloudflared，l 执行 tunnel login，经浏览器账号授权生成 cert.pem，两者齐全后回车打开表单。输入 API token、account ID、原允许身份/域名/隧道名。域名来自恢复配置，隧道名默认 felis；其他名称可根据 cloudflared.yml 的 tunnel ID 在 Zero Trust → Networks → Tunnels 查询。

    向导按名称复用隧道并取回凭证，指向面板 DNS，复用 Access 应用使 audience 不变、重写策略，安装启动 cloudflared-felis，确认隧道可用后关闭 NodePort。若保留旧隧道 JSON，可先以 0600 放回 root 的 .cloudflared，仍需 cert.pem。改名称会新建隧道并使旧隧道闲置，随后在控制台删除旧项。**演练机跳过**。

放行玩家前验证：

```
sudo felis db check                     # the database answers and has a fresh bundle
kubectl get minecraftservers -A         # every server the bundle held
kubectl -n minecraft get pods           # servers pull their pinned images (no ImagePullBackOff)
sudo felis offsite status               # the hourly copy runs from this host again
sudo felis domain check                 # every name, the certificate and the tunnel on the new address
```

演练机从隧道安装恢复并改为 nip.io 时，tunnel 检查因仍路由生产域名失败，属于预期。

通过面板域名检查：旧账号登录；除迁域名失效者外 Passkey 随数据库恢复。再退出，用自己能收信的所有者邮箱验证码登录，证明 API 到外部收件箱的真实投递；setup 自测仅证明控制台到 From 地址。码不来见 §17。检查归档列表，恢复最新世界、启动，并以 `<name>.<root>` 加入。

### 保存异地副本 {#keep-a-copy-somewhere-else}

同盘数据库包只防误操作/坏升级，同盘世界归档只防删服，均无法承受磁盘丢失；用户镜像和投稿也一样。异地复制将四类数据在主机加密后送到 S3 兼容桶（AWS、R2、B2、MinIO 等）：

```
FELIS_OFFSITE_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
FELIS_OFFSITE_BUCKET=felis-backups \
FELIS_OFFSITE_ACCESS_KEY=... FELIS_OFFSITE_SECRET_KEY=... \
  bash deploy/bootstrap.sh          # or the curl | sudo bash one-liner
```

可选 REGION、PREFIX（同桶多安装）、DB_KEEP（默认 30）。安装器写 offsite 配置，将凭证及生成的密钥存入 0600 offsite.env，**仅在终端显示密钥一次**，不进入 tee、cloud-init、CI 日志；无终端时提示读取命令。请存密码管理器，桶只有加密对象，无密钥不可读。重跑保留原密钥，拒绝与文件不同的 FELIS_OFFSITE_KEY。无桶提示 NO OFF-SITE COPY。旧安装器曾因读 offsite 的管道竞争误删 timer，重跑当前版修复；list-timers 检查。[SH-TESTED；VM-TESTED：竞争失败重跑。]

明文 felis-key-id 仅记录密钥 ID，不泄露密钥。首次同步写入，旧桶以是否能解最新对象判断。安装器 check-key、每次 sync 先检查。密钥不匹配时，在任何复制或清理前停止，安装结束 OFF-SITE COPY STOPPED，status 退出 1，看门狗立即通知。将 offsite.env 的 KEY 恢复为桶密钥并启动 service，或换空桶/前缀重跑。[GO-TESTED: `TestSyncRefusesAnotherKeysBucket`, `TestCheckKey`；SH-TESTED；VM-TESTED：MinIO 拒绝错误密钥且桶不变、check-key 0/3、fetch-db 显示 ID。]

明文 felis-writer 记录写入主机 ID、名称、最近同步。主机 ID 在 `/var/lib/felis/offsite/host-id`，不入备份。重建机有凭证却无原 ID，发现另一写入者即待机，不复制不清理，status 退出 1；原主机三小时内活跃则抑制邮件，超过后通知待机不复制。含加密对象却无 writer 的桶也待机，旧版曾写过的主机在下一次同步可认领。take-over 无 yes 只显示，加 yes 改为本机；原主机下次停止复制、status 1、立即通知。演练误接管时，在生产执行 take-over -yes 收回。[GO-TESTED: `TestLeasePlan`, `TestSyncStandsBy`, `TestOffsiteTakeOver`, `TestRestoredHostKeepsStandingBy`；SH-TESTED；VM-TESTED：MinIO 待机、接管、旧主机被替换后收回及旧版认领。]

运行内容：

- timer 每小时 sync，随机最多十分钟、Persistent=true。复制 offsite_at 为空的归档并记录，复制桶缺少的最新 db_keep 个包并清旧包；记录已删且 expires_at 过期的归档从桶删除。正确大小的现存对象直接记已复制，中断可继续。[GO-TESTED: internal/offsite]
- 复制世界归档后创建 fresh offsite 包，布局同 daily，state-dir 默认 /etc/felis，然后上传，保证桶最新索引列全归档。本地保留一份，桶仅保留最新 offsite；db_keep 只数其他标签，繁忙快照不挤掉 daily。未复制或最新包已晚于复制时不创建。面板仍检查 daily timer。[GO-TESTED: `TestOffsiteSyncerSnapshotsAndSweeps`；PG-TESTED]
- 无数据库记录的桶归档，超过 archive 各 retention 中最长者后清理；年轻者保留并日志说明。数据库完全无归档时跳过清扫，避免未恢复就删桶。[GO-TESTED]
- 用户镜像复制仓库全部 felis/、mirror/ 之外的清单和层，经回环读取，共享层只保存一次。平台路径只复制服务器/白名单按摘要固定的修订，不复制标签，恢复不覆盖新安装标签。镜像集合变化生成新版列表；被替代超过 14 天的列表及仅其引用层清理，因此误删镜像两周内可 fetch-images -at。途中丢失清单保留旧副本，status 标 not whole。默认 registry.url，registry 参数可改，off 跳过。[VM-TESTED：16 镜像、638 MiB，同摘要恢复空仓库。]
- 上传复制 felis-uploads 的 sub-*/context.tar.gz，重复内容只存一次，列表同样保留 14 天，可 at。只有大小/修改时间变化才重读；适用于本地 user_uploads_context，uploads-dir 可手动指定，uploads-pvc 空值跳过。[VM-TESTED：17 上传、10 对象、200 MiB，逐字节相同。]
- 对象路径为 worlds/`<archive>`.fenc、db/`<bundle>`.fenc、registry/blobs 与 manifests/`<sha256>`.fenc、registry/index/`<stamp>`.json.fenc、uploads/blobs/`<sha256>`.fenc、uploads/index/`<stamp>`.json.fenc。AES-256-GCM 以 64 KiB 分段，拒绝截断、重排、错密钥；只有 key-id/writer 明文。
- 顺序是数据库包 → 世界归档 → 包含新索引的包 → 镜像 → 上传。每对象期限十分钟加按 512 KiB/s 计算的大小时间，10 GiB 约六小时。超时仅该对象失败，下次重试，其他仍继续；大归档可能使一次同步运行数小时，timer 不启动第二次。单对象中断从头传。[GO-TESTED]
- 回收器须确认桶归档后才删空闲世界（§10）。
- 十二小时未完成同步则通知；密钥拒绝或桶被接管立即通知。

检查：

```
sudo felis offsite status        # last run, errors, what the bucket holds, what waits
sudo felis offsite list          # the bundles, image lists and upload lists in the bucket, newest first
sudo felis offsite check-key     # whether offsite.env holds the key the bucket was sealed with
sudo journalctl -u felis-offsite -n 50 --no-pager
sudo systemctl start felis-offsite.service   # run one now
```

status 十二小时无成功退出 1。missing 表示数据库有记录但本地卷无文件，没有数据可复制。

换桶时修改 host.toml 的 offsite 及 offsite.env 凭证，再重跑；关闭则删配置节再重跑。跨桶保持同密钥可读取旧副本。

没有桶时自行定期 `rsync -a root@felis-host:/var/lib/felis/db-backups/ /backups/felis-db/`，连同 sha256 并在目标校验；仅覆盖数据库。世界归档位于 storage 的 felis-backups 卷目录，镜像在 *_felis_registry，上传在 *_felis_felis-uploads。

### `FELIS_PRE_MIGRATE_BACKUP=0` {#felis-pre-migrate-backup-0}

跳过迁移前快照（migrate up -no-backup），安装器显著警告。只有快照无法工作且有其他备份时使用，例如外部数据库比主机 pg_dump 新。


## 17. 登录被拒绝：429 限流、邮件不可用、验证码锁定与登录失败 {#_17-sign-in-refused-429-limits-no-mail-relay-account-code-locks-failed-sign-ins}

公开登录端点（auth/*，退出和管理登录状态轮询除外）有三项限制，均返回 429、Retry-After 和独立错误码。需发码的端点在无中继时还返回 503 mail_unavailable。

### `rate_limited`：同一地址请求过于频繁 {#rate-limited-one-address-called-the-doors-too-often}

每客户端地址共享 20 次突发、每分钟补充 20 次，覆盖全部登录端点。一次登录三四个请求，通常只影响脚本。IPv6 同 /64 共用限制。计入 felis_rate_limited_total{scope="auth_door"}，每分钟拒绝超过十次、持续十分钟触发 FelisSignInFlood。

地址来自 auth.client_ip_header：

- Cloudflare 使用 CF-Connecting-IP，边缘设置写入，access_jwt_aud 配置隐含此值。NodePort 限回环使所有流量来自 cloudflared，才能信任该头。
- 自有反代用 X-Forwarded-For 最右一项，即代理追加项；防火墙必须仅允许代理到达 NodePort，否则直连可伪造地址。
- 未设置则使用 TCP 对端；反代后所有用户共用代理 IP，导致**所有人同时限流**。启动日志 sign-in rate limit keys on 表明来源。同步主机和 Pod 配置后执行 converge。

### `mail_rate_limited`：整个安装的邮件额度已耗尽 {#mail-rate-limited-the-install-wide-mail-budget-is-spent}

API 的验证码及通知共用 smtp.max_per_hour 或面板保存的中继的「每小时发信上限」，默认 120，最多四分之一可突发，防止耗尽中继配额或封号。耗尽时全部地址返回同样 429，不到达中继。felis_mail_total{result="throttled"} 计拒绝，首项触发 FelisMailBudgetExhausted。先查限流指标是否洪水，真实登录需求可按中继额度提高。

中继实际拒信为 result=failed、调用方 502 mail_undeliverable，触发 FelisMailDeliveryFailing，API 日志有中继原因。

### `mail_unavailable`：未配置邮件中继 {#mail-unavailable-no-mail-relay}

面板和 `[smtp]` 均未配置中继时，邮件登录、管理控制台登录、邮箱验证、敏感变更/迁移的邮件二次验证，均在生成码前返回 503 `mail_unavailable`。公开端点在查询邮箱前返回，避免泄露账号。只能 Passkey 登录，已验证邮箱也不作为重新验证方式。验证码绝不写日志。要开放这些端点，可在面板「平台设置 → 邮件服务」卡片保存中继（下一节），或运行 setup 配置邮件。felis.toml 没有 `[smtp]` 时，`felis api` 启动时会说明，并指出使用的是面板中继；面板是否已保存中继，可在「邮件服务」卡片查看。

### 面板中设置的邮件中继 {#the-mail-relay-set-in-the-panel}

Owner 可在面板「平台设置 → 邮件服务」卡片配置中继。它存于 `platform_settings` 的一行（`smtp`），所有发信方都读取它：felis-api（登录码、验证、二次验证码和通知）、回收器的删除前提醒（§10）、看门狗告警（§14）和应急控制台的验证码（下文）。没有该行时，各方回退到 `felis setup` 写入 felis.toml 的 `[smtp]` 中继。在面板保存后，它无需重启即在各处优先生效：felis-api 最多每 15 秒读取一次该行，回收器、看门狗和应急控制台在下次运行时读取。卡片显示当前生效的中继来源：「面板设置」、「安装时的设置」或「未配置」。

- **保存前先验证中继**。「检查并保存」向发件地址发送一封自检邮件，中继接受后才保存；该检查不可跳过，因为静默失败的中继会使用户无法登录。「发送测试邮件」（`POST /api/v1/settings/smtp/test`）通过当前输入的中继（无论是否已保存）向 Owner 的已验证邮箱发送一封邮件（无已验证邮箱时发至发件地址），并消耗上文的全安装邮件额度。失败时指明所处阶段：`smtp_unreachable`、`smtp_tls`、`smtp_auth`、`smtp_sender_refused`、`smtp_recipient_refused`，其余为 `smtp_failed`。中继返回的原文只写入 felis-api 日志，因为其中可能包含内部地址。
- **卡片接受的取值**。端口仅限 25、465、587 和 2525：felis-api 从集群内部连接中继，其他端口会使检查变成对内部服务的探测。发件人只能是纯地址，不含显示名称。「要求加密连接」（默认开启）拒绝 465 以外端口上不提供 STARTTLS 的中继，本机中继也没有豁免。「每小时发信上限」替代 `[smtp] max_per_hour`（0：使用默认值 120）。felis-api 拒绝连接链路本地、未指定或组播地址（在 DNS 解析后检查），因此中继设置无法访问云元数据地址（169.254.169.254）；此类中继返回 `smtp_unreachable`。
- **密码**永不返回面板（卡片只显示已保存，留空即保留原值），也不写入审计日志。它保存在数据库行中，因此随数据库备份包及其加密的异地副本一并保存（§16）。
- 「恢复为安装时的设置」清除该行，将中继交还 felis.toml。setup 控制台的邮件页每次保存时也执行同样操作，因此其中输入的中继即为生效的中继。
- 保存、清除和测试均需重新确认身份；卡片加载后中继已被修改时，保存返回 `409 mail_settings_changed`。审计操作为 `smtp.updated` 和 `smtp.cleared`。API：`GET`、`PUT`、`DELETE /api/v1/settings/smtp`，以及 `POST /api/v1/settings/smtp/test`（Owner）。
- `sudo felis doctor`、`felis setup` 卡片的 `alerts` 行和安装器结束摘要均计入面板保存的中继（安装器查询 `felis panel-settings`，它只输出是或否），仅当面板和 felis.toml 都没有中继时才报告缺失。[GO-TESTED: `TestDoctorCountsPanelSettings`, `TestHostAlertRoute`, `TestPanelSettingsSaysWhatThePanelHolds`] [SH-TESTED: `deploy/bootstrap_test.sh`]

[GO-TESTED: `TestMailSettingsReadShowsWhereTheRelayComesFrom`, `TestMailSettingsSaveChecksTheRelayAndOverridesFelisToml`, `TestMailSettingsRefusesAPortOffTheSubmissionList`, `TestMailSettingsClearHandsTheRelayBack`, `TestMailSettingsTestMailsTheOwner`, `TestMailSettingsOwnerOnly`, `TestRelayTestErrorCategories`, `TestValidateRefusesWhatCannotBeARelay`, `TestParseTreatsAClearedRowAsAbsent`, `TestRelayForPrefersThePanelRelay`, `TestPanelFirstRecoveryMailer`, `TestRefuseLinkLocal`]

### 邮件中继因缺少 TLS 被拒绝 {#relay-refused-for-lacking-tls}

465 从首字节使用 TLS，其他端口须 STARTTLS；不提供时失败 smtp: `<host>`:`<port>` does not offer STARTTLS，调用方 502，日志/向导显示详情，面板检查返回 `smtp_tls`。除本机 localhost、127.0.0.0/8、::1 外默认强制，避免途中读取码或剥离升级协商。使用 465 或支持 STARTTLS 的中继；可信链路可在两个配置的 smtp 中设 require_tls=false，重跑和向导保留，API 启动时警告。面板保存的中继改为在「邮件服务」卡片关闭「要求加密连接」；该设置对本机中继没有豁免，因此不支持 STARTTLS 的本地中继也需关闭此项。

### `otp_account_locked`：24 小时内输错验证码 10 次 {#otp-account-locked-ten-wrong-codes-in-24-hours}

同账号跨全部邮件码累计十次错误，锁定到首次错误后的 24 小时。公开登录返回与错误码相同回复，账号收到一次锁定邮件；已登录的邮箱验证/迁移验证返回 429 otp_account_locked。Passkey 不受影响。审计 auth.otp.locked，指标 felis_auth_otp_lockouts_total{purpose}，触发 FelisOTPAccountLocked。

确认是所有者误操作后，可提前解锁：

```sh
sudo k3s kubectl -n felis exec deploy/felis-postgres -c postgres -- psql -U postgres felis -c \
  "DELETE FROM otp_failure_windows WHERE user_id = (SELECT id FROM users WHERE username = '<name>');"
```

### 谁尝试过登录：审计记录 {#who-tried-the-audit-trail}

每个拒绝写 auth.`<door>`.failed，reason 为 bad_code、no_account、staff_account、not_staff、bad_assertion 等，并计 auth_failures；十五分钟超过 30 触发 FelisSignInFailures。每次限流突发首次拒绝写 auth.rate_limited 及来源。行有 actor_user_id（实际归因列）、client_ip、user_agent；actor 只是已验证邮箱或用户名的显示文字，不使用未验证输入。

```sh
sudo k3s kubectl -n felis exec deploy/felis-postgres -c postgres -- psql -U postgres felis -c "
  SELECT created_at, action, actor, client_ip, payload->>'reason' AS reason
  FROM audit_logs
  WHERE action LIKE 'auth.%' AND created_at > now() - interval '1 hour'
  ORDER BY created_at DESC LIMIT 50;"
```

审计写入失败不使业务失败，日志 audit: lost，计 felis_audit_write_failures_total，触发 FelisAuditWriteFailing，通常是 PostgreSQL 问题（§16）。

### 记录保留多久 {#how-long-rows-are-kept}

API 启动一分钟后及每六小时清理，日志 retention: pruned spent rows 按表统计：

| 记录 | 清理时间 |
| --- | --- |
| 会话 | 到期或退出后 30 天 |
| 邮件码、Passkey 挑战、setup 绑定、管理登录请求 | 到期或使用后 30 天 |
| /felis link 码 | 到期后 30 天 |
| 未完成账号迁移 | 最后步骤后 30 天，已完成保留 |
| otp_failure_windows | 开始后 30 天 |
| audit_logs | 超过 audit.retention 或面板保存的值 |

audit.retention 默认 365d，支持天、每月 30 天的 18mo、forever，不接受小于 30d。Owner 可在面板「平台设置 → 备份与审计保留」卡片覆盖该值（「审计记录保留天数」：0 保留全部记录，其余为 30 到 3650 天；见 §10「面板中设置的保留策略」），API 在下次清理时应用。数据库包在其保留期内仍包含旧行。需要长期保存时提前导出：

```sh
sudo felis db audit-export -until 2026-01-01 -out /root/audit-2025.jsonl
```

since/until 接受 UTC 零点日期或 RFC3339，区间左闭右开；每行 JSON、最旧优先。文件 0600，不覆盖已有文件。

### `felis breakGlass`：恢复码与 OVERRIDE [VM-VERIFIED] {#felis-breakglass-the-recovery-code-and-the-override-vm-verified}

有工作人员账号后，sudo breakGlass 询问管理员/所有者身份，通过与登录码相同的中继向其验证邮箱发六位码：数据库可访问时使用 Owner 在面板保存的中继，否则使用 felis.toml 的 `[smtp]`。十分钟有效，五次错误作废。使用 `[smtp]` 时，密码按 password_ref 环境变量 → 主机 smtp-password → Secret → 无 AUTH 读取；k3s 停止也可发，不受 API 邮件预算。正确码才以 recovery 归属账号，邮件注明主机/OS 用户，让未发起者知道 root 被他人使用。

其他结果要求输入 OVERRIDE 并说明原因：未知工作人员、无验证邮箱、无中继/读不到 Secret、拒信、过期、五次错误或主动跳过。Esc 重新开始并发新码；中继故障仍可未验证覆盖，但记录原因。

审计为 break_glass.recovery、root_override，新 Operator 账号为 operator_create，source=break-glass。仅码验证时 verified=true，并有 verified_by=email_otp、code_sent_to；覆盖记录 otp_skipped（unknown_admin、no_verified_email、no_relay、send_failed、code_expired、code_rejected、operator_skipped）及失败详情。root 可后改审计，因此只是归因记录，不是不可篡改证明。

```sh
sudo k3s kubectl -n felis exec deploy/felis-postgres -c postgres -- psql -U postgres felis -c "
  SELECT created_at, action, actor, payload->>'verified' AS verified,
         payload->>'otp_skipped' AS skipped, payload->>'otp_skip_detail' AS detail
  FROM audit_logs WHERE source = 'break-glass' ORDER BY created_at DESC LIMIT 20;"
```

### 可选：在边缘层配置 Cloudflare 限流规则 {#optional-a-cloudflare-rate-limiting-rule-in-front}

API 限制与边缘无关。Cloudflare 可在 Security → WAF → Rate limiting rules，为 console/op.console 的 URI Path 以 /api/v1/auth/ 开头的流量，按 IP 每十秒 30 请求，阻断十秒（原文使用 Free 计划限制）。

---

## 18. 服务器文件修改或上传被拒绝 {#_18-server-files-a-change-or-an-upload-is-refused}

文件页仅供所有者/管理员，须完全停服。读取会复用同一世界的只读 `felis files` Job，避免每打开一个文件夹或文件都启动 Pod。该 worker 通过现有内部 API、使用限定于该世界的随机令牌拉取命令；每个请求仍经过所有者/管理员和停服检查。worker 空闲 45 秒或累计运行四分钟后退出；每个 API 进程最多四个 worker，达到上限时改用一次性读取。不缓存任何文件内容。面板缓存目录列表 30 秒，刷新、写入、上传或恢复会使缓存失效。文本编辑器高亮常见配置格式并保留 CRLF；二进制文件和超大文件改为提供下载。

修改仍在 minecraft 运行一次性 Job，标签为 `app.kubernetes.io/managed-by=felis-files`，files-mode 为 list/read/write/mkdir/delete/rename/upload/unzip。读取和列表不持锁，全部修改持世界锁，唤醒或第二操作返回 maintenance_in_progress。面板逐个上传，期间禁用其他修改。

| HTTP | 错误码 | 含义与处理 |
| --- | --- | --- |
| 409 | not_stopped | Pod 仍在保存终止，等待服务器 Pod 不再存在 |
| 409 | maintenance_in_progress | 其他文件、备份、恢复或回收占用，见 §3b |
| 409 | file_exists | 新建/重命名/无覆盖上传路径已存在，改名或确认替换 |
| 409 | file_changed | 编辑后文件已变，加载最新或明确覆盖 |
| 400 | bad_path | 路径出卷（..、绝对路径、外指链接），移动受保护的 server.properties/config/paper-global.yml，或读取后者。名称保护避免机密泄露，paper-global.yml 含共享转发密钥 |
| 404 | not_found | 路径或父目录消失，刷新 |
| 413 | too_large | 读取超过 1 MiB、保存超过 256 KiB、单请求上传超过 64 MiB；大文件改整体上传，面板自动分片 |
| 411 | length_required | 上传无 Content-Length，使用面板或 curl -T |
| 400 | upload_incomplete | 正文少于声明长度，重试，原文件未改 |
| 507 | upload_staging_full | 暂存后空闲低于 10%，清理上传卷 |
| 507 | volume_full | 世界卷满，旧文件保持，清文件或扩卷 |
| 504 | files_timeout | API 等待超过 90 秒，Job 可能继续，见下文 |
| 503 | files_unavailable | 无 Job runner，或上传暂存目录/内部地址未配置，查启动日志 |
| 404 | upload_not_found | 会话取消、完成、空闲六小时或 API 重启，重新上传 |
| 409 | upload_offset_mismatch | 分片起点不同，面板查询偏移后续传 |
| 409 | upload_busy | 同上传另一分片仍在传，面板处理 |
| 413 | part_too_large | 超 32 MiB 或超声明总量，客户端错误，改用面板 |
| 409 | upload_incomplete | 尚未传齐便提交，客户端错误 |
| 429 | too_many_uploads | 账号已有四个大文件会话，完成/取消一个 |

**上传分两段**：浏览器至 API，暂存 `/var/lib/felis/uploads/.file-staging`，未挂上传卷时在临时目录 felis-file-staging。Job 用一次性令牌从 API 内部 file-uploads/`<id>` 获取，验证大小/sha256，再落盘。响应后删暂存，API 重启清空目录；获取失败或字节不匹配不改目标。日志：

```sh
kubectl -n minecraft get jobs -l felis.lolicon.best/server=<name>,app.kubernetes.io/managed-by=felis-files
kubectl -n minecraft logs job/<job>
```

**files_timeout 后** Job 可运行至自身两分钟期限并成功。结束前仍持锁，等待并刷新列表确认。完成后保留 Job/日志两分钟。

**超过 64 MiB 的文件**自动创建 files/uploads 会话，一次预留整文件暂存空间，不足则 507；发送 32 MiB 分片，避开 Cloudflare 100 MB，失败重试/按偏移续传，除空间无额外总量上限。途中启动服务器只影响提交，提交前须再次停服。commit 立即 202，后台 Job 最多两小时。会话绑定账号/服务器，空闲六小时删除；未获取全文件就失败的 Job 保留会话，可再次 commit，无须重传。目录应上传 zip，避免中断只留下半个世界。

**解压**仅 zip，先在归档旁 `.felis-unzip-*` 隐藏目录完整写入检查，成功才移入；失败不改目标并删临时目录。写前检查越界/链接（archive_unsafe、archive_symlink）、文件/目录冲突（type_conflict）、空间（volume_full）；声明大小不符为 archive_invalid。支持 Windows 中文 GBK 文件名。未允许覆盖而冲突时 file_exists，面板显示列表确认后带 replace 重试。

大上传/解压关页仍继续，files/ops 显示运行项及过去 30 分钟结果、字节进度；失败返回具体码或 job_failed/Job 条件，两小时为 DeadlineExceeded。Job 标 files-async=true，无结果失败日志保留 30 分钟：

```sh
kubectl -n minecraft get jobs -l felis.lolicon.best/server=<name>,felis.lolicon.best/files-async=true
```

**下载文件/目录**用 files/download 的 export Job，export-mode=files，只读读取或打 zip，由 API 流式输出。要求停服并持世界锁到结束。拒绝 paper-global.yml，目录压缩也排除；server.properties 隐去 rcon.password，按真实文件匹配保护链接。世界/备份导出同样过滤。每用户并行两个、全平台四个，每用户每小时 30，越限 429 export_busy。

审计 file.write/mkdir/delete/rename（to）、upload（size_bytes、sha256、overwrite）、unzip（overwrite）、download；server_name=`<server>`:`<path>`：

```sh
sudo k3s kubectl -n felis exec deploy/felis-postgres -c postgres -- psql -U postgres felis -c "
  SELECT created_at, actor, action, server_name, payload
  FROM audit_logs WHERE action LIKE 'file.%' ORDER BY created_at DESC LIMIT 20;"
```

[GO-TESTED: internal/fileedit、handlers_files_test.go、handlers_fileops_test.go、cmd/felis/files_test.go、TestExpireFileSessions、maintenance。VM-TESTED：带文件 Job 标签的 Pod 可到 API 内部接口；256 KiB 内容拆六变量通过真实二进制逐字节落盘，单 140 KB 变量会 argument list too long。API 上传两段端到端尚未在集群执行。]

---

## 19. 计划任务被跳过、漏执行或失败 {#_19-scheduled-tasks-a-run-is-skipped-missed-or-failed}

每服所有者/管理员最多 20 项计划任务，面板「计划任务」，API schedules。可每日定时或每 15 分钟至 12 小时，在所选星期和 IANA 时区（默认浏览器时区）执行控制台命令、重启、停止、启动、备份。重启/停服/备份可提前 1–30 分钟用 say 提醒。API 每 15 秒循环，时间误差约 15 秒；数据库将一次运行只分配给一个 API。

| 操作 | 运行中 | 停服中 |
| --- | --- | --- |
| command | RCON 执行，移除前导 / | 跳过 |
| restart | 停止 Pod 再启动 | 跳过 |
| stop | 停止 | 跳过 |
| start | 跳过，Failed 可重新开始 | 按面板启动，仍受容量/退役/世界占用限制 |
| backup | 执行不停服备份（§10），玩家保持在线，仅在复制世界期间暂停存档；无法执行时（游戏未响应控制台、世界被占用）停服、备份后重新启动 | 备份 |

不停服备份前的提醒会说明这一点（`A backup runs in <n> min; saving pauses for a few seconds`）；需停服的备份，其提醒说明服务器将暂停并在之后恢复。两种备份都记录为定时恢复点（`scheduled_keep`、`scheduled_retention`，§10）。

停服期限 15 分钟、备份 45、启动 15。重启/备份失败时，原本运行的仍尝试启动，避免失败备份让世界一直离线。

| last_result | 原因/last_detail | 处理 |
| --- | --- | --- |
| ok | 空或命令回复 | 无需处理 |
| skipped | 新所有者，与保存时不同 | 自动关闭任务，新所有者审阅并保存重新启用 |
| skipped | 无需运行：未运行/已停/已运行/无世界/退役/删除/不存在，或启动时容量/世界忙 | 下次继续尝试 |
| missed | 计划时间 API 未运行超过十分钟 | 丢弃此轮避免数小时后突然重启，下次正常 |
| failed | API 在首步中断，claim 超两分钟 | 检查服务器是否处于预期状态 |
| failed | 十五分钟未停 | 查 §1/§2，未执行备份 |
| failed | 世界被占十五分钟 | §3b |
| failed | 备份失败、超过 45 分钟或存储满 | §10 及备份页 Job |
| failed | 无法再次启动 | 容量、退役或世界忙超过十五分钟；修复后面板启动 |
| failed | 控制台不可达或命令失败 | RCON，§1c |

「立即运行」对关闭的任务也生效，不改变下次计划。run_state 为 claimed/stopping/backing_up/starting 时不能编辑、删除、重跑（409 schedule_running）。

夏令时跳过的时间按跳变前偏移，提前一小时执行；重复时间只在首次执行。未知时区退回 UTC。删服删除任务，相同名字重建不会继承。审计 schedule.create/update/delete/run_now（人工）、run（每个完成任务的结果/详情）。

[GO-TESTED: `TestScheduleNextRun`, `TestScheduleInputValidation`, `TestScheduleRunnerBackup`, `TestScheduleRunnerRestart`, `TestScheduleRunnerStaleClaim`, `TestScheduleRunnerBacksUpARunningServerLive`, `TestScheduleWarningSaysTheServerStaysUp`；PG-TESTED: `TestScheduleStoreRunCAS`, `TestDueSchedules`, `TestSchedulesFollowTheServer`]

---

## 快速索引：症状 → 章节 {#quick-reference-symptom-→-section}

| 症状 | 章节 |
| --- | --- |
| 查看运行状态、问题和诊断包 | §0 |
| 卡在 Starting | §1 |
| PodNotReady，镜像/PVC/启动问题 | §1a |
| RCON 密钥、认证、端口错误 | §1b、§1c |
| Failed | §2 |
| 玩家进入错误位置 | §3、§4 |
| 唤醒拒绝或 403/409/429/503 | §3a |
| maintenance_in_progress，恢复后不能启动 | §3b |
| 离线模式导致路由关闭 | §4 |
| 面板 401/403 | §5 |
| 本地密码拒绝 | §5c |
| 内部服务令牌 401 | §6 |
| 绑定/认领 400/409/412/403/404 | §7 |
| 构建目标/RBAC/网络/失败或执行器拉取问题 | §8、§8e |
| 仓库推送/拉取不可达 | §9 |
| 意外删世界或跳过备份 | §10 |
| 备份运行中的服务器、live_backup_console、玩家看到存档暂停 | §10 |
| 面板中设置的备份或审计保留、当前生效的值 | §10、§17 |
| awaiting_stop 持续、corrupt 损坏、orphan_archives | §10 |
| 备份/世界导出被拒或截断 | §10 |
| 自动停服不触发、玩家 0、PlayersCounted=False | §11 |
| 配置似乎无效 | §12 |
| 删除后 PVC 保留 | §13 |
| 磁盘满、驱逐、镜像拉取失败 | §13b |
| 指标采集 | §14 |
| 看门狗告警或不发邮件 | §14 |
| 主机失联未发现、NO HEARTBEAT、在面板中设置心跳 URL、failed unit、状态损坏 | §14 |
| Operator/API/LoginGate/ReconcileStuck 告警 | §14、§1、§2 |
| 控制平面升级/镜像回滚 | §15 |
| 镜像变更确认、仓库不可用、世界版本升级 | §15b |
| 数据库备份过期或从未备份 | §16 |
| pre-migration backup failed, nothing applied | §16 |
| 误操作后恢复数据库 | §16 |
| 丢主机，从数据库包重建；felis restore-host、FELIS_RESTORE_FROM_OFFSITE | §16 |
| Worker 节点离线导致其服务器停止；主控高可用 | [多机部署](/guide/distributed) |
| felis-postgres 未就绪或无数据库 Pod | §16 |
| 异地副本过期/未配置、awaiting_offsite 持续 | §16、§10 |
| 全部用户 rate_limited | §17 |
| mail_rate_limited、邮件预算告警 | §17 |
| 面板保存的邮件中继；smtp_unreachable、smtp_tls、smtp_auth、mail_settings_changed | §17 |
| 验证码正确却拒绝、otp_account_locked | §17 |
| 登录失败及来源 | §17 |
| 审计写入失败 | §17 |
| breakGlass 无码、Root override、otp_skipped | §17 |
| 会话/验证码/审计保留与导出 | §17 |
| 文件修改、上传、解压、容量、超时错误 | §18 |
| 计划任务 skipped/missed/failed 或易主后关闭 | §19 |

### 面板无法确认服务器状态与应急停止 {#panel-cannot-confirm-state-and-emergency-stop}

控制 API 超时或失联时，最后一次读取的状态仅作参考；显示「启动中」不能证明游戏进程仍然健康。控制台保留已有日志，标记状态已过期并显示最后读取时间，同时自动重试。首次读取失败时，也会向 Owner 提供主机侧恢复步骤。

普通停止由 operator 执行。Owner 可以在服务器控制台选择「更多操作 → 应急停止」，输入服务器名并重新验证身份。应急停止先持久保存 `desiredState=Stopped`，再通过 Kubernetes 的 scale 子资源将该 MinecraftServer 自己拥有的 StatefulSet 缩至零。它绕过游戏 RCON 和 operator，保留正常的 Pod 终止宽限期，且不删除世界。缩容失败时，已保存的停止意图不会撤销，界面明确提示结果未确认。请求被受理不代表游戏已停止：状态读取独立检查 StatefulSet 的副本目标和游戏 Pod，在副本目标仍大于零或游戏 Pod 仍在运行或退出时显示「停止中」。

控制 API 本身离线时，浏览器无法执行集群操作。Owner 可展开主机侧恢复步骤，在部署主机上依次保存停止意图、缩容并检查 Pod（命名空间不是 `minecraft` 时需替换）。节点离线时还需检查节点和容器运行时；强制删除 Pod 不能证明进程已经退出。不要通过强制删除世界、Pod 或 PVC 来解决控制端失联。应急停止所需的 Kubernetes 权限依赖新的 RBAC，随平台更新应用。
