---
title: 运维手册
---

# 运维手册 {#felis-operations-guide}

本文说明主机要求、资源规划、卸载及灾难恢复入口。故障诊断见[故障排查](/operations/troubleshooting)，下文以 §N 引用其中章节。

验证标记与故障排查一致：**[VM-VERIFIED]** 表示在真实主机执行过；**[CI]** 表示每次推送 main 都运行端到端验证（`.github/workflows/e2e.yml`）；**[GO-TESTED]** / **[SH-TESTED]** 表示由 `go test` 或 `deploy/` 下的 shell 测试覆盖；**[CODE-ONLY]** 表示仅描述代码行为，尚未完成端到端验证。

## 1. 支持的主机 {#_1-supported-hosts}

`deploy/bootstrap.sh` 默认单节点部署。可选的 A 主控与工作节点部署见[多机部署](/guide/distributed)。主机须有 systemd、root 权限和下列包管理器之一；安装器负责其余依赖：k3s、JRE、cloudflared，以及本机构建镜像时所需的 Docker，见下文「二进制与镜像的来源」。PostgreSQL 以 `felis-postgres` Deployment 在 k3s 内运行，使用发布版按摘要固定的官方镜像，数据位于主机 `/var/lib/felis/postgres`。

| 系统 | 包管理器 | 架构 | 状态 |
| --- | --- | --- | --- |
| CentOS Stream 9（启用 firewalld，SELinux enforcing） | dnf | aarch64 | **[VM-VERIFIED]** 从发布版附件全新安装、重复安装、从 v0.1.0 升级（将宿主机 PostgreSQL 13 数据迁入 felis-postgres）、卸载和重装 |
| Ubuntu 24.04 LTS | apt | x86_64 | **[CI]** 从推送提交的发布版附件全新安装及同提交重装；按 README 的单行命令安装最新发布版；从由其自身安装器及附件安装、向十二个表写入数据的最新发布版升级，并逐行确认数据未变；每周验证本机构建 |
| RHEL / Rocky / Alma 9、Fedora | dnf | x86_64、aarch64 | [CODE-ONLY] 与 CentOS Stream 使用同一路径 |
| Debian 12、其他 Ubuntu 版本 | apt | x86_64、aarch64 | [CODE-ONLY] |
| openSUSE Leap / Tumbleweed | zypper | x86_64、aarch64 | [CODE-ONLY] |
| Arch Linux | pacman | x86_64、aarch64 | [CODE-ONLY] |

全新安装使用以下固定版本。已安装的 k3s、cloudflared 默认保留原版本，见 §4。

| 组件 | 版本 | 固定位置 |
| --- | --- | --- |
| k3s | v1.36.4+k3s1 | `bootstrap.sh` 的 `FELIS_K3S_VERSION` |
| cloudflared | 2026.9.1 | `FELIS_CLOUDFLARED_VERSION`，各架构独立 sha256 |
| Temurin JRE（Velocity） | 25，固定补丁构建 | `FELIS_JRE_VERSION`，各架构独立 sha256 |
| Go（nano 构建） | 1.26.8 | `GO_PINNED_VERSION`，各架构独立 sha256 |
| Minecraft / Limbo / Paper / Velocity / LuckPerms | `deploy/game-stack.lock` | §15b |
| PostgreSQL | 18.6，官方 `postgres` 镜像按摘要固定 | `bootstrap.sh` 的 `POSTGRES_IMAGE`、`internal/platform` 的 `defaultPostgresImage` |

不支持 32 位主机；安装器没有可供其下载的 k3s、JRE 或 Go 构建。

安装器在修改主机前一次性检查并列出全部问题，若不满足要求则停止，不做修改 **[SH-TESTED]**：

- 架构、systemd 是否为 init，以及 k3s 所需的内存 cgroup 控制器。
- 内存低于 1.75 GiB 时拒绝安装（标称「2 GB」的 VPS 可通过）；低于 3.5 GiB 时警告。
- 各写入文件系统的可用空间，共用文件系统时累加：裸机发布版安装约需 17 GiB，`FELIS_ARTIFACT_DIR` 安装约需 15 GiB，本机构建约需 23 GiB，重装约需 7 GiB。已有 Docker 缓存或复用 k3s 等数据目录按重装计算。预计占用超过 85% 时警告，因为 k3s 会开始删除镜像缓存。
- 游戏端口、面板 NodePort、k3s 的 6443/6444 与 10248–10259、镜像仓库回环端口 5000。被安装器自身代理或 k3s 占用的端口按重装处理，允许通过。
- 主机上的其他 Kubernetes（kubelet、RKE2、k0s、MicroK8s）或 k3s agent。
- 节点地址或路由网段是否落入 k3s 的 `10.42.0.0/16`、`10.43.0.0/16`，常见冲突是 Docker 网络。覆盖范围更大的路由，例如 `10.0.0.0/8` VPN，仅警告。
- 下载主机的 HTTPS：始终检查 GitHub 和 PaperMC 下载 API；本机构建时检查 Docker Hub；k3s 安装器需要添加 Rancher RPM 源时也检查它，完整清单见下文。完成 TLS 握手即视为可达，每个地址尝试三次、间隔两秒。发布版安装时 Docker Hub 不可达仅警告，因为只在附件不可用时需要；`FELIS_ARTIFACT_DIR` 模式不检查 Docker Hub。

检查误判时，可设置 `FELIS_PREFLIGHT=warn`，将相同问题降为警告并继续安装。

安装器会增加防火墙放行规则，**不会关闭防火墙** [SH-TESTED]。启用 firewalld 时放行面板 NodePort、游戏端口、6443，并将 k3s 的 Pod 和 Service 网段置于 trusted zone。启用 ufw 时（Ubuntu、Debian 常见，CI 安装也启用 **[CI]**），允许 `10.42.0.0/16`、`10.43.0.0/16`、面板 NodePort 和游戏端口，规则注释为 `felis-…`；6443 不对外开放，Pod 从自身网段访问 API server。两种防火墙中的 Felis-nano 端口仅向 `FELIS_NANO_PROXY_CIDR` 开放。卸载器移除这些规则，只有卸载 k3s 时才移除其网段规则。主机前方的其他防火墙也须放行相同流量；Pod 流量被丢弃时，首次部署会超时并报告 `control-plane rollout did not complete`。

