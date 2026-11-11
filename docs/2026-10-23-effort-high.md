# Homer 默认思考深度 high 候选

2026-10-23，Asia/Shanghai。用户最新要求“将项目模型思考深度都改为高”。本次已完成维护源码及定向验证，随后按用户追加要求审阅并准备 Git 提交，见下文。**未构建发布包、发布或重启；当前日常服务尚未采用 high**。

## 范围与准确增量

实际目录与 Git 根均为 `/Users/wolf3c/Project/homer`，审阅基线 HEAD 为 `1ba698492903411029bb75fbafb694d76f802eb5`。宿主工作区查询返回 workflow=null，未取得可独立复核的登记路径，不能把历史登记记录当作本次查询结果。适用指导为任务给定的全局 AGENTS 指令；目录祖先及受影响子目录未发现额外 AGENTS.md。没有创建 worktree、分支或任务，也未联系其他伙伴。

| 文件 | 本次增量 |
| --- | --- |
| `src/model-config.ts` | 唯一产品逻辑变更：`PRODUCT_MODEL_DEFAULTS.effort` 从 medium 改为 high |
| `examples/homer.config.json` | 删除显式 medium，避免文档启动示例覆盖产品默认；模型和其他字段不变 |
| `tests/model-config.test.ts` | 更新默认 high 断言；将既有显式 effort 的新建/恢复/连续轮次矩阵扩展到 main、worker 两角色；测试资料改存本次 scratch |
| `tests/worker-default-fast.test.ts` | 主/Worker 及两级委派入口默认 high 断言；Fast 矩阵不变；测试资料改存本次 scratch |
| `docs/06-running-homer.md` | 当前默认、示例与采用边界；历史 medium 证据保留 |
| `docs/2026-10-22-model-defaults.md` | 仅追加最新要求及链接，不改写昨日提交/发布证据 |
| 本文 | 交付身份、验证结果和后续采用说明 |

逐文件前像已在写入前保留；只修改上述必要 hunk，没有恢复或覆盖并行 dirty 改动。配置优先级保持 `HOMER_* → 本机配置 → 产品默认`，显式 low/medium/high 等合法覆盖继续有效，不锁死未来任务选项。模型保持 `gpt-6.1-sol`；main fast、workerFast 均保持 true。没有修改 Cindy 全局默认、CTO 或其他会话设置。

`src/config.ts` 在启动加载时解析默认值；`Homer.engine()` 将同一 Config 交给主 Agent、普通 Worker 和递归 Worker；Worker 统一使用 `role: "worker"`。`engine.ts` 在每次 `turn/start` 传递 `config.effort ?? PRODUCT_MODEL_DEFAULTS.effort`，模型状态使用同一来源。故不需要增加按层级配置、适配器或热更新。模型目录入口只读；原生工具配置入口不拥有 Homer 的 model/effort/Fast。

## 当前运行与生效边界

2026-10-23 本次只读定位的 launcher PID=50823，host PID=51293。launcher 从 `.codex/private/release-inputs/95ec060eed2f7f8f60767ee8e42264e1f9bc77d27b36fc3ea9f844f389bec3de/scripts/dev.mjs` 启动，host 执行原 runtime 下 `trusted-builds/95ec060eed2f-24ca8386-d56f-45bb-9429-922dd13a61b5/dist/dev-host.js`。这两处独立冻结输入未修改。

准确配置仍为 `.codex/private/local-chatgpt.config.json`：白名单核对 model=gpt-6.1-sol，effort/fast 未设置；两进程均无 HOMER_MODEL/HOMER_EFFORT/HOMER_FAST 环境覆盖。冻结源与实际密封的 model-config 均为 medium、main fast=true、workerFast=true，冻结 config owner 的优先级与维护源码一致。这是运行入口、代码与配置的核对结果，没有提交真实模型轮次，也没有从生产业务 API 或数据库读取运行事实。

| 角色 | 当前冻结运行版的默认请求配置 | 本候选采用后的默认请求配置 |
| --- | --- | --- |
| 主 Agent（原线程恢复及后续轮次） | gpt-6.1-sol / medium / Fast=true | gpt-6.1-sol / high / Fast=true |
| 普通 Homer Worker | gpt-6.1-sol / medium / Fast=true | gpt-6.1-sol / high / Fast=true |
| 各级 Homer 子 Worker（同一创建入口） | gpt-6.1-sol / medium / Fast=true | gpt-6.1-sol / high / Fast=true |

合成宿主实际验证普通 Worker 和一个子 Worker；更深层由同一创建入口与共享 Config 保证，没有穷举所有递归深度。Codex 原生子 Agent 的模型继承合同不属于本次修改。既有执行、在途执行及历史记录不改写、不重放、不打断；冻结运行版下一轮也仍是 medium。没有改写私有配置、线程、原生 HOME、工具指纹、权限或业务数据。

## 定向验证

Node 22.22.0，复用现有依赖，无安装、真实模型调用或外发。

