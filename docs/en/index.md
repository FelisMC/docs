---
title: Introduction to Felis
---

# Introduction to Felis {#认识-felis}

A Kubernetes-driven Minecraft server hosting platform.

One command to deploy, with automatic lifecycle, backup, and security.

> [!CAUTION]
> **This project is still in early development. Do not use it in production. The FelisMC team accepts no civil or criminal liability for problems arising from its use.**

## Features {#特性}

* **On-demand Start and Stop**: A server starts when a player connects to the proxy. The player waits in a queue during start-up and is transferred once the server is ready. Idle servers stop automatically to free memory.

* **Web Dashboard**: Monitor server status, online players, and resource usage from your browser.
  * Console (RCON), whitelist, bans, OPs and LuckPerms permissions
  * File manager: create, delete, rename, chunked upload, download, and unzip while the server is stopped; also used to import worlds
  * Schedules: run commands, restart, stop, start or back up by weekday and time zone, with an in-game warning to players beforehand

* **Backup & Restore**: Enabled by default; the installer renders the archive PVC and its path.
  * Manual backups: archive a server's entire data volume (`/data`, including worlds, configuration, plugins and mods) to the cluster's archive store, with rollback to any backup point
  * Daily restore points: a server played that day gets a restore point once it stops; by default 7 are kept for up to 90 days, rotated separately from manual backups
  * Download and export: download a single backup (with sha256 verification), delete a single backup, or export a whole world
  * Off-site copy (optional): backups are encrypted on the host and synced to S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO and others)
  * Control-plane database: the database holding accounts, server ownership, quotas and the archive index is backed up daily and snapshotted before every upgrade migration; `felis db restore` rolls it back atomically, and the panel's Maintenance & Backups page shows the age of the latest backup (see [troubleshooting §16](/en/operations/troubleshooting#_16-control-plane-database-backups-and-disaster-recovery))

* **Diagnostics**
  * `sudo felis status`: a summary of the node, control plane, game proxy, each server, backups and open alerts
  * `sudo felis doctor`: runs all health checks and lists problems by area with troubleshooting pointers; sends no email
  * `sudo felis support-bundle`: generates a redacted diagnostics archive to attach to support requests (see [troubleshooting §0](/en/operations/troubleshooting#_0-first-look-felis-status-felis-doctor-felis-support-bundle))
  * Watchdog: runs a check every 2 minutes and emails the platform owners when a problem persists; supports an external heartbeat monitor

* **World Reaper** (optional): Worlds idle for more than 15 days are backed up and then removed to free disk space. Enable it by setting `FELIS_WORLDS_HOST_PATH` at install time (on k3s: `/var/lib/rancher/k3s/storage`); without it, no world is deleted. Expired backups are cleaned up daily regardless of this setting.

* **Multi-core Support**: Compatible with Paper, Fabric, Forge, and NeoForge, accessed through a single Velocity proxy.

* **Modpack Submission**: Players can upload modpacks. After admin approval, each modpack is built automatically and scanned with Trivy; the result is added to the image whitelist and can be selected as a server image.

* **Security**
  * Passkey login: passwordless authentication via fingerprint, face recognition, or hardware security keys
  * Zero-trust access: panel traffic is protected by Cloudflare Access, and the internal API is not exposed to the internet

* **Multi-node Deployment** (experimental, off by default): a single controller node issues all commands, the other nodes run game servers only, and a stopped server can be migrated to another node. Currently available only on the main branch; three-node acceptance testing is not yet complete (see [distributed mode](/en/guide/distributed)).

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
---

Source: [README_EN.md](https://github.com/FelisMC/Felis/blob/main/README_EN.md).
