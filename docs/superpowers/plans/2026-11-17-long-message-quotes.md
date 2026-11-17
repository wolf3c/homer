# 长消息引用最简实施方案（2026-11-17）

状态：用户批准后已按本方案实施源码并完成提交前复审，提交结果以Git记录为准；未安装或部署，历史数据未改，未调用真实模型。原方案步骤保留供对照，实际结果见第10节。

用户已同意的目标：取消消息整条引用的16,000 UTF-16码元截断及选区长度拒绝；引用全文在既有96KiB完整消息JSON预算内即可发送；超限明确提示并保留草稿。保留手机现有传输，不增加分页、流式、去重、压缩、引用外置或新的预算模块。

## 1. 核查基线和范围

本方案核查时HEAD为 `787afc686ee49ba9d906ee78c14c5ad83f071c37`，此前显示简化提交为 `bf5261ac`。HEAD已包含Markdown相邻图片映射，不能再把该项描述为当前未实现。显示简化历史验收见[原复审记录](../../message-display-simplification-2026-11-17.md)。

工作区仍包含长引用实验以及处理过程、渠道、截图批注等大量并行改动。以下路径和函数名是实施定位，行号会随并行修改变化。实施前重新核HEAD、index和相应片段；不整文件回退，不删除其他事项新增内容。当前工作区行为不能当作HEAD已交付行为。

本项限于消息正文的来源引用 `quote` / `quotes`；Canvas文本、网页及截图的 `resourceReference(s)` 是不同合同。成功处理过程继续隐藏，与本项无关。

## 2. 最终合同

| 字段或边界 | 最终处理 |
| --- | --- |
| 整条引用生成、选区捕获 | 取消16,000码元截断／拒绝，保留现有可见文本转换、来源和定位语义 |
| `quote.text` / `quotes[].text` | 后端不再按单条16,000码元拒绝；不再进入原48,000合计 |
| `quotes[].annotation` | 保留每条16,000码元、评论合计48,000码元；仍同时受整消息字节预算限制 |
| 引用数量、来源身份 | 保留20条引用、200个来源条目、来源ID格式、原会话与原文核验、旧新引用互斥 |
| 普通消息 `input.text` | 保留16,000码元；不把取消引用限制扩展成取消普通正文限制 |
| 预览／截图批注 | 保留原字段、数量、摘录、路径、窗口文字、评论及48,000合计的各自校验 |
| 用户要求长度 | 保留现有 `previewIntentTooLong` / `validatePreviewIntent`：有预览引用时检查24,000码元；不是全部引用原文的长度上限 |
| 入站消息业务JSON | UTF-8最多98,304字节（96KiB），等于上限可接受；超限拒绝整个请求，不裁切 |
| 手机通道 | 保留16MiB逻辑JSON包、16KiB分帧、现有背压、队列与失败处理 |

`src/web-history.ts` 的 `quotePosition()` 本身没有16,000限制，保留 `exact === text`、偏移长度、前后缀和哈希格式校验。不要修改 `src/preview-reference.ts` 中同形的文档批注锚点限制。

已有“正文／用户评论／附件或资源评论至少有一项有效”的发送条件保留；只有引用原文、没有本次要求的草稿不会因本项获得新的发送语义。

保留200个来源条目意味着结构化消息超过200项时，整条动作仍只提供已有来源前段并提示；选区跨过200项仍不可引用。这不是本次取消的字符截断，不能宣传为任意结构化消息无条件全文引用。普通Markdown转换和首尾空白处理也不改，本方案的“全文”指现有引用语义生成的可见正文，不是原始Markdown字节副本。

## 3. 字节口径及实际处理链

前端按最终 `prepareMessage()` 结果计量：

```ts
new TextEncoder().encode(JSON.stringify(input)).length > 96 * 1024
```

Node入口使用现有等价写法 `Buffer.byteLength(JSON.stringify(input))`。不新建通用预算工具。`requestId`、正文、引用、评论、来源ID、定位、资源引用、截图窗口文字和附件身份引用全部计入，JSON引号、转义及多字节字符同样计入。选区 `position.exact` 与 `text` 即使相同，也按真实重复字段计两次。草稿本地的 `draftId` / DOM Range 不进协议，不能拿整个本地草稿计算。附件文件字节通过既有上传通道传递，本请求只计算实际携带的身份等字段。

