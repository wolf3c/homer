# Homer 专属登录与全新主对话

2026-10-23：开发测试用 ChatGPT 连接／退出界面与能力页已从维护源码删除；本次没有登出或删除认证。正式认证方案另议，以下登录入口和发布回执仅为历史记录，不再是当前操作指引。当前边界见[移除说明](2026-10-23-remove-capability-settings.md)。

**最新能力直接开放批次见[29](29-native-capability-activation.md)**：用户已要求移除额外的一刀切功能禁用；本页早期手动开关/未采用状态仅对应历史阶段。固定原生默认/配置/能力发现为准，具体操作审批与网络边界保留。

更新：2026-10-18（Asia/Shanghai）。**开发环境不迁移旧对话，在 Homer 专属 Codex 目录创建全新主对话。旧 rollout 导入已取消。本人登录改用应用内浏览器入口；原生 Codex 自己保存和刷新认证。**

**当前实际状态（2026-10-18 10:35，Asia/Shanghai）：本人浏览器授权已由固定原生 account/read 确认；已按补充批准完成专属目录切换，日常版本 `c72dc2e523a7`，新主thread `01a14cdb-1d34-7600-b067-2f1eb4928132`。旧历史、记忆、渠道和六uncertain保留，无旧内容导入或重放。** 原Terminal及正常自动更新入口继续运行。新空thread首次真实消息前保留resumable保护；详见文末实际维护回执。以下方案与早期发布记录按发生阶段阅读。

## 历史开发测试登录入口（已移除）

此前测试版由 Homer 能力设置点击 **连接 ChatGPT**，在新打开的原生登录页用本人 ChatGPT 账号完成授权，然后回到 Homer。若浏览器拦截新窗口，点击页面上的“打开 ChatGPT 登录页”。页面通过原生状态查询确认后才显示“已连接 ChatGPT”。无需把验证码、Token 或登录页内容发给助手。

登录完成前可以取消；超时会尝试原生取消一次，不持续重试或自动重复打开浏览器。“核对登录状态”由 Codex 检查并按原生规则刷新认证。“退出 ChatGPT”需页面内再次确认，退出结果也由原生状态核实；不删除对话、记忆或渠道。业务工作未结束时不允许退出。登录完成但当前主对话尚未切换时，页面明确提示此区别。

复用固定 `codex-cli 0.163.0` 的 `account/login/start {type:"chatgpt"}`、`account/login/completed`、`account/read`、`account/login/cancel`、`account/logout`。同一个原生管理进程处理 Skill/MCP 与账号操作，不另建 OAuth 客户端、凭据库、刷新程序或业务数据库。用户操作走既有同源 Web 防线，模型不能发起账号登录或退出，认证 URL/账号内容不进入模型；返回界面只保留认证类型、布尔状态和有界登录操作信息，不转发 email、plan 或原始错误。

原生 CODEX_HOME 为 `~/Library/Application Support/Homer/codex`，进程 HOME 为其中 `host-home`，SQLite/log/file 凭据存储位于专属目录；不继承 API key、代理或全局 Codex 配置，不读、复制或软链原凭据，不用内部 `chatgptAuthTokens` 注入。登录本身不调用模型、不建 thread、不改变日常绑定。等待本人登录时阻止后台更新交接，避免切断原生回调；取消或完成后恢复安全空闲判断。

此前 Terminal 设备码窗口已结束，不再是默认入口。维护脚本 `scripts/native-account-login.mjs ... status` 仅保留脱敏原生状态核查与显式故障备用入口，不要求用户操作旧设备码，不自动打开终端或无限重试。

## 浏览器入口验证与发布

