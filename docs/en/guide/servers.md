---
title: Managing servers
---

# Managing servers {#管理服务器}

* **On-demand Start and Stop**: A server starts when a player connects to the proxy. The player waits in a queue during start-up and is transferred once the server is ready. Idle servers stop automatically to free memory.

* **Web Dashboard**: Monitor server status, online players, and resource usage from your browser.
  * Console (RCON), whitelist, bans, OPs and LuckPerms permissions
  * File manager: create, delete, rename, chunked upload, download, and unzip while the server is stopped; also used to import worlds
  * Schedules: run commands, restart, stop, start or back up by weekday and time zone, with an in-game warning to players beforehand

* **Multi-core Support**: Compatible with Paper, Fabric, Forge, and NeoForge, accessed through a single Velocity proxy.

* **Modpack Submission**: Players can upload modpacks. After admin approval, each modpack is built automatically and scanned with Trivy; the result is added to the image whitelist and can be selected as a server image.

## 12. A configuration field seems to be ignored {#_12-a-configuration-field-seems-to-be-ignored}

Every field below is read by a controller. What varies is the condition that
decides whether setting it does anything.

| Field | What you might expect | Reality |
|---|---|---|
| `spec.startup.timeoutSeconds` | Start budget before `Failed` | Read by `startupTimedOut` (`reconciler.go:479`), called at `:126`. `0` or unset falls back to **300s**, then `markFailed("StartupTimeout")` |
| `spec.startup.readinessTimeoutSeconds` | First-probe budget | Read by `readinessTimedOut` (`reconciler.go:490`), called at `:157`. `0` or unset falls back to **300s**, then `markFailed("ReadinessTimeout")`. Not to be confused with the prober's own 5s dial timeout (`prober.go:45`) |
| `spec.idle.autoStopEnabled` | Auto-stop empty servers | Read at `reconciler.go:175` — but gated on `spec.rcon.enabled`, since the player tally comes from the RCON probe (§11) |
| `spec.idle.emptySecondsBeforeStop` | Empty grace period | Same branch. Must be `> 0`; the guard treats `0` as "off", not "stop immediately" |

Both startup budgets are measured from the same `status.startRequestedAt`, so
`readinessTimeoutSeconds` is not a budget *after* pod readiness — it is a
deadline for the whole start, applied on the RCON-probe branch.

---

See [Troubleshooting](/en/operations/troubleshooting) for startup, connection, idle shutdown and file operations.
