# Homer 桌面 v0.1.17 修复发行

状态：2026-11-17，v0.1.17 / build 302 已公开并设为 Latest，Release ID 447249295。三平台构建、11 附件云端完整校验、发布后匿名固定/Latest 分发及 ARM 核心隔离验收通过；本机完成安全停止、完整备份、已授权单行网关绑定转换和手动安装，原账号与逐条资料保留通过。系统唤醒清理确认提示仍待单独排查，未修改系统权限。其他任务未提交改动未进入本轮提交或包；下文草稿阶段保留当时的检查快照，最终结果见文末。

## 范围与来源

- 基线 `ee89cce37b89691db09b8c3ed0b5a66dbf100c86`；原 Latest 为 v0.1.16 / build 301，本机为 v0.1.15 / build 300。新标签 v0.1.17 核对未占用；已公开及可读取草稿最大 build 为 301。
- 产品仅修改 `scripts/desktop-profile.mjs` 的既有资料校验及 `src/main-process.ts` 的共享 SQL。资料标记中非空 Codex 建档版本作为原记录保留；实际数据库格式、路径和模式、安装包引擎锁及原生线程恢复继续检查兼容性。
- 仅放行已结束节点中、精确对应该工具同轮原生 completed 的历史 `webSearch unknown`。不修改历史记录，不重放工具；缺少或错配凭据、仍在运行的搜索、命令、文件修改和外部工具继续阻塞。四个现有调用方复用相同判定；升级接口及停止流程不变。
- 本次提交还包含相关回归、既有升级/架构文档与发行版本字段；合成桌面服务补齐现有 `project_root_markers` 配置回显，避免 fixture 丢字段使正式包验收失真。按保留的增量补丁分离同文件中其他任务的改动；不提交整份脏文件。

## 已完成源码验证

使用 Node 22.22.0、隔离 HOME/CODEX_HOME 与临时数据库：

- 资料入口、共享 SQL 四个调用方及桌面 runtime 定向回归 106/106，零跳过；实际格式不支持、非法路径、模式冲突及安全断言保留。
- 固定原生引擎 0.163.0 → 0.171.0-alpha.7 线程连续性专项 7/7，零跳过；历史、记忆与精确工具回执保留，不重放。使用本地合成服务，不调用生产模型。
- 精确临时索引导出本次修复及 0.1.17 版本组合，定向回归重新 106/106；类型检查、源码构建通过。发行规划及草稿协议 29/29 通过。
- 核心套件 2700/2702，零跳过；两个 `message-image-preview.test.mjs` 失败在无本次补丁的相同基线均复现。其他任务的未提交图片修复不纳入发行，不删改断言。
- 正式安装包读取旧 profile、本机实际安装与原资料保留尚待下方执行记录；源码/引擎证据不能代替这些阶段。

## 构建及升级边界

- desktop / desktop-three / v0.1.17 / build 302，固定最终提交 SHA 和同一 run / attempt，草稿直传及云端完整下载摘要核验。
- Mac ARM 为 macOS 27+，Intel 为 macOS 14+，Developer ID 签名、公证及 stapling；Windows 11 x64 未签名 NSIS。网站 `https://super-tree.com`，网关 `https://models.super-tree.com`。仅 ARM 做本机隔离和日常资料验收；Intel / Windows 实机及完整原生自动更新证据仍未覆盖。
- v0.1.16 已发布字节不改。旧版运行中的错误升级门禁不会被新包替换，首次恢复须复用原有 owner 停止确认，完整备份后手动安装验证过的修复包。
- 用户已授权放弃内存中尚未生效的 1 项连接变更；停机前仍核对当前执行、草稿和停止确认。原账号、资料根、会话和用户文件保留，不初始化新 profile、不为验收发送真实消息。
- 若新版启动或资料核验失败，保留升级后资料和停机备份，先检查兼容性及新增写入，再决定回退；不能直接覆盖备份。
- 发布前复核双语 Release 正文、旧 Latest 与候选附件基线；公开同一草稿并按本轮授权设为 Latest，随后验证固定及 Latest 匿名下载。官网无需改动或部署。


## 构建与 ARM 验收进展

