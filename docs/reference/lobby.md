---
title: 大厅镜像
---

# 大厅镜像 {#lobby-image-paper-felis-paper}

**大厅**是常驻的中转服务器。在 `felis.toml` 的 `[velocity] lobby_image` 中指定镜像后，`felis setup` 会将它配置为系统服务（`DesiredState=Running`，不参与世界回收）。

> **仅代码验证。** Go CI 不构建此镜像。镜像会编译 `plugins/paper` 中的 `/menu` 功能，并将插件安装到 Paper 服务器。

## 拓扑与必须遵守的约束 {#topology-the-one-invariant}

```
connect → login (limbo auth gate) → lobby (/menu hub) → target backend
```

只有登录网关完成认证并放行的玩家才能进入大厅。大厅不能用作回退目的地或等待区，否则新连接会绕过认证。Felis 在每一层都遵守此约束：

- 登录系统服务**没有**回退目标；网关不可用时拒绝连接。
- 大厅和所有用户服务器均回退到 **login**，不会回退到大厅。
- `buildSystemServer` 拒绝创建回退目标为 `lobby` 的服务。
- `felis setup` 输出集群外 Velocity 的接线配置：默认落点和等待区均指向 `login`。

## 构建 {#build}

```
docker build -f deploy/lobby/Dockerfile \
  --build-arg PAPER_JAR_URL=https://<mirror>/paper-26.3-<build>.jar \
  --build-arg PAPER_JAR_SHA256=<sha256 of that jar> \
  -t felis-lobby:demo .
# Publish into the cluster's registry (on the node; docker treats 127.0.0.1 as
# insecure by default — or through a `kubectl -n felis port-forward svc/registry
# 5000:5000`, which is equivalent: only the path after the host matters).
docker tag  felis-lobby:demo 127.0.0.1:5000/felis/lobby:demo
docker push 127.0.0.1:5000/felis/lobby:demo
# felis.toml → [velocity] lobby_image = "registry.felis.svc:5000/felis/lobby:demo"
sudo felis setup
```

## 在面板中自定义 {#customize-in-the-panel}

管理员打开「登录与大厅」（`/admin/lobby`）。读取或保存所选空间的设置前须先停止该空间，完成后启动该空间以应用设置。大厅表单可配置欢迎文案、菜单标题、加入行为、游戏模式、建造保护，伤害、饥饿和虚空坠落的处理方式，以及难度、时间、天气和世界规则。设置保存在 `/data/felis-experience.json`，独立于镜像，保存时保留未知键。没有该文件的现有安装沿用原有的受保护大厅默认值。

该页面还提供现有的文件管理（包括上传和 ZIP 解压）、控制台、备份与恢复、建造权限，以及镜像与资源设置。更换地图的步骤：备份并停止大厅，上传世界 ZIP，解压到卷根目录，确认世界目录直接包含 `level.dat`，并在 `server.properties` 中设置 `level-name`。大厅运行时，在其控制台使用 `setworldspawn x y z` 设置出生点。插件 JAR 放入 `plugins/`，且须与 Paper 版本匹配；内置的 Felis 和 LuckPerms JAR 在启动时从镜像刷新。自定义镜像必须保留菜单与控制插件。

operator 对大厅复用 `init-forwarding` 的 YAML 合并逻辑，保留自定义的 Paper 全局配置，同时刷新必需的认证设置。只有在没有受管转发 initContainer 的独立运行场景下，镜像才会重写该文件。RCON 密钥和代理转发密钥仍由系统管理。

## 配置（由部署者负责） {#configure-deployer-s-responsibility}

- 游戏端口必须为 `25565`，与 CRD 的 `GamePort` 一致。
- `online-mode` 和玩家身份转发设置须与集群外 Velocity 代理一致。
- 大厅仅使用 `felis:control` 插件消息通道，按设计不持有 felis-api 令牌（规范 §12）。

## 大厅默认行为 {#what-the-lobby-allows}

felis-paper 的 `LobbyGuard` 使大厅成为不会受到破坏、玩家也不会受伤的中转区：

- 所有世界设为和平模式，关闭自然生物生成、PvP、生物破坏和 TNT；时间固定为正午，天气晴朗，死亡保留物品。
- 玩家不受伤害，也不会饥饿；落入虚空时传送回出生点。
- 没有 `felis.lobby.build` 权限的玩家以冒险模式在出生点加入，不能破坏或放置方块、使用桶、踩坏耕地、点火，也不能伤害生物、物品展示框、画、盔甲架或载具。按钮、门、压力板和容器仍可使用。
- 每次加入都会收到一条可点击执行 `/menu` 的聊天消息。

`felis.lobby.build` 默认授予 OP。允许管理员建造大厅时，可以在大厅控制台用 LuckPerms 授权（`lp user <name> permission set felis.lobby.build true`），或将其设为 OP。

`max-players` 未设置时，入口脚本将其初始化为 `200`，替代 Paper 的默认值 `20`；之后通过文件编辑器所做的修改在重启后保留。所有已认证玩家都经过大厅，服务器停服时其玩家也会同时来到这里。
