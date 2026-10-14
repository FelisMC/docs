---
layout: home
title: Felis
description: A Kubernetes-based Minecraft server hosting platform. One command deploys it; server lifecycle, backups and player access are managed automatically.

hero:
  name: Felis
  text: Minecraft server hosting
  tagline: Built on Kubernetes and k3s. One command deploys it; starting and stopping servers, backups and player access are managed automatically.
  image:
    src: /felis-logo.png
    alt: Felis
  actions:
    - theme: brand
      text: Installation
      link: /en/guide/deployment
    - theme: alt
      text: GitHub
      link: https://github.com/FelisMC/Felis

features:
  - title: On-demand start and stop
    details: A player's connection wakes the target server; the player waits in the lobby and is moved in once it is ready. Servers with nobody online go to sleep after a set time and free their memory.
    link: /en/guide/servers#power
    linkText: Start and sleep
  - title: Web panel
    details: Manage the console, whitelist, bans, LuckPerms permissions, files and scheduled tasks in the browser; the Owner handles platform settings and host operations in the panel.
    link: /en/guide/servers
    linkText: Managing servers
  - title: Backup and restore
    details: Manual backups, live backups and daily restore points, with backup downloads and world exports; the control-plane database is backed up daily, with an optional off-site copy and whole-host rebuild.
    link: /en/operations/backup#world-backups
    linkText: Backup and restore
  - title: Player access
    details: Players join through a single Velocity game proxy, with Mojang and third-party Yggdrasil authentication sources, a configurable login space, lobby and player entry policy.
    link: /en/guide/players
    linkText: Player access
  - title: Security
    details: Passkey and email code sign-in; sensitive operations require identity verification and are recorded in the audit log. Game servers are network-isolated, and modpack builds are scanned by Trivy.
    link: /en/guide/administration#roles
    linkText: Platform administration
  - title: Multi-node (experimental)
    details: A controller node directs several worker nodes, with stopped-server migration, failover and controller high availability.
    link: /en/guide/distributed#overview
    linkText: Multi-node and high availability
---

## Overview {#overview}

::: danger Development snapshots only
Only development snapshots are available; public releases have been withdrawn. They are meant for developers testing on isolated hosts; do not use them in production. Felis is in early development, and the FelisMC team accepts no civil or criminal liability for problems arising from its use.
:::

Felis is a Kubernetes-based Minecraft server hosting platform. A single install command deploys k3s, PostgreSQL, the control plane and the Velocity game proxy on a Linux host; from then on, creating servers, starting and stopping them, backups and player access are all handled in the web panel.

## How it works {#how-it-works}

- **Servers**: each Minecraft server runs in k3s, with its world on its own data volume. Admins create servers; users link their game identity, then claim and manage their own servers.
- **Player access**: players join through the game proxy, authenticate in the login space and then enter the target server; when the target is asleep, Felis wakes it and the player waits in the lobby.
- **Data protection**: world backups, daily restore points and control-plane database backups are on by default. Encrypted copies can be synced to S3-compatible storage and used to rebuild the whole host on a new machine.
- **Operations**: host status, alerts, health checks, support bundles and version information are gathered under **Maintenance & Backups** in the panel, and the matching `felis` commands run on the host.

## Get started {#get-started}

- [Requirements](/en/guide/requirements#supported-hosts): supported systems, sizing and network requirements.
- [Installation](/en/guide/deployment#install): install Felis and create the first Owner.
- [Managing servers](/en/guide/servers#create-server): create, claim and maintain servers.
- [Player access](/en/guide/players#joining): how players join servers and link their accounts.
- [Operations overview](/en/operations/#components): the components on the host and routine operations.
- [Troubleshooting](/en/operations/troubleshooting#first-steps): find problems by symptom.

## Acknowledgements {#acknowledgements}

Felis is built on [Kubernetes](https://kubernetes.io/), [k3s](https://k3s.io/), [Cloudflare Zero Trust](https://www.cloudflare.com/zero-trust/), [PostgreSQL](https://www.postgresql.org/), [React](https://react.dev/), [Vite](https://vitejs.dev/), [Tailwind CSS](https://tailwindcss.com/) and [Bubble Tea](https://github.com/charmbracelet/bubbletea), and serves [Minecraft](https://www.minecraft.net/). Felis is open source under [AGPL-3.0-only](/en/reference/license#license).
