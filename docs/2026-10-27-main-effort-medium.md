# 主 Agent 默认 medium 源码合入记录

2026-10-27，Asia/Shanghai。用户要求仅降低 Homer 主 Agent 默认思考深度以加快处理，并审阅、合入 main。CTO 已独立审阅候选 `7d0a16e8d7233b05ed168fa3e7c7312b614cadb6`，未发现阻塞缺陷，并接受既有递归验证边界；该源码候选已快进合入本地 main。尚未 push、发布、安装或重启，当前运行中的 Homer 不会因此立即改变。本地合成检查不证明真实速度、服务端采用或积压任务处理结果。

## 行为与边界

| 角色 | 模型 | 默认 effort | 默认 Fast |
| --- | --- | --- | --- |
| 主 Agent（含未指定角色） | gpt-6.1-sol | medium | 开启 |
| Homer Worker | gpt-6.1-sol | high | 开启 |

保留 `HOMER_* → 本机配置 → 产品默认` 优先级。显式 `effort` 仍是所有角色共用的覆盖，支持 low、medium、high、xhigh、max、ultra；显式 Fast 布尔值也仍覆盖所有角色。要自然采用角色默认，应保持 effort、fast 及对应环境覆盖未设置。本次不迁移或改写本机配置。

不调整自动压缩设置（任务要求保留现有 250000），不实施 DeepSeek 或其他优化，不读写鉴权与真实 HOME，不发布、不重启，也不停止、清理或重放积压任务。没有真实模型或账号验证。

## 实现

- `src/model-config.ts`：主 `effort=medium`，新增内部 `workerEffort=high`；`effectiveEffort()` 统一解析显式覆盖与角色默认。Fast 的解析和默认不变。
- `src/config.ts`：保持未设置 effort 为 undefined，使共享 Config 不会提前固定某个角色的默认；保留合法值校验与环境优先级。
- `src/engine.ts`：每次 `turn/start` 按 `options.role` 解析 effort；新建、恢复、连续轮次以及 native/legacy 分支共用该路径。模型、thread/turn 的 `serviceTier` 不变。
- `src/service.ts`：`models.configured.effort` 和 `effortListed` 使用调用角色的有效值，与执行请求一致；Web/user 入口按主角色解析。
- `src/cli.ts`、`src/dev-host.ts`：启动提示和两处 ready 消息展示有效主 effort。
- `scripts/desktop-runtime.mjs`：独立桌面启动默认 Config 不再提前填 effort；采用已有配置时仍保留其显式覆盖。本次仅源码审阅和语法检查，未构建或启动桌面发布包。
- 两份模型配置测试及协议 fixture：合成输入、隔离 HOME/数据目录；覆盖实际协议、宿主绑定能力端点与启动消息。

Config 的 effort 现在与 fast 一样表示可选共享覆盖；所有生产执行和展示调用方都已核对。真实验收脚本中的原始 `config.effort` 字段只代表显式覆盖，未设置时可为空，不能作为角色有效值证明；本次未运行这些脚本。

## 基线与验证边界

隔离目录：`/Users/wolf3c/Project/homer/.cindy-worktrees/wise-lamarr`，分支 `cindy/wise-lamarr`，基线 `ce18fa35c3696de4302c0223da391dfc12860936`。开始时隔离工作树干净。未复制维护主树的未提交资料、测试或其他改动；当前安装版与维护树的全部能力不属于此次候选验证结论。

该基线只允许主 Agent 协调一级业务 Worker。`RecursiveTools.call()` 对 Worker 的委派请求返回 `task_main_required`，`RecursiveTasks.delegate()` 也要求主角色及主根任务。因此不可能在此基线集成验证 Worker 自行递归委派；本次保持该限制，不扩权。实际验证普通同级 Worker、主 Agent 协调的子 Worker，以及共享 `role=worker` 执行/状态解析始终默认 high；不声称已验证不可达的递归链路或 Codex 原生子 Agent 的模型继承。

## 验证记录

需求推导的合成回归，使用 Node v22.22.0 和维护主树已安装的依赖；测试的 Codex 可执行文件只指向仓库本地 `.mjs` 协议 fixture，没有真实模型、网络渠道或账号访问。运行时 HOME、业务库及证据均位于本工作树 `.codex/scratch/homer-main-medium-20261027/`。

