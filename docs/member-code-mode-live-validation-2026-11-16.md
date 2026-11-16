# 最终 Homer 候选的会员 Code Mode Only 实网验收

2026-11-16：**通过**。使用最终源码的实际 `Homer`、`CodexEngine`、Main 签收、Worker 派工与回传；官方 Codex `0.171.0-alpha.7`，macOS ARM64、Node `22.22.0`。没有安装、重启或修改日常 Homer 的配置、账号、历史及业务库，没有提交或发布。

## 实际执行

通过生产 `queryHomerRuntimeConfig` 读取会员公开配置，再经真实会员网关 HTTP Responses 执行。此次下发值为 **Main `gpt-6.1-terra / medium`、Worker `gpt-6.1-terra / high`**；Worker 并非之前记录的 Sol，未擅自覆盖成另一模型。

| 角色 | 模型生成与本地执行 | 回传及终态 |
| --- | --- | --- |
| Main | 模型生成 JavaScript，经 custom `exec`／Lark 调用一次本地回执工具；观察到其原生 `codex-code-mode-host` 子进程 | 本地新生成的随机值进入下一次 `custom_tool_call_output`，原生最终回复精确匹配；实际派出一个 Worker，并处理其内部回传 |
| Worker | 模型生成 JavaScript，经自己的 Code Mode Host 调用一次本地回执工具 | 随机值进入后续模型请求，最终回复精确匹配，Homer Run 为 `succeeded`，结果沿正式 Worker 回传路径保存 |

共 **6 个真实生成请求，全部 HTTP 200 且 `response.completed`**；未出现 400、宿主重试、重复本地回执调用、额外 Worker、命令、文件修改、图像或搜索操作。上限为 8 个请求、每请求最多 2048 输出 token；未通过重试选择成功样本。独立记忆合并请求在本地被拒绝一次，没有转发或计入真实生成请求。

网关报告输入 77,736 token，其中缓存输入 51,710；输出 295 token。这是响应 usage 汇总，没有核算账单或推算费用。

## 源码与隔离证据

- 冻结当前 `src/`、`prompts/`、三个内置 Skill、package／tsconfig，以及 Windows security／desktop profile 脚本和声明，共 127 文件；在独立候选中编译成功，运行后与工作区逐文件摘要相同。
- 按相对路径排序，每项依次散列“路径、NUL、原始文件字节、NUL”，SHA-256 为 `617151224ab7bfab250991153e010de6cd95e0d78a076ee189c12863e2fdcc9f`。其中生产引擎等关键文件与前一轮核心 2737/2737 的源码摘要一致。
- 使用官方 npm 平台包，归档 SHA-256／SHA-512 SRI 与仓库锁一致；Codex 二进制 SHA-256 为 `4e37dbc4dcad2aa285e1d246823e0466ea62171a8dbd6d1684d77e9da3abcb2e`。
- 不手设 `tool_mode` 或全局 Code Mode Only：由冻结源码自动生成会员目录；实际请求出现 custom `exec`／Lark，本地回执工具没有直接暴露成普通 function。
- 使用真实 Homer 宿主和生产工具／提示词，工厂只选择本次下发的角色连接、接入有界观察代理并增加一个无参数、无外部副作用的回执工具。真实密钥只在观察代理内存中，用于同一个获授权网关；原生进程和命令环境只获得临时回环凭据。
- HOME、CODEX_HOME、runtime、工作目录及业务 SQLite 全新独立。无真实渠道适配器；输出进入测试 sink。隔离配置将目录外访问设为拒绝、工具网络关闭，插件、Apps、Hook 和宿主 Skill 发现关闭；本次没有另跑沙箱负向命令，也不改动产品配置。
- 原生所有者严格关闭确认，私有测试历史和数据库均已回收。日常配置／凭据文件前后摘要相同，日常 Homer 进程身份相同。观察器不保存请求／响应正文、生成代码、工具参数／结果或凭据，只记录计数、布尔值、usage 和代码摘要。

## 可重复入口

维护入口为 `tests/member-code-mode.live.test.mjs`，登记于显式 engine 清单，默认 `npm test` 不运行。必须显式 opt in，测试不会发现日常凭据：

```sh
HOMER_MEMBER_CODE_MODE_ACCEPTANCE=1 \
HOMER_TEST_SERVICE_MODULE=file:///absolute/candidate/dist/service.js \
HOMER_TEST_CODEX_BIN=/absolute/pinned/codex \
HOMER_MEMBER_CODE_MODE_REPORT=/absolute/ignored/report.json \
node --test tests/member-code-mode.live.test.mjs
```

实网凭据只由获授权启动器放入 `HOMER_MEMBER_TEST_TOKEN` 的进程环境，不写命令行或文件；测试读入后移除该环境变量。离线预检另设 `HOMER_MEMBER_CODE_MODE_SYNTHETIC=1`，不提供真实 Token。本次预检 1/1，实际同一 Homer 派工／双角色闭环通过；注册边界定向 3/3、完整类型检查及 MJS 语法检查通过。前一轮完整核心结果继续对应其冻结源码，本轮未重复全量。

收尾核对无在途测试进程及原生运行时打开文件后，回收本轮官方包、解压引擎、源码／编译副本和过时预检材料，逻辑大小约 521 MiB。仅暂留约 22 KiB 的脱敏结果、源码摘要和最新检查记录，供当前未提交验收入口与报告审阅；相应提交审阅完成或撤回后删除。私有运行资料和启动器已移除，没有保留凭据副本。

本次仅证明当前会员 Terra 配置的 **HTTP** Code Mode Only 闭环。未测试 Sol 等其他别名、真实 WS、会员登录刷新、完整计费、插件、Intel／Windows 或安装。会员网关未透出 Azure 诊断头；没有另行直连 Azure 或审计后台路由，不能用响应别名或头缺失推断后台供应商发生变化。

## 本地提交的证据归属

上述6次实网请求属于本报告散列的共享源码快照。按后续本地提交授权提取的窄候选保留HEAD既有HOME策略，不混入并行HOME、渠道或UI工作；该候选另通过9项原生合成验证及类型检查，核心2672/2674的两项图片失败在未改HEAD同样复现，详见[提交复核](testing.md#本地提交候选复核2026-11-16)。本次没有追加实网调用。
