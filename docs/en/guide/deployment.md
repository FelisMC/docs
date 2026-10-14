---
title: Installation and deployment
---

# Installation and deployment {#安装与部署}

> [!CAUTION]
> **Only development snapshots are available; public releases have been withdrawn. These builds are for developers testing in isolated environments and are not recommended for general deployment.**<br>
> **This project is still in early development. Do not use it in production. The FelisMC team accepts no civil or criminal liability for problems arising from its use.**

For development testing on a prepared Linux test host, explicitly select the `dev` channel, which follows `main` and builds from source:

```bash
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo FELIS_VERSION_BOOTSTRAP=dev bash
```

The script installs K3s, deploys PostgreSQL and the control plane inside it, and launches a setup wizard. When setup completes, open the configured domain in a browser to reach the control panel.

* **Setup wizard**: The wizard configures panel access and storage first. The host administrator then initializes the first Owner and receives a one-time browser setup link (valid for 30 minutes). Opening the link, registering an email address and creating a passkey gives access to the panel; Minecraft is not required. A game role can be linked later on the Account page by selecting an authentication source, entering a role name or UUID, and confirming it. Players continue to verify their identity with the in-game bind code. If the browser setup is unfinished or the link has expired, running `sudo felis setup` again issues a new link; accounts that already have a login factor are never reset. Failures of the login server or the lobby do not block panel initialization. The Account page explains Yggdrasil authentication and shows the join address and the Java Edition client version that the login server and the lobby require. The installer records the version it built in `[velocity].game_version`; custom images must set it themselves, otherwise the panel reports the version as unknown. Standard Yggdrasil endpoints support role lookup directly; a source with a nonstandard `hasJoined` path can set `[[auth_source]].api_url` to its API root, and linking with a game code remains available as a fallback. The installer launches the wizard automatically only on an interactive terminal; when output is redirected to a log or the install runs under cloud-init, run `sudo felis setup` after it finishes. Setting `FELIS_NO_SETUP=1` makes the installer end at its summary.

* **Authentication sources**: Under Platform → Authentication sources in the sidebar, the Owner adds, edits, reorders and disables third-party Yggdrasil providers and tests their authentication endpoints. A saved change applies to the next login and role lookup without a restart, and the panel configuration takes precedence over the install-time configuration. A saved permanent tag cannot be renamed or removed, so that player UUIDs and account links are preserved; a provider that is no longer used can be disabled. Mojang is always verified first. Nano continues to use its TOML configuration (see [operations §7](/en/operations/#_7-authentication-sources)).

* **Supported hosts**: CentOS Stream 9 (aarch64) is verified on physical hardware; CI tests fresh installation and repeat installation of development builds on Ubuntu 24.04 (x86_64) on every push (see [operations §1](/en/operations/#_1-supported-hosts)).

* **Preflight checks**: Before modifying the host, the installer checks memory, disk, ports, network range conflicts, existing Kubernetes installations and outbound connectivity. If any check fails, it lists all problems and exits, leaving the host unchanged (see [operations §1](/en/operations/#_1-supported-hosts) for the checks).

* **Upgrading**: Rerun the install command to upgrade felis-api to a newer version; `felis setup` only uses the binary already installed on the host and cannot upgrade it. A rerun keeps the installed root domain, and the release channel must be specified again: hosts that follow the main branch must also set `export FELIS_VERSION_BOOTSTRAP=dev`. A PostgreSQL instance installed on the host by an earlier release is migrated into K3s during the rerun; the original instance on the host is stopped and retained for rollback (see [operations §4](/en/operations/#_4-upgrading-the-pieces-around-felis)).

<details>
<summary>Installation sources and restricted networks</summary>
<br>

The following describes the release mechanism. No public release assets are currently available; development testing uses source builds.

A release installation takes the binary, all images and the Velocity plugin from the release assets prebuilt in CI, verifying each against `SHA256SUMS` before import. The host requires no Docker, Gradle or Go, and no access to Docker Hub. If an asset is missing or fails verification, only that image falls back to a local build, and the installer prints a notice (see [troubleshooting §15c](/en/operations/troubleshooting#_15c-the-installer-builds-on-the-host-although-it-installs-a-release)).

The assets can also be copied to the host in advance and installed with `FELIS_ARTIFACT_DIR=<absolute path>`; the Felis binary, images and plugin are then read from that directory. k3s and its images, the JRE, cloudflared, Velocity and the Via plugins are still downloaded from GitHub and PaperMC; hosts with SELinux enabled, such as RHEL, Fedora and openSUSE Leap, additionally install k3s-selinux from rpm.rancher.io; system packages come from the distribution's repositories.

A host with restricted outbound access must therefore allow HTTPS to these addresses or set `https_proxy`. Preflight probes each address before changing the host. Fully offline installation is not yet supported (see [operations §1](/en/operations/#_1-supported-hosts) for the address list).

</details>
