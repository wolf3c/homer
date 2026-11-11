# 历史引用跳转与消息引用入口

2026-10-28，Asia/Shanghai。维护源码与合成验收；本记录随引用功能源码提交。未安装、未部署、未更新或重启运行中的 Homer，未访问运行数据库或调用真实模型。

## 范围与行为

- 历史灰色摘录直接点击或 Enter 跳到准确来源消息；消息 ID、原生条目 ID 不显示在正文、按钮标题或可访问名称中，内部引用 payload 保留。用户消息、查看原请求及旧草稿恢复复用同一 QuoteSource。
- 复用现有 locateMessage、历史 around 分页、readEpoch、DOM 提交判断与 claimPosition，不按文字相似查找。精确选区继续由原 locateSourceQuote 校验哈希、偏移、上下文与 itemIds；重复句只定位记录的那一次。
- 旧引用没有选区时仍能跳消息；选区无法核对、消息缺失或读取失败时给出原有历史/定位提示，保留摘录、批注和主草稿。选文复制不会激活摘录链接。
- 连续引用定位、迟到哈希、迟到历史请求、较新导航与读者手势沿统一位置所有权；只有最新分页读取能结束其 busy 状态。
- 复制旁恢复原 MessageActions 的引用按钮，沿 appendQuote 追加，不回滚既有多条引用、文件批注共存或可信来源改造。可引用正文使用原 sourceQuote/previewQuoteText，保留准确来源及现有 16000 字符前段与预算校验；保留复制成功、失败、重入和流式复制行为。
- canQuoteMessage 统一承担已有“先保存或取消引用评论”的拒绝逻辑，避免新入口清理仍在编辑的选区。

当前用户要求覆盖提交 43c799f 中旧“仅复制”决定，只恢复相应接线；没有回滚该提交的其他文件。Popover 精简、主输入框引用摘要是独立事项，本次未实施；开始时已有 message-quote-editor class 及其他脏改动保留。引用与共享滚动文件的写入按任务完成状态串行处理；独立滚动提交 dadcdf5 完成后核对组合日志，再以其组合构建复跑消息动作浏览器检查。滚动提交不包含引用代码。

## 提交前审查与独立候选验证

用户随后授权代码审查、提交和合入 main。以当前 main 的 e9ac3f2 为基线，仅应用本项差异块构建独立候选，排除原有 message-quote-editor class、其他 DESIGN.md 段落及全部无关脏改动。当前工作分支已是 main，无需额外分支或合并提交；本项提交仅包含引用功能、对应测试和这份说明。

独立审查没有发现已确认的产品代码缺陷，发现并修正一处测试假阳性：reader-scroll 的延迟定位夹具未绑定 locateSourceQuote，异常被正常降级路径捕获，旧断言未实际等待定位。强化测试后先得到两项 0 !== 1 的失败，再补齐接线；现验证真实定位调用、后续手势取消且不写入选区，以及有效定位恢复准确 Range 并滚动。独立复审通过。

最终使用 Node 22.22.0 在独立候选运行：main-composer、quote-navigation-ui、reader-scroll、message-quote、HistoryWindow 共 91/91 通过；动作浏览器 51/51、导航浏览器 36/36 通过，覆盖 1440/390/320 宽度。UI 类型检查 exit 0；预览运行时及 Vite 构建通过，保留既有超过 500 kB 的大包体提示。初次独立候选缺少 node_modules 链接及预览生成文件，导致夹具缺文件与构建失败；复用现有依赖并执行原 build-preview-annotation 前置步骤后重跑通过，没有安装依赖或修改产品以绕过失败。

性能审查确认没有新增依赖、轮询、后台扫描或引用文本预处理；正文解析在引用动作时执行，哈希和选区遍历只在定位时执行，历史读取复用现有 around API。引用组件去掉原逐条状态、ref 和 effect，继续使用现有消息缓存与阅读位置 owner。本次未做性能基准测试，不将功能验收推断为吞吐量或真实长历史耗时结论。

