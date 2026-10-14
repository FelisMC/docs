---
title: Login space image
description: The Felis login space image — readiness, the in-game sign-in flow, configuration, customization in the panel and building the image.
---

# Login space image {#login-image}

This page describes the image the Felis login space (the system server `login`) runs: the readiness check, the in-game sign-in flow, the messages players see, the configuration, how to customize it in the panel, and how to build the image yourself. It is for Admins and for operators who customize the login space.

## Overview {#overview}

The login space is the always-on authentication gate. Its image combines LOOHP/Limbo and the Felis login plugin (`felis-limbo`). When `[velocity] login_image` in `felis.toml` names the image, `felis setup` creates the login space as a system server: it always stays running (`DesiredState=Running`) and is exempt from idle stop and world cleanup. The installer builds the image and configures it.

When the [player entry policy](/en/guide/players#entry-policy) requires a panel account link, every new connection reaches the login space first. It is also the only safe fallback: when a backend stops or is starting, players return to the login space, so authentication is never bypassed. The login plugin does two jobs: the readiness check and the in-game sign-in.

## Readiness {#readiness}

Limbo has no RCON, so Felis cannot use its usual RCON readiness probe, and a plain TCP check would report ready as soon as the socket binds. The login plugin therefore serves an HTTP readiness endpoint that succeeds only after the server's first tick. Both the Pod readiness probe of the `login` system server and the operator's readiness decision use this endpoint.

- Endpoint: `GET /healthz` on port `8080`; `FELIS_HEALTH_PORT` changes the port.
- It returns `503 starting` before the first tick and `200 ok` after it.
- If the endpoint cannot bind, readiness never turns green, and the operator keeps the login space in the starting state, so a gate that has not started is never advertised as available.

## Sign-in flow {#login-flow}

A player who reaches the login space has had their UUID verified by the game proxy in online mode but has not linked a panel account yet. When the player joins, the plugin runs this flow off the tick thread:

1. Checks the username-collision blacklist and disconnects a barred UUID. The genuine account with the same name has a different UUID and passes.
2. Mints a one-time bind code for the verified UUID through the felis-api internal face.
3. Opens a login book with a clickable link to the player console and sends the bind code in chat. It tells the player to finish in the system browser: in-app browsers such as those of WeChat and QQ do not support passkeys.
4. Checks the link status every second. Once the player has entered the code in the panel, the plugin asks for the player's release over the `felis:control` channel and repeats the request with backoff until the player has left; the game proxy confirms the link again and sends the player to the lobby or to the target server it remembered.
5. Disconnects the player on a blacklist match, a refused code, an expired sign-in window, or when the player has not left the login space within 120 seconds of the release. Authentication failures never let a player through.

If felis-api is unavailable when a player joins (a connection failure or a `5xx`), the plugin retries with backoff for up to 60 seconds before turning the player away. While it retries, the plugin also asks for the release: the game proxy keeps the link confirmations of the last 10 minutes, so a player who signed in a few minutes earlier still gets through a felis-api restart, and anyone else is refused.

When the player entry policy uses the login space as the waiting place while a server starts, waiting players receive no bind code and no sign-in timer starts; the game proxy's waiting queue controls the start-up progress.

### Messages players see {#player-messages}

| Situation | Message |
| --- | --- |
| Link complete | `登录成功，正在进入大厅… / Signed in — sending you to the lobby…` |
| felis-api busy, retrying | `登录服务繁忙，正在重试… / The login service is busy — retrying…` |
| felis-api still unavailable | `登录服务暂不可用，请稍后重连 / Login service unavailable, please reconnect shortly.` |
| Sign-in window expired | `登录超时，请重连 / Login timed out. Please reconnect.` |
| Could not reach the lobby after the release | `进入大厅失败，请重连 / Could not reach the lobby. Please reconnect.` |
| Username-collision blacklist match | `该用户名已被回收保护 / This username is under reclaim protection. Contact staff.` |

## Configuration {#configuration}

The configuration is a deployment input and is never compiled into the plugin. On first run the plugin writes a `felis-link.properties` template in its data directory; environment variables take precedence over the file:

| Environment variable | Meaning | Default |
| --- | --- | --- |
| `FELIS_API_BASE_URL` | Base URL of the felis-api internal face | Required for sign-in |
| `FELIS_SERVICE_TOKEN` | Internal service token (secret) | Required for sign-in |
| `FELIS_PANEL_HOSTNAME` | The player console hostname used in the login link | `console.<FELIS_ROOT_DOMAIN>` |
| `FELIS_ROOT_DOMAIN` | The deployment's root domain, used for the console hostname when `FELIS_PANEL_HOSTNAME` is unset | — |
| `FELIS_LOBBY_SERVER` | The Velocity server name players are released to | `lobby` |
| `FELIS_LOGIN_TIMEOUT_SECONDS` | The sign-in window, limited to 30–3600 seconds | `600` |
| `FELIS_HEALTH_PORT` | The readiness endpoint port | `8080` |
| `FELIS_API_CONNECT_TIMEOUT_SECONDS` | Timeout for connecting to felis-api, 1–120 seconds | `10` |
| `FELIS_API_REQUEST_TIMEOUT_SECONDS` | Timeout for a felis-api request, 1–120 seconds | `10` |

When the API configuration is missing, or neither `FELIS_PANEL_HOSTNAME` nor `FELIS_ROOT_DOMAIN` is set, the sign-in flow stays off and the plugin serves only the readiness check. An unconfigured image therefore still starts, but does not authenticate players.

### Automatic wiring {#wiring}

In a Felis installation this configuration is wired in automatically; you do not set it by hand:

- **Non-secret variables**: `felis setup` writes `FELIS_API_BASE_URL`, `FELIS_ROOT_DOMAIN`, `FELIS_PANEL_HOSTNAME` and `FELIS_LOBBY_SERVER` into the environment of the `login` system server. The internal API URL is derived from the control-plane namespace, `felis` by default; if the control-plane namespace is renamed, update that URL by hand.
- **Service token**: the login space has its own `limbo` token (Secret `felis-limbo-token`), which can only mint link codes, read link status, check the blacklist and read the player entry policy. The installer copies the token into the `minecraft` namespace, and `felis setup` refreshes that copy from the control-plane namespace. The operator injects `FELIS_SERVICE_TOKEN` only into the login space's Pod, selected by the reserved name `login` together with the label `felis.lolicon.best/system-role=login`, so a user server cannot obtain the token by choosing a name. `sudo felis rotate-token -yes limbo` replaces the token and restarts the login space. Without the token, the plugin serves only the readiness check.
- **Service address**: `FELIS_API_BASE_URL` points at the ClusterIP Service `felis-api-internal` (port `8081`) in the control-plane namespace. It is separate from the external NodePort Service `felis-api` (port `443`), so the internal face is never published on a node's external address.
- **Network policy**: `felis-server-egress` limits outbound traffic in the `minecraft` namespace to DNS and the internet, so game servers cannot reach the internal face by default. `felis-login-to-internal-api` opens only the path from the login space's Pod to felis-api port `8081`, with the same selection as the token injection.

## Customize in the panel {#customize}

Admins open **Admin → Login & lobby** and select **Login space**. Settings can be saved while it runs and take effect on the next start or restart; choose **Restart & apply** after saving to apply them at once.

::: warning
While the login space restarts or is stopped, new players cannot join; **Restart & apply** disconnects every player in the login space.
:::

The **Login guidance & waiting** part configures:

- the login book title, login book author, login page heading, login link text and login instructions;
- opening the login book automatically;
- the login timeout (30–3600 seconds). An explicitly set `FELIS_LOGIN_TIMEOUT_SECONDS` environment variable takes precedence over this setting.

The bind code, the login link and the chat prompts are generated by the system and stay enabled; the authentication flow and the release target are maintained by the system and are not customizable. The settings are stored in `/data/felis-experience.json`.

To change the scene and other content:

1. Stop the login space.
2. In the file manager, upload your scene as `spawn.schem` at the root; adjust the spawn position and other settings in Limbo's `server.properties`.
3. Add Limbo-compatible plugins if needed. Paper world ZIPs and Paper plugins do not work in Limbo.
4. Start the login space.

The page also provides runtime logs, backups and restore, and image and resource settings. Limbo does not support RCON commands, so the console shows logs only; change the configuration through the file manager. A custom image must keep the Felis login plugin and support the forwarding protocol the game proxy uses.

## Build the image {#build}

The installer builds the login space image automatically. LOOHP/Limbo has no official image and no release archive; its CI (`ci.loohpjames.com/job/Limbo`) publishes two files per build: the server jar `target/Limbo-<ver>.jar` and the default spawn schematic `spawn.schem`. The image is assembled from these two files, and Limbo writes a default `server.properties` on first run.

Build from the repository root with the versions in `deploy/game-stack.lock`:

```bash
. <(grep '^LIMBO_' deploy/game-stack.lock)
docker build -f deploy/limbo/Dockerfile \
  --build-arg LIMBO_JAR_URL="$LIMBO_JAR_URL" --build-arg LIMBO_JAR_SHA256="$LIMBO_JAR_SHA256" \
  --build-arg LIMBO_SCHEM_URL="$LIMBO_SCHEM_URL" --build-arg LIMBO_SCHEM_SHA256="$LIMBO_SCHEM_SHA256" \
  --build-arg LIMBO_VERSION="$LIMBO_VERSION" \
  -t felis-limbo:demo .
```

| Build argument | Description |
| --- | --- |
| `LIMBO_JAR_URL`, `LIMBO_JAR_SHA256` | The server jar and its SHA-256; saved as `Limbo.jar` |
| `LIMBO_SCHEM_URL`, `LIMBO_SCHEM_SHA256` | The default spawn schematic and its SHA-256; saved as `spawn.schem` and loaded as the spawn world |
| `LIMBO_VERSION` | The Limbo Maven API version the plugin compiles against. It differs from the jar's CI-qualified file name: for example, `Limbo-2026.0.3-ALPHA-26.3.jar` corresponds to the Maven version `2026.0.3-ALPHA` |

Push the image to the in-cluster registry and point the configuration at it. On the node itself, Docker treats `127.0.0.1` as an insecure registry by default:

```bash
docker tag  felis-limbo:demo 127.0.0.1:5000/felis/limbo:demo
docker push 127.0.0.1:5000/felis/limbo:demo
```

Set `[velocity] login_image = "registry.felis.svc:5000/felis/limbo:demo"` in `felis.toml`, then run:

```bash
sudo felis setup
```

Keep the image in the registry so that kubelet can pull it again after an image garbage collection; an image only imported into containerd is lost once it is collected. The registry identifies a repository by the path after the host, so pushing from another machine through `kubectl -n felis port-forward svc/registry 5000:5000` has the same effect.

## Runtime requirements {#runtime-requirements}

The image's entrypoint, `deploy/limbo/entrypoint.sh`, rewrites these settings in `server.properties` on every start and leaves the rest unchanged:

| Setting | Value | Reason |
| --- | --- | --- |
| `server-port` | `FELIS_GAME_PORT`, default `25565` | Limbo defaults to `30000`, while the Service, the readiness probe and the network policy all use `25565`. Do not change `FELIS_GAME_PORT` on its own |
| `max-players` | `-1` (no limit) | Players who have not linked wait here for up to ten minutes, and the players of a server that stops all return here at once; a cap would turn players away |
| `velocity-modern`, `forwarding-secrets` | `true`, the forwarding secret | The login space trusts only player identities signed by the proxy; `bungeecord` and `bungee-guard` are fixed at `false` |

The operator injects the forwarding secret as `FELIS_FORWARDING_SECRET`. Without it, the image refuses to start: an unverified UUID would let anyone claim any Minecraft identity. The game proxy turns the BungeeCord plugin-message channel off (`bungee-plugin-message-channel = false`); the login space asks for a player's release over the `felis:control` channel, and the game proxy accepts release requests only from the login space.
