# 首次登录引导本机安装记录

2026-11-04（Asia/Shanghai）已按用户要求打包、安装并启动本机 Homer；未提交、推送、发布或上传安装包。

## 源码与产物

- 安装位置：`/Applications/Homer.app`；版本 `0.1.1`，build `264`，macOS ARM64 本机候选。
- 基线：`591f5e91c147efa7534941ce8fc19f0aa57d8375`；仅叠加本次 `src/homer-account.ts`、`ui/desktop-permissions.tsx`、`ui/homer-app.tsx`、`ui/homer-styles.css` 的产品改动，未混入其他未提交产品改动。
- 精确产品补丁：[first-open-local-install.patch](patches/2026-11-04-first-open-local-install.patch)，SHA-256 `a29ac39239f80b2479647ec94e329c71ef8365c9bbf486dd78cfc0160068cfa0`。
- 使用已有固定 Node `22.22.0`、Codex `0.163.0` 归档；`preparation=true`、`localWorkingTree=true`、`publishable=false`。
- sourceHash：`636656a3da8d10161c05a2aa670e5dca058e8e88ebb1bc66867a3ba59389d1e8`。
- uiHash：`3298b6a64e24072fb3ee240c65a3269055429dc12158721b18d82cdd7769b073`。
- ZIP：`.codex/scratch/first-open-local-install-20261104/source/.codex/scratch/build/forge/make/zip/darwin/arm64/Homer-darwin-arm64-0.1.1.zip`；340955737 字节，SHA-256 `b5ea6bc1cc80f0d7aa36e5f559e8ff445df3d077b88bcbd63505a8d1da8cc56d`。

## 验证与安装

候选源码的账号界面测试 67 项通过；前端类型检查与生产构建通过。应用、内置 Node 和解码辅助程序通过严格签名校验；2185 个清单资源文件、代码文件、ZIP 哈希及四个产品输入文件匹配。候选与原安装的 schema hash 一致。签名为本机 ad-hoc，未做 Developer ID 签名或公证。

原应用经正常退出及“退出并停止工作”确认后，检查安装路径进程已停止，完成六份隔离私有数据备份，再使用 APFS 克隆暂存并更名替换应用。保留原 build 180：`.codex/scratch/first-open-local-install-20261104/rollback/Homer-build180.app`；私有备份索引保存在 Git 忽略的 `.codex/private/first-open-local-install-20261104/backup-index.json`。回退需先正常退出新版，再恢复旧应用；数据回退需独立判断，不能覆盖运行中的资料。

安装后严格签名校验再次通过，安装清单与候选一致。实际启动 `/Applications/Homer.app`，关于窗口显示 `0.1.1 (264)`，已有聊天记录恢复，输入框可用。未退出账号、切换来源或发送消息。已连接账号进入正常聊天页，不会触发 `desktop_account_required` 引导。

本机证据：`.codex/scratch/first-open-local-install-20261104/` 下的 `input-receipt.json`、`package-verification.json`、`stop-and-backup.json`、`install-receipt.json` 和构建日志。引导分支与窄窗验证使用此前隔离模拟账号；本次未验证真实登录、购买、模型调用或全新安装环境。

## 提交前复审后续

后续源码复审修正了“查询成功后凭据到期，缓存仍显示零余额购买引导”的边界：保留到期时间，宿主即时判旧，组件在到期时重新核对并清理定时器。400 项定向离线回归及前端类型检查通过，隔离浏览器复核了到期与重试路径。本记录与附带补丁保全此前 build 264 的准确安装身份；本次到期缓存修复尚未重新打包安装。
