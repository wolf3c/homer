# 奥德修斯 Logo 本机采用

2026-10-30 用户选定 A 配色与 D 人物造型融合稿，并要求作为 App Logo、查看电脑中的效果。正式资产与准确生成源见 `assets/branding/odysseus-20261030/README.md`。此前河马标准母版、酷感版及评审稿保留。

## 采用范围与隔离

维护源码更新 `scripts/build-desktop.mjs`、`scripts/dev.mjs`、`ui/index.html` 与 `ui/homer-app.tsx` 的图像引用，覆盖 macOS ICNS、页头、欢迎图、16/32/64px favicon 与 `/branding/homer.png`。保持原尺寸、布局及行为。

本机 `/Applications/Homer.app` 已采用本稿。沿已安装 build 123、Git `0833d08b085e43003ebefac62cb7a2bac6903392` 创建隔离图像覆盖包，不打包工作区其他未完成修改。旧安装版原样保留于 `.codex/scratch/odysseus-adoption-20261030/previous-Homer.app`。正常退出后校验前像，原子移动替换，失败恢复；没有强制退出、清理运行锁、修改数据库、提交或发布远程版本。

新 UI hash：`3f45925498bd67cdbe93141a35baf5abf6c3ea00a04b3650917b0b18210d5639`。
新 source hash：`ad782b0c9900e73db2b818a533c110e71f9d255d52ac1e974613dcca9bae236a`。
新桌面 manifest SHA-256：`5123a99704d6186764c797a2b8f1fe52192c14f962c46d3f62e5fd5bf73ddf67`。
ICNS SHA-256：`093490e18b5e49bd69e858d94fd16fec820f4388e2f9e3ad8e6c30cd3e738289`。

该包明确为本地图像覆盖 `publishable=false`，不将 build 123 宣称为新远程版本。

## 核验

- 原始选定图片 SHA 与 1254px RGBA 尺寸一致；导出八档 PNG、12 块 ICNS。没有重绘或改变选定稿。
- `node --test tests/desktop-icon.test.mjs` 2/2 通过，包含原生解码与损坏文件拒绝；维护与隔离 UI TypeScript、隔离 Vite 构建通过。
- 原隔离基线 Web 的 73 个文件与原安装版字节相同；新构建七个 JS/CSS/HTML 文件归一化图像 URL 与资源指纹后完全相同。包内 1724 资源、两项运行代码、可信构建清单和严格深层签名通过；entitlements 保持。
- 正常启动原会话。线程 hash 相同，消息数 1647、队列 0、待核对 worker 项 3、isRunning=false，与重启前一致。未发送模型测试消息。初次启动只读 HTTP 曾返回 `web_receipt_unconfirmed`；启动完成后读取恢复 200，没有绕过回执校验。
- 安装后真实 HTTP favicon 16/32/64 与兼容 Logo 的字节均匹配正式导出；真实窗口页头显示新稿，见 `assets/branding/odysseus-20261030/review/header-live.png`。未创建空白真实会话来演示欢迎图。

## 系统图标缓存与证据边界

首次用户 Dock 截图及 AppKit 的 NSRunningApplication.icon 仍为墨镜河马，不能将包内替换当成 Dock 生效。仅对准确 `/Applications/Homer.app` 更新时间并执行系统 LaunchServices 的 `lsregister -f` 重新注册；没有重建全局数据库、删除缓存或重启 Dock。

重新注册后，对同一个真实运行 PID 读取的 AppKit 图标已是奥德修斯，见 `assets/branding/odysseus-20261030/review/system-running-icon.png`，这是系统返回的当前图标图像，非 Dock 截图。随后用户确认“重启后变了”，并提供真实 Dock 截图：Homer 标注下已显示蓝橙奥德修斯图标，Dock 视觉验收完成。原始截图保留于 `assets/branding/odysseus-20261030/review/dock-user-confirmed.png`，字节未改；SHA-256 为 `38caf0ab67541b2c445a520bc1b5f4df437b9047c054b4f6a9191ee4cb3d325e`。已有页头证据只裁切原始窗口截图；没有图像合成或生成式修改。

准备、安装、原会话状态和隔离比对的原始非秘密核验记录在 `.codex/scratch/odysseus-adoption-20261030/`；本次 Dock 验收已由用户实拍补齐。

## Git 收尾审查与验证

本轮在 main 基线 `a7028e884020f0eaf1e33fe11dcddb53fc7a016c` 上用独立 index 选取准确 Logo 改动，并在临时 detached worktree 验证。仅包含当前图标、旧标准与酷感资产及来源、对应说明、应用图像引用和导出脚本；排除共享工作区中的引用评论样式、DESIGN 其他修改及所有无关改动。当前本就在 main，本地提交即纳入 main，不创建多余合并提交，不推送远程。

独立只读审查发现并修复一项问题：PNG 导出覆盖 manifest 时会丢失 ICNS 校验记录。现在只在原图 SHA、1024px 导出 SHA、准确 ICNS 路径、实际字节长度及 SHA 都与旧记录一致时保留；否则失效，不将旧校验当成新图标已验证。重跑导出不重编码 ICNS。

- 临时 worktree 的 `node --test tests/desktop-icon.test.mjs tests/desktop-source.test.mjs`：6/6 通过；UI TypeScript 与 `npm run build --workspace=homer-web` 通过。
- 导出验证 8/8：两次重跑的 PNG 和完整 manifest 字节一致；旧来源、PNG、ICNS hash、长度、路径记录不符或实际 ICNS 字节变化均失效；选定原图被修改时，在写入导出前拒绝。测试后恢复原始字节。准确 ICNS 经系统 sips 解码为 1024 × 1024。
- 与 main 基线使用同一套 UI 构建流程比较：71 个资源数量不变，7 个 JS/CSS/HTML 文件归一化图片文件名和内容指纹后逐字节一致，没有新增运行逻辑、依赖、请求或计时器。UI 只引用 16/32/64/256px PNG，不向浏览器发送 1024px 母图、ICNS、参考图或历史资产。
- 新 16/32/64/256px 图片为 951/3047/10396/115829 字节；相较 main 的 836/2220/5691/47110 字节，256px 增加 68719 字节。保留原 srcset 和 sizes，根据显示尺寸选择。没有测量或声称启动时间、CPU 或帧率提升。构建保留原有大 chunk 提示，本图标任务不修改代码拆分。
- 新旧共 24 个 PNG、3 份母图与 3 份 ICNS 的 SHA、尺寸和容器结构核对通过，Markdown 相对链接完整，独立最终审查无遗留阻断问题；diff 空白检查通过。

受本轮低磁盘空间约束，未运行全仓测试或重新制作完整桌面安装包；之前安装与用户提供的 Dock 实拍证据保持，不把本轮 UI 构建表述为重新安装。验证详细结果保留于 `.codex/scratch/logo-final-review-20261030/`，完成后只移除该目录内的临时验证 worktree，保留原应用回退包、源图和其他 worktree。
