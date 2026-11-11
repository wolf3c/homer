# 右侧预览与引用批注

2026-10-23，本地源码实施；不表示已部署或安装版已更新。实施开始 HEAD：`3c5461180575aa90f9430f35152f444530185913`，工作区已有大量未提交修改；本任务保留原工作。

## 组件与效果

| 功能 | 直接复用 | Homer 的必要连接 |
| --- | --- | --- |
| 桌面双栏、调整宽度 | `react-resizable-panels@4.14.8` 的 Group／Panel／Separator | 一个当前预览目标，打开／切换／关闭 |
| 窄屏全屏预览 | 已安装 Base UI Dialog | 同一个 Portal 容器，800px 以下模态，关闭返回原入口 |
| 文件阅读、网页工具栏 | 已固定 assistant-ui CanvasSplitDocument／Header／Body、WebPreview、ImagePreview；原 Markdown／原生 PDF | 原授权文件读取、取消、Blob URL 回收与打开／刷新 |
| 文本选择 | `@mantine/hooks@9.7.3` useTextSelection | 限定预览正文选区，添加带成果 ID／SHA-256／摘录的引用 |
| 图片区域 | `@annotorious/react@3.9.5` Annotorious／ImageAnnotator／ImageAnnotationPopup | 一个备注输入框与添加按钮；原图上传、原图像素矩形和来源进入主草稿 |
| 网页元素 | `agentation@3.1.2` 成品工具栏、元素选择、备注、标记、onSubmit | 预览内执行；结构化批注经受控 postMessage 加入主草稿，成功／失败回执返回工具栏 |
| 主输入引用、历史展示 | 已固定 assistant-ui QuoteBlock、原 Composer 与附件组件 | 一个可选 `resourceReference`，与旧消息引用互斥；用户补充后沿原请求与主队列发送 |

新增四个直接依赖，版本锁定；不引入批注 MCP、服务端批注库、协作系统、独立 Agent、阅读模式或面板注册平台。图片标记不直接修改文件；发送原图与矩形，不生成裁剪图。PDF 继续预览，不承诺 PDF 选字或区域批注。一次主草稿保留一个来源引用，网页来源内可携带至多20条元素批注。

## 数据与生命周期

文本：选择正文 → 引用按钮 → 主输入框显示来源与摘录 → 补充要求 → 原 `/api/messages` → 原 MainInputs → 原主 Agent。

图片：Annotorious 框选／备注 → 原附件上传 owner 确认原图 → 引用与原附件进入主输入框 → 补充要求或直接发送已有批注 → 原队列。重复使用同一预览图片时，下一条消息取得新上传身份；同一请求的失败重试保留原身份。移除关联原图会移除区域引用。

网页：页面内 Agentation 选元素／备注 → onSubmit → 当前 iframe、当前连接 token 验证与白名单字段整理 → 主输入框引用 → 用户发送 → 原队列。工具栏的 Send 仅表示添加主草稿，不直接触发模型。失败回执保留批注。

来源校验由原 service／任务／文件 owner 负责：成果必须已发布且内容哈希一致；文字必须对应真实可读原文；图片附件必须属于本请求且哈希对应原成果；网页必须对应当前对话真实消息中的来源 ID／URL／标题。网页元素与位置是用户端批注快照，不声称服务端已重现网页或找到了源码路径。

`ConversationInput.resourceReference` 与 `quote`／`quotes`、答题输入互斥。复用原 `conversation_messages.quote` 的 JSON 字段保存引用，不建表，不复制成果正文。旧消息与旧请求哈希保持兼容；资源变化参与新请求身份。排队编辑可保留或移除原来源快照，不能替换来源；图片引用不能脱离原附件。普通草稿、答题、排队编辑和未知回执保持原恢复路径。

## 网页控制边界

首期支持 Homer HTML 成果，以及页面自身接入批注器的受控网页；普通外站只预览。HTML 默认源码，显式操作后才运行交互或批注。外层继续使用原恒定 `/preview/interactive` 壳与内层 opaque-origin sandbox，保留禁网、禁止父页面 DOM 访问；不增加 `allow-same-origin`、任意外站注入、代理网页或放宽主页面 CSP。

`ui/annotation-frame.tsx` 是 Agentation 的最小宿主适配：挂载原组件、onSubmit 与父页面握手。opaque-origin 无浏览器 Storage 权限，故仅在该隔离文档中提供随关闭丢弃的内存 Storage，避免库的设置写入抛错；不访问 Homer 存储。Agentation 与 React 被编译成一个自包含 IIFE，按需加载后传给隔离壳，不发模块或外部网络请求。

