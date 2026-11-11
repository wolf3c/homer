# Homer 品牌图标

## 当前资源入口

以后使用或制作 Homer 品牌素材，先从本表选择已有资源。当前资源统一保存在本目录，平台配置直接引用，不另复制一份；新增衍生稿需在本表补充用途。下方旧形象记录仅供历史核对。

| 用途 | 文件／说明 | 尺寸与注意事项 |
| --- | --- | --- |
| 桌面图标、页头、favicon | [Odysseus 多尺寸与母源](odysseus-20261030/README.md) | 16–1024px，透明圆角、安全留白；不要直接作为移动端满幅图标 |
| iOS 与 Android 普通图标 | [移动端满幅方图](mobile/mobile-icon.png) | 1024×1024，不透明；系统负责裁切外形 |
| Android 自适应图标 | [自适应图层](mobile/android-adaptive.png)、[派生说明与摘要](mobile/README.md) | 1080×1080，含系统遮罩外延 |
| X 等社交头像 | [社交方形头像](homer-social/homer-x-avatar.png) | 1254×1254，不透明深蓝底；与移动稿构图不同，不自动互换 |
| 透明人物、品牌组合 | [透明人物](homer-social/homer-mark-transparent.png) | 1199×1312，透明，保持比例，不拉伸成方图 |

社交资源来自既有提交 `b3dd652`；移动资源来自 `5ba0bae`。这些均为位图，不是可编辑矢量或人物分层源稿。优先复用、等比缩放；需要改变构图时另存衍生图，不覆盖已有母源。


> 2026-10-30 当前采用：[奥德修斯融合稿](odysseus-20261030/README.md)，结合 A 的配色与 D 的洒脱人物造型。旧河马原图保留，历史导出图已清理。[本机采用记录](../../docs/2026-10-30-odysseus-logo-adoption.md)。

> 2026-10-29 历史决定：[朱橙标准精修与酷感版](vermilion-20261029/README.md)均长期保留，标准版作为后续衍生基础，近期全应用统一采用酷感版，包括桌面图标、页头、欢迎图、favicon 与渠道设置页 Logo。本机应用已更新。采用证据见[评审记录](../../docs/2026-10-29-vermilion-icon-refinement-review.md)。下方为河石灰及更早方案的历史记录。

> 2026-10-20／21 历史方案：01N「河石灰」曾获用户选择。以下母源和色系用于历史核对，不是当前 Logo 切换计划；当前采用见页首奥德修斯说明。
>
> 准确母源：[1254px 原图](source/homer-01n-river-stone/homer-01n-river-stone-transparent-original.png)；实采色系及生成来源：[palette JSON](source/homer-01n-river-stone/homer-01n-river-stone-palette.json)。JSON 中历史 selection.status 为归档时事实，原样保留；历史色系记录见维护说明。
> 取色核对可使用本目录母源和只读取色脚本。实采主体#837C76、鼻吻#B2A69E、内耳#B39B91、五官#2B2E32仅作品牌参考，不替换正文/状态色。
>
> 红底蓝黑酷版及暖黄青绿可爱备选的原图保留；旧导出图及专属清单已清理。下方正文和提示词为历史记录。

制作日期：2026-10-16。以下为暖黄／青绿可爱备选的历史制作记录；最新采用范围见页首说明。

## 可爱备选：设计

Homer 是通过简单对话交办事务的个人 AI agent。图标采用正面河马头像，以宽吻部、小圆耳、平静眼神和微笑表现亲切、可靠、能办事。暖黄背景增强头像辨识度，深青绿与浅玉绿形成清楚的层次；不带文字和附加徽章。

这是栅格图像，原图含轻微纹理与明暗，不是纯色矢量，也没有可编辑 SVG 或分层设计源文件。颜色意图为暖黄 #F3CB70、深青绿 #174D4A、浅玉绿 #A4CEBA 与象牙白；生成结果存在细微颜色变化。

## 可爱备选文件

旧尺寸导出图已清理；原图保留在 `source/`。

## 原图和导出

