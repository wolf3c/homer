# Homer 账号与模型 MVP 实施记录

命名更新：2026-10-30 源码统一改用 `runtime-config.json` 和 `.runtime-config.json.pending`，旧文件首次安全迁移；详见 [当前原生 Token MVP 说明](2026-10-29-homer-native-token-mvp.md)。下文旧名称及合成证据路径保留为历史记录。

> 历史实施记录，旧独立模型账户／钱包与支付联调不再是当前方案或验收依据。当前实现以 [原生 Token MVP](2026-10-29-homer-native-token-mvp.md) 和 v1-r5 合同为准；下文只保留已发生的历史事实。

2026-10-28。实施基线 `e5849805acbb9ea9eacb680b2dfb6f3b89e90dd1`，原账号候选提交 `53c6cc4`；本轮按用户授权审阅并合入本地 main，最终提交以 Git 记录为准。只修改隔离工作树，不采用主树并行 dirty，不安装、替换、重启日常 App，不执行真实账号、支付或模型调用。

共同方案为 `2026-10-28-homer-mvp-integration-v1-r3.md`，锁定 SHA-256 `444e3e1f834048668d975de11f96a90e2baba98dbbec414268f49ab8bdaea332`。本文记录当前实现与验证，不覆盖共同协议。

## 已实现

1. 现有 `src/homer-account.ts` 负责连接校验、内存 PKCE/state、loopback 回调、兑换、唯一连接文件与原生余额解析。未增加账号管理器、数据库表、后台服务或依赖。
2. Electron 主进程通过既有可信 preload 入口接线，设置窗口复用账号／权限两个标签。无 Token、文件损坏或权限错误时管理界面仍可打开，模型不可执行。
3. 保存后保持本轮执行连接；用户确认正常停止、收到 stopped ACK 且子进程退出 0，才重启采用。断开也先正常停止，再清 Key、保留网站归属并重启。取消退出、停止失败不清 Key、不清锁、不强杀或启动第二 owner。
4. 复用既有 profile、runtime、workspace、Codex HOME、主 thread、任务与文件。新安装只准备固定桌面目录；非空未知目录拒绝采用。保留现有首次初始化机制，成功连接前不发模型请求，旧 profile 不重新初始化。
5. 两角色执行及展示共用有效配置：主 `homer-main`，Worker `homer-worker`，max、Fast 关闭、Codex 0.163.0。原 `{token}` 文件保持旧 `deepseek-flash` 路径。后台记忆提取保留关闭配置；用户本轮另行确认，后台整合绑定当前角色别名并接受固定引擎的 medium。既有记忆与工具不删除。
6. 本人查询使用 `/api/usage/token/` 的 `user_quota`，不采用 Token 的无限额度；`/api/status` 不带 Key，按原生单位换算。失败显示未知或带更新时间的旧值。查询合并、模型结束只发无内容失效通知，账号区打开才刷新，无轮询。

## 角色能力与范围

| 请求 | 模型 | effort / Fast | 已有证据 |
| --- | --- | --- | --- |
| 主 Agent 普通轮次 | homer-main | max / 关闭 | 真实固定163 + 合成 Responses，原生工具写文件 |
| Worker 普通轮次 | homer-worker | max / 关闭 | 真实固定163 + 合成 Responses，原生工具写文件 |
| 后台记忆整合 | 当前角色别名 | 固定 medium / 关闭 | 用户确认后真实固定163验证，无第三模型名 |
| 图片、长上下文／同步压缩、真实费用 | 同上角色入口 | 由固定协议与供应商能力决定 | 尚无新增实际验收，不能以普通 Chat 替代 |

## 文件与信任边界

唯一秘密文件是当前 profile 对应 appData 下的 `deepseek.json`。已有 adoption 按其 appData 定位，新安装使用桌面 profile；不写原公共模型配置或数据库绑定。

旧格式为 `{token}`；网站格式为 `{token,subject,accountRef,modelBaseUrl,aliases}`。网站 `modelToken` 只在保存处映射为 `token`。断开网站连接保留其余四字段，同一 subject 可重新连接，不同 subject 拒绝。

读取检查私有权限、文件所有者、符号链接和大小；保存采用同目录 `.deepseek.json.pending`、0600、fsync 与原子 rename，失败保留原文件。两角色工具同时 deny 最终文件和临时文件；下次写入或断开清理经过同样校验的崩溃临时文件，遇外来／符号链接临时文件拒绝操作。没有额外明文 Key 备份。

