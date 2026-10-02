---
title: 集成边界
---

# 集成边界 {#deferred-integration-seams}

Go 源码中的 `INTEGRATION-ONLY` 和 `KNOWN-LIMITATION` 是可搜索的标记。本文汇总各标记当前的含义，免去从 34 处注释重新推导系统尚未完成的部分。

这些标记代表四种不同状态：尚无实现、已经实现但无法仅凭本仓库验证实际 I/O 等，共用相同标记容易混淆。此外，标记可能在问题解决后仍未更新；首次整理本文时，就有两处将已交付的功能描述成未来工作。

本文沿用 `internal/updater/doc.go` 的做法，按验证边界归类。测试全部通过，并不等于所有真实集成都已完成。

## 与故障排查文档中同名标记的区别 {#the-marker-collides-with-a-different-vocabulary-in-troubleshooting-md}

`docs/troubleshooting.md:19` 对 `[INTEGRATION-ONLY]` 的定义不同：症状来自 kubelet、Kaniko 或真实握手，无法在仓库内复现。那里的十二处标记说明故障来源，不代表未完成工作，本文不收录。搜索 `*.md` 和 `*.go` 会同时找到两种标记，只有 Go 中的标记表示本文所述集成边界。

## 已声明但尚未实现 {#declared-nothing-implements-it}

- `internal/updates/seams.go:32`：`Notifier`。`internal/mail` 可通过 SMTP 发送 OTP，但没有适配此接口，也没有游戏内通知通道。`felis update` 有意传入 nil。通知由面板承担：主机上的 `felis-update-check.timer` 每日执行 `felis update --record`，把报告存入 `platform_settings.update_report`；面板「管理 → 更新 → 组件版本」显示报告及每个更新对应的命令。
- `internal/updates/seams.go:43`：`Applier`。尚无执行更新的实现。nil 不会静默跳过：`Run` 为每个计划应用的更新记录 `errNoApplier`，使误排程显式失败。
- `internal/updater/gatherer_integration.go:22`：`NewSysGatherer` 在集群内路径将两个当前版本查询接口留为 nil：读取控制平面 Deployment 镜像，以及检查 Velocity jar。主机路径已实现这两项，见下文「已实现」；此缺口仅影响使用集群客户端的调用方。
- `internal/api/handlers_updates.go`：维护窗口仅供参考，没有集群内执行器应用更新。`felis update` 读取窗口，显示当前时间的位置，并在窗口外应用前警告；执行器本身仍使用零窗口，任何路径都不能据此宣称更新正在应用。
- `internal/submit/blobstore.go`：**2026-09-22 已关闭**。上传 PVC 不能跨命名空间挂载，改为通过 API 传输：派生的上下文引用现在是由服务令牌保护的内部 URL `/api/v1/internal/submissions/{id}/context`。构建 Job 的 `context-fetch` initContainer 使用 `felis fetch-context` 流式下载，经过 zip-slip 检查解压至有大小限制的 emptyDir，Kaniko 使用 `--context=/context`。令牌通过与登录网关相同的 Secret 副本机制进入构建命名空间（bootstrap + `felis setup`），构建出站策略仅允许访问控制命名空间的内部端口。此流程同时适用于本地和 `s3://` 存储，构建沙箱 Pod 都不会获得文件系统视图或对象存储凭证。Kaniko、Trivy 及 Trivy 的两个数据库来自仓库的 `mirror/` 副本，由安装器和 `felis-build-tools.timer` 保持更新（`felis mirror-build-tools`，故障排查 §8e）；可用 `[registry]` 配置覆盖。

## 已实现，实际 I/O 无法仅凭本仓库验证 {#built-only-its-i-o-is-unverifiable-from-this-repo}

代码已实现，并使用替身完成单元测试。欠缺的是可运行的主机、集群或真实上游账号，而非实现本身。