主机在安装存续期间必须保持：

- **固定地址**：安装与最初的 IPv4 绑定，k3s 节点、网络策略、面板证书、默认 nip.io 域名均使用它。安装前设置静态地址或 DHCP 保留。租约地址会触发安装警告；地址丢失时看门狗报告 `host-address`，见 §13c。k3s 节点名在安装时固定，修改主机名不影响它。
- **时钟同步**：安装器开启 NTP，无其他实现时使用 chrony；看门狗报告持续未同步的时钟。允许出站 UDP 123；由其他机制校时的主机可设置 `FELIS_MANAGE_TIME_SYNC=0`。

安装器还启用持久化系统日志，默认限额 1G，可用 `FELIS_JOURNAL_MAX_USE` 修改，或 `FELIS_MANAGE_JOURNAL=0` 跳过。管理员 kubeconfig `/etc/rancher/k3s/k3s.yaml` 仅 root 可读，请运行 `sudo k3s kubectl`。

单节点仍是默认方式。可选[分布式模式](/guide/distributed)将唯一 API/operator 留在 A，在获批的 k3s agent 上运行游戏。世界使用所在节点 local-path 存储的 ReadWriteOnce PVC；移动必须停服并经 A 的归档服务显式迁移。目前没有自动故障切换或备用主控。A 重启会暂停控制操作，工作节点丢失时世界仍留在该节点。跨节点网络还需完成多机手册规定的三机验收。

### 二进制与镜像的来源 {#where-the-binary-and-the-images-come-from}

默认通道和设置控制台安装发布版时，从该版本附件获取 Felis 构建的全部产物，使用前逐一校验 `SHA256SUMS`：`felis` 二进制、控制平面、limbo、lobby、paper 镜像、按 `bootstrap.sh` 摘要固定的 registry 和 PostgreSQL 镜像，以及 `felis-velocity.jar`。镜像通过 `k3s ctr images import` 导入 containerd，再上传集群内仓库；主机无须 Docker、Gradle、Go，也不必为这些产物访问 Docker Hub。k3s 自身镜像在首次启动前从其 GitHub release 获取 `k3s-airgap-images-<arch>.tar.zst` 并校验其 sha256 清单。升级只下载含本机缺失镜像的 tar，暂存 `/var/lib/felis/artifacts`，仓库保存成功后删除。附件清单见 `deploy/build-release-artifacts.sh`。

来源选择已由 **[SH-TESTED]** 覆盖。CentOS Stream 9 aarch64 经 `FELIS_ARTIFACT_DIR` 的附件安装已 **[VM-VERIFIED]**：全新安装及从本机构建版升级都未拉取或构建镜像，重装也未重复导入或上传。发布版下载路径在附件发布前仅为 [SH-TESTED]。

默认选择最新发布版；`FELIS_RELEASE=<tag>` 可指定旧版，从该版本附件安装，并读取该标签的安装器。这也是升级失败后回退的方法，见 §16「回滚损坏数据库的升级」。

以下情况改为本机构建，安装 Docker，并在镜像入库后停止 Docker：

- 不是发布版来源：`FELIS_VERSION_BOOTSTRAP=dev`、固定 `FELIS_REF` 或 `FELIS_SKIP_FETCH`。
- `FELIS_GAME_STACK=latest`：login、lobby、paper 镜像本机构建，其余仍取自发布版。
- 没有 `SHA256SUMS`（附件机制之前的旧版，或尚未上传完成），或附件缺失、校验失败、格式错误。仅对应镜像回退构建；registry、PostgreSQL 镜像改从 Docker Hub 拉取，并输出对应警告。每个下载先重试三次；磁盘不足以构建时，在安装 Docker 前停止。相关消息见 §15c。

`FELIS_ARTIFACT_DIR=<绝对路径>` 从目录读取发布版的全部 `felis-*` 文件和 `SHA256SUMS`，也可使用 `deploy/build-release-artifacts.sh <version> <dir>` 生成的目录。不会下载或构建 Felis 自身产物，除非使用发布版不包含的 `FELIS_GAME_STACK=latest` 游戏镜像；附件缺失或校验失败会停止安装。不能同时使用另行指定源码来源的 `FELIS_REF`、`FELIS_SKIP_FETCH`。

其余主机软件仍需下载，须直接或经 `https_proxy` 提供出站 HTTPS。目前不支持完全离线安装 **[SH-TESTED]**：

| 地址 | 下载内容 |
| --- | --- |
| `github.com` 及附件重定向的 githubusercontent.com 主机 | k3s 及其镜像、cloudflared、Temurin JRE、ViaVersion、ViaBackwards、ViaRewind |
| `raw.githubusercontent.com` | k3s 尚未安装时所需的安装脚本 |
| `rpm.rancher.io` | Red Hat 或 SUSE 系启用 SELinux 的主机上，k3s 尚未安装时所需的 k3s-selinux；包括 CentOS Stream、RHEL、Rocky、Alma、Fedora、openSUSE Leap |
| `fill-data.papermc.io` | Velocity jar，除非通过 `FELIS_VELOCITY_FORK_JAR` 提供 |
| 发行版软件源 | 缺少的 CA 证书、OpenSSL、curl、tar 等基础包，以及与 k3s-selinux 配套的 container-selinux |

preflight 在任何修改前逐一探测上述地址，一次列出所有 `cannot reach … over HTTPS`；包管理器自行报告软件源问题。覆盖配置可能增加下载来源：`FELIS_JRE_VERSION` 使用 `api.adoptium.net`；非固定 `FELIS_VELOCITY_VERSION` 使用 `fill.papermc.io`；`FELIS_GAME_STACK=latest` 会从 Docker Hub、PaperMC、Limbo CI、LuckPerms 本机构建，preflight 会探测 Docker Hub。

```
# on a machine with access: the release's assets for the host's architecture
gh release download v1.4.0 --repo FelisMC/Felis --dir felis-v1.4.0 \
  --pattern 'felis-*linux-amd64*' --pattern felis-velocity.jar --pattern SHA256SUMS
# on the host, after copying the directory over
sudo FELIS_ARTIFACT_DIR=/root/felis-v1.4.0 bash bootstrap.sh
```

`SHA256SUMS` 同时列出两种架构，可不复制另一架构的文件。

