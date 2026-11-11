# 需求与方案索引

更新日期：2026-11-11

维护入口：[UI 视觉与交互](../ui/DESIGN.md) · [测试边界与命令](testing.md)。

[Homer 核心架构](architecture/README.md)汇总当前协作、Hook、插件工具注册与多渠道接入设计及各自的验收边界。

[桌面截屏批注方案](desktop-screenshot-annotation.md)已实现窗口／区域截图、图片批注及原主草稿接续，可选附带窗口 AX 文字。Apple 芯片 Mac 隔离签名候选通过采集、批注、发送和历史查看；Windows 原生探针及合成产品路径通过，Windows 11 安装包端到端、多显示器等边界仍按正文待验。

[会话架构实施计划](superpowers/plans/2026-11-05-worker-chat-architecture.md)：已实现单一会话路径，普通回复直接回传，不保留旧库迁移与旧调用兼容。七个 chat 分工及独立审核，离线、桌面与实际 ChatGPT 验证分别记录；尚未部署到日常实例。

旧协作链路的故障复现、宿主恢复和渠道回执可查阅当时的[工作架构收敛方案](work-coordination-architecture.md)。

[协作身份与接口精简方案（历史）](collaboration-identity-simplification.md)：保留当时的接口精简与验证依据。普通文件仍用地址，稳定引用以当前消息与附件方案为准；旧合同、Matter、Result／Delivery 及旧调用兼容不作为新架构要求。

新增[事项归档与工作环境收尾方案](task-archive-housekeeping.md)：童子军原则、归档事实事件与显式 Skill 加载已接入，主 Agent 自主判断及派工；复用现有受管服务生命周期，不新增跨 Worker 停服机制。共用有限生命周期约束已接入源码，并在正式 `on-request` 下完成 ChatGPT 隔离回收及保全验证；旧实例未更新，保留项及验证边界见正文。

[手机 App 新版轻提示](mobile-app-update-notice.md)：客户端源码已接入并提交；2026-11-04 核对官网和线上数据提供 Android build 4，iOS 准备中。更新提示在正式包中的启用、真机及覆盖安装仍待验收。

[移动设备配对与连接](architecture/mobile-device-pairing-architecture.md)记录扫码授权、WebRTC 与 TURN，以及真机验证边界。

新增[Worker 宿主自动回传](40-worker-automatic-return.md)：移除完成工具，自然语言正文及暂存文件自动进入原主队列；业务验收和正式交付保持独立，无新表或 schema 迁移，尚未部署。

新增[移除能力管理页](2026-10-23-remove-capability-settings.md)：删除顶部入口、完整页面及专属传输，保留对话 capabilities、真人审批与已有认证；列明 OAuth 和隐藏配置限制，尚未上线。

新增[执行时限与故障恢复](38-native-timeout-recovery.md)：移除宿主累计时限，沿原 thread 恢复后续接待；已整合维护源码并复验，未部署。

新增[执行架构调整候选](34-flexible-execution-candidate.md)：未部署，含原生指令/记忆、角色、cwd、网络、认证及恢复/采用边界。
当前状态：M0 CLI 已实现并完成核心真实验收；实际通过项及可靠性限制见 [验证记录](07-m0-validation.md)。原 P0 是后续扩展基线，不再作为第一次可运行版本的门槛。范围依据见决策 D09 与需求文档第 9 节。本地 Web 对话页现接入同一个 Homer；IM 渠道按各自文档维护，不另建主 Agent。

本套文档记录已确认的产品方向、M0 实现边界、后续演进建议和实测证据。用户已批准 M0 并授权实现、正常依赖安装及沿用本任务连接的真实模型测试；实测结果单独记录，不能将后续建议视作已实现。

旧阶段的协作方案、迁移提案与验收记录按当时版本保留；涉及旧业务合同、旧工具或旧库兼容的描述仅供历史查证，当前协作架构以本页顶部入口为准。历史授权不代表本次部署或日常数据操作已获授权。

## 阅读顺序与内容归属

