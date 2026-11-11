# 五项恢复固定官方效果：实施与验证

2026-10-24；HEAD `4713450961bdf262d557c91dc3928f6dbac1f40c`。本次已完成源码及隔离验证，未提交、发布、安装、重启或变更真实队列／草稿／数据库。工作区原有大量 dirty；以任务开始时逐文件前像核对，保留同期右侧工作状态、刷新栏删除、助手气泡、预览入口及 Canvas 操作／标题改动。

## 实际修改

| 项目 | 修改前 → 当前 |
| --- | --- |
| 代码标题栏 | 实色边框／底色及44px复制 → 50%半透明、24px复制。修正原手写CSS映射，沿当前12px标题圆角；复用已有 TooltipIconButton／Tooltip，保留原复制Promise、流式身份、失败回执及未知语言／Mermaid处理。 |
| 官方组件按钮 | Canvas／WebPreview、审批、问答、消息动作、引用删除、Sources、File下载、Image关闭、Attachment关闭及 TaskCard 额外最小尺寸撤销。Elicitation 父栏／子按钮恢复32／32；消息动作28；Canvas关闭28；Image关闭36。宿主自建Composer、状态总入口和业务恢复操作保持原尺寸。 |
| 附件热区 | 56px方块保持；移除表面20px保持。删除宿主 `::after inset:-12px`，回官方 `-6px`，实际热区44→32px。删除相应宿主列表内距。极小原图的预览容器保留28px最小高度以容纳官方28px关闭按钮；该边界不放大按钮。 |
| 文件名 | FileList和历史附件FileName撤下换行覆盖，恢复官方truncate。完整title／可访问名称、准确ID、预览／下载owner保持；Canvas标题继续单行。删除无消费者的inline utility补充并重新生成CSS。 |
| 来源 | 删除safe数组第二次map生成的预览按钮、专属CSS和无消费者的openWeb回调。保留一组官方来源链接、原HTTP(S)／无凭据过滤、原序ID及“未经独立核验”。外链仍原样打开，不劫持到Canvas；通用网页读取／成果预览及批注owner保留。 |
| 队列 | 删除逐条展开、编辑、拖拽、排序菜单／专属DOM、row slots、编辑props／handlers、旧编辑输入helper及无消费者的完成反馈／adopt接口；删除不再使用的dnd-kit声明与六个专属锁定包条目。保留官方编号／单摘要／24px取消，无重复运行栏。 |

当前MessageQueue仍为最薄业务适配：服务端 `dispatch-v1, sources:all` 原混排次序／身份／位置、权威总数、分页、每行取消权限及禁用。Worker标识和不可编辑／未知事实并入同一摘要；仅准确可取消用户行提供取消。长页列表限高滚动以保持Composer可达。未新增队列runtime、轮询或状态库，服务端持久顺序、单条领取、CAS及后台编辑／排序API未修改。

旧 `homer-queue-editor:<thread>` 原样保留为只读恢复内容，原普通草稿仍由原restore owner恢复请求身份、引用及已确认附件；更旧的 `homer-queue-edit:<request>` 保留内容入口不再因该行仍可编辑而隐藏。未清空存储、未自动发送、未将旧附件引用转成新请求。`homer-queue-operation:<thread>` 继续由QueueOperations按原操作身份核对／明确重试，未知写锁保持，接收确认不冒充执行成功。旧编辑稿不会自动重新成为可保存的队列编辑器。

设计与来源说明已更新于 `ui/DESIGN.md` 和 `ui/vendor/assistant-ui/README.md`。固定官方来源仍为审计目录中记录的各组件固定commit；16份上游原始字节均通过manifest哈希核对。无依赖新增，中文、品牌主题、助手气泡、业务校验均保留。

## 验证

- 新增队列简洁结构／合法取消和单组来源行为测试，在修改前UI副本为0／2，通过当前源码为2／2；未用DOM镜像CSS测试代替真实渲染。
- 相关源码／固定上游／问答／草稿／状态样式测试30／30，统一混排领取／ACK合同4／4。
- 五项前后三屏合成浏览器验收63项；代码复制／流式／错误／公式／Mermaid51项；消息复制引用48项；Sources／旧工具历史45项；审批33项；问答21项；附件51项；历史Image／File48项。全部使用原React构建及合成HTTP或独立SQLite／held engine、独立Chrome，不读取账号、生产消息或真实浏览器存储。
- 队列覆盖用户／Worker原序、Worker无取消、键盘取消、取消回执丢失与刷新后准确核对、旧编辑稿字节不变、普通引用／runtime附件保留、84条跨页全量可达与返回首页。短时空闲观察中队列未新增轮询请求；复制流式回归保持准确代码源身份。未声称性能提升。
- 七组源CSS按原生成器算法重建并全部`--check`通过。为满足证据目录边界，仅使用任务目录内的生成器副本，将root及临时编译路径重定向到本任务目录；产品生成转换逻辑不变。保留该副本与原始编译输出供复核。
- UI类型检查 `tsc -p ui/tsconfig.json --noEmit`、服务端源码检查 `tsc -p tsconfig.json --noEmit`、隔离Vite构建及`git diff --check`通过。
- 全仓 `tsconfig.check.json`仍报12条旧测试错误。修改前UI隔离副本与当前输出，归一化路径后完全一致：`chat-conversation-baseline`的connectionDirectory／connectionFile、`chat-timestamps`的导入扩展／声明／process、`interruption-recovery-projection`的jsx／隐式类型及`web-history-observation`缺声明。未将此称为全仓check通过，也未扩大修复范围。
- 历史Image测试固定要求六个File行的断言，在前像构建同样失败：它与已批准的“图片加载成功后不重复File行”决定相冲突。已改为验证图片不重复File、普通文件及损坏图片仍有准确结构；文件名单行及下载回归通过。旧审批脚本的废弃问答／TaskCard段落保留，使用新增`--approval-only`仅运行当前审批合同；问答另由现行完整脚本覆盖。

