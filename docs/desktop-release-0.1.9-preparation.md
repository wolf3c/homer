# Homer 桌面 v0.1.9 发行准备

状态：2026-11-12，三平台构建失败，保留未公开的部分草稿；执行结果见下文。

- 上版：v0.1.8 / build 293，源码 `493a314e444ff2497d8a3c86e21e5669216e932d`；本机已安装版本同为 build 293。本轮拟用 v0.1.9 / build 294，标签尚未创建。
- 候选基线：本地已提交 main `99911eccc59753c9144a1b1ae38ac646bedf6605`，加本次版本元数据及准备记录；实际构建 SHA 须在获准提交后确定并核对远端与标签。其他未提交架构文档不属于候选。
- 上版以来的产品改动：桌面下载及原生更新源切换到 GitHub Latest；未签名 Windows 包接入更新及双阶段大小／SHA-512 复核；修复 ChatGPT 模型设置和 preload 转发。另有发行文档和流程更新。
- 请求 `desktop-three`：Apple 芯片 Mac（macOS 27）、Intel Mac（macOS 14）、Windows x64（Windows 11）；Mac 计划 Developer ID 签名与公证，Windows 未签名。服务地址为 `https://super-tree.com` 和 `https://models.super-tree.com`。
- 拟直接上传 Release 草稿，云端完整下载校验后，仅对 Apple 芯片 Mac 做隔离实机验收。Intel / Windows 实机、真实账号及原生升级尚未验证；Latest 切换须另有授权和升级证据。官网下载入口首次切换仍需单独授权部署。
- 本地及远端未发现 v0.1.9 标签或 Release；Actions 工作流已启用，远端 main 已注册手动触发；本地模板与工作流一致。发行前须重新核对远端 ref、标签占用及待提交 SHA。

## 构建结果（2026-11-12）

准备提交、远端 main 和标签均为 `b5a8d1cc054d9beca040139c98133faf5bf34886`。[运行 43163602567 / attempt 1](https://github.com/wolf3c/homer/actions/runs/43163602567/attempts/1) 的规划及两项 Mac 构建、上传成功；Windows NSIS 安装器生成后在 `windowsRelease` 校验报 `desktop_update_artifacts_invalid`，Windows 未上传，`verify-draft` 跳过。草稿仅含两个 Mac ZIP、两份平台清单和两份 Mac 更新清单，不是完整交付；未公开或切换 Latest。

失败定位：发行配置关闭差分包，当前 electron-builder 的非差分清单生成路径不填 `files[].size`，而 `windowsRelease` 原先强制要求该字段。runner 未保留失败时清单，故该判断基于源码路径及报错位置；已在本地以合成清单复现并修正，待新一轮真实 Windows 构建验证。不得重用或混合本轮附件与新源码或新 attempt。

Apple 芯片包本地完整下载为 409625425 字节，SHA-256 `9e1b40ecd6b73c61fb8d96cd20c0267f6d68990e83f5d7bc36568a41ec3c635f`；回执、包内 manifest 的版本、build、SHA 和双服务地址一致。`codesign --verify --deep --strict`、stapler 和 `spctl` 通过。隔离合成应用验收通过会话发送与重启、未连接账号只读、崩溃后原会话与附件恢复、SILK 预览与附件访问；语音测试临时副本修正 fixture 路径后通过。正式服务地址不满足本地回环专项前提，该专项未验收；真实账号、模型及原生升级未验证。Intel 和 Windows 未实机验收。

发行候选相关离线检查 638 项通过；Windows 清单修复的相关打包及草稿测试通过。原草稿、标签及未提交的其他工作保留，后续处理需另行确认。
