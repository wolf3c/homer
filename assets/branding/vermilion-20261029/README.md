# Homer 朱橙图标：标准母版与酷感版

> 2026-10-30：当前 App 已转用[奥德修斯融合稿](../odysseus-20261030/README.md)。下文采用状态为 2026-10-29 历史记录；两版母图、导出与回退证据全部保留。

2026-10-29。用户决定长期保留两版，**标准精修版作为后续衍生设计的基础，近期全应用统一使用酷感版**。保留两份原图、实际提示词、全部 PNG 尺寸和 ICNS，不覆盖标准版来制作衍生版本。

| 候选 | 1024px PNG | macOS ICNS | 主要区别 |
| --- | --- | --- | --- |
| 标准精修 | [PNG](homer-vermilion-standard-1024.png) | [ICNS](homer-vermilion-standard.icns) | 朱橙底、奶白宽吻、近正面微侧姿态、亲切眼神与微笑 |
| 酷感版（2026-10-29 采用） | [PNG](homer-vermilion-cool-1024.png) | [ICNS](homer-vermilion-cool.icns) | 沿用配色与构图，增加深色墨镜和轻微挑起的笑意 |

每组均提供 16、32、48、64、128、256、512、1024px RGBA PNG。ICNS 含现代 PNG 档及 16/32px 的传统 RGB/alpha 档，共 12 个容器块；由现有 `scripts/desktop-icon.mjs` 生成。应用底板自带连续圆角及透明外缘，不应再额外裁成一层圆角或移除整幅安全留白。

## 来源与导出

- 生成使用内置 `image_gen`，未使用 API/CLI 回退。
- [实际提示词](source/prompts.json)记录标准版生成、透明外缘修订和酷感对照编辑。
- 两份 [source](source/) 原图均为工具实际返回的 1254 × 1254 RGBA PNG，原始字节保留。提示词请求 1024px，实际输出尺寸与请求不同；1024px 文件是缩小导出。
- PNG 导出仅做 Pillow 预乘 alpha LANCZOS 等比缩小；未重绘、重新着色、裁切或阈值修改 alpha。ICNS 使用上述现有脚本从各自 1024px PNG 生成。
- 真实透明度为 0–255，原图四角完全透明。外缘仍有极低 alpha 的生成残留；未宣称为纯色矢量或人工分层母版。浏览器深浅底实际呈现已检查。
- [manifest.json](manifest.json)包含原图、各尺寸 PNG、ICNS 的尺寸、SHA-256 及校验信息。

## 采用边界

当前采用范围为 macOS 应用图标、页头、欢迎图、16/32/64px favicon，以及 `/branding/homer.png` 兼容接口提供的渠道设置页 Logo。`scripts/build-desktop.mjs` 指向酷感 1024px PNG，UI 导入酷感 64/256px PNG，兼容接口使用酷感 256px PNG；页面布局、显示尺寸及 Dock 固定项不变。

本机 `/Applications/Homer.app` 已完成上述统一，签名、资源清单、原会话恢复与实际 HTTP 图标字节均已核对；详情见评审记录及 manifest 的 `unifiedAdoption`。维护源码尚未提交，未发布远程版本。历史母图、旧候选与回退版本保留，不属于当前应用实际 Logo 引用。

后续节日、情绪、职业或配饰版本均从标准版原图开始，另存变体及生成提示词，保持朱橙底板、奶白宽吻、耳形、构图和留白一致。墨镜版是第一个衍生版本；当前没有实现自动换肤或轮换功能。

本次检查和真实 Dock 验证状态见 [评审记录](../../../docs/2026-10-29-vermilion-icon-refinement-review.md)。已实拍 [Dock 对比](review/dock-live-detail.png)：现有灰色 Homer、标准精修和酷感版并排显示。画面只作像素裁切，没有合成或生成式修改；两版以独立临时预览应用加载各自 ICNS，拍摄后均已退出。
