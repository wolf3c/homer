# 维护中的回归用例

开发时主动将获准、脱敏且可复现的实际使用反馈补成用例，供后续修改回归。这里只维护少量测试定义和公开 fixture，不自动采集对话、工具调用或用户文件，不向外部服务上传。

## 用例索引与来源

| 稳定 ID | 内容与定义 | 流程来源 | 输入来源 | 覆盖与入口 |
| --- | --- | --- | --- | --- |
| HMR-MEETING-001 | [CLI 交代 → 独立任务 → 查询 → 成果 → 完成后修订](meeting-revision.ts) | requirements-derived：用户已确认的 M0 需求转写 | synthetic：虚构会议、人名及日期 | T01–T05；离线 `npm run test:scenarios`，真实模型 `npm run test:real -- <专用配置>` |
| HMR-CHAT-001 | [本机订阅聊天连接](local-subscription-chat.md) | real-user-feedback：CLI 初次问候无响应、最终超时 | synthetic：离线代理与 MCP 配置；真实连接仅显式检查 | `npm test` 中 engine/proxy；真实问候手工检查 |
| HMR-PARALLEL-001 | [主 Agent 多任务派发](parallel-dispatch.md) | requirements-derived：用户明确取消单 Worker 限制 | synthetic：公开 Markdown 与脚本化离线引擎 | `npm test`；显式 `npx tsx scripts/real-parallel.ts <本机配置>` |
| HMR-CONTEXT-001 | [主对话重启延续](main-conversation-continuity.md) | requirements-derived：重启继续原主对话 | synthetic：随机暗号及本地恢复异常 | T09；真实 `npx tsx scripts/real-session-resume.ts <配置>` |
| HMR-MODEL-001 | [指定模型切换与对话延续](model-switch-continuity.md) | requirements-derived：6.1 medium 且保留原对话 | synthetic：随机暗号、公开材料和绑定配置 | T09；显式 `npx tsx scripts/real-model-switch.ts <原配置> <目标配置>` |
| HMR-INTERACTION-001 | [Worker 授权与业务提问原进程闭环](worker-interactions.md) | requirements-derived：主 Agent 自主判断、必要时升级用户 | synthetic：本地协议 fixture、公开材料、随机标题／版式 | `npm test`；显式 `npx tsx scripts/real-worker-interactions.ts <获准配置>` |
| HMR-UPGRADE-001 | [开发版安全边界自动升级](../../docs/09-development-upgrade.md) | requirements-derived：开发中自动换版，保留原主对话和任务 | synthetic：独立进程／runtime、故障候选、随机暗号 | `npm run test:development -- --test-name-pattern=HMR-UPGRADE-001`；真实模型检查另行显式执行 |
| HMR-PROMPTS-001 | [提示词文件与原线程恢复](prompt-resources.md) | requirements-derived：提示词独立文件，方便后续受控维护 | synthetic：临时包资源、随机版本标识／暗号 | `npm test`；显式 `npx tsx scripts/real-prompt-reload.ts <获准配置>` |

当前 **1 个 real-user-feedback 用例**（HMR-CHAT-001）。会议流程是需求推导，会议文本是合成样例；开发期间的真实 Codex 检查也不会把它变成真实用户案例。

来源固定使用三种标记：

- `real-user-feedback`：用户实际使用中报告的问题或行为。记录脱敏背景、已有问题 ID 和内容使用授权范围，移除身份及原始私密内容。
- `requirements-derived`：从已确认需求推导的可观察流程，引用需求编号，不能当作用户已经实际执行过。
- `synthetic`：开发者构造的边界、故障或示例。流程来源和 fixture 来源分别标注，允许“需求推导流程 + 合成输入”。

## HMR-MEMORY 如何运行

记忆系统为 requirements-derived，输入全部 synthetic。`tests/memory.test.ts`、`memory-service.test.ts`、`memory-migration.test.mjs` 随 `npm run check` 覆盖来源/幂等/CAS/遗忘/epoch、同线程重启、Worker scope 与验收候选、排队修订撤回及迁移失败阻断。实际结果与未完成真实模型验收见 [记忆验收](../../docs/14-memory-system-validation.md)。独立 workspace/runtime 不能隔离 CODEX_HOME 会话；当前禁止向共享日常列表继续创建测试线程。

三类入口与按变更/发版选择规则见[测试边界](../../docs/testing.md)。默认核心通过不代替任何显式专项；未运行、跳过和失败均不能记录为验收通过。

## HMR-UPGRADE-001 如何运行

开发版换版用例 **HMR-UPGRADE-001**：requirements-derived，输入 synthetic。定义与限制见 [开发版自动升级](../../docs/09-development-upgrade.md)；`npm run test:development -- --test-name-pattern=HMR-UPGRADE-001` 实际启动独立合成 runtime 和子进程，核验忙碌任务不被中断、同线程换版、输入交接与失败回退；`node scripts/real-dev-upgrade.mjs <获准配置>` 才运行两轮真实模型回忆检查，不记录用户案例或默认保存正文。

## HMR-MEETING-001 如何运行

完整初始条件、逐条消息、操作顺序、预期、禁止行为、清理及重跑方式在 [用例定义](meeting-revision.ts) 中。消息由离线和真实入口共同引用，避免描述与脚本分叉。输入为 [meeting-notes.md](../fixtures/meeting-notes.md)，没有真实客户资料。

