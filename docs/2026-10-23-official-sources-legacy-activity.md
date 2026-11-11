# 官方 Sources 与旧历史 RunActivity 候选

2026-10-23，目录登记、实际工作目录和 Git 根均为 `/Users/wolf3c/Project/homer`。只落实复查报告获批的两个候选。主树有大量并行修改；本候选按文件前像和局部 hunk 制作，没有使用 HEAD 代替实际源码。首次候选交付时未提交；本次后续获得准确提交授权。始终未上线、未重启生产，无真实模型或业务调用，也没有改写历史数据。

## 当前与目标

原 `MessageDetails` 由主对话用户／助手两个消息槽调用：`message.sources` 使用自绘 details/summary/ul/li，`message.toolActivities` 也使用另一套自绘列表。新过程消息已在原投影 owner 清空 toolActivities，使用现有官方 RunActivity；本次只改仍存在的旧历史消费者。

目标是链接列表采用完整官方 standalone Sources，旧工具列表复用当前固定 RunActivity。删除两套列表 DOM、域名计算与 `.message-tools/.message-sources` 专属 CSS；保留复制／引用及反馈、KaTeX、普通历史分页和过程懒读。新增 Sources 的官方受控展开状态；旧工具列表默认收起，覆盖过去运行消息自动展开的规则。准确 thread/message 身份变化重置，同一消息的正文、状态或回执更新保留用户选择。

## 官方版本与必要适配

