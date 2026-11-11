# 已完成功能统一审查与分功能提交

2026-10-25，A—F 六项已完成逐项代码审查、范围内修正、精确候选验证和本地 Git 提交。修复了窄面板图片备注框被裁切的问题。没有安装、重启、发布、push、创建分支/worktree、调用真实模型或操作生产数据；任务给定的安装基线 build58 / a6040cc 未在本轮采用这些源码。

## 范围与提交顺序

入场为 main / `a6040cc62fb2e76ece3fb62b138b31ab9da516c8`，暂存区为空，588 个已修改或未跟踪路径。先保存原 index、状态、tracked diff 和这些路径的内容 SHA-256。临时材料均在 `.codex/scratch/completed-work-review-commit-20261025/`；维护来源为 [准确来源 manifest](patches/2026-10-25-completed-work-review-sources.json)。

| 顺序 / 功能 | 文件及 hunk 边界 | 必要依赖与检查 | 实际提交 / tree |
| --- | --- | --- | --- |
| 1 · F 一级业务 Worker 与原生内部协作 | recursive-tasks/tools、engine/service 的 callback 与 EOF、worker-native-requests、task-status、原提示及维护文档 / 合成测试，55 路径 | 先限定管理权、同级通信和原生请求生命周期，独立编译并运行完整相关合成 suite | `b303848a2db813164b25dadc6c25fdabb7d7948d` / `8f0460fc41c5f1a07d7d6207cfc48cfddbfd4f5b` |
| 2 · A/B/C/D 表单、入口、主草稿与多标签 | 共享表单、三个 reader、annotationDraft、原 Composer、集合协议、固定 Agentation controller、Tabs/header 及维护来源 / 测试，57 路径 | 四项共用 reader、保存接口与主草稿合同，作为一个可编译闭包提交，避免制造旧三 Map / 单来源协议的中间状态 | `3f5e98ef43d0e869f71ae3348890da84a8cf3f9f` / `404169e0b373bd95ddf654385df668e70b8618d4` |
| 3 · E 官方工具展开 | tool-content、main-process、原执行边界采样、process-message/details、固定官方 ToolFallback 与最小 helper/CSS/来源、测试，33 路径 | 依赖 1 的执行生命周期及 2 的共享消息接缝；继续使用原审批和 Worker 卡 | `761b9a5940cbd1146c59985909064f0a656c7cd0` / `c23461409dfd59245cdc64c29a0411ff5833f7bc` |
| 4 · 审查记录 | 本文与来源 manifest | 与前三项提交读回结果、验证及保留边界一并提交；该记录提交自身由 Git 历史定位 | 仅两个维护文档 |

每项使用临时 index 精确写入候选内容，核对 tree 后以 HEAD CAS 更新 main；只刷新这些提交路径的 index 条目，保留原空暂存区语义。没有 git add 整棵 dirty 树、整文件 checkout/reset/revert 或覆盖工作区。

F 的完整 suite 使用列明的现有合成测试基础。部分测试原本未跟踪，或已有与实际 schema / 工具目录相符的夹具修正；必要回归源纳入该提交，不声称整份由本轮新写。未纳入无关的 Worker 待答发现产品代码（service 的 pendingForMain 接缝与 worker-interactions 方法）及其新断言。未纳入 package-lock 重排、branding、其它平台 / memory 工作或安装状态。

## 逐项审查结果