Token 经既有 FD 3 单次传入随包服务，只进入可信 Codex 模型环境；不进入 Renderer、URL、argv、工具环境和应用诊断。回调只接 code/state，精确检查 Host、路径、重复参数、期限及当前操作有效性；先监听再开浏览器。取消／退出／超时中止监听与请求，迟到结果不采用，不重试原 code，不撤销共用模型 Key。

公开配置只来自包 manifest：

```json
{"account":{"websiteOrigin":"https://website.example.invalid","gatewayOrigin":"https://gateway.example.invalid"}}
```

这是非秘密格式示例，不能当作可用地址。构建参数为 `--website-origin` 和 `--gateway-origin`，两者必须一起提供。正式地址仍待 owner 确认；未配置时设置明确提示。正式运行只接受 HTTPS。prepare-candidate 构建可带 HTTP127，但只有显式 `--test-profile` 隔离运行接受，正常日常入口不放宽。

## 实际验证

环境为 Node 22.22.0、现有 tsx、固定 Codex 0.163.0、Electron 45.0.0。测试全部使用新合成目录及假凭据。

| 检查 | 结果与边界 |
| --- | --- |
| 10 个聚焦测试文件 | 318/318 通过；覆盖协议、文件、profile、角色、IPC、沙箱、设置与旧 DeepSeek 路径 |
| 源码与 UI TypeScript | `tsc -p tsconfig.json --noEmit`、UI TypeScript 通过 |
| 广义 `tsconfig.check.json` | 未通过；输出与准确 HEAD 导出的基线逐字归一比较相同，未增加错误 |
| 最终准确包 Electron | 4/4 通过，含自动交付、正常重启、两角色协议、Worker 实际文件、余额变化、断开与原历史保留 |
| 最终准确包 macOS runtime | 11/11 通过，覆盖原生回退、owner、路径、schema 和启动／退出边界 |
| 界面 | 390/1440 实际 Electron 界面、标签、连接与断开路径通过，无横向溢出；已查看截图 |
| 真实 0.163.0 + loopback Responses | 1/1 通过；两角色 max/non-priority、实际原生写文件、工具环境无模型 Key，后台整合只用两个别名、medium |
| 三方实际网站／AMH／Electron | 1/1 通过；自动交付、正常重启、假支付后同 Key 余量及界面刷新；桌面模型部分仍为协议 fixture |
| 真实163 经实际 AMH | 1/1 通过；独立新 HOME、网站交付的 Key、两个角色原生文件写入与回读，合成上游 |
| 停用后的新模型请求 | 1/1 通过；AMH 用原生 Token 更新停用精确合成 Key 后，新 Responses 请求被鉴权拒绝；本轮未开启 Redis／内存缓存，不代表暖缓存场景已验证 |
| 全仓 suite | 未全绿且未完整结束；多个失败与等待，不能称全仓通过。四个 first-launch 失败另在准确 HEAD 归档复现，其他失败未全部确认归属 |

聚焦命令：

```sh
node --experimental-vm-modules --import tsx --test --test-concurrency=1 \
  tests/homer-account.test.ts tests/desktop-profile.test.mjs \
  tests/model-config.test.ts tests/desktop-deepseek.test.mjs \
  tests/desktop-deepseek-engine.test.mjs tests/desktop-permissions-ui.test.mjs \
  tests/electron-shell.test.mjs tests/desktop-source.test.mjs \
  tests/desktop-management.test.mjs tests/deepseek-isolated.test.mjs
```

包验收用 `HOMER_TEST_APP=<准确测试包>` 及独立 `HOMER_TEST_SCRATCH` 运行 `tests/electron-desktop.test.mjs` 与 `tests/macos-desktop-runtime.test.mjs`。当前工作树缺 Electron 构建依赖，已在 scratch 从现有 lock 离线恢复，Electron 测试逐字复制到该维护目录运行；未更改项目依赖。

原生严格测试命令：

```sh
TEST_APP="/absolute/path/Homer.app"
HOMER_TEST_CODEX="$TEST_APP/Contents/Resources/runtime/codex/vendor/aarch64-apple-darwin/bin/codex" \
  "$TEST_APP/Contents/MacOS/node" --import tsx --test tests/homer-account-native.test.mjs
```

