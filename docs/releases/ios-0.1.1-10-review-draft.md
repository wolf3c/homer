# iOS build 10 + 桌面 v0.1.13 审核说明草稿

更新日期：2026-11-13。本文件替代原 build 9 审核说明备选草稿；英文正文现已按用户后续授权保存至 App Store Connect，并刷新回读确认。build 10 已上传、选定并于 14:51（Asia/Shanghai）重新提交，提交时状态为“等待审核”。完整状态见 [发行记录](ios-0.1.1-10.md#app-store-提交进展2026-11-13)。

## 配套版本与验收范围（内部说明）

- 手机：Homer AI，iOS 0.1.1 / build 10，正式标识 `com.homer.mobile`，iOS 16.4 或以上，仅 iPhone。
- 桌面：Homer v0.1.13 / build 298，Apple Silicon Mac，macOS 27 或以上。
- 固定下载：[Homer-mac-arm64.zip](https://github.com/wolf3c/homer/releases/download/v0.1.13/Homer-mac-arm64.zip)。使用固定版本地址，避免 Latest 后续变化影响本次配套环境。
- 两端配对协议均为 2，聊天视图版本均为 4。build 10 已同签名覆盖安装；用户确认与实际 v0.1.13 隔离主端连接后，无需扫码看到原测试聊天，且无视图更新或版本不匹配提示。
- 图片保存及下载入口修复保留。相册保存、文件往返及重连复用既有验收结果，本轮补验只覆盖新包与最新桌面的聊天兼容性。详见 [build 10 发行及验收记录](ios-0.1.1-10.md)。

真实模型回复尚未验收。用户明确决定自行后续处理测试账号额度，并直接推进提审；本轮未修改额度或发起模型请求。下方说明不代表模型生成已经通过，也不承诺账号当前额度。账号和密码只通过商店专用登录信息字段提供，不写入本文件。

## 审核员操作流程（中文核对）

1. **下载桌面端**：在 Apple Silicon Mac（macOS 27 或以上）下载上述固定 ZIP，解压后将 Homer.app 放入“应用程序”并打开。审核期间保持 Mac 唤醒、Homer 运行和网络连接。
2. **登录与浏览器授权**：在 Mac 的 Homer 打开“设置 → 账号”，使用审核登录信息中的账号发起登录。在系统浏览器完成登录，并确认允许这台 Mac 上的 Homer 使用该审核账号的模型 Token。完成后返回桌面 Homer。
3. **应用模型来源**：选择 Homer 作为模型来源；若显示“应用并重启”，按提示完成。手机端没有单独的用户名／密码登录，账号登录和模型执行均在 Mac 上完成。
4. **获取新二维码**：在 Mac 打开“设置 → 移动设备 → 添加移动设备”，现场生成二维码并保持该页面打开。二维码有效期为 5 分钟；过期后点击“重新生成二维码”，再扫描新码。官网的 App 下载二维码不能用于绑定。
5. **手机扫码**：打开送审的 Homer AI iOS 0.1.1 (10)，点击扫码入口；首次使用时按系统提示选择相机权限，再扫描 Mac 当前显示的二维码。
6. **回到 Mac 确认绑定**：手机显示等待电脑确认后，在 Mac 同一“移动设备”页面找到这次手机操作发起的“有设备请求连接”，点击“确认绑定”。确认后手机进入桌面会话。等待确认时不需要重新扫码；此时重新生成二维码会取消当前待确认请求。
7. **检查功能**：在手机查看会话、发送简短请求，并用非敏感测试文件检查附件。图片下方的下载图标打开 iOS 系统分享，可选择“存储到文件”；从手机附件入口选中该文件可发回。长按图片保存到相册时，按 iOS 系统授权提示处理。重新打开手机 App 应恢复已保存的连接。

新码由审核员在自己的 Mac 上生成，绑定也由审核员在该 Mac 上明确确认；这两个步骤不依赖开发者在线配合。未附静态演示二维码，以免在异步审核时过期。

## English App Review Notes draft

以下英文正文已保存为 Notes，并随 build 10 于 2026-11-13 14:51（Asia/Shanghai）提交 App Review；提交时等待审核：

> Homer AI is an iPhone companion to the Homer desktop app. For this review, the paired versions are Homer AI 0.1.1 (build 10) on iPhone and Homer 0.1.13 (build 298) on Mac. The iPhone app requires iOS 16.4 or later.
>
> Desktop requirements: an Apple Silicon Mac running macOS 27 or later. Download the matching desktop package here:
> https://github.com/wolf3c/homer/releases/download/v0.1.13/Homer-mac-arm64.zip
>
> 1. Extract the ZIP, move Homer.app to Applications, and open it. Keep the Mac awake, connected to the Internet, and running Homer throughout testing.
> 2. On the Mac, open Settings > Account (设置 → 账号) and start the Homer account sign-in flow. Use the review credentials supplied in Sign-in Information. Complete sign-in in the system browser, authorize Homer on this Mac to use the review account's model token, and return to the desktop app.
> 3. Select Homer as the model source. If Apply and Restart (应用并重启) is shown, complete that step. Account sign-in and model execution take place on the Mac; the iPhone app does not have a separate username/password login.
> 4. On the Mac, open Settings > Mobile Devices > Add Mobile Device (设置 → 移动设备 → 添加移动设备). This generates a fresh live pairing QR code. Keep this page open. The code expires after five minutes; if it expires, click Regenerate QR Code (重新生成二维码) and scan the new code. The website's app-download QR code is not a pairing code.
> 5. Open Homer AI 0.1.1 (build 10) on the iPhone, open the scanner, respond to the system camera permission prompt if shown, and scan the QR code currently displayed on the Mac.
> 6. When the iPhone shows that it is waiting for computer confirmation, return to the same Mobile Devices page on the Mac. Find the request you just initiated from the iPhone and click Confirm Binding (确认绑定). The iPhone then opens the desktop conversation. Do not generate another QR code while waiting for this confirmation: regeneration cancels the pending request.
> 7. Check the conversation, send a short request, and test a non-sensitive attachment. The download icon below an image opens the iOS share sheet; Save to Files allows that file to be selected from the attachment picker and sent back. Saving an image to Photos uses the iOS permission prompt. Reopening the iPhone app should restore the saved connection without another scan.
>
> You generate each fresh QR code and confirm the device on your own Mac. Neither step requires coordination with the developer. A static pairing QR attachment is not provided because pairing codes expire after five minutes.
