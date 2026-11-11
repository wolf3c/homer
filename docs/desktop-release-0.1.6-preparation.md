# Homer 桌面 v0.1.6 构建准备

2026-11-09。公开构建提交 `2517d81da67deb893e2e15d156d76158b9e515d6` 基于 `v0.1.5` 的 `9230541d024c68b4b0819a388d4ef20d5ff9fc0b`，只纳入主会话恢复修复、对应测试和桌面版本元数据。已确认 `v0.1.6`、build 291，覆盖 Apple 芯片 Mac、Intel Mac 和 Windows x64。[GitHub Actions 第 1 次运行](https://github.com/wolf3c/homer/actions/runs/42581617906/attempts/1)

## 升级验收

- 从正式 `v0.1.4` 与 `v0.1.5` 的 Apple 芯片包提取完整动态工具目录。唯一差别是 `worker_open` 新增可选 `title`，原参数仍受同样的宿主校验。`v0.1.5` 要求旧会话指纹完全匹配，因而拒绝启动。修复只允许这对目录指纹恢复原线程，保留旧声明和原指纹。较早及未知指纹继续被拒绝。
- 新测试在修复前复现 `main_tools_migration_required`。修复后 45 项定向回归通过，公开候选类型检查和 21 项构建、草稿协议检查通过。`v0.1.4` 包内固定 Codex 在隔离目录恢复原生线程时保留了原工具声明，全程未发起模型轮。
- 用正式 `v0.1.4` 创建隔离会话并交付合成附件。用修复后的 Apple 芯片本地候选打开同一份资料，原线程、附件标识、版本、摘要及下载字节均一致。候选沿原线程完成一条新合成回复，聊天应用设置和钉钉绑定表单可打开。用 `v0.1.4` 再次打开该资料，原会话与原附件仍可读取。

本地候选为临时签名的预备包，ZIP 322480716 字节，SHA-256 `f8a719ae333edce303c65e0c9f21fec20ca033506f1045cd0def39c91c8d5a29`。本地来源摘要 `123d65be15edb51fa3eebb2c8b5c11d27846f909fd157f1373b90515635084b8`。可重放的公开候选补丁位于 `.codex/scratch/homer-v016-upgrade.L0PpwQ/release-candidate.patch`，SHA-256 `beda08cd2452e816b919534993ddeb2d08347febb1f238f52e9e4c027510a446`。同目录保留 `upgrade-acceptance.log`。

## 正式 Apple 芯片包复验

从同一轮 Release 草稿取得正式 ZIP，按平台清单和原始回执核对字节数及 SHA-256。Developer ID 签名、公证票据和 Gatekeeper 均通过。包内清单的版本、build、来源、架构和两个服务地址与回执一致。

用正式 `v0.1.4` 新建隔离资料并交付合成文件。正式 `v0.1.6` 打开同一份资料后，原线程及附件标识、版本、摘要和下载字节一致，沿原线程完成一条新合成回复，聊天应用设置与钉钉绑定表单可打开。切回 `v0.1.4` 后再次核对了原会话和附件。正式包另通过 4 项 Electron 桌面测试，覆盖新资料启动、普通重启、未登录只读、强退恢复和 SILK 播放。真实账号及外部渠道收发未纳入本轮，Intel Mac 和 Windows x64 安装与运行待目标环境验证。

## 三平台构建状态

第 1 次运行的两个 Mac 安装包已签名、公证并上传至草稿 `438859720`。Windows 在 `Install Electron runtime` 下载 Electron 45.0.0 的 x64 ZIP 时收到 HTTP 504，尚未打包，`verify-draft` 随后跳过。[Windows 构建日志](https://github.com/wolf3c/homer/actions/runs/42581617906/job/129041896886)

第 1 次草稿有两个 Mac 安装包、各自的平台清单和更新清单，共 6 个附件。

获准重跑后，将第 1 次的 6 个附件和两份原始回执保存在 `.codex/scratch/homer-v016-upgrade.L0PpwQ/42581617906/1/preserved-draft/`，全部与 GitHub 的字节数和 SHA-256 一致。随后清理草稿 `438859720`，并用原标签、源码和 build 发起第 2 次完整运行。

## 正式发布

第 2 次完整运行的三平台打包和 `verify-draft` 全部通过。云端完整回下载三个安装包和两份 Mac 更新清单，核对字节数及 SHA-256。三个原始回执与合并清单的版本、build、源码、签名、服务地址和安装包摘要一致。Apple 芯片包重跑本页的隔离升级和回退验收，并通过 4 项 Electron 回归。[GitHub Actions 第 2 次运行](https://github.com/wolf3c/homer/actions/runs/42581617906/attempts/2)

| 平台 | 附件 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| Apple 芯片 Mac | `Homer-mac-arm64.zip` | 321947780 | `a19087931c49be652cb267600350f4026b6d4182f6cce6671412458c84cbf66e` |
| Intel Mac | `Homer-mac-x64.zip` | 342661739 | `01a123fff42771bf0263bc9a4c074aabe315a2585fb1565a3d1103280a18ae4a` |
| Windows x64 | `Homer-windows-x64.exe` | 254318820 | `47d781ce0f8fd24742613ee99470b385d186f25d1b055df517485dde444dd6de` |

北京时间 2026-11-09 16:33，Release `438872100` 带 10 个原附件公开。固定标签是 `v0.1.6`，发布前 Latest 为 `v0.1.4`（Release `437240469`）。本次版本使用固定标签下载。构建提交未纳入自我进化提示词和桌面收银。[正式 Release](https://github.com/wolf3c/homer/releases/tag/v0.1.6)

公开后完成 14 项匿名下载检查。固定标签与 Latest 的三个安装包均核对了首段、文件名及完整长度。本次 7 个小附件与草稿副本逐字节一致，Latest 的校验清单仍匹配 `v0.1.4`。匿名 API 触发限流，附件 ID、字节数、摘要和中英文正文用已认证 API 回读比对，版本页和下载链接均用匿名请求验证。Latest 仍是 `v0.1.4`。

恢复已归档的 Yezi2 发行交接会话并更新官网本地手动下载入口。桌面与 390px 实际渲染均通过，三条固定标签链接、系统要求和中英文旧资料提示已核对。官网改动尚未部署。[Yezi2 下载配置](../../yezi2/imports/ui/Homer/desktopReleases.js)

同日将本机 Apple 芯片版从 `v0.1.4` build 289 覆盖升级到 `v0.1.6` build 291。日常资料的原会话正常打开，界面中 33 条历史消息与升级前一致。一份原附件在内置预览中正常打开，下载字节与升级前一致。验收未发送新消息，旧 App 和回退资料保留在本机。
