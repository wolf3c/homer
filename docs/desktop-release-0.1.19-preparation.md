# Homer 桌面 0.1.19 / build 305 草稿

- 2026-11-18。以 GitHub main 的 v0.1.18 提交 `ae293ea188feb071cba6ca538194c3b41d2d64db` 为基线，单独纳入历史滚动卡死修复 `9cdaf581`（本地原提交 `44c5d83c`，补丁一致）。构建固定到 v0.1.19 标签。
- 任务载入、输入草稿、引用、设置和历史滚动已在同一修复的本机 build 304 上通过真实数据验收。候选源码的历史滚动、虚拟窗口及发布协议定向检查共 128 项通过。build 305 的出包及完整性结果以该标签的 Actions 运行和草稿附件清单为准。
- 范围为 macOS ARM（macOS 27+）、Intel Mac（macOS 14+）和 Windows 11 x64。Actions 使用 Developer ID 签名并公证 Mac 包，生成未签名的 Windows NSIS 安装包。沿用网站 `https://super-tree.com` 与网关 `https://models.super-tree.com`。
- 本轮交付 Release 草稿，保留 Latest v0.1.17 和本机 build 304。build 305 的实际安装、自动更新与安全退出验收另行记录。
