# Homer 桌面 0.1.25 发行准备

2026-11-24，build 313。候选包含 [v0.1.24 / build 312](https://github.com/wolf3c/homer/releases/tag/v0.1.24) 之后本地 main 的 20 个已提交改动，截止 `3ca7fc5adb7f52c17e87b448f7a73f38a252b5ca`。合并了远端 Android build 9 更新清单提交 `47f82e8f6eaa73eef8f4b410035ed2687d670e57`，该提交的三个文件逐字节保留。正式源码以 `v0.1.25` 解析的完整提交 SHA 为准。

## 构建和验收

- 使用 GitHub Actions 的 `desktop-three`。Apple 芯片 Mac 需要 macOS 27 及以上，Intel Mac 需要 macOS 14 及以上，Windows 需要 Windows 11 x64。Mac 使用 Developer ID 签名及 Apple 公证，Windows 使用未签名的 NSIS 安装器。
- 构建使用 `https://super-tree.com` 和 `https://models.super-tree.com`。三平台使用相同的源码、版本和 build，直接上传同一草稿并在云端回下载核对来源、大小和 SHA-256。
- 实机安装、原生自动升级和日常安装分别核验。准备时 GitHub Latest 及本机安装均为 0.1.24 / build 312。
- macOS 原生更新的唤醒清理使用本版源码中的新核对流程。进入原生安装前仍需确认安全停止，既有注销要求继续生效。签名包的真实原生升级及日常安装未验收。
- 用户更新说明维护于 GitHub Release 正文。构建、签名、各平台验收和公开分发证据在实际取得后补记。

## 固定源码、构建和草稿证据

- `v0.1.25` 固定源码为 `35502cfa05f30d2ed59516988b6117e996c7005a`。本地与远端已提交内容通过合并提交 `081d913` 汇合，再提交桌面版本元数据。远端 `main` 和标签均回读为构建 SHA。合并后的 Android 更新清单仍提供 build 9，固定 APK 下载地址和摘要一致。
- [GitHub Actions 45392296371，第 1 次构建](https://github.com/wolf3c/homer/actions/runs/45392296371/attempts/1) 的规划、三平台打包和 `verify-draft` 均通过。草稿 ID 为 `456731527`，包含 11 个附件。合并清单、八个小附件的实收摘要、各平台包的 GitHub 附件元数据及三份原生更新入口均已复核。工作流在云端完整回下载安装包并校验 SHA-256。
- 三份原始构建回执的源码、版本、build、正式包标记与网站及网关地址一致。29 项构建规划和草稿协议测试、88 项唤醒与安全停止定向用例均零失败、零跳过。

| 产物 | 字节数 | SHA-256 | 签名 |
| --- | ---: | --- | --- |
| Homer-mac-arm64.zip | 432462038 | `c6639353ce6d3b0275c673a2d5a6a24e87fee7f2b06569a257490d557b84a4b9` | Developer ID，已公证，已附公证票据 |
| Homer-mac-x64.zip | 401380253 | `3c03c9fe5eb0e023ed477df1e869bf64c87b51e55f50211cf904898bf17e84bc` | Developer ID，已公证，已附公证票据 |
| Homer-windows-x64.exe | 305568568 | `64adc83629ec20304c030325c9f8ea5df6a9c5b513ef1f725406d1ab15571661` | 未签名 NSIS |

## Apple 芯片 Mac 隔离验收

在 macOS 27.2 ARM64 完整下载草稿 ZIP，并按构建回执复核 SHA-256、正式包标记、版本、build、源码和包内服务地址。严格验签、同已安装 0.1.24 相同的指定签名要求、附带公证票据和 Gatekeeper 检查均通过。

从已安装的 0.1.24 / build 312 签名包复制出隔离基线。在新建的合成资料目录运行 0.1.24，生成一段对话、一条 Worker 交付和一份附件，正常退出。以 0.1.25 / build 313 复用同一隔离资料目录运行并重启，核对原会话标识、消息、Worker 交付标识与附件字节及摘要。0.1.25 新回复在重启后仍可读。三个测试进程正常退出，对应 owner、锁和 lease 已释放。未使用日常账号、资料目录或真实模型。

Intel Mac 和 Windows x64 无可用目标设备，实机安装、运行和升级无验收证据。隔离验收时草稿尚未公开，Latest 当时为 v0.1.24。Apple 芯片验收通过手动切换测试包完成，真实原生下载、升级交接、安全重启与日常资料备份及安装待验。日常 Homer 承载本轮工作，仍运行 0.1.24 / build 312。

## 正式发布与 Latest

2026-11-24，用户接受 Intel Mac 和 Windows 实机验收缺口后公开了 [v0.1.25](https://github.com/wolf3c/homer/releases/tag/v0.1.25)。Release ID 仍为 `456731527`，11 个附件的 ID、字节数和 SHA-256 与原草稿一致。公开时保留 v0.1.24 为 Latest，两套下载入口均通过匿名核验。

随后按用户明确指示将同一正式版设为 [Latest](https://github.com/wolf3c/homer/releases/latest)。匿名回读确认 Latest 指向 v0.1.25。固定标签和 Latest 的三个安装包均返回 HTTP 206，首 1 KiB 范围和总文件大小正确。两套入口的八个小附件全部通过 SHA-256 比对，三个更新清单的版本都是 0.1.25，分别指向本版同平台固定安装包。

Intel Mac 和 Windows 实机验收仍未执行，Windows 包未签名。原生自动升级和安全重启仍未验证。本轮未替换日常 Homer，已核验的 Apple 芯片 ZIP 保留供后续空闲窗口安装。
