---
title: 大厅镜像
description: Felis 正式大厅镜像的作用、默认行为、在面板中的自定义方法与镜像构建。
---

# 大厅镜像 {#lobby-image}

本页说明 Felis 正式大厅（系统服 `lobby`）使用的镜像：它在玩家进服流程中的位置、默认行为、在面板中的自定义方法，以及自行构建镜像的步骤。面向管理员和需要定制大厅的运维人员。

## 概览 {#overview}

正式大厅是常驻的中转服务器，镜像由 Paper 26.3、Felis 大厅插件（`felis-paper`）和 LuckPerms 组成。`felis.toml` 的 `[velocity] lobby_image` 指定镜像后，`felis setup` 把它创建为系统服：始终保持运行（`DesiredState=Running`），不参与空闲停服和世界清理。安装器会构建该镜像并完成配置。

大厅提供 `/menu` 服务器菜单，菜单的行为见[大厅菜单](/reference/plugins#lobby-menu)。

### 进服拓扑 {#topology}

```text
连接 → login（登录空间，认证网关）→ lobby（正式大厅，/menu）→ 目标服务器
```

玩家只有在登录空间完成认证、被放行之后才能进入大厅。大厅不能作为回退目的地或等待区，否则新连接会绕过认证。Felis 在各层都保持这一约束：

- 登录空间没有回退目标，网关不可用时拒绝连接。
- 大厅和所有用户服务器都回退到 `login`，不会回退到大厅。
- Felis 拒绝创建回退目标为 `lobby` 的系统服。
- 游戏代理的默认落点和等待区都指向 `login`。

[玩家进入策略](/guide/players#entry-policy)可以改变认证后的去向，例如直接进入主服务器；使用这类策略时可以停止大厅。

## 默认行为 {#default-behaviour}

大厅插件让大厅成为不会被破坏、玩家也不会受伤的中转区。以下是默认设置，可以在面板中调整（见[在面板中自定义](#customize)）：

- 所有世界为和平难度，关闭自然生物生成、PvP、生物破坏和 TNT 爆炸；时间固定在正午，天气保持晴朗，死亡后保留物品，立即重生，不显示进度公告。
- 玩家不受伤害，也不会饥饿；掉入虚空时回到出生点。
- 没有 `felis.lobby.build` 权限的玩家以冒险模式在出生点加入，不能破坏或放置方块、使用桶、踩坏耕地、点火，也不能伤害生物、物品展示框、画、盔甲架或载具。按钮、门、压力板和容器仍可使用。
- 每次加入都会收到一条欢迎消息，点击即可执行 `/menu`。

`felis.lobby.build` 默认授予 OP。允许指定玩家在大厅建造时，在面板的「大厅建造权限」中授予，或在大厅控制台执行 `lp user <name> permission set felis.lobby.build true`。

`server.properties` 未设置 `max-players` 时，镜像入口脚本将其设为 `200`（Paper 默认为 `20`）；之后通过文件管理所做的修改在重启后保留。所有已认证的玩家都会经过大厅，某台服务器停止时，其上的玩家也会同时回到这里，因此人数上限不宜过低。

## 在面板中自定义 {#customize}

管理员在「管理 → 登录与大厅」中选择「正式大厅」。设置可以在大厅运行时保存，在下次启动或重启后生效；保存后选择「重启并应用」立即生效。

::: warning 注意
「重启并应用」会断开大厅中所有玩家的连接。
:::

表单包含以下部分：

| 部分 | 可配置项 |
| --- | --- |
| 欢迎与菜单 | 中英文欢迎文案、中英文菜单标题、加入时发送欢迎提示、加入时自动打开服务器菜单 |
| 玩家行为与保护 | 玩家默认游戏模式、加入时回到世界出生点、禁止普通玩家破坏和建造、玩家免受伤害、禁止饥饿、掉入虚空时回到出生点 |
| 世界环境 | 难度、固定世界时间与时刻（0–23999）、保持晴天、PvP、自然生成生物、生物破坏、TNT 爆炸、死亡后保留物品、立即重生、显示进度公告 |

文案最多 512 个字符。设置保存在大厅世界卷的 `/data/felis-experience.json` 中，独立于镜像；保存时保留文件中的未知键。文件内容损坏时，游戏内对无法读取的部分使用默认值，面板会提示，重新保存即可修复。

「内容与维护」部分提供以下入口：

- **地图与场景**、**高级文件管理**：编辑 `server.properties`、世界配置和插件数据，上传、解压、重命名或下载文件。
- **插件与插件配置**：上传插件 JAR、编辑插件配置。
- **控制台与运行日志**：查看日志，执行大厅命令，例如设置出生点或管理玩家。
- **地图备份与恢复**：在更换地图、插件或镜像之前保存备份，或从已有备份恢复。
- **大厅建造权限**：输入 Minecraft 角色名，选择「允许建造」或「禁止建造」。修改建造权限需要大厅处于运行状态。
- **管理镜像与版本**：更换大厅镜像和资源设置。

### 更换地图 {#replace-map}

1. 在「地图备份与恢复」中备份现有地图。
2. 停止大厅。
3. 在文件管理中上传世界 ZIP，并解压到卷的根目录。确认世界目录直接包含 `level.dat`。
4. 在 `server.properties` 中把 `level-name` 设为该世界目录的名称。
5. 启动大厅。
6. 在大厅控制台执行 `setworldspawn x y z` 设置出生点。

### 插件 {#lobby-plugins}

插件 JAR 放在 `plugins/` 目录，须与大厅的 Paper 版本匹配。镜像内置的 Felis 插件和 LuckPerms 在每次启动时从镜像刷新。使用自定义镜像时，必须保留 Felis 大厅插件。

认证转发设置由系统维护：operator 在每次启动前合并 Paper 全局配置，保留自定义项，同时刷新必需的认证设置。RCON 密码和代理转发密钥也由系统管理。

## 构建镜像 {#build}

安装器会自动构建大厅镜像。需要自行构建时，在仓库根目录使用 `deploy/game-stack.lock` 中的 Paper 和 LuckPerms 版本：

```bash
. <(grep -E '^(PAPER|LUCKPERMS)_' deploy/game-stack.lock)
docker build -f deploy/lobby/Dockerfile \
  --build-arg PAPER_JAR_URL="$PAPER_JAR_URL" --build-arg PAPER_JAR_SHA256="$PAPER_JAR_SHA256" \
  --build-arg LUCKPERMS_JAR_URL="$LUCKPERMS_JAR_URL" --build-arg LUCKPERMS_JAR_SHA256="$LUCKPERMS_JAR_SHA256" \
  -t felis-lobby:demo .
```

Paper 版本必须与登录空间一致：Limbo 每个构建只支持一种协议，客户端需要同时通过登录空间和大厅。

把镜像推送到集群内的镜像仓库，并在配置中引用它。在节点本机执行时，Docker 默认把 `127.0.0.1` 视为非安全仓库：

```bash
docker tag  felis-lobby:demo 127.0.0.1:5000/felis/lobby:demo
docker push 127.0.0.1:5000/felis/lobby:demo
```

在 `felis.toml` 中设置 `[velocity] lobby_image = "registry.felis.svc:5000/felis/lobby:demo"`，然后执行：

```bash
sudo felis setup
```

镜像仓库按主机名之后的路径区分仓库，因此从另一台机器经 `kubectl -n felis port-forward svc/registry 5000:5000` 推送效果相同。

## 运行要求 {#runtime-requirements}

- 游戏端口固定为 `25565`，与 `MinecraftServer` 资源的 `GamePort` 一致；入口脚本每次启动都写入 `server-port`。
- 大厅使用 Velocity modern forwarding 接收已由代理认证的玩家身份。`server.properties` 中的 `online-mode` 固定为 `false`；`config/paper-global.yml` 中的 `proxies.velocity` 设置在受 Felis 管理时由 operator 在每次启动前合并写入，独立运行时由入口脚本写入。
- 转发密钥由 operator 从 Secret `felis-forwarding-secret` 注入为 `FELIS_FORWARDING_SECRET`。没有该密钥时镜像拒绝启动，以免信任可伪造的 UUID。
- RCON 密码在每次启动时从 Secret 写入 `server.properties`，因此在文件管理中修改这些行不会使控制面失去对大厅的控制。
- 大厅只使用 `felis:control` 插件消息通道，不持有 felis-api 令牌。
