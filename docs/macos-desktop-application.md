# macOS 桌面应用候选

> 历史 AppKit 候选说明，保留其构建和隔离设计依据。当前桌面源码入口为 `packaging/electron/` 与 `scripts/build-desktop.mjs`，当前桌面发行说明见[桌面版本](2026-10-23-electron-desktop.md)。下文 Swift/WKWebView、签名、数据目录和旧构建命令只适用于该历史候选，不是当前安装建议；本轮未重新核验包、签名或机器兼容性。

首版为 Apple Silicon 的 Swift/AppKit 窗口，真实 WKWebView 加载随包预编译的完整 Homer Web UI。随包 Node 22.22.0、Codex 0.163.0 和原始平台配套；不需要源码、npm、Git、Cindy、Xcode 或 Homebrew。当前仅以 macOS 27.0 本机验收为依据；二进制中的更低 minOS 不等于本产品验证过更低版本。

## 候选与正式分发

本地 `.app` 的 ad-hoc 签名用于资源封存和本机运行，不是 Developer ID，也没有公证。ZIP 保留完整应用目录与代码签名。不要清除 quarantine、停用 Gatekeeper、让用户执行终端绕过命令，或把这个候选称为面向普通用户的正式安装版。

正式分发前由获得授权的维护者选择有效 Developer ID Application 身份，签名自有 ImageIO helper、主可执行和整个 `.app`，启用 hardened runtime 并审阅最小 entitlement。保留官方 Node 与完整 Codex 配套的原始签名；本地已逐一核验，上游 voice manifest 的27项 SHA 也必须全部匹配。重新签名这些上游文件会破坏它们的原始完整性清单，不能改写或删除清单来绕过；若组合包公证不接受原始依赖，应先取得上游支持的再分发产物，再审阅处理方案。重新生成自有资源身份与应用封印后压缩，使用获准的公证凭据提交准确 ZIP，核公证结果、staple 并验证票据。签名身份/entitlement/公证前后 hash 纳入发行记录，不读取或索取聊天私钥。

在第二台普通账户的干净 arm64 Mac，通过真实下载取得带隔离标记的 ZIP，在默认 Gatekeeper 下解压、拖入 Applications、双击并完成用户授权。必须实际验证未登录/离线窗口、系统浏览器登录、真实聊天/附件、关闭窗口保留、退出/重启、替换升级与数据保留。没有证书或第二台机器时明确留待此验收；本机 PATH 隔离测试只作为近似证据。

## 数据与更新

应用程序与数据分离。初次打开需明确新建 `Application Support/Homer Desktop` 专属空间；不会连接开发版 Homer 或导入其他应用账号。已存在但未带本产品标记的目录拒绝采用。应用更新只替换 `.app`，不删除历史、认证、记忆、文件和成果。关闭窗口仅隐藏并保留同一个 WebView；Cmd-Q 提醒当前工作和草稿的退出边界。sessionStorage 不承诺跨真正进程退出恢复。

更新步骤：正常退出 → 核对停止已确认且原 owner 正常释放 → 保留当前数据的完整维护点 → 换入新 `.app` → 新包先核资源与数据兼容，再打开。未知 schema 拒绝；若旧包拒绝新事实，保留数据使用兼容版本前向修复。不能回灌旧库抹去新输入/回执，也不能清锁或杀进程强行接管。

专属 codexHome 同时由一个 owner 使用。另一个应用副本、异常退出遗留 owner 或原生 lease 冲突时，程序停止并提示核对；OS 进程已退出不等于原生执行已停止。未确认请求保留原身份，禁止自动重发。

## 附件能力

文件上传和授权下载沿原 Homer 服务合同，传输与内容解析分别报告。基础 PNG/JPEG/GIF/WebP 图片用随包 ImageIO helper 解码单帧、去元数据、生成320px缩略图；实际字节/像素/超时/取消上限仍由 Homer 执行。UTF-8 文本不需要额外运行时。

PDF/Office 内容提取、FFmpeg 音视频处理、独立 ASR 模型不属于首包。文件可传输不等于已读出内容；这些格式按原 unavailable/失败状态明确展示。不能以桌面打包为由删除既有附件入口，或用机器上的 Homebrew/Python/语音模型冒充随包能力。

## 可复现构建

维护者需要已有 Swift/Xcode 命令行工具、Node22.22.0 和锁文件一致的构建依赖。脚本只读复用指定维护源 node_modules；官方运行档案仅下载到指定任务 scratch，不安装全局工具或写共享缓存。

