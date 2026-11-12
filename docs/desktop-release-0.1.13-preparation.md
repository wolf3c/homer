# Homer 桌面 v0.1.13 发行记录

状态：2026-11-13，v0.1.13 / build 298 已按用户确认公开，固定标签分发验收通过；Latest 保持 v0.1.8。三平台构建、云端完整校验及 Apple 芯片隔离验收通过；完整原生升级仍未验收。

## 本轮范围

- 产品 0.1.13 / build 298。上一公开桌面版 v0.1.10 / 295，本机安装相同；失败标签 v0.1.11 / 296 和 v0.1.12 / 297 保留，后者三个 Windows 草稿附件不覆盖、不删除。
- 源码基线 `3961b48b1892f7b7c563ed527c1198a1a57eb977`，追加本轮签名环境修复、对应测试、版本与记录。完整产品差异仍包括定时消息、电源保护和 Mac 更新验签修复，见 [v0.1.11](desktop-release-0.1.11-preparation.md)；大归档修复及其回归已在 [v0.1.12](desktop-release-0.1.12-preparation.md)完成。
- 唯一新增构建行为：buildMacPower 的 `/usr/bin/codesign` 沿用既有 Node 和图片辅助程序的宿主签名上下文；Swift 和其他编译仍走原 scratch HOME。身份、运行时签名、公证和严格验签要求不变，不扩散宿主环境给编译，不读取或输出凭据。
- 仅改 scripts/build-desktop.mjs、tests/desktop-power-packaging.test.mjs、根 package.json / package-lock.json 和本记录。保留 UI、移动端及其他任务未提交工作，不纳入候选。
- desktop / desktop-three / 草稿直传；Apple Silicon macOS 27+、Intel macOS 14+、Windows x64 Windows 11。Mac Developer ID 签名、公证和 stapling；Windows 未签名 NSIS。
- 网站 `https://super-tree.com`、网关 `https://models.super-tree.com`；Node 22.22.0、Codex 0.163.0、依赖归档和原工作流不变。
- 仅下载 Apple 芯片包做隔离签名及产品验收；不替换日常安装，不注册真实唤醒事件或改变权限，不使用真实账号或付费模型。Intel / Windows 实机、真实唤醒及原生升级仍需独立证据。

## 本地检查

新回归执行真实构建入口中 run 和 buildMacPower 调用段，在子进程边界捕获命令环境；旧实现的签名调用带有 scratch HOME，测试先失败。修复后检查 Swift 仍隔离、签名及验签继承宿主环境。该测试不冒充真实 Developer ID 签名，正式签名由本轮云端及下载包核验。

`node --test tests/desktop-power-packaging.test.mjs tests/macos-power.test.mjs tests/desktop-source.test.mjs tests/github-build-plan.test.mjs tests/github-release-draft.test.mjs`：65/65 通过，无失败、取消或跳过。原大归档、来源一致性、权限及草稿完整性拒绝断言保持。

提交前核对版本/锁文件一致、工作流/模板一致、远端来源和标签占用，并执行 git diff --check。本轮未重跑全量核心、真实引擎或电源专项；既有记录不替代本轮产品验收。

## 执行记录

