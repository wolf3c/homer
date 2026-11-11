# 引用与批注入口图标统一

2026-10-25，按用户明确选择，Homer 自有引用／批注入口统一为本机 `lucide-react@0.468.0` 实际导出的 `MessageCirclePlus`。这是 Homer 的图标组合选择，并非 assistant-ui 官方默认。

## 修改范围

- `ui/homer-app.tsx`：消息选文通过原 SelectionToolbar.Root／Quote 的 children 组合；历史引用与 Composer 预览通过原 Root／Text 组合提供同尺寸图标，保留原单条两行、多条／带批注完整展示。原 canQuote capture、Quote primitive、清选区、focusInput 与 Dismiss 接线保持。
- `ui/vendor/assistant-ui/message-actions.tsx`：既有本地适配只更换引用图标，复制／成功反馈、禁用与回调不变。
- `ui/preview-selection-toolbar.tsx`：文件选文“批注”补同图标，复用现有 14px utility 与不收缩规则；原 Mantine／Base UI／表单 owner 保持。
- `ui/canvas-panel.tsx`、`ui/image-annotation.tsx`：HTML／图片批注入口在启用前后使用同一图形，保持 14px SVG、原按钮尺寸及 aria-pressed／busy／tooltip／取消与退出逻辑。
- `ui/preview-reference.tsx`：成果引用展示标识同步使用 12px 图标，原摘录／批注文本及完整显示规则保持。
- `ui/DESIGN.md`、`ui/vendor/assistant-ui/README.md`：记录消费者组合及本地适配来源差异。

固定 `quote.tsx`、生成 CSS、Agentation 原生 Toolbar／Popup、原生标记／chip 编号及普通聊天／文件／复制图标未修改。没有新依赖、图标配置 API、批注协议或后端变更。共享顶部栏／预览 Portal 的并行改动保留。

后续审查将原合成检查保留为维护回归：`tests/unified-reference-icon.browser.mjs` 与 `tests/unified-reference-icon-history.browser.mjs`。通过 `HISTORY_FOLLOWUP_BUILD` 指定准确构建的绝对路径，`HOMER_REVIEW_EVIDENCE_ROOT` 和 `HOMER_SYNTHETIC_ROOT` 指向任务 scratch；不依赖旧 scratch 构建。逐项复核与实际提交见 [后续审查记录](2026-10-25-annotation-header-followup-review-commits.md)。

## 本地验证

- UI TypeScript 检查及 `node scripts/build-run-activity-css.mjs --quote --check` 通过；仅构建隔离 Web UI，不运行完整桌面构建。
- 同一隔离合成脚本在修改前／后运行，覆盖 1440、390、320 CSSpx。修改后每处实际图标为 MessageCirclePlus，历史引用 12px，选文／Composer／消息动作／HTML／图片入口 14px，均可见且没有页面横向溢出。
- 原生鼠标拖选消息仍写准确 messageId／文本，清选区并聚焦原 Composer，保留普通草稿；消息动作引用同样聚焦。文件选文打开原表单并保存到原 annotationDraft；两条消息引用路径均拒绝覆盖已有成果批注。
- HTML 实际隔离 iframe 与图片原生编辑器的启用／退出通过；保留 pressed、HTML 完成后的 busy=false、退出名称及图片 tooltip。测试未强行延迟模块加载，不声称覆盖每个瞬间的连接状态。
- 补查普通、带批注、多条历史引用及成果引用：三种宽度全部保持原两行／完整显示规则。共 12 组宽度检查通过；合成测试未提交消息，模型调用为零，未使用生产账户或数据。
- diff 检查通过；HEAD、暂存区和固定 quote.tsx 与入场快照一致。未提交、安装、重启或发布，当前安装版 build62 不代表采用本源码。

隔离脚本、构建、前后快照、逐项 JSON 与桌面／手机宽度截图保留于 `.codex/scratch/unified-reference-annotation-icon-20261025/`。`probe.mjs` 检查入口与交互，`history-probe.mjs` 检查历史展示。截图使用桌面 Chrome 的窄视口，不代表实体手机／WKWebView 原生选文验证。最初一次程序化消息选文的基线超时，改用原生鼠标拖选后前后核验均通过，未因此修改产品选区逻辑。
