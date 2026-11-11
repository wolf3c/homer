# 成果预览多标签

维护源码将单目标预览改为按首次打开顺序保留的文件标签。复用固定 Base UI 1.8.0 Tabs，当前文件只有一个阅读器；打开同一 id 不重读，已有标签只激活，关闭当前优先右邻否则左邻。收起保留导航并销毁阅读器，重开重新读取；刷新及合法新 thread 不恢复标签。

范围仅 `ui/homer-app.tsx` 的导航与授权代际、`ui/canvas-panel.tsx` 的稳定外壳/私有阅读器、`ui/canvas-panel.css` 的标签栏，以及聚焦回归/设计与来源说明。没有依赖、数据库、后端协议、持久标签、通用 store/controller 或业务实体变更。HEAD 冻结为 `a6040cc62fb2e76ece3fb62b138b31ab9da516c8`；当前已安装 build58 未安装、重启或采用此源码。

原 `annotationDraft` 是已保存事实源。保存即原主草稿 chip；切文件取消临时文字、选区和几何编辑，不删已存注或已确认原图。本文覆盖原多标签方案中旧 Map、singular/批量导入及文本未保存恢复断言；旧来源解析和已接收请求的兼容性仍由原 owner 负责。共享表单和 28px/14px 入口保持。HTML 默认静态，明确批注才运行；已有 revision/epoch/changeId ACK 让原生保存表单在父草稿确认前保持忙碌。延迟确认期间切走取消临时编辑，已确认保存则随草稿保留；没有增加第二 ACK。

导航先令原 previewScope 失效，再卸载 reader。reader 的 layout cleanup 失效实例/generation，文件请求 abort 并逐个 revoke URL；异步读取、runtime import、原生图片保存与 HTML 消息同时核对原 owner 当前性。空 Panel 壳保留库的 ARIA 关联，非当前 children 直接为空，不等退出动画，不保活脚本。标签关闭不触发附件 discard。滚动仅改变 rail.scrollLeft；激活、键盘聚焦、关闭和 resize 均使相应项可见，不改变聊天锚点。

复现用 `tests/preview-tabs.browser.mjs`，沿原 `web-history-followup-fixture.mjs`、独立 Chrome/CDP 和实际 HomerApp。全部文件、批注、账号占位及回执均为需求推导合成输入，服务仅随机端口、无执行 fake engine。不得将该测试连接生产端口/账号或解释为真实用户数据回放。运行时将 `HISTORY_FOLLOWUP_BUILD`、`HOMER_SYNTHETIC_ROOT`、`HOMER_REVIEW_EVIDENCE_ROOT` 全部设为本任务的隔离目录。

验证材料在 `.codex/scratch/preview-tabs-implementation-20261025/`：开工前像/HEAD/index、红例、准确构建输入哈希与漂移记录、分屏截图、测试结果、task-only patch 及检查。最终依据为 `handoff-source/`、`web-handoff-inputs.json`、`web-handoff-runtime-input.json` 和三组 `handoff-*/results.json`；此前调查/中间构建不计入最终通过数。

## 本地验证结果

Node 22.22.0、TypeScript 5.9.3、Chrome 156.0.8078.48，固定现有依赖。冻结输入含725个源码/资源/测试/配置文件，UI、实际 HTTP 服务和测试来自同一副本。原生 runtime 从该副本生成，UI raw chunk 与其逐字节相同，SHA-256 为 `d8181a4595bc03eda1253177f06ae19c1c49b886036a93930e95781ea549e12d`。构建时及三组浏览器完成后，冻结输入与工作区比对无漂移；构建仅保留现有大于500kB的 chunk 提示。

| 检查 | 结果 |
| --- | --- |
| 真实 HomerApp 多标签，1440/390/320 | 121条通过，`handoff-tabs/results.json` |
| 既有批注同步，三种宽度及低高度 | 54条通过，`handoff-sync/results.json` |
| 补充 title/no-op、超时、原生修改/删除/清空、待保存图片、modal、管理态 thread | 8条通过，`handoff-extra/results.json` |
| 合计 | 183条；三组 fake engine 调用均为0 |
| 引用、集合、附件、草稿、HTML沙箱、官方Canvas、共享表单、vendor 定向测试 | 39/39通过；旧 vendor 哈希断言由并行 owner 更新后通过，本任务未改该测试或 vendor |
| UI类型、服务源码类型、隔离 UI/runtime 构建 | 通过 |
| 全量 `tsconfig.check.json` | 共享候选12个既有错误；移除本任务改动、保留相同其他源码后仍为相同12条。只读 HEAD 源码在同一现有编译器/依赖下为137条，不能混为本任务新增问题。早期并行中间态30条记录另保留 |
| Canvas/Attachment/Quote CSS `--check` | 通过；未改生成器、依赖或生成CSS |

