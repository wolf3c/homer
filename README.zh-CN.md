<p align="center">
  <img src="assets/readme/home-hero.png" alt="荷马手持书与剑，协调 AI 军团" width="720" />
</p>

<h1 align="center">荷马 Homer — 你的 AI 工作助手</h1>

<p align="center">
  <strong>你交办目标，荷马协调 AI 军团，审核并交付成果。</strong>
</p>

<p align="center">
  <a href="https://github.com/wolf3c/homer/releases/latest"><img src="https://img.shields.io/github/v/release/wolf3c/homer?label=release&amp;color=c45a3c" alt="最新发布版本" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="荷马自有代码许可：Apache 2.0" /></a>
  <a href="#下载荷马"><img src="https://img.shields.io/badge/desktop-macOS%20%7C%20Windows-586069" alt="桌面下载：macOS 与 Windows" /></a>
</p>

<p align="center">
  <a href="https://super-tree.com/homer">官网</a> ·
  <a href="#安装与开始使用">下载与开始</a> ·
  <a href="docs/public/using-homer.md">使用指南</a> ·
  <a href="docs/public/getting-started.md">源码运行</a> ·
  <a href="docs/architecture/README.md">架构文档</a>
</p>

<p align="center">
  <a href="README.md">English</a> | <strong>简体中文</strong>
</p>

---

荷马（Homer）是一款开源 AI 工作助手。你只需与荷马对话，随时交办多项工作；荷马调度 AI 军团分工协作、审核成果，让你的目标持续向前。

## 荷马能做什么

- **一个对话，管理所有工作**：不用在多个 Agent 会话之间来回切换、梳理关系；你只需与荷马沟通，它负责协调各项工作。
- **新想法随时说，后续工作有人跟进**：前面的任务还在进行时，也可以告诉荷马下一步想做什么。荷马会记录并协调安排，不必打断当前工作或等它完成后再开新会话。
- **过程有人协调，成果有人审核**：荷马先处理 AI 助手的问题，审核成果，发现问题就安排返工；需要你提供信息或作决定时再询问你。
- **离开电脑，工作也能继续**：手机配对电脑主端后，可以查看进展、补充想法、回应问题和接收成果。也可以接入 Telegram 机器人、个人微信或钉钉机器人，在私聊中交办任务、追问进展，并订阅事项更新及附件。

## 荷马如何工作

![荷马协调任务、助手协作、审核与交付的动画示意](assets/readme/homer-workflow.gif)

## 安装与开始使用

### 下载荷马

桌面正式版 v0.1.7（build 292）已发布，请选择适合你电脑的安装包：

- [macOS · Apple 芯片](https://github.com/wolf3c/homer/releases/download/v0.1.7/Homer-mac-arm64.zip)，需要 macOS 27 或更高版本。
- [macOS · Intel](https://github.com/wolf3c/homer/releases/download/v0.1.7/Homer-mac-x64.zip)，需要 macOS 14 或更高版本。
- [Windows · x64](https://github.com/wolf3c/homer/releases/download/v0.1.7/Homer-windows-x64.exe)，需要 Windows 11。

Mac 版已签名和公证，解压后将 Homer 移入「应用程序」。Windows 安装包未签名，运行安装器手动安装，自动更新关闭。Linux 桌面安装包尚未提供。

Intel Mac 和 Windows x64 的目标系统安装与运行验收尚待完成。完整更新说明及校验文件见 [v0.1.7 Release](https://github.com/wolf3c/homer/releases/tag/v0.1.7)。

### 开始使用

1. 打开荷马，按提示连接可用的模型服务。
2. 告诉荷马你想完成什么，并提供相关材料。
3. 随时补充想法、查看进展和接收成果。

模型服务的使用资格、额度和费用以实际发布信息及服务规则为准。详见[使用指南](docs/public/using-homer.md)。

### 在手机上继续工作

安装手机 App 后，在电脑端荷马的「设置 → 移动设备」中扫码配对。手机 App 需要连接可用的电脑主端。

- Android：下载入口待补充
- iPhone / iPad：下载入口待发布

开发者也可以[从源码构建和运行](docs/public/getting-started.md)。当前为开发预览，存在[已知限制](docs/public/getting-started.md#当前源码状态)。

## 模型与费用

荷马自有代码免费开源。桌面端代码已支持两种模型来源：

- **[荷马会员服务](https://super-tree.com/homer#homer-pricing-title)**：计划按需购买模型额度，费用根据实际用量计算。
- **自己的 ChatGPT 套餐**：通过 Codex 接入，使用资格和额度遵循对应套餐规则。

模型使用可能产生费用；一个任务中的助手协作、审核和修改都会消耗用量。两种方式的实际可用性、接入资格、购买流程和计费规则须在正式发布前确认。详见[费用与数据](docs/public/data-and-costs.md)。

## 相关链接与许可

- [网站](https://super-tree.com/homer)
- [使用指南](docs/public/using-homer.md) · [源码运行指南](docs/public/getting-started.md)
- [反馈问题](https://github.com/wolf3c/homer/issues)：请勿提供凭据或私密材料。

荷马自有代码采用 [Apache-2.0](LICENSE)。[第三方许可](THIRD_PARTY_NOTICES.md)单独适用；仓库尚未记录 Agentation 额外授权确认。
