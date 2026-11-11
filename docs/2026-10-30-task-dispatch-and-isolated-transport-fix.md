# 派工材料误用与隔离测试连接修复

日期：2026-10-30，Asia/Shanghai。状态：本地候选已实施并完成针对性验证；交接范围为本地 `main` 提交，不打包安装、不发布。原有运行实例未重启，已有对话未迁移或删除。

## 根因与正式版范围

1. `material_path_denied`：实际失败的两次 `dispatch_work` 把工作说明放进了 `material`，而该字段要求相对 `.md` 材料名称。原参数不是目录越界，也不能据此认定工作区访问权限坏了。`src/service.ts` 的旧入口按约定拒绝了参数；模型同时能使用不要求材料文件的 `task_delegate`，但旧工具描述没有把区别说清楚。调查阶段对已安装 Homer 0.1.0/build 123 的同一处理方法做了隔离调用：两份原参数同样被拒绝，合法材料名称通过格式检查。因此正式版也有这条误用风险，不是开发环境专属；这不等同于正式版真实会话已经复现。
2. 工作状态读取失败：原测试桥通过 32 条继承描述符连接子进程，描述符不能像 TCP 一样重新连接。后端 HTTP 的默认空闲保活超时关闭已用通道后，桥无法重新建立它们，最终 `/api/tasks` 返回 503。故障时，后端直接读取为 200、测试会话心跳为 204。修复前独立复现中，空闲 6.5 秒后 32/32 通道关闭。正式版不经过这层测试桥；调查阶段已安装模块的普通 HTTP 路径在相同空闲前后均为 200，未观察到同一故障。
3. 复核补充：大附件下载途中关闭浏览器响应时，立即 `resume()` 会被随后执行的 `pipe()` 清理再次暂停，导致通道被占住。修复前连续取消下载，第 33 次返回 503。此问题也属于隔离测试桥。

## 实施内容与边界

- `prompts/main.md` 及本轮隔离副本的同名文件：明确新工作优先用 `task_delegate`，说明 `contract.goal`、验收条件、展示字段和空输入列表的用法；旧入口只能使用已有材料名称。解释格式错误不代表权限损坏，禁止换个说明文本反复派工，要求尊重当前工作目录和运行权限。
- `src/tools.ts` 保持逐字节不变，SHA-256 为 `5092510fe443b55a02c2fc75ec28a29e6043da962efce29502a7d3d727236aa7`。不改变既有线程保存的动态工具契约及其哈希，也不放宽材料路径校验。
- 隔离副本 `src/web-server.ts`：继承描述符使用单独的 HTTP server，仅此 server 关闭空闲保活超时；普通回环监听仍用原有配置。关闭隔离实例时显式回收继承 socket。
- 测试桥 `bridge.mjs`：浏览器中止后先结束 SSE，再在 `unpipe` 之后排空上游；大下载中止同样延后排空。通道忙、全部关闭和目标失效返回静态错误码。保持 32 通道、既有认证和来源校验，不重放请求，不回退到可被替换的 TCP 端口。
- 未变更已有账户、权限配置、工作区、运行数据库或已安装正式版。原测试实例仍加载修改前代码；本次验证使用新隔离实例，没有把测试通过等同于旧页面已切换。

隔离测试代码位于忽略目录。为保留可审查的源变更及回归用例，另存维护补丁：[隔离传输补丁](patches/2026-10-30-isolated-private-transport.patch)。补丁相对于本次开始时的副本，不是任意版本的完整安装包；保留既有隔离副本后才能重放。补丁已通过当前文件的 `git apply --reverse --check`。根目录提示词改动正常保留在工作树中。

## 验证记录

证据目录：`.codex/scratch/task-dispatch-transport-fix-20261030/`。原始模型运行记录仅留在已有忽略的私有运行目录，不收录对话正文、工具参数或凭据。

| 检查 | 观察结果 |
| --- | --- |
| 空闲通道与错误响应，先红后绿 | 修复前轮询空闲后返回 503、忙响应缺少 JSON；修复后通过 |
| 大下载取消，先红后绿 | 修复前第 33 次下载返回 503；修复后 40 次取消及随后任务读取均为 200 |
| `private-transport.test.mjs` | 6/6，通过三轮空闲复用、通道占满恢复、取消下载、70 次普通请求、80 次 SSE 重连及替换 TCP 监听测试 |
| 桥认证、会话、附件、审批及队列回执回归 | 13 通过；另 1 个启动器用例因原有 Live 实例正在运行而失败，未为测试停止该实例 |
| 派工及输入引用相关服务测试 | 33/33 通过 |
| 原线程工具兼容测试，显式指向当前源模块 | 4/4 通过 |
| 原生默认与运行配置测试 | 7/7 通过 |
| 根服务与隔离服务 `tsc --noEmit` | 均通过 |
| 新隔离实例真实模型验收 | 创建 1 个 `create_root` 工作并成功完成；无需材料文件，输入列表为空；报告包含合计 10 和 30%/50%/20%，说明来自当前消息；任务读取 53 次且空闲 6.5 秒后仍为 200 |
| 变更保护 | 移除本次新增提示段后与修改前字节完全一致；工具文件哈希不变 |

针对性命令：

```sh
node --import tsx --test .codex/scratch/impeccable-live-bridge-20261030/private-transport.test.mjs
node --import tsx --test tests/service.test.ts tests/recursive-tools.test.ts tests/delegation-attachment-input.test.ts
HOMER_TEST_SERVICE_MODULE=file:///Users/wolf3c/Project/homer/src/service.ts node --import tsx --test tests/main-tools-resume-compatibility.test.mjs
node --import tsx --test tests/native-defaults.test.ts tests/native-capability-defaults.test.ts tests/native-execution-profile.test.ts
npx tsc -p tsconfig.json --noEmit
npx tsc -p .codex/scratch/impeccable-live-isolated-20261030/tsconfig.json --noEmit
```

整体验证未通过：`npm run typecheck` 有 8 个未在本次修改的测试/UI 文件报出 26 个错误；`npm test` 有环境缺项及多项断言失败，运行到第 788 个用例后停在 `native-execution-recovery.test.ts`，本次启动的测试进程已停止，没有完整汇总。不能据此声称全仓绿色，也未逐项认定这些失败的历史归属。桥的启动器检查受已有 Live 实例占用影响，实际完整启动器重启路径未验收。

真实模型验收使用原测试配置对应的受限运行模式，未切换到正式原生权限。因此该验收证明无材料派工和测试桥回收可用，不证明其拥有整个 Homer 项目访问权，也不证明正式版真实账户/跨进程升级路径已全部验收。后续正式打包与发布前仍需处理整体验证缺口，并单独授权正式操作。

## 本地 Git 交接

独立复核未发现本次变更的阻塞问题。改动继续复用 HTTP 保活和流式读取机制，保留有限的 32 通道，不增加正常请求的网络往返、重试或 TCP 回退；未做吞吐与延迟基准，不能宣称整体性能达标。

提交前再次运行：传输回归 6/6、服务与原生配置检查合计 40/40、原线程工具兼容 4/4，根服务与隔离服务类型检查均通过。日志为证据目录内的 `precommit-transport.log`、`precommit-service.log`、`precommit-resume.log`；此次未重跑已知未通过的全量检查，也未再次调用真实模型。

提交仅包含本次新增派工提示段、本记录和隔离测试修复补丁。提示词末尾已有的内部协调规则留在原工作树，不混入本次提交。当前本来就在 `main`，本次未创建 worktree，因此没有额外分支需要合并，也没有本次 worktree 需要清理；其他既有 worktree 保留。
