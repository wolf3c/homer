# 开发版自动升级

2026-10-17 22:12 已从停止图标临时固定入口恢复正常源码自动更新；实际日常版本、自然空闲交接和启动失败回退证据见[候选发布](25-verified-candidate-release.md)。gateway/schema/deps等兼容保护继续保留。

2026-10-17日常状态：已按新正式授权完成维护切换，原Terminal的4780正在运行当前稳定入口，原主thread保持。实际版本、备份、验收与恢复限制见[日常启用记录](20-daily-environment-activation.md)。下文旧批次的“尚未迁移/未获授权”描述当时状态，当前自动更新仍遵守同一安全边界。

2026-10-16；适用于本机 Node 22 / macOS 的 Homer CLI。稳定启动器持有终端，界面源码独立构建兼容候选，任务运行时可更新；业务源码仍在安全空闲边界换版并恢复同一个主对话。运行中的 Worker、待答授权和交付继续由旧版完成。没有运行中 Worker 迁移、桌面壳或服务端发布。本地 Web 入口复用此启动器，见 [Web 界面](10-web-interface.md)。

## 启动与使用

先按 [运行说明](06-running-homer.md) 安装依赖。使用原配置和原 runtime：

```sh
export PATH=/Users/wolf3c/.nvm/versions/node/v22.22.0/bin:$PATH
npm run dev -- --config .codex/private/local-chatgpt.config.json
```

普通环境先选择 Node 22，然后同样执行 `npm run dev -- --config <原配置>`。不需要先构建 dist。启动／换版提示显示已生效的源码版本 hash、实际 Codex 二进制版本、请求的 model/effort 和主线程恢复状态。显示请求参数不等于完成真实模型调用。`npm start` 保留原单进程入口，不会自动升级。

逐行自然语言、`/status`、`/quit`、Ctrl-C 和 EOF 语义沿用原 CLI；开发入口支持 `--config` 和 `--json`，不支持 `--message` / `--request-id`。`/quit` 和信号停止工作并退出；EOF 等待交付，待用户答复时明确停止原 Worker。Web 模式额外支持 `--web --port <端口>`（或 `npm run web`），页面关闭与终端 EOF 后仍保持后台服务；`/quit` 与信号才退出。已有普通 CLI 占用同一 runtime 时必须先安全结束它；启动器不会抢锁或终止不属于自己的进程。

## 换版条件与故障

1. 每 300 ms 读取明确的源码范围，连续 600 ms 稳定后构建，合并连续修改。每份候选单独复制源码，再用锁定的 TypeScript 编译器检查；独立检查进程加载服务、配置和提示词，但不启动引擎、不调用模型、不发送业务消息。生成文件不会覆盖正在运行的版本。
2. 构建通过仍只是候选。主轮／排队主轮、执行／排队 Worker、审阅、待答交互、尚未确认的输出交付任一存在，都延后换版。旧版继续接收消息和用户答复，待答 Worker 不重启，不丢进程内授权。
3. 可尝试交接时，启动器将普通新输入持久暂存在传输日志，旧服务同步冻结输入并复核状态。旧服务关闭引擎、数据库和交互服务；必须收到正常退出且唯一 CLI 锁已释放，才启动新版。新版使用相同配置边界和 mainThread；恢复失败不静默新建线程。
4. 新版确认恢复原线程后，按稳定请求 ID 将暂存输入交给原业务接收事务。业务输出等待稳定启动器的 stdout 写入回执，之后才记 delivered。候选构建／导入失败旧版继续；候选运行启动失败且退出释放锁后，恢复上一份构建，显示恢复事实，再交给旧版处理暂存输入。已提交而执行结果不确定的请求不重放。

普通消息在启动器完成首次构建、配置与锁核验后，先写入 `runtime/gateway/transport.sqlite`，同步提交后才返回传输暂存回执；`accepted:false` 不表示已进入业务历史、被模型采用或执行成功。运行期通常直接返回原业务接收回执；交接窗口返回 `transportState:stored`。唯一业务 child 仍以原 `ConversationHistory.accept → MainInputs.accept` 同事务写入历史、输入、收据和记忆来源，claim 才采用。确认业务接收后删除传输记录；提交后丢 IPC 回执时仅重试同 ID 接收，不重放模型执行。CLI 普通行使用相同协议；`/status` 是只读瞬时命令。首次构建完成前的终端输入尚无持久保证。

传输目录 0700、数据库 0600，FULL 同步提交、单独网关锁；最多1000条尚未结清记录。拒绝时清除载荷，保留 ID/错误回执供当前页面核对；只有用户显式重试才再次投递，恢复扫描不会自动重试已拒绝项。未确认项恢复时核对连接绑定、原 thread、schema/工具指纹；不匹配拒绝启动，不能另建主线程吞掉消息。该文件是必要的受保护传输记录，不是第二个业务 inbox，也不是诊断日志。

