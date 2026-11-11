# 批注与顶部栏后续审查、验证及提交

2026-10-25，A Enter 保存、B 删除重复预览标题行、C 统一引用／批注图标、D 紧凑顶部栏均已逐项审查，并完成准确候选验证和本地提交。本轮没有发现需要再改产品运行代码的缺陷；修正了三份相关旧测试的手机尺寸断言、两份来源说明及一处文档末尾空行，并保留图标维护回归。安装版 build62 / `493ead1576ba08e59987f9db96a55ae4843a90b9` 未操作。

## 范围与提交

入场为 main / `493ead1576ba08e59987f9db96a55ae4843a90b9`，暂存区为空。保存原 index、状态和489个已修改／未跟踪路径的内容指纹；已有 `.cindy-worktrees/` 子树的文件内容不纳入本轮指纹范围，未读取或修改其文件。未重复提交前轮的 Worker、表单／主草稿／Tabs 基础或官方 ToolFallback。

D 在本轮读取时已有最终报告、验证和静态指纹。核对其验证记录的全部源码后，只有已声明的 `ui/DESIGN.md` 文档链接不同，产品输入相同，因此纳入“已开发完成”范围。随后仍用精确提交候选重新验证。没有控制、停止或向其它任务发送消息。

| 功能与边界 | 实际 commit | tree |
| --- | --- | --- |
| A：共享表单8行、原头部布局对应的键盘维护测试、两份键盘说明及 DESIGN 的准确段落；5路径 | `ceefd3e5ed81dbc53b513d6f6ed0839fe231bf57` | `b77e9ad34d34e91bf3942c88e515cb8933b0ea09` |
| C：六个图标消费者／本地适配、准确来源说明和两份维护回归；11路径 | `40e0e9081e071deca02d1ebfb5060f2907bc5662` | `ec3ab10d455de9cdab605caf0296d555ccab7751` |
| B+D：稳定 actions Portal、删除重复 header、同顶边44／52px布局、相关选择器／密度维护和文档；28路径 | `669da73cb0044aa630461958bee47b01f59fcaee` | `85d46497b182c4a0f0aff825530e9e0f6a586629` |

B与D共用标签栏、动作槽和密度合同，一起提交最终组合，避免把旧手机28px说明与已批准44px目标混在中间版本。A和C均在保留原头部的独立候选上通过后提交。本文和 [来源 manifest](patches/2026-10-25-annotation-header-followup-review-sources.json) 随后的文档提交不改运行源码。

每次用临时 index 写入精确内容，核对 tree 后通过 HEAD CAS 更新 main，只刷新所提交路径的 index 条目；未整树 add/reset/checkout，未覆盖共享工作区。来源 manifest 保存每路径的前一 tree 条目、提交 blob、SHA-256、任务补丁身份及验证口径。任务补丁仅作为来源，没有机械 apply/reverse。

## 逐项结论

- **A 正确性与可靠性：** Enter 仅走原 `form.requestSubmit()` 和 `onSubmit/canSave`；空白、busy、超长与累计预算不能绕过，失败保留输入。单次 Enter 只保存一次，Shift+Enter 换行，Ctrl／Meta／Alt沿已批准的原生语义。composition、native isComposing 和229保护保留，候选 Enter／Escape 不穿透父弹层。只写原 annotationDraft，不自动发送或抢主输入焦点。
- **B 所有权与生命周期：** 文件名及完整可访问名称在原 Tab；单文件×与整预览收起语义分开。动作在 List 外稳定 DOM 槽，仍由原 Reader／图片／HTML owner 经 Portal投影。首次ready、lazy图片、取消加载／迟到导入、HTML native Exit、旧 WindowProxy、切换销毁与 resize 不重建均覆盖。无标签名称／退出、活动Tab初焦、来源回焦、手机背景隔离与 Escape分层保留。没有残留消费者 header／close ref／header CSS，固定 Canvas vendor 保持。
- **C 组合与展示：** 所有自有入口为已安装 Lucide MessageCirclePlus；状态仍认原 pressed／busy／tooltip。SelectionToolbar.Root／Quote及捕获处理保留，准确 messageId／文本、清选区、canQuote互斥、Composer聚焦不变。普通引用仍两行，多条／有批注及成果引用按原规则完整展示。固定 `quote.tsx` 字节、Agentation内部、生成CSS及许可未改，无新依赖或图标配置接口。
- **D 布局与可用性：** 原 Group／Panel／Separator、单Dialog／Reader、workspace状态阈值1120px及原owner保持。桌面工具栏44px，手机／粗指针52px，局部动作44px触摸目标、SVG仍14px；原生窗口栏不变。标签独立横滚，250px预览／200px聊天栏及200%等效重排可用。状态显式关闭不会被SSE／resize重开；阅读位置和Composer底边有实际浏览器检查。

没有增加业务实体、第二草稿／原生实例、全局键盘监听、轮询或后端写入，也没有为性能名义扩大重构。

## 本轮修正

