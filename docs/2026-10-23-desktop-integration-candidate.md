# 桌面整合候选计划（未发布）

2026-10-23，基线 `3c5461180575aa90f9430f35152f444530185913`。本任务只在登记隔离 worktree 制作候选及补丁；不修改 main、不提交、不安装。完成标准是可审阅的准确差异、来源清单和有边界的构建/冷启动证据。

目前 CLI/Web 与桌面旧候选分离。目标是复用已有 Swift/AppKit/WKWebView 包装，包内运行当前前后端，同时保持应用身份、桌面专属数据路径、原业务状态机和权限合同。风险集中在未就绪状态、严格退出、资源身份和编译输入；用隔离合成数据验证，不接生产账号、不调用模型。

准确计划范围：

- 新增 `packaging/macos/{HomerApplication.swift,ImageDecoder.swift,Info.plist,dependencies-lock.json,distribution-policy.json,node-distribution-entitlements.plist}`：取归档已核 SHA 文件，不引入旧137文件基线。
- 新增 `scripts/{desktop-runtime.mjs,desktop-profile.mjs,prepare-desktop-dependencies.mjs,macos-distribution.mjs}`：复用现有脚本，按当前schema/历史协议接线；生产配置/账号迁入不在本候选执行。
- 新增 `scripts/{build-macos-desktop.mjs,desktop-source.mjs}`：重写输入选择部分，以显式准确Git SHA完整树导出；不覆盖7个旧owner、不套旧Logo补丁。准备模式只能覆盖本计划明确文件，并记录候选来源hash及不可发布标记；正式构建拒绝准备输入。
- 新增 `src/{desktop-resources.ts,desktop-management.ts}`；按hunk修改 `src/{config.ts,dev-host.ts,service.ts,engine.ts,media-decode.ts}` 与 `scripts/dev.mjs`：接入包身份、随包解码器、就绪与严格退出。保留当前主队列/自动回传/schema/权限owner。桌面未就绪只允许状态读取，不恢复已经删除的能力管理/登录HTTP页面。
- 修改 `ui/homer-app.tsx` 中未就绪状态说明，保留原组件/布局，不新增登录入口或旧能力页面。
- 新增 `tests/{desktop-service-startup.test.mjs,desktop-profile.test.mjs,desktop-source.test.mjs,desktop-management.test.mjs,macos-desktop-runtime.test.mjs}` 及 `tests/fixtures/desktop-app-server.mjs`；仅保留适用于当前合同的隔离用例，不导入旧逻辑记忆断言。
- 补充范围：`scripts/seamless-synthetic-fixture.mjs` 的现有假引擎注入需要覆盖新桌面就绪函数的版本读取；仍只替换 `codexVersion(...)`，避免夹具删掉导入后编译失败，不改真实运行入口或测试断言。
- 补充接线：已提交Finder owner在当前launcher/host遗漏转发。包内合成红例得到 `artifact_reveal_unsupported`，将在已有 `scripts/dev.mjs`、`src/dev-host.ts` 各补一个转发分支；沿原 `homerWebBridge.revealArtifact` 和成果授权校验，不增加系统命令或新权限。
- 本说明与 `docs/2026-10-23-desktop-release-readiness.md`、最终非敏感来源/补丁清单和验收记录。

先运行严格停止/启动失败的红例，再适配原有行为，随后源码类型、Web类型/build、官方CSS、准确Git输入与准备标记检查、隔离包冷启动/同thread重启/数据保留/未知owner拒绝。完整系统签名要在宿主上下文验证；准备包采用原有本机候选签名，不声称Developer ID、公证或已安装。若当前无登录入口与旧桌面首次登录合同发生冲突，保持删除决定，准确列为发布待决事项，不通过旧页面重新引入。

## 2026-10-23 候选结果

