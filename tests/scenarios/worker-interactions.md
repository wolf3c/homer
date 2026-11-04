# HMR-INTERACTION-001：Worker 授权与业务提问

流程来源：requirements-derived。用户已明确授权实现主 Agent 接管 Worker 授权／提问，依据当前任务的实际授权、目标和上下文决定，仅超范围或不清楚时升级用户。输入来源：synthetic，只有公开合成 Markdown、随机标题／版式和临时目录操作，不使用真实敏感文件。

## 前置与消息

显式入口 `scripts/real-worker-interactions.ts <已获准连接配置>` 自动创建 `.codex/scratch/worker-interactions/real-<时间>/workspace`、`.codex/private/wi-<时间>`，沿用获准连接但不复制凭据、不操作日常 runtime、Terminal 或主线程。CLI 标准输入保持打开，以便用户答复；每次重跑使用新目录。

1. 用真实旧工具线程（仅原五 dynamicTools、无交互 MCP）告知主 Agent 随机合成标题；关闭该引擎，再以新 Homer CLI 恢复原 ID，核验标题回忆与历史保留。
2. 要求派独立 Worker，先 read_material，再必须 ask_main 确认该标题，使用实际答复写 Markdown。主 Agent 应查看待答并直接回答，原 Worker 成功／通过内容审阅／交付。
3. 再派 Worker，ask_main 询问尚未给出的用户指定合成版式。主 Agent 应 escalate_interaction 并发出自然语言 question，待答保持 pending_user。
4. 发送一条明确不回答待答的普通聊天，验证主 Agent 能回复且原问题保持未答。
5. 发送准确 interactionId 与随机版式，主 Agent 查看并答复；断言原 Worker pid/thread 未变，实际成果包含版式且成功交付，未重新派发。
6. 可选 `--native`：要求第三 Worker 使用原生 request_permissions 申请仅自己 cwd 的 read，主 Agent 在宿主允许范围内直接批准，然后读取材料并交付。必须观察真实 native 请求、approved 和原通道 deliveredAt，不能将 ask_main 或 fixture 冒充此项。

基础脚本核对两 Run（`--native` 要求三 Run）、独立线程、产物内容、交互状态和同一 mainThread；报告只保存元数据与用量，不保存对话／原始参数／模型回执。真实模型使用可能计费，金额未知。Native 无法安全触发时应报未实测，不替换成功条件。当前本机 0.163.0 / environments=[] 不提供 request_permissions，保留原生尝试失败证据；基础脚本只代表业务问答和历史兼容通过，报告 nativeVerification=not_run。

## 离线契约

`npm run check` 包括专门的 service-interactions、worker-interactions、worker-native-requests、engine-worker-interactions、worker-interaction-protocol、worker-interaction-mcp 测试。全部使用本地 Fake、临时 SQLite、模拟 stdio 或本地 socket，不调用模型。

历史测试说明：下文“等待超过执行预算仍存活”及红绿记录来自旧执行预算阶段。当前宿主整轮预算已由[执行时限与故障恢复](../../docs/38-native-timeout-recovery.md)移除；等待期间的 `activeMs` 统计、交互失效及停止确认仍保留，不表示存在自动整轮限时。原孤立计时器及其两项专用单测已移除；现有估算费用/连续压缩保护属于独立引擎契约，不恢复旧整轮预算。

检查主直接回答、授权批准／拒绝、两 Worker 准确路由与乱序答复、等待超过执行预算仍存活、无关消息、正式 ask_main、答复前校验、重复／冲突／过期答复、停止禁授权、失去回调的重启对账、准确非空原生答案、秘密输入拒绝、权限子集和 turn scope、未知能力拒绝、MCP 只暴露三个工具、诊断无正文。协议 fixture 保留原生关联 ID 并收到真正 JSON-RPC 响应，不以模型提示词代替传输测试。

先有红色行为回归，再实现独占模块和集成。真实测试另揭示 thread config 清空自有 MCP、MCP 调用审批被 never 拦截、验收缺少步骤证据三个路径，修复后重跑；具体事实记录在 docs/07。

## 连续性与退出

`scripts/check-worker-tool-compatibility.ts <Codex路径>` 在隔离 Home 内先建原五 dynamicTools 的原生线程，注入合成历史、退出进程，再以自有 MCP 恢复同一线程，检查历史、原 dynamicTools 及三个新工具目录。它不调用模型，真实连续性还需独立的 `real-session-resume.ts` 和上述交互脚本。

停止／退出立即失效回调，重启将丢失回调项标 expired，Run interrupted；不会从持久批准恢复外部动作。EOF／--message 只剩用户待答时明示并停止。普通最终文本提问不自动识别；不涵盖运行中追加、steer、停止重派、完成后排队续办、IM、Office 或浏览器。

测试停止后确认自己的子进程／锁释放，保留必要失败元数据；仅清理该次合成目录，不删用户资料。实际版本、模型证据及限制见 [验证记录](../../docs/07-m0-validation.md)。
