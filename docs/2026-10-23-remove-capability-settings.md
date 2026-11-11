# 移除能力管理页

2026-10-23，维护源码完成；首次验收时未提交，随后按用户要求进行代码审查与独立提交，尚未上线。用户要求移除顶部“能力”及完整对应页面，原 ChatGPT 登录／退出界面只作开发测试，不纳入正式界面。能力通过同一对话交办；本轮不决定正式认证方案。

## 起点、范围与消费者

当前任务登记目录、实际目录与 Git 根均为 `/Users/wolf3c/Project/homer`。没有仓库及父目录 AGENTS.md；采用会话所给全局约束、`ui/DESIGN.md` 与现有 vendor 说明。大量既有 dirty 改动按当前文件片段保留，没有切换分支或覆盖其他任务。

原流程为顶部链接 → `/settings/capabilities` 静态 fallback → `CapabilitySettings`，后者独占 `NativeDiscovery`、`ChatgptConnection`。页面向 `/api/capabilities` 发送状态、模型、发现、插件、Skill、MCP、OAuth 与账号动作；开发 launcher 经 `capabilities.state/manage` IPC 转交 `homerWebBridge`。全仓维护源码搜索没有发现其他桌面或首次引导 HTTP 消费者。历史交付快照及补丁不是当前运行消费者，保留其历史事实。

共享 `Homer.manageCapabilities`、`capabilityState` 仍有 Agent／后台／合成测试消费者，未删除。`NativeCapabilities`、原生发现、账号 owner、执行配置与已有认证机制保留。原 `nativeCapabilitiesProtocol` 与 feature 字段继续原合同，新 UI 不再消费它们显示入口；它们不能使已删除的 HTTP／IPC 重新可达。

## 实际删减

| 文件 | 改动 |
| --- | --- |
| `ui/capability-settings.tsx` | 删除完整管理页 |
| `ui/native-discovery.tsx` | 删除仅供该页面使用的目录／插件／Apps 界面 |
| `ui/chatgpt-connection.tsx` | 删除开发测试用登录、轮询、取消与退出界面 |
| `ui/homer-app.tsx` | 删除 import、顶部链接与路径分支，正常挂载主聊天 |
| `ui/homer-styles.css` | 删除页面及链接专属 CSS |
| `src/web-server.ts` | 删除管理 HTTP GET／POST 分支与旧路径 index fallback；统一 `404 {error:"route_not_found"}` |
| `src/web-contract.ts`、`src/web-homer.ts` | 删除页面独用 bridge 合同和接线 |
| `src/dev-host.ts`、`scripts/dev.mjs` | 删除对应 IPC 分派、网关 bridge、专属超时和读写分类 |
| `scripts/native-account-synthetic-host.ts` | 删除已无界面消费者的独立测试页面宿主；账号后台合成测试保留 |
| `scripts/native-capabilities-synthetic-host.ts` | 保留对话能力测试，移除不存在的页面指引 |
| `src/native-capability-tools.ts`、`src/capability-operations.ts` | 仅修正指向旧页面的说明／审批正文，不改变操作及授权逻辑 |
| `tests/native-capabilities-web.test.ts` | 用有静态资源、旧 bridge 诱捕与全部管理动作的行为回归替代原页面接口成功断言 |
| `tests/worker-default-fast.test.ts` | 模型 DTO 直接经共享 owner 核对，保留主 Agent／两层 Worker 的原断言 |
| `tests/capability-tool-catalog.test.ts` | 新增主 Agent／Worker 真实 MCP stdio 工具发布与调用回归 |
| `tests/remove-capability-settings.browser.mjs` | 新增实际产品 bundle、HTTP router 与原文件授权 owner 的隔离三尺寸回归 |
| `ui/DESIGN.md`、README 与能力／登录／工具生命周期维护说明 | 删除当前操作指引中的旧入口要求，注明历史记录与当前功能限制 |

没有新页面、隐藏高级入口、UI 抽象、凭据服务、API Key 登录表单或第二配置源。Canvas／Finder、主输入／队列、任务浮层、普通问答、微信及审批的已有实现按原片段保留。

## 保留的能力与明确限制

`capabilities` 的 15 个 action 和 input schema 与删除前逐字相同，schema 片段 SHA-256：`428a31c9903943cf035ed5ca89e42b0337d76a077b8f869767c7a175b3b5cfd5`。主 Agent／Worker 实际 MCP 目录各仍发布一个该工具；`state/catalog/discover` 可以到达原工具 owner。Skill CRUD／启停、插件查询／安装／卸载、MCP 配置／收窄／移除及下一轮采用继续原实现。插件安装／卸载、可完整展示的 MCP 配置仍需准确真人审批，模型不能自批。

