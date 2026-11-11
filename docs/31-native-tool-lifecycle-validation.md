# 原生工具自主安装与使用验收

更新：2026-10-18。对话安装审批接线已发布，真实模型已完成原生搜索、审阅、审批、安装、下一轮读取 Skill/参考资料、实际任务、禁用与恢复。更新后再次实际使用与卸载也已由同一真实主模型完成；Browser Use 已由同一真实主模型安装；本人连接及浏览器操作尚未验收。不能以合成结果代替。

当前日常：业务与源码 `f2fcbd9e881a`；UI `594233b4d88b`。原请求自动续接、代表 Hook 的真实主对话补测及清理已完成，见“真实自动续接与 Hooks 补测”。早期发布指纹在各历史回执中保留。Browser Use 已安装，第三方连接及操作仍未验收。

## 使用入口和所有权

在同一 Homer 主对话交办任务。Agent 通过原生目录搜索、查看准确插件内容，再用 `capabilities` 提议安装或卸载；也支持固定 0.163 原生 `request_plugin_install` 所发的插件安装 elicitation。用户在现有待答卡选择允许或拒绝，宿主核对实际用户回执后调用 Codex 原生安装器。模型不能提供 `approve`，也不能用普通回答伪造授权。

2026-10-23 已移除能力页与专用管理传输；当前通过同一对话管理，MCP OAuth 暂无 Homer 用户入口，隐藏配置仍需可信原生配置路径。历史页面验收不代表当前可访问，见[移除说明](2026-10-23-remove-capability-settings.md)。插件、Skill、MCP 的原生文件和服务是唯一配置真相；没有新安装数据库、凭据代理、包管理器或 Worker 版本库。新安装或配置在下一轮原线程采用，不热换正在工作的 Worker。Worker 获得同一管理工具，但审批、生命周期及实际调用绑定自己的 Run/thread/turn；主五工具 hash 不变。

用户安装和配置保存在 Homer 专属 Codex HOME，应用更新不复制或覆盖这些数据。已有已授权工具原生发现使用；新增程序、第三方登录、费用、外发、系统权限仍按具体操作确认。本文没有开放整轮 Shell 网络或原生 multi_agent。

## 实现契约

- `capability-operations.ts` 从原生详情生成安装内容审阅，绑定详情 hash、准确目标及配置版本。过大的审阅明确报错，不截掉权限后请求确认。
- `MainNativeApprovals` 复用现有待答、历史和 owner。批准必须先持久化真实用户回执；结束、停止、超时及重启不会重建旧回调。
- 同一轮稳定 `operationId` 去重；同 ID 内容变化拒绝；原生安装回执未知时不自动重试，应查原生状态。
- 主/Worker 共用原生安装配置实现。等待具体安装审批时暂停主/Worker执行预算，主对话批准后恢复剩余执行时间，授权等待另有有界超时；普通 MCP 调用超时不扩大，宿主管理调用支持有界的人类等待。
- 原生 `mcpServer/elicitation/request` 仅对固定协议可核对的插件安装建议接通。尚未接通的通用表单、URL 或秘密输入明确拒绝，不能借插件审批索取凭据。
- 原生发现的专属安装 Skill 可以按准确 `SKILL.md` 路径启停；必须仍在专属 HOME、无软链并在实际原生发现结果中。

## 已完成的隔离验证

新增稳定行为 RED→GREEN：真实用户回执约束、批准/拒绝、配置变化、停止、超时、迟到通知、未知结果不重复安装、原生插件建议回调及 Worker 工具归属。曾发现超时交互错误地标记 delivered，已在产品路径修复；测试夹具错误与产品错误分别记录在 scratch 日志。

最终 `npm run check`：454 项，452 通过、0 失败、2 既有跳过，退出 0。此前测试中的 TypeScript 重复条件错误已经修正，未将失败的那次检查当作通过。源码、测试、脚本合计 15 个文件，没有依赖、业务 schema、网关或五 MAIN_TOOLS 变化。

