# DeepSeek / Codex 0.163 适配与执行保护

本项是维护源码及离线验证结果，不表示已安装、重启日常 Homer，或已经验证付费转发渠道。主 Agent、Worker、新建与恢复会话共用同一配置。凭据仍经既有 env_key 路径传入，未改写用户 Codex 全局配置、账号、历史或固定引擎。

## 官方接入与模型目录

依据 [DeepSeek 官方 Codex 接入说明](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)，为非 OpenAI Responses 端点的 `deepseek-flash` 提供版本化模型目录。目录由 `src/deepseek-model.ts` 生成到当前 runtime 的私有 `model-catalogs/`，进程参数选择该目录；启动校验配置与 model/list，异常时退出该子进程，避免静默使用未知模型默认值。

元数据按固定 0.163.0 的实际 schema 投影：官方最大容量 1,048,576、有效比例 95%、text/image、low/high/max、默认 high、freeform apply_patch、`supports_search_tool=true`、`tool_mode=null`。日常与隔离入口默认 high、Fast false，显式受支持的推理档位保留。其他模型维持原配置。

`supports_search_tool` 是 Codex 模型目录中的工具发现能力声明，不是 DeepSeek 请求体参数，也不等于供应商内置联网搜索。此配置下 Codex 的 web_search 仍关闭。真实固定引擎的合成测试验证了 tool_search → MCP 工具发现 → 带 namespace 的函数调用；付费转发端点能否接受同一协议仍需独立验证。

固定模型目录反序列化要求基础指令模板，因此这里提供简短基础模板，并沿用 Homer 现有 developerInstructions。没有复制官方示例中整段 GPT 专用指令；离线协议通过不能证明这段模板与原生模型的长任务质量等价。

