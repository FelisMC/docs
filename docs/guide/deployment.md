---
title: 安装与部署
---

# 安装与部署 {#安装与部署}

> [!CAUTION] 注意
> **当前仅提供开发快照，已撤下公开 Release。仅供开发者在隔离的测试环境中验证，不建议普通用户部署。**<br>
> **此项目仍处于早期开发阶段，您不该在任何生产环境使用该项目。若产生任何问题，贵用户的使用行为与 FelisMC 团队无任何民事刑事法律关系。**<br>

开发测试需在已准备好的 Linux 测试主机上显式选择 `dev` 通道（跟随 `main`，从源码构建）：

```bash
curl -fsSL https://raw.githubusercontent.com/FelisMC/Felis/main/deploy/bootstrap.sh | sudo FELIS_VERSION_BOOTSTRAP=dev bash
```

脚本将安装 K3s，在 K3s 中部署 PostgreSQL 与控制平面，随后启动设置向导。设置完成后，通过浏览器访问所配置的域名即可进入控制面板。

* **设置向导**：先完成面板访问方式与存储配置，再由主机管理员创建首位 Owner，终端将给出一次性网页设置链接（30 分钟内有效）。在浏览器中打开该链接、登记邮箱并创建通行密钥，即可进入面板，无需启动 Minecraft。角色关联可稍后在「账户」页完成：选择认证源，输入角色名或 UUID 并确认；普通玩家继续通过游戏绑定码验证身份。未完成网页登录或链接过期时，再次执行 `sudo felis setup` 将提供新链接；已设置登录凭证的账号不会被重置。登录服或大厅故障不影响面板初始化。「账户」页说明世界树（Yggdrasil）认证，并显示进服地址与登录服、大厅所需的 Java 版客户端版本；安装器将实际构建的版本写入 `[velocity].game_version`，使用自定义镜像时需自行填写，未配置时面板不推测版本。标准世界树接口可直接查询角色；`hasJoined` 地址不符合标准路径时，可通过 `[[auth_source]].api_url` 指定认证站的 API 根地址，游戏绑定码仍可作为替代方式。安装器仅在交互式终端中自动启动向导；输出重定向至日志或经由 cloud-init 安装时，请在安装结束后执行 `sudo felis setup`。设置 `FELIS_NO_SETUP=1` 时，安装器在输出摘要后直接结束。

* **认证源管理**：Owner 可在左侧导航「平台 → 认证源」中添加、编辑、排序和停用第三方 Yggdrasil 认证站，并测试认证接口。保存后立即用于下一次登录和角色查询，无需重启；面板配置优先于安装配置。已保存的永久标识不能改名或删除，以保留玩家 UUID 与账号绑定；不再使用的认证源可以停用。Mojang 始终优先验证。Nano 继续使用 TOML 配置（参见 [运维手册 §7](/operations/#_7-authentication-sources)）。

* **支持的系统**：CentOS Stream 9（aarch64）已在实机上验证；Ubuntu 24.04（x86_64）在每次推送时由 CI 验证开发构建的全新安装与重复安装（参见 [运维手册 §1](/operations/#_1-supported-hosts)）。

* **安装前检查**：安装器在修改主机之前检查内存、磁盘、端口、网段冲突、已有的 Kubernetes 及外网连通性。发现问题时一次性列出全部问题并退出，主机保持原状（检查项参见 [运维手册 §1](/operations/#_1-supported-hosts)）。

* **升级**：重新执行安装命令即可将 felis-api 升级至新版本；`felis setup` 仅使用本机已安装的二进制，无法用于升级。重新执行时沿用已安装的根域名，发布通道需重新指定：跟随 main 分支的主机须同时设置 `export FELIS_VERSION_BOOTSTRAP=dev`。早期版本安装在宿主机上的 PostgreSQL 会在重新执行时整库迁入 K3s，宿主机上的原实例停用并保留，以便回退（参见 [运维手册 §4](/operations/#_4-upgrading-the-pieces-around-felis)）。

<details>
<summary>安装来源与受限网络环境下的安装</summary>
<br>

以下说明发布机制；当前暂无公开 Release 附件，开发测试使用源码构建。

安装发布版时，二进制文件、全部镜像及 Velocity 插件均取自该版本由 CI 预构建的 release 附件，逐一校验 `SHA256SUMS` 后导入。主机无需安装 Docker、Gradle 或 Go，也无需访问 Docker Hub。若某个附件缺失或校验失败，仅该镜像回退为本机构建，并输出提示（参见 [故障排查 §15c](/operations/troubleshooting#_15c-the-installer-builds-on-the-host-although-it-installs-a-release)）。

也可将附件预先复制到主机，再通过 `FELIS_ARTIFACT_DIR=<绝对路径>` 安装，此时 Felis 自身的二进制、镜像与插件均从该目录读取。k3s 及其镜像、JRE、cloudflared、Velocity 与 Via 插件仍从 GitHub 和 PaperMC 下载；RHEL、Fedora、openSUSE Leap 等启用 SELinux 的主机还需从 rpm.rancher.io 安装 k3s-selinux；系统软件包来自发行版软件源。

因此，出站网络受限的主机须放行上述地址的 HTTPS 访问，或设置 `https_proxy`。preflight 会在修改主机之前逐一探测这些地址。目前暂不支持完全离线安装（地址清单参见 [运维手册 §1](/operations/#_1-supported-hosts)）。

</details>
