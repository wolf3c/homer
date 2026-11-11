# 无感更新：已实现范围、协议与验收

2026-10-16。基于停止补充冻结的173文件、293项历史检查。本轮是稳定入口和独立界面更新的实际实现；没有完成忙碌业务版本推广，也没有上线日常4780。原16号iLink计划及索引保留。

## 现在可以做什么

兼容UI改动独立构建，通过协议检查后激活，不等待原主轮、运行Worker、待用户答复或外发uncertain。新页面使用新资源；旧页面继续调用同一API/SSE并提示刷新，不强制打断草稿或模态编辑。刷新保留原主线程、历史和草稿。业务源码仍由原owner执行，候选失败继续旧版。

业务交接期间普通Web/CLI输入先持久暂存，业务恢复原thread后交给原队列。相同ID重复提交/刷新/网断重试只接收一次。业务child异常死亡时稳定Web入口可继续暂存，明确等待恢复；网关自身死亡须显式重启，停止期间不能接收HTTP。

本轮没有把live Engine搬进另一个进程，没有双主Agent、第二个业务inbox或第二个渠道轮询owner。主工具五项、原递归/MCP授权、预算、scope、epoch、记忆引用失效、发布文件hash与来源校验均未改动。

## 数据与公共契约

| 层 | 所有者与保证 |
| --- | --- |
| HTTP、SSE、终端 | 稳定launcher，独立gateway锁；新普通消息按请求ID持久化后才能返回暂存回执 |
| 传输记录 | `runtime/gateway/transport.sqlite`，目录0700、文件0600、FULL同步、schema1；记录稳定ID、必要受保护载荷与结果状态，不包含凭据或诊断正文 |
| 正式接收事实 | 原`conversation_inputs/messages + agent_messages/receipts + operations`，原接收事务完成才算业务接收；claim/startRequest/adopt仍同事务 |
| 执行、授权与交付 | 原唯一Homer/数据库owner，旧Worker保留原线程、回调、MCP/记忆快照和epoch；没有跨执行版本推广 |
| 界面版本 | `ui/protocol.json`必须匹配服务`WEB_PROTOCOL=1`，候选网关源码指纹也必须与驻留版本相同，不能仅声明版本号绕过契约变化；`upgrade.uiVersion`独立于业务`version` |

新增回执：`{requestId, transportState:'stored', accepted:false}`只表示传输提交，不表示业务已接受、模型采用或成功。正常运行优先等原业务收据，2秒未获收据返回持久暂存状态。UI仅在业务历史出现该requestId时清除待确认项。`upgrade.accepting/transportPending/transportRejected`为入口状态；旧客户端仍可使用原接口，旧页面不必为业务版本变化强制刷新。

业务收到同ID时沿原hash去重。提交已发生而IPC回执丢失，恢复只重试接收，不重跑模型或外发。业务收据确认后清除传输载荷；拒绝时清除正文并保留ID/错误，仅显式用户重试重新进入传输扫描，日志不能成为请求身份的第二裁判。最多1000条待结清或拒绝记录，满额拒绝新传输而不假确认。没有后台清理或自动重发未知微信/TG记录。

重启前核对连接绑定、原thread及待传输时的schema/工具指纹。已保存thread会传给child，在启动引擎前核对原业务meta，不能静默创建替代线程。不兼容的待传输契约拒启并保留原记录。

没有业务DDL迁移；原schemaHash整份owner文件屏障保留。未知DDL、依赖/账号/runtime/引擎/主工具变化不热替；网关路由和契约源码变化要求受控重启。传输schema未知版本拒绝。该保守策略不是显式的业务schema能力协商实现。

## 交接、失败与资源回收

新增只读`probe → upgrade_probe`握手：忙碌任务或活跃扫码只返回不具备条件，网关继续running；只有正向预检且父侧没有新请求时才进入prepare。prepare仍冻结输入、停渠道并再次核对，防止预检后新消息/渠道入站竞态。普通输入在冻结后进入持久传输记录；停止、打断、原交互答复和管理写入不跨版本自动补执行。管理读取最多等待5秒恢复；超时或失效明确失败。

