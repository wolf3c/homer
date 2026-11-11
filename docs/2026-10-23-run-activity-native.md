# 2026-10-23 直接采用官方 Run Activity

## 后续候选：活动信息完整接入与普通文字展示

用户进一步确认样式展示完全交给 RunActivity，工具活动采用官网基础示例的普通文字条目，保留已批准 Worker 事件卡。此次只补事实与适配，不改变固定 RunActivity／Collapsible 源码、官方 CSS、展开规则或新增依赖、数据表、Web API、状态库；消息调度和公开协作答复逻辑沿原 owner 保持。

新过程在原 start 事务中写入一条既有 commentary，说明用户消息或 Worker 提问、操作确认、结果回传、成果审阅、修订通知的来源。公开任务名取准确事件版本并沿原名称守卫；缺失只省略显示，不阻断原处理。续接、重放不重复，不回填旧历史，也不放开内部文本过滤。主端宿主工具统一记录开始与调用结束，协作检查、答复、转交用户、消息发送和回执确认不再漏记。原生搜索、看图、图像生成、外部 MCP 与动态工具只接入安全名称、类别、状态及原有时间证据；Homer 宿主调用不在原生入口重复记录，参数／结果正文／命令输出／查询词／路径不进入公开记录。

工具使用一个普通 p，label 与 content 取同一份动作／对象／结果文字；普通读取简写“已读取”，明确业务结果替代重复“调用已返回”，失败／拒绝／未知仍独立说明。删除双行回执及三个专属工具行样式，旧消息复用同一文字映射。已有阶段证据通过 statusLabel 直接显示，不依赖 commentary 是否存在；不复制阶段历史。输入框内部轮统称“正在处理协作事项”。Worker 卡片及原历史、审批、正式交付入口保持。

本轮验证及复核材料在 `.codex/scratch/run-activity-complete-20261023/`，均使用合成数据与隔离浏览器，没有访问生产数据、调用真实模型、发布或重启。新增7项来源／协作工具／安全原生事件／组件回归通过；320／390／1440px 验证来源、阶段、普通 p、14px／12px／1px官方列表指标、待发送用户消息、展开选择和历史阅读位置通过。服务端和 UI 类型、隔离 Vite 构建及固定官方源码／CSS 检查通过；原构建大 chunk 提示保留。

实施阶段混合工作区的扩大回归共77项（跨组重复项只计一次），68通过、9失败，不能称全绿。最后同版宿主检查为27项、19通过、8失败，检查前后相关源码无漂移；排除本轮增量后相同8项失败逐项复现。包括5项旧过程夹具与当前引擎／发布owner不一致、1项启动未确认期望差异，以及2项等待阶段夹具缺 acceptedRequestIds。另1项连接恢复断言在修改前的等待状态源码和原断言中复现。检查期间出现过的3项Worker回传超时没有在最终同版检查中复现，不计为最终失败，也未声称由本轮修复。未放宽这些断言或扩展修复其所属功能。准确记录为 `focused-final.tap`、`new-regressions-final.tap`、`current-related-final.tap`、`baseline-related-final.tap`、`baseline-ui.tap`；源码覆盖和副本仅用于隔离复核，不替换工作目录。原有三屏样式验收另通过键盘空格展开、焦点、200ms动画及 reduced-motion。

这是已验证的本地源码候选，不表示正式服务已采用。以下内容保留此前独立交付的历史记录。

### 审阅与独立提交验证

审阅将本轮增量从混合工作区分离，排除其他任务的队列／引擎／协作答复修改及其暂存内容。来源说明改用已提交的 MainContext.workerMessages 和 Worker 交互对应 Run 的版本，不依赖尚未提交的 WorkerInput；交互 Run 的版本优先于通知中的其他版本。多消息批次保留中性说明，不把某条消息的名称当成整批任务。浏览器回归直接复用已提交的合成夹具，避免依赖其他任务的未提交测试文件。

