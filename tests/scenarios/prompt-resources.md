# HMR-PROMPTS-001：提示词文件与原线程恢复

流程来源：requirements-derived，用户要求将维护中的提示词独立成文件，便于今后 AI 更新。输入来源：synthetic，仅临时包资源、随机测试版本标识和暗号，不使用真实用户资料。文件化不代表已实现模型自修改权限。

## 离线检查

默认 `tests/prompts.test.ts` 验证 main/worker 两个资源存在且非空、无静默 fallback、加载快照固定、下次加载读取修改，以及原生 fixture 的 thread/resume 更新指令但保持同线程。`service-interactions.test.ts` 同时核对实际 main/Worker 工厂收到资源内容和默认自主范围。

编译模块从不同 cwd 读取资源、npm pack dry-run 资源清单、打包 CLI 缺失资源后释放锁的检查移到 `tests/prompts.development.test.ts`。先构建，再显式运行 `npm run test:development -- --test-name-pattern=HMR-PROMPTS-001`；它不会验证真实模型理解。

用例先因不存在 loadPrompts 导出失败，再实现资源加载；补充 CLI 缺失文件检查先复现被误报 engine_protocol_error，修复后通过。不调用模型、不读取生产连接、不生成发布包。

## 显式真实检查

先 `npm run build`，再 `npx tsx scripts/real-prompt-reload.ts <已获准配置>`。脚本自动创建 scratch 下的独立编译包副本和 workspace，以及 private 下独立 runtime；使用原连接，不复制凭据，不修改日常提示词、配置、runtime 或 Terminal。

1. 副本 main.md 加入随机版本 A 指令，启动实际 Homer，告知合成暗号；答复必须带 A。
2. 仅修改副本文件为版本 B，当前进程再次答复仍必须带 A，证明未中途热读。
3. 正常关闭并重新启动同一副本和 runtime，mainThread 必须与之前相同。
4. 请求回忆暗号，模型须正确回忆并带 B，不能沿用 A，证明同线程历史和新指令同时生效。
5. 关闭自己的进程、释放锁；仅保存版本哈希、线程 ID、用量和布尔结果，不保存对话或模型回执。Codex 自身仍按引擎机制保存历史。

真实调用可能产生费用，金额未知，不标免费；失败保留稳定步骤／错误分类，不写断言原文。该检查不是 Worker 自修改、自主部署或动态工具迁移测试。实际结果与环境见 [验证记录](../../docs/07-m0-validation.md)。
