---
title: 访问与域名
description: 面板的访问方式、面板 TLS 证书、更换根域名、轮换凭据和应急访问。
---

# 访问与域名 {#access}

本页面向运维人员，说明用户如何访问 Felis 面板、如何在直接访问、自有反向代理和 Cloudflare Tunnel 之间切换、面板使用的 TLS 证书、如何更换根域名、如何轮换系统生成的凭据，以及在没有所有者能够登录时如何恢复访问。

## 访问方式 {#access-methods}

面板以两个域名提供服务，二者都由根域名派生：

| 域名 | 默认值 | 用途 |
| --- | --- | --- |
| 面板域名 | `console.<根域名>` | 玩家与普通用户使用的面板 |
| 管理控制台域名 | `op.console.<根域名>` | 所有者和管理员使用的管理控制台 |

根域名默认为 `<主机 IP>.nip.io`，无需配置 DNS 即可解析到主机。两个域名保存在 `/etc/felis/felis.host.toml` 的 `[auth]` 中（`panel_hostname`、`admin_hostname`）。面板和 API 在主机的 HTTPS NodePort 上提供服务，默认端口为 30443（`FELIS_PANEL_NODEPORT`）。

管理控制台按请求的主机名识别。裸 IP 地址仅在根域名内含该地址（例如 `<IP>.nip.io` 或 `<IP>.sslip.io`）或 `admin_hostname` 设为该 IP 时才算作管理控制台；其他地址（包括通过 SSH 隧道访问的 `127.0.0.1`）一律按玩家面板处理，管理功能返回 403。Passkey 与面板域名绑定，通过 IP 地址访问时无法使用 Passkey。

Felis 支持三种访问方式：

| 访问方式 | TLS | Felis 所做的修改 | 访客地址来源 |
| --- | --- | --- | --- |
| 直接访问 | 面板的自签证书，浏览器首次访问时警告 | 记录两个域名并重启 felis-api | TCP 连接的对端地址 |
| 自有反向代理 | 由 Caddy、nginx、Traefik 等反向代理终止 | 记录两个域名，将 `client_ip_header` 设为 `X-Forwarded-For`，并重启 felis-api | `X-Forwarded-For` 最右侧的一项 |
| Cloudflare Tunnel | 由 Cloudflare 边缘终止 | 创建名为 `felis` 的隧道并配置域名路由，为管理控制台启用 Cloudflare Access，写入 `/etc/felis/cloudflared.yml`，安装 `cloudflared-felis.service`，确认连接器工作后对公网关闭面板端口 | `CF-Connecting-IP` |

访客地址用于登录接口的按客户端限流。安装时，`felis setup` 的访问方式步骤（「How should people reach the panel?」）选择其中一种；按 Esc 跳过即为直接访问。之后可在面板或 `felis setup` 中随时更改。

::: info 说明
直接访问和自有反向代理仅以所有者的登录（Passkey 或邮件验证码）保护管理控制台。Cloudflare Tunnel 在此之前再增加一层 Cloudflare Access 身份检查。无论使用哪种方式，felis-api 都要求自己的登录会话，账号和角色始终以 Felis 数据库为准。
:::

### 在面板中更改访问方式 {#change-access-method}

1. 打开「平台设置 → 访问与安全」，找到「访问方式与域名」卡片。
2. 在「访问方式」中选择「直接访问」「自有反向代理」或「Cloudflare Tunnel」。
3. 填写「面板域名」和「管理控制台域名」。
4. 选择 Cloudflare Tunnel 时，另外填写：
   - 「允许登录的身份」：邮箱地址，或以 `@` 开头的邮箱域名。
   - 「Cloudflare 账户 ID」。
   - 「Cloudflare API 令牌」：须具备编辑 Access 应用与 DNS 的权限，仅用于本次变更，不会保存。
5. 选择「应用访问方式」，确认对话框，并完成身份验证。
6. 主机尚未在 Cloudflare 账户中授权时，任务停在「等待 Cloudflare 授权」阶段。选择「打开 Cloudflare 授权页」完成授权，任务随后自动继续。

::: warning 注意
更改访问方式会重启面板，访问地址可能随之变化。Passkey 与面板域名绑定，更改域名后用户需用邮件验证码登录并重新注册 Passkey。从 Cloudflare Tunnel 切换到直接访问或自有反向代理时，主机停止并禁用隧道连接器 `cloudflared-felis.service`，并重新开放面板端口。
:::

### 自有反向代理 {#reverse-proxy}

选择自有反向代理后，Felis 只记录域名，反向代理由运维人员自行配置：

