# Homer 账号与模型接入：最终版本及使用说明

2026-10-30。本轮完成客户端候选交付；等待 yezi2 和 AMH 正式上线后，再验证真实登录、购买和对话。不继续推进网站／网关上线，不安装或重启日常 Homer，不调用真实支付或模型。

## 最终版本

| 项目 | 身份／范围 |
| --- | --- |
| 产品源码 | `main` 已包含产品实现，准确输入 `688443b96e90c8935b7dee2088b6b393cdf0156d` |
| macOS 候选 | Homer 0.1.0，build **127**，arm64；本轮收尾仅提交测试夹具修正和文档，不改变该包的产品代码，不重新打包 |
| ZIP | `.codex/scratch/main-release-validation-20261030/source/.codex/scratch/formal-build/forge/make/zip/darwin/arm64/Homer-darwin-arm64-0.1.0.zip` |
| ZIP SHA-256 | `552a87c72c265efd8f7d2b48bc91e2d7912b253471f84c3090c02d7bca653789` |
| 固定引擎／角色 | Codex 0.163.0；main、worker 各自接收网站配置，当前均为 `deepseek-flash`、`max`、Fast 关闭；后台记忆沿已批准的同角色模型／medium |
| 公开入口 | 网站 `https://super-tree.com/homer`；两角色模型入口当前均 `https://models.super-tree.com/v1` |
| 当前安装 | 收尾核对仍是 build **123**，没有替换；本文使用流程以 build 127 候选为准 |

签名为 ad-hoc；ZIP、资源摘要和 strict/deep 签名检查已有证据。公开下载分发前仍需 Developer ID 签名与公证；现有候选可交给独立负责人安排本机安装验证。

## 已交付的客户端功能

- 复用设置中的“账号”：系统浏览器登录、PKCE／state、自动 Token 交付、取消和失败恢复；主进程处理秘密，Renderer 不接收 Token。
- 单一私有 `runtime-config.json`，权限 0600、安全文件校验和原子替换；旧网站连接文件按现有迁移逻辑读取。旧手填 Token 开发连接不再作为账号入口。
- 主 Agent、Worker 使用各自网站配置。新连接或配置保存后正常重启采用，保留原 profile、thread、消息、任务、交付记录和文件。
- 本人有限 Token 额度／用量、手动刷新、网站入口、退出本机登录。充值后继续使用同一 Token。
- 登录、启动以及用户发消息距上次检查超过一小时时同步网站配置；并发合并，配置变更待正常重启生效。

没有新增数据库表、账号后台服务、独立页面、订单系统、依赖或预算平台。购买和退款在网站处理，Homer 不持管理 PAT 或直接调用充值接口。

## 使用前的服务条件

由各自发布负责人完成：

1. yezi2 上线当前登录／配置／购买候选，配置已确认的普通 owner、受限 PAT 和两角色模型参数，并启用相应功能。
2. 要实际购买，AMH 必须部署已准备的同 Token 充值补丁及对应迁移，网站商品／支付／交付配置须就绪；只沿用官方 rc.45 的方案适用于购买关闭的登录首发。
3. 共享 owner 原生钱包和本人 Token 均须具备可消费额度。新 Token 固定零额；连接成功本身不赠额，也不证明模型可消费。

截至本轮收尾，购买仍关闭，不能把上述服务条件当作已上线事实。用户的内测额度意向未写入；真实模型验证没有执行。原生有限 Token 不是单轮费用硬上限，后续真实验证按重新明确的范围执行。

## 首次连接与使用

1. 由独立负责人安排使用 build 127；正常退出旧版本并保留原日常 profile，不清空应用数据。
2. 打开 Homer **设置 → 账号 → 登录**，在系统浏览器使用网站账号登录。
3. 在网站按页面完成购买并确认额度到账，然后确认连接 Homer。已有额度可直接确认连接；用户无需复制 Token 或手工编辑模型配置。
4. Homer 显示“登录信息已保存，重启后生效”后，点击 **重启并应用**，按提示正常停止当前工作。
5. 重启后查看“已登录”和“额度与用量”，发送普通消息开始对话。首次 profile 的既有初始化会使用模型额度；已有历史不会重复初始化。
6. 需要独立任务时让主 Agent 派 Worker；交付后打开实际文件核对结果。