DeepSeek 的 [Responses 兼容说明](https://api-docs.deepseek.com/guides/responses_api/) 区分函数/自定义工具与其他内置工具。不能由“OpenAI 兼容”推断 encrypted reasoning、跨供应商会话、服务端历史存储或所有内置工具可用。

## 容量和压缩阈值

独立 JSON 配置未指定 `deepseek` 时，默认保持 272,000 容量、total 口径及 244,800 压缩阈值。会员模式不进入按模型名选择的 DeepSeek 专属分支，改用网站按角色下发的通用 `context` 和可选 `capabilities`，当前未发布候选为 gpt-6.1-terra / high，窗口及总量阈值保持 272,000 / 244,800；完整契约及离线验证见 [会员上下文配置下发](2026-11-04-membership-context-config.md)。未验证真实转发渠道容量。

0.163.0 的 ModelInfo 对 total 阈值取 `min(配置值, floor(容量×90%))`；完整上下文还受 `容量×95%` 限制。config/read 返回配置覆盖值，不能单凭它证明实际压缩边界。现在省略 total 阈值时取 `min(250000, floor(容量×90%))`，显式超过 90% 则拒绝配置，避免配置与执行含义不符。

可在 Homer JSON 配置中设置：

```json
{
  "deepseek": {
    "contextWindow": 272000,
    "autoCompactTokenLimit": 244800,
    "autoCompactTokenLimitScope": "total"
  }
}
```

容量必须为 32,768–1,048,576 的整数；阈值必须为正整数且小于容量的 95%，total 另受 90% 上限约束。非法、未知字段在配置加载及直接构造引擎时均拒绝。

`body_after_prefix` 是显式可选口径：以当前压缩窗口首个请求的 input 作为基线，主要衡量此后的增长。它不代表缓存 token 免费、不从供应商 input 扣除缓存，也不绕过完整上下文上限。该口径及更大容量没有被指定为默认。

没有实测依据把 500,000 宣称为质量与成本的最优点。扩大窗口可能减少压缩，也可能增加每次请求的输入、时延与费用。后续比较需固定任务、模型/档位、工具清单、成功验收标准、缓存命中/未命中输入、输出、压缩次数及总费用，再独立授权小额真实调用。

## 单轮用量、费用与停止保护

保护归属准确的引擎、thread 与 turn。已有 usage 事件继续负责传递和保存计数，Web 仅增加白名单 `execution` 投影，没有新增数据库表或轮询。界面在输入区下方显示本轮估算、输入（含缓存）、输出与连续压缩次数；断连显示“上次记录”，缺失费用显示“费用暂不可估算”。

费用需要显式填写实际渠道人民币单价。以下数字仅用于说明配置格式，**不是官方或当前渠道报价**：

```json
{
  "executionLimits": {
    "maxCostCny": 0.5,
    "pricing": {
      "inputCnyPerMillion": 1,
      "cachedInputCnyPerMillion": 0.1,
      "outputCnyPerMillion": 2
    },
    "maxConsecutiveCompactions": 3
  }
}
```

`maxCostCny` 为正数且必须同时提供三个完整非负单价；不设置则不启用费用阈值。未配置单价时不推断币种、汇率、折扣或实际账单。根据 [DeepSeek 缓存说明](https://api-docs.deepseek.com/guides/kv_cache/)，输入已经包含命中缓存的部分，估算公式为：

```text
((input - cachedInput) × 未缓存输入单价
 + cachedInput × 缓存输入单价
 + output × 输出单价) / 1,000,000
```

reasoningOutput 是 output 的子集，不重复计费。使用累计 thread 计数的本轮增量，避免重复通知、累计值及 last 帧被反复相加；恢复会话时不把旧历史算成本轮消费。缺失、重置或矛盾计数保持未知。

费用阈值是收到 usage 后的软停止，**不是预付硬上限**：正在执行的响应仍可能继续收费，缺失 usage 时无法保证金额。供应商最终结算还需以实际账单核验。

DeepSeek 默认在连续 3 次压缩完成、期间没有新的成功工具结果时请求中断。其他模型不隐式增加此限制。`maxConsecutiveCompactions=0` 显式关闭；其他值必须为 2–100 的整数。重复事件、相同工具结果、失败调用、普通过程文字与 token 通知不会清零；新的成功工具证据才会重置。此规则是有限观察下的保护启发式，不是对任务语义进展的完备判断。

达到费用或压缩阈值后只请求一次原生 interrupt，保留已产出消息及准确原因 `engine_cost_limit_reached` / `engine_compaction_loop`。ACK 不代表已停止；轮次保持占用直到实际 terminal 或原有断连/关闭路径，不自动重放、不自动启动替代轮次。界面使用“已请求停止”。

若停止请求生效前原生恰好完成，仍保留真实 completed 证据，但主会话不会进入工具更新后的自动续接，Worker 也不会重新挂起等待并自动恢复。停止原因及已有结果沿原终态回执保留。

## 顶部错误与状态读取

合成历史 60/120/240 条输入的本地 state+序列化测量未复现 5 秒超时；这些数据不能解释此前日常实例的错误原因。此次沿既有有界进程内计时器增加 snapshot、conversation、history 分段耗时，异常仍原样抛出。没有延长状态读取超时、增加重试或记录原始提示词、工具结果、请求/响应正文。

因此，压缩循环保护与模型目录适配已有局部实现，顶部服务不可用的生产根因仍未关闭。后续要在准确运行版本及故障窗口核对客户端请求、服务端各阶段计时与进程状态，不能由旧快照推断模型仍在运行。

## 验证与采用边界

离线固定引擎测试使用隔离 HOME/CODEX_HOME、loopback Responses 与合成 MCP；覆盖工具发现与实际调用，以及 main/Worker 的压缩完成、压缩后继续、冷恢复和明确失败。费用/压缩守卫使用内存协议测试；UI 使用合成用量检查正常、未知、断连和请求停止呈现。真实渠道的大容量、图片、端到端费用和任务质量尚未验证。

本次局部验证：22 个文件的回归 196/196 通过；随后终态竞态修正的聚焦回归 92/92、扩展后的消费者测试 18/18 通过。这些集合存在重叠，不相加为独立测试数。后端、UI 及本项 TypeScript 测试的定向类型检查通过，UI 构建输出到 scratch；合成浏览器检查覆盖 375px 与 764px 的换行和未知/停止呈现。未运行或宣称全仓测试通过；全仓测试类型检查仍有与本项无关的既有诊断，原状态超时也未获得运行时根因证据。

提交前从 main `2bd58cd` 提取候选，仅叠加本项文件，排除工作目录中其他任务的修改。候选 21 个文件的相关回归 269/269 通过；后端、UI 和本项测试的定向类型检查，以及后端与完整 UI 构建通过。扩大回归中原始 main 的 `native-defaults` 引用已不存在的模块，`native-capability-defaults` 有三项断言失败，Telegram 流测试超时；均在原始 main 快照复现。Web 流 fixture 未处理既有 Fast 启动所需的 `model/list`，在原始 main 和候选均不能结束，测试进程被手动终止；没有将其计为通过，也没有带入其他任务对这些测试的修改。

性能复审移除了普通模型未启用守卫时的工具结果归一化、哈希及证据保留；DeepSeek 和显式配置守卫的模型保持原有处理。回归验证 256 KiB 工具结果及宿主工具调用后，普通模型未保留守卫指纹和压缩记录。Node 22.22.0 的单进程内存协议测量，每档预热 40 次、采样 200 次，256 KiB 完成事件的 p50 为 1.058 → 0.352 ms，p95 为 1.585 → 0.768 ms。该测量包含协议解析，不包含 JSON 序列化、模型请求或网络延迟；小样本及并行负载会影响分位数，不代表实际供应商或安装包的性能保证。

正式采用仍沿现有准确源码 SHA 的构建、签名、包验收及人工正常退出/安装流程；本项没有执行这些操作。不要同时启动两个日常数据 owner。新生成目录只是当前 runtime 的配置资产，不覆盖全局 config.toml。

回退用旧的已验收包，或沿已有 `--native` 入口恢复原生模型；先正常退出并确认停止，保留原始历史和未确认执行记录。仅关闭压缩守卫可显式设为 0；删除费用阈值会停止后续费用保护，但不会撤销已经发生的请求。