仍须旧进程正常退出、原锁释放、原thread确认，才启动业务候选。候选ready前不向它投递新业务输入，因此原启动失败回退不会重放候选已接受的输入。ready后若进程故障，不盲目自动回退；入口进入`recovery_required`。启动超时只提示，不能强杀未知owner抢锁；特别是未知存活租约、关闭false/throw、uncertain外发仍需对账。

Vite资源路径固定为`/ui/<完整UI指纹>/assets/<文件>`，旧页面请求不会混用新chunk；主页面和API维持no-store。SSE传完整快照，断线重连重新读取，消息/请求身份用于去重。最多保留本次会话8份已激活UI资源，达到上限继续当前界面并提示受控重启；不悄悄删除旧页面仍可能请求的资源。当前业务、待切候选及保留UI之外，本次创建的失败/被替代/已排空构建回收；不清理已有历史构建。

## 合成演示

维护入口：`scripts/seamless-acceptance.mjs`，创建独立fixture源码与runtime，真实launcher/业务子进程、Homer、SQLite、HTTP、SSE和UI；只注入合成EngineLike，`codexBin=/usr/bin/false`，空home、无账号、无模型调用和外发。没有创建真实Codex主线程或Worker，不读取/复制模型凭据，没有自启动项。

```sh
PATH=/Users/wolf3c/.nvm/versions/node/v22.22.0/bin:$PATH node scripts/seamless-acceptance.mjs
```

默认 <http://127.0.0.1:4791/>，占用时不要重复启动；可指定非4780的空闲`HOMER_SYNTHETIC_PORT`。控制台输出本候选PID、base和receipt；关闭仅对该命令Ctrl+C或`/quit`。

发送`hold-main`开始持续合成回复，发送普通文本进入原主队列，停止只中断当前回复。修改控制台base下的`ui/homer-styles.css`演示界面独立更新；修改其`prompts/main.md`演示业务仍等待安全边界。只操作合成base，不改日常配置。该合成Engine不模拟模型理解、递归协作或微信手机。

## 本轮证据与边界

全部新输入为requirements-derived synthetic，不冒充获准真实反馈。日志、截图、退出码、源码清单和完整增量位于`.codex/scratch/seamless-update/`。

- `compatible-ui-red.tap`：原版无法在原执行器驻留时独立激活UI，0/1，exit1。
- `transport-contracts-green.tap`：真实写者SIGKILL后的持久恢复、同ID/FIFO/权限、业务提交后丢ACK不重跑、拒绝载荷清除、绑定/thread/未知传输schema/待传输契约屏障，4/4。
- `rejection-retry-red/green.tap`：显式重试必须回到业务事实源，不能由传输拒绝记录永久裁定身份；修复后4/4。
- `gateway-crash-green.tap`及后续组合：真实子进程、SQLite、HTTP，16并发POST对应8唯一Web输入，加1CLI；恢复窗口202暂存、ID冲突409、SSE可连、gateway SIGKILL和同thread恢复；原业务接收无重复。后续同一用例增加业务child SIGKILL后入口继续暂存、显式重启恢复第11条输入。
- `gateway-ui-green.tap`早期1/2：UI通过；gateway夹具在启动未确认时等待锁自行释放超时，单列为夹具退出条件错误。改为释放精确合成启动gate并核对PID退出，不把该失败宣称产品RED。
- 原子进程交接/失败候选回退/依赖与schema/主工具guard继续运行原测试。首轮完整`npm-check-seamless.log`构建、类型、300/300、exit0。
- `npm-check-release.log`构建/类型通过、299/300、exit1：捕获活跃微信扫码被父侧短暂preparing阻断QR读取409。未放宽原200断言；用只读probe预检修正，只读probe后的窄组合4/4通过；随后`npm-check-frozen.log`为299/300，原升级测试在多份编译并发时首次启动超过原20秒窗口，未改其断言/超时。审阅期间该次源码有变化，收据明确列出，不能算最终冻结。最后只读probe冻结检查`npm-check-owner-freeze.log`构建、类型及301/301全通过。实际浏览器又复现SSE断流后首次重连503会让原生EventSource停止重试；已增加页面生命周期内500ms至10s的退避重连，关闭旧连接避免双循环，原thread校验和草稿/待确认身份保持。最终`npm-check-reconnect-freeze.log`构建、类型及**301/301**全通过，exit0/signal=null，`sourceChangedDuringCheck=[]`；同名-exit.json为逐进程收据。
- 真实Chrome 605×900及1280×900：无横向溢出，UI更新不强制reload，原流式回复/业务版本/主thread不变；草稿在点击刷新后保留，发送仍可用。`browser-stream-update-605.png`、`browser-stream-update-1280.png`、`browser-render-checks.json`和`browser-demo-after.json`留证。交接窗口普通发送已持久暂存且尚未进入历史，见`browser-handoff-stored.json`；恢复后恰两条用户消息、原待确认清除，见`browser-handoff-recovered.json`。实际SSE代理断流、禁发、草稿保留及恢复另见`browser-sse-disconnected*.png`及对应JSON；浏览器离线模拟没有中断既有SSE的尝试单列，不算产品RED。随后专用临时代理实际中断SSE并连续返回503：原版禁发且恢复后不再重连；修复版实际观察到1/2/4秒重试，放行后无需刷新恢复发送，605/桌面草稿都保留，见`browser-sse-503-red-green.json`、`browser-sse-reconnected*.png`。代理验收后已关闭。

