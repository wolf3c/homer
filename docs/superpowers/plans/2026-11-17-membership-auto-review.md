# 会员 Auto Review 固定 GPT-6 Luna：实施方案与结果

状态：**用户批准后已实施源码，未安装／部署／提交**。2026-11-17，保留共享工作树并行变更。仅按现行完整角色配置实现，没有旧配置迁移或跨版本兼容；真实付费模型调用仍未执行。

## 1. 最终行为

会员来源的 **Homer（Main）和 Worker 默认启用 Codex 原生 Auto Review**，reviewer 固定 `gpt-6-luna`。模型名在项目内定义一次，沿当前角色会员主模型的 provider、URL 和 Token 调用。

计费由 **Agent Model Hub** 负责。Homer 保持现有剩余积分读取，不新增计费、预扣、价格表、预算或结算设计。**272K 不作限制或防御，超过后的成本由用户承担**；不新增截断、计数、费用告警或阈值测试，原生模型容量与压缩机制正常运行。

不新增审核服务、业务审批队列、数据库字段、用户模型选择项、网站配置或权限系统。代码审查 `/review` 及其 `review_model` 不在本次范围。

## 2. 必要改动：两个生产文件

| 代码位置 | 现状 | 拟改内容 |
| --- | --- | --- |
| [src/model-catalog.ts，membershipModelCatalog](../../../src/model-catalog.ts#L18) | 目录只生成角色模型，没有审核模型选择 | 定义 `MEMBERSHIP_AUTO_REVIEW_MODEL='gpt-6-luna'`；会员父条目加 `auto_review_model_override`。该字段属于 ModelInfo 元数据，不是 TOML 顶层设置 |
| 同函数 | 没有独立 Luna 元数据 | 父模型异名时加入隐藏 Luna 条目；同名时单条合并 override，保留角色参数，不生成重复 slug。可用内部可选布尔参数 default false 隔离调用，不增加用户配置 |
| [src/engine.ts，目录生成](../../../src/engine.ts#L467) | 现行通用目录由 capabilities/context 生成，该调用也可能用于其他 provider | 仅在 `desktopModelSource==='website' && dailyDeepSeek===true && !controlOnly` 的会员业务路径加入上述元数据；Main、Worker 共用，不给 ChatGPT、BYOK 或控制连接加覆盖 |
| [src/engine.ts，线程参数](../../../src/engine.ts#L616) | 新会话继承原生配置；恢复参数尚无会员默认 reviewer | 解析一次当前审批设置，在正常 start/resume/fork 请求中传入；会员无显式配置时用 `approvalsReviewer:'auto_review'`、`approvalPolicy:'on-request'`。不扫描或修复历史线程数据 |
| 同处，响应处理 | 已有目录/provider 回读，未核对会员审核模式 | 保留既有回读，并核对线程响应顶层 `approvalsReviewer`、`approvalPolicy`。三种原生响应直接提供实际值，不新增查询接口 |

Luna 条目依据固定 Codex `0.171.0-alpha.7` 自带 [models-manager/models.json](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/models-manager/models.json)，在现有代码内固化必需元数据，不运行时下载、不另造资源文件。不复制父模型能力冒充 Luna。原生条目支持 low、使用 code_mode_only；复用原生选择器，不新增强度设置。其原有窗口字段照模型元数据处理，不为费用目的改大或改小。

[effectiveModelConfig](../../../src/config.ts#L115)、[会员 provider](../../../src/engine.ts#L476)、[Token 注入](../../../src/engine.ts#L531) 复用，不预计修改。Main、Worker 可以使用不同 URL，各自 reviewer 跟随所属角色。当前配置下目录与线程参数都必须生效：只指定 Luna 不会开启审核，只开启审核也不保证选到 Luna。

本轮不补缺少 capabilities 的历史会员配置，不添加能力发现、迁移或回退目录生成系统；实施按当前使用配置验证即可。

## 3. 配置优先级与实际生效时机

- **当前明确配置优先。** 显式 `approvals_reviewer='user'` 保留人工，auto_review 固定 Luna；显式策略与托管约束保留。无显式值才采用会员默认。沿现有非禁用配置层判断，不把原生默认 user 当主动退出，不新增偏好表。
- **策略必须能触发审核。** on-request/granular 可路由 Auto Review；明确 never 不产生这类审核，不能把它显示或描述为已启用。该差别直接决定功能是否工作，不是新增防御。
- **目录在原生进程启动时采用，线程模式在正常 start/resume/fork 时采用。** 代码更新不会热改正在执行的动作或待审批请求；需要在实施交付时安排当前引擎正常结束，再由更新后的代码建立业务引擎并读取响应确认。不在本方案中加入自动重启或迁移机制。
- **正常恢复仍须传当前参数。** 这是新实现日常释放/重建执行器也会走的路径，不是对旧版线程作兼容或补迁移。无需解释历史保存值来自哪个版本或用户当时意图。
- **切换模型来源按当前目标来源应用。** 会员加入上述覆盖；切回 ChatGPT 时，现有来源转换 fork 传目标来源的当前原生 reviewer/policy，避免把本次会员默认带过去。同来源普通 ChatGPT、BYOK、`controlOnly` 不改变原有行为；不另存切换前快照，不实现跨版本往返兼容。

此处给出确定的实施优先级，不再将“是否开启”列作待定产品开关，也不强制覆盖当前明确的人工选择。

## 4. 原生审批与 Homer 现有流程的接点

Main 和 Worker 共用 `CodexEngine`。Main 在 [engine.ts](../../../src/engine.ts#L454) 关闭普通多 Agent 功能，但原生 Guardian 通过内部审核会话创建，路由条件没有“只限 Worker”判断；不能因此要求新增 Homer 业务 Worker 来审批 Main。Main 实际可用性仍须用固定二进制确认，源码结构不是成功验收。

当前 Worker 原生 authorization 在 [service.ts openInteraction](../../../src/service.ts#L2061) 直接进入 `mainApprovals.open`，由 [MainNativeApprovals](../../../src/main-native-approvals.ts#L20) 接收用户明确决定，并不全部排队等 Main 模型判断。Main 对应入口为 [openMainNativeInteraction](../../../src/service.ts#L2032)。

| 请求 | 启用后的行为 |
| --- | --- |
| Main/Worker 可适用的原生权限审批 | 在 Codex 内由 Luna 审核；允许则继续、拒绝则阻止，成功内部审核不再生成宿主人工卡 |
| 必须人工的原生提示、原生人工回退、登录/插件交互 | 沿现有宿主回调，不将模型结果伪装为用户点击 |
| Worker 业务提问、任务范围澄清 | 保留 Worker→Homer 协调，不让 reviewer 承担业务负责人职责 |
| 视频生成、窗口授权等宿主专门确认 | 保持现有路径，本次不取消这些确认 |

预计不用修改 `service.ts`、`main-native-approvals.ts` 或 [WorkerNativeRequests](../../../src/worker-native-requests.ts#L34)。也不放宽 Main 的 thread/turn 身份校验，不把全部 [homer_interactions](../../../src/engine.ts#L502) 工具改成 prompt。TaskVersion、停止、操作回执和未知结果处理沿用，不增加“原生审核后再问 Main”一层。

原生 allow/deny、模型错误、超时、取消及证据失效按引擎原样处理，不另建重试器、状态机或换模型回退。现有人工链只处理仍到达宿主的请求，不重复审核已经由原生处理的动作。

## 5. 必要验证与真正未证实的事项

修改前后只跑相关离线测试；复用 `tests/deepseek-model.test.ts`、`tests/desktop-deepseek-engine.test.mjs`。固定二进制需要回环模型替身时，最多增加一个 `tests/native-membership-auto-review.engine.test.mjs` 并登记 `scripts/test.mjs` 的 engine 清单；不加入默认核心执行路径。

- [x] **配置正确：** 当前 Main/Worker 目录固定 Luna、异名隐藏/同名去重；当前显式设置及默认启用正确；三种正常线程入口响应与目标来源一致。
- [x] **调用正确：** 全新 HOME/CODEX_HOME、合成会员 Token、回环 Responses，捕获审核请求 model、所属角色 URL 和鉴权；确认 Main 关闭普通多 Agent 仍能审核，ChatGPT 未被会员默认污染。
- [x] **接点正确：** allow 不重复弹人工卡，deny/模型错误不执行动作，停止后晚到结果不执行，必要人工提示与 Worker 业务提问仍保留。沿用已有测试，只补接线缺口，不重测整套原生引擎。

会员 provider 已是 `requires_openai_auth:false` 与环境 Token，不应为审核增加 ChatGPT 登录门槛。最小调用测试不借用真实 ChatGPT 登录即可证明基本独立性；删除合成失效登录的兼容矩阵，不修理认证文件。若实际调用确被某条辅助认证路径阻断，再凭具体错误处理，不提前设计认证改造。

**当前实施已补齐原生回环证据：** Main/Worker 审核终态、冷恢复和会员来源往返均通过。会员线上端点接受真实 Luna 请求仍未验证。旧配置无 capabilities、旧线程继承意图和跨版本升级不列为本次阻断问题。

后续真实端点确认仅限最少 API 正确调用，并需当轮授权；不验会员费率、账单或 272K 阈值。线上尚未验证不等于必须增加功能。实施完成时更新账号与模型连接架构、架构索引和测试说明的真实状态，保全现有并行改动。

## 6. 源码依据与本次删减

依据固定 `rust-v0.171.0-alpha.7`，不跟随 upstream main：

- [模型 override 和选择](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/ext/guardian-reviewer/src/model.rs#L19)；[启用所需策略与 reviewer](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/ext/guardian-reviewer/src/routing.rs#L59)。
- [start 参数](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/app-server-protocol/schema/json/v2/ThreadStartParams.json)、[resume 参数](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/app-server-protocol/schema/json/v2/ThreadResumeParams.json)、[fork 参数](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/app-server-protocol/schema/json/v2/ThreadForkParams.json) 均支持审批覆盖；对应 [start 响应](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/app-server-protocol/schema/json/v2/ThreadStartResponse.json)、[resume 响应](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/app-server-protocol/schema/json/v2/ThreadResumeResponse.json)、[fork 响应](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/app-server-protocol/schema/json/v2/ThreadForkResponse.json) 返回实际模式。
- [目录启动加载语义](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/core/config.schema.json)；[内部 reviewer、父认证与环境](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/core/src/guardian/review_session_setup.rs#L107)；[原生结果处理](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/ext/guardian-reviewer/src/completion.rs#L86)。

本次删除旧线程配置意图还原、旧会员无 capabilities 接入、跨版本兼容及失效登录测试矩阵；压缩重复边界说明。保留正常创建/恢复/来源切换，是当前使用的实际调用路径，不扩成迁移系统。272K 防御与 Homer 计费持续排除。

## 7. 实施结果（2026-11-17）

- 生产改动仅两个文件；新增目录单测与固定引擎专项，现有协议夹具补充 reviewer 响应，登记专项。未修改宿主审批模块，没有新增服务、计费系统或 272K 防御。
- 相关离线回归 30/30，完整类型检查通过。固定引擎完整回环专项 **18/18 通过，零失败／跳过／取消**，覆盖 Main/Worker 模型、合成 Token、真实本地工具执行／阻止、恢复、来源往返及当前 Terra Code Mode Only。
- 实际复现并修复会员 fork 模式污染 ChatGPT；独立只读复核未发现重要生产缺陷。停止测试修正后以迟到 allow 和真实终态证明不执行。
- 只读公共配置接口确认当前两个会员角色具备 context/capabilities；不是客户端缓存采纳或线上审核成功证明。真实会员调用／账单、安装及发布未验证、未执行。
- 测试自身清理临时目录、进程及服务器；无额外任务临时资源保留。未暂存、提交、推送、部署或重启日常应用。

提交前复核（2026-11-17）：仅含本事项改动的独立候选基于 `b11e2c64`，使用项目 Node 22.22.0 验证相关回归 30/30、打包 Codex 回环 18/18、完整类型检查通过；零真实模型调用。此候选不包含共享工作树的其他未提交片段。