- 稳定契约先 RED（模块不存在）后 GREEN；账号生命周期、原生通知、Homer 宿主授权和管理进程复用均有行为测试。覆盖成功仍须 account/read、取消、失败、超时一次取消、迟到/错 ID 通知、提前通知、未知状态清除旧成功、启动未确认、非法 URL、重启状态复用及退出未确认。
- 固定 0.163.0 在独立空 HOME 的无模型协议探针退出0：原生 browser authUrl、取消、退出、重启后 refreshToken 状态查询全部确认。未打开真实授权页、未完成本人登录、未建模型 thread。
- 合成原生子进程 + Homer/SQLite + 本机浏览器实点成功、取消、刷新恢复等待状态、失败、退出二次确认；605/1470宽度无横向溢出。该阶段尚未真实认证；后续本人授权与专属切换已完成，见文末。
- 最终 `npm run check` 退出0：422项，420通过、0失败、2既有跳过；最终聚焦16项退出0。首次全测中10个临时目录缺失属于夹具问题，补齐夹具父目录后重跑通过；没有放宽产品断言。
- 本批只增加账号 UI、原生通知和宿主接线，不改 schema owner、五 MAIN_TOOLS、Web protocol/gateway、依赖、Homer 配置或当前 thread。使用正常后台构建、安全空闲交接与既有失败回退，不关闭自动更新。

发布实际版本、资源与数据保留回执在下方追加；未完成本人授权不得继续真实专属主对话切换。

## 最小开发环境切换方案

代码核对与真实业务库**只读副本**预演表明，无需清空旧库、换主管理者或重建渠道。实际切换仍以本人原生 ChatGPT 登录确认、临近自然空闲、备份及正常停机为前提。

| 对象 | 拟执行动作 | 保留范围 |
| --- | --- | --- |
| Homer配置 `codexHome` | 改为已准备的专属目录 | workspace/runtime/模型/effort/渠道配置保持 |
| `meta.mainThread` | 停服后仅解除当前指针；原生 `thread/start` 创建新主 thread，Homer再写入新ID | 旧ID及旧值留在私有维护清单与完整备份；不读/导入旧rollout |
| `meta.mainUsage` | 停服后清除旧当前用量投影，新主会话由原生 usage 更新 | 旧值保存在维护点；不把旧用量当新主会话用量 |
| `meta.mainAgentId` / `mainToolsHash` | 不变 | 唯一 Homer 业务管理者、原五工具定义及原Task/Run归属保持 |
| `conversation_inputs/messages/attachments` | 不改、不删、不搬到新ID | 旧历史仍归旧thread；新对话起始为空，旧请求ID重试明确冲突 |
| `agent_messages/receipts`、`operations`、`requests` | 不改、不删、不重放 | 旧队列仍为原管理者的终结收据，requestId与原历史thread关联保留；新请求才归新thread |
| 全部自建记忆表与owner/epoch | 不改 | 现有记忆由同一Homer提供；原生memory继续关闭，没有双权威 |
| `wechat_*`、transport、任务/成果/publication/媒体等其他表 | 不改 | 渠道绑定与收据保留；六条uncertain不重发、不改派 |

旧队列投影目前按 Homer 管理者读取，属于持久业务收据；界面仅在当前 thread 的消息上按 requestId 显示相应队列状态。切换必须先排空一切待处理/处理中/uncertain/blocked主队列及内部回执，不能靠修改状态制造空闲。旧终结行继续保留。`ConversationHistory.accept` 阻止旧requestId被新thread接纳；旧历史不会作为新主对话上下文重新发送。既有自建记忆按用户明确要求继续提供，是保留范围。

微信回复恢复只查当前 `mainThread` 的历史，因此新thread没有旧回复可重放；底层outbox六条uncertain仍保留。Telegram另有 `tg_connections.conversationId` 强绑定，若存在旧绑定，当前方案必须停止并另给精确重绑定审阅，不能静默改表；本次日常副本该表为空。

## 已完成的隔离验证

维护源码 `scripts/native-fresh-main-preview.ts` **只有离线副本入口，没有真实 apply/reset/引擎启动入口**。使用新目录、一致性只读备份、私有权限、同一Store/history/queue/Memory实现；只在副本解除上述两个meta绑定，再写明确的合成占位ID检验行为。这个占位不是真实Codex thread。

