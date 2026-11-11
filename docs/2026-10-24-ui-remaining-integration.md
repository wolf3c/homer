# 剩余 UI 闭包审查与分批入库

2026-10-24，新四小时预算。起点 `87cfef8e1f1d6b7604c01c3244b9e6e7ebf92af9`，共享 main，原暂存为空。保留此前官方组件恢复、去刷新栏和正式助手气泡。只提交批准的引用／必要问答前置及剩余 UI；品牌、记忆、原生能力和独立 Worker 待答发现逻辑留在工作区。不安装、发布、推送或重启。

## 第一批：引用与必要问答前置

`preview-reference`、`user-intent` 接入原 `ConversationHistory`、`MainInputs`、`Homer` 和 WebBridge。引用复用原 quote JSON，不建表；有来源的新增请求参与原 hash，无新增字段的旧请求 hash 保持。新请求校验真实已发布成果／内容哈希、网页消息所属对话和准确 URL／标题、原图附件身份及内容。已接收请求先沿原身份核对，不因当前来源变化而另发。

用户正文与图片／网页批注进入原 Agent 用户意图，来源摘录、元素和 URL 不升级为授权。含预览引用的新要求连同授权前缀不得超过24000字符；超限明确拒绝，不截断。保留旧已接收长请求的读取和同身份重试。公式核对使用与预览一致的数学源码解析。附件确认移除后撤销缓存身份，重加时重新上传；失败／迟到回执不清新身份。

原生 `questionAnswers` 与可读正文分离，经原交互回调接收；普通队列与授权决定拒绝原生答案字段。普通 Worker 问题不投影为强制用户原生问卷。独立 Worker 待答发现／协调系统不在此批。

固定官方 Canvas／WebPreview、QuestionFlow／OptionList／ElicitationForm 及其源 CSS、生成 CSS 与来源说明随前置入库。批注采用现有锁定 Agentation、Annotorious、Mantine hooks 与 react-resizable-panels，未安装或升级。第一批保留仍被准确 HEAD 使用的旧队列 helper 和 dnd 依赖；最终 UI 接线、删除旧问答／队列 UI 与 dnd 留下一批。

