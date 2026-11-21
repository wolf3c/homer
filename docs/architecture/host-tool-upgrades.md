# Homer 自有工具随软件升级

2026-11-21 · 在新基线上，软件升级后可继续原 Main 和 Worker 对话。Codex Code Mode 在恢复后的第一个模型请求中提供当前角色的 Homer MCP 工具签名，模型可以立即在 `functions.exec` 中调用或串联它们。首个支持基线使用独立新资料目录，开发期旧资料仍由对应旧版打开。

## 工具怎样更新

1. **业务模块持有定义和处理器。** Main 的 `MAIN_TOOLS`、`RECURSIVE_TOOLS` 与 Worker 的文件和提问工具加入已有角色目录。宿主端点和 stdio 的 `tools/list` 共用 `hostMcpTools`，插件与按配置启用的工具沿用原注册入口。新增、改参、删除工具时，更新所属模块即可。[角色目录](../../src/worker-interaction-mcp.ts)
2. **宿主在接入 Codex 时指定工具如何出现。** 引擎启动和线程创建、恢复共用一份 `homer_interactions` 配置。该服务设置 `omit_tools_from: ["deferred"]` 后，Codex 将当前签名写入最新的 `functions.exec` 声明。旧脚本仍在历史的 `custom_tool_call.input` 中，恢复请求也可能包含较早的声明。模型在选择工具前就能看到新用法。DeepSeek 由 Codex 按其模型目录提供原生函数签名。[线程创建与恢复](../../src/engine.ts)
3. **恢复指纹只覆盖线程持久化的动态工具。** Codex 会沿用建线程时的 `dynamicTools`。Main 和 Worker 的 Homer 动态工具表均为空，桌面、开发升级器和输入日志仍校验这张空表的 `mainToolsHash`。Homer MCP 目录来自当前软件，工具改参不会改变这个指纹。[恢复指纹](../../src/recursive-tools.ts)
4. **调用沿用原授权和原回执。** 桥转发原生调用 ID 和轮次。宿主核对当前引擎、线程、轮次、工具名和参数，再由原处理器核验委托。派工回执丢失时，从 Worker 的原消息取得 `operationKey`，用 `work_inspect` 查询原操作。已有确认就采用原结果，证据不足则保留未知。[调用核验](../../src/host-tool-calls.ts) · [宿主分派](../../src/service.ts) · [操作记录](../../src/recursive-tasks.ts)

## Worker 提问与答复

Worker 用同一个 MCP 目录中的 `ask_main(question)` 提问。宿主核验调用身份，在一笔事务中登记问题并通知 Main，立即返回问题 ID 和 `pending`。Worker 可以继续独立工作，受阻时结束本轮。Main 的查看、转交用户和答复都核验当前 Codex 原生调用身份。Main 查看原问题，用 `respond_interaction` 回答，也可以先请用户决定。

| 答复时的状态 | 宿主动作与送达依据 |
|---|---|
| 原 Worker 仍在执行 | 用原生 `turn/steer` 投到准确的轮次，收到 Codex 确认后记录送达。 |
| Worker 已正常结束 | 通过已有消息队列续接同一 Worker 和线程。新轮次确认接收该条输入后记录送达。冷启动可以继续领取尚未发给引擎的排队答复。 |
| 原轮明确拒收或回执丢失 | 明确拒收可在正常结束后续接一次。回执未知时保留原操作供核对，自动重发次数为零。 |
| Worker 停止、委托被替换、事项暂停或归档 | 原问题失效。回答业务问题只传递信息，原生操作审批仍绑定到各自的请求和权限范围。 |

答复消息只携带问题 ID、答复或拒绝标记及完整正文，原问题留在同一会话。问题、决定及送达时间使用已有交互表。投递复用 Worker 消息、操作及回执，问题 ID 关联原始决定和投递记录。引擎提供的原生自由问答限制仍见下方探针记录。[提问定义](../../src/worker-interaction-tools.ts) · [宿主投递](../../src/service.ts) · [轮次与回执](../../src/recursive-tasks.ts)

## 实测范围

以下验收使用独立资料。固定引擎版本为 Codex `0.171.0-alpha.7`。表中“首个请求”指原线程恢复后第一次发给模型的请求。只有订阅实模一行用于判断模型能否自主选对参数。