- 新增4项行为契约 RED（缺实现）→GREEN，覆盖历史/队列/记忆保留、旧待处理请求拒绝、旧Telegram绑定拒绝、输出范围及禁止覆盖输入。
- 2026-10-18 08:19日常库副本预演退出0：**55张业务表行数及逐表hash、schema全部相同**；仅 `mainThread/mainUsage` 两个meta值变化。旧50条历史、14条终结队列保留；新历史为空、claim无旧任务、跨thread旧requestId拒绝、现有记忆快照相同。quick_check=ok、FK=0，离线回退副本字节相同。
- 同一预演检查待处理请求、Run、Task、回执、审批、operations、publication、历史处理状态、微信/Telegram收发和遗留待出版共15类，全部为0；Telegram旧绑定数0。副本中保留的历史驻留lease不用于真实进程操作，不能代替维护时锁释放检查。
- 旧scratch维护入口已彻底移除停机/导入/改配置动作，只允许查登录状态；尝试 `import` 退出1，错误 `old_rollout_migration_cancelled_use_fresh_main_plan`，在任何数据操作前拒绝。旧单rollout工具仅保留为此前**新合成HOME**历史研究实现，本方案不用。
- 登录入口原4项合成回归已通过，覆盖最小环境/专属HOME、状态脱敏、目录/软链拒绝、API-key不冒充订阅。最新本人登录实测仍未完成。
- 新维护脚本及测试的TypeScript检查退出0；相关登录、队列、流式及新空thread更新保护等**25项聚焦回归全部通过**。日常版本/配置/完整UI资源/原thread/六uncertain保留核验退出0，没有无故重跑此前396项完整检查。

私有材料只在 `.codex/private/native-home-adoption-20261018/`（0700、文件0600，command0700），已核ignore。`fresh-main-readiness.sqlite`、`fresh-main-offline-preview/` 均是副本；真实库未改。证据只输出状态/计数/hash，不输出旧消息或记忆正文。临时日志在 `.codex/scratch/native-capabilities-expansion/`。

## 登录确认后的顺序与完成检查

1. 用原生 `account/read` 确认本人ChatGPT登录；未完成就保持日常运行，不做真实切换。无需旧rollout导入或再次批准旧迁移。
2. 核最新准确launcher/Terminal归属及源码/配置CAS；两次临近自然空闲检查主轮、Worker、全部队列/待答/待审/publication、transport与渠道发送。忙就等待。新维护点保存原配置、原meta值、完整构建清单、业务/transport一致性备份，不备份auth/Keychain。
3. 只正常停止准确归属launcher，确认全部归属进程退出、两锁及lease释放。停服后重新备份并重做此离线预演；期间新请求或旧绑定变化均拒绝继续。不得用旧PID或强杀制造维护条件。
4. 正常停机后按文末补充批准范围CAS更新业务 `binding`、解除 `mainThread/mainUsage`，同步网关 `binding/thread`，再更新Homer配置 `codexHome`；原Terminal启动正常自动更新入口。由Homer固定原生引擎创建**唯一的新主thread**，不提交测试消息、不重放历史。若新的耦合要求改动其他表，停止并先给具体审阅方案。
5. 核新ID与原ID不同、新history为空、专属HOME真实采用、Skill/MCP原生发现/加载与连接状态、旧历史及六uncertain hash、现有记忆、微信connected、schema及其他表保留。原生能力按固定引擎/模型实际发现使用，不用人工功能白名单代替发现；功能可见不构成新登录、付费、安装、外发或新增操作权限授权。
6. 核停止icon及资源hash、正常后台构建/安全空闲更新/失败回退。浏览器刷新前先保护草稿、等主轮结束。新空thread在首次真实用户轮持久化前不能恢复，既有 `resumable` fence会延后自动交接，不伪造首轮；完成用户首轮后再核同新thread恢复。手机表现和真实模型自主调用未实测时继续单列，不用合成证据冒充。

