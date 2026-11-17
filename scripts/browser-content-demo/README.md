# 网页内容技术 Demo

独立 Electron 宿主；不修改 Homer 产品入口、配置或日常 profile。使用本机项目 Electron、Playwright、React、Vite，另在此目录安装固定版本 React Grab。仅接收本次运行的合成页面，不是任意网站浏览器。

在项目根目录运行（Node 22.22.0，需要桌面图形会话及 Electron 启动权限）：

```sh
npm ci --prefix scripts/browser-content-demo --ignore-scripts --no-audit --no-fund
node scripts/browser-content-demo/run.mjs
```

默认完成交互验收、保存截图/JSON 报告并退出。交互查看可运行：

```sh
node scripts/browser-content-demo/run.mjs --interactive
```

此模式先完成同样验收，再保留最终页面 A 供手动使用（B 已在关闭验收中销毁）。左栏点击“批注”，点击网页元素，填写备注并保存；点击编号可编辑或删除；“浏览”恢复页面业务点击；“继续”交还模拟任务。关闭窗口会退出并清理临时数据。需要再次观察双后台页过程时重跑默认命令。

## 复用和新增

- 原样导入 `ui/annotation-comment-form.tsx` 及样式、`ui/annotation-draft.ts`、`src/preview-reference.ts` 的解析/格式化函数；Popover 使用已有 Base UI。
- `content.tsx` 是薄元素交互层：React Grab 命中/矩形/selector、标记、编辑状态、观察器；不运行默认工具条或 freeze。借鉴既有文本批注的位置观察和编辑模式，未迁移整个文本/图片批注组件。
- `main.cjs` 只管理两个 WCV、任务关联、接手状态及窄 IPC。网页不能获得主界面桥；内容 runtime 注入 preload 的隔离世界 999，样式放在 Shadow DOM 的 constructable stylesheet，未关闭 CSP/webSecurity。
- `host.tsx` 保持一个真实 annotation-draft；保存和引用解析使用真实 Homer 函数。调用经过内容 renderer→Electron main→宿主 renderer→原路回执，未接真实服务 stdin/MCP。
- `run.mjs` 通过 Playwright **实验性 `_electron.launch`** 启动此 Demo、操作 WCV；两个 task ID 是脚本模拟。main-process evaluate 仅为测试驱动能力，未提供给网页或 LLM；不能据此宣称既有 Homer 进程已支持连接或具有生产级工具权限隔离。

## 证据与边界

最终本机运行退出码 0；Electron 45.0.0 / Chromium 156.0.8078.48，Playwright 1.59.1，React Grab 0.2.0。记录：

- [报告](../../outputs/browser-content-demo-2026-11-17/report.json)：15 个针对本次 Demo 的断言组通过。
- [备注弹窗](../../outputs/browser-content-demo-2026-11-17/page-editor.png)、[标记效果](../../outputs/browser-content-demo-2026-11-17/page-annotations.png)、[草稿引用](../../outputs/browser-content-demo-2026-11-17/host-draft-reference.png)。三张均是实际 renderer 截图：前两张为 WCV 内容，后一张仅为宿主 renderer，**不是原生窗口合成截图**。

已验证双隐藏页分别输入、任务不匹配拒绝、隔离页内表单和样式、多标记增改删、草稿失败保留输入、4500 字备注跨 IPC、模式防误触与 timer 继续、接手/继续、DOM 重建及滚动缩放、引用格式化、导航重新注入与旧文档拒绝、关闭页不可用、无 renderer pageerror。源码首次启动曾发现目标事件就绪竞态和重复 React 实例，已分别等待目标发现、统一 React 解析修复；不是以放宽断言通过。

未验证：真实 Worker/LLM 工具选择，Homer service 的消息/sourceId 校验及 4096 字 stdin 通道，安装版 UI，HTTP 以外附件 HTML/相对资源，持久 session 重启与真实登录，系统 IME 组合输入，崩溃/睡眠，OS 焦点保持，popup，跨域 iframe/closed shadow，Windows。中文 fill 不等于真实输入法验收。

导航后，Demo 用当前 URL 建立合成来源记录并保留原草稿；**不冒充真实消息 history 中存在新链接**。产品的原来源＋当前页来源表达仍需接入现有 service 校验。恢复只覆盖 fixture 中有稳定 ID 的元素，不能保证动态业务页的语义恢复。

产物默认写入 `outputs/browser-content-demo-2026-11-17`，可用环境变量 `DEMO_OUTPUT` 指定另一个任务目录。每轮临时构建和独立 profile 位于 `.codex/scratch/browser-demo-*`，正常/失败退出均清理；截图、报告和可复现源码保留。依赖目录仅服务后续重跑，项目清理时可按此目录独立回收。