| 顺序 | 文档 | 唯一负责的内容 |
| --- | --- | --- |
| 1 | [产品定义](01-product-definition.md) | 用户价值、交互原则、长期能力目标 |
| 2 | [需求与首版范围](02-requirements-and-mvp.md) | 需求编号、优先级、功能边界及行为要求 |
| 3 | [技术方案](03-technical-design.md) | 数据归属、执行机制、引擎集成和故障处理 |
| 4 | [实施与验收](04-delivery-and-acceptance.md) | 当前 M0 的实施步骤、里程碑和完成标准 |
| 5 | [决策与待确认项](05-decisions-and-open-questions.md) | 决策状态、取舍、未决问题及选型资料 |
| 6 | [运行 Homer](06-running-homer.md) | 安装、配置、CLI、数据位置、停止和重启 |
| 7 | [M0 验证记录](07-m0-validation.md) | 实际环境、检查命令、证据、用量与已知限制 |
| 8 | [回归用例索引](../tests/scenarios/README.md) | 稳定场景 ID、来源、脱敏复现、离线与模型回归入口 |
| 9 | [Telegram Bot 接入方案](08-telegram-integration-plan.md) | 渠道与共享宿主已接合、来源／流式／停止与本地设置；真实 Bot 和手机验收仍待完成 |
| 10 | [开发版自动升级](09-development-upgrade.md) | 稳定终端、候选隔离、安全边界、失败回退、兼容阻断与验收入口 |
| 11 | [本地 Web 界面](10-web-interface.md) | assistant-ui 对话、流式、引用、待答、成果下载、持久历史与稳定宿主入口 |
| 12 | [个人微信接入](11-wechat-integration.md) | 扫码连接、本机 PNG、同一主线程、原子来源与宿主；真实扫码／私聊验收仍待完成 |
| 13 | [一级 Worker 与原生协作](12-recursive-agent-architecture.md) | 主 Agent 管理同级业务 Worker，内部复用 Codex；源码与合成验证完成，真实 smoke 认证阻塞，未发布 |
| 14 | [原生记忆](26-native-memory-feasibility.md) | 唯一原生记忆后端、使用边界及固定版本历史验收；旧自建后端和迁移入口已退役 |

[一级 Worker 与原生协作验收](15-recursive-agent-validation.md)：管理封口、一级业务合同、原生 callback 与 EOF、响应式状态、隔离证据与真实认证阻塞。

[iLink 完整支持方案](16-ilink-full-support-plan.md)：9 个公开接口、7 类消息项、媒体/引用/通知、统一附件与模型输入、事务/权限/迁移及分阶段真实验收；已验源码候选已发布，P0–P6 真实手机验收仍未完成，最新事实见25。

[无感更新的已实现范围与验收](17-seamless-update-validation.md)：界面独立更新、持久传输回执、故障恢复与尚未完成的执行版本拆分。

[日常数据库迁移预演](18-daily-migration-preview.md)：只读一致性备份、原历史/来源与六条未知发送保持、副本迁移及回退、在飞发送阻断与受控切换门槛；实际启用结果见20。

[固定旧构建回退启动器](19-pinned-rollback-launcher.md)：旧入口来源审阅、固定dist/依赖/配置清单、旧0254 host合成进程验收及受控维护入口；不自动升级或操作日常。

[日常环境已更新](20-daily-environment-activation.md)：正式授权后的维护点备份、实际原库迁移、原Terminal/原thread启用、当前4780版本、记忆与发送界面验证及后续自动更新边界。

[正式产品自动更新要求](20-product-update-requirements.md)：用户已确认必须后续完成的版本兼容清单、固定迁移程序、本机副本预演、启动验证与九项验收要求；完整机制尚未实现，与本次日常启用分开验收。

[桌面 App 自动更新实施方案](desktop-app-update.md)：已确认 Electron 内置 autoUpdater＋现有 Forge、官网静态发行清单；覆盖 Apple Silicon、Intel Mac 和 Windows x64，只有重启更新轻提示，包含与 Yezi2 的合同分工和分阶段验收。方案待实施，未构建、安装或发布。

## 文档维护约定

- 同一结论只在所属文档维护，其他文件以链接和编号引用，避免多处同步。
- 状态使用「已确认」「建议」「待验证」「待决定」，不能将助手提出但用户未确认的细节记成已确认。
- 稳定文件名不加日期、final、v2 等后缀；日期写在文档内。后续版本通过 Git 管理，当前不初始化 Git。
- 小范围变化直接更新所属文件；只有独立内容明显增多时才新增目录，并同步本索引。
- 阶段性交付、试验结果应标明环境、版本、观察和限制；未执行的检查不能标为通过。
- 临时调查、截图和日志放 .codex/scratch/，不混入维护文档；私密运行材料不得进入普通需求文档。

## 本次边界

实施已获批准的 M0，包含代码、测试、必要真实 Codex 调用和文档。沿用已有授权连接，不购买、不复用他人凭据、不修改全局账号或 Cindy；不创建 Git、提交或部署。