| 入口 | 观察结果 |
|---|---|
| 固定引擎与回环模型 | 在 A 的真实调用已进入历史后，恢复同一 Main 和 Worker。B 新增、删除工具并修改同名工具的必填项，C 只改必填项。B、C 首个请求的最新 `exec` 声明都与对应角色的目录一致（当时 Main 23 项、Worker 9 项，各含 2 个合成工具）。首次脚本就用新参数调用 `echo`，再把实际回执传给第二个工具，两个处理器均接受。[固定引擎验收](../../tests/host-tool-upgrade.engine.test.ts) |
| 不同模型目录 | 随包会员 GPT 在 `exec` 中取得完整 Main 目录，DeepSeek Flash 在原生函数声明中取得同一目录。恢复后两者都用 B 参数完成调用。另有直接调用配置作为对照，确认它会关闭 Homer 工具的脚本内调用。[模型目录对照](../../tests/host-tool-upgrade.engine.test.ts) |
| 固定引擎的权限和回执 | 在产品 Code Mode 和直接调用对照下，缺少身份的 Main 写入、Worker 调 Main 专属写工具均被拒绝。合法派工在写入后、返回前断线。冷恢复查得原操作为 `confirmed`，Worker 只运行一次，唯一输入为 `processed`。[故障注入](../../tests/host-tool-upgrade.engine.test.ts) |
| 现有工具授权 | 固定引擎核验了两个角色恢复后的定时操作，以及同来源、跨来源恢复后的渠道订阅和换绑。浏览器离线回归核验了调用身份和两个 Worker 的页面归属。[定时](../../tests/scheduled-native.engine.test.ts) · [渠道](../../tests/channel-native.engine.test.ts) · [浏览器](../../tests/browser-preview.test.ts) |
| macOS 桌面运行入口 | 本地编译的宿主配合随包 Node，通过 `desktop-runtime --test-profile` 启动，两份隔离运行资源均经过正常清单校验。A 先创建事项、开启 Worker 并用旧参数跟进。B 变更 `worker_message` 必填项，并更改两角色共用目录。在同一份资料中继续原事项，Main 和 Worker 的线程 ID、事项 ID 及 Worker ID 连续，B 定义下的消息实际送达。使用合成协议对端。[桌面升级](../../tests/macos-desktop-runtime.test.mjs) |
| 开发升级入口 | 合成引擎通过真实进程交接。B 的 `worker_message` 增加必填参数后，从当前目录读取参数，向原 Worker 投递成功。事项、两个线程及指纹保留。失败候选走现有回滚路径。[开发升级](../../tests/dev-upgrade.development.test.mjs) |
| 离线宿主的授权与回执 | Worker 请求 Main 写工具、Main 写入缺少调用身份均被拒绝。断开已写入的调用后，冷启动经事项、Worker 原消息及回执查询取得结果。故意移除确证时返回未知。两种情况下 Worker 各只启动一次。文件导出也校验调用身份与附件归属。[故障注入](../../tests/attachment-tool-outlets.test.ts) |
| 原生问答 | 启用实验开关并提供选项时，原生问题经宿主交给 Main，再由 Main 询问用户。实际等待超过十分钟后回答，原 Worker 在原线程同一轮收到自由文本，原生请求确认送达，任务成功结束。原请求中断后回答，下一轮未收到旧答案。默认模式和无选项提问在固定版本分别受到默认禁用及必须提供非空选项的限制。[问答探针](../../tests/host-tool-upgrade.engine.test.ts) |
| ChatGPT 订阅实模 | 2026-11-21，采用本次接入配置的隔离候选，`gpt-6.1-terra`。A 版历史里有成功的旧派工，B 版仅在夹具把 `attachments` 设为必填。用户只说“让刚才那个 Worker 继续原事项”。Main 分两次 `functions.exec` 调用 `work_inspect` 和 `worker_message`，首次派工即传 `attachments: []`。额外查目录和被拒调用均为 0。原事项与两个线程延续，派工确认，原 Worker 处理 1 条输入并完成。**首次派工采用新参数 1/1**，本次实现复用这次订阅记录。 |

此次固定引擎回环的合成 Main 线程为 `01a1f9fe-219d-7372-9b44-becae6dca587`，Worker 线程为 `01a1f9fe-2476-7080-9103-53924a914b2a`。各自的 `echo` 处理器按 A、B、C 顺序收到了 `oldValue`、`newValue`、`latestValue`，值分别对应角色 `main` 或 `worker`。

此前分别跑过两组订阅对照，各 1 例。原延迟发现配置下，首次派工沿用旧参数被拒，查目录后重试成功。只开放直接调用时，首次派工正确，但 `functions.exec` 内无法调用 Homer 工具。两组都向原 Worker 成功投递了一次。

将工具签名放进首个请求会增加上下文。隔离夹具中，Main 的 `exec` 声明增加 11,594 个字符，Worker 增加 3,668 个字符，未测计费 token。若显式启用 Codex 的 `features.code_mode_only_strict_3p_tools`，固定引擎会强制延迟第三方工具，两角色首包均缺少新参数。

此前工具目录实施时类型检查通过。69 项定向验收全部通过，包括 54 项离线回归、13 项固定引擎回环、macOS 桌面与开发升级各 1 项。此前另一轮全量离线回归为 2,793/2,800，剩余 7 项在当时修改前的基线上也能复现。

[执行命令和环境要求](../testing.md#homer-工具升级)

### 异步业务问答验收

2026-11-21 的隔离 ChatGPT 订阅实测使用 `gpt-6.1-terra`。用户委托一项缺少格式标签的任务。Worker 自行提问并结束本轮，Main 询问用户。用户回复后，原 Worker 在同一线程的新轮次生成了带指定标签的结果。共 2 个成功轮次，答复输入 1 条，回执为 `processed`。同一场景独立跑了两次，第二次使用最终的纯文本答复格式。两次均由模型自主完成，各只投递一次。上表的首次采用新工具参数是另一项订阅试验。

固定 Codex 回环分别验证了运行中答复、明确拒收后续接、回执丢失后冷启动不重发、停止后拒绝晚答，以及答复排队后重启继续送达。另一次冷启动后实际等待超过十分钟，原 Worker 在新轮次收到一次答复。本轮类型检查、246 项定向离线测试和开发升级进程交接通过。[固定引擎用例](../../tests/host-tool-upgrade.engine.test.ts)

提交前复审核验了 385 项定向离线用例、11 项固定引擎回环和 TypeScript 类型检查，全部通过。宿主补充回归覆盖两个恢复边界。Worker 正常结束后宿主意外退出，原问题按已保存的终态执行轮次继续有效。答复持久入队后 Main 可以结束协调轮，宿主在 Worker 确认接收后才记录送达。[冷恢复](../../tests/recursive-tasks.test.ts) · [答复入队与送达](../../tests/worker-chat-runtime.test.ts)
