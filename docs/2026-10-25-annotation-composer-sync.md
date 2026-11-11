# 批注保存与主输入草稿同步

2026-10-25 维护源码实现；HEAD `a6040cc62fb2e76ece3fb62b138b31ab9da516c8`，未提交、安装、重启或发布。安装版 build58 未被操作，本报告不表示安装版已采用。需求为已批准的第4项：明确保存即逐注 chip，双向编辑删除，多来源共存，仅实际主发送提交。

## 行为与所有权

原 MainComposer 草稿拥有已保存的来源组；`ui/annotation-draft.ts` 将其不可变视图共享给预览，chip 和三个引擎都投影这一事实源。原生选区、当前输入和未保存几何只属于编辑视图。文本、图片、HTML 不再有独立可修改的已保存 Map，也没有“添加到对话”中间动作。保存成功保持预览和阅读焦点；切文件、关闭、外点或 Escape 取消临时编辑，已保存内容保留。删除正在编辑的同注关闭编辑，删除其他条目保留当前输入。

后续键盘统一（任务 `2682b6ca-8350-4891-a9ae-20e1c78ae930`）：文本／图片共用 `AnnotationCommentForm` 的 Enter 保存、Shift+Enter 换行，与 HTML Agentation 原生一致；保存按钮和原校验／草稿 owner 不变，IME候选 Enter／Escape 与229不触发保存或关闭。本项只在本地 textarea 复用原 form submit，无 Agentation vendor 增改；不改变下文已批准的激活／双向同步／ACK 补丁。维护回归与本地证据见 `tests/annotation-enter-save.browser.mjs`、`.codex/scratch/annotation-enter-save-20261025/`。此变更未安装到 build62。

thread 隔离、source kind + artifactId + SHA-256、稳定 annotation ID 共同标识内容。draft request/epoch、reader generation 和 iframe token/revision 拒绝迟到写回。发送前取得深快照，再清新草稿；后续编辑不能改变 pending。未知回执不自动重放，显式重试保留原 requestId 和全部 payload（包括未知字段）。普通 quote 与批注互斥，两方向都明确提示先移除，不能静默替换。待答编辑冻结普通草稿，不写入答复。

沿原 `homer-draft:thread` sessionStorage 保存 confirmed 来源、锚点、最小 HTML renderer metadata、原图资产身份和 request identity；原始 File 仅在当前页面缓存。存储失败保留页面内完整草稿并显示提示。刷新后未确认原图须重选，不将临时资产或哨兵值送入 wire。没有新表、SQL 迁移、同步服务、跨引擎 undo 或跨 App 进程持久承诺。

## 请求与兼容合同

新增可选 `resourceReferences[]`，与旧 `resourceReference`、消息引用和 interaction answer 互斥。新 UI 集合按准确来源分组；同图的所有备注共用一个 asset/revision。旧 singular 字段继续原样读取、恢复、hash 和重试；只有使用集合时 hash 才加入集合字段。既有 quote JSON 列可完整承载，无生产回填。历史、主输入、队列读取、旧队列草稿恢复、原请求视图、用户意图、主 Agent 上下文和网关合同均贯通；队列只允许保留原 reference 或整体移除，不允许绕过来源核验编辑它。

`conversationView` 升为3，能力声明 `previewReferenceCollections: 1`；新旧 UI 通过原协议协商拒绝不兼容组合。原网关 pending 合同锁保留，不清 journal、不重绑或自动放锁。任一来源失效或超限整次拒绝，不取第一组或截断备注。

| 限制 | 当前合同 |
| --- | --- |
| 全消息批注 | 最多20条 |
| 摘录／路径与备注累计 | 最多48000 UTF-16字符 |
| 单条摘录、单条备注、正文 | 各最多16000字符 |
| 用户授权意图 | 正文与所有 comment 合计沿原24000预算；摘录、来源与位置不作为指令 |
| 附件 | 最多10个，每个1字节至8MiB，原 scope/revision 校验 |
| 网关请求 | 完整 JSON 最多96KiB UTF-8字节 |

主 owner 在保存候选前校验整草稿，实际发送再检查字节数。服务逐一核验所有来源、全部图片尺寸与原图附件，主上下文保留每组备注且原图仅一份。原正文和普通附件行为继续由原 owner 负责。

## 三类预览

文本／代码／Markdown：`preview-text-v1` 锚点保存 UTF-16 offset、exact、prefix/suffix 与 representation。DOM Range 映射逻辑文本流；跨 strong/link、表格、列表、重复第二次、CRLF/emoji 和公式原子均明确处理。CSS Highlights 绘制，普通编号 button 负责可访问交互，不包裹或改写 ReactMarkdown/KaTeX DOM。滚动、resize、字体和内容布局变化重算，卸载仅清自身 highlight/observer。旧无锚点或 hash 不符不猜位置。PDF、Mermaid、任意外站新批注和 HTML 源码入口不在范围。

图片：继续固定 Annotorious 3.9.5 原生 store、选择、手柄、popup 和公开 remove/update API；保存后才写 owner，再投影原生 store，取消从当前 canonical owner 恢复几何和备注。保留 x/y/w/h 派生 bounds 修正。首注原图只准备一次；准备 chip 阻止实际发送，失败可显式用同 uploadId 重试，迟到上传不得复活已删注。删最后一注保留普通原图附件；主动移图的可访问名称明确“移除原图及 N 条批注”，discard 成功后才清注，失败保留。提交清理不触发用户 discard。