已在原登记worktree完成最小桌面接线，main和本分支HEAD仍为上述基线，没有commit/merge/main写入或安装。代码建议提交范围为来源清单中的28个文件；本说明、近期盘点及两个身份/验收JSON为配套文档。补丁：[完整候选](patches/2026-10-23-desktop-integration-candidate.patch)；[来源与逐文件身份](patches/2026-10-23-desktop-integration-sources.json)；[脱敏验收索引](patches/2026-10-23-desktop-integration-verification.json)。暂存区保持未改动，本任务临时依赖链接已移除。完整补丁从准确基线执行dry-run及独立重放，32个结果文件与候选逐字节一致（28个代码文件、4个配套文档），没有依赖隐藏dirty或暂存输入。

构建入口为 `scripts/build-macos-desktop.mjs --source-sha <完整SHA>`。正式模式从Git archive读取完整已提交树，逐项核对执行中的桌面构建入口；缺未提交桌面代码时拒绝，而不是回退读dirty。准备模式必须显式 `--prepare-candidate`，仅覆盖 `DESKTOP_CANDIDATE_PATHS` 中22个桌面/夹具文件，记录路径及SHA，不能使用distribution模式。其manifest为 `preparation:true,publishable:false`，原生壳和runtime均拒绝真实profile。旧137项产品锁、7个旧owner覆盖以及旧Logo/UI补丁拼装已移除。源码输入、构建输出与维护源分离，仅只读复用维护源依赖。

共享owner只合入桌面增量：包身份保护、随包ImageIO/解码边界、已有账号就绪判断、当前history protocol3、未就绪禁写和严格退出。保留当前主队列与自动回传、schema4以及原授权校验；未修改schema owner或权限政策。未就绪空状态复用原 `projectConversation`，避免另建字段合同。Finder仅补launcher/host转发，缺授权请求必须在原成果owner被拒绝，不执行系统动作。旧能力/登录HTTP页面仍为404；管理阶段只读状态，未恢复登录或安装入口。

准备包位于任务scratch `desktop-integration-20261023/build-006/Homer.app`，版本0.1.0 build4，稳定bundle identifier `app.homer.desktop.candidate`，Git基线 `3c5461180575aa90f9430f35152f444530185913`。它是**未提交准备包**，不是仅凭该基线即可复现的正式发布；准确候选还依赖来源清单所列桌面增量。构建Node固定22.22.0，随包Node22.22.0/Codex0.163.0、89个生产JS包。sourceHash `71a077e3aad139f78be2c90b2bfa29d801442b080b2e7d687446e942fd918261`，Homer manifest `26d96f8d5e8970aa388542edeedee5812c696be019ba055432bf26ecda79b86e`，UI hash `6a055aa6cec649409da84baaf352efa58fa685ddc839c4cfb3aac68476aea2a5`。ZIP 182800933字节，SHA256 `d6f83c44477bb2ab44e1cc2c227f867bfc7b7f04571d05d8a6c90062e29c0db6`。正常宿主深度严格签名验证exit0；当前是原有ad-hoc本机候选签名，没有Developer ID/公证/Gatekeeper或干净Mac新验收，未清quarantine。

