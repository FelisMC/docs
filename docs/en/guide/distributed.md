---
title: Multi-node and high availability
description: A controller node directs several worker nodes, with stopped-server migration, failover and controller high availability.
---

# Multi-node and high availability {#distributed}

This page explains how to extend a single-node Felis installation into a multi-node deployment of a controller and worker nodes, and how to use stopped-server migration, failover and controller high availability. It is written for operators familiar with Linux, k3s and network configuration.

::: warning Experimental feature
Multi-node deployment, failover and controller high availability are experimental, off by default, and have not yet completed multi-node acceptance. Before enabling them, complete the [acceptance checks](#acceptance) in an isolated test environment and back up the database and cluster state.
:::

## Overview {#overview}

In a multi-node deployment, one controller node issues every command, and game servers run on the controller and on approved worker nodes:

- A stopped server can be migrated to another node. See [Stopped-server migration](#migrate-server).
- When a worker node is lost, its worlds can be restored on other nodes from their newest intact backups, started by the Owner or automatically. See [Failover](#failover).
- With controller high availability, more controllers can join; when the controller hosting the control plane is lost, the control plane moves to another controller automatically. See [Controller high availability](#controller-ha).

Without controller high availability, the controller is a single point of failure for the control plane and the public entry point: losing it makes the whole control plane unavailable, and the worlds on it cannot be failed over.

### Architecture {#architecture}

| Role | Components |
| --- | --- |
| Controller | Felis API and operator, k3s server, PostgreSQL, the registry, the archive service, the login space and the lobby; the game proxy (Velocity) runs on the controller as a systemd service. |
| Worker | k3s agent and containerd, plus the game pods and maintenance jobs the controller creates. |

Each server's world lives on the local storage of its node. Admins choose the execution node when they create a server; ordinary server owners cannot choose a node or a volume. A lost node refuses new work: the operator withdraws the backends and readiness of its servers, and the game proxy sends players to their fallback destination as usual. Worlds move to another node only when the Owner starts a failover or automatic failover is on. For the component layout, see [Architecture](/en/reference/architecture#multi-node).

## Requirements {#requirements}

- Every node uses the same CPU architecture and k3s version as the controller, on hosts the administrators trust and maintain.
- Each node has a fixed public address. Peer lists accept exact `/32` or `/128` addresses only.
- WireGuard UDP 51820–51821 is allowed between the nodes' fixed public addresses; k3s port 6443 is reachable from known peers only.
- The controller's root SSH configuration has non-interactive authentication and verified host fingerprints for every host; unknown host fingerprints are never accepted. The SSH account is root or has `sudo -n` rights. The SSH alias of each enrolled worker matches its node name, so that every peer firewall can be updated when a node joins.
- A host being enrolled has no k3s installed.
- The controller runs a Felis build that includes multi-node support, currently installed from the development channel or with `FELIS_REF=main`. See [Release channels](/en/guide/deployment#channels).
- Enabling multi-node mode and changing WireGuard settings require a maintenance window with every server stopped.
- Controller high availability additionally needs three or more controllers, an odd number, on a low-latency network in one region; a floating address requires all controllers on the same layer-2 network.

## Node operations {#node-operations}

The Owner manages the multi-node deployment under **Platform settings → Distributed**:

| Card | Purpose |
| --- | --- |
| Distributed deployment | Shows the deployment mode (single-node, or distributed mode enabled) and the controller high availability state. |
| Node operations | Enables distributed deployment, enrolls and approves workers, updates nodes, enables controller high availability and adds controllers, and shows the task history. |
| Execution nodes | Shows each node's role and its online, approval, fencing and version status; offers **Fail over** for lost nodes and **Return to service** for fenced controllers. |
| Failover | Sets automatic failover and the world replica interval. See [Automatic failover](#automatic-failover). |

The execution node of a server is chosen when the server is created; stopped servers are migrated from the server's console page. The command-line procedures below serve maintenance and recovery.

To run a node operation:

1. Choose the operation under **Operation**. In single-node mode, only **Enable distributed deployment** is offered; once it is enabled, you can choose **Enroll and approve worker**, **Approve existing worker**, **Update node** and **Enable controller high availability**, which **Add a controller** replaces once high availability is on.
2. Fill in **Node name**, **SSH target**, **Fixed node IP** and **Additional peer addresses (optional)** as the operation requires. The SSH target is an alias from the controller's root SSH configuration or `user@host`. Separate additional peer addresses with commas; existing nodes and the node being enrolled are included automatically.
3. Read and tick the maintenance confirmation.
4. Select **Execute operation** and verify your identity.

Tasks run on the controller host; losing the panel connection does not stop a task. **Task history** shows each task's stages and execution log. When a task fails, check the host's current state and fix the cause before selecting **Retry operation**; a retry creates a new task and repeats the checks.

### The node operations service {#node-control-service}

Node operations run in `felis-node-control.service`, which the full installation procedure installs. The panel API keeps its non-root identity and reaches the service only through a read-only mounted Unix socket directory; the service accepts a fixed set of node operations and host maintenance operations and offers no general command execution. Its endpoints are restricted to the Owner and require identity verification and an audit record. SSH private keys, bootstrap tokens and the host kubeconfig are never returned to the browser.

- Task state and logs are kept in `/var/lib/felis/node-control`, accessible to root only. The latest 100 records are kept, each log file is limited to 4 MiB, and the panel reads the last 64 KiB.
- A node operation times out after 45 minutes at most. One node task runs at a time.
- While a node operation runs, and while a host task that interrupts the control plane runs (a database restore, a host rebuild, a credential rotation, a domain change), the API refuses to start, maintain or migrate servers; stopping a server remains available.
- A service restart marks unfinished tasks as failed. Check the host state before recovering; installation steps are never repeated automatically.

If the service fails, run on the controller:

```bash
sudo systemctl status felis-node-control
sudo journalctl -u felis-node-control
sudo systemctl restart felis-node-control
```

For the general rules of host tasks, see [Running the host from the panel](/en/operations/#panel-host-operations).

## Preparing the controller {#prepare-controller}

The existing single-node host becomes the controller when multi-node mode is enabled. Prepare it first:

1. Schedule a maintenance window and stop every server, including the login space and the lobby.
2. Back up PostgreSQL with the database backup procedure. See [Database backups](/en/operations/backup#database-backups).
3. Keep an offline copy of the k3s state, the server token and the current installation configuration. For SQLite-backed k3s, the state directory is `/var/lib/rancher/k3s/server/db`. Do not copy these files to workers.
4. Record the controller's existing node name; later installations must keep it.

### Enabling in the panel {#enable-panel}

1. Open **Platform settings → Distributed** and select **Enable distributed deployment** under **Node operations**.
2. Under **Fixed node IP**, enter the controller's currently registered fixed IP (a static address or a DHCP reservation), and add peer addresses if needed.
3. Tick the maintenance confirmation, select **Enable distributed deployment** and verify your identity.

The task runs these stages in order: it checks prerequisites, pauses operator reconciliation and confirms again that the servers are stopped, backs up the database, stops k3s to save `db`, `token` and `tls` snapshots (in `/var/lib/felis/cluster-backups`) and restarts it, configures the controller identity, and finally deploys the controller components and network. The panel may be unreachable for a while; the task keeps running on the host. When it completes, select **Refresh deployment status**.

### Enabling from the command line {#enable-cli}

As root, in the Felis source checkout, rerun the installer with every existing installation parameter plus the multi-node parameters:

```bash
PEERS=192.0.2.10/32,192.0.2.11/32,192.0.2.12/32
FELIS_REF=main FELIS_DISTRIBUTED=1 \
  FELIS_NODE_EXTERNAL_IP=<controller-static-public-IP> \
  FELIS_PEER_CIDRS="$PEERS" bash deploy/bootstrap.sh
```

`PEERS` lists the fixed addresses of all nodes. The installer enables `wireguard-native`, `flannel-external-ip`, NodeRestriction and a separate agent token; installs the archive service, minimal RBAC and the host isolation rules; gives the controller node its protected identity labels; and pins the control-plane workloads, CoreDNS and local-path-provisioner to the controller. The archive volume, the registry and the database stay on the controller.

## Adding worker nodes {#add-workers}

Before adding a node, update the complete peer list on every existing node; on the controller, add `--controller`:

```bash
sudo felis node firewall --peers "$PEERS" --controller-ip <controller-address>
```

When a node is enrolled from the panel's **Node operations**, the task updates the firewalls itself.

### Enrolling in the panel {#add-worker-panel}

1. Under **Node operations**, choose **Enroll and approve worker**.
2. Fill in **Node name**, **SSH target** and the **Fixed node IP** configured on the target node.
3. Tick the maintenance confirmation, select **Execute operation** and verify your identity.

The task runs these stages in order: checking SSH and the host environment, updating peer firewalls, creating a temporary enrollment token, transferring installation files, installing worker components, waiting for node readiness, and running node admission checks.

Enrollment is for hosts without k3s only; a host that has already joined the cluster is never reinstalled. If enrollment was interrupted after the node joined the cluster, use **Approve existing worker** to complete the checks.

### Enrolling from the command line {#add-worker-cli}

1. On the controller, create a separate bootstrap token for each worker, valid for 10 minutes by default. The output file is readable by root only, and the token is not printed:

   ```bash
   sudo felis node token --name worker-01 --ttl 10m --out /root/worker-01.bootstrap
   sudo k3s kubectl -n felis get svc registry
   ```

2. Transfer the token file and a `felis` binary of the same version to the worker over trusted SSH or SCP.
3. On the worker, join the cluster. The worker needs no server token, admin kubeconfig, database credentials or registry write credentials:

   ```bash
   sudo felis node join --name worker-01 --server https://<controller-public-IP>:6443 \
     --external-ip <worker-public-IP> --token-file /root/worker-01.bootstrap \
     --registry-ip <registry-ClusterIP> --peers "$PEERS"
   ```

4. On the controller, approve the node and list the nodes. SSH uses the existing host-key verification, and the target account needs `sudo -n`:

   ```bash
   sudo felis node approve --name worker-01 --ssh-target <worker-SSH-alias> \
     --image <Felis-image-reference>
   sudo felis node list
   ```

A worker installation installs no database, Velocity, API or operator, and deletes no local volumes or node-password; a repeated installation refuses to rename the node or switch clusters. The node's registry mirror points at the in-cluster registry's ClusterIP, never falls back to the default registry, and keeps the original image references.

### Node approval {#node-approval}

Until it is approved, a worker carries a `NoSchedule` quarantine taint and no protected approval label. Approval checks:

- The architecture, k3s version, node readiness, WireGuard and the host isolation rules.
- That kubelet cannot modify protected node labels.
- Image pulls: the specified image is deleted and a real `crictl pull` is run.
- Networking, with temporary probes: cross-node Services, reachability of the control services, and the denial paths for game pods. The controller connects to each probe Service from the host and reads the source address the backend actually observes; only the controller's exact addresses are written into the game network policies.

If any check fails, the node stays quarantined and runs no game servers. Approval deletes the specified cached image, so run it before the node hosts game workloads. Nodes cordoned by hand are never uncordoned automatically.

Once a node is approved, Admins can choose it under **Execution node** when creating a server. See [Creating a server](/en/guide/servers#create-server).

### Updating nodes {#update-nodes}

After the controller is upgraded, the **Execution nodes** list marks nodes whose felis binary or k3s version is behind the controller as **Update needed**:

1. Stop every server on the node; k3s-agent restarts during the update.
2. Under **Node operations**, choose **Update node** and enter the node name and SSH target.
3. Tick the maintenance confirmation, select **Execute operation** and verify your identity.

The task first confirms that the node has no game or maintenance workloads, transfers the controller's felis binary over SSH, runs `felis node upgrade` on the node to bring felis and k3s-agent to the controller's versions, reinstalls the peer firewall, and records the new version once the node is ready.

## Stopped-server migration {#migrate-server}

A stopped-server migration moves a stopped server's world to another node:

1. Stop the server in the panel and wait until it is stopped and its game process has exited.
2. On the server's console page, open **Migrate world** and choose a target node that is online, approved and not fenced; the controller can be a target too.
3. Select **Start migration**.

The migration passes through these stages: archiving the source world, restoring and verifying the target world, switching the active volume, and migration complete. The restore task verifies the download's SHA-256 and reads back every restored file; only after everything succeeds does Felis switch the node and the active volume in a single update. The server's Service, ClusterIP, domain and ownership stay the same. Progress is stored with the server, so it remains visible after a page refresh or a controller restart.

After a successful migration, the server stays stopped. Inspect the target world, then start the server by hand. The source volume is kept and is never removed by world cleanup; an Admin removes it once it is no longer needed.

If a migration fails, the server stays stopped, and the failed stage and its reason are recorded. Do not delete migration annotations or locks by hand; resolve the cause (a lost source node, insufficient disk space on the target, transfer or verification errors) and retry. A repeated request for the same target returns the existing operation; other migrations are refused. A completed switch never rolls back to the source world on its own.

If the target node is permanently unavailable, select **Abandon migration** in the migration dialog. Abandoning applies only to a failed operation that has not switched yet: the server stays on its source node and becomes usable again, the unfinished copy on the target node is deleted, and the pre-migration safety backup is kept as a restore point. The target node does not need to be online.

Migrations can also be managed from the command line on the controller. This command is unrelated to the database migration command `felis migrate`:

```bash
sudo felis server-migrate start --name survival --target-node worker-02
sudo felis server-migrate status --name survival
sudo felis server-migrate retry --name survival --id <operation-ID>
sudo felis server-migrate abort --name survival --id <operation-ID>
```

For the corresponding Admin API, see [API reference](/en/reference/api#endpoints).

## Failover {#failover}

When a node is lost, the game servers on it cannot run. A failover restores those worlds on another online node from each server's newest intact backup, at the cost of every change made after that backup. Failover applies to worker nodes and, with controller high availability, to controllers.

### Manual failover {#manual-failover}

1. In the **Execution nodes** list, find the lost node; the list shows how long it has been lost. Select **Fail over**.
2. The dialog lists the user servers on the node: the time and size of the backup each will be restored from, and whether it starts or stays stopped after the failover (following its desired state before the failover). Servers without an intact backup stay on the lost node.
3. Under **Restore on**, choose the target node: an online, schedulable, approved worker, or a controller.
4. Type the node name to confirm, select **Start failover** and verify your identity.

Once started, each server records a failover operation, holds its world lock, and has its desired state set to stopped. The node operations service then fences the lost node: it marks it unschedulable, withdraws its approval label, and adds the Kubernetes `node.kubernetes.io/out-of-service=nodeshutdown:NoExecute` taint, so that Kubernetes releases the node's pods and volumes without waiting for its kubelet; pods still recorded on the node are then deleted directly. If the fencing task fails to start, felis-api retries it in the background every two minutes, and no world is restored until fencing completes.

Each server then passes through these stages: waiting for the node to be fenced, restoring and verifying the backup on the target, switching to the target, and restored on the target. After the switch, the original desired state is restored. The original world volume remains on the lost node's disk.

### Automatic failover {#automatic-failover}

The **Failover** card stores these settings:

| Setting | Values | Default |
| --- | --- | --- |
| Automatic failover | On or off | Off |
| Minutes lost before an automatic failover | 10–1440 | 15 |
| World replica interval (minutes) | 0 (off) or 15–1440 | 60 |

With automatic failover on, felis-api checks every 30 seconds. It fails a node's worlds over only when exactly one node is lost, that node is not fenced yet, at least one controller is online, and the node has been lost for longer than the set time. The target is the least-loaded online node: fewest user servers first, and on a tie, a controller. Several nodes lost at once more likely means a network fault on the controller itself, so the system then waits for the Owner. Servers whose automatic failover fails stay stopped and are left to the Owner; the system does not retry automatically.

A shorter wait fails over sooner, and a brief network outage is more likely to set it off.

### World replicas {#world-replicas}

World replicas reduce the progress a failover loses. Servers running on worker nodes (and, with controller high availability, on controllers) take a live backup at the set interval, listed as **Failover replica** among the backups:

- Replicas use the same live procedure as manual backups, pausing saves while the world is copied, so the server's console (RCON) must be available.
- At most one replica runs at a time, and replicas wait while other backup or restore jobs run.
- Each server keeps only its newest 2 replicas, for 48 hours. Replicas are counted separately from manual backups and scheduled restore points, so neither displaces the other.

### When a lost node comes back {#fenced-nodes}

A lost node that comes back online stays fenced: its pods have been deleted and it hosts no worlds.

- Worker: run **Approve existing worker** under **Node operations**; the fence is lifted once the node passes the full checks again.
- Controller (which can be fenced only with controller high availability): select **Return to service** in the **Execution nodes** list to lift the fence and resume scheduling.

Servers moved away by the failover stay on their new nodes. Old world volumes are not cleaned up automatically.

## Controller high availability {#controller-ha}

Controller high availability moves the cluster state to k3s embedded etcd and the control-plane data to Longhorn replicated volumes, so that the control plane can move between several controllers.

### High availability architecture {#ha-architecture}

- **Cluster state**: k3s runs with embedded etcd. etcd needs a majority of its members online, so deploy three or more controllers, an odd number: three controllers tolerate one failure, while two lose the majority as soon as either is lost.
- **Control-plane data**: PostgreSQL, uploaded files, the registry, archives, and the worlds of the login space and the lobby live on Longhorn volumes of the `felis-replicated` StorageClass (3 replicas, reclaim policy Retain), each named after the original volume with a `-ha` suffix. Longhorn components and replicas are placed on controllers only.
- **Control-plane workloads**: felis-api, the operator, PostgreSQL, the registry, the archive service and world cleanup are scheduled on controllers only and run on the same controller as PostgreSQL. When that controller is lost, these pods are evicted after a toleration period of about 30 seconds; Longhorn deletes the pods on the lost node and attaches the replicated volumes to another controller, where the control plane restarts. The panel is briefly unavailable meanwhile.
- **No duplicate execution**: felis-api's background loops are protected by the `felis-api-loops` lease and the operator by the `felis-operator` lease; a new holder takes over only after the previous one stops renewing.
- **Host tasks**: systemd tasks such as database backups, the off-site copy, the version check and build-tool image synchronization run only on the "host leader", the controller currently running the PostgreSQL pod; `felis ha leader` tells whether the local host is the leader. The watchdog runs on the leader, and also on the other controllers while the leader is unreachable, so that the failure is reported.
- **Entry point**: Velocity is installed on every controller. The optional VRRP floating address (keepalived) moves between controllers, preferring the host leader, and requires all controllers on one layer-2 network. When controllers are on different networks, point DNS or a cloud provider's floating address at them instead.
- **System servers**: the login space and the lobby can run on any controller.
- **User worlds**: user worlds on a controller's local volumes can be failed over like worlds on a worker when that controller is lost, provided another controller is online.

### Enabling controller high availability {#enable-ha}

1. Under **Node operations**, choose **Enable controller high availability**.
2. Optionally fill in **Floating address (optional)** (an unused IPv4 address), **Network interface** and **VRRP router ID**. When the interface and router ID are left empty, the installer chooses them.
3. Tick the maintenance confirmation, select **Enable controller high availability** and verify your identity.

The task runs these steps in order:

1. Back up the database (label `pre-migrate`).
2. Save a cluster state snapshot (`pre-ha`, in `/var/lib/felis/cluster-backups`).
3. Rerun the installer with `FELIS_CONTROLLER_HA=1`: k3s moves to embedded etcd through `cluster-init`; open-iscsi and Longhorn are installed (version set by `FELIS_LONGHORN_VERSION`, default `v1.8.1`, with the manifest downloaded from GitHub); `felis ha migrate-storage` stops the system servers and the control plane and copies the database directory, uploaded files, registry, archives and system server worlds one by one to their replicated volumes, keeping the original volumes; finally the high availability manifests are applied and the control plane restarts on the replicated volumes.

During the move, the login space and the lobby pause and the panel is briefly unreachable; other game servers keep running. `felis ha migrate-storage` records each volume's progress, so a rerun after an interruption copies only the volumes not yet done. The settings are written to `/etc/felis/ha.env`, so later installer runs and `felis update` keep high availability on.

From the command line, rerun the installer as root on the controller, keeping the existing installation parameters:

```bash
FELIS_DISTRIBUTED=1 FELIS_CONTROLLER_HA=1 \
  FELIS_NODE_EXTERNAL_IP=<controller-static-IP> \
  FELIS_HA_VIP=192.0.2.50/24 bash deploy/bootstrap.sh
```

| Variable | Description |
| --- | --- |
| `FELIS_CONTROLLER_HA=1` | Enables controller high availability; distributed mode is required too. |
| `FELIS_HA_VIP` | Optional IPv4 floating address with its prefix length, such as `192.0.2.50/24`. |
| `FELIS_HA_VIP_INTERFACE` | Network interface of the floating address; defaults to the interface that carries the node address. |
| `FELIS_HA_VRID` | VRRP virtual router ID, 1–255, default 51. |
| `FELIS_LONGHORN_VERSION` | Longhorn version tag, default `v1.8.1`. |

::: danger
Once enabled, controller high availability cannot be turned off from the panel. To roll back, restore manually from the database backup and cluster state snapshot saved in steps 1 and 2.
:::

### Adding a controller {#add-controller}

1. Under **Node operations**, choose **Add a controller**.
2. Enter the node name, the SSH target and the fixed IP configured on the new controller, plus additional peer addresses if needed. The new controller must have the same architecture as the existing ones and no k3s installed; the SSH requirements are the same as for enrolling a worker.
3. Tick the maintenance confirmation, select **Execute operation** and verify your identity.

The task runs these steps in order:

1. Updates every existing node's firewall with a peer list that includes the new controller's address.
2. Transfers the cluster's server token and agent token, an archive of this controller's `/etc/felis` and the current felis binary to the new controller over SSH standard input. None of this passes through the API or is written to command lines, task records or logs.
3. Runs `felis node join-controller` on the new controller: it joins embedded etcd with the same k3s version as the existing controllers and installs open-iscsi, the node operations service, Velocity, and the timers for database backups, the off-site copy, the version check and the watchdog; with a floating address configured, keepalived is installed too.
4. Once the node is ready, adds the controller role, node identity and Longhorn disk labels, so that Longhorn can place replicas on it.

Game servers keep running meanwhile. `/etc/felis` holds the database credentials, the forwarding secret, the mail relay settings and the VRRP password; every controller holds the complete set of platform secrets and must be protected to the same standard.

### Controller loss and recovery {#controller-recovery}

When the controller hosting the control plane is lost, the control plane moves automatically as described above; no manual action is needed. User worlds on that controller's local volumes need a failover (manual or automatic), under the same rules as for workers.

When a fenced controller comes back online, first confirm that it has rejoined etcd and that Longhorn has started rebuilding its replicas, then select **Return to service** on it in the **Execution nodes** list. The node operations service refuses to fence the local host and refuses to fence the last online controller.

### Removing a controller {#remove-controller}

The panel offers no operation to remove a controller. To decommission one permanently, first confirm that the remaining controllers still form an etcd majority, then remove its etcd member following the k3s documentation and delete the node.

## Isolation and network requirements {#isolation}

Game processes run as non-root, with privilege escalation forbidden, all capabilities dropped, no service account token and no host namespaces. A maintenance job mounts a single world volume: transfer jobs can reach only the archive service and DNS, and file and export jobs additionally only the API's transfer endpoint. The archive service has no database configuration and no Kubernetes identity; the controller records success only after the complete archive has been written atomically.

Host firewall rules:

- INPUT and FORWARD rules close the path from a game pod to the node it runs on; raw-table PREROUTING rules close worker NodePorts before DNAT.
- Raw rules also refuse new connections from game pods to the host, while replies on established Velocity and RCON connections pass. Trusted control pods on the controller reach the apiserver from their exact addresses.
- The rules are installed through systemd, and the control pods' addresses are refreshed periodically.
- The game servers' egress check verifies both the allowed DNS TCP path and the denial paths; in distributed mode, a check that times out prevents the server from starting.

Network configuration requirements:

- Use only exact `/32` or `/128` addresses as peers; never use a whole node or pod range as the source for Velocity or the registry.
- Allow WireGuard UDP 51820–51821 between the nodes' fixed public addresses, and k3s port 6443 from known peers only.
- After changing node addresses, firewalls or CNI configuration, stop the servers and rerun the node approval checks before running untrusted code.

Related upstream documentation: [k3s networking across public networks](https://docs.k3s.io/networking/distributed-multicloud), [time-limited bootstrap tokens](https://docs.k3s.io/cli/token), [NodeRestriction labels](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#node-isolationrestriction), [NetworkPolicy node boundaries](https://kubernetes.io/docs/concepts/services-networking/network-policies/).

## Acceptance checks {#acceptance}

Before relying on a multi-node deployment, complete these checks on at least three Linux machines (a controller and two workers, called A, B and C below); checks on a single machine cannot replace them:

- Cross-node Velocity connections to `ClusterIP:25565` and their actual source addresses, RCON, sleep and wake, and image pulls after clearing the cache all work.
- Back up and restore on B; after a migration from B to C, the Service IP and ownership are unchanged, the source volume is kept, and the target server stays stopped.
- During a migration, wakes, file writes, exports, world cleanup and duplicate requests are mutually exclusive; after A restarts, the migration continues.
- Simulate a lost source node, an interrupted transfer, a full target or archive disk and a failed read-back verification, and confirm that the source world remains recoverable.
- Requests from game pods to other servers, the controller, the registry, host ports, kubelet and the metadata service are all refused, and every refused target is reachable from a trusted probe.
- Expired, replayed, cross-server and wrong-operation archive tokens are refused; kubelet cannot forge protected labels.
- Failover: shut down B and restore to C following the panel's plan; confirm that fencing takes effect, the lost progress matches the plan, and the start state after restoration is correct; after B comes back, its old pods are stopped and it hosts no worlds until approved again; automatic failover triggers only when a single node is lost.
- World replicas: running servers produce replicas at the set interval, players notice only a save pause, and the replica count and retention match the settings.
- Controller high availability: with three controllers, shut down the controller hosting the control plane; confirm that the control plane recovers on another controller, background loops and the operator do not run twice, the host timers follow PostgreSQL and the floating address moves; the lost controller returns to service after it comes back; enabling high availability from a single controller completes its move on real data and keeps the original volumes.
- The Longhorn version (default `v1.8.1`) works on your systems.