### felis-api 重启期间的行为 {#while-felis-api-restarts}

安装器更新 API、节点重启或 Pod 崩溃时，API 在新 Pod 就绪前不可用。参考虚拟机从 `kubectl rollout restart` 到 Available 约 12 秒。Deployment 为单副本、Recreate 策略，旧 Pod 先删除再启动新 Pod。不能同时运行两个 API：上传卷是 ReadWriteOnce，分片上传在进程内串行化；构建协调、恢复收尾、仓库清理、上传回收和审计保留均在进程内运行，没有选主，双副本会重复执行。

- 已在服内的玩家不受影响，游戏服务器继续运行。
- 离开登录网关或通过服务器地址进服的玩家，若最近十分钟内 API 确认过绑定，则允许加入；其他玩家收到登录验证暂不可用的提示。
- 登录网关为新登录最多重试 60 秒并提示正在重试，较短的重启只会延迟登录。
- 唤醒、停服、`/link`、面板需等待 API。
- 此期间 Velocity 重启时，使用 `/opt/felis/velocity/plugins/felis-link/last-servers.json` 缓存的服务器列表路由，直到每 15 秒一次的刷新成功。

参考虚拟机将 API 缩至 0 副本约八分钟的演练 [VM-VERIFIED]：

- 11 秒后代理记录 `server list refresh failed ... keeping current registrations`；五分钟时记录 `still failing: 22 failed attempts over 304 s`。
- 看门狗首次运行即发现 `deployment/felis-api` 严重异常；超过五分钟后的首次巡检（约第七分钟）触发告警。无 `[smtp]` 时仅写日志，见 `journalctl -u felis-watchdog`。
- 新 Pod Available 后代理记录 `server list refresh recovered after 32 failed attempts over 469 s`。

## 2. 资源规划 {#_2-sizing}

### 平台本身的资源用量 {#what-the-platform-itself-uses}

以下数据在空闲网络的验证主机测得：4 vCPU、5.5 GB 内存、6 GB swap、CentOS Stream 9 aarch64。使用 PSS，即共享页面按进程分摊，数据来自 `/proc/<pid>/smaps_rollup` **[VM-VERIFIED]**。

| 进程 | 内存（PSS） |
| --- | --- |
| k3s（API server、控制器、调度器、kubelet） | 约 370 MiB |
| k3s containerd 和 Pod shim | 约 170 MiB |
| CoreDNS、local-path 存储供应器 | 约 105 MiB |
| 空闲 Velocity（`-Xms16M -Xmx1G`，随玩家增加） | 约 175 MiB |
| felis-api、felis-operator、registry gate | 合计约 85 MiB |
| 镜像仓库 | 约 25 MiB |
| PostgreSQL（felis-postgres Pod） | 约 40 MiB，另有页面缓存 |
| **基础设施合计** | **约 1 GB** |

安装器在 `/etc/systemd/system/k3s.service.d/50-felis.conf` 为 k3s 及其 containerd 设置 `GOGC=50`，将 Go 的默认堆增长阈值减半。空闲 k3s 活跃堆约 150 MiB，原本会增长至两倍后回收；此设置节省约 70 MiB，代价约为一个核心的 2%。旧安装重跑安装器即可获得设置，k3s 会重启，Pod 继续运行。

登录服 Limbo（Pod 限制 512 MiB，用量约 0.16 GB）和大厅 Paper（限制 1 GiB，用量约 0.7–0.85 GB）另计。每个游戏服务器增加其所有者分配的内存；Pod 的 limit 等于 request，JVM 堆由它推导，见 §1a。每用户配额在面板「管理 → 配额」限制。

发布版安装不需要构建（§1）。本机构建的峰值来自 Docker 和 Gradle 容器；完成后停止 Docker，以及未被其他程序使用的 Docker containerd，释放内存。安装器安装的 Docker 不随开机启动。内存不足 2 GB 且无 swap 的主机会新增 2 GiB `/swapfile`。

### 配置建议 {#recommendations}

| 同时在线玩家 | 运行中的游戏服 | CPU | 内存 | `FELIS_VELOCITY_XMX` |
| --- | --- | --- | --- | --- |
| 不超过 20 | 1–2 个小服 | 2 vCPU | 4 GB + 2 GB swap | 1G（默认） |
| 不超过 100 | 3–5 个 | 4 vCPU | 8–16 GB | 1G |
| 不超过 300 | 5–10 个 | 8 vCPU | 16–32 GB | 2G |
| 300 以上 | 更多 | 8+ vCPU | 32 GB 以上 | 3G–4G |

玩家数是规划估算，并非实测容量。游戏服开销主要取决于视距、红石、模组及玩家行为。内存按基础设施约 1 GB、登录和大厅约 1 GB、预计同时运行的各服务器内存总和计算，再增加四分之一供页面缓存和 PostgreSQL。Velocity 每玩家开销较小；`journalctl -u felis-velocity` 出现长 GC 停顿或 `OutOfMemoryError` 时再增加堆。

`FELIS_VELOCITY_XMX` 默认 `1G`，至少 `256M`，格式为 `<n>M` 或 `<n>G`，每次重跑安装器读取。堆不超过 1G 时从 16M 起步，使用串行 GC 和仅 C1 编译器；插件活跃内存约 50M，回收只需毫秒，压缩与加密由 Velocity 原生库处理。超过 1G 时从 64M 起步并使用 G1，避免大堆全量串行回收阻塞全部玩家；周期回收在玩家离开后归还增长的内存。修改会重写 unit 并重启代理，断开所有在线玩家，应在空闲时操作 **[VM-VERIFIED]**：

```
curl -fsSL <raw-url>/deploy/bootstrap.sh | sudo FELIS_VELOCITY_XMX=2G bash
```

### 磁盘 {#disk}

