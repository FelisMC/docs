---
layout: home
title: Felis
description: 基于 Kubernetes 的 Minecraft 服务器托管平台，单条命令完成部署，自动管理服务器的启停、备份与玩家接入。

hero:
  name: Felis
  text: Minecraft 服务器托管平台
  tagline: 基于 Kubernetes 与 k3s，单条命令完成部署，自动管理服务器的启停、备份与玩家接入。
  image:
    src: /felis-logo.svg
    alt: Felis
  actions:
    - theme: brand
      text: 安装与部署
      link: /guide/deployment
    - theme: alt
      text: GitHub
      link: https://github.com/FelisMC/Felis

features:
  - title: 按需启停
    details: 玩家连接时自动唤醒目标服务器，启动期间在大厅等待，就绪后自动传送；无人在线的服务器按设定时长自动休眠，释放内存。
    link: /guide/servers#power
    linkText: 启动与休眠
  - title: Web 控制面板
    details: 在浏览器中管理控制台、白名单、封禁、LuckPerms 权限、文件与计划任务；所有者在面板中完成平台设置与主机运维。
    link: /guide/servers
    linkText: 管理服务器
  - title: 备份与恢复
    details: 手动备份、不停服备份与每日恢复点，支持下载与导出世界；控制面数据库每日备份，可选异地副本与整机重建。
    link: /operations/backup#world-backups
    linkText: 备份与恢复
  - title: 玩家接入
    details: 统一经由 Velocity 游戏代理接入，支持 Mojang 正版与第三方 Yggdrasil 认证源，可配置登录空间、正式大厅与玩家进入策略。
    link: /guide/players
    linkText: 玩家接入
  - title: 安全
    details: 通行密钥与邮箱验证码登录，敏感操作要求身份验证并记入审计日志；游戏服务器网络隔离，模组包构建经 Trivy 安全扫描。
    link: /guide/administration#roles
    linkText: 平台管理
  - title: 多机部署（实验性）
    details: 主控节点统一调度多台工作节点，支持停服迁移、故障切换与主控高可用。
    link: /guide/distributed#overview
    linkText: 多机部署与高可用
---

## 概览 {#overview}

::: danger 仅提供开发快照
当前仅提供开发快照，公开 Release 已撤下。开发快照仅供开发者在隔离的测试主机上验证，请勿在生产环境中使用。本项目处于早期开发阶段，FelisMC 团队不对使用本项目产生的任何问题承担民事或刑事责任。
:::

Felis 是一个基于 Kubernetes 的 Minecraft 服务器托管平台。一条安装命令即可在一台 Linux 主机上部署 k3s、PostgreSQL、控制面与 Velocity 游戏代理；此后服务器的创建、启停、备份与玩家接入均在 Web 面板中完成。

## 工作方式 {#how-it-works}

- **服务器**：每台 Minecraft 服务器运行在 k3s 中，世界保存在独立的数据卷上。管理员创建服务器，用户关联游戏身份后认领并管理自己的服务器。
- **玩家接入**：玩家通过游戏代理进入，先在登录空间完成身份验证，再进入目标服务器；目标服务器休眠时，系统自动唤醒并让玩家在正式大厅等待。
- **数据保护**：世界备份、每日恢复点与控制面数据库备份默认启用，可将加密副本同步到 S3 兼容存储，在新主机上整机重建。
- **运维**：主机状态、告警、健康检查、诊断包与版本信息集中在面板「维护与备份」中，对应的 `felis` 命令可在主机上执行。

## 从这里开始 {#get-started}

- [环境要求](/guide/requirements#supported-hosts)：支持的系统、资源规划与网络要求。
- [安装与部署](/guide/deployment#install)：安装 Felis 并创建首位所有者。
- [管理服务器](/guide/servers#create-server)：创建、认领与维护服务器。
- [玩家接入](/guide/players#joining)：玩家如何进入服务器与关联账户。
- [运维概览](/operations/#components)：主机上运行的组件与日常运维。
- [故障排查](/operations/troubleshooting#first-steps)：按现象排查问题。

## 致谢 {#acknowledgements}

Felis 基于以下项目构建：[Kubernetes](https://kubernetes.io/)、[k3s](https://k3s.io/)、[Cloudflare Zero Trust](https://www.cloudflare.com/zero-trust/)、[PostgreSQL](https://www.postgresql.org/)、[React](https://react.dev/)、[Vite](https://vitejs.dev/)、[Tailwind CSS](https://tailwindcss.com/)、[Bubble Tea](https://github.com/charmbracelet/bubbletea)，并服务于 [Minecraft](https://www.minecraft.net/)。Felis 以 [AGPL-3.0-only](/reference/license#license) 协议开源。