未设置该变量时此测试跳过；显式设置时必须如实检查退出码。真实引擎使用合成 Responses，不代表真实供应商已验证。

三方隔离测试使用 `tests/homer-account-integration.test.mjs`（Electron、网站与 AMH；模型部分是协议 fixture）。`tests/homer-account-gateway.test.mjs` 使用 `HOMER_TEST_CONNECTION=<本轮 scratch 内连接文件>` 和 `HOMER_TEST_CODEX=<固定163>` 验证真实引擎经 AMH 到合成上游（同样使用包内 Node 执行，以满足实际桌面资源身份校验）；设置 `HOMER_TEST_EXPECT_DISABLED=1` 后仅运行停用验证，不重放此前模型轮次。缺少这些显式输入时测试跳过，跳过不算通过证据。文件参数必须指向本任务合成目录，不能使用日常凭据。网站和 AMH 测试实例由各自 owner 启停。

本次准备包 build 111，version 0.1.0：

- sourceHash：`6d9070513b706bd8c014aa10071be01eb1e93093bb4be48949bf87b6cb95eb12`
- uiHash：`d0fa6fb33552cadba9a39c6a011a7e37fe5d05c599046a4a1e8d1ee9c2739a9b`
- ZIP SHA-256：`83b97c62d87a946fb2a8032471de53531565fccfd4e132c7f17eee427c3b4753`
- preparation=true、publishable=false；ad-hoc 签名严格校验通过，非 Developer ID／公证包。
- manifest 为 3180 网站／3182 网关，仅限三方合成候选，不能作为用户发布包。

原始证据位于 `.codex/scratch/account-mvp/`：`focused-final.log`、`source-typecheck.log`、`ui-typecheck.log`、`typecheck.log`、`baseline-typecheck.log`、`baseline-firstlaunch.log`、`full-suite.log`、`native-163.log`、`three-projects.log`、`gateway-native.log`、`gateway-disabled.log`。实际网站链摘要与余额截图在 `three-projects/synthetic-XyU09z/`；私有连接文件不能作为公开交付附件。最终构建 receipt 为 `package-integration/desktop-build-result.json`、Electron 证据为 `electron-final-verified.log`（4/4）、runtime 证据为 `runtime-integration.log`（11/11）；此前 `electron-integration.log` 的第四项端口冲突已在各 owner 释放端口后复验通过，未放宽超时或断言。早期随机端口包记录在 `package-final/`。receipt 所列生产候选输入与当前源码摘要已逐项一致校验。过期构建目录已清理，最终 receipt、产物和日志保留。

## 仍在联调／未验

原生后台模型差异已解决。真实 0.163.0 最初除两个 alias 外还请求 Terra／medium，根因是 `generate_memories=false` 不阻止 phase2 整合。准确源码：[startup](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/memories/write/src/start.rs)、[phase2](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/memories/write/src/phase2.rs)。用户明确确认“采用别名绑定，接受后台整合 medium”后，仅在 `src/engine.ts` 两处既有日常模型配置增加 `memories.consolidation_model=当前角色有效 model`。红绿测试和真实引擎复验均通过；未修改网关白名单、固定版本或记忆工具。这个决定不授权真实调用。

三方候选与本轮收尾记录：

