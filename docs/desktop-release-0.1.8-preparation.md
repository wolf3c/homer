# Homer 桌面 v0.1.8 发行记录

发行日期：2026-11-11；收尾复核：2026-11-12。`v0.1.8` / build `293` 已正式发布并设为 Latest，三平台构建及云端完整校验通过，Apple 芯片包完成下文限定的隔离验收。官网手动下载配置已在 Yezi2 本地更新，本轮未执行官网部署或线上验收；Intel / Windows 实机及真实账号、模型仍未验收。本记录可公开；不包含账号、凭据或原始运行内容。

以下「范围与输入」至「确认后执行」保留 2026-11-11 的准备阶段快照，其中的待确认、未提交及旧 Latest 均为当时状态；实际执行和最终状态见后续记录。

## 范围与输入

| 输入 | 准备值 |
| --- | --- |
| 仓库 / ref | `wolf3c/homer` / `main` |
| 类型 / 平台 | `kind=desktop` / `target=desktop-three` |
| 标签 / 构建号 | `release_tag=v0.1.8` / `build_number=293` |
| 草稿上传 | `upload_release_draft=true`，待确认后执行 |
| 网站 / 网关 | `https://super-tree.com` / `https://models.super-tree.com` |
| Node | `.nvmrc` 指定的 `22.22.0` |
| 系统基线 | Apple 芯片 macOS 27.0；Intel macOS 14.0；Windows 11 x64 |
| 签名 | Mac Developer ID、公证及 stapling；Windows 未签名，自动更新关闭 |
| 产品验收 | 仅 Apple 芯片 Mac，使用独立资料；Intel / Windows 保留未实机验收状态 |

Linux 桌面尚未适配，不加入矩阵。移动端版本、日常安装、生产网站、自动更新入口与 Latest 变更不在本轮准备范围。

## 源码与版本

