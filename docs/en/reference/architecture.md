---
title: Deployment architecture
---

# Deployment architecture {#部署架构}

## Single-node deployment {#单机部署}

`deploy/bootstrap.sh` defaults to a single node. For the opt-in A controller / worker deployment, see [multi-node deployment](/en/guide/distributed). The host needs systemd, root, and one of the [supported package managers](/en/operations/#_1-supported-hosts); the installer installs everything else: k3s, the JRE, cloudflared, and Docker when an image has to be built on the host. Where the binary and the images come from is described in the [operations guide](/en/operations/#where-the-binary-and-the-images-come-from).

PostgreSQL runs inside k3s as the `felis-postgres` Deployment, from the official image the release pins by digest, with its data on the host in `/var/lib/felis/postgres`.

Single-node deployment remains the default. The opt-in [distributed mode](/en/guide/distributed) keeps the API and operator on the controller and runs games on approved k3s agents. A world is a ReadWriteOnce claim on its node's local-path storage; moving it requires an explicit stopped migration through the controller's archive service.

When a worker is lost, the Owner can fail its worlds over to other nodes, each restored from the server's newest intact backup, either manually or automatically once automatic failover is enabled; servers running on workers take live replicas at a set interval, which reduces the progress a failover loses. Optional controller high availability, built on k3s embedded etcd and Longhorn replicated storage, moves the control plane to another controller when the controller hosting it is lost. Without controller high availability, an A restart pauses control operations until its workloads return, and the worlds on A cannot be failed over. Failover and controller high availability have not yet completed multi-node acceptance, and cross-node networking still requires the three-machine acceptance described in the distributed runbook.

## Controller and workers {#主控与工作节点}

Distributed mode is disabled by default. Controller A runs the Felis API/operator, k3s server, PostgreSQL, registry, archive service and system servers; Velocity remains a systemd service on the controller. Workers B, C and others run only k3s-agent/containerd, game Pods and maintenance Jobs created by the controller. Every node must use the same architecture and k3s version as A; administrators must trust and maintain the hosts.

With controller high availability enabled, further controllers can be added. etcd requires a majority of its members online, so three or more controllers, in an odd number, are recommended; three controllers tolerate the loss of one. The control-plane workloads are scheduled only on controllers and run on the same controller as PostgreSQL; PostgreSQL, uploads, the registry, the archive and the system servers' worlds are stored on Longhorn replicated volumes. Host timers such as the database backup and the off-site copy run only on the controller that currently runs PostgreSQL. Every controller runs Velocity, and an optional VRRP floating address moves between the controllers.

## Host operations from the panel {#host-operations-from-the-panel}

The host operations the Owner runs from the panel (database backup and restore, the off-site copy, the whole-host rebuild, the health check, the support bundle, the access method, the root domain, credential rotation and others) are executed by `felis-node-control.service`, a root service the installer sets up. The service runs the same `felis` command or installer function as the command line and accepts only a fixed list of operations with validated parameters. felis-api remains unprivileged and mounts the service's Unix socket directory read-only; every task requires a fresh sign-in proof and is recorded in the audit log. See [operations guide section 9](/en/operations/#_9-running-the-host-from-the-panel-go-tested-sh-tested).

## Runtime flows {#运行流程}

The [sequence diagrams](/en/reference/sequence-diagrams) cover join-and-wake, claim transactions and account linking from the main repository. See [server-side plugins](/en/reference/plugins) for the implementation and routing constraints.