业务 child 意外退出时，已启动的 Web 入口继续显示最后已知状态并暂存普通消息，标为 `recovery_required`；不自动启动另一个 owner、不把未知执行或外发当作失败重跑。管理读取可短暂等待恢复，停止、打断、交互答复和管理写操作不会跨版本延迟执行。网关自身死亡仍需显式重开；HTTP 在进程停止期间不可用。启动未确认或锁未释放时不杀未知进程来抢锁。新建空引擎线程仍须先获得可恢复历史，才允许业务交接。

## 范围与兼容阻断

新进程身份固定使用 C locale，避免中英文日期格式差异。遇到旧锁／租约的 PID 仍存活但身份无法核实时拒绝接管，不删除活锁、不终止未知进程。旧日期格式的活跃 CLI 先在原终端正常 `/quit`，确认退出后再启动新入口。

监听 `src/**`、`prompts/**`、`assets/**`、`ui/**`（排除其 node_modules/dist/.vite）、`package.json`、`package-lock.json`、`tsconfig.json` 和启动时明确选择的配置文件。默认无配置文件时使用原默认配置；启动器环境变量固定为启动时值。排除 runtime、workspace、`.codex/**`、`dist/**`、`node_modules/**`、docs、tests。配置文件本身即便位于 private 也作为唯一例外读取，绝不递归监听 private。源码范围内拒绝符号链接。

相对 import 保持源码层级；提示词／assets 随候选快照复制，MCP stdio 路径指向候选自身编译文件；Codex 继续使用配置中的固定绝对路径。候选位于忽略的 `.codex/scratch/dev-upgrade/builds/`。启动器脚本不会自动更新自身，修改 `scripts/dev*.mjs` 需在空闲时手动退出重开。本次启动器创建的失败、被替代和已排空业务构建会回收；当前业务与本次会话最多8份已激活界面资源保留，旧页面不会混用新 chunk。达到8份后继续使用当前界面并提示受控重启，不能无限累积版本；既有历史构建不擅自清理。

以下变化阻止热切换，旧版继续：依赖／lockfile／Node 引擎要求变化；已知数据库所有者 `store.ts`、`worker-interactions.ts`、`web-history.ts` 及已登记渠道数据实现变化；主工具完整指纹变化（`main_tools_migration_required`）；runtime、workspace、账号目录、供应商或 Codex 二进制路径变化。不支持扩展 tsconfig、插件或改变 src/dist 根目录。新增数据库迁移必须纳入兼容审查与阻断，不能藏在其他模块绕过检查。没有自动迁移主工具定义或跨账号恢复。更改 model、effort 等兼容配置可以在同一绑定内空闲换版；旧超时字段不会恢复整轮执行预算。

node_modules 复用本机锁定安装，服务与前端依赖均按实际锁文件校验；依赖安装不能作为热更新执行，先退出再安装并重新启动。自动升级不自动下载或升级引擎。其他依赖新增后需要重新审查隔离方式。

## 有界选型与后续

| 方案 | 可复用能力 | 当前取舍 |
| --- | --- | --- |
| Node `--watch` | 原生监听并重启进程 | 直接重启不能保留进程内 Worker／待答；不用于换版 |
| nodemon | 成熟的监听、忽略、去抖和重启信号 | 可用于普通开发服务；本产品还需要业务边界、唯一锁、终端输入和失败回退协议，当前无需新依赖 |
| PM2 graceful reload | ready／退出信号，cluster 服务新旧实例交接 | cluster 针对网络服务，可能退回 restart；无法自动迁移 Homer 的单所有者主会话和进程内授权，不引入 daemon |
| 稳定启动器＋不可变候选 | Node child_process、IPC、readline、文件哈希和 TypeScript 编译器 | 当前最小实施方案，业务安全边界由 Homer 明确提供 |
| Temporal Worker Versioning | 按 build/deployment version 固定长任务版本，旧任务留在旧 Worker | 借鉴版本隔离和排空思路；当前没有 Temporal 工作流历史／服务，不能宣称现有 Run 已有其持久恢复能力，不部署 Temporal |