- 上游地址为 `https://127.0.0.1:30443`。该端口使用自签证书，反向代理须跳过上游 TLS 校验。
- 转发原始的 `Host` 请求头，Felis 据此区分面板与管理控制台。
- 反向代理须将访客地址追加到 `X-Forwarded-For`；Caddy、nginx 和 Traefik 默认如此。
- 用防火墙限制面板端口，只允许反向代理访问。否则直接访问端口的客户端可以伪造 `X-Forwarded-For` 中的地址。

Caddy 配置示例（管理控制台域名与面板域名各一段）：

```text
op.console.example.com {
    reverse_proxy https://127.0.0.1:30443 {
        transport http { tls_insecure_skip_verify }
        header_up Host {host}
    }
}

console.example.com {
    reverse_proxy https://127.0.0.1:30443 {
        transport http { tls_insecure_skip_verify }
        header_up Host {host}
    }
}
```

### Cloudflare Tunnel 与 Access {#cloudflare}

Cloudflare Tunnel 方式由主机主动连接 Cloudflare，不需要对公网开放面板端口：

- 主机创建隧道，为面板域名和管理控制台域名配置路由，并为管理控制台创建 Access 应用，只允许「允许登录的身份」中的邮箱或邮箱域名通过。
- Access 只在 Cloudflare 边缘执行。felis-api 仍要求自己的登录，且所有请求都经由 cloudflared 到达，因此 felis-api 信任 `CF-Connecting-IP` 中的访客地址。
- 连接器确认工作后，Felis 在 nftables 表 `felis_edge` 中将面板端口限制为仅回环地址可访问。连接器未确认工作时不会关闭端口，任务报告 `edge origin NOT fenced: ...`，面板端口保持可访问；隧道恢复后重新应用即可。
- 失败后重试是安全的：重试会复用已创建的隧道、DNS 记录和 Access 应用，不会重复创建。

检查端口限制，以及在隧道失效时从主机重新开放面板端口：

```bash
sudo nft list table inet felis_edge     # 查看限制规则
sudo nft delete table inet felis_edge   # 重新开放面板端口
```

