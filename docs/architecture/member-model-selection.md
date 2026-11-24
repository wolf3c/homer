# 会员模型选型与随包目录

2026-11-19，Homer 和 yezi2 已在本地实现。本方案取代[前一版会员模型随包配置](account-and-model-connection.md#会员模型随包配置)。网站选定 Main 和 Worker 的模型与推理档，Homer 和 Codex 共用随包的 Codex 原生 `models.json`。修改包内已有的选型只需改网站配置，新增模型或变更能力随 Homer 发版。

## 下发与兼容

配置 GET `/api/homer/v1/config` 和 PKCE 兑换 POST `/api/homer/v1/token` 共用一份选型。网站启用精简下发后，带 `X-Homer-Config-Version: 2` 的新版只收到 Main 和 Worker 的模型 ID 与推理档。兑换响应的账号和 Token 仍在原有外层，模型选型放在 `config`。

```json
{
  "main": { "model": "gpt-6.1-terra", "effort": "medium" },
  "worker": { "model": "gpt-6.1-terra", "effort": "high" }
}
```

网站保留同一份完整角色配置供旧版 GET 和兑换返回 V1，V2 只从中取两个角色的模型和推理档。新版只接受上面的结构，每个角色恰有 `model` 和 `effort` 两个字段。收到完整 V1 时整组采用随包默认值。

## 随包默认选型

随包 `member-model-defaults.json` 使用上面的格式。首次登录从成功的 PKCE 兑换读取选型，已有凭据的客户端启动时读取一次配置 GET。Homer 按 `slug` 查找目录中 `visibility: "list"` 的条目，并核对 `supported_reasoning_levels[].effort`。两组都有效才一起采用。配置 GET 不可达或超时、选型缺失、格式错误或任一组合无效时，整组使用随包默认值。

登录成功或已登录启动时，桌面只确定一次两角色选型，用它判断连接是否就绪，并经现有私有管道将同一份选型传给运行进程。选型只存于内存。应用连接设置会完整重启桌面程序；新进程启动时重新 GET，用新结果同时判断就绪并启动运行进程。升级时保留账号标识和 Token，移除旧配置缓存。[桌面连接状态](../../packaging/electron/main.mjs#L126) · [运行进程入口](../../scripts/desktop-runtime.mjs#L53)

回退只处理选型失败。新版兑换只有在账号与 Token 可正常交付、选型不可用时才返回 `config: null`。PKCE、账号归属校验或 Token 签发失败时，登录失败。

## 原生目录与会员网关

- **随包目录**采用 Codex 原生的 `{ "models": [...] }` 结构。Luna 可用于 Main／Worker，也供 Codex 原生审核使用。使用 `supported_reasoning_levels`、`input_modalities`、`supports_search_tool`、`context_window` 和 `auto_compact_token_limit` 等原生字段，网关声明和客户端运行参数的来源见下文。[固定版本目录格式](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/protocol/src/openai_models.rs#L982) · [随包目录](../../assets/membership/models.json)
- **打包时**将 `models.json` 放入现有的 `extraResource` 资源目录。Main 和 Worker 通过 `model_catalog_json` 直接加载这份文件，各自采用内存选型指定的模型和推理档。Homer 直接信任包内声明，移除逐字段转换，能力随发版验收。[打包资源](../../packaging/electron/forge.config.mjs#L44) · [Codex 目录读取](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/core/src/config/mod.rs#L2367)
- **会员网关配置**沿用受信安装包清单中的网关地址、现有 Token 凭据路径及启动参数，包括网页搜索模式、Responses WebSocket 开关和会员压缩口径 `total`。首版走 HTTP，关闭原生网页搜索、工具发现和 Responses WebSocket，网页查询由 Homer 的会员 `web_search` 提供。窗口和压缩阈值直接取自模型目录。[现有引擎接线](../../src/engine.ts#L489)

### 模型能力依据（2026-11-19）

AMH 生产 `/api/pricing` 的 `default` 组及交付账号的 `/api/user/models` 均列出这八个精确 ID。随包目录按每条记录的 `ReasoningEffort`、`ReasoningDefault`、`Vision`、`ContextWindow`、`Tools` 和 `openai-response` 填写。单个会员 Token 的模型权限仍由网关决定。[AMH 生产目录](https://models.super-tree.com/api/pricing) · [Homer 随包目录](../../assets/membership/models.json)

| 模型 | AMH 声明的推理档 | 默认档 |
|---|---|---|
| `gpt-6-luna`、`gpt-6-sol`、`gpt-6.1-terra` | none、low、medium、high、xhigh、max | medium |
| `gpt-6-astra`、`gpt-6.1-sol`、`gpt-6.2-sol`、`gpt-6.2-astra` | low、medium、high、xhigh、max | medium |
| `deepseek-flash` | none、low、high、max | high |

八款均声明图片输入和 Responses 工具调用。AMH 标注的总上下文（输入加输出）写入 `max_context_window`：GPT 为 1,050,000，DeepSeek 为 1,048,576。Homer 的运行窗口继续使用 272,000，自动压缩阈值为 244,800。通用工具声明只用于启用工具调用；原生搜索、工具发现、Responses WebSocket 仍按现有会员配置关闭。

固定 Codex `0.171.0-alpha.7` 对本机合成网关发起了八款模型的请求，核对了选定的模型 ID、推理档、GPT 的 Code Mode、DeepSeek 的函数工具及 Luna/low 审核。此轮复核的是 AMH 上架声明和客户端实际出站，未对八款逐一进行付费生成、图片识别或长上下文压力测试。[原生回环专项](../../tests/native-membership-auto-review.engine.test.mjs) · [Terra 既有实网记录](../member-code-mode-live-validation-2026-11-16.md)

## 两步收尾和回滚

- **Homer `2e8849d3`、`941ed2d4`**。保留提交历史，移除会员选型中的网关列表与详情查询、能力合并、配置缓存及发送前刷新。复用现有 V2 请求协商、PKCE 和凭据原子保存，将会员目录生成改为加载随包原生文件。账号额度及语音工具独立使用的网关查询继续沿用。
- **yezi2 `50260423`**。在现有版本协商中替换本地 V2 候选格式，去掉下发的 `models` 名单和对应的网站名单设置。发布前核对没有已发布的旧 V2 调用方，并验证 GET 与兑换的新版选型和旧版 V1 响应。
- **回滚**。将网站选型改回仍在使用的安装包都支持的上一组值，下次安全重启时生效。如需降级到依赖 V1 缓存的客户端，按旧版流程从网站重取配置，必要时重新登录。沿用原会话资料目录。

## 线上精简下发验收状态

2026-11-20，yezi2 6.1.45 已在线上启用 V2。已安装的本机 Mac 使用 Homer 0.1.19（build 307）完成一次会员登录和一次重启。下表记录客户端实际收到的响应。

| 本机操作 | 接口与实测结果 | Main 模型 ID / 推理档 | Worker 模型 ID / 推理档 |
| --- | --- | --- | --- |
| 会员登录 | PKCE 兑换 `POST /api/homer/v1/token` 返回 HTTP 200，选型在响应的 `config` 中 | `gpt-6.1-terra` / `medium` | `gpt-6.1-terra` / `high` |
| 重启 Homer | `GET /api/homer/v1/config` 返回 HTTP 200，响应正文即为选型 | `gpt-6.1-terra` / `medium` | `gpt-6.1-terra` / `high` |

两次选型均只有 `main` 和 `worker`，每个角色均只有 `model` 和 `effort`。会员登录已生效，本机日常推理仍使用 ChatGPT 套餐。本轮只验了这台 Mac，其他平台暂未验。会员继续使用常规压缩，异步压缩保持关闭。

### 启用前的验收记录

- **本地协议与候选包。** yezi2 的 GET 和 PKCE 兑换已通过 32 项定向回归，覆盖 V1／V2 协商、关闭开关、选型回退和授权失败。macOS arm64 隔离候选包已验证 V1 同线程升降级、八款模型回环轮换。随包默认 Terra 选型已通过真实 AMH 的 Main／Worker 出站、两次 Luna 审核及 Worker 回传。[八款模型轮换](#八款模型轮换验收) · [默认选型端到端验收](#默认选型端到端验收)
- **启用前的已发布客户端与公网 GET。** 已核对的 16 个非草稿 Release 均未发送版本头；当日公开最新版 v0.1.19 的发布清单指向 `3eadff05`，源码复核结果一致。公网配置 GET 分别以无协商头、仅 WebSocket 特性头、特性头加 V2 版本头请求，均返回 HTTP 200、完整 V1 和 `Cache-Control: no-store`。`Vary` 含特性头和 `Accept-Encoding`，尚无版本头。此次只读检查未做生产 PKCE 兑换。[v0.1.19 正式发布](https://github.com/wolf3c/homer/releases/tag/v0.1.19)

### 兼容与回滚

启用后，公网配置 GET 在无版本头或版本头为 `1` 时仍返回完整 V1。本轮未验证旧客户端的线上 PKCE 兑换，也未演练线上回滚。

**回滚。** 选型有误时，将网站两角色恢复为在用安装包都支持的上一组值，下次安全重启后复核。需要撤回整个精简格式时，将版本开关恢复为 `1` 或移除，再核对 GET 与兑换均返回完整 V1。旧版继续使用网站 V1，新版在下次安全重启后整组采用随包默认值。

## 验收

1. 用隔离资料验证新版登录和启动、旧版 V1 登录、升级复用原账号和线程，以及降级后重取 V1 配置并续办原线程。
2. 用隔离资料启动候选安装包，确认随包 Codex 实际读取包内的 `models.json`。使用默认选型，让 Main 通过 Code Mode 派工、Worker 返回结果，并触发一次原生审核。从实际出站请求的 `model` 和 `reasoning.effort` 核对 Main 为 `gpt-6.1-terra / medium`、Worker 为 `gpt-6.1-terra / high`、审核为 `gpt-6-luna / low`。会员路由按随包声明验收。[原生审核请求断言](../../tests/native-membership-auto-review.engine.test.mjs#L30)
3. 再用一组不同于默认值的有效网站选型，核对桌面就绪状态和两角色出站值。配置 GET 超时、收到完整 V1、单个角色无效或成功兑换返回 `config: null` 时，两角色都用默认值。单独模拟授权失败，确认该次登录失败。

**2026-11-19 本地安装包验收通过。** macOS arm64 候选包内的 Codex `0.171.0-alpha.7` 对回环网关实际发出了上述三组请求。发出请求时，Main 和 Worker 的进程参数均指向包内同一份 `models.json`。Main 通过 Code Mode 调用会员 `web_search` 并派工，Luna 放行测试操作，Worker 写入标记并把结果交回 Main。网站互换 Main／Worker 推理档后，重启实发为 `high`／`medium`。完整 V1、无效 Worker、GET 超时和兑换选型为空均回到默认组合，单独的授权失败没有写入凭据。

V1 对照包（`8d8a70dc`）先登录并创建线程。升级后保留账号、Token 和原线程，降级后旧包重新取得完整 V1，并在同一线程成功发言。联调使用 yezi2 的真实 GET、PKCE 处理代码和合成网关响应。候选 ZIP SHA-256 为 `955b78b9eed574058e4916b9f45ba0578c50613f02e580f96ab824dc3c255811`。[安装包专项](../../tests/member-selection-package.test.mjs) · [运行说明](../testing.md#会员选型安装包联调)

### 八款模型轮换验收

2026-11-19，Homer `fdb5ca1b` 的 macOS arm64 候选包（0.1.18，Codex `0.171.0-alpha.7`）与 yezi2 `1af7595e` 的 PKCE 和配置处理器在本机联调。候选 ZIP 的 SHA-256 为 `36ff2b273582da9a3f98278e62e23d0e8704eee2bb3ee49d44b9fa56ae801033`。表中每行是一次重启后，回环网关实际收到的 `model` 和 `reasoning.effort`。

| 轮次 | Main | 推理档 | Worker | 推理档 |
| --- | --- | --- | --- | --- |
| 1 | `gpt-6-luna` | `none` | `gpt-6-sol` | `high` |
| 2 | `gpt-6-sol` | `xhigh` | `gpt-6-astra` | `xhigh` |
| 3 | `gpt-6-astra` | `max` | `gpt-6.1-terra` | `high` |
| 4 | `gpt-6.1-terra` | `medium` | `gpt-6.1-sol` | `medium` |
| 5 | `gpt-6.1-sol` | `high` | `gpt-6.2-sol` | `max` |
| 6 | `gpt-6.2-sol` | `low` | `gpt-6.2-astra` | `low` |
| 7 | `gpt-6.2-astra` | `medium` | `deepseek-flash` | `none` |
| 8 | `deepseek-flash` | `high` | `gpt-6-luna` | `high` |

八轮均通过。首次验收共记录 32 个 Main 请求、16 个 Worker 请求，选型全部与网站一致。另有 16 个带 `x-openai-subagent=guardian` 的原生审核请求，每轮 Main 和 Worker 各一次，全部使用 `gpt-6-luna / low`。放行后两角色分别写入当轮标记。8 个 Worker 均成功结束，回复的消息 ID 均关联到同一 Main 会话中已完成的处理记录。[专项复验命令](../testing.md#八款模型轮换)

验证到候选包向本机回环网关发出请求为止。网关返回合成响应，未调用 AMH 线上模型。该轮验收时线上精简下发尚未启用，异步压缩单独验收。

### AMH 真实会员路由验收

2026-11-19，使用一个测试会员 Token 直接请求生产 AMH 的 `/v1/responses`。对 `gpt-6-luna`、`gpt-6-sol`、`gpt-6-astra`、`gpt-6.1-terra`、`gpt-6.1-sol`、`gpt-6.2-sol`、`gpt-6.2-astra` 和 `deepseek-flash` 各发一次最小文本请求，只测 `low` 档，客户端未重试。

8 次均返回 HTTP 200，流式响应均以 `response.completed` 完成，返回文本逐字匹配各自的随机短标记。每次 AMH 响应的 `model` 都与请求的模型 ID 一致，`reasoning.effort` 都回显为 `low`。这确认了该测试会员在本次请求中可以通过八个模型别名取得结果。仅凭 AMH 回显，仍无法独立确认上游实际使用的供应商、部署版本或执行的推理策略。

### 默认选型端到端验收

2026-11-19，隔离的 macOS arm64 候选包（Homer `fdb5ca1b`，Codex `0.171.0-alpha.7`）经本地 yezi2 `1af7595e` 完成 PKCE 兑换，重启后读取配置。两次均以 V2 返回随包默认选型。一次用户输入派出一个 Worker，共向生产 AMH 发出 8 个 Responses 请求。8 次均返回 HTTP 200 和 `response.completed`，AMH 回显的 `model` 和 `reasoning.effort` 与各自出站值逐条一致。

| 请求来源 | 出站与 AMH 回显的模型 ID / 推理档 | 完成请求数 | 实扣 AMH 原始额度 |
| --- | --- | ---: | ---: |
| Main | `gpt-6.1-terra / medium` | 4 | 11,799 |
| Worker | `gpt-6.1-terra / high` | 2 | 8,995 |
| Luna 原生审核 | `gpt-6-luna / low` | 2 | 1,064 |

Main 和 Worker 各触发一次 Luna 审核，两次均返回 `allow`，放行后两个角色各自写入的测试标记均已核对。Worker 成功结束并回传其独立随机标记。Main 签收了同一条回复，处理记录已完成，用户可见的最终答复包含该标记。

测试会员的期初余额为 3,082 个原始单位，按预算补入 72,555 后为 75,637。8 条账单逐笔核对，合计实扣 **21,858**，与已用额度增量及余额差额一致，期末余额为 **53,779**。

本轮验证覆盖候选包经本地网站选型后访问真实 AMH 的完整流程。AMH 回显无法独立确认上游部署及内部推理策略。该轮验收时线上精简下发尚未启用，异步压缩单独验收。

### 异步压缩专项验收

2026-11-19，同一 macOS arm64 隔离候选包（Homer `fdb5ca1b`，Codex `0.171.0-alpha.7`）经本地 yezi2 `1af7595e` 完成 V2 兑换和配置读取。仅 Main 使用 `gpt-6-luna / low`，真实 AMH 会员目录声明该模型支持 `capabilities.responses.compaction_trigger`。仅在隔离测试配置中设置以下三项。

```toml
features.async_compaction.enabled = true
features.async_compaction.model_async_compact_threshold_percent = 2
model_providers.homer.capabilities.remote_compaction = "v2"
```

2% 是按上下文窗口计算的后台压缩准备阈值。随包窗口为 272,000 token，常规自动压缩阈值仍为 244,800 token。三轮对话使用同一线程，连同一次后台压缩，共四次真实 AMH 请求，均返回 HTTP 200 和 `response.completed`。

1. **触发。** 首轮回复生成随机参考码。随后 Codex 发出的后台请求含 `compaction_trigger`，AMH 返回带 `encrypted_content` 的 `compaction` 项。
2. **压缩期间继续对话。** 客户端观察到后台请求后 80 毫秒，桌面提交第二条消息。完整答复已在对话中可见时，距 AMH 压缩响应收齐还有 753 毫秒。客户端观测的压缩总时长为 2,882 毫秒，响应收齐与转交客户端发生在同一毫秒。
3. **压缩后续接。** 第三轮出站请求中，`encrypted_content` 的内存摘要与 AMH 刚返回的密文一致。完整请求中没有首轮参考码明文，桌面显示的答复仍逐字找回了该码。

测试会员期初余额 53,779 个 AMH 原始单位，预算 25,756，无需补额。首轮、后台压缩、第二轮和第三轮分别实扣 914、92、80 和 919，四笔合计 **2,005**，与累计已用额度增量及余额差额一致，期末余额 **51,774**。本次验收覆盖上述隔离配置的一轮实测。该轮验收时默认异步压缩和线上精简下发均未启用。

### Terra 会员显式压缩路由验收

2026-11-19，使用测试会员直接请求生产 AMH 的 `POST /v1/responses`，按随包 Main 和 Worker 的选型各跑一轮。每轮包含一次显式压缩和一次回放续聊。四次请求均返回 HTTP 200 和 `response.completed`，两步的模型 ID 和推理档回显都与出站值一致。

| 随包角色 | 出站与 AMH 回显的模型 ID / 推理档 | 压缩实扣（原始单位） | 回放实扣（原始单位） |
| --- | --- | ---: | ---: |
| Main | `gpt-6.1-terra / medium` | 152 | 66 |
| Worker | `gpt-6.1-terra / high` | 212 | 81 |

两轮各用独立随机码。首个请求带 `compaction_trigger`，AMH 返回含 `encrypted_content` 的 `compaction` 项。第二个请求只发送该完整项和新问题。两轮都核对了回放密文与返回密文一致，出站请求中没有随机码明文，答复均逐字找回了本轮的随机码。

四笔消费按请求标识逐笔匹配，合计实扣 **511** 个原始单位，与累计已用额度增量一致。期初余额 **51,774**，未补额，期末余额 **51,263**。

四笔账单均来自 `default` 组渠道 6，其他渠道和故障切换尚未覆盖。

**2026-11-20 决定**　会员 Main 和 Worker 继续沿用常规压缩，暂缓开启异步压缩。待有明确需求时，再用候选包验证 Terra 按 **65%** 阈值触发后台压缩、压缩期间继续对话及压缩后续接。

## 会员自选与逐行恢复提案

2026-11-24，源码已实现。会员在桌面「设置 → 账号 → 荷马模型服务」可分别为 Homer 和 Worker 选择模型及思考深度。网站指定的角色选型仍是会员默认。ChatGPT 套餐也改为逐行恢复，沿用自己的模型目录、覆盖和用量。两种来源共用现有模型行的界面结构，继续独立保存和执行。

### 目录与来源

- **会员模型和深度**直接使用随包 `models.json` 的可列出模型、`supported_reasoning_levels` 和 `default_reasoning_level`。复用 `src/member-models.ts` 的目录缓存和校验，宿主把最小显示字段给现有模型选择器。切换模型时保留新模型支持的深度，否则换为新模型的目录默认深度并提示。用户确认生产网关目前没有按会员区分可用模型。Homer 本轮核对了随包目录与本机代码，未重新探测生产网关。会员模型设置只读取本地目录，网站照旧下发角色默认。会员语音和钱包各自沿用已有查询。
- **积分与速度**由会员网关结算，沿用现有钱包显示。界面说明「后续模型请求消耗会员积分」。零积分或余额未知仍可修改配置。会员 `fast:false`，省去闪电。ChatGPT 继续使用原生 `model/list`、可用速度与套餐用量。

### 默认、覆盖与异常状态

| 情况 | 生效规则 |
| --- | --- |
| 角色有有效的个人覆盖 | 使用这个账号为该角色保存的 `{model, effort}`。 |
| 角色没有覆盖 | 继承网站为角色指定的模型和深度。网站响应缺失、旧格式或包内校验失败时，继续沿现行规则整组使用随包默认。 |
| 已存模型或档位被新版目录移除，或网关明确拒绝该选择 | 保留选择并标明「当前选择不可用」。允许重新选择或恢复本行，由用户决定何时换用另一计费模型。网关拒绝后保留失败结果，停止自动重发。 |
| 本机目录读取失败、登录失效或结果未知 | 保留可核实的值、已保存覆盖和草稿，显示对应的重试或重新登录入口。连接错误、限流、余额不足和未确认结果各沿原处理。 |

**存储。** 复用本地私有 `desktop-profile.json` 的原子更新。只增加一个按已验证会员主体区分的角色覆盖字段，仅保存用户显式选择。旧档案没有此字段时直接继承默认。A → B → A 的隔离在覆盖存储层按主体验证。桌面资料继续绑定原账号，退出后可重登同一主体并读取原覆盖。失效的连接版本会拒绝后续保存。ChatGPT 的 `chatgpt` 字段和已存速度保留。恢复只删除目标角色覆盖。用户明确选回当前默认时可归一成继承，已存显式值恰好与新的默认相同时保留，直到用户主动恢复。

### 保存与下一轮生效

**原有路径。** Electron 经 FD 3 向桌面运行进程一次传入已验证会员主体、Token 和网站选型。`readMemberRuntimeConnection` 生成 `desktopConnection` 的两角色配置。引擎构造时通过 `effectiveModelConfig` 取本角色，启动时加载整份包内目录并绑定会员 provider、窗口和压缩。现有预轮次 `thread/settings/update` 与 `turn/start.model` 仅用于 ChatGPT。这条路径原先只在启动时读取会员选型。[桌面配置注入](../../scripts/desktop-runtime.mjs#L49) · [轮前更新](../../src/engine.ts#L1076)

1. **启动时合并。** 保持 FD 3 的网站选型协议。桌面运行进程用现有已验证主体读取本地角色覆盖，在服务共享配置保留网站默认和个人覆盖，由 `effectiveModelConfig` 解析每个角色。失效的旧覆盖保留在设置里，相关角色会在发出推理请求前收到配置不可用提示，仍可进入设置修复。另一行独立校验。
2. **现用来源自动保存。** 沿 Electron 现有受信账号桥和 `scripts/desktop-runtime.mjs → scripts/dev.mjs → src/dev-host.ts` 请求链增加严格校验的会员读取及保存操作。保存输入只需目标角色和选择或恢复信号，由宿主核对来源、连接版本和保存状态。服务参考 `applyChatGPTModels`，用随包目录校验目标行，合并最新已保存值，原子落盘后替换共享配置并通知界面。保存失败保留原值及可重试草稿，结果未知先重读；成功提示「已保存，下一轮生效」。已有 ChatGPT 整组输入继续兼容，按角色保存只校验目标行，避免另一行失效阻挡恢复或旧草稿覆盖另一行。
3. **现有线程在下一轮读取。** 将 ChatGPT 的轮前更新扩到使用随包目录的桌面会员。每个 Main／Worker 在成功领取下一轮、进入 `turn()` 准备时读取本角色最新配置一次，固定到当轮。模型或深度变化时先用现有 `thread/settings/update` 更新同一线程，然后把同一快照的模型、深度和标准档 `null` 交给 `turn/start`。确认线程更新成功后再更新该引擎的已应用值。更新失败停止该轮并保留用户选择。新建或恢复的线程使用相同解析与校验。运行中的轮次继续使用原快照，已在准备中的轮次以其读取时点为准，随后开始的排队轮次使用最新成功保存的值。附件能力检查也应使用对应的模型快照。
4. **来源变化才重启。** ChatGPT 来源草稿和两种来源之间的切换沿用「应用并重启」确认。取消或停止未确认时保留当前来源。两个来源之间切换继续由原有启动和线程衔接流程接管。会员同来源改模型、深度或恢复只更新配置和线程设置。会员 Token、provider、Luna 审核和其他会员工具沿用原路径。

这条轮前路径建立在当前随包八款的相同进程级窗口 `272000`、压缩阈值 `244800` 和 `total` 口径上。所有条目均在同一目录。GPT 的 Code Mode 与 DeepSeek 的函数工具声明不同，固定 Codex 已在回环网关验证同线程双向切换时按新条目重算工具能力及推理参数。未来新增模型若需不同进程级配置，先验明可在轮次边界正确更新，然后再进入可选目录。[随包目录](../../assets/membership/models.json) · [历史轮换](#八款模型轮换验收)

### 界面与操作

复用桌面现有角色行、`ModelSelector`、思考深度分段和回转箭头。角色名称右侧根据这一行是否继承默认显示一种内容。

- **默认行**只显示「默认」文字，完全移除该行恢复按钮和其 Tab 停靠点。会员若有已保存的显式覆盖，即使网站后来碰巧采用相同值，仍提供恢复以让用户明确回到继承。
- **自定义行**显示恢复图标。点按只恢复本行。在 ChatGPT 中恢复模型、思考深度、速度三项，当前默认均为标准速度，另一行的 Fast 或 Ultrafast 保留。会员恢复模型和深度。删掉底部统一恢复按钮。
- **反馈与可访问性**使用「恢复 Homer 默认配置」和「恢复 Worker 默认配置」作为读屏名称及提示。图标 16–18px，点按区至少 44×44px，触屏常显，支持 Enter／Space。点击后图标消失时，焦点落到本行模型入口并用状态区播报。本机目录读取失败或正在保存时保留现有值和草稿，阻止重复操作，已确认登录失效沿现有重新登录入口。窄桌面纵排，模型弹层在视口内，档位整项换行，Escape 回到入口。
- **移动端**现有手机设置独立于桌面账号桥。此次先覆盖桌面与窄桌面布局。原生手机入口如需开放，使用经授权的配置通道，不能透传 Electron IPC 或会员 Token。

两份 Demo 评审中的行为以保存状态为准。恢复图标取决于个人覆盖是否存在，当前模型恰好等于网站默认时仍可恢复继承。不可用提示绑定原失效的模型和思考深度组合，改选后及时更新，迟到结果只标注仍匹配的选择。

### 实现与验证

沿用现有角色行、会员目录、账号 IPC、私有档案和引擎轮前更新。需要新增的持久状态只有会员角色覆盖字段。显示的不可用状态由本地校验及现有运行失败反馈提供，明确区分模型不可用和连接失败。Main 透传明确的模型不可用结果，只有结果仍对应当前角色当前选择时才在设置中标注，以免迟到失败覆盖新设置。Worker 沿已有任务失败通路提示。

- 定向离线验证覆盖按主体隔离存储、过期连接版本拒收、恢复单行、保留失效值、零积分编辑、ChatGPT 标准及加速档、写入失败及重试。服务与 UI 类型检查通过。
- 固定 Codex 0.171.0-alpha.7 回环验证通过。Main 和 Worker 在同一线程、同一进程完成 GPT ↔ DeepSeek、思考深度调整及恢复默认。运行轮及其工具续调使用原选择，下一轮使用新选择。回环捕获原工具调用与结果的跨模型回放、显式压缩后摘要续接、明确拒绝只发一次、保留选型及原线程恢复。原生后台记忆整理仍由 Codex 自己选型。
- 合成桌面桥的实际设置组件在 1040px 和 320px 窗口通过菜单边界、逐行恢复、键盘焦点及同来源保存检查。安装版、真实网关和付费请求验收仍待执行。生产网关的同线程跨模型兼容性见[待办事项](../todo.md)。
