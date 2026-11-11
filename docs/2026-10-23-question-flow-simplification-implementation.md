# 问答流程简化与官方组件实施

2026-10-23 的共享工作区实施与当时验证记录。2026-10-24 分批入库只包含已实现 UI 的必要问答前置；独立 Worker 待答发现及其方案不在本轮提交范围，当前准确结果以 [剩余 UI 入库记录](2026-10-24-ui-remaining-integration.md) 为准。原实施未部署、停启产品服务，未调用真实模型、微信或 Telegram 接口，未读取日常数据库、聊天或凭据。

## 产品行为

- Worker 的普通问题仍先交主 Agent。主 Agent 可以自行回答、调查、询问、延后或根据新意图调整；没有新增固定问答状态机、自动合并或关键词路由。
- 共享工作区另有有界 Worker 待答事实发现；它属于独立工作，未纳入本轮准确提交树。普通聊天不自动成为某个问题的答案，不自动广播给所有 Worker。
- 普通澄清和原生单题自由输入使用“回答此问题”进入同一个主 Composer，显示明确目标，可退出并恢复原普通草稿。普通引用和附件对象留在原 owner，答题不会发送、清空或撤销它们。排队编辑和答题编辑互斥。
- 主 Agent 原生明确选项采用固定官方 QuestionFlow。单选即推进，最后单选即提交；保留 Back，删除最终审阅和逐题 Next。新的选项向导不持续写每题草稿。
- 原生混合多题采用固定官方 ElicitationForm，一次填写并提交。只将自由字段 input 改为 textarea，并在没有 onDecline 时隐藏拒绝按钮；不伪造原生问题拒绝或操作批准。
- 自由文字和整请求表单草稿可刷新恢复。旧 localStorage 选项草稿可初始化官方组件，不能匹配的旧文字继续保留并可复制；不会自动发送。失效问题不再触发清空答复缓存，有明确失效事实时提供保留内容入口。
- ApprovalCard、原生权限子集、Worker 成果验收和交付 owner 保持。旧自绘 `ui/question-flow.tsx`、`ui/question-flow.css` 已删除，没有留下旧实现 wrapper 或双渲染框架。

## 输入、调度和回执合同

`ConversationInput` 新增可选 `questionAnswers`。正文 `text` 仍可读；原生答案由准确 question ID 映射单独承载，经原 `MainNativeApprovals` 校验后返回原回调。字段在当前 `/api/interactions/:id` 传递，没有新增 endpoint、数据表、迁移或第二队列。

新字段只属于原生 question：授权拒绝它，MainInputs 的接收和编辑都拒绝它。历史 hash 仅在存在新字段时增加对应部分，旧请求 hash 保持；新 map 按题 ID 排序，重试时正文、目标和答案都参与身份比较。原生 wire response 和宿主工具 schema 不变。

Worker 原生原始题目保留在原记录供主 Agent inspect，不再被 Web 投影为用户必须填写的整组问卷。主对话原生提问才进入结构化组件。主 Agent 内部 event 的原生提问隔离没有解除。

普通澄清回答仍由原 MainInputs 接收和调度，交给主 Agent 理解后 respond 原 Worker。原生问题的用户输入走原直接回调路径，不能排到等待它的 native turn 后面；普通聊天继续可以接收排队。不新增默认打断、优先队列或第二个主 Agent。

组件 Promise 只在准确输入获得业务持久接收后 fulfilled，不等待 Worker 执行成功，也不把它描述为成功。错误和未知回执保留原请求；提交内容被锁定，核对/重试沿用原 requestId。组件卸载、线程切换和迟到响应受到原 owner/线程及当前编辑身份保护，不能清除后写草稿或更新另一线程的回执。

新服务声明 `features.nativeQuestionAnswers:1`。新 UI 遇到旧服务时，用准确原生 JSON map 的原 text wire 提交，不静默丢字段；此旧组合的历史正文仍可能显示协议 JSON。已接收的旧 wire 只按准确原生 schema 解码 receipt，不解析 prose 汇总或猜测普通消息。旧的非法多题汇总不会被正则转换为答案。

## 源码与样式来源

新增组件固定到 assistant-ui `24b84e51911a539b20c9f7000f64c09e6c9f253e`，MIT；复用原 LICENSE、React、Lucide、cn、receipt-focus 和 surface 常量。没有升级 npm 依赖或新增 runtime/provider。

| 官方路径（`packages/ui/src/components/react/assistant-ui/elements/`） | 原始 SHA-256 |
| --- | --- |
| `question-flow.tsx` | `57b4b8af15e4a444586e684910b89db819cc5021c60a39ea93918dc721a94489` |
| `option-list.tsx` | `5f1c156aac4ad56aedac93665bef44f84a1253f357127dd92c55bf6926d230dc` |
| `elicitation-form.tsx` | `9d98ed74254ada76f5325f6d8cb333cf56bd3521763c3f6217c64e3ad8c2e621` |

