# 紧凑顶部一行两区

2026-10-25，任务 `609f744e-9ac5-433c-859e-120d77b60dce`。已批准设计已落实到实际 HomerApp；维护源码候选，未提交、安装、重启或发布。共享 main HEAD 为 `493ead1576ba08e59987f9db96a55ae4843a90b9`，已安装 build62 保持冻结。

## 实现与边界

原 conversation-header 移入原 Group 的 conversation Panel，在原 workspace 上方形成纵向布局，与右侧 CanvasPanel 标签工具栏自然同顶、同高。原比例、25%下限、Separator保持；没有将 Tabs Portal 到全局顶栏，没有第二比例监听器、header控制器、依赖、实体或store。

普通桌面左右行高44px，≤800px或粗指针52px。河马沿原资产缩为24px，小品牌字14px；微信／状态／预览按原顺序保留职责、连接状态与ARIA，点击区44×44px、图标18px。聊天栏小于240px只隐藏品牌文字，图片保留“荷马”可访问名称。阅读字号不缩。

右侧只改局部CSS。标签rail独立横滚，动作固定；普通桌面批注28px／14px图标，手机／粗指针批注、文件关闭、收起44px。原TooltipIconButton的transition-all曾令断点目标临时插值至40.484375px；局部限定颜色过渡，使触摸尺寸立即到位。vendor源和生成样式不改。

先行任务 `bfac4da5-c768-4626-92f0-01131209e917` 已实现删重复文件名行、稳定actions Portal、手机退出和焦点。本任务直接复用，没有再改CanvasPanel／CanvasReader接线。桌面有标签通过原全局预览开关收起，不增第二收起按钮；手机保留原模态内收起及背景隔离；空态／受控网页fallback沿原owner。

`2026-10-25-preview-header-row-removal.md` 的49px收益、28px手机按钮和“尺寸冲突待组合”描述属于先行独立候选。本任务按后来批准的44/52px设计接合，并更新准确尺寸回归；不覆盖其Portal、Tooltip/Escape、Reader或草稿逻辑。另有并行引用图标工作，保留其源码与文档，task-only补丁不含该工作。

状态继续由原workspace ResizeObserver按实际宽度≥1120px决定常驻320px摘要，原TaskStatus Portal保持。1440无预览可常驻，1440对半分栏用Popover，2560对半可并列。主消息runtime、SSE、引用、ArtifactsContext、滚动锚点及Composer owner保持。

原单Dialog／Reader、HTML token/frame、Annotorious、annotationDraft、Enter保存／Shift+Enter换行／IME保持。800px只改布局/modal，不重建阅读器。HTML底部反馈未纳入顶部收紧；HTML原生英文、Electron/window/bridge及原生标题栏均未改。未访问模型、真实渠道、生产账号或运行数据。

## 实测高度

实际产品合成HTTP页面，Chrome，CSSpx、DPR1。测量预览正文容器上沿，不含内部padding；原生窗口栏N未测且未改，不计收益。

| 场景 | 冻结build62网页 | 入场共享树 | 本候选 | 对build62 / 入场净收益 |
| --- | ---: | ---: | ---: | --- |
| 1440全局栏 | 76 | 76 | 44 | 32 / 32 |
| 1440预览正文上沿 | 166（76+41+49） | 117（76+41） | 44 | 122 / 73 |
| 800模态预览正文上沿 | 90（41+49） | 41 | 52 | 38 / −11 |
| 801本候选左右工具栏 | 本轮未采集 | 本轮未采集 | 44 | 不将设计Demo计为产品实测 |

先行任务提供的49px不重复计为本任务收益。手机对入场树增加11px，换得52px行与44px触摸目标。2560、250px右栏、200px左栏、801/800/799及390/320详细几何见证据JSON。

冻结网页基线由本任务scratch内对冻结提交ui/src/assets的只读提取和隔离Vite构建获得，没有checkout或启动安装版。未提交dist import补入现有本地批注runtime资产，但基线仅打开静态文本，未激活该资产。这是冻结提交的网页几何验证，非已安装build62或完整发布包重新认证。原设计Demo的24项检查不计入产品通过数。

## 验证

临时证据全部在 `.codex/scratch/compact-header-implementation-20261025/`。使用真实HomerApp、HTTP路由、合成owner、随机端口、禁止执行的fake engine、全新Chrome profile，隔绝外部请求。实际通过数与源码／构建哈希见下方最终记录和 `verification.json`。

