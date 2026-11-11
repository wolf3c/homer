# 运行 Homer

2026-11-05 会话架构实施：当前维护源码以[任务管理表与 Worker 会话](architecture/main-worker-chat-architecture.md)为准，验证状态见[实施记录](superpowers/plans/2026-11-05-worker-chat-architecture.md)。本页保留的 M0 合同、候选验收、单文件输出及旧库升级描述属于历史版本，不能用于新链路；新 schema 不迁移旧库，也未替换日常实例。

2026-11-04 核对：本页日期段落保留当时采用状态，不能据此判断当前日常进程或安装包。当前模型配置以 `src/config.ts` / `src/model-config.ts` 为准，原生记忆、RPC 和 MCP 分别见[记忆](26-native-memory-feasibility.md)、[RPC](38-native-rpc-lifecycle.md)、[MCP](native-mcp-config-management.md)；维护检查按[测试边界](testing.md)执行。

2026-11-03 桌面双来源的 ChatGPT 登录（`desktopModelSource: "codex"`）固定使用 `gpt-6.1-terra`：主 Agent 为 `high / Fast 开启`，Homer Worker 为 `xhigh / Fast 关闭`。统一由 `src/config.ts` 的 `effectiveModelConfig()` 解析；荷马来源和下述通用产品默认值保持原行为。本次仅更新维护源码，未安装、发布或调用真实模型。

2026-10-27 候选：仅主 Agent 默认思考深度改为 `medium`，Homer Worker 默认保持 `high`，各角色模型 `gpt-6.1-sol` 与 Fast 开启保持。显式配置优先级不变；尚未发布或重启。范围、验证与基线边界见[主 Agent medium 候选](2026-10-27-main-effort-medium.md)。

2026-10-25 维护源码：Homer 只管理主 Agent 与一级业务 Worker；内部拆分交固定 Codex 原生协作，同级通信和能力管理保留。业务旧树不自动迁移或清理，未安装或发布。架构与真实 smoke 认证阻塞见[当前架构](12-recursive-agent-architecture.md)及[验收记录](15-recursive-agent-validation.md)。下文早期“递归子 Worker”描述属于历史版本。

2026-10-23：维护源码的主 Agent、Worker 及递归子 Worker 默认思考深度统一改为 `high`，模型仍为 `gpt-6.1-sol`，Fast 仍为 true。本次未发布或重启；只读核对的日常冻结版本 `95ec060eed2f…` 仍使用 `medium`，后续轮次也不会因修改维护源码自动改变。准确增量、验证及采用边界见[高思考深度候选](2026-10-23-effort-high.md)。

2026-10-20：[执行时限与故障恢复](38-native-timeout-recovery.md)已整合到维护源码：移除宿主整轮预算并补充同 thread 接待恢复。日常服务尚未采用。

2026-10-19：执行/原生记忆调整仍为隔离候选，尚未采用；当前接线、启动入口与旧 thread 限制见[执行架构候选](34-flexible-execution-candidate.md)。以下保留既有运行与历史记录。

适用版本：Homer M0 0.1.0，2026-10-16。先看 [验证范围](07-m0-validation.md)。

## 环境与安装

已验证 macOS arm64、Node 22.22.0、npm 10.9.4；早期验收使用 Codex CLI 0.154.0。指定 gpt-6.1-sol 的本机订阅入口现固定使用项目内 Codex 0.163.0，见下文。Node 的内置 SQLite 在此版本仍标为 experimental，启动命令只隐藏该警告。当前实现依赖 macOS 的进程身份和进程组检查；Linux、Windows 未验收。

```sh
npm ci
npm run build
npm run check
```

根目录及 UI 均有锁定的运行依赖；依赖与 Node 要求以 package.json 和锁文件为准。TypeScript、tsx、Node 类型为开发依赖。构建产生 dist/；源码在 src/。不自动安装或升级 Codex，也不创建 Git 仓库。

## 连接和配置

源码 CLI 使用获准的 Codex 连接。正式桌面 App 可在应用内选择登录和模型来源。业务运行使用 Homer 专属的 Codex 目录，默认是 `<appData>/codex`。原生能力配置见[原生能力说明](22-mcp-skill-configuration-design.md)。

```sh
npm start -- --config examples/homer.config.json
```

配置中的 workspace/runtime 相对目录以配置文件所在目录为基准；appData/nativeCodexHome/codexHome 显式相对值按启动目录解析。不带 `--config` 时以启动目录为基准。`examples/homer.config.json` 指向本项目 `.codex/private/`。该目录已列入 .gitignore，存放数据库、锁及用户工作文件；不要将它作为源码提交或分享。