- 准备基线为本地 `main` 的 `1f1009f52916b04e80daf6ac76becbb113c89746`。开始准备时工作区干净。
- 远端 `main` 只读回查为 `e22d6ddd9e01dc08cb12d6d0ac19261f50ee1a29`；本地领先 5 个提交、落后 0 个。后续按[仓库公开与同步](repository-publication.md)完整同步已提交的共享主线，不创建第二套公开文件树。
- 准备时 Latest 为 [v0.1.7](https://github.com/wolf3c/homer/releases/tag/v0.1.7)，Release ID `440535806`，源码为 `6a5d1edc2aaaff5a8764007fab1afc9f823d6385`，build `292`。当时本机 `/Applications/Homer.app` 的 `CFBundleVersion` 同为 `292`，拟用 `293` 满足递增要求。
- 根 `package.json.version`、锁文件顶层及根 package 版本更新为 `0.1.8`；依赖与锁定字节不变，UI workspace 与移动端不改版本。
- 远端标签列表未发现 `v0.1.8`，Release 列表中也无此版本。本轮没有创建标签或草稿。
- 版本变更尚未提交，因此准备基线不能直接作为构建的 `expected_sha`。执行前必须提交获准的准备文件、同步并回读最终完整 SHA；标签与 dispatch 均绑定该 SHA。

上版至本地准备基线的产品相关路径（`src`、`ui`、`scripts`、`packaging`、`tests`、`prompts`、根版本文件）差异共 75 个文件。不能将远端领先的 5 个本地提交等同于全部发行差异；共享主线整合已包含上版之后的其他产品变化。待核实的更新说明包括独立 ChatGPT 模型设置，以及会话展示、交互和 Cua 路径变化。最终双语 Release 正文应对照完整差异及本次安装包验收编写，不能把源码变化当成已验收效果。

## 准备检查

- 仓库默认分支为 `main`，当前身份权限为 `ADMIN`。`homer-build.yml` 在远端默认分支存在，状态 `active`；远端文件、本地工作流与维护模板一致。
- 工作流仅允许手动触发；checkout 固定 `github.sha`，规划入口核对 `expected_sha`。同标签排队，不取消上传中的运行。
- YAML 解析、12 段 shell 的 `bash -n`、9 处完整 SHA 固定的 Actions 引用通过。工作流 SHA-256：`f696bda20603ae9f752f64c74d37c12b21dcbb8ea7e7c6d6a7857123d973211d`。
- 构建、依赖准备、运行时、来源冻结和 Electron 配置入口存在；工作流显式传入双服务地址、发行标签、构建号、Intel 最低 macOS 14 与 Windows 未签名参数。
- 三平台 Node 归档具有固定 SHA-256，Codex 归档具有 SRI；随源码的 Codex 许可原字节与锁定摘要一致。没有下载归档、安装原生依赖或验证 runner 工具链。
- Mac 证书及公证所需 Secrets 名称存在；未读取其值，证书有效期与真实签名待构建验证。
- 本地 Node `22.22.0` 下执行 `node --test tests/github-build-plan.test.mjs tests/github-release-draft.test.mjs`：21 项通过，0 失败、0 跳过。仅使用合成 GitHub 协议、临时文件和回环 HTTP，未调用真实上传或构建。
- 版本一致性、锁文件仅两处版本变化及模板同步断言通过。本轮不改变产品行为，无需新增测试。

## 确认后执行

1. 获准后审查并提交本轮版本及准备材料，完整推送 `main`，回读远端完整 SHA；再次核对版本、build、标签占用与工作流状态。
2. 在创建标签、Mac 正式签名及草稿上传均获准的前提下，创建不可变 `v0.1.8` 标签并确认它解析到同一 SHA。
3. 按上表 dispatch 一轮三平台桌面构建，记录 run ID / attempt；跟踪三平台打包、直传草稿及 `verify-draft` 云端完整下载摘要校验。
4. 只下载 Apple 芯片包，核对回执与包内 manifest 的版本、build、SHA、双服务地址、签名及来源，在独立资料下验收。Intel / Windows 不标记实机通过，Windows Cua 的签名候选验收条件仍未满足。
5. 草稿与验收完成后报告结果。公开 Release、Latest、官网及部署按各自授权推进，不由构建默认参数推定授权。

准备阶段没有提交、推送、创建标签、触发工作流、构建、签名、上传、安装或发布。没有产品编译、全量回归、真实模型或外部通信验收；静态准备通过不代表三平台安装包可用。

## 执行授权（2026-11-11）

用户在准备完成后确认提交并同步准备内容、创建 `v0.1.8` 标签、执行 build `293` 三平台构建（Mac 正式签名及公证）并上传草稿。后续跟进云端校验与 Apple 芯片包验收；不公开 Release、不变更 Latest。下方执行记录以实际结果补齐。

## 执行记录

- 构建启动时，准备提交、远端 `main` 与不可变标签 `v0.1.8` 均为 `493a314e444ff2497d8a3c86e21e5669216e932d`，原子推送后已回读核对。先前领先的 5 个提交随完整主线同步；后续文档提交不改变该标签或安装包来源。
- [Actions 运行 43042241105 / attempt 1](https://github.com/wolf3c/homer/actions/runs/43042241105/attempts/1)，操作者 `wolf3c`，ref `v0.1.8`，触发时间为 2026-11-11 22:49:40（Asia/Shanghai）。运行 SHA 与上述提交一致，输入为三平台桌面 build `293`、草稿上传开启。
- 规划、三个打包 job、草稿直传及 `verify-draft` 全部通过，attempt 保持 `1`。Apple 芯片包验收范围见下节，不以工作流绿色代替目标设备验收。
- 执行前针对本次模型设置增量运行 `node --experimental-vm-modules --import tsx --test tests/model-config.test.ts tests/desktop-profile.test.mjs tests/desktop-permissions-ui.test.mjs tests/model-selector-upstream.test.mjs`：222 项通过，0 失败、0 跳过；均为隔离离线检查，不调用真实账号或模型。

### Apple 芯片包验收

草稿 ID 为 `441835374`。Apple 芯片包来自本次 run / attempt，固定附件为 `Homer-mac-arm64.zip`，大小 `409621096` 字节，SHA-256 为 `abf8c12ca7974757b0b3685f0528e04d4145e73a581445a7234f75946c424a7e`。回执、平台清单、GitHub 附件摘要及本机完整下载计算一致。包内 manifest 与回执的版本 `0.1.8`、build `293`、来源 SHA、架构、`preparation=false`、`publishable=true` 及双服务地址一致。

在 macOS 27.2 / ARM64 下直接解压到本轮 scratch 验收，未替换日常安装。`codesign --verify --deep --strict`、`xcrun stapler validate`、`spctl --assess --type execute` 通过，后者报告 `Notarized Developer ID`。随包 Cua Driver 启动并报告 `0.46.1`；未执行真实系统输入或截图权限操作。

- 包内双服务地址、批注运行时及完整第三方 notices 两项定向检查通过。
- 沿用 `tests/electron-desktop.test.mjs` 的四项实际 Electron 断言，临时入口只补实际关闭首启导览的操作：会话发送与重启、未连接账号只读、完整进程崩溃后的原线程及附件恢复、SILK 预览及权限均通过。通过原退出菜单正常结束，锁与 lease 释放断言通过。仅使用合成账号和本地协议替身，没有付费模型或外部通信。
- 正式包的 ChatGPT 设置通过实际窗口检查：模型列表读取、Homer 改选而 Worker 不变、应用按钮状态、恢复默认、390px 无页面横向溢出及关于页面版本。使用本地合成目录，未点击应用并重启或验证真实套餐资格。初版临时脚本因未指定 `--native` 没进入账号支持路径，随后因多余 Escape 关闭整个设置而超时；分别修正启动参数和操作顺序后同一包通过，未修改产品或测试断言。
- 已人工查看会话及桌面／390px 模型设置截图。真实登录、真实模型、真实旧资料升级、交互式 Cua、Intel Mac 与 Windows 目标环境仍未验收。

### 三平台草稿校验与收尾

云端 `verify-draft` 完整流式下载全部请求平台附件，比对大小和 SHA-256，并上传合并清单与 `SHA256SUMS`，最终运行结论为 `success`。草稿共 10 个附件。三平台回执、平台清单、合并清单及附件 API 元数据对应同一源码 SHA、run `43042241105` / attempt `1`；本机回读并校验小清单、摘要及两份 Mac 更新清单一致。Intel / Windows 安装器没有下载到本机，不标记本机完整下载或安装验收；其完整下载证据来自同轮云端校验。

| 平台 | 附件 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| Apple 芯片 Mac | `Homer-mac-arm64.zip` | 409621096 | `abf8c12ca7974757b0b3685f0528e04d4145e73a581445a7234f75946c424a7e` |
| Intel Mac | `Homer-mac-x64.zip` | 377626200 | `890e828cd1f5c60f1fb206ab65faa440b92c05206d79a079a7cc632ff56da1fe` |
| Windows x64 | `Homer-windows-x64.exe` | 291000164 | `5097361db77c7a74a0ad5eba235fa0e662b36e8dbbc3b7c5bbff4bf3394bed50` |

Intel 回执为 macOS 14.0、Developer ID、公证及 stapling；Windows 回执为未签名、禁用自动更新。两者的版本、build、来源、正式包标记及双服务地址均核对一致。Windows Cua 的签名候选验收条件仍不满足。

草稿阶段的中英文用户更新说明已写入并回读核对，包含系统、安装及验收缺口。当时 Release ID `441835374` 为 `draft=true`，Latest 为 v0.1.7 / ID `440535806`；该阶段尚未公开发布、变更 Latest 或交接官网，未替换日常安装。后续公开操作见下节，草稿阶段不作为公开下载入口。

草稿验收结束时，测试进程已退出，清理约 `1011809977` 逻辑字节的解压 App 和合成测试资料。当时暂存的原始 Apple 芯片签名 ZIP、小回执／清单、检查输出及三张合成截图，已在后续公开分发与交接完成后回收，见末节。本记录是可公开的长期依据，临时文件不作为唯一验证来源。

## 正式发布与分发核验（2026-11-11）

用户在获知 Intel / Windows 未实机验收、Windows 未签名及真实账号／模型未验证的边界后，确认公开同一草稿并将 Latest 从 v0.1.7 切到 v0.1.8。没有扩大到官网部署或自动更新配置变更。

- 原 Latest 由匿名公开 API 确认为 v0.1.7 / Release ID `440535806`，发布前保存其附件 ID、大小和摘要基线。本次发布前附件基线为本节上方三平台表及同轮云端校验证据，Release ID `441835374`。
- [v0.1.8 正式 Release](https://github.com/wolf3c/homer/releases/tag/v0.1.8) 已于 2026-11-11 23:20:29（Asia/Shanghai）公开，`draft=false`、`prerelease=false`；Latest 匿名回读为同一 ID `441835374` / 标签 `v0.1.8`。
- 发布前后 10 个附件的名称、ID、字节数及 `digest` 完全一致，因此复用同一 run / attempt 的完整云端 SHA-256 校验，不重新上传或重打包。标签仍解析到 `493a314e444ff2497d8a3c86e21e5669216e932d`。
- 三个平台的固定标签直链及 Latest 直链共 6 项匿名 GET 范围抽查全部通过：请求 `bytes=0-1023`，返回 `206`、正确文件名和 `Content-Range` 总大小，实际读取各 1024 字节。三项 Latest 链接均经过对应 v0.1.8 固定标签链接。
- 匿名完整下载 `SHA256SUMS`、`release-manifest.json` 及两份 Mac 更新清单，与草稿阶段文件原字节及附件摘要一致。版本页匿名可访问，中英文 Release 正文公开后回读一致；已去除草稿阶段措辞。
- 固定下载地址为 `https://github.com/wolf3c/homer/releases/download/v0.1.8/` 加上方对应附件名；[Latest 页面](https://github.com/wolf3c/homer/releases/latest)现指向本版。仅复用标准 GitHub 地址，不保存临时签名重定向地址。

Release 分发核验通过；后续已完成 Yezi2 本地交接与渲染验收，见末节。本轮未执行网站生产部署或线上版本切换。

### 发布前后附件元数据基线

以下为匿名回读的非敏感元数据快照；完整下载证据沿用上方同轮云端校验，发布后执行的是范围抽查和小清单完整比对。

原 Latest v0.1.7 / 440535806：

| 附件 | ID | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `Homer-mac-arm64.zip` | 731907808 | 388067432 | `afb6a86fe232a47c519658b50760dff4773bf7c87345d4004307af00f8e10844` |
| `Homer-mac-x64.zip` | 731940326 | 356074614 | `a79c616b6300de35e291e01568ea559fe37168f01e25c444e41f2fe21cfafc51` |
| `Homer-windows-x64.exe` | 731970053 | 271016010 | `817dffe03e06df502b1671f9ccafb06fbb328ca286ed4af60ba07c3d28ba5880` |
| `release-manifest-macos-arm64.json` | 731909153 | 973 | `d7a6afd08f7af70635caca67a3cb1b6ebffe67527be1d372b79d00a515dd2b37` |
| `release-manifest-macos-x64.json` | 731941724 | 959 | `63b5361af300389a87c48fd7a98af7133887b00d1e45e507d0a44da61242bd16` |
| `release-manifest-windows-x64.json` | 731970561 | 704 | `dc60b16ef77ced94256b9202b80ad6b4272b52d3180b78387d939b53ea829ee8` |
| `release-manifest.json` | 731972377 | 2354 | `a68d906ea1c321d82371808b54577a48e8531da99c929787e8d60d0ce9223699` |
| `RELEASES-darwin-arm64.json` | 731909096 | 314 | `2c4352679cf8df3e62c9b309ff3c0b3bc06093370d0bd52ac84cb2904790881d` |
| `RELEASES-darwin-x64.json` | 731941652 | 312 | `48704eaf6fb34bb4e959fa6b537d23bf7ed3cab18b241cf170f2859fd4e4acb9` |
| `SHA256SUMS` | 731972281 | 442 | `c8ad8a0b65e3786581e2eeafbbf39bf9b99aa89ed2e594f0ca0ab7be4c359e97` |

本次 v0.1.8 / 441835374（公开前后相同）：

| 附件 | ID | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `Homer-mac-arm64.zip` | 735881549 | 409621096 | `abf8c12ca7974757b0b3685f0528e04d4145e73a581445a7234f75946c424a7e` |
| `Homer-mac-x64.zip` | 735904620 | 377626200 | `890e828cd1f5c60f1fb206ab65faa440b92c05206d79a079a7cc632ff56da1fe` |
| `Homer-windows-x64.exe` | 735924149 | 291000164 | `5097361db77c7a74a0ad5eba235fa0e662b36e8dbbc3b7c5bbff4bf3394bed50` |
| `release-manifest-macos-arm64.json` | 735882178 | 973 | `fa9bac27aaaaf82982fd3cca47afa52f31578b52bbb31dde5968f074a1a6f52a` |
| `release-manifest-macos-x64.json` | 735905148 | 959 | `b35bc7b8f62efa414e8e19b4378a3cdb6ac3290c0e50efdae996aa2b55d5c0db` |
| `release-manifest-windows-x64.json` | 735924724 | 704 | `154def9baf83c7fec01a97f2691fe227fb43f64b2f4d0b6126f6b21a5676cdc4` |
| `release-manifest.json` | 735927557 | 2354 | `bf82f3b239ce445b5518d67fa364e12cb751360df97907287a24b31b0ff05d0b` |
| `RELEASES-darwin-arm64.json` | 735882135 | 314 | `d224ef1ff036a68dec46a823b78b379e572b25254f4d43b6a55e835bd186dd9e` |
| `RELEASES-darwin-x64.json` | 735905105 | 312 | `5f1c8d0d17d4efb1ef1f4ade7537b763670703bf3046c4b976da52e11dc7dde7` |
| `SHA256SUMS` | 735927511 | 442 | `676be0481126779794e8815853f5d702ae7c8ffcc3fa97bb4f57208be81d8159` |

中英文 README 的安装区对齐 v0.1.8 / build 293 和已核验的固定标签下载链接，与本记录一并纳入发行收尾提交；本次收尾不推送。

### Yezi2 本地交接与资源收尾

已恢复既有聊天「Yezi2：实现 Homer 移动 App 连接服务并联调」并交接本版手动下载配置。对方完成 `imports/ui/Homer/desktopReleases.js` 的两个常量更新，版本为 `0.1.8`、build 为 `293`，链接仍由现有规则生成。设备识别测试 2 项通过；对方报告中英文桌面及 390px 下载菜单实际渲染通过。协调方回读源码和差异，确认最终配置提交 `cd833dd6a030d66ddb4e9655c041efe3f3a2511c` 只含这两个值，其他聊天的首页样式等未提交工作仍保留。用户当天删除的旧资料查看提示没有恢复。

交接聊天误沿用历史提交授权创建了该本地提交，超出本轮“不提交”的交接要求；用户于 2026-11-12 明确确认保留。此处记录的是本版实际经过，不作为后续授权或聊天路由依据；现行 Skill 已改为新版本新建交接聊天、同版本复用。

官网未部署，生产页面没有执行本轮版本切换或线上验收；自动更新和移动端配置未调整。正式公开分发、本地官网接入验收已完成，网站上线仍需单独授权。

公开分发核验与官网交接完成后，回收本轮 `.codex/scratch/github-build/43042241105/`：原始公开 ZIP、剩余小回执、脚本、日志、截图及临时基线合计 `410020101` 逻辑字节。此前解压 App 和合成资料已回收 `1011809977` 逻辑字节，合计约 1.42 GB；不以全盘剩余空间变化推断本任务实际释放量。本轮未替换日常 Homer，未清理其他任务资源。可重复验证入口留在项目测试和工作流，发行来源、摘要、基线、运行与验收边界留在本记录，公开原包可从固定标签重新获取。

2026-11-12 收尾复核：GitHub 的固定标签 Release 与 Latest 均回读为 ID `441835374` / v0.1.8，10 个附件的 ID、大小及 SHA-256 与上表一致；标签仍指向构建源码，run / attempt 结论为成功。本次仅复核元数据及文档，不重新下载大包、重跑产品验收或操作发布。
