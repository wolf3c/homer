# 主对话外层滚动最小修复（2026-10-24）

长历史的消息区滚到底后，继续滚动会使 Composer 与工作摘要一起上移，下面出现大片空白。已在 `ui/homer-styles.css` 现有 `.thread-viewport` 规则中增加 `position:relative;`，使消息内绝对定位的读屏状态元素归属消息滚动容器。

## 范围与根因

产品改动只有上述一个声明，增加18字节。固定官方 RunActivity 的 `sr-only` 状态元素使用绝对定位；原 viewport 为 static，其 containing block 位于外层 `.thread`。越界滚动范围传播到 react-resizable-panels 的 `.preview-main-panel`，内层到底后的滚动链使外层继续滚动。document/body 在原复现中没有滚动。

没有删除读屏状态元素，没有修改官方 RunActivity、Composer DOM、follow/anchor、`scrollToBottomOnRunStart={false}`、分栏库或全局 overflow。现有视觉设计与交互意图保持，因此没有新增 `ui/DESIGN.md` 约定。回退产品修复只需删除这个声明。

同时新增 `tests/thread-viewport.browser.mjs`：实际产品构建、真实 Chrome 布局与滚轮、内存合成历史和原 HTTP 传输。测试断言 RunActivity 与其绝对定位读屏状态数量，避免 Worker 卡片外置后失去复现条件却误报通过；另有明确合成公开过程，检查展开与收起后的滚动范围。

## 准确前像与红绿验证

维护 HEAD 为 `5afa91483870fd69fb281bc1bd5c2e24470dd3ba`，分支 `main`。red-web 在增加 CSS 前由实际共享工作树隔离构建；green-web 使用相同工作树加单声明修复。不是以安装版旧 JS 代替当前含其他获准改动的候选。初始既有变更的前像、哈希和索引摘要已保存在任务证据目录。

最终同一回归在 red-web 的长历史场景按预期失败，在 green-web 的8个场景通过；两边均有30个真实 RunActivity 与30个隐藏状态元素。

| 1440×900长历史，CSS px | 修复前 | 修复后 |
| --- | ---: | ---: |
| 外层额外滚动范围 | 9345 | 0 |
| 内层到底后下滚400，外层scrollTop | 400 | 0 |
| 下滚前Composer.bottom | 900 | 900 |
| 下滚后Composer.bottom | 500 | 900 |
| 向上滚250，内层scrollTop变化 | 未执行，红灯已失败 | -250 |
| header.y / document.scrollTop | 0 / 0 | 0 / 0 |

绿灯场景：短历史、长历史、运行中停止按钮、运行中8条队列、390×780、320×780、1440×520短窗、1440×900 DPR=2。所有长历史场景向上滚动仍有效，过程展开/收起后外层额外范围仍为0。Chrome版本为 `156.0.8078.48`。

## 扩展交互验收

同一green-web的隔离合成浏览器检查通过：

- 1440、390、320三种宽度的历史分页、SSE流式增长、长输入正文、消息选文工具栏及Enter引用、原Composer焦点/实例保持、长Canvas独立滚动与关闭。
- 分页保留同一可见消息，偏移误差分别为0.25、0.5、0.5px；下方流式增长的锚点误差均为0。
- 桌面右摘要有486px可滚范围，真实滚轮使其移动300px而消息区不动；摘要开合锚点误差0。Canvas正文可滚范围5974px，拖动分栏后外层范围仍为0。
- 消息选文工具栏实测为fixed，在三种宽度均位于窗口内；键盘Enter生成准确引用并聚焦原Lexical编辑区，保留长草稿。
- 已有消息复制/引用套件48项、附件套件51项、审批套件33项通过，覆盖隐藏复制成功反馈、键盘/触摸、假上传和审批回执。所有业务操作仅访问合成接口。

## 实际Electron45与150%缩放

从本机已有缓存解压独立Electron `45.0.0`，通过单独入口和任务专属profile打开实际可见BrowserWindow，仅加载合成HTTP服务与green-web。没有运行、连接、退出或重启正在使用的Homer.app。

| 实测 | 100% | 150% |
| --- | ---: | ---: |
| `webContents.getZoomFactor()` | 1 | 1.5 |
| 内容窗口尺寸（原生） | 1440×891 | 1440×891 |
| renderer `innerWidth×innerHeight` | 1440×891 | 960×594 |
| DPR | 2 | 3 |
| `visualViewport.scale` | 1 | 1 |
| 外层额外范围 / scrollTop | 0 / 0 | 0 / 0 |
| Composer.bottom | 891 | 594 |

原生窗口受当前屏幕工作区约束，实际内容高891px，未将请求的900px当作实测值。缩放由Electron公开API设置并读回，DPR和CSS宽度也确认实际1.5倍变化，未用CSS zoom、DPR模拟或未生效的偏好冒充验证。向上滚轮250原生单位分别移动250和166.667 CSS px；第一次脚本未换算缩放导致断言失败，修正测试单位后通过，初次结果仍保留。

## 检查限制与安装边界

- 当前工作树的UI `tsc --noEmit`通过；红绿Vite构建、回归脚本语法检查与CSS `git diff --check`通过。Vite仍有既有大chunk提示，未因此调整打包。
- 旧 `quote-components.browser.mjs`在“dismiss keeps 44px target”停止，与当前已批准恢复官方尺寸的约定不一致。没有修改旧测试使其通过；本次直接完成三宽度选文定位、Enter引用与焦点验收。
- 旧 `reader-scroll.test.mjs`假DOM夹具缺少 `useMediaQuery`，13项均在初始化失败，未进入行为断言。没有修改旧夹具；新增真实浏览器回归负责捕捉本次CSS缺陷。
- 这是本机隔离合成验证；没有实体手机或真实业务数据验收，不声明全仓测试通过。
- 未提交、建分支/worktree、发布、安装或重启。安装build52仍未采用源码修复；安装 `app.asar` SHA256复核仍为 `eefe2fc1583c0e95898695158fbabf5e9e8c2d724a074999cb7702570d7a15c1`。

## 复核与复跑

所有临时脚本、日志、构建与截图位于 `.codex/scratch/page-scroll-fix-20261024/`。最终红绿记录为 `red-complete/results.json`、`green-complete/results.json`；扩展记录为 `extended/results.json`；Electron记录为 `electron-results.json`。任务专属补丁为 `task.patch`，文件身份及既有变更保护复核见 `verification.json`。

先隔离构建，再运行维护回归；不启动真实Homer服务：

```sh
node_modules/.bin/vite build ui --config ui/vite.config.ts --configLoader runner \
  --outDir ../.codex/scratch/page-scroll-fix-20261024/green-web
HOMER_SYNTHETIC_ROOT=.codex/scratch/page-scroll-fix-20261024 \
HISTORY_FOLLOWUP_BUILD=.codex/scratch/page-scroll-fix-20261024/green-web \
HOMER_BROWSER_EVIDENCE=.codex/scratch/page-scroll-fix-20261024/recheck \
node --import tsx tests/thread-viewport.browser.mjs
```

截图：`red-complete/long-wheel400.png`与`green-complete/long-wheel400.png`为同一最终回归的前后对照；`electron-1.5x.png`为实际150%窗口；`extended/long-canvas-320.png`为窄屏长Canvas。均只含合成内容。