原293项冻结与本轮301项是不同证据，不把旧批次日志冒充新检查。原记忆局部失效、stop-vs-answer、递归发布和三渠道权限仍由现有合成用例验证；本轮没有声称这些流程已经跨后台执行版本验收。保留Node SQLite实验功能和Vite首包提示。

## 剩余工作与日常切换

尚未完成：稳定执行层、业务/执行版本固定路由、忙碌后台新版推广、旧执行器排空回收、跨版本MCP权限/预算/等待唤醒，及显式业务schema兼容能力协商与扩展/收缩迁移证明。当前仍可能因长期Worker、pending_user、执行/操作/正式交付未知等延后业务更新；不能声称整套无感更新完成。微信已结束发送的持久outbox uncertain与活跃owner的区别及2026-10-17追加迁移预演见[日常库预演](18-daily-migration-preview.md)。相应跨版本流式主轮/Worker/待答、记忆局部失效与发布一次性验收也未成立，不能用UI独立更新代替。

没有真实模型/主thread复用、真实新Worker、微信/TG手机送达或日常升级验收。本轮不归档/删除任何真实线程，不恢复已删除探针。

该301项冻结批次未打开日常DB，只核对监听PID及进程启动身份，没有迁移/清理、重发或认定6条uncertain已送达。后续2026-10-17用户追加授权只读一致性备份及副本预演，记录独立维护于18号文档；不能将正常使用中的DB称为字节不变。

未来日常激活由CTO处理：先审阅本轮增量和原待迁移schema，取得对应维护窗口；核对旧owner/租约/外发未知状态，安全停止并取得一致私有备份与匹配旧二进制后，再更换需要重启的launcher。未确认的传输日志随同同一维护点保存，不清空掩盖输入；业务候选ready前故障可沿原受保护回退，ready后已接收/执行新请求不得恢复旧库盲目重放。未知外发与活锁未核实，继续旧日常可用状态，不擅自切换。本轮源码交付不表示已获准或已完成日常激活。

当前合成演示、源码冻结指纹、完整增量与全部退出码索引，见同批`scratch/seamless-update/seamless-update-cto-handoff.md`。该路径相对于项目`.codex/`；这是审阅证据，不是产品运行依赖。

本轮保留的最新合成入口为 <http://127.0.0.1:4791/>，PID76683，base=`.codex/scratch/seamless-update/gateway-e2e-t2Sbte`，候选业务指纹`a283ad0ad101`，UI指纹`f82e853990533a2c9a396390a3b7373626c486e195015449620bc3a5c1a698e5`。仅该演示保留；此前两份演示和临时断流代理已核对PID后关闭。候选页面以已持久接收的合成说明明确无真实模型/账号/外发。
