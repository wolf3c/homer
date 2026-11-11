# 官方 Canvas 的可复用边界（2026-10-23）

## 最终结果与范围

官方成品是 `CanvasSplit` 文档分栏，而非全格式成果阅读器。用户核实后澄清：“尽量使用 assistant-ui 组件完成相关功能；其中的自定义功能尽量改为使用 assistant-ui 组件代替。”已完成源码候选：官方 Document/Header/Body 替换阅读区结构，完整官方 WebPreview 替换网页工具栏；图片沿已有官方 Image。未安装/升级依赖、改数据合同、部署或启动生产。

这是部分复用，不以套入容器宣称完整 Canvas 引擎替换。Header删除不适用的version/saved/copy，保留准确标题与关闭；Document/Body为原样截取，WebPreview全组件仅改导入和中文。保留单一原生dialog及现有文件选择/读取状态；不新增runtime、adapter、主题或第二面板。原文件格式、安全、导航和生命周期继续由原逻辑负责。

## 环境与来源

- 登记工作目录、`pwd`、真实目录和 `git rev-parse --show-toplevel` 均为 `/Users/wolf3c/Project/homer`。
- 遵循会话提供的 AGENTS 指令；根目录、`ui/`、`ui/vendor/` 及 `ui/vendor/assistant-ui/` 没有额外 AGENTS.md。已读 `ui/DESIGN.md`、`ui/vendor/assistant-ui/README.md`、当前实现与锁文件。
- 工作区有大量并行修改。实施前保存前像；未编辑 `ui/homer-app.tsx`。编译器、package scripts、DESIGN及vendor README只追加本功能hunk，保留并行Sources/ApprovalCard/日期说明。不恢复活动阅读器，不操作其他任务。
- 当前锁定 `@assistant-ui/react@0.15.29`、core `0.3.30`、react-markdown `0.14.23`；CanvasSplit 是 registry 源码组件，不是这些包中已安装的完整 Canvas 导出。没有安装、初始化或升级。
- 官方文档：[Canvas](https://www.assistant-ui.com/elements/canvas-split)、[WebPreview](https://www.assistant-ui.com/elements/web-preview)。文档明确说明 Canvas 没有专属 canvas/artifact primitive，WebPreview 不提供隔离。
- 固定来源：[assistant-ui/assistant-ui `1f41f91643fdb56e5d8dbd14db65f742740738a1`](https://github.com/assistant-ui/assistant-ui/tree/1f41f91643fdb56e5d8dbd14db65f742740738a1)，与现有 vendor 一致。完整递归树返回 `truncated:false`。

| 固定路径 | Git blob | SHA-256 |
| --- | --- | --- |
| `packages/ui/src/components/react/assistant-ui/elements/canvas-split.tsx` | `c5c112c1b778f11ba00eb1286cac8aa1f28de9a9` | `219b3cd94b2c54d0f89f984156fa0e76081808295f883a8e487cf6f5ba90ad6c` |
| `packages/ui/src/components/react/assistant-ui/elements/web-preview.tsx` | `8d6747cd19e6f980f6b19e1775ff9b610ee2d03d` | `aa8e24257fe85d232b578799ef175adc563ebd12a2d2851fc3acd6fe5cc9cad9` |
| `LICENSE`（MIT，现有 vendor 已保留同一许可证） | — | `eafb05991a572efa34097474b31fef45b14a8879ed1d1a8fd77de62e6fa7d275` |

另核对同一 SHA 的 `examples/with-artifacts/app/artifact-surface.tsx`、`artifact-state.ts`、`package.json`。该示例依赖 interactable 状态/版本系统，文档仅有 title/code、默认 HTML 交互预览并可编辑/恢复版本；不是多格式只读文件阅读器。其 `sandbox="allow-scripts allow-forms"` 没有 Homer 的显式执行和 CSP 网络禁用合同，不能直接替换。

## 当前与原版的具体差异

| 范围 | Homer 当前合同 | 官方实际能力及替换边界 |
| --- | --- | --- |
| 分栏 | 满高、桌面对半；800px 及以下全屏 Canvas | `CanvasSplit` 最大宽 48rem；容器从 36rem 起横排、高20rem，线程宽15rem；更窄上下堆叠。替换整页需覆写这些原版布局并改变 `homer-app.tsx`，不能称原样采用。 |
| 标题 | 准确文件标题、关闭/返回 | `CanvasSplitHeader` 提供图标、截断标题、版本、saved/editing、复制、关闭。version/saved 为必填；缺少回调只禁用按钮、不隐藏。当前 CanvasArtifact 只有 id/title，不能填虚构版本或把读取结束说成保存。 |
| 正文 | Markdown、代码、文本、图片、PDF、HTML、手动网址 | `CanvasSplitBody` 只提供正文布局及写入光标；`CanvasSplitLine` 是文本段落。它们不读取文件或识别/渲染上述格式。 |
| 文件/网页 | 准确授权集合切换、手动 URL、可返回当前或原答复 | 无相应数据/选择/来源导航。ArtifactCard 是成果摘要入口；WebPreview 是外围工具栏，传入的 children 原样渲染。 |
| HTML 安全 | 默认源码，静态/交互均明确操作；独立 origin、CSP、禁网、协议/账号校验 | CanvasSplit 无执行或隔离机制；WebPreview 也无。不能用官方名称替代原安全所有者。 |
| 生命周期 | Abort、迟到响应丢弃、对象URL撤销、窄屏原生模态、iframe焦点、关闭回焦及原位置 | CanvasSplit 无这些行为。onClose 只是调用宿主回调。原合同必须继续保留。 |

已删除旧canvas-header DOM及标题布局/字号CSS，移除外层手写正文flex方向、间距、内距和滚动所有权；阅读结构与正文滚动由官方组件负责，标题保持可达。网页的新标签入口转到官方工具栏，重载回调直接重设现有iframe的已校验src，无第二套网页状态。自定义业务按钮样式收窄到剩余控件，避免污染官方ghost按钮。

保留桌面对半外层布局、800px及以下全屏和安全区、原生modal/iframe焦点、文件集合/原答复身份、格式渲染和所有安全/资源逻辑。安装版本的MarkdownTextPrimitive读取message-part context；不为文件复制runtime/消息状态以替换现有安全Markdown渲染。PDF沿浏览器原生渲染，HTML沿原安全所有者。原生文件选择和网址输入承担官方正文/readonly origin栏不提供的功能。

## 实际适配与文件

仅复制已消费的Document/Header/Body，不复制未消费的线程/演示文本行或整页320px布局。Header增加closeButtonProps传递原close ID/ref、中文标签及标题title，不增加新关闭状态。局部CSS补44px/focus、长名换行、正文最小高度/overscroll和WebPreview可用宽度。WebPreview重用现有官方ShimmerLabel。`loading={false}`代表不加加载遮罩，不能推导外站加载成功；原跨域无法确证提示、sandbox和referrerPolicy保留。

修改：`ui/canvas-panel.tsx`、`.css`、`scripts/build-run-activity-css.mjs`、`ui/package.json`、vendor README及`ui/DESIGN.md`；新增vendor `canvas-split.tsx`、`web-preview.tsx`、`canvas-split.source.css`及生成CSS。局部编译入口`--canvas-split`，`--check`可重现。新增`tests/official-canvas.browser.mjs`及`official-canvas-upstream.test.mjs`；现有CDP助手只暴露已有send为command，以查看Chrome独立进程的沙箱iframe，不关闭站点隔离或修改应用能力。官方源码比旧手写标题更长，生成CSS也增加；减少的是自写布局/工具栏的维护职责，不能声称总源码减少。

验收使用实际320/390/1440合成数据，复用现有成果浏览器合同并补受影响场景。未编辑`homer-app.tsx`或服务端安全代码。候选仅在隔离合成服务运行。

相对实施前像的准确代码增删（排除并行改动，逐文件哈希及可逆补丁在任务scratch）：

| 文件/范围 | 新增行 | 删除行 |
| --- | ---: | ---: |
| `ui/canvas-panel.tsx` | 10 | 3 |
| `ui/canvas-panel.css` | 4 | 8 |
| CSS编译器 | 3 | 3 |
| `ui/package.json`构建命令 | 2 | 2 |
| 现有CDP测试助手 | 1 | 1 |
| 新增固定官方组件源码 | 189 | 0 |
| 新增局部CSS输入/生成输出 | 22 / 658 | 0 |
| 新增浏览器/来源测试 | 111 / 19 | 0 |

DESIGN及vendor README分别只添加8行和17行的本功能说明；不覆盖原有记录。官方组件及生成CSS增加不等于自定义引擎增加；此次未新写文件渲染引擎。

## 已执行验证及限制

所有临时文件在 `.codex/scratch/official-canvas-reuse-20261023/`。原样官方 CanvasSplit 源码作为输入，别名只指向既有 cn/surfaces；未改组件实现。使用现有 Tailwind 4.1.14 编译其真实 utility，Vite 8.3.4 构建成功；合成演示使用宿主暖灰主题映射和简单页面容器，未覆盖组件布局。无安装、模型调用或真实业务请求。

隔离 Chrome 在320/390/1440均成功渲染、无横向页面溢出、无JS异常、无外部请求；关闭回调正常。320/390均实际上下堆叠；1440下测得外框768×322、线程240px、内容320px高。三个宽度均没有 dialog；标题实际显示v3/saved（仅合成演示数据），按钮28px。此验证证明原版组件边界，**不证明 Homer 已完成替换或应用场景验收**。

原版边界证据：`official-browser-evidence.json`、`official-canvas-split-{320,390,1440}.png`；来源与哈希在`upstream/`。`build-demo.mjs`与`verify-demo.mjs`可重现。以下是另行验证的产品候选，勿混淆原版演示与实际接入。

### 产品候选的红绿与浏览器验证

- 红：新增浏览器回归在旧前端失败于“official header replaces custom header 1440”，证明旧DOM尚未替换；基线构建和失败截图留在`baseline-web/`及`red/`。
- 绿：`tests/official-canvas.browser.mjs`通过60项，覆盖320/390/1440，真实顶部打开与官方关闭焦点、无虚构保存/版本状态、44px/原生modal、URL拒绝javascript、真实iframe重新加载及新标签安全选项、Markdown表格/数学/代码、正文滚动时关闭区可达、PNG实际解码、PDF实际渲染、HTML默认源码/静态不执行/明确操作后可点击/无法访问父DOM，并通过securitypolicyviolation事件确认网络由实际connect-src CSP拒绝。
- 现有`tests/artifact-file-list.browser.mjs`通过81项，覆盖1440/704/390/320、成果行打开、准确选择与旧答复/兄弟文件、Tab循环、焦点/原位置、失败重试、迟到文件/原答复响应、草稿和对象URL释放；无模型/业务提交。
- `tests/official-canvas-upstream.test.mjs`两项固定源码校验通过；`tests/html-preview.test.ts`隔离shell/CSP/API origin合同通过。HTML测试首次被默认沙箱禁止localhost listen，使用获准的隔离测试执行后通过，不改测试预期或安全策略。
- 前端`tsc -p ui/tsconfig.json --noEmit`通过；Vite8.3.4隔离候选构建通过，仅有既有大包提示。`--canvas-split --check`及diff空白检查通过。

重现（需现有依赖；Chrome为隔离新profile）：

```sh
node scripts/build-run-activity-css.mjs --canvas-split --check
node node_modules/typescript/bin/tsc -p ui/tsconfig.json --noEmit
node --input-type=module -e "import('./tests/helpers/build-approval-ui.mjs').then(m=>m.buildApprovalUI('.codex/scratch/official-canvas-reuse-20261023/candidate-web'))"
HOMER_SYNTHETIC_ROOT=.codex/scratch/official-canvas-reuse-20261023/product-runtime HISTORY_FOLLOWUP_BUILD=.codex/scratch/official-canvas-reuse-20261023/candidate-web HOMER_REVIEW_EVIDENCE_ROOT=.codex/scratch/official-canvas-reuse-20261023/product node --import tsx tests/official-canvas.browser.mjs
HOMER_SYNTHETIC_ROOT=.codex/scratch/official-canvas-reuse-20261023/flow-runtime HISTORY_FOLLOWUP_BUILD=.codex/scratch/official-canvas-reuse-20261023/candidate-web HOMER_REVIEW_EVIDENCE_ROOT=.codex/scratch/official-canvas-reuse-20261023/flow node --import tsx tests/artifact-file-list.browser.mjs
node --import tsx --test tests/html-preview.test.ts tests/official-canvas-upstream.test.mjs
```

产品证据：`product/browser-results.json`、`flow/browser-results.json`；`product/canvas-{markdown,image,pdf,web,interactive}-{320,390,1440}.png`。已目检320px Markdown/PDF、390px网页及1440px PDF，PDF可见合成正文。后者是浏览器原生PDF查看器，浏览器自己的工具按钮不是新增Homer下载入口。未验证其他浏览器、登录外站或线上；外站能否嵌入仍由站点决定，不报告加载成功。未跑无关全套测试。
