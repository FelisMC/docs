---
title: Felis-nano
description: 为自行运营的 Velocity 网络提供登录控制：多认证源登录、账号体系、面板与游戏内命令。
---

# Felis-nano {#nano}

Felis-nano 是 Felis 的极简形态，只负责登录控制。服务器、路由与代理配置仍由运营者自行管理，Felis-nano 提供多认证源登录、账号体系和管理面板。适用于已有 Velocity 网络、希望使用 Felis 的认证源与账号管理而不迁移服务器的场景。

## 功能范围 {#scope}

| 类别 | 内容 |
| --- | --- |
| 登录 | Mojang 正版账号与第三方 Yggdrasil 认证源同时可用。玩家 UUID 的计算方式与完整平台一致，详见[认证源](/guide/players#auth-sources)。 |
| 账号 | 面板登录（Passkey、邮件验证码、游戏内批准）、游戏账号绑定、会话管理与个人 API 令牌。 |
| 管理 | 用户管理、认证源、审计日志、邮件发送、默认界面语言与面板外观。 |
| 游戏内命令 | `/link`、`/felis web` 与 `/felis web op approve <code>`。 |

Felis-nano 不包含服务器管理、大厅与登录空间、备份、镜像构建、账户迁移和 k3s。代理插件在 Felis-nano 模式下不接管路由，不注册服务器相关命令与 `/invite`。

## 组成 {#components}

| 组件 | 说明 |
| --- | --- |
| `felis-nano.service` | 以系统用户 `felis-nano` 运行。内部端口（默认 `127.0.0.1:8081`，HTTP）提供 `hasJoined` 接口与代理插件接口；面板端口（默认 `8443`，HTTPS）提供面板。 |
| PostgreSQL | 主机上的 PostgreSQL 13 或更高版本。数据库与角色均为 `felis`，只接受本机连接。 |
| 代理插件 | 运营者 Velocity 上的 `felis-velocity.jar`，以 `mode=nano` 运行。 |

## 环境要求 {#requirements}

- 使用 systemd 的 Linux 主机，发行版范围与完整安装相同，见[环境要求](/guide/requirements)。
- 发行版提供的 PostgreSQL 低于 13 时（例如 Ubuntu 20.04），须先从 PostgreSQL 官方软件源安装 13 或更高版本。RHEL 系发行版由安装器启用最新的 PostgreSQL 模块流。
- Velocity 代理开启 `online-mode`。
- 代理所在主机可以访问 Felis-nano 的内部端口。

## 安装 {#install}

执行安装命令（开发版通道）：

```bash
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo FELIS_VERSION_BOOTSTRAP=dev FELIS_INSTALL_MODE=nano bash
```

安装器依次完成以下工作：

1. 安装 PostgreSQL，创建数据库与角色。
2. 写入 `/etc/felis/felis.toml`，生成面板的自签名证书。
3. 执行数据库迁移。
4. 准备代理插件与插件配置，放在 `/etc/felis/nano-proxy/`。开发版通道在本机构建 Felis 二进制与插件，构建期间临时安装并启动 Docker，构建结束后停止；构建期间内存占用约增加 1 GiB。
5. 安装并启动 `felis-nano.service`，开放面板端口。
6. 创建所有者账号，输出一次性初始化链接。

安装命令可以重复执行。重复执行沿用已生成的密钥（`/etc/felis/nano.env`）、根域名与端口设置。

### 安装变量 {#variables}

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FELIS_INSTALL_MODE` | 交互式询问 | 设为 `nano`。 |
| `FELIS_ROOT_DOMAIN` | `<主机地址>.nip.io`，云主机为 `<公网地址>.nip.io`（见[公网地址](/guide/requirements#public-address)） | 根域名。玩家面板为 `console.<根域名>`，管理控制台为 `op.console.<根域名>`。 |
| `FELIS_NANO_LISTEN` | `127.0.0.1:8081` | 内部端口的监听地址。代理在其他主机上时，设为内网地址。 |
| `FELIS_NANO_PROXY_CIDR` | — | 允许访问内部端口的代理地址，带前缀长度（例如 `10.0.0.7/32`）。 |
| `FELIS_NANO_PANEL_PORT` | `8443` | 面板的 HTTPS 端口。 |
| `FELIS_NANO_PUBLIC_PORT` | 与面板端口相同 | 面板对外地址中的端口。通过反向代理在 443 端口提供面板时设为 `443`。 |

::: warning 注意
`hasJoined` 接口不使用令牌。内部端口只应对代理开放：监听非回环地址时，须同时设置 `FELIS_NANO_PROXY_CIDR`，主机防火墙只对该来源开放端口。
:::

## 连接代理 {#proxy}

1. 将 `/etc/felis/nano-proxy/felis-velocity.jar` 复制到 Velocity 的 `plugins/` 目录。
2. 将 `/etc/felis/nano-proxy/felis-link.properties` 复制为 `plugins/felis-link/felis-link.properties`。该文件包含服务令牌，仅允许代理的运行用户读取。
3. 在代理的启动参数中加入以下 JVM 参数，位置在 `java` 与 `-jar` 之间：

   ```text
   -Dmojang.sessionserver=http://127.0.0.1:8081/session/minecraft/hasJoined
   ```

   内部端口不在本机时，将地址替换为 `FELIS_NANO_LISTEN` 的地址。
4. 确认 `velocity.toml` 中 `online-mode = true`，然后重启代理。

插件配置项：

| 配置项 | 说明 |
| --- | --- |
| `mode` | 固定为 `nano`。插件只注册登录相关命令，服务器与路由由代理自身配置决定。 |
| `api-base-url` | Felis-nano 内部端口的地址。 |
| `service-token` | 插件调用内部接口所用的令牌，与 `/etc/felis/nano.env` 中的 `FELIS_SERVICE_TOKEN` 一致。 |
| `panel-hostname`、`admin-hostname` | 游戏内消息中显示的面板地址，端口不是 443 时包含端口。 |

第三方认证源的玩家通过 [authlib-injector](https://github.com/yushijinhun/authlib-injector) 启动客户端，并指向所用的认证源站点。认证源在面板的「认证源」页面添加，见[认证源](/guide/players#auth-sources)。

## 所有者初始化 {#owner}

安装结束时输出初始化链接，有效期 30 分钟。初始化页面先记录邮箱，然后创建 Passkey。浏览器只在受信任的证书下创建 Passkey，因此须采用以下任一方式：

- 将受信任的证书和私钥写入 `/etc/felis/panel-tls.crt` 与 `/etc/felis/panel-tls.key`，然后执行 `sudo systemctl restart felis-nano`。证书须覆盖两个面板域名。
- 通过反向代理在 443 端口提供面板，见[反向代理](#reverse-proxy)。

链接过期后，执行以下命令获取新链接。对外端口不是 8443 时，追加 `-public-port <端口>`：

```bash
sudo felis nano setup
```

所有者完成初始化后，该命令只输出登录地址。

## 反向代理 {#reverse-proxy}

1. 配置反向代理，上游地址为 `https://127.0.0.1:8443`。该端口使用自签名证书，反向代理须跳过上游 TLS 校验，并转发原始的 `Host` 请求头。Caddy 配置示例：

   ```text
   op.console.mc.example.com, console.mc.example.com {
       reverse_proxy https://127.0.0.1:8443 {
           transport http { tls_insecure_skip_verify }
           header_up Host {host}
       }
   }
   ```

2. 在 `/etc/felis/felis.toml` 中加入：

   ```toml
   [auth]
   client_ip_header = "X-Forwarded-For"
   ```

3. 以 `FELIS_NANO_PUBLIC_PORT=443` 重新执行安装命令。安装器更新面板链接与初始化链接中的地址，重新生成 `/etc/felis/nano-proxy/felis-link.properties`，并在主机防火墙中关闭面板端口，使其只能由本机的反向代理访问。
4. 将新的 `felis-link.properties` 复制到代理，然后重启代理。

反向代理位于其他主机时，须在防火墙中自行允许该主机访问面板端口。

## 配置文件 {#configuration}

`/etc/felis/felis.toml` 的权限为 `0640`，属组为 `felis-nano`。修改后执行 `sudo systemctl restart felis-nano`。

| 段落 | 说明 |
| --- | --- |
| `[server]` | `root_domain`：根域名。 |
| `[database]` | `url`：PostgreSQL 连接地址，由安装器写入。 |
| `[auth]` | 可选。`panel_hostname`、`admin_hostname` 与 `client_ip_header`，含义与完整平台相同，见[配置参考](/reference/configuration)。 |
| `[smtp]` | 可选。邮件发送也可在面板的「平台设置 → 邮件服务」中配置。 |
| `[[auth_source]]` | 可选。认证源的初始列表；所有者在面板中保存列表后，以面板中的列表为准。 |

## 升级 {#upgrade}

重新执行安装命令即可升级 Felis-nano。安装器在启动新版本前执行数据库迁移，存在待执行的迁移时先备份数据库。`felis update` 不适用于 Felis-nano。

早期版本的 Felis-nano 不使用数据库，只读取 `felis.toml` 中的 `[[auth_source]]`。在这类主机上重新执行安装命令时，安装器保留原有的认证源配置，补充 `[server]` 与 `[database]` 段落。认证源的 `tag` 保持不变，玩家 UUID 也保持不变。

## 卸载 {#uninstall}

Felis-nano 使用与完整平台相同的卸载脚本，见[卸载与重装](/operations/uninstall)。默认保留 `/etc/felis` 与数据库；使用 `--purge` 时同时删除数据库与角色。

在运行 Felis-nano 的主机上安装完整平台前，须先卸载 Felis-nano；安装器检测到 Felis-nano 时停止安装。
