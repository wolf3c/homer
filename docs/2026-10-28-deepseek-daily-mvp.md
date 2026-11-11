# DeepSeek 日常桌面首版

> 2026-11-03：本文记录的直接配置 Token 开发功能已退役，启动命令和手填凭据方式不再适用。当前统一使用网站账号授权，见 [账号与模型连接](architecture/account-and-model-connection.md)。

后续维护源码的模型目录、默认 high、容量阈值和执行保护见 [Codex 适配与执行保护](2026-10-28-deepseek-codex-adaptation.md)。下文保留此前首版及其包的验收记录，不代表该维护改动已安装。

本轮基线为 `76c8f367681f7786079aee0baaf5c5684687d0a6`。沿用原日常 Homer profile、runtime、workspace、Codex HOME 和主 thread，主 Agent 与 Worker 使用 `https://models.super-tree.com/v1`、`deepseek-flash`、`effort=max`、`fast=false`、Codex `0.163.0`。原 ChatGPT 配置和账号绑定不改写；执行配置在可信桌面入口派生，两种角色和状态展示采用同一模型配置。

## 使用

正常退出旧 App 后，由使用者安装新包；维护流程只打包，不安装、替换或重启当前 App。普通双击新 Homer 即进入原日常数据，不使用旧的 `Start-DeepSeek.command` 隔离入口。

本人手动填写本机文件：

```text
/Users/wolf3c/Library/Application Support/Homer/runtime-config.json
```

```json
{"token":"替换为本人 AMH Token"}
```

文件仅本人可读写，推荐权限 `600`。新源码首次读取时会校验并迁移旧 `deepseek.json`；已安装旧包在更新前继续使用旧文件，不要手工复制出两份凭据。Token 只填写在此本机文件，不发送到聊天。配置在 App 外，升级不覆盖；修改后正常退出并重新打开 Homer。缺失、空值、非法 JSON、非私有文件或符号链接会在后台启动前提示配置路径，不回退到其他账号。没有热切换或静默降级。

日常启动不再弹出隐藏输入框。Electron 主进程读文件，经私有 FD 3 传给随包服务；公共配置只保存环境变量名称。main、Worker 及原生账号回退的工具沙箱明确拒绝读取、修改该文件，审批与 checkpoint 的保护路径使用同一拒绝清单。Token 不进入 argv、Renderer、日志或包内资源。旧隔离实验入口继续保留其临时输入方式。

## 历史保全与限制

原数据按原路径打开，不复制或合并数据库，不更换主 thread，不清理记忆或已有文件。旧待处理消息、旧任务和旧交互保留，但本次启动不自动恢复执行；用户新消息和新 Worker 正常处理。后台原生记忆提取暂时关闭，既有记忆文件和原生记忆工具保留。

旧活跃 Run、待发送交付、未确认 owner 或待处理 transport 会拒绝启动并保留记录，需核对后处理，不能直接删锁或重放结果未知的轮次。这是使用者已接受的首版限制。旧队列记录仍可能显示原“排队／处理中”状态；它们不代表本次正在执行。

微信和 Telegram 自动恢复与发送暂不启用，其恢复由单独任务处理。网站授权、余额／订单、Keychain 和多账号归属流程不在此版。真实供应商的图片、长上下文、压缩、费用和性能没有新增验证证据。

## 验证与回退

测试使用隔离 HOME、runtime、workspace 和离线协议 fixture，不读取真实 Token 或发起付费调用。覆盖：Token 文件重读与非法文件拒绝、私有管道、两种角色配置与凭据文件 deny、旧消息不 claim、旧恢复消息不 ACK、旧未知过程不阻塞新输入、旧任务不继续、正常退出、原 thread 恢复、Worker 实际文件验收和原生模式回退。

本轮已执行的源码检查：11 个相关测试文件共 145 项通过；随后凭据文件 deny 的红绿测试对 main/Worker 均通过。后端 `tsc -p tsconfig.json` 编译通过。完整仓库测试的先行尝试未取得全绿：旧基线同样存在 first-launch、旧 Memory 测试、历史 HTTP／活动渲染等失败，开发热更新端到端在候选及原基线均超时；不得将本轮写成全仓通过。完整失败名称与原始结果保留于 `.codex/scratch/daily-suite/`，本轮针对性记录在 `.codex/scratch/daily-mvp-package/`。

打包后还需对准确包运行 `tests/macos-desktop-runtime.test.mjs` 与 `tests/electron-desktop.test.mjs`，核对包内 gitSha、版本、固定引擎及签名；最终结果保存在同目录的构建 receipt 和验收记录。实际日常数据库此前只读检查：149 条任务、2135 条对话消息、0 活跃 Run、0 待发送交付、0 lease，`quick_check=ok`。这不代表新包已连接真实模型。

需要回到原生模型时，先通过 Cmd+Q 正常退出并确认停止，再启动同一包的显式原生入口：

```sh
open -n /Applications/Homer.app --args --native
```

原配置、账号凭据、主 thread、历史与文件保持原路径。回退仍暂停旧工作，不因回退自动补发或续跑；不能同时运行两个原日常 profile owner。发生启动或退出未确认时保留错误代码及 owner，核对后处理，不强杀或删除记录。

正常构建必须来自已提交的准确 source SHA，由 `scripts/build-desktop.mjs --source-sha ... --maintenance ... --archive-source ... --scratch ...` 导出；不把主树并行 dirty 纳入包。签名为本机 ad-hoc，非 Developer ID 签名或公证包。最终 candidate 身份、产物 SHA-256 和本地合并状态以构建 receipt 及 Git 为准。

## 最终复审记录

产品 candidate 为 `4066069e1377f935f127cdf45cfe83ad3d1a6870`，已合入本地 main；build 110 的 ZIP SHA-256 为 `2b6104e485d84a9d263e46b1e807cfbc2ec5dfd2e7e1de01a4dacf938d43e753`。本段只补充验收记录，不改变包内产品代码。代码复审未发现新的阻塞问题，Token 路径 deny 对 main、Worker 与原生回退均有效。没有新增轮询、Token watcher 或常驻进程；启动增加历史记录检查和五组 ID Set，耗时与内存随历史量增长。媒体 GC 暂停也会使过期附件暂不自动回收，不能据此声称零开销或性能提升。

最后一次相关源码测试为 145/145 通过，包内版本、资源摘要、ZIP 完整性及签名再次核对通过。同一包先前取得运行时 11/11、实际 Electron 3/3 通过证据；最终标准运行时复测为 4 通过、5 失败、2 取消，涉及启动等待、路径拒绝检查和 owner／schema 拒启回执的超时，保留原始失败。此结果不能写成回归全绿。

随后只在 scratch 中复制测试，延长等待预算并记录启动时间，没有改变产品或已提交测试。入口与日常主 Agent／Worker 实际文件交付、原生回退两项诊断通过；该轮启动测量约 6.9–39.9 秒。延长预算后的诊断不替代标准测试，超时根因与启动性能风险仍未关闭。本轮未调用真实模型，不保证供应商时延或性能优异。

清理时将忽略文件中的安装包、原始验收结果和早期隔离 profile 保全到主仓库 Git 忽略的 `.codex/private/worktree-archives/homer-account-stage1-20261028/`，再由 Codex 归档本任务工作树。归档目录的 manifest 记录原路径与新路径；原日常数据库、Token 文件和 `/Applications/Homer.app` 不在清理范围。
