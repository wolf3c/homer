# 桌面安装前的路径与退出修正

2026-10-23。独立审阅发现的 P1、P2 在 `03190d99090649df27a4928e304984f1666ae98e` 中均仍存在；该提交的普通构建已完成，但不获准安装。真实维护点、原库迁移、网关 CAS、采用描述写入和安装均未执行。本次依用户“修复、审阅提交并安装”授权修正，仍须准确提交的独立定向复审闭合后，显式选择新冻结 SHA、普通模式重新构建并验收已安装 App。

## P1：首次访问前核下级控制路径

`scripts/desktop-profile.mjs` 在读取 shell 标记前检查其类型及 canonical 路径，取得经过私有配置验证的接续路径后，在任何 marker 写入、SQLite 打开、IngressJournal 建库/chmod、锁恢复及 owner 写入之前检查 runtime、gateway、workspace、codexHome、shell HOME/tmp 的祖先和目录类型。业务库及 transport 库包含 `-wal`、`-shm`、`-journal` 侧车；两级 `cli.lock`、desktop-owner 也必须是原 canonical 路径的普通文件。使用 lstat 拒绝悬空符号链接；owner 释放前再次核路径，遇替换保留证据，不跟随链接读删外部文件。

新建及接续合成布局各覆盖十种下级控制路径的符号链接、悬空链接和错误类型，共 60 个负例；外目录文件名、内容 hash、目录和文件权限均保持。另有 owner 释放替换负例。准确密封验证包的完整原入口覆盖五类下级逃逸，均在建立 owner、启动服务和首次 SQLite 访问前返回 `desktop_control_path_invalid`。没有读取人工输入的 WK profile，也没有访问真实账号内容。

## P2：停止回执与真实进程退出双确认

`packaging/macos/HomerApplication.swift` 只在尚未成功启动 runtime，或已经同时收到 `stopped` 和 runtime termination callback 的退出码 0 时允许直接退出。进程 `isRunning=false` 本身不是完整证据，重复退出不能绕过尚待确认的退出。20 秒期限也以双确认判断；只有 stopped 时仍按未确认处理，不强杀进程。非成功终态取消尚挂起的 AppKit 退出请求。Process.run 成功后才登记 engine，保留未启动服务时正常关闭窗口的行为。

`tests/desktop-termination.test.mjs` 编译实际完整 Swift delegate，只替换应用循环入口；同文件测试 extension 通过实际 IPC parser 接收一个仍存活合成子进程的 stopped，调用实际 applicationShouldTerminate 和期限判断。验证重复退出取消、已回执但仍活时超时未确认且进程保留、进程已退出但 callback 尚未确认时取消、回执加真实 exit0 才允许、缺回执及非零退出仍取消。合成进程经 stdin 自行 exit0，无强杀。一般 WK 正常退出不充当这些负例的证据。

## 工具合同兼容的最终复审范围

此前审阅未包含 `03190d9` 的最终工具增量，仍须复核 `src/tools.ts`、`src/service.ts`、`src/engine.ts` 及两个 main-tools resume 测试。只允许原五工具指纹 `e6d674a05ae34945a5e234a2b1f55029f0d319e51371f448911845224062cf9a` 接续到准确目标 `0c28896bd6042284a909a8b692d41215f92a50df8abe9333f9ded11f3d540056`，或准确相同的合同。历史差别仅 list_work 描述及三个可选分页参数；原 native 动态工具定义、原 thread 和历史 mainToolsHash 均保留，未知合同仍在 engine.start 前拒绝。接续 RPC 不重传 dynamicTools，不新建 thread，不发模型轮。

build-010 的真实固定 Codex 0.163.0 原生协议 1/1 证据可复用：本次包内 tools.js、service.js、engine.js 及 Codex 可执行字节逐一相同，hash 见验证记录；新一轮合同与包内接续测试也通过。该原生测试使用隔离无凭据 HOME 和不可服务的 loopback provider，只读其合成 rollout。没有真实模型或 Fast 吞吐实测。

## 可复查的证据与门槛

[验证记录](patches/2026-10-23-desktop-review-fixes-verification.json) 保存六个最终源码/测试 hash、23 个允许桌面构建输入的复核、准备包 sourceHash/manifest/schema/tools/UI 身份及九份脱敏停止回执。最终聚焦单元 26/26，包内完整入口 7/7，Swift 实际 delegate 负例通过。九次正常停止均实际收到 `{"kind":"stopped"}`、进程退出码 0、无信号，desktop-owner、两级 cli.lock 均消失且业务库 lease 为零；含两次接续布局。原始 JSONL 仅含这些状态，保存在本任务 scratch 的 `closure-runtime-011/shutdown-receipts.jsonl`。

路径和原生退出红灯、绿灯、最终完整日志及 Swift 合成回执位于 `.codex/scratch/desktop-integration-20261023/`；没有复制人工输入 profile 的观察文件。先前 137 条全项目类型诊断与准确前像逐条相同；本次无 TypeScript/UI 产品变更，重新完成后端类型、UI 类型、Vite 和 Swift 构建，复用同 UI hash 的 148 浏览器证据及官方 CSS 校验。Swift 原有 actor 隔离警告仍在，不声称全仓全绿。

本次仅提交两处产品 owner、四个聚焦测试和本复审文档/验证记录，不收编 main 的其他 dirty。当前构建 build-011 是禁止真实 profile 的准备包，不作为新冻结或安装交付。独立复审后仍须普通 Git archive 构建、原入口冷启动、新鲜真实 owner/队列只读核验、一致私有维护点备份、最小必要 CAS、正常安装并从 `/Applications/Homer.app` 验证。不得修改 `03190d9` 已构建包，不以自审替代独立复审。
