# 桌面使用原账号和聊天的采用方案（待整合）

2026-10-23，延续同一桌面发布任务。用户再次要求直接安装并打开使用；本说明把尚缺的实际接线与数据边界具体化，不把隔离假引擎准备包当作可日常使用版本。没有复制、迁移、重绑定真实数据，没有创建新账号、thread或模型轮，也没有清锁或修改租约。

## 已核准确来源

原维护配置为维护仓库 `.codex/private/local-chatgpt.config.json`。只读取必要路径和配置元数据，未输出凭据或聊天。配置中无provider URL/keyEnv覆盖，模型为gpt-6.1-sol，effort/fast未显式设置，requiresOpenaiAuth=true；正式采用须按当前产品默认与原配置语义解析，不能继承Cindy或外部shell环境。

| 项目 | 原路径／元数据 | 建议桌面采用方式 |
| --- | --- | --- |
| 应用数据根 | `~/Library/Application Support/Homer` | 保持现有目录，不将它复制为新用户空间 |
| 原生账号、sessions、Skill/MCP及记忆 | `~/Library/Application Support/Homer/codex`，codexHome与nativeCodexHome相同 | 保持准确原路径；不复制auth、不软链其他Codex目录；真实connected状态仍须原生account/read确认，文件存在不能作登录证据 |
| 工作文件／成果根 | `<维护仓库>/.codex/private/workspace` | 沿原绝对路径，不重写成果/授权引用 |
| 业务库／媒体／队列 | `<维护仓库>/.codex/private/runtime-local-subscription` | 沿原路径，保留当前mainThread/mainAgentId、历史、任务、权限及未决事实 |
| 网关 | 上述runtime下 `gateway/transport.sqlite` | 保留请求行及原thread；发布如改变边界只通过具体维护点CAS，不重放 |
| 桌面壳专属管理根 | `~/Library/Application Support/Homer Desktop`，当前不存在 | 可作机器私有的明确采用描述、壳HOME/tmp与版本身份根；不得因此默认建立空白业务账号 |
| 执行代码 | 原固定Codex0.163.0路径位于维护私有engines目录 | 改为已安装App内同版本、校验过的Codex；业务数据路径保持，网关边界须精确处理 |

业务bindingVersion=2，按原配置／原路径以现有owner公式重算与库内binding吻合。业务与网关的thread指针吻合；本说明不记录原thread正文或原ID。业务schema为pending1/recursive3，目标产品为recursive4。读到73条runs、67条tasks，6条open pending；网关3条rejected、0条pending。不能把open pending或旧rejected当作应清空的安装障碍，也不能重放这些事实。

原生state_5.sqlite存在且SQLite文件头有效，但当前受限上下文SQLite只读连接返回unable to open database file；没有绕过为可写连接。因此原thread在原生索引的可恢复性仍未核实，不能以文件存在冒充恢复通过。后续可在宿主正常权限下做明确readOnly检查，不读取rollout正文。

## owner与维护点状态

原runtime仍有cli.lock以及lease:main/lease:native-control两条持久记录。只读宿主核查记录中的PID21363、21366、21546及原PGID20554均不存在，身份查询为空；lsof未发现原业务库、网关或锁的打开引用。扫描未见Homer launcher/host/App。此为当前快照，不自动授权删除锁/租约，不能证明任意脱离父进程的原生操作或未知审批已停止。

准备包runtime当前遇任何持久lease均以desktop_lease_review_required拒绝，profile也只接受固定子目录。故现成build006不能沿原数据启动，单纯复制App到Applications不能实现用户要求。

## 建议的最小整合闭包

