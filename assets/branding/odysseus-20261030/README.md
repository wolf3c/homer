# Homer 奥德修斯图标

2026-10-30 用户选定 A 的爱琴海蓝、朱橙、象牙白配色与 D 的洒脱发型和人物造型融合稿，作为当前 App Logo。此前河马标准母版、酷感版及所有候选保留，未来变体另存。

- [选定原图](source/odysseus-fusion-original.png)：1254 × 1254 RGBA，保留生成字节。SHA-256 `59ad7741733e2cfefa11641af558db2857a6bcf449d89d113c7fa7234c632675`。
- [实际提示词及参考图](source/prompt.json)：内置 image_gen 编辑，A 只提供配色与底板，D 提供人物与头发。
- 提供 16、32、48、64、128、256、512、1024px PNG 和 [macOS ICNS](homer-odysseus.icns)。[导出清单](manifest.json)记录尺寸、SHA 与透明度。
- [导出脚本](../../../scripts/export-odysseus-branding.py)仅整幅等比预乘 alpha LANCZOS 缩小；ICNS 使用现有 desktop-icon.mjs。未裁切、重绘、调色或阈值修改透明度；保留安全留白及原生低 alpha 边缘。此为位图，不是矢量或分层源稿。
- 使用范围：macOS Dock、页头、欢迎图、favicon，以及渠道设置页 `/branding/homer.png`。页面布局、显示尺寸和状态色不变。

重跑 PNG 导出时，仅在原图、1024px PNG 与 ICNS 字节及长度均与旧记录相符时保留 ICNS 校验元数据；若变更则移除该记录，须用 `scripts/desktop-icon.mjs` 重建并重新验证 ICNS。

本机采用、隔离打包和实拍证据见[采用记录](../../../docs/2026-10-30-odysseus-logo-adoption.md)。远程版本未发布。
