# Homer 桌面版 0.1.1（build 269）

源码：`093865d81b974689a286d427ab4146c7b15c4342`。发布日期：2026-11-05。

## 网站下载入口

版本页：https://github.com/wolf3c/homer/releases/tag/v0.1.1

本次保留原 Android Latest；桌面入口使用固定版本链接，不使用 `/releases/latest`。官网应分别提供 Apple 芯片、Intel 和 Windows 入口；无法识别 Mac 架构时让用户选择。

| 平台 | 系统要求 | 下载地址 |
| --- | --- | --- |
| macos-arm64 | 27.0 | https://github.com/wolf3c/homer/releases/download/v0.1.1/Homer-mac-arm64.zip |
| macos-x64 | 14.0 | https://github.com/wolf3c/homer/releases/download/v0.1.1/Homer-mac-x64.zip |
| windows-x64 | Windows 11 | https://github.com/wolf3c/homer/releases/download/v0.1.1/Homer-windows-x64.exe |

校验清单：https://github.com/wolf3c/homer/releases/download/v0.1.1/SHA256SUMS

## Mac 更新配置

已发布 App 固定请求以下网站路径，Yezi2 应按架构分别返回对应 JSON，避免单页应用 HTML 回退：

| 网站路径 | 对应 Release 附件 |
| --- | --- |
| `/homer/updates/stable/darwin-arm64/RELEASES.json` | https://github.com/wolf3c/homer/releases/download/v0.1.1/RELEASES-darwin-arm64.json |
| `/homer/updates/stable/darwin-x64/RELEASES.json` | https://github.com/wolf3c/homer/releases/download/v0.1.1/RELEASES-darwin-x64.json |

可直接部署附件内容为网站静态 JSON；保持 `application/json`，更新清单避免长期缓存。清单内 `updateTo.url` 已指向同架构的固定附件名；不要改回带版本号的旧包名，也不要混用两个架构。Windows 本次未签名且禁用自动更新，只接入手动下载。

验收网站时检查实际 HTTP 状态、JSON 内容和 MIME，而不只检查静态文件存在；确认首页版本、系统要求及下载地址一致。移动端 `/homer/app` 和 Android/iOS 配置独立维护。

## 验证范围

三平台安装包来自同一源码 SHA，大小和摘要与构建回执一致。Mac 包通过 Developer ID 签名、公证及票据验证；Apple 芯片在 macOS 27 隔离环境通过启动、ChatGPT 登录、真实文件生成和交付入口检查。Intel Mac 和 Windows 未做实机验收；Windows 包未签名。未增加完整安装、升级、卸载验收。

下载校验及发布状态以本次执行结果为准，网站接入、部署及线上路径核验由 Yezi2 任务负责。

## 本次发布结果

2026-11-05 已公开发布 v0.1.1。三个安装包从草稿完整回下载后 SHA-256 与原包一致；两份更新清单、分发清单和校验清单均回下载比对一致。公开后七个附件的匿名链接均可访问：安装包验证了首段及完整长度，小型 JSON／校验文件验证了全部字节。原 Android Latest 已恢复，桌面始终使用上述固定版本链接。