2026-10-23 起，示例不再显式指定旧的 `effort: "medium"`，沿用统一产品默认 `high`。

| 字段 | 含义 |
| --- | --- |
| appData | 新应用数据根；macOS 默认 `~/Library/Application Support/Homer`，其他平台 `~/.local/share/Homer`；更新保留 |
| nativeCodexHome | Homer 专属原生配置/Skill/MCP/会话目录，默认 `<appData>/codex` |
| workspace | 用户明确准备的工作区，默认 `<appData>/workspace`。普通文件按路径提供 |
| runtime | 默认 `<appData>/runtime`；业务数据库、CLI 独占锁和主线程空工作目录；不能与 workspace 重叠 |
| model | 通用产品默认 gpt-6.1-sol；桌面来源按 effectiveModelConfig 分角色解析 |
| effort | 通用默认 Main 为 medium、Worker 为 high；显式值共用。桌面 ChatGPT 分支按上方独立组合解析 |
| fast | 显式设置由主 Agent 与 Worker 共用；未设置时主 Agent、普通及递归 Worker 默认均为 true |
| codexBin | 可选，Codex 可执行文件；默认从 PATH 查找后解析真实路径 |
| codexHome | 默认 `nativeCodexHome`，业务执行要求两者指向同一目录 |
| baseUrl | 可选，用户明确指定的 Responses 供应连接；不含密钥或 URL 查询参数 |
| keyEnv | 可选，提供该连接 API key 的环境变量名；配置只写名字，不写值 |
| requiresOpenaiAuth | 无 keyEnv 时是否使用现有 Codex 鉴权，默认 true |
| stopGraceMs | 停止请求及进程退出的有限等待，默认 3000 ms |
| executionLimits | 可选估算费用/连续压缩保护，见[执行保护说明](38-native-timeout-recovery.md)；不是供应商费用硬上限 |

环境变量 `HOMER_DATA_HOME`、`HOMER_NATIVE_CODEX_HOME`、`HOMER_MODEL`、`HOMER_EFFORT`、`HOMER_CODEX_BIN`、`HOMER_CODEX_HOME`、`HOMER_CODEX_BASE_URL`、`HOMER_CODEX_KEY_ENV` 可以覆盖对应字段。凭据只通过现有 Codex 鉴权或指定环境变量交给官方引擎，不进入示例配置、SQLite 事件或 stdout 诊断。

运行目录绑定工作区、Codex Home 和供应商配置。模型与 effort 可在同一边界内切换，并恢复原主线程。核心架构切换使用独立的 schema 6 运行目录。旧版数据库由与其匹配的旧版本继续使用。

## 对话与产物

启动后每行一条自然语言消息，主 Agent 串行接待，Worker 独立运行。可连续输入，不需要等待文件生成。

```text
请把 meeting-notes.md 整理成行动清单，写入 Markdown，保留未明确负责人或时间的待确认项。
现在做到哪一步了？请查实际状态。
完成后请按负责人分组，未确认的单独列出，保留原文件。
```

主 Agent 用任务表记录当前目标、笔记和办理结果，一项任务可打开多个 Worker 会话，并在原会话追问。普通补充排队进入后续轮次；要求或授权变化先停止并确认受影响的执行，再按新版办理。`queued` 表示尚未领取。模糊指代需要澄清，必要时引用任务 ID。普通回复自动回传原文；明确采纳的文件封存在 `workspace/outputs/<taskId>/<runId>/`，正式发布后可下载。

仅放入你明确授权用于本任务的 Markdown。默认每份输入／输出不超过 128 KiB；输入为普通单链接文件，拒绝符号链接和越界路径。当前 materials 列表显示顶层 `.md` 文件；不提供任意文件浏览器。

单次输入、脚本和结构化输出：

```sh
npm start -- --config examples/homer.config.json --message '列出尚未完成的事项'
npm start -- --config examples/homer.config.json --json --request-id meeting-request-1 --message '请整理 meeting-notes.md 为 Markdown 行动清单'
```

同一 request-id 和相同消息重复提交标明历史回执并附当前执行状态，不重复派发；不同正文复用 ID 拒绝。崩溃中的 request-id 不自动重放，查询状态后明确使用新消息重试。自然语言的无 ID 输入每次都是新请求。

