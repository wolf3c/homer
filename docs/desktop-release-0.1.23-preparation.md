# Homer 桌面 0.1.23 发行准备

2026-11-23，build 311。版本元数据基于本地 `main` 的 `b4f7d44ed1a0383de98588e85062b4dd7ed6a61e`，包含归档事项箭头对齐和 Worker 启动失败处理。正式构建以远端 `v0.1.23` 对应的完整提交 SHA 为准。

## 构建与验证

- 沿用 `wolf3c/homer` 的 Homer build 手动工作流，目标为 Apple 芯片 Mac（macOS 27+）、Intel Mac（macOS 14+）和 Windows 11 x64。同一提交和运行轮次生成三平台安装包，直接上传同一 Release 草稿。
- 构建使用 `https://super-tree.com` 和 `https://models.super-tree.com`。Mac 使用 Developer ID 签名和 Apple 公证，Windows 使用未签名的 NSIS 安装器。
- 草稿发布前须完成三平台附件集合和摘要的云端校验，并按发布流程核对签名和安装运行。Apple 芯片 Mac 在隔离资料目录验收正式包。各平台实际安装及旧资料保留情况另行记录。
- 原 Latest 为 [v0.1.22](https://github.com/wolf3c/homer/releases/tag/v0.1.22)，Release ID `454189006`。真实原生升级、最终 URL 和来源兼容证据达到发布流程要求后才可切换 Latest。
- 构建、草稿校验、实机安装与公开分发状态待本轮完成后补记。用户更新说明维护在 GitHub Release 正文。
- 在冻结候选的隔离源码目录完成 612 项离线回归，无失败或跳过，覆盖 Worker 启动失败与续办、桌面桥接、更新及发行工作流契约。
