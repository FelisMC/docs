---
title: Configuration reference
description: Installer environment variables, felis.toml sections and keys, the files under /etc/felis, and how settings saved in the panel take precedence.
---

# Configuration reference {#configuration}

This page lists every setting an operator can make on a Felis host: the environment variables the installer reads, the sections and keys of `felis.toml`, the files under `/etc/felis`, and the settings saved in the panel together with their precedence. It is for operators who install, configure and maintain a host.

## Where settings live {#overview}

A Felis host has three layers of configuration:

- **Installer variables** (`FELIS_*`) are read on every installer run. Most of them are recorded in the files they produce, so a later run keeps the result.
- **Host files** under `/etc/felis`: the configuration file `felis.toml` and the files that hold credentials and installer records.
- **Settings saved in the panel**, stored in the database. Where the panel and a host file configure the same thing, the panel's value takes precedence; see [Panel settings and precedence](#panel-settings-precedence).

## Installer variables {#installer-variables}

### Passing variables {#passing-variables}

Name each variable on the `sudo` line of the installer command:

```bash
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh \
  | sudo FELIS_VERSION_BOOTSTRAP=dev FELIS_VELOCITY_XMX=2G bash
```

`sudo` resets the environment, so a variable exported before `sudo` does not reach the installer. Either name it on the `sudo` line as above, or export it and run `sudo -E bash`.

Variables that apply only to the first install, or that later runs keep without being named again, say so in their description. A rerun reuses the generated credentials in `/etc/felis/secrets.env` and keeps the installed root domain.

### Install mode and channel {#install-source-variables}

| Variable | Default | Description |
| --- | --- | --- |
| `FELIS_INSTALL_MODE` | Ask on a terminal, otherwise `full` | `full` installs the whole platform. `nano` installs only Felis-nano, the Yggdrasil `hasJoined` multiplexer, without k3s or PostgreSQL. On a host that runs Felis-nano and no full install, the default is `nano`. |
| `FELIS_VERSION_BOOTSTRAP` | `release` | `release` installs the newest published release from its assets, each checked against the release's `SHA256SUMS`. `dev` builds the newest `main` commit from source. A rerun must name the channel again. |
| `FELIS_RELEASE` | Newest release | A published release tag (`v1.2.3`) to install instead of the newest, from its assets. Use the installer of the same tag. This is the way back to an earlier release. |
| `FELIS_REF` | — | A branch, tag or commit to build from source. It overrides the channel. |
| `FELIS_ARTIFACT_DIR` | — | Absolute path of a directory holding a release's assets. The Felis binary, images and plugin are installed from there; nothing of Felis's own is downloaded or built, and a missing or mismatching file stops the install. Cannot be combined with `FELIS_REF` or `FELIS_SKIP_FETCH`. |
| `FELIS_SKIP_FETCH` | — | Build the source tree already present in `/opt/felis/src` without fetching it. |
| `FELIS_REPO_URL` | `https://github.com/FelisMC/Felis.git` | Git repository to build from and to look up releases in. |
| `FELIS_GITHUB_TOKEN` | — | GitHub token, needed only to install from a private fork. Secret. |
| `FELIS_FORCE_UPDATE` | — | `1` reinstalls the binary even when its version already matches. |
| `FELIS_IMAGE` | `registry.felis.svc:5000/felis/felis:<version>` | Control-plane image reference. An image outside the in-cluster registry is used as it is and is not copied into the registry. |

