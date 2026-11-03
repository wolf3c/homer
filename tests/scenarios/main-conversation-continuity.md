# HMR-CONTEXT-001：主对话重启延续

来源：requirements-derived，用户要求主 Agent 重启后延续原对话；测试输入全部 synthetic，随机暗号不含用户资料。

正常启动后记住合成暗号，关闭 Homer，在相同运行目录重新创建服务，再询问暗号。必须恢复相同 mainThread，真实模型回复包含暗号。普通重启不得创建新主线程；恢复异常、返回错误线程标识、工具指纹不兼容时，原 mainThread 必须保留，不能静默新建。

离线入口：`npm test` 中 T09 normal restarts 与 tool upgrades；真实入口：`npx tsx scripts/real-session-resume.ts <已授权配置>`，脚本只在 `.codex/scratch/` 的新独立 runtime/workspace 运行，不保存对话正文。模型服务仍按自己的机制保存测试线程。记录结果与路径，不能把离线通过当作实际模型记忆证明。

2026-10-16，Codex 0.154.0 / gpt-6-astra / low，真实关闭并重新启动后同线程与暗号回忆均通过。元数据见验证记录。本场景不验证自动会话迁移、无限上下文或崩溃中的工具继续执行。
