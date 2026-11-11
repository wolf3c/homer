# Homer 桌面安装发布准备与近期提交盘点

核查时间：2026-10-23 16:48 Asia/Shanghai。状态：两指定前置均已提交且main可达，桌面基线仍缺；**尚未冻结、打包、安装或清理**。本记录不是安装完成证明。后续须重新核对桌面闭包提交、main、运行占用和维护点。

继续进展：已按CTO补充授权在隔离worktree构建未提交的桌面整合准备候选，正式发布仍未冻结或安装。准确范围、补丁、来源及验证见[桌面整合候选](2026-10-23-desktop-integration-candidate.md)。下文“未打包/清理”是16:48历史观察，不代表后来未发生准备构建或本任务废弃副本回收；两者不冒充正式安装交付。

## 仓库与运行边界

- 维护仓库 `/Users/wolf3c/Project/homer`，分支 main；本任务使用现有宿主 worktree `/Users/wolf3c/Project/homer/.cindy-worktrees/proud-kernighan`、分支 `cindy/proud-kernighan`，未创建或切换分支。首次检查 HEAD/main 均为 `ab0c706d22fd8c25bef73f0004cf90367f914037`；核查末 main 为 `3c5461180575aa90f9430f35152f444530185913`。这些是观察值，**不是发布冻结 SHA**。
- 宿主项目登记仍为维护仓库；本目录在 `git worktree list --porcelain` 中。真正构建前须核宿主对本独立目录的任务登记并正常移动隔离 HEAD 到冻结提交；不得在开发 main 执行切换或使用其可写输出。
- 维护 main 有大量其他任务的 tracked/untracked/暂存工作，不纳入本版、不代提交。本任务未修改维护树、暂存区或业务数据。
- 两个标准安装目录 `/Applications`、`~/Applications` 中按 Info.plist 的 bundle identifier 查询均未发现 Homer。历史桌面候选存在不等于曾安装或正在运行。
- 宿主只读进程核查未发现 Homer 桌面、`scripts/dev.mjs` launcher、桌面构建/签名/公证/镜像切换进程；`lsof -nP -iTCP:4780 -sTCP:LISTEN` 无输出。此为当时快照，不证明其他端口/其他时间没有服务，正式操作前必须重新核查。
- 旧发布 session `3f6cfa9d-c41f-45b5-b81c-25e4d22ff844` 的 runtime 返回 completed、active=false、record_status=deleted；digest 为 NOT_FOUND。`e6306dcb-0c56-45ec-a458-7c6bd561eb51` 在当前 Cindy runtime/digest 均 NOT_FOUND，不能据此推断其他任务系统中的 engine 状态。本次未停止、恢复或控制这些任务。

## 近期任务与 main

范围为约 15:18–16:48，另保留指定任务。逐项读取 digest 和必要最后交付，再以实际 Git commit/ancestor 核对；表中已有验证是 owner 的提交证据，本轮未重复执行，后续冻结提交仍须补组合验证。