See [Release channels](/en/guide/deployment#channels) and [Installing from downloaded assets](/en/guide/deployment#offline-install).

### Network and domain {#network-variables}

| Variable | Default | Description |
| --- | --- | --- |
| `FELIS_ROOT_DOMAIN` | `<node-ip>.nip.io` | Root domain of the install. First install only: a rerun keeps the installed domain and stops when given a different one. Move the domain with [`felis domain set`](/en/reference/cli#domain). |
| `FELIS_PANEL_NODEPORT` | `30443` | NodePort of the built-in HTTPS panel and API. |
| `FELIS_GAME_PORT` | `25565` | Port on which the game proxy accepts players. The panel adds it to server addresses when it is not `25565`. |

See [Network and ports](/en/guide/requirements#network).

### Access and Cloudflare {#access-variables}

The access method (direct access, your own reverse proxy, or Cloudflare Tunnel with Access) has no installer variable. Choose it in the setup wizard or on **Platform settings → Access and security**; see [Access methods](/en/operations/access#access-methods). The installer variables for Cloudflare control the `cloudflared` binary:

| Variable | Default | Description |
| --- | --- | --- |
| `FELIS_CLOUDFLARED_VERSION` | `2026.9.1` | cloudflared release installed when none is present. An installed cloudflared moves to it only with `FELIS_UPGRADE_DEPS=1`. |
| `FELIS_CLOUDFLARED_SHA256` | Pinned for the default version | sha256 of that release for this architecture. Required for any other version. |

### Component versions {#component-variables}

| Variable | Default | Description |
| --- | --- | --- |
| `FELIS_K3S_VERSION` | `v1.36.4+k3s1` | k3s release a fresh install gets. An installed k3s is left alone unless `FELIS_UPGRADE_DEPS=1`. |
| `FELIS_UPGRADE_DEPS` | `0` | `1` moves an installed k3s and cloudflared to the pinned versions (k3s one minor version at a time, never downgraded) and restarts `cloudflared-felis` on the new binary. |
| `FELIS_JRE_VERSION` | `25` | Temurin feature version the game proxy runs on. The default's build and digests are pinned; another feature version is checked against the digest Adoptium publishes. |
| `FELIS_GO_VERSION` | `1.27.2` | Go toolchain used to build the Felis-nano binary. |
| `FELIS_GO_SHA256` | Pinned for the default version | sha256 of that Go release for this architecture. Required for any other version. |

See [Component versions](/en/operations/upgrade#component-versions).

### Storage and backups {#storage-variables}

| Variable | Default | Description |
| --- | --- | --- |
| `FELIS_BACKUP_PVC` | `felis-backups` | World archive volume. An empty value disables world backups; the backup endpoints then answer 503. |
| `FELIS_ARCHIVE_LOCAL_PATH` | `/var/lib/felis/archives` | Path at which that volume is mounted inside backup Jobs. Written to `[archive] local_path`. |
| `FELIS_WORLDS_HOST_PATH` | Unset | Node directory holding the world volumes (`/var/lib/rancher/k3s/storage` on the installer's k3s). When set, the daily reaper also archives and then deletes worlds idle for 15 days. When unset, worlds are never deleted and the reaper only removes expired backups. See [World cleanup](/en/operations/backup#world-cleanup). |
| `FELIS_REGISTRY_STORAGE` | `10Gi` | Capacity the registry volume requests. First install only; k3s local-path storage does not enforce it. |
| `FELIS_UPLOADS_STORAGE` | `5Gi` | Capacity the uploads volume requests. First install only; not enforced. |
| `FELIS_BACKUP_STORAGE` | `10Gi` | Capacity the world archive volume requests. First install only; not enforced. |
| `FELIS_DB_BACKUP_DIR` | `/var/lib/felis/db-backups` | Directory of the database bundles. |
| `FELIS_DB_BACKUP_TIME` | `*-*-* 03:30:00` | systemd calendar expression of the daily database backup; the timer adds up to 15 minutes of random delay. The panel can set it. |
| `FELIS_DB_BACKUP_KEEP` | `14` | Daily bundles kept. The panel can set it. |
| `FELIS_DB_BACKUP_METRICS` | `/var/lib/node_exporter/textfile_collector/felis_db_backup.prom` | node-exporter textfile that each daily backup rewrites. |
| `FELIS_PRE_MIGRATE_BACKUP` | `1` | `0` applies pending migrations without the pre-migration bundle. Use it only when that bundle cannot be taken and another backup exists. |

See [Database bundles](/en/operations/backup#database-backups) and [Disk layout](/en/operations/storage#disk-layout).

### Off-site copy {#offsite-variables}

| Variable | Default | Description |
| --- | --- | --- |
| `FELIS_OFFSITE_ENDPOINT` | — | `https://host[:port]` of the S3-compatible store. Required with a bucket. |
| `FELIS_OFFSITE_BUCKET` | — | Bucket name. Setting it turns the off-site copy on. |
| `FELIS_OFFSITE_REGION` | — | Bucket region. |
| `FELIS_OFFSITE_PREFIX` | — | Key prefix, so that one bucket can hold several installs. |
| `FELIS_OFFSITE_DB_KEEP` | `30` | Newest database bundles kept in the bucket. |
| `FELIS_OFFSITE_ACCESS_KEY` | — | Bucket access key. Secret; stored in `/etc/felis/offsite.env`. |
| `FELIS_OFFSITE_SECRET_KEY` | — | Bucket secret key. Secret; stored in `/etc/felis/offsite.env`. |
| `FELIS_OFFSITE_KEY` | Generated | Encryption key, as printed by `felis offsite keygen`. Secret. When none exists the installer generates one and shows it once on the terminal. A rerun refuses a key that differs from the one in `offsite.env`. |
| `FELIS_RESTORE_FROM_OFFSITE` | — | `1` rebuilds this fresh host from the off-site copy once it is installed, by running `felis restore-host`. Requires `FELIS_OFFSITE_ENDPOINT`, `FELIS_OFFSITE_BUCKET`, `FELIS_OFFSITE_ACCESS_KEY`, `FELIS_OFFSITE_SECRET_KEY` and `FELIS_OFFSITE_KEY`. |
| `FELIS_RESTORE_BUNDLE` | Newest bundle | Bundle name (`felis-db-<stamp>-<label>.tar`) from `felis offsite list` to rebuild from. |
| `FELIS_RESTORE_TAKE_OVER` | — | `1` makes this host the one that writes the bucket once rebuilt. Leave it unset on a rehearsal machine. |

The values must not contain quotes, backslashes or line breaks. A rerun without these variables keeps the existing `[offsite]` section and `offsite.env`. See [Off-site copy](/en/operations/backup#offsite) and [The encryption key](/en/operations/backup#offsite-key).

::: danger
Keep `FELIS_OFFSITE_KEY` somewhere other than the host. Without it, nothing in the bucket can be read.
:::

### Game stack and proxy {#game-stack-variables}

| Variable | Default | Description |
| --- | --- | --- |
| `FELIS_GAME_STACK` | `pinned` | `pinned` installs the Limbo, Paper, LuckPerms and Velocity builds the release pins, each checked against its sha256. `latest` resolves upstream's newest builds on every run and builds the game images on the host. |
| `FELIS_VELOCITY_VERSION` | The pinned version | Another Velocity version installs the newest build of that version. |
| `FELIS_VELOCITY_XMX` | `1G`, `256M` on the small-host profile | Maximum heap of the game proxy, written `<n>M` or `<n>G`, at least `256M`. Read on every run; a change restarts the proxy, which disconnects every player. The panel can set it. |
| `FELIS_VELOCITY_FORK_JAR` | — | Path to a Felis-Legacy Velocity fork build, installed as the proxy instead of stock Velocity. |
| `FELIS_VELOCITY_FORK_JAR_SHA256` | — | sha256 of that jar. Required when the jar is set; a mismatch stops the install. |
| `FELIS_LEGACY_FORWARDING_SERVERS` | `legacy18` | Comma-separated servers that always receive the player's identity through the handshake address, in addition to servers set to legacy forwarding. See [Forwarding mode](/en/guide/servers#forwarding-mode). |
| `FELIS_LIMBO_IMAGE`, `FELIS_LOBBY_IMAGE`, `FELIS_PAPER_IMAGE` | `registry.felis.svc:5000/felis/limbo:demo`, `…/lobby:demo`, `…/paper:demo` | Image references of the login space, the lobby and the Paper base image. |
| `FELIS_NANO_LISTEN` | The address an installed felis-nano uses, else `127.0.0.1:8081` | Listen address of Felis-nano. Set a private-network address to serve a proxy on another host. |
| `FELIS_NANO_PROXY_CIDR` | — | The proxy allowed to reach a non-loopback Felis-nano, as an address with a prefix length (for example `10.0.0.7/32`). The host firewall opens the port to that source only. |

See [Sizing](/en/guide/requirements#sizing) for the proxy heap.

### Monitoring {#monitoring-variables}

| Variable | Default | Description |
| --- | --- | --- |
| `FELIS_WATCHDOG_HEARTBEAT_URL` | — | Heartbeat URL that each watchdog run pings. Written to `/etc/felis/watchdog-heartbeat-url` (mode 0600). `off` removes it; a rerun without the variable keeps it. Treat it as a secret: the URL's path is the check's key. A heartbeat saved in the panel takes precedence. |

See [External heartbeat](/en/operations/monitoring#heartbeat).

### Distributed mode and high availability {#distributed-variables}

| Variable | Default | Description |
| --- | --- | --- |
| `FELIS_DISTRIBUTED` | `0`; a rerun detects an existing distributed controller | `1` enables distributed mode on the controller. |
| `FELIS_NODE_EXTERNAL_IP` | — | This node's fixed external address. |
| `FELIS_PEER_CIDRS` | The list last installed | Exact peer addresses (`/32` or `/128`), comma-separated. A rerun without it keeps the list in `/etc/felis/node-peers`. |
| `FELIS_CONTROLLER_HA` | — | `1` enables controller high availability. Requires `FELIS_DISTRIBUTED=1`. Later runs keep it through `/etc/felis/ha.env`. |
| `FELIS_HA_VIP` | — | Optional IPv4 floating address with prefix length, such as `192.0.2.50/24`. |
| `FELIS_HA_VIP_INTERFACE` | The interface that carries the node address | Network interface of the floating address. |
| `FELIS_HA_VRID` | `51` | VRRP virtual router ID, 1–255. |
| `FELIS_LONGHORN_VERSION` | `v1.8.1` | Longhorn version installed for replicated storage. |

The installer's worker, controller-join and reconfigure modes are started by [`felis node`](/en/reference/cli#node), node operations and the panel, which set the variables those modes need. See [Multi-node and high availability](/en/guide/distributed#overview).

### Preflight and setup {#preflight-variables}

| Variable | Default | Description |
| --- | --- | --- |
| `FELIS_PREFLIGHT` | `strict` | `strict` stops on any preflight problem and lists them all. `warn` reports them and installs anyway, for a host the checks misjudge. |
| `FELIS_HOST_PROFILE` | `auto` | Host profile. `auto` picks `small` for a fresh installation with less than 3.5 GiB of memory, and later runs keep the recorded profile; `small` deploys no lobby and shrinks the components' memory; `standard` is the standard profile. See [Small hosts](/en/guide/requirements#small-hosts). |
| `FELIS_NO_SETUP` | — | `1` ends a full install at its summary. Otherwise an install on a terminal that leaves no Owner continues into `felis setup`. |
| `FELIS_MANAGE_TIME_SYNC` | `1` | `0` leaves the host's clock alone. By default the installer turns NTP on, installing chrony when nothing else can, and waits for synchronization. |
| `FELIS_MANAGE_JOURNAL` | `1` | `0` leaves journald alone. By default the installer makes the system journal persistent. |
| `FELIS_JOURNAL_MAX_USE` | `1G` | Size cap of the persistent journal, written `<n>K`, `<n>M` or `<n>G`. |
| `PKG_LOCK_TIMEOUT` | `900` | Seconds to wait for package manager locks. |

See [Preflight checks](/en/guide/requirements#preflight).

## felis.toml {#felis-toml}

The platform's configuration is a TOML file in two copies, both written by the installer:

- `/etc/felis/felis.host.toml`, the host copy, read by commands on the host. It reaches the database on a loopback port.
- `/etc/felis/felis.pod.toml`, the pod copy, stored in the `felis-config` Secret and read by the control plane.

`/etc/felis/felis.toml` is a link to the host copy and is the default `-config` of every `felis` command.

### Editing rules {#editing-rules}

- The installer regenerates both copies on every run. It carries forward the sections and keys an operator may edit: `[auth]`, `[smtp]`, `[[auth_source]]`, `[offsite]`, and the operator keys of `[registry]`, `[registry.s3]` and `[archive]` listed below. Any other edit is overwritten.
- To change a setting, edit `/etc/felis/felis.host.toml`, then rerun the installer, which carries the change into the pod copy and applies it.
- Unknown keys are refused. A misspelt key stops every command that reads the file with `config: unknown keys in <file>: <key>`.
- Time spans are written `90d` (days), `3mo` (months of 30 days), or a duration such as `12h` or `10m`. Sizes are written with `Gi`, `Mi`, `Ki`, `G`, `M` or `K`, or as a number of bytes.
- `[database] url` contains the database password, so both copies are readable by root only. Every other credential is kept out of the file: a key ending in `_ref` names the environment variable that holds the value.

### [auth] {#auth}

| Key | Default | Description |
| --- | --- | --- |
| `panel_hostname` | `console.<root domain>` | Hostname of the panel. |
| `admin_hostname` | `op.console.<root domain>` | Hostname of the admin console. |
| `access_jwt_aud` | — | Audience of the Cloudflare Access application, written by the Cloudflare step of `felis setup`. When it is set, the visitor's address is read from `CF-Connecting-IP`. |
| `client_ip_header` | — | Header into which the edge writes the visitor's address: `CF-Connecting-IP` behind the Cloudflare tunnel, `X-Forwarded-For` behind your own reverse proxy. The per-client sign-in rate limit uses it. Empty means the connection's own address, or `CF-Connecting-IP` when `access_jwt_aud` is set. |

`felis setup` and the panel's access method change write these keys. `felis domain set` moves hostnames that follow the default names and keeps hostnames set by hand.

### [smtp] {#smtp}

| Key | Default | Description |
| --- | --- | --- |
| `host` | — | Relay host. Without a relay, no sign-in code is mailed and sign-in works by passkey only. |
| `port` | `587` | `587` uses STARTTLS; `465` uses implicit TLS. |
| `from` | — | Sender address. Required when `host` is set. |
| `username` | — | Authentication user. Empty means the relay needs no authentication. |
| `password_ref` | `FELIS_SMTP_PASSWORD`, as written by `felis setup` | Environment variable that holds the relay password. The password is kept in `/etc/felis/smtp-password` and the `felis-smtp` Secret. |
| `max_per_hour` | `120` | Install-wide cap on the mail the API sends per hour. Keep it at or below the relay's own limit. |
| `require_tls` | On, except for a relay on this host | Refuse a relay on a port other than 465 that does not offer STARTTLS. |

A relay saved on **Platform settings → Notifications and retention → Mail delivery** takes precedence over `[smtp]`. See [Mail relay](/en/operations/monitoring#mail-relay).

### [[auth_source]] {#auth-source}

Each `[[auth_source]]` table is a third-party Yggdrasil provider. Mojang is built in and always checked first; the tables follow in the order written. A fresh install lists LittleSkin.

| Key | Description |
| --- | --- |
| `tag` | Permanent namespace of the provider's player UUIDs. Must be unique, must not contain `:` and must not be `mojang`. Changing it, even its case, gives every player of the provider a new UUID. |
| `prefix` | 1–4 letters or digits, unique regardless of case. Added to a player's name when that name belongs to a Mojang account, as in `LS_steve`. |
| `url` | Full `hasJoined` URL. `https://` is required, except `http://` for localhost or a loopback or private IP address. No query string or fragment. |
| `api_url` | Optional API root, for a provider whose `hasJoined` path is nonstandard; used for name and UUID lookups. |

```toml
[[auth_source]]
tag = "littleskin"
prefix = "LS"
url = "https://littleskin.cn/api/yggdrasil/sessionserver/session/minecraft/hasJoined"
```

The panel's **Platform → Authentication sources** page imports this list on first use. Once the Owner saves a list there, the panel's list takes precedence. Felis-nano always reads `felis.toml`. See [Authentication sources](/en/guide/players#auth-sources).

### [offsite] {#offsite}

| Key | Default | Description |
| --- | --- | --- |
| `endpoint` | — | `https://host[:port]` of the store, without a path. `http://` only for a store on a trusted network. |
| `bucket` | — | Bucket name. Without it there is no off-site copy. |
| `region` | — | Bucket region. |
| `prefix` | — | Key prefix. Must not contain `..`. |
| `access_key_ref` | `FELIS_OFFSITE_ACCESS_KEY` | Environment variable that holds the access key. |
| `secret_key_ref` | `FELIS_OFFSITE_SECRET_KEY` | Environment variable that holds the secret key. |
| `key_ref` | `FELIS_OFFSITE_KEY` | Environment variable that holds the encryption key. |
| `db_keep` | `30` | Newest database bundles kept in the bucket. |

The installer writes this section from the `FELIS_OFFSITE_*` variables and keeps the secrets in `/etc/felis/offsite.env`. To change the bucket, edit the section (and `offsite.env` for new credentials) and rerun the installer. To turn the copy off, delete the section and rerun the installer. **Maintenance & Backups → Off-site copy** in the panel does the same.

### [archive] {#archive}

| Key | Default | Description |
| --- | --- | --- |
| `retention` | `90d` | How long the archive of a removed world (reclaimed for idleness, released or deleted) is kept. |
| `warn_before` | `["3d", "1d"]` | How long before an idle world is reclaimed its owner is warned by mail. Worlds are reclaimed after 15 days idle when world cleanup is enabled. |
| `max_local_bytes` | No cap | Soft cap of the backup store, for example `"50Gi"`. At the cap, owners' backups and scheduled restore points pause, and the reaper removes the oldest owner backups and backups that already have an off-site copy. |
| `manual_retention` | `30d` | How long an owner's backup is kept. |
| `manual_keep` | `5` | Owner backups kept per server; the oldest go first. |
| `manual_cooldown` | `10m` | Shortest interval between two owner backups of one server. Administrators are not held to it. |
| `scheduled_every` | `1d` | Interval of the restore points taken of worlds played since their last one. `"0s"` turns them off. |
| `scheduled_keep` | `7` | Restore points kept per server. |
| `scheduled_retention` | `90d` | How long each restore point is kept. |

The **Backup and audit retention** card in the panel overrides every key in this table except `warn_before`. See [World backups](/en/operations/backup#world-backups) and [Daily restore points](/en/operations/backup#restore-points).

### [audit] {#audit}

| Key | Default | Description |
| --- | --- | --- |
| `retention` | `365d` | How long audit rows are kept. `"forever"` keeps every row; the minimum is `30d`. Export rows that must be kept longer with `felis db audit-export`. |

The **Backup and audit retention** card in the panel overrides it. See [Audit log](/en/guide/administration#audit-log).

### [registry] {#registry}

| Key | Default | Description |
| --- | --- | --- |
| `user_uploads_context` | Set by the storage step | Where uploaded build contexts are stored: `/var/lib/felis/uploads` on the local disk, or `s3://<bucket>[/<prefix>]`. Written by the storage step of `felis setup` or the panel's **Upload storage** card. |
| `user_uploads_max_bytes` | `4Gi` | Total size of all users' uploaded contexts. Each user also has a budget of 2 GiB. |
| `context_max_bytes` | `1Gi` | Maximum size of one uploaded build context. |
| `max_concurrent_builds` | `2` | Builds that run at once, 1–6. Later builds queue. |
| `build_cpu_limit` | `2` | CPU limit of each build container. |
| `build_mem_limit` | `4Gi` | Memory limit of each build container. |
| `build_disk_limit` | `12Gi` | Ephemeral storage of a build pod. |
| `build_user_namespaces` | `auto` | Run build pods in a user namespace: `auto` turns it on when felis-api finds at startup that the node supports it, `on` always, `off` never. |
| `build_runtime_class` | — | RuntimeClass for build pods, such as gVisor or Kata. Empty uses the node's default runtime. |
| `scan_fail_on` | `["CRITICAL"]` | Severities that block a built image: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `UNKNOWN`. |
| `scan_fail_unfixed` | `false` | Also block on vulnerabilities that have no fixed release. |
| `scan_accept` | — | Vulnerability ids and secret rule ids accepted as known risks. They are still listed in the scan and never block. |
| `kaniko_image`, `trivy_image` | The copies in the in-cluster registry | Build and scan tool images. Set them only to run another build of the tools. |
| `trivy_db_repository` | `<registry>/mirror/trivy-db:2` | Repository of the vulnerability database. |
| `trivy_java_db_repository` | `<registry>/mirror/trivy-java-db:1` | Repository of the Java database. |

See [Upload storage](/en/operations/storage#upload-storage) and [Build pipeline and submissions](/en/guide/administration#submissions).

### [registry.s3] {#registry-s3}

Used when `user_uploads_context` is an `s3://` location.

| Key | Default | Description |
| --- | --- | --- |
| `endpoint` | — | Endpoint of the S3-compatible store. |
| `region` | — | Region of the store. |
| `access_key_ref` | `FELIS_UPLOADS_S3_ACCESS_KEY`, as written by the storage step | Environment variable that holds the access key. |
| `secret_key_ref` | `FELIS_UPLOADS_S3_SECRET_KEY`, as written by the storage step | Environment variable that holds the secret key. |

The keys themselves are kept in `/etc/felis/uploads-s3-access-key`, `/etc/felis/uploads-s3-secret-key` and the `felis-uploads-s3` Secret.

### Installer-owned keys {#installer-owned}

The installer sets these keys on every run. Change them through the installer variable or command named here.

| Section | Key | Value |
| --- | --- | --- |
| `[server]` | `listen` | `0.0.0.0:8080`. |
| `[server]` | `root_domain` | The root domain. Change it with [`felis domain set`](/en/reference/cli#domain). |
| `[database]` | `url` | Connection URL, including the database password. Change the password with [`felis rotate-token db`](/en/reference/cli#rotate-token). |
| `[database]` | `deployment` | `felis/felis-postgres`, in the host copy only: `felis db` runs the PostgreSQL tools inside that pod. |
| `[k8s]` | `namespace` | `minecraft`, the namespace of the game servers. |
| `[velocity]` | `login_image`, `lobby_image` | Images of the login space and the lobby (`FELIS_LIMBO_IMAGE`, `FELIS_LOBBY_IMAGE`). An empty `lobby_image` means the platform has no lobby. |
| `[velocity]` | `login_memory` | Memory of the login space as a Kubernetes quantity; empty means `512Mi`. The small-host profile writes `320Mi`. |
| `[velocity]` | `game_port` | `FELIS_GAME_PORT`. |
| `[velocity]` | `game_version` | The Minecraft Java Edition version the login space and lobby images were built for. The panel shows the client version players need from it, and reports it as unknown when empty. |
| `[registry]` | `url`, `build_namespace` | `registry.felis.svc:5000` and `felis-build`. |
| `[archive]` | `store`, `local_path` | `tarLocal`, the only supported store, and `FELIS_ARCHIVE_LOCAL_PATH`. |

## Host files {#host-files}

### Files under /etc/felis {#etc-felis}

`/etc/felis` is readable by root only. Every database bundle contains a copy of the files in it, except `bootstrap.done`.

| File | Contents | Written by | Secret |
| --- | --- | --- | --- |
| `felis.host.toml` | Host copy of the configuration. Edit the carried sections here. | Installer | Contains the database password |
| `felis.toml` | Link to `felis.host.toml`; the default `-config` of every command. | Installer | — |
| `felis.pod.toml` | Pod copy of the configuration, stored in the `felis-config` Secret. Regenerated on every run. | Installer | Contains the database password |
| `secrets.env` | Generated credentials: the database password, the internal API tokens of the game proxy, the login space, builds and operations, the Velocity forwarding secret and the registry write tokens. Reused by every rerun. | Installer, `felis rotate-token` | Yes |
| `offsite.env` | Off-site bucket credentials and encryption key, mode 0600. | Installer, panel | Yes |
| `smtp-password` | Mail relay password. | `felis setup` | Yes |
| `uploads-s3-access-key`, `uploads-s3-secret-key` | Upload bucket credentials. | `felis setup`, panel | Yes |
| `watchdog-heartbeat-url` | Heartbeat URL, mode 0600. | Installer | Yes: the path is the check's key |
| `host-settings.env` | Installer settings saved in the panel: `FELIS_DB_BACKUP_TIME`, `FELIS_DB_BACKUP_KEEP`, `FELIS_VELOCITY_XMX`. | Panel | — |
| `host-profile` | The host profile (`small` or `standard`), kept by later installer runs. | Installer | — |
| `panel-tls.crt`, `panel-tls.key` | TLS certificate and key of the panel. The installer issues a self-signed pair valid for 825 days. | Installer, `felis domain set` | The key |
| `cloudflared.yml` | Cloudflare tunnel configuration. | Cloudflare step of `felis setup`, panel | — |
| `ha.env` | Controller high availability settings, kept for later installer runs and updates. | Installer | — |
| `ha-vrrp-pass` | VRRP password of the floating address. | Installer | Yes |
| `node-peers` | Peer list last installed by `felis node firewall`. | `felis node firewall` | — |
| `node-firewall.sh`, `control-firewall.sh` | Host isolation firewall scripts. | `felis node firewall` | — |
| `archive-transfer.key` | Key of the archive transfers between nodes in distributed mode. | Installer | Yes |
| `bootstrap.done` | Marks a completed install. | Installer | — |
| `system-server-images`, `velocity.fingerprint`, `previous-felis-image` | Installer records: the login space and lobby builds, what the game proxy was last started from, and the previous control-plane image for a rollback. | Installer | — |

::: danger
Files marked as secret, and every database bundle, give full control of the install. Never copy them to an untrusted place, and never paste their contents into a support request; [`felis support-bundle`](/en/reference/cli#support-bundle) removes their values for you.
:::

An uninstall keeps `/etc/felis` unless `--purge` is given; see [Uninstalling](/en/operations/uninstall#uninstall).

### Other host paths {#other-paths}

| Path | Contents |
| --- | --- |
| `/run/felis/watchdog-quiet-until` | Unix time until which the watchdog sends no mail and no failure ping. The installer writes it while it restarts services on purpose, and the panel writes it when alerts are held. See [Holding alert mail](/en/operations/monitoring#hold-alerts). |
| `/var/lib/felis/watchdog/state.json` | Watchdog state between runs. Root only; it caches the relay password. |
| `/var/lib/felis/db-backups` | Database bundles (`FELIS_DB_BACKUP_DIR`). |
| `/var/lib/felis/postgres` | The database cluster of felis-postgres. |
| `/var/lib/felis/offsite/status.json` | Result of the last off-site copy, read by `felis offsite status` and the watchdog. |
| `/var/lib/felis/offsite/host-id` | This host's id as a writer of the bucket. No bundle contains it. |
| `/var/lib/felis/restore-host` | The bundle and progress record of `felis restore-host`. |
| `/var/lib/felis/support` | Support bundles. |
| `/var/lib/felis/node-control` | Records of host tasks and node operations started from the panel. |
| `/opt/felis/velocity/plugins/felis-link/felis-link.properties` | Settings of the game proxy's Felis plugin, including its internal API token. Secret. |
| `/opt/felis/velocity/forwarding.secret` | The game proxy's forwarding secret. Secret. |
| `/etc/rancher/k3s/k3s.yaml` | The k3s administrator kubeconfig, readable by root only. Use `sudo k3s kubectl`. |

## Panel settings and precedence {#panel-settings-precedence}

The Owner can change several host settings in the panel. These rules decide which value applies.

### Panel values over host files {#panel-overrides}

A setting saved in the panel takes precedence over the same setting in `felis.toml` or a host file. Every process that uses the setting reads the panel's value from the database. Removing the panel's value makes the host value apply again.

| Setting | Panel location | Overrides | Back to the host value |
| --- | --- | --- | --- |
| Mail relay | **Platform settings → Notifications and retention → Mail delivery** | `[smtp]` | **Revert to install-time settings** |
| Heartbeat | **Platform settings → Notifications and retention → Monitoring heartbeat** | `/etc/felis/watchdog-heartbeat-url` | **Remove heartbeat URL** |
| Backup and audit retention | **Platform settings → Notifications and retention → Backup and audit retention** | `[archive]` `retention`, `max_local_bytes`, `manual_*`, `scheduled_*`; `[audit] retention` | **Restore install-time settings** |
| Authentication sources | **Platform → Authentication sources** | `[[auth_source]]` | — |

- The mail relay applies at once, without a restart, to felis-api, the watchdog, the reaper's notices and the break-glass console's codes.
- Retention applies at once in felis-api, and in the backup Jobs and the reaper at their next run.
- The heartbeat applies at the next watchdog run.
- Authentication sources apply at the next game login and name lookup, without a restart. Felis-nano keeps reading `[[auth_source]]` from `felis.toml`.

### Installer settings saved in the panel {#host-settings}

Some settings belong to the installer but can be changed in the panel. The panel keeps them in `/etc/felis/host-settings.env` and applies them by running the installer for the affected units only.

| Setting | Panel location | Installer variable |
| --- | --- | --- |
| Daily backup time | **Maintenance & Backups → Backups → Daily backup schedule** | `FELIS_DB_BACKUP_TIME` |
| Daily backups kept | **Maintenance & Backups → Backups → Daily backup schedule** | `FELIS_DB_BACKUP_KEEP` |
| Game proxy heap ceiling | **Platform settings → Access and security → Game proxy** | `FELIS_VELOCITY_XMX` |

Each later installer run and `felis update` uses these values as its defaults, so the Owner's choice survives upgrades. A variable named on an installer run takes precedence for that run only, and `host-settings.env` is left unchanged:

```bash
# host-settings.env holds FELIS_VELOCITY_XMX=2G. This run uses 3G; later runs use 2G again.
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh \
  | sudo FELIS_VELOCITY_XMX=3G bash
```

::: warning
Saving the daily backup schedule takes one backup at once. Changing the proxy heap, in the panel or through an installer run, restarts the game proxy and disconnects every player.
:::

### Changes the panel writes to host files {#panel-host-writes}

The panel's host operations write the same files as the command line, so the most recent change applies, whichever made it:

- the access method (`[auth]`, `cloudflared.yml`), as the connection step of `felis setup`;
- upload storage (`[registry]`, `[registry.s3]` and the upload bucket key files), as the storage step of `felis setup`;
- the root domain, through `felis domain set`;
- the off-site copy (`[offsite]` and `offsite.env`), the same as an installer run with `FELIS_OFFSITE_*`;
- credential rotation, through `felis rotate-token`.

Some settings exist only in the panel and have no file or variable: the player entry policy, the startup and wake policy, failover, and the maintenance window that `felis update --apply` checks. See [Platform settings](/en/guide/administration#platform-settings) and [Maintenance window](/en/operations/upgrade#maintenance-window).

### Order of precedence {#precedence-order}

For the settings in [Panel values over host files](#panel-overrides), from highest to lowest:

1. The value saved in the panel.
2. The value in `felis.toml` or the host file.
3. The built-in default.

For the [installer settings saved in the panel](#host-settings), from highest to lowest:

1. A variable named on the current installer run.
2. The value saved in the panel, kept in `/etc/felis/host-settings.env`.
3. The installer's default.