- [source/homer-hippo-icon-generated.png](source/homer-hippo-icon-generated.png)：内置 image_gen 直接生成的原图，1254 × 1254 RGB PNG，原样保留。
- [source/homer-hippo-mark-transparent-generated.png](source/homer-hippo-mark-transparent-generated.png)：内置 image_gen 基于主图执行透明背景编辑所得的原图，1254 × 1254 RGBA PNG，原样保留。它是生成式编辑，不承诺与主图逐像素完全相同。
- 当时的六个使用版均从各自原图以 Pillow LANCZOS 等比缩小导出；没有手工重绘、程序抠图、伪造透明度或添加背景。
- 提示词要求 1024 × 1024，但工具实际返回 1254 × 1254；因此 1024 版也属于缩小导出，而非工具原始尺寸。
- 调查与检视图位于项目临时目录 `.codex/scratch/icon-design/`，不属于正式品牌资产。

## 可爱备选制作时的验证

- 实际解码全部六个交付文件，确认 PNG 格式与 1024 / 256 / 64 方形尺寸，RGB / RGBA 模式符合用途。
- 透明版 Alpha 范围为 0–255，四角完全透明；中央采样 Alpha 为 254，保留生成器的原生透明度，未人为改为 255。
- 实际打开原图和尺寸检查图，检查 256、64、额外缩至 32 像素的效果，以及圆形裁切；河马的宽吻、耳朵、双牙、笑容清楚，无多余器官、文字和水印。
- 透明原图已按原始尺寸叠在深色底检查，并在深浅底预览中对照；没有明显可见的背景残留。生成式边缘含细微抗锯齿与极低 Alpha 像素。
- 仅新增图标资产及本任务临时检视文件，未改动应用代码、模型配置或现有文档；未安装依赖，未创建 Git、提交或分支。
- 未进行商标查重或品牌法律审核；本次不改变项目中已有的工作名状态。

## 可复用提示词

生成渠道：内置 `image_gen`；未使用 CLI/API 回退。以下为实际提交的提示词。输出尺寸和视觉细节仍应人工核验。

### 主图

```text
Use case: logo-brand
Asset type: production-ready square product icon, 1024x1024 PNG.
Primary request: Design ONE finished, distinctive hippopotamus mascot icon for Homer, a personal AI agent that takes care of tasks through simple conversation. Personality: warm, dependable, quietly capable. No text.
Scene/backdrop: completely solid warm muted golden yellow (#F3CB70), full bleed square. No rounded-square container and no mockup.
Subject: a single front-facing friendly HIPPOPOTAMUS HEAD, centered, with an exceptionally clear, compact silhouette. An unmistakably wide, broad, low hippo muzzle, two small round ears high on either side of head, small calm eyes placed high ABOVE the enormous broad snout, two small separated nostrils on the TOP of the muzzle, and a simple confident smile with two short squared ivory lower teeth. Hippo anatomy, not pig, bear, cow or dog. Large muzzle should be broad and flattened with generous rounded corners, never a circular pig nose. No body or hands.
Style/medium: polished contemporary flat graphic mascot logo; bold rounded custom shapes, clean hard edges, minimal interior details. Use a deep forest-teal (#174D4A) outer head with lighter muted jade (#A4CEBA) muzzle, minimal deep teal features, ivory tooth accents. Solid color fills, no gradients, no shading, no texture, no thin outlines, no 3D. The design should feel thoughtfully drawn and ownable, not stock clipart.
Composition/framing: balanced front view with very slight expressive organic asymmetry, head occupies about 74% of canvas width and 67% of height, centered optically. Comfortable clear space all around, all ears and muzzle intact. Keep all important parts within the central circle-safe area. Broad shapes remain legible at 32px or 64px.
Constraints: one icon only, no typography, no letters, no H, no captions, no watermarks, no presentation board, no border, no extra symbols, no sparkles, no checkmarks, no speech-bubble badge, no headset, no accessories. Avoid babyish giant eyes, rosy cheeks, angry brows, giant fangs, aggressive expression. Deliver the actual icon image.
```

### 透明背景编辑

输入：上面保留的主图原图。参数：`transparent_background: true`。

```text
Use case: background-extraction.
Edit target: the provided Homer hippopotamus icon.
Change ONLY the exterior golden-yellow background to REAL alpha transparency. Isolate the entire single hippo head as a clean transparent PNG cutout. Preserve the head's position, scale, rounded ears, broad jade muzzle, forehead, eyebrows, eyes, nostrils, smiling mouth and both ivory teeth exactly. Preserve original colors, shapes and edge detail. Retain all internal colors as opaque, including ivory teeth and eye glints. Do not redesign or redraw the mascot, do not add any elements, do not add a shadow, do not paint a checkerboard. Keep the original square canvas and generous empty margins. Output a genuine transparent-background PNG with smooth antialiased edges, no yellow fringe.
```