```sh
node scripts/build-macos-desktop.mjs \
  --maintenance /absolute/reviewed/product \
  --scratch "$PWD/.codex/scratch/macos-desktop-application" \
  --logo /absolute/reviewed/river-stone-logo-candidate
```

构建先核实际前像，仅覆盖桌面明确 owner 的增量；Logo 使用批准的独立 UI hunk 和 SHA 资源。未验收分页不在输入。编译TS/UI/Swift发生在构建时，运行应用不执行这些步骤。保留 prompts 相对位置和两个完整初始化 Skills。应用资源的整体签名、SHA manifest 与原 Homer seal 均核验；模型执行权限另保护完整 `.app`，不以签名代替权限。每次从已核档案重新解包官方依赖，避免采用被改过的解包缓存；依赖闭包算法、package/lock均使用冻结stage的输入，只读复用维护源node_modules字节。

`packaging/macos/product-baseline.json` 固定137项公开输入的逐文件SHA。必须显式指定维护源；它发生并行修改时拒绝混入。允许 `--baseline-preimages /absolute/verified/preimages` 指向原发布公开前像，但仅在每个文件与锁定SHA完全相符时采用；它不授权新行为。此次已核实原 `fd23` 公开构建封包的全部137项前像，最终构建使用这组有限输入，依赖仍只读复用指定维护源。源码、原生代码、Logo及实际打包输入均进入应用 sourceHash；整个 Resources 的每个实际文件均进入运行期完整性校验，保留原 Homer owner/seal 检查。

许可证包含 Node 完整 LICENSE、Codex Apache LICENSE/NOTICE、官方 voice 原始 LGPL/其他 notices、sources.json 与版本来源，以及每个运行时 JS 依赖原始 license/notice。平台包不裁去 code-mode-host 或其他配套。

## 测试边界

隔离入口 `--test-profile` 要求事先创建格式1测试标记；配置、HOME、codexHome、数据库、假原生协议与证据全在同一个测试根内。测试标记不会授权读取日常数据。运行期环境为显式白名单；不继承开发配置、模型密钥或 Cindy/Codex Home。

真实 WKWebView 自测证据与合成协议测试分别记录。本机可测启动、渲染、缩放、窗口隐藏/重开、受控文件面板/下载及服务边界；未实际手工完成中文输入法、VoiceOver 或系统200%时，不将脚本输入/页面缩放称为这些真机验收。

## 原开发数据迁入

首包不自动迁入。本轮只提供离线合成验证与可审阅切换流程，实际迁入必须另有准确授权：

`scripts/rehearse-desktop-migration.mjs --synthetic-plan ...` 是可执行的离线演练程序。它严格限本任务scratch与格式1合成标记，拒绝真实目录；对两库做SQLite backup、完整性/FK核验，只改候选的Homer binding元数据，按准确SHA复制明确列出的合成引用文件，保留原thread/幂等/unknown。产物明确 `adopted:false`，不复制认证或改原生内部库；有原owner/lease或停写未确认时拒绝。它不代替实际生产迁入程序的路径与全部引用覆盖审阅。

1. 确认准确旧/新 appData、runtime、workspace、codexHome、当前原 thread 及所有 owner；正常停写，确认两库无写者、原生执行与 lease 已核实，未确认者停止迁移。
2. 对业务库与 gateway 库使用 SQLite backup，纳入 WAL 已提交事实；核 integrity/FK、schema、逐表行摘要，收齐附件/成果引用。认证/native目录单独按明确用户授权处理，禁止从全局 Codex/Cindy 账号迁入。
3. 预览旧→新 workspace/codexHome/config 的准确绑定映射；新业务 binding 按现有版本2算法，gateway 绑定按原launcher算法到桌面固定组件身份。只在离线候选副本写 Homer 所拥有的 binding 元数据，不改 Codex 内部数据库、thread ID、请求身份、幂等键或 unknown 回执。
4. 验证每个旧行及引用 SHA：仅经审阅的路径/绑定字段可变，当前 thread 完全相同，unknown 全保留，没有重放。准备失败只丢弃本次未采用副本；原目录保持。
5. CTO审阅准确迁入manifest/差异/完整回退和首次启动操作后，才由获准维护者切换日常入口。采用后如有新事实，不能靠旧库回灌回退。
