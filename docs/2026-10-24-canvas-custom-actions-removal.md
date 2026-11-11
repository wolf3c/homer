# Canvas 自定义文件操作删减（2026-10-24）

按用户“去掉这些自定义的功能”的新要求，删除正文上方的切换文件标签／select、查看原答复／返回对应答复、在文件夹中显示及常驻解释、普通文件的新标签页链接及冗余说明。不用新菜单、标题选择器或 tooltip 替代。

改动仅在前端：`ui/canvas-panel.tsx`／CSS、`ui/homer-app.tsx`、`ui/homer-styles.css`、删除仅供 Canvas 消费的 `ui/artifact-reveal.tsx`，并在 `ui/DESIGN.md` 增加覆盖旧约定的条目。移除失去消费者的文件选项推导、原答复读取回调和专用弹窗。后台 Finder／原答复 API、发布授权、真实文件、原读取路径不变。未改 assistant-ui 官方源码、顶部开关布局或助手气泡；共享工作区的并行改动保留。

文件仍通过聊天中原成果行打开。桌面可从聊天换目标，手机关闭预览后点另一成果；关闭回对应成果行或原预览入口。未选中时只提示从对话选取。官方 Canvas 标题／关闭／正文、WebPreview 工具栏、文本引用、图片区域与网页元素批注保留。HTML 源码默认、显式运行、沙箱与禁网、必要失败／不支持／未确认提示保留。普通文件和网页无空操作栏。

## 验证

所有浏览器检查使用现有合成 fixture、内存数据库、合成文件和隔离 Chrome，屏宽为 320／390／1440。没有真实模型、生产库、聊天发送、Finder、安装或发布。批注发送只进入合成 HTTP 队列。

- UI 类型检查：`node_modules/.bin/tsc --noEmit -p ui/tsconfig.json` 通过。
- 隔离构建：在 `ui/` 运行 `../node_modules/.bin/vite build --outDir ../.codex/scratch/canvas-custom-actions-removal-20261024/build --configLoader runner` 通过。原有大分块警告仍在。
- `tests/official-canvas.browser.mjs`：102 项检查通过。四组操作消失、无空工具栏、空态、从聊天换目标、官方关闭焦点、Enter／Escape、读取失败与准确文件重试、不支持格式、Markdown 数学／表格／代码、图片解码、PDF、HTML 显式执行／隔离／禁网、零 Finder 调用。
- `tests/preview-annotation.browser.mjs`：27 项检查通过。文本引用、图片矩形／触屏批注及原图上传、桌面 Agentation 元素批注、既有主队列、网页官方重新加载／新标签操作、无空工具条。
- `tests/preview-annotation-edge-cases.browser.mjs`：34 项检查通过。公式选文、草稿长度限制、切换 HTML 时迟到批注器不执行新文件。
- 四项 `tests/artifact-reveal.test.ts`、一项 `tests/html-preview.test.ts`、六项 `tests/preview-reference.test.ts`、两项 `tests/official-canvas-upstream.test.mjs` 通过，共 13 项；保留后台授权和隔离合同验证。
- `tests/multiple-artifact.test.ts`、`tests/multiple-artifact-migration.test.ts`、`tests/multiple-artifact-pinned.test.mjs` 共 13 项通过。
- `git diff --check` 通过。

先在修改前的隔离构建运行“删除操作不可见”断言，准确失败；修改后上述检查通过。已人工查看 320／1440 Markdown 与 390 PDF 的实际截图。三屏各格式截图保存在本任务证据目录。

## 本轮发现但未改的旧失败

`tests/canvas-html-publication.test.ts` 两项失败：当前合成 host 缺少 `previewArtifact`，一项在读取时返回 409（期望 200），另一项抛 `app.previewArtifact is not a function`。本次未修改该夹具或后台实现，也未改断言迎合。

`tests/reader-scroll.test.mjs` 13 项在夹具执行阶段抛 `useMediaQuery is not defined`。用 `HOMER_READER_SOURCE` 指向本次修改前的 `ui/homer-app.tsx` 快照，首项同样复现；未接管该旧夹具维护。

历史浏览器验收脚本中仍有针对已删除 select／原答复／Finder 按钮的操作（例如 `artifact-file-list.browser.mjs`、`artifact-reveal.browser.mjs`、`web-history-artifact-origin.browser.mjs`）。本轮现行 Canvas 与批注验证入口是上列三份已更新脚本；不把旧功能验收脚本计为通过。原答复／Finder 后台测试与合同未删除。

## 证据与复核

证据根：`.codex/scratch/canvas-custom-actions-removal-20261024/`。`before/` 保留写入前文件快照；`task-only.patch` 仅包含本次删减及回归／文档；`verification.json` 列出检查、文件哈希和共享区域边界。证据包括 `red/`、`canvas/`、`annotations/`、`edge/` 及各日志。

复跑三份浏览器脚本时设置 `HISTORY_FOLLOWUP_BUILD` 为上述隔离构建，分别设置 `HOMER_SYNTHETIC_ROOT` 和 `HOMER_REVIEW_EVIDENCE_ROOT` 到本任务证据目录下的独立子目录，使用 `node --import tsx tests/<脚本>`。不得指向真实运行目录。

如需撤回，只逆向本次 patch 的对应 hunk，先检查共享文件后续变更，不整体还原 dirty 文件。未创建分支、worktree、提交或发布；源码完成不代表运行版已采用。

## 同日代码复核与提交边界

按用户要求复核正确性、可靠性、简洁性和性能。工具栏外层判断简化为有授权来源、文件预览且为文本或图片；HTML 的 `text/html` 本身属于文本。移除子项重复的网页排除判断，保持 HTML 运行／批注和图片／文本操作的原可用性，不新增状态或计算缓存。

文件读取仍由原 effect 管理 AbortController 和 object URL 释放；切换目标仍使用准确身份重挂；文本、图片与网页回调仍沿原 owner。删去文件目录遍历、原答复请求及 Finder 前端请求，没有新增依赖、监听、网络操作或后台状态。性能结论限于代码路径和浏览器检查，没有新增性能基准或声称测得延迟收益。

本次最小补丁无法直接应用到当前 HEAD 的暂存区：HEAD 中 Canvas 仍为旧版原生 dialog，而写前快照已经使用官方 Canvas／批注；三份本轮浏览器脚本和批注模块也未被 Git 跟踪。整文件提交会包含其他任务未提交的前置实现。暂存区保持原状，需先明确前置改动的提交归属，才能提交准确且可验证的本次差异。
