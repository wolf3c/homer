# 移除输入框底部用量

2026-10-23：按用户“底部这个用量，也是自定义加上去的吧，去掉”的要求，删除输入框下方“用量”折叠入口及展开内容。当前主工作目录、物理目录和 Git 根均为 `/Users/wolf3c/Project/homer`，分支为 `main`。后续用户授权独立提交本批改动；未部署、未重启。

## 来源与实际改动

原 `ui/homer-app.tsx` 的 `MainComposer` 直接以 `state.usage` 为条件渲染原生 `<details className="usage-details"><summary>用量</summary>`，循环格式化最近一次及累计 token，并附加范围说明；`ui/homer-styles.css` 自定义其摘要、焦点、字号和滚动高度。这是 Homer 自定义展示，并非固定官方 Composer 的组成部分。

- `ui/homer-app.tsx`：删除该完整 JSX 区块（4 行替换为外层闭合 1 行）。
- `ui/homer-styles.css`：删除唯一 `.usage-details` 专用样式行。
- `ui/DESIGN.md`：替换旧的底部用量展示要求，记录取消展示的当前决定。
- 本文：保留范围、检查方法、结果与限制。

该区域没有独立组件、import、状态或专用请求；直接消费共享 WebState。删除后 UI 中无 `state.usage` 或 `.usage-details` 消费者，不新增替代入口、设置项或占位。共享 `src/web-contract.ts` 的 `usage` 字段、`src/service.ts` 的原生 usage 监听/读取、`src/store.ts` 的存储、模型上下文压缩配置均未更改；无历史数据删除。官方 TaskCard、RunActivity、ApprovalCard 及 Composer 的发送、停止、队列、附件合同不在本次改动范围。

当前工作树有大量既有及并行修改。源码写入前重新核对前像，只替换上述两处代码块；其独立补丁位于任务 scratch 的 `removal-only.patch`。最终检查确认 `homer-app.tsx` 等于即时前像仅应用本次删除后的内容，未覆盖其他人的工作。

## 验证

证据根目录为 `.codex/scratch/remove-footer-usage-20261023/`，已被 Git 忽略。所有临时构建、脚本、截图、日志、合成数据库均限于此目录。没有连接生产监听、真实聊天、凭据、真实模型或生产数据库。

1. UI 定向类型检查：`node_modules/.bin/tsc --noEmit -p ui/tsconfig.json`，删除前后均通过。
2. UI 隔离构建：在 `ui/` 运行现有 Vite，使用 `--configLoader runner --outDir ../.codex/scratch/remove-footer-usage-20261023/before-web` / `after-web`；删除前后均成功。两次均有已有的大 chunk 提示，未改分包或性能策略。未重写正式 `dist/web`。
3. 现有相关回归：`tests/main-composer.test.mjs`、`tests/homer-attachment-adapter.test.ts`、`tests/queue-edit-input.test.ts` 和 `tests/native-usage.test.ts`，最终 20/20 通过。native usage 原测试硬编码写入另一 scratch 目录，首次受沙箱限制；在本任务 scratch 内使用副本，仅调整 import 和合成目录（缩短路径以满足既有 Unix socket 长度限制），不更改断言或产品代码。其假引擎验证采集、Web 投影及重开后的持久化保持。
4. 实际 Chrome：复用 `tests/fixtures/composer-browser-server.mjs`，独立临时 profile，随机回环端口和纯内存 HTTP/SSE；拦截所有外部请求。夹具明确提供非零最近/累计 usage，删除前 9/9 检查确认入口、展开计数及说明存在；删除后 129/129 检查通过。
5. 三种宽度为 1440、390、320；验证普通输入、Shift+Enter 换行、Enter 单次发送、附件准备及准确身份发送、队列逐项展开、独立停止等待及草稿保留、低视口队列默认折叠/主动展开。正常高度无入口、内容或残余底部占位，输入框底部间距桌面 15px、手机 12px；无页面横向/纵向溢出、浏览器 JS 错误、外部请求或未支持的夹具 API 调用。`git diff --check` 通过。

结果文件为 `before/results.json`、`after/results.json`、`regression-after.log`、`typecheck-before.log`、`typecheck-after.log`、`build-before.log`、`build-after.log`。浏览器运行脚本为 `verify-browser.mjs`，调用参数 `before` / `after`；全部为任务证据，未增加维护性镜像测试。

截图：`after/footer-removed-1440.png`、`after/footer-removed-390.png`、`after/footer-removed-320.png`。同目录另有各宽度的 `attachment-*`、`queue-stop-*`、`stopping-*`、`low-height-*` 和 `low-height-queue-open-*`。

## 现有边界

420px 高度、十行长输入且主动打开队列的组合存在既有底部裁切：1440px 宽输入框底边超出视口 5.375px（按钮完整可见）；320px 宽超出 25.375px，按钮底边超出 16.375px。删除前后值相同；390px 宽无裁切，几何差异小于 1px。默认低视口队列折叠时检查通过。本次未修改这一既有布局问题，亦未声称该极端组合完全可见。

以上为首轮共享源码的隔离验证，不代表运行版已采用，不包含线上性能测量或真实业务验证。

## 独立提交核验

用户追加“完成后，提交代码”授权后，从已提交的 `f7db32fb22e914d9f537e0b38685905245ccf126` 导出独立候选，只应用两个前端删除块、设计约定的一行替换和本文，不复制共享文件中的审批、队列等其他未提交增量。真实索引在准备时为空，并记录其指纹；提交前再次检查 HEAD、索引及准确文件差异。

该独立候选的 UI 类型检查、Vite 隔离构建和 HEAD 已有的 12 项主输入框回归通过。首轮共享源码的 20 项回归和 129 项浏览器检查不冒充独立提交的验证结果。独立构建另外使用同一合成夹具核验三种宽度，126/126 项通过（另有下述三项既有失败明确排除），结果及截图保存在任务 scratch 的 `commit/`，类型检查和构建日志为 `commit-typecheck.log`、`commit-build.log`。

独立候选额外复现 HEAD 既有的旧式只读队列问题：不可排序的行仍进入 useSortable，导致 aria-disabled 继承，浏览器无法点击展开摘要（首轮失败记录为 `commit-first-browser-failure.json`）。本次删除不修改队列组件；该问题的其他任务修复留在工作树中，不纳入本次提交。独立浏览器验收明确排除这三项既有失败，其余入口消失、输入发送、附件、独立停止、队列展示及低视口折叠检查继续执行，不使用强制点击绕过。420px 高度组合的既有裁切边界继续适用。
