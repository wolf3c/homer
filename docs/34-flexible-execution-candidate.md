# 执行架构调整候选（2026-10-19，未采用）

**仅供审阅，尚未采用。** 用户已选择“涉及身份、权限和审批的代码经真实审阅后采用”。本轮在同一 gateway 中实现确切源码版本确认、受保护的运行构建与空闲切换；此前可变 UI 的失败证据按历史事实保留，不将旧探针或普通功能测试冒称全范围安全证明。最终命令和结果见交付验收元数据。

本页描述隔离候选，不代表日常版本。固定 Codex 0.163.0、Node 22.22.0；没有访问真实账号、调用付费模型、修改日常配置或部署。旧验收文档按日期保留，相关历史限制不再作为本候选的目标。

## 执行和目录

专属 HOME 的普通 main/Worker 使用现有同一原生文件权限集合：项目和普通目录可用，runtime、Codex HOME 与浏览器账号/控制数据按精确路径拒绝；工作目录变化不修改这个集合。允许项目根包含受保护 runtime，不能进入实际私有目录。共享 HOME 的旧兼容分支保持原隔离配置。

主 Agent 默认落脚 `workspace`；`work_directory` 选择自己的后续 turn cwd，一级业务 Worker 默认继承主 Agent 当前目录；原生子 Agent 的目录继承由 Codex 负责。Worker 可在已有权限内明确选择另一目录。`task_versions.workingDirectory` 保存事项契约，`runs.workingDirectory` 保存每个运行者的实际选择；不靠共享主目录迁移其他运行者。当前已发出的 Shell 使用明确 workdir，后续 turn 使用选定 cwd 并重新发现项目规则/Skill。Run 目录只管理正式成果，不承担项目 cwd。

主 Agent 的原生多 Agent 入口按实例关闭，Homer 独立后台 Worker 工具保留。Worker 的原生多 Agent 入口开启，仅使用原生子 Agent 进行内部拆分；Worker 不再创建业务子 Worker，由所属 Worker 汇总原生子 Agent 结果，不逐个建立 Homer 任务。主 Agent 派工后可以结束本轮，接待新输入；结果沿原调度回传。

普通网络默认开放，包括公网 HTTPS、公开 Git 读取、依赖 registry 下载和 localhost。普通文件操作、测试和构建不引入额外网络审批。原生提出需要新增授权的操作仍经过真实用户审批；授权来源保留实际用户要求与 requestId，模型不能把自身决定冒充用户。网络与目录能力不代表任意任务范围、账号复制或设备破坏授权。

## 用户控制入口

开放 Shell 网络后，Origin/Host 校验本身不足以认证本人。gateway 每次启动生成内存连接密钥，在 runtime/web-connection 写入权限 0600 的一次性 `connect-homer.html`，十分钟有效。用户从该本机私有入口连接；浏览器立即清除 URL fragment，密钥仅用于一次配对，入口随即移除。每标签页将会话保存在 sessionStorage，API/SSE/媒体/下载通过同源请求头认证，无 cookie、URL query、模型环境或日志凭据。其他 localhost 端口不会自动收到凭据。业务 host 切版不重置稳定 gateway 会话。

这会改变本机首次进入方式，需要采用者明确接受。已连接标签页刷新和草稿保持；新开的独立标签页不能只输入端口地址取得身份，gateway 重启需要重新连接。手机/既有浏览器渠道未在本轮更改。非默认浏览器 profile 必须在 `controlBrowserData` 记录实际目录并验证原生拒绝；默认 Chrome/Edge/Brave/Arc/Firefox/Safari 账号目录已有精确拒绝。该机制不声称防御同一操作系统用户的任意恶意进程、已获浏览器/电脑控制身份或主机管理员。采用前须确认真实浏览器 profile 在保护边界内，不能仅以 Origin 冒称隔离。

## 原生指令与记忆

`loadPrompts()` 只读取 main.md、worker.md。产品方法论通过 developerInstructions 附加，正式两份提示词目前的所有用户编辑逐字节保留，仅删除记忆占位符；包括 YAGNI，主提示另含“知识沉淀，持续改进”。没有新增自动学习服务。五份旧策略资源及 autonomy 配置/注入链已移除；旧配置残留字段被忽略，不改写文件、不阻止启动。