此前仅改 `codexHome` 已正常构建的候选 `396017c28a57` **尚未激活**；完整hash `396017c28a57e4c1672590be001767c41d71f00f8d627f2e15ffbf66dcf1f032`，与日常同UI/依赖/schema/gateway/原五工具。切换时仍重核指纹和实际代码，不直接信任历史候选。新安装 `loadConfig` 已默认专属appdata/codex，不采用本机旧显式配置。

## 回退界线

没有新业务事实时，正常停止新准确归属进程并确认锁/lease释放，核全部业务表/schema/CAS后，可以恢复原Homer配置、维护点中的 `mainThread/mainUsage` 两个原值，以及本次补充批准的业务 `binding` 和网关 `binding/thread` 原值，原Terminal启动正常入口；**不覆盖业务库、不删除新登录凭据、不删除旧数据或整目录**。仅创建空thread不允许无限重试；先保留故障证据。若该thread尚无持久化rollout，回退不能依赖恢复它。

出现新的用户输入、任务、记忆、渠道收据或外发事实后，只前向修复，不能套旧DB、旧meta或旧对话绑定。实际维护回执必须记录新ID、开始接收新事实的界线及原数据保留核对；当前尚未执行这一步。

## 登录入口实际发布回执

2026-10-18 09:04（Asia/Shanghai），日常4780已通过**原后台构建→安全空闲自动交接**发布：

| 核对项 | 实际结果 |
| --- | --- |
| 业务版本 / 完整源码指纹 | `6b2d91e39213` / `6b2d91e3921321f30b088dd567e39f014207d921552672a65876e9ea9a4d0d50` |
| UI 完整指纹 | `3f948c14e3ed38b3ed01bfccdab1d198452ce36a1587f85e33d21478ea873086` |
| 原启动器 / 日常宿主 | 原 launcher17319、原Terminal `ttys000` 保留；宿主20953→85245，正常自动交接，没有手动杀进程 |
| 原主 thread | `01a1437f-9fcd-7950-9e8b-c6f96f7f61f0`，未更换或导入 |
| 原业务数据 | 55张业务表；54表逐表hash不变。`wechat_connection`只变 `generation`；绑定及所有其余字段逐字段相同，schema不变 |
| 六条 uncertain | 六行身份与整行hash全部相同，没有重发 |
| 记忆 / 渠道 | 现有自建记忆不变；微信connected；无新模型测试或真实外发 |
| 配置 / 原五工具 | Homer配置字节不变；工具hash仍为 `e6d674a05ae34945a5e234a2b1f55029f0d319e51371f448911845224062cf9a` |
| 资源 / 浏览器 | 实际index、JS、CSS逐项hash匹配；日常605/1470设置页均显示“连接 ChatGPT”且无横向溢出，刷新前确认无草稿/主轮 |
| 实际认证 / 采用 | 原生 `account:none / connected:false / phase:idle`；`boundToNativeHome:false`。没有打开真实授权页、复制凭据或创建新thread |

发布前两次自然空闲与准确进程归属检查通过。私有新维护点 `.codex/private/native-account-browser-release-20261018/` 保留业务与transport一致性备份、原配置、精确差异/CAS、原源文件、前后完整构建资产清单与逐表差异回执，目录0700、文件0600；不含auth、Keychain或旧rollout。维护中未变DB schema，没有套用旧数据库。原自动更新的失败回退和忙碌延后保护继续使用，没有改guard、固定入口或新建重启任务。

发布核验最初将正常变化表名误写为复数，核验退出1；逐表审阅确认真实单数表 `wechat_connection` 只有 `generation` 变化，补上去除该字段后的全部行严格相等检查后退出0。产品数据与保护未为此修改。浏览器自动化的首次fill参数不匹配已改为实际type动作，合成停止交互随后实点通过：icon文字为空、44×44、aria/title完整、发送独立、停止后消息“已中断”；日常不点击真实停止或发送测试消息。

