# Homer 桌面 v0.1.15 发行准备

状态：2026-11-15，v0.1.15 / build 300 已公开；首次发布保留 v0.1.14 为 Latest，后续按用户明确指示切换为 v0.1.15（见文末）。三平台构建、云端完整校验及 ARM 隔离验收通过；固定标签与原 Latest 分发核验通过。本机后续已按用户授权停止卡住执行、完整备份并安装 v0.1.15，账号及原资料保留核验通过，见文末。

## 来源及范围

- 产品基线为本地已提交 main `d1b871e1fff494dc41fd18c05c2506fd0d26d92e`。核对时远端 main 为 `5b74088562881e5471d67de9d991b35c2824ad88`，本地领先 10 个提交，无分叉。
- 上次正式版及当前 Latest 为 v0.1.14 / build 299，源码 `65125aae77472bd7f99d330ce68261e307d470c4`。本机应用为 0.1.13 / build 298。新版本取 0.1.15 / build 300；创建前须再次核对标签占用及 build。
- 本轮版本准备仅涉及根 `package.json`、`package-lock.json` 和本记录。其他未提交及已暂存工作全部保留，不纳入发行提交。远端构建以最终发行提交完整 SHA 为准，禁止混入工作区覆盖。
- 用户要求打包发布 main 最新已提交版本；因版本仍为已发布的 0.1.14，用户本轮已明确确认提交三个发行文件、推送 main、创建 v0.1.15 标签、正式签名公证、三平台构建验收及公开发布，暂时保留 v0.1.14 为 Latest。不得覆盖旧版标签或附件。

## 上版以来的已提交变化

相对 v0.1.14，产品基线累计涉及 115 个文件，包括测试、验证材料和文档。

- 截图自动附带辅助功能上下文，供模型理解截图；本轮不扩大系统权限。
- 会员 Responses WebSocket 传输及 Main 空闲连接恢复。
- Worker 按需读取目录上下文，派发前解析工作目录；包含旧 Main 恢复及原生历史提示注入的验证材料。
- Main 邮箱送达与业务完成结果分离，调整回执迁移及恢复路径。

这些是源码差异范围，不代表本次安装包运行验收已通过。中英文用户更新说明在草稿阶段依据最终源码和验收结果整理，完整日志只维护于 Release 正文。

## 构建与验收

- `kind=desktop`，`target=desktop-three`，`upload_release_draft=true`，标签 `v0.1.15`，build `300`。
- Apple 芯片 Mac：macOS 27+；Intel Mac：macOS 14+；两者 Developer ID 签名、公证及 stapling。Windows x64：Windows 11，未签名 NSIS。
- 显式网站地址 `https://super-tree.com`，网关地址 `https://models.super-tree.com`；不修改官网或移动版。
- 使用已注册且 active 的现有手动工作流，固定 Actions SHA、源码 SHA、平台依赖锁和显式服务地址；现有签名 Secret 名称齐全，未读取值。
- 同一 run / attempt 的三平台构建、11 个附件及云端完整下载校验必须通过。仅下载 ARM 包做本机隔离验收，核对来源、版本、摘要、双服务地址和系统信任。
- 隔离验收通过后，按构建 Skill 的已授权安装流程等待日常空闲，安全退出、停机备份、安装及核对原资料；状态不明时不得强停或删锁。
- 公开同一草稿并核验固定标签；默认保留 v0.1.14 为 Latest。完整原生升级及来源兼容未验收前，不切换 Latest；其他平台实机及真实付费模型未验收不得标记通过。
- 公开前记录原 Latest 和本次附件基线，公开后匿名抽查三个平台固定链接，并复核清单及原 Latest 分支。

## 准备检查

规划及合成草稿协议检查 29/29 通过，零跳过；版本 JSON 差异仅三个版本字段，工作流与模板、HEAD 及远端 main 逐字一致，v0.1.15 远端标签未占用。已核对桌面 Release（含可读取草稿）清单，最大 build 为 299；本机 build 298。三个发行文件 diff 空白检查通过。未创建临时包或源码副本，测试 fixture 已自行收尾。最终发行 SHA、run / attempt、包摘要、隔离验收、本机安装和公开分发状态见下文，分别记录、互不替代。