1. 保持稳定bundle id、默认壳管理根及现有删除登录/能力页面的产品决定。仅为已有用户增加显式、私有、可验证的原配置采用描述：包含上述准确canonical路径、来源身份和受控配置快照；不成为任意环境／代码执行入口，不接受跨用户或软链路径，不默认扫描别的账号。首次新用户连接能力另列，不通过旧登录页回退实现。
2. `desktop-profile.mjs` 与 `desktop-runtime.mjs` 在采用模式返回准确原runtime/workspace/codexHome及nativeCodexHome；原生HOME/sqlite_home/log/session绝对路径均沿原配置。壳的host-home/tmp仍隔离。已安装代码与数据输入分别核验，不把原配置或凭据放入App/manifest/文档。未采用的全新profile逻辑保持明确区分。
3. 以原owner正常生命周期处理旧租约和严格退出；未知原生执行/权限事实不清除。准备包目前的全租约拒绝需要原owner给出受控采用流程，不能在本机通过删lease绕过。对同原路径的业务binding不改写；若网关因执行路径／组件身份变化需更新binding，必须在维护点使用现有公式生成准确新值、CAS旧值、保留contract/thread/全部请求行，禁止删除网关库。
4. schema3→4及history/queue/artifact/权限需在私有一致副本上预演，核旧表列行／重要元数据与uncertain、FK、引用完整性，准确列出目标schema新增的正常差异。先验证候选原入口，再操作真实维护点；不先停服务后试错。此阶段尚未复制真实库。
5. 把准确采用增量和已审桌面闭包真实提交main，然后显式冻结完整SHA、从普通模式重新构建，不能将preparation标记或假引擎fixture改掉后冒充正式包。用户已授权正常安装/打开，无需重复询问相同授权；首次正式运行只确认原生account/read与原thread恢复，不代发模型消息或外发。

## 正式切换与恢复边界

停前再次核真实owner／未知原生操作／上传／审批／渠道与transport状态；无需等待全部历史开发或open pending完成。正常退出确认后制作Gitignored私有维护点，保护业务库、网关、配置、引用和最小对应构建；凭据不复制到发布材料。真实写入按阶段CAS，失败先核准确阶段，不反复执行。

正常安装到准确目标，从安装后的App启动并核包版本/Git SHA/sourceHash/manifest、前后端和引擎真实来源、原账号、原thread、历史、队列、成果及授权连续性。产生任何新业务事实后只能保留事实前向修复，不能旧库覆盖。安装验收通过后才执行旧无用安装包及无运行引用构建目录的最终清理；含人工输入的WK测试profile仍保留。

本方案不是已经完成的采用实现或安装证明。既有28文件桌面补丁及其SHA保持不变，独立review可继续；本说明作为单独的采用闭包交CTO／原owner审阅。

## 采用候选实施范围

后续授权仅在隔离候选修改 `scripts/desktop-profile.mjs`、`scripts/desktop-runtime.mjs`，补充 `tests/desktop-adoption.test.mjs` 和 `tests/macos-desktop-runtime.test.mjs`。采用描述只接受同用户私有文件、已核原配置及固定Homer数据路径，不接受执行命令、环境变量或客户端路径。运行时不迁移账号、不改网关binding；需要维护点CAS时准确拒绝。旧租约只有确认为不存在的进程才交回现有 `Homer.start` 恢复，活跃或无法核实者拒绝，未知工具结果仍由原owner记为unknown，不推断成功或重放。

先跑采用路径的合成红例，再验证私有描述／路径／配置hash／模式拒绝、旧schema3与原thread恢复、活跃及无法确认的租约、网关精确CAS副本与全部事实保留。真实只读备份离线预演只在Gitignored private执行，不触及原库。原28文件patch保持原样，新增采用差异单独交付，未审查提交前仍不安装。

补充自身桌面接线的必要边界修正：`src/engine.ts` 的既有浏览器deny根从环境HOME解析改为同一OS用户的真实home，防止隔离壳HOME后遗漏原Safari/Chrome等保护。目录名单、custom controlBrowserData与原审批/权限不变；`tests/desktop-browser-boundary.test.mjs` 用隔离HOME验证实际用户目录仍受保护。不新增访问能力或浏览器桥。

## 采用候选验收与明确剩余缺口

最终采用候选为本任务scratch `build-009/Homer.app`，仍为preparation/test-only、未提交、未安装。18项桌面/采用/浏览器保护合同通过，最终包6项完整入口通过：原包功能、旧schema3经原owner升级4、同原路径/账号/主thread重开、未知命令结果保持unknown、精确gateway CAS副本保留全部行/contract/thread、活跃及无法核实的原owner拒绝。没有真实模型轮或权限审批重放。