正常停止未确认时，客户端不强杀、不清锁、不启动第二个 owner。保留提示现场，由维护者核对，不删除 profile 处理。

## 日常操作

| 需求 | 操作与结果 |
| --- | --- |
| 再次购买 | 在账号区点“打开网站”，网站完成购买后回到 Homer 点“刷新”；沿用原 Token，不需要重新登录 |
| 网站更新模型配置 | Homer 在既定节点检查并保存，提示“配置已更新，重启后生效”；点击“重启并应用”，执行中的配置不会热切换 |
| 查询失败 | 登录状态保留；已有数值标为上次记录，缺少结果显示未知，不把错误显示成零余额 |
| 登录取消或失败 | 等待态点“取消”，或按具体错误重新登录；失败保存保留原文件，取消后不采用迟到结果 |
| 登录失效／模型被停用 | 按账号提示处理；余额查询成功不等于可调用模型，结果未知的付费轮次不会自动重放 |
| 退出登录 | 点“退出登录”，先正常停止再清本机 Token；历史对话、任务和文件保留，网站账号及远端 Key 不因此注销／停用 |
| 账号归属不匹配 | 使用原网站账号；现有本机历史不会自动交给另一账号 |
| 历史没有显示 | 先核对是否打开原日常 profile；不通过删除数据库、配置或新建空 profile 来恢复历史 |

## 验证与验收边界

已有证据包括：账号／角色／权限相关聚焦检查 331 项通过，包内检查 16 项通过；固定候选三方合成登录、自动交付、重启、额度、主／Worker 实际文件交付、历史保全、配置检查间隔及停用拒绝通过。模型上游为合成输入，不能等同真实供应商或生产消费通过。

全仓逐文件归因仍有 53 个旧基线同类失败、9 个两版未结束文件；测试源码 TypeScript 检查有 116 个同基线错误。产品 TypeScript 构建通过。未完成项不能证明无回归，不宣称全仓全绿或生产性能已经验收。

本轮两处收尾修正仅涉及测试夹具：Logo 注入名跟随现行 import；网站 runtime 使用包 manifest 批准的网关 origin，角色断言为 max，同时保持原配置字节、thread、未知任务及回退断言。原期限和断言覆盖保留，无产品运行时性能改动。

提交前已用 Node 22.22.0 在 maintree 重新验证上述改动：

- `node --import tsx --test tests/reader-scroll.test.mjs`：52/52，约 4.15 秒；`HOMER_READER_SOURCE` 指向 build 127 准确源码副本，避免混入并行 UI 改动。
- `node --test --test-concurrency=1 --test-name-pattern='daily website uses max' tests/macos-desktop-runtime.test.mjs`：2/2，约 11.26 秒；`HOMER_TEST_APP` 为保留的 loopback 实验包，独立合成 profile，固定假引擎。

两项均使用独立 HOME／TMPDIR 和已有 loopback-only 网络保护，退出码 0。未重跑三方合成联调，也未启动日常 profile 或访问真实模型。命令、日志和结果索引保留在 `.codex/scratch/final-account-closeout-20261030/`。

详细命令、结果、失败归因、包身份和三方证据见 [最终包与验证记录](2026-10-30-homer-final-package-validation.md)。发布阶段历史和三方移交见 [发布准备](2026-10-30-homer-release-readiness.md)；本说明是本轮最终版本与使用入口。

## 后续一次真实验收

待两端上线后，由用户另行安排，以最新 Homer 候选走一次：

**原网站账号登录 → 真实购买 → 同 Token 到账 → 自动配置 → 正常重启 → 主 Agent 回复 → Worker 创建文件 → 主 Agent 核验并交付 → 查询额度／用量 → 再启动保留历史。**