提交计完整 `input`；编辑计完整 `{requestId,operationId,expectedRevision,...scope,input}`；打断计完整 `{input,target}`，在解出内层输入之前检查。手机外层RPC的 `{id,op,input}` 不属于96KiB业务预算，仍受现有16MiB通道限制。

HTTP入口另保留原始请求体96KiB检查，因而手工JSON的额外空白、不同转义也计入原始字节；手机入口收到解析对象，计其标准 `JSON.stringify()`。正常客户端本来就使用这种序列化，两端预算一致；不承诺任意人工HTTP文本与解析后对象字节完全相等。

真实入口：

1. 桌面／Web：输入框 → `prepareMessage` → `submitDraft`检查 → `post` → `web-server.body` → `createWebChat` → `conversationInput` → submit / queue mutation。开发接收日志 `IngressJournal.store` 仍检查完整JSON96KiB。
2. 手机：同一输入框 → `mobileFetch`把API路由转为 `mobileCall` → `mobileChannel` → `openMobileSession` → `mobile-gateway`使用的 `createWebChat` → 同一业务方法。它绕过 `web-server.body`，所以只恢复HTTP检查会留下入口缺口。
3. `messages.edit`、`messages.interrupt` 两端共用 `createWebChat` 的兼容接口；当前队列UI没有编辑入口，普通输入框只调用 `onSend(input)`。不为了测试接口新建编辑UI。编辑继续沿现有revision、source、附件范围和operationId规则，打断继续沿generation核验规则。

只对 `messages.submit` / `messages.edit` / `messages.interrupt` 加共用入口检查，不把96KiB套到媒体上传、读取响应或所有内部渠道。`conversationInput()` 保持内容合同解析职责，不承担所有业务路径的统一传输预算。

## 4. 最小产品改动清单

| 文件／函数 | 片段级改动 |
| --- | --- |
| [ui/message-details.tsx](../../../ui/message-details.tsx) `RuntimeMessageActions.quote` | 保留候选去掉 `.slice(0,16000)` 的片段，移除仅由字符长度触发的前段提示；保留来源200项提示及其他并行过程显示改动 |
| [src/message-quote.ts](../../../src/message-quote.ts) `sourceQuote` | 保留候选 `limit=Infinity` 一行改动；保留现有显式limit接口、来源数量和可见文本处理 |
| [ui/message-source-selection.ts](../../../ui/message-source-selection.ts) `captureSourceQuote` | 保留候选去掉 `text.length>16000`；保留空选区、不可引用区、跨消息和来源身份守卫 |
| [src/web-history.ts](../../../src/web-history.ts) `conversationInput` | 保留候选去掉 `validQuote` 原文单条限制，48,000合计只累加 `annotation.length`；不带入本文件处理过程读取变化 |
| [ui/homer-app.tsx](../../../ui/homer-app.tsx) `checkQuotes` | 保留20条及评论限制、现有预览要求校验；删除引用加入／保存时的预算对象构造和字节拒绝，使超限引用仍能进入草稿；随之删除该函数不再需要的附件预算收集代码 |
| 同文件 `checkCandidate` | 原有截图／资源准备预算恢复成完整JSON96KiB，不去掉该资源准备检查，不改上传状态流程 |
| 同文件 `submitDraft` | 最终输入按完整JSON96KiB检查，必须在保存待发送、标记附件提交和清空草稿之前return；发送按钮不因字节超限静默禁用，点击可得到明确提示 |
| 同文件 `recoverRejectedSource`、`sendInput` | 将确定的 `request_too_large` 映射为大小提示，复用既有受requestId／草稿状态保护的恢复逻辑；恢复文案按错误区分，不能把大小拒绝叫来源不匹配。网络未知错误继续原保全流程，不自动重发 |
| [src/web-chat.ts](../../../src/web-chat.ts) `createWebChat` | 为上述三个操作，在任何业务调用之前用完整操作输入做一次96KiB检查；一处条件、一处序列化检查即可，抛现有 `request_too_large` |
| [src/web-server.ts](../../../src/web-server.ts) `body` / POST入口 | 精确撤销候选消息路由16MiB放宽及预算helper调用，恢复统一原始body96KiB；保留HEAD相邻资源与其他事项改动 |
| [scripts/dev-ingress.mjs](../../../scripts/dev-ingress.mjs) `IngressJournal.store` | 恢复原 `Buffer.byteLength(payload)>96*1024`，在写日志前拒绝；不改hash、请求身份、日志或重放规则 |
| [ui/queue-operations.ts](../../../ui/queue-operations.ts) `queuePost` | 将服务端明确返回的 `request_too_large` 作为确定拒绝，复用现有解除pending操作锁的路径；不把断网等未知结果归为确定失败，不新增队列编辑器 |

