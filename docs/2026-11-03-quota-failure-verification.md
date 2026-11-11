# Homer 模糊鉴权与额度不足：实现和验证

日期：2026-11-03（Asia/Shanghai）。仅 Homer 源码；不修改 New API，不安装、不发布，不调用真实模型或支付。

## 行为与复核

荷马来源的模糊鉴权错误由共享引擎使用实际绑定的同一令牌核验原生个人用量。查询成功、有效期未过且余额为零才显示额度不足和原充值入口；过期或401／403保留鉴权失败，无法核实则明确提示账号状态未确认。分类同时进入主请求历史、Worker 结果和提醒，未知不推测零余额。账号授权交换原有的结构化错误码解析保持原样。

两次只读代码复核发现并修正了异步终态边界：压缩失败补查期间的重复／迟到回执，以及主／Worker 终态后的消息、工具、审批和追加输入。终态计时立即记录，查询期间不再改变结果或派发新工具；关闭会取消查询并隔离迟到结果。Worker 原有的迟到工具完成观察继续遵守现有服务契约，不重放执行。

复核还补齐了空内容、非 JSON 和过大401／403响应的分类，状态明确后直接取消响应内容，不要求错误正文可解析。上述8项回归在修正前8项失败、修正后通过。

## 性能边界

正常成功请求、明确额度不足和 ChatGPT 来源不新增账户网络查询；模糊鉴权失败每次回执只核验一次，最多5秒，成功用量内容上限64 KiB。重复终态不重复查询；无自动模型重试、重放、切源或后台额度轮询。正常网站请求无额外账户访问及真实5秒中止均有回归断言。本次没有做真实网关延迟或吞吐量基准。

## 验证结果

使用本机已有 Node 22.22.0 和依赖，隔离工作树、合成服务和独立测试目录。默认全量命令：

```sh
npm test -- --test-timeout=30000
```

每项30秒上限用于记录挂起失败，不跳过用例；默认专项边界见 `docs/testing.md`。

| 版本／检查 | 通过 | 失败 | 取消 | 结论 |
| --- | ---: | ---: | ---: | --- |
| `14cc013` 原始 main 默认全量 | 1644 | 71 | 4 | 1719项，基线未全绿 |
| `c6fef55` + 额度补丁默认全量 | 1738 | 72 | 4 | 1814项，无新增失败用例 |
| `af36d73` + 额度补丁最终默认全量 | 1738 | 72 | 4 | 1814项，与前一候选及基线失败清单一致 |
| TURN 后续默认测试变更 | 67 | 0 | 0 | 不含额度补丁 |
| 补丁预览和打包 fixture 基线补查 | 14 | 1 | 0 | 不含额度补丁，复现额外打包 fixture 失败 |
| `af36d73` + 补丁定向账户／引擎／服务／UI | 172 | 0 | 0 | 合并组合验证 |
| 同组合移动端 HTML／窄屏浏览器 | 2 | 0 | 0 | 真实组件、合成桥接 |
| 同组合原生重连／隐私桥接 | 18 | 0 | 0 | 既有依赖，合成原生模块 |

产品后端与前端类型检查通过。完整测试类型检查在无补丁基线与候选中均有117条诊断；按文件和诊断内容归一化行号与隔离路径后，新增诊断为0。共享工作区已有的其他清理未混入本次提交，因此不以共享目录的其他修改代替被提交源码的基线。

候选的76条失败／取消记录逐项匹配原始基线及无额度补丁的后续基线补查。其中新增于 TURN 合入的 `Forge places existing helpers in the app and inventories its finalized ASAR before signing` 缺少合成 app 的 `Contents/MacOS/Homer` 文件，与本补丁无关。全量未全绿，不能将这些结果表述为整套验收通过。

失败／取消所在文件及记录数：

| 文件 | 数量 |
| --- | ---: |
| `tests/chat-conversation-baseline.test.ts` | 1 |
| `tests/electron-package.test.mjs` | 1 |
| `tests/first-launch-initialization.test.ts` | 4 |
| `tests/legacy-activity-reading-ui.test.mjs` | 2 |
| `tests/main-capability-continuation.test.ts` | 1 |
| `tests/main-chat-display-ui.test.mjs` | 1 |
| `tests/main-result-memory-scope.test.ts` | 2 |
| `tests/media-tool-inventory.test.ts` | 1 |
| `tests/memory-always-on.test.ts` | 1 |
| `tests/memory-invalidation.test.ts` | 5 |
| `tests/memory-migration.test.mjs` | 1 |
| `tests/memory-receipt-copy.test.ts` | 3 |
| `tests/memory-service.test.ts` | 5 |
| `tests/memory.test.ts` | 1 |
| `tests/message-source-consistency.test.ts` | 2 |
| `tests/native-account-service.test.ts` | 1 |
| `tests/native-capability-defaults.test.ts` | 3 |
| `tests/native-defaults.test.ts` | 1 |
| `tests/native-execution-recovery.test.ts` | 1 |
| `tests/native-fresh-main-preview.test.ts` | 1 |
| `tests/native-image-output-contract.test.ts` | 1 |
| `tests/native-memory-adoption-service.test.ts` | 3 |
| `tests/native-memory-fence.test.ts` | 1 |
| `tests/native-memory-recursive.test.ts` | 1 |
| `tests/official-sources-legacy-activity-ui.test.mjs` | 1 |
| `tests/pending-main-host.test.ts` | 7 |
| `tests/process-nodes-ui.test.mjs` | 4 |
| `tests/process-presentation.test.mjs` | 1 |
| `tests/process-reading.test.mjs` | 1 |
| `tests/recursive-input-memory.test.ts` | 1 |
| `tests/recursive-worker-memory.test.ts` | 1 |
| `tests/restore-official-components.test.mjs` | 1 |
| `tests/result-text-source.test.ts` | 2 |
| `tests/service.test.ts` | 1 |
| `tests/telegram-management.test.ts` | 1 |
| `tests/telegram-settings-page.test.ts` | 4 |
| `tests/tool-service-observer.test.ts` | 1 |
| `tests/web-connection.test.ts` | 2 |
| `tests/web-engine-stream.test.ts` | 1 |
| `tests/web-service.test.ts` | 1 |
| `tests/web-upload-host.test.ts` | 1 |
| `tests/worker-execution-clock.test.ts` | 1 |

## 证据与范围

维护的回归：`tests/homer-account.test.ts`、`tests/engine-rpc-lifecycle.test.ts`、`tests/model-failure.test.ts`、`tests/desktop-permissions-ui.test.mjs`。UI 行为见 `ui/DESIGN.md`。

本地原始证据位于 `.codex/scratch/quota-closeout-20261103/`：全量日志、逐项失败比较、红绿回归、类型诊断和移动集成日志。此前实际组件的充值桥接、入口打开失败、账号页、关闭保留草稿和320px窄屏核验位于 `.codex/scratch/quota-failure-20261103/`，均使用合成账号。

未验证真实账户购买、真实模型和已安装 App；未安装或发布，也没有改 New API。既有全量和完整测试类型错误保留，不扩大到其他任务的修复。
