# 文本与图片共用备注表单

2026-10-25，任务 `7e2e7b4d-71d2-4a94-ac9d-f46d725ceed3`。下文记录当时的提取与验收；后续草稿组合行为以 `2026-10-25-annotation-composer-sync.md` 为准。没有提交、安装或发布。

后续任务 `2682b6ca-8350-4891-a9ae-20e1c78ae930` 按用户授权将共享表单改为 Enter 保存、Shift+Enter 换行，覆盖提取时的 Enter 换行约定。Ctrl／Meta／Alt+Enter 与固定 Agentation 原生一致，走原 form submit 和原 owner 校验；点击保存、中文 IME／229 保护、busy 和失败保留输入不变。仅本地 textarea 的 title／aria-description 提示，不改 CSS／消费者／Agentation vendor。维护回归为 `tests/annotation-enter-save.browser.mjs`，任务证据与报告位于 `.codex/scratch/annotation-enter-save-20261025/`；源码不表示安装版 build62 已采用。

## 本项实施

- 新增 `ui/annotation-comment-form.tsx/.css`。纯受控标题、可选完整摘录、两行输入、错误、删除／取消／保存；使用标准 textarea ref 和 useId 关联 label／error，无文件、source、坐标、Map、Composer 或全局监听。
- 文本及图片消费者接入同一 React 表单。原文本 Map／Range／Base UI Portal 和原图片 Annotorious store／事务／定位在本项提取候选中保持；文本已存条目传原删除动作，新建不提供删除。
- 共用已批准的图片深色适配：280px border-box、16px圆角、12px 16px内距、8px输入圆角；窄屏输入16px。标题／placeholder提高可读性，蓝色保存按钮用深色文字以满足小字对比度。摘录最高80px内部滚动，实际引用不截断。极窄宽度操作区可换行。
- 输入超过16000字保留原值，显示错误且禁保存，不使用 maxLength 截断粘贴。原owner继续做总量／条数／几何校验。提取时为 Enter 换行，当前键盘合同见上方后续任务；组合输入期间拒绝提交，并阻止候选Enter／Escape传播至外层关闭逻辑。busy禁用输入和全部动作，失败保留编辑。
- 原 `canvas-panel.css` 中迁走的文本表单样式、`image-annotation.css` 中迁走的图片表单样式删除。保留原生定位壳，不修改 Agentation vendor、HTML原生英文／Enter语义、依赖、后端或协议。
- `ui/DESIGN.md` 和 vendor README 仅追加本项说明并保存即时前像。Agentation 3.1.2 / Annotorious 3.9.5、Benji Taylor 版权、PolyForm Shield来源和既有notices保持。

## 本项验证事实

证据根：`.codex/scratch/annotation-comment-form-unification-20261025/`，所有图片均为本地合成数据，未外传。

| 检查 | 实际结果与范围 |
| --- | --- |
| 原有文本／图片浏览器基线 | `before-text/`、`before-image/` 三屏通过；使用任务隔离HTTP、临时Chrome，无生产账号或模型 |
| 行为红绿 | `red-text.log` 重现组合期间误提交；`red-image.log` 重现16001字粘贴被截为16000；提取候选随后通过相同新增输入保护 |
| 文本生命周期 | `text-final-v2/browser-results.json` 三屏通过，含未保存内容保留、保存／编辑／删除／重开、独立来源、长内容、迟到旧节点、原草稿／附件／请求身份、无自动发送；此结果早于并行owner重写 |
| 图片生命周期 | `after-image-v2/browser-results.json` 三屏通过，含保存／编辑／取消／删除、原生手柄保存、独立来源／hash、上传失败／迟到／关闭／thread栅栏和无自动发送；此结果早于并行owner重写 |
| 展示／交互 | `presentation-final/results.json`：24项检查、72组测量；1440／390／320及各自200%等效缩放，长标题／完整长摘录／长错误、文本滚动边缘／图片四角、Tab／focus-visible、删除插槽、按钮完整可点击、零全局横滚均通过 |
| 200%准确含义 | Chrome默认缩放偏好在headless模式实际DPR仍为1，早期 `presentation/` 不能作为缩放证据。最终明确使用半CSS视口、DPR=2，并断言真实DPR；不是实体手机或原生浏览器菜单缩放 |
| 超窄操作区 | 200%等效缩放曾重现已存条目的删除按钮挤出表单；增加局部 flex-wrap 后，最终上述三屏／缩放矩阵通过 |
| 可访问性／busy | `form-tests-final.log` 2项通过：busy禁用并屏蔽取消／删除、标准ref、不同实例label／error身份与可选删除。真实文本三屏输入检查还核验label/error、title／placeholder／按钮文字≥4.5:1、焦点≥3:1；图片相同CSS至少1440输入检查通过 |
| 相关现有测试 | `related-tests.log`：`preview-reference.test.ts`、`agentation-preview-patch.test.mjs`、`html-preview.test.ts` 共15项通过，覆盖20条／16000／48000数据边界与固定vendor／安全预览 |
| UI类型 | `tsc -p ui/tsconfig.json --pretty false` 提取前后均0诊断，`types-before.log`、`types-after.log`。不将既有其他报告的12条dirty／137条committed诊断当作本次UI检查结果；未跑整仓类型／构建／测试 |
| 样式／隔离构建 | quote／image-file／canvas-split `--check`通过；Vite隔离构建通过，保留既有大chunk提示。`build-current-inputs.json`记录最后一次当前源码构建的输入哈希，构建期间无变化；该构建不代表并行新owner交互已验收 |