专属 HOME 只接线原生 memories feature 和 dedicated_tools，不覆盖 use/generate/version/模型/限额/提取间隔。固定源码 config/src/types.rs 默认 generate/use=true、v1、每次最多两条、六小时空闲；原生 memories/write/src/start.rs 自行排除非 root 子 Agent。Homer Worker 是独立 root thread，沿原生默认参与使用/提取。宿主不再维护 native 文件指纹、额外片段注入或因任意记忆变化停止无关 Worker。历史 Homer memory 表、原生 note、rollout、旧引用和 publication 都保留；旧共享 HOME/legacy 后端及 MemoryStore 仅为现存数据和兼容分支保留，不迁移或删除数据。

**新建以及原本就使用原生基础指令的恢复会话通过实际请求验证。旧自定义 base 的既有会话没有迁移通过。** 固定源码 core/src/session/mod.rs 798–832 的优先级是 config.base_instructions → 历史 session_meta.base_instructions → render_model_instructions。thread/start/resume/fork 的可选字符串没有“重置历史 base 为原生默认”操作；传 null 等于未提供，空串是空指导，不是默认。thread/rollback 仅回退对话轮次，不撤销文件或清除原始 session meta。模型枚举也不提供可供恢复的渲染后默认基础指令。

可审阅采用选项：保持原 thread/历史时，旧 base 继续存在，并附加新 developer 方法；若另行批准全新 thread，则获得原生默认，但 thread 身份改变，旧对话保留且不会自动回放为新历史。当前没有执行任何选择，也没有补丁 Codex、直接修改 rollout/数据库或悄悄换主 thread。

## 文件恢复范围

Codex thread/rollback 不提供文件撤销。本候选使用明确文件集合的 `file_checkpoint`：修改前 capture、确认自身修改后 seal、需要时 restore。必要文件内容只保存在受保护 runtime/file-checkpoints，目录 0700、文件 0600，不进入源包/公开服务/日志；最多 128 个普通单链接文件、每个 16 MiB，不递归扫描、不跟随符号链接。

恢复先核对 seal 后的哈希；任何后续并发改动导致整组预检冲突，逐文件恢复又复查，排他创建避免覆盖新出现的用户文件。新增文件的已封存版本移入私有 displaced 留存；不是静默删除用户新增文件。跨文件系统恢复在移动前拒绝，不冒称多文件原子事务。已有打开文件句柄的后续写入可能留在 displaced，需要人工核对。

capture 到 seal 期间须核对实际变更归属；它不追踪任意 Shell 写入的作者，不能分辨此窗口内另一进程的修改。并发写入中的文件应保留差异人工核对，不能以 seal 当作作者证明。这里提供明确文件恢复和冲突保护，不声称任意安装、数据库、账号、远端操作或所有 Shell 副作用都可自动回退。已有 Git 目录继续使用现有 diff 等机制，本项目没有创建 Git。

## 兼容和采用边界

- recursiveSchemaVersion 从 1 加法升级为 2：task_versions/runs 增加可空 cwd，旧行保留并沿 workspace 默认。旧构建不应写 schema 2；pinned 仅认可明确声明支持版本 2 的 owner。memory schema 无迁移。
- 五项 MAIN_TOOLS 指纹保持原定义；MCP 增加 work_directory/file_checkpoint、递归契约增加可选 cwd。需要受控重建原生引擎/MCP 工具目录，不能将 flag 当作当前模型已换工具。不得对正在跑的任务更改 cwd。
- gateway 的 web-server/web-connection/update-review-page、Telegram 设置页、上传与媒体校验、web-history、processes 锁所有者及稳定启动脚本属于 gateway 指纹边界，既有 gateway 不热替换认证或审阅代码。采用必须在安全空闲点显式重启 gateway，重新打开私有入口；不擅改手机渠道。
- 无新增产品 npm 依赖。隔离媒体验收用候选私有 Python venv、公开校验过的 whisper 模型；浏览器验收用私有 Playwright + 独立 headless Chrome profile，均不写共享 node_modules。
- 正常后台准备、忙时延后、安全空闲同 thread 切换、构建失败留旧版和启动失败回退由受控 synthetic 更新测试覆盖；不是实际账号/模型自开发已通过。

