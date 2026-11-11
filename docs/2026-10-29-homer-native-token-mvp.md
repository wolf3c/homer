# Homer 原生 Token MVP：实施与验证

2026-10-29。替代旧方案中的独立网关账户、共享钱包查询、五操作与充值联调；保留已实现的浏览器连接和按角色配置同步。三方公共协议由 yezi2 维护，版本 `v1-r5-native-token-mvp`；[共同合同](2026-10-29-native-token-mvp-v1-r5.md) 已逐字复制并校验，SHA-256：`133aac981275e5cafd78130229a1efb4eb29178744b86ac6900f7358e6a1d35b`。

2026-10-30 当前发布决策见 [三方发布准备](2026-10-30-homer-release-readiness.md)。购买关闭、无旧待交付订单时沿用官方 AMH；后续充值补丁已另备候选，但不作为本次首发前提。本文保留历史验证，不把合成初始额度当正式赠额。

## 最小流程与责任

Homer 打开 yezi2 → 原网站账号登录并同意连接 → 网站自动交付本人原生 Token 与配置 → 正常重启 → 主 Agent／Worker 调用 AMH → Homer 展示个人 Token 额度。购买关闭。

- AMH 使用未打补丁的 New API rc.45：一个专用普通归属用户，每位网站用户一个有限额度的原生 Token。创建时关闭模型限制、显式设置 `allow_user_quota_query=false`。原生钱包仍须有足够资金；Token 可用额度不代表共享归属用户一定有钱。
- yezi2 服务端私存网站用户与原生 Token ID／Key 的对应关系，只下发 `{subject, modelToken, config}`；`subject` 是网站用户身份。Token ID、归属用户管理凭据不交给 Homer。创建结果未知时由网站保守恢复，Homer 不重放 code 或创建 Token。
- Homer 保留 PKCE／state、单次回调、subject 绑定、权限 600 的 `runtime-config.json`、私有 FD、正常停止后重启，以及原 profile／thread／任务／文件。Renderer 不获得 Token。
- `config` 继续分别保存 `main`、`worker` 的 `baseUrl/model/effort/fast`。当前两角色均 `deepseek-flash/max/Fast=false`，固定 Codex `0.163.0`；后台整合绑定对应模型，effort 保持固定引擎的 `medium`。

配置同步沿用现有实现：连接成功、App 启动，以及用户发消息时距上次检查严格超过一小时。并发合并，失败也计入间隔；新配置保存后正常重启采用，不热换凭据、不建定时后台服务。

## Homer 最小改动

1. 连接响应严格校验三个字段，去掉新协议的 `accountRef`。旧本机文件可读取；正常写入时移除旧字段，断开保留 subject，异人仍拒绝。旧 `{token}` 开发连接现已停用（见文末 2026-10-30 更新）；原生账号路径保持。
2. `/api/usage/token/` 只读顶层有限 Token 的 `total_available/total_used`，绝不采用 `user_quota`。零值保留；无限、缺字段、负值、非整数或超出安全整数范围均显示未知。`/api/status` 不带 Token，继续按原生显示配置换算。
3. 设置展示“额度与用量／可用额度／已用额度”，网站入口为“打开网站”，移除充值承诺。查询成功不等于模型可调用；状态与按钮见文末账号页面精简记录。
4. 删除旧共同包发布平台的客户端检查及假支付／credit 联调断言，保留授权、秘密、配置同步、角色执行、历史保全与禁用失败证据。旧实施记录标为历史，不冒充新版本验收。

没有新增数据库表、服务、依赖或页面。内部 `wallet` 状态与函数名保留，避免无收益的跨进程接口改名。

## 候选、验证与边界

本方实施 base：`ec161799ac62a90b9165e8de6644d2942d8dbdd4`。本次用户已另行授权 review、提交并合入本地 main；提交范围仅为本轮账号协议、额度展示及相关测试／文档。主树并行修改、暂存状态及两份 release-preparation 文档须保留，具体提交身份以 Git 记录为准。

本轮本机命令及结果（Node `22.22.0`）：

