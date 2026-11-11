# 待发送消息队列：排序、官方呈现与主输入框编辑

本项承接已批准的复核方案，在 `/Users/wolf3c/Project/homer` 局部实施；不新建 worktree，不恢复旧 serene-engelbart，不修改宿主数据库或生产数据，不部署。执行期间的公开活动事实、过程导航、日期时间呈现及相关文档变更属于其他并行任务，继续保留。

## 实际合同

- `MainInputs` 在原 `agent_messages.payloadJson` 持久保存可选整数 `queueOrder`，缺省取原 `seq`。readiness 与 claim 共用 `priority DESC / effectiveQueueOrder / seq`。原 numeric 分页仍按接受次序，正式历史与 `seq` 不重排。
- 普通 priority 0、当前线程、可编辑 pending 且无 interaction/interrupt 的消息可移动。不可移动项形成分段边界。preparing 不自动跳过，用户可主动调整同段顺序。
- move 复用原 operations owner 和 `BEGIN IMMEDIATE`。先返回已提交的相同操作，再检查 scope/CAS/顺序版本；同 ID 不同 payload 冲突。重排受影响行、receipt revision、operation 回执同时提交或回滚。内容 hash/inputRevision 不因排序变化。
- 不新增表、列或持久队列索引。排序摘要读取原 inbox 的活动身份元信息；正文仅水合当前最多80项，正式流归属仍沿现有 TEMP 关系投影。入站 admission hash 保持最初内容，编辑仍更新实际排队内容 hash。
- `POST /api/messages/move`：`threadId, readEpoch, requestId, operationId, expectedRevision, expectedOrderVersion, beforeRequestId`。null 为当前分段末尾，其他锚点必须真实属于同段。无变化移动也登记幂等结果，不递增内容/receipt 版本。
- edit/cancel 保留旧参数入口，并支持新的线程/世代 fence。取消、编辑、移动均在返回后唤醒现有调度器，不直接启动 turn，不 stop/interrupt/steer。
- `POST /api/history/queue` 增加 `view:"dispatch-v1"`、`readEpoch`、可选 `cursor`。返回实际顺序、pending 总数、锁定项、当前页及 `nextCursor`。游标绑定线程、世代和队列顺序摘要，变化后重读首页。`segmentStartRequestId` 等定位信息由服务返回，跨页“移到最前”不把页首当队首；可移动项的 `nextRequestId` 是同段真实后继（段末为null），分页末行拖动不把页末误作段末。
- `/api/history/receipts` 保留 `requestIds` admission 核对，增加可选 `operations:[{requestId,operationId}]`；返回已提交操作的原回执，以及当前消息状态、revision、inputRevision、editable。未查到不等同于不会晚到；回执不包含正文或附件内容。
- 上述路径贯通 `web-server / web-contract / web-homer / scripts/dev.mjs / dev-host`。网关仍分别合并 `gateway_stored/rejected` 的传输事实，不能冒充业务修改回执。

## 界面与草稿

官方 standalone Message Queue 的固定来源、字节 SHA 和 MIT 许可证见 `ui/vendor/assistant-ui/README.md`。Homer 沿该单层列表扩展编辑、展开、44px手柄、取消、更多菜单和锁定状态；不接 Queue Adapter 或自动派发。

鼠标、触屏与键盘菜单均提交同一 move。dnd-kit 0.5.1 的 sortable DOM 预览以拖动源 projected index 为最终落点，不能仅使用最终碰撞目标 ID；取消拖动不提交。SSE 或操作结果导致队列变化时，必须完成对应读取快照的核对才恢复动作与焦点，不把旧本地数组当作回滚事实。

主输入框显式切换新消息/排队编辑。进入前保存原新消息草稿，runtime 的原附件集合与 File 对象留在原 owner，不清空或 discard；编辑附件是独立的原引用集合，只可移除。保存继续使用原 requestId，经过服务 CAS 才更新内容和 retainRefs。旧多引用与批注不经新草稿格式转换。取消或保存成功恢复原文字、引用、请求身份与附件。

新消息草稿沿原 `homer-draft:<thread>` 保存；编辑会话沿 `homer-queue-editor:<thread>` 保存；未确认修改沿 `homer-queue-operation:<thread>` 保存精确操作及原 payload。旧逐行编辑草稿进入主输入框时保留正文、引用、附件及可解码的旧操作身份。未确认发送的原存储/核对路径继续保留，不因队列刷新自动重放。

编辑不会暂停领取。原消息已领取、状态未核实或另一设备改过正文时，禁止保存并保留本地草稿。判断来自准确 requestId 的回执，当前页没有该项不构成失效证据。保存结果未知时锁定修改和编辑输入，按原 operation 核对或明确重试，避免继续输入后被较早保存结果覆盖。

