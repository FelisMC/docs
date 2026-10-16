---
title: 服务端软件
description: 选择 Paper、Purpur、Fabric、Quilt、Forge、NeoForge、原版或自定义 jar 作为服务器核心，以及版本、Java、身份转发、下载缓存与更换版本的说明。
---

# 服务端软件 {#software}

本页说明服务器可运行的服务端软件：可选的核心与版本、Java 运行时、玩家身份转发、文件的下载与缓存，以及更换版本和使用自定义 jar 的方法。本页面向服务器所有者与管理员。

## 工作方式 {#how-it-works}

使用服务端软件的服务器运行在平台提供的 Java 运行时镜像上，服务端本身作为数据保存在服务器的世界卷中。每次启动前，平台按服务器的配置完成以下步骤：

1. 从核心的官方来源读取版本信息，下载服务端及其依赖库，并逐个校验官方公布的哈希值。
2. 为能够接入身份转发的版本写入转发配置，必要时安装转发组件。
3. 以所选 Java 版本启动服务器，写入游戏端口、离线模式与 RCON 设置，并按创建时的确认接受 Minecraft EULA。

首次启动需要下载服务端，耗时取决于网络与核心类型；Forge 与 NeoForge 还需运行官方安装器。之后的启动只校验已下载的文件，不再访问下载站，因此下载站暂时不可用时，已安装的服务器仍可启动。

