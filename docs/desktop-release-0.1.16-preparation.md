# Homer 桌面 v0.1.16 发行准备

状态：2026-11-16，v0.1.16 / build 301 已公开，Latest 保持 v0.1.15。三平台构建、云端完整下载校验、ARM 隔离验收及发布后匿名分发核验通过。本机升级因未确认原生工具状态阻塞，仍为 v0.1.15 / build 300。

## 来源与授权边界

- 用户要求打包发布 main 最新已提交代码。产品基线为 `e729c2cb2d16294229016e7039856a631ef4f10f`；核对时远端 main 为 `22a21bcee59b5b472be0042d66e12725319d00c8`，本地领先 5 个提交，无分叉。远端仓库为 `wolf3c/homer`，默认分支 main，当前身份具有 ADMIN 权限。
- 当前正式版及 Latest 为 v0.1.15；已公开合并清单和本机正式包均为 build 300，本机来源 `b192bed0773d4339bbdcb821f083a414a8325897`。候选版本为 v0.1.16 / build 301，远端新标签未占用。
- 本轮本地发行改动仅为根 `package.json`、`package-lock.json` 和本记录。工作区其余未提交及已暂存改动全部保留，不进入本轮发行提交或构建覆盖。
- 用户本轮已明确确认：提交这三个发行文件、完整推送 main、创建 v0.1.16 标签、正式签名公证及三平台构建验收，通过后公开同一 Release；Latest 保持 v0.1.15。历史授权不沿用。

## 上版以来的已提交变化

相对 v0.1.15 标签，包含 110 个文件的代码、测试及文档差异；其中 2 个提交为上版发行记录。

- 缩减审批上下文并遵循原生权限变化。
- 内置 Codex 升级到 `0.171.0-alpha.7`，会员启用 Code Mode Only，并维护原生线程绑定及连续性。
- 对齐 Main / Worker 推理强度和任务完成行为。
- 使用系统 HOME，并为 Codex 保持独立 profile。
- 修正 macOS 唤醒登记与恢复通知。

以上为源码范围，不代表新安装包或真实平台验收通过。Codex alpha 升级及 HOME 行为变化是本次重点回归范围。

## 构建与验收计划

- `kind=desktop`、`target=desktop-three`、`release_tag=v0.1.16`、`build_number=301`、`upload_release_draft=true`；以最终发行提交完整 SHA 固定 checkout。
- Apple 芯片 Mac 为 macOS 27+，Intel Mac 为 macOS 14+，均使用 Developer ID 签名、公证及 stapling；Windows x64 为 Windows 11 未签名 NSIS。Linux 与移动端不在本轮范围。
- 显式网站 `https://super-tree.com`、网关 `https://models.super-tree.com`；保持现有平台依赖锁和完整性检查。工作流与维护模板一致，远端默认分支已注册工作流且状态 active。
- 三平台须来自同一 SHA / run / attempt，云端完整下载校验 11 个附件。仅下载 ARM 正式包，核对版本、build、来源、双服务地址、包摘要和系统信任，执行隔离合成运行及重启/附件恢复验收。
- 按已有本机安装授权，在日常空闲且安全退出后完整备份，再复用已验证包安装并核对原资料；未知状态不当作空闲，不强停、不清队列。
- 公开前核对双语用户更新说明、固定标签及本次和原 Latest 附件基线；公开同一草稿后匿名核对固定链接、摘要、原生清单和所选 Latest 分支。
- Intel / Windows 实机、完整原生自动升级、真实模型、实际睡眠唤醒均不得用云端构建或 ARM 合成验收代替。常规发行无需修改或部署官网。

## 准备检查

使用仓库要求的 Node 22.22.0 执行 `node --test tests/github-build-plan.test.mjs tests/github-release-draft.test.mjs`，29/29 通过，零跳过。首轮受沙箱禁止写入测试临时目录影响，放行后完整重跑通过，未修改断言。

已读取所有桌面正式版及可读取草稿的平台/合并清单，最大 build 为 300；缺少清单的残留草稿不能据此标为完整发行。版本 JSON 仅修改三个版本字段，版本一致性断言及 diff 空白检查通过；受测发行脚本和工作流没有工作区覆盖，工作流与维护模板一致。准备阶段尚未执行产品编译、正式包生成或运行验收，后续实际结果见下文。

