# Homer 桌面 v0.1.12 发行记录

状态：2026-11-12，本地修复及定向验证完成，提交、推送及新标签已完成；本轮两端 Mac 在电源辅助程序正式签名失败，Windows 构建及三个草稿附件上传成功，verify-draft 未运行。不具备三平台发行条件，未公开或切换 Latest。

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

## 实际执行与新增阻断

- 本轮提交、远端 main 和标签 v0.1.12 回读均为 `000b55fbcb3d0e8c4c6729637b06deba7b1a34e7`。提交仅包含归档入口、对应测试、根版本与锁文件，以及 v0.1.11 / v0.1.12 发行记录六个文件；其他任务未提交工作保留。
- [运行 43244359822 / attempt 1](https://github.com/wolf3c/homer/actions/runs/43244359822/attempts/1)，操作者 wolf3c，workflow_dispatch，ref v0.1.12，2026-11-12 23:07:22（Asia/Shanghai）触发，运行完整 headSha 与目标一致。输入为 desktop / desktop-three / build 297 / 草稿直传。
- 归档已越过旧失败点，两端 Mac 完成源码及前后端编译、Node 正式签名、新电源 client 编译，随后调用 codesign 为 client 正式签名时报告 `no identity found`；没有公证或 Mac 安装包。
- Apple 芯片 job 131273090119、Intel job 131273090325 的直接失败命令均来自 `buildMacPower`。`scripts/build-desktop.mjs` 传入的通用 run 使用 scratch/build-home 作为 HOME，导致新签名路径与既有 Node、图片及窗口辅助程序的宿主签名路径不同。新问题不归因于归档修复，不通过放开全部编译环境或降低签名要求规避。
- 两端 Mac 的 Remove temporary Mac signing materials 均成功；未下载、启动或安装候选，Apple 芯片隔离验收尚未运行。
- 下一步提案：仅调整电源辅助程序的签名调用环境并补对应回归，编译继续使用原隔离环境；保留本轮标签及可能产生的附件，使用 v0.1.13 / build 298 新提交、新标签及新运行。已向用户询问扩展授权，尚未执行该修复或重试。

## 本轮最终结果

运行 43244359822 / attempt 1 最终 failure。Windows job 131273090298 为 success，真实 electron-builder 更新清单契约步骤及草稿直传步骤均成功；两端 Mac failure，verify-draft skipped。没有混用旧 attempt，也没有自动重跑。

v0.1.12 草稿 Release ID `443126427`，仅包含下表三个 Windows 附件。以下摘要来自 GitHub 附件元数据，不是本轮云端完整回下载或目标设备验收；没有合并 release-manifest.json 或 SHA256SUMS。保留草稿，不覆盖或删除。

| 附件 | ID | 字节数 | GitHub SHA-256 |
| --- | ---: | ---: | --- |
| Homer-windows-x64.exe | 739968411 | 291054776 | `919d4c63d472fcfa8f7aff14652a38d3e84a11de049e8282e76df438c8f98ab0` |
| latest.yml | 739968885 | 484 | `ceacc15f931339473fa1e0aeeb271ccc4d456876a13ac0a65586c3d131ed7be7` |
| release-manifest-windows-x64.json | 739968927 | 961 | `31c1d6656e3e55fe88e46e3e9ffb0ed6d75dbe6a2e184d9527fba34730767fbd` |

Latest 最终回读仍为 v0.1.8 / Release ID 441835374。未公开、不提出无条件发布；没有 Mac 包可以下载验收，Windows 实机及本轮三平台完整性也未验收。

按 work-cleanup 检查：本轮大归档合成仓库及测试解包副本均由测试 after 钩子删除，source-tests 父目录占用 0 B；没有本轮安装包、App、测试 profile、测试进程或临时归档遗留。日常安装与其他任务未提交文件保留。远端失败标签、草稿及附件保留，供定位与后续版本核对，不属本轮本机清理范围。
