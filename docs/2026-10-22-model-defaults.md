# Homer 统一模型默认值

> 历史记录：2026-10-22 候选随后曾用于本地运行版本；下文具体模型及发布状态不代表当前配置。当前行为以源码及现行配置为准。

2026-10-23 维护补充：用户最新要求将主 Agent、Worker 及递归子 Worker 默认思考深度统一为 `high`，模型与 Fast 保持。本页以下内容保留 2026-10-22 的 medium 候选、提交与实际发布证据，不表示最新 high 已上线；最新变更和采用边界见[高思考深度候选](2026-10-23-effort-high.md)。

2026-10-22，Asia/Shanghai。维护目录和 Cindy 登记目录均为 `/Users/wolf3c/Project/homer`，未创建 worktree 或分支。**源码候选完成，尚未发布至日常 Homer。** 用户随后授权 Git commit，并明确同意将尚未提交的必要 Fast 支撑一并提取；提交排除其他并行改动。

用户要求主 Agent、Worker 和 Homer 子 Worker 默认均为 `gpt-6.1-sol / medium / Fast=true`，覆盖此前 high 和 Worker Fast 关闭的偏好。仅修改 Homer；未修改 Cindy、CTO 或其他任务的运行设置。

## 准确变更

| 文件 | 本次变化 |
| --- | --- |
| `src/model-config.ts` | `effort: high → medium`、`workerFast: false → true`；model 保持 gpt-6.1-sol，main fast 保持 true |
| `tests/model-config.test.ts` | 默认断言改为 medium、两角色 Fast；保留显式 model/effort/Fast、环境优先级、新建/恢复及拒绝不支持 Fast 的检查 |
| `tests/worker-default-fast.test.ts` | 验证主/Worker 新建与恢复、普通及递归子 Worker 的默认 medium/Fast，核对实际协议及模型状态一致 |
| `docs/06-running-homer.md` | 更新现行默认、覆盖规则和采用范围；保留标有日期的历史证据 |
| 本文 | 维护交接与验证记录 |

最初默认值调整无需修改工作树里的 `config.ts`、`service.ts`、`engine.ts`：配置 owner 已统一从 `PRODUCT_MODEL_DEFAULTS` 读取；主及各级 Homer Worker 共用 `Homer.engine()` 和同一 Config，Worker 创建入口统一指定 `role: "worker"`，没有按层级保留 high/slow 的分支。首次初始化仍经过普通主轮入口，不另设模型。`model/list` 入口只读展示配置，不提供写入模型/effort/Fast 的热更新接口；原生工具配置写入入口不拥有这三项 Homer 参数。

Git 提交补充：HEAD 尚无 Fast 支撑；按用户追加授权，提交同时提取 `config.ts` 的 Fast 布尔解析/环境覆盖、`engine.ts` 的角色及档位传递/支持校验、`service.ts` 的 Worker 角色与状态投影、`cli.ts` 的 Fast 启动提示、`tests/fixtures/model-settings-app-server.mjs` 协议 fixture。只提取这些必要内容，不提交混在同文件中的超时、记忆、接待恢复或过程 UI 改动。测试 fixture 显式提供旧 HEAD 仍要求的时间配置，以便单独验证该提交，不夹带时限合同变化。

优先级保持 `HOMER_* → 本机配置 → 产品默认`。Config 的 fast 未设置状态仍保留；执行和状态投影共同调用 `effectiveFast()`。已有显式 high、false 或其他模型不会被迁移/强制锁定；每次执行传递的是解析后的配置。

日常准确配置 `.codex/private/local-chatgpt.config.json` 白名单核对：model=gpt-6.1-sol，effort/fast 未设置；准确 launcher `88856` 和 host `89534` 均无 HOMER_MODEL/HOMER_EFFORT/HOMER_FAST 环境覆盖。因此该实例采用新源码后自然得到全部目标值，**无需改写任何持久配置**。未复制配置、账号或原生 HOME。

## 生效范围

以下为本次只读核对时的运行事实，PID 与版本供交接定位，不作为后续发布时可直接复用的进程授权。

