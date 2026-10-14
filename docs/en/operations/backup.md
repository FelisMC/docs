---
title: Backup and restore
description: How Felis backs up worlds and the control-plane database, keeps an encrypted off-site copy, and rebuilds or moves a host.
---

# Backup and restore {#backup}

This page is for the Owner and the host operator. It covers world backups and their retention, restoring worlds, world cleanup, the off-site copy, control-plane database bundles, rebuilding a lost host and moving to another host. Server owners manage the backups of their own servers as described in [Managing servers](/en/guide/servers#server-backups).

## Overview {#overview}

Felis protects three kinds of data, each in its own way:

| Data | Protected by | Kept on the host in | Off-site copy |
| --- | --- | --- | --- |
| Worlds (each server's whole data volume) | world backups: manual backups, live backups, daily restore points, cleanup archives | the `felis-backups` volume | within the hour |
| Control-plane database and host state (accounts, passkeys, server ownership, quotas, audit log, the archive index, `/etc/felis`) | database bundles: daily, before every upgrade migration, before every restore | `/var/lib/felis/db-backups` | within the hour |
| User images and submission uploads | the off-site copy | the `registry` and `felis-uploads` volumes | hourly |

Without an off-site copy, every backup is stored on the same disk as the data it protects, and losing that disk loses both.

Most tasks are available in two places: in the panel, for the Owner, under **Maintenance & Backups → Backups** and **Maintenance & Backups → Off-site copy**; and on the host, through the `felis` command run as root. Every panel task requires a fresh sign-in proof and is recorded in the audit log; see [Running host operations from the panel](/en/operations/#panel-host-operations). Every command is described in the [Command-line reference](/en/reference/cli#backup-now).

### Production checklist {#checklist}

- Configure the off-site copy ([Off-site copy](#offsite)). Until it is set, the installer ends with `NO OFF-SITE COPY`.
- Store the off-site encryption key in a password manager, away from the host ([The encryption key](#offsite-key)).
- Without a bucket, keep at least one database bundle off the host. It contains `secrets.env`, which a rebuild needs to read the rest ([Without a bucket](#no-bucket)).
- Rehearse a rebuild once on a spare machine ([Rehearse a rebuild](#rehearsal)).
- Monitor `sudo felis offsite status` and `sudo felis db check`, or rely on the watchdog's mail. Both commands exit non-zero when the copy or the newest daily bundle is stale.

## World backups {#world-backups}

### What a backup contains {#backup-contents}

A world backup is a compressed archive of the server's entire data volume, the volume the server mounts at `/data`: world folders, `server.properties`, plugins and mods, configuration, jars, libraries, logs and cache. A restore replaces the volume's contents with the archive and removes files added since the backup, so it also rolls back configuration and plugin changes.

Libraries and cache account for most of the size of a stock Paper server: a fresh instance is about 170 MB before its world grows. Size the archive store for whole data volumes ([Storage and disks](/en/operations/storage#disk-layout)).

Every archive is checked against a sha256 recorded when it was written. The daily cleanup run reads back up to ten archives that have not been checked in the past week. An archive that fails the check is marked **Corrupt** on the server's backup page and cannot be restored.

### Kinds of backup {#backup-kinds}

| Kind (panel label) | Taken by | Default retention |
| --- | --- | --- |
| **Manual backup** | **Back up now** on the server's backup page, **Back up worlds now** in the panel, `felis backup-now` | 5 per server, 30 days |
| **Scheduled backup** | felis-api's daily restore points; a scheduled task with the backup action | 7 per server, 90 days |
| **Pre-restore snapshot** | a restore with the safety snapshot option | the 3 most recent per server |
| **Idle archive**, **Archived when given up or deleted** | world cleanup, before a world is removed | 90 days |

Multi-node deployments also show **Failover replica** backups; see [Multi-node and high availability](/en/guide/distributed#failover).

### Manual backups {#manual-backups}

On a stopped server, the backup Job archives the world volume as it is. On a running server, it takes a live backup ([Live backups](#live-backups)). Manual backups are limited by these `[archive]` keys in `felis.toml`, or by the values the Owner saved in the panel ([Retention](#retention)):

| Key | Default | Effect |
| --- | --- | --- |
| `manual_retention` | `30d` | When a manual backup expires. |
| `manual_keep` | `5` | Manual backups kept per server. After each backup the Job removes older ones and prints `removed older backup …`. |
| `manual_cooldown` | `10m` | One owner-started backup per server per window. The next one answers `429 backup_cooldown` with `Retry-After`. `0s` disables the cooldown. |

While the present backups add up to the backup store cap (`max_local_bytes`) or more, owners receive `507 backup_store_full`. Admins, `felis backup-now` and the break-glass console are exempt from the cooldown and the cap. Whoever starts it, a backup Job refuses to write an archive that would leave less than 10% of the archive filesystem free, and fails with `not enough free disk for the archive`. A failed backup or restore shows the error under **Recent operations** on the server's backup page.

## Live backups {#live-backups}

A backup of a running server leaves the server running. **Back up now** on a running server, the daily restore point of a running world, a scheduled task's backup and `felis backup-now` all take a live backup:

1. felis-api admits the backup only for a server that is running and ready, and whose world no other operation holds.
2. Over RCON, it turns saving off (`save-off`) and writes everything in memory to disk (`save-all flush`, allowed up to 2 minutes on a large world).
3. The backup Job copies the world into a scratch volume on the same node. On XFS and Btrfs each file is cloned by reflink, which makes the copy near-instant regardless of the world's size. The copy does not start when the scratch volume has less free space than the world occupies.
4. felis-api turns saving back on (`save-on`) as soon as the copy finishes. The archive, its sha256 and the read-back run from the copy while the game keeps running.

Players stay connected. Saving pauses only for the copy, typically a few seconds for a few GB, and for at most 5 minutes: a copy still running then is dropped and saving is turned back on. A server whose saving was already off before the backup keeps it off afterwards.

Limitations:

- A crash during the pause loses what changed since the flush, as any crash between two autosaves does.
- A game that restarts during the copy saves on its way down, so its copy is dropped as possibly inconsistent.
- Plugin databases written outside the game's save system (SQLite, H2) are copied as they stand at the moment of the copy.
- Live backups need RCON. User servers created before RCON was the default receive it with `sudo felis converge -user-rcon`, or with **Enable RCON on older user servers** on **Platform settings → Access and security → System server completion**.

A live backup is otherwise an ordinary backup: the same Job, cooldown, cap, keep count and free-space check, recorded in the audit log as `backup.create` (or `backup.scheduled`) with `{"live":true}`. A refused live backup names its cause:

| Response | Cause | Resolution |
| --- | --- | --- |
| `409 not_stopped`, `the server is starting or stopping; back it up once it is running or stopped` | The server is between states. | Retry once it has settled. |
| `503 live_backup_console` | The game did not answer `save-off` or `save-all flush` over RCON: RCON is off or unreachable. | Retry, back the server up while it is stopped, or turn its RCON on as described above. |
| `409 maintenance_in_progress` | Another operation holds the world, a restart is under way, or another live backup is still copying. | Retry once it ends. |
| `409 not_stopped`, `stop the server before backing up its world` | This felis-api cannot back up a running server. | Stop the server first. |

## Daily restore points {#restore-points}

A world played every day never becomes idle, so world cleanup never archives it. felis-api therefore takes a scheduled backup of every owned world that somebody joined since the owner's last intact scheduled backup, once that backup is `scheduled_every` old. Running worlds are backed up live, so a server that runs around the clock still receives its daily point.

| `[archive]` key | Default | Effect |
| --- | --- | --- |
| `scheduled_every` | `1d` | How old a world's newest scheduled backup must be before it receives the next one. `0s` turns restore points off. |
| `scheduled_keep` | `7` | Scheduled backups kept per server and owner. |
| `scheduled_retention` | `90d` | When a scheduled backup expires. |

- felis-api checks every 2 minutes and starts one scheduled backup at a time across the platform, only while no other backup or restore Job is running. Worlds without any restore point go first. A player who wakes a stopped server during such a backup sees the maintenance message and can retry once it finishes.
- A server that is starting or stopping, or whose world another operation holds, waits for a later check. A failed backup, or a game that does not answer its console, is retried after a quarter of `scheduled_every` (6 hours by default). Failures show under **Recent operations** as **Scheduled backup**.
- No restore point starts while the backup store is at its cap; felis-api logs `scheduled backups paused`, and `resumed` once there is room.
- Restore points are counted per owner. A backup taken under a previous owner is not a restore point of the new owner's world, and the new owner's backups never prune it.
- Restore points never start the owner's `manual_cooldown`, are copied off site like manual backups, and are recorded in the audit log as `backup.scheduled` with the actor `scheduler`.
- Restore points need the backup executor. felis-api logs `scheduled backups off (needs the backup executor)` at start when `FELIS_IMAGE` or `FELIS_BACKUP_PVC` is missing.

A change of `scheduled_every` in the panel applies at the next check, without a restart.

## Retention {#retention}

The Owner sets backup and audit retention on **Platform settings → Notifications and retention → Backup and audit retention**. Values saved there override the matching keys of `[archive]` and `[audit]` in `felis.toml`:

| Panel field | Overrides | Bounds |
| --- | --- | --- |
| **Manual backups**: **Kept per server** | `manual_keep` | 1–100 |
| **Manual backups**: **Days kept** | `manual_retention` | 1–3650 days |
| **Manual backups**: **Minutes between two backups** | `manual_cooldown` | 0–1440 (0: no cooldown) |
| **Scheduled restore points**: **Interval (hours)** | `scheduled_every` | 0–720 (0: off) |
| **Scheduled restore points**: **Kept per server** | `scheduled_keep` | 1–100 |
| **Scheduled restore points**: **Days kept** | `scheduled_retention` | 1–3650 days |
| **Store and audit**: **Days a removed world's archive is kept** | `retention`, which covers every archive world cleanup writes | 1–3650 days |
| **Store and audit**: **Backup store cap (GiB)** | `max_local_bytes` | 0–1048576 (0: no cap) |
| **Store and audit**: **Days audit rows are kept** | `[audit] retention` | 0 (keep every row), or 30–3650 days |

- Select **Save retention settings** to apply. felis-api applies a save at once; the backup Job reads the policy when it starts, and world cleanup on its next daily run.
- Until a policy is saved, the card shows the values from `felis.toml`, rounded to the card's units. **Restore install-time settings** discards the saved values, and `felis.toml` applies again.
- `warn_before`, the warning offsets of world cleanup, is set only in `felis.toml`.
- When the saved policy cannot be read, `felis.toml` stays in force: felis-api logs `felis.toml stands`, and the backup Job and world cleanup log `the panel's retention policy is unreadable, [archive] stands`.
- Saving and clearing require a fresh sign-in proof. A save against a policy that changed since the card loaded answers `409 conflict`. The audit actions are `platform.archive_policy` and `platform.archive_policy.clear`.

When the backup store is at its cap, world cleanup makes room before it archives an idle world: it removes the owners' manual backups first, oldest first, then cleanup archives whose off-site copy is confirmed. The only copy of a removed world is kept until its retention expires. When there is still no room, the idle world is kept.

## Restoring and exporting worlds {#restore-worlds}

Server owners and admins restore, download and delete backups on the server's page under **Servers → (server) → Backups & restore**. The steps are described in [Managing servers](/en/guide/servers#server-backups). Points that matter to the operator:

- **Restore this backup** stops the server, disconnects its players and overwrites the whole data volume with the backup. With **Take a safety snapshot of the current world first (recommended)**, a pre-restore snapshot is taken first, and the restore runs only if the snapshot succeeds. Restoring that snapshot undoes the restore. A corrupt backup cannot be restored.
- **Download backup** delivers the archive as a `.tar.gz` file, checked against its recorded sha256; a mismatch cuts the download short. **Export world** packages the current world and requires the server to be stopped; the server cannot start until the download ends.
- At most one export per user runs at a time, two across the platform, and six per user per hour; beyond that the start answers `429 export_busy` with `Retry-After`. The browser must open the download within 90 seconds of it being ready.
- While a restore, backup, export or file change holds a world, every wake and every other world operation on that server answers `409 maintenance_in_progress`.

::: danger
A restore without the safety snapshot overwrites the current world permanently. Data that is not in another backup cannot be recovered.
:::

### Deleting a backup {#delete-backup}

**Delete backup** removes a backup from every list and every restore at once. Its archive is deleted at the next daily cleanup run, and its off-site copy at the next sync. Admins may delete any backup; users may delete only backups of worlds they owned. While a restore may be reading the archive, the delete answers `409 restore_in_progress`. The audit action is `backup.delete`, with the backup id, former owner and size.

Until the next cleanup run, an admin can take a delete back with the backup id from the audit entry. Clearing `offsite_at` makes the next sync copy the archive off site again in case its copy is already gone:

```bash
sudo k3s kubectl -n felis exec deploy/felis-postgres -c postgres -- psql -U postgres felis -c \
  "UPDATE world_backups SET status = 'present', expires_at = now() + interval '30 days', offsite_at = NULL
   WHERE id = '<backup id>' AND status = 'expired'"
```

::: danger
An archive written by world cleanup can be the only remaining copy of a removed world. Once the cleanup run has deleted it, it cannot be recovered.
:::

## Back up every world {#backup-now}

A world exists only in its volume, and the off-site copy holds only its archives. Before any work that could lose a volume, such as growing the disk, moving the data to another disk or moving to another host, archive every world.

In the panel:

1. Open **Maintenance & Backups → Backups**.
2. On **Back up worlds now**, choose **All user servers** or **Selected servers** under **Servers to back up**.
3. Turn on **Stop running servers first** only when no world may change after its archive.
4. Select **Start backup**.

On the host:

```bash
sudo felis backup-now                    # the plan; nothing changes
sudo felis backup-now -yes               # archive every world, one at a time; running servers live
sudo felis backup-now -yes -stop         # stop the running servers first and leave them stopped
sudo felis backup-now -yes alpha bravo   # only these servers
```

- **The plan** lists every user server with what the run does with it: `back up` (stopped), `back up while it runs (saving pauses for the copy)` (running and ready), `stop, then back up` (running, with `-stop`), `skip: starting or stopping (run again later, or pass -stop)`, or `skip: no world volume (never started, nothing to save)`. With nothing to archive it ends with `Nothing to back up.`
- **Each archive is an ordinary manual backup**, exempt from the owner cooldown and the store cap, and recorded in the audit log as `backup.create` with the source `internal:ops`.
- **Each archive counts against `manual_keep`**: a server that already holds that many manual backups loses its oldest, and the plan says so. Raise the limit first when those older backups matter.
- **Stopped servers go first.** The run waits for each backup (`alpha: archived in 42s`) before starting the next.
- **Running servers are backed up live.** A running server whose console does not answer (RCON off) fails its backup; back it up with `-stop`, or turn its RCON on first.
- **`-stop` stops each running server before its backup.** Its players are disconnected and the server stays stopped (`Left stopped: …`). It also includes servers that are starting or stopping. A server still up after 10 minutes counts as failed, and the run moves on.
- **An unreachable felis-api ends the run** (`Stopped: nothing more can be backed up until felis-api answers`). Ctrl-C ends it after the current step; a backup Job already started runs to its end.
- **The archives stay on the host until the hourly off-site copy.** After a run that archived something, run `sudo systemctl start felis-offsite.service` to send them now; `sudo felis offsite status` shows what still waits.

The command exits 0 when every world with a volume was archived, 1 when a backup failed, a server that was starting or stopping was skipped or the run was interrupted, and 2 for a name that is not a user server.

::: warning
With `-stop` (**Stop running servers first**), the players on every running server are disconnected, and the servers stay stopped until they are started again from the panel.
:::

## World cleanup {#world-cleanup}

World cleanup (the reaper) is a Kubernetes CronJob that runs once a day. It always maintains the archive store. When it is enabled, it also archives and removes worlds that have been idle for more than 15 days.

### Archive store maintenance {#store-maintenance}

Every run:

- deletes backups past their expiry, and the archives of deleted backups;
- reads back up to ten archives that have not been checked in the past week, and marks those that do not match as corrupt;
- removes leftovers of interrupted archives (`*.partial` files older than six hours), and finished archives that no backup record points to once they are older than `retention`.

### Removing idle worlds {#idle-worlds}

Idle-world removal is enabled by the installer variable `FELIS_WORLDS_HOST_PATH`. On the k3s the installer provisions, rerun the installer with `FELIS_WORLDS_HOST_PATH=/var/lib/rancher/k3s/storage` ([Installation](/en/guide/deployment#install)). Without it, the installer reports `idle-world retention is off`, the run only maintains the archive store, and its summary shows `evaluated=0`.

With idle-world removal enabled:

- A world is removed only when its server has had no join for more than 15 days. The 15-day limit is fixed. A join or a claim of the server restarts the clock.
- The owner receives an email warning 3 days and 1 day before removal (`warn_before`), at the owner's verified address, through the mail relay ([Mail relay](/en/operations/monitoring#mail-relay)). Without a relay no warning is sent; a warning counts as sent only once it is delivered. Unowned servers receive no warning and are still removed.
- System servers (`spec.reaperExempt=true`) are never removed.
- A server that is still running is told to stop and is left for the next run. The world is archived first, under a maintenance lock that keeps the server from starting. When archiving fails or the backup store is full, the world is kept.
- With an off-site copy configured, the world is also kept until its archive is confirmed in the bucket. The run logs `world archived, kept until the archive's off-site copy is confirmed` and removes the world on a later run.
- The archive is kept for `retention`: 90 days by default, **Days a removed world's archive is kept** in the panel.

::: warning
The idle clock depends on the game proxy reporting joins to felis-api. When joins are not delivered, a world that is played every day becomes eligible after 15 days. Check that joins are reported ([Metrics](/en/operations/monitoring#metrics)) before enabling idle-world removal, and claim or exempt unowned servers that must be kept.
:::

### Run results and failures {#cleanup-failures}

Each run ends with one summary line:

```
felis reaper: evaluated=12 reaped=1 released=0 deleted=0 awaiting_offsite=0 awaiting_stop=0 warned=2 skipped=0 store_full=0 evicted=0 expired=3 expire_failed=0 verified=6 corrupt=0 verify_failed=0 swept=0 orphan_archives=0
```

When `skipped`, `expire_failed`, `corrupt` or `verify_failed` is above zero, or a sweep could not finish, the Job fails. The worlds are safe; the watchdog mails `world reaper Job … failed`, and after 26 hours without a successful run it also reports `the world reaper has not succeeded for …`. The Job retries twice, and each retry is safe to repeat. Read the error above the summary:

```bash
kubectl -n minecraft logs job/<the failed felis-reaper-… Job>
```

`awaiting_offsite` above zero for more than a day means the off-site copy is failing; check `sudo felis offsite status`. `awaiting_stop` that persists for days means something keeps starting the server, or a Job keeps holding its world. Further causes are listed in [Troubleshooting](/en/operations/troubleshooting#backup-failures).

## Off-site copy {#offsite}

The off-site copy sends world archives, database bundles, user images and submission uploads to an S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO and others). Everything is encrypted on the host and can be read only with the host's encryption key.

### Configure the off-site copy {#offsite-configure}

In the panel:

1. Open **Maintenance & Backups → Off-site copy** and select **Configure** (**Change bucket** when a bucket is already set).
2. Enter **Endpoint**, **Bucket**, **Access key ID** and **Secret access key**. Optionally enter **Region**, **Key prefix** (lets several installations share one bucket) and **Database backups kept in the bucket** (default 30). When changing the bucket, leave both keys empty to keep the current credentials.
3. Leave **Encryption key (optional)** empty to generate a new key. Enter the existing key when the bucket already holds copies from a previous host.
4. Select **Save and check**. The task writes `[offsite]` into the host configuration, installs the hourly timer and checks the key against the bucket.
5. On the **Encryption key** card, select **Show key** or **Copy key**, and store the key away from the host.

At install time, give the installer the bucket:

```bash
FELIS_OFFSITE_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
FELIS_OFFSITE_BUCKET=felis-backups \
FELIS_OFFSITE_ACCESS_KEY=... FELIS_OFFSITE_SECRET_KEY=... \
  bash deploy/bootstrap.sh          # or the curl | sudo bash one-liner
```

Optional variables are `FELIS_OFFSITE_REGION`, `FELIS_OFFSITE_PREFIX` and `FELIS_OFFSITE_DB_KEEP` (default 30). The installer writes `[offsite]` into `felis.toml` and keeps the credentials and a generated encryption key in `/etc/felis/offsite.env` (mode 0600).

To change the bucket on the command line, edit `[offsite]` in `/etc/felis/felis.host.toml` (and `offsite.env` for new credentials), then rerun the installer. Keeping the same key across buckets keeps the old copies readable.

### The encryption key {#offsite-key}

The bucket holds only sealed objects (AES-256-GCM in 64 KiB segments). Without the key they cannot be read.

- The installer shows a generated key once, on the terminal. The key stays out of the installer's output, so installation logs never contain it. With no terminal, the installer prints the command that reads it from `offsite.env`.
- The panel shows the key on the **Encryption key** card (**Show key**, **Copy key**). On the host it is `FELIS_OFFSITE_KEY` in `/etc/felis/offsite.env`.
- The bucket records which key sealed it: `felis-key-id`, the only object kept in the clear, holds the key's id (the `key id:` line of `felis offsite status`), which identifies the key without revealing it.
- A later installer run keeps the key, and refuses a `FELIS_OFFSITE_KEY` that differs from the one in `offsite.env`.

When the host's key differs from the bucket's, for example after a reinstall that lost `offsite.env` and generated a new key, every sync stops before it copies or prunes anything. The installer ends with `OFF-SITE COPY STOPPED`, `felis offsite status` exits 1, the panel reports the mismatch, and the watchdog mails the owners at once. To resolve it, set `FELIS_OFFSITE_KEY` in `/etc/felis/offsite.env` to the bucket's key and run `sudo systemctl start felis-offsite.service`, or give `[offsite]` an empty bucket or prefix and rerun the installer.

::: danger
Store the encryption key in a password manager or another location off the host. When the host is lost together with its key, nothing in the bucket can be restored.
:::

### What is copied {#offsite-contents}

`felis-offsite.timer` runs `felis offsite sync` every hour, plus up to 10 minutes of random delay. Each pass:

- copies every world archive not yet copied, then a fresh database bundle (label `offsite`) that lists them, so the newest bundle in the bucket can restore every archive there;
- copies the newest database bundles the bucket lacks, and keeps `db_keep` of them (default 30);
- copies the user images in the platform registry: every repository outside `felis/` and `mirror/`, plus the platform-image revisions that a server or whitelist entry pins by digest. Image lists are versioned and kept for 14 days, so an image deleted by mistake stays restorable for two weeks;
- copies the submission uploads when uploads are stored on the host ([Upload storage](/en/operations/storage#upload-storage)). Upload lists are versioned and kept for 14 days;
- deletes a world archive from the bucket once its backup has been deleted and its retention has passed. An archive in the bucket that no backup lists is removed once it is older than the longest archive retention.

An object already in the bucket at the right size is not sent again, so an interrupted pass resumes. Each object has its own time limit, 10 minutes plus its size at 512 KiB/s (about 6 hours for 10 GiB); an object that cannot be sent in that time is retried at the next pass, and the rest of the pass continues. World cleanup removes an idle world only after its archive is in the bucket.

### Check the copy {#offsite-status}

The **Off-site copy** card shows the state (**Copying normally** or **Needs attention**), **Last successful copy** and the last error. **Copy now** starts a pass, **Check key** checks the key against the bucket, and **List bucket contents** lists the bundles, image lists and upload lists in the bucket.

On the host:

```bash
sudo felis offsite status        # last run, errors, what the bucket holds, what waits
sudo felis offsite list          # the bundles, image lists and upload lists in the bucket, newest first
sudo felis offsite check-key     # whether offsite.env holds the key the bucket was sealed with
sudo journalctl -u felis-offsite -n 50 --no-pager
sudo systemctl start felis-offsite.service   # run one now
```

`status` exits 1 when no sync has completed in 12 hours. `missing:` lines name archives the database records but the volume no longer holds; there is nothing left to copy for them. The watchdog mails the owners when no sync has completed for 12 hours, and at once when the bucket refuses the host's key or another host takes the bucket over.

### The host that writes the bucket {#take-over}

Only one host writes a bucket. `felis-writer`, rewritten by every sync, names that host. A host restored from a backup has the bucket's key and credentials, finds another host named there and stands by: its syncs copy and prune nothing, `felis offsite status` names the writing host and exits 1, and the panel shows that the other host writes the bucket while this host stands by. While the writing host has run in the last 3 hours, the watchdog holds the standby host's mail.

To make this host the one that writes the bucket, select **Take over the bucket** on the **Off-site copy** card, or run:

```bash
sudo felis offsite take-over          # names the host the bucket names now
sudo felis offsite take-over -yes
sudo systemctl start felis-offsite.service
```

Without `-yes`, the command names the host the bucket records and when that host last wrote it, and exits 4. The host that is replaced copies nothing from its next sync on, its `status` exits 1, and its watchdog mails its owners that `the off-site copy has stopped`. When a rehearsal machine took the bucket over by mistake, run `sudo felis offsite take-over -yes` on the production host to take it back.

::: warning
Take a bucket over only when this host permanently replaces the host that wrote it. The previous host stops copying at its next sync.
:::

### Turn off the off-site copy {#offsite-disable}

Select **Turn off** on the **Off-site copy** card and confirm. The hourly copy stops, and new backups stay on the host only. The copies already in the bucket and the encryption key in `/etc/felis/offsite.env` are kept. On the command line, delete the `[offsite]` section from `/etc/felis/felis.host.toml` and rerun the installer.

### Without a bucket {#no-bucket}

Copy the database bundle directory off the host on a schedule of your own, together with the `.sha256` sidecars:

```bash
rsync -a root@felis-host:/var/lib/felis/db-backups/ /backups/felis-db/
```

`sha256sum -c` on the destination proves the copy. This covers the database only. The world archives are in the `felis-backups` volume's directory under `/var/lib/rancher/k3s/storage/`, the registry's images in the `registry` volume's directory (`*_felis_registry`) and the uploads in the `felis-uploads` volume's directory (`*_felis_felis-uploads`).

## Database backups {#database-backups}

The control-plane database runs in k3s as the `felis-postgres` Deployment, with its data in `/var/lib/felis/postgres`. It holds everything that is not a world: accounts, passkeys, Minecraft account links, server ownership, quotas, the audit log, and the index that maps each world archive to its owner. Losing it orphans every world archive.

### When bundles are taken {#bundle-schedule}

- **Daily**: `felis-db-backup.timer` runs `felis db backup` at `FELIS_DB_BACKUP_TIME` (default `*-*-* 03:30:00`, plus up to 15 minutes of random delay), and catches up at boot when the host was off at that time. The installer takes the first bundle during the installation.
- **Before every upgrade migration**: `felis migrate up` takes a `pre-migrate` bundle when the database holds data and a migration is pending, and applies nothing when that backup fails (`pre-migration backup failed, nothing applied`). `FELIS_PRE_MIGRATE_BACKUP=0` skips this snapshot, and the installer warns when it is set; use it only when the snapshot cannot work and another backup exists, for example with an external database newer than the host's `pg_dump`.
- **Before every restore**: a `pre-restore` bundle of the database about to be replaced.
- **After an off-site pass that copied world archives**: an `offsite` bundle.
- **On demand**: **Back up now** on the **Control-plane database backup** card under **Maintenance & Backups → Backups**, or `sudo felis db backup` (label `manual`).

To change the daily schedule in the panel, use the **Daily backup schedule** card under **Maintenance & Backups → Backups**: set **Backup time** (in the host's clock) and **Daily backups kept** (1–365), then select **Save schedule**. Saving rewrites the timer and takes one backup immediately. The values are kept in `/etc/felis/host-settings.env`, so later installer runs and updates keep them. On the command line, rerun the installer with `FELIS_DB_BACKUP_TIME` (any systemd calendar expression, for example `*-*-* 00/6:30:00` for every 6 hours) and a matching `FELIS_DB_BACKUP_KEEP`. A shorter interval narrows the database loss window; the hourly off-site copy picks up each bundle within the hour.

### Bundle contents and retention {#bundle-contents}

Bundles are written to `FELIS_DB_BACKUP_DIR` (default `/var/lib/felis/db-backups`, mode 0700, outside `/var/lib/rancher` so that a k3s reinstall cannot remove them). Each bundle is `felis-db-<UTC stamp>-<label>.tar`, next to a `.sha256` sidecar in `sha256sum` format:

| Member | Content |
| --- | --- |
| `MANIFEST.json` | Version, schema version, `pg_dump --version`, sha256 of every member. |
| `db.dump` | `pg_dump --format=custom` of the `felis` database. |
| `state/etc/felis/...` | Every file in `/etc/felis`: `secrets.env` (database password, forwarding secret, caller and registry tokens), `felis.host.toml`, `felis.pod.toml`, `offsite.env` (bucket credentials and encryption key), `smtp-password`, `uploads-s3-access-key` and `uploads-s3-secret-key`, the panel TLS pair, and the installer's markers. `bootstrap.done` is left out. |
| `k8s/minecraftservers.json` | Every MinecraftServer, ready for `kubectl apply`. |

Retention per label: `daily` 14 (`FELIS_DB_BACKUP_KEEP`), `pre-migrate` 10, `pre-restore` 5, `offsite` 1, `manual` never pruned.

::: danger
A bundle contains every secret of the installation, including the off-site encryption key. Protect bundles and their copies like `/etc/felis` itself.
:::

When the cluster does not answer while a bundle is taken, the bundle is written without `k8s/minecraftservers.json`, and a restore from it brings back no servers. `felis db backup` then exits 1, the panel card shows **Incomplete**, and the watchdog mails the owners while that bundle is the newest. Once `sudo k3s kubectl get minecraftservers -A` answers, run `sudo felis db backup` again.

### Check freshness and verify a bundle {#verify-bundle}

The **Control-plane database backup** card turns red when the newest daily bundle is missing or more than 26 hours old. `sudo felis db check` exits 1 for the same reason, and the watchdog mails the owners. A newer manual, `pre-migrate` or `offsite` bundle can be restored, but does not clear the alarm, because the daily timer has still stopped.

```bash
sudo felis db list                                   # every bundle with its age
sudo felis db check                                  # exits 1 when the newest daily bundle is stale
sudo systemctl status felis-db-backup.timer          # enabled? next run?
sudo journalctl -u felis-db-backup -n 50 --no-pager   # why the last run failed
sudo systemctl start felis-db-backup.service         # run the daily backup now; clears the alarm
```

To verify a bundle, select **Verify** next to it on the **Database backups on this host** card, or run:

```bash
sudo felis db verify felis-db-20260924T033012Z-daily.tar   # bare names resolve in the backup dir
sha256sum -c felis-db-20260924T033012Z-daily.tar.sha256    # on a copy, without felis
```

`verify` checks the sidecar, every member against the manifest, and that nothing is missing or unlisted. It does not touch the database. When the database itself is unavailable, see [Troubleshooting](/en/operations/troubleshooting#database-unavailable).

## Restore the database {#restore-database}

A restore replaces every table with the contents of a bundle. Use it to undo a mistake on the same host. World volumes and archives are not part of the bundle and are left as they are; a server created after the bundle was taken keeps its world volume but loses its owner record. To roll back an upgrade, follow [Rollback](/en/operations/upgrade#rollback).

::: danger
Everything written to the database after the bundle was taken is lost, including new accounts, ownership changes and audit records. The panel and the operator stop during the restore, and every user signs in again afterwards. The `pre-restore` bundle that the restore takes first is the way back.
:::

In the panel:

1. Open **Maintenance & Backups → Backups**.
2. On **Database backups on this host**, select **Restore** next to the bundle.
3. Enter the bundle name to confirm, and select **Restore**.

The task verifies the bundle, stops the panel and the operator, restores the database (taking a `pre-restore` bundle first), applies this release's migrations, and starts both again.

On the host:

```bash
kubectl -n felis scale deployment felis-api felis-operator --replicas=0
sudo felis db restore -yes felis-db-20260924T033012Z-daily.tar
sudo felis migrate up -config /etc/felis/felis.host.toml
kubectl -n felis scale deployment felis-api felis-operator --replicas=1
```

- Without `-yes`, `restore` prints what the bundle holds and exits 2.
- It refuses while other clients are connected (`other clients are connected to the database (N)`) and prints the scale command. `-force` overrides this for a client known to be idle.
- The replay is one transaction. Any failure rolls back and leaves the database exactly as it was (`rolled back, the database is unchanged`).
- To undo the restore, restore the `pre-restore` bundle it names.
- `migrate up` brings an older bundle's schema up to the running release. Nothing migrates at startup, so skip it only when rolling back to the release that wrote the bundle.

## Rebuild a host from the off-site copy {#rebuild-host}

When the host or its disk is lost, a fresh installation and the off-site bucket bring Felis back. A rebuild needs the off-site copy, or a bundle copied off the old host, and for the bucket the old host's encryption key.

### What comes back {#rebuild-scope}

| Data | Brought back from | Lost at most |
| --- | --- | --- |
| Control-plane database | the newest bundle in the bucket | changes since that bundle: up to a day plus an hour with the daily timer |
| Host state (`/etc/felis`) | inside every bundle | as the database |
| MinecraftServer objects | inside every bundle | as the database |
| World archives | the bucket | archives written in the last hour |
| Live worlds | only as their newest archive | everything since that world's newest archive |
| User images | the bucket | images pushed in the last hour |
| Submission uploads | the bucket | uploads of the last hour |
| Cloudflare Tunnel connector | the configuration is in every bundle; the Cloudflare step of `felis setup` recreates the connector | nothing; the tunnel, its DNS records and the Access application live at Cloudflare |
| Platform images, Velocity, the JRE, build tools, k3s | the installer installs them again | nothing |

A world's current state exists only in its volume. A world played since its last restore point normally has one no older than `scheduled_every` (one day by default). A world that was never archived comes back as a server with an empty world. The age of a world's newest archive, shown on the server's backup page, is its recovery point.

The rebuild time is mostly transfer time: the installer on a blank host, the database restore (seconds to minutes), then the images, uploads and world archives at the bucket's download rate. `sudo felis offsite status` reports how much the bucket holds.

### Rebuild in one command {#rebuild-one-command}

On the new host, give the installer the old installation's bucket, credentials and key, together with `FELIS_OFFSITE_REGION` and `FELIS_OFFSITE_PREFIX` when the old installation had them, and request the rebuild:

```bash
FELIS_OFFSITE_ENDPOINT=https://s3.example.com FELIS_OFFSITE_BUCKET=felis-backups \
FELIS_OFFSITE_ACCESS_KEY=... FELIS_OFFSITE_SECRET_KEY=... FELIS_OFFSITE_KEY=... \
FELIS_RESTORE_FROM_OFFSITE=1 FELIS_RESTORE_TAKE_OVER=1 \
  bash deploy/bootstrap.sh          # or the curl | sudo bash one-liner
```

- The installer refuses `FELIS_RESTORE_FROM_OFFSITE=1` without all five `FELIS_OFFSITE_*` values above, and on a host where Felis is already installed.
- `FELIS_RESTORE_BUNDLE` names a bundle older than the newest (`felis-db-<stamp>-<label>.tar`, from `felis offsite list`).
- Leave `FELIS_RESTORE_TAKE_OVER` unset on a rehearsal machine.
- Once the installation is complete, and before its summary and the setup console, the installer runs `felis restore-host -yes`, so the setup console finds the old installation's Owner.
- When the rebuild stops, the installer prints `the rebuild stopped before it finished; fix the cause above and run: sudo felis restore-host -yes`. That command continues where the run stopped; add `-take-over` when the installer had `FELIS_RESTORE_TAKE_OVER=1`.

### Rebuild an installed host {#restore-host}

A host that is already installed and holds no servers yet can be rebuilt from the panel or with `felis restore-host`.

In the panel:

1. On **Maintenance & Backups → Off-site copy**, configure the old bucket and enter the old host's key in **Encryption key (optional)** ([Configure the off-site copy](#offsite-configure)). The host finds the old host named in the bucket and stands by.
2. On **Rebuild from the off-site copy**, leave **Database backup (optional)** empty to use the newest bundle, or enter a bundle name from **List bucket contents**.
3. Keep **Take over the bucket afterwards** on, unless this host is a rehearsal and the original host keeps running.
4. Turn on **Overwrite existing servers** only when this installation already holds servers whose data may be replaced.
5. Select **Start rebuild** and enter `REBUILD` to confirm.

On the host, as root:

```bash
sudo felis restore-host                      # the steps; nothing changes
sudo felis restore-host -yes                 # rebuild, leaving the bucket to the old host
sudo felis restore-host -yes -take-over      # rebuild, then make this host write the bucket
```

The command runs the steps of [Rebuild by hand](#rebuild-manual) up to taking the bucket over:

| Step | What it does | Manual step |
| --- | --- | --- |
| `fetch_db` | `felis offsite fetch-db` of the newest bundle (or `-bundle <name>`) into `/var/lib/felis/restore-host` | 1 |
| `images` | `felis offsite fetch-images` | 4 |
| `uploads` | `felis offsite fetch-uploads` | 5 |
| `database` | scales felis-api and felis-operator to 0, runs `felis db restore -yes -no-safety-backup` and `felis migrate up`, scales both back and waits up to 5 minutes for felis-api | 6 |
| `servers` | applies the bundle's `k8s/minecraftservers.json`: user servers only (the new installation created its own login space and lobby), each `Stopped`, without the old cluster's node placement, volume claim names, locks or in-flight marks | 6 |
| `worlds` | `felis offsite fetch-worlds` | 7 |
| `restore_worlds` | restores each server's newest intact backup through felis-api and waits for its restore Job (up to 2 hours each); a server with no backup keeps an empty world | 7 |
| `take_over` | `felis offsite take-over -yes`, only with `-take-over` | 8 |

- **Resumable.** Each step is recorded in `/var/lib/felis/restore-host/state.json` once done, so a run cut short (a dropped SSH session, a bucket timeout) continues where it stopped. The database is restored only once; a rerun never restores it over what the rebuilt installation has written since.
- **Fresh installations only.** Before the database step, the command refuses an installation whose database already holds servers. `-force` restores over them.
- **Failed worlds are retried.** A server whose restore fails is listed with the reason and fails the step; the next run retries only the servers not yet restored.
- **The host keeps its own state.** The command leaves the old `/etc/felis` aside: the installer generated fresh secrets, and this host keeps its own root domain, `[smtp]` relay, uploads bucket keys and tunnel configuration. A mail relay, retention policy or heartbeat the Owner saved in the panel comes back with the database. To reuse the old host's state as well, put it in place as in step 2 of [Rebuild by hand](#rebuild-manual) before running the installer.
- **The end of the run** prints which backup each world came from and what remains by hand: step 9 (mail), step 10 (pointing the domain at this host and `felis domain set`, or keeping this host's address, in which case passkeys registered on the old address stop working and their users sign in with an email code and register new ones), step 11 (the Cloudflare tunnel), and step 8 without `-take-over`. After a take-over, `sudo systemctl start felis-offsite.service` sends this host's first copy before the hourly timer does.

Flags: `-yes` (without it the steps are printed and nothing changes), `-bundle <name>`, `-take-over`, `-force`, `-dir` (default `/var/lib/felis/restore-host`) and `-config` (default `/etc/felis/felis.toml`). A rerun with a different `-bundle` uses that bundle while the database has not been restored yet. Once it has been restored, the run refuses and names the bundle the database came from; delete `/var/lib/felis/restore-host/state.json` to start over.

::: danger
`-force` (**Overwrite existing servers**) replaces the database and servers of the current installation with the off-site copy. Everything the installation held before is lost.
:::

### Rebuild by hand {#rebuild-manual}

The numbered steps are the reference for what `felis restore-host` does, the way to rebuild from a bundle copied off the old host without a bucket, and the way to finish a step the command could not. Keep the order: the host state goes in before the installer so that it reuses the old secrets and bucket; the images go back before the database so that restored servers find the digests they pin; the worlds come after the servers, because a restore needs a server to restore into; mail is checked before the domain moves, because email codes are the way back in when passkeys stop working.

1. Get the newest bundle. From the bucket, use any `felis` binary of the same or a newer release (the `felis-linux-<arch>` release asset runs on its own), on any machine that can reach the bucket:

   ```bash
   export FELIS_OFFSITE_ACCESS_KEY=... FELIS_OFFSITE_SECRET_KEY=... FELIS_OFFSITE_KEY=...
   sudo -E felis offsite fetch-db -endpoint https://s3.example.com -bucket felis-backups \
        [-region ...] [-prefix ...] latest
   ```

   The command writes the bundle into `/var/lib/felis/db-backups` (`-dir` to change), verifies it and names it, with when it was taken, the release and schema that took it, and how many accounts and servers its database holds. Read those before continuing. A wrong key fails with `object does not decrypt with this key` and writes nothing. For a copy made by hand, check it with `sha256sum -c felis-db-....tar.sha256`.

   `latest` is the newest bundle, unless that bundle holds no servers and at most one account while an older one holds more. Such a bundle comes from a rebuilt host that took the bucket over before anyone restored onto it, so `fetch-db latest` refuses it and names up to three older bundles with their counts. Fetch the one you want by name in place of `latest`; `felis offsite list` shows them all.

2. Put the old host's state in place **before** installing, so that the installer reuses the same database password, caller tokens, forwarding secret, mail relay password, uploads bucket keys and the `[offsite]` bucket with its credentials and key:

   ```bash
   sudo install -d -m 0700 /etc/felis
   sudo tar -xpf felis-db-....tar -C / --strip-components=1 state/etc/felis
   ```

3. Run the installer as for a first installation ([Installation](/en/guide/deployment#install)). It creates the empty database with the restored password and migrates it. It finds `[offsite]` in the restored configuration, turns the hourly copy back on, detects that another host writes the bucket, stands by until step 8 and ends with `OFF-SITE COPY ON STANDBY`.

4. Push the user images back into the new registry:

   ```bash
   sudo felis offsite fetch-images
   ```

   The command restores the newest image list in the bucket (`-at <stamp>` for an older one; `felis offsite list` shows them), verifies every manifest and layer against its digest and pushes only what the registry lacks. A restored image is kept for 24 hours as freshly pushed; finish the database step within that window so that the restored servers and whitelist entries keep naming it. When the new host has already taken the bucket over and recorded its empty registry, `fetch-images` refuses that newest list and names the version to pass with `-at`; `fetch-uploads` does the same.

5. Put the submission uploads back:

   ```bash
   sudo felis offsite fetch-uploads
   ```

   The command writes every upload of the newest upload list (`-at <stamp>` for an older one) into the `felis-uploads` volume, checks each against its sha256 and leaves uploads already in place alone.

6. Restore the database and bring the servers back:

   ```bash
   kubectl -n felis scale deployment felis-api felis-operator --replicas=0
   sudo felis db restore -yes -no-safety-backup /var/lib/felis/db-backups/felis-db-....tar
   sudo felis migrate up -config /etc/felis/felis.host.toml
   kubectl -n felis scale deployment felis-api felis-operator --replicas=1
   tar -xOf felis-db-....tar k8s/minecraftservers.json | kubectl apply -f -
   ```

   When `tar` answers `Not found in archive`, the bundle lacks the MinecraftServer objects. Fetch the newest bundle that `felis offsite list` shows without `no MinecraftServer objects` and apply its `k8s/minecraftservers.json` instead; servers that bundle does not list do not come back.

7. Bring the world archives back into the archive volume:

   ```bash
   sudo felis offsite fetch-worlds
   ```

   The command fetches every archive the restored database lists as present and the volume lacks, creating the `felis-backups` volume first if nothing has used it yet, and lists any archive it could not find in the bucket. Then restore each world from its archive on the server's backup page ([Restoring and exporting worlds](#restore-worlds)).

8. Make this host the one that writes the bucket, and send its first copy ([The host that writes the bucket](#take-over)):

   ```bash
   sudo felis offsite take-over          # names the host the bucket names now
   sudo felis offsite take-over -yes
   sudo systemctl start felis-offsite.service
   ```

   Skip this step on a rehearsal machine.

9. When the old host had a mail relay, check that this host can send mail. Run `sudo felis setup`, press `e` (configure email) on the status screen and save the pre-filled relay with its password entered again. Saving sends one test message to the From address and writes nothing unless it arrives. A relay that admits senders by address, or an SPF record that lists the old host's address, refuses this host or sends its mail to spam; add the new address there. A relay the Owner saved in the panel came back with the database in step 6 and is the one in force; check it with **Send test message** on **Platform settings → Notifications and retention → Mail delivery** once the panel is reachable. Without any relay, an Owner who cannot sign in recovers with `sudo felis breakGlass` ([Emergency access](/en/operations/access#break-glass)).

10. When the installation's names still lead to the old host, move them to this host. The installer kept the bundle's root domain (its log says `(reusing the installed domain)`).

    - The default `<old-address>.nip.io` domain always resolves to the old address. Move it:

      ```bash
      sudo felis domain set <new-address>.nip.io       # the plan
      sudo felis domain set -yes <new-address>.nip.io
      sudo felis domain check
      ```

      The plan counts the passkeys that stop working; their users sign in with an email code and register a new one. See [Changing the root domain](/en/operations/access#change-domain).
    - A domain of your own stays. Point its records at the new address: `<root>`, `*.<root>`, `console.<root>` and `op.console.<root>`, or only `<root>` and `*.<root>` when a Cloudflare tunnel serves the panel. Confirm each with `dig +short <name>` before continuing.

11. When the old host served the panel through a Cloudflare tunnel, bring the connector back. Until a connector runs here, the panel hostnames answer Cloudflare error 1033. Run `sudo felis setup`, press `n` (change connection) on the status screen and choose Cloudflare Tunnel + Access. On the first screen, press `i` to install cloudflared and `l` for `cloudflared tunnel login`; `enter` opens the form once both are in place. Enter an API token and the account ID, then the same admitted identity, hostnames and tunnel name as before (the tunnel name defaults to `felis`). The step finds the existing tunnel and Access application by name, installs and starts `cloudflared-felis`, and closes the panel's NodePort once the tunnel serves. A different tunnel name creates a second tunnel; delete the old one in the Cloudflare dashboard afterwards. Skip this step on a rehearsal machine.

### Check the rebuild {#rebuild-checks}

Before letting players in:

```bash
sudo felis db check                     # the database answers and has a fresh bundle
kubectl get minecraftservers -A         # every server the bundle held
kubectl -n minecraft get pods           # servers pull their pinned images (no ImagePullBackOff)
sudo felis offsite status               # the hourly copy runs from this host again
sudo felis domain check                 # every name, the certificate and the tunnel on the new address
```

In the panel, reached by its hostname:

1. Sign in with an existing account. Accounts and passkeys come back with the database, except passkeys that step 10 counted as lost.
2. Sign out, then sign in with an email code to an Owner account whose inbox you can read. The arriving code proves that felis-api delivers mail through the relay.
3. Open a restored server's backup page, confirm its archives are listed, restore the newest one, start the server and join it at `<name>.<root>`.

### Rehearse a rebuild {#rehearsal}

A rehearsal on a spare machine, once per release, is the reliable way to know the recovery time of an installation. Write down what `sudo felis offsite status` reports the bucket holding and the bucket's download rate.

- Run the rebuild without taking the bucket over: `felis restore-host` without `-take-over`, the installer without `FELIS_RESTORE_TAKE_OVER`, the panel with **Take over the bucket afterwards** off, or the manual steps without steps 8 and 11.
- The spare machine finds the production host named in the bucket and stands by. It copies nothing into the bucket, prunes nothing there and, while production keeps writing, mails none of the owners its restored database holds.
- Leave the Cloudflare tunnel alone: a second connector on the production tunnel would take a share of the real visitors. Reach the spare machine by its own address (step 10 moves it to a `nip.io` name). `felis domain check` then reports the tunnel line as failed; that failure is expected on a rehearsal machine.
- Check the result as in [Check the rebuild](#rebuild-checks): sign in with an email code, restore one world and join it.

::: warning
A rehearsal machine must never take the bucket over. If it does, the production host stops copying; run `sudo felis offsite take-over -yes` on the production host to take the bucket back.
:::

## Move to another host {#move-host}

A planned move is a rebuild in which the old host is still available to hand over a final copy. It needs the off-site bucket, which carries the world archives to the new host. The platform is down from step 1 until the new host serves.

::: warning
Players are disconnected in step 1, and no server can start on the old host from then on.
:::

1. **On the old host**, stop everything that changes a world, then send the final copy:

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

   Keep this order. The new host fetches the archives its restored database lists, so the bundle must come after the last archive. `backup-now` runs with `-stop` so that no world changes after its archive. The operator is stopped after `backup-now`, which needs it to stop the servers. The quiet marker keeps the watchdog from mailing the owners about the stopped proxy and operator for the next 4 hours; **Hold alert mail** on **Maintenance & Backups → Status** has the same effect ([Holding alert mail](/en/operations/monitoring#hold-alerts)).

2. **On the new host**, rebuild from the bucket: run the installer with `FELIS_RESTORE_FROM_OFFSITE=1` and `FELIS_RESTORE_TAKE_OVER=1` together with the old installation's `FELIS_OFFSITE_*` settings and `FELIS_OFFSITE_KEY` ([Rebuild in one command](#rebuild-one-command)), or follow [Rebuild by hand](#rebuild-manual) from step 1. Either way the newest bundle is the one the old host just sent. The take-over makes the new host the one that writes the bucket; from then on the old host copies nothing. The one-command path leaves the old host's `/etc/felis` aside unless it is put in place first (step 2 of the manual rebuild), so the new host keeps its own root domain until `felis domain set` moves it. Steps 10 and 11 of the manual rebuild move the names and the tunnel.

3. **Check the new host** before announcing it: sign in with an email code, restore one world and join it, and confirm that `sudo felis offsite status` shows a recent `last success` and no standby notice.

4. **Retire the old host.** It holds the last copy of every world outside the bucket, so keep it powered off with its disk for a few days first, with its services disabled so that a boot brings nothing up:

   ```bash
   sudo systemctl disable k3s felis-velocity felis-watchdog.timer felis-offsite.timer \
       felis-db-backup.timer felis-update-check.timer felis-build-tools.timer
   sudo poweroff
   ```

   Then uninstall it ([Uninstall and reinstall](/en/operations/uninstall#uninstall)) or wipe it.
