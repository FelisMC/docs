---
title: 安装与部署
description: 在 Linux 主机上安装 Felis，完成设置向导并创建首位所有者。
---

# 安装与部署 {#deployment}

本页说明如何在一台 Linux 主机上安装 Felis：选择发布通道、执行安装命令、完成设置向导并创建首位所有者，以及检查安装结果。本页面向负责部署主机的运维人员。

::: danger 仅提供开发快照
当前仅提供开发快照，公开 Release 已撤下。请仅在隔离的测试主机上安装，切勿用于生产环境。
:::

## 准备工作 {#before-you-begin}

开始安装前，确认以下条件：

- 主机运行受支持的 Linux 发行版与架构，配置满足资源要求，参见[支持的主机](/guide/requirements#supported-hosts)与[资源规划](/guide/requirements#sizing)。
- 具有 root 权限，或可以执行 `sudo`。
- 主机使用固定 IPv4 地址（静态地址或 DHCP 地址保留），并可通过 HTTPS 访问安装所需的下载源，参见[网络](/guide/requirements#network)。
- 使用自有域名时，`<根域名>`、`console.<根域名>`、`op.console.<根域名>` 与 `*.<根域名>` 均解析到主机。通配符记录不覆盖三级域名 `op.console.<根域名>`，须单独添加记录。未指定域名时，安装器使用 `<节点 IP>.nip.io`。

安装器在修改主机之前执行安装前检查，发现问题时一次性列出全部问题并退出，主机保持原状。检查项见[安装前检查](/guide/requirements#preflight)。

## 发布通道 {#channels}

安装器通过 `FELIS_VERSION_BOOTSTRAP` 选择安装来源：

| 通道 | 取值 | 安装来源 |
| --- | --- | --- |
| 发布版 | `release`（默认） | 下载最新发布版本的附件：`felis` 二进制（内含面板）、全部镜像与 Velocity 插件，逐一按 `SHA256SUMS` 校验后使用。主机无需安装 Docker，也无需访问 Docker Hub。某个附件缺失或校验失败时，仅该部分改为在本机构建，安装器输出提示。 |
| 开发版 | `dev` | 跟随 `main` 分支，克隆源码并在本机构建。构建期间安装器安装 Docker，镜像推送到集群内镜像仓库后停止 Docker。 |

以下变量可进一步指定版本：

- `FELIS_REF=<分支、标签或提交>`：从源码构建指定版本，优先于通道设置。
- `FELIS_RELEASE=<标签>`：在发布版通道中安装指定的较早发布版本，用于回退。须同时使用该标签对应的安装脚本。

::: info 说明
当前仅提供开发快照，安装时须显式选择 `dev` 通道。
:::

## 执行安装 {#install}

1. 以具有 sudo 权限的用户登录主机。
2. 执行安装命令（开发版通道）：

   ```bash
   curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo FELIS_VERSION_BOOTSTRAP=dev bash
   ```

3. 安装器询问安装类型时，选择 `[1] Felis`，即完整控制面。`[2] Felis-nano` 仅安装 Yggdrasil 多认证源聚合服务，供只需要多认证源登录的第三方服务器使用，不包含 k3s、数据库与面板。
4. 等待安装完成。安装器输出摘要后，在交互式终端中自动启动设置向导，见[设置向导](#setup-wizard)。

`sudo` 会重置环境变量。安装变量须写在 `sudo` 与 `bash` 之间，或先执行 `export` 再使用 `sudo -E bash`：

```bash
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo FELIS_VERSION_BOOTSTRAP=dev FELIS_ROOT_DOMAIN=mc.example.com bash
```

安装命令可以重复执行。重复执行会将主机收敛到目标状态，已生成的密钥保存在 `/etc/felis/secrets.env` 中并继续沿用。重复执行时沿用已安装的根域名，发布通道须重新指定。升级流程见[升级](/operations/upgrade#update)。

### 常用安装变量 {#installer-variables}

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FELIS_VERSION_BOOTSTRAP` | `release` | 发布通道：`release` 或 `dev`。 |
| `FELIS_REF` | 空 | 从源码构建指定的分支、标签或提交。 |
| `FELIS_RELEASE` | 最新发布版本 | 安装指定的发布版本。 |
| `FELIS_ARTIFACT_DIR` | 空 | 从本地目录安装发布附件，见[使用预先下载的发布附件安装](#offline-install)。 |
| `FELIS_INSTALL_MODE` | 交互式询问 | 安装类型：`full` 或 `nano`。 |
| `FELIS_NO_SETUP` | 空 | 设为 `1` 时，安装结束后不启动设置向导。 |
| `FELIS_ROOT_DOMAIN` | `<节点 IP>.nip.io` | 根域名，仅在首次安装时生效。更换根域名见[更换根域名](/operations/access#change-domain)。 |
| `FELIS_PANEL_NODEPORT` | `30443` | 面板与 API 的本机 HTTPS 端口。 |
| `FELIS_PREFLIGHT` | `strict` | 设为 `warn` 时，安装前检查发现的问题仅作为警告，安装继续进行。 |
| `FELIS_WORLDS_HOST_PATH` | 空 | 世界卷所在的节点目录（k3s 为 `/var/lib/rancher/k3s/storage`）。设置后启用闲置世界回收，见[世界回收](/operations/backup#world-cleanup)。 |
| `FELIS_VELOCITY_XMX` | `1G` | 游戏代理的最大堆内存，至少 `256M`。 |
| `FELIS_DB_BACKUP_TIME` | `*-*-* 03:30:00` | 数据库每日备份时间，使用 systemd 日历表达式。 |
| `FELIS_DB_BACKUP_KEEP` | `14` | 保留的每日数据库备份份数。 |
| `FELIS_OFFSITE_BUCKET`、`FELIS_OFFSITE_ENDPOINT` | 空 | 异地副本的存储桶与服务地址，另需 `FELIS_OFFSITE_ACCESS_KEY` 与 `FELIS_OFFSITE_SECRET_KEY`。设置后启用异地副本，见[异地副本](/operations/backup#offsite)。 |
| `FELIS_WATCHDOG_HEARTBEAT_URL` | 空 | 外部监控服务的心跳地址，见[外部心跳](/operations/monitoring#heartbeat)。 |
| `FELIS_RESTORE_FROM_OFFSITE` | `0` | 设为 `1` 时，安装完成后从旧安装的异地副本重建本机，见[整机重建](/operations/backup#rebuild-host)。 |

在面板中修改过的数据库备份计划与游戏代理内存保存在 `/etc/felis/host-settings.env`，重复执行安装时作为默认值；本次执行时显式设置的变量优先。完整的变量列表见[安装变量](/reference/configuration#installer-variables)。

### 安装内容 {#what-gets-installed}

完整安装在主机上部署以下组件：

- k3s 单节点集群，以及运行在其中的 PostgreSQL（`felis-postgres`，数据位于 `/var/lib/felis/postgres`）、Felis API、operator 与集群内镜像仓库。
- 游戏代理（Velocity），以 systemd 服务 `felis-velocity` 运行在主机上，使用安装器下载的 Temurin JRE，监听游戏端口 25565。
- 登录空间（`login`）与正式大厅（`lobby`）两个系统服务器，由设置向导创建。
- 主机节点操作服务 `felis-node-control.service`，供面板执行主机运维任务。
- systemd 定时任务：数据库每日备份（`felis-db-backup.timer`）、看门狗巡检（`felis-watchdog.timer`，每 2 分钟一次）、版本检查（`felis-update-check.timer`，每天一次），以及配置后启用的异地副本同步（`felis-offsite.timer`，每小时一次）。
- 已启用的主机防火墙（firewalld 或 ufw）中放行所需端口的规则、NTP 时间同步，以及持久化的系统日志（默认上限 1G）。

内存较小的主机上，安装器还会创建交换文件。管理员 kubeconfig `/etc/rancher/k3s/k3s.yaml` 仅 root 可读，使用 `sudo k3s kubectl` 访问集群。各组件的作用与数据位置见[运维概览](/operations/#components)。

## 设置向导 {#setup-wizard}

设置向导 `felis setup` 配置面板访问方式与上传存储，并创建首位所有者。安装器仅在交互式终端中自动启动向导；输出重定向到日志文件或通过 cloud-init 安装时，在安装结束后执行：

```bash
sudo felis setup
```

设置 `FELIS_NO_SETUP=1` 时，安装器在输出摘要后直接结束。

向导依次执行以下步骤，已完成的步骤可用方向键回看：

| 步骤 | 内容 |
| --- | --- |
| Preflight | 确认控制面已就绪。 |
| Connection | 选择面板访问方式，见[访问方式](#access-method)。 |
| Storage | 选择投稿上传内容的存储位置，见[上传存储](#wizard-storage)。 |
| Panel login | 创建所有者账户并生成一次性设置链接，见[创建首位所有者](#first-owner)。 |

向导结束时创建登录空间与正式大厅。登录空间或大厅创建失败不影响面板初始化，可在面板中排查。

### 访问方式 {#access-method}

| 选项 | 说明 |
| --- | --- |
| Local only | 不安装额外组件，通过主机地址与面板端口访问。 |
| Cloudflare Tunnel + Access | 创建 Cloudflare 隧道并配置域名路由，为管理控制台启用 Cloudflare Access，随后对公网关闭面板端口。需要在浏览器中授权 cloudflared，并提供可编辑 Access 应用的 API 令牌。 |
| Reverse proxy | 由自有反向代理（如 Caddy、nginx、Traefik）终止 TLS，向导输出反向代理的配置指引。 |

在此步骤按 Esc 等同于选择 Local only。Local only 与反向代理方式下，管理控制台仅由所有者的登录凭据（通行密钥或邮箱验证码）保护；Cloudflare Access 在此之前增加一层边缘校验。访问方式可在面板「平台设置 → 访问与安全 → 访问方式与域名」中更改，详见[访问方式](/operations/access#access-methods)。

### 上传存储 {#wizard-storage}

玩家投稿的模组包构建上下文保存在所选位置：

- Local disk：保存在本机磁盘，适合单节点安装。
- Object storage：保存在 S3 兼容存储桶（如 AWS S3、MinIO、Cloudflare R2）中，需填写服务地址、存储桶、区域（可选）与访问密钥。密钥保存在 Kubernetes Secret 中。

存储位置可在面板「平台设置 → 访问与安全 → 上传存储」中更改，详见[上传存储](/operations/storage#upload-storage)。

### 创建首位所有者 {#first-owner}

1. 在向导的 Panel login 步骤中，向导创建所有者账户（无密码），并在终端输出一次性设置链接。链接 30 分钟内有效。
2. 在浏览器中打开该链接。
3. 填写邮箱地址，选择「保存并继续」。邮件服务可稍后配置，不影响初始化。
4. 选择「创建通行密钥」，使用指纹、面容或设备 PIN 注册通行密钥。完成初始化前必须注册通行密钥。
5. 进入运维控制台。整个过程无需启动 Minecraft。

Minecraft 角色可稍后在「账户」页关联，见[关联账户](/guide/players#account-linking)。

链接过期或网页初始化未完成时，再次执行 `sudo felis setup` 即可获得新链接；已设置登录凭据的账户不会被重置。所有者创建后再次执行 `sudo felis setup`，可修改邮件服务、访问方式与上传存储。所有者无法登录时，使用[应急访问](/operations/access#break-glass)恢复。

::: tip 提示
通行密钥与面板域名绑定。通过 IP 地址直接访问面板时无法使用通行密钥，请使用配置的域名注册与登录。
:::

## 使用预先下载的发布附件安装 {#offline-install}

主机无法下载 GitHub 发布附件时，可在另一台机器上下载附件，复制到主机后通过 `FELIS_ARTIFACT_DIR` 安装。此时 Felis 自身的二进制、镜像与插件均从该目录读取，安装器不下载也不构建这些内容。

1. 在可访问 GitHub 的机器上下载对应架构的发布附件：

   ```bash
   gh release download <标签> --repo FelisMC/Felis --dir felis-<标签> \
     --pattern 'felis-*linux-amd64*' --pattern felis-velocity.jar --pattern SHA256SUMS
   ```

   ARM64 主机将 `amd64` 替换为 `arm64`。`SHA256SUMS` 包含两种架构的条目，另一架构的文件可以不下载。
2. 下载同一标签的安装脚本 `https://raw.githubusercontent.com/FelisMC/Felis/<标签>/deploy/bootstrap.sh`。
3. 将附件目录与安装脚本复制到主机，例如 `/root/felis-<标签>`。
4. 在主机上以绝对路径指定附件目录并执行安装：

   ```bash
   sudo FELIS_ARTIFACT_DIR=/root/felis-<标签> bash bootstrap.sh
   ```

目录中缺少附件或附件校验失败时，安装器停止安装。`FELIS_ARTIFACT_DIR` 不能与 `FELIS_REF` 或 `FELIS_SKIP_FETCH` 同时使用。

以下软件仍需联网下载：k3s 及其镜像、JRE、cloudflared、Velocity 与 Via 插件来自 GitHub 和 PaperMC；启用 SELinux 的 Red Hat 与 SUSE 系主机还从 rpm.rancher.io 安装 k3s-selinux；系统软件包来自发行版软件源。出站访问受限的主机须放行这些地址的 HTTPS 访问，或设置 `https_proxy`。目前不支持完全离线安装。地址清单见[网络](/guide/requirements#network)。

## 检查安装结果 {#verify-install}

安装与设置完成后，按以下步骤确认 Felis 正常运行：

1. 查看整体状态。命令汇总节点、控制面、游戏代理、各服务器、备份与未解决的告警：

   ```bash
   sudo felis status
   ```

2. 执行健康检查。命令按模块列出问题与排查方向，执行过程中不发送邮件：

   ```bash
   sudo felis doctor
   ```

3. 确认控制面 Pod 均处于 `Running` 状态，游戏代理服务正在运行：

   ```bash
   sudo k3s kubectl -n felis get pods
   sudo systemctl status felis-velocity
   ```

4. 在浏览器中打开运维控制台，使用通行密钥以所有者身份登录。
5. 使用 Minecraft Java 版连接游戏地址，确认进入登录空间。代理日志可通过 `sudo journalctl -u felis-velocity -f` 查看。

安装后的访问地址如下：

| 用途 | 地址 |
| --- | --- |
| 运维控制台（所有者、管理员） | `https://op.console.<根域名>`；Local only 方式下为 `https://op.console.<根域名>:30443` |
| 玩家控制台 | `https://console.<根域名>`；Local only 方式下为 `https://console.<根域名>:30443` |
| 通过 IP 直接访问 | `https://<节点 IP>:30443`，证书为自签名，浏览器首次访问时提示确认；此方式无法使用通行密钥 |
| 游戏地址 | `<节点 IP>:25565`，可将 `mc.<根域名>` 解析到此地址；各服务器的地址为 `<子域名>.<根域名>` |

「账户」页显示进服地址，以及登录空间与正式大厅所需的 Minecraft Java 版客户端版本。安装器将实际构建的版本写入 `felis.toml` 的 `[velocity].game_version`；使用自定义登录空间或大厅镜像时须自行填写，未填写时面板显示版本未配置。

发现问题时，参见[故障排查](/operations/troubleshooting#first-steps)。

## 后续步骤 {#next-steps}

- 在「平台设置 → 通知与保留 → 邮件服务」中配置邮件服务，用于发送登录验证码与告警，见[平台设置](/guide/administration#platform-settings)。
- 配置异地副本，使备份保存在主机之外，见[异地副本](/operations/backup#offsite)。
- 设置认证源与玩家进入策略，见[认证源](/guide/players#auth-sources)与[玩家进入策略](/guide/players#entry-policy)。
- 创建第一台服务器，见[创建服务器](/guide/servers#create-server)。