1. 先调整行为断言再修改产品源码：126 项中 81 通过、45 失败，失败对应默认主 effort 仍为 high；见 `red.tap`。测试隔离修正后重新采集该红灯；旧 mock 的 skills/list 等待和基线不允许 Worker 委派均已与产品回归区分。
2. 修改产品源码后，原 126 项全部通过，见 `green.tap`。矩阵涵盖新建/恢复、两次连续轮次、未指定/main/worker 角色、native/legacy、各合法显式 effort、模型/环境优先级、错误校验、Fast 默认及显式开关；宿主能力端点的状态与捕获执行参数一致。
3. 新增 4 项真实子进程启动投影检查，首次启动和同线程重启各执行一次；默认 medium 和显式 low 均通过，见 `startup.tap`。CLI 同时核对实际 turn 参数，宿主核对 ready 消息。
4. 最终两份测试合跑 130 项全部通过，见 `final.tap`；源码及两份测试的 TypeScript 无输出检查、两份 `.mjs` 语法检查及 `git diff --check` 均通过，命令如下。没有运行可能访问生产配置或真实账号的验收脚本。

```sh
HOME="$PWD/.codex/scratch/homer-main-medium-20261027/test-home" ../../node_modules/.bin/tsx --test --test-concurrency=1 tests/model-config.test.ts tests/worker-default-fast.test.ts
../../node_modules/.bin/tsc -p tsconfig.json --noEmit
../../node_modules/.bin/tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters tests/model-config.test.ts tests/worker-default-fast.test.ts
node --check scripts/desktop-runtime.mjs
node --check tests/fixtures/model-settings-app-server.mjs
git diff --check
```

只检查源码及两份相关测试的 TypeScript 依赖图，未执行全仓测试和桌面打包验收。

## 审阅与合并

自审补齐了桌面独立默认 Config 的提前填值问题，以及 CLI/宿主 ready 消息在 Config effort 未设置时的展示缺口。`models.configured.effort` 与 `effortListed` 共用一次有效值解析；没有新增配置页面、持久迁移或角色层级状态。

2026-10-27：CTO 独立读审候选完整生产源码增量、相关测试、本文、`verification.json` 及 `final.tap`（130/130），未发现阻塞缺陷，并接受 `task_main_required` 的递归集成边界。随后按既有授权完成本地 main 源码合并，不 push。

合并前 main 仍为 `ce18fa35c3696de4302c0223da391dfc12860936`，暂存区干净；候选涉及的源码、脚本及测试均无并行漂移。预存了 85 个既有 tracked dirty 路径的内容/模式指纹、缺失状态，以及包括未跟踪目录条目的状态清单。共享文档 `docs/06-running-homer.md` 的三方整合无冲突；在临时索引和独立合成 Git 仓库演练后，仅对工作文档应用本任务补丁、将其索引指向干净候选 blob，再执行 `git merge --ff-only 7d0a16e8d7233b05ed168fa3e7c7312b614cadb6`。没有 stash/reset/clean，没有覆盖 dirty 整文件，也没有把既有 dirty 内容带入提交。

源码合并后 main 为 `7d0a16e8d7233b05ed168fa3e7c7312b614cadb6`，索引树等于候选提交树且无暂存差异；全部其他既有 dirty 路径的字节/模式/缺失状态保持，状态和未跟踪条目列表保持。共享文档与三方预览逐字节一致；在 scratch 副本逆向撤销本次补丁后，与合并前文档逐字节一致，证明原有文档增量保留。本文件随后只补充真实审阅和合并状态；最终 main 身份可从包含本文的 Git 历史及任务回执核对。

本地保全与合并证据位于 `.codex/scratch/homer-main-medium-20261027/merge-preview/`：`main-before.json`、`preview.json`、`source-merge.json`；候选阶段的 `verification.json` 保留当时未合并的历史状态。合并未改动已审阅产品代码，未重复运行整套测试；状态文档更新另经差异检查。

回退只需在后续获准源码变更中恢复本候选增量；本次没有发布或运行时状态变更需要回滚。将来采用源码时须走独立获准的正常更新流程，不能把 Git 合入 main 说成正在运行的 Homer 已生效。