- yezi2：HEAD `bf5aebafcfb245907452ff8c1cc57e1138968515` + 未提交实现；最终产品聚合 SHA `5b2267e55bc6e8964c6bced224715a3dde23e2050b1406dbbc9e77c9392a8a1a`。共同测试期间 live 与最终源差一行“无 gatewayOrigin 提前拒绝”，有配置路径不变，故不能冒称当时已联调最终整份网站源码。收尾后网站 owner 另回执最终代码 46/46 隔离 Mongo／HTTP／DDP、25 轻量测试及 1280/390 实际浏览器测试通过；该最终本方回归与前述三方链分开记录。长期网站／Mongo 实例已由其 owner 正常关闭，证据见网站 `docs/homer/2026-10-28-yezi2-mvp-implementation.md`。
- AMH：HEAD `445b05eb3b44ddaa6d07e75890f24d6e43a3cd93`、上游 `6cf0d90b5ff27f901697dddd61e0c28aba8efefc` + 本地 lab；3182 测试宿主使用实际业务处理器、新 SQLite 与假上游，非生产整站／镜像。产品 patch SHA `0a43bfbd712dea8651d6b0c8a84483cae2ff6d599baa261ea45e62fb9af7bc5b`，测试宿主 SHA `1c0207cfedf1b5ae1cb5f76b858ab0470db40205819482c48a8dcbe52f2bd68a`（补原生 InitEnv 后同库恢复，AMH 已核对钱包、Key 和充值执行记录保持）。停用验证后 owner 正常关闭测试网关与假上游，保留合成库和证据。正式 HTTP 配置仍拒绝。
- Homer：实际浏览器链已通过 1/1：自动保存、正常重启、假支付后同 Key 原生余量 +100000、界面刷新。真实 163 经实际网关到假上游的两个角色原生文件测试也通过 1/1；这与桌面协议 fixture 交付是分开执行的证据，不能冒称同一条完整桌面真实模型端到端。AMH 随后用原生更新方法停用精确合成 Key，本方新 Responses canary 1/1 通过鉴权拒绝；未删除用户／Key、改钱包或重放旧轮次。原生更新与资金保全证据由 AMH 持有；该 lab 未启用 Redis／内存缓存，不能外推到暖缓存。跨项目服务秘密只通过隔离私有配置文件接线，不写本文或聊天。

尚无真实供应商兼容、图片、长上下文／压缩、收费或性能证据；不得称生产可用或性能优异。没有新增轮询和常驻服务；余额并发合并是请求约束，未经基准测量不宣称性能提升。

## 使用、取消、断开和回退

正式 origins 与三方验收齐备后：设置 → 账号 → 登录并连接 → 系统浏览器完成登录／开通 → 返回 Homer → 重启并应用。首次初始化提示会使用模型额度。购买、订单、退款均在网站处理。

等待时可取消并重新连接；code 失效或兑换失败需重新开始。保存失败保留原文件；取消或迟到成功不调用远端撤销。归属不符联系维护方，不删除 subject 以绕过。

断开本机连接先确认停止，清除本地 Token 并保留归属与全部业务数据。远端停用联系网站维护方；本机断开不等于停用远端共用 Key。停止未确认时保留窗口与 owner，核对后处理，不强杀、清锁或重放未知计费轮次。

原生账号回退沿既有显式 `--native` 入口，须先正常退出同一 profile owner。原公共配置／账号绑定未改，不做 DB 恢复或迁移；回退仍暂停旧任务。不能把网站 Key 交给假定旧固定 gateway 的旧版程序。升级或回退不复制明文 Token 备份，不删除 thread、任务、交付、记忆或文件。

## 本地 main 合并审查补充

原候选审查无阻断项，提交前重新验证 318/318 及源码／UI TypeScript。其后 main 已推进至 `2ef3083`，包含统一渠道设置和 DeepSeek 参数／执行守卫。本方组合保留这些已提交功能，设置使用同一 panel 状态与丢弃确认；网站连接固定 max/Fast 关闭，旧直接 DeepSeek 采用 main 已有 high／显式配置行为。

审查复现了构造器再次归一配置导致 Worker 退成主别名（4/5 通过）的失败；传入实际角色后恢复。两个固定别名复用同一个 DeepSeek 模型模板、上下文配置与执行守卫，补齐目录与 profile 的配套投影；未增加动态能力发现。别名缺失适配的断言先失败，再通过。合并后的组合检查 366/366、追加设置组合 16/16、源码／UI TypeScript 与真实163合成工具链 1/1 已通过；旧 build111 三方记录仍只证明其自身 sourceHash，不冒称新提交已重跑整条三方链。

最终组合产品提交为 `6ed08c5aa533e42ac7dafeae6889299a7a7b43ee`，与此前 main `2ef3083` 做合并；原账号提交 `53c6cc4` 保留在历史中。重新构建的 build115（0.1.0、163、Node22.22、Electron45）通过 ad-hoc 严格签名校验，sourceHash `eb5869e3d528cf8fdb5612ba56b9c489883feb32e6a6b9e6075d6db38695fc21`、uiHash `d5919981e5557210b4a027ef9d02fba108c63f2cefe25b08813cc4ba9ce9b594`；仍为 loopback preparation、非发布包。准确包 Electron 4/4、runtime 12/12 通过。runtime 原用例的 adopted source 本来显式 high，而旧断言仍要求覆盖成 max；按 main 已提交的保留显式 effort 语义，改为先生成并锁定 high/max 两种合成 source，再分别验证两个角色和原历史／回退，保留准确 source 摘要检查。没有为通过而改变运行逻辑或删除断言。