| 任务（session 前缀） | 最终性质 | 实际完整 SHA | main 可达 | 待提交增量 | 可复用证据及限制 | 本版范围 |
| --- | --- | --- | --- | --- | --- | --- |
| 移除能力入口 f93d24e3 | 产品 | `280f428a2e9e2f416baf5df00d7c2c4ffb26f7fc` | 是 | owner 已交提交；共享 dirty 不归因 | 22 种旧动作404、三屏、类型/build；后台55/57，2项基线失败 | 纳入候选 |
| 历史归档/恢复/删除 d6785264 | 产品 | `d8e0bd776e10588d5f99ecd7f97d702869d0b5b8` | 是 | 同上 | 精确暂存快照18/18、服务类型；扩展11项既有失败；真实删除0 | 纳入候选 |
| 统一主队列 0bab0a53 | 产品 | `ab0c706d22fd8c25bef73f0004cf90367f914037` | 是 | 同上 | 69回归、微信1、浏览器19、前后端类型；旧记忆失败已对照 | 纳入候选 |
| Finder成果定位 dfbe2c85 | 产品 | `9b5d97c092e558d2d1863634abf4eb1827901e81` | 是 | 同上 | 25回归、浏览器12、类型/build；Finder准确选中GUI未验 | 纳入候选 |
| Working排查 0417df34 | 后续获准产品修正 | `f365c54850782608e6e9f66f806f36bdf4044407` | 是 | 同上 | 27回归、类型/build、三屏；合成性能无退化 | 纳入候选 |
| 视觉审查 ea9ab438 | 后续获准产品删减 | `ec34e5d9113fc29171fb81e0bc159ad53afc67cf` | 是 | 同上 | 状态10、消息48、任务卡及8000合成任务；当时全类型有既有TS2345 | 纳入候选 |
| 样式对比 2bc5b95a | 只读调查/用户纠偏 | 无产品提交 | 不适用 | 无待提交产品要求；后续修正在其他任务 | 只读源码/资源比较；未运行浏览器 | 不为调查补造提交 |
| Quote默认/焦点 1b83873c | 产品 | `1b52588d5725b343f6095f90ef6fcfe9cad5f4e0` | 是 | owner已交提交；共享dirty不归因 | 16单测、浏览器109、类型/CSS/build；旧多引用1失败 | 纳入候选 |
| Background Inbox 3f818f42 | Demo后获准产品实施/提交，指定前置 | `3c5461180575aa90f9430f35152f444530185913` | 是 | owner最终交付已读；共享dirty不归因 | review21测试/148浏览器、Web类型/build；2000任务首批20行、折叠0请求；24条既有全类型诊断 | 纳入候选 |
| 自动回传 1aa0def2 | 产品，指定前置 | `b3f3e1359e713d8d0faf7b32b8ae7da934010c53` | 是 | owner已交提交；共享dirty不归因 | 精确提交61+22=83合成测试、源码类型；261为组合工作区，不能混计 | 纳入候选 |
| TaskCard事件 ec05972a | **Demo后实际产品实施并提交** | `c84977626af7e234c82a096d18c3d96ebbbdead1` | 是 | owner已交提交；共享dirty不归因 | 34测试、四屏、顶部74、类型/build | 已在main；按最终授权纳入，非纯Demo |
| 交互架构图 8e2ad9fd | 设计/说明 | 无需产品提交 | 不适用 | 不等待，不混入图件 | 非产品验收 | 排除 |

不能仅凭任务标题的 Demo/排查/审查判断最终性质；上述三项后来已有明确实施及提交。已提交只证明变更进入 main，不代表已安装。没有将工作树残余自动认定为对应任务缺交或批量合并。

## 桌面发布的必要缺口

当前 main 的完整历史未包含 `scripts/build-macos-desktop.mjs`、`scripts/desktop-runtime.mjs` 或 `packaging/macos`。`package.json` 只有 CLI/Web build/start，没有可用于最新 main 的桌面打包入口；当前产品也无 `desktopResources`、桌面管理启动/严格退出接线。

真实已有框架是 Swift/AppKit/WKWebView，应用身份 `app.homer.desktop.candidate`，版本0.1.0 build3，随包Node22.22.0/Codex0.163.0，UI与后端包内绑定、随机本地端口。无需引入Electron/Tauri或新更新平台。

保存的源码入口：`/Users/wolf3c/Project/homer/docs/workspace-retirement/2026-10-22/radiant-hertz/candidate-source/`。根据 `docs/patches/2026-10-22-macos-source-relocation.json` 枚举的38个文件，本轮全部存在且SHA匹配。它们仍是未整合的旧候选，不能直接执行旧构建得到本版：旧脚本固定137项旧前像，再覆盖7个旧owner；产物将排除今天的main增量，且不绑定完整Git SHA。

交CTO/原owner在main形成独立、可审阅提交的最小闭包：

