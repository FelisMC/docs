---
title: API reference
description: The faces, authentication, access tiers, shared behaviour and main endpoint groups of the Felis HTTP API.
---

# API reference {#api}

This page describes the structure of the Felis HTTP API: its two faces, authentication, access tiers, the behaviour every operation shares, and the main endpoint groups. It is for readers who write scripts, build integrations or contribute to Felis. The parameters, request bodies and response schemas of each operation are defined in the OpenAPI document.

## Overview {#overview}

felis-api is served by the `felis` binary and runs two faces at once:

| Face | Callers | Where it is reached | Authentication |
| --- | --- | --- | --- |
| Internal face | The game proxy, the login space, image build jobs, file and export jobs, some `felis` commands on the host | The in-cluster ClusterIP Service `felis-api-internal`, port `8081`, plain HTTP | A per-caller service token; one-time tokens for job transfers |
| External face | The web panel and clients that use a session | The panel hostnames: the player console `console.<root_domain>` and the operator console `op.console.<root_domain>` | The `felis_session` session cookie or an API key |

The external face is served through the NodePort Service `felis-api` (port `443`), behind the access method chosen at install time; the panel pages and the API share the same host. The internal face is never wrapped in Zero Trust and is never published on a node's external address. The network policies of game servers block access to it, with the login space as the only exception; image build jobs reach it through their own egress policy; the game proxy reaches it from the host through the ClusterIP. See [Access and domains](/en/operations/access#access-methods) for the access methods.

The complete OpenAPI 3.1 document is published at [/openapi.yaml](/openapi.yaml) and describes both faces. It uses these extension fields:

