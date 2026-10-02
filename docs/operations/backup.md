---
title: 备份与恢复
---

# 备份与恢复 {#备份与恢复}

* **备份与恢复**：默认启用，归档 PVC 及其路径由安装器生成。
  * 手动备份：将服务器的完整数据卷（`/data`，含世界、配置、插件与模组）归档至集群内的归档存储，可回滚至任一备份点
  * 每日恢复点：当天有玩家进入过的服务器在停止后自动生成恢复点，默认保留 7 个，保存期限 90 天；恢复点单独轮换，不影响手动备份
  * 下载与导出：支持下载单个备份（附 sha256 校验）、删除单个备份及导出完整世界
  * 异地副本（可选）：备份在主机上加密后同步至 S3 兼容存储（AWS S3、Cloudflare R2、Backblaze B2、MinIO 等）
  * 控制面数据库：存放账号、服务器归属、配额与存档索引的数据库每日自动备份，每次升级迁移前额外创建快照，故障时可通过 `felis db restore` 整库原子回滚；面板「维护与备份」页显示最近一次备份的时效（参见 [故障排查 §16](/operations/troubleshooting#_16-control-plane-database-backups-and-disaster-recovery)）

## 备份包含哪些数据 {#what-a-backup-contains}

备份会将服务器挂载到 `/data` 的整个数据卷打包，包括世界目录、`server.properties`、插件与模组、配置、jar、依赖库、日志和缓存，而不只是 `world/` 目录。

恢复时，数据卷内容会被归档替换，备份之后新增的文件会被清理，因此配置和插件的改动也会回滚。标准 Paper 服务器的体积主要来自依赖库和缓存：一个尚未积累世界数据的新实例约为 170MB。规划归档 PVC 容量时，需要计入这些数据。

## 详细操作 {#详细操作}

- [世界备份、下载、导出与每日恢复点](/operations/troubleshooting#_10-world-reaper-false-deletes-and-skipped-backups-spec-§18)
- [控制面数据库备份与灾难恢复](/operations/troubleshooting#_16-control-plane-database-backups-and-disaster-recovery)
- [灾难恢复与计划迁移](/operations/#_5-disaster-recovery)

---

原文：[README.md](https://github.com/FelisMC/Felis/blob/main/README.md)、[docs/troubleshooting.md](https://github.com/FelisMC/Felis/blob/main/docs/troubleshooting.md)、[docs/operations.md](https://github.com/FelisMC/Felis/blob/main/docs/operations.md)。