- 红灯：仅先改测试契约，`tests/model-config.test.ts` 38 项中 20 fail、18 pass，退出码 1；失败位于旧默认 medium 与新目标 high 不符的路径，原显式覆盖检查通过。
- 绿灯：`node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/model-config.test.ts tests/worker-default-fast.test.ts`，84/84 pass，0 fail/skip/cancelled，退出码 0。
- 协议覆盖：main/worker、legacy/native、新建/恢复、连续两轮；默认 effort=high，显式 low/medium/high 保留。Fast 本机/env 的 true/false 优先级、thread/start、thread/resume、每轮 turn/start 的 priority/null、目录明确不支持 Fast 的拒绝均保持。
- 实际 Homer 合成委派路径创建普通 Worker 和子 Worker；读取各绑定模型端点及 Web/user 投影，并把捕获的执行选项交给协议 fixture，确认 model/effort/serviceTier 一致。所有线程、输入及数据库均为临时合成内容，没有读取生产数据库、真实聊天或原生 HOME。
- 公开示例额外隔离加载检查通过：只将目录和可执行文件指向合成路径，得到 gpt-6.1-sol/high，main/worker Fast=true。
- `node node_modules/typescript/bin/tsc -p .codex/scratch/homer-effort-high-20261023/tsconfig.focused.json`，对产品源码和两份测试执行 noEmit 检查，通过、退出码 0、日志为空。
- 准确增量及 `git diff --check` 复核通过；未重复全仓测试、构建、浏览器验收或模型 benchmark。没有真实服务端档位、费用、速度或生产 high 采用证据。

证据目录为 `.codex/scratch/homer-effort-high-20261023/`，含前像、SHA、准确增量补丁、红绿 TAP、类型检查及示例检查。关键日志 SHA256：

| 文件 | SHA256 |
| --- | --- |
| red-model-config.tap | `4a1f3893c6ad50410b707e04457458864c4b879d8b0eb87ba912b4b085f8d63a` |
| green-model-workers.tap | `d04154bbef919d6658beb408f809594c0d21f74d3fbc4a40741bc5d2db26a9c6` |
| typecheck-focused.log（空） | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| public-example-check.json | `a9adf09d8ef446bd33c1cd63778642ce3a5241d783e21dddd64dbb594f9867be` |

## 提交前审阅

用户随后明确要求 review 本次代码并 Git commit。审阅未发现阻塞问题：默认值只在统一 owner 修改，配置加载、每轮执行及主/Worker 状态沿用原读取路径，合法覆盖和 Fast 协议保留；示例取消旧覆盖，避免文档入口仍得到 medium。未增加生产分支、I/O、依赖或额外配置层。

为排除对并行未提交引擎/服务改动的依赖，从上述基线导出普通隔离副本，只叠加本次七文件增量，未创建 worktree。该准确候选的两份模型测试再次 84/84 通过，0 fail/skip/cancelled；产品源码及两份测试 noEmit 类型检查通过、退出码 0。日志为本任务 `review-commit/candidate-tests.tap`（SHA256 `8f20cd175a90e2518868b9aafffc99df48bb79df073f44b240c174688ba485d9`）及空的 `candidate-typecheck.log`。两份共享文档仅提取本次增量，不把既有未提交内容带入提交。

性能判断限于代码路径：本次不增加宿主计算、分配或 I/O；Fast 请求保持 true。high 是模型推理参数，实际响应时间和用量可能增加；未做真实模型 benchmark，不能把此默认值调整解读为加速证明。审阅记录不改变前述运行版未采用的边界，提交不包含 push、发布或服务重启授权。

## 后续最小采用与回退

本候选产品 owner 后像 SHA256 为 `2ea6a6d11e8e903f48dd1814adc2dfa9dfd21c668ecac135487963a5425cc291`（前像 `7ebc6a236c133f63848485bd94fd794aca38b7ceac5c3b1c928dbdbbf9ed4167`）。公开示例后像 SHA256 为 `883b5b20e4dc4e3c6cff8a049b015ad0429a2c514aa24bb2200cace667bfd863`。这些是本次文件身份，**不是新发布 sourceHash 或密封 manifest**。

在另获构建发布/服务切换授权后，沿现有准确源码审阅及安全空闲采用流程，把本次 owner 差异加入待采用的受审版本；不能以整个 dirty 目录代替准确增量，也不能改写现有密封或直接复用昨日发布授权。当前配置无 effort/fast 覆盖，无需持久配置迁移；保持原账号、线程、runtime、工具和权限。对新构建复核默认值及合成协议，再从原正常入口采用，读取模型投影核对 high。若该流程需要停止或重新启动，应先取得相应授权，本次未执行。

现有读取路径没有在不换版的条件下更新当前 Config 的模型设置入口。修改本机配置也不是已运行实例的热更新办法。回退仅在后续获准的安全采用边界恢复旧默认或旧兼容构建；不回滚数据库、历史执行、原生 HOME 或新增业务事实。
