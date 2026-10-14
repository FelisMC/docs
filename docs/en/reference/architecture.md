---
title: Architecture
description: The components of Felis, the single-node and multi-node layouts, and how panel requests, player joins, host operations and image builds flow through the system.
---

# Architecture {#architecture}

This page describes the components Felis is made of, how they are placed in single-node and multi-node deployments, and how the main requests move between them. It is for operators and developers who need to understand the system as a whole. Day-to-day operation of each component is covered in the [Operations overview](/en/operations/).

## Components {#components}

The Felis control plane comes from a single `felis` binary. It contains the API, the operator, the command-line tools and the embedded web panel, and selects its role by subcommand, such as `felis api`, `felis operator` or `felis reaper`. The platform runs on k3s in three namespaces: `felis` (the control plane), `minecraft` (game servers and system servers) and `felis-build` (image build jobs).

| Component | Runs as | Role |
| --- | --- | --- |
| felis-api | The Deployment `felis-api` in the `felis` namespace, one replica | Serves the internal face, the external face and the web panel; reads and writes PostgreSQL; creates backup, restore, file and build jobs. See the [API reference](/en/reference/api) |
| felis-operator | The Deployment `felis-operator` | Reconciles each server's `MinecraftServer` custom resource, creates and maintains its Pod, Service and world volume, and decides when the server is ready (usually through RCON) |
| PostgreSQL | The Deployment `felis-postgres`, with its data on the host in `/var/lib/felis/postgres` | Stores accounts, server ownership, quotas, the audit log and the backup index |
| Image registry | The Deployment `registry`, with the access-control sidecar `registry-gate` | Holds the control-plane image, the system server images, the images builds produce, and copies of the build tool images |
| World cleanup | The CronJob `felis-reaper` (when world cleanup is enabled) | Backs up and removes worlds that stay idle for a long time. See [World cleanup](/en/operations/backup#world-cleanup) |
| Game proxy | The systemd service `felis-velocity` on the host (Velocity with the Felis proxy plugin) | Accepts player connections, verifies identities, routes by hostname and player entry policy, wakes sleeping servers |
| Login space | The system server `login` in the `minecraft` namespace (Limbo with the Felis login plugin) | Completes the in-game sign-in for players who have not linked a panel account. See [Login space image](/en/reference/limbo) |
| Lobby | The system server `lobby` (Paper with the Felis lobby plugin and LuckPerms) | The post-authentication hub, with the server menu. See [Lobby image](/en/reference/lobby) |
| Game servers | A Pod and a world volume in the `minecraft` namespace, one `MinecraftServer` resource per server | Run the users' Minecraft servers |
| Image builds | Jobs in the `felis-build` namespace | Build submitted modpack images with Kaniko and scan them with Trivy |
| Host services | systemd units: `felis-node-control.service`, `felis-watchdog.timer`, `felis-db-backup.timer`, `felis-offsite.timer`, `felis-update-check.timer`, `felis-build-tools.timer`; with Cloudflare Tunnel also `cloudflared-felis` | Run the host tasks the panel requests, health checks, database backups, the off-site copy, version checks and the build tool image sync |

The services, timers and data directories are described in the [Operations overview](/en/operations/#components) and under [Host services](/en/operations/#services).

## Single-node deployment {#single-node}

The default installation places every component on one host:

```text
Players ──TCP 25565──▶ felis-velocity (systemd on the host)
                        │  ├─▶ login space login ─┐
                        │  ├─▶ lobby lobby        ├─ k3s: minecraft namespace
                        │  └─▶ game servers ──────┘
                        └─▶ felis-api internal face (ClusterIP felis-api-internal:8081)

Browser ──HTTPS──▶ access method (direct / own reverse proxy / Cloudflare Tunnel)
                        └─▶ felis-api external face and panel (NodePort, default 30443)
                               ├─▶ PostgreSQL (felis-postgres)
                               └─▶ Kubernetes API ─▶ felis-operator ─▶ game server Pods
```

- **Game entry**: the game proxy runs as a systemd service on the host and listens on the public game port. It reaches game servers through each backend Service's host-routable ClusterIP and the internal face through `felis-api-internal:8081`.
- **Panel entry**: the external face and the panel are served through a NodePort, by default `30443` (`FELIS_PANEL_NODEPORT`). The access method decides how it is exposed to the internet; see [Access and domains](/en/operations/access#access-methods).
- **Storage**: each server's world lives on a volume on the node's local-path storage; world backups go to the archive volume `felis-backups`; the PostgreSQL data directory is on the host. See [Storage and disks](/en/operations/storage#disk-layout) for the disk layout.
- **Network isolation**: the network policy `felis-server-egress` limits game servers' outbound traffic to DNS and the internet, excluding every private address range. Among game servers, only the login space may reach the internal face (`felis-login-to-internal-api`); build jobs reach it through their own egress policy, `felis-build-egress`.

## Multi-node deployment {#multi-node}

Multi-node deployment is disabled by default and is experimental. When it is enabled, the controller runs felis-api, the operator, the k3s server, PostgreSQL, the image registry, the archive service `felis-archive` and the system servers; the game proxy stays a systemd service on the controller. Workers run only the k3s agent, game Pods and maintenance jobs the controller creates. Every node must use the same CPU architecture and k3s version as the controller, and the nodes communicate over WireGuard.

- **Where worlds live**: a world is a ReadWriteOnce volume on its node's local-path storage. Moving a world to another node requires stopping the server and migrating it through the controller's archive service.
- **Failover**: when a worker is lost, the Owner can restore its worlds on other nodes from each server's newest intact backup, by hand or through automatic failover. Servers running on workers take live replicas at a set interval, which reduces the progress a failover loses.
- **Control-plane availability**: without controller high availability, the controller is a single point of failure for the control plane and the public entry; control operations pause while it restarts, and the worlds on it cannot be failed over.

See [Multi-node and high availability](/en/guide/distributed#overview) for the procedures and [Known limitations](/en/reference/limitations) for the current limits.

### Controller high availability {#controller-ha}

Controller high availability lets the control plane move between several controllers:

- **Cluster state**: k3s uses embedded etcd. etcd needs a majority of its members online, so deploy an odd number of controllers, three or more; three controllers tolerate the loss of one.
- **Control-plane data**: PostgreSQL, uploaded files, the image registry, the archives, and the worlds of the login space and the lobby are stored on replicated volumes of the Longhorn StorageClass `felis-replicated` (3 replicas); Longhorn places replicas on controllers only.
- **Control-plane workloads**: felis-api, the operator, PostgreSQL, the image registry, the archive service and world cleanup are scheduled only on controllers and run on the same controller as PostgreSQL. When that controller is lost, the Pods are evicted after a toleration period of about 30 seconds, the replicated volumes attach to another controller, and the control plane restarts there.
- **No duplicate execution**: the felis-api background loops are protected by the lease `felis-api-loops`, and the operator by the lease `felis-operator`.
- **Host timers**: database backups, the off-site copy, version checks and the build tool sync run only on the controller that currently runs PostgreSQL (the host leader); `felis ha leader` tells whether the local host is the leader.
- **Entry**: every controller runs the game proxy. An optional VRRP floating address (keepalived) moves between the controllers and prefers to stay on the host leader.

See [Controller high availability](/en/guide/distributed#controller-ha) for details.

## Request flows {#flows}

### Panel requests {#panel-requests}

1. The browser reaches the felis-api external face through the access method; with Cloudflare Access, access control happens at the edge.
2. felis-api verifies the session cookie and checks the role and request hostname against the operation's access tier.
3. felis-api reads and writes PostgreSQL; operations that affect a server change its `MinecraftServer` resource or create a backup, restore or file job in the cluster.
4. felis-operator sees the change, creates, starts or stops the server's Pod, and writes the status back.

### Player joins {#player-join}

1. The player connects to `<server>.<root_domain>` or the root domain. The game proxy runs in online mode and confirms the player's identity with Mojang and the configured authentication sources through the internal face's session verification.
2. The game proxy follows the [player entry policy](/en/guide/players#entry-policy). When a panel account link is required, a new connection enters the login space first; a player who has not linked an account gets a bind code there and completes the link in the panel.
3. Once the link is complete, the login space asks for the player's release; the game proxy confirms the link again and sends the player to the lobby or to the target server it remembered.
4. When the target server is asleep, the game proxy wakes it through the internal face and the player waits in the lobby; once the server is ready, the proxy transfers the player and reports the join.

The [Sequence diagrams](/en/reference/sequence-diagrams) show the message order of each step, and [Server plugins](/en/reference/plugins#velocity-routing) describes the plugin's behaviour.

### Host operations {#host-operations}

The host operations the Owner runs from the panel (database backup and restore, the off-site copy, the host rebuild, the health check, the support bundle, the access method, the root domain, credential rotation and others) run as follows:

1. The panel calls an `owner`-tier host operation endpoint, which requires recent reauthentication.
2. felis-api runs unprivileged, mounts the Unix socket directory of `felis-node-control.service` read-only, and submits the task through it.
3. `felis-node-control.service` runs as root, accepts only a fixed list of operations with validated parameters, and runs the same `felis` command or installer function as the command line.
4. Task state and logs are kept in `/var/lib/felis/node-control`, and each task is recorded in the audit log.

The full list of operations is under [Host operations in the panel](/en/operations/#panel-host-operations), and the endpoints under [Host operation endpoints](/en/reference/api#host-operations).

### Image builds {#image-builds}

1. A player uploads a modpack under **My Submissions**; the contents are kept in upload storage (the local disk or S3-compatible storage).
2. An Admin approves the submission under **Submissions**.
3. felis-api creates a build job in the `felis-build` namespace. The job's init container reads the build context from the internal face with the `build` service token, Kaniko builds the image, and Trivy scans it. The Kaniko and Trivy images come from copies in the image registry, which `felis-build-tools.timer` keeps current.
4. The resulting image is pushed to the in-cluster registry and added to the image whitelist, from where it can be selected when creating a server.

See [Platform administration](/en/guide/administration#submissions) for the review process.
