# 图片区域批注：输入研究与产品决策

2026-11-18 的研究以 `e3434e27` 及当时的工作区为基线。消息图片的展示改动已在 `c4511840` 提交。模型输入沿用既有方案，研究未调用真实模型。

## 1. 当前结论与范围

**保留原图与结构化批注；当前不新增默认烧录，也不把编号派生图切换为默认模型输入。** 原图加对应文字/坐标沿既有发送语义；编号框、mask、双图和裁剪保留为实验候选。若烧录不能带来明确可确认的收益，就不实施。

本结论修正本篇 2026-11-17 的“消息预览、放大和默认模型输入共用编号 PNG”建议。此前用户讨论认可该方向，后来要求按实际价值重新判断；历史认可不构成本轮实施授权。本轮只授权更新文档。本文是现行决策入口，替代 outputs 中各轮草案及本篇旧实现建议；旧材料不提供新增授权或效果证明。

需要分开的两项产品决策：

- **用户展示：** 缩略图、放大图、批注正文能否清楚对应，可以先用合成界面人工验收。复用结构化数据画覆盖层也可能满足，不必修改图片字节。
- **模型输入：** 是否减少区域错配、误读和遗漏，需要实际模型对照。用户看得清、客户端实际传图、模型答得准是三种证据，不能互相替代。

## 2. Homer 事实与最小默认

现有结构包含原附件身份与图片区域/备注；Engine 接收普通图片 URL，再构造原生图片输入，没有独立 region-mask 参数。媒体准备得到的规范化基础图可能与 JPEG 等原文件字节不同，“使用原图”不承诺源文件字节原样传给模型。

核对入口：[批注结构](../src/preview-reference.ts)、[发送及媒体授权](../src/service.ts)、[Engine 图片输入](../src/engine.ts)、[媒体准备](../src/media-decode.ts)、[媒体存储](../src/media-store.ts)、[消息展示](../ui/preview-reference.tsx)。这些是源码位置，不是安装或模型验收结论。

默认保留原则：

