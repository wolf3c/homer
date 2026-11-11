# 官方工具调用在原 Run Activity 内展开

2026-10-25，本地源码候选。用户批准官方完整组件接入后，将原来的工具摘要行改为官方工具展开：同一条消息、同一个 Run Activity，内部可查看新调用的参数和结果。未安装、发布、重启或接入真实模型。

## 数据与责任边界

`src/engine.ts` 在原 `item/started` / `item/completed` 入口提取固定 ThreadItem 协议内容；保留主 thread/turn 过滤、host 原生重复排除和已有 native callback/EOF/权限增量。命令保存 command/cwd、aggregatedOutput/exitCode；MCP 保存 arguments/result/error；dynamic tool 保存 arguments/contentItems。没有真实工具名的原生类别沿用既有中文类别标签，不以 item.type 冒充原函数名。其余已支持类别只取协议实际可提供的字段；图像原始字节隐藏，修订提示以 `revisedPrompt` 字段明确来源，不冒充原始参数。reasoning 不采集。

`src/service.ts` 在原 `mainActivity` 执行边界取得宿主真实 args/result/throw。`src/tool-content.ts` 在保存前遮蔽明确凭据并限制内容；`src/main-process.ts` 只扩展同一个 tool 的可选 `toolName/content`，沿原 meta、MainProcessHistory 和已授权 process API 透传。没有新表、第二份参数档案或详情端点；MainProgress 渠道消息不带调用内容。旧记录不回填，PublicActivity 继续表示业务记录，不能替代工具原始结果。

每次调用输入和输出各最多 **32 KiB JSON 值**，两侧至多 64 KiB 加固定状态封套；单字符串 16 KiB、最大深度 8、512 个访问节点。上下文没有更小的既有调用正文规范，因此采用该保守上限，让一次展开保持可读，同时限制原 JSON 节点的持久化增量。输出只在开始/结束采样，忽略原生输出 delta；普通 commentary 仍由原 JSON 节点保存机制处理，并非新建独立写入队列。

明确凭据包括 authorization、cookie、password、secret、token、apiKey、privateKey、相关环境变量名和凭据映射中的 key；普通记录的 key、keyboard、tokenCount 保留。字符串只匹配有边界的 Bearer/Basic、私钥块、常见密钥/JWT 和明确凭据赋值形态，不声称识别任意自然语言秘密。getter/toJSON 不执行，循环、Proxy、非 JSON 值明确隐藏；深度、节点或大小超限标为省略。采集后的内容仅用于用户获准查看的业务调用历史，不写入遥测、诊断、日志或截图。测试与截图使用虚构合成内容。

`recorded`、`truncated`、`not-recorded`、`pending`、`hidden` 分开表达，false、0、null、空字符串不走 truthy 判断。结果截断或隐藏不改变原 status，也不代表业务成功。凭据在持久化前处理，不能先保存完整原文再仅在 UI 遮蔽。

## 消息、状态与审批

`ui/process-message.tsx` 将 commentary、tool-call、显式 answer 投影进既有 external-store 消息。原消息 ID/createdAt、调用 ID、revision 与首次顺序不变；metadata 只带分类、状态、标签和内容状态说明，不复制新正文。RunActivity entries 使用 PartByIndex 和固定官方 ToolFallback 的 Trigger/Args/Result/Error；完整 Approval 源码保留，实际审批仍沿原 InteractionCard。

completed 为“调用已返回”；failed 映为 incomplete/error，避免 core 将有 result 的错误调用推成 complete；interrupted、declined、unknown、blocked 分别显示中断、拒绝、待核实、受阻。工具状态独立于主轮结果。缺少当前 thread/process/turn/stage 证据时，running 显示“上次调用中，结束未确认”，不继续转动或计时。异常进入外层 attention，已显示的条目在 settled 更新后留在原父位置。

原审批 owner、请求身份、仅本次权限、失效和未知投递规则保持。未连接模拟 onRespondApproval/addToolResult/resume，也不增加永久授权或第二组按钮。正式气泡只渲染 answer parts，复制沿原 message.text，整段与选区引用不采纳工具内容。Worker 事件卡继续在官方 RunActivity 外稳定挂载，成果、来源和时间仍在原位置。

`ui/process-details.ts` 是唯一详情缓存，位于原消息投影可见处；保留 readEpoch/thread/node/revision/Abort/卸载校验，只缓存当前有界历史窗口里的已授权详情。ProcessNodeView 不再维护第二份局部正文缓存，收起历史不预加载全部工具。

## 复现与回退

来源、原文件 SHA-256、必要 Button/Textarea/cn 消费闭包及准确适配见 `ui/vendor/assistant-ui/README.md`；RunActivity 本体、依赖版本和 MIT notice 不变。样式复现：

```sh
node scripts/build-run-activity-css.mjs --tool-fallback --check
node --import tsx --test tests/tool-content.test.ts tests/tool-call-history.test.ts tests/tool-message-projection.test.mjs tests/process-detail-owner.test.mjs tests/official-tool-fallback-upstream.test.mjs
```

行为回归来自本次需求推导的合成输入，不是生产聊天、原生 rollout 或真实账号录制。完整产品 UI 验收脚本为 `tests/run-activity-tool-integration.browser.mjs`；仅接受隔离构建、随机本地端口、新临时 Chrome profile 和合成历史。已有审批、Worker 位置与复制/引用回归按原协议继续验证。

本轮精确构建身份、测试通过与未通过项、性能数值、三尺寸 PNG、专属补丁及逐 hunk 前像记录在 `.codex/scratch/run-activity-official-tool-implementation-20261025/findings.md`。这些证据不表示生产采用。回退只撤本次源码补丁，旧前端忽略新增可选字段；不批量改写历史，也不回填或删除原生记录。
