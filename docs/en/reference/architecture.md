---
title: Deployment architecture
---

# Deployment architecture {#部署架构}

## Single-node deployment {#单机部署}

`deploy/bootstrap.sh` defaults to a single node. For the opt-in A controller / worker deployment, see [distributed.md](/en/guide/distributed). It needs systemd, root, and one of the
package managers below; everything else (k3s, the JRE, cloudflared, and Docker when an image
has to be built on the host; see "Where the binary and the images come from" below) it
installs.
PostgreSQL runs inside k3s as the `felis-postgres` Deployment, from the official image the
release pins by digest, with its data on the host in `/var/lib/felis/postgres`.

Single-node deployment remains the default. The opt-in [distributed mode](/en/guide/distributed)
keeps the sole API and operator on A and runs games on approved k3s agents. A world is
a ReadWriteOnce claim on its node's local-path storage; moving it requires an explicit
stopped migration through A's archive service. There is no automatic failover or
standby controller. An A restart pauses control operations until its workloads return;
a lost worker leaves its worlds on that node. Cross-node networking still requires the
three-machine acceptance described in the distributed runbook.

## Controller and workers {#主控与工作节点}

Distributed mode is disabled by default. A runs the sole Felis API/operator, k3s server, PostgreSQL, registry, archive service and system servers; Velocity remains a systemd service on A. Nodes B, C and others run only k3s-agent/containerd, game Pods and maintenance Jobs created by A. Every node must use the same architecture and k3s version as A; administrators must trust and maintain the hosts.

## Runtime flows {#运行流程}

The [sequence diagrams](/en/reference/sequence-diagrams) cover join-and-wake, claim transactions and account linking from the main repository. See [server-side plugins](/en/reference/plugins) for the implementation and routing constraints.

---

Source: [docs/operations.md](https://github.com/FelisMC/Felis/blob/main/docs/operations.md), [docs/distributed.md](https://github.com/FelisMC/Felis/blob/main/docs/distributed.md), [docs/sequence-diagrams.md](https://github.com/FelisMC/Felis/blob/main/docs/sequence-diagrams.md), [plugins/README.md](https://github.com/FelisMC/Felis/blob/main/plugins/README.md).
