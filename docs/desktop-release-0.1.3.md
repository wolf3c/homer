# Homer 桌面 v0.1.3 构建记录

2026-11-06，build `288`。三平台安装包及两份 Mac 更新清单已通过云端完整下载和 SHA-256 校验。 [构建运行](https://github.com/wolf3c/homer/actions/runs/42067445363) · [正式 Release](https://github.com/wolf3c/homer/releases/tag/v0.1.3)

- 公开源码及标签 `v0.1.3` 指向 `e7e6b6bfdf6701e21faebcfea6d320d90212a95b`，本地版本提交为 `c4dc1ba269105e9cbcf558b7839e4724bae246f8`。
- 运行 `42067445363`，attempt `1`，`kind=desktop`、`target=desktop-three`、`upload_release_draft=true`。三平台及 `verify-draft` 均通过。
- 草稿共 10 个附件。三平台清单、合并 `release-manifest.json`、`SHA256SUMS`、安装包及更新清单来自同一源码和 attempt。草稿附件的大小与摘要已和合并清单核对。

| 平台 | 安装包 | 字节数 | SHA-256 | 签名和系统 |
| --- | --- | ---: | --- | --- |
| Apple 芯片 Mac | `Homer-mac-arm64.zip` | 322069899 | `210f662bbcc377f9ee7f73be1bc27e93e29f413511a5ef3a23a6cca77621892b` | Developer ID，已公证并附票据，macOS 27.0 |
| Intel Mac | `Homer-mac-x64.zip` | 342783790 | `88837b0dff51fcc6ebc27b60e9f1a1fb43c5be323784c6da27a76b09db30173b` | Developer ID，已公证并附票据，macOS 14.0 |
| Windows x64 | `Homer-windows-x64.exe` | 254292523 | `4142ca13bd0c88afc7ed2013c8a7f79f10cba3e85d442b789a62c4df04aaca5e` | Windows 11，未签名 NSIS，自动更新禁用 |

## Apple 芯片版隔离验证

- 本机从草稿下载原 ZIP、合并清单与摘要文件，并下载同轮原始构建回执。原 ZIP 的大小和摘要与两份清单一致。
- 包内 `desktop-manifest.json`、`Info.plist` 和构建回执对应 0.1.3、build 288。包内清单与原始回执的 `websiteOrigin` 和 `gatewayOrigin` 分别为 `https://super-tree.com` 和 `https://models.super-tree.com`。
- macOS 27.0 Apple 芯片主机上，`codesign` 严格校验、`stapler validate` 及 Gatekeeper 均通过，Gatekeeper 识别为 `Notarized Developer ID`。
- 正式包在独立资料目录通过 3 项现有 Electron 合成测试，覆盖会话退出重启、未连接账号的只读状态和完整进程崩溃恢复。

## 旧资料拒绝路径

- 从公开 Release 下载并校验了 v0.1.1 Apple 芯片正式包（build 269）。旧包在独立资料目录生成一条合成会话和一份已交付的 Worker 文件。
- 以 v0.1.3 正式包的运行时打开同一资料目录，返回 `startup_refused` 和 `desktop_schema_incompatible`，退出码为 `1`。资料标记、数据库和已交付文件的 SHA-256 前后一致。再次启动 v0.1.1 后，会话历史和已交付文件仍可读取。
- 旧样本的任务库为 schema `4`，v0.1.3 要求 schema `5`。新包在资料标记校验处停止。本轮验证覆盖了新旧包接续同一资料目录的启动行为，原生自动更新器未执行。

本版按全新安装验收。拒绝打开旧资料并保留原数据符合 [架构约定](architecture/main-worker-chat-architecture.md)，旧资料迁移不属于本版交付。Intel 和 Windows 本轮完成构建和摘要校验，实机验收待验证。Latest 在构建核验时指向 `mobile-android-0.1.1-4`。

## Apple 芯片版真实账号验收

使用本轮正式包及新的独立资料目录，通过产品原生 Codex 入口完成 ChatGPT 浏览器授权。授权后的首次启动等待超时。重新打开同一隔离实例后，正式包识别已保存的登录并进入可用状态。

真实任务完成了事项创建、Worker 执行和正式文件交付。结果符合验收预期，下载返回 HTTP 200，文件和下载字节的 SHA-256 均为 `0ef962215cc055786d516355238a80dacc204ecf9b160d0a252190bf5c0cc370`。再次重启后仍可读取会话和同一交付文件。验收实例已退出，本轮临时认证文件已清理。

Apple 芯片版全新安装验收通过。

## 公开发布

2026-11-06 09:43（北京时间），同一 Release `435466177` 已公开。10 个附件的 ID、大小和 SHA-256 与发布前一致。发布时显式提交 `make_latest=false`。 [GitHub Release 更新接口](https://docs.github.com/en/rest/releases/releases#update-a-release)

三个固定版本下载链接均可匿名访问。每个包均按 `Content-Range` 取齐全部字节并独立计算 SHA-256，大小和摘要与上表及公开的 `SHA256SUMS` 一致。

- [Apple 芯片 Mac](https://github.com/wolf3c/homer/releases/download/v0.1.3/Homer-mac-arm64.zip)
- [Intel Mac](https://github.com/wolf3c/homer/releases/download/v0.1.3/Homer-mac-x64.zip)
- [Windows x64](https://github.com/wolf3c/homer/releases/download/v0.1.3/Homer-windows-x64.exe)

[SHA256SUMS](https://github.com/wolf3c/homer/releases/download/v0.1.3/SHA256SUMS) 和 [合并清单](https://github.com/wolf3c/homer/releases/download/v0.1.3/release-manifest.json) 已匿名完整下载并比对摘要。[Apple 芯片更新清单](https://github.com/wolf3c/homer/releases/download/v0.1.3/RELEASES-darwin-arm64.json) 与 [Intel 更新清单](https://github.com/wolf3c/homer/releases/download/v0.1.3/RELEASES-darwin-x64.json) 的摘要、版本及同架构固定下载链接均通过核验。

匿名 [Latest](https://github.com/wolf3c/homer/releases/latest) 发布前后均指向 `mobile-android-0.1.1-4`（Release `432431632`）。原 APK 和校验清单均通过 Latest 直链的完整字节校验。

| 原 Latest 附件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Homer-0.1.1-4-android-arm64.apk` | 42711323 | `49f569c94d6c64414a2360246f6bea30c181bd13a4a87bf5d3b382055570f051` |
| `SHA256SUMS` | 98 | `62198ec1dcd126b29f06d5292f7b625f6d7feb5d2995be3a560c98a88260f808` |
