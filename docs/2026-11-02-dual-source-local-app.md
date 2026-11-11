# 双来源本机体验 App

2026-11-02，Asia/Shanghai。用户选择“制作本机体验包，不提交”。当前 `main` 工作树已打包，账号页手动双向切换验收通过；没有安装、发布、提交或打开日常资料执行推理。

2026-11-06 只读复核：下列原体验包 App 和 ZIP 路径均已不存在，原账号修复构建的预期 App 和 ZIP 路径也不存在；本次未核验其他备份或当前安装状态。构建回执和配方仍保留；同日清理了两份旧构建的 Swift 模块缓存与 Node 编译缓存。

## 交付身份

- App：`/Users/wolf3c/Project/homer/.codex/scratch/dual-source-local-app-20261102-d30q38af/forge/Homer-darwin-arm64/Homer.app`。
- ZIP：`/Users/wolf3c/Project/homer/.codex/scratch/dual-source-local-app-20261102-d30q38af/Homer-local-20261102.zip`，332089347 字节。
- ZIP SHA256：`e9be803f368af6d2b49ff795d46cac8ab6eb52803c6ad05acc2525bbf8e5d44a`。
- 版本：0.1.0，build 152；本机未提交工作树快照，不是该 Git 提交的正式发行版。
- Git 基线：`e7f2539202a21652b0909bc4aca80beec151f3d2`；sourceHash：`431bc96762be60fbdf1fc9a8ad6ef9b75c05ac0ed238c7042d8c6d075acd544a`。
- UI hash：`e4673b08bf743ff0f368c25fd42500ed49b10eab920c1cc46dc4db74b33cd2f7`。
- 固定运行时：Node 22.22.0、Codex 0.163.0、Electron 45.0.0；macOS arm64，最低沿用 macOS 27.0。
- `localWorkingTree:true / preparation:true / publishable:false`；本机 ad-hoc 签名，没有 Developer ID、公证或公开分发验收。

## 使用

正常退出当前荷马，解压 ZIP 后直接打开 `Homer.app`。进入“设置 → 账号”，点击来源卡片查看详情，再点击“应用并重启”。未登录时先登录目标来源；不需要退出另一账号。来源只在全部停止确认后保存，重启后继续原主对话。

不要清空 profile、历史或 Codex 目录。此包没有自动安装、自动更新或发布动作。

## 打包增量

`--local-working-tree` 复用现有源码快照，另外纳入包装输入，记录 451 个产品输入的逐文件 hash；排除私有、临时、依赖、测试和文档目录。仅明确带本机标记且不可发布的包可使用真实资料；原提交构建、合成准备包、签名、资源完整性、账号和数据绑定规则保持。

实际验包发现原生网络 addon 在清单生成后被 Forge 签名改写，导致 `desktop_resource_changed`。修复归属在 `packaging/electron/forge.config.mjs`：复用同一个清单生成函数，在嵌套代码签名后重新生成最终清单，再签署外层 App 并严格验签，没有忽略 addon 或放宽校验。

首轮因磁盘不足停止。仅回收本轮已逐文件校验相同的解包副本，复用已完成的编译和负载；Forge 组装时采用同卷移动资源目录以减少临时副本。其 ZIP maker 随后退出 14，保留失败日志；最终 ZIP 用系统 `zip -q -r -y` 生成，没有把失败的自动归档计为成功。另有并行改动只新增本地媒体测试脚本，刷新了这两个构建输入并确认运行依赖未变。最终全部源码输入与当前工作树一致。

## 验证

- 最终相关回归：252 项通过，1 项需要 App 的检查在该轮跳过；随后包内测试实际覆盖它。
- 包内入口、原对话恢复、账号、adoption、数据边界及资源检查：16/16 通过。
- 真实 Electron 窗口 + 合成账号／原生协议：Codex → 荷马 → Codex，均通过按钮确认停止、保存来源并重新启动；取消保持原来源；原主 thread、binding、已完成历史和网站凭据字节保留，原生登录仍有效，未重放工作。
- 包内两种来源均完成合成回复；本轮没有新增真实账号模型调用。真实 Main/Worker 流向及双向续聊证据沿用[真实推理验收](2026-11-02-dual-source-live-acceptance.md)。
- 390 / 1440 宽度实际截图核验，无横向溢出、无页面异常；所有测试引擎及 owner 正常停止。
- ZIP 独立解压后完整严格验签通过；2167 个资源文件、2 个辅助程序逐项 hash 与清单一致。验证副本核对后回收，签名 App、ZIP 和证据保留。
- 源码及 UI 编译通过；最终差异空白检查通过。
- 日常资料仅做只读兼容预检：当前 schema 标记属于既有增量兼容名单，数据库版本为 pending 1 / recursive 4，与包支持值一致；没有修改日常 marker、配置或数据库，也没有替换／重启日常 App。这不替代真实资料启动验收。