`scripts/native-plugin-acceptance.ts <固定0.163二进制>`：空 HOME、本地纯 Skill 插件，真实原生读取→安装→发现→禁用→恢复→卸载通过，退出 0；无模型、账号、联网或额外程序安装。

`scripts/native-tool-acceptance.ts <固定0.163二进制>`：真实固定二进制配脚本 Responses 的有界隔离回归退出 0；主/Worker 原生 MCP、按需 Skill、Shell/patch/看图、越界拒绝、审批拒绝/停止/超时、同 thread 恢复及网络保护保留。这不是本人模型自主选择证据。

真实浏览器合成实例 `4812`：拒绝不执行、审批超时、批准执行、停止取消卡片均通过；待答刷新不复制安装。实际 605/1470 宽度无横向溢出，保留独立 44px 停止及发送。截图和回执位于 `.codex/scratch/native-tool-lifecycle/`，不包含账号或真实工具正文。

## 发布证据与回退边界

完整源码 `a9380dc5c9941a59230ee0b5b3e9138e6deb079259941d54b11beb277cc6e0d4`；UI 保持 `72a5ad015e1d90c62feaa36de46d61c72c380659e287df352ea5982e1fc4405c`。两次最新自然空闲后，正常 watcher 构建并交接，原 launcher94963/Terminal 保留，host26364→36888；未手动杀进程或替换启动器。

主 thread `01a14cdb-1d34-7600-b067-2f1eb4928132` 不变，原生 account/read 确认专属 ChatGPT 连接；55 业务表除微信连接正常 generation 均相同，绑定其余字段相同，六 uncertain 整行 hash 相同；记忆、历史、配置、schema、五 MAIN_TOOLS 保留，两个实际 UI 资源 hash 匹配。维护点在 `.codex/private/native-tool-lifecycle-release-20261018/`，包含一致性业务/transport 备份、源码 CAS 和完整前后构建清单，不含复制的认证。

原页面草稿未刷新、导航、编辑或清空。用户另明确允许在当前唯一主对话提交少量验收消息；新业务事实之后仅前向修复，不能回套本次发布前的数据库。

## 真实模型验收边界

已获准的精确对象：`impeccable@openai-curated-remote` 4.3.1，Renaissance Geek Inc，单个界面设计 Skill，无 Hooks/Apps/MCP。实际安装前必须重新匹配原生详情；由 Homer Agent 自己搜索、审阅和提议安装，不能脚本预装冒充。安装、下一轮加载完成真实设计任务、禁用/恢复、卸载及持久复用结果在观察完成后续记。

首轮本人模型已实际找到准确名称/版本/发布者，但连续详情读取失败 `capability_plugin_target_invalid`，未安装。真实 rollout 显示模型因工具的 target 只有无说明 object 而猜测字段，原生搜索字段 `marketplaceName` 又与详情字段 `remoteMarketplaceName` 不同。已补搜索→详情可直接复用的精确 target 和明确输入 schema；原生来源不合法时返回该项错误，不伪装可安装。稳定回归先重现失败再通过，真实固定二进制无模型搜索→详情也通过；更新后全量 455 项、453 通过/0 失败/2 跳过，退出 0。另一次定向命令误在根目录执行了旧测试，已明确补跑隔离候选测试，未将旧测试结果作为修复证据。

第二轮本人模型进入真实待答卡，匹配准确版本和新增能力后按本任务的用户批准提交，安装返回 `engine_rpc_failed`；模型读取未安装状态后没有盲重试。固定源码确认远程安装/卸载使用后台插件 ID，接线错误地用了显示名称。补正此映射及卸载前详情 hash 复核后，456 项检查中454通过/0失败/2跳过，退出0，已正常发布 `bd6c7f8ffb9a`。第三轮本人模型以新的准确操作、重新审阅及实际用户待答卡批准安装成功。

