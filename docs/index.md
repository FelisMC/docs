---
title: 认识 Felis
---

# 认识 Felis {#认识-felis}

基于 Kubernetes 的 Minecraft 服务器托管平台。

单条命令完成部署，自动管理服务器生命周期、备份与安全。

> [!CAUTION] 注意
> **当前仅提供开发快照，已撤下公开 Release。仅供开发者在隔离的测试环境中验证，不建议普通用户部署。**<br>
> **此项目仍处于早期开发阶段，您不该在任何生产环境使用该项目。若产生任何问题，贵用户的使用行为与 FelisMC 团队无任何民事刑事法律关系。**<br>

## 特性 {#特性}

* **按需启停**：玩家连接代理时自动启动目标服务器，启动期间玩家进入等待队列，服务器就绪后自动传送；服务器空闲后自动停止，释放内存。

* **Web 控制面板**：在浏览器中查看服务器状态、在线玩家与资源用量。
  * 控制台（RCON）、白名单、封禁、OP 与 LuckPerms 权限管理
  * 文件管理：新建、删除、重命名、分片上传、下载，以及停服状态下解压 zip，可用于导入世界
  * 计划任务：按星期与时区定时执行命令、重启、停止、启动或备份，执行前在游戏内向玩家发送提醒
  * 平台设置：Owner 可在面板中配置邮件服务（SMTP）、备份与审计保留策略及监控心跳，保存后立即生效，并优先于安装时的设置
  * 主机运维：Owner 可在面板中完成访问方式、根域名、上传存储、凭据轮换、游戏代理内存、数据库备份计划、异地副本与系统服务器补全等主机操作，由主机上的 root 服务以对应命令执行，并要求身份复核和记录审计日志（参见 [运维手册第 9 节](/operations/#_9-running-the-host-from-the-panel-go-tested-sh-tested)）

* **备份与恢复**：默认启用，归档 PVC 及其路径由安装器生成。
  * 手动备份：将服务器的完整数据卷（`/data`，含世界、配置、插件与模组）归档至集群内的归档存储，可回滚至任一备份点
  * 不停服备份：运行中的服务器无需停机即可备份，仅在同一节点复制世界的数秒内暂停保存，归档、校验与回读均基于副本完成，玩家可继续游戏
  * 每日恢复点：当天有玩家进入过的服务器每日自动生成恢复点，运行中的服务器以不停服方式生成；默认保留 7 个，保存期限 90 天；恢复点单独轮换，不影响手动备份
  * 下载与导出：支持下载单个备份（附 sha256 校验）、删除单个备份及导出完整世界
  * 异地副本（可选）：备份在主机上加密后同步至 S3 兼容存储（AWS S3、Cloudflare R2、Backblaze B2、MinIO 等）
  * 控制面数据库：存放账号、服务器归属、配额与存档索引的数据库每日自动备份，每次升级迁移前额外创建快照；Owner 可在面板「维护与备份 → 备份」中立即备份、校验备份并整库原子回滚，命令行入口为 `felis db restore`（参见 [故障排查 §16](/operations/troubleshooting#_16-control-plane-database-backups-and-disaster-recovery)）
  * 整机重建：在新主机安装时设置 `FELIS_RESTORE_FROM_OFFSITE=1`，或安装后在面板「维护与备份 → 异地副本」中执行重建（命令行为 `sudo felis restore-host -yes`），即可从异地副本恢复数据库、镜像、上传文件、服务器及各服务器最新的世界；中断后重新执行将从中断处继续（参见 [故障排查 §16](/operations/troubleshooting#rebuild-on-a-new-host-the-old-one-is-gone)）

* **运维诊断**：面板「维护与备份」页显示主机状态与未解决的告警，并提供健康检查、诊断包下载与审计日志导出；对应的命令行入口如下。
  * `sudo felis status`：汇总显示节点、控制面、游戏代理、各服务器、备份及未解决的告警
  * `sudo felis doctor`：执行全部健康检查，按模块列出问题及排查方向，执行过程中不发送邮件
  * `sudo felis support-bundle`：生成已脱敏的诊断包，供提交问题时附带（参见 [故障排查 §0](/operations/troubleshooting#_0-first-look-felis-status-felis-doctor-felis-support-bundle)）
  * 看门狗：每 2 分钟执行一次巡检，异常持续时向平台所有者发送邮件告警，支持外部心跳监测（心跳地址可在面板中设置）

* **世界回收（可选）**：超过 15 天无人游玩的世界在备份后删除，以释放磁盘空间。安装时设置 `FELIS_WORLDS_HOST_PATH`（k3s 默认为 `/var/lib/rancher/k3s/storage`）即启用每日回收；未设置时不删除任何世界。过期备份的每日清理与此设置无关，始终执行。

* **多核心支持**：兼容 Paper、Fabric、Forge 与 NeoForge，统一经由 Velocity 代理接入。

* **模组包投稿**：玩家可上传模组包，经服主审批后自动构建并通过 Trivy 安全扫描；构建产物加入镜像白名单后，可直接选作服务器镜像。

* **安全**
  * Passkey 登录：支持指纹、面容识别及硬件密钥等无密码认证方式
  * 零信任访问：面板流量经 Cloudflare Access 保护，集群内部 API 不对公网开放

* **多机部署（实验性，默认关闭）**：由主控节点统一下发指令，其余节点运行游戏服务器；已停止的服务器可迁移至其他节点，失联节点上的世界可按最新备份手动或自动故障切换至其他节点。可选的主控高可用基于 k3s 嵌入式 etcd 与 Longhorn 复制存储，使控制面在多台主控之间转移。上述功能目前仅位于 main 分支，尚未完成多机验收（参见 [多机部署](/guide/distributed)）。

## 阅读文档 {#阅读文档}

- [安装与部署](/guide/deployment)
- [运维手册](/operations/)
- [故障排查](/operations/troubleshooting)
- [多机部署](/guide/distributed)
- [贡献指南](/reference/contributing)
- [项目说明](/reference/readme-en)

## 致谢 {#致谢}

* [Kubernetes](https://kubernetes.io/)：容器编排引擎
* [K3s](https://k3s.io/)：轻量级 Kubernetes 发行版
* [Cloudflare Zero Trust](https://www.cloudflare.com/zero-trust/)：零信任安全基础设施
* [PostgreSQL](https://www.postgresql.org/)：数据持久化
* [React](https://react.dev/)：前端用户界面框架
* [Vite](https://vitejs.dev/)：前端构建工具
* [TailwindCSS](https://tailwindcss.com/)：CSS 框架
* [Bubble Tea](https://github.com/charmbracelet/bubbletea)：TUI 框架
* [Minecraft](https://www.minecraft.net/)：本项目服务的游戏