来源：[QuestionFlow](https://github.com/assistant-ui/assistant-ui/blob/24b84e51911a539b20c9f7000f64c09e6c9f253e/packages/ui/src/components/react/assistant-ui/elements/question-flow.tsx)、[OptionList](https://github.com/assistant-ui/assistant-ui/blob/24b84e51911a539b20c9f7000f64c09e6c9f253e/packages/ui/src/components/react/assistant-ui/elements/option-list.tsx)、[ElicitationForm](https://github.com/assistant-ui/assistant-ui/blob/24b84e51911a539b20c9f7000f64c09e6c9f253e/packages/ui/src/components/react/assistant-ui/elements/elicitation-form.tsx)。

QuestionFlow/OptionList 只适配本地导入、中文和 scoped CSS；ElicitationForm 另有已批准的两处控件适配。`question-flow-upstream.test.mjs` 撤销这些明确差异后核验原始 hash，不用名称相似的自绘替代。OptionList 仍为官方按钮提交交互，不改成受控 radio；官方多选能力没有被推断为新增原生工具能力。

问答样式沿现有 `build-run-activity-css.mjs --question-flow`，限定 question-flow、option-list、elicitation-form 根节点，映射原主题。宿主仅补长文/窄屏、文字换行、44px 热区、焦点和自由文字多行区域。官方结构、字号、间距及图标保留。既有其他组件的 CSS 不作为本次产物重生成。

## 验证证据与限制

首先运行新增跨 owner 合同测试，旧实现五项失败：严格单题、多题、混合题、自由答案 map 丢失，以及新字段未参与身份。修复后通过。测试从 Web bridge 到实际 MainNativeApprovals/nativeResponse，不只断言字符串被转发；另覆盖实际 localhost HTTP 路由、path 身份、无效选项/缺题、授权拒绝字段、旧 hash、来源限定和有界发现。

相关集中回归 110 项通过，包含原生问答、原授权卡、主 Composer、Worker 生命周期、原生请求、MainInputs、队列顺序、Web server 和 Telegram。对原生字段通过队列编辑进入错误 owner 的路径也补了拒绝和原文不变断言。

产品源码、本次修改的 TypeScript 测试及 Web 定向类型检查通过；问答 CSS `--check` 通过；官方三个组件来源 hash 检查通过。隔离 Vite 构建通过，仍有大 chunk 提示，未为此作无关拆包。

浏览器使用实际构建的产品界面、内存 HTTP/SSE、隔离 Chrome profile 和合成数据。1440、390、320px 检查选择即推进/最后提交、Back、键盘、未知回执、刷新及精确重试、混合多题、多行文字、主输入框目标、普通附件保留、IME composition、失效内容保留、迟到 ACK、旧服务兼容及旧选项草稿初始化/未知旧文字可达。手机另检查 520px 低视口的发送操作可达；已人工查看 320px 主输入框及桌面表单截图。没有外部页面请求或浏览器异常。

验证入口：

```sh
node --import tsx --test --test-concurrency=1 tests/question-flow-contract.test.ts tests/question-flow-upstream.test.mjs tests/question-flow.test.ts tests/main-native-approvals.test.ts tests/approval-card-ui.test.mjs tests/main-composer.test.mjs tests/service-interactions.test.ts tests/service-main-native-approvals.test.ts tests/worker-interactions.test.ts tests/worker-native-requests.test.ts tests/worker-interaction-protocol.test.ts tests/recursive-main-inputs.test.ts tests/message-queue-order.test.ts tests/web-server.test.ts tests/telegram-homer-bridge.test.ts
node scripts/build-run-activity-css.mjs --question-flow --check
node tests/question-flow.browser.mjs
```

浏览器和 baseline 产物在 `.codex/scratch/question-flow-simplification-20261023/`，包括源码基线、官方原文、定向类型配置、合成截图、`focused-tests.log`、`browser-run.log` 和 `browser-results.json`。可维护的来源及验证入口保存在本文和正式测试中，不依赖忽略目录作为唯一依据。

更广检查仍有既有失败，未修改测试使其迎合当前实现：

- `tests/web-service.test.ts` 的 generation ownership 和 failed generation terminal 两项断言；已在本次修改前的隔离源码上复现相同失败。
- `tests/wechat-homer.test.ts` 第 71 行的历史用户消息数断言（0 与 2）；同样在修改前源码复现。其他已跑的微信用例通过。
- 仓库全量 `tsconfig.check.json` 涉及既有连接字段、`.ts/.tsx` 导入、附件测试类型等错误；本次产品源码和涉及测试的定向配置及 Web 检查通过，没有声称全仓 typecheck 全绿。

上述基线复查只复制非敏感源码、公开 prompts 和合成夹具到 scratch，不临时覆盖工作区或打断其他任务。真实模型的提问判断、真实渠道和生产运行均未验证。

## 兼容、回退和并行边界

保留 Telegram 现有准确 interactionId/来源校验。微信仍为普通用户输入；出站待答编号不被解析为自动路由，也不被解释为原生权限。没有改变渠道协议或联系任何其他任务。

回退只能回退源码和显示，不删除已接收答复、decision.answers、responseUserText、deliveredAt、原待答身份或未确认 payload；原生回调失效不跨进程重放。旧 UI 仍可使用原单题文本/JSON 分支；服务回退若不认识新字段，保留原请求并核对，不丢字段另发。

实施起点 HEAD 为 `8b99a7bb65337b4cd9fa50d84db9fbb360184dbe`。过程中并行任务推进了 HEAD；其中一次复核为 `bff579afd679bc3198bc755800d86f164929050c`（其他任务的官方 CSS 发布快照修复），交付前另一次读取为 `ff0f8b15502c51e50ba4d63549bf158377b89166`。本次没有执行 Git 写操作，也没有重新生成该 RunActivity CSS。已有 DESIGN、vendor README、CSS 编译入口、package 和测试 dirty 内容均按实际工作区保留，只增加本任务所需部分。

收尾：三种宽度各七组浏览器场景通过；已移除本任务创建的十四个临时 Chrome profile，保留截图、源码基线、日志与正式回归入口。
