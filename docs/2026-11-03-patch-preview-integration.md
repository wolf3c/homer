# 补丁成果预览接入与验收（2026-11-03）

已把 `patch-preview-fd959038` 的固定 DiffViewer 候选适配到当前维护源码。只修改预览、依赖、样式、测试和相关说明。初次接入未提交；随后获准审阅、提交到本地 main 并清理旧候选 worktree。未推送、安装、发布或操作日常 Homer。日期按 Asia/Shanghai；最终审阅结果见文末。

## 行为与适配

- `.patch/.diff` 配合空、generic、plain MIME，或专用 diff/patch MIME，走独立差异预览；明确的 HTML、Markdown、JSON、图片、音视频、PDF MIME 保留原路径。
- 复用固定 assistant-ui DiffViewer 的 unified 视图、增删统计、行号和逐文件复制；最终审阅启用组件已有的每文件前200行折叠，按需展开全部，完整复制与下载不截断。补丁只作为文本解析，不执行或应用，也不进入普通文本批注。
- “原始补丁文本”位于差异内容前，下载入口位于原文前。下载沿当前 `saveBlob`，保留完整原始 Blob、文件名和移动 WebView 分享路径；失败显示提示，成功重试清除提示。
- 超过 256 KiB／2,000 行、空白、无 unified hunk、binary／combined 或解码异常时回退原文；超字节门槛只解码前 128 KiB。完整 Blob 仍受现有服务读取和移动分享大小限制。解析／渲染错误保留原文与下载；懒加载失败不自动重试，需刷新页面重新加载。
- 实际浏览器发现原文展开会使 flex 容器内的差异区域被压缩，已以局部 CSS 禁止该压缩、限制原文区域高度。窄屏复制和原文操作至少44px，保留现有 Tabs／关闭／收起与焦点机制。
- 仅新增原候选三项精确依赖：`diff@9.0.0`、`parse-diff@0.12.0`、`class-variance-authority@0.7.1`。对照本轮开始时 lock，只有三个新增包节点及 UI workspace 声明变化，既有节点未升级或移除。两份固定 vendor 源码与旧候选逐字节一致，来源和许可在 vendor README／Vite notices 中保留。

## 验收清单与结果

覆盖正常多文件、文件新增／删除、长名／长行、原文展开、复制／下载、异常回退、切标签／收起重开、加载边界、既有格式和移动下载适配。离线测试验证结构与协议；浏览器使用实际生产 UI、合成 HTTP owner 和独立 Chrome profile，不使用账号或模型。

| 检查 | 结果 |
| --- | --- |
| 红灯复现 | 接入前 generic MIME `.PATCH` 无 DiffViewer 的行为断言失败 |
| 补丁离线用例 | 最终 13/13 通过，含真实 parser、MIME 优先、门槛、错误边界、HTTP 拒绝／重试、迟到响应、URL 清理、载荷转义、复制与下载适配 |
| 移动客户端离线 | 12/12 通过，含共用 `saveBlob` 分享及已有大小限制；不代表手机原生分享验收 |
| 相关离线回归 | 39/39 通过：official-canvas、HTML、annotation-comment-form、annotation-draft、preview-reference、collections、transport、message-image-preview |
| UI 类型检查 | `tsc -p ui/tsconfig.json --noEmit` 通过 |
| CSS | Canvas 样式生成与 `--check` 通过 |
| 生产 UI 构建 | Vite 通过，输出仅位于本轮 scratch；有既有大 chunk 提醒 |
| 补丁真实浏览器 | Chrome 156.0.8078.80，1440×900／390×900／320×900，每屏9项，共27项通过 |
| 媒体适配复查 | 隔离校正旧脚本后，同三屏共39项通过；原脚本失败和校正范围见下文 |
| 人工视觉审阅 | 已逐张查看三屏正常视图及原文、超限、二进制回退截图；无页面横向溢出、差异被原文挤瘪或操作不可达现象；IAB 另核对实际组件和最终回退界面 |