**09:04发布时的后续步骤（现已完成，当前状态见文末）：** 打开上方能力设置，点击“连接 ChatGPT”，完成本人浏览器授权，等待页面经原生查询显示已连接。此时才按本页自然空闲、备份、正常停止、只更换当前thread/usage的方案推进新主对话；不迁旧内容。当前服务保持运行供本人使用，这是09:04时状态，后续专属主对话切换已完成，见文末。


## 授权成功后的归属绑定复核（已批准并执行）

原生已确认本人 ChatGPT 授权成功，没有读取或输出凭据、email、plan；没有重复发起登录。最新日常仍为 `6b2d91e39213`、原主thread，Terminal7325实际tab仍为 `/dev/ttys000`。

原方案只解除 `meta.mainThread/mainUsage` 的副本研究保留有效，但没有验证改变 `codexHome` 后的完整宿主启动。复核发现：

- `src/service.ts` 构造函数以 workspace/codexHome/baseUrl/keyEnv/requiresOpenaiAuth 计算现有 `meta.binding`；只改配置会触发 `runtime_configuration_changed`。
- `scripts/dev-ingress.mjs` 验证 `transport_meta.binding`，并将 `thread` 固定至原主thread。只更换业务meta会触发 `gateway_binding_conflict` 或 `gateway_thread_conflict`。
- 这些保护应继续保留，不能通过关闭校验、换库、清空请求或伪造hash启动。启动前必须在正常停止、锁释放、排空与备份后同步同一归属。

具体补充如下，其余授权维护步骤不变：

| 存储 | 原计划 | 必须补充的最小变化 |
| --- | --- | --- |
| Homer配置 | 仅 codexHome 指向专属目录 | 不增加其他有效配置变化 |
| 业务库 meta | 解除 mainThread/mainUsage，由Homer创建并保存新ID | 额外将现有 `binding` CAS替换为目标配置按原代码公式生成的真实hash；bindingVersion保持2，mainAgentId、tools、记忆及全部业务表不改 |
| 网关 transport_meta | 原计划漏列 | 现有 `binding` CAS替换为正常目标构建的真实boundary；仅解除旧 `thread` 指针，由正常启动器绑定唯一新ID；contract保持原schema/tools |
| 网关请求表 | 保留 | 本次预演0行；执行时必须仍无pending/rejected/inflight，全部请求/收据不删除、不重放 |

补充不是新增业务字段或schema迁移，没有额外业务库、账号系统、能力代理或保护例外。**业务元数据额外1项、网关归属额外2项；本人在补充问题中明确选择“批准同步三项归属字段”，本次已按此执行。**

### 已准备的具体候选及副本实证

目标 `c72dc2e523a7` 经正常 buildCandidate 构建，唯一有效配置差异为codexHome；同UI `3f948c14e3ed38b3ed01bfccdab1d198452ce36a1587f85e33d21478ea873086`、deps/schema/gateway/MAIN_TOOLS/Web protocol。真实boundary由构建产生，不手写替代值，不允许任意路径。源码没有产品改动，原dirty工作保持。

新私有维护点 `.codex/private/fresh-main-switch-20261018-reviewed/` 目录0700、文件0600，已有原配置、前后构建/完整资源清单、业务/网关一致性备份和 `binding-plan.json`；不含auth、Keychain、Codex会话。预演在新副本应用上述精确字段：55张业务表逐表hash、全部transport请求行、其余meta相同，quick_check=ok、foreign_key_check=0，没有创建native thread或真实模型调用。目标配置准备于原配置同级私有目录，确保原相对路径语义不变。

最初预演把目标配置放在维护子目录，相对workspace/runtime解析发生变化；构建检查以 `nonhome_config_change` 退出1，在备份及真实变更前拒绝。修正到原配置同级目录后退出0，明确只codexHome变化；失败准备目录仅为新建私有空目录，没有日常变更。

### 确认后的执行及回退界线