- `tests/compact-header.browser.mjs`：44/52px同顶边、无整页横溢出或外层纵滚；1440无预览／状态／分栏、2560并列；状态明确关闭后SSE/resize不重开、settled读取无新增；真实拖拽250px右栏／200px左栏及三入口；多长中文／ASCII标签独立横滚、活动close邻项焦点；实际阅读手势后的滚动位置／Composer底边；运行中HTML跨801/800/799保留iframe/actions/Tab且脚本执行一次；手机焦点陷阱／背景隔离、粗指针密度和200%等效重排。
- `tests/preview-tabs.browser.mjs`：保留关键生命周期／owner断言，密度适配为桌面28／手机44且SVG14。检查单Reader、切换销毁／abort／URL释放、close/fallback、迟到HTML及代际、原生图片editor/layer/Portal跨断点同实例、临时文本／几何取消、保存chip。主Composer发送／未知回执场景仅使用合成HTTP owner，不调用模型。
- `tests/preview-header-row.browser.mjs`：手机密度适配；fallback初始焦点能展开原Tooltip，明确验证Escape先关提示再关Dialog，保留退出／背景断言。busy取消、HTML激活、同actions槽、无重复header、末文件回焦和空预览均检查。
- 原 `tests/annotation-enter-save.browser.mjs` 原样复跑：共享表单及实际文本／图片消费者Enter、Shift+Enter、修饰键、IME/229、错误保留、保存chip／不自动发送。
- UI／服务TypeScript、隔离Vite build、Canvas源hash／生成CSS检查及预览／批注／状态定向合同测试。

首轮失败证据保留：旧布局红测76≠44；阅读手势缺失、跨隔离世界读取window变量、重复文件名定位及错误模拟pointer媒体条件均修正于夹具。实际40.484375≠44定位到transition-all，修复局部CSS后转绿。没有修改表单、vendor或业务校验消除失败。

`reader-scroll.test.mjs` 13项在准确入场前像也都因`useMediaQuery is not defined`失败，候选同样13项；未改旧夹具或计为通过。实际Chrome检查补充本次阅读位置／主输入底边／无外层滚动。原状态runner因本机未安装`playwright-core`退出`ERR_MODULE_NOT_FOUND`；未安装依赖，改用现成CDP覆盖本次涉及的状态路径，不声称完整runner通过。

200%是720 CSSpx、DPR2的等效重排，非真实Electron zoom或浏览器菜单缩放。实体手机、虚拟键盘、真实系统IME候选、屏幕阅读器、已安装Electron和生产环境未测。合成IME和手机viewport截图不作为真机证据。构建保留已有大chunk提示，未调整打包策略。

## 复跑与回退

仓库根目录，使用已安装依赖，不安装包：

```sh
node node_modules/vite/bin/vite.js build ui --config ui/vite.config.ts --configLoader runner --outDir ../.codex/scratch/compact-header-implementation-20261025/web
HOMER_SYNTHETIC_ROOT=.codex/scratch/compact-header-implementation-20261025/synthetic HOMER_REVIEW_EVIDENCE_ROOT=.codex/scratch/compact-header-implementation-20261025/browser-verified HISTORY_FOLLOWUP_BUILD=.codex/scratch/compact-header-implementation-20261025/web node --import tsx tests/compact-header.browser.mjs
node node_modules/typescript/bin/tsc -p ui/tsconfig.json --pretty false
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --pretty false
node scripts/build-run-activity-css.mjs --canvas-split --check
```

`before/`保留入场前像，`edit-bases/`保留并行任务后产生的测试／文档前像。`task-only.patch`仅含本任务hunk；`identity-before.json`、`identity-after.json`、`preservation.json`核对HEAD/index和未触碰owner。回退只逆向本次局部hunk，不整文件restore/reset，不删除先行Portal／手机退出／Tooltip/Escape或独立图标工作，不碰其他dirty。无持久数据迁移。

## 最终交付记录

同一最终构建的实际浏览器检查：顶部布局18组、多标签／生命周期127组、工具栏接缝20组、Enter／IME15组、受控网页／空态3组全部通过。定向单元／合同17项通过。UI及服务TypeScript、隔离Vite构建、Canvas生成CSS可复现及脚本语法检查退出0；原reader-scroll 13项基线失败与缺少playwright-core的runner未计入通过。

最终源码指纹为 `39cdfe5ff73395ceca555b29988666de92d0b4b39544e364dbb7e95bb924a536`，计算范围与逐文件SHA256在`candidate-source-manifest.json`（tracked ui/src/assets、package/package-lock及本地批注runtime，排序JSON摘要）。最终主bundle为`assets/index-C3WNKmFK.js`；构建产物逐文件哈希在`verification.json`。产品运行源码在最终构建与回归结束之间未变化；收尾并行任务只为ui/DESIGN.md补一处验证文档链接，准确差异另存post-build-doc-update.patch，交付时文档指纹另存delivery-source-manifest.json。

实际已查看的截图：[1440桌面](../.codex/scratch/compact-header-implementation-20261025/final-browser/preview-1440.png)、[390手机HTML](../.codex/scratch/compact-header-implementation-20261025/final-browser/html-390.png)、[320手机](../.codex/scratch/compact-header-implementation-20261025/final-browser/preview-320.png)、[2560状态并列](../.codex/scratch/compact-header-implementation-20261025/final-browser/preview-2560.png)。其余宽度、长标签、触摸和等效缩放PNG及原始几何在同目录。以上为本地合成HTTP验证，非安装版或真机采用证据。
