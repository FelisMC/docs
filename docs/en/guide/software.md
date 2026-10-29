---
title: Server software
description: Choosing Paper, Purpur, Fabric, Quilt, Forge, NeoForge, vanilla or a custom jar as a server's core, with versions, Java, identity forwarding, the download cache and version changes.
---

# Server software {#software}

This page describes the server software a server can run: the available cores and versions, the Java runtime, player identity forwarding, how files are downloaded and cached, and how to change versions or use a custom jar. It is for server owners and administrators.

## How it works {#how-it-works}

A server that runs server software starts on a Java runtime image provided by the platform; the server software itself is data on the server's world volume. Before every start, the platform:

1. Reads version information from the core's official source, downloads the server and its libraries, and checks each file against the hash the source publishes.
2. Writes the forwarding configuration for versions that can take identity forwarding, installing a forwarding component where one is needed.
3. Starts the server on the selected Java version, writes the game port, offline mode and RCON settings, and accepts the Minecraft EULA as confirmed when the server was created.

The first start downloads the server, which takes time depending on the network and the core; Forge and NeoForge also run their official installer. Later starts only check the downloaded files and do not contact the download sites, so an installed server still starts while a download site is unavailable.

A server can also keep running an image from the image whitelist, see [Images and Minecraft versions](/en/guide/servers#images-versions). The choice is the "Runs on" setting when creating or editing a server.

## Available cores {#types}

| Core | Description | Official source | Earliest version offered |
| --- | --- | --- | --- |
| Paper | High-performance plugin server, compatible with Bukkit and Spigot plugins | PaperMC | 1.8.8 |
| Purpur | Based on Paper, with more configurable gameplay options | PurpurMC | 1.14.1 |
| Fabric | Lightweight mod loader | FabricMC | 1.14 |
| Quilt | Mod loader compatible with Fabric mods | QuiltMC | 1.14.4 |
| Forge | Established mod loader | MinecraftForge | 1.12.2 |
| NeoForge | Mod loader derived from Forge | NeoForged | 1.20.2 |
| Vanilla | Mojang's official server | Mojang | 1.7.10 |
| Custom jar | Upload a jar, or use one in the server files | Server owner | — |

The version list shows releases only by default; select "Show pre-releases and snapshots" to include pre-releases, release candidates and snapshots. After a game version is selected:

- Paper and Purpur select a build; Fabric, Quilt, Forge and NeoForge select a loader version. The entry marked "recommended" is preselected: Forge's official recommended build, or its newest build when it names none; the newest stable build for the other cores.
- Mods and plugins are uploaded to the `mods` or `plugins` directory through [Server files](/en/guide/servers#files).

## Java version {#java}

The platform provides Java 8, 17, 21 and 25 runtimes. After a game version is selected, the panel shows the minimum Java version it requires and preselects the earliest runtime that meets it. A newer runtime can be selected; older ones are not offered, and the API refuses them with `java_too_old`. Some older modpacks run only on a specific Java version; follow the modpack's instructions.

The runtime images are copied into the in-cluster registry by `felis mirror-build-tools`, see [Runtime images](/en/operations/troubleshooting#runtime-unavailable).

## Player identity {#identity}

The game proxy verifies each player's premium identity and passes it to the server with Velocity modern forwarding. A server that takes forwarding receives players with their premium UUID and skin; a server that cannot receives them with offline-mode UUIDs, and the panel marks it "Identity not forwarded".

| Core | Identity forwarding |
| --- | --- |
| Paper, Purpur | From 1.13 the platform writes the forwarding configuration: `config/paper-global.yml` from 1.19, `paper.yml` before. |
| Fabric | The platform installs FabricProxy-Lite and Fabric API from Modrinth, only where Modrinth publishes them for the game version. |
| Quilt | The platform installs FabricProxy-Lite and Quilted Fabric API from Modrinth, only where both are published for the game version. |
| Forge | From 1.15.2 the platform installs Proxy Compatible Forge from Modrinth and writes its configuration, only where it is published for the game version. |
| NeoForge | The platform installs Proxy Compatible Forge, under the same condition as Forge. |
| Vanilla | Not forwarded; players join with offline-mode UUIDs. |
| Custom jar | The platform does not configure forwarding. To use premium identities, install and configure Velocity forwarding on the server. |

When a version is selected, the panel states whether it takes identity forwarding. Offline-mode UUIDs are derived from the player name and differ from premium UUIDs; permissions, whitelists and saved player data are recorded under the offline UUID, and are not migrated if the server later moves to a version that takes forwarding.

The forwarding components the platform installs live in the `mods` directory with file names starting with `felis-managed-`, and are placed again on every start. When the server owner adds the same component (identified by mod ID), the platform uses the owner's copy and removes its own.

::: warning
Forge 1.13 to 1.20.1 modded clients switching servers inside the proxy need the proxy-side Ambassador plugin, which the Felis proxy does not install. Players joining a running server directly through its subdomain are not affected; after a server wakes from sleep, modded clients may need to reconnect.
:::

## Downloads and caching {#downloads}

Files a server installs are fetched through the in-cluster download cache. The cache keeps each file by its hash, so a version is downloaded from its official source once, and other servers using it read it from the cache.

- The cache downloads only from the official download sites (Mojang, PaperMC, PurpurMC, FabricMC, QuiltMC, MinecraftForge, NeoForged, Modrinth and Maven Central), and keeps only content matching the requested hash.
- When the cache is unavailable, a server downloads from the official source directly, checking the same hashes.
- The cache lives on the `felis-artifacts` volume in the control namespace, which requests 10Gi by default; beyond 90% of it the least recently used files are deleted, see [Volume sizes](/en/operations/storage#volume-sizes).

Versions 1.7 to 1.18 are affected by Log4Shell (CVE-2021-44228). Vanilla, Fabric and Quilt servers start the way Mojang's advisory describes: 1.17 and 1.18 add `-Dlog4j2.formatMsgNoLookups=true`, and 1.12 to 1.16.5 and 1.7 to 1.11.2 use the logging configuration Mojang published. The latest Paper, Purpur and Forge builds are fixed; use the recommended build.

## Files on the server {#files}

| Path | Contents |
| --- | --- |
| `.felis/` | Files the platform manages: the server jar, installers, logging configuration and the installation record. |
| `libraries/` | Libraries of Fabric, Quilt, Forge and NeoForge, and those the vanilla server unpacks. |
| `mods/felis-managed-*.jar` | Identity forwarding components installed by the platform. |
| `cache/` | Files Paper and Purpur generate at startup. |

On every start the platform writes `eula.txt`, and `server-port`, `online-mode` and the RCON settings in `server.properties`. The RCON settings include `broadcast-rcon-to-ops=false`, so commands the platform runs over RCON are neither announced to operators in game nor written to the log. On a new server's first start `white-list` is set to `false`; access is controlled by the [autostart policy](/en/guide/servers#autostart) and the wake list, and a whitelist setting the owner changes later is kept. World backups contain the whole world volume, including these files.

## Changing the core or version {#change}

Server owners and administrators select "Change server software" in "Edit Server Config" on the server's console page.

1. Select the core, game version, build and Java version.
2. When changing the core or game version, select "I've backed up the world — change the software". Changing only the build or Java version needs no confirmation.
3. Select "Save Config". The change takes effect on the server's next start.

After a core or game version change the world is opened by the new version, and upgraded chunks cannot be used by older versions; [back up the world](/en/guide/servers#server-backups) first. The platform removes the server files it downloaded for the old version; the world, configuration, plugins and mods are kept. The server owner checks whether mods and plugins are compatible with the new version.

A server running a server image can also switch to server software, which additionally requires accepting the Minecraft EULA. Administrators can switch a server running server software back to an image.

## Custom jar {#custom-jar}

A custom jar runs server software the platform does not list, such as hybrid or modified servers.

For a new server:

1. In "New server", select "Custom jar" and drag the jar onto the "Jar file" area, or click it and choose the file. The jar is uploaded to the server's root folder under its own name; to put it elsewhere, select "Put it elsewhere" and enter a path relative to the root folder, such as `pack/server.jar`. The folders in the path are created automatically.
2. Select the Java version, accept the Minecraft EULA and create the server. Once the server is created, the chosen jar is uploaded; if the upload fails, the dialog offers "Retry upload" without creating the server again.
3. Start the server.

To upload the jar later, select "Enter a path" under "Jar file" and enter where the jar will be.

For an existing server, select "Change server software" and "Custom jar" in "Edit Server Config". While the server is stopped, "Jar file" offers three ways:

- "In the server": lists the jar files in the server's root folder to choose from; a lone jar is selected automatically.
- "Upload": choose a new jar, which is uploaded to the root folder on save, replacing a file of the same name.
- "Enter a path": enter the jar's path relative to the root folder.

While the server is running its files cannot be read or uploaded to, so only a path can be entered.

The jar must honor the RCON settings in `server.properties`: the platform uses RCON to tell when the server is ready, read the player count and save the world. If the jar has not been uploaded, the start fails with an upload hint. The path must be inside the server directory, end in `.jar`, and not be inside the `.felis` directory.
