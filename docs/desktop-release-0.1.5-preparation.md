# Homer 桌面 v0.1.5 构建准备

2026-11-09。已确认三平台构建与 Release 草稿范围。执行前公开 Latest 与本机 Homer 均为 `v0.1.4`（build 289）。预检未发现 `v0.1.5` 标签或 Release。

- 本地源码：`e0bd9579be2b94c8c99111c5a192277efe3d6a82`，包含核心精简合并 `18b0267` 和钉钉专用机器人接入 `e0bd957`。
- 公开候选：在公开 `v0.1.4` 的 `26ebe9aa1f7b7fcd11084384f2f41047f7c845f1` 上应用本地上次发行 `fd17bc23b4a4aa195b559db05e195c49d0a6c832` 至本次源码的差异。只导出产品代码、随包资源、内置 Skill 和测试；沿用公开工作流、文档和仓库元数据。根包与锁文件仅在隔离候选中额外更新版本为 `0.1.5`。
- 公开构建提交为 `9230541d024c68b4b0819a388d4ef20d5ff9fc0b`。候选补丁 SHA-256 为 `2c0294a925ace0ed9035c5e98a0c0b0ff02c5dc1c731fff0a1de92db391f407a`。已从公开基线重放并比对完整目录，提交前复跑 21 项构建预检，全部通过。

构建参数为 `kind=desktop`、`target=desktop-three`、`release_tag=v0.1.5`、`build_number=290` 和 `upload_release_draft=true`。Mac ARM64 最低 macOS 27，Intel 最低 macOS 14，均用 Developer ID 签名及公证。Windows x64 最低 Windows 11，安装包不签名，自动更新禁用。双服务地址为 `https://super-tree.com` 和 `https://models.super-tree.com`。

GitHub 默认 `main` 是 `e7e6b6bfdf6701e21faebcfea6d320d90212a95b`。它已注册并启用 `homer-build.yml`；远端文件、公开候选与本地模板一致。9 个 Action 引用均固定到完整 SHA，12 段 shell 通过语法检查，6 个必需的签名 Secret 名称存在。Node 22.22.0 下，候选通过 21 项构建规划和草稿协议离线测试。未安装依赖、编译、签名、打包或验收本次候选。

## 本地未提交内容

| 类别 | 处理 |
| --- | --- |
| 核心重构架构索引 | 将原 worktree 的首启证据和精简方案入口归入 [架构索引](architecture/README.md)，同步注明 C5 实测与合成验证的边界，保留钉钉条目。 |
| 历史发行与恢复记录 | `desktop-app-update.md`、`desktop-release-0.1.1.md`、`mobile-app-update-notice.md`、`architecture/mobile-device-pairing-architecture.md` 保留原改动，后续可按桌面与移动端分开提交。 |
| 积分购买评审稿 | `superpowers/specs/2026-11-09-homer-desktop-credit-purchase-design.md` 与 `images/homer-desktop-credit-purchase-*.png` 保留在一起，不进入本次公开候选。 |
| 行尾规则和聊天附件 | `.gitattributes` 保持原状；公开基线已有行尾规则。`.codex-attachments/` 原位保留，不提交。 |

两项旧工作都已合入 `main`，Git 仅剩主检出。钉钉隔离候选及验收记录和核心精简 C5 证据仍在各自主检出保留目录。核心精简工作树的原索引补丁与历史材料保留在忽略的私有目录；生成的 `dist/` 移入废纸篓。Codex 未能把核心精简旧聊天切回主检出。

本次产品验收仍待进行。钉钉已有隔离 Mac ARM64 的历史实网证据，最终脱敏修正经过离线核验。桌面壳另有四项在合入前已复现的旧资料接管失败。

## 草稿构建结果

北京时间 2026-11-09 15:02 触发第 1 次运行。规划、三个打包任务和 `verify-draft` 全部通过。GitHub 完整回下载三份安装包和两份 Mac 更新清单，核对字节数及 SHA-256。三份原始回执与合并清单的版本、build、源码、签名状态、服务地址和安装包摘要一致。[GitHub Actions](https://github.com/wolf3c/homer/actions/runs/42576734401/attempts/1)

| 平台 | 安装包 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| Apple 芯片 Mac | `Homer-mac-arm64.zip` | 321947602 | `63c4d3e1fbc2f4474061de55413a3aa66fc2e8bed3e92b2ee200b92dda34352d` |
| Intel Mac | `Homer-mac-x64.zip` | 342661526 | `004be8b5c39fc8130e72e3044f5303db9d97b78612893af87690dc79f5be7222` |
| Windows x64 | `Homer-windows-x64.exe` | 254303064 | `1056a4f82c4352a557c7026a5381f60e2cbe3bd0fa6fbdf79f25d6f2903d0b0d` |

Release `438824757` 保持草稿。回读确认 `v0.1.5` 标签、中英文更新说明及全部 10 个附件的 ID、字节数和摘要一致。GitHub 在只提交正文的编辑请求中临时将草稿关联变成内部标签，显式补回 `tag_name=v0.1.5` 后恢复。Git 标签始终指向原构建提交，公开 Latest 仍为 `v0.1.4`。

公开源码候选通过类型检查及 24 项钉钉、桌面渠道与 Hook 定向测试。三平台安装、启动和功能验收，以及安装包内部清单的服务地址核对仍待完成。

## 发布前验收（2026-11-09）

Apple 芯片正式 ZIP 的字节数与 SHA-256 匹配草稿清单。Developer ID 签名、公证票据与 Gatekeeper 均通过。包内清单的版本、build、源码 SHA 和两个服务地址与原始回执一致。隔离 Electron 测试 4/4 通过，覆盖新资料启动、原会话重启、未连接账号的只读状态、强退后的附件恢复和 SILK 播放。

正式 `v0.1.4` 在隔离资料中建立会话并交付合成文件。用 `v0.1.5` 打开同一份资料，窗口进入 `management`，返回 `desktop_chat_unavailable`，原会话和附件未显示。资料保留的主会话工具指纹与新版不匹配，现行启动代码在该条件下要求 `main_tools_migration_required`。重新使用 `v0.1.4` 可打开原会话，附件标识、摘要和字节与升级前一致。

本次发布在旧资料接管验收处停止。Release `438824757` 保持草稿，公开 Latest 仍为 `v0.1.4`。Intel Mac 和 Windows x64 缺少目标环境，安装与运行尚待验收。Apple 芯片正式包的真实账号和外部渠道收发尚未验证。
