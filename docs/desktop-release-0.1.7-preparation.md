# Homer 桌面 v0.1.7 构建准备

2026-11-10。公开候选 `6a5d1edc2aaaff5a8764007fab1afc9f823d6385` 基于已发布的 `v0.1.6`，保留其主会话恢复兼容处理，再应用本地上次公开构建基线 `e0bd9579be2b94c8c99111c5a192277efe3d6a82` 到本地已提交源码 `6744bc0cf091253e6641f9fe7afc11651f7544f8` 的产品增量。未提交文件、内部运营文档及本地 Git 历史未进入候选。公开构建分支 `codex/desktop-v0.1.7` 和标签 `v0.1.7` 均指向该提交。

构建参数为 `kind=desktop`、`target=desktop-three`、`release_tag=v0.1.7`、`build_number=292` 和 `upload_release_draft=true`。官网和网关沿用 `https://super-tree.com` 与 `https://models.super-tree.com`。Apple 芯片版最低 macOS 27，Intel 版最低 macOS 14，均走 Developer ID、公证及 stapling。Windows x64 目标为 Windows 11，当前云端流程生成未签名 NSIS 安装器，自动更新关闭。[GitHub Actions 第 1 次运行](https://github.com/wolf3c/homer/actions/runs/42842867161/attempts/1)

隔离候选通过依赖安装、宿主与 UI 类型检查、30 项构建协议、会话恢复兼容及 Chrome Cua 定向测试，以及 20 项 Telegram 和截图批注定向测试。静态和合成验证不代替安装包验收。

Intel Mac 与 Windows x64 的目标环境验收待安排。Windows Cua 的现有验收要求签名候选包和交互式 Windows 桌面，当前工作流产物不能满足该签名条件。

Apple 芯片包已上传草稿。实际下载 ZIP 为 388067432 字节，SHA-256 为 `afb6a86fe232a47c519658b50760dff4773bf7c87345d4004307af00f8e10844`，与同轮回执和平台清单一致。ZIP 内清单与回执的版本、build、架构、源码和服务地址一致。Developer ID、stapling 及 Gatekeeper 通过；随包 Cua Driver 可启动并报告 `0.46.1`。

在独立合成资料下，正式 `v0.1.4` 的会话和附件能在 `v0.1.7` 继续使用，回退后仍可读取同一会话及附件字节。实测首启导览可以关闭。Electron 原版测试的两条发送路径被导览遮挡，在临时测试夹具模拟导览已读后两条均通过；未连接账号的只读行为及 SILK 附件预览也通过。另一个账号测试专用于回环准备包，正式包因服务地址不同未通过其环境检查。真实账号、外部渠道和正式包的交互式 Cua 仍待验收。

第 1 次运行的三个打包 job 和 `verify-draft` 全部通过。草稿 `440535806` 的 10 个附件、构建回执、平台清单、合并清单及 `SHA256SUMS` 核对一致。中英文更新说明已写入草稿并回读比对。

| 平台 | 安装包 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| Apple 芯片 Mac | `Homer-mac-arm64.zip` | 388067432 | `afb6a86fe232a47c519658b50760dff4773bf7c87345d4004307af00f8e10844` |
| Intel Mac | `Homer-mac-x64.zip` | 356074614 | `a79c616b6300de35e291e01568ea559fe37168f01e25c444e41f2fe21cfafc51` |
| Windows x64 | `Homer-windows-x64.exe` | 271016010 | `817dffe03e06df502b1671f9ccafb06fbb328ca286ed4af60ba07c3d28ba5880` |

按用户后续指示公开同一 Release `440535806`，并将 GitHub Latest 从 `v0.1.4`（Release `437240469`）切到 `v0.1.7`。发布前后的附件 ID、字节数和 SHA-256 一致。匿名验证三平台固定标签下载及 Latest 跳转，公开校验清单和两份 Mac 更新清单与草稿一致。发布说明记录 Intel Mac 和 Windows x64 的目标环境验收缺口，以及 Windows Cua 的签名验收缺口。[正式 Release](https://github.com/wolf3c/homer/releases/tag/v0.1.7)


## 官网与本机安装收尾

2026-11-11，Yezi2 官网手动下载入口更新为 v0.1.7（build 292），三平台使用固定标签链接。下载配置提交为 8a2ed40b4，随 Yezi2 6.1.41 的发布提交 335a3b89 部署。部署聊天记录确认公开浏览器及免费 MCP 检查连续两轮通过；此处沿用该部署验收，未重复部署。

同日将 Apple 芯片正式版安装到本机。安装前完整核对发布 ZIP 的大小及 SHA-256，Developer ID、stapling 与 Gatekeeper 通过。包内清单为 v0.1.7、build 292、来源 6a5d1ed。启动后实见原会话历史，关闭首启导览后返回主界面。旧应用保留供回退；本次未发送模型消息或验证全部功能。