服务器也可以继续使用镜像白名单中的服务端镜像，见[镜像与 Minecraft 版本](/guide/servers#images-versions)。两种方式由创建或编辑服务器时的「运行方式」决定。

## 可选的核心 {#types}

| 核心 | 说明 | 官方来源 | 可选的最早版本 |
| --- | --- | --- | --- |
| Paper | 高性能插件服务端，兼容 Bukkit 与 Spigot 插件 | PaperMC | 1.8.8 |
| Purpur | 基于 Paper，提供更多可配置的玩法选项 | PurpurMC | 1.14.1 |
| Fabric | 轻量模组加载器 | FabricMC | 1.14 |
| Quilt | 兼容 Fabric 模组的模组加载器 | QuiltMC | 1.14.4 |
| Forge | 经典模组加载器 | MinecraftForge | 1.12.2 |
| NeoForge | 源自 Forge 的模组加载器 | NeoForged | 1.20.2 |
| 原版 | Mojang 官方服务端 | Mojang | 1.7.10 |
| 自定义 jar | 启动服务器文件中已上传的 jar | 服务器所有者 | — |

版本列表默认只显示正式版本，勾选「显示预发布版本与快照」后显示预发布版本、候选版本与快照。选择游戏版本后：

- Paper 与 Purpur 选择构建，Fabric、Quilt、Forge 与 NeoForge 选择加载器版本。默认选中标记为「推荐」的项：Forge 采用其官方推荐构建，没有推荐构建时采用最新构建；其他核心采用最新的稳定构建。
- 模组与插件通过[服务器文件](/guide/servers#files)上传到 `mods` 或 `plugins` 目录。

## Java 版本 {#java}

平台提供 Java 8、17、21 与 25 的运行时。选择游戏版本后，面板显示该版本所需的最低 Java 版本，并默认选中满足要求的最早版本。可以改选更高的版本；低于要求的版本不提供，接口以 `java_too_old` 拒绝。部分旧版模组包只能在特定 Java 版本上运行，请按模组包的说明选择。

运行时镜像由 `felis mirror-build-tools` 复制到集群内镜像仓库，见[运行时镜像](/operations/troubleshooting#runtime-unavailable)。

## 玩家身份 {#identity}

游戏代理验证玩家的正版身份，再以 Velocity 现代转发把身份传给服务器。能够接收转发的服务器以玩家的正版 UUID 与皮肤接待玩家；不能接收转发的服务器以离线模式 UUID 接待玩家，面板在服务器页显示「身份未接入」。

| 核心 | 身份转发 |
| --- | --- |
| Paper、Purpur | 1.13 及以上版本由平台写入转发配置：1.19 起为 `config/paper-global.yml`，更早版本为 `paper.yml`。 |
| Fabric | 平台从 Modrinth 安装 FabricProxy-Lite 与 Fabric API。仅在 Modrinth 发布了对应游戏版本的组件时接入。 |
| Quilt | 平台从 Modrinth 安装 FabricProxy-Lite 与 Quilted Fabric API。仅在两者都发布了对应游戏版本时接入。 |
| Forge | 1.15.2 及以上版本由平台从 Modrinth 安装 Proxy Compatible Forge 并写入其配置，仅在其发布了对应游戏版本时接入。 |
| NeoForge | 平台安装 Proxy Compatible Forge，条件与 Forge 相同。 |
| 原版 | 不接入，玩家以离线模式 UUID 进入。 |
| 自定义 jar | 平台不配置转发。如需正版身份，请在服务器中自行安装并配置 Velocity 转发。 |

选择版本时，面板说明该版本是否接入身份转发。离线模式 UUID 由玩家名计算，与正版 UUID 不同，权限、白名单与存档中的玩家数据按离线 UUID 记录；之后改为接入转发的版本时，这些数据不会自动迁移。

平台安装的转发组件位于 `mods` 目录，文件名以 `felis-managed-` 开头，每次启动时按配置重新放置。服务器所有者自行放入同一组件（按模组 ID 识别）时，平台使用所有者的副本并移除自己的副本。

::: warning 注意
Forge 1.13 至 1.20.1 的模组客户端在代理中切换服务器时，需要代理侧的 Ambassador 插件，Felis 的代理未安装该插件。玩家直接通过子域名进入正在运行的服务器不受影响；服务器从休眠中唤醒后，模组客户端可能需要重新连接。
:::

## 下载与缓存 {#downloads}

服务器安装时下载的文件经集群内的下载缓存取得。缓存按哈希值保存每个文件，同一版本只从官方来源下载一次，其他服务器再使用时直接从缓存读取。

- 缓存只从官方下载站下载：Mojang、PaperMC、PurpurMC、FabricMC、QuiltMC、MinecraftForge、NeoForged、Modrinth 与 Maven Central，并且只保存与请求的哈希值一致的内容。
- 服务器在下载缓存不可用时直接从官方来源下载，同样校验哈希值。
- 缓存位于控制命名空间的 `felis-artifacts` 卷，默认申请 10Gi，超出 90% 后删除最久未使用的文件，见[卷容量](/operations/storage#volume-sizes)。

1.7 至 1.18 版本受 Log4Shell（CVE-2021-44228）影响。原版、Fabric 与 Quilt 服务器按 Mojang 公告的方式启动：1.17 与 1.18 加入 `-Dlog4j2.formatMsgNoLookups=true`，1.12 至 1.16.5 与 1.7 至 1.11.2 使用 Mojang 发布的日志配置文件。Paper、Purpur 与 Forge 的最新构建已修复该漏洞，请使用推荐构建。

## 服务器中的文件 {#files}

| 路径 | 内容 |
| --- | --- |
| `.felis/` | 平台管理的文件：服务端 jar、安装器、日志配置与安装记录。 |
| `libraries/` | Fabric、Quilt、Forge 与 NeoForge 的依赖库，以及原版服务端解出的库。 |
| `mods/felis-managed-*.jar` | 平台安装的身份转发组件。 |
| `cache/` | Paper 与 Purpur 启动时生成的文件。 |

平台每次启动时写入 `eula.txt`，以及 `server.properties` 中的 `server-port`、`online-mode` 与 RCON 设置。新服务器首次启动时 `white-list` 设为 `false`，准入由[自动启动策略](/guide/servers#autostart)与唤醒名单控制；服务器所有者之后修改的白名单设置保持不变。世界备份包含整个世界卷，包括上述文件。

## 更换核心或版本 {#change}

服务器所有者与管理员在服务器控制台页的「编辑服务器配置」中选择「更换服务端软件」。

1. 选择核心、游戏版本、构建与 Java 版本。
2. 更换核心或游戏版本时，勾选「我已备份世界，确认更换」。只更换构建或 Java 版本时无需确认。
3. 选择「保存配置」。新配置在服务器下次启动时生效。

更换核心或游戏版本后，世界由新版本打开，升级后的区块无法在旧版本中使用，请先[备份世界](/guide/servers#server-backups)。平台移除旧版本下载的服务端文件，世界、配置、插件与模组保留；模组与插件是否兼容新版本，由服务器所有者自行确认。

使用服务端镜像的服务器也可以改用服务端软件，此时还需同意 Minecraft EULA。管理员可将使用服务端软件的服务器改回镜像。

## 自定义 jar {#custom-jar}

自定义 jar 用于平台未列出的服务端，例如混合端或修改版服务端。

1. 在[服务器文件](/guide/servers#files)中上传 jar，例如上传到服务器根目录的 `server.jar`。
2. 创建或编辑服务器时选择「自定义 jar」，填写 jar 相对服务器目录的路径，并选择 Java 版本。
3. 启动服务器。

jar 须支持 `server.properties` 中的 RCON 设置：平台通过 RCON 判断服务器是否就绪、读取在线人数并保存世界。jar 尚未上传时，启动失败并提示上传。路径必须位于服务器目录内且以 `.jar` 结尾，不能位于 `.felis` 目录下。