合并验收日志：`merge-focused.log`（366/366）、`merge-settings.log`（16/16）、`merge-tsc.log`、`merge-ui-tsc.log`、`merge-native.log`（真实163＋loopback 1/1）、`electron-merge.log`（4/4）、`runtime-merge-complete.log`（12/12）；初始角色／目录失败与 runtime 旧断言失败日志也保留。新包 receipt 为 `package-merge/desktop-build-result.json`。旧 build111 的三方链及新组合候选的独立验证分开记载，后续网站 readiness 修正与 AMH shell_command fixture 修正未冒称已整条重跑。

另外两方已确认且本方只读核对本地分支：yezi2 `master=c88a1aa6a6f4aa3feae48d25b76ca4797bf55506`（默认分支原名 master，不另造 main），其最终源摘要 `56e53477a6a0b136b4ad3609e36cffc7e8feb265ad2ca5a8d77af55ba49b0f64`，46 隔离／27 轻量／浏览器1通过回执；AMH `main=92d2d86880607867bad30236a110fa90c6aacb3d`，产品 patch 仍 `0a43bf…`，假上游脚本新增按请求工具选择 exec_command／shell_command，SHA `f9a650691ee1add1b98cc1ad4a9f05000c8eab85a224deb8e37cbcac12b8cfb3`。两方已保留旧联调摘要与最终源码的差异，正式环境未变。

## 最终已合并产品的三方合成复验

2026-10-28，本轮获准协调三方复验、修复本范围问题；未执行新提交、合并、部署、安装、日常 Homer 重启或真实付费调用。三方产品代码未改，仅补测试设施和本记录。

版本锁定：Homer `main=aae7e8b1daa2dc3d0c77a546d8ec671d71c8e1eb`；网站 `master=c88a1aa6a6f4aa3feae48d25b76ca4797bf55506`（产品聚合仍为 `56e53477…`）；AMH `main=81982e8724723b9539cbc14858481bcd747140f1`（产品提交 `92d2d86…`，产品 patch 仍为 `0a43bf…`）。复用上节准确 build115：20 项准备输入逐项匹配最终源码，产品提交 `6ed08c5…` 到当前 HEAD 仅文档和 runtime 测试差异，严格签名通过。没有采用主树的 88 项并行 tracked dirty。

网站使用新的隔离 Mongo、既有合成账号登录和假支付 SDK；网关使用新 SQLite、实际业务处理器及独立桌面假上游场景。端口为网站3180、Mongo3181、网关3182、假上游3183。首次桌面由未连接的新 profile 开始，后续复测沿用同一已充值的网站本人账号；不将它说成每轮都新建网站账号。真实模型引擎为包内固定163，测试 profile 的既有替身入口仅通过 `process.execve` 透传真实二进制，未模拟原生协议或放宽产品校验；浏览器仅替换 OS 打开链接动作，其余登录、回调、兑换、保存均走实际代码。

| 本轮实际检查 | 结果 |
| --- | --- |
| 最终三方产品、真实 Electron＋163 完整正向链 | 第3轮 1/1：网站自动交付→点击正常重启→采用本人连接→主 Agent 实际派发→Worker 读材料并写 hello.md→主 inspect/review→正式交付；真实原生 turn_context 两角色分别为 homer-main／homer-worker、max、非 priority |
| 假支付、本人额度和界面 | 同 Key 总授予额度精确增加100000；重放同一订单通知不再增加。真实初始化可在付款期间结算，因此用 available＋used 核对授予守恒，同时检查 UI 的实际可用余额刷新 |
| 再次正常退出、重开 | 原 thread、用户消息序列、Worker 交付文件保持；用户历史没有重复增加 |
| 网站—网关资金交叉核对 | owner 按合成订单 externalRef／subject 的摘要逐笔核对：本轮3笔明确假订单各 credited 一次，各100000；300000＝钱包298110＋累计已用1890（停用前最终快照） |
| 原生停用后的新请求 | 精确本轮共享 Key 仅 status 从 enabled 改为 disabled，钱包／订单保留。新 Responses 返回401；同 profile 的真实桌面新用户请求呈 failed，没有 completed，thread／原消息保留；定位对应新消息的“这条回复未完成”并等待停止按钮消失，1/1 |

