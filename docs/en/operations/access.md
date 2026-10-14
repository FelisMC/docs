---
title: Access and domains
description: How the panel is reached, the panel TLS certificate, changing the root domain, rotating credentials and emergency access.
---

# Access and domains {#access}

This page is for operators. It explains how users reach the Felis panel, how to switch between direct access, your own reverse proxy and Cloudflare Tunnel, the TLS certificate the panel uses, how to change the root domain, how to rotate the credentials Felis generates, and how to restore access when no Owner can sign in.

## Access methods {#access-methods}

The panel is served on two hostnames, both derived from the root domain:

| Hostname | Default | Used by |
| --- | --- | --- |
| Panel hostname | `console.<root domain>` | The panel for players and regular users |
| Admin console hostname | `op.console.<root domain>` | The operator console for Owners and Admins |

The root domain defaults to `<host IP>.nip.io`, which resolves to the host without any DNS setup. Both hostnames are stored under `[auth]` in `/etc/felis/felis.host.toml` (`panel_hostname`, `admin_hostname`). The panel and the API are served on the host's HTTPS NodePort, port 30443 by default (`FELIS_PANEL_NODEPORT`).

The operator console is recognized by the request's hostname. A bare IP address counts as the operator console only when the root domain embeds it (such as `<IP>.nip.io` or `<IP>.sslip.io`) or `admin_hostname` is set to that IP; any other address, including `127.0.0.1` through an SSH tunnel, is served as the player panel, and admin features answer 403. Passkeys are bound to the panel hostname, so they cannot be used when the panel is opened by IP address.

Felis supports three access methods:

| Access method | TLS | What Felis changes | Visitor address taken from |
| --- | --- | --- | --- |
| Direct access | The panel's self-signed certificate; browsers warn on the first visit | Records both hostnames and restarts felis-api | The TCP peer |
| Own reverse proxy | Terminated by your reverse proxy, such as Caddy, nginx or Traefik | Records both hostnames, sets `client_ip_header` to `X-Forwarded-For`, and restarts felis-api | The rightmost entry of `X-Forwarded-For` |
| Cloudflare Tunnel | Terminated at Cloudflare's edge | Creates a tunnel named `felis` and routes the hostnames, puts Cloudflare Access in front of the operator console, writes `/etc/felis/cloudflared.yml`, installs `cloudflared-felis.service`, and closes the panel port to the public once the connector is confirmed serving | `CF-Connecting-IP` |

The visitor address keys the per-client rate limit on the sign-in endpoints. During installation, the access step of `felis setup` ("How should people reach the panel?") picks one of the methods; skipping it with Esc chooses direct access. You can change the method later in the panel or in `felis setup`.

::: info
Direct access and your own reverse proxy protect the operator console with the Owner's sign-in alone (a passkey or an email code). Cloudflare Tunnel adds a Cloudflare Access identity check in front of it. Whichever method you use, felis-api requires its own sign-in session, and accounts and roles always come from the Felis database.
:::

### Changing the access method in the panel {#change-access-method}

1. Open **Platform settings → Access and security** and find the **Access and domain** card.
2. Under **Access method**, select **Direct access**, **Own reverse proxy** or **Cloudflare Tunnel**.
3. Enter the **Panel hostname** and the **Admin console hostname**.
4. For Cloudflare Tunnel, also enter:
   - **Who may sign in**: an email address, or `@` followed by an email domain.
   - **Cloudflare account ID**.
   - **Cloudflare API token**: it needs permission to edit Access applications and DNS. It is used for this change only and is not stored.
5. Select **Apply access method**, confirm the dialog, and confirm your identity.
6. If the host is not yet authorized in your Cloudflare account, the task waits at the **Awaiting Cloudflare authorization** stage. Select **Open Cloudflare authorization** and authorize the host; the task then continues on its own.

::: warning
Changing the access method restarts the panel, and the panel may become reachable at a different address. Passkeys are bound to the panel hostname: after a hostname change, users sign in with an email code and register their passkeys again. Switching from Cloudflare Tunnel to direct access or your own reverse proxy stops and disables the tunnel connector `cloudflared-felis.service` and reopens the panel port.
:::

### Own reverse proxy {#reverse-proxy}

With your own reverse proxy, Felis only records the hostnames; you configure the proxy yourself:

