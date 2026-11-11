# Android APK

## 持久签名

现有私有位置（相对 Homer 根目录）：

- `.codex/private/releases/homer-android/homer-release.jks`
- `.codex/private/releases/homer-android/store-password`
- alias：`homer-release`
- 正式证书 SHA-256：`a99360f0b7b12f5fab09dd41f3a7a18ec53c954253e2caca7399b14a9af28382`

从上一已验证 APK 和当前材料交叉核对证书；以上基线不授权换签名。文件缺失、密码不可用、证书不符时停止签名，不生成替代 key。2026-11-03 Pixel 旧开发签名为 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`，与正式签名不兼容；这是历史记录，安装前仍读取实际设备。

## 构建

复用 Expo/Gradle，当前已验证 ARM64 Release。其他 ABI 只有在用户要求且通过构建/验收后才承诺；最低 API 和 target 从 APK 读取，不从手写说明猜测。

在独立候选中，按根 `.nvmrc` 选择 Node，复用已安装 SDK/JDK；先完成主 skill 的内嵌页面和检查，再生成 Android 工程：

```sh
# 候选 mobile/，已设置 EXPO_NO_DOTENV=1、EXPO_PUBLIC_HOMER_RELEASE_CHANNEL=stable
node node_modules/expo/bin/cli prebuild --platform android --no-install
```

Prebuild 可能清空并重建整个 `android/`，也会恢复默认 debug signing。必须在其完成后核对并接入正式签名，不复用旧 APK 的签名检查结论。

生成的 `android/app/build.gradle` 内使用原 Android DSL：

```groovy
signingConfigs {
    release {
        storeFile file(System.getenv('HOMER_ANDROID_KEYSTORE'))
        storePassword System.getenv('HOMER_ANDROID_PASSWORD')
        keyAlias 'homer-release'
        keyPassword System.getenv('HOMER_ANDROID_PASSWORD')
    }
    // 保留生成工程已有的 debug 配置。
}
// 只把 buildTypes.release.signingConfig 指向 signingConfigs.release。
```

密码由受限文件读入当前构建子进程环境，禁止输出或打开 shell tracing，不传 `-Ppassword=...`。只修改候选生成工程，不能复制私有值进受管源码。不要复用旧 `gradle.projectsEvaluated` 签名 init script：现行 Gradle 已实证报 `It is too late to add new signing configs`。

```sh
# 候选 mobile/android/，ANDROID_HOME/JAVA_HOME 指向已核实工具
./gradlew :app:assembleRelease --no-daemon --max-workers=2 -PreactNativeArchitectures=arm64-v8a
```

保留 lint/R8 和正式 Release 配置。新工程会执行 JS 打包；如果增量构建复用原工程，先强制执行 `:app:createBundleReleaseJsAndAssets --rerun-tasks`，再 assemble，防止内嵌页面变化未进入包。核对本次任务日志与 APK 内 bundle，不靠文件修改时间推断。

## 核验与安装

- 使用当前 SDK `build-tools/<版本>/apksigner verify --verbose --print-certs APK`，要求成功且证书等于正式基线和上一正式包。
- 用同目录 `aapt dump badging APK` 读 `com.homer.mobile`、目标 versionName/versionCode、min/target SDK、`native-code`；确认不是 debuggable。
- 比较 APK `assets/index.android.bundle` 与本次生成的 Hermes bundle；用 source map 的 `sourcesContent` 比较 `App.tsx`、`update.mjs`、`.generated/chat.mjs`（source map 可能采用嵌套 `sections`）。map 只在本地核验，不打入公开 APK。
- 检查固定官网更新地址、正式渠道编译替换、内嵌许可说明，以及没有 QA 注入、私有配置、keystore 或源码 map；最终签名后计算 SHA-256 和字节数，复制到版本目录，保存非公开 `verification.json` 和可公开的 `SHA256SUMS`。源快照与精确覆盖差异须可追溯。
- `adb devices -l` 后所有命令显式指定设备；读取目标 Android user 和包状态，勿误处理工作资料。用 `pm path --user USER com.homer.mobile` 拉取已安装 base.apk，只做证书比较，不读取应用私有数据。
- 相同签名使用 `adb -s SERIAL install -r --user USER APK`；先确认不是降级，不用 `-d`。首次安装省略 `-r`。签名不同须先说明将丢失绑定/本地设置并取得卸载授权，确认其他 Android user 未安装该包，才卸载原正式标识下的旧开发版。保留独立 `com.homer.mobile.pairingqa`。
- 安装成功后重新读 package/version、启动 `com.homer.mobile/.MainActivity` 并看实际画面；记录安装对象与结果，不把进程存在等同于功能验收。

APK 发布先采用草稿和明确附件列表，重下载比较，再公开。移动标签使用独立的 `mobile-android-<version>-<build>`；既有其他标签约定优先核对再沿用，始终 `latest=false`。匿名下载核验通过后，才按发行合同更新官网 Android 一项。

首次仓库没有正式 Release 时，不能据 `latest=false` 承诺 `/releases/latest` 仍为 404：2026-11-03 实测首个正式 Android Release 仍被该接口选中。发布前识别此情况，沿用已确认处理决定；未决定时说明“保留正式版、桌面首发后接管 Latest”与“改为预发布”的差异再确认，不伪造桌面 Release，不擅自改渠道。发布后始终核验实际 Latest，已有桌面 Latest 时必须保持其身份和附件。
