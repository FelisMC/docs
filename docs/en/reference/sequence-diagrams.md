---
title: Sequence diagrams
description: Sequence diagrams of three Felis flows — join and wake, claiming a server, and account linking.
---

# Sequence diagrams {#sequence-diagrams}

This page shows three Felis flows that span several components as sequence diagrams: waking a sleeping server when a player joins, claiming an ownerless server in the panel, and linking a game account to a panel account. The request and response schemas of each endpoint are in the [API reference](/en/reference/api). It is for developers who need the order of messages between components.

## Join and wake {#join-and-wake}

When a player pings the server list, the game proxy reads only its cache and never wakes a server. When the player joins, the game proxy finds the target server by hostname: a ready server is joined directly; otherwise the game proxy requests a wake, holds the player in the lobby, polls the server's status, transfers the player once the server is ready, and reports the join. Without a lobby, the player is disconnected with a reconnect-later message, and the wake request is still sent.

The diagram starts after the player has been authenticated; a player who has not linked an account passes through the login space first; see [Login space image](/en/reference/limbo#login-flow).

```mermaid
sequenceDiagram
    autonumber
    actor Player
    participant Velocity as Velocity proxy
    participant Registry as Velocity server registry
    participant API as felis-api internal face
    participant Cluster as MinecraftServer CRD/status
    participant Operator as felis operator
    participant Backend as Minecraft backend

    Player->>Velocity: server-list ping for subdomain.root-domain
    Velocity->>Registry: read cached lifecycle view
    Registry-->>Velocity: phase-aware MOTD
    Velocity-->>Player: ping response (read-only, no wake)

    Player->>Velocity: join subdomain.root-domain
    Velocity->>Registry: resolve host to server
    Registry-->>Velocity: ServerView(name, ready=false)

    alt backend already ready and registered
        Velocity-->>Player: initial server = backend
        Player->>Backend: connect
    else backend not ready and lobby configured
        Velocity-->>Player: initial server = lobby
        Velocity->>API: POST /api/v1/internal/servers/{name}/wake {mc_uuid}
        API->>Cluster: GetServer(name)
        API->>API: authorize autostartPolicy, cooldown, running cap
        API->>Cluster: SetDesiredState(name, Running)
        API-->>Velocity: 202 phase/ready
        Velocity->>Velocity: enqueue waiter
        Operator->>Cluster: reconcile DesiredState=Running
        Operator->>Backend: start pod/service
        Backend-->>Operator: RCON-ready / lifecycle ready
        Operator-->>Cluster: status.ready=true
        loop every waiting tick
            Velocity->>API: GET /api/v1/internal/servers/{name}/status
            API->>Cluster: GetServer(name)
            API-->>Velocity: ready flag
        end
        Velocity->>Registry: lookup registered backend
        Velocity-->>Player: "ready - moving you in"
        Velocity->>Player: Connect request to backend
        Player->>Backend: connect
        Velocity->>API: POST /api/v1/internal/servers/{name}/join-event {mc_uuid}
        API->>API: RecordJoin#59; refresh activity and allowlist UUID
        API-->>Velocity: 204
    else backend not ready and no lobby configured
        Velocity-->>Player: disconnect with reconnect-later message
        Velocity->>API: POST /api/v1/internal/servers/{name}/wake {mc_uuid}
        API->>Cluster: SetDesiredState(name, Running) if authorized
        API-->>Velocity: 202 or branchable error
    end
```

## Claim a server {#claim}

When a player claims an ownerless server in the panel, felis-api first confirms that the account has a linked game profile, then checks the four quotas (servers, CPU, memory, storage) against the server's actual size. The claim completes in a single database transaction: it takes a per-user lock, locks the server row, runs the quota check again, and writes the ownership only if the server is still ownerless. The check inside the transaction decides the outcome; the quota check before it only returns errors early.

```mermaid
sequenceDiagram
    autonumber
    actor Player
    participant Panel as Web panel
    participant API as felis-api external face
    participant Repo as Repo / Postgres
    participant Audit as Audit log

    Player->>Panel: click Claim on ownerless server
    Panel->>API: POST /api/v1/servers/{name}/claim
    API->>API: validate server name and principal
    API->>Repo: IsLinked(user_id)
    alt user has no verified account link
        Repo-->>API: false
        API-->>Panel: 412 not_linked
    else linked
        Repo-->>API: true
        API->>Repo: QuotaCheck(user_id, the server's real size)
        Note over API,Repo: all four caps: servers, CPU, memory, storage
        alt quota exhausted
            Repo-->>API: false
            API-->>Panel: 403 quota_exceeded
        else quota available
            Repo-->>API: true
            API->>Repo: ClaimServer(name, user_id)
            Note over Repo: ONE transaction: pg_advisory_xact_lock(user_id) serializes this user's claim lane#59; SELECT FROM servers WHERE name=$1 AND deleted_at IS NULL FOR UPDATE#59; re-run the four-dimension quota gate (authoritative — the pre-check above is a fast path)#59; then UPDATE servers SET owner_id=$2, claimed_at=now() WHERE name=$1 AND owner_id IS NULL AND deleted_at IS NULL
            alt server missing
                Repo-->>API: ErrNotFound
                API-->>Panel: 404 not_found
            else zero rows affected
                Repo-->>API: claimed=false
                API-->>Panel: 409 already_claimed
            else one row affected
                Repo-->>API: claimed=true
                API->>Audit: external claim audit
                API-->>Panel: 200 {"claimed":true}
            end
        end
    end
```

## Account linking {#account-link}

When a player runs `/link` in the game, the plugin reads the verified online-mode UUID and asks felis-api to mint a one-time 8-character bind code, which it shows in chat. When no authentication source is given, felis-api derives it from the UUID version: a version 3 UUID is treated as a third-party authentication source, anything else as Mojang. The player then submits the code in the panel; felis-api trims surrounding whitespace, converts it to upper case and checks it. A valid code writes the link and deletes the code; repeating the verification as the same user creates no duplicate, and the link of a disabled or deleted user is taken over. See [Player access](/en/guide/players#account-linking) for how players use it.

```mermaid
sequenceDiagram
    autonumber
    actor Player
    participant Game as Minecraft server or Velocity
    participant LinkClient as Felis LinkClient
    participant APIInternal as felis-api internal face
    participant Repo as Repo / Postgres
    participant Panel as Web panel
    participant APIExternal as felis-api external face

    Player->>Game: /link
    Game->>Game: read verified online-mode UUID
    Game->>LinkClient: requestCode(mc_uuid)
    LinkClient->>APIInternal: POST /api/v1/internal/account/link/code {mc_uuid}
    APIInternal->>APIInternal: validate UUID#59; derive auth_source from the UUID version nibble if absent (v3 → thirdparty, else mojang)#59; generate 8-symbol code
    APIInternal->>Repo: CreateLinkCode(code, mc_uuid, auth_source, expires_at)
    Repo-->>APIInternal: inserted account_link_codes row
    APIInternal-->>LinkClient: 201 {code, expires_at, panel_url?}
    LinkClient-->>Game: LinkCode
    Game-->>Player: show one-time code in chat

    Player->>Panel: open Account link flow
    Panel->>APIExternal: POST /api/v1/account/link/start
    APIExternal->>Repo: IsLinked(user_id)
    Repo-->>APIExternal: linked status
    APIExternal-->>Panel: status and "run /link" instructions

    Player->>Panel: submit code
    Panel->>APIExternal: POST /api/v1/account/link/verify {code}
    APIExternal->>APIExternal: trim and uppercase code
    APIExternal->>Repo: VerifyLinkCode(user_id, code, now)
    Repo->>Repo: SELECT mc_uuid, auth_source FROM account_link_codes WHERE code=$1 AND expires_at>$2 FOR UPDATE
    alt missing or expired code
        Repo-->>APIExternal: ErrLinkCodeInvalid
        APIExternal-->>Panel: 400 invalid_code
    else UUID linked to a different, live user
        Repo-->>APIExternal: ErrConflict
        APIExternal-->>Panel: 409 already_linked
    else valid code (re-verify by the same user is idempotent#59; a retired/soft-deleted owner's link is taken over)
        Repo->>Repo: INSERT account_links(user_id, mc_uuid, auth_source) ON CONFLICT (user_id, mc_uuid) DO UPDATE auth_source
        Repo->>Repo: DELETE account_link_codes WHERE code=$1
        Repo-->>APIExternal: mc_uuid, auth_source
        APIExternal->>Repo: Audit account.link
        APIExternal-->>Panel: 200 {linked:true, mc_uuid, auth_source}
    end
```
