# 文本文件多处批注

2026-10-24，本地源码完成。以任务前像 HEAD `5afa91483870fd69fb281bc1bd5c2e24470dd3ba` 的共享工作树为基础，保留既有未提交内容。没有提交、分支、worktree、部署、安装或重启；当前 Appbuild52 不因本次源码修改而改变。

文本、代码、Markdown和已有安全HTML源码预览的选区气泡现在显示“批注”。用户选中原文后填写多行备注，点击“保存批注”留在当前文件，可继续选择其他位置。顶部“批注（N）”汇总按保存顺序显示摘录和备注，支持编辑和删除；相同原文可以有多个独立ID。只有统一“添加到对话（N）”才把已保存内容作为一条文件引用放入原主草稿，不自动发送。

## 状态与用户路径

- 未保存的备注不会导入。外点或第一次Escape收起弹层并保留输入，汇总提供“继续编辑”和“取消批注”；明确取消只移除本条编辑内容，保留其余保存项。关闭、切换文件后仍可回来继续未保存备注。
- 原预览owner在当前主thread内保留artifactId+sha256对应的会话草稿。不同文件即使内容哈希相同也不串批注，不同版本从空列表开始。切换thread会重建预览和会话记录。
- 未导入备注仅在页面内存中保留，汇总明确说明；刷新只从原Composer的持久草稿恢复已导入快照。没有新增数据库表、独立annotation session或永久批注库。
- 导入生成独立快照。之后在预览编辑备注不改动该快照，再次导入才更新原单条引用。相同快照重复添加会提示已在草稿中；切换来源仍按原单来源规则替换，保留主正文、普通附件和requestId。
- 原MainComposer继续拥有恢复、答题、连接/接收禁用、附件和请求身份。失败保留主草稿及预览批注；未知回执不自动另发，显式重试仍使用原payload/ID，后续新草稿不被旧重试覆盖。
- 桌面导入后聚焦原Lexical；窄屏先关闭预览，再聚焦同一个输入框。Popover的备注框在卸载前把焦点移回稳定阅读区，避免其下一帧恢复焦点覆盖输入光标；Dialog关闭时读取owner当前归还意图，导入时不再回到旧文件入口。正常手动关闭仍回原入口。
- 不做永久正文高亮、精确Markdown源码重定位或跨版本位置恢复。汇总提供保存项的查看/编辑入口；编号表示保存顺序。

## 复用边界

`ui/preview-selection-toolbar.tsx`继续作为独立Mantine选区订阅叶组件，保存原生Range与摘录来源。Base UI 1.8.0 Popover仍负责虚拟锚点、Portal、滚动跟随、碰撞、外点和Escape；Portal留在原Dialog内。激活时沿`previewSelectionText`提取内容，选区变化不遍历整文件或重挂Markdown/代码正文。

气泡仍复用已固定assistant-ui Quote工具条的实际外观与28px按钮。备注是Homer本地紧凑多行表单，使用现有主题、原生textarea和已安装Base UI Button，不宣称是assistant-ui专用AnnotationEditor或Agentation原生编辑器。没有引入第二Composer/runtime、cva依赖或新批注库。主引用沿现有QuoteBlock，通过公开className覆盖取消两行截断，所有编号摘录和备注在原区内限高滚动。

图片产品仍采用原单矩形合同；网页仍采用原annotations批次接口。没有复制并行图片多区域或HTML一键Demo，没有修改其scratch/库补丁，没有增加PDF阅读器、网页抓取或通用批注平台。已验收滚动修复与Worker卡片实现没有改动。

## 合同和校验

旧文本资源引用保持`{kind:'text',source,text}`，新结构为`{kind:'text',source,annotations:[{id,text,comment}]}`；二者互斥。继续存入原quote JSON，未改ConversationInput、请求接收、队列或数据库schema。

| 字段/总量 | 限制与来源 |
| --- | --- |
| annotations | 1～20项，沿现逐段引用条数 |
| 每项id | 非空，最多100字符，同文件批次不重复 |
| 每项text/comment | 各自非空、各不超过16000字符，沿现摘录/备注上限 |
| 全部摘录+备注 | 不超过48000字符，沿现逐段引用总量 |
| 主正文+全部备注+授权说明前缀 | 沿现`USER_AUTHORITY_MAX_LENGTH=24000`，精确含分隔文字 |

所有超限都拒绝，不截断。UI提示并保留编辑内容；统一导入/发送仍走原意图检查。摘录不会计入用户授权意图，备注和主正文才会；模型上下文用逐项JSON显式区分text来源数据与comment用户备注。

`src/service.ts`仍从原发布成果owner解析授权文件、标题和内容哈希，再对每条摘录独立验证，整批原文不能用拼接contains绕过。Markdown/TeX使用原`previewQuoteText`，保留行内、块、math fence、错误公式与代码混选规则。摘录的DOM位置不作为服务端授权依据。

原`ConversationHistory`哈希算法不变。旧单摘录和没有resourceReference的旧请求按原规范化字段产生原哈希；只有新annotations实际存在才改变payload。历史读取、原草稿恢复、已接收请求重试和精确ACK沿原owner处理。服务回归也验证：来源后来无法读取时，已接收payload仍按原身份重试，不重跑、不替换旧摘录。

