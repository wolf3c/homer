> 本文记录历史 Web 方案和当时的部署验收；当前界面与协作以源码、[界面设计](../ui/DESIGN.md)及[主 Agent 与 Worker 会话架构](architecture/main-worker-chat-architecture.md)为准。

> 2026-10-17 当前输入交互：单条可删除引用，说明直接写在主输入框，再次引用替换当前引用。旧多引用历史、未确认请求 payload/ID/hash 保留，旧多引用草稿与批注完整转入主输入文字并提示。完成消息不显示状态行，助手消息不显示逐条头像，页头 Logo 保留。顶部记忆配置入口已移除，记忆与自动保存常开。下文多引用编辑器和记忆配置入口若有描述，仅为历史记录。

# Homer 本地 Web 界面

2026-10-17更新：日常4780已启用新版记忆管理与连续发送界面，原主thread保持；实际浏览器刷新、草稿/发送箭头及605px检查见[日常启用记录](20-daily-environment-activation.md)。以下各日期的旧版本状态保留为历史验收记录。

状态：2026-10-16 已实现并完成浏览器、真实 Codex 与整合验收。日常 Terminal 在实时空闲、私密一致性备份和原线程校验后已安全切换到 Web 入口，实际地址 `http://127.0.0.1:4780/`；Telegram 设置页为 `http://127.0.0.1:4780/settings/telegram`。

## 启动与升级

当前交付是开发版狗粮入口：`npm run web` 依赖开发启动器的源码 watch、构建和安全换版。普通／生产环境使用的不依赖 watch 的独立 Web 启动入口尚未实现，本轮不扩展该能力。

需要 Node 22.22.0。安装并检查：

```sh
npm ci
npm run check
npm run web -- --config <已有配置> --port 4780
```

打开 `http://127.0.0.1:4780/`。此入口同时保留终端自然语言输入，Web 与终端由同一个稳定启动器连接唯一 Homer。不要同时用 `npm start`／另一个 `npm run dev` 打开相同 runtime；已有进程先安全退出，再改用 Web 入口。页面关闭、标签页断线及终端输入 EOF 不停止 Web 模式后台工作；`/quit` 或 Ctrl-C 安全退出。

UI 源码／资源纳入原不可变候选快照。兼容界面独立构建并激活，不等待主轮、Worker、待答和交付；旧页面提示刷新且继续可用，草稿按原方式保留。业务 child 仍等安全边界才交接。新建空 Codex thread 尚无可恢复 rollout，首轮开始前暂缓自动交接。依赖、SQLite owner、连接边界、主工具指纹变化继续阻断热切换，要求检查后重启；不绕过 `main_tools_migration_required`。启动器脚本自身的变化也需要受控重启。

## 范围与数据归属

用户已授权在 Homer 使用 assistant-ui 增加可用界面。首版为本机浏览器页面，没有 Electron/Tauri 壳。Web、CLI 共用同一个 Homer 服务实例、SQLite 和主 Codex thread；Worker 继续由原服务调度。IM 渠道按各自接入文档维护；Web 不另建渠道账号或审批流程。

assistant-ui `ExternalStoreRuntime` 接收 Homer 的服务端消息状态，不启动自己的模型后端。消息正文、收到的部分回复、来源引用、输入去重标识属于私有业务数据，保存在现有 Homer SQLite 的 `conversation_messages` / `conversation_inputs`；不进入诊断事件。浏览器仅在当前标签页的 sessionStorage 中保存未提交草稿与发送未确认的请求标识，不以它保存正式历史。待答卡也按原交互 ID 保留当前标签页草稿和未确认请求，重试同内容沿用原请求标识；服务确认接收后禁用重复提交，交互结束后清理该草稿。

Web state 的既有 threadId 是原 Homer 主线程标识，用于历史关联、刷新和重连校验；它不是鉴权凭据，也不提供按任意 threadId 访问引擎的入口。原生 turnId 仅供宿主使用，不进入 Web state；本地生成的 generationId 随队列状态投影，用于对准确回复请求中断，不是身份或权限。首次接通只展示接入之后留存的产品消息，不声称已导入全部 Codex 引擎历史。引擎上下文和工具调用历史仍由 Codex 管理；主线程不能在恢复失败时静默重建。