建议大小提示：“整条消息超过96KiB，请缩短引用或减少内容后发送；正文、引用和附件已保留。”在本地return或确实恢复后使用；若用户已输入新草稿，沿既有保护不覆盖新内容，提示“原请求超出96KiB，原请求内容及当前草稿已保留。”不要在只有pending副本时声称输入框已恢复。服务端原始错误码保持不变。

## 5. 精确收敛原16MiB候选

当前未跟踪的 `scripts/message-input-budget.mjs` / `.d.mts` 把引用 `text` 及匹配的 `position.exact` 从96KiB中扣除，再以模拟RPC包判16MiB。它不符合本方案，应整体移除其本事项实体和消费，不改造成另一层预算系统。

- 移除 `homer-app.tsx`、`web-server.ts`、`dev-ingress.mjs` 的helper import和调用，分别按第4节替换或恢复。
- `package.json.files` 只移除helper条目；`scripts/build-desktop.mjs` 只移除其复制和哈希依赖片段；`scripts/dev-build.mjs` 只移除其UI哈希依赖片段。逐块保留其他构建变化。
- `tests/message-input-budget.test.ts` 中10MB通过、重复定位原文不计预算等断言不能沿用；将有价值的边界断言放入现有入口／输入框测试，再移除该候选专用测试。不留下失效import。
- `tests/main-composer.test.mjs` 的fixture helper注入、`tests/display-simplification.test.ts`、`tests/display-simplification.browser.mjs` 的大引用成功断言同步改为本方案边界。选择、引用导航相关候选断言按新合同保留。
- 不执行全文件恢复、清理或宽泛暂存。本轮无Git写操作；之后提交仍需当轮授权和串行窗口。

## 6. 全文如何进入LLM，哪些行为不改

已接收输入沿 `ConversationHistory` 保存引用JSON，`MainInputs.current()` 从历史重建并调用 `conversationInput()`；本方案不迁移schema、不新建引用存储。

[src/service.ts](../../../src/service.ts) `processMessage()` 当前把多引用完整 `JSON.stringify(quotes)` 拼入 `contextText`，旧单引用完整拼入 `JSON.stringify(quote.text)`；随后 `mainTurn()` 在追加附件／待答事实后把文本交给 `acceptedBy.turn(text, ...)`。所核这条链路没有额外的16,000引用裁切，本项无需改service或engine。`src/user-intent.ts` 的授权描述只包含正文和用户评论而非来源全文，是现有“要求／工作资料”区分，不应为全文传入而改变。

验收要在现有 `tests/web-service-fixture.ts` 的合成engine输入捕获中确认引用首、中、尾及完整字符串均存在；不能只测SQLite保存或UI显示。该证据证明Homer把完整引用交给引擎，不证明真实模型必定使用每个字，也不保证引用全文自动进入之后的Worker委托；Worker材料继续由主Agent按现有方式组织。96KiB是消息入站预算，不是完整模型请求或上下文token上限，后续追加事实／图像及引擎自身上下文行为不在本项承诺中。

## 7. 旧数据、拒绝和手机回传边界

不回填旧消息、不重做旧引用。历史上已被16,000截掉的引用不会恢复；原来源还存在时可重新引用。现有已保存引用、旧单引用、requestId与hash语义保留。老的在途实验可能产生过超过96KiB的待发送副本：不读取或修改用户副本；若以后手动提交，明确拒绝并保留原内容，不自动裁切、换ID或重放。用户编辑后按现有新请求身份流程发送。

