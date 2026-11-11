# 原生能力直接发现与实际可用范围

## 当前源码与验收入口（2026-11-04）

原生能力路径使用固定 Codex 0.163.0。Main 保留业务派工职责，不暴露原生协作工具；Worker 可使用原生协作。原生工具允许普通项目读写及网络，HOME/runtime、浏览器控制数据和执行资源保持独立保护；不能将早期“工作区外一律拒绝／网络默认拒绝”当作当前权限。Code mode host 当前由 Engine 开启。记忆边界见[原生记忆](26-native-memory-feasibility.md)，MCP 配置与用户批准见[管理契约](native-mcp-config-management.md)。

固定引擎专项按[测试说明](testing.md#固定原生协议与合成验收入口)显式执行。`native-tool-acceptance.ts <固定二进制>` 当前检查普通项目/回环访问、受保护 HOME/runtime、Skill/MCP 实际调用、停止、后台活动和安全重连；不再用普通文件的旧越界/临时授权假设代替现契约。主/Worker 的迟到及失效审批另由审批协议测试覆盖。真实模型自主选择、原生子 Agent 执行、远程连接和正式安装仍须各自验收。

## 历史能力开放与发布记录

下文保留当时工具目录、网络策略、页面与发布证据，不用于判断当前源码或日常 App 已采用。

2026-10-23 源码现状：顶部“能力”、完整管理页及专属 HTTP／开发 IPC 已删除。能力通过主对话交办；ChatGPT 测试登录界面删除不改变现有认证。MCP OAuth 暂无 Homer 用户入口，隐藏配置仍需可信原生配置路径。以下历史发布和页面验收记录不代表当前页面可用；当前边界见[移除说明](2026-10-23-remove-capability-settings.md)。

更新：2026-10-18。此批复用固定 `codex-cli 0.163.0`，没有升级依赖。发布版本和真实调用结果见文末回执；准备过程不能作为日常采用证据。

后续对话内安装审批、目录通知修复和真实自主安装验收见 [工具生命周期验收](31-native-tool-lifecycle-validation.md)。原生目录查询失败与整个账号未登录分别核对，不能据旧错误重复登录。

## 使用

在[同一个主对话](http://127.0.0.1:4780/)正常交办工作。已安装、已授权且当前原生连接/模型支持的工具由 Codex 发现和加载，不再需要逐功能打开 Homer 开关。若需要查找工作方法，在同一对话请求 Agent 读取原生目录或搜索插件与 Skill。安装或卸载先展示原生详情和来源，再沿准确真人审批卡操作。Homer 不再提供该管理页或 MCP OAuth 用户入口；已有认证保持，正式认证方案另议。

MCP 新连接批准后默认使用原生发现的工具，可选工具名只用于用户主动收窄范围。已有专属原生配置的合法连接保留原生名称和字段，不受简化表单字段限制。Shell 默认仅在 Homer 工作区操作，指定外部项目及高权限操作沿原生审批。

## 当前批次改变

- Engine 专属HOME分支移除 `-c web_search=disabled` 及 Shell、看图、snapshot、Skill搜索、plugins、Apps、browser、computer、image_generation、Hooks、code_mode 的覆盖。缺省值、用户配置与模型能力由固定原生决定，没有把未知flag统一设true。
- 专属 `.system` 与已安装插件 Skill 直接发现；外部目录方法不继承。主Agent和Worker采用同一原则，没有能力版本库或逐任务工具代理。
- 复用 `experimentalFeature/list`、`modelProvider/capabilities/read`、`skills/list`、`plugin/list/search/read/install/uninstall`、`app/list`，不重造插件安装器、Apps客户端或平行配置库。部分目录失败不会关闭其他能力，界面区分配置、连接报告和实际调用。
- 新原生配置仍经原生管理服务。模型不能自行批准新程序、连接、插件安装、本人登录、费用或外发；用户UI操作与模型工具权限分开。
- 保留多Agent双flag及agents.enabled关闭、原生记忆关闭、analytics/feedback关闭、最小环境、Homer唯一业务owner与既有记忆/publication。共享HOME兼容分支继续隔离全局能力，不用于当前专属日常。

## 固定版本证据及缺项

依据本机实际二进制 feature list、0.163.0生成协议、[对应固定源码](https://github.com/openai/codex/tree/rust-v0.163.0/codex-rs)和隔离调用；最新在线文档不替代固定版本。

| 能力 | 此批证据与实际边界 |
| --- | --- |
| Shell/文件/看图/snapshot | 固定原生真实沙箱实调、主/Worker合成接线通过；外部范围需要原生许可 |
| 搜索 | 原生默认cached，专属配置可选live；真实连接报告支持。Shell断网不等于禁用原生搜索。同一专属主thread已真实执行search_service.web_run并返回官方来源链接 |
| 图片生成 | 当前连接报告支持，原生提供工具；固定源码原生文件在CODEX_HOME/generated_images。新增当前thread/turn原生PNG通知保存至当前工作目录、Worker实际文件暂存及原publication链；合成图片通过，未发付费图片生成测试，不宣称真实生成已验收 |
| Skill | 标准SKILL.md原生发现/按需加载/启停；原生插件目录搜索可用于查找工作方法，无额外功能白名单 |
| MCP | stdio/HTTP真实echo与目录、原生OAuth合成验证；自用及已授权配置供主/Worker，真实第三方连接仍需本人授权 |
| Plugins | 固定原生空HOME、本地纯Skill插件读取→安装→发现→卸载实际通过；UI合成确认/取消/刷新通过。本人连接远程plugin/list实际成功6626项，修复15MB原生帧超过宿主2MiB限制；同一主thread原生搜索成功。未自动安装远程插件 |
| Apps | account/read确认ChatGPT已连接；app/list目录/refresh上游401/403仍失败，但原生Apps中的search_service已真实调用成功。不能把目录失败等同全部Apps不可用，也不重复全账号登录 |
| 浏览器/电脑操作 | 固定版本flag存在并默认开，但app-server扩展表未提供独立browser/computer工具；需原生发现的相应插件、模型和运行环境。不以flag冒充可操作，不拿Cindy宿主工具当Homer工具 |
| Code mode/Hooks | 保留原生默认和显式用户配置；code_mode当前默认false/开发阶段，不强开未知执行路径。安装插件可能带Hooks，详情确认先于安装 |
| PPT/Word/Excel/PDF | 沿原生Skill/工具发现与既有成果验收/publication下载；没有自造办公引擎。本机既有依赖生成四格式、正文数值核对、系统预览图及正式publication后的浏览器下载hash通过；真实模型自主选择方法和制作另验 |
| Shell网络 | 整轮network授权曾实证可触及宿主控制入口，继续拒绝此扩大授权；正确代理/网络隔离尚待完成。搜索/MCP/Apps各自原生连接不因此全部关闭 |

## 隔离验收

稳定契约RED→GREEN覆盖默认不覆盖、原生配置完整保留、MCP默认发现及模型不得扩大授权、原生插件详情hash冲突/用户确认、部分目录失败与外部来源隔离。全量check及浏览器结果见发布回执。

`node --import tsx scripts/native-plugin-acceptance.ts <固定二进制>`：只创建空HOME、本地纯Skill插件；无模型、账号、程序或网络依赖安装。原生marketplace必须采用 `.agents/plugins/marketplace.json` 标准布局；初版临时夹具布局错误曾被原生明确拒绝，改正夹具后通过，没有放宽产品校验。

`scripts/native-tool-acceptance.ts` 固定二进制隔离验收通过：Shell/读写/看图、越界拒绝、精确文件许可及结束撤销、主/Worker MCP实际调用、Skill正文按需加载、审批拒绝/停止/超时/同thread恢复；使用loopback脚本Responses，不是本人模型自主决策证据。

临时证据在 `.codex/scratch/native-capability-unlock/`；维护备份只放private、权限0700/0600，不复制auth/Keychain。更新不删专属HOME/会话/配置/用户Skill。任何新业务事实后仅前向修复，不回套旧DB。

## 发布回执

第一批已于2026-10-18 11:04（Asia/Shanghai）正常自动交接上线：`5a26a14d656b`，完整源码 `5a26a14d656ba3a8291acbb05830e50085c5815b0c5b5b01261026033266a025`，UI `dd78bd62f9a868c5098a7d1c9b2553457274ee316f620420f2cbd123f7f9556e`。原Terminal/launcher94963保留，host95085→89740，同一新主thread恢复；此前授权开发首轮只简短回复，无工具/派任务/记忆写入/微信外发。

427通过、0失败、2既有跳过，全量check退出0；固定原生插件及工具实际验收退出0。首次check的21项夹具失败和后续新增验收脚本5项类型错误均已修正并重跑，不以失败结果宣称通过。浏览器605/1470确认原生搜索输入、安装前确认/取消/详情、安装后刷新、卸载和独立停止；resize窗口与已有CDP模拟宽度冲突已纠正为实际Emulation并断言innerWidth。

实际资源2项逐一hash匹配；原生account/read确认chatgpt连接，专属HOME采用，微信connected，六uncertain整行hash相同。55业务表除wechat_connection正常generation变化外相同，绑定其余字段严格相同；记忆、schema、五MAIN_TOOLS、配置及所有旧历史保留。维护点 `.codex/private/native-capability-unlock-release-20261018/` 具一致性业务/transport备份、源差异CAS、完整前后构建清单。发布没有手动杀进程或停自动更新；新业务事实后不回套DB。

上线后真实原生目录发现许多专属插件/内置Skill，UI下一小批折叠显示数量以保持简洁；远程plugins首次结果为engine_invalid_message，Apps仍为engine_authentication_failed，均没有关闭其他能力。另发现模型元数据可绕过multi_agent双flag列出协作工具；无实际原生子Agent创建，正补用固定源码agents.enabled=false并以实际目录消失验收。

### 后续边界修复验收

固定0.163的 `multi_agent_version_for_model` 在双flag关闭时仍可能采用模型元数据的V2；`agents.enabled=false` 才给出明确Disabled覆盖。已补真实native目录RED→GREEN，实际不再列出collaboration/spawn_agent；不是禁用Homer自己的Worker调度。

真实plugin/list返回6626个目录项目，单帧15,351,519字节，原2MiB限制是失败根因。原生目录RPC特定响应放宽到32MiB，普通/旧HOME响应继续2MiB，并有超限拒绝测试；原生查询已实际成功。UI分页展示，模型目录摘要最多30项并引导原生搜索，不截断配置/可用工具或引入白名单。Apps仍单独认证失败，不把目录修复当Apps成功。


### 第二批实际发布与本人模型证据

`0657e26c2094` 已正常后台构建→自然空闲自动交接，完整指纹 `0657e26c2094da55252891d7787e9692b8fb2a74cb717681eb81072d348b2503`，UI `72a5ad015e1d90c62feaa36de46d61c72c380659e287df352ea5982e1fc4405c`。432项全回归：430通过、0失败、2既有跳过，退出0。原launcher94963未变，host89740→6490；资源、专属目录、原生账号、同一主thread、55表/记忆/原事实、六uncertain整行hash及微信绑定均按维护点核对。只有连接正常generation推进，没有schema/依赖/五MAIN_TOOLS变化。

在唯一新主thread `01a14cdb-1d34-7600-b067-2f1eb4928132` 已完成获准的两轮开发验收：先只简短回复持久化，再只读原生网页搜索与插件查询。原生 `codex_apps/search_service.web_run` 和Homer原生capabilities均成功，回复含官方Skill指南链接。未建其他真实模型thread/Worker，未安装插件、写记忆或微信外发。只从该thread自身专属rollout提取工具标识/成功状态元数据作为回执，未输出工具参数或账号正文。原先空thread的resumable fence已由真实首轮持久化满足，并通过两批正常自动切换证明同thread恢复；不再需要补发首轮。

### 文件交付接线与验收（第三批已发布）

原 `stage_file_result` 要求模型把小文件转base64，不适合正常办公文件。新增Worker专用 `stage_workspace_file`：只能读取本Run实际相对路径，经现有Files的canonical/软链/硬链/50MiB校验、Run epoch/记忆检查后暂存。Markdown、二进制与workspace文件暂存共用材料读取前置：当前已采用契约含material/result/attachment输入时，须先成功调用read_material；没有这些输入可直接暂存，显式空读取不记录材料读取成功。adopt_version会清除旧读取标记，有输入的新版本须重新读取。没有新业务库、下载后门或格式白名单；仍须task_complete、主验收、根publication，下载仍只用Run ID并复核文件hash。主五工具不变。

固定0.163 `item/completed imageGeneration` 提供原生PNG字节。Homer只处理当前活动thread/turn，按20MiB/40M像素边界保存到本工作目录的 `native-image-*.png`；保留CODEX_HOME中的原件，不读取通知savedPath或任意原生文件。重放幂等、不替换已存在/软链文件；失败明确返回未能保存，不能把原生“已展示”提示当Homer已交付。原生生成图接收不另设每轮张数上限；分析使用原图，320px缩略图保留。大图片仅本轮通知可用32MiB帧额度，普通通知及现有MCP读图仍2MiB。

本批稳定契约RED→GREEN，新增8项；全量 `npm run check` 440项：438通过、0失败、2既有跳过，退出0。新增验收脚本首次缺requestId/summary/Response类型和错误路径不匹配，分别由类型检查及断言拒绝，修正合成脚本后通过；没有修改产品路由或降低校验。

`scripts/native-file-delivery-acceptance.ts <已存在Python路径> [--serve]` 不接账号/模型、不安装依赖，调用已有python-docx/python-pptx/openpyxl/pypdf/Pillow生成合成DOCX/PPTX/XLSX/PDF/PNG。四份文档实际提取标题及120/90/30数值，通过真实Run暂存→complete→内部验收→根publication；内部验收后仍拒绝下载，正式发布后Node及真实浏览器同源HTTP下载全部字节hash相同，未知Run拒绝。605/1470页面均五个下载链接且无溢出。系统Quick Look导出四份实际PNG预览：DOCX/PPTX/PDF可读；XLSX系统缩略图裁切，单元格数据已由原生格式读取核对，缩略图不代表完整排版验收。没有将合成链路称为真实模型自主制作、真实图片生成或手机媒体交付。

临时文件/预览/回执仅在scratch；维护使用源码、脚本和测试保留在正常目录。日常原浏览器页检测到草稿，因此未刷新/导航/清空，另开能力核验页；不点击真实停止或提交真实测试。


### 第三批发布回执

2026-10-18 11:28（Asia/Shanghai）已通过正常自动交接采用 `0e882dae2fb8`，完整源码 `0e882dae2fb8ef297e6875680dcbdca465e0bbb76f46c84ad23807896e1e5dc9`，UI维持 `72a5ad015e1d90c62feaa36de46d61c72c380659e287df352ea5982e1fc4405c`。此批438通过/0失败/2跳过，全量check退出0；最新固定0.163真实工具隔离回归退出0。

维护点 `.codex/private/native-file-delivery-release-20261018/`：两次最新空闲、业务/transport一致性备份、源差异CAS、完整前后构建资源清单、实际采用回执。原launcher94963/原Terminal保持；最终host12299→12511，主thread不变且正常恢复。专属原生account/read仍chatgpt/connected，实际2项资源hash匹配；55表除正常wechat_connection generation变化均相同，绑定其余字段严格一致，六uncertain整行hash不变，schema/配置/五MAIN_TOOLS/依赖/网关协议均未改变。无历史导入/删库/重放，无额外登录/模型调用/微信外发。

首次同步因新维护脚本目录不存在，在任何正式源码rename前以ENOENT退出1。临时文件曾放在被watch的源码目录，触发正常构建/恢复；版本始终为原0657，旧host6490→12299，没有手工kill。已清除仅本次生成且内容hash匹配的12个临时文件，核原正式源码指纹，再把暂存移到private维护点、补父目录创建并重新做两次空闲；后续同步/采用/核验均退出0。此失败与后续修正有独立回执，不能将最初“watch未触发”的推断当事实。

日常另开能力核验页，605/1470实际innerWidth和scrollWidth相等；原生目录读取显示6627项、199个Skill，首批只呈现30个并保留继续显示和原生搜索，没有逐功能复选框。Apps目录失败单独可见，网页搜索/图片生成连接支持分别显示。原日常有草稿的页面未刷新、导航、清空或发送；实际停止仍只在合成实例点击，日常不停止用户回复。完整UI hash保留停止44px/aria/title/等待disabled-busy及独立发送。

本阶段不要求本人重复认证。当前可在同一主对话直接交办；若某能力实际需要额外插件/运行环境、第三方连接或付费，将具体展示缺项并沿原生本人审批，不能把设置已开放冒称所有远程服务已授权。原生记忆替代仍是独立待验证阶段，此批没有替换自建记忆。


### 当前仍需具体条件的能力

| 能力 | 已核事实 | 下一步所需条件 |
| --- | --- | --- |
| 浏览器/电脑操作 | 固定app-server没有独立browser/computer扩展工具；原生搜索browser实际返回28项及后续页，Browser Use、BrowserAct等首批候选未安装。已发现的ios-simulator-browser是iOS模拟器专用方法 | 按实际工作目标在原生目录读取所需插件详情，再由本人批准所示插件、第三方授权或本机运行环境；不自动安装未知插件，不升级固定引擎，也不借用Cindy浏览器 |
| Apps目录 | 连接已由account/read确认；目录先后返回上游401/403分类和engine_rpc_timeout，其他原生Apps搜索工具已真实成功 | 核对具体Apps目录服务/连接的原生状态；没有证据需要重做整个ChatGPT登录，不复制凭据或自动持续重试 |
| 图片生成 | 连接支持、专属imagegen Skill已发现；通知→当前工作目录PNG→Run暂存→publication→下载合成验收通过 | 尚未进行真实模型生成，可能消耗生成额度；实际生成失败必须报告原生原因，功能没有因“未验”关闭 |
| Office制作 | 原生199个Skill中发现data-analytics:convert-to-slides、report-to-pdf等；原生slides搜索28项及后续页。四格式实际数据/文件/预览/下载链已验 | 本机Python只由隔离验收脚本显式使用，没有扩大Worker读范围或暴露private依赖目录。真实任务复用实际原生Skill/工具及其依赖；通用Word/Excel自主制作仍不能由合成脚本冒充。如缺具体依赖/范围/外部连接，在实际对象上审批 |
| Shell联网 | 原生断网、拒绝整轮网络、批准普通命令不授予网络及许可不跨轮均实证通过 | 整轮许可仍会使进程触及宿主控制入口；需要正确网络代理/隔离后才可放宽。原生搜索/MCP/Apps各自连接可用，不因此关闭全部能力 |
| Code mode/Hooks | 无Homer强制false覆盖，固定原生默认/用户显式配置与模型条件生效 | code_mode固定版本默认false且开发阶段；不盲强开未知flag。Hooks随所示插件/显式配置及实际审批，不自动执行新脚本 |
| 原生记忆 | 此批保持现有唯一记忆，不混入原生第二真相 | 按独立阶段验证同主thread保存/重启召回/纠正/遗忘和迁移映射；没有本轮迁移或删除旧记忆 |

目录数量是2026-10-18本次查询快照（6626→6627），不是固定上限或人工工具白名单。未额外调用真实模型、登录、安装、费用或业务外发来消除上述缺项。
