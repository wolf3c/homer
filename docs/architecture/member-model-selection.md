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

验证到候选包向本机回环网关发出请求为止。网关返回合成响应，未调用 AMH 线上模型。线上精简下发保持关闭，异步压缩单独验收。

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

本轮验证覆盖候选包经本地网站选型后访问真实 AMH 的完整流程。AMH 回显无法独立确认上游部署及内部推理策略。线上精简下发保持关闭，异步压缩单独验收。
