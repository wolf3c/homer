# Homer 运行配置简化实施计划

命名更新：2026-10-30 源码统一改用 `runtime-config.json` 和 `.runtime-config.json.pending`，旧文件首次安全迁移；详见 [当前原生 Token MVP 说明](../../2026-10-29-homer-native-token-mvp.md)。下文旧名称及合成证据路径保留为历史记录。

> 本文的运行配置同步已实现并保留；旧网关账户／钱包／充值与 v1-r4 共同包已退役，当前身份交付和额度定义见 [原生 Token MVP](../../2026-10-29-homer-native-token-mvp.md) 及 v1-r5 合同。历史验证不等于新方案已联调。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** yezi2 维护主 Agent／Worker 配置，Homer 自动获取并保存，正常重启后采用；New API 只负责账户、模型访问与计费。

**Architecture:** 复用网站现有设置、登录交付、Homer 账号模块、唯一凭据文件与重启流程。新增一个非秘密配置 GET 接口；不新增数据库表、后台服务、依赖或配置页面。

**Tech Stack:** 现有 Meteor／New API、Node 22、TypeScript、Electron、固定 Codex `0.163.0`。

**Spec:** 本文 §1–4 记录本轮用户确认的产品取舍；§5–6 是对应实施与验收步骤。本文包含方案与后续实施记录；实现和联调状态以文末实测记录为准。

## 全局约束

- 2026-10-29 用户已另行授权按本方案实施、跨对话协调、测试与合成联调；随后另行授权 review／最小清理／提交并合入各自本地主干；不部署、不安装、不重启日常 Homer、不做真实付费调用。
- 保留历史 thread、任务、消息、交付文件、原生账号／BYOK 及既有首次初始化机制。
- 普通主 Agent／Worker 首版均为 `deepseek-flash`、`max`、Fast 关闭；后台记忆整合沿当前角色模型，固定引擎 `medium` 保持不变。
- 不新增 refresh、设备 grant、多账号切换、桌面订单、模型目录、配置管理平台或通用工具配置框架。
- 本文不覆盖已锁定的 v1-r3 共同合同；实施前由三方统一修订一次接口与 fixtures，不静默兼容两套网络定义。

## 审阅重点

1. 连续发送与网络失败：一小时内不反复请求；失败也算一次检查。由迭代三测试。
2. 配置保存期间继续聊天／开 Worker：全部继续使用本次运行的配置，避免半套新旧参数。由迭代二、三测试。
3. 错误 URL、重定向与旧请求迟到：不向未批准地址发送 Token，不覆盖新连接。由迭代一、二测试。
4. 旧凭据升级与断网：不猜模型、不丢唯一 Token、不覆盖历史；缺少可用配置时仍能打开设置。由迭代二测试。
5. 展示与执行不一致：两个角色、后台记忆和余额各自使用正确来源，查询成功不冒充模型兼容。由迭代二及联合验收测试。

## 1. 三方只保留这些职责

| 项目 | 保留／调整 | 不增加 |
| --- | --- | --- |
| yezi2 | 登录、购买、交付本人 Token；维护一份公共运行配置并提供查询 | 个人配置表、版本发布系统、模型转发 |
| AMH／New API | 本人账户、钱包、Token、已有已发布模型访问与计费；去掉 Homer 专用别名依赖 | Homer 模型配置 CRUD、专属模型目录 |
| Homer | 获取配置、校验、保存、正常重启采用；角色执行与余额展示 | 第二份配置文件、定时服务、热切换 |

“不限制模型”指 Token 不设 Homer 专用模型白名单，使用已有商业模型分组与渠道。账户隔离、余额计费、停用、渠道权限和价格仍生效；不开放管理 API 或内部测试渠道。当前 AMH 补丁创建 Token 时已未启用模型白名单，应先核实现状，只移除实际存在的专用别名／限制。

## 2. 配置与接口

### 2.1 主 Agent／Worker 独立配置