固定官方提交：[`1f41f91643fdb56e5d8dbd14db65f742740738a1`](https://github.com/assistant-ui/assistant-ui/tree/1f41f91643fdb56e5d8dbd14db65f742740738a1)。采用 [`elements/sources.tsx`](https://github.com/assistant-ui/assistant-ui/blob/1f41f91643fdb56e5d8dbd14db65f742740738a1/packages/ui/src/components/react/assistant-ui/elements/sources.tsx)，不是消息 part 版 `sources.aui.tsx`。MIT，复用现有原始 LICENSE，其 SHA-256 为 `eafb05991a572efa34097474b31fef45b14a8879ed1d1a8fd77de62e6fa7d275`。

| 一手官方输入 | 原始 SHA-256 |
| --- | --- |
| `elements/sources.tsx` | `c280153e36f1a110f1c3edded3b2f27ad42def391413aa055ede9ac886e354b8` |
| `utils/href.ts` | `3a8038d038b1918ae3f58a61dcd30933633131dda341eb5bea5b6a650b31a912` |
| `elements/surfaces.tsx` | `5d81fbb669e67ae20026cd30ed57efc51a5e3ee0f4f5d265e1723de75359b8fa` |

Sources 的真实 API 为 `sources/open/onOpenChange`，可选 `layout/hideTrigger/locale/className`；本次传 `layout="list"`、`locale="zh-CN"`。保留完整官方导出、列表／网格结构、384px最大宽度、折叠入口、字形图标、标题／域名截断、链接与动画。适配仅含导入、中文、CSS入口、可选原条目 id 作为 key/data-source-id，以及从 surfaces 原样摘取所需 fieldInteractive 常量。其余所需常量复用现有文件；共享 surfaces 未变。href helper 与上游字节一致，专门测试可逆适配后的原始哈希。

现有编译器新增 `--sources`，实际 utility class 局部编译为 sources.css；主题映射既有变量，只补44px点击区和焦点。build/dev脚本加入同一生成命令。无新增依赖、runtime、全局主题或reset。本地安装／锁文件核对一致：React runtime 0.15.29、core 0.3.30、react-markdown 0.14.23、react-lexical 0.2.19、Base UI 1.8.0；未升级。

官方 href helper 允许相对、mailto和带凭据URL，不能声称它原生提供 Homer 的业务安全边界。Homer 继续过滤绝对HTTP(S)、无账号密码的URL，不去重／重排／改写消费者已收到的有效条目，保留原身份、标题及URL；安全文本由React渲染。全部无效时不生成空实体。服务端原有 messageLinks 继续负责真实Markdown链接、标准化、去重、首见顺序和30条上限，没有重提取或补写历史。

“来自本条回复中的链接，未经独立核验”仍在展开区旁说明，不补作者、日期、摘要或可信标记。不获取favicon或网页，不增加跟踪。成果 FileList、Canvas 和准确原答复授权入口不经过 Sources，没有变为普通外链；未将内部路径、工具参数或新来源投影到客户端。

旧历史活动传给原 RunActivity 的是原 tool.id、顺序、名称和四种原状态文案。未知状态显示“结束状态待核实”，无名称显示“工具名称未保留”。整体用 `incomplete` 与“处理过程 · N 项”，不推断运行、主轮结束、业务成功、验收或交付，不编造计时。未复制工具正文，也没有第二套Timeline／ToolGroup、活动详情阅读器或侧栏。活跃 RunActivity 的源码和CSS均未修改；Worker事件卡、未保留内容说明和真实懒读仍由原owner负责。

## 文件范围

修改6个文件：`ui/message-details.tsx`、`ui/message-details.css`、`ui/package.json`、`scripts/build-run-activity-css.mjs`、`ui/vendor/assistant-ui/README.md`、`ui/DESIGN.md`。

新增9个文件：`ui/vendor/assistant-ui/sources.tsx`、`href.ts`、`sources.source.css`、`sources.css`；`tests/official-sources-upstream.test.mjs`、`tests/official-sources-history.test.ts`、`tests/official-sources-legacy-activity-ui.test.mjs`、`tests/official-sources-legacy-activity.browser.mjs`及本说明。无删除文件。旧列表DOM/CSS从原文件中删除。

## 验证与可运行候选

新增合同先红后绿：原列表在含非法URL的合成输入上抛 `ERR_INVALID_URL`，且不存在官方Sources/RunActivity根；实现后通过。最终本地结果：

- 10项展示／固定源码合同测试通过，涵盖空列表、全非法列表、准确身份／顺序／重复、恶意文本、外链属性、默认收起、未知／缺名称、原调用状态、更新保留展开，以及原过程懒读／Worker卡片。
- 现有 chat-ui-enrichment 中2项相关合同通过，保护真实Markdown链接过滤／去重及旧工具返回／中断恢复。未修改服务端合同。
- 新增真实Chrome浏览器测试在320／390／1440各完成15项检查，共45项；已有 RunActivity 浏览器回归在三屏共33项通过，覆盖24个调用、同名不同ID、失败／未知／断连、新旧活动共存、懒读、Worker卡片／缺内容、折叠焦点、Markdown原列表／代码、官方几何和reduced-motion。
- Sources键盘Enter展开、Tab到链接、焦点描边、44px、完整安全文本、准确链接属性及Enter原生激活事件均已核对。激活在合成测试中preventDefault，未访问真实外站，也未声称已验证外站内容或下载。
- UI类型检查和冻结候选类型检查通过；直接Vite生产构建通过。有现有大chunk提示，未据此宣称性能改善。相关diff空白检查通过。

所有新证据在 `.codex/scratch/official-sources-legacy-activity-20261023/`：`before/`、`before-sha256.json`、`upstream/`、`candidate-source/`、`candidate-source-sha256.json`、`candidate-web/`、`build.log`、`browser/results.json`及`active-regression/direct-run-activity-browser.json`。浏览器使用独立临时profile及合成内存HTTP／SQLite，不读生产聊天、业务DB、用户HOME或凭据；阻断外站请求。结果无外站／favicon请求、无异常、无真实发送／上传／停止。截图已实际查看：

| 宽度 | 默认收起 | 展开 |
| --- | --- | --- |
| 320 | [截图](../.codex/scratch/official-sources-legacy-activity-20261023/browser/closed-320.png) | [截图](../.codex/scratch/official-sources-legacy-activity-20261023/browser/expanded-320.png) |
| 390 | [截图](../.codex/scratch/official-sources-legacy-activity-20261023/browser/closed-390.png) | [截图](../.codex/scratch/official-sources-legacy-activity-20261023/browser/expanded-390.png) |
| 1440 | [截图](../.codex/scratch/official-sources-legacy-activity-20261023/browser/closed-1440.png) | [截图](../.codex/scratch/official-sources-legacy-activity-20261023/browser/expanded-1440.png) |

交付复核时，共享 `ui/package.json` 和CSS编译器已出现随后并行任务加入的 `--canvas-split` 增量，与本次Sources分支兼容且完整保留。本任务消息展示和Sources源码／样式仍与冻结候选逐字节一致；截图与浏览器证据对应冻结时的UI，不代表后来Canvas或其他并行修改已联合验收。精确本任务patch仅包含Sources分支，不把Canvas增量归到本任务。

在项目根可运行现有冻结候选的合成预览，命令打印临时本机地址，Ctrl+C关闭；不连接生产：

```sh
node tests/official-sources-legacy-activity.browser.mjs --preview
```

复验：

```sh
node --test tests/official-sources-upstream.test.mjs tests/official-sources-legacy-activity-ui.test.mjs tests/legacy-activity-reading-ui.test.mjs tests/run-activity-upstream.test.mjs
node --import tsx --test tests/official-sources-history.test.ts
node node_modules/typescript/bin/tsc --noEmit -p ui/tsconfig.json
node scripts/build-run-activity-css.mjs --sources --check
node tests/official-sources-legacy-activity.browser.mjs
```

## 既有限制与提交／回退

现有 `node scripts/build-run-activity-css.mjs --check` 报 `run-activity_css_stale`。已使用任务开始保存的原编译器和 surfaces 前像，在本任务 `baseline-css/` 中生成并复现：现有 surfaces 已包含 paper/field/mono/按钮等额外工具类，原RunActivity生成CSS尚未同步。这不是本次Sources的改动；共享surfaces的前后SHA完全一致。为保留当前已批准RunActivity样式，不在本任务重生成或修复它。新增 Sources 的CSS可重复生成检查通过。没有宣称完整 npm build/check 通过；本次构建是类型检查后直接Vite构建隔离候选。

候选具备两项需求的源码、可复验测试和实际截图，可单独审阅并按本任务前像提取hunk提交；全仓发布准备仍应由整合owner处理上述既有CSS检查及其他并行工作。首次候选交付没有commit；本次后续提交见下节。始终未push、创建branch／worktree／tag／remote、部署或生产重启。

回退只撤销本次hunk：恢复MessageDetails两处原列表和对应CSS，撤下Sources编译分支／build-dev命令和本次维护说明，再删除本次新增vendor／测试文件。按before前像精确比对，禁止整文件回盖共享文件、git reset或清理其他dirty成果。无需数据回滚或历史迁移。截图／编译产物只是本地验证证据；维护来源与合同以本说明、vendor README及测试源码为准。


## 2026-10-23 准确提交复核

用户随后明确要求 git commit。提交基线固定为 `5fc7087809b72c1a75af8bcddefa2b301fe2d0c2`；真实索引起始为空。使用本任务临时索引构造“固定HEAD＋本批改动”，共享README／DESIGN只追加本任务段落，构建脚本与package只加入Sources分支；不包含Canvas、其样式或其他dirty修改。共6个修改、9个新增、无删除；此前“未提交”字样描述首次候选交付阶段，本节记录后续提交验证，最终SHA以Git提交记录为准。

独立索引导出的完整树正常执行 `npm run build --workspace=homer-web` 成功，含所有既有CSS生成、UI类型检查与Vite构建；没有禁用检查、修改断言或借入未提交产品依赖。Sources生成CSS与索引待提交文件SHA完全一致：`d78db66e7071593f59678191690c5afc38f45da39a37e1ccb4368c14dfad26a8`。

RunActivity旧CSS仍为原HEAD的 `c243792a03a0c0ce0a6c9fcaf08aaae70ec54e44a3edbdbd63eaacf0826eca4a`；正式构建生成 `f94341f34d9f3e3cdcd444c8ee86aee31ea1e43fe4d83efc1c6fe81e2b3e0306`，差异仍归属原surfaces已有扩展，未纳入本批索引。正常构建可生成可用产物，其后三屏新旧活动合成回归全部通过；干净检出且尚未生成时运行原 `--check` 仍需整合owner处理这一既有一致性问题。本次没有改检查或把它混作Sources改动。

固定HEAD中的UI样式／Markdown部分与首次dirty候选不同，因此对独立正式构建补跑全部78项三屏浏览器检查，均通过；无外站／图标请求或真实模型／业务操作。12项相关合同也通过。此前复用的chat-ui-enrichment文件不在固定HEAD，故将其中2项与本需求直接相关的来源过滤／身份顺序和历史工具恢复合同写入本批 `tests/official-sources-history.test.ts`，原未跟踪文件保持不动。上述复验命令现不依赖它。

提交复核的独立索引、源码树、构建日志、三屏截图与结果位于原任务scratch下 `commit-review/`。这是本批可独立构建与运行的证据，不表示现有发布冻结版本包含本次提交。未push、打tag、发布、重启或联系发布任务。
