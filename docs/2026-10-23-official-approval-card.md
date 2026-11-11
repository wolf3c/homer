# 原生命令授权卡采用官方 ApprovalCard

2026-10-23，产品源码候选。在登记、实际及 Git 根均为 `/Users/wolf3c/Project/homer` 的 `main` 开发；追加授权仅允许本批review、修正与Git提交。未建立分支/worktree、发布、重启或连接日常业务。已有大量并行改动保留，包括取消活动阅读器、底部用量展示、日期展示及排队编辑的其他修改。这里的交付只包含本任务增量。

## 现状与采用边界

已查看用户指定原截图，确认是 main-native 原生 Codex 命令授权，不是 Worker 成果验收或 TaskCard。原实现是 `.interaction-card` form 内的自绘命令文字及 `.native-approval-actions`。目标是实际采用官方成品源码，继续由现有 InteractionCard 管理业务。

采用官方提交 `1b5860dab94a221d1e0d31aad10c3e99593a0d0c` 的 `packages/ui/src/components/react/assistant-ui/elements/approval-card.tsx`、直接依赖及 MIT 许可。完整原始哈希/Git blob、最小改动及来源链接登记在 [vendor README](../ui/vendor/assistant-ui/README.md)。来源回归测试可逆转列明的适配并比对官方 SHA-256，确保不是只借组件名字的自绘套壳。

保留官方 DOM、布局、终端图标、384px最大宽度、20px圆角、16px内距、14px主间距、13.5px标题、12px命令、操作次序与原工具类。复用原 React/Lucide/cn/Tailwind/tw-animate，不安装或升级依赖，不加 wrapper、第二runtime、全局reset或新主题。

最小组件适配：本地导入；副标题允许既有准确来源链接；新增 disabled 输入接到原按钮；request 操作区可显示中性 statusLabel。宿主 CSS 只补文本保真、窄屏约束、原列表外距、段落重置、44px按钮和焦点。完整原 question（含命令、目录、说明）放入官方 command 区，不按前缀拆解，不模型摘要，不执行HTML，不读取额外路径。仅传 `onAllowOnce` / `onDeny`，始终/整会话授权入口不渲染。

## 状态与原合同

| 现有业务事实 | 官方 state / 操作 | 显示意义 |
| --- | --- | --- |
| 有效且已核对、无pending | request，允许两个按钮 | 用户决定当前请求 |
| sending | request，两按钮disabled，aria-busy | 决定已提交，等待确认 |
| pending requestId在accepted中 | request，两按钮disabled | 决定已送达；尚未确认执行结果 |
| 未确认响应 / 刷新恢复pending | request，核对后可明确重试 | 同interaction同payload保留原requestId |
| 未verified / 断线 / 全局线程屏障 | request，两按钮disabled | 正在核对当前请求，不能提交 |
| 服务确证interaction_not_live | 原owner移除/显示准确失效事实 | 不伪装成功或已拒绝 |

不使用官方 running/done/denied 推导命令执行或批准结果。后端审批协议、MAIN_TOOLS、CAS/幂等、权限边界及存储未改。原thread+interaction缓存、prepareInteractionResponse、POST路径和payload、accepted核对及准确失效处理保持。

红色行为断言发现原controller同一批次两次点击会提交两次，卸载/换目标后迟到失败仍触发旧回调；失去verification后也可能覆盖连接屏障。修复位于原owner：同步提交锁和有效owner引用，失败时只更新仍在场的准确owner；未核对状态不触发旧失效/错误回调，并保留pending供重连后显式精确重试。没有新增业务状态库。普通QuestionFlow/自由答复继续共用该owner。

追加review又以红绿断言修正两处边界：准确accepted回执已存在时，迟到POST错误不能再显示未确认；缺失sourceRequestId不能匹配另一条同样缺失ID的消息，仍可沿准确sourceMessageId定位。owner的创建/失效及最新回执引用在layout effect提交阶段更新，避免渲染阶段突变；父组件以threadId+interactionId为key，切换准确身份重建原草稿/锁。回执数组只是原props的最新引用，用于异步核对，不另存业务状态。

## 文件及清理

- `ui/homer-app.tsx`：官方卡消费、原controller保护、复用准确来源文字；替换分支不再输出旧form/标题/正文/按钮。保留其他审批和问题表单。
- `ui/homer-styles.css`：仅删除无消费者的 `.native-approval-actions`，保留普通 `.interaction-card p`。
- `ui/vendor/assistant-ui/approval-card.tsx`、`receipt-focus.ts`、`surfaces.ts`：官方源码及直接依赖；既有collapsePanel不变；现有MIT LICENSE复用。
- `approval-card.source.css` / `approval-card.css`、`scripts/build-run-activity-css.mjs`、`ui/package.json`：局部可重复编译；build/dev加入单卡编译。默认Run Activity和其他组件分支保持。
- `tests/approval-card-ui.test.mjs` / `approval-card-upstream.test.mjs` / `approval-card.browser.mjs`、两个helper及合成fixture：行为、来源、真实产品浏览器验收。现有composer fixture只多一个可选合成交互响应钩子。
- 本文、`ui/DESIGN.md`和vendor README：维护合同与来源。

未改变Worker验收、顶部TaskCard、模型high/压缩阈值、队列或Canvas源码；未恢复活动阅读器及已取消的用量入口。不会将同文件并行改动归入本次补丁。

## 验证与复开

执行于独立合成HTTP/SSE、真实产品bundle、任务专属新Chrome profile。没有生产DB、真实聊天、凭据、私有原生HOME、4780业务API、模型调用、上传或外发。Chrome请求拦截只放行合成origin及about/blob/data，校验无浏览器脚本异常、外部请求或越界API。

本轮记录：