```json
{
  "main": {
    "baseUrl": "https://models.super-tree.com/v1",
    "model": "deepseek-flash",
    "effort": "max",
    "fast": false
  },
  "worker": {
    "baseUrl": "https://models.super-tree.com/v1",
    "model": "deepseek-flash",
    "effort": "max",
    "fast": false
  }
}
```

每个角色自带 Base URL、模型、effort、Fast，不设共享默认值或继承规则。字段独立，首版值相同；未来可分别修改已验证的组合。首版只接受以上已支持的模型／参数组合，开放网关模型权限不等于 Codex 自动兼容所有模型。

复用包 manifest 已批准的 gateway origin，分别校验两个 Base URL：正式 HTTPS、批准 origin、`/v1` 路径，无用户名、密码、query 或 fragment。不要求两个字段相等，但也不因字段独立而允许向任意新站发送本人 Token。接入第二供应商及其独立凭据时再扩展；本轮不预建。

搜索等工具配置等真正接入时再增加对应字段，本轮不增加空 `tools`、通用键值或插件注册实体。

### 2.2 一个公开配置接口，原登录接口继续交付秘密

- yezi2 在现有 `private.homer` 设置中增加 `clientConfig`，内容就是上面的角色对象；无需新增表或管理页面。
- 新增 `GET /api/homer/v1/config`，成功 `200` 直接返回该对象。显式挑选公开字段，不序列化整个私有设置；不包含 Token、用户信息、商户或服务秘密。无需登录 Cookie，不接收／转发模型 Token。配置缺失或非法返回 `503`，不拼默认配置。
- `/homer` 的 PKCE／state、loopback callback、兑换请求五字段不变。兑换成功响应统一改为 `{subject, accountRef, modelToken, config}`；`config` 与 GET 使用同一读取／校验函数，避免登录得到另一套默认值。
- AMH 账户交付响应计划精简为 `{subject, accountRef, modelToken}`；角色模型与 URL 由 yezi2 配置负责。三方一起删除网络响应中的旧 `aliases`／`modelBaseUrl` 依赖，保留身份、入账幂等与安全边界。
- GET 复用现有请求超时（20 秒）和禁止重定向约束；服务端不长时间缓存，客户端每次实际检查发起网络请求，不被旧缓存永久挡住更新。

Token 只在登录／重新连接时交付，每小时检查不重新发 Key。余额依旧查询 manifest 批准的账户网关，不从 `main.baseUrl` 或 `worker.baseUrl` 推导钱包归属。

## 3. Homer 的同步与生效规则

### 3.1 只在三个节点检查

| 节点 | 行为 |
| --- | --- |
| 登录／重连成功 | 直接校验、保存兑换响应里的 `config`，算一次成功检查，不再补一次 GET |
| App 启动 | 网站连接模式强制 GET 一次；成功采用最新配置后启动模型，有有效本地缓存时失败沿用缓存 |
| 用户发送新对话消息 | 后台判断距上次检查是否 **严格超过 3,600,000 ms**；超过才 GET，否则直接跳过 |

不设 `setInterval`、系统定时任务或空闲轮询。闲置两小时不请求；下一次用户发消息才检查。Worker 创建、Worker 通知、首次自动初始化、后台记忆、状态查询、队列整理不触发；用户主动回复／插话属于发送消息，重复请求不重复触发。

用一个内存时间戳和一个进行中的 Promise 即可：检查开始前记录单调时间，失败也更新；并发发送合并为同一个请求。恰好一小时不查，超过一小时才查。时间戳不落盘，重启本来就会检查；无重试队列和额外退避状态。

消息正常接受、入队和执行不等待网站响应。当前触发检查的消息仍使用当前有效配置；同步失败不阻断聊天，不重放付费轮次。

### 3.2 保存和采用分开，沿用现有状态

唯一文件仍为当前 profile 的 `deepseek.json`。新网站格式为 `{token, subject, accountRef, config}`；断开后清 `token`、保留非秘密归属。沿用现有 0600、所有者／符号链接检查和同目录原子替换，不生成额外明文备份。

