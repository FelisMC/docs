---
title: Lobby image
description: What the Felis lobby image does, its default behaviour, how to customize it in the panel and how to build it.
---

# Lobby image {#lobby-image}

This page describes the image the Felis lobby (the system server `lobby`) runs: its place in the join flow, its default behaviour, how to customize it in the panel, and how to build the image yourself. It is for Admins and for operators who customize the lobby.

## Overview {#overview}

The lobby is the always-on hub server. Its image combines Paper 26.3, the Felis lobby plugin (`felis-paper`) and LuckPerms. When `[velocity] lobby_image` in `felis.toml` names the image, `felis setup` creates the lobby as a system server: it always stays running (`DesiredState=Running`) and is exempt from idle stop and world cleanup. The installer builds the image and configures it.

The lobby provides the `/menu` server menu; see [Lobby menu](/en/reference/plugins#lobby-menu) for its behaviour.

### Join topology {#topology}

```text
connect → login (login space, the authentication gate) → lobby (/menu) → target server
```

A player reaches the lobby only after the login space has authenticated and released them. The lobby must never be a fallback or waiting target, because a new connection would then bypass authentication. Felis keeps this rule at every layer:

- The login space has no fallback; when the gate is down, connections are refused.
- The lobby and every user server fall back to `login`, never to the lobby.
- Felis refuses to create a system server whose fallback is `lobby`.
- The game proxy's default landing and waiting targets both point at `login`.

The [player entry policy](/en/guide/players#entry-policy) can change where players go after authentication, for example straight to a main server; with such a policy the lobby can be stopped.

## Default behaviour {#default-behaviour}

The lobby plugin keeps the lobby a hub that cannot be damaged and where players cannot be hurt. These are the defaults; they can be changed in the panel (see [Customize in the panel](#customize)):

- Every world is on peaceful difficulty, with natural mob spawning, PvP, mob griefing and TNT explosions off; time is frozen at noon, the weather stays clear, inventories are kept on death, respawn is immediate, and advancement messages are hidden.
- Players take no damage and never get hungry; a fall into the void returns them to spawn.
- A player without the `felis.lobby.build` permission joins at spawn in adventure mode and cannot break or place blocks, use buckets, trample farmland, light fires, or harm mobs, item frames, paintings, armor stands or vehicles. Buttons, doors, pressure plates and containers keep working.
- Every join receives a welcome message with a click that runs `/menu`.

`felis.lobby.build` is granted to operators (OP) by default. To let a specific player build in the lobby, grant it under **Lobby builder access** in the panel, or run `lp user <name> permission set felis.lobby.build true` on the lobby console.

When `server.properties` has no `max-players`, the image's entrypoint sets it to `200` (Paper's default is `20`); later changes made through the file manager survive restarts. Every authenticated player passes through the lobby, and the players of a server that stops arrive here all at once, so the cap should not be set low.

## Customize in the panel {#customize}

Admins open **Admin → Login & lobby** and select **Lobby**. Settings can be saved while the lobby runs and take effect on the next start or restart; choose **Restart & apply** after saving to apply them at once.

::: warning
**Restart & apply** disconnects every player in the lobby.
:::

The form has these parts:

| Part | Settings |
| --- | --- |
| Welcome & menu | Chinese and English welcome text, Chinese and English menu titles, send the welcome message on join, open the server menu on join |
| Player behavior & protection | Default game mode, return to world spawn on join, prevent regular players from breaking and building, invulnerable players, disable hunger, return to spawn after falling into the void |
| World environment | Difficulty, frozen world time and its value (0–23999), clear weather, PvP, natural mob spawning, mob griefing, TNT explosions, keep inventory on death, immediate respawn, advancement messages |

Text fields hold up to 512 characters. The settings are stored in `/data/felis-experience.json` on the lobby's world volume, independently of the image; saving keeps unknown keys in the file. When the file is damaged, the game uses defaults for the parts it cannot read, the panel reports it, and saving again repairs the file.

The **Content & maintenance** part provides:

- **Maps & scenes** and **Advanced file manager**: edit `server.properties`, world configuration and plugin data; upload, extract, rename or download files.
- **Plugins & plugin settings**: upload plugin JARs and edit plugin configuration.
- **Console & runtime logs**: read the logs and run lobby commands, for example to set the spawn or manage players.
- **Map backups & restore**: save a backup before changing the map, plugins or image, or restore an existing backup.
- **Lobby builder access**: enter a Minecraft profile name and choose **Allow building** or **Deny building**. Changing builder access requires the lobby to be running.
- **Manage images & versions**: change the lobby image and resource settings.

### Replace the map {#replace-map}

1. Back up the current map under **Map backups & restore**.
2. Stop the lobby.
3. In the file manager, upload a world ZIP and extract it at the root of the volume. Check that the world directory directly contains `level.dat`.
4. In `server.properties`, set `level-name` to the name of that world directory.
5. Start the lobby.
6. Run `setworldspawn x y z` on the lobby console to set the spawn.

### Plugins {#lobby-plugins}

Plugin JARs go in the `plugins/` directory and must match the lobby's Paper version. The Felis plugin and LuckPerms bundled in the image are refreshed from the image on every start. A custom image must keep the Felis lobby plugin.

The authentication forwarding settings are maintained by the system: before each start, the operator merges the Paper global configuration, keeping custom entries while refreshing the required authentication settings. The RCON password and the proxy forwarding secret are also managed by the system.

## Build the image {#build}

The installer builds the lobby image automatically. To build it yourself, run from the repository root with the Paper and LuckPerms versions in `deploy/game-stack.lock`:

```bash
. <(grep -E '^(PAPER|LUCKPERMS)_' deploy/game-stack.lock)
docker build -f deploy/lobby/Dockerfile \
  --build-arg PAPER_JAR_URL="$PAPER_JAR_URL" --build-arg PAPER_JAR_SHA256="$PAPER_JAR_SHA256" \
  --build-arg LUCKPERMS_JAR_URL="$LUCKPERMS_JAR_URL" --build-arg LUCKPERMS_JAR_SHA256="$LUCKPERMS_JAR_SHA256" \
  -t felis-lobby:demo .
```

The Paper version must match the login space: Limbo speaks exactly one protocol per build, and a client has to pass both the login space and the lobby.

Push the image to the in-cluster registry and point the configuration at it. On the node itself, Docker treats `127.0.0.1` as an insecure registry by default:

```bash
docker tag  felis-lobby:demo 127.0.0.1:5000/felis/lobby:demo
docker push 127.0.0.1:5000/felis/lobby:demo
```

Set `[velocity] lobby_image = "registry.felis.svc:5000/felis/lobby:demo"` in `felis.toml`, then run:

```bash
sudo felis setup
```

The registry identifies a repository by the path after the host, so pushing from another machine through `kubectl -n felis port-forward svc/registry 5000:5000` has the same effect.

## Runtime requirements {#runtime-requirements}

- The game port is fixed at `25565`, the `GamePort` of the `MinecraftServer` resource; the entrypoint writes `server-port` on every start.
- The lobby receives player identities that the proxy has already authenticated through Velocity modern forwarding. `online-mode` in `server.properties` is fixed at `false`; the `proxies.velocity` settings in `config/paper-global.yml` are merged in by the operator before each start when Felis manages the lobby, and written by the entrypoint for a standalone run.
- The operator injects the forwarding secret from the Secret `felis-forwarding-secret` as `FELIS_FORWARDING_SECRET`. Without it, the image refuses to start, so it never trusts forgeable UUIDs.
- The RCON password is written into `server.properties` from its Secret on every start, so editing those lines in the file manager cannot lock the control plane out of the lobby.
- The lobby uses only the `felis:control` plugin-message channel and holds no felis-api token.
