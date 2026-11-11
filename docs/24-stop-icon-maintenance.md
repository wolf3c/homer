# 停止图标最小维护发布

后续状态：停止图标继续保留。2026-10-17 22:12 已完成整树已验候选维护并恢复源码自动更新，最新日常版本与回退边界见[候选发布](25-verified-candidate-release.md)。本页记录此前固定9ab/f91维护，不再表示当前仍固定旧入口。

2026-11-06 清理了重复的离线重建目录 `stop-icon-rebuild-zpXyv5`：其源码与 `stop-icon-compatible-source` 一致，构建输出除指向同一依赖目录的链接路径外一致。重建清单保留在 `.codex/scratch/native-capabilities-implementation/stop-icon-rebuild-zpXyv5-manifest.json`；其原路径为历史记录，旧固定入口及回退材料未删除。

当前源码已退役专用固定 UI 启动器。下文命令用于记录当时的维护流程。开发版换版失败由 `scripts/dev.mjs` 回退，显式恢复固定构建见[固定旧构建回退](19-pinned-rollback-launcher.md)。

本维护仅将日常停止按钮改为方形图标。固定业务版本 `9ab6864a6c45`、原主 thread、数据库 schema、渠道与引擎配置保持原值；不启用当前源码中的 MCP/Skill、iLink 或其它候选后端。发布结果及时间见文末实际回执。

## 已核验的输入

- 后端冻结目录：`.codex/scratch/dev-upgrade/builds/9ab6864a6c45-a37b05bb-0870-4585-b46e-c18e0cee83a8`。
- 原 UI：`6bb20b7f14f5d1d372c70c31f919a256fa4e0a1b0b61fc641a8d32bbf48100d5`。
- 图标 UI：`f91ad7a94848c89ee1909c3c7ed24860f3be23aaf5a2dcaf90c11ec2deda5fdc`。
- gateway：`98a8d410b28ce10eeca8434238355a878cd983868294abcb07da46ca365c2b4a`；dependency：`6ec82c3861e35ea215327c670026ca067320f4f5602a70bc38b93e198ba8a712`；Web protocol：1。

原补丁当时由专用脚本从准确冻结 UI 走正常类型检查和构建，仅两个 UI 文件改变；该旧补丁重建脚本现已退役。原 hash 目录不覆盖。新固定入口不扫描当前源码，不构建或自动采用其它后端；保留现有 durable ingress、队列、Web/终端共用业务 owner、正常关停及原消息身份。

## 维护与回退操作

以下操作须在已获准的维护范围内进行；不是自动升级或后台保活任务。

1. 两次临近维护的只读空闲检查：主回复、Worker、待答/待审/队列、transport 和渠道待发/发送均为空；驻留主 engine 的正常 lease 不等于忙碌。浏览器检查仅返回草稿是否存在，不读取正文。有草稿先保护，不强制刷新。
2. 核实实际 launcher/child/Terminal tty 身份；仅向准确 launcher 正常发送 SIGTERM，等待 owner、engine 正常退出及两把锁释放。禁止广泛 kill 或强杀。
3. 新建 `.codex/private/stop-icon-maintenance-20261017/`（0700），SQLite 原生 backup、gateway backup、原配置与入口清单（0600）。不复制 auth、Keychain、原生 sessions 或私人 Codex 配置。原业务 schema 不迁移。
4. 用 `preparePinned` 针对新备份生成原 9ab 清单；`scripts/prepare-fixed-ui-entry.mjs` 固定入口与基准/补丁到新的 Homer build 子目录，记录完整源码、构建资源、入口文件、实际运行依赖与配置身份。启动前再验原 thread/schema/tools/六 uncertain 逐行 hash、空闲和锁。
5. 在原 Terminal 的原 tab 启动维护点记录的冻结 `fixed-ui-launcher.mjs run <fixed-manifest> <原配置> 4780`。保留前台持久进程，不依赖开发会话生命周期。停止用该 Terminal 的 `/quit` 或准确 PID 的 SIGTERM；无强杀、自动重试或自动切树。
6. 核对 `/api/state` 的实际旧业务版本/原 thread/新 UI，逐一核静态资产 hash、微信连接及原 uncertain 行。真实页面只观察；停止按钮的实际点击仅用合成实例测试。

回退入口与步骤保存为维护点中的 `start-icon.command` 与 `start-original-ui.command`。两者使用同一原后端、原数据与严格清单，后者增加 `--baseline-ui`。先自然空闲、正常退出，再在原 Terminal 启动原 UI；不覆盖补丁或原资源。补丁损坏时原 UI 可独立核验启动；入口、后端或基准损坏均拒绝。没有新业务事实时可以按维护点审阅恢复；有新事实只前向修复，不套旧 SQLite 快照。