1. `official-canvas.browser.mjs`、`html-render-first.browser.mjs`、`restore-official-components.browser.mjs` 原有手机28px断言已过时，按明确批准的桌面28／手机44px合同更新。交互、来源、安全及其余断言保留；对应实际几何由当前布局／接缝回归验证。
2. 预览标题行说明明确：旧49px收益只对应其独立候选，手机尺寸冲突已由后来批准的紧凑方案解决。没有用旧49px断言评判当前52px组合。
3. 图标原临时检查整理为 `tests/unified-reference-icon.browser.mjs`、`tests/unified-reference-icon-history.browser.mjs`，通过环境变量指向准确构建和任务证据目录。原未跟踪的 `tests/artifact-file-list.browser.mjs` 属于其它任务，即使包含关闭选择器维护，也未整份认领或提交。
4. 紧凑顶部栏说明仅去除末尾额外空行。没有修改原native vendor或公共测试helper。

## 观察到的验证结果

证据均在 `.codex/scratch/annotation-header-followup-review-commit-20261025/`；新数据为需求推导的合成输入。使用已安装依赖、随机本地端口、隔离Chrome profile和禁止执行的fake engine，无真实模型、账号、渠道消息或生产数据。

| 准确候选／检查 | 本轮结果 |
| --- | --- |
| A 类型、单元、构建、三屏共享表单／实际文本与图片 | UI和服务tsc退出0；6单元；15浏览器组通过 |
| C 类型、固定quote CSS、构建、三屏交互／历史展示 | 检查退出0；9+3浏览器组通过 |
| 最终B+D组合：UI类型、Canvas生成CSS、定向单元、构建 | 检查退出0；16单元通过，包含A的子集，不重复累计 |
| 最终布局／多标签与原生生命周期 | 18／127组通过，两个runner最终均自然退出0 |
| 最终预览接缝／Enter与IME／受控网页及空态 | 20／15／3组通过 |
| 最终图标交互／历史展示／正式消息复制引用 | 9／3／48组通过 |
| 准确tree、脚本语法、diff、源码与资产 | 全部通过；功能提交tree的831个tracked路径逐字等于准确候选；最终网页全部资产也与D交付的准确构建哈希一致 |

三个宽度为1440／390／320 CSSpx，布局另覆盖2560、801／800／799、250px右栏、200px左栏和粗指针。已实际查看最终1440／320截图。浏览器组是各runner的分组计数，流程存在重叠，不合计成唯一场景总数。

首次A消费者验证因把Vite输出目录误指向其父目录而返回HTTP 500；修正验证路径后同源码全部通过，没有修改产品迎合失败。原A红测的表单前像与本轮HEAD字节一致，可复用其旧Enter不保存的复现。两个runner一度在断言成功后等待收尾，临时诊断只见PipeWrap、无残留定时器，最终均自然退出0；未强行退出冒充通过。

不是整仓全绿声明。前轮确认的13项reader-scroll旧夹具 `useMediaQuery is not defined`、3项无关服务生命周期失败及缺少playwright-core的旧runner没有重跑、删保护或计为通过。相关旧浏览器文件仅维护本次头部选择器和明确密度合同，没有声称全面迁移旧批量导入／旧owner场景。服务源码在三个候选均为同一HEAD输入，A的服务类型检查适用于后续纯UI提交。

## 性能与限制

同一HEAD、已安装依赖、固定本地批注runtime及Vite方式配对构建，按所有JS／CSS资产（含lazy chunks）逐文件合计，Node v26.9.0默认 `gzipSync`：

| 候选 | 原始B | gzip B |
| --- | ---: | ---: |
| 冻结HEAD源码网页基线 | 3,866,875 | 1,090,225 |
| A | 3,867,150 | 1,090,302 |
| A+C | 3,867,157 | 1,090,283 |
| A+C+B+D | 3,868,913 | 1,090,581 |

最终增加2,038 B（约0.053%），gzip增加356 B（约0.033%）；未用单次构建时间代表性能收益。代码与实际实例检查确认一个Reader、稳定Portal／iframe／图片实例，无新增轮询；settled工作状态没有新增读取。保留已有大chunk提示，不扩展打包优化。此为本地合成环境证据，不能外推生产大历史或端侧压力。

实体手机、真实系统IME／虚拟键盘、屏幕阅读器、已安装Electron与生产环境未验证。200%是720 CSSpx／DPR2等效重排。没有安装、重启、push、branch、worktree、tag或部署。

## 保留与回退

入场489路径中只有上述三份测试和三份文档发生本轮明确修正，其余原dirty／未跟踪内容逐字保留。新增两份图标测试和本审查记录属于本轮范围。原index已备份，无关index条目相同，暂存区仍为空；合法提交后的index整体字节自然变化，未误称原index哈希不变。

manifest记录各提交精确来源；scratch另保存tree等价与preservation回执。回退须按各提交hunk结合剩余dirty处理，不能整文件还原共享DESIGN／README／Reader或删除原未跟踪材料。本轮没有持久数据迁移。