正向原始日志为 `.codex/scratch/account-mvp/final-triad/desktop-real163-attempt3.log`，停用与实际渲染复验为 `desktop-disabled-rendered.log`；各运行另一个不适用用例明确 skip，不能把 skip 算通过。非秘密聚合证据为同目录 `result.json`、`native-role-contexts.json`；合成 profile 为 `.codex/scratch/account-mvp/three-projects/final-merged/synthetic-gnAM7R/`，其中连接文件仍为私有凭据，不作为公开附件。

本轮发现和修正的均为测试设施：

- 第1轮实际 Worker 已写出、inspect/review 成功，但假上游最终消息缺 `phase=final_answer`，Homer 正确拒绝将其作为内部协调的正式正文。AMH 补失败断言、JSON／SSE phase 后，22 项设施与15项实际 HTTP 自检通过；第3轮正式 delivered。
- 第2轮旧断言只看 available，忽略了真实163初始化期间消耗180。改为精确核授予守恒及重复通知不增额，未改价格、账本或放宽校验。
- 第3轮交付后测试仅等用户 `isRunning=false` 即退出，此字段不覆盖内部协调；退出时主引擎关闭，留下 `main_turn_failed/internal_processing_failed: engine_closed`，真实记录保留，不能声称无失败事件。曾尝试增加正向 `mainActivity` 空闲等待，第4轮准备验证时网关停用动作已先完成，授权等待失败；不计正向通过、不恢复 Key。最终撤回未经正向复验的额外等待，保留第3轮实际通过的正向断言；本轮验证的是可正常停止并保全数据，不是退出前所有内部通知均已排空。负向／渲染分支保留已实际通过的 `mainActivity` 等待。
- 原停用 sidecar 只接受 three-projects 直下的合成目录，拒绝本轮嵌套目录且未改库。AMH 将规范路径限定在原 scratch 子树、synthetic-* 父目录及 deepseek.json，保留 provider／subject／精确 Key 核对，补正反用例；实际停用版本和后续设施 guard 回归版本分开记录。

最终实际服务的假上游 SHA-256：`fake_upstream.py=363291990b4dddfa82c9aa574b78ecc76714b5601c8a994f715ed17d122b3ee7`，`desktop_fixture.py=e2b9e8c1a543e552dee6b3b3c1d22e0303a2d134ddfe8b5daddab8e77ad65ddb`。该场景只按真实工具回执前进，未改网关产品接口或角色别名。停用 guard 后续回归源码 SHA-256 为 `ce939e3abae4867214d600367b076b212d41fb0c147e20b4be3803d310aa54c0`，实际停用所用前一版本由 AMH 回执保留。

复现正向入口：设置 `HOMER_TEST_APP=<准确build115>`、`HOMER_TEST_SYNTHETIC_LOGIN=<本轮login.synthetic.json>`、`HOMER_TEST_REAL_CODEX=1`、`HOMER_TEST_SCRATCH=<本仓three-projects下隔离目录>`，运行 `node --test tests/homer-account-integration.test.mjs`（使用已有 Playwright 维护依赖解析环境；本轮逐字复制该测试到 scratch maintenance/tests 执行）。停用分支不设置登录输入，改设 `HOMER_TEST_DISABLED_PROFILE=<已成功的本轮合成profile>`。只使用独立测试实例，禁止套用日常凭据或生产地址。

本轮未重跑全仓 suite，没有真实供应商、真实收费、图片／长上下文／压缩、暖缓存停用或生产负载证据。这里的真实163表示原生引擎真实执行，上游仍是合成模型响应；不等于 DeepSeek 供应商兼容验收或可以生产上线。

独立审查收窄了负向证据字段：断言能证明用户历史仅追加本次消息，不能据此宣称网络请求没有自动重放；测试和汇总改记 `userHistoryAppendedOnce`，原始日志不改写。本轮没有独立统计原生网络重试／重放。审查后的调整仅为测试名称与证据标签，运行断言未变。

