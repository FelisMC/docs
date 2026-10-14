---
title: Uninstall and reinstall
description: Removing Felis from a host, what an uninstall keeps and deletes, and reinstalling on top of the kept data.
---

# Uninstall and reinstall {#uninstall-and-reinstall}

This page is for operators. It explains how to remove Felis from a host, what each of the two uninstall modes keeps and deletes, and how to reinstall on top of the kept data and bring the servers and worlds back. To move to another host, see [Planned move](/en/operations/backup#move-host).

## Uninstall {#uninstall}

The uninstall script `deploy/uninstall.sh` removes what the installer put on the host. It first prints what it will remove and asks for confirmation: type `yes` in the default mode, or `purge` with `--purge`; `--yes` skips the question.

```bash
# remove Felis, keep the data
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/uninstall.sh | sudo bash -s -- --yes
# remove Felis and the data
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/uninstall.sh | sudo bash -s -- --purge
```

| Option | Description |
| --- | --- |
| `--purge` | Also deletes `/etc/felis` and `/var/lib/felis` (the database cluster, the database bundles and anything an earlier keep-data run set aside), plus the worlds, archives, Felis images and Docker's build cache |
| `--keep-k3s` | Leaves k3s installed and removes only Felis's namespaces and CRD |
| `--remove-k3s` | Runs k3s's own uninstaller even when other workloads live in the cluster |
| `--no-backup` | Skips the final database bundle the keep-data mode takes first |
| `--yes` | Does not ask for confirmation |

Both modes remove:

- The Felis systemd units: the timers (`felis-db-backup`, `felis-watchdog`, `felis-offsite`, `felis-build-tools`, `felis-update-check`) and their services, `felis-watchdog-failed.service`, `felis-velocity.service`, `felis-nano.service`, `cloudflared-felis.service`, and `felis-postgres-firewall.service` from early releases.
- The game proxy's system user `felis-velocity`, `/opt/felis` and `/usr/local/bin/felis`.
- The release assets an interrupted installation left in `/var/lib/felis/artifacts`.
- The cloudflared binary the installer placed (kept when another service unit uses it).
- The nftables table `felis_edge` (and `felis_postgres` from early releases), the firewalld ports the installer opened and its `felis-`-commented ufw rules; the rules admitting the k3s ranges go only when k3s goes too.

How k3s is handled: when the cluster holds nothing but Felis's namespaces, k3s is removed with k3s's own `k3s-uninstall.sh`; when it runs other workloads, only the `felis`, `minecraft` and `felis-build` namespaces and the MinecraftServer CRD are deleted. `--keep-k3s` and `--remove-k3s` override that choice. When k3s does not answer, the script cannot tell whether the cluster runs anything else; it stops and asks you to start k3s (`systemctl start k3s`) or pass one of the two options.

::: danger
`--purge` deletes the database, the database bundles, every world and every world archive, irreversibly. Before running it, make sure the backups you need are stored off the host; see [Backup and restore](/en/operations/backup#offsite).
:::

### What is kept and what is deleted {#kept-data}

| Item | Default (keep data) | `--purge` |
| --- | --- | --- |
| Final database bundle | Taken first (`felis db backup -label manual`); a failure stops the uninstall before anything is removed. `--no-backup` skips it | None |
| The database (`/var/lib/felis/postgres`) | Kept; felis-postgres is stopped cleanly before k3s goes | Deleted with `/var/lib/felis` |
| A host PostgreSQL an early release installed | Left as it is: stopped after the move into k3s, with its old copy of `felis` | Its `felis` database and role are dropped (the server is started for that and stopped again), and `listen_addresses` and `pg_hba.conf` go back to how they were. If the role still owns another database or holds grants elsewhere, the purge stops before anything is removed and lists those objects with the `ALTER DATABASE … OWNER TO postgres` to run |
| `/etc/felis` (secrets, `felis.toml`, `offsite.env`, the mail relay password and upload storage keys `felis setup` recorded, the tunnel configuration) | Kept; `bootstrap.done` and the per-run records are removed | Deleted, together with the tunnel's credentials file |
| `/var/lib/felis` (the database and its bundles) | Kept | Deleted |
| Worlds, archives, the image registry, uploads | Moved to `/var/lib/felis/retained/k3s-storage-<stamp>/`; with `--keep-k3s`, their volumes switch to the `Retain` reclaim policy and stay in place | Deleted |
| Felis images, Docker's build cache | Kept | Deleted |

### Removing host packages {#remove-packages}

Neither mode removes packages (Docker, git, nftables, and the PostgreSQL server an early release installed) or the swap file a low-memory host received, since other software may use them. To return the host to a bare state:

```bash
sudo swapoff /swapfile && sudo rm /swapfile && sudo sed -i '\|^/swapfile |d' /etc/fstab
sudo dnf remove docker-ce docker-ce-cli containerd.io postgresql-server   # or use apt/zypper/pacman
```

### Cleaning up Cloudflare {#cloudflare-cleanup}

The Cloudflare side outlives the host. Once you are sure you will not reinstall, delete at Cloudflare:

1. The tunnel: Zero Trust → Networks → Tunnels, or `cloudflared tunnel delete <name>` (the tunnel Felis creates is named `felis`).
2. The DNS records for the panel and operator console hostnames.
3. The Access application for the operator console.

## Reinstalling on kept data {#reinstall}

A keep-data uninstall leaves everything a reinstall needs. The installer reuses `/etc/felis/secrets.env`, so the database password and the forwarding and session secrets are unchanged; felis-postgres starts again on the cluster kept in `/var/lib/felis/postgres`, and the installer migrates the kept database instead of creating a new one.

The steps below apply to the default mode (k3s removed by the uninstall, volumes moved to the `retained` directory). First set two variables: `kept` names the directory the uninstall moved the volumes to, and `store` is the new cluster's volume directory.

```bash
kept="$(ls -d /var/lib/felis/retained/k3s-storage-* | tail -n 1)"
store=/var/lib/rancher/k3s/storage
```

1. Install as usual, following [Installation](/en/guide/deployment#install). The installer reads the root domain from the kept `felis.host.toml`; if the old root domain was not the default `<IP>.nip.io`, name the same root domain with `FELIS_ROOT_DOMAIN`.

2. Run `sudo felis setup`. It recreates the login space and the lobby; the Owner already exists, so it opens on the status screen and you can quit there.

3. Put the image registry and the uploads back. They hold every custom server image and uploaded file; without the registry, a restored server cannot pull its image.

   ```bash
   sudo k3s kubectl -n felis scale deploy/registry deploy/felis-api --replicas=0
   sudo k3s kubectl -n felis wait --for=delete pod -l app.kubernetes.io/component=registry --timeout=120s
   sudo k3s kubectl -n felis wait --for=delete pod -l app.kubernetes.io/component=api --timeout=120s
   sudo rsync -a --delete "$kept"/pvc-*_felis_registry/ "$(ls -d $store/pvc-*_felis_registry)"/
   sudo rsync -a --delete "$kept"/pvc-*_felis_felis-uploads/ "$(ls -d $store/pvc-*_felis_felis-uploads)"/
   sudo k3s kubectl -n felis scale deploy/registry deploy/felis-api --replicas=1
   ```

   Then run the installer once more. It pushes this release's images over the older copies in the restored registry.

4. Bring the game servers back. The final database bundle holds every MinecraftServer resource; the selector skips the login space and the lobby, which step 2 created for this release:

   ```bash
   b="$(ls -t /var/lib/felis/db-backups/felis-db-*-manual.tar | head -n 1)"
   tar -xOf "$b" k8s/minecraftservers.json \
     | sudo k3s kubectl apply -l '!felis.lolicon.best/system-role' -f -
   ```

5. Put each world back. A server's volume exists only after the server has started once, so start it from the panel, stop it again, and copy the kept world over the new one:

   ```bash
   s=<server name>
   sudo rsync -a --delete "$kept"/pvc-*_minecraft_world-$s-0/ "$(ls -d $store/pvc-*_minecraft_world-$s-0)"/
   ```

   Then start the server. The lobby works the same way: stop it, copy `world-lobby-0`, and set it back to `Running`:

   ```bash
   sudo k3s kubectl -n minecraft patch minecraftserver lobby --type=merge -p '{"spec":{"desiredState":"Stopped"}}'
   ```

6. Bring the world archives back so that the panel's restore points work again. The archive volume appears with the first backup, so back up any server from the panel first, then run:

   ```bash
   sudo rsync -a "$kept"/pvc-*_minecraft_felis-backups/ "$(ls -d $store/pvc-*_minecraft_felis-backups)"/
   ```

   With an off-site bucket configured, `sudo felis offsite fetch-worlds` fetches the archives from the bucket instead.

7. Delete `/var/lib/felis/retained/` once every server is back.
