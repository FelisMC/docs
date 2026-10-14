---
title: Operations overview
description: The components that run on a Felis host, routine operating tasks, and how host operations run from the panel and the command line.
---

# Operations overview {#operations}

This page is for the operators who run a Felis host. It describes what runs on the host, where the data lives, which tasks need doing regularly, and which host operations are available in the panel and which stay on the command line. For installation, see [Installation](/en/guide/deployment#install); for host sizing, see [Requirements](/en/guide/requirements#sizing).

## Host components {#components}

The default installation is a single node. The installer installs k3s on the host and runs the control plane, the database, the image registry and the game servers inside it; the game proxy runs directly on the host as a systemd service. For multi-node deployments, see [Multi-node and high availability](/en/guide/distributed#overview); for the overall design, see [Architecture](/en/reference/architecture#components).

| Component | Runs as | Purpose |
| --- | --- | --- |
| k3s | `k3s.service` | The Kubernetes cluster that hosts the containerized components below |
| felis-api | Deployment `felis-api` in the `felis` namespace | The web panel, the public API, and the internal API the game plugins use |
| felis-operator | Deployment `felis-operator` | Starts, stops and watches game servers (MinecraftServer resources) |
| PostgreSQL | Deployment `felis-postgres` | The control-plane database; its data is in `/var/lib/felis/postgres` on the host |
| Image registry | Deployment `registry` | The in-cluster registry for platform images, game images and user-built images |
| Login space and lobby | MinecraftServer `login` (Limbo) and `lobby` (Paper) in the `minecraft` namespace | Where players arrive after joining |
| Game servers | MinecraftServer resources in the `minecraft` namespace | The servers users create |
| Build jobs | Jobs in the `felis-build` namespace | Build server images from submissions |
| Game proxy (Velocity) | `felis-velocity.service` | Accepts player connections on the game port and forwards them to the servers |
| Host operations service | `felis-node-control.service` | Runs the host tasks started from the panel, as root |
| Cloudflare connector | `cloudflared-felis.service` | Present only when the access method is Cloudflare Tunnel |

The main data locations on the host are listed below. For the size and growth of each, see [Storage and disks](/en/operations/storage#disk-layout).

| Path | Contents |
| --- | --- |
| `/etc/felis` | Configuration and secrets: `felis.host.toml` (`felis.toml` links to it), `felis.pod.toml`, `secrets.env`, `offsite.env`, the panel TLS certificate and key, `host-settings.env`, and the tunnel configuration `cloudflared.yml` |
| `/var/lib/felis` | The database cluster (`postgres/`), database bundles (`db-backups/`), host task records (`node-control/`), watchdog state (`watchdog/`) and support bundles (`support/`) |
| `/var/lib/rancher/k3s` | k3s data, the world volumes (`storage/`), world archives, the image registry and container images |
| `/opt/felis` | Velocity, the Java runtime and build tools |
| `/usr/local/bin/felis` | The `felis` command, with the panel embedded |

The admin kubeconfig `/etc/rancher/k3s/k3s.yaml` is readable by root only. Run kubectl commands on the host as `sudo k3s kubectl`.

## Services and timers {#services}

Besides the long-running services above, the installer sets up these scheduled units:

| Unit | When it runs | Purpose |
| --- | --- | --- |
| `felis-watchdog.timer` | Every 2 minutes, first 3 minutes after boot | Health checks, alert mail and the external heartbeat; see [Watchdog](/en/operations/monitoring#watchdog) |
| `felis-watchdog-failed.service` | When a watchdog run fails | Reports the watchdog's own failure |
| `felis-db-backup.timer` | Daily at `FELIS_DB_BACKUP_TIME` (default 03:30, with up to 15 minutes of random delay); a missed run catches up after boot | Creates a database bundle; see [Database backups](/en/operations/backup#database-backups) |
| `felis-offsite.timer` | Hourly, present only once the off-site copy is configured | Copies the backups, encrypted, to the bucket; see [Off-site copy](/en/operations/backup#offsite) |
| `felis-update-check.timer` | Daily around 05:30; a missed run catches up after boot | Records a version check; see [Component versions](/en/operations/upgrade#component-versions) |
| `felis-build-tools.timer` | Daily at 04:00 and 16:00 | Copies kaniko, Trivy and its vulnerability databases into the in-cluster registry for image builds |
| World cleanup CronJob (in k3s) | Daily | Deletes expired world backups and, when idle-world retention is enabled, archives and deletes idle worlds; see [World cleanup](/en/operations/backup#world-cleanup) |

To check the services and timers:

```bash
systemctl list-timers 'felis-*'
systemctl status k3s felis-velocity felis-node-control
sudo k3s kubectl -n felis get pods
```

The **Services and timers** section of **Maintenance & Backups → Status** in the panel shows the same information.

### While the control plane restarts {#api-restarts}

felis-api runs as a single replica with the Recreate strategy: the old pod stops before the new one starts. When an installer run updates the API, the node restarts or the pod crashes, the API is unavailable until the new pod is ready, normally for a few seconds. During that time:

- Players already on a server stay there, and game servers keep running.
- A player leaving the login space or joining a server by its address is admitted when felis-api confirmed their account link within the last 10 minutes; everyone else is told that login verification is temporarily unavailable.
- The login space retries a new login for up to 60 seconds and tells the player it is retrying, so a short restart only delays the login.
- Wakes, server stops, `/link` and panel actions wait for the API.
- If the game proxy restarts in that window, it routes by the server list cached in `/opt/felis/velocity/plugins/felis-link/last-servers.json` until a refresh succeeds (every 15 seconds).

During a longer outage the proxy logs `server list refresh failed ... keeping current registrations`, then `still failing: ...`, and `server list refresh recovered after ...` once the API is back. The watchdog sends an alert once `deployment/felis-api` has been unavailable for 5 minutes.

## Routine tasks {#routine-tasks}

| Task | How often | Where |
| --- | --- | --- |
| Check the platform status, open alerts and disk usage | Daily | The **Platform status** bar on the Dashboard; **Maintenance & Backups → Status** |
| Confirm that alert mail is delivered: a mail relay is configured and the Owner's address is verified | Once after installation, then whenever the mail settings change | [Alert mail](/en/operations/monitoring#alerts), [Mail relay](/en/operations/monitoring#mail-relay) |
| Set up the external heartbeat, so that you hear when the whole host goes down | Once after installation | [External heartbeat](/en/operations/monitoring#heartbeat) |
| Configure the off-site copy and keep its encryption key off the host | Once after installation | [Off-site copy](/en/operations/backup#offsite), [Encryption key](/en/operations/backup#offsite-key) |
| Check that database backups and the off-site copy run on time | Weekly, or rely on watchdog alerts | [Database backups](/en/operations/backup#database-backups) |
| Review available updates and apply them in a maintenance window | Monthly or per release | [Upgrading](/en/operations/upgrade#update) |
| Rehearse a host rebuild on a spare machine | Once per release | [Host rebuild](/en/operations/backup#rebuild-host) |
| Rotate credentials when staff with host access leave | As needed | [Rotating credentials](/en/operations/access#rotate-credentials) |
| Export audit records before they pass their retention | According to the retention | [Exporting the audit log](/en/operations/monitoring#audit-export) |

## Running host operations from the panel {#panel-host-operations}

The Owner can run the host operations of day-to-day running on the operator console, under **Maintenance & Backups** (`/admin/updates`) and **Platform settings** (`/admin/platform`). The panel hands each operation to `felis-node-control.service`, which runs the same `felis` command or installer step as the command line, as root. felis-api itself stays unprivileged.

### Task rules {#task-rules}

- One host task runs at a time. Until it finishes, a new request is answered with `409 node_operation_busy` (`a host task is already running`), and the panel shows "Another host task is running. This action becomes available when it finishes."
- The host service accepts a fixed list of operations and validates every parameter. It offers no general command execution.
- An operation that interrupts players or the panel asks for confirmation. Restoring a database bundle asks for the bundle's name; rebuilding from the off-site copy asks for the word `REBUILD`.
- Every task and every download requires a fresh identity confirmation (a passkey or an email code, valid for 5 minutes) and is recorded in the audit log under `platform.host.*`; node operations are recorded under `platform.node.*`.
- Keys and tokens entered in the panel (bucket keys, the off-site encryption key, the Cloudflare API token) are passed to the executor only. They never appear in the task record, the task log or an API response.
- The stage, log and result of each task stay readable in the panel; the records are kept in `/var/lib/felis/node-control`. Losing the panel connection does not stop a task. Each operation has its own time limit, from 1 minute (starting the off-site copy) to 12 hours (the host rebuild).
- While a database restore, a host rebuild, a credential rotation or a domain change runs, the API refuses to start, maintain or migrate servers, as it does during node operations.

### Operation table {#operation-table}

| Operation | Panel location | Command line |
| --- | --- | --- |
| Host status: disks, memory, services and timers, the game proxy | **Maintenance & Backups → Status** → **Host status** | `felis status` |
| Watchdog alerts; holding alert mail for 1, 4 or 24 hours during planned work | **Maintenance & Backups → Status** → **Host status** → **Watchdog alerts**: **Hold alert mail**, **Resume alert mail** | `/run/felis/watchdog-quiet-until` |
| Database backup now | **Maintenance & Backups → Backups** → **Control-plane database backup** → **Back up now** | `felis db backup` |
| Verifying and restoring a database bundle | **Maintenance & Backups → Backups** → **Database backups on this host** → **Verify**, **Restore** | `felis db verify`, `felis db restore`, `felis migrate up` |
| Daily database backup time and number kept | **Maintenance & Backups → Backups** → **Database backups on this host** → **Daily backup schedule** | `FELIS_DB_BACKUP_TIME`, `FELIS_DB_BACKUP_KEEP`, installer re-run |
| World backup now, live or with the servers stopped first | **Maintenance & Backups → Backups** → **Back up worlds now** | `felis backup-now` |
| Audit log export | **Maintenance & Backups → Backups** → **Audit log export** | `felis db audit-export` |
| Configuring, changing or turning off the off-site copy | **Maintenance & Backups → Off-site copy** → **Configure**, **Change bucket**, **Turn off** | `FELIS_OFFSITE_*`, installer re-run |
| Copying now; listing the bucket; checking the key; taking over the bucket | **Maintenance & Backups → Off-site copy** → **Copy now**, **List bucket contents**, **Check key**, **Take over the bucket** | `systemctl start felis-offsite.service`, `felis offsite list`, `felis offsite check-key`, `felis offsite take-over` |
| Showing the off-site encryption key | **Maintenance & Backups → Off-site copy** → **Show key** | `/etc/felis/offsite.env` |
| Rebuilding this host from the off-site copy | **Maintenance & Backups → Off-site copy** → **Rebuild from the off-site copy** | `felis restore-host` |
| Health check | **Maintenance & Backups → Diagnostics** → **Health check** → **Run health check** | `felis doctor` |
| Support bundle, downloaded through the browser | **Maintenance & Backups → Diagnostics** → **Support bundle** → **Create support bundle** | `felis support-bundle` |
| Component versions; the maintenance window | **Maintenance & Backups → Updates** → **Component versions**, **Configure Maintenance Window** | `felis update` (read-only check); the maintenance window is set in the panel only |
| Access method: direct, own reverse proxy, Cloudflare Tunnel | **Platform settings → Access and security** → **Access and domain** → **Apply access method** | The access step of `felis setup` |
| Checking and changing the root domain | **Platform settings → Access and security** → **Access and domain** → **Root domain**: **Check current domain**, **Change domain** | `felis domain check`, `felis domain set` |
| Upload storage: this host or an S3-compatible bucket | **Platform settings → Access and security** → **Upload storage** → **Apply storage** | The storage step of `felis setup` |
| Credential rotation | **Platform settings → Access and security** → **Credential rotation** → **Rotate** | `felis rotate-token` |
| Game proxy heap ceiling | **Platform settings → Access and security** → **Game proxy** → **Heap ceiling**, **Apply** | `FELIS_VELOCITY_XMX`, installer re-run |
| System server completion | **Platform settings → Access and security** → **System server completion** → **Run completion** | `felis converge` (`felis converge -user-rcon` with **Enable RCON on older user servers**) |
| Mail relay | **Platform settings → Notifications and retention** → **Mail delivery** | The email step of `felis setup` (`[smtp]` in `felis.toml`) |
| External heartbeat URL | **Platform settings → Notifications and retention** → **Monitoring heartbeat** | `FELIS_WATCHDOG_HEARTBEAT_URL`, installer re-run |
| A server's forwarding mode | The server's console page → **Forwarding mode** | The `felis.lolicon.best/forwarding` label on the MinecraftServer |
| Node operations, including the floating address for controller high availability | **Platform settings → Distributed** → **Node operations** | `felis node …`, `FELIS_HA_VIP*`, installer re-run |

::: warning
Restoring the database, rebuilding the host, rotating credentials, changing the domain, and changing the access method or the upload storage all restart the panel or disconnect players. Read the matching page first, for example [Restoring the database](/en/operations/backup#restore-database) and [Changing the root domain](/en/operations/access#change-domain).
:::

Settings changed in the panel that the installer owns (the database backup schedule and the number kept, the game proxy heap ceiling) are stored in `/etc/felis/host-settings.env`. Later installer runs and `felis update` take them as their defaults, so the Owner's choice survives upgrades; an environment variable set explicitly for one run still takes precedence. The panel applies such a change by running the installer in reconfigure mode (`FELIS_INSTALL_MODE=reconfigure`, with `FELIS_RECONFIGURE` naming the parts), which rewrites only the affected units. For the precedence of settings, see [Configuration reference](/en/reference/configuration#panel-settings-precedence).

The Dashboard shows the Owner a **Platform status** bar: open alerts, the newest database backup, the off-site copy state and the disk with the least free space, each linking to the matching tab.

## Command-line-only operations {#command-line-only}

The panel does not offer the following:

- **Installation and installer re-runs**, including the first installation on a new host and rebuilding a lost host with `FELIS_RESTORE_FROM_OFFSITE=1`. The panel exists only after installation.
- **`felis setup`**, which creates the first Owner. Until then nobody can sign in to the panel.
- **`felis breakGlass`**, which restores access when no Owner can sign in and therefore does not depend on the panel; see [Emergency access](/en/operations/access#break-glass).
- **Version changes**: `felis update --apply` and installer runs for a new release. The **Updates** tab reports available versions and shows the command; applying a version replaces the programs the panel and the host service run from. See [Upgrading](/en/operations/upgrade#update).
- **Uninstalling**; see [Uninstall and reinstall](/en/operations/uninstall#uninstall).
- **Commands run by service units and the installer**, such as `felis api`, `felis operator`, `felis watchdog`, `felis ha leader` and `felis ha migrate-storage`.
- **The host operations service itself.** When `felis-node-control` is down, the panel cannot run any host task. Check and restart it on the host:

```bash
systemctl status felis-node-control
journalctl -u felis-node-control -n 50 --no-pager
sudo systemctl restart felis-node-control
```

For the full usage of each command, see [Command-line reference](/en/reference/cli#status).