| 角色 | 当前冻结版本及其下一轮/新执行 | 采用本候选后的执行 |
| --- | --- | --- |
| 主 Agent | gpt-6.1-sol / high / Fast=true；现有模型入口已实读确认 | 恢复原主线程后，每轮 medium / Fast=true |
| 普通 Worker | 冻结代码默认 high / Fast=false；未触发真实 Worker 来验收 | 新建 Worker medium / Fast=true |
| Homer 子 Worker | 同一 Worker 入口，冻结代码默认 high / Fast=false | 新建子 Worker medium / Fast=true，合成宿主已验证两级 |
| 已执行或正在执行的任务 | 不修改记录、身份或执行参数，不打断、不重放 | 既有记录保持；后续获准的新执行读取采用后的配置 |

实际 launcher 从 `.codex/private/release-inputs/4d2b46cb2c5120545d9d24501a270b8abd329c51e205c767d85afe630172138d/scripts/dev.mjs` 启动，host 位于原 runtime 的 `trusted-builds/4d2b46cb2c51-6f048da2-b2a0-4c04-9628-ac06ec017435/`。这与 maintree 不同，修改 maintree 不会热改该冻结输入。未修改任何密封版本。

## 验证

- 红灯：先更新契约断言，`tests/model-config.test.ts` 30 项中 18 项因旧 high/Worker Fast=false 失败，12 项原有显式覆盖等检查通过。
- 绿灯：`node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/model-config.test.ts tests/worker-default-fast.test.ts`，76/76 通过，0 失败。全部为合成 engine/配置、本地 socket，不访问真实模型或账号。
- 测试不仅检查 fast 字段：实际 fixture 接收 `thread/start`、`thread/resume` 和连续两次 `turn/start`，断言 `serviceTier: "priority"`、model=gpt-6.1-sol、effort=medium；显式 false 时仍传 null。原生目录明确排除 Fast 时仍报 `engine_fast_unavailable`，不会静默降级。
- 主、Worker 的 legacy/native 两种现有分支均覆盖；真实 Homer 委派入口创建普通 Worker 和子 Worker，读取其绑定模型端点，并以捕获的执行 options 验证实际协议。
- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` 通过；受影响源码及两份测试的定向 TypeScript 检查也通过，退出码 0、日志为空。
- Git 提交前另从准确 HEAD 导出独立源码副本，加入仅本次拟提交内容：76/76 参数测试、8/8 原有 engine 回归测试，以及源码/定向测试类型检查全部通过。副本在原任务 scratch 的 `commit/snapshot/`，不属于 Git worktree；未依赖其他 dirty 源码。对应日志为 `commit/commit-tests.tap`、`commit/engine-tests.tap`。
- 日常 `/api/capabilities` 的只读 models 操作确认当前实际配置仍是 gpt-6.1-sol/high/Fast=true，且实际模型目录列有 medium。此操作不提交模型轮次；公开目录投影不含服务档位，尚未用真实调用验证服务端采用 Fast、账号额度或速度。

证据在 `.codex/scratch/homer-model-defaults-20261022/`：准确源码前像及 SHA、红绿 TAP、定向类型检查日志、本次增量补丁。没有保存真实聊天或凭据。源码增量只涉及默认 owner 的两个字段，不涉及主工具定义、指纹算法、权限/审批、线程恢复或记忆路径。未写日常业务库、线程 ID、HOME 或历史任务。

## 交 CTO 的最小采用步骤

1. 将默认值增量及追加授权的必要 Fast 支撑纳入正在进行的发布候选（Git 提交共十路径）；先核对前像漂移，尤其 `docs/06-running-homer.md` 和两份已有 dirty 测试，勿用工作树相对 HEAD 的完整 diff 覆盖并行工作。
2. 沿现有可信构建/发布流程构建并采用包含新 `src/model-config.ts` 的完整冻结版本；保持原配置、runtime、原线程和专属 HOME。当前准确配置无需额外修改。等待安全空闲后经正常 launcher 生命周期采用，不强杀、不清锁、不热改 Worker。
3. 采用后通过原 models 入口核对配置为 gpt-6.1-sol/medium/Fast=true，并核新密封的 workerFast=true。无需另发真实模型或性能测试来完成此次配置交付；若后续真实执行返回 Fast 权限错误，应明确报告该错误。

本任务不自行构建上线或重启日常服务，以免与独立发布争用。回退应在下一次安全采用时仅撤回本次默认增量及对应文档；保留上线后新增事实和他人改动，不能旧库覆盖。