原生按显示名 `impeccable` 查询仍返回 installed=false；同一新原生进程按详情给出的 `plugins_6a5028ae047081918e3dfde753112690` 查询 installed=true，并实际发现专属 `plugins/cache/openai-curated-remote/impeccable/4.3.1/skills/impeccable/SKILL.md`。不能把这个别名状态差异当用户未登录或再次安装的依据。已补原生后台 ID 的统一解析、目标身份一致性和可直接复用目标；又一次稳定 RED→GREEN。最新版全量458项：456通过、0失败、2既有跳过，退出0；固定原生本地完整插件生命周期再次退出0。

下一轮本人模型实际读取 `SKILL.md`、`audit.md`、`critique.md` 并完成虚构页面审阅；任务给出的具体标准包括正文/对比度、键盘按钮/名称/44px点击区域及320px流式排版。随后实际原生配置禁用 enabled=false、恢复 enabled=true，分别查询核实，最终恢复启用。没有运行插件的上下文启动程序、读取真实项目、创建Worker、写记忆或外发。这是描述审阅，未冒称浏览器视觉实测。

当前主 thread 自身 rollout 的工具动作/结果存在元数据回执保存在 scratch，仅记录动作名、调用ID hash、Skill文件名及结果存在；没有复制旧会话、原文参数/结果或账号信息。另有新原生进程的安装/启用状态及 Skill SHA256 回执；这两类证据与实际模型回复分别核对。

浏览器工具链仍需原生候选的准确来源、版本、运行依赖、账号/费用/系统权限及卸载方案。每个新对象按具体批准范围执行，不能借用 Cindy 浏览器作为 Homer 已有能力。五级来源治理、发行预装及可信接口仍以 [需求稿](30-tool-acquisition-requirements.md) 为准，未被本次原生闭环接线自动实现。

用户后续已单独批准仅安装并核查原生 Browser Use 1.0.0（Browser Use Inc.，`app-6a9a3581fe6c8191b68b1b2d38f37dfd@openai-curated-remote`）的连接要求：一个云端浏览器 App，无 Skill/Hooks/MCP；不含第三方登录、费用或实际浏览器操作授权。目录中的另一个 `browser-use` 0.13.10（不同发布者）只有六个 Skill，依赖宿主提供浏览器，不能作为浏览器驱动已接通的证据。`codex-browser-recorder` 0.4.1 也只是录制现有 Codex In-app Browser 的方法，不是新的浏览器运行环境。

## 更新复用、卸载及授权等待修复

`d6249e85427f` 发布前后，新原生进程均确认 Impeccable installed/enabled=true、Skill 路径与 SHA256 相同（`5ce02fc8f353d7f659535fb80e453963dc047a07c4396adf098fe010b479e7c0`）。随后同一真实主模型再次读取该 Skill、给出具体审阅标准，经准确卸载待答卡和实际用户回执调用原生卸载，详情确认未安装，Skill 发现结果为空；没有脚本代装/代卸载。

该轮随后找到准确 Browser Use 并提出安装待答卡，但原120秒整轮期限在等待用户时耗尽，卡取消，尚未安装。旧卡提交被 pending_changed 拒绝，未重放或重复安装。修复只让主对话等待具体能力授权时暂停剩余执行预算，决定到达即恢复；引用计数处理重叠等待，finally清理后不复活计时器，安装RPC本身继续消耗执行预算。授权仍有独立有界期限，停止/取消仍结束卡片。

两项新增稳定回归先RED（等待时卡错误取消）再GREEN，分别断言等待后可继续及批准后超出剩余执行预算仍 main_timeout；相关11项通过。最终完整 `npm run check` 460项、458通过、2既有跳过、0失败，退出0；构建/类型检查包含其中。首次定向命令误在根目录运行旧测试，无匹配用例，不作为RED证据；已在隔离候选正确重跑，2项均真实失败后再修复。响应式脚本首次因合成实例没有待答卡而退出1，提交新合成请求后605/1470再次退出0；缺Origin的首次合成请求被403拒绝，补正确同源头后202，无产品保护变化。

