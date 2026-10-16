---
title: Command-line reference
description: Every operator-facing felis subcommand, with its usage, main flags, required privileges and effects.
---

# Command-line reference {#cli}

This page describes the subcommands of the `felis` binary that operators run on a Felis host: what each one does, its usage line, its main flags and defaults, whether it needs root, and what it changes or restarts. Procedures that combine several commands are on the Operations pages linked from each entry.

## Conventions {#conventions}

- The installer puts the binary at `/usr/local/bin/felis`. `felis -h` lists every subcommand, and `felis <command> -h` prints the flags of one command.
- A flag takes one or two dashes: `-yes` and `--yes` are the same flag. Flags follow the subcommand and its verb, for example `felis db restore -yes <bundle>`.
- Most commands read root-only state under `/etc/felis` and `/var/lib/felis` or the k3s administrator kubeconfig. Run them with `sudo`. A command that requires root and runs as another user says so and exits with status 1.
- Commands that interrupt players or replace data print a plan and change nothing until you add `-yes`: `backup-now`, `restore-host`, `rotate-token`, `domain set` and `offsite take-over`. `db restore` prints what the bundle holds and stops until you add `-yes`.
- `-config` defaults to `/etc/felis/felis.toml`, a link to `/etc/felis/felis.host.toml`. See [Host files](/en/reference/configuration#host-files).
- Exit status: 0 on success, 1 on a failure or when a check finds a problem, 2 for a usage error. Commands that use other codes list them.
- The Owner can run many of these operations from the panel. The panel hands them to `felis-node-control.service`, which runs the same commands. See [Running host operations from the panel](/en/operations/#panel-host-operations).

::: tip
On some distributions, `sudo` uses a `secure_path` that omits `/usr/local/bin`. If `sudo felis` reports `command not found`, run `sudo /usr/local/bin/felis …`.
:::

## Command overview {#overview}

| Command | Purpose | Root | Panel equivalent |
| --- | --- | --- | --- |
| [`felis setup`](#setup) | Install the host when needed, configure access and upload storage, create the first Owner | Yes | Partly: **Platform settings → Access and security** |
| [`felis breakGlass`](#break-glass) | Emergency console when no Owner can sign in | Yes | None |
| [`felis version`](#version) | Print the version of the binary | No | None |
| [`felis status`](#status) | Show the platform at a glance | Yes | **Maintenance & Backups → Status** |
| [`felis doctor`](#doctor) | Run every health check once | Yes | **Maintenance & Backups → Diagnostics** |
| [`felis support-bundle`](#support-bundle) | Collect a redacted diagnostics archive | Yes | **Maintenance & Backups → Diagnostics** |
| [`felis backup-now`](#backup-now) | Back up every world now | Yes | **Maintenance & Backups → Backups** |
| [`felis db`](#db) | Back up, verify, list, check, delete and restore database bundles; export the audit log | Yes | **Maintenance & Backups → Backups** |
| [`felis migrate up`](#migrate) | Apply pending database migrations | Yes | Part of **Restore the database** |
| [`felis offsite`](#offsite) | Inspect, check and fetch the off-site copy | Yes | **Maintenance & Backups → Off-site copy** |
| [`felis restore-host`](#restore-host) | Rebuild this host from the off-site copy | Yes | **Maintenance & Backups → Off-site copy** |
| [`felis update`](#update) | Check versions and apply a reviewed update | For `--apply` | **Maintenance & Backups → Updates** (check only) |
| [`felis domain`](#domain) | Check or move the root domain | Yes | **Platform settings → Access and security** |
| [`felis rotate-token`](#rotate-token) | Replace a generated credential | Yes | **Platform settings → Access and security** |
| [`felis converge`](#converge) | Fill in fields that older server specifications lack | Yes | **Platform settings → Access and security** |
| [`felis server-migrate`](#server-migrate) | Move a stopped world to another node | Yes | **Migrate world** on the server's page |
| [`felis node`](#node) | Enroll, approve and update nodes | Yes | **Platform settings → Distributed** |
| [`felis ha`](#ha) | Check the host leader; move control-plane volumes to replicated storage | Yes | **Platform settings → Distributed** |

## Setup and access {#setup-and-access}

### felis setup {#setup}

Runs the first-run setup console, a terminal wizard that configures access to the panel and upload storage and creates the first Owner.

```bash
sudo felis setup [-config path]
```

- On a host where Felis is not installed yet, it first runs the installer built into the binary, then continues with the wizard. To choose a release channel or set installer variables, run the installer instead; see [Installation](/en/guide/deployment#install).
- The wizard covers preflight, the connection (direct access, your own reverse proxy, or Cloudflare Tunnel), upload storage (the local disk or an S3-compatible bucket) and the first Owner. Its summary screen also configures the mail relay.
- When it creates the Owner, it prints a one-time URL for recording an email address and creating a passkey. The URL is valid for 30 minutes. Running `sudo felis setup` again while that browser step is unfinished issues a new URL; an account that already has a sign-in factor is never reset.
- It creates the login space and lobby system servers when they are missing. Existing system servers keep their desired state, and a login space or lobby that fails to start does not block panel setup.
- On an installed host it opens on the status screen, from which the connection, the upload storage and the mail relay can be changed. Leaving that screen without a change changes nothing.
- It uses the installed binary and does not upgrade Felis. See [Upgrading](/en/operations/upgrade#update).

| Flag | Default | Description |
| --- | --- | --- |
| `-config` | `/etc/felis/felis.toml` | Configuration file. |
| `-dev` | — | Refused. The release channel is chosen by the installer (`FELIS_VERSION_BOOTSTRAP=dev`). |

**What it changes**: the `[auth]` keys and the Cloudflare tunnel configuration (`/etc/felis/cloudflared.yml`), the upload storage keys in `[registry]` with bucket credentials in `/etc/felis/uploads-s3-access-key` and `/etc/felis/uploads-s3-secret-key`, the `[smtp]` relay with its password in `/etc/felis/smtp-password`, and the Owner account. felis-api restarts when access or storage changes.

**Root**: Required.

**Panel**: the access method and upload storage on **Platform settings → Access and security**; the mail relay on **Platform settings → Notifications and retention → Mail delivery**. The first Owner can only be created here.

**See also**: [The setup wizard](/en/guide/deployment#setup-wizard), [Access methods](/en/operations/access#access-methods).

### felis breakGlass {#break-glass}

Opens the local emergency console, which restores access when no Owner can sign in.

```bash
sudo felis breakGlass [-config path]
```

The console offers four operations:

| Operation | Effect |
| --- | --- |
| **Provision or reset the Owner account** | Creates or resets the Owner, prints a one-time setup URL and turns local session sign-in back on. |
| **Add an Operator account** | Adds another staff administrator account; the global sign-in setting is left as it is. |
| **Halt a running server** | Stops one server. |
| **Back up a world now (Sync)** | Archives one server's world. |

When a staff account exists, the console asks which account is breaking the glass and mails a six-digit code to that account's verified address, through the relay saved in the panel or else the `[smtp]` relay. The code is valid for 10 minutes, and five wrong entries end it. When no code can be sent or proven (an unknown account, no verified address, no relay, a refused mail), the operator can type `OVERRIDE`; the run is then recorded as an unverified root override with the reason.

Every run writes an audit row with source `break-glass` and action `break_glass.recovery`, `break_glass.root_override` or `break_glass.operator_create`.

**Root**: Required.

**Panel**: None. The console works without the panel by design.

**See also**: [Emergency access](/en/operations/access#break-glass).

### felis version {#version}

Prints the version of the binary, the Go version and platform it was built with, and the source revision when known.

```bash
felis version
```

**Root**: Not required. The command changes nothing.

## Status and diagnostics {#status-and-diagnostics}

### felis status {#status}

Prints the platform at a glance: the release and the node, the control-plane workloads, the game proxy, every server with its players and newest world backup, the database backups and the off-site copy, the host's disks and memory, and open watchdog alerts.

```bash
sudo felis status [-systemd-dir dir]
```

- It changes nothing. A part that is down, such as the cluster or PostgreSQL, is reported as down while the rest still prints.
- `-systemd-dir` (default `/etc/systemd/system`) is where the installer's units are; the command reads the watchdog unit's settings from there.

**Root**: Required.

**Panel**: **Maintenance & Backups → Status**.

**See also**: [Diagnostics](/en/operations/monitoring#diagnostics).

### felis doctor {#doctor}

Runs every health check once and prints the results grouped by area, each with where to look next.

```bash
sudo felis doctor [-systemd-dir dir]
```

- It runs the watchdog's checks with the settings of `felis-watchdog.service`, plus checks only the host can make: systemd units that failed or stopped, timers that no longer fire, and alerts that reach no one.
- The areas are: configuration, Kubernetes cluster, PostgreSQL, game proxy, database backups, off-site copy, build scan database, disk space, memory, k3s certificates, node address, clock, systemd units and timers, and alerting.
- It sends no mail, pings no heartbeat and leaves the watchdog's state unchanged, so it is safe to run at any time.
- Exit status: 0 when every check passes, 1 when anything is found.

**Root**: Required.

**Panel**: **Maintenance & Backups → Diagnostics → Health check**.

**See also**: [Diagnostics](/en/operations/monitoring#diagnostics), [Troubleshooting](/en/operations/troubleshooting#first-steps).

### felis support-bundle {#support-bundle}

Collects status, doctor output, logs and cluster state into one redacted `tar.gz` file to share when asking for help.

```bash
sudo felis support-bundle [-o dir] [-log-lines n] [-since duration] [-server-logs]
```

| Flag | Default | Description |
| --- | --- | --- |
| `-o` | `/var/lib/felis/support` | Output directory, created with mode 0700 when missing. |
| `-log-lines` | `2000` | Lines kept from the end of each pod log and each unit's journal. |
| `-since` | `48h` | How far back each unit's journal is read. |
| `-server-logs` | off | Also collect the game servers' own logs, which contain player names, IP addresses and chat. |
| `-systemd-dir` | `/etc/systemd/system` | Where the installer's units are. |

- The archive is written with mode 0600. It never contains a Secret, a ConfigMap, the contents of a configuration file, the database or a world, and every value from the host's secret files is removed from what it collects.
- `MANIFEST.txt` inside the archive lists what it holds and what was removed. Read it before you send the bundle: redaction finds the host's known secrets and the common ways a secret is logged, and a secret logged in another way stays in.

**Root**: Required.

**Panel**: **Maintenance & Backups → Diagnostics → Support bundle**, downloaded through the browser.

**See also**: [Support bundle](/en/operations/monitoring#support-bundle).

## Backups and database {#backups-and-database}

### felis backup-now {#backup-now}

Archives the world of every user server, or of the named servers, one at a time, and waits for each archive.

```bash
sudo felis backup-now [-yes] [-stop] [server ...]
```

| Flag | Default | Description |
| --- | --- | --- |
| `-yes` | off | Back up. Without it the plan is printed and nothing changes. |
| `-stop` | off | Stop running servers first instead of backing them up live. Their players are disconnected and the servers stay stopped. |
| `-config` | `/etc/felis/felis.toml` | Configuration file. |

- A running server is backed up live: the game stops saving while its world is copied, and players stay connected.
- A server that is starting or stopping is skipped unless `-stop` is given.
- The login space and the lobby are not included.
- felis-api must be running: the backups are requested through its internal interface.

```bash
sudo felis backup-now                  # print the plan
sudo felis backup-now -yes             # back up every world, running ones live
sudo felis backup-now -yes survival    # back up one server
```

::: warning
`-stop` disconnects players and leaves the servers stopped. Start them again from the panel.
:::

**Root**: Required: the command reads the cluster's operations token.

**Panel**: **Maintenance & Backups → Backups → Back up worlds now**.

**See also**: [Backing up every world now](/en/operations/backup#backup-now).

### felis db {#db}

Backs up, verifies, lists, checks, deletes and restores the control-plane database bundles, and exports the audit log.

```text
felis db backup       [-config path] [-dir dir] [-label name] [-keep n] [-state-dir dir] [-no-servers] [-metrics-file path]
felis db restore      [-config path] [-dir dir] [-yes] [-force] [-no-safety-backup] <bundle>
felis db verify       [-dir dir] <bundle>
felis db delete       [-dir dir] <bundle>
felis db list         [-dir dir]
felis db check        [-dir dir] [-max-age 26h]
felis db audit-export [-config path] [-since date] [-until date] [-out file]
```

`-dir` is the bundle directory, `/var/lib/felis/db-backups` by default. `<bundle>` is a path, or the name of a bundle in that directory.

A bundle is one file named `felis-db-<UTC stamp>-<label>.tar` with a `.sha256` file beside it. It holds a dump of the database, every file in `/etc/felis` and every MinecraftServer object.

::: danger
A bundle contains every secret kept in `/etc/felis`. Protect bundles as you protect `/etc/felis` itself.
:::

| Verb | What it does |
| --- | --- |
| `backup` | Writes a new bundle. `-label` defaults to `manual`; manual bundles are never pruned. `-keep` sets how many bundles of the label are kept; the defaults are `daily` 14, `pre-migrate` 10, `pre-restore` 5 and `offsite` 1. `-state-dir` (default `/etc/felis`, `""` for none) is the host state included. `-no-servers` leaves the MinecraftServer objects out. `-metrics-file` names a node-exporter textfile rewritten on success. Exits with status 1 when the bundle was written without the MinecraftServer objects. |
| `restore` | Replaces every table of the database with the bundle's contents. Without `-yes` it prints what the bundle holds and stops. It first takes a `pre-restore` bundle of the current database unless `-no-safety-backup` is given, and refuses while other clients are connected unless `-force` is given. |
| `verify` | Checks a bundle's checksums and prints when it was taken, the Felis version, the schema version, the row counts and its members. |
| `delete` | Deletes a bundle and its `.sha256` file. The newest bundle cannot be deleted, as it is the latest restore point. A copy in the off-site bucket is not affected. |
| `list` | Lists the bundles with label, size and age. |
| `check` | Exits with status 1 when the newest `daily` bundle is missing or older than `-max-age` (default `26h`). |
| `audit-export` | Writes audit rows as JSON lines, oldest first. `-since` (inclusive) and `-until` (exclusive) take a day (`2026-01-31`, midnight UTC) or an RFC 3339 instant. `-out` names a file created with mode 0600 and never overwritten; without it, rows go to standard output. |

To restore a bundle:

```bash
sudo k3s kubectl -n felis scale deployment felis-api felis-operator --replicas=0
sudo felis db restore -yes felis-db-<stamp>-<label>.tar
sudo felis migrate up     # skip this when rolling back to the release that wrote the bundle
sudo k3s kubectl -n felis scale deployment felis-api felis-operator --replicas=1
```

::: warning
`db restore` replaces the whole database. The panel and the API are unavailable while felis-api is scaled down.
:::

`felis-db-backup.timer` runs `felis db backup -label daily` every day at `FELIS_DB_BACKUP_TIME`.

**Root**: Required: the bundle directory and the host configuration are root-only.

**Panel**: **Maintenance & Backups → Backups**: back up now, verify, restore and delete a bundle, set the daily backup schedule, export the audit log.

**See also**: [Database bundles](/en/operations/backup#database-backups), [Restoring the database](/en/operations/backup#restore-database), [Audit log](/en/guide/administration#audit-log).

### felis migrate up {#migrate}

Applies pending database migrations.

```bash
sudo felis migrate up [-config path] [-backup-dir dir] [-no-backup]
```

- Migrations run under a database lock and only move forward.
- When the database already holds data and a migration is pending, a `pre-migrate` bundle is written to `-backup-dir` (default `/var/lib/felis/db-backups`) first. If that bundle fails, nothing is applied. `-no-backup` skips the bundle.
- The installer runs this command on every run. Run it by hand after `felis db restore`, as that command prints.
- The verb `up` comes first, before any flag.

**Root**: Required.

**Panel**: Part of **Restore the database** on **Maintenance & Backups → Backups**.

## Off-site copy {#offsite-copy}

### felis offsite {#offsite}

Copies world archives, database bundles, user images and uploaded build contexts to an S3-compatible bucket, encrypted on the host, and fetches them back.

```text
felis offsite sync          [-config path] [-archive-dir dir] [-db-dir dir] [-registry host:port|off] [-uploads-dir dir] [-status-file path]
felis offsite status        [-config path] [-status-file path]
felis offsite list          [-config path]
felis offsite fetch-db      [-config path | -endpoint url -bucket name [-region r] [-prefix p]] [-dir dir] latest|<bundle>
felis offsite fetch-worlds  [-config path] [-archive-dir dir]
felis offsite fetch-images  [-config path] [-registry host:port] [-at version]
felis offsite fetch-uploads [-config path] [-uploads-dir dir] [-at version]
felis offsite check-key     [-config path]
felis offsite take-over     [-config path] [-status-file path] [-yes]
felis offsite keygen
```

Every verb except `keygen` reads the bucket credentials and the encryption key from the environment variables that `[offsite]` names (by default `FELIS_OFFSITE_ACCESS_KEY`, `FELIS_OFFSITE_SECRET_KEY` and `FELIS_OFFSITE_KEY`), and takes any that are unset from `-env-file` (default `/etc/felis/offsite.env`).

| Verb | What it does |
| --- | --- |
| `sync` | Runs one copy. `felis-offsite.timer` runs it every hour; to start one now, run `sudo systemctl start felis-offsite.service`. |
| `status` | Prints the bucket, the key id, the last attempt, last success and last error, what the bucket holds and what is waiting to be copied. Exits with status 1 when the copy is not configured, has never succeeded, last succeeded more than 12 hours ago, was refused on its last run, or this host stands by. |
| `list` | Lists the database bundles, image lists and upload lists in the bucket, newest first. |
| `fetch-db` | Downloads and decrypts a database bundle (`latest`, or a name from `list`) into `-dir` (default `/var/lib/felis/db-backups`). On a host without an install, give `-endpoint` and `-bucket` (and `-region` and `-prefix` when used) instead of a configuration file. |
| `fetch-worlds` | Fetches the world archives the database records into the archive volume, and reports those that have no copy in the bucket. |
| `fetch-images` | Pushes the user images back into the registry. `-at` selects an older registry index from `list`. |
| `fetch-uploads` | Restores the uploaded build contexts. `-at` selects an older uploads index from `list`. |
| `check-key` | Reports whether the key is the one the bucket's objects are sealed with, and writes nothing. Exits with status 3 when the objects are sealed with another key; `sync` then refuses to write or prune anything in the bucket. |
| `take-over` | Names the host that writes the bucket. Without `-yes` it writes nothing and exits with status 4 when another host writes the bucket and this one never did, or 5 when another host took the bucket over from this one. With `-yes` this host becomes the writer, and the other host stops copying at its next run. |
| `keygen` | Prints a new encryption key. |

::: danger
Keep the encryption key somewhere other than the host. The bucket holds only sealed objects, and without the key they cannot be read.
:::

**Root**: Required.

**Panel**: **Maintenance & Backups → Off-site copy**: configure, change or turn off the copy, copy now, list the bucket, check and show the key, take over the bucket.

**See also**: [Off-site copy](/en/operations/backup#offsite), [Off-site copy variables](/en/reference/configuration#offsite-variables).

### felis restore-host {#restore-host}

Rebuilds a freshly installed host from the off-site copy: the database, the user images, the uploads, the servers and each server's newest world.

```bash
sudo felis restore-host [-yes] [-bundle name] [-take-over] [-force]
```

With `-yes`, it runs these steps in order:

1. Fetch the newest database bundle from the bucket, or the one `-bundle` names.
2. Push the user images back into the registry and restore the uploads.
3. Restore the database over the fresh install's database and migrate it.
4. Bring the user servers back, stopped.
5. Fetch the world archives and restore each server's newest backup.
6. With `-take-over`, make this host the one that writes the bucket.

| Flag | Default | Description |
| --- | --- | --- |
| `-yes` | off | Rebuild. Without it the steps are printed and nothing changes. |
| `-bundle` | newest | A bundle name from `felis offsite list`. |
| `-take-over` | off | Make this host the bucket's writer once the rebuild is done. Leave it out on a rehearsal machine. |
| `-force` | off | Restore over an install that already holds servers. |
| `-dir` | `/var/lib/felis/restore-host` | Where the fetched bundle and the progress record are kept. |
| `-config` | `/etc/felis/felis.toml` | Configuration file. The bucket and its key come from its `[offsite]` settings. |

- Each finished step is recorded, so an interrupted run continues where it stopped. The database is restored once; a rerun never restores it over data written since.
- Without `-take-over`, this host stands by: it copies nothing into the bucket.
- Two tasks remain for the operator: pointing the domain at the new host (`felis domain set`) and bringing back the Cloudflare tunnel (`felis setup`). Passkeys registered on the old address stop working when the address changes; their users sign in with an email code and register a new passkey.
- The installer runs this command on its own when given `FELIS_RESTORE_FROM_OFFSITE=1`.

::: danger
The rebuild replaces this install's database. `-force` replaces an install that already holds servers.
:::

**Root**: Required.

**Panel**: **Maintenance & Backups → Off-site copy → Rebuild from the off-site copy**, which asks for a typed confirmation word.

**See also**: [Rebuilding a host](/en/operations/backup#rebuild-host), [Moving to another host](/en/operations/backup#move-host).

## Updates {#updates}

### felis update {#update}

Checks installed and available versions; with `--apply`, installs a reviewed Felis target.

```bash
sudo felis update [component selectors] [--version vX.Y.Z | --ref <commit-or-tag> | --dev] [--all]
sudo felis update --apply (--version vX.Y.Z --expect-commit <sha> | --ref <sha>) [--now] [--all] [--force]
```

- Without `--apply` the command changes nothing. It reports each component's installed and newest version and the maintenance window, resolves the Felis target, downloads and syntax-checks the target's installer, and prints the exact `--apply` command to run.
- `--apply` checks the maintenance window, backs up the database, `/etc/felis` and the MinecraftServer specifications, checks the window again, runs the target's installer and verifies the installed binary. A failed backup stops the update with nothing applied.
- Applying updates the felis binary, felis-api, felis-operator and the embedded panel, the platform manifests, Velocity and the Felis plugins, the login space and lobby images, and the release-pinned JRE and PostgreSQL. User server images stay pinned.

| Flag | Default | Description |
| --- | --- | --- |
| `--panel`, `--self`, `--velocity`, `--plugins`, `--k3s`, `--cloudflared`, `--jre`, `--postgres` | — | Narrow the report to these components. Applying always reconciles the whole platform bundle. |
| `--mc` | — | Report Minecraft only. A server's Minecraft version belongs to its image. |
| `--all` | off | Also include the release-pinned k3s and cloudflared upgrades. |
| `--version` | newest | A published stable release, such as `v0.2.0`. |
| `--ref` | — | An exact commit, tag or branch, built from source. |
| `--dev` | off | The newest `main` commit. |
| `--apply` | off | Apply the target. |
| `--expect-commit` | — | With `--apply`: refuse unless the target is this full 40-character commit SHA. |
| `--now` | off | With `--apply`: start one-off manual maintenance now instead of using the configured window. |
| `--force` | off | Reinstall the same version, or allow a requested downgrade. It bypasses no window, backup or compatibility check. |
| `--record` | off | Store the check for the panel's **Updates** tab. `felis-update-check.timer` runs it daily. |
| `--check` | on | Check only. |
| `--config` | `/etc/felis/felis.toml` | Host configuration for the maintenance window and the backup. |
| `--velocity-jar` | `/opt/felis/velocity/velocity.jar` | The installed Velocity jar. |

Only one of `--version`, `--ref` and `--dev` may be given. `--apply` cannot be combined with `--check` or `--record`. `FELIS_REPO_URL` names another repository and `FELIS_GITHUB_TOKEN` (a secret) gives access to a private fork; the printed apply command keeps both.

```bash
sudo felis update                     # newest stable release; installs nothing
sudo felis update --all               # also plan the pinned k3s and cloudflared upgrades
sudo felis update --version v0.2.0    # inspect a named release
sudo felis update --apply --version v0.2.0 --expect-commit <full-sha>   # as printed by the check
```

::: warning
Applying may restart felis-api, the game proxy and the system servers. Run it inside the maintenance window.
:::

**Root**: Required for `--apply`. Run the check with `sudo` too, so that it can read the maintenance window.

**Panel**: **Maintenance & Backups → Updates** shows the component versions, the maintenance window and the command to run. Applying stays on the command line.

**See also**: [Upgrading](/en/operations/upgrade#update), [Maintenance window](/en/operations/upgrade#maintenance-window), [Component versions](/en/operations/upgrade#component-versions).

## Domain and credentials {#domain-and-credentials}

### felis domain {#domain}

Moves the install to a new root domain, or checks every surface that carries the domain.

```bash
sudo felis domain set [-yes] <new-root-domain>
sudo felis domain check
```

- `set` moves every surface on the host that carries the root domain: the configuration files, the panel certificate, the cluster Secrets, the game proxy's `felis-link.properties` and the login space's settings. It then restarts what reads them. Without `-yes` it prints the plan: each surface, its new value and what the change costs.
- `check` prints one line per surface and exits with status 1 while any surface is behind. It also resolves the DNS names and compares the Cloudflare tunnel's hostnames with the new ones.
- `set` is safe to repeat: a second run changes only what is still behind.
- A panel or admin console hostname set by hand in `[auth]` keeps its value. The installer's self-signed certificate is reissued for the new names; an operator's own certificate that does not cover them stops the command before anything changes.
- After the move, `<root>`, `console.<root>`, `op.console.<root>` and `*.<root>` must resolve to the host, servers are reached as `<name>.<new root>`, everyone signs in again, and passkeys bound to the old panel hostname stop working. Rerun the Cloudflare step of `felis setup` when the panel is served through a tunnel.

::: warning
`domain set -yes` restarts felis-api and the game proxy, which disconnects every player.
:::

**Root**: Required.

**Panel**: **Platform settings → Access and security → Access and domain**.

**See also**: [Changing the root domain](/en/operations/access#change-domain).

### felis rotate-token {#rotate-token}

Replaces one credential the installer generated, and restarts what reads it.

```bash
sudo felis rotate-token [-yes] <credential>
```

| Credential | What it is | What restarts |
| --- | --- | --- |
| `velocity` | The game proxy's token for the internal API | felis-api. The proxy on this host reads the new token from its file and keeps its players; it is restarted only if it has not done so within 60 seconds. |
| `limbo` | The login space's token | felis-api and the login space pod; a player signing in at that moment reconnects. |
| `build` | The token build Jobs fetch their context with | felis-api; a build fetching its context at that moment fails and can be submitted again. |
| `ops` | The token `felis backup-now` presents | felis-api. |
| `registry` | The image registry's write tokens (platform, build, prune) | The registry and felis-api; a build pushing at that moment fails, and image pulls retry. |
| `forwarding` | The Velocity forwarding secret | Every running server (each saves its world) and the game proxy; everyone online is disconnected. A server whose world is held by a backup, restore or file operation keeps running, and players cannot join it until you stop and start it once that operation finishes. |
| `db` | The database role's password | felis-api; a backup, restore or file Job connecting at that moment fails and can be run again. Available only for the installer's felis-postgres. |

- The new value is written to `/etc/felis/secrets.env` first, so a later installer run applies it everywhere even if a later step fails. It then goes into the Secrets and files that carry it, and finally what read the old value restarts.
- Without `-yes` the command prints what would change and what that interrupts.
- When the game proxy runs on another host, the plan for `velocity` and `forwarding` names the value to copy there.

| Flag | Default | Description |
| --- | --- | --- |
| `-yes` | off | Rotate. Without it the plan is printed and nothing changes. |
| `-secrets-env` | `/etc/felis/secrets.env` | The installer's secrets file. |
| `-link-properties` | `/opt/felis/velocity/plugins/felis-link/felis-link.properties` | The game proxy's plugin settings (`velocity` only). |
| `-forwarding-secret` | `/opt/felis/velocity/forwarding.secret` | The game proxy's forwarding secret file (`forwarding` only). |
| `-config` | `/etc/felis/felis.toml` | Configuration file. |

::: warning
Rotating `forwarding` restarts every running server and disconnects every player.
:::

**Root**: Required.

**Panel**: **Platform settings → Access and security → Credential rotation**.

**See also**: [Rotating credentials](/en/operations/access#rotate-credentials).

## Servers {#servers}

### felis converge {#converge}

Fills in specification fields that newer releases added and that already installed servers lack.

```bash
sudo felis converge [-user-rcon] [-config path]
```

- It creates the login space or the lobby when either is missing, with the Secrets their pods mount, as `felis setup` creates them.
- For the login space and the lobby, it fills fields that are missing (such as `spec.rcon` and `spec.startup.healthHTTPPort`) and adds derived settings that are missing. A value that is already set is never overwritten.
- It gives every user server that has no idle setting the default idle stop: stop after 600 seconds without players.
- It lists the user servers that have no RCON. `-user-rcon` turns RCON on for them; the change applies at each server's next start.
- Run it after the images are in place, that is, after the installer has run. A server whose image does not open RCON stays in `Starting` after this change until it is marked `Failed`; check images that users brought before using `-user-rcon`.
- Exit status 1 when any server could not be updated.

**Root**: Required.

**Panel**: **Platform settings → Access and security → System server completion**.

### felis server-migrate {#server-migrate}

Moves a stopped user server's world to another approved node in distributed mode.

```bash
sudo felis server-migrate start  -name <server> -target-node <node>
sudo felis server-migrate status -name <server> [-id <operation-id>]
sudo felis server-migrate retry  -name <server> -id <operation-id>
sudo felis server-migrate abort  -name <server> -id <operation-id>
```

- The server must be stopped. The target node must be online, approved and not fenced; the controller can also be a target.
- The stages are `backing_up`, `restoring`, `switching` and `succeeded`. The server is not started after a successful migration; inspect the world and start it yourself.
- `abort` applies only to a failed operation that has not switched; the server stays on its source node.
- The command is refused while a node operation runs on the host. It prints the operation as JSON.
- This command is separate from `felis migrate`, which migrates the database.

**Root**: Required.

**Panel**: **Migrate world** on the server's page.

**See also**: [Migrating a stopped server](/en/guide/distributed#migrate-server).

## Nodes and high availability {#nodes-and-ha}

### felis node {#node}

Enrolls, approves and updates the nodes of a distributed deployment, and installs their host firewall.

```text
felis node list
felis node token    -name <node> -out <file> [-ttl 10m]
felis node join     -name <node> -server https://<controller>:6443 -token-file <file> -registry-ip <ip> -peers <cidrs> -external-ip <ip>
felis node approve  -name <node> -ssh-target <ssh-host> -image <felis-image>
felis node firewall -peers <cidrs> -controller-ip <address> [-controller] [-controller-peers <cidrs>] [-dry-run]
felis node upgrade
felis node join-controller
```

| Verb | Runs on | What it does |
| --- | --- | --- |
| `list` | Controller | Prints the execution nodes as JSON. |
| `token` | Controller | Writes a bootstrap token for one worker to a new root-only file and never prints it. `-ttl` defaults to `10m` and may be at most `1h`. |
| `join` | Worker | Joins this host as a worker through the installer's worker mode. The worker needs no server token, administrator kubeconfig, database or registry write credentials. |
| `approve` | Controller | Runs the admission checks over SSH; the SSH account needs `sudo -n`. A failed check keeps the node quarantined. Approval deletes the named cached image and pulls it again, so run it before the node has game workloads. |
| `firewall` | Every node | Installs the host isolation firewall for the given exact peer addresses (`/32` or `/128`). Add `-controller` on the controller; `-dry-run` prints the scripts without installing them. |
| `upgrade` | Worker | Started by the controller's node operations over SSH. Updates felis and k3s-agent to the controller's versions. |
| `join-controller` | New controller | Started by node operations. Joins the new controller to the cluster's embedded etcd. |

::: warning
`upgrade` restarts k3s-agent on the worker. Stop the servers on that node first.
:::

**Root**: Required.

**Panel**: **Platform settings → Distributed → Node operations**.

**See also**: [Adding workers](/en/guide/distributed#add-workers), [Network isolation](/en/guide/distributed#isolation).

### felis ha {#ha}

The host side of controller high availability: which controller runs the host's cluster-wide jobs, and moving the control plane's volumes to replicated storage.

```text
felis ha leader [-or-unreachable] [-q]
felis ha migrate-storage -node <node> -image <felis-image> [flags]
```

- `leader` exits with status 0 on the host leader and 1 elsewhere. The host leader is the controller that runs the PostgreSQL pod; on a single controller it is always that controller. Database backups, off-site copies, update checks and build tool mirroring run only on the leader, which their timers check with this command. `-or-unreachable` also exits with 0 when the cluster cannot be asked, so that the watchdog still runs and reports it. `-q` prints nothing.
- `migrate-storage` moves the database directory, the uploads, the registry, the world archives and the system servers' worlds, one at a time, to the replicated StorageClass `felis-replicated`, and keeps the original volumes. Progress is kept in `/var/lib/felis/ha-migrate`, so a rerun copies only what remains. The installer runs it when controller high availability is enabled; meanwhile the login space and the lobby pause and the panel is briefly unavailable.

**Root**: Required.

**Panel**: **Platform settings → Distributed → Node operations → Enable controller high availability**.

**See also**: [Controller high availability](/en/guide/distributed#controller-ha).

## Internal subcommands {#internal}

These subcommands are run by services, timers, Jobs or the installer. Operators do not run them in normal operation.

| Subcommand | Run by |
| --- | --- |
| `api` | The felis-api Deployment. |
| `operator` | The felis-operator Deployment. |
| `reaper` | The daily reaper CronJob: world cleanup and backup retention. |
| `watchdog` | `felis-watchdog.timer`, every two minutes; `felis-watchdog-failed.service` runs `watchdog -unit-failed`. `-dry-run` prints every finding and the mail that is due without sending anything. |
| `node-control` | `felis-node-control.service`, the host operations service the panel uses. |
| `nano` | `felis-nano.service` on a Felis-nano install. |
| `panel-settings` | The installer's summary: prints whether a mail relay and a heartbeat are saved in the panel (`yes` or `no`, never a value). |
| `mirror-build-tools` | `felis-build-tools.timer`: copies the build and scan tools and their databases into the registry. |
| `bootstrap-assets`, `pin-images`, `image-bundle`, `manifests` | The installer and release builds. |
| `apply` | Development: creates a MinecraftServer object directly, without its database records. |
| `backup`, `restore`, `stage-world`, `files`, `export`, `fetch-context`, `scan-gate`, `push-image` | Jobs and init containers the control plane creates. |
| `egress-gate`, `init-forwarding`, `init-volume`, `registry-gate`, `archive-serve`, `node-probe` | Init containers, sidecars and admission probes. |
| `ha copy-volume` | The copy Jobs of `felis ha migrate-storage`. |

### Scheduled runs {#scheduled-runs}

| Timer | Command | Schedule |
| --- | --- | --- |
| `felis-watchdog.timer` | `felis watchdog` | Every 2 minutes, from 3 minutes after boot |
| `felis-offsite.timer` | `felis offsite sync` | Hourly, with up to 10 minutes random delay |
| `felis-db-backup.timer` | `felis db backup -label daily` | `FELIS_DB_BACKUP_TIME` (default `*-*-* 03:30:00`), with up to 15 minutes random delay |
| `felis-update-check.timer` | `felis update --record` | Daily at 05:30, with up to 30 minutes random delay |
| `felis-build-tools.timer` | `felis mirror-build-tools` | 04:00 and 16:00, with up to 1 hour random delay |

In a controller high availability deployment, these timers run only on the host leader (see [`felis ha`](#ha)). The watchdog also runs on the other controllers while the cluster cannot be asked which controller leads, so that the failure is reported.