| 检查 | 结果 |
| --- | --- |
| `node --import tsx --test tests/homer-account.test.ts tests/desktop-permissions-ui.test.mjs` | 31 通过 |
| `node --experimental-vm-modules --test tests/electron-shell.test.mjs` | 181 通过 |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | 通过 |
| 同上，`-p ui/tsconfig.json` | 通过 |
| 全量 `tsconfig.check.json` | 116 个错误；用 HEAD 文件作只读基线比较，同为 116，未新增 |
| `npm test` | 未完成；记录 88 项失败，含缺模块和旧字段用例；随后在未修改的 `memory-invalidation` 测试停滞数分钟，停止本轮进程；不得报全量通过 |
| 包内 Node＋固定 Codex 163 的假上游原生测试 | 主／Worker 实际写文件通过，max／非 Fast、后台 medium 与工具环境无 Key 通过 |
| 实际 Electron＋本方网站／网关模拟接口 | 自动交付、正常重启、文件交付、消息同步间隔、额度刷新、断开保留历史通过（非三方完成） |
| 实际设置渲染 | 桌面及 390px 窄屏检查，额度和刷新可用，无横向溢出、无 Token 输入框 |
| `git diff --check` | 通过 |

独立 review 发现旧 aliases 连接直接断开仍写回 `accountRef`；回归先复现失败，修复后通过。两种旧格式均只在读取边界校验并剥离该字段，断开后仍可读取并拒绝异人覆盖；没有增加迁移或额外文件。上述聚焦测试、桌面壳及源码／UI 类型检查已在修复后重跑；本次日志位于 `.codex/scratch/native-token-review-20261029/`。

此前详细日志与基线比较脚本保存在 `.codex/scratch/native-token-mvp-20261029/`，仅作本地证据。上述 88 项是当轮未完成测试的记录，不能把 TypeScript 基线比较当成全量测试的回归证明。后续逐文件归因、最新 main 回归修正及正式包验证见 [2026-10-30 验证记录](2026-10-30-homer-final-package-validation.md)；新记录仍未宣称全仓通过。

### 新协议三方合成联调

已用实际 yezi2 Meteor／HTTP／登录模块、未打补丁的 rc.45 原生测试宿主、Homer Electron 实验副本及包内真实 Codex 0.163.0 完成以下新路径：

- 登录 → PKCE 回调 → 自动交付 → 权限 600 文件保存 → 正常停止／重启。
- 新 profile 首次初始化恰一次；两个角色正常调用，Worker 实际文件被接受并正式交付，`results.state=accepted`、`deliveries.state=recorded/outcome=succeeded`，文件 SHA-256 一致。
- 原生有限 Token 顶层额度查询，没有 `user_quota`；查询状态未泄露 Key。再次重启保留 thread、消息及文件。
- 真实网站 `configReads` 验证：启动检查一次；推进本次隔离进程时间后，超过一小时的用户消息再检查一次，下一条消息不重复；相同配置不重写连接文件。
- AMH 只对本轮唯一合成 Token 原生 `status_only` 停用，模型入口返回 401；恢复后的 Homer 显示失败，历史保留，用户消息只追加一次，没有假成功或重放。

首轮合成脚本因本方初始化等待断言写错表名而失败；已修正为现有 `agent_messages` 的 `user_input` 记录，重跑通过，未修改产品来迁就断言。三方接受同一合同摘要，没有恢复支付、credit 或旧共同包。

证据 profile：`.codex/scratch/account-mvp/three-projects/native-token-20261029/synthetic-5eGMWo/`，内有 `evidence.json`、`formal-delivery-evidence.json`、`config-cadence-evidence.json`、`disabled-evidence.json`。本方日志分别为 `triad-retry.log`、`config-cadence.log`、`disabled.log`。Homer 实验副本来源与修改清单见 `candidate.json`：APFS 克隆原 build121，只替换本轮账号编译输出和 UI，重新生成受信清单及本地签名，`preparation=true/publishable=false`；原包与安装 App 保留。

以下候选身份属于本次 review 修正前的合成验证快照；旧 aliases 文件修正另由上述聚焦回归覆盖，未重建实验 App。

这些结果是新方案的本机合成验收，假上游不代表真实 DeepSeek 兼容性、性能或生产验证；网站宿主不是正式生产包，网关宿主不是发布镜像，Homer 实验副本也不是可发布安装包。两方最终源码指纹和停止回执由各自记录保存：网站 base `f036fb22abb09fab18d4f9ac8aa54e640d58a758`＋未提交改动，产品指纹 `b7c3c8fa940e331da6f4328d17420f89f00f2e88339532d6405ef9ac996bfd9f`；AMH 官方上游 `6cf0d90b5ff27f901697dddd61e0c28aba8efefc`，2648 个产品文件的清单摘要 `42e7215172cf2e09cc9b806c122c98d4edc36e01f7570b0339213438358a60ea`，零产品补丁。原生 Token 初始 100000＝余 98920＋用 1080，12 条原生扣费记录合计 1080；其中 11 次 max、1 次后台 medium。网关未保留逐请求 service_tier，因此不声称另有上游 tier 轨迹，Fast 关闭证据来自实际配置和独立固定 163 测试。