受控网页可以复用该适配入口，或在自己的 Agentation onSubmit 中接入同一消息合同：子页发送 `homer-preview-ready`；只接收 parent 的 `homer-preview-connect` 并记住 token；回复 `homer-preview-connected`（token、当前 location.href）；提交 `homer-preview-annotations`（token、当前 location.href、annotations）；网页 URL 必须与当前来源一致；导航后原来源不匹配时拒绝添加。等待匹配 token 的 `homer-preview-annotation-result`。收到 error 时拒绝 onSubmit 的 Promise，保留批注。父页面校验精确 iframe window、token 和当前来源。导航、刷新或切换成果更换连接身份；无来源不添加引用。此协议不是任意网站批注 SDK。

网页元素批注限桌面；窄屏明示限制。文本引用和图片框选在窄屏使用全屏预览，成功添加后回主输入框；不会在不可访问的主输入框里抢焦点。

## 构建、许可与验证

Web build／dev 先运行 `scripts/build-preview-annotation.mjs`，随后沿原 UI 构建。图片批注与网页批注运行时分别按需加载。`ui/vite.config.ts` 的原 notices 产物附带新依赖声明。

Agentation 3.1.2 为 PolyForm Shield 1.0.0，非 MIT；本地集成不表示取得任何单独商业授权，正式分发前仍须按其实际用途核对许可。Annotorious 是 BSD-3-Clause；npm 缺许可证文件，仓库保存官方 npm gitHead `f780879410ff4f2d4fd0b2cb1ae1bd596a40fe65` 对应 LICENSE，随 notices 分发。Mantine hooks 与 react-resizable-panels 为 MIT。原组件来源继续见 `ui/vendor/assistant-ui/README.md`。

验证记录在本任务 `.codex/scratch/canvas-implementation-20261023/`：构建、合成来源／主队列测试与隔离 Chrome 截图。仅使用 fake engine 与合成文件，不访问真实模型、账户、生产数据；不重启当前 App、不提交、不发布。最终通过项与已有失败见本节后续结果。

### 实际结果

- Web 生产构建和服务端 `tsc --noEmit -p tsconfig.json` 通过；隔离 `buildUiCandidate` 实际生成并封装了批注运行时与 Web 资产，未启动 host。原候选构建现在也调用同一个运行时生成脚本。
- 27项引用、历史、附件、队列编辑、HTML 隔离测试通过；6项直接相关 service 测试通过，包含原图真实上传／哈希匹配、拒绝其他附件冒充原图、文字／网页来源验证和原主队列。
- 隔离 Chrome 在1440／390／320宽度完成51项多格式与焦点／隔离检查，以及27项引用／批注检查。后者包含真实 Agentation 元素选择、输入备注、onSubmit 加入主草稿并发送到合成主队列；窄屏使用触摸事件框选；来源网页入口、官方刷新与外部打开均有实际行为检查。错误和外部请求拦截列表为空。截图只含合成内容。
- 扩大回归时5个旧用例失败：`web-service.test.ts` 的 Worker 待答超时、两项 generation 生命周期断言，以及 `web-upload-host.test.ts` 的两项旧投影／候选检查。均用实施前保存的对应源码导入重跑，复现相同失败，未修改这些业务逻辑或放宽断言。
- 完整 `npm run typecheck` 仍有既有测试 API／声明／类型错误，涉及 `chat-conversation-baseline.test.ts`、`chat-timestamps.test.ts`、原附件测试的旧断言类型、`interruption-recovery-projection.test.ts` 和 `web-history-observation.test.ts`。该全量检查未通过；源码及 UI 的独立编译通过。全量发布前须另行处理这些已有检查问题。
- 未执行提交、部署或 App 重启；安装版 WKWebView 未实机验收。检查结束时共享 HEAD 为 `a33e43df6dd28b4d61544e90e48c2dbbfb2162de`，期间其他任务提交了 macOS 包装工作；本任务保留它们。当前维护的 WKWebView 原导航策略允许 about／blob／http／https 子帧，本任务没有修改原生包装器或注入权限。

新依赖共增加79个锁定包，原有包版本未变。Agentation／图片批注按需加载，普通阅读不先加载批注运行时。

## 2026-10-23 Review 后的最小修复

四处连接问题已按用户要求修复，保留原组件、布局、主队列与隔离策略：

- `CanvasPanel` 按准确文件或网页身份使用 React `key`，切换时沿标准卸载／挂载生命周期隔离状态，旧批注器加载回调不再使新 HTML 自动运行。
- 附件 owner 在服务端确认移除后删除对应 File 的缓存身份；移除失败保持原身份。迟到的移除回执只处理原上传，不清掉同一 File 在新草稿中的身份。
- 预览公式选文从 KaTeX 的原始 TeX 注释生成准确表达式；选中公式的一部分时引用完整公式。服务端使用与渲染器相同的数学解析器核对原文，仍拒绝伪造表达式与隐藏链接。普通选文不克隆 DOM，旧消息引用语义保持。
- 原 `MainContext.userText` 补入图片备注与网页批注正文，用于显式 Skill 识别、Worker 授权描述等已有路径；不纳入来源标题、URL、元素或引用摘录。