两次最新自然空闲与原生状态确认后，正常停止准确launcher与全部所属引擎，确认两把锁及全部lease释放，再制作停后备份并重做副本预演。真实写入前CAS核源配置、原主thread、两个binding、schema/tools、所有业务事实与空网关；只更新上表元数据与配置，逐阶段落私有回执。配置/两库不能作为一个跨文件事务：停服内分阶段核验，任一步未确认不得启动或重复创建thread；先依据阶段和原值核实/回退。真实创建只由正常启动Homer执行一次，未知结果不得重试多建thread。

无新事实时，正常停止新准确进程、锁释放后，依维护点CAS恢复原配置、mainThread/mainUsage及这三项原归属值，其他业务事实与schema必须仍与维护点一致；不覆盖整库、不删除本人凭据或新旧会话。出现新输入、任务、记忆或渠道收据等新业务事实后只能前向修复，不能套用旧绑定或快照。空thread未持久化前仍保留resumable fence；不伪造首轮来换版或测试恢复。


## 专属目录与全新主对话实际维护回执

2026-10-18 10:33–10:35（Asia/Shanghai）已完成一次受控切换；未重复发起登录，未复制auth/Cindy凭据，未读旧rollout或其他Codex会话。

| 核对项 | 实际结果 |
| --- | --- |
| 业务版本 / 完整源码指纹 | `c72dc2e523a7` / `c72dc2e523a748344738cc758e17527504b6d760d81ceb5555b91d7b6e34c97c` |
| UI | `3f948c14e3ed38b3ed01bfccdab1d198452ce36a1587f85e33d21478ea873086`，与登录入口版本相同；实际index及JS/CSS逐项hash相符 |
| 专属原生目录 | `/Users/wolf3c/Library/Application Support/Homer/codex`，`boundToNativeHome:true`；固定0.163.0初始化同时校验真实codexHome与版本，SQLite/log/HOME及原生凭据存储沿既有专属配置 |
| 本人授权 | 旧管理进程和重启后的专属管理进程，均由原生account/read确认 `chatgpt / connected:true / phase:idle`；未以文件存在作为认证证据 |
| 新当前主thread | `01a14cdb-1d34-7600-b067-2f1eb4928132`，唯一一次正常Homer启动创建；网关与业务指针一致 |
| 原thread | `01a1437f-9fcd-7950-9e8b-c6f96f7f61f0`不再是当前thread；原50条历史及原14条终结队列保持原身份，未搬入新对话、不重放、不删 |
| 业务数据 | 55张业务表，54张逐表hash不变；`wechat_connection`只因正常关闭/启动变generation，绑定和其余字段严格相同；schema不变，quick_check=ok、FK=0 |
| 精确持久元数据 | 业务库仅binding/mainThread/mainUsage变化（生命周期lease另行按真实进程记录）；mainAgentId、五MAIN_TOOLS及记忆owner/内容等不变。网关仅binding/thread变化，contract及请求行保持 |
| 六uncertain / 渠道 | 六行身份和整行hash不变、无重发；微信connected，没有新增业务外发。正常渠道start/stop握手仍由既有实现处理 |
| Skill / MCP | 原生发现当前专属自用Skill=0、外部MCP配置=0，未安装测试连接。宿主homer_interactions原生目录在主引擎ready前通过精确工具集校验；不把空配置称为已实测外部服务调用 |
| 实际工具 / 模型 | 新主引擎已采用Shell、view_image、shell snapshot；其余未验能力保持既有边界。原生model/list返回9项，当前 `gpt-6.1-sol / medium` 均列出；未切换模型，没有模型turn |
| 真实进程 | 原Terminal7325、原shell47294、`ttys000`；旧launcher17319/host85245正常退出，新正常launcher94963、host95085。非任务临时进程、非固定维护入口，没有新保活/重启任务 |

维护前两次最新自然空闲检查通过：主轮/Worker、队列、待答/审批/回执、Task/Run、publication、微信/Telegram收发、transport等全部无待处理；原生认证成功。正常SIGTERM仅发给精确launcher，全部所属进程退出，两把锁和全部lease释放。停后重新做业务/transport一致性备份和副本预演：55表保持、回退副本字节相同、quick_check=ok。之后才按补充批准的归属值执行CAS，配置最后替换；只有codexHome有效配置变化，产品源码/依赖/schema/gateway/UI没有改动。

