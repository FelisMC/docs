---
title: Project README
---

# Felis {#felis}

A Kubernetes-driven Minecraft server hosting platform

One command to deploy, with automatic lifecycle, backup, and security


> [!CAUTION]
> **Only development snapshots are available; public releases have been withdrawn. These builds are for developers testing in isolated environments and are not recommended for general deployment.**<br>
> **This project is still in early development. Do not use it in production. The FelisMC team accepts no civil or criminal liability for problems arising from its use.**

<details>
<summary>Table of Contents</summary>

- [Features](#features)
- [Getting Started](#getting-started)
- [Build from Source](#build-from-source)
- [License](#license)
- [Acknowledgements](#acknowledgements)

</details>

## Features {#features}

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

## Getting Started {#getting-started}

For development testing on a prepared Linux test host, explicitly select the `dev` channel, which follows `main` and builds from source:

```bash
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo FELIS_VERSION_BOOTSTRAP=dev bash
```

The script installs K3s, deploys PostgreSQL and the control plane inside it, and launches a setup wizard. When setup completes, open the configured domain in a browser to reach the control panel.

* **Setup wizard**: The wizard configures panel access and storage first. The host administrator then initializes the first Owner and receives a one-time browser setup link (valid for 30 minutes). Opening the link, registering an email address and creating a passkey gives access to the panel; Minecraft is not required. A game role can be linked later on the Account page by selecting an authentication source, entering a role name or UUID, and confirming it. Players continue to verify their identity with the in-game bind code. If the browser setup is unfinished or the link has expired, running `sudo felis setup` again issues a new link; accounts that already have a login factor are never reset. Failures of the login server or the lobby do not block panel initialization. The Account page explains Yggdrasil authentication and shows the join address and the Java Edition client version that the login server and the lobby require. The installer records the version it built in `[velocity].game_version`; custom images must set it themselves, otherwise the panel reports the version as unknown. Standard Yggdrasil endpoints support role lookup directly; a source with a nonstandard `hasJoined` path can set `[[auth_source]].api_url` to its API root, and linking with a game code remains available as a fallback. The installer launches the wizard automatically only on an interactive terminal; when output is redirected to a log or the install runs under cloud-init, run `sudo felis setup` after it finishes. Setting `FELIS_NO_SETUP=1` makes the installer end at its summary.

* **Authentication sources**: Under Platform → Authentication sources in the sidebar, the Owner adds, edits, reorders and disables third-party Yggdrasil providers and tests their authentication endpoints. A saved change applies to the next login and role lookup without a restart, and the panel configuration takes precedence over the install-time configuration. A saved permanent tag cannot be renamed or removed, so that player UUIDs and account links are preserved; a provider that is no longer used can be disabled. Mojang is always verified first. Nano continues to use its TOML configuration (see [operations §7](/en/operations/#_7-authentication-sources)).

* **Supported hosts**: CentOS Stream 9 (aarch64) is verified on physical hardware; CI tests fresh installation and repeat installation of development builds on Ubuntu 24.04 (x86_64) on every push (see [operations §1](/en/operations/#_1-supported-hosts)).

* **Preflight checks**: Before modifying the host, the installer checks memory, disk, ports, network range conflicts, existing Kubernetes installations and outbound connectivity. If any check fails, it lists all problems and exits, leaving the host unchanged (see [operations §1](/en/operations/#_1-supported-hosts) for the checks).

* **Upgrading**: Rerun the install command to upgrade felis-api to a newer version; `felis setup` only uses the binary already installed on the host and cannot upgrade it. A rerun keeps the installed root domain, and the release channel must be specified again: hosts that follow the main branch must also set `export FELIS_VERSION_BOOTSTRAP=dev`. A PostgreSQL instance installed on the host by an earlier release is migrated into K3s during the rerun; the original instance on the host is stopped and retained for rollback (see [operations §4](/en/operations/#_4-upgrading-the-pieces-around-felis)).

<details>
<summary>Installation sources and restricted networks</summary>
<br>

The following describes the release mechanism. No public release assets are currently available; development testing uses source builds.

A release installation takes the binary, all images and the Velocity plugin from the release assets prebuilt in CI, verifying each against `SHA256SUMS` before import. The host requires no Docker, Gradle or Go, and no access to Docker Hub. If an asset is missing or fails verification, only that image falls back to a local build, and the installer prints a notice (see [troubleshooting §15c](/en/operations/troubleshooting#_15c-the-installer-builds-on-the-host-although-it-installs-a-release)).

The assets can also be copied to the host in advance and installed with `FELIS_ARTIFACT_DIR=<absolute path>`; the Felis binary, images and plugin are then read from that directory. k3s and its images, the JRE, cloudflared, Velocity and the Via plugins are still downloaded from GitHub and PaperMC; hosts with SELinux enabled, such as RHEL, Fedora and openSUSE Leap, additionally install k3s-selinux from rpm.rancher.io; system packages come from the distribution's repositories.

A host with restricted outbound access must therefore allow HTTPS to these addresses or set `https_proxy`. Preflight probes each address before changing the host. Fully offline installation is not yet supported (see [operations §1](/en/operations/#_1-supported-hosts) for the address list).

</details>

## Build from Source {#build-from-source}

Felis is built with Go and Node.js:

```bash
# Backend (Go 1.27+)
go build -o felis ./cmd/felis

# Frontend (Node.js 22+)
cd panel
npm ci
npm run build

# Docker image
docker build -t felis:custom .
```

## License {#license}

This project is licensed under [AGPL-3.0-only](/LICENSE.txt).

### License Notes {#license-notes}

1. **Derivative works must use AGPL**: Any distribution of this project or of software derived from it must be released under AGPL-3.0 and must include the original copyright notice and license statement.
2. **Network services must also provide source** (AGPL section 13): anyone who offers a modified Felis to others over a network must provide those users with the complete source of the modified version, even without distributing any binary. This is the only substantive difference between AGPL and GPL; as Felis is a hosting platform accessed over a network, this clause applies to virtually every deployment.
3. **Disclaimer**: This project is provided "as is", without warranty of any kind.

## Acknowledgements {#acknowledgements}

* [Kubernetes](https://kubernetes.io/): Container orchestration engine
* [K3s](https://k3s.io/): Lightweight Kubernetes distribution
* [Cloudflare Zero Trust](https://www.cloudflare.com/zero-trust/): Zero trust security infrastructure
* [PostgreSQL](https://www.postgresql.org/): Data persistence
* [React](https://react.dev/): User interface framework
* [Vite](https://vitejs.dev/): Frontend build tool
* [TailwindCSS](https://tailwindcss.com/): CSS framework
* [Bubble Tea](https://github.com/charmbracelet/bubbletea): TUI framework
* [Minecraft](https://www.minecraft.net/): The game this project serves
