# 首次登录引导修复版本机安装记录

2026-11-04（Asia/Shanghai）按用户要求重新打包、安装并启动本机 Homer；未推送、发布或上传安装包。本次安装未新增产品代码提交；此记录随后按用户要求单独提交到 main。

## 源码与产物

- 安装位置：`/Applications/Homer.app`；版本 `0.1.1`，build `266`，macOS ARM64 本机候选。
- 冻结源码：main `1377c49094d6aa56b3597f21af967d579256deb0`，包含首次登录引导与积分缓存到期修复 `df32c52e3b83aa936e412449a835b8e5bfd1c30e`。从 Git 归档构建，未叠加工作区未提交改动。
- Node `22.22.0`、Codex `0.163.0`；`preparation=true`、`localWorkingTree=true`、`publishable=false`。
- sourceHash：`9a1d5c307bf57e72f8af87ea218dcba20efb4261f15e1fe5f59abbba2806ee39`。
- uiHash：`5b7272c698402168ca9b360e253df1278ceaca71af720b595625861adedc46ef`。
- ZIP：`.codex/scratch/first-open-fixed-main-install-20261104/source/.codex/scratch/build/forge/make/zip/darwin/arm64/Homer-darwin-arm64-0.1.1.zip`；340955830 字节，SHA-256 `1c48134e0894b92f40e15cacc4f6443b92953c1a59b68031e4e78f357b6eff5b`。

## 校验

冻结源码的 400 项定向离线测试通过，无跳过；前后端类型检查及生产构建通过。应用、内置 Node 和解码辅助程序通过严格签名校验；2185 个清单资源文件、代码文件和 ZIP 哈希匹配。五个产品输入文件与冻结提交一致，打包后的 Electron 主进程包含到期修复。候选与原安装的数据库 schema 和账号服务来源一致。

本机使用 ad-hoc 签名，未做 Developer ID 签名或公证。此结果不代表发布验收。

## 授权恢复与安装

替换前，旧版界面已报告执行服务退出；残留界面无法通过正常停止确认完成退出。先保全六份私有资料备份与恢复前的一致性数据库备份，再按用户两次明确授权执行恢复：隔离已确认进程不存在的 owner、四条租约及同一服务的失效锁；结束残留界面进程；使用现有任务恢复接口将两条旧任务保留为 `interrupted / uncertain / restart_unconfirmed`，结果待核对。保留任务和全部历史，不自动重跑。恢复后数据库 quick check 通过。此次未查明旧执行服务退出的根因。

使用 APFS 克隆暂存并更名替换应用，安装后严格签名和候选清单匹配。原 build 264 保存在 `.codex/scratch/first-open-fixed-main-install-20261104/rollback/Homer-build264.app`；此前 build 180 也保留。私有备份索引位于 Git 忽略的 `.codex/private/first-open-fixed-main-install-20261104/backup-index.json`，原任务状态的一致性备份为同目录 `runtime-before-recovery.sqlite`。回退须先退出运行中的应用；数据恢复应独立核对，不能覆盖正在使用的资料。

## 安装后观察与边界

实际启动 `/Applications/Homer.app`，“关于”显示 `0.1.1 (266)`；历史聊天可见、输入框可用，未再显示执行服务退出或启动失败提示。两条恢复任务仍为中断待核对。安装操作未退出账号、切换来源或发送消息；已有账号进入正常聊天页，因此未触发首次连接引导。

本机证据保存在 `.codex/scratch/first-open-fixed-main-install-20261104/` 的构建日志、回归日志、产物校验、授权恢复及安装收据中。未验证真实登录、购买、模型调用或全新安装环境。工作区原有文件未被安装流程覆盖；收尾对照最初 63 份文件哈希，62 份一致，`docs/first-user-operations.md` 在期间发生范围外变化，未改写或回退。