## 验证记录

证据目录：`.codex/scratch/text-file-multi-annotations-20261024/`。全部文件、备注、消息和账号身份都是需求推导的合成输入，服务端使用fake engine（`codexBin=/usr/bin/false`），浏览器使用全新隔离Chrome profile和任务专属HTTP端口，没有连接真实对话、消息库或模型。

| 检查 | 结果/证据 |
| --- | --- |
| 红绿合同 | 同一新合同在前像实现上6通过/3失败；`red-contract-tests.log`。当前聚焦引用、数学、队列、客户端30项通过；`contract-tests.log` |
| 合成服务端 | 6项通过；`service-tests.log`。三条摘录真实进入Agent上下文、全部备注进入授权；任意一条伪摘录/伪哈希拒绝，旧引用与已接收重试保持 |
| 多处批注真实浏览器 | 43项通过，1440/390/320；`final-browser-v5/browser-results.json` |
| 原选区定位/键盘回归 | 最终候选45项通过；`final-selection-browser-v2/browser-results.json` |
| 公式与HTML边界 | 最终候选34项通过；`final-math-browser/browser-results.json` |
| 原图片/网页合同 | 最终候选31项通过；`final-annotation-browser/browser-results.json`，真实Annotorious与Agentation |
| 类型与构建 | UI和服务端源码类型通过；scratch独立生产Vite构建通过，保留既有大chunk提示 |
| 全仓类型 | 仍有12处既有诊断；与任务前像副本仅规范化绝对根路径后逐字节一致。没有扩大修复范围 |

多处批注检查覆盖三处保存、编辑第二条、删除第一条后补充重复原文、取消保留其余、未保存内容跨关闭/文件切换恢复、文件ID/哈希隔离、旧按钮迟到失效、快照独立、重复导入、合并意图超限保留、刷新恢复、中文IME与多行、Tab/Enter、真实鼠标/触摸、分层Escape、长文件滚动与分栏拖窄。导入后直接发送CDP文本输入确认原Lexical焦点；未知回执检查真实合成HTTP到达，再验证不自动重发及显式原payload重试。外层额外滚动范围保持0，Composer底部保持窗口内。

聚焦合同可直接运行：

```sh
node --import tsx --test tests/preview-reference.test.ts tests/message-quote.test.ts tests/recursive-main-inputs.test.ts tests/web-client.test.ts
node --import tsx --test --test-name-pattern='preview|file annotations|all text remarks' tests/web-service.test.ts
```

复验浏览器时，`HISTORY_FOLLOWUP_BUILD`指向已构建且核对过的UI目录，`HOMER_SYNTHETIC_ROOT`和`HOMER_REVIEW_EVIDENCE_ROOT`指向本任务scratch子目录，再运行`node --import tsx tests/text-file-annotations.browser.mjs`。不要指向正在使用的服务或真实runtime；脚本会自行创建合成HTTP服务与隔离Chrome。

测试中保留了初次失败记录：CDP不能序列化DOM对象、合成文件应使用Markdown扩展名、成果发布后应选择当前fake engine、不能等待挂起fake Worker的idle、HTTP到达须独立于本地待确认卡等待。另两项是实际焦点竞争，已按上述owner边界修正并用同路径复验，没有删除失败断言来迎合实现。

截图均为合成内容，位于`final-browser-v5/`：

- `editor-1440.png`、`editor-390.png`、`editor-320.png`：紧凑多行批注Popup。
- `three-notes-1440.png`、`three-notes-390.png`、`three-notes-320.png`：同文件三处汇总。
- `composer-1440.png`、`composer-390.png`、`composer-320.png`：一条文件引用含全部摘录备注，及原输入框真实焦点。
- `dragged-editor.png`：实际拖窄后Popup保持在可用阅读区内。

Chrome `156.0.8078.48`。屏宽/触摸/IME模拟不代替实体iOS/WKWebView与软键盘验收；当前安装版未实机采用。没有宣称生产上线或原生系统验收。

## 修改与回退边界

运行代码仅：`src/preview-reference.ts`、`src/user-intent.ts`、`src/service.ts`中的逐条摘录核对，以及`ui/preview-selection-toolbar.tsx`、`ui/preview-reference.tsx`、`ui/canvas-panel.tsx/css`、`ui/homer-app.tsx`的预览/原Composer连接。同步新浏览器回归、现有引用/服务与三份批注浏览器测试、`ui/DESIGN.md`、vendor README和本文。

`before/`记录原dirty文件前像，`task-only.patch`只包含本任务相对前像的差异；Git index条目与开工前逐字节核对，不暂存任何文件。`src/service.ts`原待答事实改动、`ui/homer-styles.css`滚动修复、`ui/process-nodes.tsx`Worker卡片与其他共享改动均保留。回退应仅反向应用本任务差异，不恢复HEAD或覆盖原dirty。新旧文本结构需同时保留至不存在新结构草稿/历史时，不能直接退回只识别单段引用的解析器后读取新历史。