补丁浏览器检查包含真实键盘事件、操作系统剪贴板读回、原文件下载逐字节比对、原生 details／Tab 路径、lazy chunk 不提前加载、1,980 行实际渲染、关闭后的 Blob URL 释放。浏览器错误和页面外部请求均为零，合成 engine 调用为零。页面不添加测试专用产品逻辑。

局部性能只代表本机合成数据：三屏首次差异可见耗时分别为354／394／380ms（含驱动、读取、加载），本轮记录到最长 long task 为206／209／204ms，包含多行压力案例；不能宣称无卡顿或手机性能已通过。门槛是工作量保护，不是性能保证。

### 媒体脚本的既有问题

原 `HOMER_TABS_MEDIA=1` 在1440px视频播放处超时。使用与本轮开始时 SHA 完全一致的 `canvas-panel.tsx` 和 `canvas-panel.css` 做构建覆盖对照，同一位置复现；没有把失败归给本次补丁，也未修改音视频产品逻辑。

截图显示旧 `nativeToggle` 的 `video.bottom - 22` 点击的是当前 Chrome 进度条，播放键在 `bottom - 48`。仅在本轮 scratch 的脚本副本改这一个坐标，保留原断言，三屏播放／暂停／下载／切换均通过；随后320px即时 URL 计数断言遇到现有 `saveBlob` 一秒延迟释放。再在同一副本中等到 URL 计数收敛后执行原完整／唯一回收断言，最终39项全部通过。两处校正只在 `.codex/scratch/patch-preview-integration-20261103/media-controls-check.mjs`，未混入维护中的原媒体脚本；原入口失败状态仍保留。

## 证据与复核入口

复用入口及环境要求见 `docs/testing.md` 的“补丁成果预览”。新增离线文件自动进入默认核心；浏览器复用已有 `tests/preview-tabs.browser.mjs`，通过 `HOMER_PATCH_PREVIEW=1` 显式选择，没有扩大默认测试范围。

本轮证据目录：`.codex/scratch/patch-preview-integration-20261103/`。

- `before-hashes.json`／`before-status.txt`：入场文件状态；已有 lock、vendor README、测试说明保留原改动，共享目录并行工作未回退。
- `accepted-manifest.json`：验收源码及构建文件 SHA-256、Chrome 版本与检查数。
- `patch-tests-final.log`、`unit-final.log`、`regression.log`、`build.log`：离线与构建结果。
- `browser-accepted/results.json`：27项补丁检查；同目录保存各屏正常／原文／回退截图、逐字节下载与布局／性能数据。
- `media-browser.log`／`media-baseline.log`：原媒体脚本和改动前对照的同点失败；`media-wait/results.json`：隔离校正后39项结果。

最终构建身份：

| 产物 | SHA-256 |
| --- | --- |
| `assets/index-CmCFWypS.js` | `e8a48157cbd48bb9a503269e8714a45d260f9473056f1241b6d175a4fcfe786b` |
| `assets/index-B3_a2nys.css` | `ba28887ea01871c9b100d7a1e134d06a57272bb9110cebc6cdd71f9408db5b6f` |
| `assets/diff-viewer-B3_oBz8H.js` | `81f76afc19ef590222632e16eb3f4bcf90d5f43a97e1624c4b065b6f8bb16763` |

## 边界

未运行全量 `npm test`、真实模型或安装版验收，未测试 iOS／Android 实机分享、VoiceOver、原生 Electron 剪贴板／下载。手机宽度的 Chrome 是响应式验收，不是实体手机结论。预览使用原 parser 的投影，可能省略元数据；逐文件 Copy 不是原始字节导出，完整内容须用原文件下载。无自动应用补丁、diff 编辑器或新持久化数据。


## 最终代码审阅与提交验证

