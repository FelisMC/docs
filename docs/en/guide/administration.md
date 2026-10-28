---
title: Platform administration
description: Managing roles and users, quotas, the image whitelist, builds and submission review, platform settings and the audit log.
---

# Platform administration {#administration}

This page explains how the Owner and Admins manage the Felis platform: roles and users, quotas, the image whitelist, the build pipeline and submission review, platform settings and the audit log. For host-level operations, see [Operations overview](/en/operations/#panel-host-operations).

## Roles {#roles}

Felis has three roles:

| Role | Rights | Panel navigation |
| --- | --- | --- |
| Owner | The platform owner. Has every Admin right and manages users, authentication sources, host operations and platform settings. Can also use the emergency stop and set a server's forwarding mode. | **Platform**: Users, Authentication sources, Maintenance & Backups, Audit log, Platform settings |
| Admin | Creates servers, edits their configuration and manages every server; maintains the login space and lobby, the image whitelist, builds and submission review; in a multi-node deployment, chooses execution nodes and migrates servers. | **Admin**: Login & lobby, Images, Build Pipeline, Submissions |
| User | Claims servers, manages the servers they own, and submits modpacks. | Dashboard, Servers, My Submissions, Account |

Every role has the Dashboard, Servers, My Submissions and Account. The Owner account is created by the [setup wizard](/en/guide/deployment#setup-wizard). Its role cannot be changed in the panel, and the account cannot be disabled or deleted. If the Owner cannot sign in, recover with `sudo felis breakGlass` on the host. See [Emergency access](/en/operations/access#break-glass).

### Sign-in {#sign-in}

| Console | Address | Used by | Sign-in methods |
| --- | --- | --- | --- |
| Player console | `https://console.<root>` | Users | Bind code from the game, email code, passkey |
| Operator console | `https://op.console.<root>` | Owner, Admins | Passkey, email code, operator sign-in request |

An operator sign-in request works like this: on the operator console, select **Operator sign-in**, enter your email address and select **Request operator sign-in**. A code is emailed to you, and an online Admin or Owner with a linked game identity must approve the request in game with `/felis web op approve <code>`. Once it is approved, enter the code from the email to sign in.

Operator sessions end after 30 minutes of inactivity. Sensitive operations (for example saving platform settings, running host tasks or downloading a support bundle) require identity verification with a registered passkey or a verified email address; a verification stays valid for 5 minutes, and an operator account that signs in again counts as verified for 5 minutes. Without a mail relay, no code can be sent. See [Mail delivery](#mail-relay).

## Platform resources on the dashboard {#dashboard-overview}

On the dashboard of Admins and the Owner, the **Platform resources** card appears below the statistics cards. Users' dashboards do not show the card or load its data. The card has three parts:

- **Totals over the last hour**: the summed CPU and memory of all running servers, and the number of running servers, each in its own chart covering the last hour. CPU is shown in cores, for example “1.25 cores”; the vertical axis of each chart is scaled to the highest value in that hour.
- **Nodes table**: for each node, the summed CPU and memory of its running servers and the number of those servers, sorted by node name. Nodes with no running servers are not listed. When no server is running, the card shows “No servers are running.” On narrow screens, the table becomes a list of cards.
- **Failed sign-ins in the last 24 hours**: the number of refused sign-ins, shown in the warning color when it is above 0. The Owner can select **View audit log** beside the number to open the [Audit log](#audit-log) page and check the causes.

Samples are taken every 15 seconds, and the panel refreshes every 15 seconds; the curves keep the last hour. CPU and memory come from the cluster's metrics service. A running server without metrics counts toward the running total but not toward the CPU and memory totals. Samples are held in the memory of felis-api, so the curves start empty after felis-api restarts. When several controller replicas run, each replica samples and keeps only its own data, and the page shows the curves of the replica it reaches, so the curves can differ slightly between replicas. When the latest sample is more than 45 seconds old, the current values show “No data yet” and the nodes table is empty.

## Users {#users}

The Owner manages platform accounts under **Platform → Users**. The list can be searched by username or email and filtered by role and status.

### Creating a user {#create-user}

1. Select **Create User** and enter a username.
2. On the new user's details page, under **Linked Minecraft Accounts**, select **Link Account**, choose the **Auth Source** (Mojang or third-party Yggdrasil) and enter the game identity.
3. The user runs `/link` in game for a bind code and signs in to the player console. Once they bind an email address or register a passkey, they can also sign in with an email code or a passkey.

Accounts have no password. Players can also create their own account with a bind code from the game. See [Account linking](/en/guide/players#account-linking).

### User details {#user-details}

Select **Details** in the user list to:

- **Edit Profile**: change the username, email and role (Admin or User), then select **Save Changes**.
- **Linked Minecraft Accounts**: link a game identity, or **Unlink** one. After unlinking, the user loses the in-game identity tied to that UUID.
- **Quotas**: see [Quotas](#quotas).
- **Assign server**: give a server to this user; see [Assigning a server](#assign-server).
- **Sessions**: revoke a single session, or select **Revoke All** to sign the user out of every device.
- **Danger Zone**:
  - **Disable User** prevents sign-in and revokes every session at once; **Enable User** allows sign-in again.
  - **Unbind passkeys** removes every passkey of the account, for lost or compromised authenticators; other sign-in methods, including email codes and in-game approval, remain available.
  - **Delete User** soft-deletes the account: its servers are released, every session is revoked, and the account is permanently disabled. This cannot be undone in the panel.

The signed-in account cannot change its own role, disable itself or delete itself.

### Assigning a server {#assign-server}

The Owner can give a server directly to a chosen account, without the account claiming it. Only the Owner can do this: Admins and users do not see the entry points, and the API refuses the same requests for them. Assignment has two entry points, which share one dialog:

- **User details page**: select **Assign server**, then choose the server to hand over from the server list in the dialog. The list can be filtered by name or display name. It omits system servers, servers the account already owns and servers being given up. A disabled account cannot receive servers, and the button is unavailable for it.
- **Server page**: on the server's console page, open **Edit Server Config**. The **Owner** row shows the current owner. Select **Change owner**, then choose the new owner from the user list. The list can be filtered, and it omits disabled accounts and the current owner. System servers have no owner, so this row does not appear for them.

Once a server and an account are selected, the dialog first shows the current owner and the change from one owner to another. For a server with no owner, it states that the server will be assigned to the chosen account.

An assignment has the same effect as a claim: the server's wake list and tags are cleared, the server counts toward the new owner's quota, and the previous owner no longer owns it. A server that is being given up or deleted cannot be assigned; cancel the request first. See [Giving up and deleting servers](/en/guide/servers#retire).

Before assigning, the dialog checks the new owner's quota. If the assignment would exceed it, the dialog lists the totals after assignment and the limits in warning style, item by item, covering the number of servers, CPU, memory and storage. The Owner must tick **Assign anyway, exceeding the quota** before confirming; until then the confirm button is unavailable. No confirmation is needed when the quota is not exceeded. An excess confirmed this way is handled like a lowered quota: it restricts only the account's later creations, claims and resource changes, and existing servers are not affected. See [Quotas](#quotas).

A successful assignment is recorded in the audit log as the action `server.assign`. Its payload contains `owner_from` (the previous owner, empty when the server had none), `owner_to` (the new owner) and `over_quota` (the quota items exceeded at confirmation). The audit record detail shows the owner change as “owner: old value → new value”. See [Audit log](#audit-log).

## Quotas {#quotas}

A quota limits how many servers an account may own and their total resources. It is checked when the account creates a server for itself, claims a server, raises the CPU or memory of a server it owns, or receives a server by account migration; an action that would exceed it is refused. Lowering a quota restricts later actions only and leaves existing servers alone; an Admin can bring the account back within it by shrinking its servers. Servers given up but not yet processed still count. For the effect on users, see [Quotas](/en/guide/servers#quotas).

Each account is held to one of two quotas:

- **The default quota**: applies to every account without a quota of its own, and is set in the **Self-service servers and default quota** card on the **Users** page; see [Self-service servers and the default quota](#self-service).
- **An own quota**: set in the **Quotas** card of the user details, and takes precedence over the default quota; see [One account's quota](#user-quota).

### Self-service servers and the default quota {#self-service}

The **Self-service servers and default quota** card at the top of the **Users** page sets the default quota. When it is on, accounts without a quota of their own can create servers they own within the default quota (see [Creating your own server](/en/guide/servers#self-service)), and their claims and resource changes are held to it as well. When it is off (the default), those accounts cannot create servers, and their claims are not limited.

| Setting | Description |
| --- | --- |
| Enable self-service servers | Whether accounts without a quota of their own are held to the default quota. |
| Servers | How many servers an account may own; a whole number. |
| Memory (GB) | The total memory of all of an account's servers. |
| CPU (cores) | The total CPU limit of all of an account's servers; decimals are allowed. |
| Storage (GB) | The total world volume size of all of an account's servers. |

Leave a field empty for no limit; enter `0` to grant none of that resource. A change to the default quota affects later actions only, not existing servers.

### One account's quota {#user-quota}

In the **Quotas** card of the user details, choose where the account's quota comes from, then select **Save quota**:

- **Default quota**: the card shows what the default quota allows; while it is off, the card says the account cannot create servers and its claims are not limited. For an account with a quota of its own, choosing this and saving deletes that quota.
- **Own quota**: enter the servers, memory (GB), CPU (cores) and storage (GB). Leave a field empty for no limit; enter `0` to grant none of it. With every field empty, the account has no limit at all and is no longer held to the default quota.

The platform-wide running server limit is set in the platform settings. See [Startup and wake policy](#wake-policy). Modpack submissions have limits of their own: at most 5 pending submissions per user; by default 1 GiB per build context, 2 GiB of uploads per user and 4 GiB for all users together, adjusted with keys of the `[registry]` table in `felis.toml` such as `context_max_bytes` and `user_uploads_max_bytes`.

## Image whitelist {#images}

A server can use only enabled images from the image whitelist. Admins maintain the whitelist under **Admin → Images**, where each image shows its source:

| Source | Description |
| --- | --- |
| Platform build | An image built successfully by the build pipeline, added to the whitelist when the build completes. |
| External | An image reference an Admin registered by hand. |
| Recommended | An image Felis provides, shown first when creating a server; it is admitted by the same rule as any other image. |

To add an external image:

1. Select **Add Image**.
2. Under **Image Reference**, enter the image, for example `registry.felis.svc:5000/image:tag`.
3. Confirm.

A whitelist entry can be a specific tag, a `:*` wildcard or an image digest. After **Remove image**, new servers can no longer be created from that image. For the compatibility requirements of server images, see [Images and Minecraft versions](/en/guide/servers#images-versions).

## Build pipeline {#build-pipeline}

**Admin → Build Pipeline** lists the history of image builds and can start a build by hand. Builds run with Kaniko in the isolated `felis-build` namespace and are then scanned by Trivy; an image that passes the scan is pushed to the in-cluster registry and added to the whitelist.

To start a build by hand:

1. Under **Trigger New Image Build**, fill in **Image Reference** (the target image), **Context Reference** and **Base Image**, or pick a submission under **Import parameters from submission** to fill them in.
2. **Dockerfile Content** is archived for audit only; the build runs the `Dockerfile` inside the context tarball.
3. Select **Start Build**.

A manual build does not mark the corresponding submission as approved or update its build status; use it for emergency debugging only.

The number of concurrent builds is limited by `[registry] max_concurrent_builds`, 2 by default, 1–6; further builds queue and start automatically when a running build ends. Select **Scan & logs** to see the build log and the **Security scan**, and download the **Trivy report** and **SBOM**. By default a scan blocks an image on CRITICAL findings that have a fixed release; findings with no fixed release are listed only. `[registry] scan_fail_on` sets the blocking severities; with `scan_fail_unfixed` on, findings with no fixed release block too; known risks listed in `scan_accept` never block. A blocked image never reaches the registry. Select **Cancel** to stop a running build; a stopped build pushes nothing.

For failed builds, see [Build failures](/en/operations/troubleshooting#build-failures) and [Build pods not starting](/en/operations/troubleshooting#build-pods-not-starting).

## Submissions {#submissions}

Users can submit custom modpacks. Once an Admin approves one, it is built automatically, and the resulting image joins the whitelist, ready for creating servers.

### Submitting a modpack {#submit-modpack}

1. Open **My Submissions** and enter a **Display Name** under **Submit New Modpack**.
2. Choose the **Build Context (.tar.gz)** file, a gzip tarball that contains the `Dockerfile`; the size limit is shown in the upload area.
3. Select **Submit**. The upload goes in 32 MiB parts; you can **Pause** and **Continue upload**, and an interrupted upload resumes from the confirmed offset.

The submission list shows the review status (Pending Review, Approved, Rejected), the build status and the **Context SHA-256**, which you can compare with the local file using `sha256sum`. A pending submission can be withdrawn with **Withdraw**, which deletes the submission and its uploaded build context and releases the pending-review slot and storage quota.

### Review {#review}

1. Open **Admin → Submissions** and select a pending submission.
2. Select **Download context** to download the build context; its `Dockerfile` is what will actually run. When reviewing offline, compare the **Context SHA-256** on the page with `sha256sum`.
3. When satisfied, select **Approve**. Approval pins the digest of the current context and starts a Kaniko build and Trivy scan automatically.
4. To reject, select **Reject** and enter a **Rejection Reason** (up to 1000 characters), which is shown to the submitter.

If the submitter uploaded the context again after your review, approval is refused; download and review the latest version. A submission without an uploaded context cannot be approved. Select **Delete submission** to remove a submission that is no longer needed.

## Platform settings {#platform-settings}

Under **Platform → Platform settings**, the Owner manages platform-wide settings, spread over five tabs:

| Tab | Cards |
| --- | --- |
| Player entry | Player entry policy (see [Player entry policy](/en/guide/players#entry-policy)), Startup and wake policy, Default interface language |
| Notifications and retention | Mail delivery, Monitoring heartbeat, Backup and audit retention |
| Access and security | Access and domain, Upload storage, Credential rotation, API keys, Game proxy, System server completion |
| Distributed | Distributed deployment, Node operations, Execution nodes, Failover (see [Multi-node and high availability](/en/guide/distributed#overview)) |
| Branding | Panel name, Logo, Sign-in background image, Sign-in notice, Show “Powered by Felis” (see [Branding](#branding)) |

Saving a setting (except the default interface language) requires identity verification and is made against the current revision; if someone changed the same setting in the meantime, the save is refused and you reload before editing again. Settings saved in the panel take precedence over the install-time settings. See [Panel settings precedence](/en/reference/configuration#panel-settings-precedence).

### Startup and wake policy {#wake-policy}

| Setting | Description |
| --- | --- |
| Running server limit (0–10000) | `0` means unlimited. New starts count servers already running or requested to run; system services can always start. The limit applies to panel starts, in-game wakes and scheduled starts; lowering it stops no running server. |
| Wake cooldown (0–3600 seconds) | Minimum interval between two accepted wake requests for the same server; `0` disables the cooldown. |

The running limit is an admission check, so concurrent requests can briefly exceed it; whether Kubernetes can schedule a server still depends on the nodes' free memory. After **Save and apply**, the policy is active on every API replica at once, without a restart.

### Default interface language {#default-language}

Under **Player entry → Default interface language**, choose the default interface language of the panel: **Follow browser language**, **简体中文** or **English**. The setting applies to new visitors and to users who have not chosen a language in the panel. A language a user selects in the panel takes precedence over the default.

With **Follow browser language**, the panel uses the language of the visitor's browser and shows English when that language is not supported. After saving, the setting takes effect the next time a visitor loads the panel. A visitor who saved a language in the browser earlier keeps that language; after the site's browser data is cleared, the default applies. Notification emails are always bilingual and are not affected by this setting.

### Mail delivery {#mail-relay}

Mail delivery sends sign-in codes, identity confirmations, alerts and [server event notifications](/en/guide/servers#notifications). Under **Notifications and retention → Mail delivery**, fill in:

| Field | Description |
| --- | --- |
| Server host, Port | Your provider's SMTP relay. The port is 587 (STARTTLS, recommended), 465 (SSL/TLS), 25 or 2525. |
| Sender address | Must be a sending identity your mail provider has authorized; otherwise the provider rejects mail at delivery. |
| User name, Password | Credentials for the relay. Leave a saved password empty to keep it. |
| Hourly mail cap | `0` uses the default cap of 120 messages per hour. Keep it at or below your provider's limit. |
| Require an encrypted connection | When on, mail is refused if the server does not offer STARTTLS. Turn it off only for a server reached over a trusted internal network. |

**Check and save** first sends a self-test message to the sender address and saves only once it is delivered. **Send test message** checks the configuration at any time. The saved settings override those written by `felis setup` at install time and apply at once to the API, the watchdog, idle cleanup and break-glass sign-in, without a restart. **Revert to install-time settings** returns to the installation configuration; if none was configured then, sign-in codes cannot be mailed. For mail problems, see [Mail relay](/en/operations/monitoring#mail-relay).

### Monitoring heartbeat {#heartbeat}

Under **Notifications and retention → Monitoring heartbeat**, enter the heartbeat URL of an external monitoring service such as Healthchecks.io. The watchdog runs every two minutes and pings the URL on every run; when the pings stop, for example because the host is down or the watchdog itself failed, the service alerts you.

The URL must start with `http://` or `https://`. Its path is the check's key, so only the scheme and host are shown once saved. A URL set in the panel takes precedence over the one the installer wrote on the host. After **Remove heartbeat URL**, the watchdog stops pinging it and the monitoring service alerts on the missing pings; pause the check at the service as well. See [External heartbeat](/en/operations/monitoring#heartbeat).

### Backup and audit retention {#retention}

The settings under **Notifications and retention → Backup and audit retention** take precedence over the `[archive]` and `[audit]` tables of `felis.toml`:

| Group | Field | Range | Install default |
| --- | --- | --- | --- |
| Manual backups | Kept per server | 1–100; the oldest is removed beyond it | 5 |
| Manual backups | Days kept | 1–3650 days | 30 days |
| Manual backups | Minutes between two backups | 0–1440; `0` sets no limit; Admins are exempt | 10 minutes |
| Scheduled restore points | Interval (hours) | 0–720; `0` turns them off; only worlds played since their last point get one | 24 hours |
| Scheduled restore points | Kept per server | 1–100 | 7 |
| Scheduled restore points | Days kept | 1–3650 days | 90 days |
| Store and audit | Days a removed world's archive is kept | 1–3650 days. A world reclaimed for idleness, released or deleted is archived first; that archive is kept this long | 90 days |
| Store and audit | Backup store cap (GiB) | `0` sets no cap. At the cap, manual backups and scheduled points pause | no cap |
| Store and audit | Days audit rows are kept | `0` keeps every row; otherwise 30–3650 days | 365 days |

After **Save retention settings**, felis-api applies the new values at once, and the backup and reaper jobs on their next run. **Restore install-time settings** discards the values saved in the panel and returns to `felis.toml`. For backups in full, see [World backups](/en/operations/backup#world-backups).

### Access and security {#access-security}

The operations on the **Access and security** tab, apart from **API keys**, are run as root by the node operations service on the host. One task runs at a time, and each requires identity verification and is recorded in the audit log:

| Card | Purpose | Details |
| --- | --- | --- |
| Access and domain | Switch between direct access, your own reverse proxy and Cloudflare Tunnel; check and change the root domain | [Access methods](/en/operations/access#access-methods), [Changing the root domain](/en/operations/access#change-domain) |
| Upload storage | Change where submission uploads are stored | [Upload storage](/en/operations/storage#upload-storage) |
| Credential rotation | Replace a generated credential and restart what uses it | [Rotating credentials](/en/operations/access#rotate-credentials) |
| Game proxy | Set Velocity's memory ceiling, 256M to 64G; the default 1G suits about 100 concurrent players. Applying it restarts the proxy and disconnects every player | [Sizing](/en/guide/requirements#sizing) |
| System server completion | Add settings that newer releases introduced to servers created earlier, optionally enabling RCON on older user servers | [felis converge](/en/reference/cli#converge) |

For the task rules and the full list of operations, see [Running the host from the panel](/en/operations/#panel-host-operations).

### API keys {#api-keys}

On **Access and security → API keys**, the Owner decides whether users can create API keys. Keys that users create let scripts call the external interface as that user; the request format is described in [API keys](/en/reference/api#api-keys).

- **Switch**: **Allow users to create API keys** is off by default, and saving it requires identity verification. When it is on, users can create keys on the **Account** page.
- **Effect of turning it off**: every existing key stops working at once, but users can still view and revoke them on the **Account** page. When the switch is turned on again, keys that have neither expired nor been revoked work again.
- **Admin keys**: Admins and the Owner can also create admin keys. An admin key carries its creator's administrative permissions on the operator console, works only on the operator console domain and cannot be used for operations that require identity verification. Creating one requires a validity period of no more than 90 days and identity verification.
- **Limit**: each account can hold up to 10 keys.

### Branding {#branding}

On the **Branding** tab, set how the panel presents itself to visitors: its name, logo, sign-in background and notice, and the credit line. Saved settings apply the next time a visitor loads the panel.

| Setting | Description |
| --- | --- |
| Panel name | Up to 40 characters, shown in the sidebar, the top bar, the sign-in page and the browser tab title. Leading and trailing whitespace is removed automatically. Leave it empty to use the default name Felis. |
| Logo | Replaces the Felis mark in the sidebar, the top bar and the sign-in page. The Felis mark is used when no logo is set. |
| Sign-in background image | Fills the background of the sign-in page and the first-run setup page. The sign-in card stays readable in front of it. |
| Sign-in notice | Plain text of up to 1000 characters, shown above the sign-in card with line breaks preserved. HTML and Markdown are not interpreted and are displayed as entered. Apart from line breaks, it cannot contain control characters. Leave it empty to show no notice. |
| Show “Powered by Felis” | On by default. When on, a credit link to felismc.com appears at the bottom of the sign-in page and of the sidebar. When off, the link is hidden. |

The logo and the background image must be PNG or WebP files; SVG is not supported. The logo may be at most 256 KiB, and the background image at most 2 MiB. Each dimension of a PNG may be at most 4096 pixels. The file content must match the chosen format, or the upload is refused.

Saving the panel name, the sign-in notice or the credit switch, and uploading or removing an image, each require identity verification. The name, notice and credit switch are saved with **Save branding settings** against the current revision. Uploading or removing an image is saved at once and is not controlled by that button.

## Audit log {#audit-log}

Felis records administrative and sensitive actions in the audit log. Each record holds the time, the actor, the action, the server and the action's parameters. Recorded actions include:

- Servers: creation (`server.create`), assignment (`server.assign`), backups (`backup.create`, `backup.scheduled`), backup deletion (`backup.delete`), backup downloads and world exports (`backup.export`, `world.export`).
- Files: `file.write`, `file.mkdir`, `file.delete`, `file.rename`, `file.upload`, `file.unzip`, `file.download`.
- Scheduled tasks: `schedule.create`, `schedule.update`, `schedule.delete`, `schedule.run_now`, and `schedule.run` after every finished run.
- Platform: changes to platform settings (`platform.*`, such as `platform.entry_policy` and `platform.archive_policy`), host tasks (`platform.host.*`) and node operations (`platform.node.*`).
- Sign-in: every refused sign-in is recorded as `auth.<door>.failed`, with the cause in the payload's `reason`; throttled requests are recorded as `auth.rate_limited`. These records carry the account ID, client address and user agent.

### Browsing in the panel {#audit-browse}

The Owner browses every record under **Platform → Audit log**, newest first. Each page loads 50 records; select **Load more** to continue to older records. Submitting the filters at the top reloads the list from the first page. When several filters are filled in, a record must match all of them:

| Filter | Matching |
| --- | --- |
| Actor | Contains the text entered, ignoring case |
| Action | Matches by prefix; for example, `server.` matches every server action |
| Server | Must match the server name exactly |
| From (inclusive), Until (exclusive) | Read in the browser's time zone; the end time must be later than the start time |
| Keyword | Ignores case; matches the text of the actor, action, server and action parameters |

The list shows the time (in the browser's time zone), the actor, the action and the server; on narrow screens, each record appears as a card. Select a record to open its details, which show every field: the record number, source, actor and the actor's account ID, request ID, client address, User-Agent, and the action's parameters, formatted. Paired parameters `xxx_from` and `xxx_to` (for example `image_from` and `image_to` when an image is changed) are listed above the details as “xxx: old value → new value”. The `fields` of a server settings change are shown as **Fields changed**, naming the settings that the edit changed.

Browsing the audit log does not require identity verification, and Admins cannot open this page. Exporting still requires identity verification; see below. The Owner's dashboard also shows a **Recent actions** card, which lists the time, actor, action and server of the latest 10 records. Select **View all** to open the audit log page.

### Export and retention {#audit-export}

Audit records are kept for 365 days by default; set the period under [Backup and audit retention](#retention). felis-api prunes expired records a minute after it starts and every 6 hours after that; the daily database backups keep the records for as long as the backups are kept. To keep records longer, export them before the period ends:

1. Open **Maintenance & Backups → Backups** and find the **Audit log export** card.
2. Choose **From (inclusive)** and **To (exclusive)**; leave a date empty to export from the oldest or to the newest record.
3. Select **Download** and verify your identity. The records download as JSON lines.

On the host, the command line exports them as well:

```bash
sudo felis db audit-export -since 2026-01-01 -until 2026-07-01 -out /root/felis-audit-2026h1.jsonl
```

`-since` and `-until` take a day (UTC midnight) or an RFC 3339 instant; the window includes the start and excludes the end, with one record per line, oldest first. The file named by `-out` is created with mode 0600, and an existing file is never overwritten; without `-out`, the records go to standard output. To look at the latest audit records:

```bash
sudo k3s kubectl -n felis exec deploy/felis-postgres -c postgres -- psql -U postgres felis -c \
  "SELECT created_at, actor, action, server_name, payload FROM audit_logs ORDER BY created_at DESC LIMIT 20;"
```
