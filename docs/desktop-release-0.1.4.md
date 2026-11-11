# Homer 桌面 v0.1.4 构建与验收记录

2026-11-07，build 289。三平台安装包及两份 Mac 更新清单均已通过云端完整下载与 SHA-256 校验。Release `437240469` 于北京时间 10:11 公开并设为 Latest，双语说明与 10 个附件已回读核对。[正式 Release](https://github.com/wolf3c/homer/releases/tag/v0.1.4) · [GitHub Actions](https://github.com/wolf3c/homer/actions/runs/42324015214)

- 本地发行版本提交 `fd17bc23b4a4aa195b559db05e195c49d0a6c832` 包含核心重构及结案收尾 `5a1157c`。基于上一公开桌面版的文件树导出已提交的产品源码差异，沿用公开仓库的工作流和内部材料排除规则。
- 远端标签 `v0.1.4` 指向公开候选 `26ebe9aa1f7b7fcd11084384f2f41047f7c845f1`。运行 `42324015214`、attempt 1、`kind=desktop`、`target=desktop-three`，`plan`、三个构建 job 和 `verify-draft` 均成功。
- 隔离公开候选使用 Node 22.22.0，构建、类型检查、2,080 项核心测试和 28 项批注浏览器检查通过。三份原始打包回执与合并清单、附件大小、摘要和身份一致。回执里的服务地址均为 `https://super-tree.com` 和 `https://models.super-tree.com`。

| 平台 | 安装包 | 字节数 | SHA-256 | 签名和最低系统 |
| --- | --- | ---: | --- | --- |
| Apple 芯片 Mac | `Homer-mac-arm64.zip` | 321880668 | `abeab1f5f9e902fc23e2dc567d349aaf4d63811c0466f9a5fa056982a51ca390` | Developer ID，已公证并附票据，macOS 27.0 |
| Intel Mac | `Homer-mac-x64.zip` | 342594568 | `031321aeda6e677819a9a9baf7937fe5a7ef4b8df89b5bf6163a3cb904670f98` | Developer ID，已公证并附票据，macOS 14.0 |
| Windows x64 | `Homer-windows-x64.exe` | 254258621 | `98fc735a88294d54a12f15df84930ae3d60bdc62f2be8a1e371764ba293c7ef1` | Windows 11，未签名 NSIS，自动更新禁用 |

## Apple 芯片正式包

- 从草稿下载原 ZIP，核对其大小、摘要、包内版本、build、源码 SHA 和服务地址。Developer ID 签名、stapling 和 Gatekeeper 通过。
- 独立资料目录通过首次启动、合成对话重启、未登录只读及进程崩溃后保留原附件。并发续办只启动一个后继 Worker，1440px 和 390px 可查看任务状态、回读 Worker 原文和中断当前回复。网站账号接线用例要求回环服务地址，正式包在该用例前置检查处停止。
- 用正式 `v0.1.3` 建立隔离历史和交付文件。新包拒绝打开 schema 5 资料，返回 `desktop_schema_incompatible`。资料标记、数据库和文件字节不变，旧版重新启动后仍可读取原历史和文件。新版需要全新资料目录，回退使用 `v0.1.3` 及其原资料。

## 真实 ChatGPT 与公开分发

- 用户在浏览器确认授权，独立资料目录的正式 Apple 芯片包识别真实 ChatGPT 登录。Worker 交付的文件经应用附件接口下载为 3 字节，重启前后的 SHA-256 均为 `0ef962215cc055786d516355238a80dacc204ecf9b160d0a252190bf5c0cc370`。测试实例已退出，独立目录内的临时认证文件已清理。
- 公开的是同一个 Release，10 个附件的 ID、大小和摘要与发布前一致。原 Latest 为 `mobile-android-0.1.1-4`，Release `432431632`。公开后匿名读取固定标签与 Latest，均返回 `v0.1.4`、Release `437240469`。三个安装包分别通过两种链接的 1 KiB 范围下载，固定标签的七个小附件均与草稿副本逐字节一致。
- Intel Mac 与 Windows x64 已通过构建与分发校验，目标环境的安装和运行仍未验收。
- Yezi2 已更新本地官网手动下载入口。桌面和 390px 视口均核对了版本选择、三个固定版本链接和中英文全新安装提示。官网尚未部署，线上入口与自动更新未纳入本轮验收。
