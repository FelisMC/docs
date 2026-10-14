---
title: 时序图
description: Felis 进服唤醒、服务器认领和账号绑定三个流程的时序图。
---

# 时序图 {#sequence-diagrams}

本页以时序图展示 Felis 中跨越多个组件的三个流程：玩家进服时唤醒休眠服务器、在面板中认领无主服务器，以及游戏账号与面板账户的绑定。各接口的请求与响应结构见 [API 参考](/reference/api)。面向需要了解组件之间消息顺序的开发者。

## 进服与唤醒 {#join-and-wake}

玩家查询服务器列表时，游戏代理只读取缓存，不会唤醒服务器。玩家加入时，游戏代理按主机名找到目标服务器：服务器已就绪时直接连接；未就绪时，游戏代理请求唤醒，让玩家在大厅等待，并轮询服务器状态，就绪后把玩家传送过去并上报进服事件。未配置大厅时，玩家会被断开并提示稍后重连，唤醒请求仍会发出。

下图从玩家已通过认证之后开始；尚未绑定账户的玩家先经过登录空间，见[登录空间镜像](/reference/limbo#login-flow)。

```mermaid
sequenceDiagram
    autonumber
    actor Player as 玩家
    participant Velocity as Velocity 代理
    participant Registry as Velocity 服务器注册表
    participant API as felis-api 内部接口
    participant Cluster as MinecraftServer CRD/status
    participant Operator as Felis 控制器
    participant Backend as Minecraft 后端

    Player->>Velocity: 查询 subdomain.root-domain 的服务器列表
    Velocity->>Registry: 读取缓存的生命周期视图
    Registry-->>Velocity: 根据阶段生成 MOTD
    Velocity-->>Player: 返回查询结果（只读，不唤醒）

    Player->>Velocity: 加入 subdomain.root-domain
    Velocity->>Registry: 由主机名解析目标服务器
    Registry-->>Velocity: ServerView(name, ready=false)

    alt 后端已就绪并注册
        Velocity-->>Player: 初始服务器 = 后端
        Player->>Backend: 连接
    else 后端未就绪且已配置大厅
        Velocity-->>Player: 初始服务器 = 大厅
        Velocity->>API: POST /api/v1/internal/servers/{name}/wake {mc_uuid}
        API->>Cluster: GetServer(name)
        API->>API: 检查 autostartPolicy、冷却时间和运行数量上限
        API->>Cluster: SetDesiredState(name, Running)
        API-->>Velocity: 202 阶段/就绪状态
        Velocity->>Velocity: 加入等待队列
        Operator->>Cluster: 协调 DesiredState=Running
        Operator->>Backend: 启动 Pod/Service
        Backend-->>Operator: RCON 就绪 / 生命周期就绪
        Operator-->>Cluster: status.ready=true
        loop 每次等待轮询
            Velocity->>API: GET /api/v1/internal/servers/{name}/status
            API->>Cluster: GetServer(name)
            API-->>Velocity: 就绪标记
        end
        Velocity->>Registry: 查找已注册的后端
        Velocity-->>Player: "已就绪，正在传送"
        Velocity->>Player: 请求连接后端
        Player->>Backend: 连接
        Velocity->>API: POST /api/v1/internal/servers/{name}/join-event {mc_uuid}
        API->>API: RecordJoin#59; 更新活跃时间和 UUID 白名单
        API-->>Velocity: 204
    else 后端未就绪且未配置大厅
        Velocity-->>Player: 断开连接并提示稍后重连
        Velocity->>API: POST /api/v1/internal/servers/{name}/wake {mc_uuid}
        API->>Cluster: 授权通过后 SetDesiredState(name, Running)
        API-->>Velocity: 202 或可区分的错误
    end
```

## 认领服务器 {#claim}

玩家在面板中认领无主服务器时，felis-api 先确认该账户已绑定游戏角色，再按服务器的实际规格检查四项配额（服务器数量、CPU、内存、存储）。认领在单个数据库事务中完成：事务按用户加锁，锁定服务器记录，重新执行配额检查，并且只在服务器仍无主时写入归属。最终结果以事务内的检查为准，事务之前的配额检查只用于尽早返回错误。

```mermaid
sequenceDiagram
    autonumber
    actor Player as 玩家
    participant Panel as Web 控制面板
    participant API as felis-api 外部接口
    participant Repo as 存储层 / Postgres
    participant Audit as 审计日志

    Player->>Panel: 点击无主服务器的认领按钮
    Panel->>API: POST /api/v1/servers/{name}/claim
    API->>API: 校验服务器名称和调用者身份
    API->>Repo: IsLinked(user_id)
    alt 用户尚无已验证的账号绑定
        Repo-->>API: false
        API-->>Panel: 412 not_linked
    else 已绑定
        Repo-->>API: true
        API->>Repo: QuotaCheck(user_id, 服务器实际规格)
        Note over API,Repo: 四项上限：服务器数、CPU、内存、存储
        alt 配额耗尽
            Repo-->>API: false
            API-->>Panel: 403 quota_exceeded
        else 配额可用
            Repo-->>API: true
            API->>Repo: ClaimServer(name, user_id)
            Note over Repo: 同一事务：pg_advisory_xact_lock(user_id) 串行化该用户的认领#59; SELECT FROM servers WHERE name=$1 AND deleted_at IS NULL FOR UPDATE#59; 重新执行四维配额检查（以此处为准，上方预检只是快速路径）#59; 随后 UPDATE servers SET owner_id=$2, claimed_at=now() WHERE name=$1 AND owner_id IS NULL AND deleted_at IS NULL
            alt 服务器不存在
                Repo-->>API: ErrNotFound
                API-->>Panel: 404 not_found
            else 影响 0 行
                Repo-->>API: claimed=false
                API-->>Panel: 409 already_claimed
            else 影响 1 行
                Repo-->>API: claimed=true
                API->>Audit: 记录外部认领审计
                API-->>Panel: 200 {"claimed":true}
            end
        end
    end
```

## 账号绑定 {#account-link}

玩家在游戏中执行 `/link` 时，插件读取已验证的 online-mode UUID，请求 felis-api 生成一次性的 8 位绑定码并显示在聊天中。未提供认证来源时，felis-api 根据 UUID 的版本推导：版本 3 的 UUID 视为第三方认证源，其余视为 Mojang。玩家随后在面板中提交绑定码；felis-api 去掉首尾空白并转为大写后核对。绑定码有效时写入绑定关系并删除绑定码；同一用户重复验证不会产生重复记录，已停用或已删除用户的绑定会被接管。玩家使用方式见[玩家接入](/guide/players#account-linking)。

```mermaid
sequenceDiagram
    autonumber
    actor Player as 玩家
    participant Game as Minecraft 服务器或 Velocity
    participant LinkClient as Felis LinkClient
    participant APIInternal as felis-api 内部接口
    participant Repo as 存储层 / Postgres
    participant Panel as Web 控制面板
    participant APIExternal as felis-api 外部接口

    Player->>Game: /link
    Game->>Game: 读取已验证的 online-mode UUID
    Game->>LinkClient: requestCode(mc_uuid)
    LinkClient->>APIInternal: POST /api/v1/internal/account/link/code {mc_uuid}
    APIInternal->>APIInternal: 校验 UUID#59; auth_source 缺失时根据 UUID 版本位推导（v3 → thirdparty，其余 → mojang）#59; 生成 8 位绑定码
    APIInternal->>Repo: CreateLinkCode(code, mc_uuid, auth_source, expires_at)
    Repo-->>APIInternal: 已插入 account_link_codes 记录
    APIInternal-->>LinkClient: 201 {code, expires_at, panel_url?}
    LinkClient-->>Game: LinkCode
    Game-->>Player: 在聊天中显示一次性绑定码

    Player->>Panel: 打开账号绑定页面
    Panel->>APIExternal: POST /api/v1/account/link/start
    APIExternal->>Repo: IsLinked(user_id)
    Repo-->>APIExternal: 绑定状态
    APIExternal-->>Panel: 返回状态和“运行 /link”的提示

    Player->>Panel: 提交绑定码
    Panel->>APIExternal: POST /api/v1/account/link/verify {code}
    APIExternal->>APIExternal: 去掉首尾空白并转为大写
    APIExternal->>Repo: VerifyLinkCode(user_id, code, now)
    Repo->>Repo: SELECT mc_uuid, auth_source FROM account_link_codes WHERE code=$1 AND expires_at>$2 FOR UPDATE
    alt 绑定码不存在或已过期
        Repo-->>APIExternal: ErrLinkCodeInvalid
        APIExternal-->>Panel: 400 invalid_code
    else UUID 已绑定到另一个有效用户
        Repo-->>APIExternal: ErrConflict
        APIExternal-->>Panel: 409 already_linked
    else 绑定码有效（同一用户重复验证幂等#59; 接管已停用或软删除用户的绑定）
        Repo->>Repo: INSERT account_links(user_id, mc_uuid, auth_source) ON CONFLICT (user_id, mc_uuid) DO UPDATE auth_source
        Repo->>Repo: DELETE account_link_codes WHERE code=$1
        Repo-->>APIExternal: mc_uuid, auth_source
        APIExternal->>Repo: 记录 account.link 审计
        APIExternal-->>Panel: 200 {linked:true, mc_uuid, auth_source}
    end
```