日常新版本 `a66bdd34ae7c`，完整源码 `a66bdd34ae7c489d6032d88f0dd464c64d8ba0483a01524ca15f35e7296317aa`；UI仍 `72a5ad015e1d90c62feaa36de46d61c72c380659e287df352ea5982e1fc4405c`，schema/依赖/gateway/五工具契约不变。旧main_timeout已将主引擎标为broken，自动交接守卫如实拒绝；未删守卫或伪造安全状态。两次临近空闲核查、备份后，准确launcher正常SIGTERM、锁/lease释放、停后备份副本quick_check/FK校验，再在原Terminal7325/tab1/ttys000启动正常自动更新入口。新launcher56042/host56054，原主thread不变；55业务表仅微信连接正常generation变化，绑定其余字段和六uncertain整行hash相同；原生account/read确认chatgpt connected，实际资源逐文件匹配。私有维护点 `.codex/private/native-approval-wait-release-20261018/` 保存CAS/备份/停机/启动及发布回执，不含auth复制。无数据库迁移，发生新事实后仅前向修复，不回套旧快照。

草稿观察纠正：先前宽泛检查把组件的辅助textarea非空值误判为用户草稿。准确可见输入框“给荷马发消息”在本阶段首次模型提交前及后续核对均为空；没有读取草稿正文，也未刷新、导航、编辑或清空原页面。用户已单独允许保留页面进行验收，不能将辅助textarea或空字符串hash当作草稿内容保持的证明。

## Browser Use 实际安装与本人下一步

修复后复用同一主thread提交一个限定请求。真实模型自行核对准确对象和安装内容，创建新待答卡 `95bdf50f-d78e-4eea-b320-9c7436bb75d9`；对照本任务已获用户批准的精确范围，在独立验证页真实点击“允许本次操作”。原生安装成功，新原生进程再核 Browser Use 1.0.0 installed/enabled=true，归 Homer 专属 HOME；无额外 Skill、Hooks 或 MCP，没有新账号登录、付费或浏览器操作。

原生安装回执表示需要本人授权；`app/list` 在真实模型及独立新原生进程均返回脱敏 `engine_authentication_failed`。专属 ChatGPT 的 `account/read` 仍为 connected=true，不能据此要求重复 Homer 登录，也不能将插件已安装当连接成功。固定源码与真实 `app/read {appIds:[准确AppID],includeTools:true}` 查询可返回该 App 的公开元数据及4个展示用工具摘要；这个接口不提供连接布尔状态，不能由摘要数量推断工具可调用。最初探针误读 tools 而非 toolSummaries 得到0，已按固定协议修正并重新实测；不作为“无工具”的产品结论。

