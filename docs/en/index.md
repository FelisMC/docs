---
title: Introduction to Felis
---

# Introduction to Felis {#认识-felis}

A Kubernetes-driven Minecraft server hosting platform.

One command to deploy, with automatic lifecycle, backup, and security.

> [!CAUTION]
> **Only development snapshots are available; public releases have been withdrawn. These builds are for developers testing in isolated environments and are not recommended for general deployment.**<br>
> **This project is still in early development. Do not use it in production. The FelisMC team accepts no civil or criminal liability for problems arising from its use.**

## Features {#特性}

* **On-demand Start and Stop**: A server starts when a player connects to the proxy. The player waits in a queue during start-up and is transferred once the server is ready. Idle servers stop automatically to free memory.

* **Web Dashboard**: Monitor server status, online players, and resource usage from your browser.
  * Console (RCON), whitelist, bans, OPs and LuckPerms permissions
  * File manager: create, delete, rename, chunked upload, download, and unzip while the server is stopped; also used to import worlds
  * Schedules: run commands, restart, stop, start or back up by weekday and time zone, with an in-game warning to players beforehand
  * Platform settings: the Owner configures the mail relay (SMTP), backup and audit retention, and the monitoring heartbeat in the panel; changes take effect immediately and take precedence over the install-time settings
  * Host operations: the Owner changes the access method, the root domain, upload storage, credentials, the game proxy heap, the database backup schedule, the off-site copy and system server completion in the panel; a root service on the host runs the matching command, with a fresh sign-in proof and an audit record for each (see [operations guide section 9](/en/operations/#_9-running-the-host-from-the-panel-go-tested-sh-tested))

* **Backup & Restore**: Enabled by default; the installer renders the archive PVC and its path.
  * Manual backups: archive a server's entire data volume (`/data`, including worlds, configuration, plugins and mods) to the cluster's archive store, with rollback to any backup point
  * Live backups: a running server is backed up without stopping it; saving pauses only while the world is copied on its node, typically seconds, and the archive, checksum and read-back run from the copy while players keep playing
  * Daily restore points: every server played that day gets a daily restore point, taken live while it runs; by default 7 are kept for up to 90 days, rotated separately from manual backups
  * Download and export: download a single backup (with sha256 verification), delete a single backup, or export a whole world
  * Off-site copy (optional): backups are encrypted on the host and synced to S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO and others)
  * Control-plane database: the database holding accounts, server ownership, quotas and the archive index is backed up daily and snapshotted before every upgrade migration; the Owner backs it up, verifies a backup and rolls it back atomically under Maintenance & Backups → Backups in the panel, or with `felis db restore` (see [troubleshooting §16](/en/operations/troubleshooting#_16-control-plane-database-backups-and-disaster-recovery))
  * Whole-host rebuild: set `FELIS_RESTORE_FROM_OFFSITE=1` when installing on a new host, or start the rebuild under Maintenance & Backups → Off-site copy in the panel after installing (`sudo felis restore-host -yes` on the command line), to restore the database, images, uploads, servers and each server's newest world from the off-site copy; an interrupted run resumes where it stopped (see [troubleshooting §16](/en/operations/troubleshooting#rebuild-on-a-new-host-the-old-one-is-gone))

* **Diagnostics**: The panel's Maintenance & Backups page shows host status and open alerts, and runs the health check, the support bundle download and the audit log export; the command-line equivalents are:
  * `sudo felis status`: a summary of the node, control plane, game proxy, each server, backups and open alerts
  * `sudo felis doctor`: runs all health checks and lists problems by area with troubleshooting pointers; sends no email
  * `sudo felis support-bundle`: generates a redacted diagnostics archive to attach to support requests (see [troubleshooting §0](/en/operations/troubleshooting#_0-first-look-felis-status-felis-doctor-felis-support-bundle))
  * Watchdog: runs a check every 2 minutes and emails the platform owners when a problem persists; supports an external heartbeat monitor, whose address can be set in the panel

* **World Reaper** (optional): Worlds idle for more than 15 days are backed up and then removed to free disk space. Enable it by setting `FELIS_WORLDS_HOST_PATH` at install time (on k3s: `/var/lib/rancher/k3s/storage`); without it, no world is deleted. Expired backups are cleaned up daily regardless of this setting.

* **Multi-core Support**: Compatible with Paper, Fabric, Forge, and NeoForge, accessed through a single Velocity proxy.

* **Modpack Submission**: Players can upload modpacks. After admin approval, each modpack is built automatically and scanned with Trivy; the result is added to the image whitelist and can be selected as a server image.

* **Security**
  * Passkey login: passwordless authentication via fingerprint, face recognition, or hardware security keys
  * Zero-trust access: panel traffic is protected by Cloudflare Access, and the internal API is not exposed to the internet

* **Multi-node Deployment** (experimental, off by default): a controller node issues all commands and the other nodes run game servers. A stopped server can be migrated to another node, and the worlds of a lost node can be failed over to other nodes from their newest backups, manually or automatically. Optional controller high availability, built on k3s embedded etcd and Longhorn replicated storage, moves the control plane between several controllers. These features are currently available only on the main branch, and multi-node acceptance testing is not yet complete (see [distributed mode](/en/guide/distributed)).

## Read the documentation {#阅读文档}

- [Installation and deployment](/en/guide/deployment)
- [Operations guide](/en/operations/)
- [Troubleshooting](/en/operations/troubleshooting)
- [Multi-node deployment](/en/guide/distributed)
- [Contributing](/en/reference/contributing)
- [Project README](/en/reference/readme-en)

## Acknowledgements {#致谢}

* [Kubernetes](https://kubernetes.io/): Container orchestration engine
* [K3s](https://k3s.io/): Lightweight Kubernetes distribution
* [Cloudflare Zero Trust](https://www.cloudflare.com/zero-trust/): Zero trust security infrastructure
* [PostgreSQL](https://www.postgresql.org/): Data persistence
* [React](https://react.dev/): User interface framework
* [Vite](https://vitejs.dev/): Frontend build tool
* [TailwindCSS](https://tailwindcss.com/): CSS framework
* [Bubble Tea](https://github.com/charmbracelet/bubbletea): TUI framework
* [Minecraft](https://www.minecraft.net/): The game this project serves
