# DeepSeek 桌面隔离入口 · 2026-10-28

> 2026-11-03：本文记录的直接配置 Token 开发功能已退役，启动命令和手填凭据方式不再适用。当前统一使用网站账号授权，见 [账号与模型连接](architecture/account-and-model-connection.md)。

后续维护源码已将默认 effort 调为 high，并增加模型目录与执行保护，见 [Codex 适配与执行保护](2026-10-28-deepseek-codex-adaptation.md)。下文 max、候选身份及真实验收均为此前包的记录，不表示本次改动已打包或安装。

本轮只接入本人手动提供的 BYOK Token。主 Agent 和 Worker 共用 `https://models.super-tree.com/v1`、`deepseek-flash`、`effort=max`、`fast=false`，固定 Codex 0.163.0。没有网站授权、余额、订单或账号归属验证，也没有安装替换日常 Homer。

## 本机使用

当前准备候选的双击入口：

`/Users/wolf3c/.codex/worktrees/homer-account-stage1/homer/.codex/scratch/desktop-deepseek/try/Start-DeepSeek.command`

1. 双击入口，在 macOS 原生隐藏输入框输入 Token；不要把 Token 发进聊天、命令参数或配置文件。
2. 桌面窗口标题为“荷马 · DeepSeek”；“荷马 → DeepSeek 连接信息…”可核对固定模型配置。输入有效凭据只证明本地配置已备好，真实可用性要看模型实际回复。
3. 自己发送消息后才开始模型轮次。可交办一个 Worker 在隔离 workspace 中生成文件，再由主 Agent 核对。调用需要使用者自己的 Token 和额度。
4. 用 Cmd+Q 或菜单退出，确认停止当前回复和后台工作。下次启动重新输入同一本人的 Token，沿用该入口的独立对话和文件。

该双击入口固定的数据目录为同目录下 `profile/`；它从空目录创建，与日常账号、旧 CLI 演示、其他测试 profile 分离。修改了 Token 所属账号时应新建实例；本轮没有网站身份凭据，不能证明不同 Token 属于同一人，不提供数据认领。

维护入口可为其他**明确选定的本机候选**新建隔离实例：

```sh
node scripts/deepseek-desktop.mjs --app /绝对路径/Homer.app
```

控制台只输出新建目录；恢复同一本人的实例时追加 `--profile /此前隔离目录`。该参数拒绝无 DeepSeek 标记、非私有目录、符号链接和桌面原账号 adoption 描述。原日常 Homer 的启动入口、配置和数据保持原样。

## 秘密与生命周期

Token 只经原生隐藏输入的进程管道返回 Electron 主进程，再通过一次性 FD 3 管道传入随包 Node 服务；服务清除继承环境后只加入固定 `HOMER_DEEPSEEK_TOKEN`，由已有 CodexEngine 向可信 Codex 子进程注入。Renderer 没有 Token 输入或读取 API；启动参数、公共配置、错误及 stdout 状态中没有 Token。原生 shell 执行继续沿引擎的 `shell_environment_policy.inherit=none`，不继承模型凭据。本轮未实现 Keychain 保存，退出后须重输。

取消、输入无效或退出期间迟到的输入均不创建模型服务。没有凭据的 BYOK 桌面仍保持不可发送；原 ChatGPT 桌面继续核对原生账号。固定模型、effort、Fast 和 Responses provider 沿同一配置供主 Agent／Worker 使用，不做热切换或静默降级。

新实例不自动提交首次初始化轮次；初始 Codex 配置关闭后台记忆生成和使用。配置初始化可重试，完整私有种子文件通过原子硬链接发布，不覆盖已有配置；中断后缺文件会重新补齐。正常退出保留现有“停止 ACK + 实际 exit 0”联合确认，不删未确认 owner，不自动强杀或重启。

如启动/停止未确认，保留窗口、目录和 owner 记录核对；不要删锁或重放结果未知的模型请求。回退只需确认退出隔离实例，再打开原日常 Homer；不迁移或覆盖旧数据。测试用 `--test-profile ... --deepseek` 始终只选离线协议 fixture 和合成凭据，与真实入口分开。

## 候选身份与构建

- Base：`a88fbd631441a4a6db9bbab44839b223b3415ff7`，来自当时已提交 main；桌面增量在本次 review 后独立提交并合入本地 main，准确提交见 Git 历史及新包 receipt。
- 准备候选 sourceHash：`46404675bb8a7c336c0d83fe94e9ccced1c681bbab7497a10cbe001424654bba`。
- ZIP SHA-256：`de997745ada2b8ada891b6d2d8af7237aa3a236aafabde97444b95172e2b698e`。
- 目录：`.codex/scratch/desktop-deepseek/candidate/forge/Homer-darwin-arm64/Homer.app`。
- 构建记录：`.codex/scratch/desktop-deepseek/candidate/desktop-build-result.json` 与 `source-provenance.json`；`preparation=true / publishable=false`，只在显式测试 profile 或私有 DeepSeek profile 运行，不能采用日常账号。

`desktop-source.mjs` 有限清单只增加运行时、DeepSeek helper 和 dev-host；构建打包新增 helper。未把脏主树或产品 UI 的并行改动纳入候选，也未新建分支。原准备候选采用当时本机锁定工具链和官方归档；该工具链目录后续已不存在，重新打包在独立 scratch 按已提交 package-lock 离线恢复构建依赖，不安装或改动当前 App。

