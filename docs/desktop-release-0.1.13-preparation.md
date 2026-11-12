# Homer 桌面 v0.1.13 发行记录

状态：2026-11-12，本地修复和定向检查完成；用户已授权提交、推送、创建标签、三平台正式构建、Mac 签名公证、草稿直传及 Apple 芯片隔离验收。公开发布和 Latest 变更另行授权。

## 本轮范围

- 产品 0.1.13 / build 298。上一公开桌面版 v0.1.10 / 295，本机安装相同；失败标签 v0.1.11 / 296 和 v0.1.12 / 297 保留，后者三个 Windows 草稿附件不覆盖、不删除。
- 源码基线 `3961b48b1892f7b7c563ed527c1198a1a57eb977`，追加本轮签名环境修复、对应测试、版本与记录。完整产品差异仍包括定时消息、电源保护和 Mac 更新验签修复，见 [v0.1.11](desktop-release-0.1.11-preparation.md)；大归档修复及其回归已在 [v0.1.12](desktop-release-0.1.12-preparation.md)完成。
- 唯一新增构建行为：buildMacPower 的 `/usr/bin/codesign` 沿用既有 Node 和图片辅助程序的宿主签名上下文；Swift 和其他编译仍走原 scratch HOME。身份、运行时签名、公证和严格验签要求不变，不扩散宿主环境给编译，不读取或输出凭据。
- 仅改 scripts/build-desktop.mjs、tests/desktop-power-packaging.test.mjs、根 package.json / package-lock.json 和本记录。保留 UI、移动端及其他任务未提交工作，不纳入候选。
- desktop / desktop-three / 草稿直传；Apple Silicon macOS 27+、Intel macOS 14+、Windows x64 Windows 11。Mac Developer ID 签名、公证和 stapling；Windows 未签名 NSIS。
- 网站 `https://super-tree.com`、网关 `https://models.super-tree.com`；Node 22.22.0、Codex 0.163.0、依赖归档和原工作流不变。
- 仅下载 Apple 芯片包做隔离签名及产品验收；不替换日常安装，不注册真实唤醒事件或改变权限，不使用真实账号或付费模型。Intel / Windows 实机、真实唤醒及原生升级仍需独立证据。

## 本地检查

新回归执行真实构建入口中 run 和 buildMacPower 调用段，在子进程边界捕获命令环境；旧实现的签名调用带有 scratch HOME，测试先失败。修复后检查 Swift 仍隔离、签名及验签继承宿主环境。该测试不冒充真实 Developer ID 签名，正式签名由本轮云端及下载包核验。

`node --test tests/desktop-power-packaging.test.mjs tests/macos-power.test.mjs tests/desktop-source.test.mjs tests/github-build-plan.test.mjs tests/github-release-draft.test.mjs`：65/65 通过，无失败、取消或跳过。原大归档、来源一致性、权限及草稿完整性拒绝断言保持。

提交前核对版本/锁文件一致、工作流/模板一致、远端来源和标签占用，并执行 git diff --check。本轮未重跑全量核心、真实引擎或电源专项；既有记录不替代本轮产品验收。

## 执行记录

最终 SHA、远端 main / v0.1.13 标签回读、run / attempt、逐平台结果、草稿完整校验及 Apple 芯片验收在实际执行后补齐。任一失败先报告，不自动重跑或覆盖附件。Latest 保持 v0.1.8，公开与原生升级放量另行授权。

## 双语更新说明草案

更新说明

- 定时消息：让 Homer 按日期或重复规则向原会话投递消息；修改和取消只影响未来投递。
- 电源与唤醒：增加执行期间的防休眠保护与设置。系统唤醒受平台、设备和用户授权限制，真实睡眠唤醒尚未验收。
- Mac 更新检查：修正原生更新初始化的签名检查参数；实际包及原生升级结果按本轮证据补齐。

What's new

- Scheduled messages: deliver a message to the original conversation on a date or recurring schedule. Changes and cancellation affect future deliveries.
- Power and wake settings: add sleep prevention during execution. System wake depends on platform, hardware and user authorization; real sleep/wake remains unverified.
- Mac update checks: correct the signature requirement argument used during native update initialization. Package and native upgrade results depend on this release's acceptance evidence.

要求及安装 / Requirements and installation：Apple Silicon macOS 27+；Intel macOS 14+；Windows x64 Windows 11。Mac 解压 ZIP 后拖入 Applications，Windows 运行 NSIS 安装器 / Extract the Mac ZIP and move Homer to Applications, or run the Windows NSIS installer. Planned Developer ID signing and notarization on Mac; unsigned Windows installer.

限制 / Limitations：仅计划 Apple 芯片隔离产品验收；Intel / Windows 实机、真实账号及付费模型、原生升级、真实睡眠唤醒与系统授权仍未验收，不能据此承诺升级数据保留 / Only isolated Apple Silicon product acceptance is planned. Intel/Windows devices, real accounts and paid models, native upgrades, real sleep/wake and system authorization remain unverified; upgrade data retention is not established.

构建信息 / Build information：0.1.13 / build 298；最终源码、run / attempt、附件及 SHA256SUMS 待执行补齐。固定旧版 v0.1.10 保留，跨版本资料回退未验证；Latest 保持 v0.1.8。
