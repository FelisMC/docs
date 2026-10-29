---
title: Monitoring and alerts
description: Host status and health checks, the support bundle, the watchdog and its alert mail, the mail relay, the external heartbeat, metrics and alert rules, and audit log export.
---

# Monitoring and alerts {#monitoring}

This page is for operators. It explains how to read the state of a Felis host, create a support bundle, what the watchdog checks and how it sends alerts, how to configure the mail relay and the external heartbeat, how to connect Felis to an existing Prometheus, and how to export the audit log. To troubleshoot by symptom, see [Troubleshooting](/en/operations/troubleshooting#first-steps).

Every full installation runs the watchdog from `felis-watchdog.timer`, which mails the Owners when something breaks, with no monitoring stack needed. The metrics and alert rules further down are for deployments that also run their own Prometheus.

## Server resource sampling {#server-resource-metrics}

Full installations enable the metrics-server bundled with k3s to supply per-server CPU and memory values to the console and server list. Sampling queries PodMetrics only in the Minecraft namespace; felis-api does not need cluster-scoped node metrics permissions. See [Resource usage](/en/guide/servers#resource-usage) for the interface.

When upgrading an older installation that disabled metrics-server, the installer removes that disable flag and restarts k3s once to load the change. The API is briefly unavailable during the restart; running game containers continue running. History starts accumulating after the component becomes ready. To investigate missing metrics, check `sudo k3s kubectl -n kube-system get deployment metrics-server` and `sudo k3s kubectl top pods -n minecraft`.

## Status and health checks {#diagnostics}

The following two commands run as root on the host. They only read state, change nothing and send no mail, so they are safe to run at any time.

**`sudo felis status`** summarizes the whole platform: the release, the node and its kubelet, each control-plane Deployment (ready replicas, image, pod restarts), the game proxy (the `felis-velocity` unit and whether the game port accepts connections), every server with its desired state, phase, players and newest world backup, the newest database bundle and the off-site copy, the watched disks and memory, and the alerts the watchdog has open. When one part is down, the rest still prints: with k3s stopped, the cluster line reads `unreachable (...)` and the servers `unknown while the cluster is unreachable`; with PostgreSQL down, the backup column reads `?` and a line under the table says why.

**`sudo felis doctor`** runs every check the watchdog runs, with the settings `felis-watchdog.service` gives it, plus what only the host shows: a Felis unit that failed, a long-running service (`k3s`, `felis-velocity`) that stopped, a timer that no longer fires, alerts that reach no one (no mail relay, or no Owner with a verified address) and an unusable heartbeat URL. It prints one line per area: `✓` fine, `!` warnings, `✗` something critical, `-` not checked and why (for example, the off-site copy on an installation without one), and each finding says where to look next:

```text
felis doctor on felis-1 at 2026-09-27 12:00 UTC
checks run as /etc/systemd/system/felis-watchdog.service runs them (config /etc/felis/felis.host.toml)

✓  configuration
✓  Kubernetes cluster
✗  PostgreSQL
     critical postgres: PostgreSQL is unreachable: sign-in, the panel and server management fail
              → k3s kubectl -n felis get pods -l app.kubernetes.io/component=postgres; k3s kubectl -n felis logs deploy/felis-postgres --tail=100 (...)
-  off-site copy: not checked, not configured
...
1 problem(s): 1 critical, 0 warning(s)
```

It exits 1 when it found anything and 0 otherwise, so a script can run it. `felis doctor` sends no mail, pings no heartbeat and leaves the watchdog's state alone; an alert it shows is mailed by the watchdog's next regular run, on the watchdog's delays. A missing or unreadable `felis-watchdog.service` is itself a critical finding, and the checks then run with the watchdog's defaults.

In the panel:

- **Maintenance & Backups → Status** → **Host status** shows the disks, memory, watchdog alerts, services and timers, and the game proxy.
- **Maintenance & Backups → Diagnostics** → **Health check** → **Run health check** runs `felis doctor` and shows the results by area: **Configuration**, **Kubernetes cluster**, **PostgreSQL**, **Game proxy**, **Database backups**, **Off-site copy**, **Build scan database**, **Disk space**, **Memory**, **k3s certificates**, **Node address**, **Clock**, **Services and timers** and **Alert delivery**.
- The **Platform status** bar on the Dashboard shows the open alerts, the newest database backup, the off-site copy state and the disk with the least free space.

## Support bundle {#support-bundle}

`sudo felis support-bundle` collects what someone helping you needs into one file, `/var/lib/felis/support/felis-support-<host>-<time>.tar.gz` (mode 0600).

The bundle holds: `status.txt` and `doctor.txt`, the release, a summary of the configuration (names and settings, no credentials), the Felis units and timers, `df`, network addresses and memory, the names of the files under `/etc/felis` (no contents), each Felis unit's and k3s's journal, the nodes, volumes and servers, the pods, Deployments, StatefulSets, Jobs, CronJobs, Services, storage claims, network policies and events of the control-plane, build and server namespaces, and the tail of every control-plane and build container's log (and of its previous run after a restart). Game servers contribute their init containers' logs only.

The bundle leaves out every Secret and ConfigMap, the contents of every configuration file, the database and every world. From what it keeps, it removes: every value in the host's secret files (`secrets.env`, `offsite.env`, the mail relay and upload storage keys, the heartbeat URL, the forwarding secret, the game proxy's token, the k3s tokens), the database password, every environment value of a pod or server, passwords in URLs, private keys, `Bearer`/`Basic` credentials, and anything a log or report writes as `password=`, `token=`, `secret=` and the like. `MANIFEST.txt` inside lists what the bundle holds, what was removed, and what could not be collected (for example, k3s down or a log that is gone).

| Option | Default | Description |
| --- | --- | --- |
| `-o DIR` | `/var/lib/felis/support` | Directory to write the bundle to, created with mode 0700 when missing |
| `-since` | `48h` | How far back each unit's journal is read |
| `-log-lines` | `2000` | Lines kept from the end of each pod log and each unit's journal |
| `-server-logs` | Off | Also collect the game servers' own logs, which carry player names, IP addresses and chat |

In the panel, use **Maintenance & Backups → Diagnostics** → **Support bundle**: tick **Include game server logs** only when the problem concerns a server, select **Create support bundle**, and select **Download** when the task finishes.

::: warning
Read the bundle through before sending it anywhere. A secret written in a form none of these rules recognizes stays in the bundle.
:::

## Watchdog {#watchdog}

Every two minutes the watchdog checks the host and sends alert mail once a condition has lasted for the time in the table:

| Check | Mailed after | Severity |
| --- | --- | --- |
| The control-plane Deployment `felis-postgres`, `felis-api`, `felis-operator` or `registry` is missing or has no available pod | 5 min | Critical |
| The Kubernetes API is unreachable (k3s down); the cluster checks below are then unknown and keep their state | 5 min | Critical |
| The login space should run and is not `Running` | 10 min | Critical |
| Another system server (the lobby) should run and is not `Running` | 10 min | Warning |
| A user server is in `Failed` | 5 min | Warning |
| A backup, restore or world cleanup job failed in the last 24 hours | At once, once | Warning |
| The world cleanup CronJob last succeeded more than 26 hours ago | At once | Warning |
| A node is `NotReady`, or the kubelet reports disk, memory or PID pressure | 5 min (pressure: 2 min) | Critical |
| PostgreSQL is unreachable | 3 min | Critical |
| The game proxy refuses connections on the game port | 3 min | Critical |
| The newest daily database bundle is more than 26 hours old, or none exists; a later manual or off-site bundle does not clear it | 10 min | Critical |
| The newest database bundle lacks the MinecraftServer resources | 10 min | Warning |
| A configured off-site copy has not completed within 12 hours, or has stopped (the bucket is sealed with another key, another host took it over, or this host stands by) | 10 min | Warning |
| The build scan vulnerability database in the registry has not been refreshed for 72 hours | 10 min | Warning |
| A watched filesystem has less than 15% free (less than 5%: critical) | 15 min (critical: 5 min) | Warning |
| Less than 10% of host memory is available | 15 min | Warning |
| The host no longer holds the IP address it was installed on | 5 min | Critical |
| The system clock is not synchronized by NTP | 30 min | Warning |
| A k3s certificate expires within 30 days (within 7 days, or expired: critical) | At once | Warning |
| The watchdog's own runs keep failing (`watchdog/run`) | 10 min | Critical |
| The watchdog's state file did not parse and was moved aside (`watchdog/state`) | At once, once | Warning |

The watched filesystems include those holding `/`, `/var/lib/rancher/k3s`, `/var/lib/felis` and the database backup directory. For address, clock and disk problems, see [Troubleshooting](/en/operations/troubleshooting#host-address-changed).

```bash
journalctl -u felis-watchdog -n 40          # every check of the latest runs
sudo felis watchdog -dry-run                # run the checks now; mail nothing, change nothing
systemctl list-timers felis-watchdog.timer  # when it last ran and runs next
```

A healthy run logs `every check passed`. Otherwise it logs one line per finding, and the mail's subject once one is sent. A `-dry-run` from a shell uses the command's defaults, which do not include the game proxy and IP address checks; the service unit carries `-proxy-addr 127.0.0.1:<game port>`, `-node-ip <install address>` and the disk list the installation chose, which `systemctl cat felis-watchdog` shows.

### When the watchdog itself fails {#watchdog-failures}

`felis-watchdog.service` carries `OnFailure=felis-watchdog-failed.service`. When a run fails (a crash, the 3-minute time limit, a `felis.toml` that no longer loads), systemd runs `felis watchdog -unit-failed`, which:

- reports systemd's result to the heartbeat's `/fail` endpoint at once, for example `felis-watchdog.service failed: result exit-code, exit status 3`, except while the installer runs or this host stands by;
- records `watchdog/run` and mails it once runs have kept failing for 10 minutes. The relay and recipients come from `felis.toml` when it loads and from the watchdog's cache when it does not; a panel relay cached by the last good run takes precedence over `felis.toml`. The first passing run clears it.

A state file `/var/lib/felis/watchdog/state.json` that does not parse is renamed to `state.json.unreadable-<Unix time>`. The run starts from a fresh state and mails `watchdog/state` once. The fresh state has lost the open alerts' history, so each problem still present is mailed again as new. A power loss right after a save, or a hand edit, usually causes this; check `df -h /var/lib/felis`, then delete the set-aside copy.

A state file that cannot be written (a full or read-only `/var/lib/felis`) leaves the run's state in `/run/felis/watchdog-state.json` (tmpfs, root-only). The next run reads whichever of the two was written last, so an alert is not mailed again every two minutes. Each such run logs `save state: ...; kept in /run/felis/watchdog-state.json until the host restarts`, exits 1 and reports to the heartbeat's `/fail`; after five in a row, `watchdog/run` is mailed once. The first run whose state file saves again deletes the tmpfs copy. A restart before that forgets what was mailed, so the open problems are mailed again as new.

```bash
journalctl -u felis-watchdog-failed -n 20   # what the fallback reported and pinged
systemctl status felis-watchdog             # the failed run's result
```

## Alert mail {#alerts}

The watchdog mails by these rules:

- **Recipients** are the verified email addresses of all enabled Owner accounts. An Owner verifies their address under **Account → Email Verification**.
- **The relay** is the one sign-in codes use: the relay the Owner saved in the panel (read from the database on each run), otherwise `[smtp]` in `felis.toml`; see [Mail relay](#mail-relay).
- **One mail per run at most**, holding everything that came due: new problems, a daily reminder for each problem still open, and a resolved notice once a problem has stayed gone for 10 minutes. A condition that heals before its delay is never mailed; one that turns critical is mailed again at once.
- **During an installation** nothing is mailed: the installer writes `/run/felis/watchdog-quiet-until` and removes it when it exits.
- **On a host built from another host's backup** (a rehearsal on a spare machine, or a rebuilt host before `felis offsite take-over`), nothing is mailed while the host the off-site bucket names ran within the last 3 hours: the Owners in the restored database belong to that host, and it mails them itself. The run logs `this host stands by for host ...; holding this mail`. Once that host stops running, the standby itself is mailed as a finding.
- **Mail still goes out while the database or the API is down.** For the `[smtp]` relay the password is read from the host file `/etc/felis/smtp-password` (the Secret `felis-smtp` when that file is missing). The relay in use, its password and the recipient list are cached in `/var/lib/felis/watchdog/state.json` (root-only). A run that cannot read the database keeps mailing through the panel relay as the last good run cached it, and falls back to `[smtp]` only when that run used `[smtp]` too.

With no relay or no Owner with a verified address, each alert is written to the journal only, and while an alert is open each run reports to the heartbeat's `/fail` endpoint if a heartbeat is configured. A fresh installation starts in this state: it ends with `NO ALERT MAIL`, and the `alerts` row of the card at the end of `sudo felis setup` shows where alerts go (`mailed to <address> via <relay>`) or what is missing, marked `⚠`. Press `e` on that card to configure email (or save a relay in the panel), then verify the Owner's address in the panel. The `heartbeat` row below it shows the heartbeat setting. That card and `felis doctor` read the relay and the heartbeat saved in the panel first and fall back to `felis.toml` and the heartbeat file, as the watchdog does.

## Holding alert mail {#hold-alerts}

Planned maintenance makes the watchdog see downtime you expect. Hold the alert mail before you start, so that the Owners do not receive pointless alerts:

1. Open **Maintenance & Backups → Status** → **Host status** → **Watchdog alerts**.
2. Under **Hold duration**, choose 1, 4 or 24 hours, then select **Hold alert mail**.
3. When the work is done, select **Resume alert mail**, or let the hold expire.

During a hold the watchdog keeps checking and the alerts stay listed in the panel, but no mail is sent and no failure is reported to the heartbeat's `/fail` endpoint. A hold ends at most seven days ahead.

On the command line, the hold is the file `/run/felis/watchdog-quiet-until`, which holds the Unix time the hold ends. The file is on tmpfs and disappears when the host restarts.

```bash
sudo install -d -m 0755 /run/felis
echo $(( $(date +%s) + 3600 )) | sudo tee /run/felis/watchdog-quiet-until   # hold for 1 hour
sudo rm /run/felis/watchdog-quiet-until                                       # resume alert mail
```

## Ignoring an alert {#ignore-alerts}

A hold covers every check and expires. An alert that needs no action, such as `clock` on a host whose clock is deliberately left unsynchronized, can be ignored on its own:

1. Open **Maintenance & Backups → Status** → **Host status** → **Watchdog alerts**.
2. Select **Ignore** beside the alert and confirm your identity when asked.

An ignored check keeps running, but it sends no mail or reminders, does not count as an open alert and reports no failure to the heartbeat's `/fail` endpoint; no recovery notice is sent when it clears. An ignore lasts until it is removed and survives host restarts. Ignored checks are listed under **Ignored**; after **Restore alerts**, an alert that is still open is mailed on the usual schedule.

The ignore list is kept on the host in `/var/lib/felis/watchdog/ignored.json`, a JSON array of alert keys.

## Mail relay {#mail-relay}

The mail relay sends sign-in codes, email verification and identity confirmation codes, notices, the world cleanup's warnings, watchdog alerts and the emergency console's codes. A relay comes from one of two places:

- The relay saved on the **Mail delivery** card under **Platform settings → Notifications and retention**, stored in the `smtp` row of `platform_settings`.
- The `[smtp]` relay the email step of `felis setup` writes into `felis.toml` (the install-time settings).

A relay saved in the panel takes precedence for every sender without a restart: felis-api reads it at most every 15 seconds, and the world cleanup, the watchdog and the emergency console at their next run. The card shows which source is in force: **Panel settings**, **Install-time settings** or **Not configured**.

To configure the relay in the panel:

1. Open **Platform settings → Notifications and retention** → **Mail delivery**.
2. Enter the **Server host**, **Port**, **Sender address**, **User name**, **Password** and **Hourly mail cap**, and review **Require an encrypted connection**.
3. Optionally select **Send test message**, which sends one message through the relay as typed to the Owner's verified address (or to the sender address when there is none).
4. Select **Check and save**. Felis first delivers one self-test message to the sender address and saves only once the relay has accepted it; the check cannot be skipped.

| Setting | Rules |
| --- | --- |
| Port | 25, 465, 587 (STARTTLS, recommended) and 2525 only. felis-api reaches the relay from inside the cluster, and any other port is refused |
| Sender address | A plain address without a display name. It must be a sending identity your mail provider has authorized, or the provider rejects the mail at delivery |
| Require an encrypted connection | On by default. When on, a relay on a port other than 465 that does not offer STARTTLS is refused, with no exception for a relay on this host. Turn it off only for a server reached over a trusted internal network |
| Hourly mail cap | The installation-wide mail budget, replacing `[smtp] max_per_hour`; 0 means the default of 120, and up to a quarter of it may go out at once. Keep it at or below your mail provider's limit |
| Password | Never sent back to the panel and never written to the audit log; the card shows only that one is saved, and an empty field keeps it. The password is stored in the database, so it travels in the database bundles and their encrypted off-site copies |

A failed check names its stage: `smtp_unreachable`, `smtp_tls`, `smtp_auth`, `smtp_sender_refused`, `smtp_recipient_refused`, otherwise `smtp_failed`. The relay's own text is written to the felis-api log only. felis-api refuses to connect to link-local, unspecified and multicast addresses (checked after DNS resolution); such a relay answers `smtp_unreachable`.

**Revert to install-time settings** clears the panel relay and hands the relay back to `[smtp]` in `felis.toml`; if none was configured at install time, email codes cannot be sent. The email screen of `felis setup` also clears the panel relay each time it saves, so the relay typed there is the one in force. Saving, clearing and the test message require a fresh identity confirmation; a save made against a relay someone else changed since the card loaded answers `409 mail_settings_changed`. The audit actions are `smtp.updated` and `smtp.cleared`.

An `[smtp]` relay on port 465 is spoken to over TLS from the first byte; on any other port STARTTLS is required, and a relay that does not offer it fails with `smtp: <host>:<port> does not offer STARTTLS`. `[smtp]` makes no such demand of a relay on this host (`localhost`, `127.0.0.0/8`, `::1`). For a relay reached over a trusted link that offers no STARTTLS, set `require_tls = false` under `[smtp]` in `/etc/felis/felis.toml` and `/etc/felis/felis.pod.toml`; installer re-runs and the setup email screen keep it.

::: warning
With no relay at all, email sign-in, operator console sign-in, email verification and the email confirmation for sensitive actions answer `503 mail_unavailable`. Users can sign in with a passkey only, a verified address no longer counts as a way to confirm identity, and watchdog alerts go to the journal only. Configure a relay soon after installation.
:::

For mail delivery problems, see [Mail and alert problems](/en/operations/troubleshooting#mail-problems).

## External heartbeat {#heartbeat}

A host that is off, a timer that stopped, a watchdog that crashes before it can mail: the host reports none of these about itself. An external heartbeat covers them. Every watchdog run pings a check at an outside monitoring service (Healthchecks.io, or one that follows its API), and that service notifies you when the pings stop.

1. Create a check at the monitoring service with a period of 2 minutes and a grace time of 10 minutes.
2. Give the watchdog the check's ping URL, in either of two places:
   - In the panel, under **Platform settings → Notifications and retention** → **Monitoring heartbeat**: enter the **Heartbeat URL** and select **Save heartbeat URL**. The next watchdog run uses it.
   - On the host: re-run the installer with `FELIS_WATCHDOG_HEARTBEAT_URL=<ping URL>`, which writes the URL to `/etc/felis/watchdog-heartbeat-url` (root-only, mode 0600).

The URL's path is the check's key, so the panel, the installer output and the journal show only its scheme and host. A URL saved in the panel takes precedence over the host file; each run reads it from the database and caches it in the watchdog's state, so runs while the database is down, and the failure fallback, still ping it. **Remove heartbeat URL** clears the panel's URL, after which the watchdog uses the host file the installer wrote, if any; the monitoring service then alerts on the missing pings, so pause the check there as well. Saving and removing require a fresh identity confirmation; the audit actions are `platform.heartbeat` and `platform.heartbeat.clear`.

A later installer run without the variable keeps the host file, and `FELIS_WATCHDOG_HEARTBEAT_URL=off` removes it. When neither the panel nor the host file holds a heartbeat URL, the installation ends with `NO HEARTBEAT`.

| The run | Ping |
| --- | --- |
| Its alerts reached the Owners (mailed, or nothing due) | `GET <url>` |
| An alert is open and reaches no one (no relay or no verified address), the mail failed, or the state did not save | `POST <url>/fail`, with the reason and the findings in the body |
| One of those failures while the installer runs | Nothing |
| This host stands by for another host's off-site bucket | Nothing; the host that writes the bucket pings the check |

A URL with a query string (`?`) has no `/fail` endpoint, so a failing run sends no ping and the service alerts once the grace time runs out. A ping that times out (10 seconds) or gets a non-2xx answer logs `felis watchdog: heartbeat: ...`; the run's exit status stays that of its checks and its mail.

A database bundle carries `/etc/felis` and the heartbeat file with it, and a URL saved in the panel travels with the database. A host rebuilt from a bundle stands by and pings nothing until `felis offsite take-over`; from then on it pings the same check.

## Metrics and alert rules {#metrics}

### Metrics {#metric-list}

- `felis_servers_total`: the number of managed servers.
- `felis_server_phase{server,role,phase,desired}`: 1 for each server's current phase. `role` is `login` or `lobby` for system servers and empty for user servers. `desired` tells a server that is down on purpose from one that failed to come up.
- `felis_build_info{component,version}`: 1 on the process serving it (`operator` or `api`); its absence means that process is down.
- `felis_start_duration_seconds`: a histogram, observed once per start when readiness is first reached. A start that never completes contributes nothing, so missing observations are themselves the sign that starts are hanging.
- `felis_image_build_failures_total`: increments when a build job fails.
- `felis_reaper_worlds_deleted_total`: increments when a world volume is actually deleted after its backup; a spike means worlds crossed the idle limit, so check that player join events are being reported.
- `felis_http_requests_total{face,method,route,code}` and `felis_http_request_duration_seconds{face,route}`: every API request, by the route pattern it matched (such as `/api/v1/servers/{name}/status`; `unmatched` when no route serves the path). `face` is `internal` or `external`. Log streams count as requests but stay out of the latency histogram. A rise in `code=~"5.."` on one route narrows a failure to one handler; a rise in `route="unmatched"` usually means someone is scanning.
- felis-api's Go runtime and process series (`go_*`, `process_*`): goroutines, heap and open file descriptors. Goroutines that climb without falling back usually mean log streams or uploads that never end.
- `go_sql_*{db_name="felis"}`: the API's database connection pool. It is capped at 25 connections, and every connection runs with `statement_timeout=15s` and `idle_in_transaction_session_timeout=60s` unless the `[database] url` sets its own. `go_sql_in_use_connections` sitting at `go_sql_max_open_connections` while `go_sql_wait_count_total` climbs means requests are queueing for a connection; look for a slow query or a lock (`SELECT pid, state, wait_event, query FROM pg_stat_activity`). A statement cut off by the limit logs `canceling statement due to statement timeout`.
- Sign-in series: `felis_mail_total`, `felis_rate_limited_total`, `felis_auth_otp_lockouts_total`, `felis_auth_failures_total`, `felis_sessions_revoked_total` and `felis_audit_write_failures_total`.

The API also writes one logfmt access-log line per request, with `face`, `method`, `route`, `path`, `status`, `duration_ms`, `bytes`, `request_id` (the id in every error response) and `principal` (the user id, once signed in). Successful probes and scrapes are left out.

```bash
sudo k3s kubectl -n felis logs deploy/felis-api | grep 'msg=request' | grep 'status=5'
sudo k3s kubectl -n felis logs deploy/felis-api | grep 'request_id=<id from the error>'
```

The game plugins' calls are the `face="internal"` series, one route per kind of call:

```text
sum by (route, code) (rate(felis_http_requests_total{face="internal", route="/api/v1/internal/servers/{name}/join-event"}[5m]))
sum by (route, code) (rate(felis_http_requests_total{face="internal", route="/api/v1/internal/servers/{name}/wake"}[5m]))
histogram_quantile(0.95, sum by (le, route) (rate(felis_http_request_duration_seconds_bucket{face="internal"}[5m])))
```

A call that never reached felis-api (refused, reset or timed out) is missing from those series; the caller counts it. The game proxy logs one line per active 10 minutes, and `/felis` at the proxy console prints the totals since start:

```bash
journalctl -u felis-velocity | grep 'Felis: last 10 min'
# Felis: last 10 min: felis-api calls=412 (no answer=0, 4xx=3, 5xx=0, retried=0), avg=18 ms, max=240 ms,
#   busy refusals=0, join-events failed=0, join-events dropped=0, transfers failed=0,
#   server-list refreshes failed=0, waiting now=0
journalctl -u felis-velocity | grep 'server list refresh'
sudo k3s kubectl -n minecraft logs login-0 | grep 'link status poll'
```

`no answer` rising while `felis_http_requests_total` stays flat means the path to the internal API is broken (a network policy, the Service, or the API pod). `busy refusals` or `join-events dropped` above zero means felis-api answers more slowly than the proxy's pool of 8 threads can absorb. A server-list refresh or link-status outage logs a warning when it starts, the failure count every 5 minutes while it lasts, and an info line when it recovers.

### Scraping {#scraping}

The series come from two processes. Both Services carry the `prometheus.io/scrape|port|path` annotations, so a Prometheus that discovers annotated Service endpoints picks them up as they are:

- `felis-operator` on `:8080/metrics` (Service `felis-operator-metrics`): `felis_servers_total`, `felis_server_phase`, `felis_start_duration_seconds`, `felis_build_info{component="operator"}`, and controller-runtime's `controller_runtime_reconcile_*` and `workqueue_*` series.
- felis-api's internal face on `:8081/metrics` (Service `felis-api-internal`): `felis_build_info{component="api"}`, the `felis_http_*`, `go_*`/`process_*` and `go_sql_*` series, `felis_image_build_failures_total` and the sign-in series above. Unauthenticated like the health probes, served on the ClusterIP only, and never on the external face.
- `felis_reaper_worlds_deleted_total` is produced inside the one-shot world cleanup CronJob, which exits long before any scrape interval; without a pushgateway it cannot be scraped. Read the cleanup pod's log or the `world_backups` table instead.

The database backup freshness metric `felis_db_backup_last_success_timestamp_seconds` is written by each daily backup to `FELIS_DB_BACKUP_METRICS` (default `/var/lib/node_exporter/textfile_collector/felis_db_backup.prom`); point node-exporter's `--collector.textfile.directory` at that directory.

### Alert rules {#alert-rules}

The `deploy/alerts/` directory of the Felis source repository ships ready-made rules in these groups:

- **Control plane**: `felis-operator` or `felis-api` down or not scraped (`FelisOperatorDown`, `FelisAPIDown`).
- **Servers**: the login space or another system server not running (`FelisLoginGateDown`, `FelisSystemServerDown`), and a user server in `Failed` (`FelisServerFailed`).
- **Operator reconcile**: errors piling up (`FelisReconcileErrors`), and a pass stuck past 3 minutes (`FelisReconcileStuck`). The operator's liveness probe restarts a pod whose pass runs past 10 minutes.
- **World jobs** (needs kube-state-metrics): a failed backup, restore or cleanup job (`FelisWorldJobFailed`), and a world cleanup that has not succeeded for 26 hours (`FelisReaperStale`).
- **Builds and starts**: build failures and slow starts.
- **Node**: disk and memory thresholds, and the kubelet `DiskPressure` condition.
- **Database backups**: control-plane backup freshness (`FelisDBBackupStale`, `FelisDBBackupMetricMissing`; needs node-exporter's textfile collector).
- **Sign-in abuse**: the mail budget, relay failures, throttled floods, account code locks and the refused sign-in rate, plus lost audit records.

To load the rules:

- Plain Prometheus: add `felis-alerts.yaml` to `rule_files`, and check it with `promtool check rules felis-alerts.yaml`.
- kube-prometheus-stack or prometheus-operator: run `kubectl apply -f felis-prometheusrule.yaml`, after adjusting its `release:` label to your stack's ruleSelector.

## Exporting the audit log {#audit-export}

Audit records are deleted once they pass their retention. The retention comes from `[audit] retention` in `felis.toml`: the default is `365d`, and it takes days (`90d`), months of 30 days (`18mo`) or `forever`, refusing anything under `30d`. The Owner can override it under **Platform settings → Notifications and retention** → **Backup and audit retention** with **Days audit rows are kept** (0 keeps every record, otherwise 30 to 3650 days), which felis-api applies at its next cleanup. Database bundles still hold older records for as long as the bundles are kept. For what the audit log contains, see [Audit log](/en/guide/administration#audit-log).

To keep records past the retention, export them before they go:

```bash
sudo felis db audit-export -until 2026-01-01 -out /root/audit-2025.jsonl
```

`-since` and `-until` take a date (UTC midnight) or an RFC 3339 instant; the exported range is `[since, until)`. Each line is one record as JSON, oldest first. The file is created with mode 0600, and an existing file is never overwritten.

In the panel, use **Maintenance & Backups → Backups** → **Audit log export**: choose **From (inclusive)** and **To (exclusive)** (leave a date empty to export from the oldest or to the newest record), then select **Download**.
