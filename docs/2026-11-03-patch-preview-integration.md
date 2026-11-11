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
