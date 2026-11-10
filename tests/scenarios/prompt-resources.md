# HMR-PROMPTS-001：提示词文件与原线程恢复

流程来源：requirements-derived，用户要求将维护中的提示词独立成文件，便于今后 AI 更新。输入来源：synthetic，仅临时包资源、随机测试版本标识和暗号，不使用真实用户资料。文件化不代表已实现模型自修改权限。

## 离线检查

默认 `tests/prompts.test.ts` 验证 main/worker 两个资源存在且非空、无静默 fallback、加载快照固定、下次加载读取修改，以及原生 fixture 的 thread/resume 更新指令但保持同线程。`service-interactions.test.ts` 同时核对实际 main/Worker 工厂收到资源内容和默认自主范围。

编译模块从不同 cwd 读取资源、npm pack dry-run 资源清单、打包 CLI 缺失资源后释放锁的检查移到 `tests/prompts.development.test.ts`。先构建，再显式运行 `npm run test:development -- --test-name-pattern=HMR-PROMPTS-001`；它不会验证真实模型理解。

用例先因不存在 loadPrompts 导出失败，再实现资源加载；补充 CLI 缺失文件检查先复现被误报 engine_protocol_error，修复后通过。不调用模型、不读取生产连接、不生成发布包。

## 宿主升级回归

`tests/service.test.ts` 覆盖旧会话追加新版、注入失败后重试、同版本重启去重以及运行中恢复。在 Apple 芯片上用原版 Codex 0.163.0 和编译后的宿主，对 v0.1.4 与 build 291 分别验证了完整历史和已压缩历史。首轮和重启都收到旧版一份、新版一份，正常压缩及压缩后重启只收到新版一份。恢复阶段零模型请求，原会话 ID、历史、附件和工具声明均保留。使用相同注入方式的隔离原型另用真实 `gpt-6.1-terra` 验证了旧规则与新版冲突时采用新版。

## 原生请求检查

以下专项用于比较 Codex 引擎自身替换旧指令的行为。

用 `HOMER_TEST_CODEX_BIN` 指定待验收的真实引擎绝对路径，用 `HOMER_TEST_SERVICE_MODULE` 指定基线 Homer 包内 `dist/service.js` 的文件 URL。用 `HOMER_TEST_CODEX_BASELINE_BIN` 指定创建旧会话的正式引擎，省略时也使用待验收引擎。分别用 v0.1.4 和 build 291 的包内模块运行同一个专项。

```sh
npm run test:prompt-resume
```

测试在隔离目录启动原生 app-server，推理请求只到本地模拟 Responses 接口。覆盖完整历史、升级前已压缩，以及写入上下文检查点前中断后直接续聊或先压缩。恢复阶段要求零模型请求，首条请求旧版 0 份、新版 1 份，同一线程的历史、附件、工具声明和原始记录前缀仍可核对。用例也检查相同标记的非 Homer 指令、重启和压缩后的实际请求。常规桌面验收单独保留工具声明恢复用例。

本地补丁基于 Codex `rust-v0.163.0` 的 `83086188ae0614bd882818ff1aa23f3194962012`，用原生内容标记和 Homer 主宿主附加的工作目录尾部识别指令。在独立 Codex 源码根目录应用 [原生回放补丁](../../docs/patches/2026-11-09-codex-cold-resume-developer-instructions.patch)，在 `codex-rs` 运行以下命令。标签中的锁文件仍含 `0.0.0` 的工作区版本，`cargo fetch` 会将其同步为标签版本。

```sh
cargo fetch --target aarch64-apple-darwin
CARGO_INCREMENTAL=0 cargo rustc --locked --offline --profile dev-small --package codex-cli --bin codex -- -C strip=none
```

使用生成的 `target/dev-small/codex` 运行该原生对照专项。当前宿主升级路径沿用固定官方引擎，并按上面的宿主回归验收。

2026-11-09 Apple 芯片验证。v0.1.4 与 build 291 的官方包内引擎字节相同，使用各自工具目录时均复现首轮旧版 1 份、新版 0 份。以原版引擎创建资料，再用本地补丁引擎恢复，两套专项各 5 项通过，覆盖正常历史、已有压缩历史和中断后先续聊或先压缩。另用两版官方包内的 Homer 宿主分别创建合成会话和上传附件，再由编译后的候选宿主续聊。原线程、附件字节和工具指纹一致，恢复零请求，首轮旧版 0 份、新版 1 份。旧声明省略 `title`、新声明提供 `title` 均派工成功，两个 Worker 都结束为成功。推理端点为本地回环。

同一候选引擎冷恢复 12,000 条合成历史，交替测量 7 组（另有 1 组预热）。不传新版指令和传入新版指令的中位耗时分别为 1.84 秒、1.81 秒，两组在恢复时均无模型请求。

## 显式真实检查

先 `npm run build`，再 `npx tsx scripts/real-prompt-reload.ts <已获准配置>`。脚本自动创建 scratch 下的独立编译包副本和 workspace，以及 private 下独立 runtime；使用原连接，不复制凭据，不修改日常提示词、配置、runtime 或 Terminal。

1. 副本 main.md 加入随机版本 A 指令，启动实际 Homer，告知合成暗号；答复必须带 A。
2. 仅修改副本文件为版本 B，当前进程再次答复仍必须带 A，证明未中途热读。
3. 正常关闭并重新启动同一副本和 runtime，mainThread 必须与之前相同。
4. 请求回忆暗号，模型须正确回忆并带 B，不能沿用 A，证明同线程历史和新指令同时生效。
5. 关闭自己的进程、释放锁；仅保存版本哈希、线程 ID、用量和布尔结果，不保存对话或模型回执。Codex 自身仍按引擎机制保存历史。

真实调用可能产生费用，金额未知，不标免费；失败保留稳定步骤／错误分类，不写断言原文。该检查不是 Worker 自修改、自主部署或动态工具迁移测试。实际结果与环境见 [验证记录](../../docs/07-m0-validation.md)。
