# UI 统一代码审查与分批提交

2026-10-24；起始主目录 `main`，HEAD `4713450961bdf262d557c91dc3928f6dbac1f40c`，暂存区为空。范围为已批准的七项 UI 改动；保留共享工作区其他未提交内容。未发布、推送、安装、重启或修改生产数据。

## 本次可独立提交的范围

以准确 HEAD 导出独立候选，而非提交混合工作区整文件：

- 已跟踪的 CodeHeader 恢复50%边框／底色、24px复制及已有官方 Tooltip，保留原复制 Promise、防重入、流式身份和错误回执。
- 已有 Attachment、ApprovalCard、MessageActions、Quote、Sources、Image／File及历史 TaskCard撤销额外尺寸覆盖，保留焦点、禁用、业务校验和附件56px方块；两处 FileName恢复官方省略并保留完整title。
- 原工作状态 owner仅移除常驻刷新栏；总览真实失败就地重试，读取中／断线禁用，自动读取及详情收起重开保持。`ui/task-status-data.ts` 不变。
- 相应现行浏览器回归、DESIGN和vendor来源说明。`homer-app.tsx` 此批只提交一处 FileName属性变化；`task-status.tsx/css` 只提交上述刷新／尺寸变化，不混入后续常驻摘要实现。

助手气泡已在起始 HEAD提交，本轮不重复提交。Sources最终单组列表在 HEAD已有相同实现，不人为制造差异。队列仍在此批 HEAD中使用 dnd，因此此批不删除其依赖声明或锁定包。

## 审查发现与处理

未发现需要在此独立候选内新增运行逻辑修复的缺陷。组件复用、读取owner、取消／URL释放、复制迟到回执、渲染稳定身份与消费者边界已核对；没有为“优化”增加缓存、轮询、订阅或影子状态。

纠正旧状态回归中与本次批准要求冲突的44px宿主下限断言，继续验证焦点；审批结果描述从44px改为实际核验的32px。没有放宽身份、接收、权限或安全断言。另两份仅供联合审查的历史脚本副本，分别更新已批准的微信→工作状态→预览Tab顺序，以及等待合成HTTP收件完成；旧失败与副本均留在证据目录，不改产品逻辑。

## 独立候选验证

UI和服务端源码类型检查、隔离Vite构建通过。五组已有源CSS按候选自身原生成器 `--check`通过。19项固定来源／状态合同通过。

真实Chrome三屏320／390／1440px：代码复制51项、附件51项、Image／File48项、消息复制引用48项、Sources45项、审批33项通过。包含流式复制迟到隔离、上传／移除、触屏tooltip、长文件名、准确下载、官方尺寸和键盘焦点。新代码复制24px要求在准确 HEAD构建上先失败，候选通过。

状态七组通过：统一层级107项、迟到响应9项、缓存2项、断线恢复11项、呈现21项、刷新栏18项及大列表检查。2,000条合成任务首批20个事项、下一批40个，收起无进展请求；50次通知合并为1次总览读取，虚拟时钟空闲10秒新增总览／进展请求均为0。首批打开到帧260ms为本机单次受控观察，不代表设备性能保证。

全仓 `tsconfig.check.json` 在准确起始 HEAD与候选均为137条错误，归一化目录后逐字一致，包含旧memory接口／模块、连接测试与时间测试。不能沿用混合工作区此前的“12条”记录，也不能声称全仓检查通过。

相同构建方式：准确HEAD JS 2,544,864字节、CSS 343,646字节；候选JS 2,545,006字节、CSS 341,126字节。未新增依赖，原大chunk警告仍在；这些数字不证明运行延迟改善。

## 剩余提交边界

其余最终行为已做联合源码审查，但不能把共享文件整体当作本轮授权增量：

