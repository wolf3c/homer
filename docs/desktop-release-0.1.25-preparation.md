# Homer 桌面 0.1.25 发行准备

2026-11-24，build 313。候选包含 [v0.1.24 / build 312](https://github.com/wolf3c/homer/releases/tag/v0.1.24) 之后本地 main 的 20 个已提交改动，截止 `3ca7fc5adb7f52c17e87b448f7a73f38a252b5ca`。合并了远端 Android build 9 更新清单提交 `47f82e8f6eaa73eef8f4b410035ed2687d670e57`，该提交的三个文件逐字节保留。正式源码以 `v0.1.25` 解析的完整提交 SHA 为准。

## 构建和验收

- 使用 GitHub Actions 的 `desktop-three`。Apple 芯片 Mac 需要 macOS 27 及以上，Intel Mac 需要 macOS 14 及以上，Windows 需要 Windows 11 x64。Mac 使用 Developer ID 签名及 Apple 公证，Windows 使用未签名的 NSIS 安装器。
- 构建使用 `https://super-tree.com` 和 `https://models.super-tree.com`。三平台使用相同的源码、版本和 build，直接上传同一草稿并在云端回下载核对来源、大小和 SHA-256。
- 实机安装、原生自动升级和日常安装分别核验。准备时 GitHub Latest 及本机安装均为 0.1.24 / build 312。
- macOS 原生更新的唤醒清理使用本版源码中的新核对流程。进入原生安装前仍需确认安全停止，既有注销要求继续生效。签名包的真实原生升级及日常安装未验收。
- 用户更新说明维护于 GitHub Release 正文。构建、签名、各平台验收和公开分发证据在实际取得后补记。
