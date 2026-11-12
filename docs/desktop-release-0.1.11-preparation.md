# Homer 桌面 v0.1.11 发行准备

状态：2026-11-12，提交、推送和标签完成；三平台 attempt 1 均在源码归档阶段失败，无草稿或附件，未进入产品验收。未公开或切换 Latest。

## 候选与边界

- 仓库 `wolf3c/homer`，默认分支 `main`，当前身份具备 ADMIN 权限，Actions 已启用，`Homer build` 工作流 active。
- 已审查的本地源码基线 `da8b490023e184e296fd43528cf216dd75546380`；远端 main `454cccfc10624e21fb7dbf229ad721949fa53d04`，本地领先 1 个提交、落后 0。提交版本准备后须记录最终完整 SHA，并回读远端 main 及标签，再将其作为 `expected_sha`。
- 上一公开桌面版 v0.1.10 / build 295，发行清单来源 `93dcab106dbd78df2df1bea77f5ddc72446587c9`；本机 `/Applications/Homer.app` 同为 0.1.10 / 295。Latest 仍为 v0.1.8（Release ID 441835374）。
- 本轮产品版本 0.1.11、显式 build 296；根 package.json 及 package-lock.json 两处版本同步。UI 没有独立产品版本或锁文件，移动端版本独立，不修改。
- 准备时远端 `v0.1.11` 标签查询为 404，无同名草稿；最近工作流均已结束。旧失败草稿及标签保持原位。
- `kind=desktop`，`target=desktop-three`，`upload_release_draft=true`。Apple 芯片 Mac / macOS 27、Intel Mac / macOS 14、Windows x64 / Windows 11；Mac Developer ID 签名、公证及 stapling，Windows 未签名 NSIS。
- 网站 `https://super-tree.com`，网关 `https://models.super-tree.com`，沿用现有工作流显式输入。Node 22.22.0、Codex 0.163.0 沿用锁定归档及完整性校验。
- 仅 Apple 芯片 Mac 做隔离产品验收，不替换日常安装，不注册真实唤醒事件或改变系统权限。云端三平台打包不代表 Intel / Windows 实机通过。原生升级、真实睡眠唤醒和系统授权专项另行选择，缺证据时保持旧 Latest。

## 上一公开桌面版以来的完整差异

比较 `v0.1.10..da8b490`：6 个提交，117 个文件，5758 行新增、211 行删除。完整差异可用 `git diff v0.1.10 da8b490023e184e296fd43528cf216dd75546380` 审阅，不只挑选桌面目录同步。

- `6ade1a7`：Mac codesign requirements 改为显式表达式，修复原生更新初始化失败；修复进入源码不等于已安装版本已具备该修复或升级已验收。
- `da8b490`：定时消息四工具、来源认证与持久化入箱；电源保护、桌面设置、Mac 原生辅助程序和 Windows 普通用户唤醒任务接线；包含相应架构、测试及打包清单。
- `edbf4c6`、`f394d95`、`454cccf`：Android GitHub 更新来源、build 6 发行清单与公开核验记录，随完整主线同步，不构建手机包。
- `a4c6822`：v0.1.10 发行完成记录。

工作区现有 UI / 图片预览测试、移动端版本与隐私、v0.1.10 手动安装记录、docs/releases 和 docs/superpowers/specs 的未提交工作均保留，不纳入本轮准备提交。触发前重新检查 HEAD 和这些边界，避免并行任务漂移。

## 准备核验

本轮仅执行静态检查：模板与工作流逐字节一致，远端默认分支工作流 SHA-256 与本地一致；工作流 YAML、手动触发、固定 Actions SHA、固定 checkout、三平台矩阵、服务地址、版本及锁文件一致性、依赖归档哈希字段、必要路径和 git diff --check。无依赖安装或编译。

当前工作流 SHA-256：`c78d204b39b57def179839203fdd20e86b35a9044c8d028770d8f4f43101f6a8`。默认分支已注册 workflow_dispatch，构建前仍须重核最终源码包含同一工作流及入口。

既有架构记录报告该功能候选默认核心 2352/2352 通过，以及定向、类型和归档检查；本轮未重跑，不将记录当成本轮产品验收。Developer ID 安装后的电源授权／拒绝／撤销／升级卸载、Intel 新原生组件编译、Windows PowerShell 运行、真实睡眠和实网渠道补收仍缺证据。

## 本轮已授权执行

用户确认：仅提交本轮 package.json、package-lock.json 和本记录，完整推送已提交 main，创建并推送 v0.1.11 标签；以最终完整 SHA 构建三平台、Mac 正式签名公证、直接上传 Release 草稿，云端完整下载校验后下载 Apple 芯片包做隔离签名及产品验收。失败先定位，不自动整轮重试或覆盖附件。