```sh
node scripts/build-desktop.mjs \
  --source-sha a88fbd631441a4a6db9bbab44839b223b3415ff7 \
  --maintenance /Users/wolf3c/Project/homer/.codex/scratch/app-package-20261028-a88fbd6 \
  --prepare-candidate \
  --archive-source /Users/wolf3c/Project/homer/.codex/scratch/review-install-20261026/official-archives \
  --scratch .codex/scratch/desktop-deepseek/candidate
```

复建须使用新的空 scratch 目录；以上候选保留供核对，不覆盖重建。Node 为 22.22.0，Codex 固定 0.163.0；没有升级引擎。

## 验证范围与证据

维护源码测试覆盖：原生隐藏输入的固定 argv／秘密管道、取消与迟到结果、私有目录／拒绝接管、初始化中断、双方角色 `max` 与显式非 Fast、原生账号和构建来源回归。后端和 UI 类型检查、Vite 编译、Forge 打包和本机签名检查由上述构建实际通过。

实际 Electron 合成验收覆盖无 ChatGPT 账号的 BYOK 启动、零自动首次轮次、主对话发送、独立 Worker 生成 `hello.md`、主 Agent 验收与交付、双方 Responses／model／effort／serviceTier、正常退出、同线程重启、用户消息保留、私有目录逐字节合成 Token 扫描。390px／1440px 截图检查无横向溢出。原生隐藏输入控件曾单独验证返回；后续真实桌面验收由使用者在原生隐藏输入框提供 Token，未读取或记录 Token。

```sh
node --test tests/desktop-deepseek.test.mjs
node --import tsx --test tests/desktop-deepseek-engine.test.mjs \
  tests/desktop-profile.test.mjs tests/desktop-source.test.mjs tests/desktop-adoption.test.mjs
node --experimental-vm-modules --test tests/electron-shell.test.mjs
node --import tsx --test tests/model-config.test.ts tests/worker-default-fast.test.ts \
  tests/desktop-management.test.mjs
HOMER_TEST_APP=/绝对路径/Homer.app HOMER_TEST_SCRATCH=/隔离测试目录 \
  node --test tests/electron-desktop.test.mjs
```

记录位于 `.codex/scratch/desktop-deepseek/`：`unit-final.log`（27/27）、`shell-final.log`（167/167）、`model-regression.log`（131/131）、`electron-verified.log`（3/3），以及 `initialization-red.log`／`initialization-green.log`。初始化中断问题经只读复核发现，先复现失败，再修复并复核关闭。Electron 旧测试的异步 `waitForFunction` 会过早返回，现已改成真实状态轮询；Worker 完成另以数据库和实际文件断言，不能以模型文字宣称成功。

广泛运行时回归 `runtime-final.log` 首轮 8 项中 4 通过、3 超时、1 取消；机器当时负载较高。将这 4 项单独重跑后 `runtime-recheck.log` 为 4/4 通过，覆盖路径/SQLite 逃逸、原账号 gateway CAS 与数据保留、拒绝活动/未知 owner。合并两次记录，适用的 8 项均取得通过证据，保留原始失败，不把整轮重写为一次通过。

随后在使用者明确授权下，对上述准备候选完成真实桌面主 Agent → 独立 Worker → 文件验收与交付。原生会话元数据确认所有相关主／Worker 轮次均为 `deepseek-flash / max`；Fast 关闭由固定配置与合成协议断言确认，真实供应商下游 service tier 未独立取证。最终 `hello.md` 为 41 字节，SHA-256 为 `13b941780e233d8698c4a18dee8f02fd1a86a7195fa262006eaeb0105e0f2e95`，实际内容与记录一致，桌面成果按钮与预览交互正常；数据库结果为 accepted、交付为 recorded。原始证据保留在上述隔离 profile 的 runtime 与 codex，会话原文和 Token 不复制进维护文档。

这次真实验收经历一次返工：首次 Worker 写了文件但未登记正式文件产物，主 Agent 出现 `task_invalid_verdict` 参数重试与 `artifact_missing`；主 Agent 拒绝该结果并派发修订，第二次 Worker 登记的文件才正式验收交付。因此只能证明实际链路可完成，不能声称首次交付可靠、性能优异或没有重试。供应商费用、图片、长上下文和压缩能力仍未验证；本轮没有新增前端包、常驻模型查询或轮询。

2026-10-28 合并前 review 未发现桌面代码阻断项。核对 main 已包含 `a88fbd6` 引用导航、`78fda26` 阅读位置保持、`dadcdf5` 底部提示清除及 `545d95d` 已确认交付时间修复。交叉回归发现时间显示集成测试遗漏新引用导航 Context，已只补齐测试夹具注入，不更改产品行为。仅打包已提交 main；不会把主树并行 dirty 纳入包，也不安装、替换或重启当前 App。新包身份与版本、签名检查结果保存在构建 receipt 与打包验收记录。

合并前新执行的检查：`review-unit.log` 7/7、`review-shell.log` 167/167、`review-regression.log` 初次 218/219（时间显示夹具缺 Context）；补齐夹具后 `review-chat-green.log` 13/13。因此该 393 项不同用例均有通过证据，原始失败保留；不是一次完整仓库测试全通过。本次仅重建和静态检查包，不启动新 App 或发起额外模型轮次。
