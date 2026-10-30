---
title: Installation
description: Install Felis on a Linux host, run the setup wizard and create the first Owner.
---

# Installation {#deployment}

This page explains how to install Felis on a Linux host: choose a release channel, run the install command, complete the setup wizard, create the first Owner and check the result. It is written for the operators who deploy the host.

::: danger Development snapshots only
Only development snapshots are available; public releases have been withdrawn. Install them only on isolated test hosts, never in production.
:::

## Before you begin {#before-you-begin}

Make sure that:

- The host runs a supported Linux distribution and architecture and meets the resource requirements. See [Supported hosts](/en/guide/requirements#supported-hosts) and [Sizing](/en/guide/requirements#sizing).
- You have root access or can run `sudo`.
- The host has a fixed IPv4 address (a static address or a DHCP reservation) and can reach the download sources over HTTPS. See [Network](/en/guide/requirements#network).
- If you use your own domain, `<root>`, `console.<root>`, `op.console.<root>` and `*.<root>` all resolve to the host. The wildcard record does not cover the third-level name `op.console.<root>`, so give it its own record. Without a domain, the installer uses `<node-ip>.nip.io`.

Before it changes anything, the installer runs its preflight checks. If any check fails, it lists every problem at once and exits, leaving the host unchanged. The checks are listed under [Preflight checks](/en/guide/requirements#preflight).

## Release channels {#channels}

The installer chooses its source with `FELIS_VERSION_BOOTSTRAP`:

| Channel | Value | Source |
| --- | --- | --- |
| Release | `release` (default) | Downloads the assets of the newest release: the `felis` binary (panel included), every image and the Velocity plugin, each verified against `SHA256SUMS` before use. The host needs neither Docker nor access to Docker Hub. If an asset is missing or fails verification, only that piece is built on the host, and the installer prints a notice. |
| Development | `dev` | Follows the `main` branch: clones the source and builds it on the host. The installer installs Docker for the build and stops it once the images are in the in-cluster registry. |

These variables select a version more precisely:

- `FELIS_REF=<branch, tag or commit>`: builds that version from source. It takes precedence over the channel.
- `FELIS_RELEASE=<tag>`: on the release channel, installs an earlier published release instead of the newest, for example to roll back. Use the installer script of the same tag.

::: info
Only development snapshots exist at present, so select the `dev` channel explicitly.
:::

## Install {#install}

1. Sign in to the host as a user with sudo rights.
2. Run the install command (development channel):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo FELIS_VERSION_BOOTSTRAP=dev bash
   ```

3. When the installer asks what to install, choose `[1] Felis`, the full control plane. `[2] Felis-nano` installs only the Yggdrasil multi-source authentication service, for third-party servers that need nothing but multi-provider sign-in; it includes no k3s, database or panel.
4. Wait for the installation to finish. After printing its summary, the installer starts the setup wizard when it runs on an interactive terminal. See [Setup wizard](#setup-wizard).

`sudo` resets the environment. Put installer variables between `sudo` and `bash`, or `export` them and run `sudo -E bash`:

```bash
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo FELIS_VERSION_BOOTSTRAP=dev FELIS_ROOT_DOMAIN=mc.example.com bash
```

The install command can be run again. A rerun converges the host to the desired state, and the generated secrets kept in `/etc/felis/secrets.env` are reused. A rerun keeps the installed root domain; specify the release channel again each time. For upgrades, see [Upgrading](/en/operations/upgrade#update).

### Common installer variables {#installer-variables}

| Variable | Default | Description |
| --- | --- | --- |
| `FELIS_VERSION_BOOTSTRAP` | `release` | Release channel: `release` or `dev`. |
| `FELIS_REF` | empty | Builds the named branch, tag or commit from source. |
| `FELIS_RELEASE` | newest release | Installs the named release. |
| `FELIS_ARTIFACT_DIR` | empty | Installs release assets from a local directory. See [Installing from downloaded release assets](#offline-install). |
| `FELIS_INSTALL_MODE` | interactive prompt | Installation type: `full` or `nano`. |
| `FELIS_NO_SETUP` | empty | `1` ends the installation without starting the setup wizard. |
| `FELIS_ROOT_DOMAIN` | `<node-ip>.nip.io` | Root domain, applied on the first installation only. To change it later, see [Changing the root domain](/en/operations/access#change-domain). |
| `FELIS_PANEL_NODEPORT` | `30443` | Local HTTPS port of the panel and API. |
| `FELIS_PREFLIGHT` | `strict` | `warn` reports preflight problems as warnings and installs anyway. |
| `FELIS_WORLDS_HOST_PATH` | empty | Node directory that holds the world volumes (`/var/lib/rancher/k3s/storage` on k3s). Setting it enables idle world cleanup. See [World cleanup](/en/operations/backup#world-cleanup). |
| `FELIS_VELOCITY_XMX` | `1G`, `256M` on the small-host profile | Maximum heap of the game proxy, at least `256M`. |
| `FELIS_HOST_PROFILE` | `auto` | Host profile: `auto`, `small` or `standard` ([Small hosts](/en/guide/requirements#small-hosts)). |
| `FELIS_DB_BACKUP_TIME` | `*-*-* 03:30:00` | Time of the daily database backup, as a systemd calendar expression. |
| `FELIS_DB_BACKUP_KEEP` | `14` | Number of daily database backups kept. |
| `FELIS_OFFSITE_BUCKET`, `FELIS_OFFSITE_ENDPOINT` | empty | Bucket and endpoint of the off-site copy, together with `FELIS_OFFSITE_ACCESS_KEY` and `FELIS_OFFSITE_SECRET_KEY`. Setting them enables the off-site copy. See [Off-site copy](/en/operations/backup#offsite). |
| `FELIS_WATCHDOG_HEARTBEAT_URL` | empty | Heartbeat URL of an external monitoring service. See [External heartbeat](/en/operations/monitoring#heartbeat). |
| `FELIS_RESTORE_FROM_OFFSITE` | `0` | `1` rebuilds this host from the old installation's off-site copy once it is installed. See [Rebuilding a host](/en/operations/backup#rebuild-host). |

The database backup schedule and the game proxy heap, when changed in the panel, are kept in `/etc/felis/host-settings.env` and serve as defaults for later installer runs; a variable set explicitly for a run takes precedence. For the full list of variables, see [Installer variables](/en/reference/configuration#installer-variables).

### What gets installed {#what-gets-installed}

A full installation sets up these components on the host:

- A single-node k3s cluster running PostgreSQL (`felis-postgres`, with its data in `/var/lib/felis/postgres`), the Felis API, the operator and the in-cluster registry.
- The game proxy (Velocity), which runs on the host as the systemd service `felis-velocity` on a Temurin JRE the installer downloads, and listens on game port 25565.
- Two system servers, the login space (`login`) and the lobby (`lobby`), created by the setup wizard; the [small-host profile](/en/guide/requirements#small-hosts) creates the login space only.
- The host node operations service `felis-node-control.service`, through which the panel runs host operations.
- systemd timers: the daily database backup (`felis-db-backup.timer`), the watchdog check (`felis-watchdog.timer`, every 2 minutes), the version check (`felis-update-check.timer`, daily) and, once configured, the off-site copy (`felis-offsite.timer`, hourly).
- Rules that open the required ports in an active host firewall (firewalld or ufw), NTP time synchronization, and a persistent system journal (capped at 1G by default).

On hosts with little memory, the installer also creates a swap file. The admin kubeconfig `/etc/rancher/k3s/k3s.yaml` is readable by root only; use `sudo k3s kubectl` to reach the cluster. For what each component does and where its data lives, see [Operations overview](/en/operations/#components).

## Setup wizard {#setup-wizard}

The setup wizard, `felis setup`, configures how the panel is reached and where uploads are stored, and creates the first Owner. The installer starts it automatically only on an interactive terminal. When the output goes to a log file or the installation runs under cloud-init, run it after the installation finishes:

```bash
sudo felis setup
```

With `FELIS_NO_SETUP=1`, the installer ends after its summary.

The wizard runs these steps in order; you can review completed steps with the arrow keys:

| Step | Purpose |
| --- | --- |
| Preflight | Confirms that the control plane is ready. |
| Connection | Chooses how the panel is reached. See [Access method](#access-method). |
| Storage | Chooses where submission uploads are stored. See [Upload storage](#wizard-storage). |
| Panel login | Creates the Owner account and a one-time setup link. See [Creating the first Owner](#first-owner). |

When the wizard finishes, it creates the login space and the lobby. A failure of either does not block panel initialization; you can investigate it from the panel.

### Access method {#access-method}

| Option | Description |
| --- | --- |
| Local only | Installs nothing more. The panel is reached at the host's address and the panel port. |
| Cloudflare Tunnel + Access | Creates a Cloudflare tunnel, routes the hostnames, puts Cloudflare Access in front of the admin console, and then closes the panel port to the public. You authorize cloudflared in a browser and supply an API token that can edit Access applications. |
| Reverse proxy | Your own reverse proxy (for example Caddy, nginx or Traefik) terminates TLS; the wizard prints the proxy configuration guide. |

Pressing Esc at this step selects Local only. With Local only or a reverse proxy, the admin console is protected by the Owner's sign-in alone (passkey or email code); Cloudflare Access adds an edge check in front of it. You can change the access method later in the panel under **Platform settings → Access and security → Access and domain**. See [Access methods](/en/operations/access#access-methods).

### Upload storage {#wizard-storage}

The build contexts of modpacks that players submit are stored in the location you choose:

- Local disk: on this host's disk, which suits a single-node installation.
- Object storage: in an S3-compatible bucket (for example AWS S3, MinIO or Cloudflare R2). Enter the endpoint, bucket, optional region and access keys. The keys are stored in a Kubernetes Secret.

You can change the location later under **Platform settings → Access and security → Upload storage**. See [Upload storage](/en/operations/storage#upload-storage).

### Creating the first Owner {#first-owner}

1. At the Panel login step, the wizard creates the Owner account (passwordless) and prints a one-time setup link in the terminal. The link is valid for 30 minutes.
2. Open the link in a browser.
3. Enter an email address and select **Save & continue**. Mail delivery can be configured later and is not needed for initialization.
4. Select **Create passkey** and register a passkey with a fingerprint, face recognition or device PIN. A passkey is required to complete initialization.
5. You enter the operator console. Minecraft is not needed at any point.

You can link a Minecraft profile later on the **Account** page. See [Account linking](/en/guide/players#account-linking).

If the link has expired or the browser setup is unfinished, run `sudo felis setup` again for a new link; accounts that already have a sign-in method are never reset. Once the Owner exists, running `sudo felis setup` again lets you change the mail relay, the access method and upload storage. If no Owner can sign in, see [Emergency access](/en/operations/access#break-glass).

::: tip
Passkeys are bound to the panel hostname. They cannot be used when the panel is opened by IP address; register and sign in on the configured hostname.
:::

## Installing from downloaded release assets {#offline-install}

When the host cannot download GitHub release assets, download them on another machine, copy them to the host and install with `FELIS_ARTIFACT_DIR`. The Felis binary, images and plugin are then read from that directory; the installer neither downloads nor builds them.

1. On a machine with access to GitHub, download the release assets for the host's architecture:

   ```bash
   gh release download <tag> --repo FelisMC/Felis --dir felis-<tag> \
     --pattern 'felis-*linux-amd64*' --pattern felis-velocity.jar --pattern SHA256SUMS
   ```

   For an ARM64 host, replace `amd64` with `arm64`. `SHA256SUMS` lists both architectures; the files of the other architecture may be left out.
2. Download the installer script of the same tag from `https://raw.githubusercontent.com/FelisMC/Felis/<tag>/deploy/bootstrap.sh`.
3. Copy the asset directory and the script to the host, for example to `/root/felis-<tag>`.
4. On the host, run the installer with the absolute path of the asset directory:

   ```bash
   sudo FELIS_ARTIFACT_DIR=/root/felis-<tag> bash bootstrap.sh
   ```

If an asset is missing from the directory or fails verification, the installation stops. `FELIS_ARTIFACT_DIR` cannot be combined with `FELIS_REF` or `FELIS_SKIP_FETCH`.

The rest of the host's software is still downloaded: k3s and its images, the JRE, cloudflared, Velocity and the Via plugins come from GitHub and PaperMC; hosts of the Red Hat and SUSE families with SELinux enabled also install k3s-selinux from rpm.rancher.io; system packages come from the distribution's repositories. A host with restricted outbound access must allow HTTPS to these addresses or set `https_proxy`. Fully offline installation is not supported yet. For the address list, see [Network](/en/guide/requirements#network).

## Checking the installation {#verify-install}

After installation and setup, confirm that Felis is running:

1. Show the overall status. The command summarizes the node, control plane, game proxy, each server, backups and open alerts:

   ```bash
   sudo felis status
   ```

2. Run the health check. The command lists problems by area with pointers for investigation, and sends no email:

   ```bash
   sudo felis doctor
   ```

3. Confirm that the control-plane pods are `Running` and the game proxy service is active:

   ```bash
   sudo k3s kubectl -n felis get pods
   sudo systemctl status felis-velocity
   ```

4. Open the operator console in a browser and sign in as the Owner with your passkey.
5. Connect to the game address with Minecraft Java Edition and confirm that you arrive in the login space. Follow the proxy log with `sudo journalctl -u felis-velocity -f`.

After installation, Felis is reached at these addresses:

| Purpose | Address |
| --- | --- |
| Operator console (Owner, Admin) | `https://op.console.<root>`; with Local only, `https://op.console.<root>:30443` |
| Player console | `https://console.<root>`; with Local only, `https://console.<root>:30443` |
| Direct access by IP | `https://<node-ip>:30443`, with a self-signed certificate the browser asks you to confirm on the first visit; passkeys cannot be used here |
| Game address | `<node-ip>:25565`; point `mc.<root>` at it. Each server is reached at `<subdomain>.<root>` |

The **Account** page shows the join address and the Minecraft Java Edition client version that the login space and the lobby require. The installer records the version it built in `[velocity].game_version` of `felis.toml`; custom login space or lobby images must set it themselves, otherwise the panel reports the version as not configured.

If something is wrong, see [Troubleshooting](/en/operations/troubleshooting#first-steps).

## Next steps {#next-steps}

- Configure mail delivery under **Platform settings → Notifications and retention → Mail delivery**, for sign-in codes and alerts. See [Platform settings](/en/guide/administration#platform-settings).
- Configure the off-site copy so that backups are kept away from the host. See [Off-site copy](/en/operations/backup#offsite).
- Set up authentication sources and the player entry policy. See [Authentication sources](/en/guide/players#auth-sources) and [Player entry policy](/en/guide/players#entry-policy).
- Create your first server. See [Creating a server](/en/guide/servers#create-server).
