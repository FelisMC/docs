---
title: Troubleshooting
description: Find the cause of a Felis problem from what you observe, confirm it and fix it.
---

# Troubleshooting {#troubleshooting}

This page helps operators diagnose and fix problems on a Felis host. Start with the first
steps, which show the state of the whole host, then go to the entry that matches what you
observe. Each entry describes the symptom, its causes, how to confirm the cause and how to
resolve it. Entries are grouped by area: servers, players and routing, the panel and
sign-in, the internal API, account linking, builds and images, the host, backups and the
database, mail, and files and schedules. The [quick reference](#quick-reference) at the end
maps common symptoms to entries.

::: info
Commands on this page run as root on the Felis host. `kubectl` commands use the copy that
ships with k3s (`sudo k3s kubectl …`), because the cluster's administrator credentials in
`/etc/rancher/k3s/k3s.yaml` are readable by root only. Game servers run in the `minecraft`
namespace and the control plane in the `felis` namespace.
:::

## First steps {#first-steps}

Before you look at a specific symptom, check the state of the whole host. The commands in
this section only read: they change nothing and send no mail, so they are safe to run at
any time. The Owner can run the same checks from the panel.

### Check the platform status {#check-status}

```bash
sudo felis status
```

`felis status` prints the platform at a glance: the release, the node and its kubelet, each
control-plane Deployment (ready replicas, image, restarts), the game proxy (the
`felis-velocity` unit and whether the game port accepts connections), every server with its
desired state, phase, players and newest world backup, the newest database bundle, the
off-site copy, disks and memory, and the alerts the watchdog has open.

A component that is down is reported as such and the rest still prints. With k3s stopped,
the cluster line reads `unreachable (...)` and the servers read
`unknown while the cluster is unreachable`. With PostgreSQL down, the backup column reads
`?` and a line below the table gives the reason.

### Run the health check {#run-doctor}

```bash
sudo felis doctor
```

`felis doctor` runs every check the watchdog runs, with the watchdog's own settings, and adds
what only the host shows: a Felis unit that failed, `k3s` or `felis-velocity` stopped, a
timer that no longer fires, alerts that reach no one (no mail relay, or no Owner with a
verified address) and an unusable heartbeat URL. It prints one line per area: `✓` fine, `!`
warning, `✗` critical, `-` not checked, with the reason. Each finding says where to look
next:

```text
✓  configuration
✓  Kubernetes cluster
✗  PostgreSQL
     critical postgres: PostgreSQL is unreachable: sign-in, the panel and server management fail
              → k3s kubectl -n felis get pods -l app.kubernetes.io/component=postgres; k3s kubectl -n felis logs deploy/felis-postgres --tail=100 (...)
-  off-site copy: not checked, not configured
...
1 problem(s): 1 critical, 0 warning(s)
```

The command exits with status 1 when it finds a problem and 0 otherwise, so scripts can use
it. It sends no mail and leaves the watchdog's state alone; the watchdog mails open alerts on
its own schedule. [Monitoring and alerts](/en/operations/monitoring#diagnostics) describes
every check.

### Create a support bundle {#create-support-bundle}

When you ask someone for help, attach a support bundle:

```bash
sudo felis support-bundle
```

The bundle is written to `/var/lib/felis/support/felis-support-<host>-<time>.tar.gz` with
mode 0600; `-o DIR` writes it to another directory. It contains the output of `felis status`
and `felis doctor`, a configuration summary without credentials, the Felis units and their
journals (`-since 48h` and `-log-lines 2000` by default), and the state, events and recent
logs of the control-plane, build and server namespaces. Game server logs contain player
names, IP addresses and chat; the bundle includes them only with `-server-logs`.

Secrets, ConfigMaps, configuration file contents, the database and worlds are never
collected, and credentials are removed from everything that is collected. `MANIFEST.txt` in
the bundle lists what it holds, what was removed and what could not be collected.

::: warning
Read the bundle before you send it anywhere. A secret written in a format the redaction
rules do not recognise stays in the bundle.
:::

See [Support bundle](/en/operations/monitoring#support-bundle) for the full contents.

### Find the logs {#logs}

| Component | Command |
| --- | --- |
| Panel and API (`felis-api`) | `sudo k3s kubectl -n felis logs deploy/felis-api` |
| Operator (server lifecycle) | `sudo k3s kubectl -n felis logs deploy/felis-operator` |
| Database | `sudo k3s kubectl -n felis logs deploy/felis-postgres` |
| A game server | `sudo k3s kubectl -n minecraft logs <server>-0`, or the server's console in the panel |
| Login space and lobby | `sudo k3s kubectl -n minecraft logs login-0`, `sudo k3s kubectl -n minecraft logs lobby-0` |
| Game proxy (Velocity) | `sudo journalctl -u felis-velocity` |
| Watchdog | `sudo journalctl -u felis-watchdog` |
| Host operations started from the panel | `sudo journalctl -u felis-node-control` |
| k3s | `sudo journalctl -u k3s` |

Add `--tail=200` to `kubectl logs`, or `-n 200` to `journalctl`, to read only the most recent
lines.

### Use the panel {#panel-diagnostics}

The Owner can run the same checks without a shell:

- **Maintenance & Backups → Status** shows the host status (`felis status`) and the
  watchdog's open alerts.
- **Maintenance & Backups → Diagnostics** contains the **Health check** card
  (`felis doctor`; select **Run health check**) and the **Support bundle** card
  (`felis support-bundle`; select **Create support bundle**, and enable
  **Include game server logs** only when the problem concerns a server). The bundle
  downloads through the browser.

Each host task requires a fresh identity verification and is recorded in the audit log, and
only one host task runs at a time. When the panel cannot reach the host, for example because
`felis-node-control` is down, use the commands above.
[Running host operations from the panel](/en/operations/#panel-host-operations) lists every
operation and its command-line equivalent.

## Platform services are not running {#services-down}

When the platform did not fully come back after a reboot, or `felis status` or `felis doctor`
shows units such as k3s or the game proxy not running, run:

```bash
sudo felis start
```

It starts the cluster and waits for the node to be Ready, then starts the other services and
timers set to start at boot, then waits for every control plane Deployment to be ready, and
prints the outcome of each. Services already running are left alone. If a part still does not
come up, read its logs with the command the output gives; see [felis start](/en/reference/cli#start).

## Servers {#server-problems}

### A server stays in Starting {#server-stuck-starting}

The panel shows **Starting** for a long time, or players wait in the lobby and are never
moved to the server.

A short period in **Starting** is normal. A start that does not succeed is checked again
every 2 seconds until one of two time limits runs out; the server then moves to
**Failed to start** (see [A server shows Failed to start](#server-failed)). A server that was
**Running** returns to **Starting** after three consecutive failed readiness checks.

**Cause**

The readiness check is an RCON connection and login: the server counts as ready as soon as
RCON accepts its password. The operator records why a server is not ready yet as the reason
of its conditions:

| Reason | Meaning | Checked again after |
| --- | --- | --- |
| `PodNotReady` | The game pod has not opened its game port yet | 2 s |
| `SpecChanged` | The server's settings changed while the pod was not ready; the operator recreated the pod from the new settings | 2 s |
| `AutoRestart` / `StartRetried` | A timed-out start was retried, automatically or with **Retry start**, by recreating the pod | 2 s |
| `ServiceAddressPending` | The server's Service has no cluster address yet | 2 s |
| `RconSecretUnavailable` | The Secret holding the RCON password is missing or lacks the referenced key | 10 s |
| `RconNotReachable` | The RCON check could not connect or log in | 2 s |

**Diagnosis**

1. Open the server's console in the panel. While the server starts, the console shows the
   current stage (**Waiting for resources and scheduling**, **Preparing files and pulling
   images**, **Starting Minecraft and checking readiness**) and, when something blocks the
   start, the reason: insufficient schedulable memory, an image pull failure or a container
   exit.
2. Read the condition reason and message:

   ```bash
   sudo k3s kubectl -n minecraft get minecraftserver <server> -o jsonpath='{.status.conditions}'
   ```

3. For `PodNotReady`, inspect the pod and its log:

   ```bash
   sudo k3s kubectl -n minecraft describe pod <server>-0
   sudo k3s kubectl -n minecraft logs <server>-0
   ```

4. If the server stays in **Starting** longer than its time limit and never moves to
   **Failed to start**, the operator is not processing it. Read the operator log:

   ```bash
   sudo k3s kubectl -n felis logs deploy/felis-operator --tail=200
   ```

**Resolution**

For `PodNotReady`, act on what `describe pod` shows:

| What you see | Cause | Resolution |
| --- | --- | --- |
| Pod `Pending` with an `Unschedulable` or insufficient-memory event | The node has too little free memory | Lower the server's memory, stop other servers, or add capacity |
| `ImagePullBackOff` or `ErrImagePull` | The image reference is wrong, the tag does not exist, or the registry is unreachable | Correct the image; see [game images](#game-images) and [registry errors](#registry-errors). Editing the server is enough, even after it failed: the operator replaces the stuck pod, and the server returns to **Starting** with reason `SpecChanged`, a fresh time limit and its retry count reset |
| Volume claim `Pending` (`sudo k3s kubectl -n minecraft get pvc`) | The storage class does not exist, or no class can provide the requested size | Correct the storage class or the size |
| The container restarts before the game port opens | The server software, its plugins or its start script fail | Read the container log and fix the server's configuration, plugins or image |
| Stuck in an `Init:` step, or `AccessDeniedException` / `Permission denied` in the log | Game servers run as uid and gid 1000 with all capabilities dropped. Before each start, the `prepare-data` init container hands world files to 1000:1000 | Read `sudo k3s kubectl -n minecraft logs <server>-0 -c prepare-data`: it reports how many entries it changed and lists up to 20 it could not change. An image that writes outside `/data` and `/tmp` must be rebuilt to keep its state under `/data` |
| Every start waits about 30 seconds in its last `Init:` step | The `egress-gate` init container waits until the server's network fence is in effect | Read `sudo k3s kubectl -n minecraft logs <server>-0 -c egress-gate`. `is unreachable after …; the egress lock is in effect` is the normal result. `still answers after 30s; starting anyway` means network policies are not enforced (a CNI without NetworkPolicy support, or k3s started with `--disable-network-policy`), or an allowed private range for game servers (`--server-egress-allow-cidr`) covers the node. Narrow the range to the hosts the servers need |
| `FailedCreate … violates PodSecurity "baseline"` | The `minecraft` namespace enforces the `baseline` Pod Security profile, and the refused pod was created or edited outside Felis | Run `sudo k3s kubectl get events -n minecraft --field-selector reason=FailedCreate` to see the offending field, and remove that change |

For `RconSecretUnavailable`, the message names the problem:

- `rcon.secretRef.name and .key are required when rcon is enabled`: RCON is enabled, but the
  Secret name or key in `spec.rcon.secretRef` is empty.
- `secret "<name>" has no key "<key>"`: the Secret exists but lacks the key.

Create the Secret with the referenced key, or correct `spec.rcon.secretRef`. The operator
provisions a Secret named `<server>-rcon` for servers that Felis created with RCON. Confirm
that the key holds a value:

```bash
sudo k3s kubectl -n minecraft get secret <secret> -o jsonpath='{.data.<key>}' | base64 -d | wc -c
```

For `RconNotReachable`, the message is the connection error:

- `rcon: authentication failed`: the password in the Secret differs from the server's
  `rcon.password`. Make the two match.
- `connection refused` or `i/o timeout`: the server has not opened its RCON port yet, RCON is
  disabled in `server.properties`, or the image listens on a port other than 25575, the only
  port `spec.rcon.port` accepts.

Each RCON check has a fixed 5-second timeout. The time limit for the whole start is a
separate setting (see [A server shows Failed to start](#server-failed)).

If the operator is not processing the server, restore the operator first; see
[Monitoring and alerts](/en/operations/monitoring#alerts) for the related alerts.

### A server shows Failed to start {#server-failed}

The panel shows **Timed out · retrying** or **Failed to start**. A player who tries to join
reads `« <server> » failed to start and its automatic retries are spent. The owner can check
its log in the panel and start it again.` The watchdog reports user servers that failed.

**Cause**

| Reason | Meaning |
| --- | --- |
| `StartupTimeout` | The pod did not open its game port within `spec.startup.timeoutSeconds` (default 300 seconds) |
| `ReadinessTimeout` | RCON did not accept the password within `spec.startup.readinessTimeoutSeconds` (default 300 seconds) |
| `InvalidSpec` | The server's workload could not be built, usually because `spec.storage.size` is not a valid quantity: `invalid storage size "<value>": <parse error>` |

Both time limits are measured from the moment the start was requested, and both use 300
seconds when they are unset or 0.

After a timeout, the operator retries the start by recreating the pod, up to 3 times. It
waits 1, 2 and then 4 minutes after the time limit before each attempt. Meanwhile the panel
shows **Timed out · retrying** with the number of retries used, and players who join are
queued for the coming attempt. When the retries are spent, or for `InvalidSpec`, the server
stays in **Failed to start** until someone acts; a join does not start another attempt.

**Diagnosis**

1. Open the server's console in the panel and read the startup log and the reported error.
2. Read the conditions:

   ```bash
   sudo k3s kubectl -n minecraft get minecraftserver <server> -o jsonpath='{.status.conditions}'
   ```

3. For a timeout, work through [A server stays in Starting](#server-stuck-starting): the
   causes are the same, and the time limit ran out before they were fixed.

**Resolution**

1. Fix the cause: the image, the memory, the configuration or RCON.
2. Select **Retry start** on the server's console. This resets the retry count and starts the
   server again at once. Editing the server's settings also replaces a stuck pod.
3. For `InvalidSpec`, set `spec.storage.size` to a valid quantity such as `10Gi` (`10 GB` is
   invalid). The server leaves the failed state at the next reconcile.
4. For a server that starts correctly but needs more than 300 seconds, such as a large
   modpack, raise `spec.startup.timeoutSeconds` and `spec.startup.readinessTimeoutSeconds` on
   the server resource.

### A server stopped after crashing {#server-crash-stopped}

The console page shows **The server kept crashing and is no longer restarted** or **The server stopped after a crash**. A player who tries to join is told the server failed to start, and joining does not wake it. For the restart rules, see [Crashes and host restarts](/en/guide/servers#recovery).

**Troubleshooting**

1. Read the cause of the latest crash in the notice and in the **Activity** list on the console page.
2. For **Out of memory; the process was killed**, raise the memory under **Edit Server Config**, or reduce what uses it, such as plugins, mods and view distance.
3. For another exit code, select **Wake** and watch the log in the console for the error. Common causes are incompatible plugins or mods, broken configuration files and damaged world data.
4. Once it is fixed, select **Wake**; the crash count starts over.

### A server does not stop {#server-wont-stop}

After **Stop**, the server stays **Running** or **Stopping**, or the panel shows
**Status unavailable**.

**Cause**

- **Players are online.** Before a server with players stops, the operator sends everyone
  online a yellow chat warning, waits 30 seconds, sends a last notice and then stops the
  server, which saves the world. Starting the server again within the 30 seconds cancels the
  stop, and the players are told so. An empty server, a server without RCON, or a server
  whose player count or warning fails stops at once.
- **A live backup is copying the world.** The operator waits for the copy to finish before
  it shuts the server down, for at most about six minutes.
- **The game is saving.** The server shows **Stopping** until its pod has exited, which takes
  longer for a large world.
- **The panel cannot reach the control API.** The console marks the state as
  **Status unavailable**, shows when it was last read and retries on its own. The state shown
  is for reference only; a server shown as starting or running is no proof that its game
  process is healthy.
- **The game process or the operator does not respond**, so the normal stop never completes.

**Diagnosis**

```bash
sudo k3s kubectl -n minecraft get minecraftserver <server> -o jsonpath='{.spec.desiredState} {.status.phase}{"\n"}'
sudo k3s kubectl -n minecraft get pods -l felis.lolicon.best/server=<server>,felis.lolicon.best/component=server -o wide
sudo k3s kubectl -n minecraft get events --field-selector involvedObject.name=<server>
```

A `StopNotice` event means the 30-second warning is running.

**Resolution**

1. Wait for the warning period and the shutdown save. **Stopping** changes to **Stopped**
   once the pod is gone.
2. If the normal stop does not respond, the Owner selects **More actions → Emergency stop** on
   the server's console, types the server's name and confirms their identity. Emergency stop
   saves the stop intent (`desiredState=Stopped`) and then scales the server's StatefulSet to
   zero, bypassing the game's RCON and the operator. The normal termination grace period
   applies and no world is deleted, but changes the game has not saved may be lost. The panel
   shows **Stopping** while the replica target is above zero or the game pod is still running
   or exiting. If the scale-down fails, the stop intent stays saved and the panel reports the
   result as unconfirmed.
3. If the control API itself is offline, expand **Host emergency shutdown procedure** on the
   console page and run its commands on the host in order. Replace `minecraft` if the
   deployment uses another namespace:

   ```bash
   sudo k3s kubectl patch minecraftserver <server> -n minecraft --type=merge -p '{"spec":{"desiredState":"Stopped"}}'
   sudo k3s kubectl scale statefulset <server> -n minecraft --replicas=0
   sudo k3s kubectl get pods -n minecraft -l felis.lolicon.best/server=<server>,felis.lolicon.best/component=server -o wide
   ```

4. If the node is offline, check the node and its container runtime. While a pod is
   terminating or its node is unreachable, the game process may still be running.
5. If the emergency stop fails with a permission error, apply the current platform update,
   which installs the permissions it needs (see [Upgrading](/en/operations/upgrade#update)).

::: danger
Do not resolve a lost control connection by force-deleting worlds, pods or volume claims.
Force-deleting a pod is no evidence that the game process has exited.
:::

### A server does not stop when empty {#idle-stop}

Servers created from the panel stop after 600 seconds with nobody online, and the next join
wakes them. The login space and the lobby never stop when idle. A server that keeps running
with nobody online, or whose player count always shows 0, has one of the causes below.

**Cause**

- Idle auto-stop is set to **Never** in **Edit Server Config → Idle auto-stop**.
- The server was created before idle auto-stop became the default and has no idle setting.
- RCON is off on the server. The player count comes from the RCON readiness check, which runs
  `list`; without RCON the count is never read and stays at 0, and idle auto-stop never acts.
- The server's `list` reply has a format Felis does not recognise, such as a plugin that
  rewrites `/list` or a translated reply. A count that cannot be read counts as unknown,
  never as zero: the server keeps running, the panel shows **The online player count could
  not be read. Idle shutdown is paused until player count retrieval resumes.**, and the
  `PlayersCounted` condition is `False` with reason `ListUnreadable`.
- The server became ready less than 3 minutes ago. A zero count in that window starts no
  countdown, so the server does not stop while players are still arriving.
- A live backup is copying the world. The operator does not idle-stop a server during the
  copy.

**Diagnosis**

```bash
sudo k3s kubectl -n minecraft get minecraftserver <server> -o jsonpath='{.spec.idle}{"\n"}{.spec.rcon.enabled}{"\n"}'
sudo k3s kubectl -n minecraft get minecraftserver <server> -o jsonpath='{.status.conditions[?(@.type=="PlayersCounted")]}'
```

Run `list` in the server's console in the panel to see the reply. Felis reads these formats:

- `There are 3 of a max of 20 players online` (vanilla, Paper, Fabric, Forge)
- `There are 3/20 players online` (1.12 and Bukkit)
- `There are 3 out of maximum 20 players online` (EssentialsX)

**Resolution**

1. Set **Idle auto-stop** in **Edit Server Config** to a duration between 1 minute and 24
   hours.
2. For servers created before idle auto-stop or RCON became defaults, run system server
   completion: `sudo felis converge` gives servers without an idle setting the default of 600
   seconds, and `sudo felis converge -user-rcon` turns RCON on for older user servers. Read
   [System server fields](#system-server-fields) before you enable RCON: a server whose image
   has no RCON listener then fails to start.
3. Restore a supported `list` reply, for example by removing the plugin's override or its
   translation of that message.

### An operation reports that the world is busy {#world-busy}

A wake, restore, backup, download or file change is refused with
`409 maintenance_in_progress`, and the panel shows **The world is undergoing restoration,
backup, export, file download, file modification, or reclamation. Retry after the operation
completes. Exports and downloads remain active until the browser completes the transfer.**
Or the panel shows **Stop the server completely before performing this operation.** (`409 not_stopped`).

**Cause**

Only one operation at a time may hold a server's world. A restore, a backup, a world download
or a file change holds it until its Job finishes; reading and listing files never hold it.
While the world is held, every wake (from the panel or from a join) and every other world
operation on that server is refused. The operator applies the same rule: it does not start
the server, and the `Ready` condition reads `MaintenanceInProgress` until the Job ends.

The world is held by one of these:

1. An unfinished Job for the server: a restore, a backup, a file change, or a world download
   until the download ends.
2. The admission lock `felis.lolicon.best/maintenance=<kind>@<time>` on the server, which
   covers the moment between admitting an operation and creating its Job. If felis-api stops
   in between, the lock lapses after at most two minutes, and the next wake clears it.
3. World cleanup while it archives an idle world. It writes the same lock as `reap@<time>`
   and renews it every 30 seconds; refusals name `the idle-world reaper`, and a join-driven
   wake gets `409 world_reclaiming`.

`409 not_stopped` while the panel already shows **Stopped** means the game pod is still
shutting down and saving.

**Diagnosis**

```bash
sudo k3s kubectl -n minecraft get jobs -l felis.lolicon.best/server=<server>
sudo k3s kubectl -n minecraft get minecraftserver <server> -o jsonpath='{.metadata.annotations}'
sudo k3s kubectl -n minecraft get pods -l felis.lolicon.best/server=<server>
```

The server's **Backups & restore** page also lists recent backup, restore and export jobs
with their result.

**Resolution**

1. Wait for the Job to finish. A Job that is truly stuck is ended by its own time limit
   (`activeDeadlineSeconds`).
2. To release the world at once, delete the Job:

   ```bash
   sudo k3s kubectl -n minecraft delete job <job>
   ```

   ::: warning
   Deleting a Job discards whatever it was writing.
   :::

3. To remove a stale admission lock:

   ```bash
   sudo k3s kubectl -n minecraft annotate minecraftserver <server> felis.lolicon.best/maintenance-
   ```

   Removing a `reap@` lock also cancels that cleanup run: world cleanup keeps the world and
   tries again the next day (see [World cleanup](/en/operations/backup#world-cleanup)).
4. For `not_stopped`, retry once the pod list for the server is empty.

### The login space or the lobby is missing {#system-servers-missing}

**Cause**

- The setup wizard creates the login space and the lobby. An installation whose wizard never finished, or whose system servers were deleted, has neither, and players cannot get past the game proxy.

**Diagnosis**

The **Login & lobby** page reports that the login space or the lobby does not exist. On the host:

```bash
sudo k3s kubectl -n minecraft get minecraftservers login lobby
```

**Resolution**

1. As the Owner, select **Create again** on the **Login & lobby** page. The same task runs from **Platform settings → Access and security → System server completion**.
2. Alternatively, run on the host:

   ```bash
   sudo felis converge
   ```

The missing servers are created from the images configured at installation and start on their own.

## Players and routing {#player-problems}

### Players cannot join {#players-cannot-join}

Every new connection passes through the game proxy (Velocity) and the login space, then
reaches the lobby or the target server according to the player entry policy. A failure at
any of these steps keeps players out.

**Cause**

| What the player sees | Cause |
| --- | --- |
| The connection fails or times out | The game proxy is not running, or the game port is unreachable |
| `Finish signing in before joining a server.` | The player has not completed sign-in in the login space |
| `Login verification is temporarily unavailable. Please try again shortly.` | The proxy cannot reach felis-api |
| `The lobby is unavailable right now. Try again shortly.` | The lobby is not running or not registered with the proxy |
| `Starting « <server> » — you'll be moved in automatically.`, and the move never happens | The server does not become ready; see [A server stays in Starting](#server-stuck-starting) |
| A message that the server cannot be started | The wake was refused; see [Waking a sleeping server is refused](#wake-refused) |
| The player lands in the lobby instead of the server, or the connection is rejected | Routing is disabled, or the player entry policy sends the connection elsewhere |

Players see these messages in Chinese or English, following their game language. A player
waiting for a server hears a progress line every minute. The proxy drops a waiting
player after 120 seconds without an answer from felis-api, and after one hour in any case.

**Diagnosis**

1. Run `sudo felis status` and read the game proxy line (the `felis-velocity` unit and
   whether the game port accepts connections) and the state of the login space and the lobby.
2. Read the proxy's state and log:

   ```bash
   sudo systemctl status felis-velocity
   sudo journalctl -u felis-velocity -n 200
   ```

3. Look for the line `Felis routing ready: rootDomain=…, login=…, lobby=…`. A line starting
   with `Felis routing DISABLED` leads to [Routing is disabled](#routing-disabled).
4. `server list refresh failed` or `server list refresh still failing` in the proxy log means
   the proxy cannot reach felis-api; see [internal API errors](#internal-api-errors).
5. Check the login space and the lobby:

   ```bash
   sudo k3s kubectl -n minecraft get minecraftserver login lobby
   ```

6. Check the player entry policy in **Platform settings → Player entry**.

**Resolution**

1. If the proxy is not running, start it with `sudo systemctl restart felis-velocity`. If it
   keeps failing, read its journal. Long garbage-collection pauses or `OutOfMemoryError` call
   for a larger heap: raise **Heap ceiling** on the **Game proxy** card in
   **Platform settings → Access and security**. The proxy restarts and disconnects all
   players.
2. If players have not completed sign-in, they follow the steps in
   [Player access](/en/guide/players#joining) and link their account.
3. If the proxy cannot reach felis-api, restore felis-api (see [The panel shows an
   error](#panel-errors)) and the internal API (see [internal API errors](#internal-api-errors)).
4. If the login space or the lobby is not running, treat it like any server: see
   [A server stays in Starting](#server-stuck-starting) and
   [A server shows Failed to start](#server-failed).
5. Review the player entry policy (see [Player entry policy](/en/guide/players#entry-policy)).
   With **Route by hostname** and no default destination, connections that require web
   sign-in enter the lobby and other connections are rejected. Saved changes reach the proxy
   within 15 seconds and apply to new connections.

### Waking a sleeping server is refused {#wake-refused}

When a player joins a stopped server, the proxy holds the player and asks felis-api to wake
the server. felis-api checks, in order, the server's autostart policy, the per-server wake
cooldown and the running-server limit. A server counts as ready only when the operator's RCON
check succeeds; the proxy polls the server's status every 2 seconds and moves the player when
it is ready.

**Cause and resolution**

| Answer | The player sees | Cause | Resolution |
| --- | --- | --- | --- |
| `403 forbidden` | `You're not allowed to start « <server> ».` | The autostart policy is **Owner only** and the player is not the owner, or **Wake list** and the player has no wake permission | Grant the player wake permission on the server's **Wake list**, have the owner start the server, or change the policy in **Edit Server Config** (see [Autostart](/en/guide/servers#autostart)) |
| `409 maintenance_in_progress` | `« <server> » is under maintenance (restore, backup or file edit). Please try again shortly.` | Another operation holds the world | Wait for it to finish; see [An operation reports that the world is busy](#world-busy) |
| `409 world_reclaiming` | `« <server> » sat idle too long and its world is being archived, so it can't start.` | World cleanup is archiving the idle world; afterwards the server is released with an empty world | The old world stays in the archive; see [World cleanup](/en/operations/backup#world-cleanup) |
| `409 server_retiring` | `« <server> » has been given up or is being deleted, so it can't be started.` | The owner gave the server up or an admin is deleting it; it stays down until the next daily cleanup run | Cancel the request in the panel to make the server startable again |
| `409 start_failed` | `« <server> » failed to start and its automatic retries are spent.` | The last start failed and its automatic retries are spent | See [A server shows Failed to start](#server-failed) |
| `429 cooldown` | No message; the player keeps waiting | A wake for this server is already under way | None |
| `503 at_capacity` | `The cluster is at capacity right now — « <server> » can't start. Please try again later.` | The running-server limit is reached | Stop another server, or raise the limit |
| Any other answer | `Couldn't start « <server> » right now. Try again shortly.` | The proxy logs `Felis: wake <server> failed (status=…)` | Read the proxy log; see [internal API errors](#internal-api-errors) |

The Owner sets the running-server limit and the wake cooldown on the
**Startup and wake policy** card in **Platform settings → Player entry**:

- **Running server limit (0–10000)**: 0 means unlimited. The limit applies to panel starts,
  in-game wakes and scheduled starts; system services can always start. It is checked when a
  start is admitted, so concurrent requests can exceed it briefly, and lowering it does not
  stop running servers. Available memory still decides whether Kubernetes can schedule a
  server.
- **Wake cooldown (0–3600 seconds)**: the minimum interval between accepted wake requests for
  the same server; 0 disables the cooldown.

Saved values apply on all API replicas without a restart.

### Routing is disabled {#routing-disabled}

Players can connect, but servers are not reached by their hostname and no server wakes when
someone joins. The proxy log contains one of these lines:

```text
Felis routing DISABLED: the proxy is in offline mode (online-mode=false). Domain autostart and the allowlist trust Mojang-verified UUIDs; refusing to route on spoofable identities. /link remains available. Set online-mode=true to enable routing.
```

```text
Felis routing DISABLED: no root-domain configured. Add 'root-domain=' to felis-link.properties (or set FELIS_ROOT_DOMAIN) to enable host-based routing. /link remains available.
```

**Cause**

- Wakes, claims and the wake list trust Minecraft identities that Mojang verified. A proxy in
  offline mode would accept forged identities, so the Felis plugin refuses to route.
  Server-side settings such as the autostart policy cannot make an offline proxy safe; the
  proxy is where this is enforced.
- The plugin has no root domain, so it has no hostnames to route by.

In both cases `/link` keeps working.

**Diagnosis**

```bash
sudo journalctl -u felis-velocity | grep 'Felis routing'
sudo grep -n 'online-mode' /opt/felis/velocity/velocity.toml
sudo grep -n 'root-domain' /opt/felis/velocity/plugins/felis-link/felis-link.properties
```

**Resolution**

1. Re-run the installer (see [Installation](/en/guide/deployment#install)). The installer
   manages both files: it writes `online-mode = true` to `velocity.toml` and the root domain
   to `felis-link.properties`, and restarts the proxy when they change. Restarting the proxy
   disconnects all players.
2. For a proxy on another host, set `online-mode = true` in its `velocity.toml` and
   `root-domain=<root domain>` in its `felis-link.properties` (or the `FELIS_ROOT_DOMAIN`
   environment variable), then restart it.
3. Confirm that the proxy log shows `Felis routing ready`.

If the root domain itself has changed, follow [Changing the root
domain](/en/operations/access#change-domain).

## Panel and sign-in {#panel-problems}

### The panel shows an error {#panel-errors}

The API answers errors with a code and a message (`{"error":{"code","message","request_id"}}`),
and the panel shows a translated message for common codes.

**Cause**

| Panel message | Answer | Cause |
| --- | --- | --- |
| **The session has expired. Sign in again.** | `401 unauthorized` | No valid session. Sessions last 12 hours; staff sessions also end after 30 minutes without activity. Signing out on another device or revoking the session ends it too |
| **The current account is not authorized to perform this operation.** | `403 forbidden` | The account's role does not allow the action, or an admin action was requested outside the operator console (see [Admin pages return 403](#admin-console-forbidden)) |
| **This operation requires recent identity verification. Verify identity again using a Passkey or email code.** | `403 reauth_required` | Sensitive operations require an identity verification within the last 5 minutes |
| **The sign-in service is currently unavailable.** | `503 auth_unavailable` | The session store, PostgreSQL, is unreachable |
| **The service is currently unavailable. Retry later.** | `5xx` | felis-api, or a component behind it, is down or restarting |
| **The operation failed because of an internal server error. Ask an admin to check the logs. Request ID: …** | `500 internal` | An unexpected error; the details are only in the felis-api log |
| **Unable to connect to Felis. The network may be unavailable or the Cloudflare Access session may have expired. …** | No answer | The browser cannot reach the panel, or the Cloudflare Access session has expired |
| **Host node service is unavailable. Inspect felis-node-control.service on the controller.** | `503 node_control_unavailable` | The service that runs host operations is down |
| **Node maintenance is running. Server starts and additional node tasks are temporarily blocked.** | `409 node_operation_busy` | A host or node task is running. Only one runs at a time, and while a task that takes the control plane away runs (a database restore, a host rebuild, a credential rotation, a domain move), server starts are refused |

**Diagnosis**

1. For an internal error, search the felis-api log for the request ID shown in the panel.
   The log line has the form
   `api: <METHOD> <path>: unmapped error (request_id=<id>): <error>`:

   ```bash
   sudo k3s kubectl -n felis logs deploy/felis-api | grep '<request-id>'
   ```

2. For an unavailable service, check the control plane:

   ```bash
   sudo felis status
   sudo k3s kubectl -n felis get pods
   ```

3. For host operations, check the host service:

   ```bash
   sudo systemctl status felis-node-control
   sudo journalctl -u felis-node-control -n 100
   ```

**Resolution**

- **Session expired**: sign in again. Sessions belong to one hostname, so signing in on the
  operator console does not sign you in on the player console.
- **Not authorized**: use an account with the required role (see
  [Roles](/en/guide/administration#roles)), or open the operator console as described in
  [Admin pages return 403](#admin-console-forbidden).
- **Identity verification**: confirm with a passkey or an email code, then repeat the action.
- **Sign-in service unavailable**: restore the database; see
  [The database is unavailable](#database-unavailable).
- **Service unavailable or internal error**: read the felis-api log, and run `sudo felis
  doctor` for the state of every component.
- **Unable to connect**: reload the page; behind Cloudflare Access, sign in to Access again.
  See [Access methods](/en/operations/access#access-methods) for how the panel is reached.
- **Host node service unavailable**: restart it with
  `sudo systemctl restart felis-node-control`.
- **Node maintenance is running**: wait for the running task to finish. Its stage and log
  are shown in the panel where it was started.

### Admin pages return 403 {#admin-console-forbidden}

A staff account is signed in, but admin pages and actions answer
**The current account is not authorized to perform this operation.**

**Cause**

Felis recognises the operator console by the request's hostname: `admin_hostname`, by
default `op.console.<root domain>`. A bare IP address counts as the operator console only
when the installation names it: the address embedded in a `<ip>.nip.io` or `<ip>.sslip.io`
root domain (the local panel address `felis setup` prints), or an `admin_hostname` set to
that address. Any other address, loopback included, is served as the player console. A staff
account that opens `https://127.0.0.1:30443` through an SSH tunnel therefore gets 403 on
admin routes.

On the operator console itself, every request from an account without a staff role is
refused with 403.

**Diagnosis**

Compare the hostname in the browser's address bar with the **Admin console hostname** field
on the **Access and domain** card in **Platform settings → Access and security**.

**Resolution**

1. Open the operator console by its hostname. Through an SSH tunnel, add an `/etc/hosts`
   entry on your computer that points the hostname at the tunnel's local address, or use
   `curl --resolve` for scripted calls.
2. Alternatively, set `admin_hostname` in the `[auth]` section of the configuration to the IP
   address you use (see [Configuration reference](/en/reference/configuration#felis-toml)).

### Sign-in fails {#sign-in-problems}

**Cause and resolution**

| Message | Answer | Cause | Resolution |
| --- | --- | --- | --- |
| **Owner account not initialized; sign-in unavailable** | — | No Owner exists yet | Run `sudo felis setup` on the host and open the one-time setup link it prints (see [Setup wizard](/en/guide/deployment#setup-wizard)) |
| **The setup link is invalid or has already been used** | — | The one-time setup link expired or was used | Run `sudo felis setup` again to get a new link |
| **Local sign-in is disabled in this deployment. Access the console through the organization's secure entry point.** | `403 local_auth_disabled` | The `local_auth_enabled` platform setting is off or missing. Creating the first Owner turns it on. While it is off, existing sessions are refused too | Run `sudo felis breakGlass` to create or recover the Owner, which turns local sign-in on (see [Emergency access](/en/operations/access#break-glass)) |
| **Sign-in requests are rate-limited. Retry after the limit resets.** | `429 rate_limited` | One client address made too many sign-in calls | Wait for the time in the `Retry-After` header. If everyone is affected at once, see [Everyone is rate-limited at once](#sign-in-rate-limited) |
| **Mail delivery is not configured, so verification codes cannot be sent. …** | `503 mail_unavailable` | No mail relay is configured, in the panel or in the configuration file | Sign in with a passkey, or players with a bind code. Configure a relay (see [Mail relay](/en/operations/monitoring#mail-relay)) |
| **Mail delivery is rate-limited. …** | `429 mail_rate_limited` | The installation's mail budget is spent: the **Hourly mail cap** (default 120 messages per hour) | See [mail problems](#mail-problems) |
| **The verification email could not be delivered — …** | `502 mail_undeliverable` | The mail relay refused the message | See [mail problems](#mail-problems) |
| **Too many incorrect attempts, please request a new verification code.** | `429 otp_locked` | This code has used up its attempts | Request a new code |
| **Too many wrong codes in 24 hours — email codes for this account are paused. …** | `429 otp_account_locked` | Ten wrong codes for the account within 24 hours | Use a passkey, or see [Email codes are locked for an account](#email-code-locked) |
| **This is a staff account — use Operator sign-in instead.** | `403 staff_account` | Staff accounts (Admin and Owner) cannot sign in on the player console with an email code | Sign in on the operator console |
| **The sign-in service is currently unavailable.** | `503 auth_unavailable` | PostgreSQL is unreachable | See [The database is unavailable](#database-unavailable) |
| **Waiting for in-game approval…** does not end | — | Operator sign-in needs approval from an administrator who is online in the game | See [Operator sign-in waits for approval](#operator-sign-in) |

Passkeys are bound to the panel hostname. After the hostname changes, users register their
passkeys again.

### Everyone is rate-limited at once {#sign-in-rate-limited}

Every user gets **Sign-in requests are rate-limited.** at the same time.

**Cause**

Each client address may make 20 sign-in calls at once, refilled at 20 per minute and shared
across all sign-in endpoints; IPv6 clients share one limit per /64. A person signing in makes
three or four calls, so the limit normally affects only scripts. Felis reads the client
address from the header named in `[auth] client_ip_header`. When no header is set, it uses
the TCP peer address. Behind a reverse proxy or tunnel, every visitor then shares the proxy's
address and one limit.

**Diagnosis**

felis-api logs at start which address the limit uses:

```bash
sudo k3s kubectl -n felis logs deploy/felis-api | grep 'sign-in rate limit keys on'
```

`felis api: sign-in rate limit keys on the TCP peer ([auth] client_ip_header unset)` behind a
proxy confirms the cause. Refusals are counted in
`felis_rate_limited_total{scope="auth_door"}`, and the `FelisSignInFlood` alert fires when
more than 10 a minute are refused for 10 minutes (see
[Metrics](/en/operations/monitoring#metrics)).

**Resolution**

1. Select the access method that matches how the panel is reached, on the **Access and
   domain** card in **Platform settings → Access and security** or in `felis setup` (see
   [Access methods](/en/operations/access#access-methods)). **Own reverse proxy** keys the
   limit on the rightmost `X-Forwarded-For` entry, the one your proxy appends;
   **Cloudflare Tunnel** keys it on `CF-Connecting-IP`.
2. Behind your own reverse proxy, firewall the panel port so that only the proxy reaches it.
   Otherwise a direct caller can put any address in the header.
3. Behind Cloudflare, you can also stop floods at the edge: under Security → WAF → Rate
   limiting rules, match URI paths starting with `/api/v1/auth/` on the panel and operator
   console hostnames, count by IP, and block for 10 seconds above 30 requests per 10 seconds.

### Email codes are locked for an account {#email-code-locked}

A user enters the right code and is still refused, or gets
**Too many wrong codes in 24 hours — email codes for this account are paused.**

**Cause**

Ten wrong email codes for one account within 24 hours, counted across every code sent to it,
lock email-code sign-in for that account until 24 hours after the first wrong code. Public
sign-in answers a locked account exactly like a wrong code, and the account's owner receives
one mail about the lock. Signed-in steps such as email verification and account migration
answer `429 otp_account_locked`. Passkey sign-in keeps working.

**Diagnosis**

Each lock is recorded in the audit log as `auth.otp.locked` and counted in
`felis_auth_otp_lockouts_total{purpose}` (alert `FelisOTPAccountLocked`). See
[Find failed sign-ins](#sign-in-audit) for the query.

**Resolution**

1. Sign in with a passkey, or wait until the lock ends.
2. To lift the lock early, after you have confirmed that the account's owner locked
   themselves out, delete the account's wrong-code record:

   ```bash
   sudo k3s kubectl -n felis exec deploy/felis-postgres -c postgres -- psql -U postgres felis -c \
     "DELETE FROM otp_failure_windows WHERE user_id = (SELECT id FROM users WHERE username = '<name>');"
   ```

### Find failed sign-ins {#sign-in-audit}

Every refused sign-in writes an `auth.<door>.failed` row to the audit log, with a `reason`
such as `bad_code`, `no_account`, `staff_account`, `not_staff` or `bad_assertion`. The first
refusal of each throttled burst writes `auth.rate_limited` with the source address. Rows
carry `actor_user_id` (the account; use it for attribution), `client_ip` (the same address
the rate limit uses) and `user_agent`.

```bash
sudo k3s kubectl -n felis exec deploy/felis-postgres -c postgres -- psql -U postgres felis -c "
  SELECT created_at, action, actor, client_ip, payload->>'reason' AS reason
  FROM audit_logs
  WHERE action LIKE 'auth.%' AND created_at > now() - interval '1 hour'
  ORDER BY created_at DESC LIMIT 50;"
```

Refusals are also counted in `felis_auth_failures_total{door,reason}`; the
`FelisSignInFailures` alert fires above 30 in 15 minutes. When an audit row cannot be
written, the action still succeeds, felis-api logs `audit: lost ...`, and the
`FelisAuditWriteFailing` alert fires; the cause is almost always the database (see
[The database is unavailable](#database-unavailable)). For audit retention and export, see
[Audit log](/en/guide/administration#audit-log).

### Operator sign-in waits for approval {#operator-sign-in}

**Operator sign-in** on the operator console stays at **Waiting for in-game approval…**.

**Cause**

Operator sign-in requires two factors: a code mailed to the staff address, and approval from
an administrator who is online in the game. Only a Minecraft account linked to a staff
account can approve. The request expires after a short time.

**Resolution**

1. Ask an administrator who is online in the game to run `/felis web op approve <code>`. The
   command shows whose request it is; the administrator approves it with
   `/felis web op approve <code> <account>`, naming the account.
2. Sign in with a passkey instead, which needs no in-game approval.
3. If no staff account can sign in, restore access on the host with `sudo felis breakGlass`
   (see [Emergency access](/en/operations/access#break-glass)).

## Internal API and game plugins {#internal-api}

### Game plugins cannot reach the internal API {#internal-api-errors}

The game proxy, the login space, build Jobs and `felis backup-now` call felis-api's internal
API (port 8081, routes under `/api/v1/internal/`). It is reached through the ClusterIP
Service `felis-api-internal`, which is separate from the panel's `felis-api` Service on port
443 and is never exposed on the node. Each caller authenticates with its own bearer token,
and each route serves only the callers listed for it in the OpenAPI document (see
[API reference](/en/reference/api#authentication)).

| Caller | Secret in `felis` (key `token`) | API variable | Where the caller reads it |
| --- | --- | --- | --- |
| Game proxy (`velocity`) | `felis-service-token` | `FELIS_SERVICE_TOKEN` | `service-token` in `/opt/felis/velocity/plugins/felis-link/felis-link.properties` |
| Login space (`limbo`) | `felis-limbo-token`, with a copy in `minecraft` | `FELIS_LIMBO_TOKEN` | The login pod's `FELIS_SERVICE_TOKEN` variable |
| Build Jobs (`build`) | `felis-build-token`, with a copy in the build namespace | `FELIS_BUILD_TOKEN` | The build Job's fetch step |
| `felis backup-now` (`ops`) | `felis-ops-token` | `FELIS_OPS_TOKEN` | The Secret, on each run |

The installer generates the four tokens into `/etc/felis/secrets.env` (`SERVICE_TOKEN`,
`LIMBO_TOKEN`, `BUILD_TOKEN`, `OPS_TOKEN`) and applies them on every run. The audit log
records internal actions with the source `internal:<caller>`.

When the internal API fails, the proxy logs `server list refresh failed …; keeping current
registrations` and keeps routing on the last server list it received; players read
`Login verification is temporarily unavailable.`; the login space logs
`FelisLimbo: link status poll failed`; and builds fail while fetching their context.

**Cause**

| Symptom | Cause |
| --- | --- |
| Calls fail to connect, with no HTTP status | The `felis-api-internal` Service is missing or no longer selects the API pods, or felis-api is down |
| Every call from one caller gets `401` | The caller's token is unset, or differs from the API's copy |
| `403 wrong_caller` | The token is valid but belongs to a caller this route does not serve, for example the build token on a proxy route |
| felis-api pods stay in `CreateContainerConfigError` | One of the four token Secrets is missing in `felis` |
| felis-api refuses to start with `the X and Y tokens are the same value; each caller needs its own` | Two callers have the same token |

**Diagnosis**

1. Read the proxy's summary and refresh lines:

   ```bash
   sudo journalctl -u felis-velocity | grep -E 'Felis: last 10 min|server list refresh'
   ```

   The proxy logs a summary for every active 10 minutes, for example
   `Felis: last 10 min: felis-api calls=412 (no answer=0, 4xx=3, 5xx=0, retried=0), …`.
   A rising `no answer` count means the path to the internal API is broken: the Service, a
   network policy, or the API pod. `busy refusals` or `join-events dropped` above zero means
   felis-api answers more slowly than the proxy's pool of 8 threads can absorb.
2. Check the Service; it must show a cluster IP with port 8081:

   ```bash
   sudo k3s kubectl -n felis get svc felis-api-internal
   ```

3. Look for unset tokens. felis-api logs one line per unset token at start, for example
   `felis api: warning: FELIS_LIMBO_TOKEN unset — the internal face turns the limbo caller away`:

   ```bash
   sudo k3s kubectl -n felis logs deploy/felis-api | grep 'unset'
   ```

4. Compare the caller's token with its Secret, for example for the proxy:

   ```bash
   sudo k3s kubectl -n felis get secret felis-service-token -o jsonpath='{.data.token}' | base64 -d; echo
   sudo grep '^service-token=' /opt/felis/velocity/plugins/felis-link/felis-link.properties
   ```

5. For the login space, read its log:

   ```bash
   sudo k3s kubectl -n minecraft logs login-0 | grep 'link status poll'
   ```

**Resolution**

1. For a missing Service, a missing Secret or a mismatched token, re-run the installer (see
   [Installation](/en/guide/deployment#install)). It applies the Service, the four Secrets and
   every caller's copy of its token.
2. For a proxy on another host, set `service-token` in its `felis-link.properties` to the
   value in Secret `felis/felis-service-token`; the plugin reads the new value within a few
   seconds.
3. For `wrong_caller`, configure the caller with its own token from the table above.
4. For two identical tokens, rotate one of them:

   ```bash
   sudo felis rotate-token <kind>
   sudo felis rotate-token -yes <kind>
   ```

   Without `-yes`, the command only prints what it would change and what that interrupts.
   [Credential rotation](/en/operations/access#rotate-credentials) lists what each rotation
   restarts.

## Account linking and claims {#account-linking}

### Linking or claiming fails {#account-link-errors}

A player links a Minecraft account by running `/link` in the game, which returns a one-time
code, and entering the code in the **Link code** field of the **Minecraft link** card on the
**Account** page, then selecting **Link**. Codes have 8 characters (letters and digits,
without I, O, 0 and 1), are valid for 10 minutes and work once; case and surrounding spaces
are ignored. Claiming an unowned server requires a linked account and enough quota (see
[Account linking](/en/guide/players#account-linking)).

**Cause and resolution**

| Answer | Panel message | Cause | Resolution |
| --- | --- | --- | --- |
| `400 invalid_code` | **The binding code is invalid or expired. Obtain a new code.** | The code is unknown or older than 10 minutes | Run `/link` again and enter the new code within 10 minutes |
| `409 already_linked` | **That Minecraft account is already linked to another user.** | The Minecraft account is linked to another panel account. The code stays valid, so the right account can still use it | Sign in with the account that holds the link, or ask an admin to check the accounts under **Admin → Users** |
| `412 not_linked` | **Link your Minecraft account before claiming (Account → Link).** | Claiming and owner actions require a linked Minecraft account | Link the account first |
| `403 quota_exceeded` | **You have reached your server quota.** | The claim would exceed the account's quota for servers, CPU, memory or storage | An admin raises the quota (see [Quotas](/en/guide/administration#quotas)) |
| `409 already_claimed` | **This server has been claimed by another account.** | Another account claimed the server first; a claim succeeds for exactly one account | Refresh the server list |
| `409 server_retiring` | **The server is pending release or deletion at the next daily reclaim run. …** | The server is being given up or deleted | Cancel the request in the panel |
| `404 not_found` | **The requested content does not exist or has been deleted. Refresh and retry.** | The server does not exist | Refresh the server list |
| `400 bad_request`, `400 bad_mc_uuid` | **The request was not accepted: …**, **Invalid Minecraft UUID format. …** | The game plugin sent a request without a UUID, with an empty code, with an invalid UUID, or with an authentication source other than `mojang` or `thirdparty` | Check that the game plugins match the installed Felis release |

On a standalone server running a Felis mod, `/link` answers `This server runs with
online-mode off, so /link is unavailable here.` when the server runs in offline mode. Behind
the Felis proxy, the proxy serves `/link`.

**Diagnosis**

Successful links and claims appear in the audit log as `account.link` and `claim`. For
failures, read the felis-api log and the proxy log:

```bash
sudo k3s kubectl -n felis logs deploy/felis-api --tail=200
sudo journalctl -u felis-velocity -n 200
```

If `/link` itself fails in the game, check the internal API (see
[internal API errors](#internal-api-errors)).

## Builds and images {#builds-images}

These entries cover image builds from the **Build Pipeline**, the platform registry and the game images servers run on.

### An image build fails {#build-failures}

**Cause**

A build runs as a Job in the `felis-build` namespace. Its pod runs the steps `egress-gate`, `context-fetch`, `kaniko`, `trivy`, `sbom` and `scan-gate` in turn, and the final `push` step runs only after all of them succeed, so an image the scan blocks never reaches the registry. The build's error names the step that failed together with the last lines of its output, the deadline it exceeded, or the scan verdict.

| Error or state | Cause |
| --- | --- |
| `the scan blocked the image: 1 CRITICAL, 1 HIGH (CVE-…, …)` | A vulnerability or leaked secret has a severity listed in `[registry] scan_fail_on` (default `CRITICAL`). |
| The build hangs, then fails fetching a base image or packages | Build pods reach only cluster DNS, the internal registry and the API's internal face. Every download from the internet is blocked. |
| `felis fetch-context: … it changed after approval; refusing to build` | The uploaded context no longer matches the digest the administrator approved. |
| Approval answers `409 context_changed` | The submitter uploaded again after the review. |
| Upload answers `507 uploads_full` or `403 submission_quota_exceeded` | Uploaded contexts exceed `user_uploads_max_bytes` (default 4Gi for all users together), 2 GiB for one user, or would leave the uploads volume under 10% free. One context is limited to `context_max_bytes` (default 1Gi). |
| Submission refused with `400` and `must target the internal registry "…", not "…"` | The image reference points outside the internal registry. |
| `push` fails with `403` | The target repository is under `felis/` or `mirror/`, which are reserved for the platform. |
| `push` fails with `401` | The `felis-registry-push` Secret in the `felis-build` namespace is missing or stale. |
| The build pod is `Evicted` | The build used more disk than `build_disk_limit` (default `12Gi`): extracted context, unpacked base image and image tarball together. |
| `the build namespace's NetworkPolicy is not enforced` | The cluster runs without NetworkPolicy enforcement (a CNI without it, or k3s started with `--disable-network-policy`). |
| `scan-gate` exits with code 2 | The scan report was missing or unreadable, and the build fails closed. |

The build ServiceAccounts `felis-build` and `felis-restore` have no Role anywhere, so every Kubernetes API request they make is denied. This is part of the build isolation; leave them without permissions.

**Diagnosis**

1. In the panel, open **Build Pipeline** and select **Scan & logs** on the failed build. It shows the verdict and up to 100 findings with the blocking ones first, marks findings accepted as known risks as **Accepted**, and offers the Trivy report and the SBOM for download.
2. Read the output of every step:

   ```bash
   sudo k3s kubectl -n felis-build get jobs,pods
   sudo k3s kubectl -n felis-build logs job/<build-job> --all-containers --prefix
   sudo k3s kubectl -n felis-build describe pod <build-pod>
   ```

Administrators can read the same scan data over the API: `GET /api/v1/images/build/{id}/scan`, `GET /api/v1/images/build/{id}/scan/report` and `GET /api/v1/images/build/{id}/sbom`. `404 scan_not_found` means the build stopped before the scan. `404 scan_document_not_kept` means the report or SBOM exceeded the 6 MiB kept per image; the verdict and findings are always kept.

**Resolution**

- **Scan blocked:** update the vulnerable component in the image and build again. To accept a finding as a known risk, add its id (a CVE or GHSA id, or a secret rule id such as `aws-access-key-id`) to `[registry] scan_accept`; accepted findings are still counted and listed. A vulnerability with no fixed release blocks only when `scan_fail_unfixed = true`. Adding `HIGH` to `scan_fail_on` blocks every build based on the platform's `felis/paper` image, whose upstream `paper.jar` carries five fixable HIGH findings, until those ids are accepted:

  ```toml
  [registry]
  scan_fail_on = ["CRITICAL", "HIGH"]
  scan_accept = ["CVE-2021-35515", "CVE-2021-35516", "CVE-2021-35517", "CVE-2021-36090", "CVE-2025-67030"]
  ```

  Review the accepted ids whenever the base image changes.
- **Downloads blocked:** base the Dockerfile on an image in the internal registry, such as the platform's `felis/paper`, and put every file the build needs into the uploaded context.
- **Context changed:** download and review the new upload, then approve again. When the review happened outside the panel (a command-line download or another browser), compare the `sha256sum` of the file you reviewed with the digest shown on the review page.
- **Upload quota:** delete rejected submissions or raise `user_uploads_max_bytes`. A rejected submission's upload is deleted 7 days after the verdict.
- **Push `401`:** re-run the installer, which recreates the push Secret. **Push `403`:** choose a repository outside `felis/` and `mirror/`.
- **Evicted:** raise `build_disk_limit` and keep the node's free disk above it.
- **NetworkPolicy not enforced:** restore NetworkPolicy enforcement in the cluster.

To change a `[registry]` key, edit both configuration files and reload the API. felis-api reads its configuration from the `felis-config` Secret, so a restart alone does not pick up the edit.

1. Edit the key in `/etc/felis/felis.host.toml` and in `/etc/felis/felis.pod.toml`.
2. Render the Secret again and restart felis-api:

   ```bash
   sudo k3s kubectl -n felis create secret generic felis-config \
     --from-file=felis.toml=/etc/felis/felis.pod.toml --dry-run=client -o yaml | sudo k3s kubectl apply -f -
   sudo k3s kubectl -n felis rollout restart deployment/felis-api
   ```

::: tip
A scan reflects the vulnerability database on the day of the build, and an admitted image is not scanned again later. To rescan an image, refresh the database with `sudo felis mirror-build-tools -only trivy-db` and start a new build of the same context.
:::

### Build pods do not start {#build-pods-not-starting}

**Cause**

Build pods run Kaniko and Trivy, and Trivy reads a vulnerability database and a Java database. The build namespace has no internet access, so all four come from copies in the internal registry:

| Tool | Copy in the registry |
| --- | --- |
| Kaniko | `mirror/kaniko-executor:v1.24.0` |
| Trivy | `mirror/trivy:0.74.0` |
| Vulnerability database | `mirror/trivy-db:2` |
| Java database | `mirror/trivy-java-db:1` |

The installer makes these copies with `felis mirror-build-tools`, and `felis-build-tools.timer` refreshes them at 04:00 and 16:00. Copying needs access to gcr.io, ghcr.io and mirror.gcr.io.

| Symptom | Cause |
| --- | --- |
| The build stays **Queued** | `[registry] max_concurrent_builds` builds (default 2, at most 6) are already running. Queued builds start oldest first. |
| `ImagePullBackOff` on `mirror/kaniko-executor` or `mirror/trivy` | The first copy has not finished, or the host had no internet access during the install. |
| The scan fails with `failed to download vulnerability DB` | `mirror/trivy-db:2` is missing. |
| Watchdog: `the vulnerability DB was last refreshed … ago` | The timer's runs fail (network, registry down, full disk). The watchdog warns after three days without a clean run; scans keep gating, against old advisories. |
| No build starts after setting `build_user_namespaces = "on"` | The node cannot run a pod with `hostUsers: false`. User namespaces need Kubernetes 1.33 or later, containerd 2.x and a kernel with idmapped mounts (5.19 or later; the RHEL and CentOS Stream 9 kernels carry the backport). |

**Diagnosis**

```bash
sudo k3s kubectl -n felis-build get pods
journalctl -u felis-build-tools -n 50
sudo cat /var/lib/felis/build-tools/status.json
sudo k3s kubectl -n felis logs deploy/felis-api | grep 'build pods run'
```

The felis-api log states at startup whether build pods use a user namespace: `build pods run in a user namespace (hostUsers: false)` or `build pods run without a user namespace: …`.

**Resolution**

1. Once the host can reach gcr.io, ghcr.io and mirror.gcr.io, copy the tools again:

   ```bash
   sudo felis mirror-build-tools                  # every build tool and runtime
   sudo felis mirror-build-tools -only trivy-db   # one tool
   ```

2. On an air-gapped host, fetch the four images on a machine with internet access and push them into the registry under the names above, as the `platform` user, through a port-forward:

   ```bash
   sudo k3s kubectl -n felis port-forward svc/registry 5000:5000
   # password of the platform user
   sudo k3s kubectl -n felis get secret felis-registry-auth -o jsonpath='{.data.platform}' | base64 -d
   ```

   Push to `localhost:5000/mirror/<name>:<tag>`. Repeat this for the two databases as often as current advisories matter to you. The watchdog warning stays until the timer can reach upstream.
3. If builds stopped starting after setting `build_user_namespaces = "on"`, set it back to `"auto"` (the default, which turns user namespaces on only when the node supports them) or `"off"`, as described in [An image build fails](#build-failures).

::: info
Kaniko v1.24.0 is the final upstream release and receives no security fixes. To run a maintained fork, copy its image under `mirror/` and set `[registry] kaniko_image` to it.
:::

### Pushing to or pulling from the registry fails {#registry-errors}

**Cause**

The platform registry runs as the `registry` Deployment in the `felis` namespace, and images are addressed as `registry.felis.svc:5000/<repository>:<tag>`. The node pulls through the loopback port `127.0.0.1:5000`, which `/etc/rancher/k3s/registries.yaml` maps the registry name onto. Both the port and the file must be present for pulls to work. Reads are anonymous; every write needs a token from the `felis-registry-auth` Secret.

| Symptom | Cause |
| --- | --- |
| The registry pod never starts and its volume stays `Pending` | The cluster has no default StorageClass. |
| Writes answer `503` with `Retry-After` while pulls work | The daily garbage collection holds a read-only window. The installer and build pushes wait for it to end. |
| A push of a very large layer is killed | The registry ran out of memory (its limit is 2Gi). |
| Pulls fail after disk pressure or image garbage collection | `registries.yaml` is missing or changed, or the registry is down. |
| A push answers `401` | The credential is missing or wrong. A missing `felis-registry-auth` Secret leaves the registry read-only. |
| Platform and user images are gone | The registry volume was lost. |
| The installer warns `could not pull …` on an air-gapped host | The registry and PostgreSQL images come from Docker Hub, pinned by digest. |

**Diagnosis**

```bash
sudo k3s kubectl -n felis get pods -l app.kubernetes.io/component=registry
sudo k3s kubectl -n felis get pvc registry
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000/healthz   # expect 200
sudo cat /etc/rancher/k3s/registries.yaml
sudo k3s kubectl -n felis logs deploy/registry -c registry-gc
```

An anonymous `GET /v2/` answers `401`; that is expected.

**Resolution**

- **Volume `Pending`:** mark a StorageClass as the cluster default.
- **`503` during garbage collection:** wait for the window to end. To run the collection at once, remove its marker and restart the registry pod:

  ```bash
  sudo k3s kubectl -n felis exec deploy/registry -c registry-gc -- rm -f /var/lib/registry/.felis-last-gc
  sudo k3s kubectl -n felis rollout restart deploy/registry
  ```

- **Pulls fail:** `registries.yaml` must map `registry.felis.svc:5000` to `http://127.0.0.1:5000`. If it is missing or changed, re-run the installer.
- **Credentials:** `sudo felis rotate-token -yes registry` replaces the registry tokens and restarts the registry and felis-api. See [Rotating credentials](/en/operations/access#rotate-credentials).
- **Volume lost:** re-run the installer, which pushes every platform image again. With the [off-site copy](/en/operations/backup#offsite) configured, `sudo felis offsite fetch-images` puts user images back at their old digests; it pushes only what is missing, so a second run after an interruption is cheap. Without it, rebuild user images from their approved submissions, whose uploaded contexts stay on the uploads volume. Servers pinned to a digest the registry no longer holds fail to pull until an administrator picks a current image (see [game images](#game-images)).
- **Air-gapped `could not pull`:** install from release assets copied to the host ([Offline installation](/en/guide/deployment#offline-install)). Without assets, fetch the image by the same digest for the host's architecture on a connected machine, export it with containerd and import it on the host:

  ```bash
  # on a machine with internet access; $ref is the full reference with digest from the warning
  sudo ctr images pull --platform linux/amd64 "$ref"
  sudo ctr images export --platform linux/amd64 image.tar "$ref"
  # on the Felis host
  sudo k3s ctr images import image.tar
  ```

  Use `linux/arm64` on an ARM host. A `docker save` rewrites the manifest, and the copy then no longer matches the digest. Re-run the installer afterwards; it finds the image and pins it against image garbage collection.

### Creating a server or changing its image is refused {#game-images}

**Cause**

Game images live under tags that an installer run can move, such as `registry.felis.svc:5000/felis/paper:demo`. A server is pinned to the digest its tag named when it was created, so it keeps running exactly that build. Each installer run also pushes every game build under a versioned tag that no later run rewrites, `<Minecraft version>-<12 hex digits of the image id>` (for example `felis/paper:26.2-3f9c0a1b2c4d`). The registry deletes a build that no server and no whitelist entry has referenced for 24 hours, and always keeps the 5 newest builds of each `felis/` repository.

| Message | Cause | Resolution |
| --- | --- | --- |
| `image_not_in_registry` | The whitelisted tag was never pushed to the internal registry, or was deleted. | Push or rebuild the image, then retry. |
| `registry_unavailable` | felis-api could not reach `registry.felis.svc:5000`. | Check the registry pod, and check that the `felis-registry-ingress` NetworkPolicy still admits felis-api. |
| `the registry no longer holds build …` | The image names a digest the registry pruned. | Pick a current tag. Whitelist the versioned tag of any build you want to keep. |
| `409 image_change_unconfirmed` | An image change over the API without `"confirmImageChange": true`. | Back up the world, then send the change with the confirmation. |
| Installer warns `could not pin every user server` | The registry was down, or a server names a tag the registry lost. | Fix the registry, then run `sudo felis pin-images` before starting those servers. A server whose tag is gone keeps its bare tag until an administrator picks a new image. |
| Installer warns `could not pin the login system server` (or the lobby) | The registry did not answer right after the push. | Re-run the installer once the registry pod is Ready. |
| A running server restarted once during an installer run | The installer pinned it to the build it already ran. | No action; this happens once per server. |

**Diagnosis**

```bash
sudo k3s kubectl -n felis get pods -l app.kubernetes.io/component=registry
sudo k3s kubectl -n minecraft get minecraftserver <name> -o jsonpath='{.spec.image}'
```

`spec.image` names the exact build a server runs (the digest after `@sha256:`).

**Resolution**

To move a world to a newer build or Minecraft version:

1. Back up the world. Minecraft upgrades chunks as it loads them, and the older version cannot open them again.
2. Open **Edit Server Config** and pick the image. Picking the current tag again moves the server to that tag's newest build.
3. Tick **I've backed up the world — change the image** and save.

To roll back, set the previous build again (the audit log records `image_from` and `image_to` for every change) and restore the pre-upgrade backup. This works while the registry still holds the old build. To create servers on a specific Minecraft version after the default tag has moved, whitelist its versioned tag ([Images](/en/guide/administration#images)).

### Server software installation fails {#software-install}

A server that runs server software installs it before starting. When the installation fails, the server stays **Starting** and shows **Start failed** once the time limit runs out. The first start needs the download sites; later starts only check the downloaded files.

**Diagnose**

```bash
sudo k3s kubectl -n minecraft logs <server>-0 -c install-server
sudo k3s kubectl -n felis logs deploy/felis-artifacts --tail=50
```

| Message | Cause | Fix |
| --- | --- | --- |
| `fetch <path>: … content does not match its published digest` | The download does not match the hash the official source publishes; the file is damaged or was replaced. | Retry the start. If it happens every time, report it. |
| `fetch <path>: HTTP 403`, `HTTP 5xx` or a timeout | The node cannot reach the download site, or the site is temporarily unavailable. The cache logs `artifact download failed` for it. | Make sure the node can reach the internet, then retry the start. |
| `software: <address> answered HTTP …` | Version information could not be read for the first installation. | Retry the start later. Installed servers are not affected. |
| `the custom jar <path> is not in the server's files yet` | The custom jar has not been uploaded. | Upload the jar to the server files, or correct the path under **Edit Server Config**. |
| `the forge installer failed` (or neoforge) | The official installer failed, usually because it cannot reach its Maven repository or runs out of memory. The installer runs within the server's memory limit. | Read the installer output in the log; raise the server's memory if it ran out. |
| `a forwarding mod (Modrinth …) for <core> <version> not found` | Modrinth no longer publishes the forwarding component that was available when the server was created. | Change the game version, or report it. |

When the download cache is unavailable, servers download from the official sources directly, and the installation does not fail because of it.

### Java runtime unavailable {#runtime-unavailable}

Creating a server or changing its server software answers `runtime_unavailable`, or a server pod shows `ImagePullBackOff` pulling a `mirror/eclipse-temurin` image.

**Cause**

Server software runs on Java runtime images in the in-cluster registry. The installer and `felis-build-tools.timer` copy them from Docker Hub with `felis mirror-build-tools`; until the copy has completed, or while the host cannot reach Docker Hub, the runtime is unavailable.

| Java version | Copy in the registry | `-only` name |
| --- | --- | --- |
| 8 | `mirror/eclipse-temurin:8-jre` | `runtime-java8` |
| 17 | `mirror/eclipse-temurin:17-jre` | `runtime-java17` |
| 21 | `mirror/eclipse-temurin:21-jre` | `runtime-java21` |
| 25 | `mirror/eclipse-temurin:25-jre` | `runtime-java25` |

**Fix**

Once the host can reach Docker Hub, copy the runtimes:

```bash
sudo felis mirror-build-tools                          # build tools and every runtime
sudo felis mirror-build-tools -only runtime-java21     # one runtime
```

### The installer builds images on the host during a release install {#host-build-fallback}

**Cause**

A release install takes its images and the Velocity plugin from the release's assets and checks each against the release's `SHA256SUMS`. When an asset cannot be used, the installer names it and the reason, and builds that image on the host with Docker instead; the registry and PostgreSQL images are then pulled from Docker Hub. Each download is tried three times, five seconds apart, and a transfer that stays under 1 KiB/s for a minute is restarted.

**Diagnosis**

Read the installer messages printed before the build:

| Message | Meaning | Resolution |
| --- | --- | --- |
| `release vX publishes no SHA256SUMS … building them on this host instead` | The release has no assets, or they are still being uploaded. | For a new release, re-run once the release page lists `SHA256SUMS`. |
| `SHA256SUMS lists no <file>` or `could not download <file> from release vX` | The release lacks that asset. | Re-run later. The host build is correct meanwhile. |
| `downloaded <file> hashes to …, but release vX's SHA256SUMS says …` | The download was corrupted, or the asset was replaced. | Re-run. If the same mismatch repeats, the asset itself is bad; report it. |
| `the release's image listing … is malformed` | `felis-images-linux-<arch>.txt` does not parse. | Report it. Every image is built on the host. |
| `the release's registry image is …, but this installer runs …` | The installer and the release are from different versions. | Run the installer read at the release's tag; `felis update --panel` prints that command. |
| `k3s containerd holds no <image> from <tar>` | The tar did not contain the image under the listed digest. | `sudo k3s ctr images ls \| grep felis` shows what was imported. Report it. |
| `FELIS_ARTIFACT_DIR: …`, and the install stops | A file in the asset directory is missing or fails its checksum. Nothing is built from a directory install. | Copy the named file from the release again and re-run. |

During plugin builds, `[felis] Downloading <file> (<host>)` lines identify each Gradle download, and an active download reports its progress every ten seconds. `no new data for …; waiting for the download` reports a download that has received nothing for thirty seconds; Gradle's own timeouts and retries still apply.

**Resolution**

A host build needs about 8 GiB under `/var/lib/containerd` (2 GiB when Docker already has a build cache there). Without that room the install stops before Docker is installed:

```
building here what the release did not supply takes about … MiB under /var/lib/containerd, and … has … MiB free; nothing has been built
```

Re-run once the asset can be downloaded, free the space, or set `FELIS_PREFLIGHT=warn` to build anyway. An interrupted install keeps the downloaded files in `/var/lib/felis/artifacts`, and the next run reuses those that still match `SHA256SUMS`.

## System servers and configuration {#configuration}

These entries cover settings that do not take effect on existing servers, idle auto-stop and world volumes left behind by deleted servers.

### A newer setting never reaches an existing server {#system-server-fields}

**Cause**

The installer creates the login space and lobby servers only when they are missing and leaves existing ones unchanged. A field that a newer release added to their definition therefore stays unset on an older install: the lobby may lack RCON (its console stays dead and its online count always shows 0), or the login space may lack its HTTP readiness check. User servers created before idle auto-stop became the default have no idle setting and never stop when empty. User servers created before RCON became the default have a dead console, always show 0 players, cannot be backed up live and never stop when idle.

Some fields act only under conditions:

| Field | Behaviour |
| --- | --- |
| `spec.startup.timeoutSeconds` | Time allowed for a start. `0` or unset means 300 s; afterwards the server becomes `Failed` with `StartupTimeout`. |
| `spec.startup.readinessTimeoutSeconds` | Deadline for the whole start while waiting for the RCON probe, measured from the start request. `0` or unset means 300 s; afterwards the server becomes `Failed` with `ReadinessTimeout`. |
| `spec.idle.autoStopEnabled`, `spec.idle.emptySecondsBeforeStop` | Act only with `spec.rcon.enabled`, because the player count comes from RCON. `emptySecondsBeforeStop: 0` turns idle stop off. |

**Diagnosis**

```bash
sudo k3s kubectl -n minecraft get minecraftserver \
  -o custom-columns=NAME:.metadata.name,RCON:.spec.rcon.enabled,IDLE:.spec.idle.autoStopEnabled
```

**Resolution**

Run the following after the images are in place, that is after an installer run or update. Enabling RCON or the readiness check on a server whose image lacks the listener keeps that server in `Starting` until it is marked `Failed`.

1. Fill the missing fields of the system servers and give older user servers the default idle auto-stop (stop after 600 s with nobody online):

   ```bash
   sudo felis converge
   ```

   Servers that are already current report `already converged`. Values that are set are never overwritten, so an idle stop an administrator turned off stays off. Without `-user-rcon`, the command lists the user servers that lack RCON and leaves them unchanged.
2. Turn RCON on for older user servers whose RCON was never set:

   ```bash
   sudo felis converge -user-rcon
   ```

   Each server gets the RCON block of a newly created server, and the change applies at its next start. Felis's own Paper and lobby images open RCON; check that a user-built image does before running this. A server whose RCON someone set, on or off, is left unchanged.

The same actions are available in the panel: **Platform settings → Access and security → System server completion**, with **Enable RCON on older user servers** for step 2, then **Run completion**.

### A deleted server's world volume remains {#world-volume-kept}

**Cause**

A world volume outlives its MinecraftServer object. Deleting the object directly (for example with `kubectl`) keeps the volume, so a server that comes back under the same name mounts the same world. The world cleanup is the only process that deletes a world volume, and only after a verified backup. A server given up or deleted in the panel is archived and its volume removed by the next daily cleanup run, which needs a worlds root (`FELIS_WORLDS_HOST_PATH`, see [World cleanup](/en/operations/backup#world-cleanup)). While the volume exists it holds the name: creating a new server with that name answers `409 world_volume_exists`.

**Diagnosis**

List the world volumes whose server is gone:

```bash
comm -23 \
  <(sudo k3s kubectl -n minecraft get pvc -l felis.lolicon.best/server -o jsonpath='{range .items[*]}{.metadata.labels.felis\.lolicon\.best/server}{"\n"}{end}' | sort) \
  <(sudo k3s kubectl -n minecraft get minecraftservers -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | sort)
```

**Resolution**

Delete a volume only when its world is no longer needed:

```bash
sudo k3s kubectl -n minecraft delete pvc world-<name>-0
```

::: danger
Deleting a world volume is irreversible. The world is gone unless an archive of it exists.
:::

## Host problems {#host-problems}

These entries cover the disk, the host's address, the k3s certificates and the clock. The system journal is persistent, so `journalctl -b -1` shows the boot before the last restart.

### Pods are evicted or images go missing when the disk fills {#disk-full-symptoms}

**Cause**

When the disk fills, the kubelet evicts game server pods first. The control-plane pods (felis-api, the operator, the world cleanup and the registry) run under the `system-cluster-critical` priority class and are not evicted; the kubelet logs `Eviction manager: cannot evict a critical pod` for them. The kubelet may then remove images that nothing runs. Backups stop as well: a backup that would leave less than 10% of the archive filesystem free fails with `not enough free disk for the archive`.

Typical symptoms:

- The login space or lobby is evicted, and players cannot join.
- Pods stay in `ImagePullBackOff` after the eviction.
- The watchdog mails `node … reports DiskPressure: the kubelet is evicting pods`, or `the filesystem holding … is …% free` (a warning below 15% free, critical below 5%).
- After space is freed, the node keeps `DiskPressure: True` for up to about 5 minutes, and pods waiting to be scheduled wait with it.

**Diagnosis**

```bash
df -h / /var/lib/rancher /var/lib/felis
sudo k3s kubectl describe node | grep -A 8 Conditions
sudo k3s kubectl get pods -A | grep -v Running
```

The largest consumers are usually k3s's images (`sudo k3s ctr images ls -q`) and the world and backup volumes under `/var/lib/rancher/k3s/storage`.

**Resolution**

1. Free space or grow the disk as described in [Recovering from a full disk](/en/operations/storage#disk-full).
2. Images come back on their own: every platform image is also stored in the platform registry, and the node pulls a removed image from there on the next attempt. Delete a pod stuck in `ImagePullBackOff` to retry at once.
3. If a pull still fails, check the registry pod, `http://127.0.0.1:5000/healthz` and `registries.yaml` as described in [Pushing to or pulling from the registry fails](#registry-errors).
4. For an image that is in neither place, re-run the installer. It rebuilds or re-imports the images from the host's Docker store and pushes them to the registry, so keep that store as the recovery copy.

### The host's address changed {#host-address-changed}

**Cause**

An install is bound to the IP address it was installed on. The k3s node, the network policies, the panel certificate and the default `<ip>.nip.io` root domain all use it. When the host loses that address (a DHCP lease that came back different, a moved virtual machine), the cluster and the game proxy keep using the old address and the panel stops answering on its old name. The installer warns at install time when the address is a DHCP lease.

**Diagnosis**

The watchdog reports the finding `host-address` (critical, after 5 minutes): `this host no longer holds <ip>, the address the install was made on (it has: …)`.

```bash
ip -brief address
journalctl -u felis-watchdog -n 40
```

**Resolution**

1. Give the host its old address back, either as a DHCP reservation on the router or as a static address. With NetworkManager (for example on Rocky Linux):

   ```bash
   sudo nmcli con mod <connection> ipv4.method manual ipv4.addresses <ip>/<prefix> ipv4.gateway <gateway> ipv4.dns <dns>
   sudo nmcli con up <connection>
   ```

2. Restart felis-api and the game proxy:

   ```bash
   sudo k3s kubectl -n felis rollout restart deploy/felis-api
   sudo systemctl restart felis-velocity
   ```

Moving an install to a new address means reinstalling onto a restored backup; see [Moving to another host](/en/operations/backup#move-host). With the default `<ip>.nip.io` root domain, run `sudo felis domain set <new-ip>.nip.io` once the install runs on its new address ([Changing the root domain](/en/operations/access#change-domain)).

::: info
A hostname change is harmless. The installer pins the k3s node name in `/etc/rancher/k3s/config.yaml.d/50-felis.yaml` (`node-name:`), and every local volume is bound to that name. Check the pin with `sudo k3s kubectl get node -o jsonpath='{.items[0].metadata.annotations.k3s\.io/node-args}'`.
:::

### k3s certificates are about to expire {#k3s-certificates}

**Cause**

k3s issues its client and serving certificates (API server, kubelet, admin kubeconfig, etcd) for 365 days and its CA certificates for ten years. It renews the client and serving certificates only when it starts, reissuing every one that has expired or expires within 120 days. A host that restarts k3s inside that window, through a reboot or a k3s upgrade, renews them automatically. A host that runs a year without restarting k3s loses its API server and node the day they lapse, and the panel can no longer start, stop or back up servers. A restart never renews a CA certificate.

**Diagnosis**

The watchdog reports the certificate that expires first as `k3s-certs`: a warning 30 days before expiry, critical in the last 7 days and after expiry. Its hint says whether a restart renews the certificate.

```bash
sudo k3s certificate check --output table
```

**Resolution**

1. Restart k3s, then check again; renewed certificates show about a year of validity:

   ```bash
   sudo systemctl restart k3s
   sudo k3s certificate check --output table
   ```

   The restart stops k3s alone: game servers, PostgreSQL and the control plane keep running, and the API server returns within a minute. `k3s-killall.sh` stops every container; do not use it for this.
2. To renew every client and serving certificate ahead of the 120-day window, for example to align with a maintenance slot:

   ```bash
   sudo systemctl stop k3s && sudo k3s certificate rotate && sudo systemctl start k3s
   ```

3. A CA certificate needs `k3s certificate rotate-ca` and the procedure in the [k3s certificate documentation](https://docs.k3s.io/cli/certificate).

The panel's own certificate (`/etc/felis/panel-tls.crt`) is separate from this check; see [Panel TLS certificate](/en/operations/access#tls). `felis watchdog -k3s-cert-dirs ""` turns the certificate check off.

### The system clock is not synchronized {#clock}

**Cause**

Sign-in codes and sessions expire by the system clock, S3 refuses off-site uploads signed more than 15 minutes off, and certificate checks fail on a clock that is far off. The installer turns NTP on (`timedatectl set-ntp true`, installing chrony where no client exists) unless `FELIS_MANAGE_TIME_SYNC=0`. A firewall that drops outbound UDP port 123 keeps the clock unsynchronized.

**Diagnosis**

The watchdog reports the finding `clock` (warning, after 30 minutes).

```bash
timedatectl          # expect "System clock synchronized: yes" and "NTP service: active"
chronyc sources
```

**Resolution**

1. Turn NTP on:

   ```bash
   sudo timedatectl set-ntp true
   ```

2. Allow outbound UDP port 123 to the time servers.
3. Check `chronyc sources` until a source is selected and `timedatectl` reports the clock as synchronized.

## Backups and the database {#backups-database}

These entries cover world backups, the world cleanup, downloads, the control-plane database and its backups, and the off-site copy. Restore and rebuild procedures are on [Backup and restore](/en/operations/backup).

### A world backup is refused or fails {#backup-failures}

**Cause**

A backup runs as a Job that archives the server's whole data volume. A stopped server is archived as it is; a running server gets a live backup, during which saving pauses while the world is copied. Before a backup starts, felis-api checks the limits set in `[archive]` or on the **Backup and audit retention** card.

| Answer or message | Cause | Resolution |
| --- | --- | --- |
| `429 backup_cooldown` | One owner-started backup per server per cooldown window (`manual_cooldown`, default 10 minutes). | Retry after the time in `Retry-After`. Administrators are exempt. |
| `507 backup_store_full` | Present backups add up to the backup store cap (`max_local_bytes`). | Delete backups that are no longer needed, or raise the cap. Administrators are exempt. |
| `not enough free disk for the archive` | The archive would leave less than 10% of the archive filesystem free. | Free disk space ([Recovering from a full disk](/en/operations/storage#disk-full)). |
| `409 not_stopped`, `the server is starting or stopping; back it up once it is running or stopped` | The server is between states. | Retry once it is running or stopped. |
| `503 live_backup_console` | The game did not answer `save-off` or `save-all flush` over RCON: RCON is off or unreachable. | Retry, back the server up while stopped, or turn RCON on with `sudo felis converge -user-rcon` ([A newer setting never reaches an existing server](#system-server-fields)). |
| `409 maintenance_in_progress` | A restore, another backup, a file change, a world download or the world cleanup holds the world, or a restart is under way. | Retry once that operation ends. |
| `409 not_stopped`, `stop the server before backing up its world` | This felis-api cannot back up a running server. | Stop the server first. |
| `409 restore_in_progress` when deleting a backup | A restore may be reading the archive. | Wait for the restore to finish. |
| A backup is marked **Corrupt** | Reading the archive back did not match its recorded checksum. | It cannot be restored. It is kept until it expires and can be deleted by hand. |

Scheduled backups (daily restore points) follow the same limits. While the store is full, felis-api logs `scheduled backups paused` and starts none; a failed scheduled backup is retried after a quarter of `scheduled_every` (6 hours by default). felis-api logs `scheduled backups off (needs the backup executor)` at startup when it lacks `FELIS_IMAGE` or `FELIS_BACKUP_PVC`.

**Diagnosis**

1. Open the server's **Backups & restore** page. **Recent operations** shows each backup, restore, scheduled backup and download with the error its Job exited on.
2. List the Jobs that act on the server's world and read the log of a failed one:

   ```bash
   sudo k3s kubectl -n minecraft get jobs -l felis.lolicon.best/server=<name>
   sudo k3s kubectl -n minecraft logs job/<job>
   ```

**Resolution**

Act on the cause in the table. A live backup also needs scratch space on the same node at least as large as the world; free space when the copy step refuses to start. To back up every world before maintenance, use `felis backup-now` ([Backing up all worlds](/en/operations/backup#backup-now)).

### The world cleanup Job fails {#world-cleanup-failed}

**Cause**

The world cleanup runs once a day as a Job in the `minecraft` namespace. On every install it expires old backups and reads archives back to verify them. With a worlds root configured, it also archives and removes worlds idle for more than 15 days and carries out servers given up or deleted in the panel. A world is never removed without a confirmed backup, so a failed run keeps the worlds. The run fails (exits 1) when any of these counters in its summary line is above zero: `skipped` (servers the run failed on), `expire_failed` (expired backups it could not remove), `corrupt` (archives that failed verification and are now marked **Corrupt**) or `verify_failed` (archives that could not be read; retried next run). The Job retries twice.

**Diagnosis**

The watchdog mails `world reaper Job … failed`, and after 26 hours without a successful run `the world reaper has not succeeded for …`; the Prometheus alert is `FelisWorldJobFailed`. Read the log, especially the error above the summary line:

```bash
sudo k3s kubectl -n minecraft get jobs | grep felis-reaper
sudo k3s kubectl -n minecraft logs job/<felis-reaper-job>
```

The summary line looks like this:

```
felis reaper: evaluated=12 reaped=1 released=0 deleted=0 awaiting_offsite=0 awaiting_stop=0 warned=2 skipped=0 store_full=0 evicted=0 expired=3 expire_failed=0 verified=6 corrupt=0 verify_failed=0 swept=0 orphan_archives=0
```

| Counter | Meaning |
| --- | --- |
| `store_full` | Worlds kept because the backup store is full. |
| `awaiting_stop` | Idle servers left for the next run because they were not yet stopped. A server that stays here for days is being started again, or a Job keeps holding its world. |
| `awaiting_offsite` | Worlds archived but kept until the archive's off-site copy is confirmed. Above zero for more than a day means the off-site copy is failing. |
| `orphan_archives` | Archives no backup record points to. They are removed once older than the retention, and each run lists the first few by path. |
| `evaluated=0` | No worlds root is configured (`FELIS_WORLDS_HOST_PATH`). The run only expires backups and verifies archives; idle worlds are neither archived nor released, and servers given up or deleted in the panel wait. |

**Resolution**

1. Fix the error named above the summary line. A server that fails every day keeps its world and fails the Job every day until the cause is fixed.
2. `store_full`: free space in the backup store or raise its cap.
3. `awaiting_offsite`: see [The off-site copy has stopped](#offsite-stopped).
4. Idle worlds are tracked by player joins. If the game proxy cannot deliver join events, an actively played world can become eligible for cleanup after 15 days; see [Players cannot join](#players-cannot-join) and [Internal API errors](#internal-api-errors). Unowned servers get no warning mail before cleanup; claim servers you want to keep, or exempt them with `spec.reaperExempt: true`. Retention and warnings are described in [World cleanup](/en/operations/backup#world-cleanup).

### A backup or world download fails {#download-failures}

**Cause**

A download runs a `felis-export` Job that streams the archive through felis-api to the browser. A world export needs the server stopped and holds the world until the download ends, so the server cannot start meanwhile.

| Answer or message | Cause |
| --- | --- |
| `429 export_busy` | Limits reached: one export per user at a time, two across the platform, six per user per hour. |
| `410 export_expired` | The Job did not reach felis-api within 10 minutes. |
| `503 export_unavailable` | felis-api runs without `FELIS_IMAGE` or `FELIS_BACKUP_PVC` and logs `world export disabled` at startup. |
| `409 not_stopped`, `409 no_world_volume` | A world export needs a stopped server with a world volume. |
| `409 backup_corrupt` | The archive no longer matches its recorded checksum. The download is cut off short. |
| `felis-api answered 410 Gone: this export has expired …` | The download was not opened within 90 seconds of being ready (the tab was closed, or the browser blocked the download). |
| `felis-api answered 410 Gone: the download ended before the archive did …` | The browser cancelled or lost the connection. |
| `felis-api answered 404 Not Found: no such export` | felis-api restarted since the export began, or the ticket had run out. |

**Diagnosis**

The reason appears under **Recent operations** on the server's **Backups & restore** page as the Job's last line.

**Resolution**

1. Start the export again once the cause is resolved; keep the tab open until the browser has saved the file.
2. A world export whose Job never reaches felis-api holds the world until the Job's two-hour deadline. Release it at once:

   ```bash
   sudo k3s kubectl -n minecraft delete job -l app.kubernetes.io/managed-by=felis-export,felis.lolicon.best/server=<name>
   ```

### The database backup is overdue or incomplete {#database-backup-overdue}

**Cause**

`felis-db-backup.timer` runs `felis db backup` daily at `FELIS_DB_BACKUP_TIME` (default `*-*-* 03:30:00`, plus up to 15 minutes of random delay). Every check watches the newest daily bundle with a 26-hour limit; a newer manual, pre-upgrade or off-site bundle can be restored but leaves the alarm standing, because the daily timer is still broken. Common causes:

- felis-postgres is not running: `kubectl exec` finds no running pod, or `pg_dump: … connection refused` ([The database is unavailable](#database-unavailable)).
- `k3s: executable file not found`: `felis` ran with neither `/usr/local/bin` on `PATH` nor k3s elsewhere.
- The backup directory's disk is full. The half-written file is removed and earlier bundles stay intact.
- `pg_dump: server version mismatch`: an external database is newer than the host's client tools.

A bundle is **Incomplete** when the cluster did not answer the export of the MinecraftServer objects three times running. The bundle still holds the database, but a restore from it brings back no servers; `felis db backup` then exits 1. An upgrade stops with `pre-migration backup failed, nothing applied` for the same causes and applies no migration.

**Diagnosis**

The **Control-plane database backup** card on **Maintenance & Backups → Backups** shows **Overdue**, **Never backed up** or **Incomplete** together with the commands to fix it. The watchdog mails the owners. On the host:

```bash
sudo felis db check                                   # exits 1 with the reason
sudo felis db list                                    # every bundle with its age
sudo systemctl status felis-db-backup.timer
sudo journalctl -u felis-db-backup -n 50 --no-pager
```

The Prometheus alerts are `FelisDBBackupStale` and `FelisDBBackupMetricMissing`. The second fires when node-exporter's textfile collector does not read the directory of `FELIS_DB_BACKUP_METRICS` (default `/var/lib/node_exporter/textfile_collector/felis_db_backup.prom`).

**Resolution**

1. Fix the cause shown in the journal. For a version mismatch with an external database, install the matching `postgresql` client package.
2. Run the daily backup now, which clears the alarm:

   ```bash
   sudo systemctl start felis-db-backup.service
   ```

3. For an **Incomplete** bundle, wait until `sudo k3s kubectl get minecraftservers -A` answers, then run `sudo felis db backup`.

Schedule, retention and restore are described in [Database backups](/en/operations/backup#database-backups).

### The off-site copy has stopped {#offsite-stopped}

**Cause**

`felis-offsite.timer` copies world archives, database bundles, user images and uploads to the bucket every hour. The watchdog and the **Off-site copy** tab (**Needs attention**) report these states:

| Message | Cause |
| --- | --- |
| `the off-site copy last completed … ago` | No sync has completed for 12 hours (network, credentials, bucket, clock). The mail adds the last error. |
| `the off-site copy has never completed; …` | The first sync has not succeeded. |
| `the off-site copy has stopped: the bucket's objects are sealed with another key, …` | `/etc/felis/offsite.env` holds a different key than the one the bucket was written with, for example after a reinstall that generated a new key. The installer ends with `OFF-SITE COPY STOPPED`. |
| `the off-site copy has stopped: <host> took the bucket over, …` | Another host ran `felis offsite take-over`. |
| `this host was built from another host's backup and copies nothing into the off-site bucket: …` | This host was restored from a bundle and stands by while another host writes the bucket. |
| The installer ends with `NO OFF-SITE COPY` | No bucket is configured. |

One object that the uplink cannot send within 10 minutes plus its size at 512 KiB/s fails alone, stays pending and is retried on the next pass.

**Diagnosis**

```bash
sudo felis offsite status        # last run, errors, bucket contents, pending items; exits 1 after 12 hours without a sync
sudo felis offsite check-key     # whether offsite.env holds the bucket's key
sudo journalctl -u felis-offsite -n 50 --no-pager
systemctl list-timers felis-offsite.timer
```

`missing:` lines in `status` are archives removed from the volume by hand; nothing is left to copy for those. `not whole:` lists images the registry lost during a run.

**Resolution**

- **Transient failure:** fix the network, credentials or clock ([The system clock is not synchronized](#clock)), then run a sync with `sudo systemctl start felis-offsite.service` or **Copy now** on the card.
- **Wrong key:** set `FELIS_OFFSITE_KEY` in `/etc/felis/offsite.env` to the bucket's key and run a sync, or point `[offsite]` at an empty bucket or prefix and re-run the installer ([Encryption key](/en/operations/backup#offsite-key)).
- **Taken over by mistake** (for example by a rehearsal machine): run `sudo felis offsite take-over -yes` on the production host.
- **Standing by after a rebuild:** once this host permanently replaces the old one, run `sudo felis offsite take-over -yes` ([Rebuilding a host](/en/operations/backup#rebuild-host)).
- **Timer missing:** re-run the installer.

### The database is unavailable {#database-unavailable}

**Cause**

The control-plane database runs as the `felis-postgres` Deployment, with its data in `/var/lib/felis/postgres` on the host. When it is unavailable, sign-in, the panel and server management fail.

| Symptom | Cause | Resolution |
| --- | --- | --- |
| `ImagePullBackOff` or `ErrImagePull` on `postgres` | The node cannot reach Docker Hub and has no copy. | Import the image as described in [Pushing to or pulling from the registry fails](#registry-errors). |
| `CreateContainerConfigError`, `secret "felis-postgres" not found` | The superuser Secret is gone. | Re-run the installer, which creates a new one. |
| The log shows `Permission denied` on `/var/lib/postgresql/18/docker` | The data directory lost its owner (uid 999) or, with SELinux enforcing, its `container_file_t` label. | Re-run the installer, or run `sudo chown -R 999:999 /var/lib/felis/postgres` and `sudo restorecon -R /var/lib/felis/postgres`. |
| The log shows `database files are incompatible with server` | The data was created by another PostgreSQL major version. | Follow [PostgreSQL major upgrades](/en/operations/upgrade#postgresql-major). |
| `Pending`, `Insufficient memory` | The node has no room for the pod. | Free memory on the node. |
| felis-api in `CrashLoopBackOff` with `database schema is newer than this felis build: …` | felis-api was rolled back across an upgrade that migrated the database. | Restore the `pre-migrate` bundle the upgrade took ([Rollback](/en/operations/upgrade#rollback)). |
| `database schema is behind this felis build` | Migrations are missing. | Run `sudo felis migrate up -config /etc/felis/felis.host.toml`. |
| `audit: lost …` in the felis-api log, alert `FelisAuditWriteFailing` | Audit rows cannot be written, almost always because PostgreSQL is failing. | Check the database as below. |
| Requests slow down; `canceling statement due to statement timeout` | Requests queue for one of the 25 pool connections, or a statement exceeded 15 seconds. | Look for a slow query or a lock with `pg_stat_activity`. |

The installer stops with `felis-postgres did not become ready` after 10 minutes and prints the pod's events. The watchdog mails `PostgreSQL is unreachable: …` after 3 minutes.

**Diagnosis**

```bash
sudo k3s kubectl -n felis get pods -l app.kubernetes.io/component=postgres -o wide
sudo k3s kubectl -n felis describe deploy/felis-postgres | tail -n 30
sudo k3s kubectl -n felis logs deploy/felis-postgres --tail=60
```

To query the database by hand as the superuser:

```bash
sudo k3s kubectl -n felis exec -it deploy/felis-postgres -c postgres -- psql -U postgres felis
```

```sql
SELECT pid, state, wait_event, query FROM pg_stat_activity;
```

**Resolution**

Apply the fix in the table. To undo a mistaken change or recover damaged data, restore a database bundle as described in [Restoring the database](/en/operations/backup#restore-database).

## Mail and alerts {#mail-alerts}

### Mail is not delivered {#mail-problems}

**Cause**

One mail relay delivers sign-in codes, email verification and identity confirmations, world cleanup warnings, watchdog alerts and break-glass codes. A relay saved on the panel's **Mail delivery** card overrides the `[smtp]` relay that `felis setup` wrote into `felis.toml`.

| Symptom | Cause | Resolution |
| --- | --- | --- |
| `503 mail_unavailable` | No relay is configured. Sign-in works by passkey only. | Configure a relay (below). |
| `429 mail_rate_limited`, alert `FelisMailBudgetExhausted` | The hourly mail cap is spent (`[smtp] max_per_hour` or **Hourly mail cap**, default 120, of which a quarter may go at once). | Check `felis_rate_limited_total` for a flood. If the sign-ins are genuine, raise the cap to what the relay allows. |
| `502 mail_undeliverable`, alert `FelisMailDeliveryFailing` | The relay refused the mail. | Read the relay's reason in the felis-api log. |
| `smtp: <host>:<port> does not offer STARTTLS`, or `smtp_tls` on the card | The relay is on a port other than 465 and does not offer STARTTLS. | Use port 465 or a relay with STARTTLS (below). |
| `smtp_unreachable` | The relay cannot be reached, its port is not 25, 465, 587 or 2525, or it resolves to a link-local, unspecified or multicast address. | Correct the host and port. |
| `smtp_auth` | The relay rejected the credentials. | Correct the user name and password. |
| `smtp_sender_refused`, `smtp_recipient_refused` | The relay refused the sender or the recipient. | Use a sender address the provider has authorized, and check the recipient address. |
| `409 mail_settings_changed` | The relay changed since the card was loaded. | Reload and save again. |
| The install ends with `NO ALERT MAIL`; alerts appear only in the journal | No relay, or no Owner with a verified email address. | Configure a relay and verify the Owner's address. |
| `reaper: warning suppressed — no warner wired` in the world cleanup log | No relay, or the owner has no verified address. | Configure a relay. The pending warning is sent on the next daily run while the warning window lasts. |

**Diagnosis**

1. Open **Platform settings → Notifications and retention**. The **Mail delivery** card shows which relay is in force: **Panel settings**, **Install-time settings** or **Not configured**.
2. Select **Send test message**. It sends one message through the relay as typed to the Owner's verified address and names the failing stage. Each test counts against the hourly cap.
3. Read the relay's own error text, which the panel does not show:

   ```bash
   sudo k3s kubectl -n felis logs deploy/felis-api | grep -i smtp
   journalctl -u felis-watchdog -n 40
   sudo felis doctor
   ```

**Resolution**

1. On the **Mail delivery** card, enter the relay and select **Check and save**. Felis delivers one self-test message to the sender address and saves only once the relay has accepted it. The sender must be a plain address without a display name.
2. Alternatively, run `sudo felis setup` and configure email. Saving there writes `[smtp]` and also clears a relay saved in the panel, so the relay typed in setup is the one in force. Change the relay password through `felis setup`; a hand edit of the `felis-smtp` Secret lasts only until the next installer run.
3. For a relay without STARTTLS reached over a trusted network, turn off **Require an encrypted connection** on the card, or set `require_tls = false` under `[smtp]` in `/etc/felis/felis.toml` and `/etc/felis/felis.pod.toml`.
4. For alert mail, verify the Owner's email address under **Account → Email Verification**.

Sign-in limits and locked accounts are covered in [Sign-in problems](#sign-in-problems). The relay, the watchdog and the heartbeat are described in [Mail relay](/en/operations/monitoring#mail-relay), [Watchdog](/en/operations/monitoring#watchdog) and [Heartbeat](/en/operations/monitoring#heartbeat).

## Files and scheduled tasks {#files-schedules}

### The file manager refuses a change or an upload {#file-manager-errors}

**Cause**

The **Server Files** page is available to the server's owner and administrators while running or fully stopped. Wait for startup or shutdown to finish during a transition. Backups, restores and migrations block file operations. Stopped writes take a maintenance lock. Live file operations access the same volume on the game server's node without taking that admission lock or preventing shutdown. Modifying world directories or extracting an archive while running requires the panel's risk acknowledgement checkbox.

| Status | Code | Meaning | Resolution |
| --- | --- | --- | --- |
| `409` | `not_stopped` | The game pod still exists, usually finishing its shutdown save. | Retry once `sudo k3s kubectl -n minecraft get pods -l felis.lolicon.best/server=<name>` shows nothing. |
| `409` | `server_transitioning` | The server is starting or stopping. | Wait until it is running or fully stopped, then retry. |
| `409` | `maintenance_in_progress` | Another change, a backup, a restore or the world cleanup holds the world. | Retry once that operation ends. |
| `409` | `file_exists` | Something exists at the path of a new file, folder, rename or upload. | Choose another name, or select **Replace** for an upload. |
| `409` | `file_changed` | The file changed after the editor read it. | Select **Load latest** or **Overwrite anyway**. |
| `400` | `bad_path` | The path leaves the world volume, or it would move `server.properties`, `config` or `config/paper-global.yml`, or read `config/paper-global.yml`. | These three keep their names; `paper-global.yml` holds the forwarding secret shared by every server. |
| `404` | `not_found` | The path, or a new folder's parent, no longer exists. | Select **Refresh**. |
| `413` | `too_large` | A read over 1 MiB, a save over 256 KiB, or a single-request upload over 64 MiB. | Upload a large file whole instead of editing it. The panel sends files over 64 MiB in parts automatically. |
| `411` | `length_required` | An upload without `Content-Length`. | Upload from the panel, or with `curl -T`. |
| `400` | `upload_incomplete` | The body ended before its declared length. Nothing changed. | Retry. |
| `507` | `upload_staging_full` | Staging the upload would leave felis-api's staging filesystem under 10% free. | Free space on the uploads volume. |
| `507` | `volume_full` | The world volume is full. The old file is unchanged. | Delete files the server no longer needs, or grow the volume. |
| `504` | `files_timeout` | felis-api stopped waiting after 90 seconds. | The Job may still finish (below). |
| `503` | `files_unavailable` | felis-api runs without the file Job runner, or without upload staging. | Check felis-api's startup log. |
| `404` | `upload_not_found` | A large upload's session is gone: cancelled, finished, idle for 6 hours, or felis-api restarted. | Upload the file again. |
| `429` | `too_many_uploads` | The account already has 4 large uploads in progress. | Finish or cancel one. |
| `429` | `export_busy` | Download limits: two per user at a time, four across the install, 30 per user per hour. | Retry later. |

`upload_offset_mismatch`, `upload_busy` and `409 upload_incomplete` during a multi-part upload are handled by the panel, which resumes on its own. Extracting a `.zip` checks every entry before writing anything and changes nothing on failure: `archive_unsafe` (an entry leaves the folder), `archive_symlink` (an entry is a link), `type_conflict` (a file where the server has a folder, or the reverse), `archive_invalid` (an entry's size differs from the archive's declaration) and `volume_full`. Without replace, an archive that would overwrite files ends `file_exists` with the list, which the panel shows for confirmation. Folders cannot be uploaded; upload them as a `.zip` and extract it.

**Diagnosis**

```bash
sudo k3s kubectl -n minecraft get jobs -l felis.lolicon.best/server=<name>,app.kubernetes.io/managed-by=felis-files
sudo k3s kubectl -n minecraft get jobs -l felis.lolicon.best/server=<name>,felis.lolicon.best/files-async=true
sudo k3s kubectl -n minecraft logs job/<job>
```

A finished Job and its log are kept for two minutes; a large upload or extraction that failed without a result keeps its log for 30 minutes. The Job's log names the cause when it could not fetch the staged upload or the bytes did not match.

**Resolution**

Act on the code in the table. After `files_timeout`, the Job runs on to its own two-minute deadline and may still apply the change; it holds the world until it ends. Select **Refresh** once the Job is gone to see whether the change landed. Large uploads and extractions run up to 2 hours in the background and continue when the page is closed; a failure there shows the code above, or `job_failed` with the Job's condition (`DeadlineExceeded` after 2 hours).

### A scheduled task is skipped, missed or failed {#schedule-errors}

**Cause**

felis-api checks scheduled tasks every 15 seconds and records the result of each run on the **Scheduled tasks** page. A command, restart or stop runs only while the server is running, and a start only while it is stopped. A backup of a running server is taken live; when that is not possible, the server is stopped, backed up and started again. A step has a deadline: the pod must stop within 15 minutes, the backup Job must end within 45, and the start gets 15. A restart or backup that cannot finish still starts the server again if it was running before.

| Result | Detail | Resolution |
| --- | --- | --- |
| Skipped | `the server has a new owner since this schedule was saved; save it again to use it` | Ownership changed and the task switched itself off. The new owner reviews the task and saves it to turn it back on. |
| Skipped | `the server was not running`, `the server was already stopped`, `the server was already running`, `the server has no world yet`, `the server is being given up or deleted`, `the server no longer exists`; for a start also `the cluster is at its running-server cap` or `the world is busy with …` | The run had nothing to act on. The next run tries again. |
| Missed | `felis-api was not running at the scheduled time` | felis-api was down for more than 10 minutes past the time. The run is dropped; the next one runs as usual. |
| Failed | `felis-api stopped in the middle of this run` | felis-api restarted during the run. Check that the server is in the state you want. |
| Failed | `the server did not stop within 15 minutes` | See [A server does not stop](#server-wont-stop). The backup did not run. |
| Failed | `another operation kept the world busy for 15 minutes` | A restore, file change or another backup held the world. |
| Failed | `the backup failed: …`, `the backup did not finish within 45 minutes`, `the backup store is full; ask an administrator to free space` | See [A world backup is refused or fails](#backup-failures). The **Backups & restore** page shows the Job. |
| Failed | `could not start the server again: …` | The server stopped and could not start again (running-server cap, a server being given up, or a world still busy after 15 minutes). Start it from the panel once the cause is gone. |
| Failed | `the server console could not be reached`, `the console is not configured`, `the command failed: …` | RCON is unreachable or off. See [A server is stuck starting](#server-stuck-starting) and [A newer setting never reaches an existing server](#system-server-fields). |

While a run is in progress the task cannot be edited, deleted or run again (`409 schedule_running`).

**Diagnosis**

Each task row shows its last result and detail. The audit log records every finished run as `schedule.run` with its result and detail ([Audit log](/en/guide/administration#audit-log)).

**Resolution**

Act on the detail in the table. Timing rules that explain unexpected run times:

- A time that the clock skips at a daylight-saving change runs an hour early; a time it repeats runs once, the first time.
- A time zone the host no longer knows runs in UTC.
- **Run now** starts a run at once, also on a task that is off, and leaves the next planned run unchanged.
- Deleting a server deletes its tasks; a new server with the same name starts with none.

## Quick reference {#quick-reference}

| Symptom | See |
| --- | --- |
| Where to start: status, health check, support bundle, logs | [First steps](#first-steps) |
| The platform did not come back after a reboot; k3s, the game proxy or another service is not running | [Platform services are not running](#services-down) |
| Server stuck in `Starting`; `PodNotReady`, `RconNotReachable` | [A server is stuck starting](#server-stuck-starting) |
| Server in `Failed`; `StartupTimeout`, `ReadinessTimeout` | [A server is in Failed](#server-failed), [A newer setting never reaches an existing server](#system-server-fields) |
| A server does not stop | [A server does not stop](#server-wont-stop) |
| The **Login & lobby** page reports that the login space or the lobby does not exist | [The login space or the lobby is missing](#system-servers-missing) |
| Server never stops when empty; player count always 0; `PlayersCounted` is `False` | [A server never stops when empty](#idle-stop) |
| Players cannot join or land in the wrong place; wake refused | [Players cannot join](#players-cannot-join) |
| Routing disabled | [Routing is disabled](#routing-disabled) |
| Panel answers 401 or 403 | [Panel errors](#panel-errors) |
| Sign-in refused: `rate_limited`, `otp_account_locked` | [Sign-in problems](#sign-in-problems) |
| Game proxy or plugins get 401 from the internal API | [Internal API errors](#internal-api-errors) |
| Account linking or claim errors | [Account linking errors](#account-link-errors) |
| Build failed; scan blocked; `context_changed`; `uploads_full` | [An image build fails](#build-failures) |
| Build stays **Queued**; `ImagePullBackOff` on `mirror/kaniko-executor`; `failed to download vulnerability DB` | [Build pods do not start](#build-pods-not-starting) |
| Registry push or pull fails; writes answer `503`; `could not pull …` on an air-gapped host | [Pushing to or pulling from the registry fails](#registry-errors) |
| `image_not_in_registry`, `registry_unavailable`, `image_change_unconfirmed`; moving a world to a newer Minecraft | [Creating a server or changing its image is refused](#game-images) |
| A server running server software fails to start; errors in the `install-server` log | [Server software installation fails](#software-install) |
| `runtime_unavailable`; `ImagePullBackOff` on `mirror/eclipse-temurin` | [Java runtime unavailable](#runtime-unavailable) |
| The installer builds images on the host during a release install | [The installer builds images on the host](#host-build-fallback) |
| Lobby console dead; older servers lack RCON or idle stop; `felis converge` | [A newer setting never reaches an existing server](#system-server-fields) |
| `409 world_volume_exists`; volume left after deleting a server | [A deleted server's world volume remains](#world-volume-kept) |
| Pods evicted; `DiskPressure`; filesystem alerts | [Pods are evicted when the disk fills](#disk-full-symptoms), [Recovering from a full disk](/en/operations/storage#disk-full) |
| Watchdog `host-address`; panel unreachable after an address change | [The host's address changed](#host-address-changed) |
| Watchdog `k3s-certs` | [k3s certificates are about to expire](#k3s-certificates) |
| Watchdog `clock`; S3 refuses off-site uploads | [The system clock is not synchronized](#clock) |
| `backup_cooldown`, `backup_store_full`, `live_backup_console`, `not enough free disk for the archive` | [A world backup is refused or fails](#backup-failures) |
| World cleanup Job failed; `awaiting_stop`; a backup marked **Corrupt** | [The world cleanup Job fails](#world-cleanup-failed) |
| Download refused or cut off: `export_busy`, `export_expired`, `export_unavailable` | [A backup or world download fails](#download-failures) |
| Database backup **Overdue**, **Never backed up** or **Incomplete**; `FelisDBBackupStale`; `pre-migration backup failed, nothing applied` | [The database backup is overdue or incomplete](#database-backup-overdue) |
| `the off-site copy last completed … ago`; `OFF-SITE COPY STOPPED`; `awaiting_offsite` stays above 0 | [The off-site copy has stopped](#offsite-stopped) |
| `felis-postgres did not become ready`; `database schema is newer than this felis build` | [The database is unavailable](#database-unavailable) |
| Undo a mistaken change; restore the database | [Restoring the database](/en/operations/backup#restore-database) |
| The host is lost | [Rebuilding a host](/en/operations/backup#rebuild-host) |
| An upgrade went wrong | [Rollback](/en/operations/upgrade#rollback) |
| `mail_unavailable`, `mail_rate_limited`, `smtp_tls`; `NO ALERT MAIL` | [Mail is not delivered](#mail-problems) |
| Alert mail from the watchdog; `NO HEARTBEAT` | [Watchdog](/en/operations/monitoring#watchdog), [Heartbeat](/en/operations/monitoring#heartbeat) |
| No administrator can sign in | [Emergency access](/en/operations/access#break-glass) |
| Server Files: a change, upload or extraction refused | [The file manager refuses a change or an upload](#file-manager-errors) |
| A scheduled task shows Skipped, Missed or Failed | [A scheduled task is skipped, missed or failed](#schedule-errors) |
| A worker node is offline and its servers are down | [Failover](/en/guide/distributed#failover) |