| 内容 | 位置 | 大小 |
| --- | --- | --- |
| 世界 | `/var/lib/rancher/k3s/storage` 下每服一个卷 | 随世界增长 |
| 世界归档 | `felis-backups` 卷，`FELIS_BACKUP_STORAGE` 默认请求 10Gi | 每个保留备份约为一个压缩世界 |
| 集群内镜像仓库 | `registry` 卷，默认请求 10Gi | 默认镜像 2–3 GB，自定义构建会增长，每日清理（§9） |
| k3s containerd 镜像 | `/var/lib/rancher/k3s/agent/containerd` | 6–9 GB |
| Docker 镜像与构建缓存 | 本机构建时的 `/var/lib/containerd` | 多次升级后 5–10 GB |
| 安装时的发布版附件 | `/var/lib/felis/artifacts` | 最多约 2 GB，镜像入库后删除 |
| 工具链与源码 | `/opt/felis` | 约 2.5 GB |
| 数据库 | `/var/lib/felis/postgres` | 几十 MB，主要是审计日志 |
| 数据库备份包 | `/var/lib/felis/db-backups` | 每份几 MB，保留 14 份每日备份 |

local-path 卷不强制请求容量（§9），所有卷共用根文件系统。至少准备 **40 GB**，世界和自定义镜像增多后建议 60 GB 以上。文件系统超过阈值时看门狗邮件告警，磁盘耗尽见 §13b。本机构建的主机可先启动 Docker，再用 `docker builder prune -af` 回收构建缓存；下次升级会重新构建。

### 扩容磁盘 {#growing-the-disk}

上述内容共用根文件系统。可保持服务运行，先在云服务商处扩大虚拟磁盘，再扩分区和文件系统：

```bash
sudo felis backup-now -yes                      # a mistyped partition number is how a resize loses a disk
lsblk -f                                        # which disk and partition hold /, and whether LVM sits on it
sudo growpart /dev/vda 3                        # cloud-utils-growpart (RHEL) / cloud-guest-utils (Debian, Ubuntu)
# LVM (the RHEL-family default):
sudo pvresize /dev/vda3
sudo lvextend -r -l +100%FREE /dev/<vg>/root    # -r grows the filesystem with it
# no LVM:
sudo xfs_growfs /                               # xfs
sudo resize2fs /dev/vda3                        # ext4
df -h /
```

`felis backup-now`（故障排查 §10）归档所有已停止世界；加 `-stop` 可包含运行中的世界。

### 将数据迁移到独立磁盘 [VM-VERIFIED] {#moving-the-data-to-its-own-disk-vm-verified}

主要数据都在 `/var/lib/rancher/k3s`：世界、世界归档、仓库和镜像。使用独立磁盘后，数据增长或世界存储耗尽不会占满根文件系统。较小的数据库及备份包（`/var/lib/felis`）仍放在根磁盘。迁移停机时间为复制时间加一至两分钟；演练复制 4.2 GB 用时 18 秒，k3s 在新磁盘启动后 14 秒 API 即响应 `/readyz`。

1. 接入磁盘并创建文件系统。以下使用整盘，须先用 `lsblk` 确认其为空：

   ```bash
   sudo mkfs.xfs /dev/vdb
   U=$(sudo blkid -s UUID -o value /dev/vdb)
   ```

2. 停服使世界保存，再归档全部世界。使用安装器同样的标记，让看门狗在一小时内不发送邮件或失败心跳：

   ```bash
   sudo felis backup-now -yes -stop
   sudo install -d -m 0755 /run/felis
   echo $(( $(date +%s) + 3600 )) | sudo tee /run/felis/watchdog-quiet-until
   ```

3. 停止 k3s 并复制：

   ```bash
   sudo systemctl stop k3s
   sudo /usr/local/bin/k3s-killall.sh       # the containers k3s leaves running, and their mounts
   sudo mkdir -p /mnt/felis-data
   sudo mount UUID=$U /mnt/felis-data
   sudo rsync -aHAX --numeric-ids /var/lib/rancher/k3s/ /mnt/felis-data/
   sudo umount /mnt/felis-data
   ```

   `-X` 保留 k3s 设置的 SELinux 标签。不要执行 `restorecon`，否则会将 runc、CNI 二进制的 `container_runtime_exec_t` 重置为策略默认值。

4. 在原路径挂载，并让 k3s 依赖该挂载：

   ```bash
   sudo mv /var/lib/rancher/k3s /var/lib/rancher/k3s.old
   sudo mkdir /var/lib/rancher/k3s
   echo "UUID=$U /var/lib/rancher/k3s xfs defaults,nofail 0 0" | sudo tee -a /etc/fstab
   sudo mkdir -p /etc/systemd/system/k3s.service.d
   printf '[Unit]\nRequiresMountsFor=/var/lib/rancher/k3s\n' | sudo tee /etc/systemd/system/k3s.service.d/data-disk.conf
   sudo systemctl daemon-reload
   sudo mount /var/lib/rancher/k3s
   sudo systemctl start k3s
   ```

   drop-in 保护数据：若 k3s 在空挂载点启动，会创建全新空集群。依赖设置会在磁盘无法挂载时以 `A dependency job for k3s.service failed` 拒绝启动，`nofail` 则允许主机正常启动，便于远程修复。演练移除磁盘后 k3s 保持 inactive、挂载点为空；重新接入后 `systemctl start k3s` 完成挂载并启动。

5. 确认 `sudo k3s kubectl -n felis get pods` 全部就绪，`findmnt /var/lib/rancher/k3s` 指向新磁盘。然后在面板启动服务器，执行 `sudo rm /run/felis/watchdog-quiet-until`。正常运行一天后，可用 `sudo rm -rf /var/lib/rancher/k3s.old` 释放根磁盘空间。

看门狗已通过 `-disk-paths` 将 `/var/lib/rancher/k3s` 作为独立文件系统监控，新磁盘的占用也会触发邮件通知。

## 3. 卸载 {#_3-uninstall}

`deploy/uninstall.sh` 移除安装器创建的内容。执行前打印移除清单并询问，`--yes` 跳过询问 **[SH-TESTED] [VM-VERIFIED]**：

```
curl -fsSL <raw-url>/deploy/uninstall.sh | sudo bash -s -- --yes     # keep the data
curl -fsSL <raw-url>/deploy/uninstall.sh | sudo bash -s -- --purge   # remove the data too
```

两种模式均移除 `felis-*` systemd unit、`cloudflared-felis.service`、Velocity 用户、`/opt/felis`、`/usr/local/bin/felis`、中断安装残留的 `/var/lib/felis/artifacts`、安装器放置的 cloudflared（二进制仍被其他 unit 使用时保留）、`felis_edge` nftables 表和旧宿主机数据库版本的 `felis_postgres` 表，以及安装器开放的 firewalld 端口和带 `felis-` 注释的 ufw 规则。