进入编辑时列表收为数量，退出恢复原展开状态；低视口收起列表，正文/原引用附件分别局部滚动。当前主回复停止按钮继续独立。旧服务不声明 dispatch 能力时仅呈现已加载数量、隐藏排序，复用主输入框编辑，不新增第二套 textarea。

## 验证与交付

维护的合成回归：

- `tests/message-queue-order.test.ts`：领取一致性、稳定身份、版本冲突、幂等、事务回滚、分段、preparing、165项分页、持久重开、旧 FIFO 读取及元信息不读取请求响应正文/当前页最多80项的有界水合。
- `tests/message-queue-web.test.ts`：真实 HTTP Origin/scope、修改回执、领取后核对、旧 numeric 页面，以及准确生产网关/业务 IPC 闭包转发。
- `tests/message-queue-scheduler.test.ts`：真实假引擎宿主中，取消/移动 preparing 队首后的唤醒。
- `tests/queue-edit-input.test.ts`：原请求、旧多引用/批注、单引用形态与附件引用保持。
- `tests/message-queue.browser.mjs`、`tests/message-queue-recovery.browser.mjs` 与 `tests/fixtures/message-queue-browser-server.ts`：真实 Homer/SQLite/HTTP/UI，固定假引擎、独立 scratch runtime/HOME 和随机端口；独立 Chrome profile，拦截外部网络。

前端只构建到 `.codex/scratch/message-queue-implementation/web`，服务类型检查使用 noEmit，不覆盖日常 dist。截图与原始检查结果存于同一 scratch 交付目录。准确队列增量及持久验证元数据为 `docs/patches/2026-10-22-message-queue.patch` 和 `docs/patches/2026-10-22-message-queue-identities.json`；增量比较基线保留并行活动/日期改动，不等同于整份 Git HEAD。

### 2026-10-22 实际结果

| 检查 | 结果 |
| --- | --- |
| 相关行为回归（13个文件） | 审阅后64项通过，0失败；排序、有界读取与查询次数均先建立失败断言再修正 |
| 编辑/调度局部复测 | 11项通过，与上述覆盖重叠，不另加总 |
| 主队列浏览器用例 | 审阅后55项通过，含鼠标/触屏手柄、普通触屏滚动、Escape、IME、44px动作、1440/390/320px、低视口、未知移动回执及165项分页末行拖动 |
| 恢复与兼容浏览器用例 | 20项通过，含保存回执丢失、两设备编辑、离线恢复、纯附件、旧未确认操作之后的本地修改、单项/旧服务编辑、独立停止、真实鼠标选文、reduced-motion及历史阅读位置 |
| UI noEmit / 服务 noEmit | 均通过 |
| 隔离 Vite 构建 | 初次和审阅后均通过；初次构建前后UI/lock输入哈希一致 |
| 准确队列补丁反向 dry run | 通过；只检查，不执行回退 |

当前仓库总 `tsconfig.check.json` 仍未通过：23条诊断来自附件适配测试、跨UI的中断恢复测试、历史观察声明及并行日期时间测试，涉及 NodeNext/JSX、`.ts`扩展名、缺少声明及已有测试类型。这些文件/配置未为通过检查而改写；独立服务/UI检查和上述运行行为检查通过，不能称全库检查通过。

额外扩展的接待回归曾为38通过/1失败；`tests/reception-host.test.ts`的连续接待断言把瞬态 `observedAtMs` 当作固定快照，进一步诊断也遇到旧Worker条目查找与当前卡片合同不一致。未保留该测试的诊断性改动，也未把它作为本项通过证据。

一轮隔离恢复浏览器进程超过7分钟未返回，确认身份后仅终止该测试进程；带场景/清理阶段诊断的重试20项全过，未复现原因，不推断为已修复的产品故障。所有最终夹具目录与独立浏览器profile均已清理。实际截图及校验摘要保留，失败轮次的过时截图不作为交付。

审阅修正、性能实测及本次Git提交边界见 `docs/2026-10-22-message-queue-review.md`。当前HEAD尚未包含既有共享整合源码，准确补丁以保留并行成果的比较基线为前提，不能直接应用到HEAD或把本次提交称为独立可构建源码快照。

## 回退

本任务未执行上线，不以维护源码修改表示生产已采用。源码回退应仅撤销队列增量，保留其他并行成果和普通未确认请求/草稿，不恢复整份旧文件。

新版服务兼容缺少 queueOrder 的 FIFO 数据，旧 numeric 页面仍保持原次序。旧服务回退会忽略已保存的 queueOrder：需先让自定义队列自然清空，或明确接受剩余 pending 恢复 FIFO。不得把这称为透明回退，不得自动重放 offered/uncertain 项。

单独回退前端会丢失新编辑会话和修改核对入口；应先确认没有未核实修改、保存或取消编辑并恢复普通草稿，再切回旧界面。不能把未知操作视为失败后换新身份发送。无需删除/重写生产数据、运行 schema 降级或改变原生线程。
