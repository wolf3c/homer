# 主 Agent 插件工具注册

2026-11-07 · Homer 业务插件的首版接线已通过合成宿主和 stdio MCP 验收。

本注册契约只适用于 Homer 自有的业务工具。Codex 已支持的工具、MCP、Skill 和插件沿原生机制接入，通用权限和审批由用户选择的 Codex 配置及操作系统决定。[主架构核心边界](main-worker-chat-architecture.md#核心边界)

## 注册与授权

Homer 业务插件启动时向宿主注册自有工具的定义及处理函数。宿主校验工具名、参数、当前主会话和轮次。需要真实用户授权的业务动作，由宿主向处理器注入当前用户轮的可信 `requestId`，插件据此核对请求、用户意图及事项范围。后台轮、Worker 回报、历史正文和模型参数不能伪造真实用户授权。异步执行跨越等待时需在产生副作用前重新核验当前授权与撤销状态。

各工具的参数和业务授权规则由所属模块定义，业务状态由各插件保存。渠道工具见[多渠道方案](multi-channel-architecture.md#3-主程序的最小接口)。

[定时任务方案](scheduled-tasks-architecture.md)已接通 Croner 和创建、查询、修改、取消四个薄工具，分别加入 Main／Worker 的宿主业务 MCP 目录，共用定时模块及规则存储。两角色均由宿主将原生调用元数据与同一引擎的工具开始事件匹配，再核验当前交办或委托；保留真实用户轮专属门禁。创建响应全丢时，两角色通过 `schedule_list({ receipts: true })` 查询获准范围内的原操作回执，无需预知安排或调用 ID；宿主复用持久操作身份，同原调用重取原结果，过期旧写仍拒绝。模块只负责到点向 Homer 投递消息，不增加工具、独立 MCP 服务或业务执行状态。隔离宿主和实际固定 Codex 0.163.0 的双角色旧线程、调用证据及回执恢复专项已通过，未替换日常安装。

### 旧主会话如何加载工具

**采用现有主 Agent 专用 `homer_interactions` MCP 入口，在宿主重启时加载 Homer 业务插件目录。** 固定 Codex 0.163.0 生成的实验协议只在 `thread/start` 声明 `dynamicTools`。Homer 恢复时沿用旧线程的动态目录，目录哈希变化会触发 `main_tools_migration_required`。把业务插件工具接入主 Agent 的 `homer_interactions` 可沿用动态目录及其哈希。该服务的注册目录、宿主分发、stdio MCP `tools/list` 和引擎可调用名称须一致，并由恢复后的 `mcpServerStatus/list` 核对。名称冲突在注册时拒绝。Worker 沿其独立的 Homer 业务工具目录启动。源码入口见 [service.ts](../../src/service.ts)、[engine.ts](../../src/engine.ts) 和 [worker-interaction-mcp.ts](../../src/worker-interaction-mcp.ts)。

**2026-11-06 本机协议探针。** 使用固定版 app-server、新建隔离 HOME、合成旧线程和回环 Responses 服务。首次启动时只有原 MCP 工具，写入历史标记并退出引擎。带扩展目录重启并恢复同一 `threadId` 后，原历史与动态目录仍在，`mcpServerStatus/list` 列出新增工具。一轮合成 Responses 通过 `functions.exec` 找到并调用新增 MCP 工具，结果回到该轮。原生 `item/started` 的 `mcpToolCall` 携带线程、轮次、工具名和参数。实测该调用的 MCP `tools/call` 带 `_meta.callId`，与原生 `item.id` 相等，`_meta["x-codex-turn-metadata"].turn_id` 与通知的 `turnId` 相等。轮外 `mcpServer/tool/call` 能访问夹具，但缺少这对关联字段和相应的开始通知。此探针验证固定引擎的加载、调用及关联字段。

**使用真实用户授权的工具须核对原生轮次。** 主 MCP 桥转交插件工具调用的原生元数据。宿主用活动主引擎的线程、调用元数据中的轮次与调用 ID 匹配该引擎发出的 `mcpToolCall`，并核验服务器、工具名及规范化参数。宿主只在活动真实用户轮消费该证据一次，从该轮注入可信 `requestId`。渠道工具在同一同步段核验事项并登记订阅。两路消息可限时等待对方，缺失、冲突、重复、停止或过期均拒绝写入。升级引擎时复验关联字段及拒绝路径。[宿主注册与校验](../../src/service.ts) · [MCP 桥](../../src/worker-interaction-mcp.ts)

## 验收

- 用固定引擎恢复同一个旧主会话，核对新增工具的发现、参数校验和实际调用。插件禁用后恢复时目录移除该工具，Worker 目录始终不可见。
- 用真实用户轮验证宿主注入正确的 `requestId`。覆盖轮外直调、后台轮、Worker、同参数的迟到调用、重复及停止后的请求，确认均无法借用其他轮次的授权。
- 合成验收覆盖有证据的调用、请求注入、重复调用、参数不匹配、过期轮次以及 Worker 工具目录隔离。固定 Codex 0.163.0 专项恢复旧线程后验证真实 MCP 调用：有绑定的用户轮可登记订阅，无绑定请求及后台轮被拒绝，Worker 看不到工具。[宿主接口测试](../../tests/channel-host.test.ts) · [真实引擎专项](../../tests/channel-native.engine.test.ts)

隔离候选已从 Main 和 Worker 的目录、分派及实现删除 `capabilities`。MCP、Skill 和插件通过固定版 Codex 原生配置、发现与管理。插件安装建议使用原请求及既有待答，客户端调用一次 `plugin/install`。回执丢失时核对原生状态。账号登录继续沿桌面管理入口。固定引擎专项已核对原生 MCP 注册及调用、Skill 和插件生命周期，验收使用独立 HOME 和回环模型。[测试入口](../testing.md#固定原生协议与合成验收入口)