根依赖显式声明已安装的 `mdast-util-math@3.0.0` 与 `micromark-extension-math@3.1.0`，使服务端打包包含同一解析器；没有新增锁定包或升级版本。修复前主 JS gzip 为608078字节，最终候选为608459字节，增加381字节；图片和网页批注保持独立懒加载。本结果仅说明本地构建差异，不代表生产或手机性能基准。

验证：

- 图片删除后重加、公式规范化校验、批注意图进入真实 Worker 授权描述均先复现失败，再验证修复通过。图片移除失败和迟到回执也有回归保护。
- 33项针对性测试通过：附件9项、引用5项、Markdown引用3项、服务4项、队列9项、HTML隔离1项及官方组件来源2项。
- 隔离 Chrome 的37项检查通过：原三屏批注流程27项，加新增 `tests/preview-annotation-edge-cases.browser.mjs` 的10项。新增覆盖1440／390／320宽度下整段／部分／块级公式引用，及慢速加载中从A切到B再回A仍保持源码模式。
- 服务端与UI独立 `tsc --noEmit`、最终Web候选构建和 `git diff --check` 通过。全量 `npm run typecheck` 仍有其他4个旧测试文件的12处既有错误：`chat-conversation-baseline.test.ts`、`chat-timestamps.test.ts`、`interruption-recovery-projection.test.ts`、`web-history-observation.test.ts`。本次附件测试的原类型错误已修正，没有放宽运行断言。

最终隔离资产及浏览器结果在 `.codex/scratch/preview-reference-fixes-20261023/`；仅合成数据和fake engine，未调用真实模型。未创建提交、部署或重启安装版；WKWebView未实机验收。

## 二次 Review 的三处边界修复

- 将 Canvas 的 Markdown 组件映射移到模块级，避免选区更新时重新挂载代码节点，保留“公式＋代码块”的完整选区。
- `remarkPreviewMath` 在数学解析完成后保留准确 TeX，包在 KaTeX 可替换输出之外。选文读取这一解析来源，正常显示及 `.katex-error` 降级共用同一引用规则；不读取错误 title 猜测源码，也不放宽服务端来源校验。
- `src/user-intent.ts` 统一原用户意图拼接、授权前缀与24000字符上限。新消息在原接收事务的 `validateFresh` 阶段检查，排队编辑在原 CAS 事务内检查；超限返回 `preview_intent_too_long`，不占用请求身份或修改已接收修订。浏览器在添加引用、发送和保存前提示并保留草稿，缩短后恢复可发送。来源解析器不加新限制，旧消息和已接收请求仍可读取、核对原回执。未截断内容或改变授权上限。

验证先通过旧构建复现混合选文截断，并通过服务回归复现长批注被错误接收，再验证修复。最终37项针对性测试通过：附件9项、引用6项、Markdown引用3项、队列11项、服务5项、HTML隔离1项及官方来源2项。隔离 Chrome 在1440／390／320下通过49项检查，包括原批注流程27项与新增边界22项；后者覆盖代码混合选文、行内／块级错误公式、超限草稿刷新恢复和缩短后发送恢复。

服务端及UI独立类型检查、Web候选构建、脚本语法检查和diff空白检查通过。全量类型检查仍为前节4个旧测试文件的12处错误，没有新增错误。新候选主 JS gzip 为608909字节，比上一候选增加450字节；图片／网页批注仍独立懒加载，无新增安装包。这里只记录本地构建开销，不代表实机性能基准。

证据保存在 `.codex/scratch/preview-boundary-fixes-20261023/`，仅使用合成数据与fake engine。没有创建提交、部署或重启App，未验收安装版WKWebView。

## 代码块公式引用补齐

`remarkPreviewMath` 补齐 `math` 语言代码块，在 KaTeX 可替换输出之外保留原始代码文本，沿服务端现有代码引用规则校验。公式仍按块级显示；局部选中引用完整表达式，错误公式也保留原文。不改服务端来源规则，不增加依赖。

新增浏览器用例先在旧候选复现失败，修复后1440／390／320宽度的34项边界检查通过，覆盖多行代码块公式、与行内公式混合、整段／局部引用和错误降级；三屏截图已核对。另有8项专项测试通过（Markdown引用3项、实际服务5项），包括代码块公式接收及伪造表达式拒绝；UI类型检查、Web候选构建及diff检查通过。相同gzip level 9测量主JS由607716增至607790字节，增加74字节，仅为本地构建体积比较。

本轮证据在 `.codex/scratch/preview-fenced-math-fix-20261023/`，全部使用合成内容及fake engine。既有全量类型检查问题不在本次修复范围；未提交、部署或重启App，未进行原生安装版验收。