## 交互边界

- Thread、Message、Composer 与 SelectionToolbar 使用 assistant-ui 真实原语。选文引用携带来源 `messageId` 和原始选中文字，在服务端按相同 Markdown/GFM 呈现语义核对所选消息的可见文本后加入主 Agent 输入。粗体、链接、表格与换行可引用，隐藏链接地址、伪造选文及其他消息不通过；原始选文保持原样。
- 增量只能来自 App Server `item/agentMessage/delta`，按当前 thread/turn 过滤；完成文本不拆字重播。最终状态以真实 turn 完成／中断／失败为准。
- 停止只针对当前主回复，保留已派发 Worker。中断未确认时显示具体状态，不能把按钮点击等同于已停止。
- 页面不再展示任务列表、“正在办”入口或用户消息的“你”署名；后台 Run 调度继续保留。只有原交互契约的 `pending_user` 请求显示待答卡，携带交互 ID 回原主 Agent，再由既有交互引擎送回原 Worker；页面不新增审批策略。
- 成果链接保留在正文区域，仅使用 Run ID，由服务确认已显式正式发布的根结果/文件链、原用户来源和 Files 真实路径／链接／类型／大小/hash 检查。内部子成果即使已验收，也不能下载。没有任意路径下载或文件浏览器。
- Markdown 支持表格和代码高亮；代码和宽表格局部滚动。支持键盘、中文输入法、长内容阅读、自动滚动与窄屏布局。
- 页头显示正式河马 Logo 与名称，右上角微信图标直接打开原连接弹窗；未配置时灰色但可点击，真实 bound 决定配置样式，title／弹窗保留暂停或断线语义。Telegram 主界面入口暂时隐藏，其既有 `/settings/telegram` 路由与服务不删除。顶部不展示常驻连接状态；真实连接、自动重连和发送禁用条件保留，断线通过错误提示与输入占位反馈。微信入口复用既有同源管理路由，打开弹窗不自动创建 QR；用户点击连接后才生成本机 PNG 二维码，支持必要验证码、暂停、恢复与解除连接，不在前端存储凭据。扫码必须由用户本人完成。
- 配色参考 Cindy 的暖灰、白色表面和炭灰控件，以本项目 CSS 变量统一，不声称是官方 tokens。发送仅向上箭头，保留可访问名称和 title；助手消息仅头像保留替代文字；用户气泡按内容自适应宽度、右对齐，长文／URL／引用在最大宽度内换行。
- Generative UI 可沿 assistant-ui 的 `MessagePrimitive.Parts` 组件映射扩展；首版仅实现文本、引用、Markdown 与既有业务卡片，没有通用组件注册平台或生成代码执行。

## 本机访问边界

HTTP 默认只监听 `127.0.0.1`，按实际端口校验 Host。跨源 Origin 和跨站请求被拒绝；POST 必须携带精确同源 Origin 和 JSON。SSE 断开不触发服务停止，重连重新获取服务端当前快照。API 不把模型连接配置或凭据发送给前端。

`src/web-server.ts` 只负责 HTTP、SSE、固定构建资源和 Run ID 成果路由。它注入服务桥，不自行创建 Homer。升级时需要继续使用既有稳定宿主、候选快照与安全空闲边界；不得同时启动两个拥有运行锁的 Homer。

## 依赖与资料

2026-10-16 核对 npm 包与官方文档：`@assistant-ui/react` 0.15.29、`@assistant-ui/react-markdown` 0.14.23，MIT；React 19.3.1；Vite 8.3.4 支持 Node 22.22.0。精确安装版本由锁文件负责。