截图：

| 宽度 | 文本共享表单 | 图片共享表单 |
| --- | --- | --- |
| 1440 | [PNG](../.codex/scratch/annotation-comment-form-unification-20261025/text-final-v2/editor-1440.png) | [PNG](../.codex/scratch/annotation-comment-form-unification-20261025/after-image-v2/edit-region-1440.png) |
| 390 | [PNG](../.codex/scratch/annotation-comment-form-unification-20261025/text-final-v2/editor-390.png) | [PNG](../.codex/scratch/annotation-comment-form-unification-20261025/after-image-v2/edit-region-390.png) |
| 320 | [PNG](../.codex/scratch/annotation-comment-form-unification-20261025/text-final-v2/editor-320.png) | [PNG](../.codex/scratch/annotation-comment-form-unification-20261025/after-image-v2/edit-region-320.png) |

## 并行冲突与尚未验证

在最终复核期间，另一任务把 `src/web-homer.ts` 的 conversationView 从2改为3，并重写 `ui/preview-selection-toolbar.tsx`、`ui/image-annotation.tsx` 及其调用方，接入 annotation-draft／保存同步主草稿等第4项行为。文本原 `draft.editor` Map／统一导入的批准边界已不再是当前源码行为。共享表单入口仍被两者使用，但当前差异不能全部归本项。

本项没有覆盖或撤销上述改动，也不修改新协议／状态owner来让旧测试通过。旧构建被当前协议栅栏正常拒绝为“对话显示合同已更新，请保存草稿后使用刷新界面”；因此后续尝试未进入批注界面，不能冒充表单回归失败或通过。重新构建当前源码成功，但按原任务边界停止对新交互做实施／验收。临时view2合成夹具尝试仍未建立有效联验，其结果不计入通过项。

以下必须由CTO在两个owner稳定后安排最终联验：新旧任务组合下的保存／删除／busy／迟到结果与草稿政策；拖到真实250px预览面板的额外检查；明确拖动已存几何后取消、逐坐标回滚的强化检查。后者的试验指针操作未建立稳定的“确实改变几何”前置条件，已从维护测试撤回，不能声称完成。原提取保留了取消快照代码，原生手柄保存及备注取消已有通过记录。实体手机、虚拟键盘、真实端侧IME候选、浏览器菜单200%缩放和辅助技术均未验证；没有声称已测监听器计数，只确认共享组件未增加全局监听。

## 审阅与回退

开始及交付核对 HEAD 均为 `a6040cc62fb2e76ece3fb62b138b31ab9da516c8`，index逐字节一致。本项未操作build58或App。保留全部原dirty及后续并行改动。

`before/` 为准确前像；`before-doc-update/` 为文档追加前的即时副本。`own-review/` 和 `own-extraction.patch` 从前像重建本项独立提取，排除后续第4项及HTML入口改动；它们是审阅材料，**不可直接向当前已重写的owner自动应用或反向应用**。当前完整git diff含其他任务，不应整文件回退。回退应逐hunk只撤本项共享表单／消费适配和迁移CSS；新owner已依赖共享表单时，先由CTO协调依赖，不删除其他任务状态或数据。无持久数据迁移。

重测命令与任务证据环境：

```sh
node --test tests/annotation-comment-form.test.mjs
node --import tsx --test tests/preview-reference.test.ts tests/agentation-preview-patch.test.mjs tests/html-preview.test.ts
node node_modules/typescript/bin/tsc -p ui/tsconfig.json --pretty false
node scripts/build-run-activity-css.mjs --quote --check
node scripts/build-run-activity-css.mjs --image-file --check
node scripts/build-run-activity-css.mjs --canvas-split --check
# 浏览器必须使用与当前合成bridge合同匹配的隔离UI构建。
# 设置 HOMER_SYNTHETIC_ROOT、HOMER_REVIEW_EVIDENCE_ROOT、HISTORY_FOLLOWUP_BUILD
# 为本任务scratch内不同目录，再运行相应 *.browser.mjs。
```
