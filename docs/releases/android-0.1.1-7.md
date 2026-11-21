# Android 0.1.1 build 7 发行记录

2026-11-21。候选取自桌面 0.1.21 的固定源码 `5b1c2f78da6010ad20dba55801e9685507f187d9`。候选只把 `mobile/app.json` 的 `expo.android.versionCode` 改为 `7`。采用 `stable` 渠道，重新生成内嵌聊天页面并用既有正式 Android 密钥构建。

- APK 为 `Homer-0.1.1-7-android-arm64.apk`，42,083,181 字节，SHA-256 为 `801664beba79e2467572373745438162f73efd11444f24fe99afd92a370bf5dc`。应用标识为 `com.homer.mobile`，最低 API 24，目标 API 37，架构为 `arm64-v8a`。证书 SHA-256 `a99360f0b7b12f5fab09dd41f3a7a18ec53c954253e2caca7399b14a9af28382`，与 build 6 相同。
- 41 项移动端离线测试、类型检查及 30 项真实浏览器和宿主定向测试通过。已核对签名、Hermes、4 份包内源码来源及内嵌许可证。Gradle 正式构建含 lint、R8 和资源缩减。
- Pixel 8 Pro 上的正式 build 6 已同签名覆盖到 build 7。安装前旧包与公开 build 6 的摘要一致，安装后读回的 APK 与本次签名包逐字节一致。应用数据目录保留，原绑定免扫码恢复。手机工作状态页显示了与桌面 0.1.21 一致的首批 20 条归档事项。
- 按用户决定，以现有验收范围发布；真机续聊回信和原生系统分享端到端尚未完成。

已公开发行 `mobile-android-0.1.1-7`，Release ID `453624608`。草稿回下载与公开匿名下载的 APK、`SHA256SUMS` 均匹配本次核验的制品。桌面 Latest 保持 `v0.1.21`，11 个附件与发布前一致。[Android 下载](https://github.com/wolf3c/homer/releases/tag/mobile-android-0.1.1-7) · [Android 更新清单](https://raw.githubusercontent.com/wolf3c/homer/main/mobile/android-releases.json)
