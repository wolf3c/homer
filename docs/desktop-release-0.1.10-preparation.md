# Homer 桌面 v0.1.10 发行记录

状态：2026-11-12，v0.1.10 / build 295 已公开，Latest 按本轮授权保持 v0.1.8。三平台构建及云端完整校验通过，Apple 芯片隔离验收范围见下文。

- 本轮用户要求先补全修复、确认真实构建器输出契约，再继续三平台构建。沿用已授权的提交、推送、创建标签、Mac 签名公证、草稿直传和 Apple 芯片隔离验收范围。保留 v0.1.9 的失败标签与六个草稿附件，不覆盖、不混入新轮。
- 产品版本 0.1.10，显式 build 295；上一公开版 v0.1.8 / 293，本轮失败候选 v0.1.9 / 294。
- 三平台：Apple 芯片 Mac / macOS 27、Intel Mac / macOS 14、Windows x64 / Windows 11。Mac Developer ID 签名、公证及 stapling；Windows 未签名。
- 网站 `https://super-tree.com`，网关 `https://models.super-tree.com`。原生更新来源 GitHub Latest，安装器引用固定标签。公开及 Latest 仍需另行授权；Intel、Windows 实机与原生升级尚未验收。

## Windows 修复与契约检查

锁定的 electron-builder / app-builder-lib 26.18.0 在关闭 differentialPackage 后，非差分 NSIS 路径不提供自定义 updateInfo。实际 createUpdateInfoTasks 和 writeUpdateInfoFiles 生成的 latest.yml 包含文件名与实际 SHA-512，但 files[0] 没有 size。专项直接调用安装依赖中的这两个函数，写出并重新解析 YAML，再交给 Homer；未模拟生成器或手写其输出。安装器输入为合成字节，不把这个专项称为真实 NSIS 安装验收。

Homer 先核对安装器 SHA-512，再将实际读取字节数写入清单；已有错误长度、错误摘要、错误文件引用及提权标记仍拒绝。校验错误使用固定字段标识，不打印清单内容或路径。Windows 云端在打包前运行同一契约专项。测试已登记在现有 development 清单，无需扩大默认测试。

本地验证：

- `node --test --test-name-pattern='real electron-builder' tests/electron-package.development.test.mjs`：真实生成器契约及 YAML 往返通过。错误字段诊断断言先失败后通过。
- `node --test tests/electron-package.test.mjs tests/github-release-draft.test.mjs tests/github-build-plan.test.mjs`：41 项通过。
- 模板一致、版本元数据一致与 git diff --check 通过。

以下执行证据来自本轮实际产物，不沿用旧轮产品验收。

## 本轮执行证据