先复现了“第二文件替换首文件、没有两个标签”的红例；又复现并修正窄屏 ResizeObserver 被旧焦点拉回左端、以及旧 chip 定位请求在收起重开后复活图片编辑器。HTML 原生保存的额外检查按实际可见状态判定，原生组件保留隐藏编辑 DOM 不等于保存未完成。

同步任务在联验期间继续修正 `htmlMetadata`、附件预检与测试的 CDP 返回值；均按其最新 owner 接口保留。满附件新增红例曾在旧组合产生错误待确认 chip，最终组合已包含 owner 的提前校验，并通过该用例。本任务没有覆盖这些 hunk、重建同步协议或更改断言来回退新合同。

截图在 `handoff-tabs/preview-1440.png`、`preview-390.png`、`preview-320.png`。同时保存暗色系统偏好截图；当前产品仍使用既有配色，这不表示增加或验收了独立暗色主题。主截图已人工检查标签、关闭按钮、正文高度与整页横向溢出。

## 更新后的22组验收

下表均指本地合成数据；不继承原独立 TabsDemo 的通过数。批注保存/取消/来源集合语义按已批准的新主草稿合同更新。

| 编号 | 已观察到的结果 |
| --- | --- |
| S1 | 同id三次、同名不同id、目录改名不增加标签/重读；实际图片保存等待中同id重开保持有效 |
| S2 | 关非当前不换阅读器；关当前右邻优先、否则左邻；关最后收起，准确入口或顶部回焦 |
| S3 | 收起重读并保留导航；刷新/新thread为空；真实管理态切thread当次卸载旧HTML上下文 |
| S4 | SSE目录缺文件不删标签；合成撤权就地失败，重试恢复；不绕过unexpected-thread拒收 |
| S5 | 迟到bytes/旧finally不覆盖当前loading；原请求abort，退役URL逐个revoke；A→B→A内容正确 |
| S6 | 新hash不借旧注、不改原草稿来源；回旧hash恢复对应保存注，标签id不变 |
| U1 | 1440、拖窄侧栏、390/320均单外壳/当前阅读器；非当前Panel为空，不溢出整页 |
| U2 | 长中文名、同名和resize时名称截断、当前项及关闭操作可见；连续ASCII长名未单列实测 |
| U3 | 方向/Home/End只移焦点，Enter/Space激活；普通Tab到同级关闭按钮；库的Tab/Panel关联完整 |
| U4 | 邻项关闭回焦、入口卸载回顶部、外层Escape、chip定位请求消费后重开普通阅读；不恢复旧未保存编辑政策 |
| U5 | 801/800/799往返保持同一Dialog/阅读器/运行frame；实际Tab循环与aria-hidden验证modal边界，无残留遮罩。图片编辑中跨断点未单列实测 |
| H1 | 默认/返回静态、无源码入口；明确批注才运行；只有connected没有active会超时，运行错误回静态 |
| H2 | 真实计时脚本的旧执行上下文在切走后销毁；旧WindowProxy消息拒绝，未选Panel无运行内容 |
| H3 | 延迟runtime不启下一文件；旧token无效；ACK前忙碌输入切走不写另一来源，ACK后保存立即切换保留 |
| A1 | 文本三条、精确重复句/emoji/CRLF/跨节点/公式/表格/代码锚点和双向删除恢复；切回不自动弹临时编辑器 |
| A2 | 原生多框、编辑/删除、手柄几何取消、新框切走取消、重开普通看图；已存事实与确认原图保持 |
| A3 | 原生HTML新增、修改、删除、清空与切换重挂同源；零注及删除chip不被旧快照复活 |
| C1 | 原正文、保存来源组与原图附件保留；保存不发消息。原消息quote与成果注互斥时明确拒绝，不隐式覆盖 |
| C2 | 延迟上传不污染下一阅读器/复活删注；已确认附件保留；失败重试沿原uploadId；10附件满额在chip/上传前拒绝 |
| C3 | 原图discard失败保留事实；unknown不自动重放，明确重试保持原payload/id及较新草稿 |
| C4 | 多文件集合、旧singular/rect解析、累计预算/超限与主发送快照由相关合同测试覆盖；导航无新wire字段或自动发送 |
| D1 | HEAD/index保持；维护源码、隔离产物、183条检查和安装build58分开计证，无安装采用声明 |

受控外网页面 API 仍按原 message/source/url 身份隔离实例，不纳入文件标签；本次没有实际外网页面调用者，不声称验收了外部站点。PDF/其他格式继续原阅读分支，本轮未逐一验证其原生解码交互。

回退只逐 hunk 逆向应用 task-only patch。它保留并行批注同步、共享表单、按钮、Run Activity 及其他 dirty 工作；不按 HEAD 整文件恢复。没有数据迁移。实体手机/虚拟键盘、真实屏幕阅读器、Electron 安装采用与生产端到端未验证。