集群只有 Felis 命名空间时，通过 k3s 的 `k3s-uninstall.sh` 卸载 k3s；存在其他工作负载时，仅删除 `felis`、`minecraft`、`felis-build` 和 MinecraftServer CRD。`--keep-k3s`、`--remove-k3s` 可覆盖该选择。

| 内容 | 默认保留数据 | `--purge` |
| --- | --- | --- |
| 最终数据库备份包 | 先执行 `felis db backup -label manual`，失败则在删除前停止；`--no-backup` 可跳过 | 不创建 |
| 数据库 `/var/lib/felis/postgres` | 保留，卸载 k3s 前先正常停止 felis-postgres | 随 `/var/lib/felis` 删除 |
| 早期版本的宿主机 PostgreSQL | 保持原状；已迁入 k3s 时停用，保留旧 `felis` 副本 | 删除其 `felis` 数据库和角色，为此临时启动再停止服务器；恢复原 `listen_addresses`、`pg_hba.conf`。若该角色仍拥有其他数据库（如 PG 合约测试的 `felis_pgint`）或其他授权，则在删除前拒绝，并列出资源及需执行的 `ALTER DATABASE … OWNER TO postgres` |
| `/etc/felis`：机密、`felis.toml`、`offsite.env`、设置向导记录的邮件密码和上传存储密钥、隧道配置 | 保留，删除 `bootstrap.done` 及每次运行记录 | 连同隧道凭证删除 |
| `/var/lib/felis`：数据库和备份包 | 保留 | 删除 |
| 世界、归档、仓库、上传文件 | 移到 `/var/lib/felis/retained/k3s-storage-<stamp>/`；`--keep-k3s` 时将卷设为 `Retain` 并留在原处 | 删除 |
| Felis 镜像、Docker 构建缓存 | 保留 | 删除 |

数据库相关两行由 [SH-TESTED]（`deploy/uninstall_test.sh`）覆盖；上面的虚拟机验证早于 felis-postgres。

两种模式都不会卸载 Docker、git、nftables、旧 PostgreSQL 服务端软件包或 swap 文件，因为其他程序可能使用它们。需要恢复裸机时可自行处理：

```
sudo swapoff /swapfile && sudo rm /swapfile && sudo sed -i '\|^/swapfile |d' /etc/fstab
sudo dnf remove docker-ce docker-ce-cli containerd.io postgresql-server   # or apt/zypper/pacman
```

Cloudflare 配置独立于主机。最终卸载后，还需删除隧道（Zero Trust → Networks → Tunnels，或 `cloudflared tunnel delete <name>`）、面板域名的 DNS 记录及 Access 应用。

### 保留数据后重新安装 {#reinstall-on-top-of-kept-data}

保留数据模式留下重装所需内容。安装器复用 `/etc/felis/secrets.env`，数据库密码、转发和会话密钥不变；对已有数据库执行迁移，不会新建。旧宿主机数据库版本已 **[VM-VERIFIED]**；felis-postgres 从 `/var/lib/felis/postgres` 保留的集群启动为 [SH-TESTED]。

以下步骤在参考虚拟机的保留数据卸载后逐项执行过，恢复世界的 `level.dat` 校验和与保留副本一致 **[VM-VERIFIED]**。`kept` 指向卸载器移出的卷目录：

```
kept="$(ls -d /var/lib/felis/retained/k3s-storage-* | tail -n 1)"
store=/var/lib/rancher/k3s/storage
```

1. 正常安装（`curl ... | sudo bash`）。若原域名不是默认 `<ip>.nip.io`，使用相同根域名；保留的 `felis.host.toml` 会供安装器读取。
2. 执行 `sudo felis setup`，重建登录服和大厅。已有所有者时直接进入状态页，可退出。
3. 恢复镜像仓库和上传文件，否则自定义服务器镜像无法拉取：

   ```
   sudo k3s kubectl -n felis scale deploy/registry deploy/felis-api --replicas=0
   sudo k3s kubectl -n felis wait --for=delete pod -l app.kubernetes.io/component=registry --timeout=120s
   sudo k3s kubectl -n felis wait --for=delete pod -l app.kubernetes.io/component=api --timeout=120s
   sudo rsync -a --delete "$kept"/pvc-*_felis_registry/ "$(ls -d $store/pvc-*_felis_registry)"/
   sudo rsync -a --delete "$kept"/pvc-*_felis_felis-uploads/ "$(ls -d $store/pvc-*_felis_felis-uploads)"/
   sudo k3s kubectl -n felis scale deploy/registry deploy/felis-api --replicas=1
   ```

   再运行一次安装器，将当前发布版镜像推送到保留仓库，覆盖旧版本。

4. 恢复游戏服务器。最终备份包保存全部 MinecraftServer；筛选器跳过步骤 2 已重建的 login 和 lobby：

   ```
   b="$(ls -t /var/lib/felis/db-backups/felis-db-*-manual.tar | head -n 1)"
   tar -xOf "$b" k8s/minecraftservers.json \
     | sudo k3s kubectl apply -l '!felis.lolicon.best/system-role' -f -
   ```

5. 恢复各世界。服务器至少启动一次后才有卷，因此先在面板启动，再停服，将保留数据复制到新卷：

   ```
   s=<server>
   sudo rsync -a --delete "$kept"/pvc-*_minecraft_world-$s-0/ "$(ls -d $store/pvc-*_minecraft_world-$s-0)"/
   ```

   然后启动服务器。大厅同理：用 `sudo k3s kubectl -n minecraft patch minecraftserver lobby --type=merge -p '{"spec":{"desiredState":"Stopped"}}'` 停止，复制 `world-lobby-0` 后修改回 `Running`。

6. 恢复归档，使面板恢复点可用。归档卷在首次备份时出现，先在面板备份任意服务器，再执行：

   ```
   sudo rsync -a "$kept"/pvc-*_minecraft_felis-backups/ "$(ls -d $store/pvc-*_minecraft_felis-backups)"/
   ```

   已配置异地存储桶时，可改用 `sudo felis offsite fetch-worlds` 获取归档，见 §16。

7. 所有服务器恢复后，删除 `/var/lib/felis/retained/`。

