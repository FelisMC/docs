---
title: Installation and deployment
---

# Installation and deployment {#安装与部署}

> [!CAUTION]
> **This project is still in early development. Do not use it in production. The FelisMC team accepts no civil or criminal liability for problems arising from its use.**

On a prepared Linux host, run:

```bash
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo bash
```

The script installs K3s, deploys PostgreSQL and the control plane inside it, and launches a setup wizard. When setup completes, open the configured domain in a browser to reach the control panel.

* **Setup wizard**: The wizard first binds the platform Owner: join the address it shows in Minecraft Java Edition, then enter the 8-character link code that the login server displays (valid for 10 minutes). The step can be skipped and completed later by running `sudo felis setup` again; until an Owner is bound, nobody can sign in to the control panel, and the sign-in page states this together with the binding steps and the address to join. The installer launches the wizard automatically only on an interactive terminal; when output is redirected to a log or the install runs under cloud-init, run `sudo felis setup` after it finishes. Setting `FELIS_NO_SETUP=1` makes the installer end at its summary.

* **Supported hosts**: CentOS Stream 9 (aarch64) is verified on physical hardware; Ubuntu 24.04 (x86_64) is tested in CI on every push with a fresh install, a rerun, an upgrade and the install command above (see [operations §1](/en/operations/#_1-supported-hosts)).

* **Preflight checks**: Before modifying the host, the installer checks memory, disk, ports, network range conflicts, existing Kubernetes installations and outbound connectivity. If any check fails, it lists all problems and exits, leaving the host unchanged (see [operations §1](/en/operations/#_1-supported-hosts) for the checks).

* **Upgrading**: Rerun the install command to upgrade felis-api to a newer version; `felis setup` only uses the binary already installed on the host and cannot upgrade it. A rerun keeps the installed root domain, and the release channel must be specified again: hosts that follow the main branch must also set `export FELIS_VERSION_BOOTSTRAP=dev`. A PostgreSQL instance installed on the host by an earlier release is migrated into K3s during the rerun; the original instance on the host is stopped and retained for rollback (see [operations §4](/en/operations/#_4-upgrading-the-pieces-around-felis)).

<details>
<summary>Installation sources and restricted networks</summary>
<br>

A release installation takes the binary, all images and the Velocity plugin from the release assets prebuilt in CI, verifying each against `SHA256SUMS` before import. The host requires no Docker, Gradle or Go, and no access to Docker Hub. If an asset is missing or fails verification, only that image falls back to a local build, and the installer prints a notice (see [troubleshooting §15c](/en/operations/troubleshooting#_15c-the-installer-builds-on-the-host-although-it-installs-a-release)).

The assets can also be copied to the host in advance and installed with `FELIS_ARTIFACT_DIR=<absolute path>`; the Felis binary, images and plugin are then read from that directory. k3s and its images, the JRE, cloudflared, Velocity and the Via plugins are still downloaded from GitHub and PaperMC; hosts with SELinux enabled, such as RHEL, Fedora and openSUSE Leap, additionally install k3s-selinux from rpm.rancher.io; system packages come from the distribution's repositories.

A host with restricted outbound access must therefore allow HTTPS to these addresses or set `https_proxy`. Preflight probes each address before changing the host. Fully offline installation is not yet supported (see [operations §1](/en/operations/#_1-supported-hosts) for the address list).

</details>

---

Source: [README_EN.md](https://github.com/FelisMC/Felis/blob/main/README_EN.md).
