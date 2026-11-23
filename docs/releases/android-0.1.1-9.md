# Android 0.1.1 build 9

已通过固定 Android 标签公开分发。标签与源码基线均为 `0840bbe1d14824abe3d265306fc2ec7ccd19a8eb`，正式包在隔离构建中仅将 `mobile/app.json` 的 Android `versionCode` 从 8 调为 9。

- `com.homer.mobile`，Android API 24 及以上，ARM64；target SDK 37。沿用 build 8 的正式签名证书。
- 41 项移动测试、类型检查、合成浏览器配对与重连、Release lint、R8 及资源缩减通过。包内 Hermes 字节与本轮产物一致，内嵌聊天页面包含第三方许可。扩展离线检查 81 通过、1 失败；隔离诊断等待模拟信令就绪后原断言通过，产品源未修改。
- Pixel 8 Pro 从公开 build 8 同签名覆盖到 build 9。ADB 回读 build 9 和相同的应用数据目录标识，并确认 MainActivity 启动。随后无线 ADB 断开，未自动回取安装 APK 或检查原绑定与会话恢复。用户确认已完成手动测试并要求公开发行。
- 草稿回下载和公开匿名完整下载的 APK 与本地 SHA-256 一致，摘要文件逐字一致，公开 APK 再验签通过。APK 为 42,139,329 字节，SHA-256 `e446f88b70ec01f9bd171613eeb5f724b872d3424413006885d6f15f35b32976`。
- GitHub Release ID `456103989`，APK 附件 ID `784879885`。Android 使用 `latest=false`，Android 公开前后桌面 GitHub Latest 均为 `v0.1.23`。Android 自动更新与官网安卓入口共用 Android 更新清单。

[固定发行页](https://github.com/wolf3c/homer/releases/tag/mobile-android-0.1.1-9) · [Android 更新清单](https://raw.githubusercontent.com/wolf3c/homer/main/mobile/android-releases.json)
