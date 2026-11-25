# Homer 桌面 0.1.26 发行准备

2026-11-25，build 314。候选以本地已提交的 `main`（`2b2dbe877830724f2aec8c96ddfdaafcf59aac77`）为第一父历史，合并 GitHub `main` 的 `6eefcf3b65f2607435432f65e437c2ca30ccb839`，保留 Android build 9 的三个文件及 v0.1.25 发行记录。`v0.1.26` 解引用后的完整提交 SHA 用于固定构建来源。

- `desktop-three` 构建 Apple 芯片 Mac（macOS 27 及以上）、Intel Mac（macOS 14 及以上）和 Windows 11 x64。Mac 使用 Developer ID 签名及 Apple 公证，Windows 使用未签名 NSIS。网站为 `https://super-tree.com`，网关为 `https://models.super-tree.com`。
- 三个平台使用同一版本、build 和源码。工作流直接上传草稿并回下载核对包大小及 SHA-256。准备时 GitHub Latest 为 v0.1.25 / build 313，本机日常包为 0.1.24 / build 312。
- Preview 前置验证覆盖隔离构建、类型检查和 67 项离线测试。Electron 专项 3 项通过，另 3 项在 macOS 整窗截图处失败。整窗与实体输入、各平台安装和原生自动升级按实际证据记录。
