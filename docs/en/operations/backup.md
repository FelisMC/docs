---
title: Backup and restore
---

# Backup and restore {#备份与恢复}

* **Backup & Restore**: Enabled by default; the installer renders the archive PVC and its path.
  * Manual backups: archive a server's entire data volume (`/data`, including worlds, configuration, plugins and mods) to the cluster's archive store, with rollback to any backup point
  * Live backups: a running server is backed up without stopping it; saving pauses only while the world is copied on its node, typically seconds, and the archive, checksum and read-back run from the copy while players keep playing
  * Daily restore points: every server played that day gets a daily restore point, taken live while it runs; by default 7 are kept for up to 90 days, rotated separately from manual backups
  * Download and export: download a single backup (with sha256 verification), delete a single backup, or export a whole world
  * Off-site copy (optional): backups are encrypted on the host and synced to S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO and others); the Owner configures, changes or turns it off under Maintenance & Backups → Off-site copy in the panel
  * Control-plane database: the database holding accounts, server ownership, quotas and the archive index is backed up daily and snapshotted before every upgrade migration; the Owner backs it up, verifies a backup and rolls it back atomically under Maintenance & Backups → Backups in the panel, or with `felis db restore` (see [troubleshooting §16](/en/operations/troubleshooting#_16-control-plane-database-backups-and-disaster-recovery))
  * Whole-host rebuild: set `FELIS_RESTORE_FROM_OFFSITE=1` when installing on a new host, or start the rebuild under Maintenance & Backups → Off-site copy in the panel after installing (`sudo felis restore-host -yes` on the command line), to restore the database, images, uploads, servers and each server's newest world from the off-site copy; an interrupted run resumes where it stopped (see [troubleshooting §16](/en/operations/troubleshooting#rebuild-on-a-new-host-the-old-one-is-gone))

## What a backup contains {#what-a-backup-contains}

A backup tars the server's ENTIRE data volume — the same volume the server mounts
at `/data`: world folders, `server.properties`, plugins/mods, configs, jars,
libraries, logs and cache, not just the `world/` directory. A restore replaces the
volume's contents with the archive (files added since the backup are pruned), so a
restore also rolls config/plugin changes back. Sizes are dominated by
libraries/cache on stock Paper servers (~170MB for a fresh instance before any
world growth) — do not size the archive PVC as if only world data were stored.

## Detailed procedures {#详细操作}

- [World backups, downloads, exports and daily restore points](/en/operations/troubleshooting#_10-world-reaper-false-deletes-and-skipped-backups-spec-§18)
- [Live backups](/en/operations/troubleshooting#live-backups-backing-up-a-running-server)
- [Control-plane database backups and disaster recovery](/en/operations/troubleshooting#_16-control-plane-database-backups-and-disaster-recovery)
- [Disaster recovery and planned migration](/en/operations/#_5-disaster-recovery)
- [Database backup and restore, the off-site copy and the rebuild from the panel](/en/operations/#_9-running-the-host-from-the-panel-go-tested-sh-tested)