## 4. 升级 Felis 的配套组件 {#_4-upgrading-the-pieces-around-felis}

重跑安装器升级 Felis 本身（§15）。其他组件默认保留首次安装版本，例外如下：

| 组件 | 重跑行为 | 升级方式 |
| --- | --- | --- |
| Velocity、Limbo、Paper、LuckPerms | 跟随 `deploy/game-stack.lock` | 固定版本更新的发布版出现后重跑（§15b） |
| Temurin JRE | 更新至固定补丁构建 | 重跑 |
| k3s | 默认保留 | `FELIS_UPGRADE_DEPS=1` 使用固定发布版的安装脚本逐个 minor 升级；更大跨度会在修改前停止并提示中间版本，绝不降级 |
| cloudflared | 默认保留 | `FELIS_UPGRADE_DEPS=1` 用已校验 sha256 的固定版替换 `/usr/local/bin/cloudflared` 并重启 `cloudflared-felis`；发行版安装的仍由包管理器维护 |
| PostgreSQL | 跟随发布版固定镜像 | minor 随 Felis 发布版更新，重跑会重启 felis-postgres，API 暂停数秒；major 需导出恢复，见下文 |
| Docker、git、nftables | 发行版软件包 | 包管理器 |

```sh
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh \
  | sudo FELIS_UPGRADE_DEPS=1 bash
```

`sudo felis update` 比较 Felis、Velocity、k3s、cloudflared、JRE、PostgreSQL 的已安装与最新版本；`--k3s`、`--cloudflared`、`--jre`、`--postgres` 可只查看一项。PostgreSQL 从 felis-postgres 容器读取，仅比较同 major 的 minor；minor 更新随 Felis 发布，major 过期时提示当前支持版本。

安装器创建 `felis-update-check.timer`，每天约 05:30 执行 `felis update --record`，错过时在开机补执行。结果写入 `platform_settings`，面板「管理 → 更新 → 组件版本」显示已安装和最新版本；可更新时给出 `sudo felis update --<component>`，该命令打印应用方法。Felis 不自动应用，实际更新通过重跑安装器完成。记录超过 26 小时未更新时卡片变红，说明定时器已停止：

```sh
systemctl list-timers felis-update-check.timer
journalctl -u felis-update-check -n 50 --no-pager
sudo felis update --record   # record a fresh check now
```

### 升级旧版本安装 [VM-VERIFIED] {#bringing-an-older-install-up-to-date-vm-verified}

三部分保留创建时的状态，`felis setup` 或 `kubectl rollout restart` 无法更新：API Deployment（新环境变量如 `FELIS_SMTP_PASSWORD` 需重新渲染）、大厅镜像（早期未包含 LuckPerms，会使权限操作返回 `luckperms_missing`）、MinecraftServer spec（新增字段仍为空）。先更新镜像，再依序处理：

```sh
# 1. Rerun the installer: renders and applies the control-plane bundle, rebuilds and
#    re-imports the login and lobby images, and recreates those two pods so they run
#    the new images. The [smtp] relay the setup wizard wrote is carried forward.
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo bash

# 2. Fill the spec fields the system servers gained since (troubleshooting §12b), then
#    RCON for user servers created before it was the default. -user-rcon waits on
#    each server's image opening RCON; see §12b before running it.
sudo felis converge
sudo felis converge -user-rcon
```

检查各部分：

```sh
kubectl -n felis get deploy felis-api \
  -o jsonpath='{.spec.template.spec.containers[0].env[*].name}' | tr ' ' '\n' | grep SMTP
kubectl -n minecraft exec lobby-0 -- ls /data/plugins | grep -i luckperms
kubectl -n minecraft get minecraftserver \
  -o custom-columns=NAME:.metadata.name,RCON:.spec.rcon.enabled,IDLE:.spec.idle.autoStopEnabled
```

环境变量仅携带密码，仍需在 `felis setup` 的邮件设置中配置中继。用户服务器的新 RCON 配置在下次启动生效。

### PostgreSQL 大版本升级 [CODE-ONLY] {#postgresql-major-versions-code-only}

数据库集群位于 `/var/lib/felis/postgres/<major>/docker`。发布版改用新 major 时，安装器发现旧集群后会在修改前停止，以免新服务器在旁边创建空集群。应先在当前发布版创建备份包，再恢复到新 major 的空集群：

```sh
# On the release you run now:
b="$(sudo felis db backup -label pre-upgrade | sed -n 's/^felis db backup: wrote //p')"
sudo k3s kubectl -n felis scale deploy/felis-postgres --replicas=0
sudo mv /var/lib/felis/postgres/18 /var/lib/felis/postgres-18.old   # the old major's cluster, for a way back

# Install the new release: it starts an empty cluster on the new major and creates the schema.
curl -fsSL <raw-url>/deploy/bootstrap.sh | sudo bash

# Put the data back and bring its schema up to the new release.
sudo k3s kubectl -n felis scale deploy/felis-api deploy/felis-operator --replicas=0
sudo felis db restore -yes -no-safety-backup "$b"
sudo felis migrate up -config /etc/felis/felis.host.toml
sudo k3s kubectl -n felis scale deploy/felis-api deploy/felis-operator --replicas=1
```

新版本稳定运行一段时间后删除 `/var/lib/felis/postgres-18.old`。需要回退时，将 felis-postgres 缩至 0，把新 major 目录移出 `/var/lib/felis/postgres`，将 `postgres-18.old` 放回 `/var/lib/felis/postgres/18`，再重跑旧发布版安装器。

### 将数据库迁入 k3s [VM-VERIFIED] [CI] {#the-database-s-move-into-k3s-vm-verified-ci}

早期版本使用安装在宿主机上的 PostgreSQL。首次重跑包含 felis-postgres 的发布版会进行一次迁移：

1. 停止 API、operator、宿主机定时器；在宿主机 `pg_hba.conf` 顶部加入规则，拒绝除迁移连接以外对 `felis` 的访问，原文件保存在 `pg_hba.conf.pre-pg-move`。
2. 用 `felis db backup` 创建 `pre-pg-move` 备份包，`felis db restore` 恢复到 felis-postgres，并比较两个服务器每个表的行数。至此任何失败都会恢复 `pg_hba.conf` 和控制平面，继续使用未改变的宿主机数据库。
3. 停止并禁用宿主机 `postgresql` 服务，保留软件和旧数据，写入 `/var/lib/felis/postgres-moved`。若宿主机还运行其他数据库，则服务保持运行，但 `felis` 仅能经回环地址访问。