- [ExternalStoreRuntime 官方文档](https://www.assistant-ui.com/docs/runtimes/custom/external-store)
- [Quote / SelectionToolbar 官方文档](https://www.assistant-ui.com/elements/quote)
- 视觉规则：[ui/DESIGN.md](../ui/DESIGN.md)
- 正式品牌：[assets/branding/README.md](../assets/branding/README.md)

## 验证

新增离线用例全部是需求推导与合成输入，没有将合成内容冒充真实用户反馈。真实用户正文不写入截图证据或维护文档。

- `tests/web-history.test.ts`：事务接收、持久消息、去重、引用来源与部分回复保留。
- `tests/web-server.test.ts`：Host/Origin 边界、原交互 ID 转发、Run ID 下载、SSE 重连与断线不取消。
- `tests/web-engine-stream.test.ts`：真实协议增量早于完成，过滤错线程／错轮次及迟到开始事件，ack 前增量在真实轮次确认后按序交付；新空 thread 即使返回 path，也在首轮开始前禁止自动交接。
- `tests/web-service.test.ts`：停止不破坏主引擎、不取消并发 Worker、引用来源透传、原待答返回、成果授权与路径检查；本地 sink 的真实用户轮 `main_start` → `delta` → `main_terminal` 顺序，停止请求不冒充结束，旧消息停止拒绝，未确认关闭不发终态，内部审阅不发用户生命周期。原生 turnId 不进入 Web state。
- `tests/web-client.test.ts`：主输入与待答卡发送未确认时沿用原请求；修改正文、来源或交互 ID 才生成新请求。
- `tests/web-acceptance.test.ts`：可信渠道来源与产品消息同库事务提交；失败无回执、无派发；重复来源及内容冲突拒绝。
- `tests/web-dev-host.test.mjs`：真实子进程验证空 thread 候选等待、不可变 UI 换版、原 thread／历史／去重回执、EOF 后后台继续。

初版浏览器已实际点击验证（其中任务侧栏与常驻状态已在后续简化中移除）：选文引用与补充要求发送、流式中停止后继续派发、Worker 提问／授权卡返回原任务、成功成果附件下载、刷新保留历史和草稿、断线显示重连并禁发、发送错误保留草稿、390px 窄屏、桌面工作列表实际收起与 UI 换版后草稿保留。微信连接界面用合成 API 验证真实按钮、同源 PNG、验证码表单、暂停／恢复／解除及窄屏弹窗；未连接真实微信账号。

真实订阅 Codex 0.163.0 / gpt-6.1-sol / medium，专用合成工作区：首条消息先后收到 1、5、21、68、79 字且仍为 running，随后才完成；刷新后第二条准确回忆第一条指定代号，主 thread 未变化。最终共享宿主冻结后，专用服务安全退出并以原 runtime 恢复，第 3 轮仍准确回忆原代号；原 4 条消息 ID 不变，现 6 条。总计 3 个真实合成用户轮，日常会话未注入模型测试。未使用实际用户正文作为验收材料。

本次 Web 交付基线的 `npm run check` 构建、类型检查与 184 项测试全部通过；此基线不包含随后用户反馈的 Telegram「验证并安全保存无反应」修复。该问题由 Telegram 原任务定位，其修复及验收结果单独记录，不以本基线声称已修复。日常接管核验原线程、原 9 条请求完整行哈希不变，唯一锁与引擎归属正确，数据库 integrity=ok；旧进程退出后才启动新宿主，已核对 Telegram schema 备份 0600。Web 从接入后留存产品消息，因此现有 Codex 旧聊天不会自动显示为 Web 消息。

证据位于 `.codex/scratch/assistant-ui/`：`final-combined-check.log`、`real/recovery-evidence.json`、`browser/acceptance-evidence.json`、`browser/card-retry-verification.json` 与 `daily/running-web-checks.json`。截图 `daily/homer-web-running.jpg` 为实际日常空界面，`browser/quote-desktop.jpg`、`browser/authorization-desktop.jpg` 与 `browser/mobile-chat.png` 为合成场景。私有正文未进入验收证据。构建保留 Vite 首包较大提示（JS 约 910 kB，gzip 约 280 kB）；本机渲染已验，未做跨设备性能基准。实际微信账号、Telegram Bot/手机及钥匙串连通由各渠道专项说明，不能以页面／fixture 通过宣称已验收真实账号；跨 Bot 永久 owner 归属迁移亦未实现。

2026-10-16 页头简化追加验收：使用独立合成页面检查 605×837 与桌面渲染，页头正式 Logo、微信弹窗入口可用（Telegram 主界面入口暂时隐藏）；任务列表、常驻连接状态与用户可见署名移除，待答和成果链接保留。发送、选文引用及断线反馈沿原服务契约验证；本轮只改 UI 与对应文档，不操作日常 Terminal，不使用用户正文或凭据作为证据。具体观察与日常自动生效状态见 `.codex/scratch/assistant-ui/header-logo/` 验证记录，不能以候选构建通过代替生效确认。

本轮视觉阶段：独立 UI 类型检查与构建通过，合成浏览器 605×837／1280×900 通过；短气泡 110px／容器 561px，长 URL 无横向溢出。直接微信弹窗、无自动 QR、引用来源／正文发送、待答、成果、断线提示／禁发／恢复均验证。日常 HTTP 资源和现有浏览器页头已确认暖灰 UI 在版本 0254b6232c85 自然生效。2026-10-16 10:36 UTC 只读检查微信存在 2 条 uncertain 发件，故保留原 launcher、不重启、不重发；旧 Telegram 设置 JS 尚无新进度反馈，不能声称保存反馈修复已生效。此结论不读取或记录用户正文及凭据。证据：header-logo/synthetic-ui-verification.json、header-logo/daily-readonly-status.json。

## 多段引用分别批注

连续选取同一或不同消息正文，每次“引用”追加独立卡片，分别填写批注或删除；整体要求可留空，至少有正文或一段批注。一次发送一条用户请求，逐项携带 quotes[{messageId,text,annotation}]；原文仅作为来源数据，主 Agent 收到每段原文与对应用户批注的清晰配对。历史逐段显示，旧 quote 历史仍可读。引用和批注属于私有业务数据，不进入诊断日志。

后端逐条核对原消息、原 thread 与可见 Markdown/GFM 文本，任一项伪造均整条拒绝、零 receipt／派发。最多 20 段，单段原文及批注各不超过 16000 字符，原文与批注合计不超过 48000 字符；HTTP 仍受原 96 KiB 请求字节上限约束。禁止 quote 与 quotes 同时提交。相同内容及来源重试沿原 requestId，仅批注、顺序、来源、正文或删除项改变时生成新请求 ID。旧单引用和无引用请求继续使用原哈希算法，旧未确认单引用草稿按原 payload／ID 重试。可信 source／persist 仍在同一 SQLite 接收事务内，提交后才排主轮，渠道无引用输入保持原行为。

没有新增表、列或第二份历史：现有 conversation_messages.quote 的 JSON 对象继续承载旧引用，新记录可为逐项数组，读出时提供 quotes 字段；旧行不改写。因为该字段语义增加，web-history 属现有 schemaHash owner，热切换会被 dev_schema_change_requires_review 拦住。须在安全空闲与渠道无未结事项后先一致性备份、原 tab 正常退出，再以原配置恢复；不能只热替换前端，也不能让旧版本读取新增格式后冒称兼容回退，回退需对应升级前备份。多引用未改变 Worker／engine／渠道协议或模型配置。

合成专项涵盖多个消息与独立批注、仅批注、逐条伪造拒绝、旧 quote／原哈希、同 ID 一次派发、可信来源同事务回滚；浏览器以独立合成 Homer 与假引擎验证 605×837 连选、分别批注、删除、刷新、发送及历史／主输入逐项一致，不使用模型轮次或真实账号。证据在 .codex/scratch/assistant-ui/multi-quotes/，以最终验证记录为准。

多引用最终代码整合：npm run check 的构建／类型检查与 199 项测试全部通过。首次并行检查为 198／199，唯一旧微信宿主 fixture 等待换版超时；原专项独立 2／2 通过，原命令全量复验 199／199，未延长超时、跳过断言或改微信测试。失败现场保留；其 disable HTTP 回执未断言，结束仍为 connecting，疑似撞上 prepare 窗口，不能把重试通过冒称已修 fixture 根因。最新草稿编辑／删除优先旧 pending、已接收草稿刷新不复活、旧 pending 保留 payload／ID、Enter／Shift+Enter 已另在合成浏览器验证。最终多引用仍因 schema owner 变更等待受控重开，日常视觉阶段与 Telegram 保存反馈的生效状态分别以上述只读记录为准。

2026-10-16 10:53 UTC 最终只读复核：日常仍为 0254b6232c85，原主线程与接管前原始请求／事项／Run／交互行哈希不变；微信 uncertain 已为 3，未重开、未重发或清理。多引用与 Telegram 进度反馈均尚未在日常激活。最后仅移除未配置微信图标额外透明度，灰色对比度提升（不禁用按钮），已再次通过 UI 构建／类型检查与实际 605px 渲染；199 项整合检查不为这一 CSS 调整重复全跑。最终指纹与证据见 multi-quotes/handoff-verification.json。

## 递归候选的连续发送（2026-10-16）

此增量已进入候选源码，日常 4780 尚未更新。生成期间向上箭头始终保留，点击或 Enter 默认逐条排队；当前回答继续，服务端按发送顺序单条处理。Shift+Enter 换行，组合输入 Enter 不发送。独立停止按钮只停止当前主回复，后台 Worker 保留。

排队消息就地显示“等待处理”，可编辑正文及各段批注或撤回；claim 与编辑/撤回做 revision CAS，真正开始处理后不可原地改写。刷新/重连从服务器恢复队列；浏览器仅逐条保存发送未确认请求，不再用单一 pending 槽代替多条。来源、原 requestId、多引用数组和旧 quote/hash 均保留。

有草稿时可“打断并发送”：先持久接收新要求，再中断准确 generation，确认结束后优先该要求，再继续此前队列，不悄悄撤回旧项。停止失败/丢回执显示未确认，不丢新消息或重复执行。默认连续发送不是实时 steer。进程崩溃时已领取项为待核对，未知副作用不自动重放；真正未领取项保留。记忆只采用 claim 时的当前 revision，排队/撤回/旧文本不能提前提取或授权。

实际 605px/桌面浏览器、SSE 断线恢复、多引用批注及完整联合检查见[递归验收](15-recursive-agent-validation.md)。真实模型流式接合及日常部署仍受该文门槛限制。


## 更新窗口的输入与恢复

稳定启动器已就绪时，普通发送在交接窗口仍可用。网关先持久暂存并返回 `accepted:false/transportState:stored`；页面显示“已暂存，等待业务接收”，不能显示为模型已采用。原业务历史中出现请求后才清除逐条待确认标识；刷新、重连及手动同 ID 重试不新增一条消息。业务校验拒绝显示具体错误，只有显式重试才再次提交。传输载荷位于受保护 runtime，不进入维护日志；完整协议见[本轮设计与验收](17-seamless-update-validation.md)。

停止、打断、原待答答复及管理写操作依赖当前 owner，不在更新后自动补执行。管理读取可在交接时等待至多5秒；未就绪明确失败。SSE 断线时仍禁发并保留草稿，恢复后读取完整业务快照。页面对网络失败及503使用500ms至10秒退避重连，旧连接先关闭，恢复不重发业务输入。业务 child 故障时网关标记待恢复并可暂存普通输入；网关进程本身停止时仍需显式重开。

界面资源有独立版本路径，旧页面不混用新 chunk；最多保留本次会话8份已激活资源，达到上限延后 UI 更新并继续旧页面，不强制刷新。网关/依赖/数据库/工具/账号/引擎变化不保证热替，日常4780未由此源码更新自动上线。合成候选启动命令、最新指纹和验收范围见[更新验收](17-seamless-update-validation.md)。

## 原生用量展示（候选，2026-10-17）

输入框下新增折叠“用量”，仅在主引擎提供有效token计数时出现；默认不展开，刷新从原mainUsage恢复数字。最近一次模型请求和主对话累计分开，不含后台任务，不估算费用/余额，不显示内部工具流水。流式、中断和连续发送语义不变，原生复用/隔离及最新验证见[22的三项补充验收](22-mcp-skill-configuration-design.md#8-用户确认的三项补充验收2026-10-17)。尚未日常上线。