- 修复发行提交 `98a5fa4ea854f9fec53b9cced0b7580831f3e079` 只含本轮 15 个文件的增量；其他任务三个原有暂存文件的 blob 保持不变。同文件其他未提交片段未暂存。main 与不可变 v0.1.17 标签远端回读一致。
- [运行 43899035705 / attempt 1](https://github.com/wolf3c/homer/actions/runs/43899035705/attempts/1)，操作者 wolf3c，workflow_dispatch，desktop / desktop-three / build 302，来源固定上述完整 SHA。仅一次触发，无重跑或混合 attempt。
- ARM ZIP 为 426,537,459 字节，SHA-256 `485e73996b383250a1e6d645c8a20d2e592818af462e9373849a0f82cc2eeb98`；原始回执、平台清单及包内封存清单的来源、版本/build、正式标记与双服务地址一致。codesign deep/strict、stapler 和 Gatekeeper 通过，Notarized Developer ID。
- 实际 Electron 四场景 4/4、零跳过：原会话正常重启、未登录只读、完整进程崩溃后的原线程与精确附件恢复、SILK 预览及附件访问控制。隔离验收临时 harness 仅在 launch 后用正常关闭按钮消除首次功能导览遮挡，原测试断言和产品包字节不改；合成服务使用本次已提交的配置回显修正。
- 完整 runtime 专项 9/13、零跳过：本轮旧 Codex 0.163 标记、原账号记录、历史/附件/同线程重启案例通过；路径安全、未知 owner 和 schema 5 拒绝等通过。四项扩展失败为 `review refusal preserves an unowned active Worker` 的合成 `task_authority_source_denied`、`adoption requires reviewed gateway CAS` 的当前 schema 8 与旧断言 7 不符，以及两项 `daily website uses max ...` 状态超时。未删改这些安全断言，不将整套专项记为通过。以未改动的 0.1.16 正式包、相同合成 fixture 只重跑这四项，4/4 复现相同错误；这是既有缺口，不能据此把它们记为已验收。
- 正常停止案例核对 owner、runtime/gateway 锁及 lease 释放，无手动删锁；未发送真实消息或调用生产模型。Intel / Windows 实机和完整原生升级尚未验收。

## 本机首次恢复新增检查

只读核对日常资料根为系统默认 Homer Desktop，无外部 adoption 路径，资料标记保留 Codex 0.163；安装版仍为 0.1.15 / build 300。对同一日常数据库分别调用安装版与本次原包的 `RecursiveTasks.safeToUpgrade()`：前者 false，后者 true；未构造可写 Store 或修改任何记录。唯一历史未知工具为同轮 native completed 的 webSearch，其他执行/交互检查仍适用。

进一步确认原方案未涵盖的网关安全绑定：现有 `transport_meta.binding` 精确匹配同账号路径的 0.163 引擎边界，不匹配 0.171；待处理 transport 请求为 0。新包的严格既有检查将拒绝 `gateway_binding_conflict`，两处源码修复不能代替这项检查。最小本机处理为安全停机并完整备份后，以已核对旧值为条件 CAS 更新这一条绑定；其余 metadata、transport 请求和业务记录不变，不放宽产品绑定检查。

该单行操作已在只读快照上试演：CAS 恰为 1 行、其他记录逐字相同、完整性检查通过并回滚；原资料未改动。因为这是计划之外的持久化安全绑定变更，已单独请求明确决定，尚未执行。窗口读取工具持续超时，未发送草稿也待用户核实；此前已获准放弃的 1 项内存待生效连接变更不重复询问。

原 0.1.15 应用已复制到 Git 忽略、0700 的本轮 private 恢复目录并通过 deep/strict 签名校验，以防旧 ShipIt 在退出时自动替换；完整停机资料备份及安装尚未执行。本轮新包保持草稿，尚未公开或切换 Latest；后续实际结果继续追加，不以包内合成验收替代日常资料验收。


## 三平台完整校验与草稿阶段快照（2026-11-17）

plan、Mac ARM、Mac Intel、Windows、verify-draft 五个 job 均 success，同一 SHA / run / attempt。verify-draft 在云端完整流式下载请求集合并核对大小和 SHA-256；本机核对三份原始小回执、ARM 原 ZIP 和全部八个小附件。两份 Mac 回执为 Developer ID、公证和 stapling；Windows 回执明确未签名，工作流的真实 electron-builder 更新清单契约步骤通过。Intel / Windows 大包没有在本机重复下载，其完整摘要证据来自云端；原生平台和完整自动升级缺口保持原状。

11 个附件均 uploaded，平台/合并清单的版本、build、完整源码、run / attempt、包和更新清单摘要完全对应。双语草稿正文回读逐字一致，包含首次旧引擎网关绑定转换限制，不宣传仅换包即可恢复。原 Latest 的匿名 API 为 HTTP 200，仍为 v0.1.16 / Release ID 447024680，11 个附件 ID、名称、大小和 digest 与认证基线一致。没有公开本版，尚未执行本版固定标签或 Latest 匿名下载验收。

| 附件 | ID | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `Homer-mac-arm64.zip` | 755433179 | 426537459 | `485e73996b383250a1e6d645c8a20d2e592818af462e9373849a0f82cc2eeb98` |
| `Homer-mac-x64.zip` | 755474123 | 395456818 | `8472b8b8438588453d799c1e12e81b48564e0a183650186969b478e3e8d8f138` |
| `Homer-windows-x64.exe` | 755503256 | 305306699 | `ff95543f966e995c292a5186f45dcb796839618e5a5d4942610ca4d0e609910a` |
| `latest.yml` | 755504128 | 484 | `a74d0ea82c091e52fb5006ecf0f4704b199aed4b7e65a844f3b7dc99dc9180ef` |
| `release-manifest-macos-arm64.json` | 755434242 | 977 | `411018397d984be012eb9e5e5b321d19a7012b27ca15433e5f80c16a067f3625` |
| `release-manifest-macos-x64.json` | 755475301 | 963 | `d34b526a1605d5281edbdc63f5c1c6e224ce48d0e068f39a63258d413b5f6b10` |
| `release-manifest-windows-x64.json` | 755504201 | 961 | `b12a9384d210db3fce301cc1b8a3da06310ae2b7fc45845584e5fa873572b761` |
| `release-manifest.json` | 755507863 | 2643 | `a81969b71e3ebab5aadaab815a0eb5b869c4a0426d9bf3de5f73adaa4474d791` |
| `RELEASES-darwin-arm64.json` | 755434150 | 319 | `e0d1c5fdaca5d00d810fd97c9ba0ba02f0136fa7d7ec56b341d3e07b9e80f5f9` |
| `RELEASES-darwin-x64.json` | 755475249 | 317 | `a8275337a8fc7f2627e995e9a8510f4ee053e5bbb04df96747d948d611725d03` |
| `SHA256SUMS` | 755507775 | 519 | `2b2657c0315e2076c1bb35dc9f569061c0834030b18caa59e45ab95e45ba266f` |

草稿阶段曾停留在已完整校验的同一草稿：用户对是否有未发送草稿及单行安全绑定 CAS 的答复尚未收到，不能把等待视为同意。待决定后须重新核对实际执行、owner 正常停止和锁/lease 释放，完成完整资料停机备份，才执行绑定转换、同一原包安装和按原记录/文件核验；原资料仍未修改。发布、Latest 与本机升级授权不重复询问，此处等待仅针对新发现的计划外绑定变更与无法直接核实的草稿事实。

按 work-cleanup 核对无进程占用，回收本轮隔离源码/重复构建及 runtime、旧包对照、Electron 合成 profile，共 127,090,688 分配字节；不将其视为 APFS 可用空间精确增量。保留 `.codex/scratch/github-build/43899035705/1/` 已验证的 ARM ZIP 与原签名 App 供未完成安装复用；保留本轮 private 旧 0.1.15 App 供恢复，完整停机资料备份尚未生成。小回执、清单、harness 差异和摘要仅用于完成本次阻塞后的验收；安装和日常资料核验完成后回收重复包/副本，停机备份待确认日常使用正常后再清理。其他任务暂存、未提交文件和日常数据未清理。


## 已授权公开、Latest 与本机升级完成（2026-11-17）

用户明确确认没有未发送草稿，授权安全停机和完整备份后仅转换这一条网关绑定，并继续公开 0.1.17、设为 Latest、安装及原资料验收。此前放弃 1 项内存待生效连接变更的决定沿用；没有追加源代码、依赖、实体、IPC 或其他未提交修复。

- 发布前重新核对相同 Release ID、固定标签 SHA、11 附件 ID/大小/digest 及逐字双语正文，与草稿完整校验基线一致。公开同一 Release 并设为 Latest，无重传或覆盖附件、无标签移动。[公开页面](https://github.com/wolf3c/homer/releases/tag/v0.1.17)，发布时间 **2026-11-17 10:26:02（Asia/Shanghai）**；Latest 从 v0.1.16 / ID 447024680 切换为本版 / ID 447249295。
- 发布后匿名固定标签及 Latest API 均 HTTP 200，身份、正式状态、11 附件元数据和最终双语正文一致。初轮匿名 API 403 / remaining=0 保留为限流，恢复后补验通过；未把限流当作不存在或通过。三平台固定及 Latest 包直链共 **6 项 1 KiB Range GET** 均为 206，Content-Range、总大小、文件名和实际 1024 字节吻合；Latest 均跳到本版固定标签。固定及 Latest 的 8 个小附件分别完整下载，共 **16 项大小/摘要检查**通过。大包继续复用云端完整 SHA-256 与相同附件身份，不在发布后全平台重复下载。
- 停机前执行、待答交互、待处理操作及 working Main 均为零；相同日常数据库上的安装版安全检查 false、本版 true，原历史记录未改写。使用旧 runtime 已有 SIGTERM 正常停止处理，等待全部 owner、runtime/gateway 锁和 lease 释放；再软退出无业务 owner 的旧界面。没有 SIGKILL 或删锁。旧 ShipIt 随退出应用了缓存 0.1.16 / build 301，但 `launchAfterInstallation=false`，没有启动该包；原 0.1.15 签名应用已事先保留。
- 资料根无外部 adoption 路径。完整停机备份覆盖账号凭据文件、原数据库、附件、工作区及 Electron 状态：**10,090 个文件、5 个符号链接、788,923,259 字节**，逐文件字节和权限与稳定原目录一致；识别的 **11 个 SQLite** 完整性均为 ok，foreign-key violation 为 0。备份及原应用仅保存在 Git 忽略、0700 的本轮 private 恢复目录，用户内容和凭据未进入本文或提交。
- 备份验证后，以已核对的旧边界 CAS 恰好更新 **1 条** `transport_meta.binding`。其他网关 metadata、全部 transport 请求及表结构逐字相同；业务主库文件和 profile 标记字节当时完全未变。启动后既有流程将 gateway contract 更新为本包 schema/tools 摘要，原 thread 绑定保留；这与人工 CAS 分开记录。
- 安装复用同一 run 43899035705 / attempt 1 的原 ARM ZIP，重新核对 SHA-256、版本/build、完整来源与双服务地址；macOS 27.2 / ARM64 上暂存校验、原子替换后 codesign deep/strict、stapler、Gatekeeper 均通过。实际运行路径为 `/Applications/Homer.app`，**0.1.17 / build 302**，来源仍为 `98a5fa4ea854f9fec53b9cced0b7580831f3e079`。

### 原资料逐条及文件核验

原 ChatGPT 登录被包内原生 `login status` 正常识别；原主会话 ID 保留。对停机备份与实际运行资料按主键、全部原字段核对，原有业务记录均无缺失且未改写：**1,767 条消息、60 条附件记录、33 项任务、133 次执行**，以及操作、消息回执、媒体记录等均保留。不是只比总数。

原生历史 **14,902 个条目和 1,486 轮次**逐条全部原字段相同，无新增轮次或工具重放；**27 份 stage1 记忆输出**及原记忆/目标/队列记录保留。原 rollout 变化仅为追加，旧文件全部原字节仍为前缀。**57 个工作区文件**逐文件不变，原媒体/附件文件及用户自定义 Skill 未缺失或改变；原 `desktop-profile.json`、`codex/auth.json`、`codex/config.toml` 字节相同，根配置不变。

已区分并核对的预期变化为主提示摘要、已授权网关绑定和包 contract、活跃 lease/派生缓存，以及主线程恢复时间和原生投影字节位置。原生引擎新增 state 库 **2 条**、history 库 **1 条**迁移记录，旧记录仍在；不能用旧引擎版本字符串或总行数替代格式判断。主线程恢复采用原文件已保存的 workspace-write / on-request / 联网配置，原权限配置文件未改写；上轮线程中只读 policy 记录不作为当前选择。原生管理的插件版本缓存、模型目录及 `.system` Skill 刷新与用户文件保留分开记录，未手工迁移或删除用户资料。

菜单退出时业务 owner、三个锁及 lease 均已正常释放。退出出现“系统唤醒清理未确认”提示：只读 `pmset` 检查的 Homer 唤醒事件和电源保护均为 **0**，通过产品现有“仍然退出”选项退出后重开，账号、同一主会话及上述逐条数据再次复验通过；没有修改系统权限。**系统清理确认本身未通过，作为已观察到的限制写入本版双语说明，待专项排查，不将整套系统唤醒验收记绿。** 本次没有发送真实用户消息或调用付费模型；Intel / Windows 实机、完整原生自动升级、实际睡眠唤醒仍未验收，原有核心 2 项和 runtime 4 项基线失败保持原记录。

### 最终收尾与恢复材料

按 work-cleanup 确认无占用后，回收本次临时旧 0.1.16 壳、重复解压 0.1.17 App 和已成功安装的 ZIP，合计 **2,484,285,440 分配字节**，不等同于 APFS 可用空间精确增量；此前本轮测试/索引等副本已单独回收。保留 `.codex/private/desktop-upgrade-0.1.17/20261116-build302/` 中原签名 0.1.15 应用、完整停机资料及小型验收记录，供用户确认日常使用正常前的故障恢复。用户确认无需恢复后再清理；新版已发生原生格式迁移，未来如需回退，先检查兼容性及新增写入，不能直接覆盖备份。其他任务的暂存和未提交内容保持原样。
