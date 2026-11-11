> 本文记录 2026-10-25 的旧协作架构验收，不作为当前架构或日常实例的验收结论；当前实现与分层证据见[主 Agent 与 Worker 会话架构](architecture/main-worker-chat-architecture.md)。

# 一级业务 Worker 与原生协作验收

更新：2026-10-25。维护源码已实施，未提交、未安装、未发布；未操作生产数据库、账号或渠道，未中断在途任务，未介入独立 UI 发布。当前架构见[主 Agent、一级 Worker 与原生协作](12-recursive-agent-architecture.md)。

## 证据与隔离

本轮所有前像、增量补丁、构建、合成 DB/home、日志与截图集中于 `.codex/scratch/worker-native-subagent-convergence-implementation-20261024/`。起始 HEAD 为 `a6040cc62fb2e76ece3fb62b138b31ab9da516c8`；`baseline.json`、`before/` 与 index/staged/status/dirty 前像用于逐 hunk 保留共享工作。

维护检查不运行 `test:real`、日常启动器或账号渠道。UI 使用真实产品构建、合成读取 owner、随机端口和独立空白 Chrome profile。业务、审批、用户回执均为明确标注的合成数据。

## 已验证合同

- Worker 直接伪造管理调用仍拒绝，Task/Run/operation 无副作用；main 可建多个同级 Worker，非空 parent 仅 main 根。同版本旧库的业务多层或 Worker coordinator 只读拒绝，不改历史。保留 peer、capabilities、skills/MCP 获取与原权限。
- 根与直属版本、依赖环、消息/ACK、精确 Run 目标、通用等待、park、材料读取、候选文件组、主验收与发布；主队列领取/CAS 与未知回执保持。
- 同连接子 callback 的允许/拒绝、真实 requestId 单次回送、并发首入末出等待、resolved、子轮/父段/旧 epoch/关闭失效；main 仍严格，动态子工具不绕父 thread/turn。
- 同名 native item 在两个子 thread 中的文件审批仍关联各自准确操作；没有新增 child registry。
- EOF 先行、46 秒后才信号兜底、未确认退出保留 lease、已有 terminal/accepted 不被关闭动作覆盖；yield/park 不关闭引擎。
- 工作状态 320/390/1440 像素下四个直属 Worker 同层显示，无多层文案；摘要/Popover、原计划、窄屏 Escape 返回焦点、预览与 `scrollWidth == viewport`、页面 scroll range 为 0。截图在 `screenshots/`，浏览器错误为 0。

最终相关合成检查共 443/443 通过：主 suite 430，实际宿主成功/部分交付 2，相关执行恢复 4，隔离桌面 preflight 2，固定启动器 5。平面状态浏览器 4 组检查、外置 Worker 卡片 19 项检查通过，均覆盖 320/390/1440。没有运行整仓 `npm test` 或真实账号/渠道验收。

首轮 249/251 的两个失败是被删除的旧合同断言，已删除/改写并复测。新增管理封口、子审批、文件 item 关联与同版本旧树拒绝均先复现红灯再修复。最终命令、准确阶段和退出状态见本轮 `implementation-report.md`、`verification.json` 与日志。

服务源码类型与隔离前端构建通过。整仓 `typecheck` 在当前混合工作区仍有 12 条诊断；实施前保存副本同样有这些诊断。本轮不扩大修复无关旧测试。此前 committed 137 条的诊断属于不同源码快照，本轮没有将它当作当前基线。

## 真实原生 smoke 的限制

已使用随包固定 `codex-cli 0.163.0` 和现行 `gpt-6.1-sol / high / Fast` 请求一次隔离场景：一业务 Worker 原生拆两份合成文本，整合为父结果送主，断言 native 子不增加 Homer Task/Run/Result。

最初在模型调用前遇 `interaction_socket_path_too_long`，改为在同一隔离目录运行后启动成功。随后现有网关返回 `engine_authentication_failed`：观察到 1 个 Homer Task、1 个 Run、1 个失败候选 Result，native spawn 为 0、usage 不可得、主未接收成功结果。因此两子工作整合与真实原生关闭贯穿没有验收通过。该尝试中的 Worker EOF、exit 与 lease 释放已确认。

没有读取生产 profile、复制 token/rollout、伪造用户授权或无限重试。后续需提供可用于隔离 home 的合法现有认证机制，再续跑同一小场景；无需升级模型或引擎。真实审批若出现，须逐项取得用户对具体动作的明确决定，实施批准不能替代。

## 重跑

先阅读 `implementation-plan.md` 和 `verification.json`。普通合成测试可使用仓库既有 `node --import tsx --test` 入口，源码/前端构建只在 scratch 副本执行。真实 smoke 不是普通单测，不应随回归套件自动运行。任何生产迁移、清理、安装、重启、提交或发布须另有明确授权。
