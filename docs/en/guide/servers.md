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
| Stop, restart, force stop, console, player management, files, scheduled tasks, backups and restore | Server owner, Admin |
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
   | Memory | The container memory limit in GiB: 4 by default, at least 1, decimals such as 1.5 allowed. The Java heap is sized from it. |
   | Storage | The world volume size in whole GiB: 10 by default. It cannot be changed after creation. |
   | Autostart policy | Defaults to **Owner only — wake from the panel**. See [Autostart policy](#autostart). |

4. With server software, accept the Minecraft End User License Agreement (EULA).
5. Select **Create**.

A new server stops automatically after 600 seconds with nobody online. A server an Admin creates charges no user's quota; quotas are charged when the server is claimed. A name that matches the leftover world volume of a deleted server is refused until that volume is removed or another name is chosen.

### Self-service creation {#self-service}

**New server** appears on the **Servers** page, and the account can create servers it owns, when:

- It has a linked Minecraft account. See [Linking your account](/en/guide/players#account-linking).
- It has a server quota: the Owner set a quota for this account, or turned on the default quota under [Self-service servers](/en/guide/administration#self-service).

A self-created server runs server software only, and its resources count toward the account's quota. The panel shows the quota usage and what is left of it, and a server whose memory or storage exceeds what is left cannot be created. Once the server count reaches its cap, **New server** is unavailable. In a multi-node deployment the server is placed on the approved node with the fewest user servers. Server owners can give up their servers; deleting a server remains an Admin action, see [Giving up and deleting a server](#retire).

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
- Restarting after a crash and resuming after a host restart. See [Crashes and host restarts](#recovery).
- Email notifications. See [Email notifications](#notifications).
- JVM arguments, server arguments, environment variables and stop commands. See [Advanced startup settings](#startup-settings).

Raising the CPU or memory of an owned server must fit the server owner's quota; lowering them is never held to it. The login space and the lobby are system services, which Admins manage under **Login & lobby**. See [Customizing the login space and lobby](/en/guide/players#customize-login-lobby).

### Advanced startup settings {#startup-settings}

Server owners and Admins can expand **Edit Server Config → Advanced startup settings** to read and change that server's JVM arguments, server arguments, environment variables and stop commands. Admins manage the login space and the lobby. Advanced startup settings are excluded from public server status and do not include platform-managed environment variables.

| Setting | Input and limits |
| --- | --- |
| JVM arguments | Enter one complete argument per item, up to 128 items and 1,024 bytes per item. Arguments cannot contain whitespace. Heap sizing options, including `-Xmx` and `-Xms`, and argument file options are rejected; the heap size is derived from the memory setting. |
| Server arguments | Each item is passed to the server as one argument, preserving spaces, order and empty strings. Up to 128 items and 2,048 bytes per item. |
| Environment variables | Enter names and values individually, up to 64 items. Names must be unique, use only English letters, digits and underscores, and cannot start with a digit; up to 128 bytes per name. Values may be empty and are limited to 4,096 bytes. |
| Stop commands | Commands run in the order entered, up to 16 items. Each item must be a single line of at most 1,024 bytes. Leading and trailing whitespace and one leading `/` are removed. |

All advanced settings together are limited to 64 KiB, measured in UTF-8 bytes. Environment variables cannot override `FELIS_*` or reserved runtime variables such as `JAVA_MEMORY`, `JAVA_FLAGS`, `JAVA_TOOL_OPTIONS`, `RCON_PASSWORD`, `PATH` and `HOME`. Removing an item and saving removes that value; unchanged settings keep their values.

Saved JVM arguments, server arguments and environment variables take effect on the next start or restart. Saving while the server is running or starting does not immediately restart it. On the next normal stop or explicit restart, stop commands are attempted over RCON in order after the world save attempt and before the process shuts down; the group has a total time limit of 30 seconds. Unavailable RCON, a command failure or a timeout does not prevent shutdown. Commands may run again after a failed attempt is retried. Force stop, emergency stop and automatic retries after a failed start skip these commands.

### Disk usage and quota {#disk-quota}

The storage size selected when creating a server is also its disk quota. The console and file page show usage, the quota and the latest measurement time, including while the server is stopped. Usage counts allocated bytes in the world volume, including worlds, plugins, configuration, logs and temporary files within that volume. Sparse files count only allocated space, hard links count once, and symbolic links are not followed.

At 90% of the quota, the console displays a warning. Server owners with problem notifications enabled also receive an email. At 100%, the platform stops the server through the normal shutdown process, records the `DiskFull` stop reason, and refuses starts, start retries and restarts. File management and downloads remain available for cleanup. Once the platform confirms a new successful measurement below the quota, the server can be started again; it does not start automatically.

The platform schedules read-only volume scans serially every minute. Updates may take longer with more servers, slow volume mounts or large directory trees. Protection takes effect after periodic detection, so writes may continue during measurement and normal shutdown. A failed, timed-out or incomplete scan preserves the last successful result. Measurements older than three minutes are marked stale. After cleanup, even a new measurement below the quota may still await confirmation. During this period, its timestamp is retained, current usage is shown as unavailable, and the startup restriction remains in effect. Usage without a successful measurement is unavailable rather than zero. Sampling failures do not release an existing full-disk startup block.

The file listing's available space is the free space on the underlying filesystem, separate from the server quota. Writes can fail when the underlying storage is full even if the server remains below its quota.

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

### Restarting {#restart}

The console page shows **Restart** while the server is running. Restarting saves and shuts down the current process, then starts the server again. The panel asks for confirmation when players are online or the player count cannot be read. Restart requests are refused during maintenance such as backups, restores or file changes.

### Force stop {#force-stop}

When the server process is unresponsive or a normal stop has not completed, the server owner or an Admin can select **More actions → Force stop** on the console page and confirm after reading the data loss warning. Force stop terminates the process immediately, without saving or waiting for the shutdown countdown or termination grace period. Online players will be disconnected. Changes since the last save may be lost.

After the request is accepted, the platform processes the stop and the panel continues updating the server state. The server cannot start again until the stop request has been processed. Force stop requires the operator; if the operator is unresponsive, the platform Owner uses the emergency stop below.

### Emergency stop {#emergency-stop}

When a normal stop does not respond, the Owner can use an emergency stop:

1. On the server's console page, select **More actions → Emergency stop**.
2. Type the server's name and verify your identity.

The emergency stop first saves the stop intent, then sets the workload's replicas directly to zero, bypassing the game process and the operator while keeping the normal termination grace period. World data is not deleted; unsaved changes may be lost. An accepted request does not prove that the process has exited: the panel keeps checking the game pod and shows **Stopping** until it has gone.

::: warning
An emergency stop disconnects every player on the server at once. When the control API is offline, the panel cannot act on the cluster: expand **Host emergency shutdown procedure** and run its commands on the host in order. Do not resolve a lost control connection by force-deleting worlds, pods or PVCs.
:::

When the panel cannot read a server's state within 12 seconds, it shows the time of the last successful read and retries on its own. The state shown then is for reference only and does not prove that the game process is healthy.

## Crashes and host restarts {#recovery}

### Restarting after a crash {#crash-restart}

When the server process exits unexpectedly (including being killed for running out of memory) or stops responding, the platform restarts the server by default. Automatic restarts have a limit on crashes in a row, so a server that keeps crashing is not restarted forever:

- While the crashes in a row stay within the limit, the server is restarted.
- Once they exceed the limit, the server stops, and its console page shows why, together with the cause of the latest crash.
- A crash more than an hour after the previous one starts the count over.

Admins and server owners set this under **Edit Server Config → Running and recovery**:

| Setting | Default | Description |
| --- | --- | --- |
| Restart after a crash | On | When off, the platform stops the server once it detects that the process exited. The process may already have restarted briefly before the stop. |
| Restart at most | 3 times | From 1 to 20. |

A server stopped for crashing is not woken by players joining. Its owner or an Admin fixes the cause and selects **Wake** on the console page, which also resets the crash count. Exiting the process with an in-game command such as `/stop` also counts as an unexpected exit; to stop a server, use **Stop** on the console page.

The **Activity** list on the console page shows the latest starts, stops, crashes, failed starts and host restarts.

### Resuming after a host restart {#resume-after-host-restart}

After a power loss or a restart of the host, the platform services start with the host, and servers that were running before resume by default. With **Resume after a host restart** turned off under **Edit Server Config → Running and recovery**, the server stays stopped once the host is back and its console page shows why; select **Wake** when it is needed, and players joining wake it under its autostart policy. A process exit caused by a host restart does not count as a crash.

::: tip
Whether the host powers on by itself after a power loss depends on the hardware or virtualization platform, for example the BIOS setting Restore on AC Power Loss. Unattended deployments need that setting turned on at the host.
:::

The login space and the lobby always restart and resume after a host restart, whatever these settings say; the platform alerts the platform owners about their problems. See [Monitoring and alerts](/en/operations/monitoring).

## Email notifications {#notifications}

When the platform has a [mail relay](/en/guide/administration#mail-relay), server events are mailed to the verified email of the server's owner; for an unclaimed server, to the platform owners. Admins and server owners choose the events under **Edit Server Config → Email notifications**:

| Notification | Default | Events |
| --- | --- | --- |
| Problems | On | Crashes and the outcome of the restart, a stop after crashing, failed starts, and resuming or staying stopped after a host restart. |
| Server started | Off | The server finished starting. |
| Server stopped | Off | The server finished stopping, including idle auto-stop. |

After a crash, the platform waits up to 3 minutes and sends the outcome of the restart and any events in between in one mail; a stop after crashing is sent at once. Events not sent within an hour are dropped. These mails count toward the relay's hourly limit. The login space and the lobby send no such mail.

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
- While the server starts or runs, its owner and Admins can use **Server command** to send console commands, for example `list` or `op <player>`.
- Links to player management, LuckPerms permissions, backups and restore, server files and scheduled tasks.

### Sending commands {#console-commands}

Enter a single-line command and press Enter or select **Send command**. RCON displays the command's reply when available. During startup or when RCON cannot connect, the platform can send input through the server's standard input; the panel displays **Command sent. Check the console log for the result.** This confirms that input was sent; check the log for the execution result.

If the connection fails after sending begins, the panel reports an uncertain outcome and retains the input. Check the log before deciding whether to send it again; commands are never retried automatically. Input is unavailable before startup or during shutdown; send requests are refused during maintenance such as backups, restores and migrations.

Servers already running before an upgrade enable standard input at their next start or restart. The upgrade does not restart the game process for this change. Older instances can continue to use RCON when it is available.

### Stopped server logs {#stopped-logs}

Once the server has fully stopped, its owner and Admins can view the last 200 lines of `logs/latest.log` on the world volume and load earlier content. Each page displays at most 256 KiB; longer individual lines appear in segments. History is read-only. The live log stream connects automatically when the server starts.

An absent world volume or log file displays no history. If the file is replaced or modified, refresh to read it again and avoid mixing different versions. Existing file access restrictions apply during backups, restores and migrations.

### Resource usage {#resource-usage}

Server owners and Admins can view current CPU and memory usage and the last hour of history on the console. The wide server list also displays current usage. CPU percentages use the server's CPU limit: 500 millicores against a limit of two cores is 25%. Without a CPU limit, usage is shown in millicores. Memory shows the working set against the container memory limit, including memory outside the JVM heap.

The platform samples every 15 seconds and retains at most 240 points per server. Stopped servers and unavailable metrics show no current value; existing history remains for up to one hour. Missing metrics are never shown as zero usage. History is held in the API instance's memory and starts accumulating again after an instance restart or change. Sampling does not include disk usage or network traffic.

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

## Installed plugins and mods {#extensions}

Server owners and Admins can open **Plugins and mods** from the console sidebar to inspect `.jar` and `.jar.disabled` files in `plugins/` and `mods/`. The page is available while running or fully stopped; wait for startup, shutdown or maintenance to finish before making changes.

The list shows the filename, size, enabled state, and the name, version, authors and loaders declared in readable manifests. It supports Bukkit, Paper, Fabric, Quilt, Forge, NeoForge and Velocity manifests, retaining multiple mod or loader declarations in one JAR. Files with unreadable metadata remain listed and can be disabled or deleted. Consult the server console for actual loading status.

- **Enable and disable** rename between `.jar` and `.jar.disabled`. An existing destination is never replaced; resolve conflicting names through the file manager first.
- **Delete** permanently removes the selected JAR after confirmation and keeps configuration files.
- **Open configuration** opens an existing configuration directory in the file manager. The action is absent when no matching directory was found.
- **Upload JAR** sends files to the plugin or mod directory through the existing upload queue and multipart transfer. The list refreshes after the batch finishes.

Restart the server to apply uploads, enables, disables and deletions made while running. Changes to world directories still require the additional acknowledgement, including when `level-name` is set to `plugins` or `mods`. Missing directories produce an empty list. Scans inspect at most 2000 entries per directory, return at most 500 files, and bound manifest and response sizes; a truncated list directs you to the file manager for remaining files.

## Server files {#files}

The **Server Files** page browses and repairs files in the world volume, for the server owner and Admins. It is available while the server is running or fully stopped; wait for startup or shutdown to finish during a transition. A new server that has not started yet can use it as well, for example to put a modpack, a world or a custom jar in place before its first start.

During live access, the page warns that world changes may be overwritten by the server and that plugin and configuration changes usually take effect after a restart. Select the additional risk acknowledgement before modifying `world`, `world_nether`, `world_the_end` or the world directory named by `level-name` in `server.properties`. Extracting an archive while running also requires this acknowledgement. It applies only to the current page and resets after reopening the page or a change in running state.

You can:

- Browse folders, create files and folders, rename and delete. Select several entries to delete or download them together. Deletion is permanent; back up anything you need first. Each row's **More** menu also supports right-click and a long press on mobile.
- Copy or cut files and folders within the same server, then open the destination folder and paste. Review the conflict list before confirming replacement of existing files. Rename entries first when a file conflicts with a folder.
- Search file names in the current folder and its descendants. Search returns at most 500 results, descends at most 16 levels, and skips the `region`, `entities` and `poi` chunk-data folders. Narrow the folder or query when results are truncated.
- Edit text files up to 5 MiB online, preserving CRLF line endings. Download binary or oversized files, edit them elsewhere and upload them again. If a file changed after you opened it, the editor offers **Load latest** or **Overwrite anyway**.
- Upload files or folders using the upload buttons or by dragging them into the list. Folder uploads preserve relative paths, create directories and upload each file in turn. Files up to 64 MiB go up in one request; larger files are sent automatically in 32 MiB parts and resume after an interruption. For a file that already exists, choose **Replace** or **Skip**. An account can have at most 4 large uploads in progress, and an upload session idle for 6 hours is dropped.
- Download a public URL to a chosen server path. Only HTTP and HTTPS without a username or password are accepted. Private, loopback and link-local destinations, including redirects to them, are refused. The file is first fetched onto the platform's staging disk, then written to the server; its size is bounded by available staging space.
- Pack selected entries into a `.zip` on the server, or extract `.zip`, `.tar`, `.tar.gz` and `.tgz` archives into the current folder. Before extracting, Felis checks containment, links, file/folder conflicts and free space. When existing files would be replaced, the panel lists them for confirmation. Zip archives with file names in GBK encoding extract correctly.
- Download a file, a folder as a `.zip`, or selected entries together as a `.zip`. Each account may run 2 downloads at a time and 30 per hour; the platform runs at most 4 at a time. PNG, JPG, GIF and WebP images up to 5 MiB can be previewed through the same download channel and count toward these limits.

Upload landing, copies, moves, packing and extraction run in the background and continue after you close the page; **Background operations** shows their progress, and each may run for up to 2 hours. URL downloads wait for remote content to reach staging before starting the background landing operation. Backups, restores and migrations block file operations. Writes and downloads on a stopped server hold a maintenance lock that prevents startup until they finish. Live file operations take no admission lock and do not prevent shutdown.

A running server may recreate source or destination files during an operation. If rollback cannot finish, **Background operations** lists the retained directories. Review the contents of `move-recovery-*` or `file-recovery-*` before moving or deleting them. Concurrently created content is not overwritten automatically; protected backups require recovery by the host administrator.

Some files are protected:

- `config/paper-global.yml` holds the proxy forwarding secret that every server shares. Its source and downloads remain protected, and it is left out of folder downloads. Common settings can be edited through the restricted form below.
- Downloading, packing or copying `server.properties` redacts its credentials.
- `server.properties`, `config` and `config/paper-global.yml` are managed by Felis and cannot be renamed or moved.

### Configuration forms {#server-properties}

Open `server.properties` in the root folder through file management to switch between **Form** and **Text**. The form groups common settings under game rules, players, world, network and performance, with boolean, integer, choice and text controls, field descriptions and validation errors. Use text mode for other settings.

Both modes share one draft, so switching preserves unsaved changes. The form updates only properties you change, retaining comments, order, unknown keys and line endings; opening the form does not add missing properties. Legacy properties such as PVP, Nether access and mob spawning appear only when their keys exist in the file, with descriptions of applicable versions. Platform-managed ports, authentication and RCON fields are read-only in the form. Forwarding and player limits for the login space are also managed by the platform.

The editor hides `rcon.password` and `forwarding-secrets`. Saving retains the current on-disk values for unchanged placeholders; these credentials do not need to be entered.

`bukkit.yml`, `spigot.yml`, `config/paper-world-defaults.yml` and `purpur.yml` also offer form and text modes. Each form lists existing common settings with compatible types, without inserting defaults or creating world overrides. Edits preserve comments, order and unknown data, although formatting may be normalized; unchanged files retain their source. Use text mode for complex structures such as anchors, aliases or multiple documents.

`config/paper-global.yml` uses a restricted form for existing common fields with compatible types, without inserting defaults; proxy forwarding and authentication remain managed by the platform. The form receives only editable fields and saves only those you change, retaining other settings and comments. After a conflict, **Overwrite anyway** reads the latest version before applying those changes.

If another process changed the file before saving, choose **Load latest** or **Overwrite anyway**. Configuration saved while running usually requires a restart to take effect; the existing file access and world-directory acknowledgement rules apply.

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