新私有维护点 `.codex/private/fresh-main-switch-20261018-reviewed/` 保留原配置、binding-plan、停前/停后备份、完整构建资源/依赖清单、原版本严格回退manifest、逐阶段CAS回执和 `fresh-main-release-receipt.json`。目录0700、文件0600，启动command0700，ignore已核对。没有备份auth、Keychain或原生会话。操作为单次阶段入口，回执flag:wx拒绝覆写；不能重跑创建新thread。程序更新仍保留专属原生用户数据；已有业务runtime按本次限定范围保持原路径，新安装仍默认全部Homer应用数据目录。

### 验证与未采用的测试手段

- 正常目标构建退出0；与此前420通过/2跳过候选相比没有产品源码变化，因此没有无故重跑整套check。
- 新增本轮有界聚焦回归退出0：19项全部通过，覆盖原数据副本、新空thread交接保护、原生流式与停止、网关身份/队列及实际子进程Web更新交接；测试均为合成引擎/数据，未接入真实账号或渠道。
- 日常605/1470能力页均真实渲染已连接、Shell/图片查看已采用，旧目录提示消失，无横向溢出；主页面显示新对话起始，未点击停止或提交测试消息。原停止icon代码与完整UI资源不变，本次无需停止真实回复验证。
- 仅查询**唯一新thread**的专属原生索引：有该索引记录，指向专属sessions目录；对应rollout尚不存在，未读取任何rollout正文。已有resumable=false fence继续阻止首轮前后台交接。必须等本人正常发送第一条真实消息后，才可核同新thread重启恢复和完整自动切换；本轮未伪造首轮、未创建额外测试thread。
- 首次停后严格表比对因正常close导致generation+1退出1；逐字段确认仅generation且严格+1后继续，未放宽其他业务事实检查。首次目录验证漏传catalog所需serverName被既有校验拒绝，尚无外部MCP配置时不再发虚构目录请求，改核真实状态及主引擎ready前目录契约；没有改API或绕guard。
- 旧浏览器tab已关闭，原ID观察返回404；重新枚举未见日常tab，未读取任何登录页或草稿正文。后续只新开验证页，不强制刷新用户页面；发现新页面有草稿则保留，不发送或清空。

### 当前用户动作与回退界线

服务继续在[4780](http://127.0.0.1:4780/)运行，可在全新主对话正常交办第一件事。已完成本人认证，**无需再登录或批准旧内容迁移**。第一条真实消息前，不主动停止或重启空主thread；首次消息持久化及实际工具/新外部MCP使用仍分别按真实操作授权和结果验收。Shell整轮网络许可、网页搜索/浏览器/图片生成/电脑操作、原生记忆替代仍按之前分批实证范围推进，不因目录切换虚报完成。

无新事实且确需回退时，先检查最新准确进程/自然空闲，正常停止并确认锁/lease释放；从维护点读取原配置和原值，在CAS确认所有业务表仍与停后基线相同（只容许已核正常generation变化）后，恢复业务binding/mainThread/mainUsage及网关binding/thread，再恢复原配置并在原Terminal启动正常入口。不要复制整个旧DB、删除新旧原生数据或本人凭据。**任何新输入、任务、记忆、渠道收据或外发事实出现后，仅前向修复，不能回套原绑定或旧快照。**


## 2026-10-18 后续采用状态

上述空thread与首轮待验证记录是维护当时事实。其后已在同一唯一新主thread完成获准开发首轮并持久化，再完成原生搜索/目录只读验收；正常空闲自动切换已恢复同thread。当前无需重新登录、创建thread、迁入旧rollout或重复维护。能力解除额外禁用及实际发布详见[原生能力直接发现与实际可用范围](29-native-capability-activation.md)。原历史、现有记忆、渠道及六uncertain继续保留；新事实后只能前向修复。