至少覆盖首次安装和已有日常 profile。记录准确三方版本、购买／交付结果和实际费用，不在证据中保存秘密或客户内容。源码和合成结果不替代该生产验收；本轮不继续执行此阶段。

## 收尾范围

本轮仅将两处测试修正、最终验证／发布移交／使用文档收录到本地 main，不推送。主树并行 dirty、现有安装、最终 ZIP、必要证据和全部历史数据保留。

旧 `homer-account-stage1` 工作树清洁，没有独有源码或 ignored 候选／证据，已按授权尝试应用工作树归档接口；接口返回 `The task's primary checkout cannot be removed.`，因此**尚未移除**。本轮虽在 maintree 工作，该目录仍绑定为当前聊天的主检出，须先解除该绑定才能归档。其他工作树保留；本轮没有宣称清理释放了磁盘空间。

## 结束旧对话、迁回 maintree 的交接

2026-10-30 再次盘点。用户决定结束旧对话后删除旧工作树，再从 maintree 新开对话；不再尝试把当前对话和 Git 状态一起移交。以下是新对话的接手基线，优先于前文及旧方案的阶段性待办。

### 源码归档和主树边界

- 唯一后续工作目录：`/Users/wolf3c/Project/homer`，分支 `main`。本次文档补充前 HEAD 为 `3316f54a0474beafa569f1578f772bc343d39891`；补充后的准确提交用 `git log -1` 核对，不把本段的历史 HEAD 当作必须回退的版本。
- 旧工作树：`/Users/wolf3c/.codex/worktrees/homer-account-stage1/homer`，detached HEAD 为 `688443b96e90c8935b7dee2088b6b393cdf0156d`，是 main 的祖先；没有尚待合入的独有提交、暂存、未暂存或普通未跟踪文件。
- main 已包含 `ea1ec52`（网站配置同步）、`c964b2b`（本人有限 Token 额度）、`0833d08`（日常 profile 兼容）、`a7028e8`（配置文件改名迁移）、`e662856`（账号界面简化／退出旧手填连接）、`0ab960f`（测试夹具与最终交付）、`3316f54`（清理阻塞说明）。提交说明与实际差异可在主树查看，无须从旧工作树再次复制代码。
- 盘点时 main 有 **89 个无关已跟踪改动、370 个普通未跟踪文件**，暂存区为空。这些属于其他工作，不是本任务遗留；不得整树提交、stash、reset、clean 或覆盖。接手时重新盘点，数量变化不自动构成本轮回归。
- 本次仅补充本文件；不改变产品源码、包、凭据或数据。主树无关差异摘要和未跟踪文件名单已保存到下述盘点记录，用于复核保全。

### 代码导航与当前协议

| 位置 | 已实现职责／接手注意点 |
| --- | --- |
| `src/homer-account.ts` | PKCE/state、loopback 回调、有限响应校验、单一配置文件安全读写和迁移、网站配置查询、本人 Token 额度解析。不要重新引入 grant、refresh、设备实体或管理 PAT。 |
| `packaging/electron/main.mjs`、`packaging/electron/preload.cjs` | 可信账号 IPC、浏览器交接、状态和查询合并、配置检查、正常停止与重启；Renderer 不接收 Token。 |
| `scripts/desktop-profile.mjs`、`scripts/desktop-runtime.mjs`、`scripts/desktop-deepseek.mjs` | 原 profile 采用、首次初始化、私有启动通道和模型环境。`desktop-deepseek.mjs` 仍有实际调用，不按名称删除。 |
| `src/config.ts`、`src/model-config.ts`、`src/engine.ts`、`src/service.ts` | 两角色有效配置、固定引擎执行、记忆模型绑定、用户发送消息时的配置检查通知。正常轮次 max；固定引擎后台记忆 medium 是已批准例外。 |
| `ui/desktop-permissions.tsx`、`ui/homer-styles.css` | 单一账号区、登录／取消／待重启／退出、额度与用量及错误。后续 UI 改动先读当时的 `ui/DESIGN.md`，其中已有并行修改。 |

