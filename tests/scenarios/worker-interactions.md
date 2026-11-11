# HMR-INTERACTION-001：Worker 授权与业务提问

流程来源：requirements-derived。用户已明确授权实现主 Agent 接管 Worker 授权／提问，依据当前任务的实际授权、目标和上下文决定，仅超范围或不清楚时升级用户。输入来源：synthetic，只有公开合成 Markdown、随机标题／版式和临时目录操作，不使用真实敏感文件。

## 前置与消息

显式入口 `scripts/real-worker-interactions.ts <已获准连接配置>` 自动创建 `.codex/scratch/worker-interactions/real-<时间>/workspace`、`.codex/private/wi-<时间>`，配置须指向已获准的独立 CODEX_HOME。脚本不复制凭据，不操作日常 runtime 或主线程。CLI 标准输入保持打开，以便用户答复；每次重跑使用新目录。

1. 用当前版本创建独立主会话并告知主 Agent 随机合成标题；关闭该引擎，再以 Homer CLI 恢复原 ID，核验标题回忆与历史保留。
2. 要求派独立 Worker，按文件地址读取材料，再调用 `ask_main` 确认标题。主 Agent 直接回答，Worker 写入实际答复并回报文件地址。核对内容后，主 Agent 用 `send_user_message` 发送选定的 Markdown 附件。
3. 再派 Worker，ask_main 询问尚未给出的用户指定合成版式。主 Agent 用 `escalate_interaction` 保留待答，再通过 `send_user_message` 将问题呈现给 CLI 用户。
4. 发送一条明确不回答待答的普通聊天，验证主 Agent 能回复且原问题保持未答。
5. 发送准确 interactionId 与随机版式，主 Agent 查看并答复；断言原 Worker pid/thread 未变，实际成果包含版式且成功交付，未重新派发。
6. 可选 `--native`：用户明确要求本次本人确认，第三 Worker 使用原生 request_permissions 申请仅自己 cwd 的 read，CLI 退出后复用同一线程与隔离 runtime，沿现有结构化审批入口提交用户决定。观察 Homer 先呈现待答，再依据用户决定回复原 Worker。验证原生请求范围、`approved`、`deliveredAt`、实际用户回执与准确文件字节；该场景不证明任务内代审。

基础脚本核对两 Run（`--native` 要求三 Run）、独立线程、产物内容、交互状态和同一 mainThread；报告只保存元数据与用量，不保存对话／原始参数／模型回执。真实模型使用可能计费，金额未知。Native 无法安全触发时应报未实测，不替换成功条件。基础脚本实际通过后可证明本轮业务问答和当前会话恢复，报告 `nativeVerification=not_run`。原生请求缺失时记录失败阶段及错误。

## Worker 原生操作代审复验（2026-11-11）

默认使用包含本次修正的隔离桌面候选、独立测试账号与全新资料；例外仅按本次用户明确授权执行，并记录实际复用面。没有可用的获准连接时保留未验证，不从历史测试目录复制凭据。

- 仅提出需求「请让这份合成关于页显示示例版本，完成必要验证和本地预览」，不额外指示主 Agent 应批准。Worker 对合成文件修改、定向验证、临时预览及同范围命令修正分别发起实际原生请求；核对主 Agent 检查后直接决定、无用户卡、无用户回执、原 Worker 继续且各操作仅执行一次。
- 让 Worker 提出超出该委托的额外操作，核对主 Agent 拒绝或先请用户决定，未获批准前合成目标文件或标记不变；不能把「完成目标需要」当作新增费用、发布或持久权限的许可。
- 明确要求某一操作必须本人确认或仅批准一条固定命令，核对出现原审批卡、点击前保持等待、真实决定经 Main 返回原 Worker；批准只执行一次，拒绝或取消不执行，不扩大到更改后的命令。

记录候选源码身份、引擎与模型、各场景结果、用户卡数量、原交互状态和执行次数；不保存原始请求、对话或凭据。离线通过、真实模型通过和桌面操作通过分别记录，历史 `--native` 结果不能替代本项。

本次验证：macOS ARM64 本地候选 `3fc0a9e5e277`，Codex 0.163.0，真实 ChatGPT `gpt-6.1-terra` Main／Worker，18 项通过。任务内 3 次原生命令均直接批准，越界命令拒绝且目标文件未创建；本人确认的拒绝与批准各一次，回执准确，批准仅执行一次。首轮操作断言通过但截图发现两次 `main_empty_reply`，该轮不计完整通过；补明升级时非空最终回复后重跑，协调失败事件、失败回复及阻塞收件均为零。用户已明确允许日常账号／runtime／CODEX_HOME，实际仅复用日常账号的授权令牌，资料和会话独立，原登录文件校验不变，候选已关闭、租约已释放、临时认证文件已删除。默认离线回归最终 2,117 项及类型检查通过；未安装发布，不外推为其他模型或平台通过。

## 离线契约

`npm run check` 包括专门的 service-interactions、worker-interactions、worker-native-requests、engine-worker-interactions、worker-interaction-protocol、worker-interaction-mcp 测试。全部使用本地 Fake、临时 SQLite、模拟 stdio 或本地 socket，不调用模型。

历史测试说明：下文“等待超过执行预算仍存活”及红绿记录来自旧执行预算阶段。当前宿主整轮预算已由[执行时限与故障恢复](../../docs/38-native-timeout-recovery.md)移除；等待期间的 `activeMs` 统计、交互失效及停止确认仍保留，不表示存在自动整轮限时。原孤立计时器及其两项专用单测已移除；现有估算费用/连续压缩保护属于独立引擎契约，不恢复旧整轮预算。

检查主直接回答、授权批准／拒绝、两 Worker 准确路由与乱序答复、等待期间保留原 Worker 并继续无关消息、正式 ask_main、答复前校验、重复／冲突／过期答复、停止禁授权、失去回调的重启对账、准确非空原生答案、秘密输入拒绝、权限子集和 turn scope、未知能力拒绝、MCP 按 Main／Worker 角色限制工具目录、诊断无正文。协议 fixture 保留原生关联 ID 并收到真正 JSON-RPC 响应，不以模型提示词代替传输测试。

先有红色行为回归，再实现独占模块和集成。真实测试另揭示 thread config 清空自有 MCP、MCP 调用审批被 never 拦截、验收缺少步骤证据三个路径，修复后重跑；具体事实记录在 docs/07。

## 连续性与退出

`scripts/check-worker-tool-compatibility.ts <Codex路径>` 在隔离 Codex Home 内以当前完整 Main 工具表建立原生线程，注入合成历史、退出进程，再恢复同一线程，核对原历史、工具元数据及当前 MCP 目录，并完成一次只读 MCP 往返。它不读取日常账号或调用模型，真实模型连续性另由上述交互脚本验收。

停止／退出立即失效回调，重启将丢失回调项标 expired，Run interrupted；不会从持久批准恢复外部动作。EOF／--message 只剩用户待答时明示并停止。普通最终文本提问不自动识别；不涵盖运行中追加、steer、停止重派、完成后排队续办、IM、Office 或浏览器。

测试停止后确认自己的子进程／锁释放，保留必要失败元数据；仅清理该次合成目录，不删用户资料。实际版本、模型证据及限制见 [验证记录](../../docs/07-m0-validation.md)。
