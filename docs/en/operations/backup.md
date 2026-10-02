---
title: Backup and restore
---

# Backup and restore {#备份与恢复}

* **Backup & Restore**: Enabled by default; the installer renders the archive PVC and its path.
  * Manual backups: archive a server's entire data volume (`/data`, including worlds, configuration, plugins and mods) to the cluster's archive store, with rollback to any backup point
  * Daily restore points: a server played that day gets a restore point once it stops; by default 7 are kept for up to 90 days, rotated separately from manual backups
  * Download and export: download a single backup (with sha256 verification), delete a single backup, or export a whole world
  * Off-site copy (optional): backups are encrypted on the host and synced to S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO and others)
  * Control-plane database: the database holding accounts, server ownership, quotas and the archive index is backed up daily and snapshotted before every upgrade migration; `felis db restore` rolls it back atomically, and the panel's Maintenance & Backups page shows the age of the latest backup (see [troubleshooting §16](/en/operations/troubleshooting#_16-control-plane-database-backups-and-disaster-recovery))

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
- [Control-plane database backups and disaster recovery](/en/operations/troubleshooting#_16-control-plane-database-backups-and-disaster-recovery)
- [Disaster recovery and planned migration](/en/operations/#_5-disaster-recovery)

---

Source: [README_EN.md](https://github.com/FelisMC/Felis/blob/main/README_EN.md), [docs/troubleshooting.md](https://github.com/FelisMC/Felis/blob/main/docs/troubleshooting.md), [docs/operations.md](https://github.com/FelisMC/Felis/blob/main/docs/operations.md).