后续授权：审阅本轮修改、提交到本地 main、清理对应 worktree；不推送或发布。本项已经位于 main 工作区，因此无需制造额外合并提交。审阅范围为本轮16个文件，预期负载为一个活动成果阅读器、256 KiB／2,000 行内的本地补丁；不承诺无限文件或手机实机性能。

审阅沿 `CanvasPanel` → `CanvasReader` → 原 `connectionFetch`／文件授权接口、固定 parser／renderer、`saveBlob`、AbortController／Blob URL 清理路径进行。没有新增后端、文件写入或补丁执行入口，复制仍与原始字节导出区分。未发现剩余的本项正确性、安全或数据损失阻塞问题。

发现并修复一项性能问题：1,980 行默认一次渲染约8,000个节点，产生约210ms主线程长任务。复用组件现有 `maxCollapsedLines={200}`，没有新组件、状态、依赖或虚拟化代码；完整数据仍可按需展开、复制和下载。增加折叠／展开／再折叠不重解析，以及折叠时复制仍含全部1,980行的行为断言；删除冗余 `isText || isPatch` 判断。

在 `14cc013` 的独立干净 worktree 上仅装入本轮16个文件差异，未复制其他未提交修改。已安装的全部直接依赖版本与候选 package 声明逐项一致。Node 22.22.0 下定向63/63通过、0跳过；与上一阶段64项的差异来自共享工作区中未纳入本次提交的其他改动，不删除断言。一次误用系统 Node 26 的检查有1项图片 fixture 失败；切回项目指定 Node 22 后全部通过，没有修改图片测试来迎合结果。

UI 类型检查、Canvas CSS一致性及干净候选 Vite构建通过。最终三屏补丁浏览器30项全部通过，新增每屏200行首屏、展开全部和再折叠检查；截图复核正常。旧媒体专项的原入口基线问题和初次隔离复查仍按前文记录，本次性能改动仅影响补丁渲染，没有再次运行无关媒体专项。

提交前检测到另一任务将 TURN 候选合入 main（`c7461bf`）。在暂存前停止，独立候选重新基于该提交构建，锁文件只重加本项三个依赖；定向63/63、类型检查、Canvas CSS一致性、Vite构建及三屏浏览器30项全部重新通过，最终截图已复核。最终验证未带入共享目录的其他未提交修改。

### 同一干净候选的性能对照

下述性能对照基于 `14cc013` 的隔离候选；两个构建唯一行为差异为 `maxCollapsedLines={200}`，使用相同合成文件、浏览器及视口串行测量。下表是本轮局部观测，不是跨设备SLO。

| 1,980行补丁首屏 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 1440px：预览内节点 | 7,983 | 865 |
| 1440px：可见耗时 | 265ms | 67ms |
| 1440px：记录到的最长长任务 | 213ms | 未记录到 ≥50ms 长任务 |
| 320px：预览内节点 | 7,988 | 870 |
| 320px：可见耗时 | 264ms | 104ms |
| 320px：记录到的最长长任务 | 212ms | 未记录到 ≥50ms 长任务 |

同时测试普通多文件、15KB长行、250KB单行、超字节上限和二进制回退。首次异步组件加载仍有加载等待；主动展开全部仍要创建全部行，可能产生长任务，不宣称所有交互或所有设备都无卡顿。

最终证据在 `.codex/scratch/patch-preview-review-20261103/`：`latest-main-tests.log`、`latest-main-build.log`、`latest-main-browser/results.json`（30项）；之前同版本对照保留于 `perf-matched-before/results.json` 和 `perf-matched-after/results.json`。最终构建身份（取代上文初次接入身份）：

| 产物 | SHA-256 |
| --- | --- |
| `index-BSqVM5qM.js` | `6f1fd2d51322ce0c71ed01a13d9056f2cfcd4850b4e4e5d18b10ad3c6c2aa8f9` |
| `index-CVSe30Fg.css` | `a5dd46394035cdf62d0cbd84fdd983c9ceec1ff4e0a7be695d8e3d56f8ba8951` |
| `diff-viewer-BrZ8UZ_5.js` | `9961c89041a80a01b3f4e0680afaecd81f513529f48af8df40f79fc3827520d6` |