本地超限在提交前保留原输入框和附件状态。服务端确定大小拒绝也要复用现有恢复守卫；若已有新草稿，只保留双方而不覆盖。已有草稿存储失败时沿用“仅本次页面保留”的提示，不新增持久化机制，不承诺刷新后一定恢复。与旧服务端／旧客户端混用时仍可能遇到原16,000合同的 `invalid_quote`；本方案不新建版本协商，验收使用同一候选前后端，不能称为兼容所有旧安装版。

手机入站检查应返回明确错误，不依赖16MiB包超限断线。回传仍由 [src/mobile-channel.ts](../../../src/mobile-channel.ts) 的现有通道负责；单条输入在96KiB内并不能数学保证聚合历史／队列响应在16MiB内。[src/conversation-projection.ts](../../../src/conversation-projection.ts) 的队列项含 `input` 与 `user`，历史默认40／最多80条、队列现有80条分页是条数边界，不是字节预算。既有大历史、多项引用及聚合字段仍可能触发包超限并断开，未确认请求沿既有流程保留；本项不改这些回传机制，不作“手机任意历史全文必达”承诺。

## 8. 必要验证与实施顺序

在现有测试文件补案例，不新建框架；先用最终断言复现候选差异，再完成最小产品片段并验证。

1. 引用生成：`tests/message-source-selection.test.mjs` / `quote-navigation-ui.test.mjs` 覆盖大于16,000码元的整条与选区，确认尾部保留，来源身份、200项及不可引用区规则不变。
2. 后端合同：`tests/web-multi-quotes.test.ts` / `display-simplification.test.ts` 覆盖单条60,000 ASCII原文与多条原文合计超过48,000但JSON仍在96KiB内；旧单引用同样通过。评论单条16,001、评论合计48,001、伪造来源、旧新引用并存仍拒绝。评论合计48,000测试可测解析器合同，不应假设任意中文评论组合也必然通过96KiB传输。
3. 准确预算：在现有 `web-chat.test.ts`、`web-server.test.ts`、`dev-ingress.test.mjs` 覆盖98,304通过、98,305拒绝、UTF-8中文／emoji、JSON转义、`position.exact`、截图AX和编辑／打断外层字段。用独立合成数据生成精确字节边界；业务方法spy在拒绝时调用次数为0，日志／receipt／队列无新增写入。HTTP另测原始body空白占字节。
4. 草稿：`tests/main-composer.test.mjs` 覆盖超限全文可加入／保存；发送显示提示、不调用onSend、不清空任何草稿；减少内容后发送完整文本。模拟服务端 `request_too_large`，检查恢复及新草稿不覆盖；未知网络错误不自动重发。队列操作用现有测试覆盖明确大小拒绝解除pending锁、未知结果继续保留。
5. 模型输入：在现有 `tests/web-service.test.ts` 与其fixture使用本地fake engine核对长引用从接收、持久化、领取直到turn输入的全文一致；不调用模型，不要求修改service。
6. 手机：`tests/mobile-session.test.ts` 通过合成已配对会话调用实际 `createWebChat`，覆盖submit／edit／interrupt超过完整业务JSON预算返回 `request_too_large`，不进入桥接写操作，通道仍可收下一条正常请求。复用 `mobile-channel.test.ts` 回归原分帧和16MiB行为，不运行真实RTC专项或真机。
7. 浏览器：调整现有 `display-simplification.browser.mjs`，在1080px和390px核对预算内引用尾部、超限提示、草稿／附件保留及缩减后发送；检查mock收到的JSON全文，不只截图。使用独立fixture和目录，Chrome正常退出；窄屏结果不替代手机真机验收。

离线定向检查使用项目Node 22.22.0、现有 `synthetic-home.mjs` / `core-system-proxy.mjs` fixture及tsx测试路径；之后跑前后端 `tsc --noEmit`、必要UI构建和上述单一浏览器专项。不运行全量、真实引擎、安装／发布专项。没有新增测试文件则不改 `scripts/test.mjs` 清单。更新现有 [Web接口说明](../../10-web-interface.md) 与 `ui/DESIGN.md` 的现行引用合同，不改历史验收结论。

原规划轮只核查、写方案与检查文档链接；批准实施后的实际验证见第10节，不能沿用此前16MiB实验通过作为本方案验收。

## 9. 本次复审结论