`--json` 每行输出一个完整事件。终端显示文字回复，文件可用工作区路径交接。消息附件在桌面、Web 或匹配版本的移动 App 中读取。`/status` 直接显示宿主记录。`/quit`、Ctrl-C 或 SIGTERM 请求停止工作并退出。标准输入 EOF 和 `--message` 会等待已交办的工作，遇到待用户回复的事项时提示并停止。需要当场补答时使用持续逐行输入模式。

## 停止、故障与重启

日常开发可用 `npm run dev -- --config .codex/private/local-chatgpt.config.json` 保持终端入口，在安全空闲边界自动构建换版并恢复原主对话；现有 `npm start` 仍为单进程入口。忙碌 Worker、待答和交付不被升级中止。兼容阻断、回退及边界见 [开发版自动升级](09-development-upgrade.md)。

- 自然语言指定停止事项，或退出 CLI，先保存停止请求并禁止后续写文件工具，再请求 Codex 中断及停止所属进程组。只有确认退出后才 cancelled；无法确认是 interrupted。历史 failed/timeout 原样保留，候选不再新增整轮预算超时。
- 成果须经过范围／存在／普通文件／非空校验，再由主 Agent 读取原文和实际 Markdown 做内容审阅。未通过不报 succeeded。引擎完成但未写文件报告 artifact_missing，不用预写结果补齐。
- 主 Agent 的派发回复若已落后于终止事实，会附宿主读取的当前执行记录。普通错误只输出稳定错误码，如 engine_authentication_failed、engine_rpc_failed、material_missing、artifact_missing、content_rejected；不回显供应商响应体、凭据、工具参数或完整 URL。候选中，确认结束的普通主轮失败保留 failed 并继续接待；进程确需重建时只在旧进程已确认停止、原生后台活动已解决后，为下一请求恢复原 thread、账号边界、当前工作目录和最新附加指令。未确认状态阻止替代执行，不重试失败请求。详见[执行时限与恢复候选](38-native-timeout-recovery.md)。
- 异常关闭后再启动同一配置：检查原引擎进程身份、停止残留，将 queued/running/awaiting_review 标记 interrupted；不自动重新派发或精确续跑。完成记录保留，主线程通过 thread/resume 继续。明确提出重试才新建 Run。
- 结果先落库再回传，stdout 确认写入后才记 delivered。写入与记账之间崩溃可能重复显示；delivered 只代表本机输出回执，不代表人已阅读。待回传记录在重启后补投递。

## 安全边界

模型只能调用宿主白名单工具。Worker 输入绑定唯一材料，输出只创建当前 Run 的新 `.md` 文件，不能覆盖历史。主 Agent 无写成果工具，Worker 无派发工具。