采用前：核对维护源并发修改，保留用户 main.md 原文；在空闲且无未决操作时保留一致 SQLite（含 WAL 事实）、配置、当前不可变构建和旧 prompts 的私有备份，再应用已审阅候选。备份不是授权本任务执行这些步骤。schema 2 后不能把旧二进制直接接入新库；优先前向修复。若确需完整回退，只能在确认没有新业务写入/外部未知副作用后恢复一致旧快照，否则先逐项对账，不能丢弃新用户数据或重放 uncertain 操作。原生历史/记忆保持原位置，不回填、删除或复制凭据。

## 可复现验收

全部只对受控 fixture，需 Node 22.22.0。原生探针显式传固定 0.163.0 绝对 binary 路径；不使用真实账号。

- `npm run check`：构建、完整 typecheck、tests；最终摘要在审阅 metadata。
- `node --import tsx scripts/native-execution-profile-probe.ts <codex>`：main/Worker 真实 sandbox command/exec，普通修改、私有/浏览器/入口拒绝、三目录同一配置、四项网络、Origin/伪凭据控制请求 401。
- `node --import tsx scripts/native-execution-lifecycle-probe.ts <codex>`：本地 scripted Responses + 真实原生工具/cwd/AGENTS/Skill、main 工具可见性、Worker 子 Agent 完成/汇总/停止清理、原生 note 及自动提取、新建/恢复请求层检查、旧 base 继承事实。仅在自己的合成状态库准备空闲时间/preview fixture，不修改真实历史。
- `tests/runner-directories.test.ts`：真实 Homer 调度配合合成引擎，在 A/B/C 非 Run 项目修改、执行 Node 测试、继承/独立切换、结果回传，无多余审批。
- `tests/file-checkpoints.test.ts`：非 Git 的修改/删除/新增恢复，seal 后并发修改保留。
- `tests/dev-upgrade.test.mjs`：synthetic main→Worker 改受控 Homer 源码、测试、构建、忙时保持旧版、空闲切换、同 thread/输入和失败回退；pinned/dev-gateway 与既有渠道/记忆/媒体/publication/停止测试同时覆盖兼容。
- `scripts/web-user-connection-browser-probe.ts`：私有测试 Playwright、独立 Chrome profile，渲染确认 bootstrap fragment 清除、认证 SSE/图片/下载、草稿刷新保留、无 cookie。此脚本不进产品运行链。

公网曾出现超时，探针保留最终逐项退出码，不能把网络成功等同真实模型业务验收。未进行真实模型自开发和日常采用；下一次最小真实验收提案：仅修改 ui/homer-app.tsx 的断线提示，在现有断线提示中加入从私有入口重连的说明并保留草稿，加相应渲染验收；Worker 在授权源码目录实现、运行 check，主 Agent 审阅，随后再独立决定采用。该提案没有执行。

## 可信构建经真实审阅采用

此前负向实测确实失败：旧路径可修改普通构建目录中的 UI，已连接合成浏览器执行它后伪造控制一次。旧 receipt 保留为历史 RED。本轮按用户选定的较小方案实施，没有重跑攻击复现、扩展安全研究、关闭网络或改变平台防护。

- `src/` 整体是同一个可访问 runtime 的宿主；目前没有可独立证明不持有私有权限的 TS 业务模块，因此源码变更均须审阅。`ui/`（含构建插件配置）、`assets/`、根 package.json/tsconfig.json 同属可信构建输入。没有承诺其中某类业务代码可自动热替换。
- 在用 gateway 通过已有用户连接提供 `/settings/update`。页面来自已认可 gateway 模块，不来自候选 UI；展示本次准确源码前后对照与完整 source hash，用户勾选后确认。API 检查本人连接、同源及仍与磁盘完全一致的 source hash。没有 MCP/普通模型工具批准入口，也不读取“批准文件”；变更源文件后旧确认不能批准新版。确认仅保存在在用 gateway 内存中，不由业务 child 发放。
- 在执行新的宿主导入或 Vite 配置之前，先取得对准确源码 snapshot 的用户确认。既有依赖、schema、工具契约及 gateway/restart guard 仍有效；这些不兼容变更不会因点击确认而绕过原门槛。配置文件整体改变要求受控重启，避免自动改变浏览器保护或身份配置；原始配置不发送到审阅页面。
- 运行代码、静态资源、维护入口脚本和 Skill 复制到 `runtime/trusted-builds/`，生产依赖亦复制到该已有精确 deny 内；活动宿主和 getAssets 只用这些副本。后续编译使用启动时封存的工具链，模型可编辑的共享 node_modules 不会成为后续运行依赖或编译器。未安装/修改共享依赖。模式0700/0600用于私密性，真实模型文件边界来自已有 runtime deny；不声称 chmod 能防同 OS 账号的任意未受约束进程。
- 构建清单绑定 source hash 和运行文件哈希，启动与采用 UI 前复验。普通 source 或 staging build 变化不改变正在服务的版本。此机制复用现有构建/发布状态，不维护全局文件事务。固定维护/回退入口也先复制已核验的执行与资源到同一受保护运行区，避免只在启动时校验一次便继续从普通目录懒读。
- 审阅后依旧等待现有任务、审批和写操作安全空闲。兼容 UI 采用不更换执行宿主；只读状态轮询不会饿死它。宿主交接先冻结新的管理写入并排空已有只读 RPC，再沿原 thread 交接；不丢弃未知写操作。构建失败继续旧版，启动失败沿原流程恢复旧构建；新源码若在准备期间变化，不将它混入已认可的构建。
- 方法论提示词、现有项目 Skill 等非宿主执行内容可沿原兼容流程准备更新；没有自动批准身份/权限代码的例外。新 Skill 仍由正常任务按需编写，不建立学习调度或数量指标。

