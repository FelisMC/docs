---
title: 存储与磁盘
description: Felis 在主机上的数据存放位置、扩容磁盘与将数据迁移到独立磁盘的方法、上传内容的存储位置，以及磁盘写满后的恢复。
---

# 存储与磁盘 {#storage}

本页面向主机管理员，说明 Felis 写入磁盘的内容及其增长情况、扩容磁盘或将数据迁移到独立磁盘的方法、投稿上传内容的存储位置，以及磁盘写满后的恢复方法。

## 磁盘布局 {#disk-layout}

### 数据存放位置 {#disk-usage}

| 内容 | 位置 | 大小 |
| --- | --- | --- |
| 世界 | `/var/lib/rancher/k3s/storage` 下每台服务器一个卷 | 随各世界增长 |
| 世界归档 | `felis-backups` 卷 | 每份保留的备份约为一个压缩后的数据卷 |
| 集群内镜像仓库 | `registry` 卷 | 默认镜像 2–3 GB，随自定义构建增长 |
| 投稿上传内容 | 上传内容保存在本机时为 `felis-uploads` 卷 | 不超过上传限制（见[上传存储](#upload-storage)） |
| k3s 容器镜像 | `/var/lib/rancher/k3s/agent/containerd` | 6–9 GB |
| Docker 镜像与构建缓存 | 自行构建镜像的主机上的 `/var/lib/containerd` | 多次升级后 5–10 GB |
| 安装期间的发布版附件 | `/var/lib/felis/artifacts` | 最多约 2 GB，镜像进入镜像仓库后删除 |
| 工具链与源码 | `/opt/felis` | 约 2.5 GB |
| 数据库 | `/var/lib/felis/postgres` | 数十 MB，主要是审计日志 |
| 数据库备份包 | `/var/lib/felis/db-backups` | 每份数 MB；默认保留 14 份每日备份包 |
| 系统日志 | `/var/log/journal` | 上限为 `FELIS_JOURNAL_MAX_USE`（默认 1G） |

内存不足 2 GB 且没有 swap 的主机上，安装器还会添加 2 GiB 的 `/swapfile`。

世界备份会归档服务器的完整数据卷，包括依赖库和缓存，因此标准 Paper 服务器在世界尚未增长时，其归档约为 170 MB（见[备份包含的内容](/operations/backup#backup-contents)）。

### 卷容量 {#volume-sizes}

镜像仓库卷、上传卷和世界归档卷在首次安装时申请容量：

| 卷 | 安装变量 | 默认申请容量 |
| --- | --- | --- |
| `registry` | `FELIS_REGISTRY_STORAGE` | 10Gi |
| `felis-uploads` | `FELIS_UPLOADS_STORAGE` | 5Gi |
| `felis-backups` | `FELIS_BACKUP_STORAGE` | 10Gi |

在 k3s 的 local-path 存储上，申请的容量不会强制生效：每个卷都是节点磁盘上的一个目录，可以超出申请容量。因此所有卷共用存放 `/var/lib/rancher/k3s` 的文件系统。重新运行安装器时，已有卷声明保持原容量；变量要求不同容量时，安装器给出警告。

限制增长的机制：

- **世界归档**：备份保留策略及可选的备份存储上限（见[保留策略](/operations/backup#retention)）。若写入归档后归档文件系统的可用空间将低于 10%，备份 Job 拒绝写入。
- **镜像仓库**：felis-api 每 6 小时删除一次无人使用的镜像清单，镜像仓库每天释放一次不再被任何清单引用的镜像层。最近 24 小时内推送的镜像、白名单中的镜像、服务器固定使用的镜像，以及每个平台仓库最新的 5 个带标签构建都会保留。
- **Docker 构建缓存**：在自行构建镜像的主机上空间不足时，启动 Docker 后执行 `docker builder prune -af` 回收；下次升级会重新构建。

主机至少应准备 **40 GB**；世界和自定义镜像增多后，建议 60 GB 以上。安装器的预检会检查所需的可用空间（见[安装前检查](/guide/requirements#preflight)），并在安装后文件系统占用将超过 85% 时警告：k3s 在此时开始删除缓存镜像，接近 95% 时会驱逐 Pod。

### 磁盘监控 {#disk-monitoring}

看门狗监控根文件系统，以及作为独立文件系统时的 `/var/lib/rancher/k3s`。被监控的文件系统可用空间低于 15% 持续 15 分钟时发出警告；低于 5% 持续 5 分钟时发出严重告警。节点上的 kubelet 磁盘压力在 2–5 分钟后触发严重告警。详见[看门狗](/operations/monitoring#watchdog)。

「维护与备份 → 状态」显示各磁盘的可用空间，仪表盘向所有者显示占用最高的磁盘。在命令行中，`sudo felis status` 输出相同的信息。

## 扩容磁盘 {#grow-disk}

除非已将数据迁移到独立磁盘（见[将数据迁移到独立磁盘](#move-data)），上述数据都位于根文件系统，因此增加空间即扩大根文件系统。扩容可在服务运行时原地完成：先在云服务商处扩大虚拟磁盘，再扩大分区及其上的文件系统。

前提条件：

- 已在云服务商处扩大虚拟磁盘。
- 已安装 `growpart`：RHEL 系为 `cloud-utils-growpart`，Debian 和 Ubuntu 为 `cloud-guest-utils`。

::: danger
输错磁盘或分区编号可能损坏文件系统。请先备份全部世界（第 1 步），并从 `lsblk` 的输出中核对设备名称后再输入。
:::

1. 归档全部世界。运行中的服务器以不停服方式备份，玩家保持在线：

   ```bash
   sudo felis backup-now -yes
   ```

   也可在「维护与备份 → 备份」中使用「立即备份世界」（见[备份全部世界](/operations/backup#backup-now)）。

2. 确认存放 `/` 的磁盘和分区，以及其上是否使用 LVM：

   ```bash
   lsblk -f
   ```

3. 扩大分区。以下示例为 `/dev/vda` 的第 3 个分区：

   ```bash
   sudo growpart /dev/vda 3
   ```

4. 扩大文件系统。使用 LVM 时（RHEL 系默认）：

   ```bash
   sudo pvresize /dev/vda3
   sudo lvextend -r -l +100%FREE /dev/<vg>/root    # -r grows the filesystem with it
   ```

   不使用 LVM 时，分别对应 XFS 和 ext4：

   ```bash
   sudo xfs_growfs /                               # xfs
   sudo resize2fs /dev/vda3                        # ext4
   ```

5. 确认新容量：

   ```bash
   df -h /
   ```

## 将数据迁移到独立磁盘 {#move-data}

主要数据位于 `/var/lib/rancher/k3s`：世界、世界归档、镜像仓库和镜像。迁移到独立磁盘后，数据增长不影响系统，世界存储写满也不会占满根文件系统。数据库及其备份包（`/var/lib/felis`）体积较小，保留在根磁盘。

迁移期间平台停止服务，停机时间为复制时间加一至两分钟。

::: warning
第 2 步会停止所有游戏服务器并断开玩家。从第 3 步起到第 4 步 k3s 重新运行为止，面板和游戏代理均不可用。
:::

1. 接入磁盘并创建文件系统。以下示例使用整块磁盘 `/dev/vdb`，请先用 `lsblk` 确认其为空：

   ```bash
   sudo mkfs.xfs /dev/vdb
   U=$(sudo blkid -s UUID -o value /dev/vdb)
   ```

2. 停止服务器以保存各世界，归档全部世界，并让看门狗在接下来一小时内保持静默（在标记中的时间之前不发送邮件，也不向心跳发送失败信号）：

   ```bash
   sudo felis backup-now -yes -stop
   sudo install -d -m 0755 /run/felis
   echo $(( $(date +%s) + 3600 )) | sudo tee /run/felis/watchdog-quiet-until
   ```

   也可不写标记，改为在「维护与备份 → 状态」中使用「暂停告警邮件」，将看门狗邮件暂停 1、4 或 24 小时（见[暂停告警邮件](/operations/monitoring#hold-alerts)）。

3. 停止 k3s 并复制数据：

   ```bash
   sudo systemctl stop k3s
   sudo /usr/local/bin/k3s-killall.sh       # the containers k3s leaves running, and their mounts
   sudo mkdir -p /mnt/felis-data
   sudo mount UUID=$U /mnt/felis-data
   sudo rsync -aHAX --numeric-ids /var/lib/rancher/k3s/ /mnt/felis-data/
   sudo umount /mnt/felis-data
   ```

   `-X` 保留 k3s 设置的 SELinux 标签。不要对副本执行 `restorecon`，否则 runc 和 CNI 二进制的 `container_runtime_exec_t` 标签会被重置为策略默认值。

4. 将磁盘挂载到原路径，并让 k3s 依赖该挂载：

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

   该 drop-in 用于保护数据。k3s 若在空挂载点上启动，会在其中创建一个新的空集群。有了 drop-in，磁盘无法挂载时 k3s 以 `A dependency job for k3s.service failed` 拒绝启动，`nofail` 则保证主机正常开机、便于远程访问。磁盘恢复后，`sudo systemctl start k3s` 会完成挂载并启动。

5. 确认所有 Pod 已就绪，且挂载点指向新磁盘：

   ```bash
   sudo k3s kubectl -n felis get pods
   findmnt /var/lib/rancher/k3s
   ```

6. 在面板中启动服务器，并删除静默标记：

   ```bash
   sudo rm /run/felis/watchdog-quiet-until
   ```

7. 主机正常运行一天后，释放根磁盘上的旧副本：

   ```bash
   sudo rm -rf /var/lib/rancher/k3s.old
   ```

看门狗已将 `/var/lib/rancher/k3s` 作为独立文件系统监控，新磁盘的占用情况与根磁盘一样会触发告警。

## 上传存储 {#upload-storage}

上传存储保存玩家提交整合包时上传的构建上下文（见[审核提交](/guide/administration#submissions)）。已通过审核的提交，其上下文会保留，供管理员重新构建镜像；被拒绝的提交，其上传内容在审核结论作出 7 天后删除。

可选两种存储位置：

| 位置 | 面板标签 | 说明 |
| --- | --- | --- |
| 本机磁盘 | 「本机存储」 | 主机上的 `felis-uploads` 卷。无需其他配置，适合单节点安装。异地副本包含这些上传内容。 |
| 兼容 S3 的存储桶 | 「兼容 S3 的存储桶」 | 外部存储桶（AWS S3、MinIO、Cloudflare R2 等）。felis-api 以 8 MiB 分块将完成的上下文转发到存储桶，单次上传上限约为 78 GiB。异地副本不包含保存在存储桶中的上传内容。 |

### 上传限制 {#upload-limits}

| 限制 | 数值 | 超出时 |
| --- | --- | --- |
| 单个上传的上下文（`[registry] context_max_bytes`） | 1Gi | 面板在上传前拒绝该文件 |
| 所有用户上传的上下文总量（`[registry] user_uploads_max_bytes`） | 4Gi | `507 uploads_full` |
| 单个用户保存的上传总量 | 2 GiB | `403 submission_quota_exceeded` |
| 上传卷的可用空间 | 10% | `507 uploads_full` |

面板以不超过 32 MiB 的分块发送上下文，分块暂存在上传卷的 `.parts/` 下，连接中断后可从已暂存的位置续传。24 小时未更新的暂存上传会被删除。暂存的数据计入上述限制。

### 更改上传存储 {#change-upload-storage}

::: warning
更改存储位置会使面板短暂重启。已保存的上传内容保留在原位置，不会迁移到新位置。
:::

在面板中：

1. 打开「平台设置 → 访问与安全」。
2. 在「上传存储」卡片中选择「存储位置」：「本机存储」或「兼容 S3 的存储桶」。
3. 选择存储桶时，填写「服务地址」「存储桶」「区域」（服务商需要时）、「访问密钥 ID」和「访问密钥」。
4. 选择「应用存储设置」并确认。

变更前会先检查存储桶；密钥、服务地址或存储桶有误时任务失败，安装保持原状。检查通过后写入配置并重启 felis-api。

在命令行中：

1. 执行 `sudo felis setup`。
2. 在状态页按 `s`（change storage）。
3. 选择本机磁盘或对象存储；选择对象存储时填写存储桶信息。

### 存储桶凭据 {#upload-credentials}

存储桶密钥保存在主机的 `/etc/felis/uploads-s3-access-key` 和 `/etc/felis/uploads-s3-secret-key`，以及 `felis-uploads-s3` Secret 中。每次运行安装器都会根据这两个文件重新应用该 Secret，因此手动修改 Secret 只能维持到下一次运行安装器。请通过「上传存储」卡片或 `felis setup` 更改凭据，两者都要求重新输入密钥。上传指向存储桶但缺少任一密钥时，安装器会给出提示，并指明可重新填写密钥的 `felis setup` 界面。

这两个密钥文件包含在每份数据库备份包中（见[备份包内容与保留](/operations/backup#bundle-contents)）。

## 磁盘写满后的恢复 {#disk-full}

磁盘写满是 Felis 主机上影响最大的故障。看门狗报告文件系统可用空间低于 15% 时，应尽快释放空间。相关症状及排查方法另见[故障排查](/operations/troubleshooting#disk-full-symptoms)。

### 磁盘写满的影响 {#disk-full-effects}

- **游戏服务器最先被驱逐。** kubelet 的磁盘压力驱逐会移除游戏服务器 Pod。控制面 Pod（felis-api、operator、世界回收、镜像仓库）以 `system-cluster-critical` 优先级运行，kubelet 不会驱逐它们，其日志会对每个此类 Pod 输出 `Eviction manager: cannot evict a critical pod`。
- **镜像可能被删除。** 发生驱逐后，kubelet 可能回收未被运行中 Pod 使用的镜像。Felis 运行的每个镜像也保存在集群内镜像仓库中，被删除的镜像会在下次尝试时自动重新拉取，无需人工处理。
- **备份安全停止。** 若写入归档后可用空间将低于 10%，备份 Job 拒绝写入（`not enough free disk for the archive`）；备份存储达到上限期间，每日恢复点暂停。磁盘写满导致数据库备份失败时，写了一半的 `.partial` 文件会被删除，之前的备份包保持完好。

### 释放空间并恢复 {#free-space}

1. 找出占用空间的内容：

   ```bash
   df -h /var/lib/rancher
   sudo k3s ctr images ls -q
   ```

   占用最多的通常是 k3s 容器镜像，以及 `/var/lib/rancher/k3s/storage` 下的世界卷和备份卷。

2. 通过以下一种或多种方式释放空间：

   - 在服务器备份页面删除不再需要的备份，并在「平台设置 → 通知与保留 → 备份与审计保留」中缩短保留时间或设置备份存储上限。已删除备份的归档在下一次每日回收运行时删除（见[世界回收](/operations/backup#world-cleanup)）。
   - 在自行构建镜像的主机上，启动 Docker 后执行 `docker builder prune -af`。
   - 迁移到独立磁盘并稳定运行一天后，删除 `/var/lib/rancher/k3s.old`（见[将数据迁移到独立磁盘](#move-data)）。
   - 扩容磁盘（见[扩容磁盘](#grow-disk)）。

3. 等待节点的磁盘压力状态解除。释放空间后，节点可能在最长约 5 分钟内仍报告 `DiskPressure:True`，需要调度的 Pod 会等待其解除。

4. 删除卡在拉取镜像的 Pod 可立即重试，也可等待下一次自动重试。随后工作负载会自行恢复。

::: danger
不要为释放空间而手动删除 `/var/lib/rancher/k3s/storage` 下的卷或世界卷声明。世界只存在于其数据卷中，没有备份时删除即永久丢失。
:::

### 镜像未能自动恢复时 {#disk-full-images}

1. 检查镜像仓库：

   ```bash
   sudo k3s kubectl -n felis get pods -l app.kubernetes.io/component=registry
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000/healthz
   ```

   镜像仓库运行时，健康检查返回 `200`。匿名访问 `GET /v2/` 按设计返回 `401`。

2. 检查镜像源映射文件：`/etc/rancher/k3s/registries.yaml` 必须将 `registry.felis.svc:5000` 映射到 `http://127.0.0.1:5000`。文件缺失或被改动时，重新运行安装器；安装器会重写该文件，仅在内容变化时重启 k3s。

3. 重新推送镜像仓库中缺少的标签。启动 Docker（安装器使 Docker 守护进程保持停止），以 `platform` 身份登录 `127.0.0.1:5000`，密码通过 `kubectl -n felis get secret felis-registry-auth -o jsonpath='{.data.platform}' | base64 -d` 获取，然后执行：

   ```bash
   sudo systemctl start docker
   docker tag <ref> 127.0.0.1:5000/<repo>:<tag> && docker push 127.0.0.1:5000/<repo>:<tag>
   ```

4. 镜像仓库和本机 Docker 存储中都没有的镜像，重新运行安装器即可：安装器会导入或重新构建镜像，并同步到镜像仓库。单个镜像可用 `docker save felis:<tag> | k3s ctr images import -` 导入 k3s。镜像仓库问题见[故障排查](/operations/troubleshooting#registry-errors)。
