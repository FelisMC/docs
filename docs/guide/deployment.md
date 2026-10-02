---
title: 安装与部署
---

# 安装与部署 {#安装与部署}

> [!CAUTION] 注意
> **此项目仍处于早期开发阶段，您不该在任何生产环境使用该项目。若产生任何问题，贵用户的使用行为与 FelisMC 团队无任何民事刑事法律关系。**<br>

在已准备好的 Linux 主机上执行：

```bash
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo bash
```

脚本将安装 K3s，在 K3s 中部署 PostgreSQL 与控制平面，随后启动设置向导。设置完成后，通过浏览器访问所配置的域名即可进入控制面板。

* **设置向导**：向导首先绑定平台所有者：以 Minecraft Java 版加入向导所示的地址，登录服务器会给出 8 位绑定码（10 分钟内有效），将其输入向导即可。该步骤可以跳过，之后再次执行 `sudo felis setup` 补做；绑定所有者之前，任何人均无法登录控制面板，登录页届时会说明原因并列出绑定步骤及连接地址。安装器仅在交互式终端中自动启动向导；输出重定向至日志或经由 cloud-init 安装时，请在安装结束后执行 `sudo felis setup`。设置 `FELIS_NO_SETUP=1` 时，安装器在输出摘要后直接结束。

* **支持的系统**：CentOS Stream 9（aarch64）已在实机上验证；Ubuntu 24.04（x86_64）在每次推送时由 CI 执行全新安装、重复安装、升级及上述安装命令（参见 [运维手册 §1](/operations/#_1-supported-hosts)）。

* **安装前检查**：安装器在修改主机之前检查内存、磁盘、端口、网段冲突、已有的 Kubernetes 及外网连通性。发现问题时一次性列出全部问题并退出，主机保持原状（检查项参见 [运维手册 §1](/operations/#_1-supported-hosts)）。

* **升级**：重新执行安装命令即可将 felis-api 升级至新版本；`felis setup` 仅使用本机已安装的二进制，无法用于升级。重新执行时沿用已安装的根域名，发布通道需重新指定：跟随 main 分支的主机须同时设置 `export FELIS_VERSION_BOOTSTRAP=dev`。早期版本安装在宿主机上的 PostgreSQL 会在重新执行时整库迁入 K3s，宿主机上的原实例停用并保留，以便回退（参见 [运维手册 §4](/operations/#_4-upgrading-the-pieces-around-felis)）。

<details>
<summary>安装来源与受限网络环境下的安装</summary>
<br>

安装发布版时，二进制文件、全部镜像及 Velocity 插件均取自该版本由 CI 预构建的 release 附件，逐一校验 `SHA256SUMS` 后导入。主机无需安装 Docker、Gradle 或 Go，也无需访问 Docker Hub。若某个附件缺失或校验失败，仅该镜像回退为本机构建，并输出提示（参见 [故障排查 §15c](/operations/troubleshooting#_15c-the-installer-builds-on-the-host-although-it-installs-a-release)）。

也可将附件预先复制到主机，再通过 `FELIS_ARTIFACT_DIR=<绝对路径>` 安装，此时 Felis 自身的二进制、镜像与插件均从该目录读取。k3s 及其镜像、JRE、cloudflared、Velocity 与 Via 插件仍从 GitHub 和 PaperMC 下载；RHEL、Fedora、openSUSE Leap 等启用 SELinux 的主机还需从 rpm.rancher.io 安装 k3s-selinux；系统软件包来自发行版软件源。

因此，出站网络受限的主机须放行上述地址的 HTTPS 访问，或设置 `https_proxy`。preflight 会在修改主机之前逐一探测这些地址。目前暂不支持完全离线安装（地址清单参见 [运维手册 §1](/operations/#_1-supported-hosts)）。

</details>

---

原文：[README.md](https://github.com/FelisMC/Felis/blob/main/README.md)。
