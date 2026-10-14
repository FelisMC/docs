---
title: Storage and disks
description: Where Felis keeps its data on the host, how to grow the disk or move the data to its own disk, where uploads are stored, and how to recover from a full disk.
---

# Storage and disks {#storage}

This page is for the host operator. It describes what Felis writes to disk and what grows over time, how to enlarge the disk or move the data to a disk of its own, where submission uploads are stored, and how to recover when a disk fills up.

## Disk layout {#disk-layout}

### What is stored where {#disk-usage}

| What | Where | Size |
| --- | --- | --- |
| Worlds | one volume per server under `/var/lib/rancher/k3s/storage` | what each world grows to |
| World archives | the `felis-backups` volume | about one compressed data volume per backup kept |
| In-cluster registry | the `registry` volume | 2–3 GB for the stock images; grows with custom builds |
| Submission uploads | the `felis-uploads` volume, when uploads are stored on the host | up to the upload limits ([Upload storage](#upload-storage)) |
| k3s's container images | `/var/lib/rancher/k3s/agent/containerd` | 6–9 GB |
| Docker's images and build cache | `/var/lib/containerd`, on a host that built its images itself | 5–10 GB after repeated upgrades |
| Release assets during an installation | `/var/lib/felis/artifacts` | up to about 2 GB, deleted once the images are in the registry |
| Toolchains and sources | `/opt/felis` | about 2.5 GB |
| Database | `/var/lib/felis/postgres` | tens of MB; the audit log is most of it |
| Database bundles | `/var/lib/felis/db-backups` | a few MB each; 14 daily bundles kept by default |
| System journal | `/var/log/journal` | capped at `FELIS_JOURNAL_MAX_USE` (default 1G) |

On a host with less than 2 GB of RAM and no swap, the installer also adds a 2 GiB `/swapfile`.

A world backup archives the server's whole data volume, including libraries and cache, so a stock Paper server's archive is about 170 MB before its world grows ([What a backup contains](/en/operations/backup#backup-contents)).

### Volume sizes {#volume-sizes}

The registry, uploads and world-archive volumes request a size on the first installation:

| Volume | Installer variable | Default request |
| --- | --- | --- |
| `registry` | `FELIS_REGISTRY_STORAGE` | 10Gi |
| `felis-uploads` | `FELIS_UPLOADS_STORAGE` | 5Gi |
| `felis-backups` | `FELIS_BACKUP_STORAGE` | 10Gi |

On k3s's local-path storage the requested size is not enforced: each volume is a directory on the node's disk and can grow beyond it. Every volume therefore shares the filesystem that holds `/var/lib/rancher/k3s`. A rerun of the installer keeps an existing claim's size and warns when the variable asks for another.

What bounds growth:

- **World archives**: the backup retention and the optional backup store cap ([Retention](/en/operations/backup#retention)). A backup Job refuses to write an archive that would leave less than 10% of the archive filesystem free.
- **Registry**: every 6 hours felis-api deletes the image manifests nothing uses, and once a day the registry frees the layers no remaining manifest names. Images pushed in the last 24 hours, whitelisted images, images servers pin and the 5 newest tagged builds of each platform repository are kept.
- **Docker's build cache**: on a host that built its images, `docker builder prune -af` (with Docker started) reclaims it when space is short; the next upgrade rebuilds it.

Give the host at least **40 GB**, and 60 GB or more once worlds and custom images accumulate. The installer's preflight checks the free space it needs ([Preflight checks](/en/guide/requirements#preflight)) and warns when a filesystem would end above 85% full, where k3s starts deleting cached images; near 95% it evicts pods.

### Disk monitoring {#disk-monitoring}

The watchdog watches the root filesystem and `/var/lib/rancher/k3s` when it is a filesystem of its own. A watched filesystem below 15% free raises a warning after 15 minutes; below 5% free, a critical alert after 5 minutes. Kubelet disk pressure on the node raises a critical alert after 2–5 minutes. See [Watchdog](/en/operations/monitoring#watchdog).

**Maintenance & Backups → Status** shows each disk's free space, and the dashboard shows the Owner the fullest disk. On the command line, `sudo felis status` reports the same.

## Grow the disk {#grow-disk}

All the data above shares the root filesystem unless it was moved to its own disk ([Move the data to its own disk](#move-data)). More room therefore means a larger root filesystem. It grows in place while everything keeps running: enlarge the virtual disk at the provider, then the partition and the filesystem on it.

Prerequisites:

- The virtual disk has been enlarged at the provider.
- `growpart` is installed: `cloud-utils-growpart` on the RHEL family, `cloud-guest-utils` on Debian and Ubuntu.

::: danger
A mistyped disk or partition number can destroy the filesystem. Back up every world first (step 1), and read the device names from `lsblk` before typing them.
:::

1. Archive every world. Running servers are backed up live, and their players stay connected:

   ```bash
   sudo felis backup-now -yes
   ```

   The same is available as **Back up worlds now** on **Maintenance & Backups → Backups** ([Back up every world](/en/operations/backup#backup-now)).

2. Find the disk and partition that hold `/`, and whether LVM sits on it:

   ```bash
   lsblk -f
   ```

3. Grow the partition. The example uses partition 3 of `/dev/vda`:

   ```bash
   sudo growpart /dev/vda 3
   ```

4. Grow the filesystem. With LVM (the RHEL-family default):

   ```bash
   sudo pvresize /dev/vda3
   sudo lvextend -r -l +100%FREE /dev/<vg>/root    # -r grows the filesystem with it
   ```

   Without LVM, for XFS or ext4 respectively:

   ```bash
   sudo xfs_growfs /                               # xfs
   sudo resize2fs /dev/vda3                        # ext4
   ```

5. Confirm the new size:

   ```bash
   df -h /
   ```

## Move the data to its own disk {#move-data}

The bulk of the data lives under `/var/lib/rancher/k3s`: the worlds, the world archives, the registry and the images. On a disk of its own it grows without touching the system, and a full world store leaves the root filesystem alone. The database and its bundles (`/var/lib/felis`) are small and stay on the root disk.

The move takes the platform down for the time of the copy plus a minute or two.

::: warning
Every game server is stopped and its players are disconnected in step 2. The panel and the game proxy are unavailable from step 3 until k3s runs again in step 4.
:::

1. Attach the disk and create a filesystem on it. The example uses the whole disk `/dev/vdb`; confirm with `lsblk` that it is empty:

   ```bash
   sudo mkfs.xfs /dev/vdb
   U=$(sudo blkid -s UUID -o value /dev/vdb)
   ```

2. Archive every world, stopping the servers so that each one saves, and keep the watchdog quiet for the next hour (no mail, no failure pings to the heartbeat, until the time in the marker):

   ```bash
   sudo felis backup-now -yes -stop
   sudo install -d -m 0755 /run/felis
   echo $(( $(date +%s) + 3600 )) | sudo tee /run/felis/watchdog-quiet-until
   ```

   As an alternative to the marker, **Hold alert mail** on **Maintenance & Backups → Status** holds the watchdog's mail for 1, 4 or 24 hours ([Holding alert mail](/en/operations/monitoring#hold-alerts)).

3. Stop k3s and copy the data:

   ```bash
   sudo systemctl stop k3s
   sudo /usr/local/bin/k3s-killall.sh       # the containers k3s leaves running, and their mounts
   sudo mkdir -p /mnt/felis-data
   sudo mount UUID=$U /mnt/felis-data
   sudo rsync -aHAX --numeric-ids /var/lib/rancher/k3s/ /mnt/felis-data/
   sudo umount /mnt/felis-data
   ```

   `-X` carries the SELinux labels k3s set. Do not run `restorecon` on the copy: it would reset runc and the CNI binaries from `container_runtime_exec_t` to the policy default.

4. Mount the disk in place and tie k3s to the mount:

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

   The drop-in keeps the data safe. k3s started on an empty mount point would create a new, empty cluster there. With the drop-in, a disk that does not come up fails the start with `A dependency job for k3s.service failed`, and `nofail` keeps the host booting so that it stays reachable. Once the disk is back, `sudo systemctl start k3s` mounts it and starts.

5. Check that every pod is ready and that the mount names the new disk:

   ```bash
   sudo k3s kubectl -n felis get pods
   findmnt /var/lib/rancher/k3s
   ```

6. Start the servers from the panel, and remove the quiet marker:

   ```bash
   sudo rm /run/felis/watchdog-quiet-until
   ```

7. Once the host has run normally for a day, free the old copy on the root disk:

   ```bash
   sudo rm -rf /var/lib/rancher/k3s.old
   ```

The watchdog already watches `/var/lib/rancher/k3s` as a filesystem of its own, so the new disk's fill level is reported like the root's.

## Upload storage {#upload-storage}

Upload storage holds the build contexts that players upload with modpack submissions ([Submissions](/en/guide/administration#submissions)). An approved submission's context stays as the source an admin rebuilds the image from; a rejected submission's upload is deleted 7 days after the verdict.

Two locations are available:

| Location | Panel label | Description |
| --- | --- | --- |
| Local disk | **This host** | The `felis-uploads` volume on the host. Nothing else to set up; suited to a single-node installation. The off-site copy includes these uploads. |
| S3-compatible bucket | **S3-compatible bucket** | An external bucket (AWS S3, MinIO, Cloudflare R2 and others). felis-api sends each finished context on to the bucket in 8 MiB parts, which puts the ceiling of one upload at about 78 GiB. The off-site copy does not include uploads stored in a bucket. |

### Upload limits {#upload-limits}

| Limit | Value | When exceeded |
| --- | --- | --- |
| One uploaded context (`[registry] context_max_bytes`) | 1Gi | the panel refuses the file before uploading it |
| All users' uploaded contexts together (`[registry] user_uploads_max_bytes`) | 4Gi | `507 uploads_full` |
| One user's stored uploads | 2 GiB | `403 submission_quota_exceeded` |
| Free space on the uploads volume | 10% | `507 uploads_full` |

The panel sends a context in parts of at most 32 MiB, staged under `.parts/` on the uploads volume, so a dropped connection resumes from the staged length. A staged upload untouched for 24 hours is deleted. Staged bytes count toward the limits.

### Change the upload storage {#change-upload-storage}

::: warning
Changing the storage location restarts the panel briefly. Uploads already stored stay where they are and are not moved to the new location.
:::

In the panel:

1. Open **Platform settings → Access and security**.
2. On the **Upload storage** card, choose the **Storage location**: **This host** or **S3-compatible bucket**.
3. For a bucket, enter **Endpoint**, **Bucket**, **Region** (when the provider needs one), **Access key ID** and **Secret access key**.
4. Select **Apply storage** and confirm.

The bucket is checked before anything changes; a wrong key, endpoint or bucket fails the task and leaves the installation as it was. On success the configuration is written and felis-api restarts.

On the command line:

1. Run `sudo felis setup`.
2. On the status screen, press `s` (change storage).
3. Choose local disk or object storage, and enter the bucket details for object storage.

### Bucket credentials {#upload-credentials}

The bucket keys are kept on the host in `/etc/felis/uploads-s3-access-key` and `/etc/felis/uploads-s3-secret-key`, and in the `felis-uploads-s3` Secret. Every installer run applies the Secret from these files, so a hand edit of the Secret lasts only until the next installer run. Change the credentials through the **Upload storage** card or `felis setup`; both require the keys to be entered again. When uploads go to a bucket without both keys, the installer says so and names the `felis setup` screen that takes them.

The key files are part of every database bundle ([Bundle contents and retention](/en/operations/backup#bundle-contents)).

## Recover from a full disk {#disk-full}

A full disk is the most disruptive failure on a Felis host. Free space as soon as the watchdog reports a filesystem below 15% free. Symptoms and their diagnosis are also listed in [Troubleshooting](/en/operations/troubleshooting#disk-full-symptoms).

### What happens {#disk-full-effects}

- **Game servers are evicted first.** Kubelet's disk-pressure eviction removes game-server pods. The control-plane pods (felis-api, the operator, world cleanup, the registry) run at the `system-cluster-critical` priority, which kubelet does not evict; its log shows `Eviction manager: cannot evict a critical pod` for each of them.
- **Images may be removed.** After evictions, kubelet can garbage-collect images no running pod uses. Every image Felis runs is also kept in the in-cluster registry, so a removed image is pulled again on the next attempt without operator action.
- **Backups stop safely.** A backup Job refuses to write an archive that would leave less than 10% free (`not enough free disk for the archive`), and daily restore points pause while the backup store is at its cap. A database backup that fails on a full disk removes its half-written `.partial` file, and the earlier bundles stay intact.

### Free space and recover {#free-space}

1. Find what fills the disk:

   ```bash
   df -h /var/lib/rancher
   sudo k3s ctr images ls -q
   ```

   The largest consumers are usually k3s's container images and the world and backup volumes under `/var/lib/rancher/k3s/storage`.

2. Free space with one or more of these:

   - Delete backups that are no longer needed on the servers' backup pages, and lower the retention or set a backup store cap on **Platform settings → Notifications and retention → Backup and audit retention**. Archives of deleted backups are removed at the next daily cleanup run ([World cleanup](/en/operations/backup#world-cleanup)).
   - On a host that built its images, start Docker and run `docker builder prune -af`.
   - Remove `/var/lib/rancher/k3s.old` once a move to a separate disk has run for a day ([Move the data to its own disk](#move-data)).
   - Grow the disk ([Grow the disk](#grow-disk)).

3. Wait for the node's disk-pressure condition to clear. After space is freed the node can report `DiskPressure:True` for up to about 5 minutes; pods that need scheduling wait for it.

4. Delete a pod that is stuck pulling its image to retry at once, or wait for the next retry. The workload then converges on its own.

::: danger
Do not delete volumes under `/var/lib/rancher/k3s/storage` or world claims by hand to free space. A world exists only in its volume; deleting it loses the world unless a backup exists.
:::

### When an image does not come back {#disk-full-images}

1. Check the registry:

   ```bash
   sudo k3s kubectl -n felis get pods -l app.kubernetes.io/component=registry
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000/healthz
   ```

   The health check answers `200` while the registry runs. An anonymous `GET /v2/` answers `401` by design.

2. Check the mirror file: `/etc/rancher/k3s/registries.yaml` must map `registry.felis.svc:5000` to `http://127.0.0.1:5000`. When it is missing or changed, rerun the installer; it rewrites the file and restarts k3s only when the content changed.

3. Push a tag the registry does not have again. Start Docker (the installer leaves the daemon stopped), log in to `127.0.0.1:5000` as `platform` with the password from `kubectl -n felis get secret felis-registry-auth -o jsonpath='{.data.platform}' | base64 -d`, then:

   ```bash
   sudo systemctl start docker
   docker tag <ref> 127.0.0.1:5000/<repo>:<tag> && docker push 127.0.0.1:5000/<repo>:<tag>
   ```

4. For an image that is in neither the registry nor the local Docker store, rerun the installer: it imports or rebuilds the images and mirrors them into the registry. For a single image, `docker save felis:<tag> | k3s ctr images import -` imports it into k3s. Registry problems are covered in [Troubleshooting](/en/operations/troubleshooting#registry-errors).