隧道、DNS 记录和 Access 应用保存在 Cloudflare 账户中，卸载 Felis 后仍然存在，清理方法见[清理 Cloudflare 资源](/operations/uninstall#cloudflare-cleanup)。

## 面板 TLS 证书 {#tls}

安装器在首次安装时生成自签证书 `/etc/felis/panel-tls.crt` 和私钥 `/etc/felis/panel-tls.key`：RSA 2048 位，有效期 825 天，包含管理控制台域名、面板域名、`localhost`、`127.0.0.1` 和主机 IP。每次运行安装器都会将这对文件应用为 Secret `felis-api-tls`，由 felis-api 在启动时加载。文件已存在时，安装器不会重新生成。

- 使用自有反向代理或 Cloudflare Tunnel 时，公网 TLS 由反向代理或 Cloudflare 终止，自签证书只用于其与 felis-api 之间的连接。
- `felis domain set` 会为新域名重新签发安装器的自签证书，并保留旧证书；其他颁发者签发的证书保持不变，见[更换根域名](#change-domain)。
- k3s 自身的证书与面板证书无关，其续期见 [k3s 证书](/operations/troubleshooting#k3s-certificates)。

改用自有证书，或在自签证书到期前重新生成：

1. 将 PEM 格式的证书和私钥写入 `/etc/felis/panel-tls.crt` 和 `/etc/felis/panel-tls.key`（私钥权限 0600）。删除这两个文件则由安装器重新生成自签证书。
2. 重新运行安装器，使其更新 Secret `felis-api-tls`。
3. 重启 felis-api，使其加载新证书：

   ```bash
   sudo k3s kubectl -n felis rollout restart deployment/felis-api
   ```

::: warning 注意
重启 felis-api 时面板和登录短暂不可用，游戏中的玩家不受影响。
:::

## 更换根域名 {#change-domain}

根域名写入多个位置：主机与 Pod 的配置文件、面板证书、两个命名空间中的 Secret `felis-config`、Secret `felis-api-tls`、游戏代理的 `felis-link.properties`、登录空间 MinecraftServer 的环境变量（`FELIS_ROOT_DOMAIN`、`FELIS_PANEL_HOSTNAME`），以及 Cloudflare 隧道和 DNS。`felis domain set` 依次更新主机上的各个位置，再重启读取它们的组件；`felis domain check` 逐项报告每个位置的状态。安装器保留已安装的域名，以不同的 `FELIS_ROOT_DOMAIN` 重新运行时会停止并提示使用此命令。

前提条件：

- `<根域名>`、`console.<根域名>`、`op.console.<根域名>` 和 `*.<根域名>` 的 DNS 记录已指向本主机。通配符不覆盖三级域名 `op.console.<根域名>`，须为它单独建立记录。
- 已配置邮件中继，以便用户在 Passkey 失效后用邮件验证码登录，见[邮件中继](/operations/monitoring#mail-relay)。

操作步骤：

1. 查看计划。命令列出每个位置、更新后的值和影响，不做修改：

   ```bash
   sudo felis domain set new.example.net
   ```

2. 执行更换：

   ```bash
   sudo felis domain set -yes new.example.net
   ```

3. 检查结果。仍有位置落后时退出码为 1：

   ```bash
   sudo felis domain check
   ```

面板中的对应操作位于「平台设置 → 访问与安全」→「访问方式与域名」→「根域名」：「检查当前域名」和「更换域名」。

::: warning 注意
更换根域名会重启游戏代理，断开所有在线玩家；服务器地址改为 `<名称>.<新根域名>`，旧地址不再路由。会话 Cookie 属于旧域名，所有用户须重新登录；面板域名变化时，为旧域名注册的 Passkey 失效，计划会列出受影响的 Passkey 数量。
:::

`felis domain set` 保留以下内容：

- `[auth]` 中手动设置的面板域名和管理控制台域名（即不是 `console.<根域名>`、`op.console.<根域名>` 的值）。需要随之迁移时，先手动修改 `/etc/felis/felis.host.toml`，再运行 `set`。
- 其他 `[auth]` 键（`access_jwt_aud`、`client_ip_header`）以及两个配置文件中的其他所有行。文件无法逐行修改时（多行值、带引号或点号的键），命令拒绝执行并指出需要修复的内容。
- 运维人员自备的证书。安装器的自签证书会为新域名重新签发，旧证书和私钥保存为 `*.pre-domain-<时间>`；其他颁发者的证书若不覆盖新域名，命令在任何修改前停止，换成覆盖新域名的证书后再运行。

需要另行处理的内容：

- **Cloudflare**：隧道路由和 Access 应用仍使用旧域名。更换后重新运行 `sudo felis setup` 的 Cloudflare 步骤，或在面板中重新应用 Cloudflare Tunnel 访问方式；`felis domain check` 会将隧道的域名与新域名比对。
- **其他主机上的游戏代理**：远程的 `felis-link.properties` 不在本机处理范围内，`set` 会打印需要写入的三个键。
- **游戏代理指纹**：更换后首次重新运行安装器时，代理会再重启一次。

`set` 可以安全地重复执行：再次运行只修改仍然落后的位置，中断后重新运行也是如此。若游戏代理的启动时间早于 `felis-link.properties` 的最近修改时间，`check` 会将代理报告为落后；执行 `sudo systemctl restart felis-velocity` 可清除该提示。

## 轮换凭据 {#rotate-credentials}

`felis rotate-token` 替换一项由安装器生成的凭据，并重启使用它的组件。在怀疑凭据泄露，或具备主机权限的人员离开时轮换。

```bash
sudo felis rotate-token velocity        # 只打印将写入的内容和中断影响
sudo felis rotate-token -yes velocity   # 执行轮换
```

每次轮换都先将新值写入 `/etc/felis/secrets.env`。之后的步骤失败时，重新运行安装器即可将新值同步到所有位置。旧值在 felis-api（或镜像仓库）重启后失效，仍使用旧值的调用方会被拒绝，直到获得新值。

| 类型 | 面板名称 | 替换的内容 | 中断影响 |
| --- | --- | --- | --- |
| `ops` | 运维令牌 | `felis backup-now` 使用的令牌，Secret `felis-ops-token` | felis-api 重启 |
| `velocity` | 代理令牌 | 游戏代理的令牌：Secret `felis-service-token` 和主机代理 `felis-link.properties` 中的 `service-token` | felis-api 重启，面板、登录和代理的请求暂停数秒；代理重新读取文件，玩家保持连接 |
| `limbo` | 登录空间令牌 | 登录空间的令牌 `felis-limbo-token` 及其在 `minecraft` 命名空间中的副本 | felis-api 重启，随后登录空间重启，其中的玩家被断开 |
| `build` | 构建令牌 | 构建任务的令牌 `felis-build-token` 及其在构建命名空间中的副本 | felis-api 重启；此时正在获取构建上下文的构建失败，可重新发起 |
| `registry` | 镜像仓库凭据 | 镜像仓库的 platform、build 和 prune 写入令牌：Secret `felis-registry-auth` 和构建任务的 `felis-registry-push` | 镜像仓库重启（此时的推送失败，拉取会重试），随后 felis-api 重启 |
| `forwarding` | 转发密钥 | Velocity 转发密钥：`/opt/felis/velocity/forwarding.secret` 和两个命名空间中的 Secret `felis-forwarding-secret` | 所有运行中的服务器保存世界并重启，游戏代理重启，所有在线玩家被断开 |
| `db` | 数据库密码 | 数据库角色的密码：felis-postgres 中的角色、`felis.host.toml` 和 `felis.pod.toml` 中的 `[database] url`，以及两个命名空间中的 Secret `felis-config` | felis-api 重启；此时连接数据库的备份、恢复或文件任务失败，可重新执行 |

面板中的对应操作位于「平台设置 → 访问与安全」→「凭据轮换」：在要替换的凭据旁选择「轮换」，确认中断影响并完成身份验证。

::: warning 注意
轮换 `forwarding` 会重启所有运行中的服务器和游戏代理，断开所有在线玩家。在玩家较少时执行。
:::

各类型的补充说明：

- **velocity**：轮换等待代理日志 `Felis: service-token reloaded from … (fingerprint <12 hex digits>)`。felis-api 重启后 60 秒内未出现该日志时（较早版本的插件），代理被重启，所有在线玩家断开。文件保留原修改时间，因此 `felis domain check` 不会将代理报告为落后。其他主机上的代理不受处理：将其 `felis-link.properties` 中的 `service-token` 设为 Secret `felis/felis-service-token` 中的值，数秒内生效。
- **forwarding**：世界正被备份、恢复或文件修改占用的服务器保持运行，并在计划和输出中列出；在其重启前玩家无法加入，相关操作完成后从面板停止并重新启动它。下次运行安装器时代理会再重启一次。其他主机上的代理须将 Secret `felis/felis-forwarding-secret` 中的值写入其转发密钥文件并重启。
- **db**：新密码以 SCRAM-SHA-256 校验值传给 PostgreSQL，不会以明文出现在失败语句的日志中。只有用新密码连接成功后才更新配置副本；连接失败时命令停止并说明原因，重新运行安装器可按 `secrets.env` 统一角色和所有副本。安装器未托管的外部数据库（未设置 `[database] deployment`）会被拒绝：在数据库所在处修改密码，再更新各副本的 `[database] url`。`felis.pod.toml` 必须是独立文件，因为 Pod 通过不同的地址访问数据库。

## 应急访问 {#break-glass}

`sudo felis breakGlass` 打开一个仅限 root 的全屏控制台，直接操作数据库，不依赖面板和 Web 登录。它用于所有者无法登录时的本地恢复，仅在紧急情况下使用。

控制台提供以下操作：

- 「Provision or reset the Owner account」：创建或重置所有者账号，并开启本地会话登录。
- 「Add an Operator account」：新增一个管理员账号。
- 「Halt a running server」：停止一台运行中的服务器。
- 「Back up a world now (Sync)」：立即备份一个世界。

尚无工作人员账号时，控制台直接引导创建首位所有者。已有工作人员账号时，控制台先询问由哪位管理员或所有者执行，并通过与登录验证码相同的中继（数据库可访问时使用面板中保存的中继，否则使用 `felis.toml` 的 `[smtp]`）向其已验证邮箱发送 6 位验证码。验证码 10 分钟内有效，输错 5 次作废；k3s 停止时也能发送，且不计入 API 的邮件额度。邮件注明发起请求的主机和系统用户。

只有输入正确的验证码，本次操作才以 `recovery` 记入该账号名下。其他情况（账号不存在、没有已验证邮箱、没有可用中继、发信失败、验证码过期或输错 5 次，或在验证码提示处主动跳过）都须输入 `OVERRIDE` 才能继续，审计记录会注明原因。在任一界面按 Esc 会重新开始并发送新的验证码。

创建或重置所有者后，控制台退出时打印一次性设置链接，在浏览器中打开即可验证邮箱并注册 Passkey，随后打印管理控制台地址。

审计记录为 `break_glass.recovery`、`break_glass.root_override` 或 `break_glass.operator_create`（新增管理员），来源为 `break-glass`。只有经验证码证明的操作 `verified` 为 true，并带有 `verified_by: email_otp` 和 `code_sent_to`；`OVERRIDE` 的记录带有 `otp_skipped`（`unknown_admin`、`no_verified_email`、`no_relay`、`send_failed`、`code_expired`、`code_rejected`、`operator_skipped`），失败时另有 `otp_skip_detail`。root 可以事后修改这些记录，因此它们只用于归属，不构成证明。查询最近的应急操作：

```bash
sudo k3s kubectl -n felis exec deploy/felis-postgres -c postgres -- psql -U postgres felis -c "
  SELECT created_at, action, actor, payload->>'verified' AS verified,
         payload->>'otp_skipped' AS skipped, payload->>'otp_skip_detail' AS detail
  FROM audit_logs WHERE source = 'break-glass' ORDER BY created_at DESC LIMIT 20;"
```

登录失败、验证码锁定等其他登录问题见[登录问题](/operations/troubleshooting#sign-in-problems)。