- 源码、远端 main 和标签 v0.1.10 均为 `93dcab106dbd78df2df1bea77f5ddc72446587c9`；推送后回读核对，远端工作流与本地 SHA-256 一致。
- [运行 43167908086 / attempt 1](https://github.com/wolf3c/homer/actions/runs/43167908086/attempts/1)，操作者 wolf3c，2026-11-12 14:24:21（Asia/Shanghai）触发；三平台桌面、build 295、草稿直传。
- Apple 芯片包 `Homer-mac-arm64.zip`：409625334 字节，SHA-256 `bceca90edf71c56ab83613984eb47d408e56fcc19b94655b5c0548c028b54fba`，本机完整下载、回执及平台清单一致。包内 manifest 和回执中的版本、build、SHA、正式包标记及双服务地址一致。
- macOS 27.2 / arm64：codesign 深度严格校验、stapler 和 Gatekeeper 通过，后者报告 Notarized Developer ID。没有替换日常安装。
- 实际 Electron 的四项隔离合成验收全部通过、无失败或跳过：发送及重启、未连接账号只读、完整进程崩溃后的原线程与附件恢复、SILK 预览及访问限制；退出锁及 lease 释放断言通过。临时入口仅适配首启导览关闭和 fixture 路径，选择实际 Electron 场景，不运行要求本地回环服务的 daily 专项。会话实际截图已查看。
- 正式包双服务地址、批注运行时和 notices 两项定向检查通过。真实账号、付费模型、原生升级及 Intel / Windows 目标设备仍未验收。

## 完整构建与草稿校验结果

规划、三平台构建和 verify-draft 全部 success，attempt 保持 1。Windows runner 的真实 electron-builder 契约步骤在完整打包前通过；NSIS 安装器生成、windowsRelease 校验与草稿上传均成功，未再触发旧错误。最终云端完整流式下载三平台包及更新清单，比对大小和 SHA-256 后完成合并清单与摘要上传。

| 平台 | 固定附件 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| macos-arm64 | `Homer-mac-arm64.zip` | 409625334 | `bceca90edf71c56ab83613984eb47d408e56fcc19b94655b5c0548c028b54fba` |
| macos-x64 | `Homer-mac-x64.zip` | 377630468 | `b835619478dde59e6408fb320a1d5a2cacfb737a7adacd8472da2394a35bc903` |
| windows-x64 | `Homer-windows-x64.exe` | 291069771 | `e9ad51824196233405f6db18549dac6b901ad5db446de81c5b9daebbe056e5a1` |

三份回执、平台清单、合并清单及 GitHub 附件 API 摘要一致，11 个附件齐全；本机回读小清单及三份原生清单并复核摘要，未下载 Intel 或 Windows 安装器，其完整下载证据来自本轮云端校验。

Windows latest.yml 的 files[0].size 为 291069771，files[0].url 与兼容 path 均指向 v0.1.10 固定名 EXE，SHA-512 保留；非差分缺失大小契约已由真实生成器专项和本轮完整 Windows 构建共同验证。Windows 回执明确未签名；Intel 回执为 macOS 14.0、Developer ID、公证与 stapling。两者版本、build、来源及双服务地址一致。

草稿中英文说明已更新并逐字回读核对，包含系统要求、安装方法、签名及未验收边界。草稿验收完成时 Latest 回读为 v0.1.8 / Release ID 441835374，当时尚未公开草稿；后续公开结果见下节。缺少各平台真实原生升级证据，Latest 保持旧版，未部署官网。

收尾回收本轮下载 ZIP、解压 App、合成 profile、临时验收入口及重复回执；需要时从草稿重新下载。保留本记录和 Git 中的验证入口，不修改日常安装、数据或其他任务的工作。

## 公开发布并保持旧 Latest（2026-11-12）

用户确认公开同一 v0.1.10 草稿，并保持 Latest 为 v0.1.8。本轮通过 `gh release edit v0.1.10 --verify-tag --draft=false --prerelease=false --latest=false` 公开原 Release，未重传附件、移动标签或部署官网。

- [v0.1.10 固定版本页面](https://github.com/wolf3c/homer/releases/tag/v0.1.10)：Release ID 442573313，draft=false、prerelease=false；与构建及验收草稿身份相同。
- 发布前后通过认证 API 核对：11 个附件的节点 ID 保持一致，安装包与三份更新清单的大小及 SHA-256 与本轮云端完整校验清单一致。复用本轮 verify-draft 全量下载证据，未在发布后重复下载大包。
- 原 Latest 为 v0.1.8 / Release ID 441835374。发布前后认证 API 的标签、ID 和 10 个附件 ID、大小及摘要与原基线一致；原基线同时与 v0.1.8 发行记录核对。
- 匿名 GET 范围抽查共六项通过：本版三平台固定标签链接，以及原 Latest 三平台入口。读取前确认 206、Content-Range 总大小和文件名，实际读取各 1024 字节；Latest 三条链接均经过 v0.1.8 的对应固定标签链接。匿名固定版本页面可访问，Latest 页面最终仍为 v0.1.8。
- SHA256SUMS、release-manifest.json、两份 Mac 原生清单和 Windows latest.yml 共五份附件匿名完整下载，大小及 SHA-256 均匹配。合并清单的来源为 93dcab106dbd78df2df1bea77f5ddc72446587c9 / run 43167908086 / attempt 1 / build 295。
- 匿名 GitHub API 返回 403 / rate-limit remaining=0，因此发布前后匿名 API 元数据复核未完成；没有把该项记为通过。元数据采用认证 API，比对之外的公开可访问性、大小与实际清单字节由上述匿名页面及下载验证。

### 公开附件基线

| 附件 | ID | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `Homer-mac-arm64.zip` | 738355524 | 409625334 | `bceca90edf71c56ab83613984eb47d408e56fcc19b94655b5c0548c028b54fba` |
| `Homer-mac-x64.zip` | 738385916 | 377630468 | `b835619478dde59e6408fb320a1d5a2cacfb737a7adacd8472da2394a35bc903` |
| `Homer-windows-x64.exe` | 738406830 | 291069771 | `e9ad51824196233405f6db18549dac6b901ad5db446de81c5b9daebbe056e5a1` |
| `latest.yml` | 738407084 | 484 | `f472fb8b9014d3da9553656ee10d49ae754762173b7c89fbaea4e573c63776d8` |
| `release-manifest-macos-arm64.json` | 738356204 | 977 | `300e6b74b355f02ad9baacf16cf2ea97131a16a7c0407c7767dbd00128b0bfa9` |
| `release-manifest-macos-x64.json` | 738386610 | 963 | `b54141ed94c8ae89b72463f58171ef3fd99a760da5c9dc83f6340e38ff360c65` |
| `release-manifest-windows-x64.json` | 738407107 | 961 | `855306947398fdf020d2fba2efb21a980b3189b39153f148ae4e32b663a1d4ff` |
| `release-manifest.json` | 738409254 | 2643 | `93dae3168af965168082f8eb70747a71bacbb8be57a99d435872d7da56ff6f2c` |
| `RELEASES-darwin-arm64.json` | 738356153 | 319 | `25d5753cdca9d3d53939ba26b15c333f48a0f5039b60aca701d21b8463a7fd39` |
| `RELEASES-darwin-x64.json` | 738386547 | 317 | `987bb4b82d5fa2ff233a29112206eb282aac47751fbb8e3862fc662b44e39a46` |
| `SHA256SUMS` | 738409219 | 519 | `6ee38b90b20d1663d7fe81b73a7c24dcaea54cf89d38f117534b87069d63300a` |

本版下载请使用固定版本页面或其安装包链接；官网和 README 的 Latest 入口仍提供 v0.1.8。Intel / Windows 实机、真实账号及原生升级未增加验收证据。本记录按用户要求单独提交；并行任务的提交及未提交工作不纳入本次记录提交。
