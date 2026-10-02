---
title: 部署架构
---

# 部署架构 {#部署架构}

## 单机部署 {#单机部署}

`deploy/bootstrap.sh` 默认部署在单个节点。可选的 A 主控与工作节点部署见[多机部署](/guide/distributed)。主机需要 systemd、root 权限和[受支持的包管理器](/operations/#_1-supported-hosts)；安装器负责安装 k3s、JRE、cloudflared，以及需要在主机上构建镜像时使用的 Docker。二进制与镜像的来源见[运维手册](/operations/#where-the-binary-and-the-images-come-from)。

PostgreSQL 作为 `felis-postgres` Deployment 运行在 k3s 内，使用发布版按摘要固定的官方镜像，数据存放在宿主机的 `/var/lib/felis/postgres`。

单机部署仍是默认方式。可选的[分布式模式](/guide/distributed)将唯一的 API 和 operator 留在 A，在获批的 k3s 工作节点上运行游戏。世界使用所在节点 local-path 存储上的 ReadWriteOnce PVC；迁移需要先停服，再通过 A 的归档服务显式执行。

目前没有自动故障切换或备用主控。A 重启期间，控制操作会暂停，直到其工作负载恢复；工作节点失联时，世界仍留在该节点。跨节点网络仍须完成多机部署手册规定的三机验收。

## 主控与工作节点 {#主控与工作节点}

分布式模式默认关闭。A 运行唯一 Felis API/operator、k3s server、PostgreSQL、Registry、归档服务和系统服；Velocity 继续使用 A 的 systemd 服务。B、C 等节点只运行 k3s-agent/containerd、游戏 Pod 和 A 创建的维护 Job。节点必须与 A 同架构、同 k3s 版本，宿主机由管理员信任并维护。

## 运行流程 {#运行流程}

[时序图](/reference/sequence-diagrams)保留主仓库的进服唤醒、认领事务与账号绑定流程。服务端实现与路由限制见[服务端插件](/reference/plugins)。

---

原文：[docs/operations.md](https://github.com/FelisMC/Felis/blob/main/docs/operations.md)、[docs/distributed.md](https://github.com/FelisMC/Felis/blob/main/docs/distributed.md)、[docs/sequence-diagrams.md](https://github.com/FelisMC/Felis/blob/main/docs/sequence-diagrams.md)、[plugins/README.md](https://github.com/FelisMC/Felis/blob/main/plugins/README.md)。