| 功能 | 审查结论 |
| --- | --- |
| A 共享备注表单 | 表单只负责受控输入、错误、busy 和动作；文本 Base UI 与图片 Annotorious 继续定位。IME Enter/Escape 不穿透父弹层，超过 16000 字保留原输入且禁保存，无重复焦点陷阱。实际窄面板缺陷及修复见下。 |
| B 批注入口与移除 HTML 源码 | HTML / 图片沿现有入口、28px 按钮与不收缩的 14px SVG；局部 specificity 覆盖附件 utilities。没有残留 HTML 源码/返回模式或专属文本选区入口；静态默认及显式脚本授权边界保留。 |
| C 保存即主草稿与多来源 | 已存批注只认原 annotationDraft；chip 和预览双向投影。解析、服务端逐源核验、累计 20 条 / 48000 字预算、24000 字授权要求及 96KiB 消息限制、queue/history/restore/能力 3 保持一致。旧 singular pending 与未知回执继续保留原 ID / payload。原图确认/删除/晚回包、普通消息引用互斥、HTML 零注/ACK/拒绝保留输入与旧 iframe token、UTF-16 重复句/跨节点/公式原子锚点均经审查和合成验证。 |
| D Base UI Tabs | 官方 Tabs 负责 ARIA、roving focus 与手动激活；只有当前 Panel 挂载 reader，切换实际销毁 HTML 上下文并 Abort / revoke 旧资源。稳定 Dialog、800px resize、标签关闭焦点、同名准确 ID、导航不删已存 chip 通过。没有新依赖、持久标签或业务实体。 |
| E 官方 Run Activity 工具展开 | 固定官方 RunActivity / PartByIndex / 完整 ToolFallback 保留；不同工具状态独立于主轮结果。执行入口先遮明确凭据，再有界序列化，不执行 getter/toJSON，循环/Proxy/非 JSON 明确隐藏，0/false/null 保留。开始/结束采样，不按 output delta 写。一个可失效的懒读缓存；原审批唯一决策；Worker 卡外置；复制/引用只取正式答复。 |
| F 一级业务与原生协作 | main 管理守卫在 mutation/operation 复用前拒绝 Worker 越权，peer/capabilities 保留。没有 native child 业务实体或第二协调层。callback 绑定原连接、WorkerSlot/epoch/父 segment，main 仍严格校验自身 thread/turn；真实子请求 ID 保留，resolved 与并发等待从原事实派生。EOF 给固定引擎 46 秒有界排空，再沿 TERM/KILL；确认 exit 才释放 lease，park/unknown 保留。同版本旧业务多层只读拒绝，不擅自迁移生产记录。 |

简洁性审查确认：沿原 owner 删除被本功能取代的旧导入/summary/Map 和递归协调分支，不增加新框架、表、详情端点、轮询或并行状态档案；未顺带清理其它历史代码。固定 Agentation 为 PolyForm Shield，assistant-ui 为 MIT，声明、镜像声明、最小补丁及 notices 如实保留。

## 本轮修复与测试整理

1. **实际界面缺陷，红绿复现。** 桌面预览拖到 250px 时，原生图片 popup 外层按收缩宽度参与定位，但内部 280px form 溢出到右侧，保存按钮被裁切。只改 `ui/image-annotation.css`：popup 默认 280px，同时以当前图片容器与 viewport 约束最大宽度。保留原 ImageAnnotationPopup / Floating UI 定位，无手工坐标、额外 observer 或 vendor fork。四角、长错误与按钮 hit-test 在 7 组尺寸/缩放组合通过。
2. `tests/annotation-comment-form.browser.mjs` 改为真实文本 marker 编辑入口，替代已被 C 移除的 summary 列表。
3. `tests/annotation-composer-sync.browser.mjs` 增加真实 handle 拖动后必须改变几何的断言；取消后重新打开，逐个核对全部 handle 坐标，而非只检查未改动的主草稿。
4. 共享 composer 合成夹具改为当前 `conversationView:3`。已有审批测试 loader 纳入真实 vendor QuestionFlow 路径和词法依赖，产品审批逻辑不变。
5. E 新服务观察用例独立维护为 `tests/tool-service-observer.test.ts`，从原未跟踪 `tests/main-process.test.ts` 精确提取其新合同；原文件保持入场内容且不提交，避免认领或修改整份旧套件。

## 验证与准确来源

所有新测试/截图均为需求推导的合成数据。使用随机本地端口、新隔离 Chrome profile、内存或 scratch 数据库与 fake engine；不安装依赖、应用，不使用真实账号/审批/模型或渠道消息。