此外，Codex 命名权限 profile 用操作系统拒绝其他文件读写和命令网络；只允许必要运行文件、本线程空目录的读取。shell、独立代码模式、插件、应用、浏览器、图像、hooks 和原生子 Agent 关闭；官方 code_mode_host 仅承载获准工具，Worker 原生权限请求交主 Agent 判断，宿主仍仅接受本 Run 目录内的读取子集，不开放命令、写入或网络。即使提示词被材料干扰，也不会得到任意路径或操作能力。详见 [技术方案](03-technical-design.md#11-m0-实现收缩方案)。

较长材料还可能受 Codex 的工具输出截断和模型上下文限制影响；宿主的 128 KiB 上限不保证模型看见全部内容。本次长样例的不完整成果被内容审阅拒绝，未假报完成；分段读取留待后续。

边界针对模型动作，不是对恶意的同一 macOS 用户、被篡改的 Codex 二进制或宿主 Node 程序的防护。合法模型连接本身需要联网；本地沙箱关闭的是执行工具网络。当前不支持文件删除、任意代码执行、真实敏感账号操作或跨进程审批恢复；原进程内待答／继续见下节。

## 可重复验证

自动化检查不调用模型：

```sh
npm run check
npm run test:scenarios
npm audit
```

真实检查调用 Codex 和模型，使用新建的专用 scratch 工作区及独立 runtime。先在 `.codex/scratch/` 创建配置，将 workspace 指到该目录下的新测试文件夹、runtime 指到 `.codex/private/` 下的新运行文件夹，并填入当前已授权的连接。勿使用日常工作区运行测试脚本。

```sh
npm run build
npm run test:real -- .codex/scratch/your-core.config.json
npx tsx scripts/real-controls.ts .codex/scratch/your-controls.config.json
npx tsx scripts/real-routing.ts .codex/scratch/your-routing.config.json
npx tsx scripts/real-main-failure.ts .codex/scratch/your-main-failure.config.json
```

核心检查通过实际 CLI 标准输入发送多轮问答、派发、进度查询和修订；控制检查启动真实 CLI，安全中断长样例、SIGKILL 后重启对账，并直接运行 Codex 沙箱核对 OS 拒绝。各配置应使用不同的新 runtime。路由检查另验证自然语言澄清、仅停止指定事项、缺失输入以及重复请求。主引擎故障检查主动终止本测试自己的主引擎，核对 Worker 原文仍持久保存且没有编造文件；普通答复不要求生成正式交付。已有历史验证记录不代表新会话链路已通过，须以本次实际执行结果为准。

维护中的 [回归用例索引](../tests/scenarios/README.md) 记录稳定 ID、来源和复现方法。HMR-MEETING-001 将用户确认的 CLI 交代 → 独立任务 → 查询 → 成果 → 完成后修订转为需求推导用例，输入为合成会议；最新用例数量与来源见索引。`test:scenarios` 是不消耗模型的确定性检查；`test:real` 才运行相同消息的真实模型回归，可能产生费用，金额未知，只记录可得用量。

核心回归结果写到 `.codex/scratch/scenario-regressions/HMR-MEETING-001/core-checks.json`，包括来源、环境／模型／版本、结果和资源／用量；验收脚本默认不保存对话或模型回执，失败只记录步骤／稳定分类。调查公开合成样例时，核心和排队脚本可显式加 `--save-public-transcript`。脚本均限定公开合成样例，不得用于真实用户资料。后续实际反馈要先授权和脱敏，沿用问题 ID 补最小复现，行为修复采用适用的 red-green；不自动采集、复制用户文件或上传外部服务。

后续已实现的本地浏览器对话入口与共享稳定宿主见 [Web 界面](10-web-interface.md)；IM 接入按各自渠道文档验收。Office 自动化、浏览器执行工具、插件市场、多引擎、商业售卖鉴权及精确金额硬限额仍不在当前范围。

## 本机 ChatGPT 订阅试用（连接修复后）

本机已验证配置为 `.codex/private/local-chatgpt.config.json`，直接运行：

```sh
npm start -- --config .codex/private/local-chatgpt.config.json
```

使用本机默认 Codex 登录，不复制凭据；不使用此前已失效的临时开发代理。2026-10-16 已复现版本差异：Homebrew Codex 0.154.0 未列出且拒绝 gpt-6.1-sol，而 App 自带 0.163.0-alpha.10.2 在同一订阅下成功调用该模型及工具。故旧结果只适用于旧引擎，不能据此判断订阅无权限。

历史旧绑定仍禁用继承 MCP 并保留自有交互目录；新专属目录候选只允许已批准、满足配置边界的原生 MCP，Worker仍不继承。两者均核验有效配置，不改全局设置。最新目录见[原生能力说明](22-mcp-skill-configuration-design.md)。传输继承 HTTP/HTTPS/ALL_PROXY 等代理变量，未设置时在 macOS 读取已有 HTTP/HTTPS 系统代理；不改变系统代理，亦不开放 Worker 命令网络。仅引擎“已启动”不代表模型可用，应以实际回复及工具执行确认。本轮指定模型的同线程恢复、合成暗号回忆和真实 list_work 查询已通过；Worker 文件验收详见验证记录。

项目内稳定引擎固定为官方 `@openai/codex@0.163.0`，不升级系统 Codex。需要重新安装时执行：

```sh
npm install --prefix .codex/private/engines/codex-0.163.0 --no-audit --no-fund --save-exact @openai/codex@0.163.0
```

下载使用用户既有网络／代理设置。本机 arm64 配置的 `codexBin` 指向该目录下 `node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex` 的绝对路径，保留同目录的 code-mode host。日常配置明确设置 `model: "gpt-6.1-sol"`、`effort: "medium"`，继续使用原 workspace、runtime 和 `/Users/wolf3c/.codex`；账号凭据留在原位置。项目内安装及数据库备份位于已忽略的 private 目录。

旧绑定迁移仅改变两项 meta（binding、bindingVersion），不改变 mainThread、工具指纹、事项、请求或成果。迁移及配置切换前先确认用户工作已完成、备份数据库与旧配置。若失败，停止本次 Homer 后恢复这对备份及原引擎配置；不能只回退一个文件，也不能覆盖用户在切换后新增的数据。未完成的 Worker 不通过此次迁移继续执行。

## 并行版本更新

当前会话架构由主 Agent 决定并行数量和续谈时机，每个 Run 单独跟踪执行归属与停止确认；Worker 回复不自动结案。正常退出和崩溃恢复保留任务、原文及操作回执，已知或未知外发不自动重放。宿主不设置累计整轮时限，相关独立等待边界见[执行时限与故障恢复](38-native-timeout-recovery.md)。实现和验证状态见[会话架构实施计划](superpowers/plans/2026-11-05-worker-chat-architecture.md)，不能用历史 M0 验收替代当前链路验证。

本机订阅文件任务已通过显式真实并行验收，见验证记录；不再仅有问候验证。保留官方 code_mode_host 执行工具，不开放其他工具。主会话现在禁止静默重建，恢复及升级规则见下节。

## 模型与推理强度

产品模型默认值统一维护在内部文件 `src/model-config.ts` 的 `PRODUCT_MODEL_DEFAULTS`：`model`、`effort`、`workerEffort`、`fast`、`workerFast`、`baseUrl`、`keyEnv`、`requiresOpenaiAuth`。其中 `effort`、`fast` 是主 Agent 默认值，`workerEffort`、`workerFast` 是 Homer Worker 角色默认值（内部常量，不是本机配置字段）。主 Agent、Worker、启动提示与模型状态读取同一来源，不提供对外编辑接口。优先级为对应的 `HOMER_*` 环境变量 → 本机配置文件 → 产品默认值；`requiresOpenaiAuth` 沿用本机配置 → 产品默认值。

默认不填写 API 地址和密钥引用，使用现有 Codex 登录；使用 API 时只配置连接地址及 `keyEnv` 环境变量名，实际 key 仍留在私有环境中，不写入源码或配置文档。维护产品默认值后须按既有安全空闲更新流程采用，不在执行中的 Worker 上切换模型。

配置字段 `model` 和 `effort` 分别选择模型和推理强度；环境变量 `HOMER_MODEL`、`HOMER_EFFORT` 可覆盖。未设置 effort 时，主 Agent 使用产品默认 medium，Homer Worker 使用 high；未指定角色视为主 Agent。支持 low、medium、high、xhigh、max、ultra，具体组合仍由模型服务决定是否支持。配置加载保留 effort 未设置的状态；执行、模型状态和启动提示通过 `effectiveEffort()` 解析角色默认，每轮显式传递。显式 effort 仍同时覆盖主 Agent 和 Worker，不增加按层级配置或热更新接口。

`fast` 独立于模型与推理强度；主 Agent 缺省使用 `gpt-6.1-sol / medium / Fast`，Homer Worker 使用 `gpt-6.1-sol / high / Fast`（2026-10-27 仅调整主 Agent 思考深度）。配置加载仍保留 Fast 未设置的状态，由执行角色解析产品默认，两种角色现在均为 true。`HOMER_FAST=true` 或 `HOMER_FAST=false` 覆盖本机布尔字段 `fast`，仅接受这两个小写字符串；不接受空值、0/1 或字符串形式的本机布尔值。显式模型、effort、Fast 覆盖继续有效；已有显式 false 不会被产品默认改写。显式 true／false 同时覆盖主 Agent 和 Worker；需要两者均关闭时可在本机配置设置 `"fast": false`，并核对环境没有 `HOMER_FAST=true`。采用角色产品默认时保持 `effort`、`fast` 及对应环境覆盖未设置即可。

固定 Codex 0.163.0 的本地生成协议使用 `serviceTier`；同一二进制内置模型目录将 `gpt-6.1-sol` 的 `priority` 档标为 Fast。Homer 在 `thread/start`、`thread/resume` 和每次 `turn/start` 显式传递 `serviceTier: "priority"`，关闭时传 `null` 清除继承档位；每轮重新指定，覆盖线程设置的旧值，无需额外调用 `thread/settings/update`，也不使用只影响单轮的 `serviceTierForTurn`。不写 Codex 全局或专属 HOME 的 `service_tier`，不热改当前执行轮次。本次只调整 Homer 创建的 Worker 执行角色，不单独指定或改写 Codex 原生子 Agent 的模型／Fast 继承合同。原生目录若明确不支持请求档位，启动报 `engine_fast_unavailable`；未报告目录支持、第三方供应连接、费用／账号权限及服务端实际采用仍需真实调用确认。`models.configured.fast` 表示当前调用方的有效请求配置：主 Agent 和 Web/user 使用主角色，普通及递归 Worker 使用当前 Worker 角色；宿主状态投影与引擎启动共用 `model-config.ts` 的 `effectiveFast()` 解析。启动行的“Fast 请求”和模型状态的 `configured.fast` 不证明已加速、具体速度或费用。

修改产品默认只产生候选版本，须由既有安全空闲更新流程采用；采用后恢复原主线程、后续主轮及新建 Homer Worker 按角色使用默认值；本基线不开放 Worker 自行递归委派，也不改变 Codex 原生子 Agent 的继承合同。现有冻结版本的下一轮仍使用旧配置，现有运行中的 Worker 不变。回退可在下一次安全采用时恢复原候选版本，或显式设置所需 effort／Fast；不改变账号和线程身份。最新候选与未上线边界见[2026-10-27 主 Agent medium 候选](2026-10-27-main-effort-medium.md)；此前 high 候选记录见[2026-10-23 候选](2026-10-23-effort-high.md)；2026-10-22 的 medium 上线记录保留在[统一模型默认值交接](2026-10-22-model-defaults.md)。

2026-10-20 Worker Fast 默认关闭候选：`tests/model-config.test.ts` 与 `tests/worker-default-fast.test.ts` 首轮 74 项、本次投影收口后 76 项本地合成检查通过，覆盖配置优先级、新建／恢复、每轮请求及实际宿主的普通／递归 Worker 启动，并经主 Agent／两级 Worker 绑定端点及 Web/user 入口核对 `models.configured.fast` 与实际请求档位一致；维护源生产依赖图及两份测试通过 TypeScript 无输出检查。验证不调用真实模型，不证明服务端档位、速度或费用；本次未部署。

旧引擎 0.154.0 请求 `gpt-6.1-sol medium` 的失败证据仍保留；更新引擎后须重新执行真实检查，不可只改显示名称。指定模型、恢复上下文及真实工具的联合检查入口：`npx tsx scripts/real-model-switch.ts <原配置> <目标配置>`，使用独立合成测试目录。

## 主对话连续性

使用相同配置、runtime、Codex Home 重启时，恢复 SQLite 中已保存的同一个主线程。启动提示明确“已恢复原主对话”；仅首次启动才“已建立首次主对话”。无需每次重述背景；模型仍可能压缩长上下文，不能承诺所有原文永久驻留。

会话恢复失败不会回退新建，也不会覆盖 mainThread。工具定义升级不兼容时返回 main_tools_migration_required，原线程及指纹保留，需完成兼容迁移或恢复兼容版本后再启动。通用动态工具迁移尚未实现；此次交互工具通过本地 MCP 加载，保留原五工具及指纹，不需要替换主线程。不能靠删除运行库或更换 runtime 绕过并称为对话延续。此规则不改变退出时停止 Worker、重启后不自动重放任务的行为。

显式真实连续性测试：`npx tsx scripts/real-session-resume.ts .codex/private/local-chatgpt.config.json`。测试在 scratch 建立独立运行目录，以合成暗号核验先记忆、关闭、重启、同线程回忆，不保存对话正文。


2026-10-16 本机 Terminal 实际启动已显示 `codex-cli 0.163.0 / gpt-6.1-sol / medium` 和“已恢复原主对话”，并进行真实问候检查。此前运行库指向 15:17 建立但尚无消息的线程，引擎未保存其 rollout，重启无法读取；经用户明确选择，将指针修复到仍保存三轮既有对话的 14:56 原线程。已核对该线程工作目录、供应商及工具名称／输入结构兼容，保留原库全部记录和旧指针备份。此为本次获准的明确修复，不是自动回退；以后遇到不可恢复历史，启动返回 engine_thread_history_unavailable 并保持原指针，不能自行替换对话。


## Worker 待答与自主范围

Worker 需要业务信息时调用 `ask_main`，原生授权／用户输入请求也先转主 Agent。主 Agent 先查看详情和实际用户授权，能判断就直接回答、批准或明确拒绝，缺少范围／信息才发出 `question` 事件询问用户。交互模式可直接回复“回答待答 ID …：…”；多项同时等待时注明 ID 避免歧义。等待期间可继续聊天、查状态或运行其他 Worker，原 Worker 进程不退出，待答时间不扣执行预算。

时限语义更新（2026-10-21）：上段“待答时间不扣执行预算”为旧阶段记账描述；当前[已移除宿主整轮预算](38-native-timeout-recovery.md)，仍区分执行与等待的 `activeMs` 统计，交互有效性、原生独立等待和停止确认不因取消整轮预算而解除。

`/status` 的 `interactions` 提供 ID、run/thread/turn、状态及 waitingFor，不输出问题或操作详情。`question` 事件含 interactionId/runId 和主 Agent 的自然语言问题。`pending_main` 等主 Agent，`pending_user` 等用户；最终状态为 approved/denied/answered/cancelled/expired，`deliveredAt` 是原通道回执。停止后不能再授权；退出再启动只保留历史并对账，旧回调失效，不自动重派、重放或沿用旧批准。

初始自主范围默认允许主 Agent 在当前已获准任务内判断项目修改、测试及普通依赖安装，具体按目标、上下文、请求内容和授权决定并记录理由；不需要逐个动作都问用户。可在自己的配置中加 `autonomy` 收紧或明确这段范围，例如“仅限本任务文件整理；需要新依赖时先问我”。修改配置在下次启动后影响新派发，现有任务保留派发时的授权快照。用户消息仍可明确授权或拒绝具体请求；主 Agent 不得把模型提议视为新授权。

自主范围和实际能力分开：目前 Worker 只有绑定材料／上一成果读取、当前 Run 的 Markdown 新建、ask_main，以及原生请求桥接（批准校验仅接受本 Run 目录读取子集）。当前保持 `environments: []`，本机 0.163.0 的真实 Worker 未提供 request_permissions，原生审批实测未触发，不通过开启执行环境绕过。主 Agent 无法通过批准开放 shell、任意文件写入、网络或外部 MCP。原生命令／文件审批可被记录和拒绝，尚无获准执行能力；不以本机制声称安装、付款或外发已可用。原生秘密输入不支持，勿在对话中提供密码或 token。

正式 Worker 业务提问必须使用 ask_main。普通最终回复中仅写问题不会被自动猜测和关联，仍可能 artifact_missing；这条边界避免把任意文字误当待答或授权。

新增主工具 `inspect_interaction`、`respond_interaction`、`escalate_interaction` 通过 Homer 自有本地 stdio MCP 接入，只有这三个工具有宿主调用许可。原五动态工具定义／指纹保持原样，同一个主线程恢复历史；不改用户全局 MCP，不更换 runtime 或 mainThread。日常 Terminal 已运行的旧进程不会自动热更新，待空闲后退出并按原配置启动即可使用新版本；本次真实检查使用独立测试进程。

显式真实交互验收（复用已获准连接，但自动创建独立合成工作区和 private runtime）：

```sh
npm run build
npx tsx scripts/real-worker-interactions.ts .codex/private/local-chatgpt.config.json
```

无模型的原生协议探针：`npx tsx scripts/check-worker-tool-compatibility.ts <codex可执行路径>`。该探针使用 scratch 内隔离的 Codex Home，注入合成历史后恢复同一线程，核对当前完整 dynamicTools、MCP 目录及一次真实只读 MCP 往返，不访问日常账号、不调用模型。真实交互脚本验证模型回忆与工具调用。普通 `npm run check` 只运行离线检查；显式添加 `--native` 可要求原生审批实测，未观察到真正请求／回执会失败，不记通过。来源及历史结果见 [HMR-INTERACTION-001](../tests/scenarios/worker-interactions.md)。

## 维护提示词

默认主/Worker 提示词来自安装根目录的两个文本文件：

| 文件 | 编辑内容 |
| --- | --- |
| [prompts/main.md](../prompts/main.md) | 主 Agent 接待、派发、审阅、待答判断与升级用户规则 |
| [prompts/worker.md](../prompts/worker.md) | Worker 材料／成果规范、ask_main 与实际能力边界 |

`src/prompts.ts` 只负责读取，不保留备用提示词。每次 Homer 启动读取并验证这两个文件存在、可读且非空，加载失败会报告 `prompt_file_missing/empty/unreadable:<文件名>` 并停止启动，不静默使用旧内容。路径按模块位置解析，与执行命令时的工作目录无关；`src/` 与构建后的 `dist/` 都读取旁边的 `prompts/`。分发包显式包含 dist 和 prompts，不能只复制 dist。

直接编辑这些 Markdown 即可，无需为纯提示词修改重新编译。Homer 下次启动时读取文件，运行期间及其后续 Worker 使用这次加载的版本。独立开发启动器监听 prompts，在安全空闲时重启候选进程。详见 [开发版自动升级](09-development-upgrade.md)。

重启恢复旧主会话时，Homer 沿用原 `mainThread`、历史和附件，并按原动态工具指纹校验兼容性。升级后的首轮可以同时带有旧版和新版主提示词，宿主明确新版优先。正常压缩后使用当前配置里的新版。见 [宿主升级回归](../tests/scenarios/prompt-resources.md#宿主升级回归)。

文件化便于开发者或将来获准的维护工具更新规则。提示词不授予文件权限或执行授权；实际能力由当前原生权限配置、业务审批和可信运行资源保护共同决定。**本轮没有实现完整自进化**：受控修改提案、写入授权、独立验证和失败恢复流程仍待实现，不能将材料里的指令当成提示词更新或用户授权。

离线回归见 `tests/prompts.test.ts`；显式真实检查 `npx tsx scripts/real-prompt-reload.ts <获准配置>` 使用独立的编译包副本与合成会话，检查运行中固定版本、下次启动更新、同线程及历史回忆，不编辑日常提示词或运行库。结果见 [验证记录](07-m0-validation.md)。

## 当前记忆

记忆由 Homer 专属 HOME 中的 Codex 原生系统负责，查询、追加纠正和撤回要求通过主对话交给原生工具处理。旧自建记忆后端及其工具、Web/IPC 接口和迁移脚本已退役，不再提供旧数据兼容。原生纠正/撤回不等于删除全部历史或供应商上下文；后台汇总沿用原生调度，不承诺额外的费用硬上限。当前源码边界和既有原生验收记录见 [原生记忆说明](26-native-memory-feasibility.md)。

## 递归与连续发送候选

候选源码已接合同一个 Homer 的递归协作、内部验收/正式发布、持久输入队列及编辑/撤回/打断交互。隔离合成入口为 <http://127.0.0.1:4788/>，运行与关闭方式见[递归验收](15-recursive-agent-validation.md)。这里不启动 Codex 或账号渠道，不是日常服务升级。

日常4780已按明确授权更新并恢复后台构建/安全空闲自动切换，当前版本与实证见[最新发布](27-native-tools-and-approvals.md)；六条uncertain保留不重发。此处4788只表示早期合成验收，不保证该端口仍在运行。专属原生HOME采用需本人合法登录及单个原thread迁移的另行批准，不能把配置保存当已采用。

## 本地开发 Web 入口

新候选版本启动后，直接打开 launcher 输出的 `http://127.0.0.1:端口/`（默认 4780）继续原主对话，无需寻找连接文件或配对。刷新、新独立标签页、关闭重开和正常服务重启均读取原 runtime 的历史；服务未就绪或断线会明确提示，未取得有效主线程前不能发送。未提交草稿仍按标签页保存，不承诺关闭后恢复。

开发浏览器入口继续暂缓 Web 访问凭据这一层；仍绑定 127.0.0.1，现有 Host/Origin、业务审批、可信更新/数据库审阅和 HTML 预览隔离保持。localhost 不是等价 Host；不要改成 LAN/公网监听来绕过检查。本机程序可以伪造请求访问开发入口的管理与审批 API，因此该入口仅适用于可信本机开发，不作为普通用户的独立分发入口。

2026-11-02 起，桌面启动分支的候选源码增加自动认证：gateway 每次启动生成随机凭据，仅通过私有父子进程通道交给 Electron 主进程；主进程为当前主界面访问本机 `/api/` 的请求自动添加认证，用户无需配对。所有桌面 API（包括事件流、媒体、上传及审批）在调用业务处理函数前校验，未携带有效凭据返回 401。静态界面与隔离 HTML 预览不包含凭据，不设置认证 Cookie。凭据不进入 URL、命令行、业务状态或模型宿主；其他窗口、预览 frame 和外站不获得凭据，服务退出后停止注入，网关重启换新凭据。缺少有效启动凭据时桌面拒绝加载会话，不回退到免认证。

这层认证用于阻止未知凭据的程序直接调用桌面 HTTP 接口，不替代操作系统权限、模型沙箱或业务审批。移动 RTC 仍使用既有设备授权。隔离验证入口为 `node --test tests/desktop-gateway-access.test.mjs`、`./node_modules/.bin/tsx --test tests/web-desktop-access.test.ts tests/web-server.test.ts`、`node --experimental-vm-modules --test tests/electron-shell.test.mjs` 和 `node tests/web-desktop-access.electron.mjs`；后者启动独立 Electron 及合成 HTTP 服务，无模型请求，不启动已安装的 Homer。源码与隔离验证不代表日常 App 已采用，正式安装包仍需重新构建、签名并验收；记录见[技术验证记录](desktop-web-access-validation.md#本地-web-访问边界复现与修复范围)。

此变更需要正常采用完整 gateway 新版本，不能以刷新界面替代 gateway 换版，也不放松 `dev_gateway_changed_restart_required` / `dev_schema_change_requires_review`。当前入口实现见[网关源码](../scripts/dev.mjs)（详细实施流水仅在本地保留）。
