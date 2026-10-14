---
title: 部署架构
---

# 部署架构 {#部署架构}

## 单机部署 {#单机部署}

`deploy/bootstrap.sh` 默认部署在单个节点。可选的 A 主控与工作节点部署见[多机部署](/guide/distributed)。主机需要 systemd、root 权限和[受支持的包管理器](/operations/#_1-supported-hosts)；安装器负责安装 k3s、JRE、cloudflared，以及需要在主机上构建镜像时使用的 Docker。二进制与镜像的来源见[运维手册](/operations/#where-the-binary-and-the-images-come-from)。

PostgreSQL 作为 `felis-postgres` Deployment 运行在 k3s 内，使用发布版按摘要固定的官方镜像，数据存放在宿主机的 `/var/lib/felis/postgres`。

单机部署仍是默认方式。可选的[分布式模式](/guide/distributed)将 API 和 operator 留在主控，在获批的 k3s 工作节点上运行游戏。世界使用所在节点 local-path 存储上的 ReadWriteOnce PVC；迁移需要先停服，再通过主控的归档服务显式执行。

工作节点失联时，Owner 可将其上的世界按各服务器最新的完好备份故障切换至其他节点，可手动执行，也可开启自动故障切换；运行在工作节点上的服务器按设定间隔生成不停服副本，以减少切换时丢失的进度。可选的主控高可用基于 k3s 嵌入式 etcd 与 Longhorn 复制存储，承载控制面的主控失联时，控制面自动转移至其他主控。未启用主控高可用时，A 重启期间控制操作会暂停，直到其工作负载恢复，A 上的世界也无法故障切换。故障切换与主控高可用尚未完成多机验收，跨节点网络仍须完成多机部署手册规定的三机验收。

## 主控与工作节点 {#主控与工作节点}

分布式模式默认关闭。主控 A 运行 Felis API/operator、k3s server、PostgreSQL、Registry、归档服务和系统服；Velocity 继续使用主控的 systemd 服务。B、C 等工作节点只运行 k3s-agent/containerd、游戏 Pod 和主控创建的维护 Job。节点必须与 A 同架构、同 k3s 版本，宿主机由管理员信任并维护。

启用主控高可用后可增加主控。etcd 需要多数成员在线，因此建议部署三台或更多奇数台主控，三台主控可容忍一台失联。控制面工作负载只调度到主控，并与 PostgreSQL 运行在同一台主控上；PostgreSQL、上传文件、Registry、归档及系统服的世界存放在 Longhorn 复制卷上。数据库备份、异地副本等宿主机定时任务只在当前运行 PostgreSQL 的主控上执行。每台主控都安装 Velocity，可选的 VRRP 浮动地址在主控之间漂移。

## 面板主机运维 {#host-operations-from-the-panel}

Owner 在面板中执行的主机操作（数据库备份与恢复、异地副本、整机重建、健康检查、诊断包、访问方式、根域名、凭据轮换等）由安装器设置的 root 服务 `felis-node-control.service` 执行。该服务调用与命令行相同的 `felis` 命令或安装器函数，只接受固定的操作列表及经过校验的参数。felis-api 保持非 root 身份，仅以只读方式挂载该服务的 Unix socket 目录；每项任务均需身份复核，并记录审计日志。详见[运维手册第 9 节](/operations/#_9-running-the-host-from-the-panel-go-tested-sh-tested)。

## 运行流程 {#运行流程}

[时序图](/reference/sequence-diagrams)保留主仓库的进服唤醒、认领事务与账号绑定流程。服务端实现与路由限制见[服务端插件](/reference/plugins)。