最终独立候选基于父提交 `280f428a2e9e2f416baf5df00d7c2c4ffb26f7fc`，仅加入本轮16个路径的增量。相关27项回归全部通过，覆盖来源、协作工具、原生元信息、旧消息、官方组件及异常回执；服务端／UI 类型与隔离 Vite 构建通过，320／390／1440px 浏览器检查通过。审阅修正了旧历史 blocked 被通用映射改写的回归，保留原“已中断，待核对”语义，原断言保持。浏览器先等待展开动画与用户滚动事件完成，再验证更新不移动阅读位置，保留原滚动断言。

原生活动类别映射提升为模块常量，避免每个通知重复创建同一对象；工具文字映射改为直接分支，保持单个普通 p 与原默认折叠。基于 `9b5d97c` 的同版合成性能对照为10万条事件解析及每轮250次调用的内存记录：父版本／候选解析中位数2.23／1.84微秒每事件，持久化中位数0.69／0.58毫秒每事件，最终记录大小均为88605字节。该样本没有显示新增开销，不代表生产延迟或设备间性能保证；没有新增网络请求、模型调用或轮询。审阅证据在 `.codex/scratch/run-activity-review-20261023/`，源码与构建哈希绑定准确候选。

按用户澄清，Working／Worked 直接采用固定上游 Run Activity，不添加汇总阅读器、额外页头或自动展开规则。随后用户明确取消逐项活动详情阅读器；本次审查按用户选择，等待该任务完成后整合其相关增量，见 [功能移除记录](2026-10-23-remove-activity-reader.md)。已批准的不可变 Worker 事件卡保留。

本文记录以 `7597e1bfafa0cf015e1c14d3365e9cde98699183` 为父版本的最终提交候选及其独立验证。源码提交与运行版采用分开；本轮没有发布、重启或访问4780业务接口。

## 最终行为与边界

- 原调用按准确 ID、revision 和原顺序进入同一个官方列表，同名调用不合并，不补写历史。公开动作、对象、结果与真实调用状态直接展示；调用返回不代表检查通过或正式交付。
- 移除“查看原调用记录”的汇总与弹窗、“协作记录”、调用返回总数、耗时缺失说明及其专用样式。异常仍使用官方 attention，可靠计时继续显示。
- 初始收起，之后仅随用户操作改变 open；流式更新、完成和断连不强制改变选择，不保存展开状态。空 entries 使用官方状态行；历史仍由原展开按钮授权懒读，迟到响应在线程切换后不能复活旧内容。
- 移除 ActivityReader、活动导航 Context、活动内详情/任务/成果/原答复跳转，以及无剩余消费者的旧 TaskOverviewPanel 和专属样式。没有以新 Dialog、Drawer 或其他入口替代。服务端事实与公开读取合同保留。
- Worker 事件卡沿原事件正文，折叠时可见，展开按原序且只出现一份，无按钮；旧 Worker 缺失事件正文时保留中性说明。普通 FileList／Canvas／准确原答复、顶部 TaskCard、待答和审批保持其独立 owner。

## 官方组件与必要接入

`run-activity.tsx` 与固定上游 `1f41f91643fdb56e5d8dbd14db65f742740738a1` 仅有 cn 导入路径不同；恢复该路径后 SHA-256 为 `1b838ae6054c2c45535701af231291436e77da1d6215a2c2a80a313de5aaeace`。`collapsible-root.tsx` 完全原样，SHA-256 为 `6d3e6d9a776ac9db13448606627c2ef51e5605cacb2f805379ada9b58abe4565`。直接使用原 collapsePanel 常量和已有 Lucide 图标，不扩展 triggerProps/contentProps、不替换折叠实现。

用户批准的 `@base-ui/react@1.8.0` 已由共享前置提交纳入；本次不重复安装或升级依赖。阅读器移除只删除 FocusScope 的直接 workspace 声明，保留仍有消费者的同版本传递依赖。CSS 由现有 Tailwind 编译官方类名，只隔离作用域并绑定宿主颜色；base 层排除条目内容，避免重置 Markdown 列表标记和已批准卡片。没有手写替代字号、间距或动画。

Homer 仅提供准确身份、公开事实、真实计时、授权懒读与异常。CSS 编译器保留现有 Quote／Attachment／Image-File 分支及参数优先级，默认 Run Activity 分支单独处理内容重置边界。开发候选编译前检查生成 CSS；UI build/dev 生成该 CSS。

