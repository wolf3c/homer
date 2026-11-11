# Working / Worked 缺详情内部调用阅读候选（2026-10-22）

已完成界面实现、隔离候选、实际 Chrome 验收与前后截图。本次没有上线、提交 Git、创建分支/worktree、修改宿主数据库或联系其他任务。环境登记路径、实际目录及 Git 根均为 `/Users/wolf3c/Project/homer`。

## 实际变化和规则

原来展开 Worked 后，24次旧调用会逐条显示“检查资料／核对成果”“调用已返回”和重复缺失说明。现在同一过程在首个符合条件的位置保留一次说明和“查看原调用记录”，不再默认铺开24行。

紧凑呈现的条件全部来自现有字段：`kind=tool`、`category=host`、没有 `activity`、`status=completed`。`host` 在 `MainProcessHistory.tool()` 中由内部业务进展 owner 明确提供，原生工具不进入该分支。不根据时间、文字相似度或同名判断历史；已返回但缺少公开事实的新内部调用也采用相同保守呈现，不编造详情。

| 场景 | 默认阅读 |
| --- | --- |
| 全部符合紧凑条件 | 一条数量/缺失说明，一个已有 reader 的入口 |
| 全部有公开事实 | 原具体动作、公开对象、回执结果及“查看活动”，无缺失占位 |
| 同一 Run 混合新旧 | 具体条目保持相对原顺序；一次说明位于首个缺详情调用的位置；原记录阅读包括该过程全部已读取工具项，以便核对交错顺序 |
| running / failed / declined / interrupted / unknown / blocked | 各自保留原行和真实状态；异常汇总仍在官方折叠区外 |
| 原生类别或缺少 category | 保守保留原行 |
| 同名、不同调用 ID | 各自计数、各自记录，不按名称去重 |
| 同 ID 后续 revision | 沿已有投影更新；获得公开事实后显示具体活动；原记录弹窗同步读取当前已加载投影 |
| 历史尚未展开 | 继续只读原轻量页头；展开才沿原 history/process 懒读 |
| Worker 事件/旧快照 | 原不可变卡片、位置、正文及缺失说明保持，不当作工具行收起 |

原调用记录弹窗只呈现原安全标签、调用状态、原过程顺序号。没有原始参数、工具输出、模型摘要、新后端接口或批量补写。调用返回不代表检查通过、验收成功或正式交付。原始 ID、revision、seq、计数、计时、分页、正式答复和成果归属没有改变。

## 官方组件和 Homer 适配边界

`ui/vendor/assistant-ui/run-activity.tsx`、`run-activity.css`、README 与 LICENSE 均未修改。仍是官方一个 disclosure、一个活动列表，保留14px字体/图标、12px间距、6px trigger gap、1px列表线、14px列表内距和200ms展开动画。没有 Tool Timeline、第二层工具折叠、过程树或新托盘。

产品改动集中在 `ui/process-nodes.tsx`：筛选符合条件的默认行，提供一个普通列表条目，复用已有 `ActivityReader` 和44px阅读按钮样式。没有新增产品组件、CSS、Context、数据 owner、依赖或请求。原弹窗增加已读取调用列表模式；单项活动的准确身份读取、取消请求和任务/Canvas/原答复导航继续复用。

验证补出了一个边界修正：弹窗打开期间，如果更新移除了原阅读入口，关闭会返回同一 Run 的官方展开按钮；原入口处于已收起的 inert 面板内时同样使用这个返回位置。若更新暂时移除了已读详情，弹窗明确提示关闭后重新展开核对，不留空白列表冒充已无记录。

## 准确改动范围

| 文件 | 本次增量 |
| --- | --- |
| `ui/process-nodes.tsx` | 默认阅读筛选、既有 reader 的原记录模式、返回焦点 |
| `ui/DESIGN.md` | 仅增加本次缺详情调用规则；保留已有其他设计更新 |
| `tests/legacy-activity-reading-ui.test.mjs` | 三项新增行为回归：全旧、混合/异常/原生/同ID更新、历史懒读 |
| `tests/legacy-activity-reading-browser-fixture.mjs` | 复用现有内存合成 owner；事件经原 Worker owner 保存；没有生产数据 |
| `tests/legacy-activity-reading.browser.mjs` | 三种宽度的新规则、顺序、身份、状态、动态更新、返回焦点及截图 |
| `tests/process-reading.test.mjs` | 仅更新一个直接要求全部旧行展开的旧用例；保留原计数、投影和异常断言 |
| `tests/process-reading.browser.mjs`、`tests/run-activity-facts.browser.mjs`、`tests/run-activity-style.browser.mjs` | 仅将旧行的读取改为本次已有阅读入口，继续验证准确身份、官方样式、其他活动和导航 |
| `scripts/preview-legacy-activity-reading.mjs` | 当时的隔离预览入口，已退役 |
| 本文与 `docs/patches/2026-10-22-legacy-activity-reading-*` | 交付、准确补丁、身份与验证索引 |

上述已有文件以任务开始时的实际字节保存前像，而非使用 Git HEAD；原本未跟踪的已有浏览器脚本也以其实际前像计算增量，未冒充本次整文件新增。每次共享文件修改前核对前像；没有恢复整个共享文件、清理其他任务或暂存文件。