- 提交、远端 main 及标签 v0.1.13 回读均为 `0184dd81bca18df5f4de7070eefabc0440af9291`；提交仅上述五个文件，其他任务未提交工作保留。
- [运行 43247531635 / attempt 1](https://github.com/wolf3c/homer/actions/runs/43247531635/attempts/1)，操作者 wolf3c，workflow_dispatch，ref v0.1.13，2026-11-12 23:24:57（Asia/Shanghai）触发；headSha 与目标完整 SHA 一致，输入为 desktop / desktop-three / build 298 / 草稿直传。
- Apple 芯片 job 131284294780 success，已越过旧电源辅助程序签名失败点，正式包及原生更新清单上传成功。取回原始小回执，版本/build、来源、preparation=false、publishable=true、Developer ID / notarized and stapled、macOS 27.0 和双服务地址均核对通过。
- Apple 芯片 ZIP `Homer-mac-arm64.zip` 为 409832399 字节，回执 SHA-256 `10d71d4a786484f875567e26260a1f64d8732b7662fde0886db5a9cbee2ffcef`。此时尚待最终云端完整下载校验和本机产品验收。

本轮无重跑，全部产物来自同一 SHA / run / attempt；最终结果如下。Latest 保持 v0.1.8，公开与原生升级放量另行授权。

## 完整构建与草稿校验

plan、三平台 build、verify-draft 五个 job 全部 success，attempt 为 1。Windows 真实 electron-builder 更新清单契约步骤通过；两端 Mac 临时签名材料清理步骤成功。verify-draft 完整流式下载三平台包及原生更新清单，比对大小和 SHA-256 后上传合并清单与 SHA256SUMS。

草稿 Release ID `443142581`，11 个附件齐全。三份原始回执、平台与合并清单及 GitHub 附件摘要一致；所有回执版本、build、完整 SHA、正式包标记和双服务地址均符合本轮输入。Intel 实际最低系统为 macOS 14.0，Windows 回执明确未签名。本机只完整下载 Apple 芯片包，其余大包的完整下载证据来自云端 verify-draft；小清单均回读并核对摘要及固定标签 URL，Windows 原生清单 size=291108006。

| 附件 | ID | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `Homer-mac-arm64.zip` | 740011033 | 409832399 | `10d71d4a786484f875567e26260a1f64d8732b7662fde0886db5a9cbee2ffcef` |
| `Homer-mac-x64.zip` | 740053869 | 377847271 | `fa3b49029039f36785ed334880246a1a7a2343ec830f5f8f03d008315d7762ad` |
| `Homer-windows-x64.exe` | 740082401 | 291108006 | `544fb8a7025c743afd6e34184538687b8d9db96ba65cfb7a7fdf682637a0b5bc` |
| `latest.yml` | 740082905 | 484 | `f3cc1bf55dac3dd28e50b929105f148e5b85563924e23d2bdaf9977ff269993e` |
| `release-manifest-macos-arm64.json` | 740011801 | 977 | `c713c96db5c173ffb97e77b17a6f2e63b25d9b57935d263da5a2d9e37a401173` |
| `release-manifest-macos-x64.json` | 740054827 | 963 | `97c9312ec0b010f98e70ce787e596a0e5d5546df74631d1acbd48ee47ad5ebdf` |
| `release-manifest-windows-x64.json` | 740082959 | 961 | `16ab927307fb176d663e9339733cdc054ac4ce54681a80cb12621e7e5171b464` |
| `release-manifest.json` | 740084706 | 2643 | `8d7064e723a6484dbfca10148e9b832dc19dee3e4a0aa9991e8cb38b17b9ccbe` |
| `RELEASES-darwin-arm64.json` | 740011756 | 319 | `1ecfe4dd44043c2647640862da04755992efcf1e3cb8249d4af33fe956f2695f` |
| `RELEASES-darwin-x64.json` | 740054759 | 317 | `8854b1e6f75b37a6c152b964c233c0223ce49c3b80a5aa6b17533b278bdfd1c2` |
| `SHA256SUMS` | 740084651 | 519 | `937d489f47388d1806d535a370a3111fa5613c2f349e3210635c7b3e97f226b0` |

## Apple 芯片实际包隔离验收（2026-11-13）

本机 macOS 27.2 / arm64。ZIP 完整下载后的大小和 SHA-256 与本轮回执及合并清单一致；包内 desktop-manifest 与原始回执的版本、build、来源、正式包标记、双服务地址和 powerWake=1 一致，两个电源可执行文件和 launchd plist 均进入封存清单。

- codesign 深度严格校验、stapler 和 Gatekeeper 均通过，Gatekeeper 报告 Notarized Developer ID。真实 codesign 更新表达式专项 1/1 通过，旧表达式和错误标识均拒绝；不等同于完整原生升级验收。
- 本轮正式 Electron App 的五项隔离合成验收 5/5 通过，零失败、取消或跳过：发送与正常重启；未连接账号只读；完整进程崩溃后的同一线程与精确附件恢复；SILK 预览及访问控制；电源默认值、实际设置保存、真实系统防休眠保护申请与释放。
- 电源设置经实际界面开关验证，profile 持久化值与状态一致；390 / 1440 宽度无页面横向溢出。会话截图和宽窄电源设置截图均已查看。五项正常退出后的 owner、runtime/gateway 锁和 lease 释放断言均通过；崩溃恢复未手动删锁。
- 正式包双服务地址和批注运行时/notices 两项定向检查 2/2 通过，无跳过。

验收入口基于本次提交的 tests/electron-desktop.test.mjs 前四项场景，在 scratch 副本预置首启导览已读标记、适配 SILK fixture 路径，并追加实际电源设置、profile 保存及保护释放场景；未修改 App 或原签名 ZIP。测试仅使用独立合成 profile，不调用要求回环账号服务的 daily 场景。没有替换日常安装、调用真实账号或付费模型、注册唤醒事件或改变系统权限。

## 草稿验收完成时的授权边界

草稿中英文用户更新说明已按本次实际验收完善并逐字回读一致；包含定时消息、电源设置、Mac 更新检查、系统要求、安装方式、签名和未覆盖项。完整用户日志以该 Release 正文为唯一维护处，本记录不再复制草案。

草稿状态仍为 draft=true、prerelease=false，11 个附件身份不变；Latest 回读仍为 v0.1.8 / Release ID 441835374。下一步可确认公开同一草稿、保留原 Latest；不重新上传安装包或部署官网。

未覆盖：Intel / Windows 实机、真实账号与付费模型、系统唤醒授权／拒绝／撤销／升级卸载、真实睡眠唤醒及实网渠道补收、各平台最终 URL 的完整原生升级及真实数据迁移。合成恢复与表达式验签不能替代这些验收，因此不提出切换 Latest。

## 本轮资源清理

已按 work-cleanup 核对无本轮 App / profile 进程，删除本轮 ZIP、解压 App 和五个合成 profile，精确目录占用合计约 1.33 GiB；未以此声称等量 APFS 可用空间回收。核对后磁盘可用空间约 32 GiB。本轮 scratch 仅余约 624 KiB，包含三张审核截图、临时验收入口、脱敏 TAP、三份回执、小清单及草稿基线，供待公开审核和分发核验；同一草稿公开并验收后可清理。产品源码与本记录提供重建和追溯依据。日常安装、旧失败标签／草稿及其他任务未提交工作保留。

## 公开及发布后核验（2026-11-13）

用户确认公开，并询问为何不切 Latest。已说明本机五项隔离验收通过，但未执行旧客户端从最终 URL 下载、原生安装、安全重启及原资料保留的完整升级；不将该问句视为切 Latest 授权。本轮按确认公开同一草稿，保留 v0.1.8 为 Latest。

公开命令为 `gh release edit v0.1.13 --repo wolf3c/homer --verify-tag --draft=false --prerelease=false --latest=false`。没有重传附件、移动标签或部署官网。

[固定版本页面](https://github.com/wolf3c/homer/releases/tag/v0.1.13)，Release ID `443142581`，公开时间 `2026-11-12T16:05:58Z`，draft=false、prerelease=false。

- 公开前重新核对标签来源、同一草稿正文和全部 11 个附件身份；匿名记录原 Latest 的 Release ID、标签及全附件元数据。
- 公开后匿名 API 核对本版的 Release ID、状态、正文和 11 个附件名称／ID／大小／SHA-256 均与发布前基线相同，复用本轮 verify-draft 的完整下载证据。
- 八个小附件全部匿名完整下载，大小和 SHA-256 与基线一致，包括 SHA256SUMS、合并与平台清单及三份原生更新清单。
- 三平台固定标签安装包各匿名 GET 起始 1024 字节，均为 206、Content-Range 总大小与基线一致、实际样本长 1024、文件名正确。
- Latest 的 Release ID／标签及全部附件元数据保持原基线；三平台 Latest 安装包各匿名 GET 1024 字节均通过，并核对中途重定向经过 v0.1.8 的同名固定标签 URL。未保存临时存储 URL 或鉴权值。

原 Latest：v0.1.8 / Release ID 441835374。发布前后匿名元数据逐项一致，基线如下；本次 v0.1.13 附件基线见上方完整构建表。

| 原 Latest 附件 | ID | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `Homer-mac-arm64.zip` | 735881549 | 409621096 | `abf8c12ca7974757b0b3685f0528e04d4145e73a581445a7234f75946c424a7e` |
| `Homer-mac-x64.zip` | 735904620 | 377626200 | `890e828cd1f5c60f1fb206ab65faa440b92c05206d79a079a7cc632ff56da1fe` |
| `Homer-windows-x64.exe` | 735924149 | 291000164 | `5097361db77c7a74a0ad5eba235fa0e662b36e8dbbc3b7c5bbff4bf3394bed50` |
| `release-manifest-macos-arm64.json` | 735882178 | 973 | `fa9bac27aaaaf82982fd3cca47afa52f31578b52bbb31dde5968f074a1a6f52a` |
| `release-manifest-macos-x64.json` | 735905148 | 959 | `b35bc7b8f62efa414e8e19b4378a3cdb6ac3290c0e50efdae996aa2b55d5c0db` |
| `release-manifest-windows-x64.json` | 735924724 | 704 | `154def9baf83c7fec01a97f2691fe227fb43f64b2f4d0b6126f6b21a5676cdc4` |
| `release-manifest.json` | 735927557 | 2354 | `bf82f3b239ce445b5518d67fa364e12cb751360df97907287a24b31b0ff05d0b` |
| `RELEASES-darwin-arm64.json` | 735882135 | 314 | `d224ef1ff036a68dec46a823b78b379e572b25254f4d43b6a55e835bd186dd9e` |
| `RELEASES-darwin-x64.json` | 735905105 | 312 | `5f1c8d0d17d4efb1ef1f4ade7537b763670703bf3046c4b976da52e11dc7dde7` |
| `SHA256SUMS` | 735927511 | 442 | `676be0481126779794e8815853f5d702ae7c8ffcc3fa97bb4f57208be81d8159` |

本版请使用固定标签链接。官网及 README 的 Latest 入口继续提供 v0.1.8；本次固定标签已公开且验收通过，不将其称为已放量的自动更新。后续切换 Latest 仍需各启用平台的来源兼容与完整原生升级证据及相应授权。

公开分发核验完成后，本轮 scratch 的保留条件已解除；回执、TAP、截图、下载清单、草稿与公开核验快照和临时脚本均可按任务收尾回收。永久来源、附件摘要及验收结论保留在本记录、Git 历史、固定 Release 和 Actions 中；不保留原始敏感日志。
