# Homer 桌面 v0.1.17 修复发行

状态：2026-11-17，v0.1.17 / build 302 三平台构建及 11 附件云端完整下载校验通过，ARM 核心隔离验收通过。Release ID 447249295 保持草稿；新发现的旧网关安全绑定及草稿核对仍待决定，尚未公开、切换 Latest 或更换本机。用户本轮授权本次修复单独提交、推送 main、正式签名公证、三平台构建发布并设为 Latest，再完成本机升级及原资料保留验收；其他未提交改动不进入发行。

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


## 三平台完整校验与当前停留点（2026-11-17）

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

当前停留在已完整校验的同一草稿：用户对是否有未发送草稿及单行安全绑定 CAS 的答复尚未收到，不能把等待视为同意。待决定后须重新核对实际执行、owner 正常停止和锁/lease 释放，完成完整资料停机备份，才执行绑定转换、同一原包安装和按原记录/文件核验；原资料仍未修改。发布、Latest 与本机升级授权不重复询问，此处等待仅针对新发现的计划外绑定变更与无法直接核实的草稿事实。

按 work-cleanup 核对无进程占用，回收本轮隔离源码/重复构建及 runtime、旧包对照、Electron 合成 profile，共 127,090,688 分配字节；不将其视为 APFS 可用空间精确增量。保留 `.codex/scratch/github-build/43899035705/1/` 已验证的 ARM ZIP 与原签名 App 供未完成安装复用；保留本轮 private 旧 0.1.15 App 供恢复，完整停机资料备份尚未生成。小回执、清单、harness 差异和摘要仅用于完成本次阻塞后的验收；安装和日常资料核验完成后回收重复包/副本，停机备份待确认日常使用正常后再清理。其他任务暂存、未提交文件和日常数据未清理。
