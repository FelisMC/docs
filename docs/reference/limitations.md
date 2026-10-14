---
title: 已知限制
description: Felis 当前尚未实现或只部分实现的功能，以及它们对运维人员和玩家的影响。
---

# 已知限制 {#limitations}

本页列出 Felis 当前尚未实现或只部分实现的功能，并说明它们对运维人员、管理员和玩家的影响及可行的应对方式。部署或升级之前，请确认这些限制不影响预期用途。

## 发布状态 {#release-status}

Felis 只提供开发快照，没有公开发布的 Release 资产。开发快照仅供开发者在隔离的测试主机上验证，不应用于生产环境。安装开发版需要显式选择 `dev` 通道，见[安装与部署](/guide/deployment#channels)。

## 安装与升级 {#installation}

- **不支持完全离线安装。** 使用 `FELIS_ARTIFACT_DIR` 从预先下载的发布资产安装时，Felis 二进制、镜像和代理插件从该目录读取，但 k3s 及其镜像、JRE、cloudflared、Velocity、Via 插件和系统软件包仍需联网下载。主机需要能通过 HTTPS 访问这些地址，或配置 `https_proxy`。见[从预下载资产安装](/guide/deployment#offline-install)与[网络要求](/guide/requirements#network)。
- **PostgreSQL 大版本升级需要手动完成。** 发布版把 PostgreSQL 镜像升级到新的大版本时，安装器检测到旧版本的数据目录后停止，不会自动迁移数据；需要先生成数据库备份包，再在新版本上恢复。见[PostgreSQL 大版本升级](/operations/upgrade#postgresql-major)。

## 控制面 {#control-plane}

- **felis-api 只能以单副本运行。** felis-api 的 Deployment 固定为一个副本，更新时先停止旧 Pod 再启动新 Pod，期间 API 短暂不可用。邮箱验证码的重发冷却、投稿频率限制和每用户上传存储预算都只在单个进程内生效，多个后台任务也在进程内运行；把 felis-api 扩展为多个副本会使这些限制失效、后台任务重复执行，因此不受支持。
- **不自动应用版本更新，也不发送更新通知。** `felis-update-check.timer` 每日检查一次组件版本，结果显示在「维护与备份 → 版本更新」中；Felis 不会通过邮件或游戏内消息通知可用更新，也不会自动安装。应用更新需要在主机上执行 `sudo felis update --apply`，见[升级](/operations/upgrade#update)。

## 多机部署与高可用 {#multi-node}

多机部署、故障切换和主控高可用属于实验性功能，默认关闭，尚未完成在多台真实主机上的验收。只应在测试主机上启用。具体限制如下：

- 未启用主控高可用时，主控是控制面和公共入口的单点。主控重启期间控制操作暂停，主控上的世界无法故障切换。
- 主控高可用启用后无法在面板中关闭。需要回退时，使用启用过程中保存的数据库备份（标签 `pre-migrate`）和集群状态快照（`pre-ha`）手动恢复。
- 面板不提供移除主控的操作。永久下线一台主控时，先确认其余主控仍构成 etcd 多数，再按 k3s 文档移除其 etcd 成员并删除节点。
- 故障切换后，原世界卷保留在失联节点的磁盘上，不会自动清理。
- 多机部署不允许为游戏服务器设置访问私有网络的例外，见[主机与网络](#host-network)。

操作步骤见[多机部署与高可用](/guide/distributed#overview)。

## 主机与网络 {#host-network}

- **游戏服务器无法访问私有网络。** `minecraft` 命名空间的网络策略只允许游戏服务器访问 DNS 和公网，所有私有地址段都被排除。依赖局域网服务的插件（例如连接局域网数据库的权限插件）无法工作。单机部署中，只能在使用 `felis manifests` 生成清单时通过 `--server-egress-allow-cidr` 添加例外，安装器和面板不提供该设置；多机部署不允许任何例外。
- **firewalld 重新加载可能移除面板端口防护。** 使用 Cloudflare Tunnel 访问方式时，Felis 用一张独立的 nftables 表（`inet felis_edge`）关闭面板 NodePort 的公网访问，使面板只能经过 Cloudflare 访问。在运行 firewalld 的主机上，firewalld 重新加载可能清除这张表，面板端口会重新暴露在公网上。firewalld 重新加载后，执行 `sudo nft list table inet felis_edge` 检查；表不存在时重新应用 Cloudflare Tunnel 访问方式，见[访问方式](/operations/access#access-methods)。主机缺少 `nft` 命令时，防护步骤明确报错，端口仍开放时不会报告成功。
- **SELinux 主机上的主机运维服务没有独立的进程域。** `felis-node-control.service` 的套接字目录和文件使用专用的 SELinux 类型，felis-api 通过文件权限和独占挂载访问该服务；当前策略允许容器进程连接以 `unconfined_service_t` 运行的服务的 Unix 流套接字，实际可达范围由文件标签和挂载范围限定。

## 玩家与游戏 {#players-and-games}

- **服务器列表只显示 Felis 生成的 MOTD。** 游戏代理根据服务器的生命周期状态（运行中、启动中、启动失败、休眠）和缓存的玩家人数生成服务器列表信息，不显示服务器自身配置的 MOTD。查询服务器列表不会唤醒服务器。
- **用户名冲突处理只部分实现。** 登录空间会拒绝用户名冲突黑名单中的 UUID。游戏代理不会自动检测并记录用户名冲突，被替换账户的数据也没有供新账户继承的流程；面板中没有管理该黑名单的页面。
- **加载器模组不会自动安装。** Fabric、Forge、NeoForge 模组只提供 `/link`，面向 Minecraft 1.20.x 的独立服务器，无法加载到 Felis 网络使用的 26.x 服务器，安装器也不会部署它们。在 Felis 网络中，游戏代理的 `/link` 已覆盖所有服务器。见[服务端插件](/reference/plugins#overview)。

## 构建流水线 {#build-pipeline}

- **批准投稿时的部分失败需要人工处理。** 极少数情况下，批准投稿后构建已经启动，但构建与投稿的关联未能写入，此时接口返回的错误会注明正在运行的构建 ID。构建会继续运行并推送镜像；不要再次批准或重新提交该投稿，否则会重复构建。投稿记录中的构建关联需要由运维人员手动修正。投稿审核见[平台管理](/guide/administration#submissions)。