共享工作区前后隔离构建的主JS为1,961,489→1,839,738字节，全部CSS为450,146→442,673字节；记录包含保留的并行改动，不是运行性能结论。Vite原有大chunk提示仍存在。独立构建输出保留，不复用其他清理任务的产物。

## 五项前后截图

均为实际产品React的合成数据截图；每个链接均指向本任务证据目录。按钮对照使用能直接检出32／44父子冲突的Elicitation，另有审批、Canvas、附件和图片回归截图。

| 项目 | 320px | 390px | 1440px |
| --- | --- | --- | --- |
| 代码标题栏 | [前](../.codex/scratch/restore-official-components-20261024/browser/before-code-320.png)／[后](../.codex/scratch/restore-official-components-20261024/browser/after-code-320.png) | [前](../.codex/scratch/restore-official-components-20261024/browser/before-code-390.png)／[后](../.codex/scratch/restore-official-components-20261024/browser/after-code-390.png) | [前](../.codex/scratch/restore-official-components-20261024/browser/before-code-1440.png)／[后](../.codex/scratch/restore-official-components-20261024/browser/after-code-1440.png) |
| 官方按钮 | [前](../.codex/scratch/restore-official-components-20261024/browser/before-buttons-320.png)／[后](../.codex/scratch/restore-official-components-20261024/browser/after-buttons-320.png) | [前](../.codex/scratch/restore-official-components-20261024/browser/before-buttons-390.png)／[后](../.codex/scratch/restore-official-components-20261024/browser/after-buttons-390.png) | [前](../.codex/scratch/restore-official-components-20261024/browser/before-buttons-1440.png)／[后](../.codex/scratch/restore-official-components-20261024/browser/after-buttons-1440.png) |
| 文件名 | [前](../.codex/scratch/restore-official-components-20261024/browser/before-file-320.png)／[后](../.codex/scratch/restore-official-components-20261024/browser/after-file-320.png) | [前](../.codex/scratch/restore-official-components-20261024/browser/before-file-390.png)／[后](../.codex/scratch/restore-official-components-20261024/browser/after-file-390.png) | [前](../.codex/scratch/restore-official-components-20261024/browser/before-file-1440.png)／[后](../.codex/scratch/restore-official-components-20261024/browser/after-file-1440.png) |
| 来源列表 | [前](../.codex/scratch/restore-official-components-20261024/browser/before-sources-320.png)／[后](../.codex/scratch/restore-official-components-20261024/browser/after-sources-320.png) | [前](../.codex/scratch/restore-official-components-20261024/browser/before-sources-390.png)／[后](../.codex/scratch/restore-official-components-20261024/browser/after-sources-390.png) | [前](../.codex/scratch/restore-official-components-20261024/browser/before-sources-1440.png)／[后](../.codex/scratch/restore-official-components-20261024/browser/after-sources-1440.png) |
| 待发送队列 | [前](../.codex/scratch/restore-official-components-20261024/browser/before-queue-320.png)／[后](../.codex/scratch/restore-official-components-20261024/browser/after-queue-320.png) | [前](../.codex/scratch/restore-official-components-20261024/browser/before-queue-390.png)／[后](../.codex/scratch/restore-official-components-20261024/browser/after-queue-390.png) | [前](../.codex/scratch/restore-official-components-20261024/browser/before-queue-1440.png)／[后](../.codex/scratch/restore-official-components-20261024/browser/after-queue-1440.png) |

## 复核与回退

临时证据仅在 `.codex/scratch/restore-official-components-20261024/`：`plan.md`、`before-source/`、`before-web/`、`after-web/`、`verification.json`、`source-identities.json`、`build-sizes.json`、各测试日志／结果与截图。`shared-diff-since-start.patch`是共享dirty工作区的前后审阅材料，其中task-status外部布局的同期精简属于并行任务，不能整份应用或回退。此任务只撤销其额外尺寸两处规则。

回退须逐hunk恢复五项owner，保留并行修改；不要整体覆盖homer-app、task-status、DESIGN或package-lock。无需数据库或浏览器存储迁移。本地源码及隔离验证完成，不表示正在运行的安装版已采用。