e2e 升级任务通过 `deploy/e2e_seed.sh` 写入用户、绑定、会话、审计、备份、构建等数据，升级后检查迁移后的 felis-postgres 是否保持全部值不变。最新发布版仍为 v0.1.0 时，该测试验证的就是此迁移。

之后主机配置指向 `127.0.0.1:15432`，并以 `deployment = "felis/felis-postgres"` 使 `felis db` 在 Pod 内运行 `pg_dump`、`psql`、`pg_restore`；Pod 使用 `felis-postgres.felis.svc:5432`。

回退到宿主机数据库，例如重装迁移前的发布版：

```sh
sudo k3s kubectl -n felis scale deploy/felis-api deploy/felis-operator deploy/felis-postgres --replicas=0
hba="$(sudo -u postgres psql -XtAc 'SHOW hba_file' 2>/dev/null || echo /var/lib/pgsql/data/pg_hba.conf)"
sudo cp -p "${hba}.pre-pg-move" "$hba"
sudo systemctl enable --now postgresql
sudo rm /var/lib/felis/postgres-moved
curl -fsSL <raw-url-of-that-release>/deploy/bootstrap.sh | sudo bash
```

`SHOW hba_file` 需要数据库运行。停止时的回退路径是 EL 默认路径，Debian/Ubuntu 使用 `/etc/postgresql/<major>/main/`。迁移后的写入只在 felis-postgres；需要保留时先执行 `sudo felis db backup`，再恢复到宿主机数据库。迁移稳定后，可用 `sudo systemctl start postgresql; sudo -u postgres dropdb felis; sudo -u postgres dropuser felis` 删除旧副本，或卸载服务端软件包。

### MinecraftServer CRD [VM-VERIFIED] {#the-minecraftserver-crd-vm-verified}

每次重跑均应用二进制内嵌 CRD（`felis bootstrap-assets crd`）。目前只提供并存储 `v1alpha1`，API server 拒绝 operator 无法处理的值：

| 字段 | 允许值 |
| --- | --- |
| `spec.rcon.port` | 未设置、`0` 或 `25575`；allow-rcon 策略只开放 25575，其他端口无法探测 |
| `spec.startup.timeoutSeconds`、`readinessTimeoutSeconds` | 0–86400 |
| `spec.startup.healthHTTPPort` | 0–65535 |
| `spec.lifecycle.terminationGracePeriodSeconds` | 0–3600 |
| `spec.idle.emptySecondsBeforeStop` | 0–604800，面板上限 86400 |

`0` 均表示 operator 默认值。旧对象的越界值可通过 CRD validation ratcheting 保留，直到有人编辑该字段。operator 将负值解释为默认，过大正值按原值执行；请用 `kubectl -n minecraft edit minecraftserver <name>` 手动修正。

**迁入 `v1beta1` 是计划，尚未实现。** 首次破坏性 spec 变更将通过新版本交付，每一步间隔一个发布版：

1. CRD 同时提供 `v1alpha1`、`v1beta1`，仍存储 `v1alpha1`。字段一致时 `conversion.strategy: None` 足够；改名或结构变化需要由 operator 提供转换 webhook。
2. 存储改为 `v1beta1`。安装器用 `kubectl get minecraftservers -A -o json | kubectl replace -f -` 重写对象，再将 CRD 的 `status.storedVersions` 设为 `["v1beta1"]`。
3. 后续发布版停止提供 `v1alpha1`。Felis 一次使用一个 Go 类型，operator 和 API 在存储切换的发布版同步切换。

### 使用旧式转发的后端 [VM-VERIFIED] {#legacy-forwarded-backends-vm-verified}

1.8 时代的后端经过 ViaVersion 降至协议 47 时，现代转发的登录插件消息会被丢弃。因此代理须在握手地址中按 BungeeCord 方式传递身份。只有 Felis-Legacy Velocity fork 支持按服务器设置。标记 CR 后，下次每 15 秒的服务器列表刷新会读取：

```sh
kubectl -n minecraft label minecraftserver <name> felis.lolicon.best/forwarding=legacy
kubectl -n minecraft label minecraftserver <name> felis.lolicon.best/forwarding-   # back to modern
journalctl -u felis-velocity | grep 'legacy forwarding list'
```

安装器的 `FELIS_LEGACY_FORWARDING_SERVERS`（默认 `legacy18`）不受标签影响，始终保留在列表中。

| 代理 | 标签生效时间 |
| --- | --- |
| 含补丁 0004 的 fork（`build-velocity.sh` 默认分支） | 下次连接该服务器 |
| 只有 0003 的 fork（`--deployed`） | 下次 `systemctl restart felis-velocity` |
| 原版 Velocity | 不生效，日志警告并注明服务器 |

测试虚拟机的 0004 fork 在添加标签 12 秒后记录 `legacy forwarding list is now [legacy18,resolvecheck]`；移除后恢复 `[legacy18]`。fork 的 `FelisLegacyForwardingTest` 验证列表变化影响后续连接。

旧式转发没有密钥，后端信任所有到达游戏端口的身份。`felis-allow-game-from-velocity` 只允许代理和节点本身，但节点上的其他程序也能访问。

## 5. 灾难恢复 {#_5-disaster-recovery}

数据库备份包内容、原主机恢复、升级回退、从异地副本重建新主机均见 §16。部署时应：

- **配置异地副本**：`FELIS_OFFSITE_*`，见 §16「保存异地副本」。否则世界与归档、数据库与备份包都在同一磁盘，磁盘丢失即全部丢失。未配置时安装结束会提示 `NO OFF-SITE COPY`。
- **将异地加密密钥保存在主机之外**，例如密码管理器；存储桶仅持有加密对象。
- 没有存储桶时，也应在主机之外保存一份数据库备份包，内含重建所需的 `secrets.env`。
- 在备用虚拟机**演练重建**：执行 §16 新主机重建步骤，跳过第 8 步接管和第 11 步隧道；随后用邮件验证码登录、恢复一个世界并加入。`felis offsite status`、`felis db check` 在副本或最新每日备份过期时非零退出，可接入监控，也可依赖看门狗邮件。