- `cmd/felis/tui_edge_apply.go:246,274,295`：`nft` 边缘防护、幂等清理及 cloudflared 调用。
- `internal/cfsetup/runner.go:18`、`internal/cfsetup/cfsetup.go:329`：真实 Cloudflare Tunnel 和 Access API 调用；`internal/cfsetup/cfsetup_test.go:11` 通过替身测试完整流程。
- `internal/api/console.go:39`、`internal/api/logstream.go:236,306`、`internal/fileedit/k8sjobs.go:45`：分别需要真实集群的 RCON、`pods/log` 持续读取或 Job。**2026-09-22/23 已实测（auditfix7–25）**：RCON 命令链（唤醒 → 探测 → `command` / 访问权限变更 / 停服）、日志 SSE 流和文件编辑 Job 均在演练集群完成端到端验证。
- `internal/api/handlers_access.go:170,490`：解析原版服务器和 LuckPerms 的真实命令输出。**2026-09-23 已实测**：玩家、白名单、封禁列表解析与真实 Paper 回复一致；未安装 LuckPerms 时按文档返回原始回复；四个反例的输入保护均有效。

## 已接受且暂不计划修复的限制 {#deliberately-accepted-not-scheduled-to-close}

这些是当前设计决策，不是待办事项。每项都说明何时需要重新评估。

- ~~`internal/api/pgrepo.go:281`：配额检查和 `ClaimServer` 是两个语句（审计 #4 的 TOCTOU），需真实 Postgres 才能关闭。~~ **已关闭**：检查移入 `ClaimServer`，在一个事务中执行咨询锁、复查和 UPDATE。pgint 的先失败后通过测试提供了真实 Postgres 验证。
- `internal/api/api.go:773`：`cooldownLimiter` 仅在单进程内生效。API 有 N 个副本时，调用方每窗口最多能取得 N 份 OTP 额度。单副本内的突发问题已解决，跨副本限制需要共享存储，超出单副本安装范围；扩容 API Deployment 前须重新评估。
- `internal/submit/submit.go:524`：每用户上传存储预算先读取已存字节，再写入。单副本通过每用户上传预留串行化；跨副本交错上传时，每个并行上传可能多出一个仍符合单文件限制的对象。待处理投稿上限已无此问题：`CreateSubmission` 在每投稿者咨询锁内计数和插入（pgint `TestSubmitPendingCapHoldsUnderConcurrency`）。扩容 API 前，与上面的冷却限制一起评估；可用同类事务中的上传预留行解决。
- `internal/submit/submit.go:436`、`internal/submit/submit_test.go:351`：CAS 之后 `Approve` 失败，记录状态与正常情况无法区分，因此返回注明正在运行构建的独立错误，避免盲目重试导致重复推送。其他操作顺序风险更大。
- `cmd/felis/tui_edge_apply.go:246` 的第二处标记：防护使用 nftables。在 firewalld 主机上，重载可能清空独立表，目前未处理 firewalld 原生协调。缺少 `nft` 可执行文件时显式失败，不会留下开放端口。
- `internal/api/handlers_account.go:169`：重新认领时「从头开始或继承」的选择，在 Java/Velocity 侧仅有代码验证；绑定状态端点只报告绑定完成，不暴露该选择。

## 标记之后已接入的功能 {#wired-since-the-marker-was-written}

- `internal/api/handlers_email_otp.go`、`internal/api/api.go`：SMTP 已于 2026-07-20 交付（`internal/mail`，在 `cmd/felis/api.go` 接入）。未配置 `[smtp]` 时 `Mailer` 为 nil，发送验证码的端点均返回 503 `mail_unavailable`，验证码绝不写入日志。因此「Felis 无法发送邮件」已过时。
- `internal/config/config.go:117`：原注释已过时，在两个存储后端交付后仍把上传传输描述成待集成。`LocalContextStore`、`S3ContextStore` 已由 `cmd/felis/api.go` 按配置基础地址的形式选择。新增本文时已修正；当时剩余的是上文所列 Kaniko 的读取路径。
- `internal/updater/doc.go:44`：原「剩余集成」列表将已存在的 `felis update` CLI 和集群外 Velocity jar 读取列为未完成（`cmd/felis/update.go`、`internal/updater/gatherer_host.go`），已在同次修改中纠正；另两个 nil 接口缺口仍存在，见上文。

## 代码之外记录的边界 {#recorded-outside-the-code}

- minecraft 命名空间通过 `felis-server-egress` 限制出站流量：允许 DNS 和公网，排除全部私有网段及节点自身公网地址。`felis-login-to-internal-api` 只开放游戏 Pod 必需的平台路径：login → felis-api:8081。游戏服务器以后需要访问其他集群内服务时，必须在相邻位置添加单独的允许策略（`internal/platform/netpol.go`）。

---

来源：[docs/deferred-seams.md](https://github.com/FelisMC/Felis/blob/main/docs/deferred-seams.md)。