脱敏证据、输入清单、恢复构建配方、签名修复前后的日志和实际窗口脚本保留在 `.codex/scratch/dual-source-local-app-20261102-d30q38af/`。`desktop-build-result.json` 锁定最终 ZIP，`switch-ui.json` 为最终成功记录；较早失败不作为通过证据。

未验收：安装到 Applications、真实日常资料首次启动、全部渠道、全部原生工具、长对话压缩和公开分发。此前网站最终用量查询缺口仍未补验，不宣称已核对。

## 本机安装补验

2026-11-02 16:53，用户授权安装并打开。已将同一 build 152 安装到 `/Applications/Homer.app`，安装前后严格验签通过；旧 App 和停止后的业务库、传输库备份保留在 `.codex/private/dual-source-install-20261102/`。

真实资料启动后，原 mainThread、binding、全部历史表、原配置及凭据文件保持；仅新增原生账号控制租约并更新网关构建契约。数据库完整性检查通过。账号页已打开，ChatGPT 原生状态为已登录；当前仍生效的荷马来源尚无网站登录，旧开发 Key 文件原样保留，没有将其导入网站账号。仅展开 ChatGPT 详情，没有点击“应用并重启”。

未发送模型消息或发布；真实日常资料双向切换与续聊留给用户手动测试。脱敏安装记录：`.codex/scratch/dual-source-install-20261102/result.json`。

## 账号页与旧凭据修复

账号页打开时以桌面桥接返回的当前生效来源为默认选项；用户随后选择的详情仅在本次打开期间保留，后台状态刷新不会覆盖。重新打开设置再次跟随生效来源。

恢复旧版只有 `token` 的荷马连接，不重新授权、不伪造网站账号身份。沿用现有私有文件校验和原子改名迁移，将 `deepseek.json` 原样迁到 `runtime-config.json`，保留文件内容和 inode；不复制凭据、不创建另一套账号资料。旧连接显示“已连接（原凭据）”，使用原固定 `deepseek-flash / high / Fast 关闭`；网站账号继续使用网站交付配置。切换仍须确认全部停止，不清除任何一侧凭据，不改变原主对话和数据绑定。

构建及脱敏验证记录保留在 `.codex/scratch/dual-source-account-fix-20261102/`。构建仍为本机未提交体验包，不用于发布。

2026-11-02 17:23 已更新并打开 `/Applications/Homer.app`，仍为 build 152，修复版 sourceHash：`f4289f53f992f22581778401fa6aec84b6367a3643fbb943bb1a8088f6867f18`。更新前正常停止并备份最新业务库、传输库和旧 App；备份在 `.codex/private/dual-source-account-fix-install-20261102/`。原主 thread、binding、历史表、源配置和原生认证文件保持；旧 Key 完成原子改名，内容、inode、0600 权限均核验一致。

相关回归 270 项通过；其中另有 1 项包环境检查在定向轮跳过，随后最终包内 15 项全部通过。固定 Codex 历史兼容与来源检查 11 项通过；服务、UI 编译和类型检查通过。首次包内 Finder 检查在并行构建期间超时，单项复验及最终整轮均通过，保留原失败记录。实际安装页确认默认选中当前 Codex，荷马显示“已连接（原凭据）”且可应用；查看荷马详情后关闭、重开设置，重新默认选中 Codex，没有应用切换或发起登录。

最终 ZIP：`Homer-account-fix-20261102.zip`，SHA256 `909439210e14ad776b3003ea159009e38d291f84fc6d2209b51b9c8007418a88`；2167 个资源及 2 个辅助程序与最终清单逐项匹配，严格验签通过。构建曾因 Electron 下载超时停止，随后使用与安装依赖包校验表一致的 Electron 45.0.0 缓存完成。构建期间仅测试命令有并行更新，核对运行依赖未变后已纳入最终源码清单。

本轮没有真实模型推理、提交或发布；真实账号双向续聊仍留给用户手测。`install-result.json` 记录安装前后保护项与实际页面核验。