Agentation 3.1.2 的实际许可为 [PolyForm Shield](https://raw.githubusercontent.com/benjitaylor/agentation/v3.1.2/LICENSE)，包含竞争用途限制、保留原 notices 及分发附带许可文本的条件，不是 MIT。本地集成与提交不证明正式分发满足竞争用途条件。本轮无分发行为；现有构建 notices 附带实际许可。Annotorious 保留固定 npm gitHead 的 [BSD-3-Clause 原文](https://raw.githubusercontent.com/annotorious/annotorious/f780879410ff4f2d4fd0b2cb1ae1bd596a40fe65/LICENSE)，其他固定来源及适配详见 `ui/vendor/assistant-ui/README.md`。

## 验证边界

证据目录 `.codex/scratch/ui-remaining-review-commit-20261024/` 保存原 index、前像、白名单、临时 index、准确候选 tree、补丁和日志。每批基于准确 HEAD 加白名单导出，不用混合 dirty 通过替代提交树通过。使用隔离合成引擎、HTTP、SQLite 与独立 Chrome；不读取生产或请求真实模型。

结果与实际 SHA 在完成后补记。原全仓 types 基线为137条既有错误，须逐诊断比较，不能沿用混合工作区12条的报告；源码及 UI 单独检查另记。保留原大 chunk 警告，不把构建字节变化称为全设备性能保证。

第一批准确候选：服务端源码与 UI `tsc --noEmit`、八组源 CSS `--check`、独立 Web 构建通过。41项引用／附件／HTML隔离／数学源码／问答／队列合同、9项问答兼容检查（其中7项与前组重复）、5项真实合成 service 路径通过，合计48项不同测试。图片测试的 `syntheticFile` Buffer 类型前置已随候选补齐。全仓137条诊断归一化候选根目录后与准确基线逐字一致，无新增诊断。

同一工具构建：基线主 JS 2545006字节、CSS 341126字节；第一批主 JS 2546445字节、CSS 341126字节。第一批尚未连接前端批注入口，因此不把此数当作最终体积。基线首跑因从错误工作目录找不到 index.html 失败，改在准确基线 ui 目录重跑通过，两份日志保留。构建后已跟踪源码与候选 tree 字节一致，真实 index 保持为空。

第一批实际提交 `94b6992075aa0ab6a7cd84748c76fada9e29c9a6`，tree `99a90fb8619b39472850342be4a7241577bd72e4`，父提交为起点 `87cfef8`。51个白名单路径，提交前后工作文件字节一致，暂存仍为空。新增 range 摘录文件的末尾多余空行在提交前移除，未改函数。

## 第二批：剩余界面接线与审查修复

同一个 MainComposer 内的预览引用、答题、旧草稿恢复和队列取消共享原输入／附件／回执 owner，故作为一个内聚闭包入库，避免拼装临时的另一套 owner。包含：

- Canvas 的官方标题／关闭和 WebPreview、可调双栏及窄屏模态、HTML 显式运行和禁网、文本／图片／受控网页批注。删除指定的自定义文件操作及前端原答复／Finder 控件；相关服务端授权 API 保留。
- 微信 → 工作状态 → 全窗口最右预览；实际聊天栏达到1120px时320px常驻摘要，余800px聊天。一个原数据 owner、一个列表，保留展开／分页／身份／缓存／阅读锚点／焦点。显式关闭意图跨 SSE、恢复和断点保持；窄屏临时弹层不改变桌面意图。
- 官方原生问答与目标 Composer 接线，删除旧自绘问题组件。简洁队列删除展开／编辑／拖拽／排序 UI，删除六个不再消费的 dnd 锁定包；服务端 order／CAS／领取／ACK 保持。旧草稿和 unknown 原操作只读恢复／精确核对，不自动另发或清存储解锁。

审查复现并最小修复了两处遗漏消费者，均先在准确候选真实 Chrome 失败，再验证修复通过：

1. `homer-queue-edit:<request>` 恢复入口只显示 `quotes`，没有显示旧单条 `quote` 或 `resourceReference`。改用既有 `draftQuotes` 与 `ResourceReferenceBlock`；旧 JSON、原请求身份和附件字节记录不变。预览来源保持单独引用展示，复制正文不把它转换成用户授权。
2. 助手“查看原请求”已显示旧 quote 和附件，却没有显示新预览引用。补用同一只读引用块；保留原正式助手气泡、来源和正文 owner。

独立 Worker 待答发现及其未完成方案不纳入。独立 Mermaid 懒加载优化、品牌／记忆／原生能力及历史材料继续留 dirty。`ui/DESIGN.md` 仅取本轮新增的相关章节，锁文件仅取准确依赖增量，未吞入无关 libc 元数据变化。

## 最终验证与性能边界

最终准确候选的服务源码及 UI 类型检查通过，八组源 CSS `--check` 与 Web 构建通过。构建后逐个 Git blob 核对已跟踪源码，无漂移。全仓 `tsconfig.check.json` 仍为137条既有诊断，归一化目录后与准确起始 HEAD 完全相同，没有修旧测试凑全绿。最终明确使用现有 Node 22.22.0，未安装工具或依赖。

46项引用／附件／历史／数学源码／问答／队列与恢复测试、5项真实合成 service 引用路径、24项原授权／统一队列／原生协议检查通过。最后一组的旧 reopen 用例第一次因缺少其约定的 scratch 父目录失败，准确起始 HEAD 同样失败；仅在候选中补齐合成目录后24项全过，未改该测试或产品逻辑。

真实隔离 Chrome 的现行检查：

| 路径 | 通过检查 |
| --- | ---: |
| Canvas，320／390／1440px | 102 |
| 文本／图片／真实 Agentation onSubmit，原请求引用、同 File 重加与懒加载 | 31 |
| 公式整段／混选／错误／math fence、慢加载切换、超限保留 | 34 |
| 独立网页组件：官方操作、窗口／当前 token／刷新旧 token／URL 拒绝回执 | 21 |
| 问答，三屏各七组 | 21 |
| 简洁队列、旧 editor／edit 草稿、unknown、取消、Worker 权限、84条跨页 | 61 |
| 常驻摘要、数据、重连；含320／390／1440／2560px | 50 |
| 官方代码复制／流式／错误／公式／Mermaid | 51 |
| Image／File 下载与准确身份 | 48 |
| 消息复制／引用 | 48 |
| 单组 Sources／旧活动 | 45 |
| 附件上传／移除／原身份重试 | 51 |
| 原授权卡准确决定／未知回执／迟到隔离 | 33 |

这些是本地合成路径和分组检查，不是全仓测试或生产验证。网页组件没有恢复被删除的 Sources 预览入口；其独立夹具直接构建准确候选的 CanvasPanel，受控网页自行接入协议。错误窗口、错误／刷新前 token 均不添加引用，URL 不符向网页返回明确失败，准确当前来源才进入草稿回调。

2,000条合成任务三次重新加载观察：首批均20、下一批40，均保留分页按钮焦点，收起时进展请求0。点击操作前计时至两帧的本机样本为约167.2／132.0／130.8ms，含浏览器驱动与调度开销，不是纯 React 渲染时间或设备保证。虚拟空闲10000ms新增总览／进展读取均0，页面恢复一次总览读取；切换面板保持原输入框实例与阅读锚点。未添加轮询、订阅、缓存层或影子状态。

相同构建方式的实际未压缩产物：

| 构建 | 主 JS | 图片批注 JS | 网页批注运行时 JS | 全部 CSS |
| --- | ---: | ---: | ---: | ---: |
| 准确起始 HEAD | 2545006 | — | — | 341126 |
| 最终 UI 候选 | 2499757 | 131029 | 665505 | 442081 |

最终全部 JS 为3296291字节；不能用主包减少45249字节掩盖总 JS 增加751285字节。三屏普通对话初始网络记录未请求图片／网页批注块，只有明确使用后加载。原500kB大 chunk 警告仍在。构建 notices 已实际核验含 Agentation 的完整 PolyForm Shield 文本／版权及 Annotorious BSD 原文；不据此宣称竞争用途限制已获豁免。

浏览器夹具遇到的软链接目录拒绝、缺 CDP helper 命令和未指定已有 Playwright 模块已分别改为真实候选目录、补齐必要 helper、显式指定机器现有模块。新增网页回归最初错误地等外层文本，现按原协议核对网页收到的错误回执。所有失败日志保留，不改沙箱／CSP／目录安全校验，不以失败计为通过。

## 证据与复现入口

`batch1-commit-result.json`、`batch2-identity.json`／`batch2.patch`、`final-*-types-node22.log`、`final-css-checks.json`、`batch2-build-reviewed.log` 和各浏览器结果均位于本轮证据根。只读回归源和固定版本／许可说明已入正常 tests、scripts、vendor 和本文，截图／日志／导出树只留 scratch。

浏览器通过现有 Chrome 与现有 Playwright 执行；使用已构建候选的 `dist/web`，设置 `HISTORY_FOLLOWUP_BUILD`／`HOMER_COMPONENT_BUILD`／`HOMER_APPROVAL_WEB_DIR`，以及任务内 `HOMER_BROWSER_EVIDENCE`／`HOMER_REVIEW_EVIDENCE_ROOT`／`HOMER_SYNTHETIC_ROOT`。队列脚本现支持 `HOMER_COMPONENT_BUILD` 直接验当前构建。`tests/web-preview-bridge.browser.mjs` 自行生成任务内独立组件夹具；`tests/task-status-pinned-runner.mjs performance` 可复测三次2,000任务分页。全程合成引擎或禁止执行的 fake engine，外部请求阻断。

代表截图：`final-pinned/preview-2560-pinned.png`、`final-canvas/canvas-markdown-390.png`、`legacy-green/browser/after-queue-old-draft-390.png`。各组最终 JSON 与日志保存完整场景名；失败前像、红灯及早期回归目录亦保留用于归因。

## 实际提交与收尾

剩余 UI 闭包实际提交 `831c15c38684bb9f5d3ffc53527f151c4d6a6ea1`，tree `af07e664632d33b11e812ad88db3905a7b802f14`，父提交为第一批 `94b6992`。41个精确白名单路径；提交前后这些工作文件字节一致，原暂存为空且提交后仍为空。源码、生成 CSS、锁文件增量、许可说明、维护文档与回归闭包均已入库；本轮授权的引用／必要问答、Canvas精简、最右预览、常驻摘要、队列简化与旧引用恢复全部已提交。

前像核对脚本最初漏列了本轮已修改的 `tests/preview-annotation.browser.mjs`，该检查尚未完成便执行了提交。随后补齐白名单，对实际 tree 的全部源码 blob、224份初始前像和真实 index 完成复核：只变化了本轮明确修改的8个前像文件，没有无关字节变化。该核对结果与原检查失误如实记录在 `postcommit-verification.json`，不冒称首次检查通过。

仍留 dirty：独立 Worker 待答发现、品牌、记忆／原生能力、独立 Mermaid 优化、其他旧测试和历史材料、DESIGN 中未纳入的旧文档变化、锁文件无关元数据等。不是所有 dirty 都获准提交；未整体暂存，未创建分支或 worktree。未部署、安装、重启、推送或访问生产业务／凭据；安装版尚未采用本轮提交。后续正式分发仍须核对 Agentation 的实际竞争用途许可条件。

本节为文档收尾增量，运行代码身份仍是上述第二批提交；完整最终 SHA 与状态另外封存在本任务 scratch 的 `final-verification.json`，避免在提交自身文档中制造循环 tree 身份。
