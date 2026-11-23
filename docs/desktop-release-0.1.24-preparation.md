# Homer 桌面 0.1.24 发行准备

2026-11-23，build 312。版本元数据基于本地 `main` 的 `1c790ba343b91db645c0c7c3c9501692d4baf92f`。正式构建以远端 `v0.1.24` 对应的完整提交 SHA 为准。上一桌面正式版为 [v0.1.23 / build 311](https://github.com/wolf3c/homer/releases/tag/v0.1.23)，源码为 `71c64d89df514dd896332e44c88f656b068c924b`，Release ID 为 `455111224`。本机在准备时也已安装 0.1.23 / build 311。

## 构建与验收范围

- 沿用 `wolf3c/homer` 的 Homer build 手动工作流。Apple 芯片 Mac 需要 macOS 27 及以上，Intel Mac 需要 macOS 14 及以上，Windows 需要 Windows 11 x64。Mac 包使用 Developer ID 签名及 Apple 公证，Windows 使用未签名的 NSIS 安装器。
- 构建使用 `https://super-tree.com` 和 `https://models.super-tree.com`。三平台统一使用固定源码、版本和 build，直接上传同一 GitHub Release 草稿，随后在云端回下载全部安装包和原生更新清单，核对大小、SHA-256 与来源。
- Apple 芯片 Mac 使用隔离资料目录验收正式包。Intel Mac 和 Windows 实机安装、已启用平台的实际原生升级及每日使用实例的安装与资料保留需要各自的证据。准备时 GitHub Latest 仍为 v0.1.23。
- 手机配对的 TLS 中继代码需要带 ICE 角色修复版本标记的原生模块。这个模块的单独候选验证见[移动设备配对架构](architecture/mobile-device-pairing-architecture.md)，标准 GitHub 工作流使用上游原生依赖，发行说明不将该中继能力列为正式包功能。
- 用户更新说明维护于 GitHub Release 正文。构建、草稿完整性、安装、分发及 Latest 状态在取得证据后补记。