[iLink 实施验收记录](21-ilink-implementation-validation.md)：候选、日常与真实手机证据分开记录，包含最新界面/记忆常开调整及剩余工作。

[MCP 与 Skill 配置及自主维护方案](22-mcp-skill-configuration-design.md)：固定0.163原生复用表、专属目录、Skill/MCP管理及OAuth、授权/采用状态与可重复合成验收；管理入口已上线；本人原生登录及专属HOME全新开发主对话已采用，当前实证和首轮恢复边界见28。

[账号与模型连接](architecture/account-and-model-connection.md)记录网站授权、角色配置及网关职责。

[停止图标最小维护发布](24-stop-icon-maintenance.md)：已授权并于2026-10-17在原Terminal启用；固定原9ab后端、f91图标UI、完整清单校验、原UI回退及实际资源/数据保持证据。MCP/iLink其它候选未顺带上线。

[已验候选发布与自动更新恢复](25-verified-candidate-release.md)：383项通过/2跳过、完整新宿主浏览器上传/队列/停止、原库全表预演、日常d3a发布与原Terminal自动更新、真实采用和手机待验边界。

[原生记忆说明](26-native-memory-feasibility.md)：维护源码只保留 Codex 原生记忆，旧自建后端和迁移入口已退役；保留固定版本接入及后台汇总的既有证据。本次源码清理不代表重新验证真实模型效果或已部署。

[原生工具与审批](27-native-tools-and-approvals.md)：本批接线及网络边界收口已发布7a02，后台自动切换实证通过；文件/图片/审批、Worker原生MCP/Skill与OAuth退出完成396项回归及实际调用。Shell整轮网络因无法排除控制入口暂不批准。旧日常尚未采用专属HOME；最新选择本人登录后新建专属主对话，不迁旧内容。

[专属 Codex 登录与全新主对话](28-native-home-adoption.md)：本人原生浏览器授权已确认；`c72dc2e523a7` 已安全采用专属HOME及全新开发主对话。补充归属绑定已获批准，55表保留，旧历史、记忆、渠道及六uncertain不重放、不删除；首条真实消息前恢复保护保持。

[原生能力直接发现与实际可用范围](29-native-capability-activation.md)：专属HOME原生默认/配置、插件与Apps发现管理、实际验收和未完成的工具输出/办公/网络边界。

[工具获取、安装与自主扩展需求](30-tool-acquisition-requirements.md)：精选按 Cindy 类别列具体工具、功能与安装方法；第二类列7个认可市场／目录与6个发布者集合，不再设置第三、第四层；入口简述自建条件，安装／创建命令作为按需参考；另列25个 Cindy 官方插件源码的独立替代／适配办法；原生已有能力不重复列作安装项，平台云服务按需查附录。只预装两个自定义 Skill，具体工具按任务获取；远程索引不是使用本地清单的前提。

[原生工具自主安装与使用验收](31-native-tool-lifecycle-validation.md)：已上线对话安装审批、主/Worker 同一原生管理机制、取消/拒绝/未知结果保护，合成与真实模型闭环证据分别记录。

[首次启动与旧初始化记录](32-first-launch-initialization-skill-requirements.md)：沿用账号引导和空会话欢迎页，移除自动模型轮，保留内置 Skill 分发与旧输入队列兼容。

[三项目登录、充值及模型计费需求](33-account-payment-model-gateway-requirements.md)：三项目职责、登录及凭据交接、订单幂等入账、唯一余额、5%加价、接口与异常恢复、实施顺序和22项验收；需求已整理，尚未接通。

[主 Agent 动态协调与待处理事项：需求方案（历史）](34-main-agent-work-cycle-requirements.md)：保留动态判断、可靠记录及记录不等于授权的需求依据；目标方案将待办与已启动事项统一到任务管理表。

[主 Agent 动态协调与待处理事项：技术方案（历史）](35-main-agent-pending-items-design.md)：保留原 Pending 实现依据。独立待办表、三个工具及来源选择接口不再作为目标；原来源、并发和恢复校验由任务、消息与操作记录承接。

[自由执行候选的最终审阅与维护采用](36-flexible-execution-final-adoption.md)：实质源码审阅、两项阻塞修正、保留原thread的兼容限制、一致库迁移预演和准确源码确认后的维护步骤；现场采用结果另见本轮回执。

[新版本统一整合与采用记录](39-release-integration.md)：五组候选已统一；维护源完整 check 688项、686通过、0失败、原2项跳过，权限/审批/schema/gateway变化与采用回退边界；真实上线由 CTO 执行。