1. 恢复已有macOS原生包装、资源身份与运行/profile脚本；对 `src/config.ts`、`dev-host.ts`、`service.ts`、`engine.ts`、`media-decode.ts`、`scripts/dev.mjs`、`ui/homer-app.tsx` 逐hunk适配今天的main，保留今天删除能力/登录界面的产品边界，不能整文件覆盖。
2. 将打包输入改为准确完整已提交树，记录Git SHA、sourceHash、UI/后端manifest和包版本/build；取消旧137文件/旧owner overlay拼装。沿现有签名/公证工具和稳定bundle身份，不绕过系统校验。
3. 明确日常数据连续性：旧桌面默认新建 `Application Support/Homer Desktop`，不自动采用开发版账号/原线程；现有 `rehearse-desktop-migration.mjs` 仅合成演练，不能把它当生产迁入程序。先提交能保护既有Homer独立HOME、配置、线程、库和引用的准确采用方案，再执行维护点切换；不要求用户重新建立账号来冒充保留成功。

以上涉及当前产品启动/认证/退出和数据采用合同，不属于release内的构建参数修正。本轮只读确定缺口并交协调，没有在release修产品、复制归档源码或创建新框架。

## 已核旧恢复材料

路径 `/Users/wolf3c/Project/homer/.codex/private/releases/homer-macos/0.1.0-3-notarized/`，不是已安装位置：

- `Homer.app`：0.1.0 build3，sourceHash `b791bea4d667195616cdcf09381589f134e23e22ed153d4758bf912036d689a9`，manifest `1b3a38148feb5393d360a9178d8c8840e768b6fc6d261d7b5dff0bea32bcf93c`，uiHash `7f048ac5b20bb71955e7bf0bcf60401ab3d4f973a078f5baad1e258ed129b1cb`。
- `Homer-0.1.0-macos-arm64-notarized.zip`：176056216字节，SHA256 `17b84f4f0c1b1519030d5e6dcbab0a73d99c3ad342e81e538b4f2299d30ed69f`，匹配归档记录。
- 宿主正常上下文 `codesign --verify --deep --strict` exit0。第一次受限沙箱内同命令exit1，未据此误判包损坏；复核并未修改包。本轮没有重新做公证/Gatekeeper或第二台Mac验收。

## 条件齐备后的执行计划与完成标准

1. 先读两前置最终提交和桌面闭包提交，以 `git merge-base --is-ancestor` 核main；只冻结一次完整SHA，并在宿主已登记的独立worktree构建，后续main提交留下一版。已有无关dirty不阻塞，也不进入包。
2. 在候选执行前后端类型、构建、source-only官方CSS一致性及真实桌面原入口隔离冷启动。以当前前像归因既有全类型/旧测试失败，不宣称全绿。离线副本核schema/history/queue/artifact/权限、主线程/uncertain/FK及引用完整性，再补320/390/1440合成界面与新状态交互。
3. 候选冷启动通过后才核实际App/launcher/host/engine和原生操作/上传/审批/渠道写入，以正常退出管理入口进入停写维护点。保护业务库、gateway、配置和引用，私有材料只写Gitignored `.codex/private/`。无未知写者/停机冲突才安装，不清锁、不强杀、不重放。
4. 标准安装目标拟为 `/Applications/Homer.app`（当前未发现已安装Homer，实际若发现原目标则沿原路径更新）。由已安装App启动，核实际路径/版本/build/GitSHA/sourceHash/manifest及所有后端/UI资源来源，不能新前端连旧服务。只读核历史/原线程/队列/成果/权限连续性及新UI；不消耗真实模型或外发，不把合成验证称Fast实测。
5. 安装并验收成功后，先保全非敏感发布身份和同维护点最小恢复组合，核运行引用并卸载临时卷，再删除本次及旧无用DMG/ZIP/PKG和无引用打包目录；正常worktree收尾，保全独有工作。记录实际逻辑清理量，APFS空间变化不称物理释放。

完成必须同时具备：准确冻结SHA、实际安装路径/时间/包身份、已安装App运行来源、核心验收和连续性、保留限制、清理清单及回退边界。当前这些尚未发生。没有新安装成功，故未删除唯一旧恢复材料、旧安装包或其他任务目录；本轮清理量为0。

接续方式：CTO收到前置与桌面整合结果后续接本任务；本轮不建立sleep轮询、定时任务，不催改/重派/代提交他人任务。新基线启动若失败，回main由原owner修复、审阅提交，再显式重新冻结，不在release拼补源码。