入口代码首次采用或 gateway 指纹变化仍须由 CTO 在真实用户审阅后、安全空闲时显式重启。模型启动另一个进程或写下一个批准标记不能给当前 gateway 发放用户连接。启动器本身的采用是可信入口边界，不能把维护脚本的普通 Shell 调用当作真实用户审阅。本任务没有启动、重启或替换日常入口；新本机配对方式也未暗改现有手机渠道。

恢复方式：保留当前受保护构建、对应源 hash/运行清单及一致数据库备份。忙时拒绝切换；兼容候选启动失败恢复原在用构建。新 schema/tools/gateway 不兼容时继续要求单独采用，不拿旧二进制直接写新版库。历史/记忆不删除；若切换后已有新写入或外部未知副作用，先对账和前向修复，不自动用旧库覆盖新数据。旧 base 无受支持同 thread 重置和真实模型自开发未验收仍是事实。

定向验收保留在 `tests/trusted-build.test.mjs`、`tests/web-dev-host.test.mjs`、`tests/dev-upgrade.test.mjs`、`tests/dev-gateway.test.mjs` 与 `scripts/web-user-connection-browser-probe.ts`。这些是无账号本地 fixture 的正常功能验证，未对新候选重复执行旧攻击探针，不能称真实模型自开发或日常采用通过。

测试文件串行执行：合成构建记录显示默认并行下 TypeScript 在30050ms被既有30000ms截止终止、系统 load 超过60；后续并行2时load约50仍出现45秒fixture等待/120秒总验收超时，改为文件串行减轻自身构建竞争。生产超时、断言和产品 Worker 并发没有放宽。

共享依赖补充核对：默认 Vite bundle loader 会在共享 node_modules/.vite-temp 写入并自动删除临时配置；发现后已中止当次 check，没有修改/清理共享依赖内容。候选 UI build 命令及自动构建统一使用已安装 Vite 的 `--configLoader runner`，后续检查观察该目录事件数，并保留中止记录。依赖版本及 lock 未变，但现有 dependencyHash 包含 UI package 元数据，因此这一构建命令变化也要求显式维护重启，不绕过原门槛。工具链使用 APFS 独立克隆，并在同 runtime 按 lock hash 复用；独立副本与缓存复用由定向测试保护。

工具安装前提：本轮封存项目代码/资源/依赖和编译工具模块，未封存 process.execPath（Node）及 config.codexBin（Codex）可执行文件本身，也未验证其安装位置对模型不可写。现有 profile 未为这两个路径自动附加精确 deny；若安装位置仍可由模型修改，不能据此宣称完整工具链不可替换。采用前由CTO核对这一前提；必要的可执行包封存或安装保护属于需单独审阅的具体差异，本轮没有修改平台防护或运行攻击探针。

采用入口范围：运行副本与审阅交接接在线上已有 dev gateway、pinned/fixed 维护发布路径；裸 node dist/cli.js（含当前 npm start/bin 的直接CLI）没有新增审阅/封存流程，不属于本轮可信更新入口证明。实际采用须使用已审阅的上述入口，不能将裸CLI启动等同完成可信发布。