启动模型前确定一次有效配置。运行中下载的新配置只保存为待采用内容，复用 `connection`／`activeConnection` 的现有比较与“重启并应用”提示，不增加持久化 `pendingConfig`、版本号或配置历史。规范化后相同的配置无需写盘或提示。

用户确认重启后，沿既有 stopped ACK 与退出码检查正常退出，再采用已保存配置。停止失败或用户取消，保留原运行、凭据和锁，不强杀、不自动重启。重启前新开的 Worker 也使用旧快照。

取消连接、断开、退出或更换连接时，复用现有操作代际和 AbortController；迟到 GET／兑换结果不能写盘。写失败保留旧文件；界面沿现有状态显示错误，不报“已保存”。同步和断开不能撤销网站共用 Key。

### 3.3 旧格式和历史

- 旧 `{token}` 文件继续走手动 DeepSeek 模式，不自动转网站连接，也不替换 BYOK／原生模型设置。
- 旧网站文件保留 Token、subject、accountRef；首次升级须成功获取新配置，再原子转为新格式，不猜测别名到实际模型的映射。若暂时无法获得配置，保留旧文件并进入可操作设置、模型未连接状态，恢复网络后正常重新启动重试。
- 新格式缓存有效而网站暂时失败，允许继续使用；明确显示同步失败／保留配置。无有效配置则不发模型请求，仍可登录、打开网站和设置。
- 不改历史数据库、profile 路径与 thread 绑定，不重跑已有用户初始化，不重放旧消息。回退版本前不把新格式交给不认识它的旧程序；恢复旧协议配置须另行受控处理，不以复制 Token 备份作回退手段。

## 4. 最小代码改动地图

以下是职责定位，不要求拆出新模块。所有路径相对各自仓库。

| 项目／文件 | 本轮必要改动 |
| --- | --- |
| yezi2 `server/homer_http.js`、`imports/api/homer/runtime.server.js` | GET 路由、读取并校验现有设置、公开白名单输出 |
| yezi2 `imports/api/homer/auth.server.js`、`gateway.server.js`（同目录） | 兑换携带同一配置，适配精简后的账户响应 |
| AMH `infra/new-api/homer-rc45/patches/0001-homer-mvp.patch` 及其锁／现有测试 | 精简账户响应，核实模型分组／白名单，删除专用别名依赖；不改变计费、幂等或 TLS 修复 |
| Homer `src/homer-account.ts` | `HomerRuntimeConfig={main:RoleConfig,worker:RoleConfig}`；`RoleConfig={baseUrl:string,model:string,effort:'max',fast:false}`；校验、读取新旧文件与 GET |
| Homer `packaging/electron/main.mjs` | `syncHomerConfig(reason:'startup'|'message'):Promise<void>`；节流、单飞、保存与错误状态；登录复用响应无需 GET |
| Homer `src/config.ts`、`src/model-config.ts`、`src/engine.ts`、`scripts/desktop-runtime.mjs` | 私有 FD 传递已校验连接；从有效快照按角色取参数，执行与显示一致，记忆整合随角色模型 |
| Homer `src/service.ts`、`src/dev-host.ts`、`scripts/dev.mjs` | 在真实用户消息成功接受且 fresh 后，通过现有状态观察／私有桌面通道发送无内容 `account_config_check`；排除 first_launch 和内部输入 |
| Homer 现有设置组件／桌面菜单 | 仅在必要时调整错误、角色信息与“重启并应用”文案；先读 `ui/DESIGN.md`，不新增页面／按钮／任意 URL IPC |

`submitMessage` 有提前返回的交互回复路径，实施时必须核对对应接受结果；不可在 HTTP 入站或 Renderer 点击时计数，避免未接受／重复消息触发。已有余额 `refresh()` 保持查询余额，不能改为配置同步。Renderer 永远收不到 Token。

## 5. 三个小步迭代

实施前重新确认实际 base／dirty 归属，不采用脏整树。本文只读观察的 Homer HEAD 为 `6c49d2901bac02a067575bc4a2231e3769f47e38`；不自动指定它为将来实施候选。各步先聚焦验证，后统一联调，不在实现中顺带升级引擎或修复并行功能。

