# 网页批注气泡实施方案

**状态**　交互 Demo 已通过用户评审。源码已实施并完成独立审查与隔离验证。

**目标**　普通用户消息把每个网页引用显示为一个只读批注组。来源只显示一次，用户能直接读完每条备注。

**接入点**　沿用 `UserMessage → MediaAttachments → ResourceReferenceBlock`。用一个可选的气泡展示标志进入现有资源引用组件的网页分支，直接渲染现有引用数据。样式落在现有预览引用 CSS 中。

## 当前路径与数据

- [普通消息气泡](../../../ui/homer-app.tsx#L238)先显示消息引用和逐段批注，再经过 `MediaAttachments` 按原顺序展示资源引用、未配对的附件，最后显示用户正文。这个组件也供「查看原请求」调用，队列编辑恢复则直接使用资源引用组件。
- [现有资源引用](../../../ui/preview-reference.tsx#L46)将网页的 `element：comment` 拼成一段交给 `QuoteBlock.Text`，默认最多显示两行。桌面桥接存在时，`source.kind === 'message-file'` 的网页引用还会渲染逐条打开按钮。按钮共用文本批注的路径，图片有自己的独立分支。
- [引用合同](../../../src/preview-reference.ts#L9)中的 `kind: 'web'` 已包含 `source`、有序的 `annotations`，以及浏览器采集时可保存的 `page`。HTML 的 `selectedText` 可出现在草稿侧的原生渲染元数据，正式引用沿用 `element`，它可能是元素文本、标签名或描述。 [HTML 保存](../../../ui/canvas-panel.tsx#L402) · [浏览器保存](../../../ui/browser-preview.tsx#L57)
- [整条消息复制](../../../ui/message-details.tsx#L102)走 `sourceMessageText`，用原消息正文或原回复片段。批注块中的文字可以通过原生选区单独复制。 [用户备注授权文本](../../../src/user-intent.ts#L11)继续取完整 `comment`，[模型来源材料](../../../src/preview-reference.ts#L141)继续取原来源及定位信息。显示回退文字只存在于 DOM。

## 展示规则

| 项目 | 规则 |
| --- | --- |
| 来源 | 优先取 `page.title`，其次取 `source.title`，来源标题由合同保证非空。用已有 `webSourceUrl` 校验，优先从 `page.url` 提取主机名，其次用具备 `url` 的 `source.url`。主机名与标题不同时单独显示。HTML 文件没有可用 HTTP(S) 主机名时只显示标题。 |
| 单条与多条 | 每个既有引用渲染一组。单条显示来源、元素和备注，多条在标题右侧显示「N 条批注」，并按数组顺序编号，用细分隔线分开条目。相同标题或主机名的独立引用各自成组。 |
| 元素与备注 | 元素描述放在当前备注上方，用次要色和短引用线。备注用正文色，按纯文本直接呈现原字符串，用 `white-space: pre-wrap` 保留段落和换行。元素描述、标题和长单词均可换行。 |
| 缺失信息 | 无 `page` 时沿用来源标题和可用域名。无域名省略对应行。现有解析要求标题、元素、备注非空，批注列表至少一条。 |
| 布局 | 窄屏沿用单列。标题和备注区域可收缩换行，单条序号省去，多条序号及条数保持窄列。所有备注随对话滚动，长批次会增加气泡高度。 |
| 操作 | 网页批注块由普通标题、列表和文本组成。来源标题、元素和备注都可选中，Tab 跳过该块。消息引用仍走原消息定位，文件和图片仍走各自入口。 |

## 一次完成展示改动与验收

- [x] **接入普通气泡。** 在 [`ui/homer-app.tsx`](../../../ui/homer-app.tsx#L190) 的 `MediaAttachments` 和 [`ui/preview-reference.tsx`](../../../ui/preview-reference.tsx#L46) 的 `ResourceReferenceBlock` 中透传可选的 `webAnnotationsReadOnly?: boolean`。仅普通主对话和事项对话共用的 `UserMessage` 调用传入。输入框、查看原请求和排队恢复沿用原展示。保留已有 `hideScreenshotDetails` 的独立用途。引用获取沿用 `referencesOf`，引用组键沿用 `referenceKey`，保留历史 `resourceReference` 与新 `resourceReferences` 的既有映射及排列。
- [x] **直接渲染已有数据。** 在 `ResourceReferenceBlock` 内加一个提前返回，条件为标志为真且 `reference.kind === 'web'`。在该分支中直接从 `page` 和 `source` 算标题及主机名，沿用同文件的 `GlobeIcon`、`preview-reference`、`preview-reference-source`，一次遍历 `annotations` 输出语义列表。多条时用列表序号，CSS 负责单条隐藏序号。用现有条目 ID 加序号作为 React key，兼容旧单引用未保证 ID 唯一的情况。用文本节点渲染来源、元素和备注。整条消息复制仍交给原消息操作，引用块内的选择、复制沿用浏览器。其余分支继续使用原渲染。
- [x] **添加局部样式。** 在 [`ui/canvas-panel.css`](../../../ui/canvas-panel.css#L72) 的预览引用样式旁，限定于只读网页块设置浅底、细边框、来源行、条目分隔和次要字色。复用现有字号和颜色变量。标题与条目内容设 `min-width: 0` 和 `overflow-wrap: anywhere`，备注保留换行，随消息列自然增长。无需独立组件、样式文件、依赖、状态、持久字段或接口。
- [x] **复用已有验证入口。** 在 [`tests/browser-preview.electron.test.mjs`](../../../tests/browser-preview.electron.test.mjs#L690) 的本地 HTML 发送用例中，沿用真实 Composer 与输入断言。关闭预览后，改为在已发送的用户气泡断言来源、元素和原备注可见，且批注块内无按钮、链接、展开元素或可聚焦项。发送前从草稿入口重开并核对标记，保留紧邻的本地文本历史定位和图片批注回看断言。在 [消息操作浏览器专项](../../../tests/message-actions.browser.mjs) 中复用其消息夹具补一个实际产品 UI 场景，合成旧单引用及含两个网页引用、普通消息引用、配对图片、文件附件和正文的新集合。在 1440、390、320px 验证来源及批注顺序、长备注的完整文本与换行、无横向滚动、普通引用的跳转和整条消息复制仍取原正文。在旧单引用夹具中覆盖无 `page`、无主机名的有效历史数据。复用待释放的历史分页响应验证长备注气泡的阅读锚点。复用现有浏览器专项与已登记的脚本，无需新增测试文件或运行全量专项。
- [x] **核对最小验收结果。** 运行下列类型和离线检查，随后使用隔离 UI 构建、临时资料目录和已获授权的合成浏览器专项跑上述用例。Electron 测试按文件顶部的 `HOMER_PREVIEW_UI`、`HOMER_PREVIEW_RUNTIME`、`HOMER_PREVIEW_EVIDENCE` 设置显式路径，用下列 Electron 命令定向运行。消息操作浏览器专项用同一候选 UI，设置 `HOMER_COMPONENT_BUILD` 和 `HOMER_BROWSER_EVIDENCE` 后执行下列命令。核对桌面和窄屏截图、断言结果与浏览器正常退出。 [测试边界和构建方式](../../testing.md)

```sh
node_modules/.bin/tsc --noEmit -p ui/tsconfig.json
node --import tsx --test tests/preview-reference.test.ts tests/preview-reference-collections.test.ts
node --import tsx --test --test-name-pattern='real Preview UI, service provenance' tests/browser-preview.electron.test.mjs
node tests/message-actions.browser.mjs
```

合成 Demo 在 1280、390、320px 下验证了四个评审场景。产品候选 Vite 构建和 UI 类型检查通过，引用合同离线回归 30/30，隔离 Chrome 1440、390、320px 共 107 项，覆盖普通引用键盘跳转、Tab 跳过只读列表、文字选区、图片配对、原正文复制和长备注分页锚点。定向 Electron 专项通过，验证本地 HTML 在草稿重开、现有来源授权和合成模型输入下正常发送，气泡只读展示标题、元素和备注，文本与图片仍可在历史重开。独立代码审查反馈已通过上述测试复验。正式安装版及移动真机待验。
