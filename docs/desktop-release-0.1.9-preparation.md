# Homer 桌面 v0.1.9 发行准备

状态：2026-11-12，本地准备，尚未提交、构建、签名、上传或发布。

- 上版：v0.1.8 / build 293，源码 `493a314e444ff2497d8a3c86e21e5669216e932d`；本机已安装版本同为 build 293。本轮拟用 v0.1.9 / build 294，标签尚未创建。
- 候选基线：本地已提交 main `99911eccc59753c9144a1b1ae38ac646bedf6605`，加本次版本元数据及准备记录；实际构建 SHA 须在获准提交后确定并核对远端与标签。其他未提交架构文档不属于候选。
- 上版以来的产品改动：桌面下载及原生更新源切换到 GitHub Latest；未签名 Windows 包接入更新及双阶段大小／SHA-512 复核；修复 ChatGPT 模型设置和 preload 转发。另有发行文档和流程更新。
- 请求 `desktop-three`：Apple 芯片 Mac（macOS 27）、Intel Mac（macOS 14）、Windows x64（Windows 11）；Mac 计划 Developer ID 签名与公证，Windows 未签名。服务地址为 `https://super-tree.com` 和 `https://models.super-tree.com`。
- 拟直接上传 Release 草稿，云端完整下载校验后，仅对 Apple 芯片 Mac 做隔离实机验收。Intel / Windows 实机、真实账号及原生升级尚未验证；Latest 切换须另有授权和升级证据。官网下载入口首次切换仍需单独授权部署。
- 本地及远端未发现 v0.1.9 标签或 Release；Actions 工作流已启用，远端 main 已注册手动触发；本地模板与工作流一致。发行前须重新核对远端 ref、标签占用及待提交 SHA。
