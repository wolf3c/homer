# 工作状态右侧常驻摘要

2026-10-24；本地源码实施与合成验证，未提交、安装、发布或重启。

工作状态从左侧品牌旁的计数入口移到右侧列表图标，位于微信之后、最右预览图标之前。Logo／荷马名称保持。图标有“工作状态”可访问名称、真实计数 title、aria-expanded、aria-controls 及44px点击区。

`ui/homer-app.tsx` 在原 react-resizable-panels 聊天栏内提供摘要位置，`ui/task-status.tsx` 观察该栏实际宽度。1120px及以上默认常驻320px摘要，至少保留800px给聊天及原内距；不足时沿原 Radix Popover，缩窄不自动打开。预览不被关闭，也不新建工作区。2560px可同时容纳聊天、摘要与预览；拖窄聊天栏同样触发回退。

桌面显式关闭选择保留在当前组件会话，SSE、读取代际、断线恢复或跨断点不强行重开；手机临时弹层的开关不修改桌面选择。只挂一个列表，沿原 `useTaskStatusData` 读取、缓存、2秒合并刷新与原进展读取。原数据 owner 持有准确身份的展开 Map、分页与列表滚动位置；父层收起仍清理子层，执行身份或读取代际变化不复用旧展开／迟到结果。没有第二订阅、轮询、后端接口、数据源或新增依赖。

正常布局内的 aside 独立滚动，主输入框不重挂，面板开关沿原历史锚点恢复。窄屏定位、碰撞避让、外点、Esc和关闭焦点交给既有 Popover；外点输入框保留所点焦点。Esc 不向预览组件继续传播。手机预览保持原模态，背景工作状态入口不可达。原状态图标、列表、子 Worker、计划、计数、就地错误重试及准确待答定位保持；不恢复常驻刷新栏。

## 验证来源与复现

以下都是合成任务／fake engine，不读取真实历史、运行数据库或凭据，不调用模型；浏览器 runner 阻断外部来源与业务写入，只允许原有只读 HTTP 查询和夹具 stdin 的合成状态通知。

- `tests/task-status-pinned.browser.mjs`：320／390／1024／1440／2560px、1120px边界、拖动预览分隔条、开关与断点意图、焦点、暗色／reduced-motion、聊天锚点、单内容与无轮询；另覆盖原计数层级、父子收起、SSE进展、缓存失败、旧身份迟到结果、就地重试、待答定位、20/40分页、长标题、独立滚动、断线重连与读取代际。
- `tests/task-status-pinned-runner.mjs`：隔离服务、现有 Chrome／Playwright、随机回环端口与禁止生产端口保护。`HOMER_PLAYWRIGHT_MODULE` 指向本机已有模块，无安装。
- 原有 `tests/task-status.test.ts`、`tests/task-status-progress.test.ts`、`tests/task-status-css.test.mjs`、`tests/task-status-license.test.ts` 共14项；UI TypeScript 和任务专属 Vite 隔离构建。

任务证据目录为 `.codex/scratch/work-status-pinned-summary-20261024/`。`preimage/` 保存任务开始时四个实施文件及 DESIGN 前像；共享工作中的其他未提交改动继续保留。`red-build/` 只覆盖状态组件及样式前像，保留当前聊天挂载位置以隔离状态行为差异（四文件全量前像与并行删除的旧队列接口不兼容），`red/browser-results.json` 应在宽屏缺少默认 aside 处失败。`web-build/` 为当前源码隔离构建；`browser-results.json` 与 `verification.json` 保存最终结果／源码哈希。构建沿原拆包警告，不将其记为新性能结论。

在项目根使用已有依赖构建，输出必须指向任务 scratch，避免影响运行资源：

```sh
node_modules/.bin/tsc -p ui/tsconfig.json --noEmit
HOMER_SYNTHETIC_ROOT="$PWD/.codex/scratch/work-status-pinned-summary-20261024/unit-runtime" node --import tsx --test tests/task-status.test.ts tests/task-status-progress.test.ts tests/task-status-css.test.mjs tests/task-status-license.test.ts
node --import tsx --input-type=module - <<'JS'
import {build,mergeConfig} from 'vite';
import config from './ui/vite.config.ts';
await build(mergeConfig(config,{
  root:process.cwd()+'/ui',configFile:false,
  build:{outDir:process.cwd()+'/.codex/scratch/work-status-pinned-summary-20261024/web-build',emptyOutDir:true},
}));
JS
# 生成隔离构建后，传入已存在的模块路径：
HOMER_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node --import tsx tests/task-status-pinned-runner.mjs
```

## 截图与边界

证据目录中的 `desktop-1440-pinned.png`、`desktop-1440-closed.png`、`popover-320.png`、`popover-390.png`、`popover-1024.png`、`preview-1440-popover.png`、`preview-2560-pinned.png`、`desktop-1440-dark.png`、`desktop-1440-long-titles.png` 展示真实浏览器中的合成场景。

只变更入口与响应式呈现，不复制 Codex Outputs、Created chats 或后台进程功能。关闭偏好不跨刷新持久化。当前布局合同由新增响应式浏览器用例验证；本次没有全仓运行旧版“左侧计数入口／始终浮层”的浏览器断言。主共享工作树的队列、气泡、预览简化等并行改动不属于本任务，不应按任务开始时前像整文件回退。