### 迭代一：网站能交付一份配置

**接口：** GET 返回 §2.1；登录响应与 AMH 响应按 §2.2。三方同步修订共同合同和同一套合成 fixtures。

- [x] 在 yezi2 `tests/homer_http.test.js`、`tests/homer_auth.test.js` 补先失败用例：GET 无秘密、两个角色字段独立、非法配置 503、登录与 GET 配置相同、精简账户响应。
- [x] 运行对应现有测试，确认因旧合同／缺少 GET 失败；然后按 §4 在原文件实现，不另建配置服务。
- [x] AMH owner 用现有合成账户测试验证无专用模型限制、普通钱包扣费与停用不变，同时更新补丁锁；不因“全部模型”授予额外管理权限。
- [x] 重跑上述聚焦测试，记录准确候选与三方匹配的 fixture 摘要；通过后交付给 Homer 使用。

### 迭代二：Homer 读取配置并正确采用

**接口：** 校验后的 `config` 进入现有连接对象；`effectiveModelConfig(config, role)` 只读取本次运行快照。

- [x] 在 `tests/homer-account.test.ts`、`tests/desktop-deepseek.test.mjs`、`tests/model-config.test.ts` 补先失败用例：新旧文件、角色独立 URL、错误 origin／重定向拒绝、写失败保留、旧网站缺配置进入设置、新缓存断网可用。
- [x] 运行这三个文件确认预期失败；实现校验、原子保存、启动 GET／缓存采用与 FD 传递，复用现有连接状态。
- [x] 在 `tests/desktop-deepseek-engine.test.mjs`、`tests/electron-shell.test.mjs` 验证主／Worker 参数、后台整合模型及 medium、余额固定账户 origin、Token 不进入 Renderer／argv／工具；补停止失败与取消重启断言。
- [x] 重跑以上聚焦测试；通过后形成“登录 → 正常重启 → 两角色按配置执行”的可审阅增量，历史路径保持原样（本方合成验证；三方实例见实施记录）。

### 迭代三：发送消息时按需检查

**接口：** 无内容 `account_config_check` 私有事件 → `syncHomerConfig('message')`；同一函数处理时间门槛、并发与结果保存。

- [x] 在 `tests/electron-shell.test.mjs` 用可控时钟补先失败断言：`3_600_000` 不查、`3_600_001` 查；多消息一次请求；失败一小时内不重试；断开／退出后的迟到结果不保存。
- [x] 在 `tests/service.test.ts`／`tests/desktop-source.test.mjs` 补接受事件断言：正常发送／回复／插话会通知，重复、拒绝、first_launch、Worker 通知不会；延迟 GET 不阻断消息接受与模型执行。
- [x] 运行新增用例确认失败，再接入既有状态观察和私有通道；只增加必要时间戳／进行中 Promise，不新增消息内容或用户标识到事件。
- [x] 重跑相关测试；在 `tests/electron-desktop.test.mjs` 隔离场景确认待重启提示、旧快照继续执行、重启后两个角色一起采用，设置关闭重开及窄视口仍可操作。

聚焦命令使用现有 Node 22／tsx，例如：

```sh
node --experimental-vm-modules --import tsx --test --test-concurrency=1 \
  tests/homer-account.test.ts tests/model-config.test.ts \
  tests/desktop-deepseek.test.mjs tests/desktop-deepseek-engine.test.mjs \
  tests/electron-shell.test.mjs tests/desktop-source.test.mjs
./node_modules/.bin/tsc -p tsconfig.json --noEmit
./node_modules/.bin/tsc -p ui/tsconfig.json --noEmit
```

执行前核对各测试是否会触及外部服务；服务与 Electron 测试只选择本轮合成用例并使用新 scratch、HOME、runtime、workspace。依赖缺失先报告，不隐式安装；基线失败单列，不删断言或延长超时凑通过。提交与合并需另获授权，不作为上述步骤的默认动作。

## 6. 最后只验这条闭环