当前自动交付响应严格为 `{subject, modelToken, config}`；`config` 只有 `main`、`worker`，各自含 `baseUrl`、`model`、`effort`、`fast`。两个角色分别保存配置，当前校验仍限制到批准的网关 `/v1`、`deepseek-flash`、`max`、`false`；结构可分别扩展，不代表任意供应商已兼容。

浏览器入口 `/homer` 使用既定六项授权参数；回调为 `http://127.0.0.1:<随机端口>/homer/oauth/callback`；兑换为 `POST /api/homer/v1/token` 的五字段请求。`GET /api/homer/v1/config` 返回非秘密角色配置，不携带或刷新 Token，不要求网站登录。登录交付和启动会取得配置；用户发消息距上次检查超过一小时才再次检查，没有每小时后台定时器，也不在每个 Worker 启动时另做同步。

额度只读取 AMH `GET /api/usage/token/` 的本人有限 Token `total_available`、`total_used`；`GET /api/status` 不发送 Token，用于显示单位。禁止把共享 `user_quota` 当作本人余额。`runtime-config.json` 保存凭据和配置，旧网站文件迁移路径保留；不手动读取、打印、搬动或重写真实文件来完成本次交接。

### 必须保留的本机产物

以下路径均位于 maintree，删除旧工作树不应影响它们：

| 保留项 | 位置／用途 |
| --- | --- |
| build 127 ZIP | 本文“最终版本”给出的 `.codex/scratch/main-release-validation-20261030/source/.codex/scratch/formal-build/forge/make/zip/darwin/arm64/Homer-darwin-arm64-0.1.0.zip`；再次计算 SHA-256 与上表一致，326962932 字节。 |
| 构建、失败归因及包内证据 | `/Users/wolf3c/Project/homer/.codex/scratch/main-release-validation-20261030/`；包含 `neutral-failure-classification.json`、`package-verification.json`、`packaged-tests-final-result.json`、`resume-1335/completion.json` 和截图。 |
| 最终收尾测试及盘点 | `/Users/wolf3c/Project/homer/.codex/scratch/final-account-closeout-20261030/`；`focused-results.json`、两项日志、原完成记录，以及 `worktree-handoff/inventory-before.json`、`worktree-handoff/completion.json`。 |
| 三方合成 profile／文件交付 | `/Users/wolf3c/Project/homer/.codex/scratch/account-mvp/three-projects/20261030/synthetic-YbOEXY`；只作合成证据，不能采用为日常 profile。 |
| 维护文档 | 本文件、`docs/2026-10-30-homer-final-package-validation.md`、`docs/2026-10-30-homer-release-readiness.md`、`docs/2026-10-29-homer-native-token-mvp.md`。 |
| 日常环境 | `/Applications/Homer.app` 当前仍为 **build 123**；原 adoption、appData、runtime、workspace、Codex HOME、历史数据库、任务和用户文件全部保留，本次未启动或改写。 |

证据目录包含必要的合成输入和日志，不整目录加入 Git 或打成公开下载。详细命令环境和候选以已有记录为准；两个收尾测试的简写命令需要原隔离环境，不能直接使用日常 HOME 或生产 origin 复跑。

旧工作树占用 `du -sk` 为 **41896 KiB（约 40.9 MiB）**。唯一忽略内容为 `node_modules` 下 272 个符号链接：大部分指向主树依赖，另有主树 UI 链接和一个已失效的旧测试工具链链接；没有独有依赖实体、`.codex/scratch`、`.codex/private`、候选或历史数据。已扫描的主树依赖、最终构建与收尾证据目录未发现指回旧工作树的符号链接。删除链接时不得删除其指向的主树依赖。

### 旧工作树删除顺序