固定候选过程中观察到另一任务后来加入页头/任务面板改动（`ui/homer-app.tsx`、`ui/task-overview.tsx`、`ui/package.json`）。它们没有被本任务写入或回退。仅在临时候选源码中采用之前已验收的这三份页面基线，避免把另一任务的新界面一并作为本候选交付；排除记录在 `candidate-parallel-exclusions.json`。维护工作区继续保留其变化，本候选不宣称验收这些后续并行改动。

## 验证结果

所有业务夹具使用内存数据库、scratch合成文件和禁止执行的 fake engine；浏览器使用独立无账号 Chrome profile，非本地请求拦截。真实模型、发送、停止计数均为0，没有访问4780、生产数据库、真实聊天、凭据、上传、发布或权限配置。

| 检查 | 结果 |
| --- | --- |
| 实施前新增行为用例 | 三项均在预期路径失败：旧调用仍逐条铺开 |
| 最终定向行为回归（六个文件） | 34/34通过 |
| UI类型检查 | 通过；固定候选源码另行通过 |
| Vite生产构建 | 通过，输出仅在本任务scratch；原有大chunk提示仍在 |
| 固定源码重建与已验收bundle对照 | 全部69个构建文件逐字节一致 |
| 新过程阅读浏览器 | 320/390/1440px，30项检查通过 |
| 已有公开活动浏览器 | 三种宽度，36项检查通过 |
| 已有过程阅读浏览器 | 三种宽度，24项检查通过 |
| 官方样式/动画/reduced-motion | 三种宽度通过 |
| 官方收起期间焦点与重开 | 三种宽度通过 |
| 前后截图 | 相同合成场景、相同视口，展开动画完成后采样 |
| 增量审阅 | 只修改本次展示范围；没有vendor或后端产品源码改动 |

新增场景覆盖全旧、全详情、交错混合、同名不同ID、全部异常状态、运行中新增/同ID更新、折叠计数、历史懒读、原记录/具体详情返回焦点及入口消失后的返回位置。既有浏览器继续验证原任务版本、Canvas、原交付定位、待答在区外、迟到响应和连接变化。实际阅读过320px紧凑过程、390px原记录弹窗及1440px混合过程截图，没有页面横向溢出。

本次出现的验证失败均已区分并处理：旧用例的8行展开要求与新授权规则直接冲突，改为核对按需读取原8项；新增夹具最初未通过事件owner记录Worker快照，已修正夹具；焦点返回先等下一帧再断言，且额外复现并修正了入口消失时无法回焦的产品边界。没有通过删除异常断言或修改后端状态来通过检查。

本次只改UI展示，未运行全仓测试、生产验收或独立发布流程；这些不在本候选通过结论内。

## 历史预览与重建

本节原有的固定候选预览及重建命令已退役：后续产品决定移除了活动详情阅读器，旧预览入口已删除。当时的截图、候选与验收仅作为历史证据；当前旧记录展示的浏览器回归仍使用 `tests/legacy-activity-reading.browser.mjs` 和其夹具。

## 截图与证据

[自包含前后截图HTML](../.codex/scratch/legacy-activity-reading-20261022/comparison.html) 无外部资源或网络请求，手机可查看；它是实际截图对照，不代替交互候选。

| 状态 | 320px | 390px | 1440px |
| --- | --- | --- | --- |
| 调整前全旧展开 | [图](../.codex/scratch/legacy-activity-reading-20261022/browser-before/all-old-expanded-320.png) | [图](../.codex/scratch/legacy-activity-reading-20261022/browser-before/all-old-expanded-390.png) | [图](../.codex/scratch/legacy-activity-reading-20261022/browser-before/all-old-expanded-1440.png) |
| 候选全旧展开 | [图](../.codex/scratch/legacy-activity-reading-20261022/browser-after/all-old-expanded-320.png) | [图](../.codex/scratch/legacy-activity-reading-20261022/browser-after/all-old-expanded-390.png) | [图](../.codex/scratch/legacy-activity-reading-20261022/browser-after/all-old-expanded-1440.png) |
| 原记录弹窗 | [图](../.codex/scratch/legacy-activity-reading-20261022/browser-after/original-records-320.png) | [图](../.codex/scratch/legacy-activity-reading-20261022/browser-after/original-records-390.png) | [图](../.codex/scratch/legacy-activity-reading-20261022/browser-after/original-records-1440.png) |

`unit-final.tap`保存最终行为测试输出；各 `*-browser.json` 保存实际场景检查结果；`ui-types.log`、`fixed-build.log`、`fixed-build-validation.json` 保存固定源码类型/构建结果及bundle身份；`candidate-source-identities.json`保存候选源码hash。准确源码增量见[候选补丁](patches/2026-10-22-legacy-activity-reading-candidate.patch)，文件前后hash及证据索引见[候选绑定](patches/2026-10-22-legacy-activity-reading-bindings.json)。

## 回退

候选没有上线、数据库迁移或持久记录变更。停止demo即可撤下预览。源码回退以本次实际前像和准确补丁为准，先执行 `git apply --reverse --check docs/patches/2026-10-22-legacy-activity-reading-candidate.patch`；遇到后续并行修改应逐hunk核对，不恢复整个文件或HEAD。本次没有执行回退或任何Git提交。