使用三方准确候选和固定 163，合成网站／AMH 账户／假支付／假上游；绝不读日常凭据或清理现有数据。

1. 登录自动交付 Token 和配置，正常重启，主 Agent 回复；Worker 实际创建文件，主 Agent 回读交付。
2. 更新网站角色配置后，模拟超一小时发送消息：本条消息不等待查询，下载后提示重启；重启前后记录两个角色实际 URL、模型、effort、Fast，与界面一致。
3. 无变更不重复写盘；网站失联、非法配置、取消和迟到均保留旧连接。断开清本机 Key，原历史和文件不变。
4. 假充值后原 Token 查到新余额，停用后新请求拒绝；不改变现有余额解析与缓存失效语义，不自动重放结果未知的计费请求。

交付仅需：三方共同定义／fixture 摘要、各自 base→candidate 与聚焦测试结果、上述闭环证据、连接／重启／断开／旧格式处理说明。合成通过、真实供应商兼容和上线验收分别记录；不能互相替代。

简化的结果是：**一份网站配置、一个只读 GET、一个现有本机文件、两个独立角色、三个检查节点；没有定时器，也没有新的配置实体。**

## 实施记录（2026-10-29，合成实施及联调完成）

三方已核对并确认唯一[运行配置合同 v1-r4](/Users/wolf3c/Project/yezi2/docs/homer/2026-10-29-homer-runtime-config-contract-v1-r4.md)，SHA-256 `14c0366b9fa8cd2eb185cd2e03828985b3c656364e148e1532b27b9441876125`。Homer 本轮 base 为 `6c49d2901bac02a067575bc4a2231e3769f47e38`，联调时改动尚未提交（最终提交见末节）；保留原发布准备文档和主树并行改动。

已实现配置校验／原子保存／旧文件升级、启动 GET 与有效缓存、主／Worker 角色配置、用户消息接受后的严格一小时检查、单飞与取消代际、既有重启提示。没有新增数据库表、依赖、后台服务或产品页面。

| 本方检查 | 实际结果／边界 |
| --- | --- |
| 账号协议／文件 | 13/13，已观察 RED→GREEN |
| 最终十二文件聚焦回归 | 357 项：356 通过、1 个可选共同包测试跳过；该可选测试带锁定包另跑 1/1 通过 |
| 桌面主进程 VM | 181/181，含启动断网、旧格式不能误报待重启、一小时边界、失败计时、并发与迟到 |
| 输入／审批／队列 | 26/26；真实用户接受通知用例另 RED→GREEN 1/1 |
| 源码与 UI TypeScript | 通过；不是全仓 suite 通过声明 |
| 实际固定 163、包内 Node、本机合成 Responses | 1/1：两角色 max／非 Fast、原生工具实际写文件、工具环境无 Key、后台同模型 medium；无真实供应商调用 |

临时证据在 `.codex/scratch/runtime-config-mvp/`。测试候选使用 APFS 克隆未改动的已安装运行依赖、完整编译本轮准确源与 UI、核对锁定依赖文件、重建清单及 ad-hoc 签名；`preparation=true/publishable=false`，不是安装或发布包。原 `/Applications/Homer.app` 未更改或重启。

空间曾不足，AMH 编译失败不能计作测试失败／通过。用户随后明确批准仅清理 AMH `homer-tools-20261028/go-cache`；执行指定 GOCACHE 的 `go clean -cache`，观察释放约 12.34 GiB。数据库、历史、候选、必要证据及模块下载缓存保留。两方已获通知恢复新实例构建，旧端口／旧库不复用。

独立只读审查已完成，未发现确定的 Critical／Important／Minor 问题。实际隔离 Electron 闭环 1/1 通过，覆盖自动连接、正常停止后采用、两角色文件交付、余额、390／1440 视口和断开保留历史；增加完整私有事件通道后再次 1/1 通过，确认 Worker 不触发检查、超一小时发送消息才 GET、紧接下一条不重复 GET、无变更不写盘。三方实际联调随后完成，结果见下表。真实供应商兼容及上线验收未执行。