删除页面会移除 **MCP OAuth 的现有唯一 Homer 用户入口**。未找到能按原身份和授权合同直接复用的标准授权入口，因此本轮没有另接授权卡。后台 OAuth 实现保留，Agent 请求仍拒绝；已有授权及凭据不变，新发起／重新登录／退出 MCP OAuth 暂无 Homer 用户入口，需要另行产品决定。

非空 argv、env、headers、凭据引用或其他隐藏字段仍返回 `capability_mcp_trusted_configuration_required`，包括 patch 继承的字段。保留用户可信原生配置路径这一原合同，不把 `approve:true` 或 hash 当成已审阅隐藏内容；本轮没有新增 Homer 内可信高级配置编辑入口。已获授权的配置与工具执行不因删页被禁用。

ChatGPT 登录、核对、取消、退出的面向用户界面和专属传输已删，底层账号 owner 仍供既有认证生命周期及合成测试使用。删除测试界面不代表正式执行无需身份认证；本轮没有真实 `account_logout`、删凭据、改账号、改模型或后端认证方式。

## 验证与证据

临时目录：`.codex/scratch/remove-capability-settings-20261023/`。所有 HTTP 使用随机 loopback 端口，浏览器是独立 Chrome profile，合成业务 owner 不执行模型；浏览器拦截外部访问，没有访问日常数据或真实账号。

- RED：旧路径实际返回 200，`red-routes.log` 中的目标 404 断言失败。
- GREEN：最终定向 **60/60**，`final-focused.log`。含新 MCP 目录／来源回归、旧路径与全部管理 HTTP 动作 404、旧 bridge 不被调用、Origin 拒绝、原精确插件／MCP 审批、隐藏字段拒绝、账号隔离及原生配置合同。
- 模型／Fast 相关 `worker-default-fast.test.ts` 在第一次扩展运行中全部通过，其原模型与启动／turn 参数对照断言保持。
- 实际产品浏览器 **320／390／1440 各 17 项通过**，`browser-results.json`。即使后台声明 nativeCapabilities=true 也无入口；直接旧 URL 无表单；主聊天发送、准确审批拒绝、任务浮层、正式成果 Canvas、微信弹窗均可用；Canvas／任务回焦、Canvas→微信 Tab 顺序、无页面横向溢出、无运行错误及外部请求。微信仅开关弹窗，不发起登录。
- UI 类型检查、隔离 Vite 构建通过。最终受影响源码／测试类型检查见 `changed-types.log`；不写 `dist` 或运行资源。构建仍有原大 bundle 警告，未扩大为优化任务。
- 本轮文件的 `git diff --check` 和新浏览器／launcher 语法检查通过。全树 diff 检查另见未触碰 `src/service.ts` 的并行空白问题，未清理。

可复现命令（需要宿主允许写项目 scratch 与启动隔离本机浏览器；不运行真实验收脚本）：

```sh
node --import tsx --test --test-concurrency=1 tests/capability-tool-catalog.test.ts tests/native-capabilities-web.test.ts tests/capability-approval.test.ts tests/service-capability-operations.test.ts tests/service-mcp-approval.test.ts tests/mcp-operation-review.test.ts tests/native-capabilities-service.test.ts tests/native-discovery.test.ts tests/native-capabilities.test.ts tests/native-account-service.test.ts tests/native-account.test.ts tests/native-mcp-config.test.ts
node node_modules/typescript/bin/tsc -p ui/tsconfig.json --noEmit
(cd ui && ../node_modules/.bin/vite build --configLoader runner --outDir ../.codex/scratch/remove-capability-settings-20261023/web)
node --import tsx tests/remove-capability-settings.browser.mjs
```

首次维护工作树隔离构建资产 SHA-256（包含当时其他并行改动，不是独立提交候选）：

| 资产 | SHA-256 |
| --- | --- |
| `index-IcZCh4GD.js` | `cf662a98998ec8fc13f63ca1d8191691e71a4c3b589942bbd1ff69570d865b6a` |
| `index-TYku3Yrz.css` | `88105e2e496a6e2d30096262d33f3a69784106663c96e2f200163e19a95fa7a8` |

截图位于同一临时目录：`chat-{320,390,1440}.png`、`canvas-{320,390,1440}.png`、`retired-url-{320,390,1440}.png`。已实际查看 320／1440 主界面截图。源码身份清单 `verified-source-identities.json` 在重建前登记，重建及浏览器完成后核对无漂移。

## 范围外失败与结论边界

