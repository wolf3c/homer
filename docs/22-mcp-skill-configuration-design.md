# 原生 MCP、Skill 与 Homer 专属数据

## 当前接线（2026-11-04）

能力管理通过主对话的既有宿主工具完成，已移除的管理页面和专用 HTTP/IPC 不恢复。MCP 保存、完整配置审批、项目层信任与原生严格校验以[当前 MCP 管理契约](native-mcp-config-management.md)为准；普通审批卡不能用 hash 代替用户审阅隐藏配置。OAuth 合成协议通过不代表当前存在用户操作入口或真实第三方登录已经验收。

系统 Skill 沿原生发现及用户启停；完整用户包可写，`.system` 只读。`$name` 显式接线只选择已启用且位于专属 HOME/skills 的项；停用不能抹除已有上下文。当前隔离探针断言停用 Skill 的正文未被新调用加载，早期“显式调用可绕过停用”记录不作为现契约。Main 不暴露原生协作调度，Worker 可使用原生协作；普通项目和网络沿当前执行权限，HOME/runtime 等控制数据仍受保护。

记忆由[原生记忆](26-native-memory-feasibility.md)管理，不再由 Homer 业务 SQLite 保存记忆。配置保存、目录发现、下一轮采用与工具调用必须分别确认。当前专项入口见[测试说明](testing.md#固定原生协议与合成验收入口)。

## 历史设计与验收记录

下文保留截至各标注日期的页面、隔离策略与通过数，不能用于判断当前入口、运行状态或权限。

2026-10-23 源码现状：顶部“能力”、完整管理页及专属 HTTP／开发 IPC 已删除。能力通过主对话交办；ChatGPT 测试登录界面删除不改变现有认证。MCP OAuth 暂无 Homer 用户入口，隐藏配置仍需可信原生配置路径。以下历史发布和页面验收记录不代表当前页面可用；当前边界见[移除说明](2026-10-23-remove-capability-settings.md)。

**最新能力直接开放批次见[29](29-native-capability-activation.md)**：用户已要求移除额外的一刀切功能禁用；本页早期手动开关/未采用状态仅对应历史阶段。固定原生默认/配置/能力发现为准，具体操作审批与网络边界保留。

更新：2026-10-18。状态：**原生管理入口已随已验候选发布到日常；固定 Codex 0.163.0 合成验收通过。本人原生登录已确认；日常c72dc2e523a7已采用专属HOME并创建全新开发主对话，旧数据保留；真实模型首轮待本人使用。** 最新上线/自动更新/隔离状态见[已验候选发布](25-verified-candidate-release.md)。原生工具/审批与Worker扩展的最新边界见[27](27-native-tools-and-approvals.md)。应用内原生浏览器登录已随 `6b2d91e39213` 正常自动更新上线；后续本人认证及专属新主对话切换已完成，首轮恢复边界见[28](28-native-home-adoption.md)。以下阶段性验收不代替最新回执。

用户已明确选择最大程度复用固定引擎的原生配置、发现、加载、调用、管理与 OAuth。此前本文建议的自建 Broker、SQLite 能力版本库、Worker 能力冻结、按任务工具代理均已被替代，不是实施要求。本轮没有建设这些机制，也没有跨代码版本 Worker 并行。配置文件和原生管理服务是唯一能力配置真相；Homer 的业务 SQLite 继续独占 Task/Run、记忆、授权、队列和 publication。

## 1. 当前实现与边界

同一个 Homer 对话通过主 Agent 专用自有 MCP `capabilities` 管理自用 Skill，以及已经获得用户批准的 MCP。原顶部管理页及其专用 HTTP／IPC 已移除，现有工具继续共用同一个服务，不新建业务账号、Agent 或数据库。原五个 `MAIN_TOOLS` 定义与 hash 保持不变；新入口属于既有 `homer_interactions` MCP，恢复原主 thread 不替换动态工具。

新连接、程序、参数、工具扩权及 OAuth 必须由用户管理入口明确批准，模型工具没有 `approve` 或 OAuth 操作。模型可以维护工作方法，读取状态，在既有许可范围内收窄工具、启停或移除连接；不能安装依赖、提交 Token、借 Skill 正文自授权。新程序以用户系统账户运行，**Codex 的模型文件沙箱不覆盖 MCP 程序**，批准前必须信任程序本身。原有读写范围、来源、Worker 授权和 publication 检查没有放宽。

## 2. 固定版本原生复用表

依据：本机固定二进制 `codex-cli 0.163.0`、其 `app-server generate-ts --experimental` 输出、实际空 HOME/loopback 协议探针及当前源码。在线最新文档不能替代此表。

| 能力 | 类别 | Homer 的使用与限制 |
| --- | --- | --- |
| thread/start、thread/resume | 已有复用 | 同一个主 thread；恢复失败不另建替代。保留原动态工具 hash |
| turn/start、通知流、usage、interrupt、steer、compact | 已有复用／本轮补展示 | 继续由现有 Engine 处理；Web折叠显示原生token用量。停止与追加沿既有队列/授权语义，不新增工具流水 |
| config/read includeLayers | 本轮接通 | 按实际 user 层文件定位专属 config.toml；有效配置和持久用户层分开读取 |
| config/batchWrite + expectedVersion | 本轮接通 | 原生校验与版本 CAS；仅修改受管 mcp_servers，不开放任意配置键给模型 |
| model/list | 本轮接通 | 显示原生支持模型、reasoning efforts及当前组合是否列出；不自动切换模型或供应商，不将目录支持当真实调用成功 |
| skills/list、标准 SKILL.md、skills/config/write | 本轮接通 | 专属目录文件 CRUD、原生发现/解析/启停，正文 hash 冲突检查；现有文件编辑保留完整 frontmatter |
| UserInput.skill | 本轮接通 | `$name` 显式选择经原生目录确认已启用的自用 Skill；正文由原生按需加载。模型自动匹配理解仍待真实模型验收 |
| stdio、Streamable HTTP、工具 schema、实际调用 | 本轮接通 | 原生 MCP 客户端负责；Homer 只约束配置和管理入口。显式工具列表，空列表仅发现 |
| config/mcpServer/reload | 本轮接通 | 修改保存后，安全的下一主轮采用；不热替换工作中的 Worker，不承诺原子刷新所有进程 |
| mcpServerStatus/list | 本轮接通 | 显示配置探针与当前主 thread 的连接、工具、authStatus；保存、发现和实际调用分开核对 |
| mcpServer/oauth/login | 本轮接通 | 原生 PKCE/state、回调、凭据存储。仅 loopback 假 OAuth 验证；真实登录需明确具体服务授权 |
| 原生 sessions/索引/缓存/日志 | 本轮接通 | HOME、CODEX_HOME、sqlite_home、log_dir及 file 凭据存储均绑定专属目录，实际落盘已验 |
| shell/apply_patch/view_image/shell snapshot、主审批 | 后续批准批次已验 | 专属引擎的工作区工具和按操作授权接通；旧日常HOME不自动采用。见27 |
| web/browser/computer/hooks/plugins/apps/cloud workflows | 后续实证 | 用户已批准按固定版本能力分批验证；未验证通路仍关闭，不仅打开flags。见27 |
| account/login/start、completed、read、cancel、logout | 已接通并发布 | 应用内“连接 ChatGPT”复用原生浏览器登录及存储/刷新；成功须原生状态确认。固定版本空HOME协议及合成全流程通过，真实授权由本人完成。见28 |
| 多供应商鉴权、旧订阅凭据迁移、统一账号系统 | 另阶段／不迁移 | 不复制/软链鉴权，不建鉴权代理，不索取 Token；旧rollout导入取消，开发环境登录后创建全新主thread。见28 |
| 原生 memories | 后续隔离验证 | 用户已同意四步验收通过后优先替代；当前仍关闭，现有记忆保留，不能双权威。见[替代准备](26-native-memory-feasibility.md) |
| 原生 multi_agent | 不替换 | 保持关闭，不增加第二个Homer业务管理者 |
| Homer Task/Run、队列、验收、publication、渠道收据/授权 | 不替换 | 继续由原服务/业务 SQLite 管理，六条 uncertain 不修改或重发 |

`config/batchWrite` 是唯一持久 MCP 写路径；不维护平行能力 DB、客户端或 Skill 加载器。Homer 文件 CRUD 仅管理 SKILL.md，解析与发现交给原生，未实现脚本/依赖安装器。

## 3. 目录、配置与更新保留

新配置默认应用目录：macOS `~/Library/Application Support/Homer`，其他平台 `~/.local/share/Homer`。可设 `appData` / `HOMER_DATA_HOME`；工作区与 runtime 默认分别为其下 `workspace`、`runtime`。引擎原生目录可用 `nativeCodexHome` / `HOMER_NATIVE_CODEX_HOME` 覆盖，默认 `<appData>/codex`。

| 内容 | 归属 |
| --- | --- |
| 原生用户配置 | `<nativeCodexHome>/config.toml` |
| 自建 Skill | `<nativeCodexHome>/skills/<目录名>/SKILL.md` |
| 原生 HOME | `<nativeCodexHome>/host-home`；隔离 `.agents/skills` 等宿主发现 |
| 引擎索引/缓存/会话 | `CODEX_HOME`、`sqlite_home` 均指向 nativeCodexHome；sessions、tmp、锁及原生 SQLite 留在该目录 |
| 原生日志 | 显式 `log_dir=<nativeCodexHome>/log`；测试同时观察到原生 logs_2.sqlite |
| 原生 OAuth/鉴权 | file store，原生负责专属 HOME 下凭据文件；Homer 不读取/复制/展示内容 |
| Homer 业务数据 | `<runtime>/homer.sqlite` 及原有附件/渠道/锁文件，不成为原生能力配置库 |

真实探针观察到 state_5、thread_history_1、queue_1、goals_1、logs_2、memories_1 等 SQLite 及 sessions/installation_id/tmp/thread-writer-locks 均在独立 CODEX_HOME。原生创建 memories_1 文件不代表记忆启用；进程配置与 thread memoryMode 都关闭原生记忆。

更新构建只打包源码与 UI，不复制应用数据。默认更新不删除 Skill、MCP、原生会话和 Homer 数据；缓存与诊断日志继续按原生失效/有界留存，不承诺永久保留全部正文。本轮不移动任何日常目录。安装目录不是默认用户数据根。用户主动将目录设到安装区时不能承诺安装器保留。

环境变量 `CODEX_HOME` 不再隐式影响新配置。**已有显式 `codexHome` / HOMER_CODEX_HOME 仍保持绑定**，防止迁移原账号或 thread。若其不等于 Homer 专属 nativeCodexHome，工具状态仍区分“只保存到专属配置、旧引擎尚未采用”；不会把配置写进日常 `~/.codex`，也不会把新能力偷偷接到旧账号/thread。

独立 HOME 与现有订阅鉴权/原主 thread 如何合法共存尚未证实。不能把隔离候选称日常生效，不能通过复制 auth、私有配置、记忆、无关历史或软链来消除差异。后续真实采用须先明确合法鉴权和维护授权。

## 4. 使用与采用状态

- 对话可要求“把这套工作方法保存成 Skill”“读取并修正这个 Skill”“停用某个 Skill”。主 Agent 在有效主轮作用域内调用自有 MCP；轮结束后的迟到操作拒绝。
- Web Skill 可新增、读取编辑标准文件、启停和移除。内容 hash 防覆盖；现有文件编辑完整 SKILL.md，不丢弃高级 frontmatter。目录 ID 与 frontmatter 的原生名称可以不同。
- MCP 表单接受绝对程序路径和 JSON 参数，或 HTTPS / 显式 loopback HTTP 地址。工具名逐项指定，地址禁止内嵌凭据、query/fragment；不接受 env、headers、密码或 Token。已有超出本轮可管理字段的配置显示需本机审阅，不自动扩权。
- 新建/改连接按“批准并保存连接”；原生版本过期时拒绝写入，刷新后核对再提交。查看状态分别显示配置连接检查与当前对话。工具目录出现不等于工具已调用成功。
- HTTP 服务可“开始账号授权”，由原生返回登录链接，用户自行完成后刷新。链接不进入模型结果或诊断。真实连接另获具体对象授权；不把假 OAuth 验证视为真实登录。
- 修改保存后标“等待下一轮采用”。下一主轮核对原生配置版本，必要时确认旧进程退出并恢复同thread（后台命令或空thread未可恢复时延后）；失败仍保留待采用，不能假称成功。配置中间被再次修改仍保留待采用标记。重连/重启仍须沿既有 owner/升级 guard。
- Worker 继续使用任务原授权；用户后续已批准专属引擎的新Worker使用Homer已授权MCP/自用Skill，实际双transport调用/正文加载及不能写主工作区见27。未实现版本库、按任务代理或运行中热替换；旧绑定不静默采用。

## 5. 已实证的原生限制

1. `features.skip_host_skill_discovery=true` 并不能排除 HOME 下 `.agents/skills`。因此专属 CODEX_HOME 之外还隔离进程 HOME。2026-10-20 候选取消原生会话对 `.system` 的统一 thread 禁用，系统 Skill 由 Codex 发现和管理；非原生能力分支仍保留原有隔离。
2. 固定 0.163 在 `skills/config/write enabled:false` 后，若仍显式发送原始 UserInput.skill，会加载正文。Homer `$name` 接线先从原生目录过滤 enabled 和专属路径；服务测试覆盖已停用、系统和外部路径。系统 Skill 与普通 Skill 同样只在已启用且来自专属 HOME/skills 时可显式选择；插件及外部来源的显式接线范围未扩大。原生会话不再追加系统 Skill 的统一停用配置，启停由 Codex 默认与用户配置决定。已进入历史上下文的旧正文不能据停用自动抹除。没有宣称原生启停可撤回旧知识。
3. 原生 reload 的采用状态属于具体进程/thread，保存成功不能证明工作中 Worker 或旧配置绑定采用。UI分别查询配置探针与主 thread；不人为合成在线状态。
4. stdio 进程不受模型文件权限沙箱约束。MCP程序的系统权限不因模型沙箱而受限；本批模型Shell/网络按27的明确工作区和原生本轮审批处理，不掩盖MCP自身外部副作用。
5. 真实模型自主选择、真实第三方 OAuth、订阅隔离、日常原 thread采用尚未验收；合成 Agent 决策明确为脚本。

## 6. 结构与维护

`src/native-capabilities.ts` 负责管理入口约束、原生配置 CAS、标准文件与 hash；`src/native-capability-tools.ts` 定义主专用工具。Engine 绑定 HOME/配置/原生 MCP，Service 保持主轮作用域、待采用标记、控制进程 lease 和关闭清理。只读管理进程使用 controlOnly，无模型 thread。管理操作计入升级 busy，失败启动可重试，不绕业务 owner。全量检查发现原宿主关闭会误套入正在结束的模型记忆scope；现由私有WeakSet记录真实宿主创建的Actor对象，仅这些对象可执行生命周期清理，模型字段不能伪造，模型/Worker记忆围栏保留。

已移除页面专用 HTTP／管理 IPC。原 `nativeCapabilitiesProtocol:1` 握手和只读 feature 字段保留原合同，但新 UI 不再消费它或显示入口，不借此开放管理写入。源代码 watch 的 gateway/deps/schema 保护保留，新候选不会被混成匹配日常的 UI。

源码入口：[engine](../src/engine.ts)、[service](../src/service.ts)、[native management](../src/native-capabilities.ts)、`ui/capability-settings.tsx`（历史页面，已删除）。现有 iLink/媒体/队列候选与简短记忆回执全部保留，不据本轮验收宣称 iLink 完成。

## 7. 可重复验证与实际结果

全部使用 Node22、项目固定 0.163.0、空 HOME、合成 Homer SQLite、Mock stdio 与 loopback HTTP。没有真实账号、模型服务或微信外发。原生 turn/start 只连接脚本内 loopback 假 Responses，正文载入与 Worker 隔离为真实原生行为，回答为固定假响应。

```sh
./node_modules/.bin/tsx --test tests/native-capabilities.test.ts tests/native-capabilities-service.test.ts tests/native-capabilities-web.test.ts
node --import tsx scripts/native-capabilities-acceptance.ts /absolute/path/to/codex
HISTORY_FOLLOWUP_BUILD=/absolute/path/to/web node --import tsx scripts/native-capabilities-synthetic-host.ts /absolute/path/to/codex
```

第三条是明确 opt-in 的合成可打开候选，端口4797，附带4798 loopback Mock MCP；不是生产启动命令。页面可试“演示用量”（脚本数字，不是实际消耗）、“保存示例 Skill”“修正示例 Skill”“停用示例 Skill”“启用示例 Skill”“调用合成 MCP stdio/http”。固定二进制之后的第二个参数可传其先前输出的 `synthetic-host-*` scratch目录，以原合成业务库恢复同 thread。不要指定真实 runtime 或日常配置。

| 检查 | 已观察结果 |
| --- | --- |
| 单元契约 RED→GREEN | 无主授权不写、CAS冲突、Skill正文hash/路径/原生名称与目录不同、主轮失效保护；本轮新增8项合成测试通过 |
| 实际固定 native | Skill发现/更新/启停/按需正文、stdio/HTTP目录与实际调用、MCP启停移除、显式空工具范围拒绝调用、假OAuth code/token回调及鉴权后实际echo、原合成thread恢复、Worker继承关闭均通过 |
| 五 MAIN_TOOLS | `e6d674a05ae34945a5e234a2b1f55029f0d319e51371f448911845224062cf9a`，前后相同 |
| Web | 实际浏览器新增Skill和stdio、对话创建修正启停、同bridge原生echo；605/1470无溢出、44px控件；HTTP与stdio实际调用、并发CAS拒绝、刷新/合成重启同thread同12条历史均通过；Web假OAuth显示已登录，下一主轮后原thread连接状态connected/oAuth且pending清除 |
| 构建/类型 | `npm run build`、`tsconfig.check`、UI typecheck局部通过；Vite已有大包警告保留 |
| 原记忆回执/来源与工具目录回归 | 局部通过；未替换CTO简短回执修复 |
| 全量检查 | 本次明确获准后实际执行。首次发现旧MCP夹具漏列工具及宿主关闭记忆scope错误，终止停滞测试退出1；修正后39项通过。随后379/380、退出1，定位另一份Telegram目录夹具并专项修正；最终完整命令380/380、退出0。历史启动前Rejected不计退出码 |

临时证据只放 `.codex/scratch/native-capabilities-implementation/`：原始源码指纹、差异、native-acceptance-checks.json、浏览器截图及独立停止图标构建清单。维护文档和验收脚本为可重建依据，不依赖忽略目录作为唯一产品契约。


### 本轮检查纠正与发布结论

- 第一次完整check已启动，发现模拟工具目录过期；另两停止场景停滞，主动终止本任务测试进程，实际退出1。复制到独立scratch的诊断夹具第一次因Unix socket路径过长退出1，缩短相对路径后复现真实 `tool_scope_denied`，不把夹具路径错误归给产品。
- 宿主关闭错误是既有候选记忆scope将宿主清理误视为模型操作；修正真实宿主Actor识别后，原停止、主结果记忆scope、恢复、Web继续回复等39项通过。只给真实宿主创建的对象记录私有WeakSet，不接受模型传入host标记。
- 两份旧协议夹具分别补齐主MCP现有目录（包括本轮capabilities及此前quote_current_message/prepare_combined_delivery），没有删除权限断言。Worker目录仍不含capabilities/记忆/publication。
- 最终 `npm run check` 退出0，380测试全通过；native验收脚本另用固定二进制通过。完整log在scratch `full-check-complete.log`，失败记录另存，均为合成输入。
- 停止图标独立兼容补丁已正常构建、重建及实际点按，尚无安全运行期注册入口；精确限制与后续最小工作见[21的停止补丁记录](21-ilink-implementation-validation.md)。不替换旧hash资产、不重启日常。
- 日常只读复核仍为后端9ab6864a6c45、UI6bb20b7f14f5…、原thread01a1437f-9fcd-7950-9e8b-c6f96f7f61f0。MCP/Skill候选没有在日常采用，不宣称iLink候选完成或已发布。


## 8. 用户确认的三项补充验收（2026-10-17）

### 流式、中断、追加与用量

沿原Engine的native通知流、turn/interrupt与turn/steer。固定0.163真实二进制连接loopback假Responses，已实证完成前收到正文delta、活动turn接受steer并回原turnId、中断收到interrupted终态。steer RPC受理不等于模型理解或Worker采用；Web连续发送依然默认排队，“打断并发送”仍先持久接收再停止准确generation，不把它改成steer。

Web新增折叠“用量”，从原有mainUsage读取白名单数字，不新增计数库；仅主对话累计与最近一次模型请求，缓存/推理输出是其中的分项，不能再次加算为费用。无有效数字时隐藏；无实际引擎报告不估算账号余额或价格。流式正文、停止待确认、打断/排队反馈保留，不展示内部工具流水。新测试实证迟到的用量通知可覆盖已结束轮次；现Engine仅接受活动turn用量，错thread、旧turn、结束后的通知都拒绝污染。

### 原生OAuth存储隔离

假OAuth登录由native生成PKCE/state及callback，Homer不读取凭据正文。已验证同一专属HOME重启后仍显示oAuth且实际echo成功，token端点仍仅交换一次；另一新空HOME配置同一个loopback服务后显示notLoggedIn，未产生凭据文件。仅检查合成凭据文件存在/大小，不解析或复制；未使用钥匙串或搭建Homer凭据库。真实订阅auth与原主thread隔离仍未解决，不能据此宣称真实账号已隔离可迁。

### 路径、更新保留与有界留存

| 类别 | 固定版本核对 | 本轮证据及保留规则 |
| --- | --- | --- |
| 原生会话 | `<nativeCodexHome>/sessions/<日期>/rollout-*.jsonl` | 实际thread/read返回该路径，同合成thread重启恢复；更新不迁移/复制日常会话 |
| 索引 | `<nativeCodexHome>/state_5.sqlite`、thread_history_1及其它原生库/WAL | 实际生成，sqlite_home由有效config/read确认；不成为第二业务库 |
| MCP OAuth | `<nativeCodexHome>/.credentials.json`、mcp-oauth-locks | 只stat合成文件，重启复用及另一HOME未登录实证；不读取真实auth |
| 临时缓存/锁 | `<nativeCodexHome>/tmp`、thread-writer-locks | 实际生成；tmp内原生apply_patch程序链接仅记录、不跟随，不代表开放该模型工具；操作系统临时目录不属于持久会话数据 |
| 模型目录缓存 | `<nativeCodexHome>/models_cache.json` | 固定二进制basename与同tag源码路径核对；本轮无账号探针未产生远程模型缓存，未冒称实际生成。原生单快照覆盖，TTL300秒并校验版本/身份；过期失效不等于立即物理删除 |
| 诊断日志 | `<nativeCodexHome>/logs_2.sqlite`，配置log_dir=`<nativeCodexHome>/log` | 实际SQLite产生；本stdio运行未产生log目录文件，stderr直接丢弃，Homer不落原始引擎诊断正文 |

固定版本日志原生在启动及每30分钟做年龄/占用清理：默认10天，64MiB占用预算，超预算缩短窗口，最近1秒仍保留，SQLite空页复用不代表物理文件必缩到64MiB。不是永久归档或严格磁盘硬上限。实际新合成日志库种入11天前和当前两条标记，再由native重启：旧条被删、新条保留；未等待30分钟或压力验证全局预算。模型缓存和日志继续复用原生规则，不另建清理数据库或触碰会话文件。

原生依据：[0.163模型缓存路径/TTL](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/models-manager/src/manager.rs)、[缓存版本与身份校验](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/models-manager/src/cache.rs)、[日志定期清理](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/state/src/runtime/logs_maintenance.rs)。这些源码说明与本机实测分别记录，不能当成当前真实账号的落盘证据。

`scripts/native-data-update-acceptance.mjs` 使用正常buildCandidate创建隔离构建，并用8类新合成标记核对配置/Skill/会话/索引/缓存/日志/Homer库/工作材料；成功构建及故意不支持的tsconfig失败清理后，文件hash均不变且未被打包。该测试的SQLite/缓存是保留标记，不伪称真实引擎解析。应用升级不等于备份或恢复全部日志，也不授权迁移现有日常数据。

```sh
node scripts/native-data-update-acceptance.mjs
./node_modules/.bin/tsx --test tests/native-usage.test.ts tests/web-engine-stream.test.ts tests/engine.test.ts tests/web-service.test.ts tests/recursive-main-inputs.test.ts
```

本轮扩展检查：实际浏览器用量展开/收起、刷新后数字保留并默认折叠、605/1470无溢出且输入框可见；上述局部27/27、正常build与typecheck退出0；固定native扩展验收退出0；新增接线后完整`npm run check`再次通过382/382，退出0。此前380/380是上一候选基线，不替代本次结果。临时记录为confirmed-native-followup/，路径清单native-persistence-paths.json只记录新合成HOME的文件名、类型与大小。首次全路径断言误将原生tmp里的程序链接视为外部数据链接，夹具退出1；改为不跟随扫描后退出0。另一次隔离缓存探针未观察到目录请求，缓存生成断言退出1，故不计为缓存生成通过；恢复不需鉴权的验收链后再次退出0。无此探针的产品默认不变。


## 2026-10-20 系统 Skill 复用修复候选

原生会话不再把 `skills/.system` 全部追加为 `enabled:false`；继续传递原生有效 `skills.config`，不强制开启任何项目。main 与 Worker 共用的新建／恢复路径均覆盖；非原生能力的专属 HOME 隔离分支和旧共享 HOME 防线保持。主服务显式 `$name` 可选择同一专属 HOME/skills 中已启用的系统项，保留 `enabled` 与原目录来源检查，不扩大插件或外部来源范围。

新增 `scripts/native-system-skills-probe.ts` 以明确传入的固定 0.163.0 二进制、全新临时 HOME、loopback 假 Responses 验证真实原生发现、解析和加载，不使用真实账号或模型。main／Worker 各发现 5 项系统 Skill，其中 4 项允许隐式调用；原生 `allow_implicit_invocation:false` 仍受尊重，已启用的显式项可加载正文。合成旧 blanket override 可通过关闭测试子引擎后正常 `thread/resume` 恢复同一 ID，真实用户停用的系统／普通项仍被停用。

本候选不自动迁移真实会话。采用后应走现有安全生命周期，在空闲时以同一 thread ID 冷恢复，让新的有效用户配置替换旧宿主覆盖；未证明对正在加载的旧引擎仅发一次 warm resume 即可清除覆盖。若停用实际保存在用户 config.toml，则不能仅凭 `false` 区分来源：保留该值，只在用户明确选择后使用受支持的 `skills/config/write` 修改单项。停用和恢复不删除历史上下文中的旧目录或已加载正文。以上为候选隔离验证，不是日常账号采用或真实模型决策验收。

首轮发现／启停修复的服务／UI 构建及类型检查通过，相关回归 38/38 通过。该轮固定范围快照的全套测试为 544 项：528 通过、14 失败、2 跳过；14 个失败项均在原 402 文件基线按名称复现，涉及未复制的打包／示例／私有媒体运行库、基线 `.DS_Store` 计数和既有编译超时。没有为本修复安装运行库、删除基线内容、调整时限或改测试规避失败。

### 同任务追加：完整用户 Skill 包

原生能力会话的沙箱现在只将专属 `CODEX_HOME/skills` 用户包目录改为可写，同时对 `skills/.system` 增加更具体的只读规则。HOME 其余部分仍 deny，plugins 仍 read，运行库、执行文件和账号控制数据继续保护；非原生能力分支仍只读。若 skills 落在其他保护根（运行库、插件、执行包或浏览器数据）之下，或 skills／.system 本身为链接，配置以 `engine_native_skills_path_protected` 拒绝，不能靠更具体 write 重开保护祖先。内置 Creator／Installer 继续使用自己的完整目录机制，`skill_save` 保持兼容单文件入口，不新增 Homer 安装器、资源 CRUD 或来源授权。

主／Worker 的原生文件审批只为同一专属 skills 下的用户包路径豁免外层 HOME 保护，不允许整个 skills 根、.system、plugins、配置、运行库及其祖先授权；移动请求同时检查源和目标。检查原始路径及实际磁盘路径，拒绝包路径中的符号链接（含悬空链接）及包外别名，macOS 大小写别名使用 `realpathSync.native` 归一。原有真实用户待答卡、回执先持久化、当前轮有效性和防模型自批均保持；文件权限例外不能代替来源审查或授予额外安装授权。原有 file_checkpoint 仍保护整个 HOME。

`scripts/native-skill-writes-probe.ts` 在固定 0.163.0 的空临时 HOME 中，对 main／Worker × start／resume 使用真实 `command/exec permissionProfile:homer` 验证内置 Creator 创建和多文件更新、scripts／references／assets／agents 元数据，以及内置 Installer 的本地合成源校验、复制、执行位保留和脚本执行。仅替换 Installer 的远程下载准备函数，不访问外网或安装真实第三方 Skill；覆盖用户停用保留、拒绝已有包覆盖、包外源链接、受保护目标写入、符号链接与大小写别名、保护目录及其祖先重命名。普通工作目录原有写权限未缩小；本检查不宣称任意工作目录都是禁止的越界目标。

此原生探针证明实际固定版本沙箱和脚本行为；合成服务测试另证真实用户卡与主／Worker 接线。`command/exec` 是独立原生执行 RPC，虽在新建／恢复线程后运行，不能等同于真实模型自主调用 Creator／Installer 或日常服务验收。旧 thread 的冷恢复结论仍按上文执行，本候选不改真实账号、线程、配置或日常服务生命周期。
