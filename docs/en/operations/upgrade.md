---
title: Upgrading
description: Check and apply updates with felis update, set the maintenance window, manage component versions, cross PostgreSQL major versions and roll back a failed upgrade.
---

# Upgrading {#upgrade}

This page is for operators. It explains how to check for and apply Felis updates, which components restart during an update, how to manage the versions of the components around Felis, how to cross a PostgreSQL major version, and how to roll back a failed upgrade. For the difference between the installation channels, see [Installation](/en/guide/deployment#channels).

## Checking and applying updates {#update}

By default `felis update` only checks; it changes nothing on the host. It reports each component's installed and available upstream version, resolves the Felis target, downloads the installer that matches the target and checks its syntax, and prints an explicit apply command.

```bash
sudo felis update                        # check the newest stable release
sudo felis update --all                  # also plan the release-pinned k3s and cloudflared upgrades
sudo felis update --version v0.2.0       # check a named published release
sudo felis update --dev                  # check the newest commit on main
sudo felis update --ref <commit-or-tag>  # check a specific source tree
```

The upstream table is advisory. Applying uses the target's mutually compatible pinned versions; it does not install each component's newest upstream release on its own. User servers' game images stay as they are. Options such as `--k3s`, `--cloudflared`, `--jre` and `--postgres` only narrow the report; applying any core component reconciles the whole platform bundle.

To apply an update:

1. Set a [maintenance window](#maintenance-window) in **Maintenance & Backups → Updates**.
2. Run the check and review the target, the full commit, the scope and the restart impact it prints.
3. Inside the maintenance window, run the `--apply` command the check printed, exactly as printed. For a release it carries `--version <tag> --expect-commit <full SHA>`, which refuses a tag that has moved; for a source build it carries `--ref <full SHA>`.

```bash
sudo felis update --apply --version v0.2.0 --expect-commit <full SHA>
```

The apply runs these steps and stops at the first one that fails:

1. Checks the maintenance window.
2. Backs up the database, `/etc/felis` and every MinecraftServer resource into a `pre-migrate` database bundle. If the backup fails, nothing is changed.
3. Checks the maintenance window again.
4. Runs the target's installer, which reconciles the `felis` command, the API, operator and panel, the manifests and RBAC, the game plugins, the game proxy and the system server images, and streams the installer's progress. The installer's rollout checks decide whether the update succeeds.
5. Verifies that the installed `felis` version matches the target.

Other options:

- `--force` reinstalls the same version or permits an intentional Felis downgrade; a downgrade to an earlier release requires it. It never skips the maintenance window, the backup or the component compatibility checks.
- `--all` also applies the release-pinned k3s and cloudflared upgrades; see [Component versions](#component-versions).

An older `felis` whose `felis update -h` has no `--apply` needs one installer run to acquire this updater. On a completed installation, `sudo felis setup` opens the configuration console only; it is not an upgrade path.

::: warning
Applying an update can restart the API, the game proxy and the system servers: the panel is briefly unavailable, and a proxy restart disconnects every player online. Apply inside the maintenance window, at a quiet hour.
:::

### Restarts during an update {#restarts}

The installer restarts a component only when what it runs has changed:

| Component | Restarted when |
| --- | --- |
| Game proxy `felis-velocity` | Its unit, the Java runtime, `velocity.jar`, `velocity.toml`, the forwarding secret, the felis-link settings (except `service-token`, which the plugin re-reads) or a plugin jar changed, or the service was not running. The fingerprint is kept in `/etc/felis/velocity.fingerprint`; delete it to force a restart. |
| Login space and lobby pods | A rebuilt Limbo or lobby image has a new image ID (recorded in `/etc/felis/system-server-images`). The installer pins that server's image to the new digest and the operator rolls each pod onto it; when the registry is unreachable, the installer recreates the pod instead. |
| felis-postgres | The release changed the PostgreSQL image or the pod; the API pauses for a few seconds. |
| felis-api, felis-operator, the registry pod | The image tag changed (an upgrade), or a same-version re-run rebuilt the image. |

felis-api and felis-operator each run as a single replica with the Recreate strategy, so the panel and the API pause during an upgrade, normally for seconds and longer when an image has to be imported. When a new pod cannot start (for example, a missing image), the installer reports the rollout as failed after 180 seconds and prints `kubectl describe` diagnostics, where `ErrImagePull` or `ImagePullBackOff` shows.

A platform upgrade does not restart running game servers. Their init containers also run the Felis image; a running server keeps the version it started with and picks up the new one at its next start. A release that changes the game pod in any other way restarts running servers once, as editing a server's settings does.

## Updating from the panel {#panel-update}

The Owner can update Felis from the panel directly, without logging in to the host to run `felis update --apply`.

**Entry and permissions**: the entry point is **Maintenance & Backups → Updates**. When the daily version check finds a newer release for felis-api, a card titled **Update now to** followed by the target version appears below the **Component versions** card. It shows the current version, the target version and a description of the component. Only the Owner can use it; Admins do not see the card. After you select **Update now** and confirm in the dialog, identity verification is required before the update starts. While another host task is running on the host, the button is unavailable; use it once that task ends.

**What it does**: the update is the same as `--apply` on the command line. Felis backs up the database and the deployment state first, then runs the installer of the target version. felis-api, the game proxy and the system servers restart, and players who are online may be disconnected; see [Restarts during an update](#restarts).

**Maintenance window**:

- Inside the [maintenance window](#maintenance-window), the dialog asks only for confirmation.
- Outside the window, the dialog shows “The current time is outside the maintenance window. The update starts immediately.” The update can be confirmed only after you tick **I confirm updating immediately outside the maintenance window**. This is the same as `--apply --now`, which explicitly starts one-off manual maintenance.

**How it runs**: the update runs in a transient systemd unit named `felis-update-<task ID>.service` on the host. It does not depend on the felis-api or node-control processes, so restarting either of them during the update does not interrupt it. Panel requests fail briefly while the update runs; the page shows “The panel is restarting. Reconnecting…” and keeps retrying. When node-control restarts, it reattaches to the same task, and the stage shows “Reconnected; waiting for the update to finish”. A task runs for at most 90 minutes; on timeout, the task is marked as failed and the update unit on the host is not stopped. If the host restarts during the update, the task ends as failed. Run `felis version` and `felis update --check` on the host to confirm the installed version before deciding whether to retry.

**Results**:

- Success: the page shows the version the host was updated to. The panel files have changed, so select **Reload the panel** to load the new version.
- Failure: the page shows the error and the end of the log, including the installer output, with a rollback note. The backups of the database and the deployment state taken before the update are kept. Run `felis update --check` on the host to see the version now installed, then investigate under [When an update fails](#failed-update). To go back, follow [Rolling back](#rollback).

**Multi-node deployments**: a panel update updates only the controller node. Worker nodes still use the node upgrade task; see [Updating nodes](/en/guide/distributed#update-nodes).

## Maintenance window {#maintenance-window}

The maintenance window decides when `felis update --apply` may run. Set it under **Maintenance & Backups → Updates** → **Configure Maintenance Window**:

1. Choose a **Start Time** and an **End Time**. Times are chosen and shown in your browser's local time zone; the end must be after the start.
2. Select **Save Maintenance Window**. **Clear Maintenance Window** removes a window.

The window's status reads **Currently Active**, **Scheduled (Future)**, **Expired (Past)** or **Unset**.

When applying, `felis update` reads the window before the backup and again before installation:

- An unset, future or expired window refuses the apply.
- `--apply --now` explicitly starts one-off manual maintenance instead of using the window.
- A window that cannot be read is always refused, `--now` included.
- `--force` never skips the window check.
- The daily check (`felis update --record`) never applies anything.

An installer run started by hand does not read the maintenance window; schedule such runs for a quiet hour yourself.

## Development channel {#dev-channel}

A host installed from the development channel (`FELIS_VERSION_BOOTSTRAP=dev`) follows the main branch and builds from source. To check and apply a development version:

```bash
sudo felis update --dev
```

The check prints the full SHA of the newest commit on main and an apply command with `--ref <full SHA>`, pinned to the commit you checked. `--apply --dev` resolves main again when it runs; use it only when that is what you want.

You can also upgrade by re-running the installer. A re-run keeps the installed root domain, but the channel must be given again; otherwise the installer installs from the default release channel:

```bash
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo FELIS_VERSION_BOOTSTRAP=dev bash
```

A source build needs the resources to build images on the host; see [Requirements](/en/guide/requirements#preflight).

## Component versions {#component-versions}

`felis-update-check.timer` runs `felis update --record` daily around 05:30 (catching up after boot when a run was missed). The result appears on the **Component versions** card under **Maintenance & Backups → Updates**: each component's installed version and any newer release, and, for a component with an update, the `sudo felis update --<component>` command that prints how to apply it. Felis applies no update on its own. When the newest record is more than 26 hours old, the card reads **Check overdue**, meaning the timer has stopped:

```bash
systemctl list-timers felis-update-check.timer
journalctl -u felis-update-check -n 50 --no-pager
sudo felis update --record   # record a fresh check now
```

The updater reuses the installer to reconcile Felis and its core components. The other components the installer puts on the host are treated as follows:

| Component | On an installer re-run | How to upgrade |
| --- | --- | --- |
| Velocity, Limbo, Paper, LuckPerms | Follow the release's game stack lock file (`deploy/game-stack.lock`) | Re-run the installer or apply an update after a release that moves the lock |
| Temurin Java runtime | A runtime the installer put there moves to the pinned patch build; a runtime from any other source is left in place | Re-run the installer |
| k3s | Left at its version | Re-run the installer with `FELIS_UPGRADE_DEPS=1`, or `felis update --all`: moves to the pinned release through that release's install script, one minor version at a time, never backwards |
| cloudflared | Left at its version | `FELIS_UPGRADE_DEPS=1` or `felis update --all`: replaces `/usr/local/bin/cloudflared` with the pinned, sha256-checked release and restarts `cloudflared-felis`; a cloudflared installed by the distribution's package stays with its package manager |
| PostgreSQL | Follows the image the release pins | A minor version comes with a Felis release, and the re-run restarts felis-postgres (the API pauses for a few seconds); for a major version, see [PostgreSQL major upgrades](#postgresql-major) |
| Docker, git, nftables | Distribution packages | The package manager |

Versions pinned by the current release:

| Component | Pinned version | Installer variable |
| --- | --- | --- |
| k3s | v1.36.4+k3s1 | `FELIS_K3S_VERSION` |
| cloudflared | 2026.9.1 | `FELIS_CLOUDFLARED_VERSION`; another version also needs `FELIS_CLOUDFLARED_SHA256` |
| Temurin Java runtime (game proxy) | 25 (25.0.4.1+1) | `FELIS_JRE_VERSION` |
| PostgreSQL | 18.6, the official `postgres` image pinned by digest | — |

When a k3s upgrade would skip a minor version, the installer stops before changing anything and asks you to set `FELIS_K3S_VERSION` to the newest release of the next minor version first.

The game stack lock file pins the upstream builds, with their sha256, that the login space, the lobby, the plain Paper image and the game proxy are built from, so every host installing one release builds the same images. `FELIS_GAME_STACK=latest` resolves upstream's newest builds at install time and builds them on the host instead, and `FELIS_VELOCITY_VERSION=<minor>` installs the newest Velocity build of that minor version. Existing servers stay pinned to the image digest they were created with and do not follow platform image changes; to move a world to a newer Minecraft version, see [Game images](/en/operations/troubleshooting#game-images).

## PostgreSQL major upgrades {#postgresql-major}

felis-postgres keeps its database cluster in `/var/lib/felis/postgres/<major>/docker`. When a release moves the image to a new major version, the installer finds the old major's cluster and stops before changing anything, so that the new server does not start an empty cluster beside it. The way across is a bundle taken on the current release, restored into the new major's empty cluster.

::: warning
These steps stop the panel and all server management until the restore completes. Run them inside a maintenance window, and keep the old cluster directory as the way back.
:::

1. On the release you run now, take a bundle, stop the database and move the old cluster aside:

   ```bash
   b="$(sudo felis db backup -label pre-upgrade | sed -n 's/^felis db backup: wrote //p')"
   sudo k3s kubectl -n felis scale deploy/felis-postgres --replicas=0
   sudo mv /var/lib/felis/postgres/18 /var/lib/felis/postgres-18.old
   ```

2. Install the new release. It starts an empty cluster on the new major version and creates the schema:

   ```bash
   curl -fsSL <installer URL> | sudo bash
   ```

3. Restore the data and bring its schema up to the new release:

   ```bash
   sudo k3s kubectl -n felis scale deploy/felis-api deploy/felis-operator --replicas=0
   sudo felis db restore -yes -no-safety-backup "$b"
   sudo felis migrate up -config /etc/felis/felis.host.toml
   sudo k3s kubectl -n felis scale deploy/felis-api deploy/felis-operator --replicas=1
   ```

Delete `/var/lib/felis/postgres-18.old` once the new release has run for a while. To go back instead, scale felis-postgres to 0, move the new major's directory out of `/var/lib/felis/postgres`, move `postgres-18.old` back as `/var/lib/felis/postgres/18`, and re-run the older release's installer. For what a bundle holds and the restore rules, see [Restoring the database](/en/operations/backup#restore-database).

## Upgrading older installations {#older-installs}

### Refreshing an older installation {#refresh-old-install}

Three parts of an installation keep the shape they had when they were created, and neither `felis setup` nor `kubectl rollout restart` updates them: the felis-api Deployment (an environment variable added later, such as `FELIS_SMTP_PASSWORD`, is absent until the Deployment is rendered again), the lobby image (an early build lacks LuckPerms, and every permission change from the panel then answers `luckperms_missing`), and the MinecraftServer resources (a field added later stays unset). Bring them forward in this order, images first:

1. Re-run the installer. It renders and applies the control-plane configuration, rebuilds and imports the login space and lobby images, and recreates those two pods; the `[smtp]` relay `felis setup` wrote is kept.
2. Fill in the fields the system servers gained since, then enable RCON on user servers created before it was the default:

   ```bash
   sudo felis converge
   sudo felis converge -user-rcon
   ```

   ::: warning
   `-user-rcon` requires the server image to open an RCON listener; with an image that does not, the server may fail to start. Run it only for images that support RCON. A user server applies its new RCON settings at its next start.
   :::

The panel equivalent is **Platform settings → Access and security** → **System server completion**. Check each part:

```bash
sudo k3s kubectl -n felis get deploy felis-api \
  -o jsonpath='{.spec.template.spec.containers[0].env[*].name}' | tr ' ' '\n' | grep SMTP
sudo k3s kubectl -n minecraft exec lobby-0 -- ls /data/plugins | grep -i luckperms
sudo k3s kubectl -n minecraft get minecraftserver \
  -o custom-columns=NAME:.metadata.name,RCON:.spec.rcon.enabled,IDLE:.spec.idle.autoStopEnabled
```

The environment variable carries only the mail relay's password; the relay itself still needs configuring, see [Mail relay](/en/operations/monitoring#mail-relay). For the system server fields, see [System server configuration](/en/operations/troubleshooting#system-server-fields).

### Moving a host PostgreSQL into k3s {#database-move}

Early releases ran the database on a PostgreSQL the installer installed on the host. The first re-run of a release with felis-postgres on such a host moves the database once:

1. It stops felis-api, felis-operator and the host timers, and heads the host's `pg_hba.conf` with a rule that refuses every connection to the `felis` database except its own; the original is kept as `pg_hba.conf.pre-pg-move`.
2. It takes a `pre-pg-move` bundle, restores it into felis-postgres, and compares the row count of every table on both servers. Any failure up to here puts `pg_hba.conf` and the control plane back, and the platform keeps running on the untouched host database.
3. It stops and disables the host `postgresql` service (the package and its copy of the data stay) and writes `/var/lib/felis/postgres-moved`. A host server that also holds other databases keeps running, and its `felis` copy is then reachable over loopback only.

After the move, the host configuration reaches felis-postgres at `127.0.0.1:15432`, and `[database] deployment = "felis/felis-postgres"` makes `felis db` run `pg_dump`, `psql` and `pg_restore` inside the pod; the pods use `felis-postgres.felis.svc:5432`.

To go back to the host database (for example, to reinstall a release from before the move):

```bash
sudo k3s kubectl -n felis scale deploy/felis-api deploy/felis-operator deploy/felis-postgres --replicas=0
hba="$(sudo -u postgres psql -XtAc 'SHOW hba_file' 2>/dev/null || echo /var/lib/pgsql/data/pg_hba.conf)"
sudo cp -p "${hba}.pre-pg-move" "$hba"
sudo systemctl enable --now postgresql
sudo rm /var/lib/felis/postgres-moved
curl -fsSL <installer URL of that release> | sudo bash
```

`SHOW hba_file` needs the server running; with it stopped, the fallback is the EL distributions' default path, and Debian and Ubuntu keep the file in `/etc/postgresql/<major>/main/`. Whatever the platform wrote after the move exists only in felis-postgres; to keep it, run `sudo felis db backup` first and restore that bundle onto the host database afterwards. Once the move has run for a while, drop the host copy:

```bash
sudo systemctl start postgresql; sudo -u postgres dropdb felis; sudo -u postgres dropuser felis
```

### Server resource validation {#crd-validation}

Every installer run applies the MinecraftServer CRD embedded in the `felis` program. The API server refuses values the operator cannot act on:

| Field | Accepted values |
| --- | --- |
| `spec.rcon.port` | Unset, `0` or `25575`; the network policy opens 25575 only |
| `spec.startup.timeoutSeconds`, `spec.startup.readinessTimeoutSeconds` | 0–86400 |
| `spec.startup.healthHTTPPort` | 0–65535 |
| `spec.lifecycle.terminationGracePeriodSeconds` | 0–3600 |
| `spec.idle.emptySecondsBeforeStop` | 0–604800 (the panel caps it at 86400) |

`0` means the operator's default throughout. An object stored before these rules took effect keeps an out-of-range value until someone edits that field; the operator reads a negative value as its default and an oversized one as written. Fix such a value with `sudo k3s kubectl -n minecraft edit minecraftserver <name>`.

## Rolling back {#rollback}

### Rolling back the control-plane image {#rollback-image}

Each release runs under its own image tag, such as `felis/felis:v1.2.3`. At the end of an upgrade the installer prints the tag it moved away from and records it in `/etc/felis/previous-felis-image`. To return to the previous image:

```bash
sudo k3s kubectl -n felis rollout undo deployment/felis-api deployment/felis-operator
sudo k3s kubectl -n felis rollout status deploy/felis-api
```

The image is normally still on the node; if it was cleaned up, the in-cluster registry serves it again, since it always keeps the five newest `felis/felis` tags and every image a game pod still runs. A same-version re-run reuses its tag, so a later `rollout undo` lands on that same tag. The next installer run applies the version it installs again.

`rollout undo` reverts the image only; the database migrations the upgrade applied stay applied.

### Rolling back an upgrade that broke the database {#rollback-database}

Database migrations only roll forward. The `pre-migrate` bundle taken before the upgrade is the way back: `felis update --apply` takes one before installation, and the installer takes one whenever `felis migrate up` has migrations to apply.

::: danger
A restore replaces the whole database with the bundle; every database change made after the bundle is lost. Before restoring, Felis takes a `pre-restore` bundle of the current database.
:::

1. Stop the control plane, find the upgrade's bundle and restore it, then roll back the images:

   ```bash
   sudo k3s kubectl -n felis scale deployment felis-api felis-operator --replicas=0
   sudo felis db list | grep pre-migrate        # the newest one is the upgrade's
   sudo felis db restore -yes <that bundle>
   sudo k3s kubectl -n felis rollout undo deploy/felis-api
   sudo k3s kubectl -n felis rollout undo deploy/felis-operator
   sudo k3s kubectl -n felis scale deployment felis-api felis-operator --replicas=1
   ```

   Do not run `felis migrate up` here: the `felis` on the host is already the new release and would re-apply the migrations you are rolling back.

2. Reinstall the earlier release from its own assets, with the installer read at that same tag, so that the host matches the database (`v1.2.3` here):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/v1.2.3/deploy/bootstrap.sh \
     | sudo FELIS_RELEASE=v1.2.3 bash
   ```

   `FELIS_RELEASE` makes the installer install that release; without it the installer installs the newest release again and re-applies its migrations. It is refused together with `FELIS_REF`, `FELIS_ARTIFACT_DIR`, `FELIS_SKIP_FETCH` or `FELIS_VERSION_BOOTSTRAP=dev`, and an unpublished tag stops the install before anything changes. An installer older than this variable ignores it (`curl -fsSL <installer URL> | grep -c FELIS_RELEASE` prints `0`); for one of those, use `FELIS_REF=v1.2.3`, which builds that tag from source.

For the full restore rules, see [Restoring the database](/en/operations/backup#restore-database).

### Schema guard {#schema-guard}

felis-api, the world cleanup, the off-site copy and `felis migrate up` compare the migrations the database records with the ones built into the program:

- When a newer release migrated the database, they stop with `database schema is newer than this felis build: it records migration 0026, and this build knows migrations up to 0025`. After a `rollout undo` across an upgrade that migrated, felis-api stays in CrashLoopBackOff until the `pre-migrate` bundle is restored.
- When the database lacks migrations, felis-api, the world cleanup and the off-site copy report `database schema is behind this felis build` until `felis migrate up` runs; the preflight of `felis setup` applies missing migrations itself.

### When an update fails {#failed-update}

The installer replaces `/usr/local/bin/felis` early (later steps run the new version) and keeps the old one as `felis.prev` until the new one is in use. A run that fails before the database migrations start puts the old version back, so the host timers and `felis setup` keep matching the database and the control plane that are still running; a re-run continues from there. Once the migrations have started, the new version stays.

A failed installer can leave some components changed, and the database schema is not rolled back automatically. Keep the pre-update bundle and read the installer's output before retrying, or go back as described in [Rolling back an upgrade that broke the database](#rollback-database).
