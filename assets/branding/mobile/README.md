# 移动端启动图标

沿用已采用的 Odysseus 人物、蓝色／朱橙／象牙白配色。移动端独立于桌面透明圆角素材，系统负责圆角和圆形裁切。

- `mobile-icon.png`：1024×1024 RGB、不透明、满幅方图；供 iOS 和 Android 普通图标使用。基于原品牌 1024px 图经 imagegen 延展方形画布，再使用现有 sharp 等比导出；生成适配图并非原图的逐像素复制，原品牌文件未覆盖。
- `android-adaptive.png`：1080×1080 RGB 自适应前景。将上述方图缩为 720×720，四边各复制延展 180px；中央 72/108 区域对应原图，外延用于系统遮罩及运动，不增加透明留白或第二个圆角框。背景色为品牌蓝 `#0645AD`，完整不透明插画覆盖其上，无额外人物分层。

可用现有 sharp 重建 Android 派生图：`sharp('assets/branding/mobile/mobile-icon.png').resize(720,720).extend({top:180,bottom:180,left:180,right:180,extendWith:'copy'}).png()`。测试 `node --test tests/mobile-icons.test.mjs` 验证尺寸、不透明性、路径及中央图像一致。

2026-11-05 本地预览检查 iOS 圆角及 Android 圆形遮罩，无白圈；不代表真机安装验证。版本号、应用标识和签名未改变；须在以后授权构建的新安装包中生效，不更改已提交的 iOS build 7。

校验摘要（SHA-256）：

- `android-adaptive.png`: `39b0e99c7319c5b8a6d3b6c96fd6bcac925d3b9a8a8f2ccd7a7991ecc79f8cde`
- `mobile-icon.png`: `a585c5ce1d8f1ed79fa64c6413d43c0d3011d3958c8d4678fd1d23f5d96acf8b`
