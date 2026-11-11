# DeepSeek BYOK 隔离试跑入口

2026-10-28，Asia/Shanghai。用户要求先运行 DeepSeek 主 Agent／Worker，再接入网站授权。初始 base 为 `0120d92084f6cdc90c4f05f19e92aa0e8c1233bb`；审查合并基线更新为 `545d95d1311578a766f78d776a587a5370c5a425`。本任务只新增账号输入模块、隔离启动器、测试及两份文档，未接收主树未提交改动。用户已授权代码审查、本地提交及合并 main；未授权安装、重启日常服务或部署。最终提交身份以本文件的 Git 历史为准。

## 运行

在 main 仓库目录，用现有 Node 22 在本人 macOS 终端执行，不要把 Token 放进命令、聊天、截图或普通配置：

```sh
cd /Users/wolf3c/Project/homer
/Users/wolf3c/.nvm/versions/node/v22.22.0/bin/node scripts/deepseek-isolated.mjs
```

看到“粘贴 AMH Token”后粘贴并按回车，字符不会显示。Ctrl-C 可取消。终端不会把隐藏输入作为 shell 命令写入历史。入口拒绝重定向输入及命令行 Token 参数。

启动后先输入“只回复连接成功”，确认主 Agent 响应；然后输入：

> 请派一个 Worker，在默认测试工作目录完成一个最小任务：交付一份 hello.md，内容只有“DeepSeek Worker 已运行”。你检查实际产物后告诉我结果。不要安装依赖、连接其他服务或操作工作目录以外的文件。

`/status` 查看隔离实例；`/quit` 正常停止。当前为终端交互入口，尚未接桌面界面。模型请求可能计费，使用用户创建的专用限额 Token；不要把原始日志或整个运行目录发进聊天，遇错先提供无秘密的错误类别和现象。

## 实际配置与秘密边界

- Provider：`https://models.super-tree.com/v1`，`wire_api=responses`，不使用网站授权或日常原生账号。
- 主 Agent 和 Worker 共用 `deepseek-flash`，隔离入口默认 effort 为 `high`，Fast 显式关闭；模型目录和压缩阈值见 [Codex 适配与执行保护](2026-10-28-deepseek-codex-adaptation.md)。下文首轮验收记录对应此前 max 配置，不代表本次维护源码已完成真实渠道验收。
- 固定 Codex `0.163.0`，从本仓 Git common directory 对应仓库的 `.codex/private/engines/` 定位既有二进制；工作树和 main 共用同一固定构件，不写死用户绝对路径。启动前流式校 SHA-256 `8813367285524ac798dd96d1b071aea30d58708c7226fd236cd275cf1cfdee31` 与实际版本，避免一次分配约250 MB。复用本机 Node `22.22.0`、既有 tsx，无新增依赖，不自动安装引擎。
- 每次创建 `.codex/scratch/homer-deepseek-smoke/session-*`，含独立 HOME、CODEX_HOME、runtime、workspace 和临时目录。启动不读取日常配置或 auth，不安装、不重启日常 Homer。新启动不会恢复或重放上一轮任务；旧试跑目录保留。
- 普通配置只含 `keyEnv=HOMER_DEEPSEEK_TOKEN`。Token 经隐藏输入进入启动器内存，再进入可信 Homer／Codex 进程环境，不放入 argv 或配置文件。退出后需重新输入；未提供 Keychain 持久化或网站授权。
- 启动器不继承其他 HOMER 覆盖、账号变量或用户代理变量。原引擎继续使用 `shell_environment_policy.inherit=none`。这是一套独立运行数据，仍沿用产品原生工具权限，并非虚拟机或仅允许访问 workspace 的 OS 隔离。
- 显式关闭后台记忆生成及记忆使用；自定义 runtime 避免产品首次启动自动发起初始化模型轮次。正常启动只建立会话，用户输入普通消息才提交模型轮次。
- 输入阶段 Ctrl-C 或外部 SIGINT／SIGTERM 都会恢复终端回显；信号处理先于输入提示安装，避免刚显示提示时中断却未清理的竞态。运行阶段启动器把 SIGINT 转为子进程 SIGTERM，复用 CLI 的幂等关闭，避免重复 SIGINT 提前结束清理。`--check` 只使用可关闭传输的原生引擎，信号立即触发一次关闭并拒绝挂起RPC，随后等待同一关闭结果；关闭未确认则失败，不会强杀日常进程。

## 本地验证与证据边界

在上述工作树运行：

```sh
/Users/wolf3c/.nvm/versions/node/v22.22.0/bin/node --test tests/deepseek-isolated.test.mjs
/Users/wolf3c/.nvm/versions/node/v22.22.0/bin/node scripts/deepseek-isolated.mjs --check
/Users/wolf3c/.nvm/versions/node/v22.22.0/bin/node --import ./node_modules/tsx/dist/loader.mjs --test --test-concurrency=1 tests/model-config.test.ts
/Users/wolf3c/.nvm/versions/node/v22.22.0/bin/node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```

`--check` 不询问Token，调用固定真实引擎的initialize／config等本机协议后关闭，不创建Homer主会话、不启动本机MCP、不提交模型轮次。该检查不替代完整Homer入口验收。配置回归是合成协议；终端输入检查使用PTY和固定假字符串，检查无回显、回车接收、Ctrl-C／信号取消、终端回显恢复。合成测试不能替代供应商或共同联调验收。

首轮新增入口测试8/8、配置回归74/74通过；曾在本机load335.51期间出现子进程超时。审查时用可重复合成输入复现了输入阶段外部信号退出和启动后吞掉SIGINT的问题；修复后入口测试扩展到17项，含`--check`启动／关闭两个阶段的SIGINT／SIGTERM各一次关闭、永不回应的启动请求可取消、关闭未确认报错。未通过放宽超时或断言规避失败。流式哈希后的最终引擎协议检查测得0.46秒、最大RSS94699520 bytes（约90 MiB）；这仅是本次本机探针测量，不代表Homer完整启动、推理延迟或性能保证。

提交前在上述main合并基线联合运行账号59项、隔离入口17项、模型配置74项和Worker默认56项，共206/206通过，0失败、0跳过；后端`tsc --noEmit -p tsconfig.json`及账号测试定向严格类型检查均通过。独立只读复审确认退出问题已关闭，无剩余阻塞。结果日志保留于本任务隔离工作树`.codex/scratch/homer-account-stage1/review-tests.log`；未运行全仓测试或增加真实模型请求。

用户已在本人终端隐藏输入真实Token并完成最小试跑。只读核对该隔离实例数据库与实际文件：Worker状态`succeeded`、任务`settled`、结果由协调者验收为`accepted`，交付对应会话消息`completed`；`hello.md`精确内容为“DeepSeek Worker 已运行”，SHA-256为`5a5770d10f9cfbf0c1a0ab424dfa6b3ac6f96bc3d07b813d10b19dacecf2dc2e`。Token未进入聊天或本仓文件。此证据仅覆盖一次主对话→派工→文件生成→验收交付，不覆盖图片、压缩、长任务、账单准确性、所有工具兼容或网站授权／三方联调；本轮代码审查不重复发起付费调用。

退出入口即可回到原日常 Homer；无需迁移或恢复日常数据。隔离试跑失败时先停止该入口并检查本实例，不改日常安装、不自动重放结果未知的付费请求。网站授权、账户绑定、钱包／用量及共同包联调继续按锁定合同另行迭代。
