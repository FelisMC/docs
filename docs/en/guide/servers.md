---
title: Managing servers
description: Create, claim, start, stop and maintain Minecraft servers in the panel, including the console, players, files, scheduled tasks and backups.
---

# Managing servers {#servers}

This page explains how to create and claim servers in the Felis panel, control when they start and sleep, and use the console, player management, the file manager, scheduled tasks and backups. It is written for server owners, Admins and the platform Owner.

## Permissions {#permissions}

What you can do depends on your account role and on who owns the server. In the table below, "server owner" is the account that claimed or created the server; "Owner" is the platform Owner role, which has every Admin right.

| Action | Who |
| --- | --- |
| Create a server | Admin; an account with a server quota can create servers of its own, see [Self-service creation](#self-service) |
| Edit the server configuration | Admin; server owners can change their own servers, except the image |
| Claim an unowned server | Any account with a linked Minecraft account |
| Start a server | Server owner, Admin; other players as the [autostart policy](#autostart) allows |
| Stop, console, player management, files, scheduled tasks, backups and restore | Server owner, Admin |
| Give up a server | Server owner, Admin |
| Delete a server | Admin |
| Forwarding mode, emergency stop | Owner |

Admins see every server on the platform on the **Servers** page, with its owner, online players and autostart policy. Users see the servers they own and the servers they can claim. For the roles, see [Roles](/en/guide/administration#roles).

## Creating a server {#create-server}

A server an Admin creates is stopped and belongs to no account until a user claims it. See [Claiming a server](#claim). An account with a server quota can create servers it owns itself; see [Self-service creation](#self-service).

1. Open **Servers** and select **New server**.
2. Under **Runs on**, select **Server software** or **Whitelisted image**. Regular accounts can select server software only.
3. Fill in the fields:

   | Field | Description |
   | --- | --- |
   | Server software | The core, game version, build or loader version, and Java version. See [Server software](/en/guide/software#types). |
   | Image | With **Whitelisted image**, an image from the image whitelist. See [Images and Minecraft versions](#images-versions). |
   | Name | 3–32 lowercase letters, digits or hyphens, with no hyphen at either end. `login`, `lobby`, `admin`, `panel`, `console`, `api`, `felis`, `velocity`, `registry`, `internal` and `www` are reserved by the platform. |
   | Subdomain | Same rules as the name. Players reach the server at `<subdomain>.<root>`. |
   | Display name (optional) | The name shown in the panel and the lobby menu. |
   | Execution node | Shown to Admins only, in a multi-node deployment: an online, approved node. See [Multi-node and high availability](/en/guide/distributed#overview). |
   | Memory | 2Gi, 4Gi (default), 6Gi or 8Gi; used as the Java heap and the container memory limit. |
   | Storage | Size of the world volume: 5Gi, 10Gi (default), 20Gi or 50Gi. |
   | Autostart policy | Defaults to **Owner only — wake from the panel**. See [Autostart policy](#autostart). |

4. With server software, accept the Minecraft End User License Agreement (EULA).
5. Select **Create**.

A new server stops automatically after 600 seconds with nobody online. A server an Admin creates charges no user's quota; quotas are charged when the server is claimed. A name that matches the leftover world volume of a deleted server is refused until that volume is removed or another name is chosen.

### Self-service creation {#self-service}

**New server** appears on the **Servers** page, and the account can create servers it owns, when:

- It has a linked Minecraft account. See [Linking your account](/en/guide/players#account-linking).
- It has a server quota: the Owner set a quota for this account, or turned on the default quota under [Self-service servers](/en/guide/administration#self-service).

A self-created server runs server software only, and its resources count toward the account's quota. The panel shows the quota usage, and memory and storage sizes beyond the remaining quota cannot be selected. Once the server count reaches its cap, **New server** is unavailable. In a multi-node deployment the server is placed on the approved node with the fewest user servers. Server owners can give up their servers; deleting a server remains an Admin action, see [Giving up and deleting a server](#retire).

### Images and Minecraft versions {#images-versions}

A server that runs an image can use only enabled images from the image whitelist, which Admins maintain. See [Image whitelist](/en/guide/administration#images). Modpacks that players submit join the whitelist once they are reviewed and built. See [Submissions](/en/guide/administration#submissions).

- When a server is created, it is pinned to the build its image tag points to at that moment. When the tag later points to a new build, existing servers stay as they are.
- After you change the image under **Edit Server Config**, the server uses the build the tag points to now; selecting the same tag again also selects its latest build. A Minecraft version change may upgrade the world on the next start, and upgraded chunks cannot be used by older versions. Before saving, tick **I've backed up the world — change the image**.
- The game proxy passes the player's identity to servers with modern forwarding. For Paper-based images, Felis writes the forwarding settings before every start. Other server software must read the environment variable `FELIS_FORWARDING_SECRET` and enable Velocity modern forwarding itself, or use [legacy forwarding](#forwarding-mode).
- The login space and the lobby run the platform's Minecraft version; the client version players need is shown on the **Account** page. A target server may need another version or mods, which its owner announces.

## Claiming a server {#claim}

A server that belongs to no account can be claimed. The claiming account becomes the server owner, with console, whitelist and backup management rights, and its Minecraft UUID is added to the server's access whitelist.

To claim a server:

- The account must have a linked Minecraft account. See [Account linking](/en/guide/players#account-linking).
- The claim must fit the account's quota. See [Quotas](#quotas).
- The server must not be pending release or deletion.

You can claim:

- In the panel: on **Servers**, select **Claim** on a claimable server and confirm.
- In game: join the server and run `/felis claim`.
- In the lobby menu: click the **Claim & Start** tile. See [Joining](/en/guide/players#joining).

For claim errors, see [Account link and claim errors](/en/operations/troubleshooting#account-link-errors).

## Editing the server configuration {#edit-server}

On the server's console page, Admins and server owners select **Edit Server Config** to change the following; fields left unchanged keep their values:

- Display name and autostart policy.
- Server software. See [Changing the core or version](/en/guide/software#change).
- Image (Admins only). See [Images and Minecraft versions](#images-versions).
- Memory and CPU limit. Enter the CPU limit in cores (for example `1` or `1.5`) or millicores (for example `500m`); leave it empty for no limit.
- Idle auto-stop. See [Start, stop and sleep](#power).

Raising the CPU or memory of an owned server must fit the server owner's quota; lowering them is never held to it. The login space and the lobby are system services, which Admins manage under **Login & lobby**. See [Customizing the login space and lobby](/en/guide/players#customize-login-lobby).

## Start, stop and sleep {#power}

A server is in one of these states:

| State | Meaning |
| --- | --- |
| Running | The server is ready and players can join. |
| Starting | Resources are being scheduled, files prepared and images pulled, or Minecraft is starting and being checked for readiness. |
| Stopping | The world is being saved and the server shut down. |
| Stopped | The server is asleep and uses no memory or CPU. |
| Timed out · retrying | The start timed out; the system is recreating the runtime instance and retrying. |
| Failed to start | The automatic retry limit has been reached. |

### Starting {#start}

A server starts:

- When you select **Wake** on its console page.
- When a player joins its address, as the [autostart policy](#autostart) allows.
- When a player runs `/felis go <server>` in game or clicks its tile in the lobby menu.
- When a scheduled start task runs. See [Scheduled tasks](#schedules).

Every start is subject to the platform's running server limit and wake cooldown. See [Startup and wake policy](/en/guide/administration#wake-policy). A server pending release or deletion cannot start. While a backup, restore or file change is in progress, a start is refused with a maintenance notice.

While the server starts, its console page shows the current stage and diagnostics. When schedulable memory runs short, the page suggests reducing the server's memory, stopping other servers or adding node capacity. The default start budget is 300 seconds. After a timeout the system recreates the runtime instance up to 3 times, waiting longer before each attempt; if the server is still not ready, its state becomes **Failed to start**. Resolve the fault, then select **Retry start**. To investigate, see [Server stuck in Starting](/en/operations/troubleshooting#server-stuck-starting) and [Server failed to start](/en/operations/troubleshooting#server-failed).

### Stopping and idle auto-stop {#stop}

Select **Stop** on the console page. If players are online, the server sends them an in-game notice and disconnects them 30 seconds later before stopping; starting the server again within that window calls the stop off. When the online count cannot be read, the panel warns that players may still be connected and asks for confirmation.

A server whose online count stays at zero for the configured time stops automatically and releases its memory and CPU; the next join wakes it according to the autostart policy. New servers use 600 seconds. Admins change it, or set it to **Never**, under **Edit Server Config → Idle auto-stop**. The online count is read over RCON; while it cannot be read, idle auto-stop pauses and resumes once the count is readable again. The login space and the lobby never stop when idle.

### Emergency stop {#emergency-stop}

When a normal stop does not respond, the Owner can use an emergency stop:

1. On the server's console page, select **More actions → Emergency stop**.
2. Type the server's name and verify your identity.

The emergency stop first saves the stop intent, then sets the workload's replicas directly to zero, bypassing the game process and the operator while keeping the normal termination grace period. World data is not deleted; unsaved changes may be lost. An accepted request does not prove that the process has exited: the panel keeps checking the game pod and shows **Stopping** until it has gone.

::: warning
An emergency stop disconnects every player on the server at once. When the control API is offline, the panel cannot act on the cluster: expand **Host emergency shutdown procedure** and run its commands on the host in order. Do not resolve a lost control connection by force-deleting worlds, pods or PVCs.
:::

When the panel cannot read a server's state within 12 seconds, it shows the time of the last successful read and retries on its own. The state shown then is for reference only and does not prove that the game process is healthy.

## Autostart policy {#autostart}

The autostart policy decides who may wake a sleeping server. The server owner and Admins can always start it.

| Policy | Who can wake the server |
| --- | --- |
| Owner only — wake from the panel | Only the server owner and Admins. |
| Public — any player join wakes it | Any player who joins. |
| Wake list — previous players with wake permission can start the server | The server owner, Admins, and players on the wake list who hold wake permission. |

Admins set the policy under **Edit Server Config**. With the **Wake list** policy, a player is added to the list on their first join. The server owner or an Admin selects **Revoke** under **Player management → Wake list** to take the permission away and **Allow again** to restore it. Rejoining does not restore a revoked permission. When the server changes owner, the wake list is cleared.

A player without permission to wake the server is told in game that they cannot start it. When the platform is at its running server limit, the player is told to try again later.

## Console {#console}

The server's console page shows the live log and offers:

- The stream state (Live, Reconnecting, Stream ended) with **Reconnect**, **Clear** and **Jump to latest**. RCON connection lifecycle logs are hidden by default; show them with **Show RCON connection logs**.
- While the server runs, the **Server command** field runs console commands, for example `list` or `op <player>`.
- Links to player management, LuckPerms permissions, backups and restore, server files and scheduled tasks.

The console connects automatically once the server is running.

## Player management {#players}

The **Player management** page works over a live connection to the server, so it is available only while the server runs, to the server owner and Admins.

- **Whitelist**: enter a player name (1–16 letters, digits or underscores) and select **Add**, or select **Remove**. While the whitelist is turned on in the game (console command `whitelist on`), only listed players can join.
- **Online players**: see who is online and select **Kick** to disconnect a player.
- **Bans**: enter a full player name and select **Ban**; the player is kicked and blocked from rejoining. Select **Pardon** in the ban list to lift a ban.
- **Wake list**: see [Autostart policy](#autostart).

When the panel cannot parse the server's reply, **View raw server reply** shows the raw output.

### LuckPerms permissions {#luckperms}

When the server runs the LuckPerms plugin, the **LuckPerms Permissions** page manages a player's groups and permission nodes:

1. Select an online player on the left, or look up a player by name at the top.
2. Select **Add Parent Group** or **Remove Parent Group** to manage parent groups.
3. Enter a permission node, a value (grant or deny) and an optional world context, then select **Add Permission** or **Remove Permission**. Removal deletes the node in that world context whatever its value.

The page offers presets and keeps a **Recent Actions History**, from which **Revert** undoes a change. Changes by player name are reliable only for players who have joined since LuckPerms was installed.

## Server files {#files}

The **Server Files** page browses and repairs files in the world volume, for the server owner and Admins. A running server mounts its world volume exclusively, so stop the server completely before browsing or editing files. A new server that has not started yet can use it as well, for example to put a modpack, a world or a custom jar in place before its first start.

You can:

- Browse folders, create files and folders, rename and delete. Deletion is permanent; back up anything you need first.
- Edit text files online. The editor reads up to 1 MiB and saves up to 256 KiB, and keeps CRLF line endings. Download binary or oversized files, edit them elsewhere and upload them again. If a file changed after you opened it, the editor offers **Load latest** or **Overwrite anyway**.
- Upload files with **Upload** or by dragging them into the list. Files up to 64 MiB go up in one request; larger files are sent automatically in 32 MiB parts and resume after an interruption. Compress folders into a `.zip`, upload it and extract it. For a file that already exists, choose **Replace** or **Skip**. An account can have at most 4 large uploads in progress, and an upload session idle for 6 hours is dropped.
- Extract a `.zip` into the current folder. Before extracting, Felis checks for paths that leave the folder, symbolic links, file/folder conflicts and free space. When the archive would overwrite files, the panel lists them; confirm with **Replace and extract**. A failed extraction changes nothing. Archives with file names in GBK encoding extract correctly.
- Download a file, or a folder as a `.zip`. Each account may run 2 downloads at a time and 30 per hour; the platform runs at most 4 at a time.

Large uploads and extractions run in the background and continue after you close the page; **Background operations** shows their progress, and each may run for up to 2 hours. While a file change, backup, restore or download is in progress, the server cannot start.

Some files are protected:

- `config/paper-global.yml` holds the proxy forwarding secret that every server shares. It cannot be read, edited or downloaded online, and it is left out of folder downloads.
- A downloaded `server.properties` has its `rcon.password` redacted.
- `server.properties`, `config` and `config/paper-global.yml` are managed by Felis and cannot be renamed or moved.

### Importing a world {#import-world}

1. Back up and stop the server.
2. Compress the world folder into a `.zip` and upload it to the root folder under **Server Files**.
3. Extract the archive and confirm that the world folder directly contains `level.dat`.
4. In `server.properties`, set `level-name` to the name of the world folder.
5. Start the server.

For refused file operations, see [File manager errors](/en/operations/troubleshooting#file-manager-errors).

## Scheduled tasks {#schedules}

The **Scheduled tasks** page runs server operations on a schedule, for the server owner and Admins, with up to 20 tasks per server. It offers templates such as **Restart every night at 04:00**, **Back up every night at 05:00** and **Announce in chat every 30 minutes**; select **New task** for a custom one.

| Task type | Server running | Server stopped |
| --- | --- | --- |
| Console command | Runs the command over RCON; the leading `/` is optional | Skipped |
| Restart | Stops and starts the server; players are disconnected | Skipped |
| Stop | Stops the server; players are disconnected | Skipped |
| Start | Skipped | Starts the server, subject to the running server limit |
| Backup | Takes a live backup where possible; otherwise stops the server, backs it up and starts it again | Backs it up; the server stays stopped |

Task settings:

- **Execution mode**: **Once a day** runs at a set time; **Repeat** runs at an interval counted from 00:00 each day: 15 or 30 minutes, or 1, 2, 3, 4, 6, 8 or 12 hours. A restart, stop, start or backup repeats at most once an hour.
- **Execution days**: the weekdays to run on, with shortcuts for every day, weekdays and weekends.
- **Time zone**: an IANA time zone name (for example `Asia/Shanghai`); defaults to the browser's.
- **Warn players**: a restart, stop or backup can post a Chinese and English warning in game chat 1, 5, 10, 15 or 30 minutes ahead while the server runs.
- **Enabled**: switch it off to keep the task without running it.

How tasks run:

- felis-api checks every 15 seconds, so a task starts within about 15 seconds of its time. A run more than 10 minutes late (for example because felis-api was not running) is recorded as **Missed**, and the next one runs as usual.
- The result shows as **Succeeded**, **Skipped**, **Failed** or **Missed**, with details.
- **Run now** also works on a task that is off. It skips the players' warning, disconnects online players right away, and keeps the next scheduled run. While a run is in progress, the task cannot be edited, deleted or run again.
- When the server changes owner, its tasks are switched off; the new owner reviews and saves them to turn them back on.
- A time the clock skips at a daylight-saving change runs an hour early; a time it repeats runs once. A time zone the host does not know runs in UTC.
- Deleting a server deletes its tasks.

For skipped or failed runs, see [Scheduled task errors](/en/operations/troubleshooting#schedule-errors).

## Backups and restore {#server-backups}

The **Backups & restore** page lists the server's world backups, for the server owner and Admins. A backup holds the server's entire data volume: worlds, configuration, plugins and mods.

Felis creates these backups automatically:

- **Scheduled backups**: every server played that day gets a daily restore point, taken live while it runs. By default 7 are kept per server, for 90 days.
- **Reclamation archives**: before a server is given up, deleted or reclaimed for inactivity, its world is archived.

Manual actions:

- **Back up now**: a stopped server is archived as it is. A running server is backed up live: saving pauses for a few seconds while the world is copied, and players stay connected; a live backup needs the server's RCON. While the server is starting or stopping, wait until it runs or has stopped. By default each server keeps its 5 latest manual backups for 30 days, and two manual backups must be at least 10 minutes apart; Admins are exempt from the interval.
- **Restore this backup**: stops the server (with a 30-second notice to online players) and overwrites the current world with the chosen backup. Tick **Take a safety snapshot of the current world first (recommended)**: the restore starts only once the snapshot succeeds, and nothing is restored if it fails. To undo a restore, restore the **Pre-restore snapshot**; the last 3 pre-restore snapshots are kept.
- **Download backup**: downloads a `.tar.gz`, checked during transfer against the sha256 recorded at backup time.
- **Export world**: stop the server first. The current world is packaged as a `.tar.gz` and downloaded automatically; keep the page open, as the server cannot start until the download ends.
- **Delete backup**: the backup leaves the list at once and can no longer be restored. Its archive is removed at the next daily cleanup, and its off-site copy at the next sync.

A backup that fails read-back verification is marked **Corrupt** and cannot be restored intact. **Recent operations** lists backup, restore and export tasks with the reason for any failure. When the backup store is full, manual backups by server owners are refused.

::: warning
Without a safety snapshot, a restore overwrites the current world directly; existing data that has no other backup cannot be recovered.
:::

For retention, live backups and restore points in detail, see [World backups](/en/operations/backup#world-backups), [Live backups](/en/operations/backup#live-backups) and [Daily restore points](/en/operations/backup#restore-points). For failed backups, see [Backup failures](/en/operations/troubleshooting#backup-failures).

## Forwarding mode {#forwarding-mode}

The forwarding mode decides how the game proxy passes the player's identity to a server. The Owner sets it under **Forwarding mode** on the server's console page; the login space and the lobby do not offer it.

| Mode | Use |
| --- | --- |
| Modern forwarding | The default. Servers on 1.13 or newer use modern forwarding, signed with the proxy's secret. |
| Legacy forwarding (BungeeCord) | Older backends behind ViaVersion. |

1. Open **Forwarding mode** on the server's console page.
2. Tick or clear **Use legacy forwarding** and select **Save**.
3. Verify your identity. The proxy applies the change at its next server-list refresh, within 15 seconds.

::: warning
A legacy-forwarded server trusts any identity that reaches its port. Felis lets only the proxy reach game servers; do not expose the server's port in any other way.
:::

The change runs through the host node operations service and is recorded in the audit log. The servers named in `FELIS_LEGACY_FORWARDING_SERVERS` at install time (default `legacy18`) always use legacy forwarding.

## Giving up and deleting servers {#retire}

A server owner can give up a server; Admins can also delete it:

| Action | Result |
| --- | --- |
| Give up | The world is archived and its storage deleted; the server is released for other accounts to claim. |
| Delete | The world is archived, and its storage and the server record are deleted; the name and subdomain can be reused. |

1. On the server's console page, in the **Give up server** card, select **Give up** or **Delete**.
2. Type the server's name and confirm.

The server then stops and is processed at the next daily reclaim run; until then it stays stopped and cannot be started. Archives are kept for 90 days by default. Before the run, select **Cancel request** on the console to withdraw it; a deletion requested by an Admin can be cancelled only by an Admin. A server that was given up counts toward the account's quota until it has been processed.

With world cleanup enabled, worlds nobody has played for more than 15 days are backed up and then deleted. See [World cleanup](/en/operations/backup#world-cleanup).

## Quotas {#quotas}

The Owner can set a quota for each account, limiting how many servers it owns and their total CPU, memory and storage; with [Self-service servers](/en/guide/administration#self-service) on, accounts without their own quota use the default quota. Quotas are checked:

- When a server is self-created, at the selected size.
- When a server is claimed, at the server's actual size.
- When the CPU or memory of an owned server is raised.
- When an account receives servers through an account migration.

An action that would exceed the quota is refused. Lowering a quota restricts later actions only and leaves existing servers alone. To set quotas, see [Quotas](/en/guide/administration#quotas).
