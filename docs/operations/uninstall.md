---
title: 卸载与重装
description: 从主机上卸载 Felis、卸载时保留与删除的内容，以及在保留的数据上重新安装。
---

# 卸载与重装 {#uninstall-and-reinstall}

本页面向运维人员，说明如何从主机上卸载 Felis、两种卸载模式分别保留和删除哪些内容，以及如何在保留的数据上重新安装并恢复服务器和世界。迁移到另一台主机见[计划迁移](/operations/backup#move-host)。

## 卸载 {#uninstall}

卸载脚本 `deploy/uninstall.sh` 移除安装器在主机上安装的内容。它先打印将移除的内容并要求确认：默认模式须输入 `yes`，`--purge` 模式须输入 `purge`；`--yes` 跳过确认。

```bash
# 卸载 Felis 并保留数据
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/uninstall.sh | sudo bash -s -- --yes
# 卸载 Felis 并删除数据
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/uninstall.sh | sudo bash -s -- --purge
```

| 选项 | 说明 |
| --- | --- |
| `--purge` | 同时删除 `/etc/felis` 和 `/var/lib/felis`（数据库集群、数据库备份包以及之前卸载时保留的数据），以及世界、归档、Felis 镜像和 Docker 构建缓存 |
| `--keep-k3s` | 保留 k3s，只删除 Felis 的命名空间和 CRD |
| `--remove-k3s` | 即使集群中还有其他工作负载，也运行 k3s 自身的卸载程序 |
| `--no-backup` | 跳过保留数据模式在卸载前创建的最终数据库备份包 |
| `--yes` | 不要求确认 |

两种模式都会移除：

- Felis 的 systemd 单元：各定时任务（`felis-db-backup`、`felis-watchdog`、`felis-offsite`、`felis-build-tools`、`felis-update-check`）及其服务、`felis-watchdog-failed.service`、`felis-velocity.service`、`felis-nano.service`、`cloudflared-felis.service`，以及早期发布版的 `felis-postgres-firewall.service`。
- 游戏代理的系统用户 `felis-velocity`、`/opt/felis` 和 `/usr/local/bin/felis`。
- 中断的安装留在 `/var/lib/felis/artifacts` 中的发布版附件。
- 安装器放置的 cloudflared 程序（仍被其他服务单元使用时保留）。
- nftables 表 `felis_edge`（以及早期发布版的 `felis_postgres`）、安装器在 firewalld 中开放的端口和带 `felis-` 注释的 ufw 规则；k3s 网段的放行规则只在卸载 k3s 时移除。

k3s 的处理方式：集群中只有 Felis 的命名空间时，用 k3s 自带的 `k3s-uninstall.sh` 卸载 k3s；集群中还运行其他工作负载时，只删除 `felis`、`minecraft`、`felis-build` 命名空间和 MinecraftServer CRD。`--keep-k3s` 和 `--remove-k3s` 可覆盖这一选择。k3s 无法响应时，脚本无法判断集群中是否有其他工作负载，会停止并提示启动 k3s（`systemctl start k3s`）或指定其中一个选项。

::: danger 警告
`--purge` 删除数据库、数据库备份包、所有世界和世界归档，无法恢复。执行前确认已在主机之外保存需要的备份，见[备份与恢复](/operations/backup#offsite)。
:::

### 保留与删除的内容 {#kept-data}

| 内容 | 默认（保留数据） | `--purge` |
| --- | --- | --- |
| 最终数据库备份包 | 卸载前先执行 `felis db backup -label manual`；失败时在删除任何内容前停止。`--no-backup` 跳过 | 不创建 |
| 数据库（`/var/lib/felis/postgres`） | 保留；卸载 k3s 前先正常停止 felis-postgres | 随 `/var/lib/felis` 删除 |
| 早期发布版在宿主机上安装的 PostgreSQL | 保持原状：迁入 k3s 后已停止，保留其中的 `felis` 旧副本 | 删除其中的 `felis` 数据库和角色（为此临时启动再停止该服务器），并将 `listen_addresses` 和 `pg_hba.conf` 恢复原状。若该角色仍拥有其他数据库或在其他位置有授权，则在删除任何内容前停止，列出这些对象和需要执行的 `ALTER DATABASE … OWNER TO postgres` |
| `/etc/felis`（机密、`felis.toml`、`offsite.env`、`felis setup` 记录的邮件中继密码和上传存储密钥、隧道配置） | 保留；删除 `bootstrap.done` 和每次运行的记录 | 连同隧道凭据文件一起删除 |
| `/var/lib/felis`（数据库及其备份包） | 保留 | 删除 |
| 世界、归档、镜像仓库、上传文件 | 移至 `/var/lib/felis/retained/k3s-storage-<时间戳>/`；使用 `--keep-k3s` 时，其卷的回收策略改为 `Retain` 并留在原处 | 删除 |
| Felis 镜像、Docker 构建缓存 | 保留 | 删除 |

### 清理主机软件包 {#remove-packages}

两种模式都不卸载软件包（Docker、git、nftables，以及早期发布版安装的 PostgreSQL 服务器），也不删除低内存主机上创建的 swap 文件，因为其他软件可能在使用它们。需要将主机恢复为空白状态时：

```bash
sudo swapoff /swapfile && sudo rm /swapfile && sudo sed -i '\|^/swapfile |d' /etc/fstab
sudo dnf remove docker-ce docker-ce-cli containerd.io postgresql-server   # 或使用 apt/zypper/pacman
```

### 清理 Cloudflare 资源 {#cloudflare-cleanup}

Cloudflare 上的资源独立于主机存在。确定不再重装后，在 Cloudflare 中删除：

1. 隧道：Zero Trust → Networks → Tunnels，或执行 `cloudflared tunnel delete <name>`（Felis 创建的隧道名为 `felis`）。
2. 面板域名和管理控制台域名的 DNS 记录。
3. 管理控制台的 Access 应用。

## 在保留的数据上重装 {#reinstall}

保留数据模式留下了重装所需的全部内容。安装器复用 `/etc/felis/secrets.env`，因此数据库密码、转发密钥和会话密钥保持不变；felis-postgres 在 `/var/lib/felis/postgres` 中保留的集群上重新启动，安装器对已有数据库执行迁移，不会新建数据库。

以下步骤适用于默认模式（k3s 已随卸载移除，卷已移至 `retained` 目录）。先设置两个变量：`kept` 指向卸载时移出的卷目录，`store` 是新集群的卷目录。

```bash
kept="$(ls -d /var/lib/felis/retained/k3s-storage-* | tail -n 1)"
store=/var/lib/rancher/k3s/storage
```

1. 按[安装与部署](/guide/deployment#install)正常安装。安装器从保留的 `felis.host.toml` 读取根域名；原根域名不是默认的 `<IP>.nip.io` 时，以 `FELIS_ROOT_DOMAIN` 指定相同的根域名。

2. 执行 `sudo felis setup`。它重新创建登录空间和大厅；所有者已存在，因此直接进入状态页面，可以退出。

3. 恢复镜像仓库和上传文件。其中保存所有自定义服务器镜像和上传的文件；缺少镜像仓库时，恢复的服务器无法拉取镜像。

   ```bash
   sudo k3s kubectl -n felis scale deploy/registry deploy/felis-api --replicas=0
   sudo k3s kubectl -n felis wait --for=delete pod -l app.kubernetes.io/component=registry --timeout=120s
   sudo k3s kubectl -n felis wait --for=delete pod -l app.kubernetes.io/component=api --timeout=120s
   sudo rsync -a --delete "$kept"/pvc-*_felis_registry/ "$(ls -d $store/pvc-*_felis_registry)"/
   sudo rsync -a --delete "$kept"/pvc-*_felis_felis-uploads/ "$(ls -d $store/pvc-*_felis_felis-uploads)"/
   sudo k3s kubectl -n felis scale deploy/registry deploy/felis-api --replicas=1
   ```

   然后再运行一次安装器，将当前发布版的镜像推送到恢复的镜像仓库中，覆盖其中的旧版本。

4. 恢复游戏服务器。最终数据库备份包保存了全部 MinecraftServer 资源；筛选条件跳过第 2 步已为当前发布版重新创建的登录空间和大厅：

   ```bash
   b="$(ls -t /var/lib/felis/db-backups/felis-db-*-manual.tar | head -n 1)"
   tar -xOf "$b" k8s/minecraftservers.json \
     | sudo k3s kubectl apply -l '!felis.lolicon.best/system-role' -f -
   ```

5. 逐台恢复世界。服务器的卷在其首次启动后才存在，因此先在面板中启动服务器，再将其停止，然后用保留的世界覆盖新世界：

   ```bash
   s=<服务器名称>
   sudo rsync -a --delete "$kept"/pvc-*_minecraft_world-$s-0/ "$(ls -d $store/pvc-*_minecraft_world-$s-0)"/
   ```

   然后启动该服务器。大厅的处理方式相同：先停止它，复制 `world-lobby-0`，再将其改回 `Running`：

   ```bash
   sudo k3s kubectl -n minecraft patch minecraftserver lobby --type=merge -p '{"spec":{"desiredState":"Stopped"}}'
   ```

6. 恢复世界归档，使面板中的恢复点重新可用。归档卷在首次备份时创建，因此先在面板中备份任意一台服务器，然后执行：

   ```bash
   sudo rsync -a "$kept"/pvc-*_minecraft_felis-backups/ "$(ls -d $store/pvc-*_minecraft_felis-backups)"/
   ```

   已配置异地存储桶时，也可以改用 `sudo felis offsite fetch-worlds` 从存储桶获取归档。

7. 所有服务器恢复后，删除 `/var/lib/felis/retained/`。
