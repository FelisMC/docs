---
title: Known limitations
description: Features Felis does not implement yet or implements only in part, and what they mean for operators and players.
---

# Known limitations {#limitations}

This page lists the features Felis does not implement yet or implements only in part, and explains what each means for operators, Admins and players and how to work with it. Before you deploy or upgrade, check that none of these limitations affects your intended use.

## Release status {#release-status}

Felis provides development snapshots only; no public release assets are published. Development snapshots are for developers testing on isolated hosts and must not be used in production. Installing a development build requires selecting the `dev` channel explicitly; see [Installation](/en/guide/deployment#channels).

## Installation and upgrades {#installation}

- **Fully offline installation is not supported.** When you install from pre-downloaded release assets with `FELIS_ARTIFACT_DIR`, the Felis binary, images and proxy plugin are read from that directory, but k3s and its images, the JRE, cloudflared, Velocity, the Via plugins and system packages are still downloaded. The host needs HTTPS access to those addresses, or `https_proxy`. See [Installing from pre-downloaded assets](/en/guide/deployment#offline-install) and [Network requirements](/en/guide/requirements#network).
- **PostgreSQL major-version upgrades are manual.** When a release moves the PostgreSQL image to a new major version, the installer finds the old version's data directory and stops; it does not migrate the data. Take a database bundle first and restore it on the new version. See [PostgreSQL major upgrades](/en/operations/upgrade#postgresql-major).

## Control plane {#control-plane}

- **felis-api runs as a single replica only.** The felis-api Deployment is fixed at one replica, and an update stops the old Pod before starting the new one, so the API is briefly unavailable. The email code resend cooldown, the submission rate limit and the per-user upload storage budget apply within one process only, and several background tasks run inside the process; scaling felis-api to more replicas would defeat these limits and run the background tasks more than once, so it is not supported.
- **Updates are neither applied automatically nor announced.** `felis-update-check.timer` checks component versions once a day, and the result appears under **Maintenance & Backups → Updates**; Felis sends no email or in-game notice about available updates and never installs them on its own. To apply an update, run `sudo felis update --apply` on the host; see [Upgrading](/en/operations/upgrade#update).

## Multi-node and high availability {#multi-node}

Multi-node deployment, failover and controller high availability are experimental, disabled by default, and have not completed acceptance on multiple real machines. Enable them on test hosts only. The specific limits are:

- Without controller high availability, the controller is a single point of failure for the control plane and the public entry. Control operations pause while the controller restarts, and the worlds on the controller cannot be failed over.
- Once enabled, controller high availability cannot be turned off from the panel. To roll back, restore by hand from the database backup (tag `pre-migrate`) and the cluster state snapshot (`pre-ha`) saved while it was enabled.
- The panel has no operation to remove a controller. To decommission a controller permanently, first confirm that the remaining controllers still form an etcd majority, then remove its etcd member following the k3s documentation and delete the node.
- After a failover, the original world volume stays on the lost node's disk and is not cleaned up automatically.
- Multi-node deployment allows no exceptions for game servers to reach private networks; see [Host and network](#host-network).

See [Multi-node and high availability](/en/guide/distributed#overview) for the procedures.

## Host and network {#host-network}

- **Game servers cannot reach private networks.** The network policies of the `minecraft` namespace allow game servers to reach only DNS and the internet; every private address range is excluded. Plugins that depend on a local-network service (for example, a permissions plugin connecting to a database on the LAN) do not work. On a single-node deployment, an exception can be added only with `--server-egress-allow-cidr` when generating manifests with `felis manifests`; the installer and the panel offer no such setting, and a multi-node deployment allows no exceptions.
- **A firewalld reload can remove the panel port protection.** With the Cloudflare Tunnel access method, Felis closes the panel NodePort to public access with a separate nftables table (`inet felis_edge`), so the panel is reachable only through Cloudflare. On a host running firewalld, a firewalld reload can flush that table and expose the panel port to the internet again. After a firewalld reload, check with `sudo nft list table inet felis_edge`; if the table is missing, apply the Cloudflare Tunnel access method again (see [Access methods](/en/operations/access#access-methods)). On a host without the `nft` command, the protection step fails with an explicit error, so it never reports success while the port is still open.
- **The host operations service has no dedicated process domain on SELinux hosts.** The socket directory and files of `felis-node-control.service` have their own SELinux types, and felis-api reaches the service through file permissions and an exclusive mount; the current policy allows container processes to connect to Unix stream sockets of services running as `unconfined_service_t`, and the actual reach is bounded by the file labels and the mount scope.

## Players and games {#players-and-games}

- **The server list shows only the MOTD Felis generates.** The game proxy builds the server-list information from the server's lifecycle state (online, starting, start failed, sleeping) and the cached player counts; it does not show the MOTD configured on the server itself. A server-list ping never wakes a server.
- **Username-collision handling is only partly implemented.** The login space refuses UUIDs on the username-collision blacklist. The game proxy does not detect and record username collisions automatically, there is no flow for a new account to inherit the displaced account's data, and the panel has no page to manage the blacklist.
- **The loader mods are not installed automatically.** The Fabric, Forge and NeoForge mods provide `/link` only, target standalone Minecraft 1.20.x servers, do not load on the 26.x servers the Felis network uses, and are not deployed by the installer. Inside a Felis network, the game proxy's `/link` already serves every server. See [Server plugins](/en/reference/plugins#overview).

## Build pipeline {#build-pipeline}

- **A partial failure while approving a submission needs manual handling.** In rare cases, the build starts after a submission is approved but the link between the build and the submission cannot be written; the error returned then names the running build's ID. The build keeps running and pushes its image; do not approve the submission again or resubmit it, or it is built twice. An operator has to correct the build link in the submission record by hand. See [Platform administration](/en/guide/administration#submissions) for submission review.
