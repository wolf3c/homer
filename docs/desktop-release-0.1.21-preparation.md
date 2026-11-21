# Homer 桌面 0.1.21 发行记录

2026-11-21，build 309。`v0.1.21` 指向 `5b1c2f78da6010ad20dba55801e9685507f187d9`。[GitHub Actions 第 1 次构建](https://github.com/wolf3c/homer/actions/runs/44864965716/attempts/1)

## 工具升级与资料迁移

- 默认回归 2,807 项、固定 Codex 回环 11 项、迁移与桌面运行时定向 53 项均通过，无跳过。后端和 UI 类型检查通过。迁移定向覆盖原生历史替换中断后重试，以及遇到未知声明时拒绝迁移。
- 隔离 ChatGPT 订阅实测先用正式 0.1.20 宿主生成旧派工和提问，再冷启动迁移。原 Main 和 Worker 在 Code Mode 首次调用新版工具，原 Worker 各收到一次续做消息和问题答复，并完成事项。[工具升级架构与证据](architecture/host-tool-upgrades.md) · [专项入口](testing.md#homer-工具升级)
- 在 macOS 27.2 Apple 芯片机下载同一份正式签名包，核对版本、源码、SHA-256、Developer ID、公证票据和 Gatekeeper。正式包在停机资料副本上启动、读取主对话并正常退出。原线程标识、聊天、事项、Worker 历史和附件关联均保留。旧已结案事项转为暂停，原归档归属保留。
- 使用同一安装包手动升级本机 0.1.20 / build 308。启动实际桌面应用，确认原 Main 恢复，停机备份与迁移后的历史记录一致。保留升级前的旧应用和完整停机备份，以备回退。日常资料未用于订阅实模验收。

## 分发验收

公开 Latest 的基线是 `v0.1.20`，Release ID `452233763`。正式包仍在 0.1.21 草稿，Release ID `453434521`。

三平台均由同一源码和构建轮次生成。`verify-draft` 完整下载草稿中的安装包及原生更新清单，核验大小和 SHA-256，再回下载并校验 `release-manifest.json` 与 `SHA256SUMS`。草稿共 11 个附件。两份 Mac 包均使用 Developer ID 签名并公证，Windows 使用未签名的 NSIS 安装包。

| 平台 | 文件 | 最低系统 | 安装包字节数 | SHA-256 |
| --- | --- | --- | ---: | --- |
| Apple 芯片 Mac | `Homer-mac-arm64.zip` | macOS 27.0 | 432,382,104 | `78dc6166158a57835f12ebc75fd9f0e5beb8d3596bcfaad032919addd81de2de` |
| Intel Mac | `Homer-mac-x64.zip` | macOS 14.0 | 401,301,563 | `79898602ce25c1795fab41401fc23e399371ac12e99f97f054291495822ca130` |
| Windows x64 | `Homer-windows-x64.exe` | Windows 11 | 305,490,666 | `fe2075d7fd3a37bd8d8a214034844baa40d0f6de6204d2faf4be43ea454cc853` |

Intel Mac、Windows 的安装和旧资料升级需要对应系统上的实测。已启用来源版本通过 GitHub 最终清单和固定标签安装包的原生升级仍待验证。本次保留原 Latest。Apple 芯片 Mac 此前的隔离签名包原生升级使用回环源，当前正式包完成本机手动升级和资料恢复。[桌面更新验收顺序](desktop-app-update.md#2-接口归属与对齐)
