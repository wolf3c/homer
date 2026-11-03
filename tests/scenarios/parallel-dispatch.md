# HMR-PARALLEL-001：主 Agent 多任务派发

来源：requirements-derived，用户明确要求移除固定单 Worker 限制，暂由模型决定派发，不引入复杂调度提示词。输入：synthetic，公开虚构 Markdown；不采集真实用户材料。

## 步骤与验收

1. 在新 runtime 启动；一条消息允许多次 dispatch_work，独立 Run 同时执行，主 Agent 可查询。
2. 逆序完成，逐一审阅交付，内容与路径不串任务；相同用户 request-id 重放只回传已有关联 Run。
3. 停止其中一个，其他保持运行；退出停止所有执行，并等待进程收口。
4. 一次失败不阻塞其他执行；文件权限、超时和旧成果保护继续生效。运行中同 Matter 修订仍拒绝。

普通 `npm test` 使用脚本化 Fake，引擎不联网。显式 `npx tsx scripts/real-parallel.ts <本机配置>` 使用已授权模型，可能消耗订阅或付费额度；仅在新的 `.codex/scratch/parallel-regression-*/` 写入合成材料和结果元数据，不保存对话正文。真实运行验证两个 Worker 的 engine_started 到 artifact_written 区间重叠、独立线程／文件、成功验收和分别交付；退出后保留非敏感证据供核对。

自动与真实结果见 docs/07-m0-validation.md。测试未运行不得标通过；模型是否自行选择合理粒度不在这一项中保证。
