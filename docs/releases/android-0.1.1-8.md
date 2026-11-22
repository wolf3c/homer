# Android 0.1.1 build 8

已通过公开固定标签分发。构建输入为冻结候选 `8fe9cf350a66f7cb715aa4546d2b2cda61e3f529` 加 `versionCode=8` 的单行覆盖，完整等价源码提交为 `b2cdbfe1d64e43309ca3d613c0abfafdf72fbb49`。

- `com.homer.mobile`，Android API 24 及以上，ARM64。沿用 build 7 的正式签名证书。
- 41 项移动端检查、类型检查、Release lint、R8 和资源缩减通过。APK 内 Hermes 与本轮生成的字节一致，内嵌聊天页面含第三方许可证。
- Pixel 8 Pro 从公开 build 7 同签名覆盖到 build 8，保留原配对和首次安装时间。回前台恢复聊天，实际发送一条测试消息并收到独立回信。
- 草稿回下载与公开匿名下载的 APK 和 `SHA256SUMS` 均与在设备验收的字节一致。APK 为 42,089,809 字节，SHA-256 `8b41148e1474bff1e541b70b7bff14e7a35118217e6e611851ab55862a53f201`。

[固定发行页](https://github.com/wolf3c/homer/releases/tag/mobile-android-0.1.1-8) · [Android 更新清单](https://raw.githubusercontent.com/wolf3c/homer/main/mobile/android-releases.json)
