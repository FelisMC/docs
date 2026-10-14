---
title: Multi-node deployment
---

# Distributed deployment: controllers, workers, failover and controller high availability {#a-主控与多机-worker}

Distributed mode is disabled by default. Controller A runs the Felis API/operator, k3s server, PostgreSQL, registry, archive service and system servers; Velocity remains a systemd service on the controller. Workers B, C and others run only k3s-agent/containerd, game Pods and maintenance Jobs created by the controller. Every node must use the same architecture and k3s version as A; administrators must trust and maintain the hosts.

When a worker is lost, its worlds can be restored to another node from their latest intact backups (see [Failover](#failover)). With controller high availability enabled, additional controllers can be added; when the controller hosting the control plane is lost, the control plane moves to another controller automatically (see [Controller high availability](#controller-high-availability)).

## Panel management {#panel-management}

In the **Node operations** card on the **Platform settings → Distributed** tab, the Owner can enable distributed deployment, enroll workers over SSH, approve enrolled workers, update nodes, enable controller high availability, add controllers, and query or retry failed tasks. The **Execution nodes** list shows each node's online, approval, fencing and version status, and provides failover for lost nodes and a way to return fenced controllers to service; the **Failover** card sets automatic failover and the world replica interval. Node selection for servers and migration of stopped worlds remain on the server management page. The CLI procedures below remain available for maintenance and recovery.

A full installation installs `felis-node-control.service`. The panel API keeps its non-root identity and mounts only the service's read-only Unix socket directory. The host service accepts only a fixed set of node operations and host maintenance operations (see [section 9 of the Operations guide](/en/operations/#_9-running-the-host-from-the-panel-go-tested-sh-tested)) and provides no general command execution. On SELinux hosts, the dedicated socket directory and files have their own types; the API reaches the service through file permissions and an exclusive mount. The current policy also allows container domains to connect to Unix stream sockets on which services running as `unconfined_service_t` listen; the actual reach is bounded by the file labels and the mount scope. Tightening this rule by defining a dedicated process domain for the service remains to be verified on an SELinux host. The HTTP endpoints are restricted to the Owner and keep the identity re-verification and audit requirements for sensitive operations. SSH private keys, bootstrap tokens and the host kubeconfig are never returned to the browser.

Before the first enrollment, set up non-interactive authentication in A's root SSH configuration and verify the host fingerprints. The SSH account must be root or have `sudo -n` privileges. The SSH alias of each enrolled worker must match its node name, so that the firewalls of all peers can be updated when a node is added. The system never accepts an unknown host fingerprint and never reinstalls a host that has already joined the cluster. If an installation is interrupted after the worker has joined the cluster, use the approve operation instead.

Stop all game and maintenance workloads before enabling the deployment. After pausing the operator, the service checks the stopped state again, backs up the database, stops k3s to save `db`, `token` and `tls` snapshots, and then restarts k3s; the snapshots are stored in `/var/lib/felis/cluster-backups`. It then reuses the current binary's installer to configure WireGuard, the controller identity and the platform components. The panel may be temporarily unreachable during this time; the host task continues to run. Worker approval reuses the CLI's image-pull, network-isolation and node-identity acceptance checks; on failure, the node stays quarantined. Nodes cordoned manually are not uncordoned automatically.

Task state and logs persist in `/var/lib/felis/node-control`, protected by root. Node operations time out after at most 45 minutes; host maintenance operations each have their own limit and perform the necessary recovery actions after an interruption. The latest 100 records are kept; each log file is limited to 4 MiB, and the panel reads the last 64 KiB. A service restart marks unfinished tasks as failed; check the host state before recovering, because installations are not repeated automatically. When the host service is configured, the API blocks starts, maintenance and migrations while a node operation runs, and while a host maintenance operation that interrupts the control plane runs, such as a database restore, full rebuild, credential rotation or domain change. When the host service is unavailable, these operations return an explicit error; stopping remains available.

If the host service fails, the host administrator can run `systemctl status felis-node-control`, `journalctl -u felis-node-control` and `systemctl restart felis-node-control`. The first upgrade to a version that includes this feature must go through the full installation procedure to install the service and the socket mount; replacing only the web assets does not enable host operations.

## Prepare A first {#先准备-a}

Stop the servers during a maintenance window, back up PostgreSQL using the existing database backup procedure, and keep an offline copy of the k3s state, server token and current installation configuration. For SQLite-backed k3s, the state directory is `/var/lib/rancher/k3s/server/db`; for another datastore, follow its own backup procedure. Do not copy these files to workers.

Record A's existing node name and keep it in subsequent installations. Pin the current control workloads to A before enabling WireGuard; existing game PVCs are not migrated.

```bash
# Run as root on A; replace the node name and every static node address.
A_NODE=existing-node-name
PEERS=192.0.2.10/32,192.0.2.11/32,192.0.2.12/32
k3s kubectl label node "$A_NODE" \
  felis.node-restriction.kubernetes.io/identity="$A_NODE" \
  felis.node-restriction.kubernetes.io/role=controller --overwrite

# Use the actual Deployment names and protected identity labels throughout.
for d in felis-api felis-operator felis-postgres registry; do
  k3s kubectl -n felis patch deployment "$d" --type merge \
    -p "{\"spec\":{\"template\":{\"spec\":{\"nodeSelector\":{\"felis.node-restriction.kubernetes.io/identity\":\"$A_NODE\"}}}}}"
done
```

Rerun an installer that includes this feature on A with `FELIS_DISTRIBUTED=1`, `FELIS_NODE_EXTERNAL_IP=<A-static-public-IP>` and `FELIS_PEER_CIDRS="$PEERS"`, retaining the existing installation parameters. This enables `wireguard-native`, `flannel-external-ip`, NodeRestriction and a separate agent token, and installs the archive service, minimal RBAC and host isolation rules. Changing WireGuard requires a maintenance window with the servers stopped. Update existing workers' peer lists in advance as well.

Pushing to main alone does not publish a release. Until release assets contain these changes, run the following as root in the updated source checkout to build explicitly from main, retaining all other existing installation parameters. Updating only the installer while keeping the default release channel can download an older binary without distributed commands.

```bash
FELIS_REF=main FELIS_DISTRIBUTED=1 \
  FELIS_NODE_EXTERNAL_IP=<A-static-public-IP> \
  FELIS_PEER_CIDRS="$PEERS" bash deploy/bootstrap.sh
```

When generating manifests directly, add:

```bash
felis manifests --felis-image <existing-logical-image-reference> \
  --distributed --controller-node "$A_NODE" \
  --egress-probe felis-api.felis.svc:443 \
  --velocity-cidr <A-exact-source-IP/32> \
  --archive-local-path <original-archive.local_path> --backup-pvc felis-backups
```

Retain the other existing parameters. The installer also pins CoreDNS and local-path-provisioner to A; for a manual deployment, give these Deployments A's protected node selector too. Manual deployments must store the same random key in the `felis-archive-key` Secret in both the `felis` and `minecraft` namespaces (field `key`, at least 32 characters). Only the API, Reaper and archive service receive the key; the operator does not. The archive PVC, registry and database stay on A.

## Join B, then C {#接入-b-再接入-c}

First run `felis node firewall --peers "$PEERS" --controller-ip <A-address>` on every existing node to update the complete peer list; add `--controller` on A. Only exact `/32` or `/128` addresses are allowed. Do not use an entire node or Pod range as the Velocity or registry source. Allow WireGuard UDP 51820–51821 between static public node addresses, and allow k3s 6443 only from known peers.

```bash
# A: create a separate token for each worker, valid for 10 minutes by default.
# The output file is root-only; the token is not printed.
felis node token --name b --ttl 10m --out /root/b.bootstrap
k3s kubectl -n felis get svc registry
# Transfer this file and the same-version felis binary to B over trusted SSH/SCP.

# B needs no server token, admin kubeconfig, database or registry write credentials.
felis node join --name b --server https://<A-public-IP>:6443 \
  --external-ip <B-public-IP> --token-file /root/b.bootstrap \
  --registry-ip <Registry ClusterIP> --peers "$PEERS"

# A: SSH uses existing host-key verification; the target account needs sudo -n.
felis node approve --name b --ssh-target <B-SSH-alias> \
  --image <Felis-logical-image-reference>
felis node list
```

Installing a worker does not install the database, Velocity, API or operator, and does not delete local volumes or node-password. A repeated installation rejects renaming the node or switching clusters. The mirror uses the registry ClusterIP, disables fallback to the default image source, and preserves the original image references.

Before approval, a worker has a `NoSchedule` quarantine taint and no protected approved label. Approval checks the architecture, version, node availability, WireGuard and host isolation, verifies that kubelet cannot modify protected labels, deletes the specified image and performs a real `crictl pull`. It then creates temporary probes to test cross-node Services, positive reachability of control services, and denial paths for game-labelled Pods. A connects to each test Service from the host and reads the source address actually observed by the backend; only exact addresses belonging to A are written into game policies. Any failed check keeps the node quarantined. Approval deletes the specified cached image, so run it before the node has game workloads.

Under **Platform settings → Distributed deployment** in the panel, the Owner can view the deployment mode, each node's online and approval status and the enrollment procedure, and go to server node selection and migration. The deployment mode can be configured from the panel's **Node operations** card or by the installer; node approval runs the same complete set of checks from either entry point.

Once approved, administrators can select the node when creating a server in the panel, or pass `nodeName` in the creation request. Ordinary server owners cannot select a node or specify a PVC. An unreachable node rejects new work; the operator removes the server Service's backends and Ready status, and Velocity follows its existing fallback flow. Worlds move to another node only when the Owner starts a failover or automatic failover is enabled (see [Failover](#failover)).

## Update nodes {#update-nodes}

After the controller is upgraded, the **Execution nodes** list marks workers whose k3s version or felis build differs from the controller's as **Update needed**. In **Node operations**, choose **Update node**, enter the node name and SSH target, and confirm the maintenance conditions. The task first confirms that the node has no game or maintenance workloads, then transfers the controller's felis binary over SSH, runs the installer's worker-upgrade mode (`felis node upgrade`) on the worker to update felis and k3s-agent to the controller's versions, reinstalls the peer firewall, and records the new version once the node is ready. Because k3s-agent restarts, stop the servers on the node first.

## Migrate a stopped server {#停服迁移}

Stop the server in the panel and wait for `Stopped` and for the game Pod to exit. Open **Migrate world** and select a target node that is online, approved and not fenced; the controller can also be a target. The panel reads the latest operation from the CR's persistent record, so progress remains visible after a page refresh or an A restart.

```bash
# Root operations on A; separate from the database's felis migrate command:
felis server-migrate start --name survival --target-node c
felis server-migrate status --name survival
felis server-migrate retry --name survival --id <operation-ID>
felis server-migrate abort --name survival --id <operation-ID>
```

Administrator API:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/nodes` | Execution node list |
| POST | `/api/v1/servers/{name}/migrations` | `{ "targetNode": "c" }`; returns the operation and ID |
| GET | `/api/v1/servers/{name}/migrations` | Latest migration record |
| GET | `/api/v1/servers/{name}/migrations/{id}` | Current operation progress |
| POST | `/api/v1/servers/{name}/migrations/{id}/retry` | Retry the failed stage |
| POST | `/api/v1/servers/{name}/migrations/{id}/abort` | Abandon a failed migration that has not switched |

Stages are `backing_up` → `restoring` → `switching` → `succeeded`. The lock is `migration@<start-time>` and does not expire under the temporary maintenance lock's two-minute rule. Failure records the stage and reason while keeping the lock and stopped state. A repeated request for the same target returns the existing operation; other migrations are rejected. The restore Job checks the download's SHA-256 and reads back each restored file for verification. Only after success does a single optimistic-lock CR update switch the node, active PVC and progress. The stopped StatefulSet is rebuilt to use the new PVC; the CR, Service, ClusterIP, domain and ownership remain unchanged.

A successful migration still does not start the server automatically. Inspect the target world and start it manually. The recorded `sourcePVC` is retained and is not removed by the reaper; an administrator must explicitly clean it up once it is no longer needed. On failure, do not manually delete migration annotations or locks. Resolve source-node loss, insufficient target disk space or transfer/verification errors, then retry. A committed switch does not automatically roll back to the source world.

If the target node is permanently unavailable, use **Abandon migration** in the migration dialog. Abandoning applies only to a failed operation that has not yet switched: the server stays on the source node and becomes usable again, the incomplete copy on the target node is deleted, and the pre-migration safety backup is kept as a restore point. The target node can be offline.

## Failover {#failover}

When a worker is lost, the game servers on it cannot run. Failover restores these worlds on another online node from each server's latest intact backup. The cost is every change made after that backup; before confirmation, the panel lists, for each server, the time and size of the backup that will be used.

### Manual failover {#manual-failover}

The **Execution nodes** list shows how long a lost node has been unreachable and offers the Owner a **Fail over** button. The dialog lists the user servers on the node: the backup each server will be restored from, and whether it will start automatically or stay stopped after the switch (following its desired state before the switch). Servers without an intact backup stay on the original node. The Owner selects a target node (an online, schedulable approved worker or a controller), types the node name to confirm, and completes the identity re-verification required for sensitive operations.

Once started, each server records a migration operation whose `kind` is `failover`, holds the world lock, and has its desired state changed to stopped. The node operations service then fences the lost node: it marks the node unschedulable, removes the approval label, and adds the Kubernetes `node.kubernetes.io/out-of-service=nodeshutdown:NoExecute` taint so that Kubernetes releases the node's Pods and volumes without waiting for its kubelet; Pods still recorded on the node are then deleted directly. If the fencing task fails to start, felis-api retries it in the background every two minutes; no world is restored until fencing completes. The stages are `fencing` → `restoring` → `switching` → `succeeded`: wait for fencing to complete and delete the server's unfinished maintenance Jobs on the lost node; create a new volume on the target node; restore the backup and verify it by reading back each file; finally, switch the node and active volume in a single CR update and restore the original desired state. The original world volume remains on the lost node's disk.

A lost node stays fenced when it comes back online: its Pods have been deleted and it no longer hosts worlds. A worker is unfenced only after **Approve existing worker** is run in **Node operations** and the node passes the full acceptance checks again. A controller (which can be fenced only when controller high availability is enabled) is unfenced and made schedulable again with **Return to service** in the **Execution nodes** list. Old world volumes are not cleaned up automatically.

### Automatic failover and world replicas {#automatic-failover-and-world-replicas}

The **Platform settings → Failover** card stores the following settings:

| Setting | Values | Default |
| --- | --- | --- |
| Automatic failover | On or off | Off |
| Minutes lost before an automatic failover | 10–1440 minutes | 15 |
| World replica interval | 0 (off) or 15–1440 minutes | 60 |

With automatic failover enabled, felis-api checks every 30 seconds. It fails a node's worlds over to the least-loaded online node (fewest user servers first; on a tie, a controller is preferred) only when exactly one node is lost, that node is not yet fenced, at least one controller is online, and the node has been lost for longer than the configured time. Several nodes lost at the same time more likely indicates a network fault on the controller itself, so in that case the system waits for the Owner. Servers whose automatic failover fails stay stopped and are left to the Owner; the system does not retry automatically.

World replicas reduce the progress lost in a failover. Servers running on workers (and, with controller high availability enabled, on controllers) take an online backup at the configured interval, recorded with the reason `replica`. Replicas use the same online procedure as manual backups (RCON `save-off` and `save-all flush`, then `save-on` immediately after the world is copied on the same node), so the server console must be available. The system starts at most one replica at a time and waits while other backup or restore Jobs run. Each server keeps only its latest 2 replicas, with a retention period of 48 hours. Replicas are counted separately from the Owner's manual backups and scheduled restore points, so neither displaces the other.

API (Owner only):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/nodes/{node}/failover` | Failover plan: lost status, the backup each server will be restored from, and available targets |
| POST | `/api/v1/nodes/{node}/failover` | `{ "targetNode": "c", "confirm": "<node-name>" }`; starts the failover and requests fencing |
| GET | `/api/v1/settings/failover` | Read the failover settings |
| PUT | `/api/v1/settings/failover` | Save the failover settings (written after a revision comparison) |

Without controller high availability, losing the controller makes the entire control plane unavailable, and worlds on the controller cannot be failed over.

## Controller high availability {#controller-high-availability}

Controller high availability moves the cluster state to the k3s embedded etcd and the control-plane data to Longhorn replicated volumes, so that the control plane can move between multiple controllers.

### Architecture {#architecture}

- **Cluster state**: k3s runs with embedded etcd. etcd needs a majority of its members online, so deploy an odd number of controllers, three or more; three controllers tolerate one failure, while two controllers lose the majority as soon as either one is lost. Controllers should be connected by a low-latency network within the same region.
- **Control-plane data**: PostgreSQL, uploaded files, the registry, archives, and the worlds of the login space and the main lobby are stored on Longhorn volumes of the `felis-replicated` StorageClass (3 replicas, reclaim policy Retain); each volume is named after the original with a `-ha` suffix. Longhorn components and replicas are placed on controllers only.
- **Control-plane workloads**: felis-api, the operator, PostgreSQL, the registry, the archive service and the reaper are scheduled only on controllers and run on the same controller as PostgreSQL. When that controller is lost, these Pods are evicted after a toleration period of about 30 seconds; Longhorn deletes the Pods on the lost node and attaches the replicated volumes to another controller, where the control plane restarts. The panel is briefly unavailable during this time.
- **No duplicate execution**: the felis-api background loops are protected by the `felis-api-loops` lease and the operator by the `felis-operator` lease; a new holder takes over only after the previous holder stops renewing.
- **Host tasks**: systemd tasks such as database backups, off-site copies, update checks and build-tool image synchronisation run only on the "host leader", which is the controller currently running the PostgreSQL Pod; `felis ha leader` determines whether the local host is the leader. The watchdog runs on the leader, and also on the other controllers when the leader is unreachable, so that the failure is reported.
- **Entry point**: Velocity is installed on every controller. The optional VRRP floating address (keepalived) moves between controllers and prefers to stay on the host leader; it requires all controllers to be on the same layer-2 network. When the controllers are on different networks, use DNS or a cloud provider's floating address pointing at the controllers instead.
- **System servers**: the login space and the main lobby are no longer pinned to a particular controller and can run on any controller.
- **User worlds**: when a controller is lost, user worlds on its local volumes can be failed over in the same way as worlds on a worker (another controller must be online).

### Enable {#enable}

In **Node operations**, choose **Enable controller high availability** and confirm the maintenance conditions. **Floating address (optional)**, **Network interface** and **VRRP router ID** can be filled in at the same time; they correspond to `FELIS_HA_VIP`, `FELIS_HA_VIP_INTERFACE` and `FELIS_HA_VRID` in the table below. If the network interface and router ID are left empty, the installer script determines them. The task runs these steps in order:

1. Back up the database (tag `pre-migrate`).
2. Save a cluster state snapshot (`pre-ha`, in `/var/lib/felis/cluster-backups`).
3. Rerun the installer with `FELIS_CONTROLLER_HA=1`: k3s migrates to embedded etcd through `cluster-init`; open-iscsi and Longhorn are installed (the version is set by `FELIS_LONGHORN_VERSION`, default `v1.8.1`, and the manifest is downloaded from GitHub); `felis ha migrate-storage` stops the system servers and the control plane and copies the database directory, uploaded files, registry, archives and system-server worlds one by one to the corresponding replicated volumes, keeping the original volumes; finally, the high-availability deployment manifests are applied and the control plane restarts on the replicated volumes.

During the migration, the login space and the main lobby are paused and the panel is briefly unreachable; other game servers keep running. `felis ha migrate-storage` records the progress of each volume, and a rerun after an interruption copies only the volumes not yet completed. The settings are written to `/etc/felis/ha.env`, so later runs of the installer or `felis update` keep the high-availability mode.

From the command line, rerun the installer as root on the controller, retaining the existing installation parameters:

```bash
FELIS_DISTRIBUTED=1 FELIS_CONTROLLER_HA=1 \
  FELIS_NODE_EXTERNAL_IP=<controller-static-IP> \
  FELIS_HA_VIP=192.0.2.50/24 bash deploy/bootstrap.sh
```

| Variable | Meaning |
| --- | --- |
| `FELIS_CONTROLLER_HA=1` | Enables controller high availability; distributed mode is required as well |
| `FELIS_HA_VIP` | Optional; IPv4 floating address with prefix, such as `192.0.2.50/24` |
| `FELIS_HA_VIP_INTERFACE` | Network interface for the floating address; defaults to the interface that carries the node address |
| `FELIS_HA_VRID` | VRRP virtual router ID, 1–255, default 51 |
| `FELIS_LONGHORN_VERSION` | Longhorn version tag, default `v1.8.1` |

Once enabled, controller high availability cannot be disabled from the panel. To roll back, restore manually from the database backup and cluster snapshot saved in steps 1 and 2.

### Add a controller {#add-a-controller}

In **Node operations**, choose **Add a controller** and enter the node name, the SSH target and the new controller's static IP; additional peer addresses are optional. The new controller must have the same architecture as the existing controllers and must not have k3s installed yet; the SSH requirements are the same as for enrolling a worker. The task runs these steps in order:

1. Update the firewalls of all existing nodes with a peer list that includes the new controller's address.
2. Transfer the cluster's server token and agent token, an archive of this controller's `/etc/felis`, and the current felis binary to the new controller over SSH standard input. None of this content passes through the API or is written to command lines, task records or logs.
3. Run `felis node join-controller` on the new controller, which is the installer's controller-join mode: it joins the embedded etcd with the same k3s version as the existing controllers and installs open-iscsi, the node operations service, Velocity, and the timers for database backups, off-site copies, update checks and the watchdog; when a floating address is configured, keepalived is installed as well.
4. Once the node is ready, add the controller role, node identity and Longhorn disk labels so that Longhorn can place replicas on it.

`/etc/felis` contains the database credentials, the forwarding secret, the mail relay settings and the VRRP password. Every controller holds the complete set of platform secrets and must be protected to the same standard as A.

The panel does not yet provide an operation to remove a controller. To decommission a controller permanently, first confirm that the remaining controllers still form an etcd majority, then remove its etcd member following the k3s documentation and delete the node.

### Controller loss and recovery {#controller-loss-and-recovery}

When the controller hosting the control plane is lost, the control plane moves automatically as described above, with no manual action required. User worlds on that controller's local volumes need a failover (manual or automatic), under the same rules as for workers. When a fenced controller comes back online, first confirm that it has rejoined etcd and that Longhorn has started rebuilding its replicas, then use **Return to service** on it in the **Execution nodes** list. The node operations service refuses to fence the local host and refuses to fence the last online controller.

## Isolation and acceptance {#隔离与验收}

Game processes keep the existing restrictions: non-root, no privilege escalation, drop ALL, no service-account token and no host namespaces. A maintenance Job mounts only one world PVC. Transfer Jobs can access only the archive service and DNS; file/export Jobs additionally access only the existing API transfer endpoint. The archive service has no database configuration or Kubernetes identity. A records success only after the complete archive has been written atomically; existing tarLocal paths, retention and off-site workflows remain in use.

Host INPUT/FORWARD rules close the resident-node path, and raw PREROUTING closes worker NodePorts before DNAT; trusted control Pods on A can reach the apiserver from their exact addresses. Raw rules also deny new game-Pod connections to the host, preventing kube-router's early ACCEPT from bypassing filter rules; replies on established Velocity/RCON connections remain allowed. Rules are installed through systemd, with control-Pod addresses refreshed periodically. After changing node addresses, firewalls or CNI configuration, stop the servers and rerun approval checks before running untrusted code. The game egress gate checks both the allowed DNS TCP path and denial paths; in distributed mode, a timeout prevents startup.

Acceptance must be completed on three Linux machines, A/B/C; single-node unit tests do not replace it:

- Cross-node Velocity `ClusterIP:25565` connections and actual source addresses, RCON, idle shutdown and wake, and image pulls after cache removal.
- Backup and restore on B, B→C migration, unchanged Service IP/ownership, retained source PVC, and a target that remains stopped.
- Mutual exclusion of wake, file writes, export, reaping and duplicate requests during migration; reconciliation continues after A restarts.
- Source-node loss, interrupted transfers, full target/archive disks and read-back verification failures; confirm that the source world remains recoverable.
- Game-Pod requests to other servers, the controller, registry, host ports, kubelet and metadata are all denied; every denial target is reachable by a trusted positive probe.
- Expired, replayed, cross-server and wrong-operation archive tokens are rejected; kubelet cannot forge protected labels.
- Failover: shut down B and restore to C according to the panel's plan; confirm that fencing takes effect, the lost progress matches the plan and the automatic-start state after restoration is correct; after B comes back online, its old Pods are stopped and it hosts no worlds until it is approved again. Automatic failover triggers only when a single node is lost.
- World replicas: running servers produce replicas at the configured interval, players notice only a save pause meanwhile, and the replica count and retention period match the settings.
- Controller high availability: with three controllers, shut down the controller hosting the control plane; confirm that the control plane recovers on another controller, the background loops and the operator do not run twice, the host timers move with PostgreSQL and the floating address moves; the lost controller returns to service after coming back online; enabling high availability from a single controller completes its migration on real data with the original volumes kept.

Current local verification uses one existing ARM64 CentOS Stream 9 Felis VM and a temporary test program for the archive and migration logic. `deploy/test-node-firewall.sh` tests resident-node, NodePort DNAT and early-ACCEPT protection in isolated network namespaces without changing the VM's existing cluster network. Three-machine network acceptance remains mandatory before deployment. The failover and controller high-availability logic is covered by unit tests and installer script tests; the acceptance above is still pending on multiple real machines, and the default Longhorn version `v1.8.1` also remains to be confirmed on the target systems. Without controller high availability, A remains a single point of failure for the control plane and public entry.

Related upstream documentation: [k3s networking across public networks](https://docs.k3s.io/networking/distributed-multicloud), [time-limited bootstrap tokens](https://docs.k3s.io/cli/token), [NodeRestriction labels](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#node-isolationrestriction), [NetworkPolicy node boundaries](https://kubernetes.io/docs/concepts/services-networking/network-policies/).