| 剩余部分 | 准确HEAD缺少的前置实现 |
| --- | --- |
| 最右预览、Canvas删操作、标题省略、常驻摘要 | HEAD的Canvas仍为原生dialog；官方 `canvas-split.tsx/css/source.css`、`web-preview.tsx`未跟踪，可调分栏依赖及相关布局未提交。当前Canvas同时依赖批注模块，不能直接提交整文件。 |
| 当前Canvas与Composer连接 | `src/preview-reference.ts`、`src/user-intent.ts`、`ui/preview-reference.tsx`、`ui/preview-selection.ts`、图片／网页批注及生成资源，还有后端引用合同均超出本轮整批提交授权。 |
| 队列去编辑／拖拽及旧草稿恢复 | `queue-draft-recovery.tsx`已使用上述未提交引用合同；MainComposer又与未提交的答题／批注owner交叠，不能整体提交，也不能删去这些功能拼快照。 |
| 问答／Canvas官方尺寸恢复 | 所消费官方组件本身未在HEAD；须先明确其前置实现归属，再连同生成器和精确锁文件增量验证。 |

下一批需明确：是否把上述最小前置实现纳入独立审查／提交范围。此前“保留批注功能”不等于本轮整批批注提交授权。本轮不替用户作此范围决定，不删除现有功能，也不将其他dirty顺便提交。

## 证据与复现

证据根 `.codex/scratch/ui-review-commit-20261024/`：起始index／状态／patch和逐文件前像，`candidate/`与`baseline/`准确导出，`candidate-paths.json`精确白名单，`build-sizes.json`、`missing-head-dependencies.json`及各日志／结果。提交树与实际SHA由最终 `commit-result.json`记录。

候选内运行 `tsc -p ui/tsconfig.json --noEmit`、`tsc -p tsconfig.json --noEmit`；源CSS沿 `scripts/build-run-activity-css.mjs --<组件> --check`。浏览器使用候选内同名测试，`HOMER_COMPONENT_BUILD`／`HOMER_APPROVAL_WEB_DIR`指向证据根 `web-build`，证据路径显式放本任务目录；状态runner使用同根 `web-build`及已有Playwright模块。数据为受控合成HTTP／独立数据库，不调用模型或访问生产。

截图：`code-header/code-header-320.png`、`image-file/official-image-file-1440.png`、`refresh-removal-390-normal.png`。保留全体dirty的联合界面另用 `mixed-web`验证，不能代替准确候选证据；超宽并列截图在 `mixed-pinned/preview-2560-pinned.png`。不得将这些本地验证表述为安装版已采用。

## 完成后的联合验证补充

独立运行代码提交：`a27996e7df5455c6802f0accdac0b48175542036`，准确候选树 `cc30915b42e1619a1d334fa04fcc38e32a13631f`。提交前后工作文件字节一致，原暂存为空，提交后暂存仍为空。以下记录单独补入文档，不扩大运行代码提交范围。

保留所有共享dirty的构建通过UI类型检查；合成Chrome验证：助手气泡6组明暗界面84项、最右预览三屏36项、常驻摘要／数据／重连50项、Canvas102项、批注24项、批注边界34项、五项恢复与队列57项。最后一组含原序、合法取消、Worker无取消、丢失回执锁、重载不重发、旧编辑稿原字节／普通引用／附件保留及84条跨页全量可达；另8项统一队列来源／领取／ACK合同通过。

Sources预览按钮已按要求删除，通用网页Canvas分支用独立组件夹具保留验证：sandbox、官方重新加载、新标签安全参数、28px关闭及关闭行为，三屏共15项。没有恢复被删除入口。新增夹具只在本任务scratch；旧完整批注脚本对已删除入口的等待已换为验证官方外链。`tests/official-canvas.browser.mjs`的44px旧断言更新为28px。这两份本来未跟踪且依赖批注前置的测试，保存前像后最小修改，继续留为未提交，不冒充已纳入独立代码提交。

联合队列夹具首次因证据目录过深触发 `interaction_socket_path_too_long`，只缩短本任务内合成目录后重跑。随后旧脚本等待瞬时“修改结果待核对”时，原自动回执核对已显示“尚未查到该操作的提交记录”；本任务副本接受这两种既有未知提示，继续检查准确锁／操作身份／无重发，最终通过。产品逻辑和超时限制均未改。

最终联合结果见 `mixed-bubble/browser/results.json`、`mixed-preview/browser/results.json`、`mixed-pinned/browser-results.json`、`mixed-canvas/`、`mixed-annotations/`、`mixed-annotation-edge/`、`mixed-components/browser/results.json`、`web-preview-harness-browser/results.json`和对应日志。失败日志与最终重跑日志保留，不能将旧脚本失败计为通过。所有补充验证均是本地合成检查，未发布。