不能称全仓检查通过：

- 全仓 `npm run typecheck` 基线 61 条错误，最终 41 条；并行修改使条目变化。仍含旧 `connectionDirectory/connectionFile`、旧 API／夹具、附件 NodeNext import 等错误；新增差异在未由本轮修改的接待、队列及历史测试。两轮均无本轮受影响源码／测试的报错。原始输出分别为 `baseline-typecheck.log`、`final-typecheck.log`。
- 第一次扩展测试 `green-contracts.log` 为 119/122，失败为队列续接 `new-user`、`stop-suspended`、`ack-yield`。本轮没有改该文件或队列实现；期间并行任务继续修改这些路径，不能将此组称为稳定的删页前后基线，也没有为过关改断言。
- IPC／原审批扩展组 `targeted-sequential.log` 为 22/23，`dev-gateway` 通过；`web-dev-host.test.mjs:72` 仍断言运行中旧 queue 中的输入为 1，实际 0。本轮没有改其队列语义。
- `catalog-contracts.log` 为 13/14，旧主 Agent 全目录断言缺少并行新增 `archive_work/restore_work/delete_work`；Worker 通过。新增的独立 MCP 回归只核对本轮必须保留的 capabilities 公开合同与真实 stdio 调用，主 Agent 和 Worker 均通过，未删除旧断言。

只验证本地维护源码。首次验收后用户授权 review 与 git commit，本次仅提交删页相关差异；未建 branch／worktree／tag／remote、push、部署、重启或安装应用，未真实登录／登出、调用模型、改能力配置或写生产数据。

## 回退

仅逐 hunk 反向撤销本轮删减，并恢复四个已删源码文件；不得整文件覆盖并行工作。任务前像与仅本轮差异保留在同一 scratch 下供审阅。回退不涉及原生 HOME、账号、Skill／MCP／插件文件、凭据或数据库，不进行生产数据回滚。

## 代码审查与独立提交验证

用户随后明确要求 review 与 git commit。审查没有发现需要阻止本轮删页提交的剩余问题；补齐以下两点：工具描述将 OAuth 明确限定为 MCP OAuth，保留其他原生账号与 Apps 语义；HTTP 回归覆盖全部22种旧管理动作。浏览器发送测试改为先确认输入可发送，再等待合成后端的接收记录，不用输入框清空来推导接收完成。

提交只纳入27个文件的本轮差异。`ui/DESIGN.md` 中其他任务的队列／活动段落及其他 dirty 代码均保留在原工作树；预先存在的未跟踪 `docs/native-mcp-config-management.md` 已仅撤销本轮两处说明改动，不纳入提交。更新后的限制完整记录在本文中。

以普通文件导出而非分支／worktree构建独立候选，更新到 `d8e0bd7` 后确认该并行提交的17个文件与本轮27个文件无交集。候选不依赖其他未提交实现，Node 22.22.0 的回执保留在同一scratch的 `review/`：

- 新增 MCP 发布／调用与旧管理路由回归 **3/3**，`new-tests.log`。主 Agent 与 Worker各保留准确capabilities schema，22种管理动作不触达旧owner。
- 主 Agent／两层 Worker 模型配置对照 **5/5**，`candidate-model-contract.log`。
- 最新候选合同 **55/57**，`commit-contracts.log`；两项失败与同一原HEAD基线完全一致：旧账号测试仍读取已不存在的toolSettings.settings，旧resumed-timeout测试仍期待mainBroken=true。基线／初始候选分别为52/54，见 `baseline-contracts.log`、`candidate-contracts.log`，没有因删页新增失败。
- 基线timeout案例等待540秒的人工决定，复核使用原生test-skip-pattern明确排除，并设20秒单文件上限；未修改该测试或放宽生产超时。
- 实际待提交前端 **320／390／1440各17项通过**，`commit-browser.log`；相关源码／测试类型与UI类型检查通过，`commit-types.log`、`candidate-ui-types.log`。
- 相同前端基线及相同构建环境下，主JS由2,568,020降至2,542,312字节，减少25,708字节；gzip由824,177降至816,360字节，减少7,817字节（约7.6KiB）。没有引入依赖、额外请求、轮询或运行状态；未声称已测得端到端延迟提升。

本次源码提交不表示上线；原OAuth唯一入口限制和全仓既有检查失败仍按上文保留，不进行真实账号、能力配置或生产数据操作。

独立提交候选主JS：`index-UJTI4s3c.js`，SHA-256 `5453dc281f09b371ac70e7539160d892c14e318fa4ea5456b9a6da1c86f11483`。其资源与首次工作树构建分开记录。