| Field | Where | Meaning |
| --- | --- | --- |
| `x-felis-face` | Every operation | The face it belongs to: `internal`, `external`, or both (such as `/healthz`) |
| `x-felis-tier` | Every operation | The access tier, see [Access tiers](#access-tiers) |
| `x-felis-callers` | Internal operations | The service-token callers allowed to call the operation |
| `x-felis-setup-allowed` | External operations | Operations an account still in first-run setup may call, see [Setup lockdown](#setup-lockdown) |
| `x-felis-common-responses` | Document root | Responses any operation can give under a stated condition, not repeated under each operation |

The server URLs in the document use the placeholder domain `example.test`. In a deployment, the external face lives under the panel hostnames and the internal face is reachable only inside the cluster.

## Authentication {#authentication}

### Service tokens {#service-tokens}

The internal face authenticates with `Authorization: Bearer <service-token>`. Each caller holds its own token, and each operation accepts only the callers listed in `x-felis-callers`:

| Caller | Secret (`felis` namespace) | Used by | Reaches |
| --- | --- | --- | --- |
| `velocity` | `felis-service-token` | The game proxy plugin | The server list, wake, claim, status, join events, the lobby menu, staff login approval, account linking, the blacklist, the player entry policy |
| `limbo` | `felis-limbo-token`, with a replica in the `minecraft` namespace | The login space | Link codes, link status, the blacklist, the player entry policy |
| `build` | `felis-build-token`, with a replica in the `felis-build` namespace | Image build jobs | A submission's build context |
| `ops` | `felis-ops-token` | `felis backup-now` and `felis restore-host` on the host | World backups of stopped servers, world restores during a host rebuild |

A missing or invalid token returns `401`; a valid token for a caller the operation does not list returns `403 wrong_caller`. The audit log records internal calls with the source `internal:<caller>`. Run `sudo felis rotate-token -yes <caller>` to replace a token; see the [Command-line reference](/en/reference/cli#rotate-token).

### Sessions {#sessions}

The external face accepts the session cookie `felis_session` or an API key; the latter is described in [API keys](#api-keys). The cookie is `HttpOnly`, `Secure` and `SameSite=Lax`, and is valid only for the host that issued it, so an operator console session is never sent to the player console. The server stores only the SHA-256 digest of the cookie.

Sessions are issued by these passwordless sign-in methods:

- passkey sign-in;
- email code sign-in;
- in-game bind code sign-in;
- staff login (started on the operator console and approved by a staff member who is in the game);
- the setup token in the first-run setup link (used to initialize the first Owner).

When the installation sits behind Cloudflare Access, Access is enforced at the edge and felis-api does not read the Access token. The sign-in endpoints are rate-limited per source address; over the limit they return `429 rate_limited` with a `Retry-After` header.

### API keys {#api-keys}

An API key lets a script call the external face as the account that created it. The request header takes the form `Authorization: Bearer felis_pat_…`:

```bash
curl -H "Authorization: Bearer $FELIS_API_KEY" https://console.example.com/api/v1/me/servers
```

- **Availability**: the Owner must turn API keys on in the platform settings before keys can be created or used. The setting is off by default; see [API keys](/en/guide/administration#api-keys). When it is turned off, every existing key stops working immediately. When it is turned on again, keys that have neither expired nor been revoked work again.
- **Identity**: a key represents the account that created it. A request that carries both a session cookie and an API key returns `401`.
- **Operations that require a session**: a key cannot manage keys. Using an API key on `/api/v1/account/api-tokens` returns `403 session_required`. A request made with an API key also cannot pass [reauthentication](#reauthentication), and operations that require reauthentication return `403 session_required` for it.
- **Validity and limit**: an ordinary key may have no expiry; when one is set, it can last at most 365 days. Each account can hold up to 10 keys.
- **Admin keys**: Admins and the Owner can set `admin: true` when they create a key. An admin key holds administrative permissions only on the operator console domain. It must have a validity period of no more than 90 days, and creating it requires reauthentication.
- **Storage and audit**: the creation response returns the plain-text key once; the server stores only its SHA-256 digest. The audit log records the source as `api_key:<prefix>`, where the prefix is the first 18 characters of the key.
- **Cross-site checks**: requests made with an API key are not subject to the [cross-site write](#common-behaviour) check.

### Access tiers {#access-tiers}

The `x-felis-tier` of each operation takes one of these values:

| Tier | Face | Requirement |
| --- | --- | --- |
| `public` | Internal, external | No authentication. Covers the health checks, metrics, the sign-in endpoints and sign-out |
| `service` | Internal | A valid service token whose caller is listed in `x-felis-callers` |
| `app` | External | Any signed-in account. Operations on a server also check its ownership |
| `admin` | External | A session of an Admin or the Owner that arrives through the operator console hostname |
| `owner` | External | A session of the Owner that arrives through the operator console hostname |

The operator console is open to staff only: any request from a User session on the operator console hostname returns `403 forbidden`. An Admin or the Owner signed in through the player console hostname has `app`-tier access only. See [Platform administration](/en/guide/administration#roles) for the roles.

### Reauthentication {#reauthentication}

Operations that add, remove or change a way into an account, and the host operations that change the host or read sensitive data (see [Host operation endpoints](#host-operations)), require the session to have proven a sign-in factor within the last 5 minutes; otherwise they return `403 reauth_required`. `GET /api/v1/account/reauth` lists the reauthentication methods available to the current account.

- Signing in with a passkey, an email code, staff login or the setup token counts as reauthentication; signing in with a bind code does not.
- Users reauthenticate with a passkey or an email code.
- Admins and the Owner reauthenticate with a passkey or by signing in again; an email code alone is not a factor for staff.
- A request made with an API key cannot pass reauthentication and returns `403 session_required`.

### Setup lockdown {#setup-lockdown}

An account still in first-run setup (for example, a new Owner who has not verified an email address yet) may call only the operations marked `x-felis-setup-allowed`; every other operation returns `403 setup_required`. The restriction ends when the setup wizard is complete; see [Installation](/en/guide/deployment#setup-wizard).

## Shared behaviour {#common-behaviour}

The following applies to every operation and is not repeated under each one in the OpenAPI document:

- **Response headers**: every response carries `X-Request-Id` (a well-formed inbound value is kept), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `Content-Security-Policy: default-src 'none'`. `Strict-Transport-Security` is added when the request came through the TLS edge (`X-Forwarded-Proto: https`).
- **Error format**: error responses use `{"error": {"code": "...", "message": "...", "request_id": "..."}}`. `code` is a stable machine-readable code; `request_id` matches `X-Request-Id` and locates the matching entry in the server log. The details of a `500` error are written only to the server log.
- **Routing**: a path no operation serves returns `404 not_found`; a path served under other methods returns `405 method_not_allowed` with an `Allow` header.
- **Cross-site writes**: a POST, PUT, PATCH or DELETE that a browser sends from another site returns `403 cross_site` before authentication. The request counts as cross-site when `Sec-Fetch-Site` is `same-site` or `cross-site`, or when the host in `Origin` differs from the request's host. Callers that send neither header, such as plugins and scripts, are unaffected.
- **Request bodies**: a JSON body over 1 MiB returns `413 too_large`; an operation that takes a JSON body returns `415 unsupported_media_type` for any other `Content-Type`. A request body must keep arriving: after 30 seconds it has to average 16 KiB/s or the connection is closed.
- **Event streams**: the console and the build logs use Server-Sent Events and tag each line with `id:` (Unix seconds). A client that reconnects with `Last-Event-ID` within the hour resumes from that second. The server re-checks the caller every minute and ends the stream with `event: revoked` once the session or the access is gone. A stream also closes after 30 minutes and on server shutdown; the client reconnects.

## Endpoint groups {#endpoints}

The tables below list the main endpoint groups. `{name}` in a path is the server name.

### Internal face {#internal-endpoints}

| Group | Path | Tier | Purpose |
| --- | --- | --- | --- |
| Health and metrics | `/healthz`, `/readyz`, `/metrics` | `public` | Liveness and readiness probes; Prometheus metrics. `/healthz` belongs to the external face as well |
| Session verification | `/session/minecraft/hasJoined` | `public` | Multi-source session verification for the game proxy: asks the configured authentication sources in priority order, Mojang first |
| Server lifecycle | `/api/v1/servers`, `/api/v1/internal/servers/{name}/…` | `service` | Server list, wake, status, claim, readiness callback, join events, lobby menu data |
| Players | `/api/v1/internal/player/…` | `service` | Menu access decisions, the username-collision blacklist |
| Account linking | `/api/v1/internal/account/…` | `service` | Link codes, link status, account migration |
| Staff login | `/api/v1/internal/op-login/…` | `service` | Lists pending staff login requests and approves them in the game |
| Player entry policy | `/api/v1/internal/settings/entry-policy` | `service` | The game proxy and the login space read the current policy |
| Build context | `/api/v1/internal/submissions/{id}/context` | `service` | Build jobs read a submission's contents |
| Host commands | `/api/v1/internal/servers/{name}/backup`, `…/restore` | `service` | World backups of stopped servers; world restores during a host rebuild |
| Job transfers | `/api/v1/internal/file-uploads/{id}`, `/api/v1/internal/file-browser/{id}`, `/api/v1/internal/exports/{id}` | `public` | File and export jobs move data with a one-time token |

### External face {#external-endpoints}

| Group | Path | Tier | Purpose |
| --- | --- | --- | --- |
| Sign-in | `/api/v1/auth/…` | `public` | Passkey, email code, staff login, bind code, setup token, sign-out |
| Current user | `/api/v1/me`, `/api/v1/me/servers`, `/api/v1/me/server-quota` | `app` | Account details, the user's own servers and server quota; creating and changing their own servers within it |
| Server software | `/api/v1/software…` | `app` | Available cores, game versions, builds and the Java each needs |
| Account | `/api/v1/account/…` | `app` | Account linking, email, passkeys, reauthentication, sessions, API keys, account migration |
| Server actions | `/api/v1/servers/{name}/…` | `app` | Wake, stop, restart, claim, status, retirement, job records |
| Startup settings | `GET /api/v1/servers/{name}/startup-settings` | `app` | The server owner and Admins read JVM arguments, server arguments, user environment variables and stop commands |
| Console and players | `/api/v1/servers/{name}/console`, `…/command`, `…/access/…`, `…/allowlist` | `app` | The console event stream and RCON commands; whitelist, bans, kicks, OP, LuckPerms |
| Files | `/api/v1/servers/{name}/files…`, `…/file` | `app` | Browse, edit, upload (including chunked uploads), download, unzip, rename |
| Backups and exports | `/api/v1/backups`, `/api/v1/servers/{name}/backup`, `…/restore-backup`, `…/world/export`, `/api/v1/exports/…` | `app` | World backup list, backup now, restore, export and download |
| Schedules | `/api/v1/servers/{name}/schedules…` | `app` | Create, change, delete and run scheduled tasks |
| My submissions | `/api/v1/me/submissions…` | `app` | Modpack submissions and uploads |
| Server administration | `POST /api/v1/servers`, `PATCH /api/v1/servers/{name}`, `/api/v1/fleet`, `/api/v1/nodes`, `/api/v1/servers/{name}/migrations…` | `admin` | Create and change servers, the platform-wide server list, execution nodes, server migration |
| Images and builds | `/api/v1/images`, `/api/v1/images/build…` | `admin` | The image whitelist; builds, build logs, cancellation, security scans and SBOMs |
| Submission review | `/api/v1/submissions…` | `admin` | Approve or reject submissions |
| User administration | `/api/v1/users…` | `owner` | Users, quotas, sessions, passkeys, game profile links |
| Platform settings | `/api/v1/settings/…`, `/api/v1/updates/…`, `/api/v1/platform/db-backup` | `owner` | Player entry policy, wake and archive policies, the self-service default quota, heartbeat, failover, mail relay, authentication sources, the API key switch, maintenance window, update report, database backup status |
| Failover | `/api/v1/nodes/{node}/failover` | `owner` | Read the failover plan and fail over a lost node |
| Emergency stop | `POST /api/v1/servers/{name}/emergency-stop` | `owner` | Stop a server immediately |
| Host operations | See below | `owner` | Run maintenance tasks on the controller host |

### Server advanced settings {#server-startup-settings}

`GET /api/v1/servers/{name}/startup-settings` allows only that server's owner and Admins to read the four arrays `java_flags`, `args`, `env` and `stop_commands`. Each `env` item contains `name` and `value`; empty values are returned as empty strings. Platform-managed environment variables are excluded. These values do not appear in public server status or server lists.

Server owners update them through `PATCH /api/v1/me/servers/{name}`, and Admins through `PATCH /api/v1/servers/{name}`, using the same four fields. Omitting a field or passing `null` keeps its value; passing `[]` clears it. Clearing environment variables removes only user settings and preserves platform-managed values. All fields are validated before they are saved together. Invalid settings return `400 bad_startup_settings`. A concurrent change that cannot be merged returns `409 conflict`; read the settings again before retrying. See [Advanced startup settings](/en/guide/servers#startup-settings) for limits and when changes take effect.

### Additional ports {#server-extra-ports}

Owners use `PATCH /api/v1/me/servers/{name}` and administrators use `PATCH /api/v1/servers/{name}` with an `extraPorts` array, for example `{"extraPorts":[{"protocol":"UDP","port":24454},{"protocol":"TCP","port":8123}]}`. Each entry accepts only `protocol` (`TCP` or `UDP`) and an internal `port` (1–65535). Up to five entries are allowed, with unique protocol/port pairs. Managed game, RCON and health-check TCP ports return `400 bad_extra_ports`. Clients cannot select external ports. Omitted or `null` values keep the current list; `[]` removes it. All fields are validated before being saved together, and changing ports while running does not restart the game.

Manager status and owned server-list rows can include `extraPorts`, with `protocol`, `port`, and a confirmed external `nodePort` plus a complete direct `address` when available. `extraPortsPending` indicates that application is not yet confirmed; unconfirmed external ports and addresses are not presented as valid mappings. Public status omits these fields. Addresses use the node's external IP rather than a Cloudflare Tunnel hostname.

Account deletion and world release wait for port removal to be confirmed. Incomplete cleanup retains ownership; HTTP requests can return `409 extra_ports_pending` and be retried later. See [Additional TCP and UDP ports](/en/guide/servers#extra-ports).

### Disk usage {#server-disk-usage}

Server status and lists return `disk` only to the server owner and administrators, with `usedBytes`, `limitBytes`, `sampledAt` and `stale`. The field is omitted when no successful measurement exists; stopped servers can still report usage. `diskFull` indicates that the quota blocks startup. Public status may include this flag without disclosing usage.

`stale: true` can indicate an expired measurement or a new below-quota measurement awaiting confirmation after cleanup. Use `diskFull` to determine whether startup is blocked.

Start and restart endpoints return `409 disk_full` while the quota blocks startup. An existing block remains until a new successful measurement confirms usage below the quota; failed or stale measurements do not release it. Normal stops, file management and downloads remain available. See [Disk usage and quota](/en/guide/servers#disk-quota) for measurement rules and update delays.

### Host operation endpoints {#host-operations}

All host operation endpoints belong to the external face and have the tier `owner`. felis-api hands each task to `felis-node-control.service`, a root service on the host, which runs the same `felis` command or installer function as the command line. The panel location and command-line equivalent of each operation are listed in the [Operations overview](/en/operations/#panel-host-operations).

| Method and path | Purpose | Reauthentication |
| --- | --- | --- |
| `GET /api/v1/platform/host` | Host overview: disks, memory, services and timers, open alerts, database bundles, the off-site copy, host settings | Not required |
| `POST /api/v1/platform/host/quiet` | Hold the watchdog's mail until a time within the next seven days, or lift the hold | Required |
| `POST /api/v1/platform/offsite/key` | Read the off-site encryption key | Required |
| `GET /api/v1/platform/audit-export` | Export the audit log | Required |
| `GET /api/v1/settings/node-control` | List host tasks | Not required |
| `POST /api/v1/settings/node-control/tasks` | Start a host task | Required |
| `GET /api/v1/settings/node-control/tasks/{id}` | Read a task's stage, error and recent execution log | Not required |
| `POST /api/v1/settings/node-control/tasks/{id}/retry` | Create a new attempt from a failed task | Required |
| `GET /api/v1/settings/node-control/tasks/{id}/artifact` | Download a file a task produced, such as a support bundle | Required |

The request body that starts a task has these fields:

| Field | Description |
| --- | --- |
| `action` | The operation. Node operations are `enable`, `join`, `approve`, `upgrade`, `fence`, `unfence`, `enable-ha` and `join-controller`; host tasks are `db-backup`, `db-verify`, `db-delete`, `db-restore`, `offsite-sync`, `offsite-list`, `offsite-check-key`, `offsite-take-over`, `offsite-configure`, `offsite-disable`, `restore-host`, `backup-now`, `rotate-token`, `domain-check`, `domain-set`, `storage-configure`, `connection-configure`, `converge`, `doctor`, `support-bundle`, `host-settings` and `server-forwarding` |
| `confirmMaintenance` | Required. Must be `true` for every node operation and for host tasks that disconnect players, restart the panel or replace data |
| `name`, `sshTarget`, `externalIP`, `peers` | Node operation parameters: the node name, a verified root SSH target, the node's fixed address, additional peer addresses |
| `params` | The operation's own inputs, kept with the task, such as a bundle name, a domain or a mode |
| `secrets` | Credentials the operation needs, such as bucket keys or an API token. They reach the host only, are never stored with the task and are never returned; a retry asks for them again |

A task record carries `state` (`running`, `succeeded`, `failed`), `stage`, `error`, the most recent 64 KiB of `log`, the data the operation reports in `result`, and the file it produced in `artifact`. One task runs at a time: starting another while one runs returns `409`. When the host service is unavailable, the endpoints return `503`.