中间build007暴露原第二owner错误优先级回归（desktop_lease_review_required遮盖desktop_owner_conflict），已改成只读预检并保留后续原子owner创建；最终原断言通过。build008一次首个URL就绪超时，未改弱测试或延长deadline；准确同包该项独立复核通过，最终build009全部6项通过。保留失败及复核原始日志。

宿主正常readOnly原生索引核对已成功：原唯一主thread存在，rollout路径位于原Homer专属sessions；没有读取rollout正文。此前受限SQLite打开失败不再是待解决阻断，但原生account/read的真实connected状态仍未执行。

Gitignored `.codex/private/desktop-adoption-20261023/initial-readonly/` 已保存真实业务/网关只读一致快照及离线候选副本。原迁移owner在副本执行schema3→4：60张原表全部原列行保持，只有tasks增加historyState及recursiveSchemaVersion更新；integrity=ok、FK=0，原thread/business binding/mainToolsHash均保留。网关经原公式确认确需binding变化，副本唯一CAS该值，所有请求行/contract/thread不变。这只是初始只读快照，不能替代正式停写维护点。真实库/绑定/账号/权限没有更改，不含auth或native sessions副本。

目前实际阻断为旧主thread工具合同：原库mainToolsHash=`e6d674a05ae34945a5e234a2b1f55029f0d319e51371f448911845224062cf9a`；准确Git候选为`0c28896bd6042284a909a8b692d41215f92a50df8abe9333f9ded11f3d540056`。`d8e0bd7^:src/tools.ts` 的MAIN_TOOLS实算与原库完全一致。与当前五定义相比，仅list_work描述及三个可选分页参数变化；其他四工具及名称不变。`Homer.start` 对已有thread明确抛main_tools_migration_required，不能改库指纹假装原native工具已更新。

可审阅的最小兼容方向：仅为准确历史五工具hash允许原thread恢复；保留旧mainToolsHash，原native thread/resume仍不发送dynamicTools、不替换原定义，既有list_work handler接受旧{}参数。未知hash继续拒绝，新thread继续当前定义；不新建替代thread，不改原权限、审批或持久业务事实。该方向已交CTO；实施/审阅/提交的准确授权仍待收口，未把这一产品合同修复偷偷混入采用patch。未完成此项及准确main提交、正式普通模式重建前，不能安装日常使用。

## 用户追加授权后的准确兼容闭包

用户已明确授权最小兼容修复、审阅提交main、直接安装打开。现已在隔离候选完成：src/tools.ts仅对已核历史hash→当前hash这一个准确组合提供兼容判断；src/service.ts恢复已有thread时保留原mainToolsHash，只给新thread写当前hash。旧原生定义不替换，未知hash及未来不相关合同继续拒绝。源码准备白名单明确追加src/tools.ts（23项），来源测试逐项核对名单内实际字节及SHA，名单外schema/history/权限owner继续保持Git树。新增工具合同与原生协议聚焦测试，未扩大权限或复制账号。

build010最终验证：22项合同、6项包内入口全部通过；采用测试使用准确旧五工具hash，原thread与指纹经两次重启保持。另用固定随包Codex0.163.0在完全隔离无凭据HOME、本机废端口provider验证真实原生thread恢复：旧五工具定义逐字节保留，原thread不变、turn/start=0。只读合成rollout，不接触用户rollout。全项目类型前像137／候选137，只有准确导出根绝对路径不同，归一化后逐条一致，无新增。

原28文件补丁保持原SHA；后续采用／兼容增量见独立[补丁](patches/2026-10-23-desktop-adoption-candidate.patch)、[来源](patches/2026-10-23-desktop-adoption-sources.json)及[验收](patches/2026-10-23-desktop-adoption-verification.json)。上节工具合同“待实施”是build009阶段历史状态，已由本节验证解决；此前准备包仍不作为正式安装输入。实际提交、冻结、安装与原数据验收另记[正式发布记录](2026-10-23-homer-desktop-release.md)。
