---
title: 备份与恢复
---

# 备份与恢复 {#备份与恢复}

* **备份与恢复**：默认启用，归档 PVC 及其路径由安装器生成。
  * 手动备份：将服务器的完整数据卷（`/data`，含世界、配置、插件与模组）归档至集群内的归档存储，可回滚至任一备份点
  * 不停服备份：运行中的服务器无需停机即可备份，仅在同一节点复制世界的数秒内暂停保存，归档、校验与回读均基于副本完成，玩家可继续游戏
  * 每日恢复点：当天有玩家进入过的服务器每日自动生成恢复点，运行中的服务器以不停服方式生成；默认保留 7 个，保存期限 90 天；恢复点单独轮换，不影响手动备份
  * 下载与导出：支持下载单个备份（附 sha256 校验）、删除单个备份及导出完整世界
  * 异地副本（可选）：备份在主机上加密后同步至 S3 兼容存储（AWS S3、Cloudflare R2、Backblaze B2、MinIO 等）；Owner 可在面板「维护与备份 → 异地副本」中配置、修改或停用
  * 控制面数据库：存放账号、服务器归属、配额与存档索引的数据库每日自动备份，每次升级迁移前额外创建快照；Owner 可在面板「维护与备份 → 备份」中立即备份、校验备份并整库原子回滚，命令行入口为 `felis db restore`（参见 [故障排查 §16](/operations/troubleshooting#_16-control-plane-database-backups-and-disaster-recovery)）
  * 整机重建：在新主机安装时设置 `FELIS_RESTORE_FROM_OFFSITE=1`，或安装后在面板「维护与备份 → 异地副本」中执行重建（命令行为 `sudo felis restore-host -yes`），即可从异地副本恢复数据库、镜像、上传文件、服务器及各服务器最新的世界；中断后重新执行将从中断处继续（参见 [故障排查 §16](/operations/troubleshooting#rebuild-on-a-new-host-the-old-one-is-gone)）

## 备份包含哪些数据 {#what-a-backup-contains}

备份会将服务器挂载到 `/data` 的整个数据卷打包，包括世界目录、`server.properties`、插件与模组、配置、jar、依赖库、日志和缓存，而不只是 `world/` 目录。

恢复时，数据卷内容会被归档替换，备份之后新增的文件会被清理，因此配置和插件的改动也会回滚。标准 Paper 服务器的体积主要来自依赖库和缓存：一个尚未积累世界数据的新实例约为 170MB。规划归档 PVC 容量时，需要计入这些数据。

## 详细操作 {#详细操作}

- [世界备份、下载、导出与每日恢复点](/operations/troubleshooting#_10-world-reaper-false-deletes-and-skipped-backups-spec-§18)
- [不停服备份](/operations/troubleshooting#live-backups-backing-up-a-running-server)
- [控制面数据库备份与灾难恢复](/operations/troubleshooting#_16-control-plane-database-backups-and-disaster-recovery)
- [灾难恢复与计划迁移](/operations/#_5-disaster-recovery)
- [在面板中执行数据库备份与恢复、异地副本及整机重建](/operations/#_9-running-the-host-from-the-panel-go-tested-sh-tested)
