---
title: 环境要求
description: Felis 主机支持的操作系统、硬件规划、磁盘、网络、DNS 与时间要求，以及安装器在修改主机前执行的检查。
---

# 环境要求 {#requirements}

本页面向规划 Felis 主机的管理员，列出支持的操作系统、应准备的 CPU、内存与磁盘、Felis 使用的端口、网段与 DNS 记录、对地址和时钟的要求，以及安装器在修改主机前执行的检查。安装步骤见[安装与部署](/guide/deployment#install)。

## 支持的主机 {#supported-hosts}

Felis 默认安装在单台 Linux 主机上。将游戏服务器分布到多台机器为可选功能，见[多机部署与高可用](/guide/distributed#overview)。

主机须满足：

- 64 位 x86（`x86_64`）或 ARM（`aarch64`）处理器，不支持 32 位主机；
- 以 systemd 作为 init 系统，并启用内存 cgroup 控制器；
- 具有 root 权限；
- 使用下表中的一种包管理器。

| 发行版 | 包管理器 | 架构 |
| --- | --- | --- |
| CentOS Stream 9、RHEL 9、Rocky Linux 9、AlmaLinux 9、Fedora | dnf | x86_64、aarch64 |
| Ubuntu 24.04 LTS 及其他 Ubuntu 版本、Debian 12 | apt | x86_64、aarch64 |
| openSUSE Leap、openSUSE Tumbleweed | zypper | x86_64、aarch64 |
| Arch Linux | pacman | x86_64、aarch64 |

CentOS Stream 9（aarch64，启用 firewalld 且 SELinux 为 enforcing）和 Ubuntu 24.04 LTS（x86_64）为参考平台，其他发行版使用相同的安装流程。

其余依赖由安装器负责安装：k3s、游戏代理所需的 Java 运行时、cloudflared，以及需要在主机上构建镜像时所需的 Docker。PostgreSQL 以 `felis-postgres` Deployment 运行在 k3s 中，数据位于主机的 `/var/lib/felis/postgres`。主机上已安装的 k3s 服务端会被复用，Felis 在该集群中添加自己的命名空间。主机上存在其他 Kubernetes 发行版（kubelet、RKE2、k0s、MicroK8s）或 k3s agent 时，安装器拒绝安装。全新安装所使用的组件版本见[组件版本](/operations/upgrade#component-versions)。

## 资源规划 {#sizing}

### 平台自身的资源占用 {#platform-usage}

平台空闲时的大致内存占用：

| 组件 | 内存 |
| --- | --- |
| k3s（API server、控制器、调度器、kubelet） | 约 370 MiB |
| k3s 的 containerd 及 Pod shim | 约 170 MiB |
| CoreDNS 及 local-path 存储供应器 | 约 105 MiB |
| 游戏代理 Velocity（空闲时；随玩家增加） | 约 175 MiB |
| felis-api、felis-operator、registry gate | 合计约 85 MiB |
| 镜像仓库 | 约 25 MiB |
| PostgreSQL | 约 40 MiB，另有页面缓存 |
| **基础设施合计** | **约 1 GB** |

系统服务器另计：登录空间（Limbo，Pod 限制 512 MiB，实际占用约 0.16 GB）和大厅（Paper，Pod 限制 1 GiB，实际占用约 0.7–0.85 GB）。每台游戏服务器另需其所有者分配的内存：Pod 的 limit 等于 request，Java 堆大小据此计算。每位用户可用的内存受配额限制（见[配额](/guide/administration#quotas)）。

安装发布版时不在主机上构建任何内容。安装器需要在主机上构建镜像时，峰值占用来自镜像构建（Docker 及 Gradle 容器）；构建完成后安装器停止 Docker，释放的内存归还给服务器使用。没有交换空间的节点上，安装器创建与物理内存等大的 `/swapfile`（至少 2 GiB），供服务器[休眠](/guide/servers#hibernate)时存放内存；根文件系统在安装后剩余空间不足 10% 时不创建。节点已有交换空间时保持不变，交换空间小于物理内存时安装器给出提示。

### 配置建议 {#recommendations}

| 同时在线玩家 | 同时运行的游戏服务器 | CPU | 内存 | `FELIS_VELOCITY_XMX` |
| --- | --- | --- | --- | --- |
| 不超过 20 | 1–2 台小型服务器 | 2 vCPU | 4 GB + 2 GB swap | 1G（默认） |
| 不超过 100 | 3–5 台 | 4 vCPU | 8–16 GB | 1G |
| 不超过 300 | 5–10 台 | 8 vCPU | 16–32 GB | 2G |
| 300 以上 | 更多 | 8 vCPU 以上 | 32 GB 以上 | 3G–4G |

玩家数为规划估算值：Minecraft 服务器的开销主要取决于玩家行为（视距、红石、模组）。内存按以下方式估算：基础设施约 1 GB，登录空间和大厅约 1 GB，加上预计同时运行的各服务器内存之和，再增加四分之一供页面缓存和 PostgreSQL 使用。

### 游戏代理内存 {#proxy-heap}

游戏代理（Velocity）每位玩家所需内存很少。其堆内存上限为 `FELIS_VELOCITY_XMX`：默认 `1G`，最小 `256M`，格式为 `<n>M` 或 `<n>G`。`journalctl -u felis-velocity` 出现较长的垃圾回收停顿或 `OutOfMemoryError` 时，应调高该值。

- 在面板中：在「平台设置 → 访问与安全 → 游戏代理」中设置「内存上限」（256M 至 64G），然后选择「应用」。该值在重新运行安装器或更新后保持不变。
- 在命令行中：带 `FELIS_VELOCITY_XMX` 重新运行安装器，例如 `FELIS_VELOCITY_XMX=2G`。安装器每次运行都会读取该变量。

::: warning 注意
修改内存上限会重启游戏代理，所有在线玩家都会被断开。请在玩家较少时操作。
:::

## 磁盘 {#disk}

磁盘至少准备 **40 GB**；世界和自定义镜像增多后，建议 60 GB 以上。世界、世界归档、镜像仓库、上传内容和容器镜像都存放在 `/var/lib/rancher/k3s` 下，共用同一个文件系统，卷的申请容量不会强制生效。如需将这些数据与系统盘分开，可将 `/var/lib/rancher/k3s` 放到独立磁盘上（见[将数据迁移到独立磁盘](/operations/storage#move-data)）。

各部分占用的空间以及之后的扩容方法，见[存储与磁盘](/operations/storage#disk-layout)。安装器所需的可用空间见[安装前检查](#preflight)。

## 网络 {#network}

### 端口 {#ports}

| 端口 | 协议 | 用途 | 访问来源 |
| --- | --- | --- | --- |
| 25565（`FELIS_GAME_PORT`） | TCP | 游戏代理，玩家由此连接 | 玩家 |
| 30443（`FELIS_PANEL_NODEPORT`） | TCP | 面板和 API（HTTPS） | 面板用户，或面板前方的反向代理；由 Cloudflare Tunnel 提供面板时不对公网开放 |
| 6443 | TCP | Kubernetes API（k3s） | 本机及其 Pod；多机部署中的其他节点 |
| 6444、10248–10259 | TCP | k3s 的 supervisor、kubelet、kube-proxy、controller manager 和调度器 | 仅本机 |
| 5000 | TCP | 镜像仓库的回环端口 | 仅本机 |
| 15432 | TCP | 数据库的回环端口 | 仅本机 |

面板的访问方式（直接访问、自有反向代理或 Cloudflare Tunnel）见[访问方式](/operations/access#access-methods)。节点之间的网络要求见[隔离与网络要求](/guide/distributed#isolation)。

### 防火墙与网段 {#firewall}

安装器会在主机防火墙中添加放行规则，不会关闭防火墙。

- 启用 firewalld 时，放行面板端口、游戏端口和 6443，并将 k3s 的 Pod 网段和 Service 网段加入 trusted 区域。
- 启用 ufw 时（Ubuntu 和 Debian 上常见），放行 `10.42.0.0/16`、`10.43.0.0/16`、面板端口和游戏端口，每条规则的注释为 `felis-…`。6443 端口不对网络开放，因为 Pod 从自身网段访问 API server。
- 卸载时会删除这些规则。

主机前方的其他防火墙也须放行相同的流量。Pod 流量被丢弃时，首次部署会超时并提示 `control-plane rollout did not complete`。

k3s 使用 `10.42.0.0/16` 作为 Pod 网段，`10.43.0.0/16` 作为 Service 网段。主机地址及其路由的网络必须位于这两个网段之外，常见冲突来自 Docker 网络。覆盖范围更大的路由（例如 `10.0.0.0/8` VPN）会使主机无法访问这两个网段内的地址，预检会给出警告。

### 出站访问 {#outbound}

主机须能直接或经 `https_proxy` 以 HTTPS 访问以下地址：

| 地址 | 下载内容 |
| --- | --- |
| `github.com` 及其发布版下载所重定向的 githubusercontent.com 主机 | Felis 发布版附件、k3s 及其镜像、cloudflared、Temurin JRE、ViaVersion、ViaBackwards 和 ViaRewind |
| `raw.githubusercontent.com` | k3s 安装脚本，k3s 安装完成前需要 |
| `rpm.rancher.io` | 在启用 SELinux 的 Red Hat 系或 SUSE 系主机（CentOS Stream、RHEL、Rocky、Alma、Fedora、openSUSE Leap）上，由 k3s 安装脚本添加的 k3s-selinux，k3s 安装完成前需要 |
| `fill-data.papermc.io` | Velocity jar，通过 `FELIS_VELOCITY_FORK_JAR` 提供时除外 |
| 发行版软件源 | 基础软件包（缺少时安装 CA 证书、OpenSSL、curl 和 tar），以及与 k3s-selinux 配套的 container-selinux |
| Docker Hub | 仅在主机上构建镜像时需要 |

不支持完全离线安装。使用预先下载的发布版附件安装时，无需下载 Felis 自身的二进制和镜像，其他软件仍需下载（见[使用预下载附件安装](/guide/deployment#offline-install)）。部分安装器覆盖项会增加下载地址：`FELIS_JRE_VERSION` 访问 `api.adoptium.net`；非固定版本的 `FELIS_VELOCITY_VERSION` 访问 `fill.papermc.io`；`FELIS_GAME_STACK=latest` 在主机上构建镜像，需要访问 Docker Hub、PaperMC、Limbo 的 CI 和 LuckPerms。

为进行时间同步，还须放行出站 UDP 123（见[时间同步](#time-sync)）。

## DNS {#dns}

Felis 的全部服务都位于同一个根域名下，在首次安装时通过 `FELIS_ROOT_DOMAIN` 设置。默认值为 `<node-ip>.nip.io`，无需自行配置 DNS 记录。重新运行安装器时沿用已安装的域名；之后可用 `felis domain set` 更换（见[更换根域名](/operations/access#change-domain)）。

| 名称 | 用途 |
| --- | --- |
| `<name>.<root>` | 玩家连接各游戏服务器时使用的地址；游戏端口不是 25565 时附加 `:<port>` |
| `console.<root>` | 面板 |
| `op.console.<root>` | 管理控制台 |

使用自有域名时，为 `<root>`、`*.<root>`、`console.<root>` 和 `op.console.<root>` 创建指向主机的记录。通配符记录不覆盖三级名称 `op.console.<root>`，须为其单独创建记录。由 Cloudflare Tunnel 提供面板时，只需让 `<root>` 和 `*.<root>` 指向主机。玩家的加入方式见[玩家接入](/guide/players#joining)。

## 固定地址 {#static-address}

安装与安装时使用的 IPv4 地址绑定：k3s 节点、网络策略、面板证书和默认的 `nip.io` 域名都包含该地址。安装前应为主机设置静态地址或 DHCP 保留。

- 地址为 DHCP 租约时，安装器给出警告。
- 主机失去该地址时，看门狗报告 `host-address`（严重，持续 5 分钟后）。见[故障排查](/operations/troubleshooting#host-address-changed)。
- k3s 节点名在安装时固定，修改主机名不受影响。

## 时间同步 {#time-sync}

主机时钟必须由 NTP 同步。登录验证码和会话按时钟过期；签名时间偏差超过 15 分钟时，S3 会拒绝异地副本上传；时钟偏差过大还会导致证书校验失败。

- 安装器开启 NTP（`timedatectl set-ntp true`；没有可启用的客户端时安装 chrony），并等待时钟完成同步。由其他方式校时的主机可设置 `FELIS_MANAGE_TIME_SYNC=0`。
- 放行出站 UDP 123；防火墙丢弃该流量时，时钟将无法同步。
- 看门狗将未同步的时钟报告为 `clock`（警告，持续 30 分钟后）。可用 `timedatectl`（应显示 `System clock synchronized: yes` 和 `NTP service: active`）和 `chronyc sources` 检查。见[故障排查](/operations/troubleshooting#clock)。

## 安装前检查 {#preflight}

安装器在修改主机前先检查主机，一次性报告全部问题；存在问题时停止，主机保持原样。检查项如下：

- **平台**：架构（`x86_64` 或 `aarch64`）、systemd 是否为 init，以及 k3s 所需的内存 cgroup 控制器。在 Raspberry Pi 上，需在 `/boot/firmware/cmdline.txt` 中添加 `cgroup_memory=1 cgroup_enable=memory` 并重启。
- **内存**：低于 1.75 GiB 时拒绝安装（标称「2 GB」的 VPS 可以通过）；低于 3.5 GiB 时警告。
- **可用磁盘空间**：按安装器写入的每个文件系统检查，多个目录位于同一文件系统时累加：

  | 目录 | 所需可用空间（首次安装） | 重新安装或目录已有数据时 |
  | --- | --- | --- |
  | `/var/lib/rancher` | 10 GiB | 3 GiB |
  | `/var/lib/felis` | 安装发布版时 4 GiB，否则 2 GiB | 3 GiB 或 1 GiB |
  | `/opt/felis` | 3 GiB | 1 GiB |
  | `/var/lib/containerd`（仅在主机上构建镜像时） | 8 GiB | 2 GiB |

  在只有一个文件系统的空白主机上，合计约为：安装发布版 17 GiB，使用 `FELIS_ARTIFACT_DIR` 15 GiB，在主机上构建镜像 23 GiB；重新安装约 7 GiB。安装后文件系统占用将超过 85% 时给出警告，因为 k3s 此时会开始删除缓存镜像。
- **端口**：游戏端口、6443、6444、10248、10249、10250、10256、10257、10259、面板端口、镜像仓库回环端口 5000 和数据库回环端口 15432。被安装器自身服务占用的端口（重新安装时）视为通过；被其他程序占用时，报告该程序的名称。
- **其他 Kubernetes**：主机上存在其他发行版（kubelet、RKE2、k0s、MicroK8s）或 k3s agent 时拒绝安装。
- **网段**：主机地址或其路由的网络落在 `10.42.0.0/16` 或 `10.43.0.0/16` 内时拒绝安装；覆盖这两个网段的更大范围路由给出警告。
- **出站 HTTPS**：检查本次安装的各个下载地址（见[出站访问](#outbound)）。完成 TLS 握手即视为可达，每个地址最多尝试三次、间隔两秒，无法访问的地址在一条消息中列出（`cannot reach … over HTTPS`）。安装发布版时，Docker Hub 不可达仅给出警告；使用 `FELIS_ARTIFACT_DIR` 时不检查 Docker Hub。

检查结果与实际情况不符时，可设置 `FELIS_PREFLIGHT=warn`，将相同问题降为警告并继续安装。
