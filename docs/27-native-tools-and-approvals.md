# 原生工具、审批与专属目录采用

**最新能力直接开放批次见[29](29-native-capability-activation.md)**：用户已要求移除额外的一刀切功能禁用；本页早期手动开关/未采用状态仅对应历史阶段。固定原生默认/配置/能力发现为准，具体操作审批与网络边界保留。

更新：2026-10-18。 浏览器原生登录入口于09:04随 `6b2d91e39213` 自动更新上线，后续已于10:33切换专属HOME并创建全新开发主对话c72dc2e523a7，旧数据保留、首轮恢复待本人使用，见[28发布回执](28-native-home-adoption.md#登录入口实际发布回执)。**最新决定：开发环境取消旧rollout导入，登录确认后在专属HOME创建全新主对话；旧数据与既有记忆保留，方案与副本实证见[28](28-native-home-adoption.md)。以下旧单会话导入仅为历史合成研究，不再执行真实迁移。** 固定 `codex-cli 0.163.0`，唯一 Homer 业务管理者。本批接线00:06发布后，网络权限收口于2026-10-18 00:24经原后台构建/安全空闲自动切换发布为 `7a02ce032a85`；版本及实际采用限制见下文。原账号、原主对话及自建记忆仍保持原归属，不能把管理入口上线称为原主对话已采用专属 HOME。

## 本批行为与权限

专属引擎默认提供已实调验证的 Shell、文件操作、查看本机图片和 Shell 快照。配置覆盖只存原生 `config.toml`，通过原生 `config/read` / `config/batchWrite` 校验和 CAS；没有新能力数据库、MCP 客户端或 Skill 加载器。Web“能力”页可保存这三项工具选择，分别显示已保存和当前对话已采用的状态。旧 HOME 绑定明确显示只管理专属配置。

主 Agent 默认只写 Homer 工作区。Worker 默认只写自己的 Run 目录，原任务来源、成果 Markdown／已授权媒体及 publication 校验继续有效。新增外部项目文件权限由原生 `request_permissions` 申请精确路径，默认网络关闭。固定引擎的整轮网络许可会同时允许直接访问本机控制入口，实测配置域名限制不能约束 `curl --noproxy`。因此Homer当前**拒绝整轮网络提权**，不展示可批准卡片；Shell工具网络扩展尚未接通。已经明确授权的原生MCP连接继续按原范围联网。文件临时许可仅本轮有效，命令单次批准不增加文件或网络权限。

原生审批直接成为主对话待答卡，不等待另一轮模型。真实用户点击“允许本次操作”／“拒绝本次操作”，用户收据持久提交后才释放原生回调。模型/Worker 的原交互管理工具不能替主 Agent 自批。拒绝、停止、结束、重启和超时后的旧回调不能重放。请求绑定当前 thread、turn 和主轮；超大审核内容失败关闭。文件补丁显示路径和变更，原生私有目录/runtime 及其软链、祖先范围不可通过此入口提权。单个原生问题支持直接文本回答；多个问题目前仍需按卡片结构提交 JSON，尚无多问题表单。

Shell 子进程不继承完整父环境或引擎传输代理变量。原生权限配置保留 root deny、minimal read 与明确工作目录；不开放整盘。Shell 快照在专属原生目录。后台命令可比模型轮次活得更久，因此通过原生 `thread/backgroundTerminals/list` 确认真实结束后才允许更新/配置重连；无法确认时保持忙碌，不自动扩大权限或无限重连。原生 multi_agent 两项仍 off，analytics/feedback off。

## 固定版本能力表

| 能力 | 当前类别 | 实证和采用边界 |
| --- | --- | --- |
| stream / usage / interrupt / steer / resume / compact | 已有原生复用 | 保留既有队列、停止和原 thread；本批不重造这些机制 |
| config/read、batchWrite、model/list | 原生接通 | 原生文件为唯一真相；有效配置、用户覆盖、当前模型/effort目录支持分开；不切模型 |
| Shell、apply_patch、view_image、shell_snapshot | 本批实调接通 | 固定二进制 + 新 HOME + loopback 脚本模型；实际命令/文件/图片输出和拒绝/停止/超时，未调用真实模型 |
| 主 Agent 审批、精确文件临时权限 | 本批实调接通 | 原生回调 + 现有交互/history owner；批准/拒绝/迟到/存储失败/自批防护与轮次失效均验证 |
| Shell工具网络 | 固定引擎权限范围限制，未接通 | 整轮网络许可无法排除宿主管理接口，Homer拒绝该请求；命令批准仍不能联网。原生已授权MCP不受此限制 |
| Skill 标准文件/发现/按需加载/启停 | 原生接通 | 原生解析与目录，Web按名称/描述查找；原生语义搜索 flag 可配置但未证明真实模型搜索效果，界面不冒称支持 |
| MCP stdio / HTTP / 工具目录与调用 | 本批补全模型和 Worker 调用 | 线程配置必须携带经校验的专属 MCP；原生 `ALL_TOOLS` 中实际调用两个 transport；空列表仅检查连接 |
| MCP reload / 新设置采用 | 安全同 thread 重连 | 保存后下一主轮检查版本；自然空闲、后台命令结束且原 thread可恢复后关闭旧进程并恢复同 thread。空新 thread尚未产生首轮时延后，不伪造输入；不热替换运行中Worker |
| MCP OAuth 登录/状态/退出 | 原生接通、仅 Mock 登录实证 | AppServer登录、原生file store；固定版本无 MCP logout RPC，退出复用固定原生 `codex mcp logout NAME`。不是 account/logout，不读 Token；退出需用户明确对象授权 |
| Worker 使用 Homer 已授权 MCP/自用 Skill | 本批实调接通 | 新Run使用同一专属原生配置与目录；可调用两类Mock MCP、加载自用Skill，不能写主工作区；不冻结版本/不造按任务代理 |
| code-mode host | 已实际复用 | 原生函数目录和 builtin/MCP 调用经 `functions.exec`；不另造 JS 客户端或开启另一业务管理者 |
| 网页搜索 | 待模型/原生服务验收 | 固定模型元数据声明支持、配置能读写，不等于搜索实际可用；默认 disabled，无真实查询/外连证据 |
| browser / image_generation / Apps / plugins / computer / Hooks | 后续实证门槛 | 协议/flag或模型元数据存在不等于执行通路可用；本批保持关闭，没有电脑点击、付费、安装或Hook执行。须逐项真实调用、拒绝/停止/超时、权限及数据保留后分批接通；不升级固定依赖 |
| 原生 memory | 替代可行性阶段 | [26](26-native-memory-feasibility.md)门槛尚未通过；本批不双写、不迁真实旧记忆 |
| Homer Task/Run、队列、内部验收、publication、渠道收据 | 不替换 | 业务 SQLite 与唯一原管理者保留，六条 uncertain 不重发 |

原生工具目录在模型请求 `input.additional_tools` 中，MCP 还通过 `ALL_TOOLS` 延迟发现；顶层 `tools` 为空不能判为不支持。旧记忆探针此前按顶层检查；最新V1/V2已按正确路径验证追加note、重启同thread读取及模型MCP污染状态。遗忘为追加说明，完整替代门槛见26，未切换日常。

## 验证与复验

使用 Node22.22.0、固定二进制、新空 HOME、合成 SQLite、Mock stdio、loopback HTTP/Responses/OAuth。脚本模型只发指定工具调用，没有真实账号/模型/微信外发，不创建真实测试 thread。真实模型自主选择、真实网站/登录及手机表现均未由合成替代。

- 最新 `npm run check` 退出0：**396通过、0失败、2跳过**，包含网络控制入口边界的新增契约。此前395项为00:06发布基线；两项跳过仍为需要显式旧构建参数的固定 UI 专用用例，先前维护已独立验证。
- 稳定契约 RED→GREEN：用户收据失败不能解锁、模型不能自批、后台命令阻止更新、专属工具默认值、原生OAuth退出、私有目录/软链范围拒绝。既有原五 MAIN_TOOLS hash、Web protocol、gateway和依赖不变。审批owner文件变化触发原有源码schema审阅保护，未修改guard。
- `scripts/native-tool-acceptance.ts <固定codex绝对路径>`：实际原生Shell/patch/image；工作区可写、外部/私有HOME拒绝，文件轮次失效、整轮网络申请被宿主拒绝、单次命令批准仍不能联网；父环境隔离；主/Worker实际MCP与Skill；中断、后台结束前延后采用、原thread重连和超时清理。
- `scripts/native-capabilities-acceptance.ts <固定codex绝对路径>`：标准Skill/配置/MCP目录、流式/steer/usage/resume、Mock OAuth真实原生登录→调用→重启凭据复用→另一空HOME未登录→原生CLI退出→重启未登录；不读凭据内容。
- `scripts/native-data-update-acceptance.mjs`：15类合成应用数据marker，经正常成功和失败构建hash保持、构建不打包用户数据；包括会话、索引、缓存、日志和记忆准备marker，缓存/日志仍遵循正常有界保留。
- 真浏览器4802：同一Homer/Web/SQLite、脚本主引擎，批准/拒绝卡、刷新待答、停止图标、保存工具设置刷新保留及并发CAS拒绝保留草稿；最新收口再次实点：网络申请明确拒绝且无批准卡、项目读取可批准，605/1470布局与44px控件。早期网络允许卡验证已被本次拒绝策略替代，不能作为当前可用证据。此UI夹具不执行真实外部操作，原生实调由上一脚本覆盖。

首轮隔离副本全量检查因缺少临时父目录、公开 examples 和本机媒体 venv引用，19项失败；补齐后2项仍缺venv库，补齐既有 `lib`/`pyvenv.cfg` 后395通过。没有安装新依赖或放宽断言。旧1×1图片不能解码、MCP仅检查inline目录/未先持久化空thread、原生TOML数组序列化等探索夹具错误另有日志，不算原生不支持。保留相关失败和成功退出码。

## 使用与专属 HOME 的真实采用

新安装默认 `<Application Support/Homer>/codex`，已有显式旧 `codexHome` 保持绑定。只有已绑定专属 HOME 的主引擎才启用本批原生工具；旧主引擎不偷接全局配置、外部Skill或新权限。保存时看到“仅保存专属配置”就意味着当前日常尚未采用。

真实采用仍有两个独立门槛：

1. 用户本人通过固定原生账号登录界面，在 Homer 专属 HOME 完成合法登录；不发送Token、不复制/软链旧auth。原生登录状态尚未确认。
2. 用户最新选择开发环境全新主thread，**不导入旧rollout、不保留原ID为当前主thread**。旧会话与业务数据不删除、不重放；自然空闲、备份/正常停机后仅解除当前thread/usage绑定，Homer在专属HOME创建新主thread。55表副本保留实证与确切meta范围见[28](28-native-home-adoption.md)。该切换尚未执行。

遇此缺口继续交付独立可验部分，不静默退回共享HOME。没有新的证据前，本页不能把专属工具称为日常已采用。

## 日常发布与回退

2026-10-18 **00:24（Asia/Shanghai）最新兼容修正已自动发布**，日常入口仍为 <http://127.0.0.1:4780/>，顶部“能力”进入设置页。只发布本批已验接线；原主引擎仍 `boundToNativeHome:false` / `isolated_configuration_only` / `activeToolSettings:null`，未宣称Shell/Skill/MCP已加入旧日常对话。

| 项目 | 真实值 |
| --- | --- |
| 业务版本 | `7a02ce032a85` |
| 完整源码hash | `7a02ce032a853a2c7ced4e9693d694868ac51fb93a22ae2eefc8a278fcfba8e0` |
| UI | `c4816d984756ea03bae737b08b5695142f206cdabdb726adb673a218721607da` |
| JS / hash | `index-CQDDfjAU.js` / `51b6302d85736bcbc621613da4c2a0af93f6ae7aae1be9eeb50e0962d32ffde7` |
| CSS / hash | `index-CoF7gDUY.css` / `d4102669d2a76634c7205d64c36c871e7343b33864100075d6bc52b459775f9b` |
| gateway | `8245affd1cb8639af0214b3aab8c69579511cf8dfee1db12bf89d0fe9341cfdf`，未变 |
| 依赖 | `6ec82c3861e35ea215327c670026ca067320f4f5602a70bc38b93e198ba8a712`，未变 |
| SQLite schema | `7bb04862cc7dedde54ba98eee74a942368d7e3e0a79332878e764d0ed3a5f4a0`，未变 |
| MAIN_TOOLS | `e6d674a05ae34945a5e234a2b1f55029f0d319e51371f448911845224062cf9a`，未变 |
| 原Homer配置 | `0bf61829ef7d0e937a962b84dec362c03f258a5c24e1fbea1aa0f8a9bda76ff3`，未变 |
| Web protocol | 1，未变 |

以下00:06显式维护建立 `7b72cf97b60c` 基线；00:24后续兼容自动切换另见下一段。维护前原库只读副本和停服后新备份分别预演：55个原非meta表、原metadata、thread及六uncertain保持，quick_check=ok、FK=0、schema完全相同，离线恢复副本字节/事实一致。没有迁真实业务库。两次临近自然空闲核对主轮、Worker、任务/待答/待审/队列、transport、渠道发送均为空；主引擎与控制引擎lease均核属原launcher子进程。准确旧launcher92892正常SIGTERM，816ms内全部归属进程退出，两锁/lease释放，无强杀。

维护点 `.codex/private/native-tools-release-20261018/` 为0700，原配置、源文件CAS备份、maintenance/transport SQLite、旧完整构建清单和维护/回退材料为0600；不复制auth、Keychain或私人Codex目录。仅17个审核文件同步，全部原dirty候选保留。随后在原Terminal7325、tty `/dev/ttys000`、shell47294启动正常 `scripts/dev.mjs --web --config <原配置> --port 4780`。核查时launcher17319/host17355；PID仅当时证据，后续须重新核身份。

上线核验原thread `01a1437f-9fcd-7950-9e8b-c6f96f7f61f0`、微信connected、transport pending/rejected=0。真实源/编译清单、HTTP index/JS/CSS均匹配已验构建。55表核对仅 `wechat_connection.generation` 正常重连增加1，其余表行hash和非lease metadata不变；六uncertain逐行hash不变。未发送真实测试消息，未点停日常回复。确认两任务浏览器页无草稿且主轮结束后刷新，605/1470实测无横溢、独立发送/上传/能力入口保留，设置页显示专属目录未采用提示。

普通后台构建→安全空闲切换→原thread→兼容启动失败回退入口继续运行，没有再次固定旧版本或取消保护。因审批owner源码变化，本次通过显式维护建立已审阅基线，未伪造schema指纹或改guard。相关忙碌延后、自动切换/失败回退的真实合成子进程回归在395项中通过；新增native后台命令阻止切换另经实际原生目录和服务回归验证。没有在日常注入故障。

回退优先前向修复；只有正常停服、两锁/lease释放、源文件CAS、schema及原业务事实核对通过，才能执行本维护点 `rollback-source-only.command`。它仅恢复本批源文件并启动正常自动入口，**不覆盖业务DB**；只容许已逐行审阅的正常重连generation值和进程lease（最新私有回执为34→37），其他metadata仍须一致。有新业务事实则拒绝旧快照回退。旧d3a完整构建清单保留，没有重写其资产。备份DB不能因代码失败自动套回。

证据在 `.codex/scratch/native-capabilities-expansion/`：`native-expansion-release-full-check.log`、`native-tools-release-acceptance.log`、`native-oauth-logout-verified.log`、`native-data-release-preservation.log`、`native-tools-daily-release-receipt.json`、`daily-browser-conversation.json`、`daily-browser-capabilities.json` 及605/1470合成PNG。私人维护证据只留private。维护脚本首次复用已有目录的EEXIST，以及将驻留native-control误计为忙碌，均在任何停止动作前修正；驻留lease核属准确宿主后才通过。探针维护路径移动时的ERR_MODULE_NOT_FOUND已修正并复验，未操作日常。


## 00:24兼容自动更新的实际证据

网络边界契约先RED再GREEN，16项聚焦回归退出0，完整396项通过；固定引擎实际工具脚本退出0。另三个隔离网络配置探索不能阻止直接loopback请求，断言退出1，属于权限边界未实现的实证，未将这些配置部署。产品采用拒绝整轮网络提权的明确限制，没有伪称域名隔离有效。

仅6个审核文件CAS同步；正常构建比较gateway、依赖、Web协议、主工具和已审阅schema-owner全部不变。原launcher17319持续运行，由后台自动替换host为20953并恢复同一个主thread；没有维护停服/修改guard。HTTP index/JS/CSS与已验构建逐hash相同，微信connected、transport pending/rejected=0，六uncertain逐行hash不变。业务库schema及55表继续核对；仅连接表generation为原维护点34→37，其余字段、其余54表及非lease metadata不变。没有真实外发/测试消息。

日常对话任务页确认无草稿且主轮结束后刷新；605/1470均匹配最新UI，无横溢。原设置任务页的保守草稿检查把checkbox的 `value=on` 计作非空，退出1并未刷新；没有清空它。另开本任务自己的新设置页，区分checkbox后正常检查/刷新，三项工具和网络限制/未采用提示均匹配最新资源。浏览器误用fill/open参数分别400/INVALID_ARGS，修正后实际动作通过，不计为产品故障。首次上线核验早于后台完成而仍读旧版，退出1；等待真实running新版后核验退出0。

最新证据：`native-network-boundary-full-check.log`、`native-network-control-scope-{red,green}.log`、`native-control-boundary-actual-acceptance.log`、`network-boundary-daily-release-receipt.json`、`network-boundary-daily-browser-{conversation,capabilities}.json`、`browser-{605,1470}-network-scope-project-approval.png`。原395项/00:06证据保留，不能混作最新指纹。原维护点源文件CAS已更新，回退仍不覆盖业务DB；新增业务事实即前向修复。

## 专属 HOME 与原thread：限定迁移预演（未执行真实迁移）

当时使用专用合成预演脚本，固定0.163、新合成 HOME A/B、loopback 脚本 Responses，实际新建的是合成记录。该迁移方案随后取消，预演和导入实验代码及其专属测试已退役；历史结果如下：

1. HOME B仅给A的threadId恢复失败，`-32600`；全新B进程加跨HOME `path`仍报 no rollout found。首次探针将此未处理负例记退出1，随后明确分类；没有绕过或换引擎。
2. 关闭两个准确归属的合成进程，只复制A那一个新合成rollout到B相同sessions相对位置，**不复制任何auth/配置/SQLite/缓存/其他会话**。原生按原ID恢复成功，自行建立新HOME索引。
3. 原五MAIN_TOOLS完整定义hash相同；下一合成轮只写B的rollout，A源文件hash不变；再次关闭/重启B仍按原ID恢复，路径在B内。原生memory保持关闭，没有history重造或第二客户端。

结果在 `.codex/scratch/native-thread-home-preview/synthetic-home-boundary-receipt.json`；脚本只记录布尔/错误码/合成metadata，不接触真实Codex会话。此证据证明**选定rollout导入的隔离方法可行**，尚未证明真实账号登录、原会话全部附件可访问或真实模型四步记忆。

2026-10-18后续方向已覆盖上述研究：用户明确选择**不迁旧内容、在专属HOME创建全新主thread**。旧限定迁移批准不再作为导入依据，旧维护入口已取消所有动作，仅保留原生登录状态查询。本人登录实测尚未完成，日常仍用旧thread和旧显式HOME；最新本人动作、两项meta方案、55表副本验证及回退界线见[专属登录与全新主对话](28-native-home-adoption.md)。没有创建真实新thread、改日常配置或清空旧库。