先问答记住一个代号，再交代文件工作；等 Worker running 时查进度；等实际成果通过审阅及交付后，用原 matterId 要求按负责人修订；核对同 Matter 新 Run、新 Worker、新文件和原文件哈希。固定事实包括未知负责人／时间、讨论和暂缓边界。

```sh
# 确定性回归：不启动 Codex，不调用模型，不读取生产连接，模型费用为 0
npm run test:scenarios

# 构建、类型与默认核心回归；不包含显式专项
npm run check

# 显式真实模型回归：需要已授权连接，可能产生模型费用
npm run build
npm run test:real -- .codex/scratch/your-scenario.config.json
```

离线入口包括来源检查、固定事实／分组断言的正反例和完整宿主流程。Fake 的自然语言响应、工具选择和文档均为脚本化合成结果，只验证调度、持久状态、成果边界及修订契约，不能证明模型理解或内容质量。默认核心的 transport fixture 仅模拟协议；显式引擎专项会启动实际 Codex，账号联调另有网站/网关前提，不能把“合成输入”当成“不执行外部工具”。

真实入口启动产品 CLI、真实主 Agent 和独立 Worker；只有实际调用且所有断言通过，才记真实通过。实测环境为 macOS arm64、Node 22.22.0、Codex 0.154.0、gpt-6.1-sol。其他模型／版本需重新标注环境并执行，不能继承通过结论。真实运行记录各线程可得 tokenUsage；金额未知，不标为免费，也没有精确金额硬限额。当前实际结果在 [M0 验证记录](../../docs/07-m0-validation.md)，不是从离线结果推断。

真实配置的 workspace 必须位于项目 `.codex/scratch/` 下的专用新目录，runtime 选择 `.codex/private/` 下的新目录，不用日常数据。正常 EOF 等完成及交付后退出；若中断，先确认本次进程退出、锁释放，再仅清理本次 workspace/runtime。失败元数据先保留调查，每次重跑换新目录；不会自动清空旧工作区或覆盖原成果。

结果元数据写到 `.codex/scratch/scenario-regressions/HMR-MEETING-001/core-checks.json`：包括稳定 ID、两类来源、实际环境、分项结果、范围内成果路径及哈希、用量和资源。失败仅写步骤及稳定错误分类，不保存会回显正文的断言异常。默认不保存模型回执或原始对话，控制台只输出事件类型和 Run ID。仅为当前公开合成样例调查时，可显式添加 `--save-public-transcript`；它不是收集真实用户内容的授权。Codex 自身仍会按引擎机制保存线程历史，真实回归不得放入未授权内容。

断言关注状态、独立线程、真实路径、文件保留、固定任务事实和修订分组，不用整篇逐字快照。Markdown 固定事实检查是此样例的有限校验，内容还须经过产品主 Agent 对源文的审阅，不宣称能自动证明任意文档正确。

## 后续开发中补充真实反馈

在处理实际反馈时，先找到已有问题 ID；沿用该 ID 关联新增或扩展的用例，不因重复反馈另造问题。每个用例分配不改名、不复用的稳定场景 ID，并在本索引登记。若尚无问题 ID，先用本地维护的非敏感问题标识关联，不自动创建外部工单。

每例至少保留以下信息，可沿用当前 TypeScript 数据定义，无需建设通用测试平台：

1. ID、标题、来源类型、脱敏背景、需求引用或问题 ID；真实内容使用授权范围。
2. 初始状态、独立目录、必要 fixture 及其来源；只保存获准且脱敏后的最小复现材料。
3. 按顺序的消息和操作、等待条件、动态 ID 如何填入。
4. 可观察的状态／结构／任务语义预期、禁止行为；避免限定非必要措辞和排版。
5. 清理与重复执行方式、离线／模型入口、实际环境、费用边界，以及可核实的检查结果。

遇到可稳定复现的行为缺陷，先用同一问题 ID 加失败用例，再修复并使其通过；无法安全或稳定自动重现时，写清限制和最接近的行为检查。普通测试只用本地 Fake、fixture 和 mock；真实模型调用必须留在显式入口。未实际执行标“未运行”，失败标“失败”，不把模拟结果标为真实通过。

不要默认持久化原始聊天、工具参数／结果、用户附件、凭据或敏感 URL。需要实际内容时先取得授权并脱敏；授权不足就改用最小合成复现，并如实标 `synthetic`。不自动扫描 Codex 历史、生产数据库或用户文件来“收集案例”。

## HMR-RECURSIVE / HMR-QUEUE 如何运行

流程为 requirements-derived，所有输入 synthetic。`tests/recursive-*.test.ts` 覆盖 HMR-RECURSIVE-001..013、两个文档完整状态案例，以及 HMR-QUEUE 的 FIFO、CAS、引用批注、丢回执、准确 generation、重启未知状态和记忆来源。`recursive-host.test.ts` 使用实际 Homer 服务及合成 Agent，不能当作真实模型。默认 Web/TG/微信检查验证 publication 与原线程契约；完整宿主升级兼容另由 development 专项覆盖。

`npm run check` 不调用真实模型；可打开的 4788 隔离入口、605px/桌面浏览器结果、迁移预览及未通过真实模型门槛见[递归验收](../../docs/15-recursive-agent-validation.md)。不得运行共享 CODEX_HOME 的真实递归探针；独立 runtime/workspace 不能代替会话持久化隔离。