- `node --test tests/approval-card-ui.test.mjs tests/approval-card-upstream.test.mjs`：9/9；覆盖官方替换、安全文本、两种准确决策、同批次双击、未verified、未知回执、刷新同身份重试、accepted禁用、accepted先于迟到POST错误、缺失来源ID、过期目标及卸载/换目标/失核对的迟到回执。
- `npx tsc --noEmit -p ui/tsconfig.json`：通过。
- Vite以产品配置（含许可notice）构建到scratch candidate：通过；保留现有超过500kB chunk提示，未声称性能提升。
- 首轮相关服务/协议/客户端6个文件：36/37通过。追加review对准确HEAD、HEAD+本批和实施前像复跑失败用例：HEAD与HEAD+本批相同，`tests/question-flow.test.ts`旧mock首先缺少snapshot.deliveries，在`src/web-homer.ts:137`读map失败；工作区实施前像的旧mock补过deliveries，但仍缺少app.inputs.dispatchSummary，首次失败相应后移。两者都早于本批卡片路径；未改mock或后端掩盖失败。真实产品QuestionFlow的选项、审阅、准确提交另由独立候选浏览器检查。
- 全仓类型检查未全绿。追加review用相同TypeScript、准确Git源码视图比较：HEAD与HEAD+本批均为5个完全相同的chat-timestamps历史测试错误（TS5097、TS7016、TS2339）；当前dirty工作区与本批实施前像均为24个完全相同的错误，另含chat-conversation-baseline、homer-attachment-adapter、interruption-recovery-projection、web-history-observation等未提交修改/导入配置。本批未新增诊断；不把工作区24项全部归因于HEAD，也不称全仓全绿。

Chrome `156.0.8078.48` 对独立HEAD+本批构建的1440/390/320三宽度均通过，每宽度13组，共39组检查：原请求点击后准确聚焦、键盘焦点/回车、真实触屏点击、reduced-motion、双按钮禁用、完整长命令安全换行、未知回执/刷新/accepted、accepted先于POST错误、断线重连、过期/迟到/线程切换，以及原QuestionFlow、自由答复、顶部TaskCard及Canvas。实测卡宽分别384/358/288px，按钮均44px高，无页面/卡片/命令横向溢出。测量保存在 `.codex/scratch/approval-card-official-20261023/browser-results.json`。长期维护入口为本仓库测试，复跑：

```sh
node scripts/build-run-activity-css.mjs --approval-card --check
node --test tests/approval-card-ui.test.mjs tests/approval-card-upstream.test.mjs
npx tsc --noEmit -p ui/tsconfig.json
node tests/approval-card.browser.mjs
```

追加 `--screenshots` 可拍摄隔离合成页面的request/sending/unknown/accepted状态；`HOMER_APPROVAL_WEB_DIR`可指定已经构建的准确候选目录，用于review独立HEAD+本批产物。该选项只服务测试，不改变产品runtime或默认开发代理。

仅复开合成产品候选（会构建并打印本次临时地址，Ctrl-C关闭，不连接生产）：

```sh
node tests/approval-card.browser.mjs --serve
```

候选静态文件位于 `.codex/scratch/approval-card-official-20261023/candidate/`；必须通过合成服务复开，不能直接指向默认开发代理4780。`--reuse-build`只供本轮明确已有相同产品源码候选时复用，不作为重新构建证据。

追加授权澄清允许隔离合成页面的浏览器截图。现已实际拍摄并查看桌面/手机真实渲染：准确HEAD前图在scratch的`review/approval-before-{1440,390,320}.png`；独立HEAD+本批后图及提交中/未知/已送达图在`approval-{request,sending,unknown,accepted}-{1440,390,320}.png`。图片中均为合成消息和`/synthetic`命令文本，没有执行用户原截图中的node/probe命令。上线、真实审批及命令执行均未验证，也不在授权范围。

## 独立提交预检与性能边界

review基于`ef0278ff4ab19044290a5579078a5686da03af76`，保留日期任务已经提交的内容，真实索引起始为空。只从HEAD重放本批19文件hunk，其他源码按需从Git blob读取；不复制全仓、不建worktree、不夹带dirty队列/Canvas/连接/日期修改。准确HEAD与HEAD+本批UI类型均零错误；两者均用各自真实Vite配置完成构建，并检查独立补丁可应用到临时索引。源码视图预检、输入清单和诊断位于scratch的`review/`。

代码检查没有新增网络订阅、自动重试、轮询或第二runtime。每次明确决策仍只有一个POST；同步锁防重复，异步以准确owner/request核对。layout effect只更新当前验证/回执引用和卸载标记，不测量布局或触发额外渲染；普通流式快照不会因thread+interaction key变化而重建卡片。原sessionStorage读取/草稿effect继续归原owner。

同一HEAD配置的构建实测：仍是1个JS和1个CSS文件；增加JS 5700字节（gzip +1438），CSS 27186字节（gzip +2881）。这是官方卡片、图标和作用域样式的采用成本，不是加载提速证据。现有大chunk提示保持；未做延迟/吞吐量benchmark，不保证未经测量的速度指标。所有业务验证均沿合成fixture；没有日常性能或生产采用证据。

## 回退

本轮共享文件前像/哈希、固定官方原件、独立增量及测量位于专属scratch。应用本任务独立补丁的反向hunk可恢复旧分支；先检查当前文件是否又被他人修改，再仅反向本任务hunk，删除本任务新增且无消费者的vendor/test文件。共享surfaces只移除本任务新增五个常量，保留collapsePanel。不要恢复整份旧homer-app/DESIGN/CSS，也不要git reset/checkout；这样会覆盖并行取消活动阅读器、用量入口等改动。没有发布或持久业务数据变化，因此不需要业务数据回滚。
