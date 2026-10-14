---
title: Player access
description: How players join servers and link their panel account, and how to configure authentication sources, the player entry policy, the login space and the lobby.
---

# Player access {#players}

This page explains how players join servers through the game proxy and link their panel account, and how the Owner and Admins configure authentication sources, the player entry policy, the login space and the lobby. The first two sections are for players; the rest are for the Owner and Admins.

## Joining {#joining}

Players connect with Minecraft Java Edition. The client version they need is shown on the panel's **Account** page under **Prepare to enter Minecraft**. The login space and the lobby use that version; a target server may need another version or mods, as its owner announces.

Each server is reached at `<subdomain>.<root>`, which can be copied from the panel's **Servers** list. When the game proxy listens on a non-default port, the address includes the port.

With the default player entry policy, joining works like this:

1. The game proxy (Velocity) verifies the player's game identity: first with Mojang, then with the enabled third-party sources in order. See [Authentication sources](#auth-sources).
2. The player enters the login space. A player without a linked panel account gets a bind code there and completes the web sign-in (see [Account linking](#account-linking)); a linked player passes straight through.
3. If the target server is running, the player is moved there directly. If it is asleep, Felis wakes it according to its [autostart policy](/en/guide/servers#autostart); the player waits in the lobby, hears a progress line every minute, and is moved over once the server is ready.

The Owner can change how players enter, for example straight to a main server or without account linking. See [Player entry policy](#entry-policy).

In the server list, each server's MOTD shows its current state (online, starting or sleeping); refreshing the server list never wakes a server.

### Lobby menu {#lobby-menu}

In the lobby, run `/menu` to open the server menu. The menu follows the player's client language and shows one tile per server, with the player's own servers first, marked ★ and **Your server**:

| Tile | Meaning |
| --- | --- |
| Join (green) | The server is running; click to join. |
| Claim & Start (gold) | The server has no owner; click to claim and start it. |
| Start (red) | The server is asleep; click to wake it and join once it is ready. |
| Can't start (grey) | The player may not start it; the reason appears in the tile's description and in chat. |

### In-game commands {#commands}

| Command | Purpose |
| --- | --- |
| `/link` | Get a one-time bind code for linking a panel account. |
| `/menu` | Open the server menu in the lobby. |
| `/felis` | Show the proxy and routing status; `/felis help` lists every command. |
| `/felis server` | List the servers the proxy knows. |
| `/felis go <server>` | Start a server and move you in when it is ready. |
| `/felis lobby` | Return to the lobby. |
| `/felis claim` | Claim the server you are on. |
| `/felis migrate` | Start an account migration that moves your servers to another account. |
| `/felis web` | Show the web console addresses. |
| `/felis web op approve <code>` | Review and approve a pending operator sign-in; Admins and the Owner only. |
| `/invite <player>` | Invite an online player to the server you are on; they accept with `/invite accept` or decline with `/invite deny`. |

The `/felis` commands are not available in the login space; finish signing in first.

### Messages when a join is refused {#join-refusals}

| Message | Cause |
| --- | --- |
| Not allowed to start the server | The server's autostart policy does not let this player wake it. |
| The server is under maintenance | A backup, restore or file change is in progress; retry once it ends. |
| The server sat idle too long and its world is being archived | World cleanup is archiving the world. |
| Try again later | The platform is at its running server limit. |
| Login timed out, please reconnect | The web sign-in was not completed within the login timeout. |
| This game identity is barred | The identity is on the global blacklist. See [Global blacklist](#blacklist). |

For other join problems, see [Players cannot join](/en/operations/troubleshooting#players-cannot-join).

## Account linking {#account-linking}

Account linking binds a panel account to a verified game identity. Claiming, starting, stopping and managing servers require it. A bind code has 8 characters, is valid for about 10 minutes and can be used once.

### First sign-in to the player console {#first-sign-in}

Players need no prior registration; a bind code from the game creates their account and signs them in:

1. Connect with Minecraft Java Edition. The login space opens a login book and posts the bind code and the player console link in chat.
2. Open the link, `https://console.<root>`, in the system browser. Do not use the in-app browser of WeChat or QQ, where passkeys do not work.
3. Select **Sign in with Bind Code**, enter the code and select **Verify & Sign In**. Felis creates the account, links the game identity and signs you in.
4. Return to the game. Once the login space sees the link, it sends you to the lobby.

The login space waits 600 seconds by default and then disconnects; reconnect for a new bind code. Afterwards, run `/link` in game at any time for a new code to sign in with. Once you verify an email address or register a passkey on the **Account** page, you can also sign in with an email code or a passkey.

### Linking an existing account {#link-existing}

1. Run `/link` in game to get a bind code.
2. In the panel, open **Account**, enter the code under **Minecraft link** and select **Link**.

A game identity can be linked to one panel account only. For link errors, see [Account link and claim errors](/en/operations/troubleshooting#account-link-errors).

The Owner and Admins can also link by profile lookup: on the **Account** page, choose an **Authentication source**, enter a **Minecraft role name or UUID**, select **Look up role**, then **Confirm role link**. When a source has no role lookup API configured, use an in-game bind code instead. Game identities of Admins and the Owner cannot be used to sign in to the player console; they sign in to the operator console. See [Roles](/en/guide/administration#roles).

### Account settings {#account-settings}

The **Account** page also offers:

- **Email Verification**: enter an email address to receive a six-digit code, valid for 10 minutes.
- **Passkeys**: register or delete passkeys. An account's only passkey cannot be deleted while its email address is unverified.
- **Signed-in devices**: review browser sessions, revoke an unrecognized device, or select **Sign out other devices**.

### Account migration {#account-migration}

An account migration moves every server of a retired account to another account:

1. With the account being retired, run `/felis migrate` in game.
2. Sign in to the retired account in the panel, open **Account → Account migration**, and verify your identity with **Confirm with passkey** or **Send a code to my email**.
3. Enter the **Account ID** shown on the destination account's **Account** page and select **Issue code**. The transfer code is shown once, and a notification goes to the verified email address.
4. Sign in to the destination account, enter the transfer code under **Account migration** and select **Redeem**.

After the migration, the retired account is disabled. If the destination account's quota is too small, the redemption is refused and the code stays valid; redeem it again once the quota is raised. Scheduled tasks on the moved servers are switched off until the new owner reviews and saves them.

## Authentication sources {#auth-sources}

Authentication sources decide which game identities the game proxy accepts. Mojang verification is built in, always enabled and checked first. Under **Platform → Authentication sources**, the Owner adds third-party Yggdrasil providers, which are checked from top to bottom after Mojang.

### Adding a source {#add-auth-source}

1. Open **Platform → Authentication sources** and select **Add source**.
2. Fill in the fields:

   | Field | Description |
   | --- | --- |
   | Permanent source ID | A unique ID without colons or surrounding spaces. It becomes permanent when saved and cannot be renamed or removed, which preserves player UUIDs and account links. |
   | Name collision prefix | 1–4 letters or digits, unique regardless of case. When a player of this source has the name of an official account, their in-game name becomes `<prefix>_<name>`. |
   | Authentication endpoint (hasJoined) | The full `hasJoined` URL. HTTPS is required; HTTP is allowed only for localhost or private IPs. No query or fragment. |
   | Role lookup API root (optional) | Leave empty for a standard `hasJoined` URL; for a custom path, enter the Yggdrasil API root so roles can be looked up by name or UUID. |

3. Check the endpoint with **Test connection** on the source card. The check passes when the endpoint answers HTTP 204 for an unused session; it saves nothing and checks neither launcher configuration nor the role lookup API.
4. Use **Move source up** and **Move source down** to set the order.
5. Select **Save & apply** and verify your identity.

A saved configuration applies to the next login and role lookup without a restart, and online players stay connected. The configuration saved in the panel takes precedence over the `[[auth_source]]` list of the installation configuration, which the page imports when it is first opened. Felis-nano keeps using its TOML configuration.

### Identities and disabling {#auth-identities}

- Official players keep their Mojang UUIDs. Players of a third-party source get UUIDs in a namespace of their own, keyed by the permanent source ID, so identities of different sources never collide.
- Clearing **Enabled** and saving stops accepting that source's logins. The ID stays reserved, and enabling the source again restores the same player identities.
- Changing a source's endpoint changes who verifies the identities in its namespace; keep it pointed at the same trusted service.
- Players' launchers must use the same provider.
- If the database cannot be read, new authentication is refused; Felis never falls back to an outdated or disabled source.
- If another Owner changed the configuration in the meantime, saving is refused and your draft is kept; select **Discard changes** and **Reload** before editing again.

## Player entry policy {#entry-policy}

The player entry policy decides where the proxy sends a player after verifying their identity, independently of game identity verification and panel account linking. The Owner configures it under **Platform settings → Player entry → Player entry policy**.

| Entry mode | Destination after authentication |
| --- | --- |
| Lobby | The lobby, where the player chooses a server. |
| Direct to main server | The selected **Main server**, whatever hostname the player connected with. The main server's autostart policy still decides who may start it. |
| Route by hostname | The server matching the connection hostname. **Default destination (optional)** handles unmatched hostnames; without one, connections that require web sign-in enter the lobby and all others are refused. |

With **Require panel account linking** on, players must complete web sign-in in the login space. With it off, game identity is still verified, and players can link a panel account separately with `/link`.

When the destination is offline:

| Option | Behavior |
| --- | --- |
| Start automatically and wait | Applies the usual wake permission, maintenance, running limit and cooldown checks. Choose a running **Startup waiting space**: the login space (Limbo) or the lobby; with web sign-in required, the lobby is used. An unlinked player can start the destination only if its autostart policy permits their game identity; being the main server grants no startup right. If the start fails or times out, the player is told why, and a connection waiting in the login space is then disconnected. |
| Enter a fallback server | Sends the player to another running **Fallback server**. The proxy never starts the fallback server itself, and refuses the connection when neither destination is available. |
| Reject with an explanation | Refuses the connection with an explanation; no waiting space is needed. |

Until a policy is first saved, Felis uses the default: route by hostname, require panel account linking, start automatically and wait in the lobby.

### Single-server deployment {#single-server}

When you run a single server, players can go straight to it:

1. Under **Entry mode**, select **Direct to main server**, and select the server under **Main server**.
2. Turn off **Require panel account linking**.
3. Choose what happens when the destination is offline.
4. Select **Save entry policy** and verify your identity.

A running main server then accepts authenticated players directly, without the login space or the lobby. Game identity verification and the global blacklist still apply; the setting does not enable offline mode or change authentication sources.

The proxy reads a saved policy within 15 seconds and applies it to new connections; players already online keep the policy they connected with. An unused login space or lobby keeps running until you stop it under **Login & lobby**; running `felis setup` again preserves the desired state of the system servers. The API and the game plugins must be on the same version to use this feature.

The **Startup and wake policy** card on the same tab sets the running server limit and the wake cooldown. See [Startup and wake policy](/en/guide/administration#wake-policy).

## Customizing the login space and lobby {#customize-login-lobby}

Under **Admin → Login & lobby**, Admins customize the scenes, guidance and rules players meet when they join. Under **Choose a space**, select **Login space** or **Lobby**; the console page of each system server also links here with **Customize login space** and **Customize lobby**.

The login space runs Limbo and is where players authenticate; the lobby runs Paper and offers the server menu. Neither stops when idle.

### Settings {#space-settings}

Settings can be saved while the space runs and take effect on its next start or restart. After saving, select **Restart & apply** to apply them now; the restart disconnects players in that space. Settings are stored in `/data/felis-experience.json` on the space's data volume, independently of the image.

Lobby settings:

| Group | Settings (defaults) |
| --- | --- |
| Welcome & menu | Chinese menu title, English menu title, Chinese welcome message, English welcome message; Send a welcome message on join (on); Open the server menu on join (off). The welcome message carries a clickable server menu. |
| Player behavior & protection | Default player game mode (Adventure); Return to world spawn on join, Protect against building and damage, Prevent player damage, Prevent hunger, Return to spawn after a void fall (all on). Players with building access keep their own game mode. |
| World environment | Difficulty (Peaceful); Fixed time (0–23999, default 6000); Freeze world time, Keep clear weather, Keep inventory on death, Respawn immediately (on); Allow PvP, Allow natural mob spawning, Allow mob griefing, Allow TNT explosions, Show advancement announcements (off). |

Login space settings are in the **Login guidance & waiting** group: Login book title, Login book author, Login page heading, Login link text, Login instructions, Open the login book automatically (on), and Login timeout (30–3600 seconds, default 600). Bind codes and sign-in links are generated by Felis, and the chat prompts stay on. An explicitly configured `FELIS_LOGIN_TIMEOUT_SECONDS` environment variable overrides the login timeout set here.

Text fields hold up to 512 characters. If the settings file is damaged, the game uses defaults for whatever it cannot read; the page keeps the settings that are still valid, and saving writes them over the file.

### Maps, plugins and files {#space-content}

The **Content & maintenance** area offers:

- **Maps & scenes**:
  - Lobby: back up and stop the lobby, upload a world ZIP in the file manager and extract it at the root, confirm that the world folder directly contains `level.dat`, set `level-name` in `server.properties`, then start it. Spawn comes from the map; change it with `setworldspawn x y z` in the lobby console.
  - Login space: stop it, upload your scene as `spawn.schem` at the root, then start it; adjust the spawn position in `server.properties`. The login space uses Limbo schematics and supports neither Paper world maps nor Paper plugins.
- **Plugins & plugin settings**: upload plugin JARs and edit their configuration. Plugins must match the space's core and version; the bundled Felis plugins and LuckPerms are refreshed from the image at startup.
- **Advanced file manager**: edit server properties, world settings and plugin data. Authentication forwarding settings are maintained by Felis.
- **Console & runtime logs**: read logs and run lobby commands. Limbo has no RCON, so edit the login space's configuration in the file manager.
- **Map backups & restore**: back up before replacing maps, plugins or images, or restore a saved backup.
- **Lobby builder access**: while the lobby runs, enter a Minecraft player name and select **Allow building** or **Deny building** to grant or revoke `felis.lobby.build`. The permission defaults to operators; you can also run `lp user <name> permission set felis.lobby.build true` in the lobby console.

The file manager requires the space to be stopped. While the login space is stopped, new players cannot join. A replacement image must keep the Felis login or menu plugin and support the proxy's forwarding protocol; images and resources are set under **Edit Server Config** on the system server. For how the images are built and behave, see [Lobby image](/en/reference/lobby#customize) and [Login space image](/en/reference/limbo#customize).

## Global blacklist {#blacklist}

The global blacklist records game identities that are barred from logging in, matched by UUID. A barred identity is refused when the game proxy verifies it and is disconnected in the login space, whatever the player entry policy; the blacklist also applies with **Require panel account linking** turned off. Because matching is by UUID, an official player with the same name but a different UUID is never affected. The blacklist has no page in the panel.