| 验证 | 实际结果与限界 |
| --- | --- |
| 启动/停止红绿 | 原main 5项中3失败，接回旧租约/管理保留/严格停止合同后5/5通过 |
| 最终桌面合同/完整Git输入/profile | 12/12通过；普通模式拒绝未提交入口，准备模式只覆盖明确名单；原主队列、history、tools、web-server和状态UI字节保留准确Git输入 |
| 最终源码/Web类型、Vite、Swift | 准确build006实际构建通过；Swift保留归档已有actor隔离警告，未冒称零警告 |
| 官方CSS | 从候选源码source-only快照重现全部官方CSS分支，通过 |
| 包内原入口 | build006的3项完整测试通过：Finder原owner拒绝、未连接账号只读/空journal、当前history3/队列/上传/原thread重启/文件保留/integrity ok/FK0/第二owner拒绝。全部使用合成profile/假原生协议，无真实模型或Finder动作 |
| 浏览器 | 最终包实际UI资源：148项通过，320/390/1440等屏宽；2000任务首批20行、折叠0进展请求、下一批40且保焦点；8000任务320px无横溢。独立无账号Chrome、无外网/业务写入；合成耗时不是生产性能承诺 |
| 真实原生窗口 | 最终build006实际WK渲染/可编辑/无横溢，重开原合成profile保留thread及历史。最终build006由用户在确认框正常退出，实际回执stopAcknowledged=true/exit0；进程消失、桌面owner及两层租约已释放。自动操作曾受CUA_UNAVAILABLE阻断，未强杀或清锁 |
| 共享回归 | 原组合52项通过；修正假引擎夹具的版本读取替换后，完整网关另1项通过。Web宿主1项401期望/409实际，在准确未修改main的Node22前像同样复现；未改弱断言 |
| 旧T08累计超时 | 原main准确前像Node22的单项12秒内仍不结束，正常终止本次合成进程组；候选组合按精确名称排除，不记作通过 |
| 全项目类型 | 准确提交前像137条、最终候选137条，归一化源码绝对路径后逐条完全一致，新增0。其他任务“24条”属于当时组合工作区，不能套用于本次Git提交树 |

全部原始检查位于本worktree `.codex/scratch/desktop-integration-20261023/`；索引只包含非敏感身份和结果，不纳入真实账号或对话正文。WK验收窗口后来出现人工新增输入，这份profile及原生探针证据保持原位；它不再视为可以直接删除的纯合成数据，不把内容写入本说明或公开验收JSON。已提示其使用合成引擎而非已安装生产应用。

本轮发现并修正：旧schema指纹引用已移除的memory-store、重启只接受旧schema3、准备包可能选择真实profile、未就绪返回类型丢orderWarning合同、已提交Finder缺IPC转发。现有数据schema、历史、业务实体和原账号owner没有迁移或重写。改动均在隔离候选，未拼入正式发行包。

## 尚未满足的正式安装条件

1. CTO审阅准确28文件补丁并处理具体提交授权，使闭包真实进入main；后续才选择并冻结完整提交SHA。当前不代提交或合并他人dirty，不以本准备包直接安装。
2. 原桌面保持 `Application Support/Homer Desktop/{runtime,workspace,codex,host-home,tmp}` 及标记/owner合同。当前开发版Homer的独立HOME、账号、原thread、数据和引用**没有迁入、复制或重绑定**；已有桌面迁入脚本仅合成演练。真实数据采用方式需要准确mapping、owner/租约停写证据和维护点预演，不能新建空账号冒充连续性。
3. 最新产品删除了能力/登录页，本候选保留删除决定。因此已有账号可自动启动，未连接账号明确停在只读阶段；没有可用的首次登录入口。需要原owner明确“原账号采用/首次连接”路径，不在发布任务恢复旧页面或引入新认证方案。
最终原生窗口退出条件已满足：用户确认点击“退出并停止工作”，随后核实最终包stopAcknowledged=true、exit0、无进程及owner/锁残留。人工新增输入和对应profile仍保留，不随构建清理。

这些是准确待审事项，不是已安装结果。正式安装仍按发布Skill：候选冷启动通过→实际owner/写入核查→正常退出与一致维护点→正常安装→已安装路径/包/前后端身份及数据连续性验收→清理本次和旧无用安装包。没有真实模型/Fast速度、生产迁入、真实Finder选中、第二Mac或无障碍/IME实测结论。

## 本次准备材料清理

期间出现ENOSPC，先核每一旧准备目录lsof无运行引用、保留来源和构建身份，再删除本任务已替代的build001部分输出及build002–005目录。累计删除逻辑文件大小6151386088字节；这是准备阶段废弃副本回收，不等于APFS物理释放，也不等于安装后的全量收尾。保留build006、所需官方原档案缓存、日志与最小重现材料，旧公证恢复包、真实用户数据、源码历史和当前WK profile均未删。没有挂载DMG/临时卷。