本方测试候选源码摘要 `7ea1604bc8c7c24447e0638a905498e49429f2c9b690ff74d9f0775d79d0ab65`；20 个打包输入逐一核对与当前源码一致，原已安装 manifest 摘要仍为 `6e8d601dd81e55071820d3669eecadce355b8bcdc145cfb44a6c918a5ce78713`。

共同包沿用 AMH `infra/new-api/homer-contract-v1`，manifest SHA-256 `9dae73990c4e8442937c954dec85b4a65c4b18cccd7d2bc820d484d55a1779eb`，14 个 payload 摘要均核对。联调时包为 `publication=unpublished/sourceCommit=null`，不能称为已发布包。yezi2 最终 base `0f4794a9990772829c758b1fdacee1c3d316935f`，5 个产品文件摘要 `235d70828dc12c1e73d4b4367794cbcac2729b040f7e8420399f7624f07d366e`，34 轻量及 49 真实 Mongo／HTTP／DDP 检查通过，联调时尚未提交。


三方合成联调时的准确未提交候选如下；审查清理后的提交身份及最终包锁见末节：

| 项目 | 准确候选／验证 |
| --- | --- |
| Homer | base `6c49d2901bac02a067575bc4a2231e3769f47e38`；source SHA-256 `7ea1604bc8c7c24447e0638a905498e49429f2c9b690ff74d9f0775d79d0ab65`；8 个产品文件 diff SHA-256 `e7cb46cdfca745ff4988a847a20e83668924489d387cf0116ae33dd459fa2e2a` |
| yezi2 | base／source 摘要见上；34 轻量、49 Mongo／HTTP／DDP 通过；实际网页 checker 通过，含原登录、假支付通知、一次入账、重复不入账、PKCE 自动交付与公开 GET 匹配 |
| AMH | base `78abd82ee99e7610f19e56b5932d28ca874f910b`；source `6b2af346ab84c70e5868eb3716769231d63e46533151fc418949425870cf3c66`；patch `84ec4d93988ec2bc2f88e2c1a2941d8406bae321fd1cb1879f6e063632caf516`；实际测试 binary `1563bb38c72783cb8ca729050e17e7795d63dc7b9b8de3f4e9f3c1f728864679`，已本地核摘要 |
| AMH owner 证据 | Python 23、共同包 3、common／middleware 421、真实网关 smoke 15 通过；新库三引擎 28 通过，原 rc.45 种子升级三引擎另 28 通过，恢复启动与原用户／Token／价格保全通过。分别见 AMH `.codex/scratch/hm-8ytpfne7/report.json`、`.codex/scratch/hm-q820pxlo/report.json` |

| 三方实际验证 | 观察结果／本方日志 |
| --- | --- |
| 网站 → 桌面 → 固定 163 → AMH → 假上游 | 1/1 通过，42.6 秒；自动保存 Token／配置、正常停止并重启、Worker 实际写文件、主 Agent 回读交付；假充值 +100000 原生额度，重放不增额，原 Key 不变；重启后原 thread／用户消息／文件保留；`triad-electron.log` |
| 主／Worker 原生工具文件 | 1/1 通过，2.86 秒；同一 Key、两角色固定 163 经实际 AMH 创建各自文件；停用专用用例此时按设计跳过；`triad-native.log` |
| 原生停用后桌面新请求 | 1/1 通过，10.36 秒；请求被 401／403 拒绝，界面可见回复失败、没有伪成功；原 thread／历史保留，用户消息只追加一次，Renderer 无 Key；`triad-disabled.log` |

上述日志位于本方 `.codex/scratch/runtime-config-mvp/`；非秘密汇总 `final-evidence.json`。新 profile 为 `.codex/scratch/account-mvp/three-projects/runtime-config-20261029/synthetic-gcpL0i/`，`evidence.json`、`disabled-evidence.json` 与两张实际截图保留；`deepseek.json` 含合成凭据，不作为公开证据复制。原生停用仅更新该合成 Token，钱包和充值执行记录不变，AMH owner 的受限控制证据在 `.codex/scratch/homer-runtime-17xshbi6/token-control-v597suxc/report.json`。