收尾独立核对3180／3181／3182／3183全部无监听，四个合成 profile 的 owner／cli／gateway 锁均释放。主树在本轮期间由并行工作推进到 `751a13f700955ae8e220a5b37ebe3d6ed85b6673`，相对锁定的 `aae7e8b…` 只增加移动端方案文档及 README 链接，没有产品代码差异。本任务未写主树；原88项 tracked dirty 中87项文件字节相同，README 的并行文档变化保留，暂存仍为空。Homer 本轮未提交修改仅本测试和本记录，均留在原隔离工作树。

## 正常退出的 engine_closed 归因与修正

2026-10-28，获准查因、最小修复、审查提交并合入本地 main；上述“不提交”描述是上一轮联调边界。实施 base 为隔离树 `aae7e8b…`，合入前 main 为 `751a13f…`，两者产品源码一致；主树88项 tracked dirty 和空暂存已另行记录，不能作为本次提交输入。

已确认这两条事件来自同一次主动退出取消：Worker 正式交付后79ms，新的内部协调轮次正在执行；`Homer.close()` 设置 closing 并关闭自有引擎，`CodexEngine.closeProcess()` 将活动 turn 拒绝为 `engine_closed`。`mainTurn` 和 `processWorkerInput` 随后各记录一次失败。该轮次保留为 failed、原通知为 blocked，文件仍已交付；没有供应商失败证据。这是宿主把正常取消归成失败的缺陷，不需要等待所有内部通知排空或延长退出时间。

最小修复仅在 `closing && engine_closed` 时采用既有 interrupted 语义，两个协调错误事件均不再生成；仍执行原退役及停止确认。停止未确认时，退出继续报错，过程／原通知保持 unknown／uncertain；意外断线以及非退出期间的 engine_closed 仍为失败。用户轮次没有原生终态时仍为 uncertain，不能因此自动重放。退出中的无正文回复改为“已停止当前回复，原记录已保留”，避免误称已派发 Worker 仍在运行。未改引擎、退出协议、数据库、账号接口或等待期限，不重写原联调数据库和历史失败事件。

验证证据在 `.codex/scratch/account-mvp/shutdown-review/`：

- `tsx --test tests/service-shutdown.test.ts` 先复现正常退出被记 failed 和两条错误事件（red.log，2失败／2通过），修复后扩为6项，全部通过；覆盖确认／未确认退出、退出中意外断线、运行中 engine_closed、用户输入 uncertain、原通知及文件保全、持久退出文案。
- `tsx --test tests/service-shutdown.test.ts tests/engine-rpc-lifecycle.test.ts tests/service-interactions.test.ts`：38/38（focused-final.log）；准确源码编译后的 `desktop-service-startup.test.mjs`：5/5（desktop-stop.log），包括不能伪造主／控制／Worker owner 停止确认。
- 账号／模型／原生账号／队列／DeepSeek 聚焦组合：123/124（account-related.log）；唯一失败 `Homer owns one control child, user-only account mutations and login handoff fence retain original main thread` 使用已删除的 `app.memory.settings`，在未修改基线同样复现（baseline-native-account.log）。
- `tsc -p tsconfig.json --noEmit` 及源码编译通过。完整 `tsconfig.check.json` 有113项既有错误，与准确 HEAD 提取的未修改基线逐项归一后完全相同（typecheck-comparison.json），本轮源码／新测试无新增类型错误。
- 扩展 Web 组合53/57，4项失败在基线逐项同名复现：`quote source ID and selected text reach the existing main thread`、`Web pending card reply returns through main decision to the original interaction`、`real user generation sink orders start/delta/confirmed terminal and ignores delayed stop and foreign events`、`a failed main generation terminates only when failure or process shutdown is confirmed`。`service.test.ts` 的10秒有界运行和基线同样先通过4项后超时；原非限时组合也未完成，不能报全绿。
- 已实际发起仓库 `npm test`；在旧记忆测试停滞后停止本任务的测试进程树，保留95条已观察失败记录及准确名称（full-suite.log／full-suite-failures.txt），不是完整 suite 统计，也未逐条归因为基线。上面已单独核对的基线失败不扩展为整仓无回归声明。未配置联调环境时两条三方用例明确 skip，不算验收通过。

独立只读审查核对本轮全部四个文件及关联退出路径；发现的退出文案和测试 SQL 问题已修正，最终无剩余阻塞意见。保留上轮实际 build115 联调结果；该包不含本节源码修复，本轮未重新打包或重跑三方服务。没有安装、部署、日常重启、真实账号支付或模型供应商调用，未做性能基准。
