# MCP 原生配置管理

2026-11-04：本页保留当前保存/审批及项目配置契约。配套回归为 `tests/native-mcp-config.test.ts`、`tests/mcp-operation-review.test.ts`、`tests/project-mcp-*.test.ts`；严格解析、项目层及实际回环调用列入显式[固定原生专项](testing.md#固定原生协议与合成验收入口)。此处浏览器结果为既有历史证据，不代表本轮或最新安装包已完成浏览器验收。

本实现针对 Codex 0.163.0 简化 MCP 管理入口，已整合到维护源码。日常服务采用由 CTO 按审阅流程执行；本地验证不构成第三方连接、真实账号或模型调用验收。

## 配置与授权

`mcp_save.server` 接受固定原生引擎支持的 MCP 配置，包括 `env`、`env_vars`、`cwd`、HTTP headers、原生凭据引用和超时。Homer 不再维护输入字段白名单、不要求 command 为绝对路径，也不限制启动/工具超时最多 120 秒。原生支持的零值、小数和大于 120 秒的值由原生规则决定。合法字段按用户原始值保存，不补写或改写 `default_tools_approval_mode`；原生格式不合法、未知字段和不兼容 transport 明确失败。

新连接、命令、参数、环境、目录、headers、凭据引用、超时、审批模式或扩大工具范围仍须真实用户批准。模型自带 `approve:true` 不构成批准。免新增审批仅允许保持所有其他配置完全相同并缩小 `enabled_tools`；比较覆盖全部字段，未来新增字段也不能绕过。保留 `homer_interactions`、专属 HOME、URL 来源策略、真实 origin/身份、版本冲突与串行管理规则。启停与移除仍沿原有权限契约。

环境变量是显式原生配置，不会使子进程继承整个 Homer 宿主环境。已有进程环境隔离保持。

## 项目配置与执行

专属 HOME 的原生执行路径采用 Codex 按实际 CWD 解析的有效 MCP 配置，不再因服务未出现在专属 user 文件中就额外禁用，也不在线程参数中重新注入 user MCP 表来覆盖项目优先级。可信项目 `.codex/config.toml` 是否生效、同名字段优先级、disabled 和工具限制由固定原生引擎处理。Homer 不创建项目可信名单，不授予 trust，不读取其他产品的共享 HOME 或账号。旧共享 HOME 兼容执行路径的环境服务隔离保持。

固定源码存在“新线程显式 cwd + 未知 trust + 可写权限”自动持久化 trusted 的分支。因此新原生线程使用已经按目标目录启动的 app-server 默认 CWD，省略会触发该分支的 thread/start.cwd；runtimeWorkspaceRoots 和 environments 保留实际目录，恢复与后续 turn 继续显式 CWD。不改权限策略、不写 trust 记录。隔离无账号原生线程已验证最终 CWD 正确，unknown/untrusted 项目服务不会连接，用户 trust 文件字节不变。

管理入口仍以专属 user 文件为编辑对象。项目服务可能在执行中有效，但不成为可修改的 user 记录；不会因执行采用项目配置而自动写回、删除或复制项目文件。项目配置的信任与高级配置由用户沿原生可信配置路径管理。新原生项目层优先级可能使该层覆盖 user 中的同名字段，这按原生规则处理，不另造合并规则。

`homer_interactions` 是宿主保留身份。启用的文件配置层不得声明该名字来向内置连接追加环境或其他选项；原生已忽略的不可信层不会因此获得权限。启动、每次原生 turn 前和配置刷新前按对应 CWD 检查配置来源，并保持内置命令/参数/目录与准确工具目录校验。该检查只保护内部保留服务，不筛除普通项目 MCP。

固定 0.163.0 的无 threadId 状态查询刻意使用不含项目层的全局配置；不能用管理控制进程的目录查询证明项目服务不存在。项目有效配置、实际连接/工具调用及 thread/start/resume 的 CWD 已用无账号原生线程与 loopback 合成 MCP 验证，没有启动 turn 或模型。原生 thread/settings/update 后 MCP reload 仍保留初始项目配置，因此已存在历史的线程在实际 CWD 变化时先关闭并按新目录 resume，再开始下一轮；不复制配置表。turn/项目准备与配置刷新在首次 await 前取得同一个准备槽，压缩在途也参与互斥；等待原生回执期间拒绝其他 turn/压缩/刷新，异常或关闭取消准备，内部冷恢复保留该槽。后台工具未结束时拒绝切换。空线程尚无可恢复历史时明确返回 engine_project_switch_requires_history，不沿用旧项目 MCP；正常首次调用沿启动 CWD 运行不受影响。Homer start 与首次 turn 读取同一个主目录，Worker start/首次 turn 读取其运行目录；work_directory 只能从已有活动 turn 调用，接受该 turn 时已有历史标志，选择对下一轮生效。因此已核对的正常入口不会在空线程上触发跨目录错误；直接调用 Engine 在首次 turn 前改变 CWD 仍会明确失败，不制造历史。

## 保存与显示

原生 `config/batchWrite` 可校验类型及 transport，但实际探针确认它会保留并忽略未知字段。因此保存前先在临时无账号 HOME 写入待校验 MCP 配置，用固定引擎 `app-server --strict-config --stdio` 加 EOF 调用其严格配置加载；没有线程、模型请求或 MCP 连接。该进程不接收宿主账号或完整环境，敏感值不放在 argv，输出被丢弃，临时目录在结束后删除。

通过后再以原始 expectedVersion 调用正式原生 batchWrite。只编辑 `mcp_servers.<name>`，不整表覆盖其他连接或内置服务。校验失败不触及正式文件；校验期间的外部更新会由原生版本冲突拒绝，不执行宿主快照回滚来覆盖新配置。Homer 内的同时写入由同一队列串行处理。

原生落盘仍由 Codex 自身负责。未验证其他独立进程在原生“版本检查到文件写入”之间同时修改同一配置时的原子互斥；不声称新增了跨进程事务锁。连接状态、文件保存和下一轮采用分别报告；未知 I/O/RPC 结果需刷新核对，不自动重放或回滚。

state 只返回用于基本编辑的显示投影，隐藏 argv、env、headers、凭据和原生高级配置。它不是可整对象回写的配置。已有连接编辑使用 `preserveExisting:true`，由宿主合并未显示字段；patch 中 null 删除该字段。创建和完整替换省略此标志。高级环境/凭据继续在用户可信的专属原生配置路径处理，不添加普通 JSON 凭据编辑器。

普通审批卡只处理能完整、安全展示的有效 MCP 配置：基本 command/url、空 args、cwd、工具集、超时与默认审批模式逐值展示，patch 先在宿主解析为完整配置，再绑定 expectedVersion。非空 args、env、headers、凭据引用或其他隐藏高级字段（包括继承的字段）不能用 hash 代表用户已审阅；此时返回 capability_mcp_trusted_configuration_required，用户沿可信原生配置路径处理，不生成可放行的不完整审批卡。底层用户可信保存仍接受全部原生合法字段，已授权工具集收窄仍可免新审批。hash 只绑定完整性，不证明隐藏值已被阅读。

可展示操作的审批记录保存完整配置与准确 hash，实际操作留在当前授权闭包中；超时、拒绝、版本变化或本轮结束后不重建操作。敏感字段不会写入普通审批记录。catalog 保留工具目录及账号/连接状态，诊断错误仅返回固定错误码，资源 URL 和原生诊断正文不进入普通管理响应。OAuth 浏览器地址仍仅沿原有用户管理路径返回。

## 验证

- `tests/native-mcp-config.test.ts`：字段保真、全字段授权比较、patch、脱敏、OAuth 接线、保留名、保存失败与冲突。
- `scripts/native-mcp-config-acceptance.ts <固定引擎绝对路径>`：独立 HOME、无账号/模型/外部 MCP，实际严格解析与 batchWrite；验证 env/cwd/headers/凭据引用/审批模式/大超时的原始配置保真，未知和非法输入失败不污染文件，校验后版本冲突、管理队列并发冲突。测试程序 marker 确认校验未启动 MCP 程序。
- `scripts/project-mcp-runtime-acceptance.ts <固定引擎绝对路径>`：仅在明确授权隔离原生线程时运行；一次性无账号 HOME、loopback 合成 MCP，真实连接/调用、scope/disabled、未知项目信任、按 A/unknown/B 切换恢复和内部保留名防护。拦截 turn 请求，拒绝后台代理隧道，不连接外部服务；thread/delete 后确认所有测试进程退出，再移除测试 HOME，不直接改内部数据库。
- 浏览器合成验收：1470px/605px、参数不回填、编辑保存保留 env/cwd/timeouts/审批模式。采用前应重新运行维护源完整检查；本候选检查回执及限制随审阅交付。

采用以准确文件差异与 SHA 清单为单位，先核对维护源是否仍匹配基线。源码回退只撤销本候选差异，不回退用户原生配置、账号或数据库；原生配置中新增的合法字段无需迁移或清除。