- The upstream is `https://127.0.0.1:30443`. That port uses the self-signed certificate, so the proxy must skip upstream TLS verification.
- Forward the original `Host` header; Felis uses it to tell the panel from the operator console.
- The proxy must append the visitor's address to `X-Forwarded-For`; Caddy, nginx and Traefik do so by default.
- Firewall the panel port so that only the reverse proxy reaches it. Otherwise a client connecting to the port directly can write any address it likes into `X-Forwarded-For`.

A Caddy example, with one block for the operator console hostname and one for the panel hostname:

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

### Cloudflare Tunnel and Access {#cloudflare}

With Cloudflare Tunnel the host connects out to Cloudflare, and the panel port does not need to be open to the public:

- The host creates the tunnel, routes the panel and operator console hostnames, and creates an Access application for the operator console that admits only the email address or email domain given in **Who may sign in**.
- Access is enforced at Cloudflare's edge only. felis-api still requires its own sign-in, and since every request arrives through cloudflared, felis-api trusts the visitor address in `CF-Connecting-IP`.
- Once the connector is confirmed serving, Felis restricts the panel port to loopback in the nftables table `felis_edge`. When the connector cannot be confirmed, the port is left open and the task reports `edge origin NOT fenced: ...`; apply the method again once the tunnel is healthy.
- Retrying after a failure is safe: a retry reuses the tunnel, DNS records and Access application created so far instead of making duplicates.

To check the port restriction, and to reopen the panel port from the host if the tunnel fails:

```bash
sudo nft list table inet felis_edge     # show the restriction
sudo nft delete table inet felis_edge   # reopen the panel port
```