最小路径可行；此前方案需补齐三处：移除后端原文48,000合计而非仅单条16,000、手机共用入口补96KiB校验、服务端明确大小拒绝接入现有草稿恢复及队列确定拒绝路径。现有全文进主轮的链路无需重写。不能用“去重计量”或“已保存在pending”替代完整JSON预算及准确草稿提示，也不能把当前队列协议编辑接口当作已存在编辑UI。

实现不增加新产品实体；产品变化集中于现有生成、校验、发送和恢复函数，其他文件仅撤销本事项16MiB候选依赖。仅在上述测试全部满足后可称为该合同完成；安装版、真实模型及真实手机验收仍分别报告。

## 10. 实施与复审结果

2026-11-17 在共享main增量实施；开始HEAD为 `b11e2c64`，结束核查HEAD为 `100238af`，期间其他事项提交已保留。仅修改第4节所列业务片段，恢复旧96KiB HTTP／Ingress及构建依赖，已移除本事项未跟踪的两份预算helper和其专用实验测试；未暂存或提交。共享 `web-chat.ts` 的定时读取、`homer-app.tsx` 的历史尾页等并行片段保持。

- 定向离线13个文件158/158通过，零失败／跳过；另对同一消息入口测试补emoji及JSON转义后7/7通过（包含在前述测试范围，不另累加数量）。覆盖旧／新引用、完整持久化与fake engine输入、原文累计超过48,000、评论累计48,000／48,001、98,304／98,305字节、HTTP原始空白、手机submit／edit／interrupt、确定拒绝及未知结果、草稿与附件恢复。
- 修正前已观察到四项合同回归失败：过早拒绝保存、超限原文被发送、服务端拒绝未恢复草稿、共享操作入口缺少预算；队列明确大小拒绝不释放pending也先复现失败。实现后对应测试通过。
- Vite UI构建通过。后端 `tsc --noEmit` 通过；共享UI类型检查两次仍报 `ui/scheduled-messages.tsx:5` 导入 `conversation-client` 未导出的 `ScheduleContext`（TS2305）。主Agent确认属于并行定时事项尚在接线，本项不修改，不能称为共享树全部类型检查通过。
- 实际隔离Chrome专项在1080px、390px均通过：20,004字符中文引用完整送入mock请求且JSON在96KiB内；40,004字符中文引用超限时零发送，正文、引用尾部和已上传附件保留，删除引用后正文及附件可发送。另保留此前显示回归。Chrome退出0，forced=false，watchdog=false，使用独立mock-keychain profile；不替代安装版或真实手机验收。
- 一次新上下文只读复审未发现产品逻辑阻断；指出的现行文档旧合同、服务端大小拒绝附件恢复断言、多段原文和累计评论边界三项缺口均已补齐并定向复验。未引入额外产品实体、真实模型任务或新传输机制。

当前可复现入口为现有13项测试和 `tests/display-simplification.browser.mjs`；浏览器构建目录与profile在验证完成后回收，合成截图、浏览器退出回执及离线日志暂保留于 `/private/tmp/homer-long-quotes-331234d8/`，用于下一步主Agent集成复审，复审完成后可回收。共享测试历史目录不作归属猜测或跨任务清理。

## 11. 提交前复审（2026-11-17）

用户本轮授权review、提交到main和清理。本事项一直在共享main实施，没有自建Git worktree，不另造分支或执行无意义合并。滚动条事项提交后的基线为 `25faee7c`；拟提交只纳入25个文件的本事项片段，排除定时任务、历史尾页、渠道及图片展示等并行变化。临时候选是该HEAD加精确片段的普通源码副本，不是worktree。

候选158/158定向离线测试、前后端类型检查及预览运行时／Vite构建通过。共享UI类型检查已在并行定时接口补齐后通过，实施阶段的TS2305不再是当前阻塞。源码复审确认完整JSON序列化计量、超限前return、确定拒绝恢复与来源校验位置正确；不新增持久化或传输实体，预算检查为现有消息大小的线性计量，且引用保存退出重复预算构造，不引入逐字网络请求。未做性能基准测试，不声称模型或设备任意负载无延迟。

精确候选的1080／390px合成浏览器专项再次通过：完整引用入站、超限全文／正文／附件保留及减少内容后发送均通过；Chrome退出0，confirmed=true，forced=false，watchdog=false。暂存和提交按Git串行窗口执行，逐文件核对index哈希；保留其他未提交内容，不推送或部署。