官方来源：[Node watch](https://nodejs.org/api/cli.html#--watch)、[nodemon 重启与忽略](https://github.com/remy/nodemon#readme)、[PM2 graceful shutdown](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/)、[PM2 cluster 与 reload 限制](https://pm2.keymetrics.io/docs/usage/cluster-mode/)、[Temporal Worker Versioning](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning)。查阅日期 2026-10-16；方案判断基于当前 Homer 的单进程 Map、数据库独占锁和主线程恢复约束。

已实现界面独立激活与 CLI/Web 传输回执；IM 沿各渠道原接收事务和单轮询 owner。尚未实现独立 Worker 生命周期与版本路由、忙碌业务版本推广、显式数据库兼容能力迁移和独立生产 Web 发布。不能将这些未完成能力称为无感更新已完成。详见[本轮设计与验收](17-seamless-update-validation.md)。

## 验证入口

默认核心只保留更新判定等离线契约；`npm run test:development -- --test-name-pattern=HMR-UPGRADE-001` 显式运行真实子进程升级测试（见 [测试边界](testing.md)）；专用合成 runtime，真实启动 Homer、独立合成 App Server 和 SQLite，不调用模型。覆盖忙碌 Worker、主轮、交付边界、空闲换版、输入空档、坏构建／坏启动回退、连续变更、相同线程与业务记录、依赖／工具／数据库阻断、排除范围和退出进程清理。待答边界另由服务交互测试覆盖。证据保留在 `.codex/scratch/dev-upgrade/e2e-*/verified-checks.json`。

显式真实模型验证仅手动运行：

```sh
npm run build
node --disable-warning=ExperimentalWarning scripts/real-dev-upgrade.mjs .codex/private/local-chatgpt.config.json
```

使用独立合成工作区和 private runtime，仅两轮模型请求，检查升级前记忆、升级后同线程回忆及退出清理；不默认保存回执正文。验证元数据位于 `.codex/scratch/dev-upgrade/real-*/real-upgrade-checks.json`。模型用量或结算金额没有查得时不标免费。实际结果与日常 Terminal 接管状态见 [验证记录](07-m0-validation.md)。

## 数据库所有者的升级边界

Store、递归任务、待处理事项及已登记渠道等数据库所有者仍纳入 schemaHash；变化阻断于 `dev_schema_change_requires_review`，不允许候选先碰日常库。旧自建记忆 owner 已移除，原生记忆由专属 Codex 管理，见 [原生记忆说明](26-native-memory-feasibility.md)。源码构建成功不是日常上线授权，新业务事实产生后不能自动用旧数据库副本回退。

## 递归与主输入队列的候选边界

递归 schema owner `src/recursive-tasks.ts` 已加入 schemaHash；Task/Run/消息/正式发布及 interaction epoch 改动继续要求 `dev_schema_change_requires_review`，不能热切日常库。parked、RPC、held、recovery、uncertain、未审、待发和 pending/offered/received/blocked 收据全部阻断交接。服务端已确认接收的主消息队列持久化在现有 SQLite，启动器暂存的普通输入使用上述传输恢复协议，两类回执不能混淆。

新增主互斥支持多 turn Worker 与等待唤醒；原 mainThread resume 和五工具指纹保持。真实离线子进程已验证忙碌延后、原线程/数据交接和失败回退。迁移预览、最终联合日志、回退维护点以及未完成真实模型门槛见[递归验收](15-recursive-agent-validation.md)。2026-10-17追加授权只读日常备份及离线迁移预演，结果见[日常库预演](18-daily-migration-preview.md)：微信已结束发送的持久uncertain可原样保留，活跃发送/提交/扫码仍阻断；递归执行与正式交付的未知保护不变。没有日常迁移、重启、重发或清理授权。


## 独立界面契约

`ui/protocol.json` 与服务 `WEB_PROTOCOL=1` 一致时，UI/样式/其 Vite 资源可独立构建和激活，不调用业务 prepare，不等待主轮、Worker、待答、uncertain 外发或新建空 thread。依赖变化仍拒绝；业务 schema 或代码候选失败不会阻止兼容 UI 构建。UI 与业务分别投影 `upgrade.uiVersion/version`。

页面在更新后继续使用原 API/SSE，提示“刷新界面”，不强制重载表单；刷新从会话草稿恢复，业务历史仍以服务为准。静态资源通过 `/ui/<完整指纹>/assets/<文件>` 固定版本，旧资源保留到本次启动器结束。主页面与 API 保持 no-store。SSE 传完整状态，断线重连重新读取快照，客户端按消息 ID 和请求 ID 投影，无增量重放窗口。

网关自身持有 HTTP 路由，`web-server.ts/web-contract.ts` 或显式协议变化要求受控重启；不能在只替换业务 child 后声称网关实现也已更新。schema owner 仍保守采用原整文件指纹，未删除 guard、未执行未知 DDL；本轮没有业务库迁移。

## 维护回退入口

需要回到明确旧构建时，使用经审阅的[pinned-rollback入口](19-pinned-rollback-launcher.md)，不重新运行会构建/观察新源码的历史dev.mjs。该入口固定旧dist、UI、依赖与原thread/数据库契约，拒绝活锁、未知执行、待交付或gateway待投递，不自动升级/重启/重放。它不提供自动降级数据库或日常关闭功能；维护点备份与新版已采用后的禁止盲回退边界仍由docs18定义。