实际命令以本仓为工作目录。该次 root 依赖未提供 playwright-core，复用已有锁匹配 maintenance 依赖，并将未改内容的测试副本放进 scratch harness 解决加载；没有安装依赖或修改产品依赖：

```sh
HOMER_TEST_APP="$PWD/.codex/scratch/runtime-config-mvp/app/Homer.app" \
HOMER_TEST_SYNTHETIC_LOGIN=/Users/wolf3c/Project/yezi2/.codex/scratch/homer-runtime-config-lab-20261029/login.synthetic.json \
HOMER_TEST_WEBSITE_ORIGIN=http://127.0.0.1:3184 \
HOMER_TEST_GATEWAY_ORIGIN=http://127.0.0.1:3183 HOMER_TEST_REAL_CODEX=1 \
HOMER_TEST_SCRATCH="$PWD/.codex/scratch/account-mvp/three-projects/runtime-config-20261029" \
node --test --test-name-pattern='actual website and AMH' \
  .codex/scratch/runtime-config-mvp/harness/tests/homer-account-integration.test.mjs

HOMER_TEST_CODEX="$PWD/.codex/scratch/runtime-config-mvp/app/Homer.app/Contents/Resources/runtime/codex/vendor/aarch64-apple-darwin/bin/codex" \
HOMER_TEST_CONNECTION="$PWD/.codex/scratch/account-mvp/three-projects/runtime-config-20261029/synthetic-gcpL0i/deepseek.json" \
HOMER_TEST_GATEWAY_ORIGIN=http://127.0.0.1:3183 \
"$PWD/.codex/scratch/runtime-config-mvp/app/Homer.app/Contents/MacOS/node" \
  --import tsx --test tests/homer-account-gateway.test.mjs

# 仅在 AMH owner 用原生方法停用该合成 Key 后运行；不再次充值或兑换。
HOMER_TEST_APP="$PWD/.codex/scratch/runtime-config-mvp/app/Homer.app" \
HOMER_TEST_DISABLED_PROFILE="$PWD/.codex/scratch/account-mvp/three-projects/runtime-config-20261029/synthetic-gcpL0i" \
HOMER_TEST_GATEWAY_ORIGIN=http://127.0.0.1:3183 \
node --test --test-name-pattern='native-disabled synthetic' \
  .codex/scratch/runtime-config-mvp/harness/tests/homer-account-integration.test.mjs
```

保全与使用边界保持：自动连接保存到当前 profile 唯一凭据文件；只在正常“重启并应用”后采用。断开先停止再清 Token、保留归属与历史；停止失败或取消不清凭据。旧网站文件需要一次成功 GET 才升级，无配置时保留原文件并提供设置；有效新缓存断网可用；手动 Token 文件沿旧路径。回退前须让识别新格式的版本处理凭据，不能把新格式直接交给旧版，不额外复制明文 Token 作备份。

三方合成联调只使用全新隔离网站／数据库和本机假上游；联调阶段未提交／合并，此后按新增授权完成本地提交和合入；未部署、安装、替换或重启日常 Homer，也未进行真实付费调用。测试候选是不可发布准备包；性能证据仅限合成链路耗时和不阻塞消息／单飞／无重复写盘断言，不外推真实供应商延迟或吞吐。

收尾确认：yezi2 本轮 launcher 退出 0，3184／3185 均关闭；AMH 本轮 launcher 退出 0，3183／本轮假上游均关闭（`homer-runtime-17xshbi6/shutdown-report.json`）。Homer 测试桌面正常退出，无在途请求。各方保留本轮数据库及证据，旧库／历史／日常服务未动。最后复核 HEAD 未变、暂存区无变更、20 个候选输入与源码一致、原已安装 manifest 不变，`git diff --check` 通过。

## 本地合入前审查（2026-10-29）