共享工作树中的队列、审批、后端、记忆等其他任务增量不纳入此次提交；共享 App、DESIGN、README 和 dev-build 按 hunk 整合。任务生命周期、MAIN_TOOLS、权限、数据库和正式成果归属不变。

## 审查与实际验证

使用父版本 Git archive 加准确提交文件的独立源码快照验证；它没有 .git、运行目录或生产配置，只复用现有 node_modules。验证发现并纠正两类问题：测试辅助函数对缺失点击目标会误通过；新增浏览器夹具依赖未提交后端 collector/数据库列。现在缺失目标明确失败，浏览器夹具仅注入合成公开事实，继续使用已提交的真实 HTTP、任务、文件与历史 owner。

- 37/37 过程投影、阅读、懒读、活动取消及上游来源回归通过。
- UI TypeScript、隔离 Vite 构建、四个 CSS 分支的 `--check` 通过。开发升级两项既有合成回归也通过。
- 隔离 Chrome 156，320／390／1440 三种宽度，33项原记录/混合/异常/样式检查与39项公开事实/阅读器移除/Canvas/顶部状态检查通过。覆盖同名独立调用、运行更新、失败/拒绝/中断/未知/受阻、历史懒读、键盘、reduced-motion 和 Worker 单份呈现。
- 默认详情读取和工具行 DOM 为零；展开后保留24次原调用身份。列表保留原生标记，Markdown 标题18px；官方标题/箭头14px、间距12px、列表线1px、折叠过渡200ms，reduced-motion 为0s。
- 同一父版本/工具链独立构建比较：主 JS 原始体积减少29,168字节，gzip减少7,498字节；主 CSS原始体积增加7,555字节，gzip减少508字节。没有新增轮询、计时器或逐项活动读取。这是构建与具体读取行为证据，不是通用CPU性能跑分。

验证未触发真实模型、上传、发送、审批或停止业务操作，没有读取生产数据库。没有全仓重测或Safari/线上验证；Vite既有大chunk提示保留。

阅读器移除任务另外核对的旧 interruption 投影测试仍有4项基线失败：一项旧SSR摘要断言、三项mock缺 inputs.dispatchSummary，详见其移除记录，未放宽合同。手机 Canvas 定位准确原答复后，原模态关闭会把焦点还给成果按钮，修改前后相同；普通关闭还焦、顶部状态关闭还焦及原待答聚焦通过。该独立既有问题未在本范围修复。

## 复现与证据

最终候选、日志、截图和hash在 `.codex/scratch/run-activity-commit-review-20261023/`；`candidate-integrated.json` 标明源码和文件快照，`unit-integrated.log`、`build-integrated.log`、`browser-merged-legacy/`、`browser-merged-facts/` 与 `bundle-integrated-comparison.json` 对应本文结果。早期保留阅读器的截图/预览仅作历史前像，不能当最终候选。

从项目根使用Node22及现有依赖：

```sh
node --import tsx --test tests/legacy-activity-reading-ui.test.mjs tests/process-nodes-ui.test.mjs tests/process-presentation.test.mjs tests/process-reading.test.mjs tests/run-activity-upstream.test.mjs tests/run-activity-facts-ui.test.mjs
node node_modules/typescript/bin/tsc --noEmit -p ui/tsconfig.json
node scripts/build-run-activity-css.mjs --check
```

浏览器用例复用已有Playwright，通过 HOMER_PLAYWRIGHT_MODULE 指定其 index.mjs，不安装依赖。先在ui目录以Vite构建至专属scratch，再从项目根运行以下两条；HISTORY_FOLLOWUP_BUILD指定准确隔离构建，HOMER_SYNTHETIC_ROOT与HOMER_BROWSER_EVIDENCE均指定任务scratch目录：

```sh
node --import tsx tests/legacy-activity-reading.browser.mjs
node --import tsx tests/run-activity-facts.browser.mjs
```

## 回退

此次提交只含本范围及获准整合的阅读器移除；没有持久化数据变化。后续回退应先检查后续修改，再仅反向该提交的相关hunk，不整体恢复共享工作树或删除已被其他组件复用的编译脚本。依赖只处理准确manifest/lock声明，不批量重装。运行版采用仍需独立发布流程。
