---
title: Requirements
description: Supported operating systems, hardware sizing, disk, network, DNS and time requirements of a Felis host, and the checks the installer runs before it changes anything.
---

# Requirements {#requirements}

This page is for operators planning a Felis host. It lists the supported operating systems, how much CPU, memory and disk to provide, the ports, network ranges and DNS records Felis uses, the address and clock requirements, and the checks the installer runs before it changes the host. Installation itself is described in [Installation](/en/guide/deployment#install).

## Supported hosts {#supported-hosts}

Felis installs on a single Linux host by default. Spreading game servers over several machines is optional and described in [Multi-node and high availability](/en/guide/distributed#overview).

The host needs:

- a 64-bit x86 (`x86_64`) or ARM (`aarch64`) processor. 32-bit hosts are not supported;
- systemd as the init system, with the memory cgroup controller enabled;
- root access;
- one of the package managers in the table below.

| Distribution | Package manager | Architectures |
| --- | --- | --- |
| CentOS Stream 9, RHEL 9, Rocky Linux 9, AlmaLinux 9, Fedora | dnf | x86_64, aarch64 |
| Ubuntu 24.04 LTS and other Ubuntu releases, Debian 12 | apt | x86_64, aarch64 |
| openSUSE Leap, openSUSE Tumbleweed | zypper | x86_64, aarch64 |
| Arch Linux | pacman | x86_64, aarch64 |

CentOS Stream 9 (aarch64, with firewalld active and SELinux enforcing) and Ubuntu 24.04 LTS (x86_64) are the reference platforms. The other distributions use the same installation path.

The installer brings everything else: k3s, the Java runtime for the game proxy, cloudflared, and Docker when an image has to be built on the host. PostgreSQL runs inside k3s as the `felis-postgres` Deployment, with its data on the host in `/var/lib/felis/postgres`. A k3s server already installed on the host is reused, and Felis adds its namespaces to that cluster. Another Kubernetes distribution (kubelet, RKE2, k0s, MicroK8s) or a k3s agent on the host is refused. The component versions a fresh installation receives are listed in [Component versions](/en/operations/upgrade#component-versions).

## Sizing {#sizing}

### What the platform uses {#platform-usage}

Approximate memory use of an idle platform:

| Component | Memory |
| --- | --- |
| k3s (API server, controllers, scheduler, kubelet) | about 370 MiB |
| k3s's containerd and the pods' shims | about 170 MiB |
| CoreDNS and the local-path volume provisioner | about 105 MiB |
| Velocity, the game proxy (idle; grows with players) | about 175 MiB |
| felis-api, felis-operator, registry gate | about 85 MiB together |
| Image registry | about 25 MiB |
| PostgreSQL | about 40 MiB, plus page cache |
| **Infrastructure total** | **about 1 GB** |

The system servers come on top: the login space (Limbo, pod limit 512 MiB, about 0.16 GB in use) and the lobby (Paper, pod limit 1 GiB, about 0.7–0.85 GB in use). The [small-host profile](#small-hosts) has no lobby and limits the login space's pod to 320 MiB. Every game server adds the memory its owner assigned to it: the pod's limit equals its request, and the Java heap is derived from it. Quotas cap the memory per user ([Quotas](/en/guide/administration#quotas)).

A release installation builds nothing on the host. When the installer does build images on the host, its peak is the image builds (Docker and a Gradle container); afterwards it stops Docker, so that memory returns to the servers. On a node without swap, the installer creates a `/swapfile` as large as physical memory (at least 2 GiB) to hold the memory of [hibernated](/en/guide/servers#hibernate) servers; it skips the file when the root filesystem would have less than 10% free after the installation. Existing swap is left as it is, and the installer warns when it is smaller than physical memory. Some cloud images set `vm.swappiness` to 0, which keeps the kernel from swapping until memory runs out, so the host stalls reclaiming its page cache; when swap is active and the value is 0, the installer restores the kernel default of 60, writes it to `/etc/sysctl.d/99-zz-felis-swappiness.conf` and reports the change.

### Recommendations {#recommendations}

| Concurrent players | Game servers running | CPU | RAM | `FELIS_VELOCITY_XMX` |
| --- | --- | --- | --- | --- |
| up to 20 | 1–2 small | 2 vCPU | 4 GB + 2 GB swap | 1G (default) |
| up to 100 | 3–5 | 4 vCPU | 8–16 GB | 1G |
| up to 300 | 5–10 | 8 vCPU | 16–32 GB | 2G |
| over 300 | more | 8+ vCPU | 32 GB or more | 3G–4G |

The player counts are planning figures: a Minecraft server's cost depends mostly on what its players do (view distance, redstone, mods). Size RAM as follows: about 1 GB for the infrastructure, about 1 GB for the login space and lobby (about 0.2 GB for the login space alone on the small-host profile), plus the sum of the servers expected to run at the same time, then add a quarter for the page cache and PostgreSQL.

### Small hosts {#small-hosts}

A host with less than 3.5 GiB of memory gets the small-host profile on its first installation, which lowers the platform's own memory use:

- No lobby is deployed. Players authenticate in the login space and then enter their destination server directly, waiting in the login space while it starts ([Player entry policy](/en/guide/players#entry-policy));
- The login space's pod is limited to 320 MiB;
- The game proxy's heap ceiling defaults to `256M` ([Game proxy memory](#proxy-heap));
- k3s runs without the Helm controller, which Felis does not use, and with a 400 MiB soft limit on its Go heap.

On a "2 GB" cloud host that reports about 1.6 GiB, the idle platform takes about 0.6 GB on the small-host profile and the components shipped with the system image another 0.4 GB, which leaves too little for a Paper server: starting one keeps the host paging, and the platform stops responding. A host that runs game servers needs at least 4 GB of memory, as in [Recommendations](#recommendations).

The installer variable `FELIS_HOST_PROFILE` selects the profile:

| Value | Behavior |
| --- | --- |
| `auto` (default) | `small` for a fresh installation with less than 3.5 GiB of memory, otherwise `standard`. Later runs keep the profile recorded in `/etc/felis/host-profile`, also after the host gains memory. |
| `small` | The small-host profile. The installer refuses to switch an installation that has a lobby to it. |
| `standard` | The standard profile. After a small-host installation is rerun with this value, the lobby can be created under **Login & lobby**. |

### Game proxy memory {#proxy-heap}

The game proxy (Velocity) needs little memory per player. Its heap ceiling is `FELIS_VELOCITY_XMX`: default `1G`, or `256M` on the [small-host profile](#small-hosts); at least `256M`, written as `<n>M` or `<n>G`. Raise it when `journalctl -u felis-velocity` shows long garbage-collection pauses or `OutOfMemoryError`.

- In the panel: **Platform settings → Access and security → Game proxy**, set **Heap ceiling** (256M to 64G) and select **Apply**. The value is kept across installer reruns and updates.
- On the command line: rerun the installer with `FELIS_VELOCITY_XMX`, for example `FELIS_VELOCITY_XMX=2G`. The installer reads the variable on every run.

::: warning
Changing the heap ceiling restarts the game proxy, which disconnects every player online. Make the change at a quiet hour.
:::

## Disk {#disk}

Provide at least **40 GB** of disk, and 60 GB or more once worlds and custom images accumulate. The worlds, world archives, registry, uploads and container images are stored under `/var/lib/rancher/k3s` and share one filesystem with it; the requested volume sizes are not enforced. To keep this data off the system disk, put `/var/lib/rancher/k3s` on a disk of its own ([Move the data to its own disk](/en/operations/storage#move-data)).

The space each part takes, and how to grow the disk later, are described in [Storage and disks](/en/operations/storage#disk-layout). The free space the installer needs is listed under [Preflight checks](#preflight).

## Network {#network}

### Ports {#ports}

| Port | Protocol | Purpose | Reached from |
| --- | --- | --- | --- |
| 25565 (`FELIS_GAME_PORT`) | TCP | the game proxy; players connect here | players |
| 30443 (`FELIS_PANEL_NODEPORT`) | TCP | the panel and API over HTTPS | panel users, or the reverse proxy in front of the panel; closed to the public when a Cloudflare Tunnel serves the panel |
| 6443 | TCP | the Kubernetes API (k3s) | the host and its pods; the other nodes in a multi-node deployment |
| 6444, 10248–10259 | TCP | k3s's supervisor, kubelet, kube-proxy, controller manager and scheduler | the host itself |
| 5000 | TCP | the image registry's loopback port | the host itself |
| 15432 | TCP | the database's loopback port | the host itself |

How the panel is reached (directly, through your own reverse proxy, or through Cloudflare Tunnel) is described in [Access methods](/en/operations/access#access-methods). Network requirements between nodes are described in [Isolation and network requirements](/en/guide/distributed#isolation).

### Firewall and network ranges {#firewall}

The installer opens the host firewall; it never turns it off.

- With firewalld active, it opens the panel port, the game port and 6443, and puts k3s's pod and service ranges in the trusted zone.
- With ufw enabled (common on Ubuntu and Debian), it admits `10.42.0.0/16` and `10.43.0.0/16`, the panel port and the game port, each rule commented `felis-…`. Port 6443 stays closed to the network, because pods reach the API server from their own range.
- Uninstalling removes these rules again.

Any other firewall in front of the host must admit the same traffic. Dropped pod traffic shows up as the first rollout timing out with `control-plane rollout did not complete`.

k3s uses `10.42.0.0/16` for pods and `10.43.0.0/16` for services. The host's address and the networks it routes to must lie outside these ranges; a Docker network inside them is the usual conflict. A wider route that covers them, such as a `10.0.0.0/8` VPN, makes hosts in those ranges unreachable from the host, and preflight warns about it.

### Outbound access {#outbound}

The host needs outbound HTTPS, directly or through `https_proxy`, to these addresses:

| Host | What comes from it |
| --- | --- |
| `github.com`, and the githubusercontent.com hosts its release downloads redirect to | Felis release assets, k3s and its images, cloudflared, the Temurin JRE, ViaVersion, ViaBackwards and ViaRewind |
| `raw.githubusercontent.com` | k3s's install script, until k3s is installed |
| `rpm.rancher.io` | k3s-selinux, which k3s's install script adds on an SELinux host of the Red Hat or SUSE family (CentOS Stream, RHEL, Rocky, Alma, Fedora, openSUSE Leap), until k3s is installed |
| `fill-data.papermc.io` | the Velocity jar, unless `FELIS_VELOCITY_FORK_JAR` supplies one |
| the distribution's package mirrors | base packages (CA certificates, OpenSSL, curl and tar where missing), and container-selinux beside k3s-selinux |
| Docker Hub | needed only when images are built on the host |

A fully offline installation is not supported. Installing from pre-downloaded release assets removes the download of Felis's own binary and images, while the other software is still downloaded ([Installing from pre-downloaded assets](/en/guide/deployment#offline-install)). Some installer overrides add download hosts: `FELIS_JRE_VERSION` reads `api.adoptium.net`, a `FELIS_VELOCITY_VERSION` other than the pinned one reads `fill.papermc.io`, and `FELIS_GAME_STACK=latest` builds its images on the host from Docker Hub, PaperMC, Limbo's CI and LuckPerms.

Allow outbound UDP 123 for time synchronization ([Time synchronization](#time-sync)).

## DNS {#dns}

Felis serves everything under one root domain, set with `FELIS_ROOT_DOMAIN` at the first installation. The default is `<node-ip>.nip.io`, which needs no DNS records of your own. A rerun of the installer keeps the installed domain; `felis domain set` moves it later ([Changing the root domain](/en/operations/access#change-domain)).

| Name | Used for |
| --- | --- |
| `<name>.<root>` | each game server, as players address it; with `:<port>` appended when the game port is not 25565 |
| `console.<root>` | the panel |
| `op.console.<root>` | the admin console |

With a domain of your own, create records that lead to the host for `<root>`, `*.<root>`, `console.<root>` and `op.console.<root>`. The wildcard does not cover `op.console.<root>`, a third-level name, so give it its own record. When a Cloudflare Tunnel serves the panel, only `<root>` and `*.<root>` need to point at the host. How players join is described in [Player access](/en/guide/players#joining).

## Static address {#static-address}

An installation is bound to the IPv4 address it was made on: the k3s node, the network policies, the panel certificate and the default `nip.io` domain all carry it. Give the host a static address or a DHCP reservation before installing.

- The installer warns when the address is a DHCP lease.
- When the host loses its address, the watchdog reports `host-address` (critical, after 5 minutes). See [Troubleshooting](/en/operations/troubleshooting#host-address-changed).
- The k3s node name is pinned at installation, so changing the hostname is harmless.

## Time synchronization {#time-sync}

The host's clock must be kept by NTP. Sign-in codes and sessions expire by it, S3 refuses off-site uploads signed more than 15 minutes off, and certificate checks fail on a clock far off.

- The installer turns NTP on (`timedatectl set-ntp true`, installing chrony where no client can be enabled) and waits for the clock to synchronize. Set `FELIS_MANAGE_TIME_SYNC=0` on a host whose clock is kept another way.
- Allow outbound UDP 123; a firewall that drops it keeps the clock unsynchronized.
- The watchdog reports an unsynchronized clock as `clock` (warning, after 30 minutes). Check with `timedatectl` (expect `System clock synchronized: yes` and `NTP service: active`) and `chronyc sources`. See [Troubleshooting](/en/operations/troubleshooting#clock).

## Preflight checks {#preflight}

Before it changes anything, the installer checks the host, reports every problem at once, and stops with the host untouched. It checks:

- **Platform**: the architecture (`x86_64` or `aarch64`), systemd as init, and the memory cgroup controller k3s needs. On a Raspberry Pi, add `cgroup_memory=1 cgroup_enable=memory` to `/boot/firmware/cmdline.txt` and reboot.
- **Memory**: less than 1.5 GiB is refused (a "2 GB" cloud host, which reports 1.6–1.9 GiB after the kernel's share, passes); a fresh installation with less than 3.5 GiB uses the [small-host profile](#small-hosts), and the standard profile warns.
- **Free disk** on each filesystem the installer writes to, summed when several directories share one filesystem:

  | Directory | Free space needed (first installation) | On a rerun or a reused directory |
  | --- | --- | --- |
  | `/var/lib/rancher` | 10 GiB | 3 GiB |
  | `/var/lib/felis` | 4 GiB when installing a release, otherwise 2 GiB | 3 GiB or 1 GiB |
  | `/opt/felis` | 3 GiB | 1 GiB |
  | `/var/lib/containerd` (only when images are built on the host) | 8 GiB | 2 GiB |

  On a bare host with a single filesystem this comes to about 17 GiB for a release installation, 15 GiB from `FELIS_ARTIFACT_DIR` and 23 GiB when the images are built on the host; about 7 GiB for a rerun. A filesystem that would end above 85% full is a warning, because k3s starts deleting cached images there.
- **Ports**: the game port, 6443, 6444, 10248, 10249, 10250, 10256, 10257, 10259, the panel port, the registry's loopback port 5000 and the database's loopback port 15432. A port held by the installer's own units (a rerun) passes; any other program holding one is reported by name.
- **Other Kubernetes**: another distribution (kubelet, RKE2, k0s, MicroK8s) or a k3s agent on the host is refused.
- **Network ranges**: the host's address or a routed network inside `10.42.0.0/16` or `10.43.0.0/16` is refused; a wider route that covers them is a warning.
- **Outbound HTTPS** to the download hosts of this run ([Outbound access](#outbound)). A host counts as reachable once a TLS handshake completes; each gets three tries two seconds apart, and the unreachable ones are listed in one message (`cannot reach … over HTTPS`). When installing a release, an unreachable Docker Hub is a warning; from `FELIS_ARTIFACT_DIR` it is not checked.

`FELIS_PREFLIGHT=warn` reports the same problems as warnings and installs anyway, for a host the checks misjudge.