HTML：继续固定 Agentation 3.1.2 原生 PopupToolbar，公开 Add/update/delete/clear 正向写草稿，包括零条。不挂 onSubmit，无 webhook/endpoint 时原生 Send 自然消失。固定库缺反向 API，因此批准的最小本地 `onDraftController` 提供 `replaceAnnotations`／`cancelPending`，只写唯一 native annotations state，authoritative replace 不回调。候选经父层确认才结束原生表单，拒绝保留输入并显示错误；删除当前编辑和迟到动画受保护。opaque、禁网、无 same-origin、明确点击才运行、关闭销毁的边界不变；父删除不重建 iframe，不伪造 StorageEvent。

固定补丁共26 hunks、+93/-17（ESM和主声明），两份声明字节一致。原 ESM SHA-256 `1a4d069438c9f218d20eab31150e5c2b1c6ef05c526135bd10dd492950023b1e`，输出 `2cf30bd06dc8819541f91e0efd1f56144d2ffdf3d319457420d96b29c8952946`。原声明 `ad53930a48adf24d58dd40e6d469c2e54f8133c619e490af9a4a77e84c78b438`，输出 `b37ba49827a64f25f7510bf744dcf10456d4656cd22cd3c56d47e2ac235e0949`。脚本核验精确 input/output、原 upstream、许可和声明镜像；未改 node_modules。原 PolyForm Shield 1.0.0、版权、MODIFIED-SOURCE 及构建 notices 保留；本地源码实现不授予额外商业许可。

## 验证与实际限制

全部输入为需求推导的合成文本、HTML、图片与 HTTP fixture；真实库组件在隔离 Chrome/156 中运行，无生产连接、真实消息或模型调用（modelCalls=0）。证据位于 `.codex/scratch/annotation-composer-sync-implementation-20261025/`，可维护的测试源码纳入 tests。

- `tests/annotation-composer-sync.browser.mjs`：1440／390／320px及320×480低高度，共54项检查通过。覆盖三类三注、改第二／删第一、双向删除／零注、重开与刷新、同名不同来源、重复句／跨节点／公式、HTML hydration/noecho／超限拒绝恢复／删除当前编辑／clear、原图只上传一次／保留与复用／上传失败同 ID 重试／迟到来源切换／discard 失败、quote 双向互斥、存储失败保留、发送前零 `/api/messages`、实际模拟发送与未知回执原样重试。自审新增附件10个满额时的保存前拒绝检查：旧实现红测确认为1个错误准备 chip，修正后无 chip、无上传且保留输入和原附件，三屏重跑全部通过。
- 扩展定向回归76项：73通过、3失败。3项为 `Web pending card reply returns through main decision to the original interaction`、`real user generation sink orders start/delta/confirmed terminal and ignores delayed stop and foreign events`、`a failed main generation terminates only when failure or process shutdown is confirmed`；使用记录的任务 dirty 前像进行仅内存源文件覆盖复跑，3项也全部失败。未为本任务扩大修改这些普通输入生命周期分支。完整输出保留 `focused-tests.tap`／`preimage-failures.tap`，并非全套测试全绿。
- UI/server 定向 TypeScript 编译通过。全仓类型检查当前12项，任务 dirty 前像12项，新增0；冻结 committed HEAD 以真实 tsc 检查为137项。比较脚本、诊断及限定条件保留在 task scratch；并行文件保持读取时实际状态。
- 固定 vendor 精确补丁测试、旧／新预览合同、草稿生命周期、网关原样 pending/96KiB、所有来源授权和主上下文合成服务测试通过。相关 quote／attachment／image-file／canvas-split CSS 精确生成检查通过；隔离 Vite 与 annotation runtime 构建通过。

本地 PNG：`browser/composer-1440.png`、`browser/composer-390.png`、`browser/composer-320.png`、`browser/composer-low-320.png`、`browser/text-highlights-1440.png`。截图仅本地保留，未上传。检查覆盖合成 keyboard／IME 事件与可访问名称；实体手机、原生虚拟键盘、真实端侧候选选择和已安装 Electron 未测试。CSS Highlights 未在其他浏览器验证，不新增假想兼容层。旧批量导入浏览器脚本描述已被本测试替代的行为，不能据此声称其全部通过。

## 变更边界与回退

核心文件：`src/preview-reference.ts`／`web-history.ts`／`user-intent.ts`／`recursive-main-inputs.ts`／`service.ts`／`web-contract.ts`／`web-homer.ts`／`html-preview.ts`；`ui/annotation-draft.ts`／`preview-text-anchor.ts`／三个预览适配器／原 MainComposer、请求、附件、历史和旧队列恢复视图；固定 vendor 及补丁脚本、上述测试和本说明。

复用并行任务的 AnnotationCommentForm，不修改其源码／CSS。不恢复 HTML 源码入口。共享文件期间出现的 Tabs、CanvasReader、Worker 与 Run Activity 改动均由原任务所有，本任务只接其真实调用边界，不认领或整文件覆盖；没有新增 Tabs／活动架构。原 HEAD、index 及他人 dirty 保留。

回退必须对照 task scratch 的逐文件前像和所有权记录逐 hunk 逆向；共享文件不可整文件回滚，vendor 要与桥接、能力版本和 wire 合同成组回退。已有 plural 草稿／pending 不应被旧 UI 忽略；必须先保留原数据与合同锁，不能手工清 journal 或重绑来恢复连接。无生产数据迁移或发布动作。
