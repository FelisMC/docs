---
title: Felis-nano
description: Login control for a Velocity network you run yourself, with multiple authentication sources, accounts, a panel and in-game commands.
---

# Felis-nano {#nano}

Felis-nano is the minimal form of Felis and handles login control only. The operator keeps managing the servers, the routing and the proxy configuration; Felis-nano provides login through multiple authentication sources, the account system and the management panel. It suits an existing Velocity network that adopts Felis's authentication sources and account management without moving its servers.

## Scope {#scope}

| Area | Contents |
| --- | --- |
| Login | Mojang accounts and third-party Yggdrasil authentication sources side by side. Player UUIDs are derived as on the full platform; see [Authentication sources](/en/guide/players#auth-sources). |
| Accounts | Panel sign-in (passkey, email code, in-game approval), game account linking, session management and personal API tokens. |
| Administration | User management, authentication sources, the audit log, mail delivery, the default interface language and the panel's appearance. |
| In-game commands | `/link`, `/felis web` and `/felis web op approve <code>`. |

Felis-nano does not include server management, the lobby and login space, backups, image builds, account migration or k3s. In Felis-nano mode the proxy plugin does not take over routing and registers neither the server commands nor `/invite`.

## Components {#components}

| Component | Description |
| --- | --- |
| `felis-nano.service` | Runs as the system user `felis-nano`. The internal port (default `127.0.0.1:8081`, HTTP) serves the `hasJoined` endpoint and the proxy plugin's API; the panel port (default `8443`, HTTPS) serves the panel. |
| PostgreSQL | PostgreSQL 13 or later on the host. The database and the role are both `felis` and accept local connections only. |
| Proxy plugin | `felis-velocity.jar` on the operator's Velocity, running with `mode=nano`. |

## Requirements {#requirements}

- A Linux host with systemd, on the distributions the full installation supports; see [Requirements](/en/guide/requirements). Felis-nano has no memory minimum.
- Where the distribution ships a PostgreSQL older than 13 (for example Ubuntu 20.04), install 13 or later from the PostgreSQL project's repository first. On RHEL-family distributions the installer enables the newest PostgreSQL module stream.
- The Velocity proxy runs with `online-mode` enabled.
- The proxy's host can reach Felis-nano's internal port.

## Installation {#install}

Run the installer (development channel):

```bash
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo FELIS_VERSION_BOOTSTRAP=dev FELIS_INSTALL_MODE=nano bash
```

The installer performs these steps:

1. Installs PostgreSQL and creates the database and the role.
2. Writes `/etc/felis/felis.toml` and generates a self-signed certificate for the panel.
3. Runs the database migrations.
4. Prepares the proxy plugin and its settings in `/etc/felis/nano-proxy/`. The development channel builds the Felis binary and the plugin on the host; Docker is installed and started for the build and stopped afterwards, and the build uses about 1 GiB of additional memory.
5. Installs and starts `felis-nano.service` and opens the panel port.
6. Creates the Owner account and prints a one-time setup link.

The installer can be run again. A rerun keeps the generated secrets (`/etc/felis/nano.env`), the root domain and the port settings.

### Installer variables {#variables}

| Variable | Default | Description |
| --- | --- | --- |
| `FELIS_INSTALL_MODE` | Interactive prompt | Set to `nano`. |
| `FELIS_ROOT_DOMAIN` | `<host address>.nip.io`, or `<public address>.nip.io` on a cloud host ([Public address](/en/guide/requirements#public-address)) | Root domain. The player panel is `console.<root domain>` and the operator console `op.console.<root domain>`. |
| `FELIS_NANO_LISTEN` | `127.0.0.1:8081` | Listen address of the internal port. Set a private-network address when the proxy runs on another host. |
| `FELIS_NANO_PROXY_CIDR` | — | The proxy allowed to reach the internal port, as an address with a prefix length (for example `10.0.0.7/32`). |
| `FELIS_NANO_PANEL_PORT` | `8443` | HTTPS port of the panel. |
| `FELIS_NANO_PUBLIC_PORT` | The panel port | Port in the panel's public address. Set `443` when a reverse proxy serves the panel on port 443. |

::: warning
The `hasJoined` endpoint takes no token. Open the internal port to the proxy alone: when it listens on a non-loopback address, also set `FELIS_NANO_PROXY_CIDR`, and the host firewall opens the port to that source only.
:::

## Connecting the proxy {#proxy}

1. Copy `/etc/felis/nano-proxy/felis-velocity.jar` into Velocity's `plugins/` directory.
2. Copy `/etc/felis/nano-proxy/felis-link.properties` to `plugins/felis-link/felis-link.properties`. The file holds the service token; make it readable by the proxy's user only.
3. Add this JVM option to the proxy's start command, between `java` and `-jar`:

   ```text
   -Dmojang.sessionserver=http://127.0.0.1:8081/session/minecraft/hasJoined
   ```

   When the internal port is on another host, use the address of `FELIS_NANO_LISTEN`.
4. Make sure `velocity.toml` has `online-mode = true`, then restart the proxy.

Plugin settings:

| Setting | Description |
| --- | --- |
| `mode` | Always `nano`. The plugin registers the login commands only; servers and routing follow the proxy's own configuration. |
| `api-base-url` | Address of Felis-nano's internal port. |
| `service-token` | Token the plugin uses for the internal API; matches `FELIS_SERVICE_TOKEN` in `/etc/felis/nano.env`. |
| `panel-hostname`, `admin-hostname` | Panel addresses shown in in-game messages, with the port unless it is 443. |

Players of a third-party authentication source start their client through [authlib-injector](https://github.com/yushijinhun/authlib-injector), pointed at that source's site. Authentication sources are added on the panel's **Authentication sources** page; see [Authentication sources](/en/guide/players#auth-sources).

## Owner setup {#owner}

The installer ends with a setup link that is valid for 30 minutes. When `/etc/felis/felis.toml` has an `[smtp]` section, the setup page sends a code to the email address the Owner enters, and verifying it completes setup; a passkey can be added later on the **Account** page. Without mail delivery, the setup page records an email address and then creates a passkey. Browsers create passkeys only under a trusted certificate, so use one of the following:

- Add an `[smtp]` section to `/etc/felis/felis.toml`, run `sudo systemctl restart felis-nano`, then open the setup page again and complete setup with an email code.
- Write a trusted certificate and key to `/etc/felis/panel-tls.crt` and `/etc/felis/panel-tls.key`, then run `sudo systemctl restart felis-nano`. The certificate must cover both panel hostnames.
- Serve the panel through a reverse proxy on port 443; see [Reverse proxy](#reverse-proxy).

When the link has expired, run the following command for a new one. Append `-public-port <port>` when the public port is not 8443:

```bash
sudo felis nano setup
```

Once the Owner has completed setup, the command prints only the sign-in address.

## Reverse proxy {#reverse-proxy}

1. Configure the reverse proxy with the upstream `https://127.0.0.1:8443`. That port uses a self-signed certificate, so the reverse proxy skips upstream TLS verification; it also forwards the original `Host` header. A Caddy example:

   ```text
   op.console.mc.example.com, console.mc.example.com {
       reverse_proxy https://127.0.0.1:8443 {
           transport http { tls_insecure_skip_verify }
           header_up Host {host}
       }
   }
   ```

2. Add to `/etc/felis/felis.toml`:

   ```toml
   [auth]
   client_ip_header = "X-Forwarded-For"
   ```

3. Run the installer again with `FELIS_NANO_PUBLIC_PORT=443`. The installer updates the addresses in panel links and the setup link, regenerates `/etc/felis/nano-proxy/felis-link.properties`, and closes the panel port in the host firewall so that only the reverse proxy on this host reaches it.
4. Copy the new `felis-link.properties` to the proxy, then restart the proxy.

When the reverse proxy runs on another host, allow that host to reach the panel port in the firewall.

## Configuration file {#configuration}

`/etc/felis/felis.toml` has mode `0640` and group `felis-nano`. After editing it, run `sudo systemctl restart felis-nano`.

| Section | Description |
| --- | --- |
| `[server]` | `root_domain`: the root domain. |
| `[database]` | `url`: the PostgreSQL connection URL, written by the installer. |
| `[auth]` | Optional. `panel_hostname`, `admin_hostname` and `client_ip_header`, as on the full platform; see the [Configuration reference](/en/reference/configuration). |
| `[smtp]` | Optional. Mail delivery can also be configured in the panel under **Platform settings → Mail delivery**. |
| `[[auth_source]]` | Optional. The initial list of authentication sources; once the Owner saves a list in the panel, the panel's list applies. |

## Upgrading {#upgrade}

Run the installer again to upgrade Felis-nano. The installer runs the database migrations before starting the new version, and backs up the database first when migrations are pending. `felis update` does not apply to Felis-nano.

Earlier versions of Felis-nano used no database and read only the `[[auth_source]]` entries in `felis.toml`. On such a host, a rerun of the installer keeps the existing authentication sources and adds the `[server]` and `[database]` sections. The sources' `tag` values stay the same, and so do the players' UUIDs.

## Uninstalling {#uninstall}

Felis-nano uses the same uninstall script as the full platform; see [Uninstall and reinstall](/en/operations/uninstall). By default `/etc/felis` and the database are kept; `--purge` also drops the database and the role.

Uninstall Felis-nano before installing the full platform on the same host; the installer stops when it finds Felis-nano.
