# Native RPC 生命周期

2026-11-04 核对：以下 RPC/compact/关闭契约仍对应维护源码；验证数量和采用记录保留原日期，不表示本轮重新执行真实引擎、登录或安装。当前隔离原生入口见[测试说明](testing.md#固定原生协议与合成验收入口)。

2026-10-20：已与执行时限修复整合到维护源码，保留集中模型配置及主提示词；尚未部署日常服务。

## 行为约定

Homer 的 `CodexEngine.request(method, params)` 仅负责将请求 id 与原生 JSON-RPC 响应对应。普通 RPC 没有宿主统一超时：成功、原生错误、stdio EOF、进程退出、协议失败或显式关闭决定 Promise 的结果。原生执行、重试、取消及操作期限仍由 Codex 管理；Homer 不重放 RPC。

等待回执期间不能认定有副作用的操作失败。`engine_disconnected`、`engine_closed` 等只说明回执通道已结束；安装、OAuth、config 写入是否生效仍未知，调用者应查询原生状态。既有调用接口和错误脱敏规则保持兼容，`engine_rpc_timeout` 不再由本适配器产生。引擎仅在 pending RPC 因通道结束而拒绝时附加 `EngineRpcUnconfirmed` 错误类型，message 仍是脱敏分类；发送前拒绝、同步发送异常与收到的原生错误均不附加此证据。这个类型不进入原生协议或持久数据。

保留的宿主边界：

- 本地 `initialize` 协议握手沿用原来的 15000ms 上界，错误为 `engine_initialize_timeout`，随后关闭子进程。它不覆盖握手后的 config、skills、thread/start/resume 等原生操作。
- `interrupt()` 沿用 `stopGraceMs`，有请求 ACK 也不自行宣称轮已停止。无确认返回 `false`；等待中的 RPC 在后续原生响应或关闭时清理。
- `close()` 一进入就拒绝新请求，并拒绝所有 pending、turn 与 compact 等待；SIGTERM 等待 `stopGraceMs`，SIGKILL 仍沿用原来的 1000ms 退出确认期。只有观察到进程退出才返回 `true`。到期退出监听器会移除。

服务关闭时先关闭 native control，再排空账号队列。关闭态的 `nativeRpc` 拒绝请求，不会因队列中的取消/读取再次创建 control 子进程。这避免了账号 read/login/start/cancel 丢回执时，账号 close 排在它们之后永久等待。正常运行时的账号登录、取消、logout 与授权策略不变。

存活进程如果永不响应，普通请求会持续等待，直到原生响应或显式关闭。这是移除统一截断后的明确语义。调用者的停止、关闭与已整合的主轮故障恢复流程继续负责各自生命周期；Homer整轮累计预算已由[执行时限修复](38-native-timeout-recovery.md)移除，本修改不添加第二层执行或恢复框架。

## ACK 与操作完成

固定 0.163.0 源码核对位置（相对于固定快照的 `codex-rs/`）：

| 操作 | 证据 | 语义 |
| --- | --- | --- |
| OAuth | `app-server/src/request_processors/mcp_processor.rs:306–364`；`app-server-protocol/src/protocol/v2/mcp.rs:322` | 先等待 URL 获取/注册，再返回 `authorizationUrl` 与 `loginId`；后台任务等待登录并发 `mcpServer/oauthLogin/completed`。 |
| 插件安装 | `app-server/src/request_processors/plugins.rs:1481–1591` | 安装、配置/缓存/runtime 刷新等 await 位于返回前，可形成直接长 RPC。 |
| compact | `app-server/src/request_processors/thread_processor.rs:2461–2477`；`core/src/tasks/compact.rs` | 空响应仅说明 `Op::Compact` 已提交；实际压缩由原生任务执行，带原生 retry/cancel。 |
| steer | `app-server/src/request_processors/turn_processor.rs:1044–1182` | await 原生 steer_turn；Steered 返回 turnId，NotSubmitted 返回原生错误。收到 ACK 仅表示原生受理，不等于 Worker 采用新版契约。 |
| interrupt | `app-server/src/request_processors/turn_processor.rs:1619–1680` | 非空 turn id 的确认在原生 TurnAborted 到达后返回；启动取消另有提交 ACK。 |
| 终态 | `app-server/src/bespoke_event_handling.rs:186–204,1207,1336–1352,1631–1640` | turn/completed 包含完成、失败或中断状态；可重试错误通知不等于终态。 |

因此，“OAuth 的 120 秒必然与 RPC 的 15 秒冲突”假说被否定：120 秒不是这个 RPC 必须等待人类登录的时间。URL 返回前的发现/注册仍可能慢，但本次没有做真实登录或安装，不能声称复现了它们的真实耗时。已复现的是传输层在 15000ms 后丢弃合法慢响应的问题。

`compact()` 同时等待请求成功与其原生完成项，不设另一个 15 秒模型操作预算。同线程新 turn/started 或 contextCompaction item/started 绑定 turn/item id；匹配 item/completed 确认完成。匹配的 turn/completed 若先到达，按原生 error、中断、缺少完成项分别拒绝。进程断开、协议失败和 close 同样拒绝它。压缩期间阻止本地并行 turn/compact；interrupt 使用该压缩的原生 turn id。通知早于 ACK 也不会把一个被原生拒绝的请求变成成功。

## 验证与复验

验证环境：2026-10-20，Node v22.22.0。新测试通过 `node:test` 可控时钟推进超过旧上界，不真实等待分钟；专用 stdio fixture 只用于静默初始化、EOF、进程退出，不读账号或联网。

```sh
node --import tsx --test --test-concurrency=1 tests/native-steer-receipts.test.ts tests/engine-rpc-lifecycle.test.ts tests/native-catalog-size.test.ts tests/native-rpc-shutdown.test.ts
npm run typecheck
npm run build
node --import tsx scripts/native-rpc-lifecycle-probe.ts /path/to/codex-0.163.0
```

14 项 RPC/compact 生命周期测试、5 项既有目录大小测试、2 项服务关闭测试，共 21 项通过。CTO 复审新增的 6 项 steer 回执行为测试与这 21 项合跑 27/27 通过，相关 Worker/更新回归 31/31 通过，类型检查通过；本次收口未重复构建、真实原生探针或全量高负载测试。服务关闭测试的两个用例在关闭调用者修正前均失败，其中一个用例覆盖读取、登录开始和取消三条阻塞路径。三个核心慢响应测试对清单 SHA 一致的基线 engine 在 Node 22 下全部失败（请求提前 rejected），候选全部通过。旧 0.154.0 合成协议、固定 0.163.0 合成协议与现有 engine/native/account/interaction 回归均纳入验证。

实际固定 0.163.0 二进制探针使用临时空 HOME、无账号、仅本机脚本 Responses，不执行真实登录或插件安装。观察到：

```text
compact ACK
turn/started
item/started:contextCompaction
item/completed:contextCompaction
turn/completed:completed
```

两次 loopback 模型响应后，close 确认退出且 pending 为 0；临时 HOME 已清理。此证据确认固定版本成功协议，不代表真实服务的长耗时、真实 OAuth、安装或实际网络取消均已端到端验证。失败/中断/丢回执、并发、原生 retry、关闭清理由可控协议测试覆盖。

原生 EOF 新增关闭通道判定；旧子进程在重启后新到达的 stdout 行/EOF 不会进入新连接。现有大目录响应额度、native/legacy 边界、错误分类和通知接口不变。同步清理了目录大小测试中已失去所有者的 pending timer fixture，保留原断言。

Web 存在独立的传输回执边界：`scripts/dev.mjs` 的 `invokeWeb` 对 capabilities.manage 等待 30000ms，对 capabilities.state 等待 20000ms；到期返回 `web_receipt_unconfirmed`，移除 Web 等待项，不关闭原生进程或重放 RPC。因此长原生请求仍可继续，但开发网关的 Web 调用可能先显示回执未确认。这不是原生操作失败证据，本次保留该独立边界并明确交付风险。`src/web-server.ts` 另有上传阶段 30 秒 socket timeout，上传完成即取消。浏览器/代理的网络中断也不证明原生操作失败。

## 本次完整检查结果

2026-10-20 的完整 `npm test`（Node 22.22.0、单进程、低优先级）为 559 项：546 通过、11 失败、2 跳过。本次 RPC/compact/服务关闭专项全部通过；完整检查没有全绿。

9 个失败涉及输入快照不包含打包锁、ASR 模型、文档 Python、会议示例，以及基线 `.DS_Store` 导致的既有文件数量断言。相关输入清单及未改测试/实现 SHA 已核对。另 2 个开发升级夹具因编译/启动边界失败，观察到 TypeScript 约 30 秒被终止和高机器负载；根项目类型/构建通过，但这两条真实交接路径仍未验证通过。没有修改这些断言、增加依赖或扩大修复范围。

## 采用与回退

公共 `EngineLike`/request 签名、配置 schema、权限与审批、主提示词均未改。生产代码改动集中在 `src/engine.ts` 的 pending、启动握手、stdio/fail、compact、interrupt 与 close；新增错误类型只传递 RPC 回执未确认的证据，request/EngineLike 方法签名不变。服务层修改 `nativeRpc` 的关闭态 gate、close 中 native control 关闭顺序，以及 `applyUpdate(steer)` 的回执分类和重复操作 gate；不涉及主轮级执行或恢复。

CTO 采用时按 hunk 协调共同文件 `src/engine.ts`、`src/service.ts`，尤其是另一个轮级执行/恢复任务可能修改的 turn/interrupt/close 区域。不能整文件覆盖另一个候选。回退只逆向本补丁的 hunk，并移除本次新增测试/探针/文档；不涉及账号、线程、数据库或配置迁移。

`applyUpdate(steer)` 将 `EngineRpcUnconfirmed`（兼容旧 `engine_rpc_timeout`）返回并持久记录为 uncertain；明确原生拒绝、发送前失败与 ACK turnId 不匹配保持 failed，正常 ACK 为 received、adopted=false，只有既有 adopt_version 确认采用。不能只凭 engine_disconnected/engine_closed 字符串判未知，因为同码也可能在发送前产生。复用已有 operations.state/rpcState，在等待、received、failed、uncertain 或已采用操作再次进入时返回既有状态，不重复发 steer；无需新操作表。迟到 ACK 不能清除持久不确定状态。

这次新增测试经真实 RecursiveTools→Homer.applyUpdate→CodexEngine 路径进入受控 peer，检查 SQLite operations 和 runs；无真实账号、原生联网或生产数据库。修改前两种丢 ACK 路径均实际返回 failed，重复操作也会重发；修正后保持未知，不宣称未执行。固定版本的真实 steer 丢 ACK 端到端场景没有执行，成功/拒绝协议由固定源码佐证，丢回执由受控 peer 复现。

## 维护源合并验证（2026-10-20）

CTO核对最终9文件候选SHA后，按变更块应用；`service.close` 的旧预算计时器上下文已适配，没有恢复已移除的总预算。结合轮级恢复，实际合并版本111项相关测试及独立类型检查通过。

随后固定Node22.22.0原样运行一次 `npm run check`：构建/类型检查通过，597测试中594通过、1失败、2跳过，未取消。普通RPC、compact、丢steer回执、停止、原thread恢复、防重复、主Agent/Worker模型设置及四类升级路径均通过。唯一失败仍是未修改的Skill快照固定文件数断言：现有 `.DS_Store` 导致11而非10；基线快照脚本已在相同目录复现。未删除文件、改断言或屏蔽用例，完整检查退出1，不能称全绿。

准确RPC增量补丁、包含时限修复的组合补丁、10文件前后SHA和回退副本见 `.codex/scratch/native-rpc-integration-20261020/`。这次没有新增真实模型、登录、联网安装或生产数据验证；候选内的原生探针记录与本轮合并检查分别保留。未重启、部署或绕过真实用户代码更新审阅。