| 验证 | 观察结果 | 本轮证据（scratch 相对路径） |
| --- | --- | --- |
| 三个实际提交树的 server / UI TypeScript | 各通过；后续只有 Markdown 来源说明变化，runtime / test 源文件逐字相同 | `F-tree-*-types`、`ABCD-tree-*-types`、`E-tree-*-types`、`tree-equivalence.json` |
| F 完整相关合成 suite | **430/430** | `f-verified-suite.log` / `.json` |
| A/B/C/D 相关合同 / 真实库 / 服务扩展 | **45/48**；3 个旧生命周期失败，见下 | `preview-tests.log` / `.json` |
| E 遮敏、真实执行采样、来源、投影、缓存与原审批 | **63/63** | `e-verified-core.log` / `.json` |
| 组合批注 1440/390/320 | **54 项通过** | `browser-sync/results.json` |
| 补强几何取消与边界，1440 | **27 项通过**，包含原 54 项中的重复流程，不累加成独立覆盖总数 | `browser-geometry/results.json` |
| 共享表单、250px 面板、200% 等效缩放 | **28 组通过 / 84 次几何测量**，7 个 viewport/zoom 组合 | `browser-form-green/results.json`；红测 `browser-form/failure.json` |
| Tabs 组合导航、实例与资源生命周期 | **121 项通过** | `browser-tabs/results.json` |
| 官方工具展开、状态、原审批与正式答复，三屏 | **21 组通过** | `browser-tool/results.json` |
| 原消息复制/引用，三屏 | **48 项通过** | `browser-actions` |
| 外置 Worker DOM / 父位置 / 焦点 / 滚动锚点 | **19 项通过** | `worker-cards/browser.json` |
| 一级 Worker 状态与预览并列 | **4 组通过**，320/390/1440 | `browser-flat-final/browser-results.json` |
| 官方 CSS 与固定 vendor | tool-fallback / quote / attachment / image-file / canvas-split 五项精确 check；Agentation 原输入、输出、两声明和 license 校验通过 | `css-*.log`、`vendor-exact.log` |
| 隔离 runtime / 产品构建、diff / tree | 通过；只有原有大 chunk 提示；候选与实际 tree 的 src/ui/tests/scripts/prompts 完全一致 | `*-fixed-ui.log`、`e-final-build-runtime.log`、`trees.json`、`tree-equivalence.json` |

不是整仓全绿。`tests/web-service.test.ts` 的旧失败为：

- `Web pending card reply returns through main decision to the original interaction`
- `real user generation sink orders start/delta/confirmed terminal and ignores delayed stop and foreign events`
- `a failed main generation terminates only when failure or process shutdown is confirmed`

本轮在 F 树、同一份测试源且未加入批注改动时复现 **3/3** 失败（`preview-lifecycle-preimage.log`），没有为绿色放宽校验或修改无关生命周期。旧批量导入/旧 annotationDraft 浏览器夹具不代表当前新合同；其历史结果不冒充本次通过。没有运行整仓 `npm test`，没有混用旧 committed 137 条类型诊断和其它 mixed tree 的 12 条诊断。

预审读取原未跟踪 main-process 旧套件时也观察到 5 项旧夹具/展示断言问题（缺少 active.messages、旧 Worker 投影、旧的全部工具内容禁止断言、缺 dispatchSummary、scratch 父目录）；该整份文件不属于本次提交。新观察合同已单独进入上述 63 项通过的核心测试，不将旧套件宣称通过。

## 性能与适用限制

本轮按同一 A/B/C/D/F 候选、有/无 E 的隔离 Vite 构建配对统计 JS/CSS：**3,801,957 → 3,866,875 B，增加 64,918 B，约 1.71%**；Node v22.22.0 `gzipSync` 默认参数逐资产合计 **1,078,763 → 1,090,225 B，增加 11,462 B**。两侧都包含本轮窄面板修复。完整资产 SHA 和口径见 `paired-bundles-node.json`。未将单次构建耗时噪声当性能改善。

已有 E 测量的 `src/tool-content.ts` / `engine.ts` / `main-process.ts` 与本次准确树 SHA 全部一致，因此复用其 Node 22 合成测量：100 次 3MB 字符串采集中位约 0.105ms；开始/结束 2 次保存，1000 个 output delta 新增 0 次写入。该数字仅对应该合成环境，不代表真实模型、网络、生产大历史或端侧压力。当前实现的内容、节点和 DOM 生命周期有界；历史仍按原真实调用数线性增长，没有新增后台回填或轮询。

F 的真实原生协作 smoke 之前因 `engine_authentication_failed` 未通过。本轮核对固定源码和完整合成合同后提交维护源码，**不将其称为真实端到端通过，不安装采用，不复制生产凭据续跑**。实体手机/原生虚拟键盘、已安装 Electron、其它浏览器及真实生产压力未验证。

## 保留与回退

维护来源 manifest 逐路径记录 before blob、提交 blob、SHA-256、来源补丁哈希、commit/tree 和必要测试基础边界。前三个提交已实际 `git log` 读回。审查记录提交以本文件和该 manifest 两个文档为界；完整四次提交及最终 preservation 回执另保留在 scratch `final-delivery.json`。

原工作区的全部入场内容保留，除本轮明确修正的共享表单浏览器测试、几何回滚测试和图片 CSS；另新增当前协议的夹具修改、新观察测试及维护审查记录。原未跟踪 main-process 套件、无关源码/文档/branding/package-lock 等未覆盖。暂存区仍为空。

回退须对照各提交精确 hunk 与本地剩余 dirty；不能整文件还原共享文件、清 pending / journal / lease 或用旧协议忽略 plural 请求。任何真实数据处置、发布或安装都不在本轮权限内。