## 执行记录

- 发行提交 `b192bed0773d4339bbdcb821f083a414a8325897` 仅含三个获准发行文件；推送后回读远端 main 和 v0.1.15 标签，完整 SHA 均一致。未提交或已暂存的其他任务工作保留。
- [运行 43704742655 / attempt 1](https://github.com/wolf3c/homer/actions/runs/43704742655/attempts/1)，操作者 wolf3c，workflow_dispatch，ref v0.1.15，固定上述 SHA，desktop / desktop-three / build 300 / 草稿直传。未重跑或混合 attempt。
- 固定提交导出的源码快照，显式 Node 22.22.0：构建、类型检查通过；连接恢复、邮箱送达与投影、回执迁移、工作目录及桌面壳定向回归 539/539 通过，零跳过。首轮误用系统 Node 26 的结果不充当仓库工具链验收，已用 Node 22 完整重跑。未调用真实模型。
- ARM 正式包 409853535 字节，SHA-256 `aa20f2657881d6a8268195e82c1fe560105949ccab9d9476d4e3a98cf0fc49f9`；与原始回执一致。回执及 ZIP 内封存清单版本/build、源码、正式包标记、双服务地址均核对通过。
- ARM codesign deep/strict、stapler、Gatekeeper 通过，系统报告 Notarized Developer ID。真实更新验签表达式 1/1、正式包地址及批注运行时/许可证检查 2/2 通过。
- 初轮四场景隔离验收 3/4 通过；Worker 附件交付在崩溃步骤前超时。定位到仓库旧 desktop-app-server 合成 fixture 的 config/read 未回显传入的 project_root_markers，Worker 明确以 worker_project_root_config_mismatch 结束。仅在 scratch 源码快照中补充该配置回显后重跑，未改正式包、产品校验或原断言；仓库原 fixture 未修改，初轮失败不记为通过。
- 匿名读取原 Latest 基线成功：v0.1.14，Release ID 444092207，共 11 个附件，保留附件 ID、大小和 digest 供发布前后比较。此前匿名 API 限流，恢复后取得基线，未把 403 当作无 Latest。

补齐 fixture 配置回显后，正式 ARM 包四场景隔离验收 4/4 通过、零跳过：发送与正常重启、未登录只读、完整进程崩溃后原会话及精确附件恢复、SILK 预览与访问控制。每次正常退出均核对 owner、runtime/gateway 锁及 lease 释放；未手动删锁。已查看实际合成界面截图，390/1440 宽度无横向溢出。未发送真实消息、调用付费模型或扩大权限；首次导览仅在隔离 profile 标记已读。


## 三平台完整校验与公开

plan、Mac ARM、Mac Intel、Windows 及 verify-draft 五个 job 均 success，同一 SHA / run / attempt，无重跑。11 个附件齐全。三平台原始回执的版本、build、来源、正式包标记及双服务地址均一致，按原始 basename 核对大小及 SHA-256；Windows 路径按分隔符规范化后匹配。Mac 两平台为 Developer ID 签名、公证及 stapled；Windows 为未签名 NSIS。Windows 的真实 electron-builder 清单契约步骤成功；latest.yml 固定标签 URL、大小及 SHA-512 字段已核对，完整包摘要验证由云端完成。未在本机重复下载 Intel / Windows 大包。

公开前回读双语正文逐字一致、全部附件上传完成，重新核对不可变标签以及原 Latest 的身份和附件基线未变。执行 gh release edit 时显式 draft=false、prerelease=false、latest=false，公开同一草稿，没有重传安装包、移动标签或部署官网。

[本版固定页面](https://github.com/wolf3c/homer/releases/tag/v0.1.15)，Release ID 445981017，公开时间 2026-11-15 18:59:48（Asia/Shanghai），draft=false、prerelease=false。匿名 API 回读正文、全部附件 ID/大小/digest 与发布前基线一致，复用云端完整下载校验证据。

- 本版固定链接及旧版 Latest 各抽查 3 个安装包，共 6 次匿名 Range GET，均返回 206，Content-Range、总大小、1024 字节样本及文件名正确。
- 本版与旧版各 8 个小附件，共 16 次匿名完整下载，大小与 SHA-256 全部一致；本版还与发布前下载字节比较一致。
- Latest 仍为 v0.1.14 / Release ID 444092207，11 个附件身份及摘要均未变，全部 Latest 直链均经过该版同名固定标签 URL。官网和采用 GitHub Latest 的客户端继续获得 0.1.14。
- Intel / Windows 实机、所有平台完整原生自动升级、真实账号及付费模型功能未验收，未将云端绿色或 ARM 手动验收替代这些证据。

### 本版公开附件基线

| 附件 | ID | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `Homer-mac-arm64.zip` | 750658359 | 409853535 | `aa20f2657881d6a8268195e82c1fe560105949ccab9d9476d4e3a98cf0fc49f9` |
| `Homer-mac-x64.zip` | 750681494 | 377868390 | `2ecf6f6e7b6fc8ef9712e8fa6c9d423eb78ba9977d1c2ffbeb62d07894fc7195` |
| `Homer-windows-x64.exe` | 750701980 | 291064723 | `bd18ca45a8e4b5addf9d9ba74124581b9f3e5f7311660a2c76796fa80126e960` |
| `latest.yml` | 750702277 | 484 | `b1b07f8df35d01bd7a9516845089d6ec7870aed3accd8a23b36eaae7a114ea1e` |
| `release-manifest-macos-arm64.json` | 750659893 | 977 | `83c63435999d7951ac2b3ac96e6f7c770163cb2a835cae2db2632c080bbf8071` |
| `release-manifest-macos-x64.json` | 750682387 | 963 | `ff147fc48b79eb987180674efbaffa7b2e393431ddfd35dc05199ce379ff3171` |
| `release-manifest-windows-x64.json` | 750702296 | 961 | `003ea657b5e2ef9b66fa735753126f3bb8e22eaa3f9c3d6aada26151680aef54` |
| `release-manifest.json` | 750703641 | 2643 | `cde0c479d198b5fac17c455167c4fa7f57b57f2460167f7815056ce616839420` |
| `RELEASES-darwin-arm64.json` | 750659845 | 319 | `cc08ef8947d05b862062ba48979dc114b63d44faf89323cf285a809097b7009e` |
| `RELEASES-darwin-x64.json` | 750682316 | 317 | `de8ef9a55318ceb31ae2b9ed0e87b6e26943883354cc9a0c8148e3e4b28e743b` |
| `SHA256SUMS` | 750703613 | 519 | `3f7f7eb425f2cc78ec95ad411ded16713c58f9be7c8a3787f9d048a20ce2d550` |

### 保留的原 Latest 附件基线

v0.1.14 / Release ID 444092207，发布前后完全一致。

| 附件 | ID | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `Homer-mac-arm64.zip` | 743224045 | 409875670 | `765d8c8b34dcbb36728ca8990c612bfc32c983e419ecc5ee89ce9c79b93b13b5` |
| `Homer-mac-x64.zip` | 743245804 | 377890511 | `943d2df988dab520d59f652ce16771f9f4271187b1ed4f91ea3981f88fd47b84` |
| `Homer-windows-x64.exe` | 743270881 | 291073609 | `8c85ea6313ec1ae351d08a85aa01c8576bb6ebcba89ba977eaa724407f05ce59` |
| `latest.yml` | 743271352 | 484 | `c0d9e6da3ffd4599270b44529118041e04fdf6c9849afe34f93f7991c412d98e` |
| `release-manifest-macos-arm64.json` | 743224823 | 977 | `6e4465d099755d4dd511a00a25676a95ba310addd0e4da8d132c4b5272b9ca73` |
| `release-manifest-macos-x64.json` | 743246616 | 963 | `456bc37228cdc5ec064c9adece9104883a2984869bc8c91059a53ad00afab188` |
| `release-manifest-windows-x64.json` | 743271469 | 961 | `8e4f07214b91c2f2fdfa07124ca38810ebeab9f87a0b1493297ad02ba21109a4` |
| `release-manifest.json` | 743273660 | 2643 | `37b6f9f2e62a8238434971a172508153805228e619988d116bba178ae0243eb1` |
| `RELEASES-darwin-arm64.json` | 743224784 | 319 | `4be1495dbc1892970abdc97f91712aed2824b85bd2af580e975ac253861111e4` |
| `RELEASES-darwin-x64.json` | 743246564 | 317 | `bffdb7ad76754f403e477ce0e8d2510843ad99c74ff0e0f046e050b78e8d3c12` |
| `SHA256SUMS` | 743273615 | 519 | `fa23a9ad487623bb8ca6f97ea20ae0055e2cda38bce604b98d83fb5e006863f9` |


## 首轮本机安装阻塞及保留材料（后续已解除）

发布后只读复核日常实际资料根 ~/Library/Application Support/Homer Desktop，无 adoption 外部路径；本机仍为 0.1.13 / build 298。1 个运行中 Worker 处于 rpc_wait，1 项 authorization 交互为 pending_main，另有 blocked 14 / received 1 / uncertain 1 的未处理 agent_receipts。安装版 upgradeStatus().safe 要求这些执行及交互、回执清空；本轮多次观察仍未满足，需在日常流程处理待授权工作，不能由发行任务擅自批准、取消或清队列。

因此没有停止日常实例、做停机备份或替换应用，没有改动日常资料或声明安装及数据保留核验完成。无需再次取得安装授权；后续空闲后仍须按 Skill 完成安全停机、完整备份、安装同一已验证包及资料核验。

保留 `.codex/scratch/github-build/43704742655/1/Homer-mac-arm64.zip`、ARM 原始回执，以及 metadata 下 release-manifest.json 和 SHA256SUMS，供同一 SHA / run / attempt 的安全安装及复核。安装与资料核验成功、或明确不再需要该版本安装时清理；可从原 ZIP 正常解压，不重新打包或下载。清理结果见下文。


## 本轮资源收尾

按 work-cleanup 核对本轮目录无打开文件后，删除源码快照、解压 App、合成 profile、截图、临时脚本及已完成验证的日志/重复清单，分配块合计约 1075.0 MiB；不将此值等同于 APFS 可用空间变化。保留上述安装 ZIP、ARM 回执及两份复核清单。日常应用、资料、共享 node_modules、其他任务工作、历史发行包及草稿均未触碰。


## 后续本机安装与原资料核验（2026-11-15）

用户明确授权正常停止卡住的 Worker、备份全部资料并安装 v0.1.15。再次核对时原执行及授权约 44 小时无进展。原应用已暂存 0.1.14，Cmd-Q 被旧版更新分支拦住，仅能进入“重启并更新”；取消该弹窗后，通过已安装运行时注册的 SIGTERM 正常停机处理器停止后台。Worker、宿主及 runtime 退出，owner、runtime/gateway 锁及全部 lease 正常释放；没有批准卡住的原生操作、手动清队列或删锁。随后向只剩界面的 Electron 主进程发送普通 SIGTERM，确认应用相关进程全部退出；没有使用 SIGKILL，也未安装暂存的 0.1.14。

退出前输入框为空，无待生效账号配置或聊天应用绑定变更。停机后完整备份原 Homer Desktop 资料根（无 adoption 外部资料路径），共 10,250 个文件、770,178,950 字节，逐文件 SHA-256 与源资料一致；11 个 SQLite 数据库 integrity_check 均通过。旧 0.1.13 / 298 应用另有完整逐文件核对副本。

复用 run 43704742655 / attempt 1 的同一 ARM ZIP；再次验证大小、SHA-256、封存版本/build、来源及双服务地址。签名、公证 stapling、Gatekeeper 通过，替换为 /Applications/Homer.app 的 0.1.15 / build 300 / b192bed0773d4339bbdcb821f083a414a8325897，安装位置再次 codesign deep/strict 通过。启动沿用原账号和同一资料根；设置已显示原 ChatGPT 账号已登录，原会话和可编辑输入框恢复。未为验收发送消息或调用付费模型；用户开始使用后停止界面操作，保留其新增草稿与资料。

与停机备份按主键及原字段逐记录比对：1,609 条原消息、59 条附件关联、33 个事项、122 条执行、1,336 条 Agent 消息及原操作、交互、媒体、设备记录均保留，未缺原行或原字段；除预期 meta/回执迁移外，原业务字段完全相同。183 个媒体、工作区、账号及配置文件逐字节相同，codex/auth.json 原凭据文件摘要一致。用户后续新增内容不回写或覆盖。

预期迁移仅涉及 recursiveSchemaVersion 7→8、mainPromptHash 及 Agent 回执 state/revision。使用安装包自身 inspectMainReceiptEvidence 对停机备份重新计算，1,203 条回执均与实际迁移目标一致；其中 1,198 条 state/revision 改变（processed 1,183、blocked 14、uncertain 1 转为有接收证据的 received）。没有将业务结果或未知副作用批量标记成功。启动时删除的 774 个旧文件均为插件缓存 771 个及宿主临时文件 3 个；旧文件仍保留在完整备份，原资料文件无缺失。业务库完整性检查通过。

渠道绑定另行核对：停机备份和升级后的正式 runtime 中均未找到 wechat.json、telegram.json 或 channels.sqlite；已检查的旧资料路径也未找到原绑定。因此上述资料保留核验不代表原微信、Telegram 绑定已恢复可用，原绑定何时、为何消失仍未确定。渠道即时生效的实现仍在未提交工作区，未进入 v0.1.15，正式包仍采用“应用并重启”流程。

停机备份、旧应用及私密逐文件/逐记录核验材料保留在 Git 忽略且权限 0700 的 `.codex/private/desktop-upgrade-0.1.15-20261115/`；账号和原聊天内容不进入公开文档。日常使用确认正常后再清理该备份。旧程序不能直接打开 schema 8；若需回退，先审查兼容性及新版新增写入，不用旧备份直接覆盖现有资料。

安装核验通过后按 work-cleanup 核对临时目录无打开文件，删除本轮 ZIP、重复旧应用、解压 staging 与重复小清单，分配块合计约 1321.8 MiB；保留停机备份及旧应用的单份回退副本。该结果是本机手动升级及数据保留验收，不代替完整原生自动升级或其他平台实机验收。Latest 仍保留 v0.1.14，本次未修改远端发行、官网或其他任务工作。


## 后续 Latest 切换（2026-11-15 20:07:26，Asia/Shanghai）

用户明确要求“将 Latest 切到 v0.1.15”。切换前原 Latest 为 v0.1.14 / Release ID 444092207；本版全部 11 个附件 ID、大小和 digest 与此前完整下载校验基线逐项一致。使用 gh release edit 的 latest 标记切换同一公开正式 Release，未移动标签、修改包字节或重传附件；同时将中英文正文中“暂不设为 Latest”的状态更新为当前事实，其余说明和验收边界保留。

认证 API 回读 Latest 和固定标签均为 v0.1.15 / Release ID 445981017，非草稿、非预发布，正文逐字一致，全部附件身份和摘要不变。匿名 API 受 GitHub 限流，本轮未取得匿名 API 回读；匿名 Latest 页面实际重定向到 v0.1.15。固定标签及 Latest 共 6 次安装包 1024 字节 Range GET 全部 206，Content-Range 总大小、样本长度及文件名一致；16 次小附件匿名完整下载 SHA-256/大小全部通过。所有 Latest 附件直链均经过 v0.1.15 的同名固定标签地址，涵盖三平台包、Mac 两架构更新清单、Windows latest.yml 及摘要/来源清单。

官网下载和使用 GitHub Latest 的客户端更新入口随之切换到 v0.1.15；本轮未修改或部署官网。完整原生自动升级及 Intel/Windows 实机仍未验收，不将本次分发核验写为这些场景已通过。临时核验脚本、正文副本及清单已按 work-cleanup 清理；本记录保留本轮来源、切换决策及验证边界。
