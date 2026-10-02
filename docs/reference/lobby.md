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
  --build-arg PAPER_JAR_URL=https://<mirror>/paper-1.21.x-<build>.jar \
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

## 配置（由部署者负责） {#configure-deployer-s-responsibility}

- 游戏端口必须为 `25565`，与 CRD 的 `GamePort` 一致。
- `online-mode` 和玩家身份转发设置须与集群外 Velocity 代理一致。
- 大厅仅使用 `felis:control` 插件消息通道，按设计不持有 felis-api 令牌（规范 §12）。

## 大厅允许哪些操作 {#what-the-lobby-allows}

felis-paper 的 `LobbyGuard` 使大厅成为不会受到破坏、玩家也不会受伤的中转区：

- 所有世界设为和平模式，关闭自然生物生成、PvP、生物破坏和 TNT；时间固定为正午，天气晴朗，死亡保留物品。
- 玩家不受伤害，也不会饥饿；落入虚空时传送回出生点。
- 没有 `felis.lobby.build` 权限的玩家以冒险模式在出生点加入，不能破坏或放置方块、使用桶、踩坏耕地、点火，也不能伤害生物、物品展示框、画、盔甲架或载具。按钮、门、压力板和容器仍可使用。
- 每次加入都会收到一条可点击执行 `/menu` 的聊天消息。

`felis.lobby.build` 默认授予 OP。允许管理员建造大厅时，可以在大厅控制台用 LuckPerms 授权（`lp user <name> permission set felis.lobby.build true`），或将其设为 OP。

入口脚本每次启动都将 `max-players` 固定为 `200`，覆盖 Paper 的默认值 `20`：所有已认证玩家都经过大厅，服务器停服时其玩家也会同时来到这里。

---

来源：[deploy/lobby/README.md](https://github.com/FelisMC/Felis/blob/main/deploy/lobby/README.md)。