提交只包含本项差异：共享 lock只增加三个包和对应声明；DESIGN、vendor README、testing文档只提交本项段落。旧候选清理前核验全部12个文件仍匹配原交付清单和完整patch；保留原patch、报告及本轮验收证据。其他worktree及未提交修改不属于清理范围。

## 2026-11-18 文件改动摘要卡调研与验证

**首版只展示能归到该条回复、且已确认成功的原生文件操作。** 固定 Codex 的 `fileChange` 可以把已完成的原生补丁操作归到对应线程、轮次和工具项。轮次 diff 在简单编辑中能合并重复操作和撤销，也会漏报命令写入、保留过时内容，并在同文件交错编辑时包含其他线程的改动。共享工作区暂不显示「本轮净改动」或净增删总数。以下是实验和方案，产品尚未实施。

### 产品参照

- Codex 在审查入口区分最近一轮和不同 Git 范围，并提供逐文件差异。产品上的范围选择说明用户需要知道自己正在看哪一批改动，其实现不能作为 Homer 共享工作区的归属证据。[Codex 审查文档](https://learn.chatgpt.com/docs/code-review)
- Claude Code Desktop 从 Changes 卡的增删行数进入逐文件差异。Cursor 从轮末摘要的文件进入相应范围的 Changes 页。Homer 可复用这种简短入口和就地阅读方式。[Claude Code Desktop](https://code.claude.com/docs/en/desktop#review-changes-with-diff-view) · [Cursor 更新记录](https://prod.cursor.com/docs/release-notes)
- 前次调研建议在对应 Main／Worker 回复汇总文件数，按文件进入现有 Preview。本次保留入口，按下列反例收窄增删统计和归属语义。App Server 文档定义了带 `threadId/turnId/diff` 的轮次通知和带 `id/changes/status` 的 `fileChange` 工具项。[Codex App Server](https://learn.chatgpt.com/docs/app-server#turn-events)

### 固定引擎证据

使用仓库锁定的 macOS arm64 `codex-cli 0.171.0-alpha.7`，二进制 SHA-256 为 `4e37dbc4dcad2aa285e1d246823e0466ea62171a8dbd6d1684d77e9da3abcb2e`。通过 stdio 启动实际 App Server，版本及独立 `CODEX_HOME` 由 `initialize` 核验，`account/read` 返回空账号。隔离系统 HOME、Codex HOME、Git 工作目录、日志和数据库，Responses 只走 `127.0.0.1` 的脚本 SSE。fixture 发工具调用及最终消息，文件实际由 Codex 写入，JSON-RPC 通知从实际进程读取。直接 `apply_patch` 与 `functions.exec` 内的 `tools.apply_patch` 两次完整对照各 9 轮、24 次回环请求，进程均退出 0，以下结果一致。A、B 是同一个隔离 App Server 内并行的两个原生线程，模拟两个 Worker 的原生执行，未运行 Homer 的双 Worker 调度。

| 场景 | `item/completed` | 同一 `threadId/turnId` 末次 `turn/diff/updated` | 磁盘或终态 |
| --- | --- | --- | --- |
| 重复编辑 | 两个成功项 `base → first → second` | 5 条通知含重复，最后只含 `-base/+second` | `second` |
| 同轮撤销 | 两个成功项 `base → temporary → base` | 3 条，最后一条 `diff: ""` | 恢复 `base` |
| 仅命令写 | `commandExecution` 退出 0，`fileChange` 0 条 | 0 条 | `written` 已落盘 |
| 补丁、命令、补丁 | 补丁项分别为 `base → patched`、`shell → final`，中间命令退出 0 | 6 条，最后显示 `-base/+final`。命令之后、第二补丁之前仍发出旧的 `+patched` | `final` |
| 补丁后由命令覆盖 | 成功补丁 `base → patched`，命令退出 0 | 4 条，最后仍为 `-base/+patched` | 实际是 `shell` |
| 删除文本 | 成功项 `kind.type: delete`，`changes[].diff` 是原文 `base\n` | 3 条，含 `+++ /dev/null` 和 `@@ -1 +0,0 @@` | 原路径不存在 |
| 写入后中断 | 成功项 `base → survives` | 2 条，均早于 `turn/completed` | `interrupted`，已写内容保留 |
| 并行 A、B，A 写后等待直到 B 完成 | A 的左侧操作与 B 的右侧操作有各自原生项 | 两边各报自己片段，A 结束时未刷新成共享文件全貌 | 同一文件同时有 `leftA` 和 `rightB` |
| 并行 A、B，B 完成后 A 再写 | A 两项只含 `left0 → leftA → leftAA`，B 一项只含 `right0 → rightB` | A 的 5 条通知中，最后一条同时含 `-left0/+leftAA` 和 **`-right0/+rightB`**。B 的 3 条通知始终只含右侧 | A、B 均完成，文件同时保留左右两处改动 |

并行两行分别来自一次单写对照与两次完整交错验证。初次在外层沙箱内尝试时，嵌套 macOS 沙箱拒绝实际写入，仍收到带路径和补丁的 `item/started` 与 `status: failed` 的 `item/completed`，没有轮次 diff。隔离复跑保留 Codex 的 workspace-write 沙箱，成功判定同时检查工具终态与磁盘。带补丁的通知或 `turn/completed: completed` 单独都不足以证明工具成功。

复核时可用临时 Git 目录，每个单文件场景先写入并提交 `base\n`，共享文件用 `left0\nsep0\n…\nsep9\nright0\n`。用 `initialize → initialized → thread/start → turn/start` 启动，Responses SSE 依次发 `response.created`、`response.output_item.added/done` 和 `response.completed`。每次编辑回包发 `apply_patch`，命令用 `tools.exec_command` 执行 `printf 'shell\n' > overwrite.txt` 一类固定操作。中断测试在第一项成功后挂起下一条 SSE，再针对原轮次发 `turn/interrupt`。并行反例在 A 首次写后挂起其下一条 SSE，完整执行 B，再放行 A 第二次补丁。比较配对的工具终态、轮次通知和合成文件字节。两次完整验证的 `thread/read(includeTurns: true)` 都读回了各轮工具项，但未测试重启、压缩或历史截断后的可用性。

原生补丁项可以解释「谁做了这一步」，即使两次操作触及相同路径。同一轮次最晚收到的 diff 仍可能把两个执行的操作合在一起，或者与磁盘不同。文件名、整个共享 Git diff、命令文本、命令退出码、无事件及终态均无法独立补足这个缺口。任何工作区级对照都应使用自己的范围标识。重叠编辑、命令／脚本／MCP 绕过原生补丁、失联后迟到写入及未知执行状态仍需明确覆盖限制。

### 当前 Preview 能力

| 检查 | 当前源码和验证 |
| --- | --- |
| 点击打开与定位 | `ui/homer-app.tsx` 的成果按钮打开对应 Canvas Tab，`CanvasReader` 把补丁交给 `DiffViewer`。后者有文件头、行号、每文件复制及折叠展开，当前调用只传 `patch`、`maxCollapsedLines={200}`，没有从外部文件条目跳到文件或行的参数与焦点契约。Main 消息本地链接可打开路径当前内容，`:行[:列]` 后缀用于解析路径，当前阅读器未消费该位置；删除后的原路径无法作为历史读入口。 |
| 删除 | Unified 文本删除可渲染旧侧和删行。需用仍可访问的补丁快照，避免重新读已删除路径。原生删除项的 `diff` 是旧文本，接入时按 `kind` 转成合法统一补丁，并处理空文件、无末尾换行及不可安全转换的内容。 |
| 二进制、超限及异常 | 明确的 binary／combined 标记、解码出现 NUL 或替换字符、空补丁或无统一 hunk 均回退原文。解析、渲染异常保留原文与下载。超过 256 KiB 仅解码开头 128 KiB，行数超过 2,000 回退原文。下载保留已获准读取的原始补丁 Blob，仍受服务读取与平台分享上限。二进制回退只阅读补丁文本，折叠的 200 行是渲染门槛。 |
| 来源权限 | 附件读取绑定可见消息及精确 `assetId/revision`，宿主校验消息附件与授权，客户端核对加载内容的 SHA-256。消息本地路径入口要求桌面授权、同源 POST、当前 Main 线程内可见且未撤销的源消息及其确切 Markdown 链接，并执行本地路径、普通文件、符号链接和读取限制。原生事件路径本身无权打开文件，Worker 原生输出也不能借此自动进入主对话。 |

当前源码定向离线通过 46/46，其中 CanvasReader／DiffViewer 与引用校验 40 项、临时目录的文件和传输 3 项、合成宿主来源权限 3 项。来源权限用例覆盖当前字节、附件身份、未授权桌面、跨线程、隐藏或撤销的消息、受保护路径及删除后缺失。首轮 3 项硬编码 scratch／传输测试受外层沙箱写限制，改用临时目录后通过。2 项合成宿主用例首次因进程身份不可读停止，获准打开测试自有进程身份校验后通过。现有补丁组件的真实浏览器验收见本文前文，本轮核对当前组件、DOM 交互及合成 HTTP／来源校验，未重新打开真实浏览器或安装版检查点击和布局。

### 最简接入方案与验收

1. 宿主在现有 engine 事件入口仅收当前来源的 `item/completed` 中 `type=fileChange, status=completed` 的安全子集。按引擎连接／执行代次、原生线程、原生轮次、item ID 去重，沿已有保留绑定处理可核实的迟到终态。保留安全相对路径、操作种类及有界文本证据。Homer 现有过程投影只保留安全标签和文件数等字段，Worker 操作记录用于状态与恢复，均无可重建补丁；旧历史缺证时隐藏入口。第一版只纳入与该回复精确绑定的原生轮次，子线程归属未打通时不合并。
2. 在对应用户可见的 Main／Worker 回复展示一张「本轮记录的文件操作」卡，显示有证据的去重文件数。同路径的多个成功操作按发生顺序归在一个文件下。能解析的单个操作可显示该操作的增删数，撤销与中间编辑仍按操作展示，省略跨操作净增删。命令专用轮次无文件证据时保留既有命令记录，不展示“未改文件”。中断轮次若有可绑定的公开记录，可查看已确认项并标明轮次中断与覆盖范围；未知或失败项不计作成功。
3. 点文件行打开该文件的已授权操作快照，复用 Canvas Tab、DiffViewer 和已有原文回退。按文件选择内容天然定位，避免先加多文件跳转、逐行批注或改造 vendor。优先复用现有快照资产和消息绑定，只给该来源读授权，在读取时复核消息可见性及撤销；避免为每个文件创建正式成果或擅自转发给 Main、其它 Worker、渠道或模型。元数据超预算时明确显示记录不全，正文不可读时保留授权范围内的操作类型和适当提示。实际落地需验证补丁路径和正文的公私边界，尤其是重命名双路径、路径别名、跨任务来源及补丁上下文中的敏感内容。
4. 实现验收需在隔离宿主回放这里的原生反例，覆盖重复通知、晚到／中断、空 diff、无事件命令、同文件两轮交错、旧历史和跨任务拒绝。验证点击确实打开正确文件与版本、删除可读、二进制／超限可理解、撤销后失效，以及宽窄窗的键盘与焦点行为。真实模型、完整 Homer 双 Worker、安装版和真机均待专项。工作区净差异若成为需求，需要另行证明隔离基线和写入边界；普通轮次事件与共享 Git diff 无法提供该证明。