**需要本人处理的实际入口：** [Browser Use 原生连接页](https://chatgpt.com/apps/browser-use/asdk_app_6a9a3581fe6c8191b68b1b2d38f37dfd)。该地址来自原生插件/App元数据，没有自动打开。用户可在自己的浏览器查看连接要求并决定是否授权；若出现新第三方账号、费用、地区/订阅或权限条件，需按具体条件处理，当前尚未验证其资格。本人完成后再从同一 Homer 主对话核连接并授权最小实际浏览器任务。本轮没有宣称云端浏览器已可操作，也没有用 Cindy 浏览器替代。

验收后日常空闲，无待答/Worker/transport待处理，微信connected；相对本次维护点的所有原有业务行均保留，六uncertain整行hash相同。原记忆内容/设置/来源/操作/快照等表不变，仅本轮开发消息新增一个已完成的memory_jobs来源处理收据，没有新增记忆条目。首次严格全表相等检查因此退出1，核实是新收据而非旧记忆变化后使用“原有行未变＋记忆内容未变＋新收据逐项核对”的检查退出0，未修改数据。

## 证据范围与后续边界

| 范围 | 本轮证据 |
| --- | --- |
| 主Agent纯Skill完整生命周期 | 真实本人模型自主搜索、详情、实际用户授权、原生安装、下一轮读取并完成任务、禁用/恢复、应用及原生进程更新后再次使用、原生卸载 |
| Worker同一管理与审批接线 | 合成回归及固定二进制隔离工具验收；未另建真实Worker模型会话冒充实证 |
| Browser Use | 同一真实主模型安装成功；新进程确认持久安装，原生连接入口与公开工具摘要可读取；连接状态查询鉴权失败，第三方授权/费用/实际浏览器操作未完成 |
| 任意程序/所有来源/办公成品/所有浏览器 | 不由上述一个插件闭环推出全部可用；具体依赖、权限和产物仍需真实任务验收，五级来源方案不是已实现的承诺 |

可直接使用 [Homer主对话](http://127.0.0.1:4780/)交办需要的工作；模型自行发现已有原生工具，缺少时提出准确安装授权，失败可核原生状态后修复。不存在后台无限搜索或“任意软件均能安装”的保证。

## 目录摘要状态和连接入口修正

真实浏览器检查发现：搜索返回两个不同的 Browser Use 项目，原生摘要对已装项目仍报 installed=false，列表因此误显示“尚未安装”。不是再次安装的理由。保留原生唯一配置真相，不逐项增加目录查询或建立安装缓存：远程列表明确提示“安装与启用状态请查看详情”，详情使用现有后台身份解析，显示准确状态、版本和发布者；搜索目标复用原生已解析target。详情所含Apps提供同一原生安全HTTPS连接要求链接，由本人点击，不自动打开，也不称已连接。

本批仅 `ui/native-discovery.tsx` 与 `ui/DESIGN.md`，无后端/协议/依赖/权限变化。此前真实页面误报为失败路径证据，隔离合成目录故意返回false而后台身份详情返回true；实点查看后605/1470均显示已装、版本/发布者、卸载入口和正确连接链接，无横向溢出，PNG已目视核验。UI构建、相关类型检查及正常候选构建退出0；本批不无故重跑刚完成的460项全检查。首次误在根目录构建旧UI的结果未作候选验证，另在隔离候选正确执行并保留独立日志。

目标版本 `6094fddf281f`，源码 `6094fddf281fabe37cae357a450a60c9abe82f2d4c0738ac5b951873ac828c5d`，UI `594233b4d88b2afe07990610c20d049f22617b0e1c491ef2c970fb0599a274d4`。新维护点 `.codex/private/native-plugin-status-ui-release-20261018/`；两次最新空闲后源码CAS同步，走正常后台构建/交接，最终实际采用结果以其release-receipt为准，不把源文件保存称已生效。

实际发布核验：正常更新器采用了**兼容UI独立发布**，无需重启业务。日常执行版本仍 `a66bdd34ae7c`，当前源完整指纹为上述6094，实际UI已为594233；launcher56042/host56054和主thread均不变。最初沿用整树交接断言而得到 new_version_not_adopted，是验证脚本预期错误，未因此重启或修改guard。改按既有UI独立采用契约严格核对：旧业务完整inventory/source保持、新UI完整source及实际index/两资源hash匹配，55业务表全部相同、六uncertain相同、微信connected、专属account/read正常；退出0。自动UI发布实际恢复可用，后端变化仍沿安全空闲交接；不能把完整源版本6094误报为已换业务版本。

最后日常渲染复核退出0：独立验证页刷新当前594233资源，真实搜索并点击准确Browser Use详情，605/1470均核对已安装/已启用、1.0.0与Browser Use Inc.、正确原生连接链接、卸载入口、无横向溢出。保留 `daily-plugin-status-605.png`、`daily-plugin-status-1470.png` 与同名responsive回执；没有点击连接、卸载或日常停止，原用户页面仍未操作。

## 真实自动续接与 Hooks 补测（2026-10-18 18:20）

本批补齐此前“没有新增真实模型安装后续轮实调”的证据，不重复发布或迁移。日常仍为 `f2fcbd9e881a`，完整源码 `f2fcbd9e881ad9e31e0362e0b03effcb839cc3cb165324d61c155c5d55149f52`，UI `594233b4d88b2afe07990610c20d049f22617b0e1c491ef2c970fb0599a274d4`；唯一主 thread `01a14cdb-1d34-7600-b067-2f1eb4928132`，专属 HOME 不变。没有新增真实 thread、第三方安装、账号、费用授权或微信外发。

### 真实模型保存 Skill 后自动执行

请求 `real-builtin-skill-auto-continuation-20261018` 由当前主模型自行调用已有 `capabilities skill_save`，新建完全可审阅的自有纯文本 Skill `homer-acceptance-builtin-check-20261018`。宿主没有预安装或伪造模型结果。

| 证据 | 实际结果 |
| --- | --- |
| 原生文件与发现回执 | `saved=true` 一次；安装文件 SHA256 `dd56bb3d1cec00a08b239fa00555ff16288b50cf64a8bbc5365d66dae6dcd94e` 与完整审阅正文相同 |
| 保存模型轮 | `01a14e7d-524b-7c90-a287-45ce273dcedf`，只保存后结束 |
| 自动续接模型轮 | `01a14e7d-73e6-7000-960d-ee9d1fa1550d`，实际读取专属 HOME 中的 `SKILL.md`，随后调用原生 Shell 执行其内建整数计算 |
| 归属 | 同一 request、reply、thread；队列 generation `9397c749-0ad9-41e1-a509-0d679ca24cf8` 保持，原 operation 的最终 turnId 与执行轮相同 |
| 实际产物 | Shell stdout `sumSquares=267`、`checksum=73`，退出 0；一条用户输入、一条最终完成回复，没有要求用户重发 |

该 Skill 只用 Shell 内建算术和 printf，不写文件、不运行额外程序或访问网络。结果来自模型真实工具调用的返回对象，不是仅按 Skill 文字复述。它验证自有 Skill 的保存、发现、读取和执行；不外推所有第三方插件或依赖的安装成功。

### 固定版本 Hook 合同与实际执行

固定源码依据为 [Hook 协议](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server-protocol/src/protocol/v2/hook.rs)、[加载线程热更新测试](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server/tests/suite/v2/hooks_list.rs)、[发现与信任](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/hooks/src/engine/discovery.rs)及[命令生命周期](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/hooks/src/engine/command_runner.rs)。以实际固定二进制调用为准，没有借用桌面专有 Hook 或 Node REPL。

先在空 HOME、无凭据环境运行固定原生 app-server，配 loopback 合成 Responses：新增 Hook 未信任时不执行；按 `hooks/list` 的准确 key/currentHash，经 `config/batchWrite(reloadUserConfig=true)` 设置该条 `trusted_hash` 后，同进程同合成 thread 执行成功；脚本更新、禁用、移除及运行中 interrupt 无迟到写入通过。这里的 Responses 是脚本夹具，不称为真实模型证明。

随后在日常专属 `config.toml` 临时配置一个同步 `UserPromptSubmit` command Hook，超时 3 秒；按准确 native hash 信任这一条，没有开启 bypass 或放宽 Shell／网络保护。脚本不读 stdin、不读账号或用户文件、不联网，只向自己的 scratch 写随机标记。原配置备份位于 private；每次写入有版本及文件 CAS，恢复前确认没有其他配置变更。

| 实际主对话请求 | 观察结果 |
| --- | --- |
| `real-hook-v1-20261018` | 新 Hook 写出 v1 标记，真实模型完成；Homer 自动将主子引擎 5150→12394 并恢复同一 thread，launcher／host 不重启 |
| `real-hook-v2-20261018` | 只修改已审阅脚本内容，写出 v2 标记；仍为子引擎 12394，没有重连 |
| `real-hook-disabled-20261018` | 原生 enabled=false；真实模型轮没有新增标记 |
| `real-hook-removed-20261018` | 恢复原配置，原生列表为空；真实模型轮及其后 3.5 秒均无新增标记 |
| `real-hook-stop-20261018` | 另用可审阅同步脚本先写随机开始标记、sleep 2 秒再拟写第二标记（超时 5 秒）。确认 Hook 已开始后，仅停止该原请求；回复 interrupted，等待 3 秒后仍只有开始标记，无迟到第二标记；之后恢复配置并清理 |

所有请求保持原 thread 和准确 request/generation 归属。Hook 执行证据为原生配置／信任状态、真实主轮归属及受控脚本的随机标记；固定原生没有把本批 Hook 通知持久化到该 thread 的 rollout，未伪造相应通知记录。运行中停止在空 HOME 原生通知中另观察到 `hook/started`，不将该合成通知冒充日常通知。

**边界：**“无需用户重启 Homer”已验；“原生进程永不重连”不是契约。当前 Homer 对用户配置版本变化自动安全重连主子引擎；纯脚本内容更新本次同进程采用。原生 command Hook 是经信任的宿主命令，不等同于模型 Shell 的文件／网络沙箱；native `currentHash` 绑定 Hook 配置，不绑定被调用脚本字节，因此脚本更新仍须审阅，不能以旧信任证明任意新脚本安全。这里只验证同步 `UserPromptSubmit`，没有保证全部事件、异步 Hook、MCP／prompt／agent Hook、插件 Hook 更新或跨平台行为。没有增加通用 Hook 管理器、初始化器或第二安装事实库。

### 失败夹具、清理与保留

前两条真实 Skill 夹具未计为完整成功：第一条要求主 Agent 写文件且禁止 Worker，与既有“文件成果由 Worker 写入”冲突；第二条用系统 shasum，Perl 动态库被沙箱拒绝，命令退出 134，模型提出额外只读权限。没有批准扩大权限；只停止自己的请求，再改为上述纯内建校验。保存及自动读取虽已发生，也没有把它们当最终产物完成。

原生探针初始辅助脚本将 JSON 对象错误用作 CLI TOML 参数，初始化超时，exit 1；修正序列化与退出处理后，实际 Hook 探针 exit 0。最终保留观察脚本最初漏列 interrupted 终态，错误报告非空闲，exit 1；修正夹具后 exit 0。没有修改产品保护或共享代码来使夹具通过。

两个测试 Skill 均先核对自有完整 hash，再通过现有管理入口移除；原生重扫确认不再发现。Hook 配置恢复到原始字节 hash，测试脚本与随机标记已清理；隔离空 HOME 的自有脚本／标记也按内容 hash 核对后清理。`homer-tool-management` 九文件未改、仍启用；原生 `.system` 和用户资产未动。最后请求 `real-tools-cleanup-adoption-20261018` 在同一主对话实际查询 state，自动采用清理结果，pending=false，子引擎 13697；没有让用户重启或再次交办原任务。

最后观察：launcher56042／host5147／原 Terminal 保持；原业务行无改删，记忆事实／历史原行、配置、主 thread、专属 HOME、ChatGPT connected、微信 connected、六 uncertain 整行 hash、原页面草稿 DOM／sessionStorage hash、UI 和五 MAIN_TOOLS 均保持。本轮留下 9 条经授权的合成验收输入及其既有队列／回执／自动记忆评估 job 元数据，没有新增记忆事实或重放旧请求。新事实后不回套业务 DB。

真实续接验证、原生 Hook 探针、真实 Hook 生命周期、运行中停止、清理与清理采用、保留核对和 605／1470 新开能力页只读检查均 exit 0。两宽度的管理 Skill 卡片启用、编辑入口及无横向溢出通过，原浏览器页面不导航、不编辑、不发送、不刷新。本批无共享行为修改，未重复上批完整 481 项检查或部署；不是把旧回归计作本批新运行。

普通辅助证据在 `.codex/scratch/real-tool-continuation-hooks-20261018/`，只保存自有合成内容、工具调用 ID hash／turn 元数据及脱敏结果；私有配置备份与逐行业务 hash 在 `.codex/private/real-tool-continuation-hooks-20261018/`（0700／0600，ignore 核验），没有复制 auth／Keychain。首次初始化、暂停 L1、第三方连接和桌面独立宿主组件仍不在本次实施范围。
