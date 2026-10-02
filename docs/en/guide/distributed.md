---
title: Multi-node deployment
---

# A controller with multiple workers {#a-主控与多机-worker}

Distributed mode is disabled by default. A runs the sole Felis API/operator, k3s server, PostgreSQL, registry, archive service and system servers; Velocity remains a systemd service on A. Nodes B, C and others run only k3s-agent/containerd, game Pods and maintenance Jobs created by A. Every node must use the same architecture and k3s version as A; administrators must trust and maintain the hosts.

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

Once approved, administrators can select the node when creating a server in the panel, or pass `nodeName` in the creation request. Ordinary server owners cannot select a node or specify a PVC. An unreachable node rejects new work; the operator removes the server Service's backends and Ready status, and Velocity follows its existing fallback flow without moving to another node.

## Migrate a stopped server {#停服迁移}

Stop the server in the panel and wait for `Stopped` and for the game Pod to exit. Open **Stopped migration** and select an online, approved target worker. The panel reads the latest operation from the CR's persistent record, so progress remains visible after a page refresh or an A restart.

```bash
# Root operations on A; separate from the database's felis migrate command:
felis server-migrate start --name survival --target-node c
felis server-migrate status --name survival
felis server-migrate retry --name survival --id <operation-ID>
```

Administrator API:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/nodes` | Execution node list |
| POST | `/api/v1/servers/{name}/migrations` | `{ "targetNode": "c" }`; returns the operation and ID |
| GET | `/api/v1/servers/{name}/migrations` | Latest migration record |
| GET | `/api/v1/servers/{name}/migrations/{id}` | Current operation progress |
| POST | `/api/v1/servers/{name}/migrations/{id}/retry` | Retry the failed stage |

Stages are `backing_up` → `restoring` → `switching` → `succeeded`. The lock is `migration@<start-time>` and does not expire under the temporary maintenance lock's two-minute rule. Failure records the stage and reason while keeping the lock and stopped state. A repeated request for the same target returns the existing operation; other migrations are rejected. The restore Job checks the download's SHA-256 and reads back each restored file for verification. Only after success does a single optimistic-lock CR update switch the node, active PVC and progress. The stopped StatefulSet is rebuilt to use the new PVC; the CR, Service, ClusterIP, domain and ownership remain unchanged.

A successful migration still does not start the server automatically. Inspect the target world and start it manually. The recorded `sourcePVC` is retained and is not removed by the reaper; an administrator must explicitly clean it up once it is no longer needed. On failure, do not manually delete migration annotations or locks. Resolve source-node loss, insufficient target disk space or transfer/verification errors, then retry. A committed switch does not automatically roll back to the source world.

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

Current local verification uses one existing ARM64 CentOS Stream 9 Felis VM and a temporary test program for the archive and migration logic. `deploy/test-node-firewall.sh` tests resident-node, NodePort DNAT and early-ACCEPT protection in isolated network namespaces without changing the VM's existing cluster network. Three-machine network acceptance remains mandatory before deployment. A remains a single point of failure for the control plane and public entry; the first version has no controller HA or automatic failover.

Related upstream documentation: [k3s networking across public networks](https://docs.k3s.io/networking/distributed-multicloud), [time-limited bootstrap tokens](https://docs.k3s.io/cli/token), [NodeRestriction labels](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#node-isolationrestriction), [NetworkPolicy node boundaries](https://kubernetes.io/docs/concepts/services-networking/network-policies/).

---

Source: [docs/distributed.md](https://github.com/FelisMC/Felis/blob/main/docs/distributed.md).