公开同一草稿及 Latest 决策为后续单独授权边界；当前不修改官网、不安排延时构建、不沿用历史发布或安装授权。

## 用户更新说明草案

正式发布前按最终产物及验收结果补齐并回读双语 Release 正文，当前仅本地准备：

更新说明

- 定时消息：可让 Homer 按指定日期或重复规则，在原会话收到一条消息；修改和取消只影响未来投递。
- 电源与唤醒：增加执行期间的防休眠保护和相关设置；系统唤醒受平台、设备与用户授权限制，真实睡眠唤醒尚未验收。
- Mac 更新检查：修正原生更新初始化的签名检查参数，安装包及真实升级路径待本轮验证。

What's new

- Scheduled messages: ask Homer to deliver a message to the original conversation on a date or recurring schedule. Changes and cancellation affect future deliveries.
- Power and wake settings: add sleep prevention during execution and related controls. System wake depends on platform, hardware and user authorization; real sleep/wake behavior remains unverified.
- Mac update checks: correct the signature requirement argument used during native update initialization. Package and native upgrade validation are pending.

系统要求 / Requirements：Apple Silicon macOS 27+；Intel macOS 14+；Windows x64 Windows 11。计划 Mac Developer ID 签名及公证，Windows 未签名 / Planned Developer ID signing and notarization on Mac; unsigned Windows installer. Mac 解压 ZIP 后拖入 Applications，Windows 运行 NSIS 安装器 / Extract the Mac ZIP and move Homer to Applications, or run the Windows NSIS installer.

已知限制 / Known limitations：仅计划 Apple 芯片隔离验收，Intel / Windows 目标设备、真实账号与付费模型、原生升级及真实睡眠唤醒未验收；不能据此承诺升级数据保留 / Only isolated Apple Silicon acceptance is planned; Intel/Windows devices, real accounts and paid models, native upgrades and real sleep/wake remain unverified. Upgrade data retention has not been established for this release.

技术信息 / Build information：0.1.11 / build 296；最终源码 SHA、run / attempt、三平台附件与 SHA256SUMS 待构建填入。固定旧版 v0.1.10 可手动获取；跨版本资料回退未验证。Latest 保持 v0.1.8，直到另获授权且升级证据齐全。

## 本轮执行及失败证据

- 准备提交 `59291165605d8606f60bad2cb7317e9d67dc14d2`，只包含根版本文件、锁文件及本记录。完整推送 main 后回读，远端 main 与标签 v0.1.11 均指向该完整 SHA；其他任务未提交工作保持原状。
- [运行 43241848369 / attempt 1](https://github.com/wolf3c/homer/actions/runs/43241848369/attempts/1)，操作者 wolf3c，workflow_dispatch，ref v0.1.11，2026-11-12 22:53:11（Asia/Shanghai）触发。输入为 desktop / desktop-three / build 296 / 草稿直传，运行 headSha 与目标一致。
- plan 通过；Apple 芯片 job 131264311316、Intel job 131264311196、Windows job 131264310970 全部失败。三者均为 `scripts/desktop-source.mjs:52` 的 `git archive --format=tar` 同步输出超过 `maxBuffer:64*1024*1024`，分别报告 `/usr/bin/git` 或 `git.exe ENOBUFS`。没有进入产品编译、打包或上传。
- 本机用相同 SHA 归档测得 67,215,360 字节；上限 67,108,864 字节，超出 106,496 字节。使用原上限调用 spawnSync 已复现 ENOBUFS / SIGTERM，不写归档或解压目录。
- verify-draft skipped；运行最终结论 failure。固定标签 Release 查询为 not found，没有草稿附件；Latest 回读仍为 v0.1.8。两端 Mac 临时签名材料清理步骤均成功。
- 没有下载或启动候选包，Apple 芯片产品验收、签名公证及三平台产物完整性均未通过；不将依赖准备、签名材料配置或 Windows 生成器契约步骤视为产品验收。
- 未自动重跑、移动标签或删除旧资源。本轮本机未产生临时归档、测试 profile 或安装包，无新增临时资源需要清理。日常安装与其他任务文件未修改。

建议修复边界：`scripts/desktop-source.mjs` 改为在受控 scratch 临时目录生成归档文件，解包后通过 finally 清理，保留完整 SHA、路径和已提交源码校验；`tests/desktop-source.test.mjs` 增加大于 64 MiB 的归档回归和清理断言。修复需另获本轮扩展授权，再以新版本 v0.1.12 / build 297 创建新标签和新运行，保留 v0.1.11 失败标签，不复用旧 SHA 重跑。
