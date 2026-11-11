# Homer、yezi2 与 AMH：原生 Token MVP 需求

更新：2026-10-29。替代旧的独立模型用户、钱包和支付接入设计。购买关闭，暂不自动充值；本文不授权生产配置、真实账户或模型调用。

## 流程与分工

Homer 打开 yezi2 → 原网站账号登录 → PKCE 一次性 code → 网站兑换并自动交付个人 Token／配置 → 正常重启 → 主 Agent／Worker 直连普通网关 → 查询个人 Token 额度。

| 项目 | 负责内容 |
| --- | --- |
| yezi2 | 网站身份；网站用户与原生 Token ID/Key 的服务端私有映射；安全交付、配置同步。管理凭据永不到 Homer |
| AMH／New API | 一个专用普通归属用户，每位网站用户一个有限 Token；复用组、渠道、模型、价格、Redis、batch、原生 Token 查询和停用 |
| Homer | 安全保存 Token；网站 subject 防换人；原 profile、thread、任务、记忆及文件；角色执行配置与个人 Token 额度 |

共享用户没有“无限钱包”开关，需维持足够额度。个人 Token 余额不保证共享钱包、模型渠道或上游一定可消费。创建 Token 必须显式 `allow_user_quota_query=false`，不向客户端展示共享用户余额。

## Homer 最小合同

唯一公共定义由 yezi2 的 `docs/homer/2026-10-29-native-token-mvp-v1-r5.md` 维护；本仓保留锁定副本，不自行添加字段。

- Token 交付严格为 `{subject, modelToken, config}`；subject 是网站用户身份，不是共享 AMH 用户 ID。不新增 accountRef／tokenRef。
- 运行配置包含 `main`／`worker` 各自的 `baseUrl、model、effort、fast`。2026-11-04 未发布候选新增必需 `deepseek`，会员窗口 512000、total 压缩阈值 400000，见 [契约增量](2026-11-04-membership-context-config.md)。首版两者均为 deepseek-flash／max／Fast 关闭，固定 Codex 0.163.0；后台记忆整合沿固定引擎 medium。
- 配置在登录、启动时同步；每次用户发送消息时，若距上次检查超过一小时则检查。无系统定时任务、无空闲轮询、不重新发 Key。
- Token 保存在当前 profile 的唯一私有连接文件，UI、URL、argv、日志和普通工具不接收秘密。
- 连接保存后正常停止并重启采用；停止未确认不清锁、不强杀、不起第二 owner。取消或迟到结果不采用，不撤销网站共用 Token。
- 查询 `/api/usage/token/` 的顶层 `data.total_available／total_used`，不读取 `user_quota`。缺失、非法或无限 Token 显示未知，不冒称零余额；`/api/status` 不带 Token，沿原生单位换算。
- 旧私有文件的 accountRef／alias 仅作读取兼容；正常保存移除废弃引用，不迁移或认领历史，不静默切换 BYOK 或其他账号。

## 最小验收

验证精确 callback／PKCE／单次 code、取消及写失败，旧文件兼容与异人拒绝；普通原生有限 Token 的自动交付、正常重启、两个角色与文件交付、配置同步和额度查询；原生停用后新请求失败且不重放。只用合成身份和假上游，真实模型性能另行验证。

不再验收支付、内部 ensureAccount／credit、独立钱包／claim、设备 grant、专用资金分支或隐藏价格。历史证据保留，不能把旧方案已通过的结果当成 v1-r5 已通过。