本轮可复核证据在 `.codex/scratch/quote-review-20261028/`：基线、仅本项补丁、独立候选、修正测试的红绿日志、91 项测试、类型/构建日志、两组浏览器 results.json 和截图。历史实现阶段的验证记录保留如下。

## 验证

全部输入为内存合成数据，使用本项目已有隔离 Chrome/CDP 流程、本地 HTTP/SSE fixture 和现有依赖，没有安装依赖。Browser skill 未提供；额外尝试的内置浏览器清单读取超时，未用于验收。

| 检查 | 结果 |
| --- | --- |
| 新组件回归旧实现 | 3 项按预期失败，修复后通过 |
| 未保存引用评论的 canQuote 守卫 | 旧路径实际失败，修复后通过 |
| 本项候选 main-composer / quote-navigation-ui / reader-scroll / message-quote（滚动合入前） | 79/79 通过 |
| dadcdf5 组合 reader + HistoryWindow；引用 UI/来源合同（核对独立对话实际日志） | 57/57；15/15 通过 |
| 最终组合 message-actions.browser，1440/390/320 | 51/51 通过，含 console.warn/error 采集 |
| quote-navigation.browser，1440/390/320 | 本项候选 36/36；dadcdf5 组合联验 36/36 通过 |
| UI TypeScript 检查 | 通过，进程 exit 0、无诊断；组合对话记录亦通过 |
| 最终 Vite 隔离构建 | 通过，保留原大包体提示 |

导航浏览器检查涵盖页面身份、非空界面、无框架错误覆盖层、无运行异常、截图、真实点击与键盘操作；同文消息身份、重复句第二次出现、复制选区、无位置旧引用、哈希漂移、缺失来源、历史加载、逆序哈希和迟到历史响应均有状态断言。动作浏览器检查涵盖官方几何、复制失败/重入/成功、主草稿和焦点、多条追加/移除、刷新恢复、准确发送 payload、流式复制及截断提示。

早期动作浏览器检查有两处测试前提失败：Lexical 空编辑器 innerText 为换行而非空字符串；当前阅读页受保护时新流式页需要明确回到最新。已据真实 UI 状态修正夹具断言/操作，未为此修改产品行为。期间机器 I/O/调度延迟还导致一次 Chrome CDP 连接超时；该次不计通过，最终组合动作浏览器完成 51 项，退出码 0。未跑全库测试，不声称生产或已安装 App 验收；实体移动设备、真实历史服务与 Electron 安装版未测。

## 可复现检查与证据

```sh
node --import tsx --test tests/main-composer.test.mjs tests/quote-navigation-ui.test.mjs tests/reader-scroll.test.mjs tests/message-quote.test.ts
node node_modules/typescript/bin/tsc -p ui/tsconfig.json --noEmit
node node_modules/vite/bin/vite.js build ui --config ui/vite.config.ts --configLoader runner --outDir "$PWD/.codex/scratch/quote-navigation-20261028/candidate-web"
HOMER_COMPONENT_BUILD=.codex/scratch/quote-navigation-20261028/candidate-web HOMER_BROWSER_EVIDENCE=.codex/scratch/quote-navigation-20261028/actions-browser node tests/message-actions.browser.mjs
HOMER_COMPONENT_BUILD=.codex/scratch/quote-navigation-20261028/candidate-web node tests/quote-navigation.browser.mjs
```

本次实际使用 Node 22.22.0。临时证据保留在 `.codex/scratch/quote-navigation-20261028/`：文件前像、红绿回归、构建及类型日志、浏览器 results.json 与三种宽度截图；最终动作证据为 combined-actions/。最终组合构建与导航 36 项复验在 `.codex/scratch/scroll-integration-20261028/web/`、`quote-browser/`，对应维护记录为 `docs/2026-10-28-reader-scroll-cue.md`。收尾源码哈希保存在本项 source-identities.sha256。产品源码、维护测试和本说明为可审源；截图/构建输出不是发布采用证明。

只回退本次源码块及对应测试/说明；不要整文件恢复共享 homer-app.tsx 或 DESIGN.md。