准备阶段按 work-cleanup 核对协议测试的临时 fixture 已自行回收，当时尚无下载包、解压 App、测试 profile 或备份。三个待审阅发行文件保留，其他任务的暂存及未提交工作未动。

## 执行记录

- 发行提交 `3fc5514519f3e149251a3fbf44aa9c833c35750f` 仅含三个获准发行文件。完整推送后，远端 main 和 v0.1.16 标签回读完整 SHA 均一致；其他任务原有三个暂存文件保持原样。
- [运行 43867816956 / attempt 1](https://github.com/wolf3c/homer/actions/runs/43867816956/attempts/1)，操作者 wolf3c，workflow_dispatch，ref v0.1.16，固定上述 SHA、desktop / desktop-three / build 301 / 草稿直传。plan、三平台及 verify-draft 均成功；没有重跑或混合 attempt。
- 从发行提交导出隔离源码，使用 Node 22.22.0，构建及类型检查通过。引擎 HOME/权限/线程绑定及上下文、原生线程记忆、进程、桌面 HOME/电源/壳和更新契约定向回归 637/637 通过，零跳过。测试使用合成 HOME/CODEX_HOME，不读取日常账号、不调用真实模型；未修改产品断言。
- 原 Latest 核对为 v0.1.15 / Release ID 445981017，本轮保持该版；公开前仍需重新记录附件基线。
- 日常实例只读核对使用 `~/Library/Application Support/Homer Desktop`，无 adoption 外部路径。安装版实际 `RecursiveTasks.safeToUpgrade()` 在只读数据库上返回 false：存在未确认原生工具执行状态；当前未结束 run、working Main 节点及 pending_main/pending_user 交互均为零，不能用这些零值覆盖安全检查失败。未处理原生状态、强停、清队列或替换日常应用；安装前需复核该阻塞和草稿/待生效配置。

## ARM 正式包验收

- 正式 ZIP 为 426,536,376 字节，SHA-256 `e463ff1afc3c0ee4ab2b3b9ded4247a98e4eed85b6f2db6c4a1cd3a8a31988dc`，与同一 run / attempt 的原始回执及平台清单一致。ZIP 内封存清单的版本/build、完整 SHA、正式标记和双服务地址与回执及本轮输入一致。
- 下载后解压的原 `.app` 通过 codesign deep/strict、stapler 和 Gatekeeper，系统识别为 Notarized Developer ID。实际更新验签表达式 1/1 通过，包内服务地址及批注运行时/许可证检查 2/2 通过。
- 初轮四场景 2/4 通过，两个发送步骤被首次功能导览遮挡；临时验收脚本在 launch 后通过 `.desktop-feature-tour-close` 正常关闭导览，不改变产品。第二轮 3/4 通过，崩溃恢复场景在崩溃前的 Worker 附件交付超时，数据库明确记录 `worker_project_root_config_mismatch`。
- 根因是旧 `tests/fixtures/desktop-app-server.mjs` 的 config/read 未回显传入的 `project_root_markers`。仅在临时源码快照的配置回显字段列表补入该字段后，正式包四场景完整重跑 4/4 通过、零跳过：会话发送与正常重启、未登录只读、完整进程崩溃后原会话和精确附件恢复、SILK 预览及访问控制。初轮失败不记为通过；仓库源文件、产品包及全部原断言不变。
- 正常退出均验证 owner、runtime/gateway 锁及 lease 释放，未手动删锁。390 / 1440 宽度无横向溢出，实际合成界面截图已查看。未发送真实消息、调用付费模型、扩大权限或验证真实睡眠唤醒。


## 三平台完整校验与公开

plan、Mac ARM、Mac Intel、Windows 和 verify-draft 五个 job 全部 success，同一完整 SHA / run 43867816956 / attempt 1，未重跑。三份原始回执均核对版本/build、来源、正式标记和双服务地址；按原始 basename 规范化路径后匹配包大小及 SHA-256。Mac 两平台签名、公证及 stapling，Intel 最低 macOS 14；Windows 未签名 NSIS。

Windows 真实 electron-builder 原生清单契约步骤成功。latest.yml 的固定标签 URL、版本、大小、顶层及 files 中的 SHA-512 字段一致；清单字节与平台/合并清单的 SHA-256 相符。Intel / Windows 大包完整校验证据来自云端 verify-draft，未在本机重复下载。

匿名 API 首次限流（403、remaining=0），恢复后取得原 Latest v0.1.15 / Release ID 445981017 和 11 附件身份/大小/摘要基线；未把限流当作不存在。发布前再次确认该基线不变、本次 11 附件均 uploaded、合并清单与原始回执一致、双语正文逐字一致及不可变标签 SHA 正确。草稿通过认证列表定位，标签查询 API 对草稿的 404 未当作草稿丢失。

随后按授权执行 `gh release edit v0.1.16 --repo wolf3c/homer --verify-tag --draft=false --prerelease=false --latest=false`，公开同一草稿，没有重传附件、移动标签、切换 Latest 或部署官网。

[本版固定页面](https://github.com/wolf3c/homer/releases/tag/v0.1.16)，Release ID 447024680，公开时间 2026-11-16 21:02:34（Asia/Shanghai），draft=false、prerelease=false。完整双语用户更新说明只维护在 Release 正文。

### 本版公开前附件基线

v0.1.16 / Release ID 447024680。

| 附件 | ID | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `Homer-mac-arm64.zip` | 754811771 | 426536376 | `e463ff1afc3c0ee4ab2b3b9ded4247a98e4eed85b6f2db6c4a1cd3a8a31988dc` |
| `Homer-mac-x64.zip` | 754843230 | 395455710 | `3551e365ce01e1184ea4d564f6ef118a63df9df23c81c17039c890b615865cbb` |
| `Homer-windows-x64.exe` | 754867964 | 305269212 | `3d33e0ad3e0b699542dab9012d02ef812f871080e18bebbef070cbf021346a2f` |
| `RELEASES-darwin-arm64.json` | 754812477 | 319 | `8d6a6ca84b7f6ea483e498242ad0d804762fd86aa84177215fbd2858895b55b0` |
| `RELEASES-darwin-x64.json` | 754843889 | 317 | `b47db41121c66bd5d0083a6e877dd88f510f6d005d56870389a49fd1a80ad600` |
| `SHA256SUMS` | 754871561 | 519 | `117f3bf3e3a3c76044c0ab99013149cb91d4aad8eba4e4ab2abc75b5ecebdb8d` |
| `latest.yml` | 754868475 | 484 | `df2f0ebf0ba06958a7edddfe61592e36b9f86360881cedd2556cdb69ed5ae8c0` |
| `release-manifest-macos-arm64.json` | 754812533 | 977 | `cfad75a07fb9c0cb5d1d9e7fbf9d89d40880ea177ab34d1d716cb03d0bfa85c4` |
| `release-manifest-macos-x64.json` | 754843946 | 963 | `ef12b5ce533a6d75a2911e61adeaeb74f77d7f4c815f63fd7f5ee99ff93acd43` |
| `release-manifest-windows-x64.json` | 754868539 | 961 | `41071c9540b1f08adb3934dea811aa8303638a1f2b1065d524154da31b78cd3b` |
| `release-manifest.json` | 754871608 | 2643 | `d5247b50a87e53e9ed16c6730d74844192fd28d15c5e08f39155014f0b5b6582` |

### 保留的原 Latest 附件基线

v0.1.15 / Release ID 445981017。

| 附件 | ID | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `Homer-mac-arm64.zip` | 750658359 | 409853535 | `aa20f2657881d6a8268195e82c1fe560105949ccab9d9476d4e3a98cf0fc49f9` |
| `Homer-mac-x64.zip` | 750681494 | 377868390 | `2ecf6f6e7b6fc8ef9712e8fa6c9d423eb78ba9977d1c2ffbeb62d07894fc7195` |
| `Homer-windows-x64.exe` | 750701980 | 291064723 | `bd18ca45a8e4b5addf9d9ba74124581b9f3e5f7311660a2c76796fa80126e960` |
| `RELEASES-darwin-arm64.json` | 750659845 | 319 | `cc08ef8947d05b862062ba48979dc114b63d44faf89323cf285a809097b7009e` |
| `RELEASES-darwin-x64.json` | 750682316 | 317 | `de8ef9a55318ceb31ae2b9ed0e87b6e26943883354cc9a0c8148e3e4b28e743b` |
| `SHA256SUMS` | 750703613 | 519 | `3f7f7eb425f2cc78ec95ad411ded16713c58f9be7c8a3787f9d048a20ce2d550` |
| `latest.yml` | 750702277 | 484 | `b1b07f8df35d01bd7a9516845089d6ec7870aed3accd8a23b36eaae7a114ea1e` |
| `release-manifest-macos-arm64.json` | 750659893 | 977 | `83c63435999d7951ac2b3ac96e6f7c770163cb2a835cae2db2632c080bbf8071` |
| `release-manifest-macos-x64.json` | 750682387 | 963 | `ff147fc48b79eb987180674efbaffa7b2e393431ddfd35dc05199ce379ff3171` |
| `release-manifest-windows-x64.json` | 750702296 | 961 | `003ea657b5e2ef9b66fa735753126f3bb8e22eaa3f9c3d6aada26151680aef54` |
| `release-manifest.json` | 750703641 | 2643 | `cde0c479d198b5fac17c455167c4fa7f57b57f2460167f7815056ce616839420` |

## 发布后匿名分发核验

- 固定标签匿名 API 回读为 v0.1.16 / Release ID 447024680，draft=false、prerelease=false，双语正文逐字一致。11 个附件的名称、ID、大小及 digest 与公开前基线一致，复用本轮云端完整下载 SHA-256 证据。
- 本版固定标签及原 Latest 三平台大包各匿名 GET 起始 1024 字节，共 6 次均返回 206，Content-Range 总大小、文件名及样本长度符合基线。Latest 三条直链均经过 v0.1.15 同名固定标签 URL。
- 本版固定标签与原 Latest 各 8 个小附件共 16 次匿名完整下载，大小及 SHA-256 均符合 API 基线；SHA256SUMS、合并/平台清单及原生更新清单互相一致。
- Latest 继续为 v0.1.15 / Release ID 445981017，11 个附件身份、大小及 digest 与发布前基线完全一致。官网和采用 Latest 的客户端继续交付 v0.1.15；本版通过固定标签交付。
- Intel / Windows 实机、全部平台完整原生自动升级、真实模型及实际睡眠唤醒仍未验收，未将云端构建或 ARM 合成运行替代这些证据。

## 本机安装阻塞及保留材料

公开后再次只读复核日常正式包仍为 v0.1.15 / build 300，安装版实际持久化安全升级检查仍为 false，具体为 1 条 unknown 原生工具执行状态。未擅自确认、取消或改写该状态，未强停、清队列、删锁、安全退出、停机备份或替换日常应用；不能声称本机安装及原资料迁移核验完成。当前还需在安全退出前确认草稿及待生效配置。该阻塞需由日常流程确认原生执行状态，不是缺少安装授权。

保留 `.codex/scratch/github-build/43867816956/1/Homer-mac-arm64.zip`、ARM 原始小回执、合并清单和 SHA256SUMS，供阻塞消除后按同一来源/字节安装；不重新下载或改包。安装和原资料核验完成，或明确不再需要本机安装后回收。未产生本轮停机资料备份。

## 本轮收尾

按 work-cleanup 核对本轮目录无打开文件后，回收隔离源码快照、三轮合成 profile 及解压 App，共约 1,220,751,360 分配字节；该数字不等同于 APFS 可用空间变化。协议测试 fixture 自行回收。公开来源、全部附件摘要、失败原因及最终验收结论已在本记录、固定 Release 和 Git/Actions 留存；其余临时日志、脚本和重复小清单在核对后回收，仅保留上节安装材料。未操作日常资料、其他任务工作区、历史安装备份、旧标签或草稿。