网站、Mongo、网关与假上游均已由各 owner 正常停止，本方复查 3180／3181／3183／3197／3198 无监听；测试库和必要证据保留。汇总与各证据 SHA 见 `.codex/scratch/native-token-mvp-20261029/verification.json`。本方本轮编译与 UI 暂存目录已清理，保留最终实验副本和复现脚本。

本次 Git review／提交不包含部署、安装、日常 Homer 重启、真实账号或付费模型调用。当前验证使用隔离身份、HOME、runtime、workspace 与假上游。旧安装包仍是旧协议候选，不能据此安装或发布新方案；回退不覆盖历史数据库、不自动重放未知模型轮次，也不删除原生 Token。

## 2026-10-30 配置文件命名整理（源码改动，尚未打包安装）

统一使用当前 appData 下的 `runtime-config.json`，承载 Token、subject 和独立 main／worker 配置；暂不预建工具配置字段。写入临时文件为 `.runtime-config.json.pending`。网站接口和文件内容格式不变。

首次读取新路径时，旧 `deepseek.json` 必须先通过同样的内容、所有者、权限和符号链接检查，再以不覆盖目标的硬链接加移除旧名称完成迁移；不复制明文备份。中断后若两个名称仍指向同一文件，下次读取完成收尾。两个独立文件同时存在则拒绝覆盖并保留，文件损坏、权限或写入失败也不回退到另一份凭据。迁移保留字节与身份，不修改数据库、thread、任务或模型配置。

工具保护同时 deny 新旧最终文件及临时文件。已安装 build 123 仍使用旧名称；本轮仅改源码并以合成凭据验证，不迁移日常真实凭据、不重启 App，也不改后台记忆整合的 medium 例外。

回退到仍读取旧名称的安装包时，先正常退出并确认没有 profile owner，再将唯一有效的 `runtime-config.json` 改名回 `deepseek.json`；不复制 Token、不覆盖已有旧文件、不改数据库。若两份独立文件并存，先人工核对归属，不能随意删除或覆盖。

本次验证：先观察 5 项迁移用例在旧代码失败；实现后账号／权限／记忆及 UI 相关 43 项通过，Electron shell 181 项通过，后端 `tsc --noEmit -p tsconfig.json` 通过，`git diff --check` 通过。证据在 `.codex/scratch/runtime-config-filename-20261030/`；未重跑全仓或包内 Electron 联调，不将其写成新安装包验收。

本轮提交前复审补正迁移读取的错误归一化：目录不可访问统一返回 `CONNECTION_FILE_INVALID`，迁移写入失败仍保留 `CONNECTION_WRITE_FAILED`。新增拒绝坏文件、旧文件符号链接和异常临时文件的覆盖；账号／保护相关测试 46 项、桌面 shell 181 项全部通过，后端 TypeScript 与差异检查通过。未重跑全仓或打包测试，不读取／迁移真实凭据、不安装或重启日常 Homer。

## 2026-10-30 日常桌面仅保留网站连接（未提交、未安装）

账号区仅展示网站账号的登录／连接、取消、正常重启、断开和额度查询；移除“原 DeepSeek 配置”状态和日常入口的手填 Token 提示。主 Agent／Worker 仍使用网站提供的各自配置，目前均为 deepseek-flash、max、Fast 关闭。

仅含 `{token}` 的开发文件不再提供执行凭据、配置同步或额度查询，按未连接处理；读取时保留文件原样，不自动删除真实凭据。旧文件名中的这类开发输入不迁移，用户通过网站登录后写入 `runtime-config.json`；若开发输入已在新文件名中，仅明确完成网站连接时原子替换。有效的网站连接仍保留安全改名、归属校验、断开保留 subject 和失败保留原文件的行为；私有 FD 也必须验证网站身份与完整角色配置，拒绝 Token-only 输入。

