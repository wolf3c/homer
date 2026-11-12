# Homer 桌面 v0.1.12 发行记录

状态：2026-11-12，本地修复及定向验证完成，用户已授权提交、推送、创建新标签、三平台正式构建、Mac 签名公证、草稿直传和 Apple 芯片隔离验收。公开发布及 Latest 变更仍未授权。

## 版本、来源与范围

- 0.1.12 / build 297；上一公开桌面版 v0.1.10 / 295，本机安装相同。失败候选 v0.1.11 / 296 的标签保留，不移动、不覆盖。
- 源码基线 `59291165605d8606f60bad2cb7317e9d67dc14d2`，追加本轮归档修复、测试、版本与发行记录。最终提交 SHA、远端 main / 标签回读和 run / attempt 在执行后补充。
- 与上一公开版的产品差异仍为定时消息、电源保护及 Mac 更新验签修复，完整差异与未提交排除范围见 [v0.1.11 记录](desktop-release-0.1.11-preparation.md)。本轮新增构建归档修复，无其他产品行为变更。
- `kind=desktop`、`target=desktop-three`、`upload_release_draft=true`。Apple 芯片 macOS 27+、Intel macOS 14+、Windows x64 Windows 11；Mac Developer ID 签名、公证及 stapling，Windows 未签名 NSIS。
- 网站 `https://super-tree.com`、网关 `https://models.super-tree.com`；Node 22.22.0、Codex 0.163.0 及归档锁定不变。工作流与模板保持一致，触发前回读远端工作流、最终完整 SHA 和标签占用。
- 仅 Apple 芯片做隔离产品验收，不替换日常安装、不注册系统唤醒事件、不改变权限、不使用真实账号或付费模型。不自动重试，不公开或切换 Latest。

## 归档修复与本地验证

v0.1.11 三平台都在 `prepareDesktopSource` 将完整 git archive 捕获为内存 Buffer 时触发 ENOBUFS，实际 67,215,360 字节超过 64 MiB。现改为在已经核对的 scratch 父目录创建唯一临时目录，git archive 显式写入文件，tar 从文件解包；finally 删除临时归档目录。没有修改完整 SHA、路径、候选覆盖、已提交源码一致性或退休入口校验。

真实 Git / tar 回归创建独立合成仓库和 65 MiB 文件，验证精确解包、publishable 来源及临时归档回收；另确认未提交入口仍拒绝、失败后无归档残留。新测试在旧实现上以 ENOBUFS 失败，修复后通过。

- `node --test tests/desktop-source.test.mjs tests/github-build-plan.test.mjs tests/github-release-draft.test.mjs`：35/35 通过，无失败、取消或跳过。该路径仅本地合成夹具，不调用真实模型或生产服务。
- Node 与版本/锁文件一致性、工作流模板一致性、静态 YAML 和 git diff --check 在提交前复核。
- 本次未重复核心全量、原生电源或真实引擎专项；先前产品验证只作既有记录，不替代本轮安装包验收。

## 待执行证据

三平台构建、草稿完整校验、Apple 芯片下载摘要、包内服务地址、签名公证及隔离产品验收尚待本轮实际产物。Intel / Windows 目标设备、真实睡眠唤醒、授权／撤销／卸载、实网渠道补收和原生升级仍未验收；缺证据时 Latest 保持 v0.1.8。

## 双语用户更新说明草案

更新说明

- 定时消息：可让 Homer 按日期或重复规则向原会话投递消息，修改和取消只影响未来投递。
- 电源与唤醒：增加执行期间的防休眠保护及设置。系统唤醒受平台、设备和用户授权限制，真实睡眠唤醒尚未验收。
- Mac 更新检查：修正原生更新初始化的签名检查参数；实际安装包及原生升级验证状态在验收后补齐。

What's new

- Scheduled messages: deliver messages to the original conversation on a date or recurring schedule. Changes and cancellation affect future deliveries.
- Power and wake settings: add sleep prevention during execution. System wake depends on platform, hardware and user authorization; real sleep/wake remains unverified.
- Mac update checks: correct the signature requirement argument used during native update initialization. Package and native upgrade results will be recorded after acceptance.

系统要求 / Requirements：Apple Silicon macOS 27+；Intel macOS 14+；Windows x64 Windows 11。计划 Mac Developer ID 签名及公证，Windows 未签名 / Planned Developer ID signing and notarization on Mac; unsigned Windows installer.

安装 / Installation：Mac 解压 ZIP 后拖入 Applications，Windows 运行 NSIS 安装器 / Extract the Mac ZIP and move Homer to Applications, or run the Windows NSIS installer.

已知限制 / Known limitations：仅计划 Apple 芯片隔离验收；Intel / Windows 实机、真实账号与付费模型、原生升级和真实唤醒未验收，不能据此承诺升级数据保留 / Only isolated Apple Silicon acceptance is planned. Intel/Windows devices, real accounts and paid models, native upgrades and real wake behavior remain unverified; upgrade data retention is not established for this release.

技术信息 / Build information：0.1.12 / 297；最终 SHA、run / attempt、附件摘要和实际签名结果待构建。固定旧版 v0.1.10 保留，跨版本资料回退未验证；Latest 保持 v0.1.8。