## 验证

固定入口测试需显式给出审阅的旧后端、基准 UI 和图标 UI 路径，以免普通测试误用本机日常：

```sh
HOMER_PINNED_TEST_BUILD=<9ab冻结目录> \
HOMER_FIXED_TEST_BASE_UI=<6bb冻结目录> \
HOMER_FIXED_TEST_PATCH_UI=<f91冻结目录> \
node --disable-warning=ExperimentalWarning --test tests/fixed-ui-launcher.test.mjs
```

真实旧 `dev-host.js` + 合成 engine、空 HOME、临时 SQLite 验证：同 thread 恢复、原队列接收、原 stop 路径、正常关停与锁释放、EOF 保留 Web、旧 UI 回退、再采用图标、源码/资源/入口篡改拒绝、锁拒绝及启动失败恢复。无真实账号/模型调用或微信外发。605/1470 浏览器实际输入合成消息并点击停止，核对空文字、44×44、title/aria、disabled/busy、独立发送与无横溢。

相关共享入口回归为 `dev-upgrade`、`dev-gateway`、`web-dev-host` 和 `dev-ingress`，以及项目 typecheck。不是重跑已完成的382全量检查。初次测试夹具漏 Origin、将 stop 的202误写200，以及普通 Node 不能载入 TypeScript 参数属性，均作为夹具错误单列；修正夹具/改用现有 `tsx` 后重验，不改网关保护或业务契约。

## 实际发布回执

已于 **2026-10-17 21:37（Asia/Shanghai）** 按用户针对最小维护的“继续”授权完成日常发布。

- 两次临近维护均自然空闲；正常 SIGTERM 仅发送给已核实的原 launcher，614ms 内原 launcher/host/engine 归属子进程全部退出，业务/网关锁及 lease 释放，无强杀。
- 新维护点：`.codex/private/stop-icon-maintenance-20261017/`，目录0700，配置/数据库/清单/启动与回退材料0600。未复制 auth、Keychain 或原生 HOME 数据；业务 schema 未迁移，workspace 未改。
- 固定入口：`.codex/scratch/dev-upgrade/builds/fixed-ui-b43d3e61-48da-4b82-9e5d-7802e83ab4b6/scripts/fixed-ui-launcher.mjs`。完整私有清单 SHA256：`e718a13e8b5d6c2d05e43b13f5b6c8318ece0469cf68becd6b912e4bfbb5c6c8`。
- 日常地址：`http://127.0.0.1:4780/`。原 Terminal window7325、`/dev/ttys000`、原 shell47294 持续运行；发布核查时 launcher84816、业务 host84818（PID仅作当时证据，未来操作必须重新核实）。后端仍 `9ab6864a6c45`，UI为本页固定的f91补丁，原主thread `01a1437f-9fcd-7950-9e8b-c6f96f7f61f0` 已恢复。
- 实际 HTTP 返回的 index 与补丁原文件相同；JS `index-DyYEIGYM.js` SHA256 `7107e0dc18649e33840e772931071ab1548370677d3c71fbd4bd7cbe778b8cde`，CSS `index-BGnEUAVx.css` SHA256 `fff3bd1b071010be67949646241d205564468019de7540834be0eb97974c3653`，均逐文件匹配。完整旧后端 inventory、源码及原配置保持原 hash。
- 原五 MAIN_TOOLS hash `e6d674a05ae34945a5e234a2b1f55029f0d319e51371f448911845224062cf9a`；SQLite schema hash `b1e8f96a9c342f8236cf53528b9aed6b19aa0d8f813a27217b2d3ba8f8939cd9` 未变；维护点记录保留检查 changed=[]、quick_check=ok、foreign_keys=0。微信 connected，原六 uncertain 逐行 hash 全部相同。
- 确认真实页面可见输入与保存草稿为空、主轮结束后，刷新既有日常验证页；实际浏览器加载f91资源。605/1470均无横溢、独立发送保留。日常当时空闲，停止按钮按原语义不显示；正在回复时的图标、44px与等待状态已在**同一资源、同一旧宿主的合成实例**实点验证，没有在日常提交对话或点停止来制造截图。
- 本轮新增固定入口2/2、相关入口回归4/4、ingress4/4及 typecheck/三份 launcher 语法检查退出0。完整382项是本轮最小维护之前的候选证据，未无故重跑，也不冒称覆盖新增入口。

日常服务保留运行。新 MCP/Skill 原生候选、订阅隔离与其它 iLink 候选仍保持独立的未上线/待验证状态。固定维护入口不会自动切换到当前整树。以后恢复源码自动升级须另审阅兼容边界，不能仅改 manifest 或删 guard。