用户随后明确授权三方 review、清理本轮旧逻辑、提交并合入各自本地主干；仍不部署、安装、重启日常 Homer 或真实调用。独立审查未发现 Critical／Important 问题，确定两项冗余已清理：删除执行层旧 `homer-main`／`homer-worker` 适配和 catalog 条目；删除已由 `readHomerConnection` 替代、无产品调用者的 `readDeepSeekToken` 及专属 import／单测／fixture。旧别名改为负向用例，已观察先失败；删除后回归通过。固定 163 所需 `deepseek-flash` catalog、旧凭据文件校验升级、PKCE 兑换、手动／原生账号／BYOK 和可用的隔离实验入口保留。前两份 10 月 28 日文档已标为历史记录，保留实测证据。

清理后最终本方验证：13 个聚焦文件共 362 项，361 通过、1 个按环境可选的共同包测试跳过；该客户端共同包测试另带新锁单独 1/1 通过。源码与 UI TypeScript 检查通过，用户接受通知 1/1、固定 163 两角色原生工具文件 1/1 通过。只运行本轮相关检查，未将全仓 suite 宣称为通过。日志在 `.codex/scratch/runtime-config-review/`，含旧别名负向用例的 RED→GREEN。

AMH 本轮清除了旧 v1-r2 五操作 stub／serve／fixtures 等已无用途的测试入口，保留同一共同包的当前配置合同及 fixture；清理后的 manifest SHA-256 为 `3e56efb0c44addf9df3d682d092a2d8ce611877dcb8b00259a9fc931e0927c1e`，payload 6 项，合同 SHA-256 仍为 `14c0366b9fa8cd2eb185cd2e03828985b3c656364e148e1532b27b9441876125`。Homer 已核新包并通过真实客户端子集；此前 14 payload／9dae 摘要仅记录清理前联调候选，不能当作当前包锁。上节 App/source 摘要同样对应清理前实际三方联调候选；本次清理未构建安装 App，最终源码以本次 Git 提交身份为准。

本地合入采用当前干净候选和准确拥有路径；主树唯一共享文件 `tests/service.test.ts` 先三方文本合并预览，保留原 T08 并行修改，再按私有索引／CAS 快进更新本地主干；其他 87 项 tracked dirty 内容及未跟踪路径保留。不会把主树脏整树作为提交输入。


### 最终提交与本地合入

| 项目 | 已核对的最终产品提交／本地主干 | 收尾验证 |
| --- | --- | --- |
| Homer | `ea1ec528c20250b0fcbe22ef7ba80f051c23f576`，合入本地 `main`；本段另作仅文档的包锁提交 | 准确 Node 22.22.0 在合入后运行：361 通过／1 可选跳过；最终包客户端另 1/1，源码／UI 类型检查、用户接受通知和固定 163 两角色原生文件通过 |
| yezi2 | `a7250a11ee9de350d2f8c6d17dd4ce206275b1a7`，其现有本地主干为 `master`；未新建／重命名分支 | owner 报告并归档：独立 review 无问题；隔离轻量 34/34，排除并行 RTC 的准确提交候选 Mongo／HTTP／DDP 48/48，提交后 runtime 7/7；无关 RTC／mobile dirty 保留 |
| AMH | `a5cecf95e026855958995b549dc31ef1475fda46`，本地 `main`；也是本轮共同包的准确 producer commit | owner 报告并归档：独立 review 无问题；共同包 3、Python 23、Go common／middleware 421、实际网关 15、三库升级 28 与恢复通过；删除 13 个废弃执行／fixture 文件，无关暂存及工作内容保留 |

已直接核对两方主干 ref 和 producer 提交内 manifest，与最终锁 `3e56efb0c44addf9df3d682d092a2d8ce611877dcb8b00259a9fc931e0927c1e` 一致；该包没有额外发布动作。源码／字段／计费无新增行为变化，不为纯废弃链清理与格式变化重新启动三方服务。Homer 主树原 88 项 tracked dirty 与全部 untracked 保全、暂存区空；共享测试文件的旧并行修改已通过反向三方合并保全校验。Node 26 的附加检查通过但不作为批准运行时依据，正式收尾结果使用上述 Node 22 重跑。
