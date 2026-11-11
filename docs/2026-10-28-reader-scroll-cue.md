# 手动到底后清除新内容提示

原实现只在点击“最新消息”时清除新内容标志，手动到底仅更新几何状态，因而提示仍然可见。现在沿原视口测量路径，复用已安装 assistant-ui 的判底函数；仅在最新页且 runtime 已提交当前消息投影时清除本地视觉提示。归档页和尚未提交的新正文不能被提前确认。

内容观察改用同库 observeContentResize，覆盖高度未变的 DOM 提交。原阅读锚点、一次定位、手势取消异步定位，以及禁止自动跟随的设置保持。没有持久已读状态、后端、数据协议或依赖变更。

共享源码的引用导航、引用展示和对应测试并行改动完整保留；本提交只暂存滚动 hunks。引用并行改动留在工作区，由原任务负责提交。

2026-10-28 在本地 main（入场基线 5595794）验证：

- 未改实现上新增回归 5/5 按预期失败；合入后，共享组合 reader + HistoryWindow 57/57 通过。
- 仅本提交暂存源码/测试的隔离快照，reader 51/51 通过，确认不依赖未提交引用实现。
- 引用 UI、原文与多引用合同测试 15/15 通过。
- 实际组合 UI 的 Chrome 滚动验收 12/12；引用导航在 1440/390/320px 的浏览器验收 36/36。包含手动到底清提示、后续增长不自动跟随、重新提示、一次定位、准确重复原文、离页来源读取、草稿保留及手势取消旧定位。
- UI TypeScript 无输出通过；Vite 输出至 scratch 构建成功，仅保留已有大 chunk 提醒。未更新根 dist、打包、安装、推送或更新/重启运行中的 App。

浏览器回归保存在 tests/reader-scroll.browser.mjs，使用任务内存数据库、合成 final_answer 条目和不会执行的假引擎；摘要本身不是原生正文 owner。迟到媒体场景为受控 DOM 高度增长，不声称真实图片解码或实体设备触控验收。实体触控板/手机及运行 App 未验收。本轮未运行全库套件；其他既有失败不在本改动范围。

原始证据在 .codex/scratch/scroll-integration-20261028/：red.log、green.log、staged-green.log、quote-tests.log、ui-types.log、build.log、scroll-browser/browser-results.json、quote-browser/results.json，前像与身份校验也保留在该目录。