1. 原文件及精确 `assetId/revision` 身份不变；区域、备注、引用顺序仍是来源。不同修订不混用，多组引用与缺失引用沿现有规则，不新增冲突拒绝。
2. 模型沿既有基础图及对应文字/坐标路径。文字明确图片与区域的对应关系、坐标基底尺寸和左上原点；图片没有标记时不写“图上编号可见”。这是输入表达约定，不宣称本轮已修复所有投影路径。
3. 缩略图显示区域框和编号，批注按相同顺序列出。放大时显示原图，放大图编号待办已关闭。见[消息展示与结案记录](desktop-screenshot-annotation.md#消息中的图片批注2026-11-14)。
4. 不为研究新增资产、数据库字段、`imageView` 包装、派生缓存、分割模型、状态机、模式开关或后台迁移。不预生成历史编号图，不重写旧输入哈希，不补发模型。

编辑坐标必须对应实际基础图。EXIF 方向、透明背景、动画选帧和缩放不能靠编号补救；尤其不能把后续动画帧的选区套给首帧。现有准备与授权失败仍沿原路径处理，不因实验放宽权限或自动改图重试。

## 3. Codex 实际实现：可借鉴，但不是效果对照

### 本机一手证据

本事项 2026-11-18 只读检查 `/Applications/ChatGPT.app/Contents/Resources/app.asar`：包内产品名 Codex，版本 `26.1111.21308`；CLI 清单为 `0.169.0-alpha.11.1`。asar SHA-256：`64782f30d783c24eb483e92f9a2e884ada6d24dc105fc27659ba16e073da145c`。仅检查应用资源，未读用户会话、截图、日志或凭据。

已追通的是**浏览器用户批注**：保存选择锚点、附加选择、视口尺寸、标记位置与正文；主进程要求页面准备当前 comment 的截图；页面画框/编号并在动画帧后报告准备完成；主进程截取已显示标记的页面像素，裁剪/缩小后保存 data URL 与尺寸；发送时把说明文字和图片项一起加入线程。另一条 ChatGPT 会话路径将该截图解码成 `File` 上传。标记因此进入图片字节，不能只当作界面覆盖层。

包内定位（零基 JavaScript 字符串偏移，不是原始源码行号）：

| 包内文件 | 证据入口 |
| --- | --- |
| `.vite/build/browser-page-preload.js` | 约 394700：截图期间显示的框与编号；约 403594：`comment-screenshot-ready` 与动画帧回执 |
| `.vite/build/early-bootstrap-226-2f6bd181558008cf.js` | 约 2439871：`captureBrowserScreenshot`；2440871：准备/等待/截图/保存；2451635：裁剪、缩图和 data URL |
| 同上 | 约 1218700：区域坐标与目标文字；1232575：图片与对应说明加入输入 |
| `webview/assets/async/638132.7b67b5e457.js` | 约 21300：批注截图转文件并上传 |

发送文字还可包含 URL、frame、区域 x/y/width/height、元素 selector/附近文字与附加选择；图片前的说明明确它对应哪条 Comment、框与编号的含义，并将网页内容标为来源证据。**实际采用的是标记像素与文字定位信息互补，不是“只传烧录图”。** 同一 comment 可多选；不同批注的截图不能误说成所有区域始终共用一张图。

本机浏览器截图代码长边上限为普通全图 1280、普通裁剪图 1024、紧凑图 768，条件与多选处理不同。只从包内提取纯函数做合成参数检查：模拟 2400×1200 输入，普通/紧凑路径分别返回 1280×640、768×384；data URL/本地路径分别成为普通 image/localImage。该检查没有生成真实截图、运行桌面闭环或验证模型效果。

### 固定官方源码与边界

对应 CLI tag 固定到提交 [`226fa88979b1a9d76dc36f339ee9c5fbdb2c8e7f`](https://github.com/openai/codex/tree/226fa88979b1a9d76dc36f339ee9c5fbdb2c8e7f)：[线程输入和图片引用转换](https://github.com/openai/codex/blob/226fa88979b1a9d76dc36f339ee9c5fbdb2c8e7f/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L181)接收普通图片；[Core 转换](https://github.com/openai/codex/blob/226fa88979b1a9d76dc36f339ee9c5fbdb2c8e7f/codex-rs/protocol/src/models.rs#L2260)产生 `input_image`，未指定 detail 时默认 high。[本地图片准备](https://github.com/openai/codex/blob/226fa88979b1a9d76dc36f339ee9c5fbdb2c8e7f/codex-rs/protocol/src/models.rs#L2006)普通路径还有 [2048 长边上限](https://github.com/openai/codex/blob/226fa88979b1a9d76dc36f339ee9c5fbdb2c8e7f/codex-rs/utils/image/src/lib.rs#L26)，original 走不同分支；这与 GUI 先缩图不同。

官方[浏览器文档](https://learn.chatgpt.com/docs/browser#styling-feedback)说明批注交互，但不是准确率实验。[Appshots](https://learn.chatgpt.com/docs/appshots)是前台窗口图片加可获得文字的附件入口，不足以证明采用同一批注链路。普通上传、图片查看器评论、图像编辑 markup 尚未全部追通；GUI 未公开原始源码，服务端进一步缩放、视觉编码与注意力不可见。此调查证明本机版本的客户端路径，不证明所有 Codex 输入路径、持续视频传输或最佳准确率。此前只凭 Computer Use 示例推断 Codex 实现的论证不再沿用。

## 4. mask：编辑控制、普通视觉提示与原生区域输入

| 机制 | 本次核实结论 |
| --- | --- |
| OpenAI Images Edit 的 mask | alpha 为零的区域表示待编辑部分，多参考图时作用于第一张；输出编辑图片，不是理解区域的注意力参数。当前 markup 也用于指导编辑 |
| Responses 的 `input_image_mask` | 位于 image_generation 工具配置，用于 inpainting；普通 `input_image` 没有独立区域 mask 字段 |
| Anthropic 普通图片输入 | 公开图片输入及 transformations 未提供独立 ROI-mask 契约，支持 PNG 不等于把 alpha 当关注区域 |
| Gemini、Qwen3-VL 普通视觉入口 | 本次所核文档/示例未见独立 ROI-mask 输入；Gemini 能输出分割 mask，不能据此推断支持原生 mask 输入 |
| DAM、Osprey | 有专门训练的区域编码/提取机制，明确支持 mask 理解；不能通过给通用 API 增加普通图片复现 |

一手来源：[OpenAI 编辑 API](https://developers.openai.com/api/reference/python/resources/images/methods/edit)、[Responses 工具定义](https://github.com/openai/openai-python/blob/main/src/openai/types/responses/tool_param.py)、[普通视觉输入定义](https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_input_image_param.py)、[Anthropic 图片定义](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/types/image_block_param.py)及[变换定义](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/types/image_transformations_param.py)、[Gemini 图像理解](https://ai.google.dev/gemini-api/docs/image-understanding)、[Qwen3-VL 示例](https://github.com/QwenLM/Qwen3-VL#quickstart)。接口核实日期为 2026-11-18，供应商文档与 main 分支可能变化；“未见”限定于所核公开契约。

mask 的几种用法不能混称：

- **原图＋二值 mask 双图：** 保留 RGB，但要求跨图对齐。多个区域并成一个二值集合后丢失逐条身份；用不同颜色/编号区分后仍是普通视觉提示。重叠和嵌套须单测。
- **区域内透明填色：** 改变文字对比度与颜色；区域外压暗可保留目标 RGB，但削弱上下文。两者均非硬性注意力约束。
- **区域外透明/移除：** 不保证普通模型将 alpha 解释为 ROI，还会丢失上下文；若同时发送原图，也没有隔离区域外内容。透明不等于已安全移除隐藏 RGB。
- **原图＋裁剪：** 能给小目标更多有效像素，但增加图片与对应关系；过紧裁剪会丢上下文。mask 本身不会放大小目标。
- **编号空心框单图：** 多区域身份直观，内部遮挡通常少于填色，但标签/边框仍可能遮字、串号或缩小后不可读。优于其他方式是待测假设。

Homer 已有矩形可直接栅格化实验 mask，不需要先接 SAM 做物体分割。DAM 的兼容服务用 alpha 传 ROI 是自定义语义，不是 OpenAI 服务承诺；Osprey 将各区域特征与文字交错输入。接入这些专门模型意味着新增模型、部署和验收，当前不采用；DAM 权重的非商业许可也须在实际选型时重新核对。[DAM 官方实现](https://github.com/NVlabs/describe-anything)、[Osprey 论文](https://arxiv.org/html/2312.10032v4)。

## 5. 公开对照：收益与反例同读

以下数字是指定论文、模型和任务的历史结果，不是当前排行榜或 Homer 预期准确率；每项都不足以单独决定默认输入。

| 一手研究 | 实际对照与数字 | 能推导的边界 |
| --- | --- | --- |
| [SoM v2，2023，Table 3](https://arxiv.org/html/2310.11441v2) | GPT-4V 在 Flickr30K 子集 phrase grounding：数字＋mask 为 84.4 R@1，增加 box 为 89.2 | 支持可见标记组合的潜力；两组都有 mask，不是纯框与原生 mask 的比较。微软等机构研究，不是 OpenAI Codex 实现说明 |
| 同上，§4.4 | 中心编号可能落到其他物体；算术图中的数字、文档中的字母可能与标记混淆 | 编号也会造成视觉污染，不能承诺“框外放标签”解决所有情况 |
| [OSWorld v2，2024，Table 5 / §4.2](https://arxiv.org/html/2404.07972v2) | GPT-4V：截图 5.26%、截图＋a11y 12.17%、SoM 11.77%；GPT-4o：截图 5.03%、截图＋a11y 11.21%、SoM 4.59% | 有帮助也有下降。SoM 使用 a11y 元素编号/表格，包含输入与动作表达差异，不能将差值全归因于画框。是最多 15 步的桌面任务成功率，不是截图批注理解准确率；不能与后来的 OSWorld-Verified 混用 |
| [ScreenSpot-Pro v1，2025，Tables 4–5](https://arxiv.org/html/2504.07981v1) | OS-Atlas-7B：直接定位 18.9%，ReGround 40.2%；后者裁剪 512/1024 时为 25.1%/40.2% | 说明搜索与裁剪可能改善高分辨率小目标，也可能丢上下文；包含多轮定位，不能说简单“原图＋一张裁剪”已有同等收益 |
| [DAM v1，2025，Table 8](https://arxiv.org/html/2504.16072v1) | DAM 的 DLC-Bench 消融：全图 48.7%、带上下文局部图 65.4%、全图＋普通局部图直接拼接 42.4%、全图＋带上下文局部图专用融合 67.3% | 原生 mask 编码、裁剪和专用融合共同作用；“多给图片”不必更好。自然图像局部描述/属性评分，不是 GUI 点击或中文多区域批注；不是通用 GPT/Claude 的纯 mask 对框实验 |

DAM 全图和局部图都使用专用 mask 嵌入；不能把其成绩提升归因于普通 API 多传一张 mask。SoM、OSWorld 和 ScreenSpot 的目标定位/动作指标也不能当成 OCR、关系理解或用户批注响应质量。当前未找到 OpenAI 官方针对 Codex 用户批注、同时比较坐标/框编号/mask/裁剪的完整实验；未找到不等于不存在。

## 6. 成本、缓存、原图与兼容

[OpenAI 视觉文档](https://developers.openai.com/api/docs/guides/images-vision)给出按模型/尺寸/detail 的 patch 或 tile 计费及预处理限制；[Claude 坐标文档](https://platform.claude.com/docs/en/build-with-claude/vision-coordinates)说明处理坐标与缩放。上传原尺寸不代表模型按原尺寸理解，不能把某一模型的尺寸、token 或费用规则泛化到所有厂商。

相同尺寸与设置下，原图＋mask 通常是两份图片输入；黑白 PNG 文件压得小不代表视觉 token 更少。一张编号图可能避免双图，但不自动比一张原图省 token；也不能把双图总延迟简单算成两倍。以实际请求用量和耗时核实，不承诺节省百分比。

[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)针对可复用输入前缀，不能由“保留原图”或“标记图确定性”推断必然命中。改框会改变派生像素、文字和请求排列，历史前缀/供应商策略也影响复用；应看实际缓存用量。本地派生缓存只省本地生成，不等于 GPT 缓存。当前不新增任何一类缓存设施。

原图保留用于重新编辑、细节核验和重新生成表示，独立于模型输入选择。沿现有存储期限、删除与 grant，不新建永久图库。实验只用合成材料，不读私有会话，不把截图发给编辑/分割服务。未来若采用派生图，须沿现有消息/附件授权精确选择，保留原下载语义，并保证图文出自同一输入修订；当前不为这些未来条件新增表或持久状态。

## 7. 最小可证伪实验：尚未运行

先做不调用模型的展示检查：同一图片和结构化批注在缩略/放大下是否可对应，检查重复编号、极小框、边缘与重叠。若覆盖层已能满足用户阅读需求，就没有“必须烧录”的展示结论；展示收益单独成立时，也不自动切换模型输入。

真实模型实验须另获用户对调用、模型与费用的授权，建议先做 12 张合成截图 × 4 组 × 2 个拟支持模型，共 96 次请求：

- A：基础原图＋坐标文字；图片没有编号时只将编号作为文字条目 ID，明确对应矩形。
- B：编号空心框图＋同样的区域/备注文字，解释图上标记是辅助批注。
- C：原图＋同尺寸编号 mask 图＋同样文字。二值合并不能区分多区域，因此本组测的是“可用的带身份 mask 提示”，不能将提升归因于纯 mask。
- D：原图＋一个带上下文的目标裁剪＋同样文字，标明裁剪来自哪个区域；多区域样例预先固定一个困难目标，不默认逐区域增加图片。

样例覆盖重复按钮、中文小字、图中原有数字、1/多区域、重叠/嵌套、四边、长图、透明背景和必须依赖区域外内容的问题。先写答案与区域对应，再生成各表示，避免按某组结果改问题。固定实际模型 ID/版本、参数、源尺寸、detail、文字顺序与输出上限；记录预处理尺寸。保留各方案真实图片数量与成本，不人为把双图成本隐去，也不把多图预算差异称为纯表示因果效应。

逐题记录目标/批注对应、OCR/颜色等内容识别、关系/上下文、漏项/臆造与新增错误；人工按预设答案核验，不能只用另一个 LLM 总分。另记输入/缓存用量、费用和端到端延迟。对异常配对结果如需复跑，先将重复次数纳入预算并各组对称执行，不能只重试失败组。

采纳条件在调用前写定：候选须在目标模型上可重复减少已知错误，新增误读不能抵消收益，且成本/延迟在用户接受范围。12 张只是方向筛选，结果接近或仅个别案例改善时不宣布准确率提升；需要扩大预先选定困难集，仍无明确收益则维持 A。没有当前失败案例或明确展示收益，不以“业界惯例”为由推进。

## 8. 旧方案撤回与后续实施边界

旧版的默认编号图、接收时记录视图版本、`imageView` 元信息、派生键与缓存、平台合成 helper、历史精确重建、删除 `ImageReferenceRegions` 的步骤均**未采纳为当前实施要求**。先证明价值，再决定是否需要其中任何部分；不能以文档旧措辞为理由扩大改动。

如后续获授权采用某候选，先重新核对 HEAD/index/worktree、截图与上传的共同基底、模型实际读取 bytes、发送文字顺序、队列/重试/删除/历史，以及缩略/放大职责。优先复用原有入口，不另造发送器；取消、未知执行结果与权限错误沿原机制，不因图片失败自动换图续发。共享文件按片段协调，保留精确配对、正文/来源和其他事项已改样式；只有确认某覆盖层被同一视图替代后才讨论精确移除。

当前验证范围：源码/安装包只读调查、一手文档与论文核对、上文纯函数合成检查；**Homer 编号烧录、mask、裁剪的模型增益及成本均未实测，未安装、未部署、未新增模型调用。** 本次只更新本篇与两个现有入口；不改变[截图批注正文](desktop-screenshot-annotation.md)中各日期的历史实施/验收记录。