### 计划迁移到另一台主机 {#moving-to-another-host-planned}

计划迁移采用 §16 的重建流程，但旧主机仍能提供完整最终副本。需要异地桶传送世界归档（§16 第 7 步）。从第 1 步开始停机，直到新主机提供服务。

1. **旧主机**停止全部可能改变世界的操作，发送最终副本：

   ```bash
   sudo install -d -m 0755 /run/felis
   echo $(( $(date +%s) + 4 * 3600 )) | sudo tee /run/felis/watchdog-quiet-until
   sudo systemctl stop felis-velocity                                   # no joins, so no server wakes
   sudo felis backup-now -yes -stop                                     # every world archived; the servers stay stopped
   sudo k3s kubectl -n felis scale deploy/felis-operator --replicas=0   # nothing starts a server from here on
   sudo felis db backup                                                 # a bundle that lists those archives
   sudo systemctl start felis-offsite.service
   sudo felis offsite status                                            # again until nothing waits
   ```

   顺序不能颠倒：新主机按恢复数据库的索引获取归档，因此数据库备份必须晚于最终世界归档。`backup-now` 需要 operator 停服，所以之后才能停止 operator。静默标记使看门狗在四小时内不因代理/operator 停止发邮件。

2. **新主机**从 §16「在新主机重建」第 1 步开始。`fetch-db latest` 取得旧主机刚发送的备份包；第 8 步 `felis offsite take-over` 将新主机设为桶写入者，旧主机此后不再复制。第 10、11 步迁移域名和隧道。
3. **检查新主机**：用邮件验证码登录、恢复世界并进服，确认 `sudo felis offsite status` 的 `last success` 较新且没有待机提示，再宣布迁移完成。
4. **退役旧主机**：它保存桶之外各世界的最终副本，先连同磁盘关机保留数日，并禁用服务，避免开机自动启动：

   ```bash
   sudo systemctl disable k3s felis-velocity felis-watchdog.timer felis-offsite.timer \
       felis-db-backup.timer felis-update-check.timer felis-build-tools.timer
   sudo poweroff
   ```

   之后卸载（§3）或清空。

各步骤分别有对应验证：`backup-now` 见 §10，重建见 §16；完整迁移顺序尚未作为一次整体迁移演练。

## 6. 更换根域名 [VM-VERIFIED] [GO-TESTED] [SH-TESTED] {#_6-changing-the-root-domain-vm-verified-go-tested-sh-tested}

根域名不仅写入安装器配置，还涉及面板证书 `/etc/felis/panel-tls.crt`、两个命名空间的 `felis-config` Secret、`felis-api-tls` Secret、代理 `felis-link.properties`、登录 MinecraftServer 的 `FELIS_ROOT_DOMAIN` / `FELIS_PANEL_HOSTNAME`、Cloudflare 隧道和 DNS。`felis domain set` 按此顺序更新主机内可处理的各处，再重启读取它们的服务；`felis domain check` 逐项报告。安装器保留已安装域名，带不同 `FELIS_ROOT_DOMAIN` 重跑时会停止并提示此命令。

```sh
sudo felis domain set new.example.net        # the plan: every surface, what it moves to, what it costs
sudo felis domain set -yes new.example.net   # do it
sudo felis domain check                      # one line per surface; exits 1 while any is behind
```

以下内容保留：

- `[auth]` 中手动设置的面板、管理控制台域名，即不是 `console.<root>`、`op.console.<root>` 的值。需要迁移时手动改 `/etc/felis/felis.host.toml`，再运行 `set`。
- 其他 `[auth]` 键（`access_jwt_aud`、`client_ip_header`）及两个配置文件的其他行。多行值、带引号或点号的键无法逐行修改时，命令拒绝并指出需修复内容。
- 管理员自备证书。安装器自签证书会按相同结构为新域名重签，旧证书/密钥保存为 `*.pre-domain-<time>`；其他颁发者的证书若不覆盖新域名，则在修改前停止。换成覆盖新域名的证书后重跑。

计划在 `-yes` 前打印以下影响：

- **DNS**：`<root>`、`console.<root>`、`op.console.<root>`、`*.<root>` 必须指向主机。通配符不覆盖三级域名 `op.console.<root>`，须单独建记录。`check` 会解析各域名并警告未生效项。
- **玩家**：服务器地址改为 `<name>.<新根域名>`，旧地址不再路由；代理重启断开全部在线玩家。迁移后的首次安装器重跑还会重启一次代理，因为其文件指纹早于迁移。
- **登录**：Cookie 属于旧主机名，所有人须重新登录。Passkey 绑定面板域名；计划显示失效数量，用户需用邮件验证码登录并注册新 Passkey。无 `[smtp]` 中继时无法收码，被锁在外的所有者可用 `sudo felis breakGlass` 恢复。
- **Cloudflare**：隧道 ingress 和 Access 应用仍使用旧域名，迁移后重跑 `sudo felis setup` 的 Cloudflare 步骤。`check` 会对比隧道与新域名。
- **远程代理**：另一主机上的 `felis-link.properties` 不在本机处理范围，`set` 会打印需更新的三个键。

`set` 可安全重复执行，只修改落后的部分；已处于目标域名时，会收敛 `check` 报告的差异。中断后也可重跑。

参考虚拟机从 `10.211.55.6.nip.io` 迁入 `10-211-55-6.nip.io` 用时 34 秒。30443 的证书、两个域名的 `/config.json`、代理日志 `Felis routing ready: rootDomain=`、登录 Pod 环境变量均更新。第二次 `set -yes` 无修改或重启；旧 `FELIS_ROOT_DOMAIN` 在首项检查即拒绝；完整重跑保留新域名且 `check` 全部通过；迁回也恢复所有位置 **[VM-VERIFIED]**。

若代理启动时间早于 `felis-link.properties` 最近修改时间，`check` 会报告落后。旧安装器每次重写该文件，因此从旧版升级后，文件域名已正确时也可能报告一次；`sudo systemctl restart felis-velocity` 可清除。现在内容相同时安装器不再重写文件。

---

来源：[docs/operations.md](https://github.com/FelisMC/Felis/blob/main/docs/operations.md)。