The tunnel, its DNS records and the Access application live in your Cloudflare account and remain after Felis is uninstalled; see [Cleaning up Cloudflare](/en/operations/uninstall#cloudflare-cleanup).

## Panel TLS certificate {#tls}

On the first installation the installer generates a self-signed certificate `/etc/felis/panel-tls.crt` with the key `/etc/felis/panel-tls.key`: RSA 2048, valid for 825 days, naming the operator console hostname, the panel hostname, `localhost`, `127.0.0.1` and the host IP. Every installer run applies this pair as the Secret `felis-api-tls`, which felis-api loads when it starts. When the files already exist, the installer does not generate new ones.

- With your own reverse proxy or Cloudflare Tunnel, public TLS terminates at the proxy or at Cloudflare; the self-signed certificate only secures the hop to felis-api.
- `felis domain set` reissues the installer's self-signed certificate for the new names and keeps the old one; a certificate from another issuer is left as it is, see [Changing the root domain](#change-domain).
- k3s's own certificates are separate from the panel certificate; for their renewal, see [k3s certificates](/en/operations/troubleshooting#k3s-certificates).

To use your own certificate, or to regenerate the self-signed one before it expires:

1. Write the PEM certificate and key to `/etc/felis/panel-tls.crt` and `/etc/felis/panel-tls.key` (key mode 0600). To have the installer generate a new self-signed pair instead, delete both files.
2. Re-run the installer, which updates the Secret `felis-api-tls`.
3. Restart felis-api so that it loads the new certificate:

   ```bash
   sudo k3s kubectl -n felis rollout restart deployment/felis-api
   ```

::: warning
While felis-api restarts, the panel and sign-in are briefly unavailable; players in game are not affected.
:::

## Changing the root domain {#change-domain}

The root domain is written into several places: the host and pod configuration files, the panel certificate, the Secret `felis-config` in both namespaces, the Secret `felis-api-tls`, the game proxy's `felis-link.properties`, the login space MinecraftServer's environment (`FELIS_ROOT_DOMAIN`, `FELIS_PANEL_HOSTNAME`), and the Cloudflare tunnel and DNS. `felis domain set` updates each place on the host in turn and then restarts what reads them; `felis domain check` reports each place on its own line. The installer keeps the installed domain: a re-run with a different `FELIS_ROOT_DOMAIN` stops and names this command.

Prerequisites:

- DNS records for `<root domain>`, `console.<root domain>`, `op.console.<root domain>` and `*.<root domain>` point to this host. The wildcard does not cover the third-level name `op.console.<root domain>`; give it a record of its own.
- A mail relay is configured, so that users whose passkeys stop working can sign in with an email code; see [Mail relay](/en/operations/monitoring#mail-relay).

Steps:

1. Review the plan. The command lists every place, its new value and the impact, and changes nothing:

   ```bash
   sudo felis domain set new.example.net
   ```

2. Apply the change:

   ```bash
   sudo felis domain set -yes new.example.net
   ```

3. Check the result. The command exits 1 while any place is behind:

   ```bash
   sudo felis domain check
   ```

In the panel, the same operations are under **Platform settings → Access and security** → **Access and domain** → **Root domain**: **Check current domain** and **Change domain**.

::: warning
Changing the root domain restarts the game proxy, which disconnects every player online. Servers are reached as `<name>.<new root domain>`, and the old addresses stop routing. Session cookies belong to the old hostnames, so every user signs in again; when the panel hostname changes, passkeys registered for the old hostname stop working, and the plan counts the passkeys affected.
:::

`felis domain set` keeps the following:

- A panel or operator console hostname set by hand in `[auth]` (any value other than `console.<root domain>` or `op.console.<root domain>`). To move it too, edit `/etc/felis/felis.host.toml` first, then run `set`.
- The other `[auth]` keys (`access_jwt_aud`, `client_ip_header`) and every other line of both configuration files. When a file cannot be changed line for line (a multi-line value, a quoted or dotted key), the command refuses and names what to fix.
- An operator's own certificate. The installer's self-signed certificate is reissued for the new names, and the old pair is saved as `*.pre-domain-<time>`; a certificate from another issuer that does not cover the new names stops the command before anything changes. Replace it with one that does, then run the command again.

What needs handling separately:

- **Cloudflare**: the tunnel routes and the Access application still carry the old names. After the change, re-run the Cloudflare step of `sudo felis setup`, or apply the Cloudflare Tunnel access method again in the panel; `felis domain check` compares the tunnel's hostnames with the new ones.
- **A game proxy on another host**: a remote `felis-link.properties` is outside this host's reach; `set` prints the three keys to put there.
- **The game proxy fingerprint**: the first installer re-run after the change restarts the proxy once more.

`set` is safe to repeat: a second run changes only what is still behind, and the same holds after an interruption. When the game proxy started before `felis-link.properties` last changed, `check` reports the proxy as behind; `sudo systemctl restart felis-velocity` clears it.

## Rotating credentials {#rotate-credentials}

`felis rotate-token` replaces one credential the installer generated and restarts what uses it. Rotate after a suspected leak, or when staff with host access leave.

```bash
sudo felis rotate-token velocity        # print what would be written and what it interrupts
sudo felis rotate-token -yes velocity   # rotate
```

Every rotation writes the new value to `/etc/felis/secrets.env` first. If a later step fails, re-running the installer puts the new value everywhere. The old value stops working as felis-api (or the registry) restarts; a caller still presenting it is turned away until it has the new one.

| Kind | Panel name | Replaces | Interrupts |
| --- | --- | --- | --- |
| `ops` | Operations token | The token `felis backup-now` uses, Secret `felis-ops-token` | felis-api restarts |
| `velocity` | Proxy token | The game proxy's token: Secret `felis-service-token` and `service-token` in the host proxy's `felis-link.properties` | felis-api restarts, pausing the panel, sign-in and the proxy's calls for a few seconds; the proxy re-reads its file and keeps its players |
| `limbo` | Login space token | The login space's token `felis-limbo-token` and its copy in the `minecraft` namespace | felis-api restarts, then the login space, disconnecting the players in it |
| `build` | Build token | The build jobs' token `felis-build-token` and its copy in the build namespace | felis-api restarts; a build fetching its context at that moment fails and can be started again |
| `registry` | Registry credentials | The registry's platform, build and prune write tokens: Secret `felis-registry-auth` and the build jobs' `felis-registry-push` | The registry restarts (a push at that moment fails, a pull retries), then felis-api |
| `forwarding` | Forwarding secret | The Velocity forwarding secret: `/opt/felis/velocity/forwarding.secret` and the Secret `felis-forwarding-secret` in both namespaces | Every running server saves its world and restarts, and the game proxy restarts: every player online is disconnected |
| `db` | Database password | The database role's password: the role in felis-postgres, `[database] url` in `felis.host.toml` and `felis.pod.toml`, and the Secret `felis-config` in both namespaces | felis-api restarts; a backup, restore or file job that connects in those seconds fails and can be run again |

In the panel, the same operation is under **Platform settings → Access and security** → **Credential rotation**: select **Rotate** next to the credential, confirm the impact, and confirm your identity.

::: warning
Rotating `forwarding` restarts every running server and the game proxy, disconnecting every player online. Do it at a quiet hour.
:::

Notes on individual kinds:

- **velocity**: the rotation waits for the proxy's log line `Felis: service-token reloaded from … (fingerprint <12 hex digits>)`. A proxy that has not logged it within 60 seconds of felis-api's restart (a plugin from an earlier release) is restarted, which disconnects everyone online. The file keeps its modification time, so `felis domain check` does not report the proxy as behind. A proxy on another host is left alone: set `service-token` in its `felis-link.properties` to the value in the Secret `felis/felis-service-token`, and it takes it within a few seconds.
- **forwarding**: a server whose world a backup, restore or file change holds is left running and named in the plan and the output; players cannot join it until it restarts, so stop and start it from the panel once that work finishes. The next installer run restarts the proxy once more. A proxy on another host needs the value of the Secret `felis/felis-forwarding-secret` in its forwarding secret file, and a restart.
- **db**: the password reaches PostgreSQL as a SCRAM-SHA-256 verifier, never as text a failed statement could log. The configuration copies change only after a connection with the new password succeeds; when it fails, the command stops and says so, and an installer re-run sets the password from `secrets.env` in the role and every copy. An external database the installer does not run (`[database] deployment` unset) is refused: change its password where it runs, then in each copy's `[database] url`. `felis.pod.toml` must be a file of its own, since the pods reach the database at another address.

## Emergency access {#break-glass}

`sudo felis breakGlass` opens a root-only, full-screen console that works directly on the database and depends on neither the panel nor web sign-in. It is for local recovery when no Owner can sign in; use it only in an emergency.

The console offers these operations:

- **Provision or reset the Owner account**: creates or resets the Owner account and turns local session sign-in on.
- **Add an Operator account**: adds another admin account.
- **Halt a running server**: stops one running server.
- **Back up a world now (Sync)**: backs up one world now.

When no staff account exists yet, the console goes straight to creating the first Owner. When one exists, the console first asks which Admin or Owner is breaking the glass and mails a six-digit code to that account's verified address through the same relay as sign-in codes (the relay saved in the panel when the database answers, otherwise `[smtp]` in `felis.toml`). The code is valid for 10 minutes and five wrong entries end it; it is sent even while k3s is down, and it does not count against the API's mail budget. The mail names the host and the OS user that asked.

Only the right code records the run as a `recovery` attributed to that account. Every other outcome (no such account, no verified address, no usable relay, a refused mail, an expired code or five wrong entries, or skipping at the code prompt) requires typing `OVERRIDE` to continue, and the audit record states why. Esc on either screen starts over with a new code.

After the Owner is created or reset, the console prints a one-time setup URL on exit; open it in a browser to verify the email address and register a passkey. The operator console address is printed after it.

The audit records are `break_glass.recovery`, `break_glass.root_override` or `break_glass.operator_create` (a new admin), with the source `break-glass`. Only a run a code proved has `verified` set to true, together with `verified_by: email_otp` and `code_sent_to`; an `OVERRIDE` record carries `otp_skipped` (`unknown_admin`, `no_verified_email`, `no_relay`, `send_failed`, `code_expired`, `code_rejected`, `operator_skipped`) and, where something failed, `otp_skip_detail`. Root can edit these records afterwards, so they record attribution without proving it. To list recent emergency runs:

```bash
sudo k3s kubectl -n felis exec deploy/felis-postgres -c postgres -- psql -U postgres felis -c "
  SELECT created_at, action, actor, payload->>'verified' AS verified,
         payload->>'otp_skipped' AS skipped, payload->>'otp_skip_detail' AS detail
  FROM audit_logs WHERE source = 'break-glass' ORDER BY created_at DESC LIMIT 20;"
```

For other sign-in problems, such as refused sign-ins and locked email codes, see [Sign-in problems](/en/operations/troubleshooting#sign-in-problems).
