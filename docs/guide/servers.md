---
title: 管理服务器
---

# 管理服务器 {#管理服务器}

* **按需启停**：玩家连接代理时自动启动目标服务器，启动期间玩家进入等待队列，服务器就绪后自动传送；服务器空闲后自动停止，释放内存。

* **Web 控制面板**：在浏览器中查看服务器状态、在线玩家与资源用量。
  * 控制台（RCON）、白名单、封禁、OP 与 LuckPerms 权限管理
  * 文件管理：新建、删除、重命名、分片上传、下载，以及停服状态下解压 zip，可用于导入世界
  * 计划任务：按星期与时区定时执行命令、重启、停止、启动或备份，执行前在游戏内向玩家发送提醒

* **多核心支持**：兼容 Paper、Fabric、Forge 与 NeoForge，统一经由 Velocity 代理接入。

* **模组包投稿**：玩家可上传模组包，经服主审批后自动构建并通过 Trivy 安全扫描；构建产物加入镜像白名单后，可直接选作服务器镜像。

## 12. 配置字段似乎没有生效 {#_12-a-configuration-field-seems-to-be-ignored}

以下字段都会被控制器读取。是否生效，取决于各自的触发条件。

| 字段 | 预期用途 | 实际行为 |
|---|---|---|
| `spec.startup.timeoutSeconds` | 启动失败前的时间限制 | 由 `startupTimedOut`（`reconciler.go:479`）读取，在 `:126` 调用。未设置或为 `0` 时默认 **300s**，超时后执行 `markFailed("StartupTimeout")` |
| `spec.startup.readinessTimeoutSeconds` | 首次探测的时间限制 | 由 `readinessTimedOut`（`reconciler.go:490`）读取，在 `:157` 调用。未设置或为 `0` 时默认 **300s**，超时后执行 `markFailed("ReadinessTimeout")`。它不同于探测器自身的 5 秒连接超时（`prober.go:45`） |
| `spec.idle.autoStopEnabled` | 自动停止无人服务器 | 在 `reconciler.go:175` 读取，但必须启用 `spec.rcon.enabled`，因为玩家数来自 RCON 探测（§11） |
| `spec.idle.emptySecondsBeforeStop` | 无人状态的宽限期 | 属于同一分支，必须 `> 0`；`0` 表示关闭，而非立即停服 |

两个启动时间限制都从同一个 `status.startRequestedAt` 开始计时。因此，`readinessTimeoutSeconds` 限制的是整个启动过程，并在 RCON 探测分支检查；它不是 Pod 就绪之后额外分配的时间。

---

完整的启动、连接、休眠和文件操作排查步骤见[故障排查](/operations/troubleshooting)。
