---
title: Server plugins
description: The Felis Velocity, Limbo and Paper plugins and the loader mods — what they do, Minecraft versions, building, dependency verification and deployment.
---

# Server plugins {#plugins}

This page describes the Java plugins and mods in the repository's `plugins/` directory: what each module does, the Minecraft versions it supports, the identity trust model, the game proxy's routing behaviour, the lobby menu, and how to build, verify and deploy them by hand. It is for developers and for operators who deploy plugins manually. The installer builds and deploys the plugins the game proxy, the login space and the lobby need.

## Overview {#overview}

| Module | Platform | Compiles against | Jar | Built by the installer |
| --- | --- | --- | --- | --- |
| `velocity/` | Velocity proxy plugin | velocity-api 3.5.1 (Java 21 bytecode) | `felis-velocity-0.1.0.jar` | Yes |
| `limbo/` | LOOHP/Limbo plugin (login space) | Limbo API 2026.0.3-ALPHA (Java 17 bytecode) | `felis-limbo-0.1.0.jar` | Yes |
| `paper/` | Paper plugin (lobby) | paper-api 26.3.build.40-alpha | `felis-paper-0.1.0.jar` | Yes |
| `fabric/` | Fabric server mod | MC 1.20.1 / fabric-loader 0.16.5 / fabric-api 0.92.2+1.20.1 | `felis-fabric-0.1.0.jar` | No |
| `forge/` | Forge server mod | MC 1.20.1 / Forge 47.3.0 | `felis-forge-0.1.0.jar` | No |
| `neoforge/` | NeoForge server mod | MC 1.20.4 / NeoForge 20.4.251 | `felis-neoforge-0.1.0.jar` | No |
| `shared/` | Not built on its own | — | Source compiled into each module | Source only |

What each module does:

- **The Velocity plugin** (plugin ID `felis-link`) is a full proxy plugin: it recognizes servers by subdomain, registers backends dynamically, wakes sleeping servers and holds players until they are ready, routes by the [player entry policy](/en/guide/players#entry-policy), provides the `/link`, `/felis` and `/invite` commands, and approves staff logins in the game. It reaches felis-api directly through the internal face; see [Velocity routing](#velocity-routing).
- **The Limbo plugin** turns the login space into the authentication gate: it serves a readiness endpoint, mints a bind code for players who have not linked an account, and holds them until they complete the link in the panel. See [Login space image](/en/reference/limbo).
- **The Paper plugin** provides the lobby's `/menu` chest interface and the lobby protection rules. It holds no felis-api token and talks to the game proxy only over the `felis:control` plugin-message channel; see [Lobby menu](#lobby-menu).
- **The Fabric, Forge and NeoForge mods** provide `/link` only, for standalone online-mode servers outside the Felis network.

`/link` is the in-game step of account linking: a player who is already online runs `/link`, the plugin asks felis-api to mint a one-time code for the player's verified UUID and shows it in chat, and the player enters the code on the panel's **Account** page to complete the link. The login space needs no command: it mints the code when the player arrives. See [Player access](/en/guide/players#account-linking) for the linking flow.

The Velocity, Limbo and Paper versions the installer uses are the builds pinned in `deploy/game-stack.lock`: Velocity is `VELOCITY_VERSION`, Limbo is `LIMBO_VERSION`, and Paper is the build in `PAPER_JAR_URL`. The repository's Go tests fail when a compile dependency and the lock disagree; see [Dependency verification](#dependency-verification).

::: warning The loader mods are for standalone servers only
Inside a Felis network, the game proxy's `/link` serves every backend and takes precedence over a backend's own command of the same name, so user game servers need no mod. A mod answers `/link` only when its server runs `online-mode=true`. The installer does not deploy these mods; build them with the commands under [Building](#building) and install them by hand.
:::

::: danger The token a mod holds is a real credential
A mod's token can mint a bind code for any UUID. Anyone who can read that server's files (its operator, any plugin or mod on it, the holder of a copied backup) can bind a not-yet-linked player's account to their own panel account. Install a mod only on a server whose operator you trust with that, and give it the `limbo` token: it opens only the link-code, link-status and blacklist endpoints. The `velocity` token can also approve staff logins and wake or claim servers for any player; keep it on the proxy host. To replace a leaked token, run `sudo felis rotate-token -yes limbo`: the login space restarts with the new value; update the mod's `felis-link.properties` by hand, and the mod picks up the new value on its next call without a restart.
:::

## Minecraft versions {#minecraft-versions}

| Module | Runs on | Minecraft |
| --- | --- | --- |
| `velocity` | The Felis game proxy (Velocity 3.5.1) | The client versions the proxy accepts: 26.3 natively, older clients through the ViaVersion components the installer deploys |
| `limbo` | The Felis login space (Limbo) | 26.3 only; Limbo speaks exactly one protocol, the lock's `MC_VERSION` |
| `paper` | The Felis lobby (Paper 26.3) | 26.3, the lock's `MC_VERSION` |
| `fabric` | A standalone Fabric server | 1.20.1 (`fabric.mod.json` declares `~1.20.1`) |
| `forge` | A standalone Forge server | 1.20.1 (`mods.toml` declares `[1.20.1,1.20.2)`) |
| `neoforge` | A standalone NeoForge server | 1.20.4 (`mods.toml` declares `[1.20.4,1.20.5)`) |

The Felis network itself runs Minecraft 26.3. The loader mods target the 1.20.x modding lines and belong on standalone servers outside the network; they load on no 26.x server, and a Felis installation never loads them.

## Identity trust {#identity}

Only the paths through the game proxy are protected against forged identities. The game proxy runs with `online-mode=true` (the installer writes it), so every login is verified with Mojang or a configured authentication source, and everything downstream uses that verified identity:

- The proxy's own `/link`, `/felis` and `/invite` use the UUID of the verified connection.
- The `felis:control` frames a lobby sends are attributed to the backend connection they arrive on, and the `player` field the lobby writes is ignored; see [Lobby menu](#lobby-menu).
- The login space and the lobby run in offline mode behind the proxy and accept only logins that carry Velocity's modern forwarding signature (the shared forwarding secret), so a client that bypasses the proxy cannot claim a UUID.

A game proxy started with `online-mode=false` turns routing off and logs an error; its `/link` then sees only name-derived offline UUIDs, which never match a genuine account's UUID.

The loader mods are outside this protection. A mod trusts the UUID its server reports, so it is exactly as trustworthy as that server: the mod refuses `/link` unless the server runs `online-mode=true`, and whoever operates the server holds a token that can mint a code for any UUID (see the warning under [Overview](#overview)).

## Architecture {#architecture}

Each platform is an independent Gradle build with its own `settings.gradle`; the loader Gradle plugins have conflicting Gradle version requirements, so there is no shared root project. The platform-neutral core lives in `shared/src/main/java`, and each module compiles it in with:

```groovy
sourceSets { main { java { srcDir '../shared/src/main/java' } } }
```

The core package `best.lolicon.felis.link` has no third-party dependencies: it uses the JDK's `java.net.http.HttpClient` and a small JSON parser, so every jar is self-contained and nothing needs shading.

- **Link client**: calls `POST {apiBaseUrl}/api/v1/internal/account/link/code` with `Authorization: Bearer <service-token>` and the body `{"mc_uuid":"<uuid>"}`. Success returns `201` with `{code, expires_at}`; failure returns the `{error:{code,message}}` envelope.
- **Configuration loader**: reads the environment variables `FELIS_API_BASE_URL` and `FELIS_SERVICE_TOKEN`, or a commented `felis-link.properties` template written on first run; the environment wins. The API URL and the service token are deployment inputs and are never compiled in. Two optional keys bound each call, in whole seconds from 1 to 120, default 10: `connect-timeout-seconds` (`FELIS_API_CONNECT_TIMEOUT_SECONDS`) for opening the connection, and `request-timeout-seconds` (`FELIS_API_REQUEST_TIMEOUT_SECONDS`) for the whole call. Any other value fails the load and names the key.
- **Routing client**: a GET that failed on a dropped connection or a `502`, `503` or `504` is retried once after a random pause of 100–400 ms. A GET that timed out, and every POST (wake, claim, join event, approval), is never retried.

Commands run on the server thread; the HTTP call goes to a single-thread daemon executor, and the reply is handed back to the server thread, so a slow felis-api never stalls the tick loop. When the configuration is missing, the plugin still loads but does not register `/link`, and the server runs normally.

All three mods use the official Mojang mappings, so class and method names are identical across Fabric, Forge and NeoForge and the command handler is the same; only the mod declaration, event bus and configuration directory glue differs per loader.

## Velocity routing {#velocity-routing}

The game proxy sits on the player-facing edge, outside the cluster. Besides `/link`, the Velocity plugin recognizes Felis servers by subdomain, registers backends in Velocity's dynamic server registry, and decides on each join whether to send the player straight in, wake a sleeping server and hold the player, or ask the player to reconnect later. It drives wake and routing over the felis-api internal face (service-token authentication), and receives the `felis:control` frames from the lobby and the login space, translating them into the same wake, claim, status and release calls.

Two preconditions gate routing. If either is missing, routing turns off safely and `/link` keeps working:

- **Online mode**: `online-mode=true` in `velocity.toml`. The autostart policy and whitelist checks trust verified UUIDs; in offline mode the plugin refuses to route on spoofable identities and logs an error.
- **Root domain**: the deployment's root domain, such as `mc.example.net`. This is the only place the root domain enters the proxy, and it is never compiled in; without it, hostname routing has nothing to match and stays off.

With routing active:

| Feature | Behaviour |
| --- | --- |
| Backend registry | Requests `GET /api/v1/servers` every 15 seconds, reconciles Velocity's dynamic registry and refreshes the player entry policy. A failed request keeps the existing registrations and the last policy, so a brief control-plane outage never deregisters running backends. The API returns each backend Service's host-routable ClusterIP, so the proxy does not depend on cluster DNS. |
| Proxy restart while the API is down | The proxy routes on the last server list it received, `/opt/felis/velocity/plugins/felis-link/last-servers.json`, until a refresh succeeds. |
| Join | Resolves `<subdomain>.<root-domain>` and remembers the target. When a panel account link is required, a new connection enters `login` first; when the login space asks for the player's release, the proxy confirms the link again: a ready remembered target is joined directly, and a sleeping target is woken from the lobby and queued. While felis-api restarts, players whose link was confirmed within the last 10 minutes still get through. |
| Waiting queue | One pass every 2 seconds queries the status of each distinct target server once. A player keeps waiting while the server is starting, or failed but inside the operator's restart backoff, and hears a progress line every minute. The wait ends on transfer, when the player leaves, when the start is given up, when the server is stopped, after 120 seconds without an answer from felis-api, or at a one-hour limit. |
| Wake check | Calls `POST /api/v1/internal/servers/{name}/wake` with the player's online-mode UUID. `403` means the policy refused, which the player is told before the wait ends; `429` means a wake is already in progress, and the wait continues. |
| Server-list ping | Answers from the cached lifecycle view with a phase MOTD (online, starting, start failed, sleeping) and the cached player counts. The ping is read-only: it never wakes a server and never contacts a backend. |
| Join report | Reports each real join to a Felis backend through `POST …/join-event`, so world cleanup sees the activity and the player is added to the server's allowlist automatically. |
| `/felis`, `/felis list` | Shows the operational state: online mode, root domain, lobby, and the known servers with their phase and readiness. |
| `/felis lobby`, `/felis go <lobby>` | Moves the player back to the lobby from any backend without waking anything; a wait already queued still moves the player when its server is ready. The command lives under `/felis` so that a user server's own `/lobby` or `/hub` is not shadowed. |
| `/server` | Velocity's built-in `/server` is removed so the command reaches the backend: the server menu in the lobby, a user server's own `/server` elsewhere. A `/server` registered by another proxy plugin is kept. With routing off, the built-in command stays, because it is then the way to switch servers. |

Other commands: `/felis claim` claims a server, `/felis migrate` is used for account migration, `/felis web op approve` approves a staff login in the game, `/invite <player>` invites an online player to the server you are on, and `/invite accept` and `/invite deny` answer an invitation.

Velocity-only configuration keys are read from the same `felis-link.properties` or environment as `/link`; the environment wins:

| Key | Environment variable | Meaning |
| --- | --- | --- |
| `root-domain` | `FELIS_ROOT_DOMAIN` | The root domain routing uses, such as `mc.example.net`. Routing is off when unset |
| `login-server` | `FELIS_LOGIN_SERVER` | The authentication gate every new connection passes, default `login` |
| `lobby-server` | `FELIS_LOBBY_SERVER` | The post-authentication waiting server used while a backend wakes, default `lobby`; it must differ from `login-server` |
| `panel-hostname` | `FELIS_PANEL_HOSTNAME` | The player console hostname, default `console.<root-domain>` |
| `admin-hostname` | `FELIS_ADMIN_HOSTNAME` | The operator console hostname, default `op.console.<root-domain>` |

**Load limits**: felis-api calls run on 8 threads with 64 waiting slots. Beyond that a call is refused at once: the player sees a "busy" message, a lobby frame gets a `busy` error, and a dropped join event is logged as a warning. The registry refresh (15 seconds) and the queue poll (2 seconds) skip a run while the previous one is still going. Acting commands (`/link`, `/felis claim`, migration, staff approval) share a per-player budget of 5, then one more every 5 seconds. `felis:control` frames from the lobby are also limited per player, and menu status answers are cached.

**Health log**: every 10-minute window with any activity produces one info line with only that window's counts:

```text
Felis: last 10 min: felis-api calls=… (no answer=…, 4xx=…, 5xx=…, retried=…), avg=… ms, max=… ms, busy refusals=…, join-events failed=…, join-events dropped=…, transfers failed=…, server-list refreshes failed=…, waiting now=…
```

Running `/felis` from the proxy console also shows the felis-api call counts since start, the number of waiting players and the failure totals. A server-list refresh that keeps failing logs a warning when it starts, then every 5 minutes with the running count, and an info line when it recovers. The login space handles its link-status polls the same way.

## Lobby menu {#lobby-menu}

The `paper/` module provides the lobby's player interface. `/menu` (alias `/server`, which the proxy passes through to the lobby when routing is active) opens a chest interface with one tile per server the proxy routes; clicking a tile wakes, claims or joins that backend.

**The lobby is interface only.** It holds no felis-api token, opens no HTTP connection and keeps no waiting queue. Each action it takes is one frame on the `felis:control` plugin-message channel, and every piece of state it shows arrives on the same channel; only the game proxy talks to felis-api. The build enforces this: the module's source include rules compile only the paper package and four shared classes, `Control`, `ControlFrame`, `Json` and `ExperienceConfig`, so the lobby jar contains no API client or token configuration class. If a shared class ever gained a dependency on the API client, the lobby build would fail.

**Frames.** The lobby sends `ListRequest`, `WakeRequest`, `ClaimRequest` and `StatusQuery` to the proxy; the proxy sends `ListUpdate`, `StatusUpdate`, `TransferReady` and `Error` to the lobby. The login space asks for a player's release with a `LoginRelease` frame. The proxy accepts `felis:control` frames only from the lobby and the login space, and each only with its own frames.

`/menu` sends a `ListRequest`, and the proxy answers with a `ListUpdate` built from the registry it routes by, naming every user server, so a server created in the panel appears without editing the lobby. The list leads with the player's own servers and carries felis-api's decision for the player on each one: `owner`, `wake`, `owner_only`, `allowlist`, `retiring` or `start_failed`. The decision comes from `GET /api/v1/internal/player/menu-access/{uuid}`, called once per menu open; when felis-api cannot answer, only the server names are sent and the tiles leave the decision to the actual wake request. The menu first paints a grey "loading" tile per server (45 per page, with page arrows in the bottom row), then sends a `StatusQuery` for each server, and the proxy answers with `StatusUpdate` frames that repaint each tile by phase and ownership.

**Spoofing protection.** The `player` field in a lobby frame is not trusted. The proxy derives the acting player and UUID from the backend connection the plugin message arrived on, and the server-side autostart policy and ownership checks use that verified identity. The frame's `server` field only names the tile that was clicked. A fully compromised lobby therefore cannot act as another player or reach the API directly.

**Button rules**: based on the latest `StatusUpdate` and the player's access decision; the first match wins.

| Tile state | Button | Frame sent |
| --- | --- | --- |
| Ready (`ready`), any decision | **Join** (green) | `WakeRequest{server}` |
| Ownerless (`claimable`) | **Claim & Start** (gold) | `ClaimRequest{server}` |
| `retiring`, `start_failed`, `owner_only`, `allowlist` | **Can't start** (grey, with the reason in the description) | None; the reason goes to chat and the menu stays open |
| Anything else (`owner`, `wake` or no decision) | **Start** (red) | `WakeRequest{server}` |

The player's own servers are marked ★ and "Your server". The status line shows the phase in the player's language: Running, Starting, Stopping, Stopped, Failed to start or Unknown. "Join" and "Start" send the same `WakeRequest`: when the server is already running, the proxy joins the player directly, and any linked player may join. A refusal comes back as an `Error` frame (for example `not_linked`, `quota_exceeded` or `already_claimed`) and is shown as a readable message; this is where claim, quota and policy failures reach the player. When the server is ready, the proxy sends `TransferReady` and then transfers the player.

## Building {#building}

Each module builds through its own Gradle wrapper. Every wrapper pins the SHA-256 of its distribution (`distributionSha256Sum`), so a tampered or swapped Gradle download fails before it runs. The platforms need different Gradle versions:

| Module | Gradle | JDK | Reason |
| --- | --- | --- | --- |
| `velocity` | 9.8.1 | 21 or newer runs it; emits Java 21 bytecode | velocity-api 3.5.1 declares `jvm.version = 21` |
| `paper` | 9.8.1 | Java 25 toolchain | paper-api 26.3 is published as a Java 25 artifact, so the module declares a `JavaLanguageVersion.of(25)` toolchain |
| `limbo` | 9.8.1 | 21 or newer runs it; emits Java 17 bytecode | Current LOOHP/Limbo releases ship class-file version 65, so the compiling JDK must be 21 or newer to read them; `release 17` bytecode loads on any Limbo running Java 17 or newer |
| `fabric` | 8.8 | 17 | loom 1.7.4 uses a Gradle API that Gradle 9 removed |
| `forge` | 8.8 | 17 | ForgeGradle 6 supports Gradle 8 only |
| `neoforge` | 8.14 | 17 | NeoGradle 7.1.38 requires Gradle API 8.14 or newer |

The three plugins the installer uses are built with Gradle 9.8.1 on every path: through the wrapper locally and in CI, and in the digest-pinned `gradle:9.8.1-jdk25` image in the lobby and login space Dockerfiles and the installer's Velocity build.

Run from the repository root:

```bash
# Velocity and Paper
plugins/velocity/gradlew -p plugins/velocity build
plugins/paper/gradlew    -p plugins/paper    build

# Limbo must name the Limbo API version the login space runs: deploy/game-stack.lock's LIMBO_VERSION
plugins/limbo/gradlew -p plugins/limbo build -PlimboVersion="$(sed -n 's/^LIMBO_VERSION=//p' deploy/game-stack.lock)"

# Fabric, Forge, NeoForge (the installer does not deploy these; use the jars built here)
plugins/fabric/gradlew   -p plugins/fabric   build
plugins/forge/gradlew    -p plugins/forge    build
plugins/neoforge/gradlew -p plugins/neoforge build
```

The jars are written to each module's `build/libs`. The first build of each mod downloads Minecraft and remaps or decompiles it, which can take a few minutes; later builds are faster. See [Building from source](/en/guide/building#tests) for running the plugin tests.

## Dependency verification {#dependency-verification}

Every dependency version is exact: paper-api is the API of the Paper build `deploy/game-stack.lock` installs (`paper-26.3-40.jar` corresponds to `26.3.build.40-alpha`), Limbo compiles against the lock's `LIMBO_VERSION`, velocity-api is the lock's `VELOCITY_VERSION`, and ForgeGradle is pinned to `6.0.54`. The installer's three modules also carry `gradle/verification-metadata.xml`, the SHA-256 of every artifact their build resolves, and Gradle refuses any artifact whose bytes differ. The Limbo API entry is the jar the login space actually runs; its SHA-256 equals the lock's `LIMBO_JAR_SHA256`.

After `deploy/update-game-stack-lock.sh` moves Paper, Limbo or Velocity, update the pins, regenerate the verification files and review the diff:

1. Set paper-api in `plugins/paper/build.gradle` to the new build (`paper-<mc>-<n>.jar` corresponds to `<mc>.build.<n>-<channel>`).
2. With JDK 25, regenerate the three verification files from an empty Gradle home. With a warm cache, Gradle skips the BOMs and parent POMs it already holds, and the image builds, which start empty, then refuse those unrecorded artifacts.

   ```bash
   rm -f plugins/{velocity,paper,limbo}/gradle/verification-metadata.xml
   export GRADLE_USER_HOME="$(mktemp -d)"
   plugins/velocity/gradlew -p plugins/velocity --write-verification-metadata sha256 build
   plugins/paper/gradlew    -p plugins/paper    --write-verification-metadata sha256 build
   plugins/limbo/gradlew    -p plugins/limbo    --write-verification-metadata sha256 build \
     -PlimboVersion="$(sed -n 's/^LIMBO_VERSION=//p' deploy/game-stack.lock)"
   unset GRADLE_USER_HOME
   ```

3. Run `go test .` in the repository root. It fails until the pins, the verification files and the lock agree.

The loader mods also pin exact plugin and dependency versions and their wrappers' SHA-256, but carry no verification file: loom, ForgeGradle and NeoGradle fetch and remap Minecraft through their own downloaders, checked against the hashes in Mojang's manifest.

## Deploying {#deploying}

The installer deploys the Velocity, Limbo and Paper plugins automatically. The following steps apply to manual deployment, such as installing a loader mod on a standalone server or running a lobby yourself:

1. Put the matching jar into the server's or proxy's `mods` or `plugins` directory.
2. Start it once to generate `config/felis-link.properties` (`plugins/felis-link/felis-link.properties` on Velocity).
3. Set `api-base-url` and `service-token`, or provide the environment variables `FELIS_API_BASE_URL` and `FELIS_SERVICE_TOKEN`, which take precedence.

The token is one of felis-api's per-caller internal tokens: the game proxy uses the `velocity` token (Secret `felis/felis-service-token`), the login space the `limbo` token (`felis-limbo-token`), and each token reaches only its own endpoints; on another caller's endpoint it gets `403 wrong_caller`. A loader mod uses the `limbo` token, on a standalone online-mode server only. Treat the token as a secret; `sudo felis rotate-token -yes <caller>` replaces it (see the [Command-line reference](/en/reference/cli#rotate-token)).

A token read from the file follows the file: the proxy or mod re-reads the file at most once a second, presents the new `service-token` from its next call to felis-api, logs `service-token reloaded from … (fingerprint …)`, and keeps its connected players. A token from the environment variable `FELIS_SERVICE_TOKEN` stays fixed until the process restarts.

**Velocity**: also set `root-domain` (and optionally `lobby-server`) in the same file, and make sure `velocity.toml` has `online-mode=true`, to turn routing on. Without either, the proxy still serves `/link` but routing stays off; see [Velocity routing](#velocity-routing). The plugin ID is `felis-link`, so the configuration directory is `plugins/felis-link/`. On an installed host, the proxy configuration is `/opt/felis/velocity/plugins/felis-link/felis-link.properties`.

**Paper lobby**: there is no token to set and no server list to maintain. The menu shows the servers the proxy routes, which the proxy sends over `felis:control`; a `servers:` list in `plugins/FelisPaper/config.yml` is ignored, and the plugin says so at startup. The lobby must sit behind the same Velocity proxy as the backends and reaches the control plane only through the proxy, so it needs no `api-base-url` or `service-token` of its own. The installer packages the plugin into the lobby image; see [Lobby image](/en/reference/lobby).