1. 用户先结束本对话。Git 工作树干净不等于 Codex 当前聊天已解除绑定，本轮不删除仍在使用的主检出。
2. 在 Codex 中归档／删除对应旧工作树；若工具仍提示 primary、shared 或占用，停止并处理对应绑定，不以强制删除绕过。此前另一聊天的 handoff 因 main 并行 dirty 失败，本次不再要求清空主树来完成 handoff。
3. 只清理上文准确旧工作树，不清理其他 worktree、主树依赖、保留证据或 App。完成后用 `git -C /Users/wolf3c/Project/homer worktree list` 核对登记，核对 build 127 摘要及证据仍在，再记录实际释放空间；不要承诺释放 GiB。
4. 从 Homer 项目选择本地目录 `/Users/wolf3c/Project/homer` 新开对话；不要在旧工作树里 checkout main。新对话先核对 `pwd`、分支、HEAD、Git 状态和本文件。

### 后续工作与停止线

Homer 本轮实现、review、必要聚焦测试、正式候选和合成交接已完成。实际最新完整登录复验是**购买关闭、假模型上游**：真实 Electron、网站、AMH 和固定 Codex 163 完成自动交付、正常重启、额度显示、主／Worker 文件交付、历史保全、同步间隔和停用拒绝。不是本次购买或真实供应商验收；不重复该测试来替代部署后的验证。

后续顺序：先只读确认 yezi2／AMH 是否已上线、实际版本和开关，再由用户授权安装／重启及真实验收。若目标包括购买，需网站商品支付交付及 AMH 同 Token 充值补丁和迁移均已上线；购买关闭时的 rc.45 登录路径不能据此证明购买可用。两项目版本和状态是本文记录时快照，新对话须刷新，不能自行恢复之前已停止的上线推进。

本轮没有解决全仓所有旧失败：保留 **53 个同基线失败、9 个两版未结束文件、测试 TS 116 个同基线错误**，具体名单见验证文档。若用户另行要求继续归因，以失败文件为单位选最小复现，先排除其他对话已在主树修改的内容，不整体接收脏树或延长超时凑绿。不得声称全部测试通过或真实性能已证明。

真实试用曾讨论的个人 10 元、共享预算 100000 元和本次 0.10 元上限均未写入；有限 Token 不能保证单次硬费用上限。新对话不把这些历史意向当作当前自动调用权限，不新增预算系统来扩张本任务。用户已明确 MongoDB 事项不由 Homer 任务处理。

### 可直接粘贴给 maintree 新对话

```text
继续 Homer 账号接入与角色模型连接的后续验证和优化。直接在
/Users/wolf3c/Project/homer 的 maintree 工作，不创建工作树。

先读 docs/2026-10-30-homer-account-final-handoff.md，尤其最后的迁回交接；
再读最终包验证和发布准备文档。先只读核对当前 HEAD、dirty 归属、
旧工作树是否已删除、build 127 ZIP 和保留证据，给出当前事实与下一项最小行动。

本轮产品输入 688443b，收尾提交 0ab960f、3316f54 及后续交接文档提交均在 main；
build 127 已保留，当前安装仍是 build 123。不要把主树并行 dirty 当发布输入。
保留全部历史、任务、文件和真实 runtime-config.json，不打印秘密或改真实凭据。

现有功能：网站登录自动交付 Token、独立 main/worker 配置、正常重启采用、
本人有限 Token 额度、发消息距上次检查超过一小时同步配置。
当前两角色 deepseek-flash/max/Fast 关闭，Codex 0.163.0；后台记忆 medium 已获批准。

聚焦和包内检查、购买关闭的三方假上游复验已有证据；全仓仍有旧失败和未完成项。
不要重复整套合成测试；先确认网站和 AMH 实际上线状态，之后按我具体授权验证。
当前不部署、不安装、不重启日常 Homer、不开放购买或接入、不写额度、不做真实付费调用。
不要自动推进其他项目或处理 MongoDB；坚持 KISS，有实际问题再做最小修复。
```
