# HMR-MODEL-001：切换指定模型并保留主对话

流程来源：requirements-derived，用户明确要求 gpt-6.1-sol / medium，并保留原主对话与事项。输入来源：synthetic，随机暗号和公开 Markdown；不采集用户对话或凭据。

初始状态为独立 scratch runtime/workspace、已授权本机订阅。先用原配置记住随机暗号，关闭服务，再用目标引擎／模型恢复同一 runtime。必须保持 mainThread、成功回忆暗号、通过 list_work 读取真实合成材料名，并保留切换前请求记录。禁止换 runtime、删除历史或只改启动文字。返回错误线程／恢复失败时不得新建主线程。

离线 `npm test` 中 T09 legacy bindings：旧版 binding 只能先用原配置升级；升级后 model/effort 可变，workspace、codexHome、baseUrl、keyEnv、requiresOpenaiAuth 的变化仍拒绝。结合已有 normal restarts / tool upgrades 测试保留恢复失败边界。

显式真实入口：`npx tsx scripts/real-model-switch.ts <原配置> <目标配置>`。两份配置的账号／供应商字段必须相同；脚本只更改独立测试目录。报告仅包含版本、模型、effort、线程标识和断言结果，不保存对话正文，费用金额未知。重复执行自动建立新目录；失败证据先保留，清理只限本次测试目录且须确认进程退出。Codex 自身按引擎机制保留测试线程。

2026-10-16 调查已复现：同一 ChatGPT 订阅下，Codex 0.154.0 不列出且拒绝 gpt-6.1-sol；App 引擎 0.163.0-alpha.10.2 列出并成功执行该模型及测试工具。因此账号不能使用该模型的旧判断不适用于新引擎。实际稳定版服务切换验收以 docs/07-m0-validation.md 的记录为准。

实际入口另发现已有空线程只存在于旧引擎内存，关闭后没有 rollout。此类错误必须分类为 engine_thread_history_unavailable，不输出引擎原始异常，不静默新建或替换 mainThread。仅用户明确同意后，才可将指针修复到已核验、工具契约兼容的既有历史；修复前备份配置与 SQLite，核验原记录哈希未变。离线 engine 测试覆盖错误分类，已有 service 测试覆盖恢复失败保留指针。测试不能声称无消息的新线程一定可跨进程恢复。