本轮未修改日常 profile、数据库、历史对话、任务或文件；网站／网关接口及购买开关不变。旧隔离调试入口和原生账号回退不属于日常账号设置，不随本次 UI 精简扩大修改范围。后续安装本轮版本后，仍使用旧手填凭据的开发 profile 需要通过网站连接，不能继续靠旧 Token 自动调用。

本轮验证：先复现手填 Key 被读取／注入、无网站配置仍补默认模型入口、菜单误报已配置模型的失败，再作修正。账号、角色配置、原生记忆及 UI 相关 124 项和 Electron shell 182 项通过；前后端 TypeScript 与 `git diff --check` 通过。真实浏览器使用无网络合成 bridge 检查未连接、连接取消、待重启和已连接状态；未执行包内 runtime／完整三方联调或全仓测试，合成预览不证明生产登录／购买可用。日志在 `.codex/scratch/website-only-20261030/`。本轮无提交、合并、打包、安装、日常重启或真实付费调用。

## 2026-10-30 账号页面精简（未提交、未安装）

账号标题下直接展示登录状态和对应操作，删除重复连接标题与常驻长说明。未登录、登录中、待重启、正常登录和凭据失效分别提供登录、取消、重启并应用、退出登录和重新登录；配置同步失败不要求重新登录。仅已采用网站连接时展示“额度与用量”，查询失败保留登录状态，旧值标记“上次记录”，没有数值显示未知。现有重启／退出确认说明正常停止及数据保留，本机退出不会注销网站账号；停止、取消和清凭据时序不变。

聚焦验证命令：Node 22 执行 `node --test tests/desktop-permissions-ui.test.mjs tests/channel-settings-ui.test.mjs`，29 项通过；`node --experimental-vm-modules --test tests/electron-shell.test.mjs`，184 项通过。前后端 `tsc --noEmit` 和 `git diff --check` 通过。新增断言先在旧界面／确认文案上观察失败，再验证实现通过，覆盖取消、待重启、额度失败、凭据失效和退出取消。

实际组件经隔离 loopback 合成 bridge 渲染，桌面 1280×720 与窄窗口 390×844 检查通过，窄窗口无横向溢出；Escape 关闭、焦点返回、键盘重开和按钮可达已验证。截图及测试日志位于 `.codex/scratch/account-ui-simple-20261030/`。演示额度不是生产数据，浏览器内重启／退出为合成动作，实际主进程取消边界由上述 shell 测试验证；未执行包内 Electron、完整三方联调或全仓测试。购买及接入开关未改，不读取真实凭据，不提交、打包、安装或重启日常 Homer。

## 2026-10-30 提交前复审

复审覆盖上述网站连接精简、原开发 Token 停用及账号页面改动。补正 `tests/electron-desktop.test.mjs` 与 `tests/homer-account-integration.test.mjs` 中遗留的旧按钮定位，并统一错误提示与“重新登录”动作；未扩大产品接口。连接、取消、凭据原子写入、角色配置、历史归属、记忆模型和退出确认沿原调用链核对，未发现剩余阻塞问题。没有新增请求、轮询、依赖或每条消息的额外工作，不据此宣称完成性能基准。

Node 22 下运行 `tsx --test --test-concurrency=1 tests/homer-account.test.ts tests/model-config.test.ts tests/desktop-deepseek-engine.test.mjs tests/native-memory-engine.test.ts tests/desktop-permissions-ui.test.mjs tests/channel-settings-ui.test.mjs`，137 项通过；Electron shell 184 项通过，共 321 项。前后端 TypeScript 检查、两个包内测试的语法检查和差异检查通过。首次组合测试在既有 CLI 启动用例处异常中止，未输出诊断；单独复现 2 项及完整重跑 137 项均通过，保留两次日志，不修改断言或超时。

本轮未重跑包内 Electron／三方完整联调，也未打包、安装、重启日常 Homer、读取真实凭据或调用付费模型。工作树清理时，测试日志、截图、旧隔离数据和回退材料已保留至主仓库忽略目录 `.codex/private/worktree-retained/homer-account-stage1-20261030/`；两份未跟踪的发布准备文档存放于其 `untracked-docs/`。Codex 归档工具拒绝删除本对话的主工作树，故保留该干净 checkout，不绕过保护。代码提交为 `e662856`；主树无关未提交改动已核对保留，具体保留清单和合并校验记录在上述忽略目录内。
