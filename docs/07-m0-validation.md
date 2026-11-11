# M0 验证记录

日期：2026-10-16；Homer 0.1.0。本记录区分真实模型检查、模拟故障检查和未验证范围。运行方法见 [运行 Homer](06-running-homer.md)，验收口径见 [T01–T11](04-delivery-and-acceptance.md#4-m0-验收场景)。

## 环境和协议

本机 macOS arm64，Node 22.22.0，npm 10.9.4；产品调用 PATH 中 Codex CLI **0.154.0** 的真实可执行文件。托管本次开发任务的 Cindy 使用另一份引擎，不将其版本混作产品版本。主 Agent 与 Worker 均用 **gpt-6.1-sol**，通过本次任务已有的授权连接完成模型调用。

先执行 `codex --version`，再由该二进制的 `app-server generate-json-schema` / `generate-ts` 输出确认协议；不是按猜测接口实现。探针完成 initialize、动态工具调用和真实模型确认；实际产品使用公开 App Server stdio JSON-RPC，包含 thread/start、thread/resume、turn/start、turn/interrupt、动态工具及用量通知。实验能力须在 Codex 升级后重新验收。

参考：[官方 App Server](https://developers.openai.com/codex/app-server/)、[权限](https://developers.openai.com/codex/permissions/)、[配置参考](https://developers.openai.com/codex/config-reference/)。运行事实来自本机探针和验收脚本，文档本身不作为成功证据。

未购买、借用其他人的凭据、修改全局账号／配置、安装其他引擎、初始化 Git、提交、部署或发送外部消息。凭据由官方 Codex 使用现有鉴权提供，未写入项目文件。

## 实际命令与证据

```sh
npm ci
npm run check
npm run test:scenarios
npm audit
npm run test:real -- .codex/scratch/release-core.config.json
npm run test:real -- .codex/scratch/meeting-regression.config.json
npx tsx scripts/real-controls.ts .codex/scratch/control-release.config.json
npx tsx scripts/real-routing.ts .codex/scratch/routing-verified.config.json
npx tsx scripts/real-main-failure.ts .codex/scratch/main-failure-verified.config.json
```

检查脚本要求专用 scratch 工作区和新 runtime；配置含当前任务的临时连接，不能作为长期公共服务配置。维护示例 [homer.config.json](../examples/homer.config.json) 不含临时地址或凭据。

`npm run check` 包含正式构建、源码／测试／真实验收脚本的 TypeScript 检查及行为测试。新增维护用例后共 26 项自动测试通过，其中 `npm run test:scenarios` 的 4 项检查独立通过；完整 npm 依赖审计 0 个漏洞。自动测试使用显式 Fake 引擎或 transport mock，不冒充真实 Codex。

| 场景 | 真实 Codex 检查 | 自动故障／契约检查 |
| --- | --- | --- |
| T01 多轮对话 | 连续输入后正确回忆刚才信息；没有派发 Run | 简单对话无 Worker |
| T02 实际派发 | 主 Agent 动态工具创建 Matter/Run；独立 Codex 线程读材料、写非空 Markdown | 持久状态、唯一 claim、Worker 会话分离 |
| T03 查询进度 | 真实 Worker 运行时输入自然语言查询，主 Agent 工具读取 running | 主线程响应且 Worker 不中断 |
| T04 成果验收 | 宿主检查路径／存在／普通文件／非空；主 Agent 读取源文及成果后内容验收并交付 | 未 inspect 不得批准；空文件、越界和覆盖拒绝 |
| T05 修订 | 同 Matter 新 Run、新 Codex 线程，按负责人分组；旧文件 SHA-256 保持 | 新路径、旧成果仍可读 |
| T06 排队与澄清 | 第二件工作 queued；模糊“那个”先询问且不新派发 | 全程最多一活动 Worker；运行中同 Matter 修订拒绝 |
| T07 失败 | 实际缺失文件得到 material_missing，无成果；长材料不完整成果被 content_rejected；主动终止本测试主引擎后系统事实回执正常输出及记账 | 引擎断开、无成果、启动失败、输出目录不可写均不得成功 |
| T08 停止和超时 | 真实运行时 SIGINT，记录请求后确认 cancelled；1000 ms Worker 超时为 failed/timeout；自然语言停止仅作用指定工作 | 停止无法确认是 interrupted；进度输出失效不能阻止停止；主引擎停止未确认退出报错 |
| T09 重启 | 真实运行中 SIGKILL CLI，重新启动清理残留；旧 Run interrupted，无自动重派；完成／停止历史保留 | 落盘 Store 重开、幂等对账 |
| T10 重复与投递 | 相同 request-id 的重复 CLI 请求不新增 Run，回执标历史及当前状态 | 重复结束／迟到通知不污染新轮次；交付途中另一结果结束仍会排空；stdout 未确认时保留 pending |
| T11 权限 | 实际 Codex OS 沙箱对范围外读／写返回 Operation not permitted；命令网络连接同样 EPERM | 遍历、绝对路径、软链接、非许可工具配置拒绝；额外审批请求拒绝 |

核心链路证据：`.codex/scratch/real-acceptance/core-checks.json` 和 `public-sample-transcript.jsonl`。停止／崩溃／超时／OS 隔离证据：`.codex/scratch/real-controls/lifecycle-checks.json`。排队／澄清／缺失／去重证据：`.codex/scratch/real-routing/`。这些是本机公开样例的临时验收证据；下面的成果来源和本文件保留为不含敏感信息的维护记录。

核心检查于 05:58 UTC 通过，控制检查于 06:07 UTC 通过，整组路由检查于 06:19 UTC 通过。首次交付前重新执行 npm ci 后完整检查通过；新增维护用例后的最新自动检查记录为 `.codex/scratch/red-green/scenarios-full-check.txt`。错误交付降级会保存稳定分类事件，不写原始异常或供应商内容。

06:23 UTC 启动的独立真实主引擎故障检查通过：对经本应用租约核实的主引擎 PID 发送 SIGTERM 后，Run `run-d2d9f0ee-409b-4e8c-b122-496d020a99a1` 保持 failed/material_missing，记录 engine_disconnected 降级原因及 delivered，无虚构成果，正常退出。证据为 `.codex/scratch/real-main-failure/main-failure-checks.json`。实际入口配置另经 `dist/cli.js --message` 测试正常响应，未派发多余工作。

## 持续维护的使用回归用例

用户要求开发中主动提炼获准且脱敏的实际使用反馈，供未来修改回归、保障质量。维护入口为 [用例索引](../tests/scenarios/README.md)，初次交付时只有 **HMR-MEETING-001**：来源 `requirements-derived`，fixture 来源 `synthetic`；**初次交付时真实用户反馈用例数为 0**（后续已新增 HMR-CHAT-001，见文末），不把虚构会议或开发验收冒充用户实际使用。

该用例包含初始条件、顺序消息和操作、输入、可观察预期／禁止行为、清理及重复执行方式。离线和真实入口共用消息与固定事实检查，不做整篇逐字快照。后续真实反馈沿用原问题 ID 补用例；适用的行为修复先重现失败再修复。采集不默认保存原始对话、工具参数／结果或用户文件，不自动上传；实际内容需授权及脱敏。

新增用例后于 **2026-10-16 06:36:16 UTC** 实际重跑 `npm run test:real -- .codex/scratch/meeting-regression.config.json`，退出码 0，T01–T05 全部通过。本次没有重新运行 T06–T11 的模型检查，其既有结果仍以先前证据为准。模型／环境：gpt-6.1-sol、Codex 0.154.0、Node 22.22.0、macOS arm64。

| 本次观察 | 实际结果 |
| --- | --- |
| 简单问答与执行中查询 | 保持代号；在 running 时查询主 Agent 工具读取的事实，回复时仍 running |
| 初版 | Run run-24ed496c-1b3d-4fea-8dc1-261b35a4ecad；独立线程 01a1436a-f0d0-7c40-9ef0-e9a60726d494；实际 Markdown 通过源文／内容审阅 |
| 修订 | 同 Matter matter-aca75f6c-f3bf-41c0-9e9e-a5f578bcbe17；新 Run run-9d16971a-1446-4272-8529-27c050e73c18；新线程 01a1436c-438a-7de0-8ef3-e471b60abc24；新路径、原文件哈希未变 |
| 默认留存 | `transcriptSaved=false`，本次证据目录只有 core-checks.json；控制台无模型正文 |
| 用量／费用 | 主线程 217350、首次 Worker 23646、修订 Worker 33576 totalTokens，合计 274572；缓存不重复相加，实际金额未知，不能标免费 |

本次元数据在 `.codex/scratch/scenario-regressions/HMR-MEETING-001/core-checks.json`，记录稳定 ID、两类来源、实际环境、分项断言、文件路径／哈希和用量；离线记录为 `.codex/scratch/red-green/offline-scenarios-check.txt`。真实成果在此次专用 workspace 中，未改写下方首次验收的维护示例或来源记录。普通 `npm test`／`check`／`test:scenarios` 均不调用模型或生产资源；真实模型回归仅由显式入口触发，可能计费。核心与排队脚本只在显式 `--save-public-transcript` 时保存公开合成样例回执，现有历史证据保留而不自动采集新用户内容。

## 实际成果与内容检查

固定输入为 [虚构会议笔记](../tests/fixtures/meeting-notes.md)。真实核心检查于 2026-10-16 05:58 UTC 完成，Matter 为 `matter-e2c5a85b-8088-44f7-adbd-d9c0eb9c1148`。

| 成果 | 原始 Run / Codex Worker 线程 | 字节 / SHA-256 |
| --- | --- | --- |
| [行动清单](../examples/meeting-actions.md) | run-40a85526-ab21-48cb-9551-2da6597388d3 / 01a14349-0d41-76c1-9eff-48ab3ecaa4df | 1570 / c0f8b9976d39a6a44d63f52596904d9fcf90534cce193f884c39871810f4ab1b |
| [按负责人修订](../examples/meeting-actions-by-owner.md) | run-6a1c2484-c50e-416d-8a79-2580d52381db / 01a14349-e34d-77b1-96c5-08547f10f75a | 2854 / 440a6efbc787050cf6de29e2001b9327c99a1a71688253a13d2cbb791a24ab8d |

示例是实际生成且通过审阅的原文件逐字节副本，不是预写测试输出。机器可读来源见 [provenance](../examples/meeting-artifact-provenance.json)。原始文件位于专用测试 workspace/outputs 下的各自 Run 目录；重命名示例副本不更改原 Run。

内容逐项核对：林青完成初稿，期限保持“2026-10-20 前”；陈舟检查导出流程，日期待确认；整理反馈的负责人和日期均待确认；“周五讨论帮助文档”与“预算暂缓”独立列出，不升级为行动承诺。修订按负责人分组、汇总未确认项，不新增承诺，原文件哈希未变。

## 资源、耗时和用量

核心运行由脚本每约 500 ms 对 CLI 及全部后代进程采样，未只计算 Node 主进程。共 237 个快照，常见空闲 2 进程、Worker 活跃 3 进程。RSS 观察范围 93.3–229.8 MiB；CPU 快照聚合最大 35.6%。`ps %cpu` 是采样时可得的进程平均值，不是瞬时峰值或性能保证。

| 阶段 | 进程数 | RSS MiB | CPU % |
| --- | --- | --- | --- |
| 一次空闲观察 | 2 | 122.5 | 15.0 |
| Worker 活跃，尚未查询 | 3 | 175.6 | 2.5 |
| 主 Agent 查询与 Worker 同时活跃 | 3 | 199.9 | 2.5 |

首次 Run 从领取到完成内容审阅约 28.18 s；修订 Run 约 37.77 s；运行中的自然语言进度查询约 10.6 s，回复时 Worker 仍 running。包含模型／网络延迟，不是本地调度基准。

下表为该次核心运行各独立线程最终可得的累计 tokenUsage；缓存输入已包含在输入中，不重复相加。主线程累计含问答、派发、进度、审阅和交付。

| 线程 | totalTokens | inputTokens | cachedInputTokens | outputTokens |
| --- | --- | --- | --- | --- |
| 主 Agent | 219843 | 218127 | 186624 | 1716 |
| 首次 Worker | 23833 | 23170 | 14720 | 663 |
| 修订 Worker | 34414 | 33398 | 23552 | 1016 |

三线程报告 totalTokens 合计 278090；不等于独立上下文长度，也不是全次开发的模型用量。停止／崩溃时仅保存已经收到的通知，缺少不当成 0。未获得可信计费单价和结算金额，不声称精确成本或金额硬限额。

## 失败记录和剩余边界

- 最初修订时 Worker 将材料名猜成带 materials/ 前缀的路径，宿主拒绝后真实失败；改为由宿主绑定 read_material 的唯一输入，之后完整 T01–T05 通过。失败证据保留为 `real-acceptance/revision-path-failure.json`。
- 原生沙箱启动最初使用 Codex 符号链接路径，运行辅助程序被拒；改为解析真实二进制路径，实际越界读写／命令网络拒绝检查通过。
- 补测中一次缺失文件的终止状态正确，但主 Agent 交付退回系统事实回执且 CLI 以 engine_protocol_error 退出；待交付仍 pending。重启补交付、两次独立缺失复测、最新整组路由检查及主动主引擎故障检查均正常；该数据库 integrity_check 为 ok。原异常保留在 `real-routing/routing-before-investigation.json` 及对应公开对话。根因尚未确认，不能据复测抹去这条可靠性限制。
- 180 项长材料在 Codex 工具回传中发生截断；Worker 未完整产出时，主 Agent 拒绝内容验收，没有假报完成。128 KiB 宿主上限不等于模型可完整读取；M0 未做分段读写和长文档质量保证。
- OS 权限检查在当前 Mac 和 Codex 版本执行，未验证 Linux／Windows。安全边界控制模型及工具动作，不防护恶意同一系统用户或被篡改的宿主／Codex。
- 内容审阅由模型执行，固定样例外没有自动事实正确性保证。文件通过后可能被同一用户主动改动；查询和修订会重新检查，不能把旧状态当作永恒有效签名。
- stdout 的 delivered 只代表本机写入获确认；写入与 SQLite 标记之间崩溃可能重复显示。没有 IM 送达回执或人已阅读保证。
- 无 GUI、IM、Office、浏览器、插件市场、多引擎、账号收费、递归子 Agent、daemon、精确金额硬限额或完整审批恢复；未扩展旧 P0 的全部目标。

项目原先无 Git。本轮按工程文件逐项审阅边界、错误与生命周期，并运行源码／测试／验收脚本类型检查；保留原七份产品文档及后续目标，未创建仓库或提交。维护文件检查清单为 `.codex/scratch/maintained-file-review.json`。本地文档目标链接无缺失，两份成果与来源哈希一致；维护文件未发现字面凭据，本次运行未留下活动引擎租约或 CLI 锁。

## 本机订阅连接修复复核

2026-10-16 用户首次 CLI 问候无响应并出现 main_timeout。旧入口使用已失效的临时开发代理；改用本机登录后，继承 MCP、未传递系统代理、账号模型不可用依次暴露。修复为进程内逐项禁用 MCP、核验后再开线程、更新重启进程租约、传递既有代理设置；默认官方 OpenAI 路由，显式 baseUrl 仍走原可配置路由。未改全局账号、MCP 或代理，未复制凭据。

本次真实验证：macOS arm64 / Node 22.22.0 / Codex 0.154.0，原本机 ChatGPT 登录、官方服务、账号实际列出的默认 gpt-6-astra，CLI 通用问候得到非空中文回复并正常退出；gpt-6.1-sol 对本账号实际不可用。`npm run check` 构建、类型检查、29 项离线测试通过。新增回归 HMR-CHAT-001，当前真实用户反馈用例 1 个。普通测试不调用模型；本次未重跑文件任务真实全链路。

## 多 Worker 并行更新验证（2026-10-16）

用户取消固定单 Worker 限制，程序现允许主 Agent 一条消息多次派发独立执行；未增加复杂调度提示词。原 T06 单槽位／排队实测仅描述初次交付版本，不再代表当前行为。新用例 HMR-PARALLEL-001 覆盖三 Worker 同时执行、主 Agent 查询、乱序完成、单独停止、退出停止全部、局部失败及同一请求重放；旧库新增 sourceRequestId 及索引，保留原记录，兼容原 requestId 查询。

本机订阅首次文件任务实测暴露 code-mode host is disabled：先前聊天通过不代表工具可用。修复为保留官方 code_mode_host，仍关闭 shell、外部 MCP 等非许可能力。官方问题记录：[工具宿主禁用导致工具不可用](https://github.com/openai/codex/issues/37376)。首次真实并行尝试未派发任何 Run，未记作成功。

随后显式 `npx tsx scripts/real-parallel.ts .codex/private/local-chatgpt.config.json` 真实通过：本机 Codex 0.154.0 / gpt-6-astra，主 Agent 同一消息派发两个不同事项，两个独立 Worker 从 engine_started 到 artifact_written 的区间重叠；分别读取公开合成材料、生成不同文件，内容中的人名与待确认日期核对通过，两次均 succeeded / delivered。元数据位于 `.codex/scratch/parallel-regression-1792134805405/checks.json`，不保存对话正文，记录可得用量，实际金额未知。

最终 `npm run check` 构建、源码／测试／真实脚本类型检查及 35 项离线测试全部通过，包含旧数据库字段迁移和旧主线程工具定义兼容。此次没有重复执行完整 OS 权限／崩溃验收；局部停止与退出的并发行为以离线检查为证，不能写成已做真实停止测试。主工具描述变更时新建主线程，旧线程索引及任务库保留，旧聊天不自动复制。

## 指定模型与 medium 核验（2026-10-16）

发现原适配器固定发送 low，已增加 effort 配置与 HOMER_EFFORT 覆盖，并在启动提示中显示。新增行为测试先确认 medium 被错误发送为 low，再修复；连续两轮验证 medium 传输。`npm run check` 构建、类型检查、36 项离线测试通过。

使用当前 local-chatgpt 连接、独立测试工作目录、现有 Codex 登录，真实请求 gpt-6.1-sol / medium，结果 failed / engine_model_unavailable / hasReply=false。元数据为 `.codex/scratch/model-medium-check/result.json`。本次没有修改工作配置、登录或终端进程，当前运行模型仍为 gpt-6-astra；指定模型切换尚未完成。

## 主对话重启连续性（2026-10-16）

已取消工具指纹变化自动创建新主线程；相同配置重启恢复保存的线程，核对返回标识。恢复失败、错误线程标识、工具不兼容均不覆盖旧 mainThread；工具自动迁移尚未实现。启动提示区分首次主对话与恢复原主对话。

回归先确认旧工具升级逻辑会静默换线程，再修复。`npm run check` 构建、类型检查和 37 项离线测试通过；新增真实脚本后类型检查通过，补充错误线程标识后两个相关 T09 检查通过。

显式真实 `scripts/real-session-resume.ts`：Codex 0.154.0 / gpt-6-astra / low，先告知随机合成暗号，关闭服务，使用相同运行目录重建 Homer，验证 mainThread 相同且模型能回忆暗号，通过。元数据 `.codex/scratch/session-resume-1792135527336/checks.json`；不保存对话正文。不代表 gpt-6.1-sol 可用，不保证无限上下文，不改变 Worker 退出停止与重启不重放规则。已构建新版本，未中断用户日常 Terminal 会话。

## GPT-6.1 Sol medium 实际切换与 Terminal 启动（2026-10-16）

本次已完成指定模型切换：macOS arm64、Node 22.22.0、项目内官方稳定 Codex **0.163.0**、用户原有本机 ChatGPT 订阅、官方 OpenAI 路由、**gpt-6.1-sol / medium**。未改系统 Codex 安装、全局账号配置或系统代理，未复制凭据，也未使用 Cindy 的模型连接。此前“本账号无法使用 6.1”的结论只反映旧 0.154.0 引擎，现已被本次同账号实测修正。

根因对比：同一 codexHome、订阅、目标模型、effort 和测试工具，Homebrew 0.154.0 的 model/list 不含 6.1，真实请求 failed/engine_model_unavailable、无回复、工具 0 次；App 自带 0.163.0-alpha.10.2 列出 6.1，真实请求完成、工具 1 次、返回合成标记正确。随后在项目 private 目录固定安装官方 `@openai/codex@0.163.0`，不依赖 App 随升级变化的内置路径。普通下载曾超时，复用已有系统代理后安装成功，版本实测为 codex-cli 0.163.0。

| 检查 | 实际结果与证据 |
| --- | --- |
| 版本／订阅对比 | `.codex/scratch/sol-medium-upgrade/engine-comparison.json`；账号类型均为 chatgpt，无凭据或对话正文 |
| 引擎层同线程切换 | 0.154.0 Astra 记住随机合成暗号，App 新引擎 6.1 medium 恢复同一线程并回忆成功；`cross-model-resume-checks.json` |
| Homer 稳定版完整切换 | `scripts/real-model-switch.ts` 通过：原模型记忆、0.163.0 / 6.1 medium 同线程恢复、暗号回忆、真实 list_work 材料查询、切换前请求保留；`.codex/scratch/model-switch-1792136300471/model-switch-checks.json` |
| 实际轮次参数 | 同一测试线程的 turn_context 顺序为 Astra/low、6.1/medium、6.1/medium；`.codex/scratch/sol-medium-upgrade/stable-model-contexts.json` |
| 两个独立 Worker 文件任务 | `scripts/real-parallel.ts` 通过：执行区间重叠、不同事项／线程／成果，真实读取公开合成材料并生成 Markdown，两个 succeeded/delivered，姓名和日期待确认检查通过；`.codex/scratch/parallel-regression-1792136327612/checks.json`。三个主／Worker 线程的实际 turn_context 均为 6.1/medium，另见 `.codex/scratch/sol-medium-upgrade/parallel-model-contexts.json` |
| 自动检查 | 最后 `npm run check` 构建、源码／测试／真实脚本类型检查、**39 项离线测试**全部通过；`.codex/scratch/sol-medium-upgrade/full-check.txt` |
| 用户原 Terminal | 07:47:34 UTC 核验窗口 7325、/dev/ttys000，实际 0.163.0 进程存活，启动显示 gpt-6.1-sol / medium、“已恢复原主对话”，真实回复“Homer 已就绪”；`terminal-startup-checks.json` |

运行目录绑定修复先有失败回归，再实现 v2：model/effort 是同一账号与工作区内的选择，不再阻断正常同线程切换；workspace、codexHome、baseUrl、keyEnv、requiresOpenaiAuth 变化仍拒绝。旧 hash 仅在原配置匹配时事务升级，不凭新模型猜旧绑定。没有放宽跨账号／供应商边界，既有恢复失败／错误线程／工具不兼容的拒绝行为保留。

实际用户库还暴露了独立的历史问题：mainThread 指向 15:17 建立、尚无消息且没有落盘 rollout 的空线程，而三条既有请求均发生于 14:56–15:00，对应另一个仍完整保存的原主线程。首次新版本恢复因此返回 engine_rpc_failed，未创建新线程。调查仅检查必要的线程元数据、请求时间和结构，不输出历史正文。增加错误分类后，此类引擎错误返回 engine_thread_history_unavailable，CLI 明示保留指针、不新建对话。

**用户明确选择恢复 14:56 的已有主对话后**，才核验其相同工作目录、OpenAI 供应商、全部工具名称和输入结构，并修复主指针。旧线程的工具描述文本与当前版本不同，本次核验允许的是同名称／输入契约的已有线程恢复，不是通用自动工具迁移。原指针、配置与完整 SQLite 已在被忽略的 private/backups 中备份；首次停止前确认无未完成请求、活动任务或待交付。没有更换日常 workspace/runtime、删除历史或创建替代对话。修复元数据为 `approved-thread-repair-checks.json`。

最终逐行哈希检查：原 **3 条请求**、事项与 Run 记录均完整保留；新增 1 条合成启动检查后请求共 4 条，无活动 Run，SQLite integrity_check=ok。原日常库此前事项与 Run 均为 0，本次未往日常库添加任务。实际已恢复线程的最后 turn_context 明确是 gpt-6.1-sol / medium；Terminal 留在运行状态供用户继续使用。报告不保存完整对话，仅保留获准合成检查的短回复和必要状态字段。

新增维护用例 [HMR-MODEL-001](../tests/scenarios/model-switch-continuity.md)，来源 requirements-derived、输入 synthetic，覆盖模型切换、绑定升级／边界、真实同线程回忆与工具查询。普通测试不调用模型。此次没有重复完整 OS 沙箱／崩溃验收，也不保证未发生过消息的引擎线程一定跨进程持久化；遇到缺失历史继续按明确失败处理，禁止静默更换线程。模型用量仍以可得元数据为准，未取得结算金额，不标为免费。


## Worker 授权／提问闭环（2026-10-16）

本次实现独立 Run 的正式 `ask_main`、原生 App Server 请求桥接、主 Agent 查看／答复／升级工具、SQLite 业务状态和原进程等待／继续，不只是提示词或方案。用户授权下，主 Agent 按当前任务的实际授权、目标、上下文及请求详情自行判断，明确批准、拒绝或回答；只有超范围或判断不清才升级用户。默认自主范围及 `autonomy` 调整方法见 [运行说明](06-running-homer.md#worker-待答与自主范围)。不增加 shell、任意文件写入、网络、IM、浏览器或 Office；三种运行中追加方式留给后续任务。

### 离线与协议证据

`npm run check` 的构建、源码／测试／真实脚本类型检查和 **73 项本地测试全部通过**（含本任务新增 31 项交互检查与同期独立升级检查），最后记录在 `.codex/scratch/worker-interactions/full-check.txt`。普通测试不调用模型或生产连接。新增行为先用失败回归定义契约，再实现独占模块和共享集成。

- 服务级覆盖主 Agent 自主批准／明确拒绝／直接回答、两个 Worker 并行待答与逆序准确回传、等待超过执行预算仍存活、主 Agent 继续接待无关消息、停止后拒绝答复、重启将失去回调的项标 expired，原主线程 ID 不变、不重新派发。超出本 Run 的读取和网络授权即使由模型提出也被宿主拒绝，合法读取子集仍可通过。
- 业务状态／时钟覆盖多个问题不串线、同一答复幂等、冲突与过期答复拒绝、校验失败不落批准、只有真实用户消息上下文可答复 pending_user、未送达决定在停止／重启后失效、等待不扣预算且答复不续满预算。
- 本地 stdio 协议 fixture 经真正 CodexEngine 适配器发送原生 command approval 和 question，保留关联 ID 等待主决定，核对单次 accept/decline、非空准确答案及原生 resolved 回执。权限子集／turn scope、文件 grantRoot 和会话策略拒绝、秘密输入拒绝、未知能力与错误 thread/turn 拒绝另有测试。这些是合成协议验证，**不是模型发出真实原生审批**。
- 本地 MCP 测试只暴露三个交互工具，敏感异常只返回稳定错误分类；额外检查进程及 thread 配置均只为三个自有业务工具提供 MCP 调用许可。原五个主 dynamicTools 的定义／指纹未改，已有 model/effort、binding v2、历史不可恢复错误分类与禁止静默新建行为保留。

本机原生协议分别从 Codex 0.154.0 和 0.163.0 `app-server generate-ts --experimental` 核对，副本在 scratch 的 protocol 与 protocol-0.163。官方同版配置及 MCP 审批语义也核对了 [0.163.0 schema](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/config.schema.json)、[MCP 审批实现](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/mcp_tool_call.rs)。对三个业务工具的调用许可不替代 Worker 具体操作判断。

### 真实 CLI 与旧主线程兼容

`npx tsx scripts/real-worker-interactions.ts .codex/private/local-chatgpt.config.json` 在全新合成 workspace 和独立 private runtime 通过；未修改用户日常 runtime、历史主指针、配置、账号或正在运行的 Terminal。

实际环境：macOS arm64、Node 22.22.0、官方稳定 Codex **0.163.0**、原有本机 ChatGPT 订阅、**gpt-6.1-sol / medium**。不仅记录请求参数：对本测试三个线程的实际 turn_context 逐项核对，全部为该模型与 effort。只提取这些合成测试线程的 model/effort，不复制原始历史。

| 检查 | 观察到的结果 |
| --- | --- |
| 旧线程加入新工具 | 先以原五 dynamicTools、无交互 MCP 建立真实主线程并记住随机标题；关闭旧进程后，新 Homer CLI 恢复同一 ID，正确回忆标题，随后真正调用新增 MCP 工具 |
| 主 Agent 直接回答 | Worker 先读材料，再 ask_main；主 Agent 查看并直接回答已有标题，原 Worker 写入实际答案，通过源文／内容审阅并 succeeded/delivered |
| 必要时升级用户 | 第二 Worker 提问主 Agent 未知且用户禁止猜测的版式；主 Agent 记录 pending_user 并自然语言发问 |
| 待答时继续聊天 | 独立无关消息得到正确回复，原问题仍 pending_user，没有误用该消息作为答案 |
| 原 Worker 继续 | 用户给准确待答 ID 与随机版式；主 Agent 关联真实用户消息并答复，Worker 的 pid/thread 不变，文件包含实际版式并 succeeded/delivered，没有重新派发 |
| 回执与留存 | 两项 ask_main 均 answered，deliveredAt 非空；报告 transcriptSaved=false，不保存模型回执或对话正文；引擎本身仍按机制保存历史 |

本次成功主线程 `01a143d3-111b-7bb3-b6d6-37455dec1797`。两个成功 Run 分别为 `run-d3879f7c-11ed-424f-bfc8-f7762f9a0930` 与 `run-b7c30eee-9cec-4d6b-98a2-527595ba6c53`，各自独立 Worker 线程与产物路径见 `.codex/scratch/worker-interactions/real-1792139268095/interaction-checks.json`；实际模型核验为同目录 `model-contexts.json`。主线程累计 totalTokens=544818、两 Worker=50041/49993，合计 644852；缓存已包含在输入中，不重复相加。该数值仅是这次成功验收，不涵盖之前失败尝试；结算金额未知，不标免费。

无模型原生兼容探针 `scripts/check-worker-tool-compatibility.ts` 还在隔离 Codex Home 内，验证原五 dynamicTools 线程注入合成历史、退出、同 ID 恢复、原历史及动态工具元数据不变，新 MCP 目录可用。`.codex/scratch/worker-interactions/native-tool-compatibility-evidence.json` 版本为 0.163.0，modelCalled=false。实际模型与工具证据以上述 CLI 检查为准，不把目录发现当作工具已执行。

### 失败调查与真实原生审批限制

本次保留四次独立失败记录，没有覆写为通过：

1. `real-1792138363467` 启动失败：thread config 中旧的空 mcp_servers 清掉自有 MCP；修复为进程和 thread 两处传递相同受控配置，保留其他继承 MCP 的禁用。
2. `real-1792138544829`：模型可发现新工具，但 Codex 的 never 策略拒绝 MCP 调用。只对三个自有业务工具显式设置调用许可，未将 Worker 操作一律批准，亦未改全局 MCP。
3. `real-1792138852527`：问答和产物已成功，但主 Agent 无步骤证据而 content_rejected。inspect_run 现返回已有事件类型／时间和交互摘要，能够核验读取／提问顺序，不新增原始参数诊断。
4. `real-1792138961257`：两个业务问答 Run 均成功交付，但第三个原生审批尝试未发出请求，测试按 native_approval_not_observed 失败，第三 Run 最终 read_material_first。真实 Worker 检索不到 request_permissions，未用 ask_main 伪造原生批准。当前保留 `environments: []`；[同版工具注册](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/tools/spec_plan.rs) 要求环境可用才广告该工具。没有为测试而启用额外原生执行环境。

因此当前交付可确认：原生请求桥接与校验在 fixture 下通过，**真实模型原生审批未触发**；成功 CLI 基础报告明确 `nativeVerification=not_run` / `nativeApprovalObserved=false`，不宣称第三项成功。脚本可显式 `--native` 要求这项实测，未观察到真正请求及回执会失败。业务问答、升级用户、原进程继续和旧线程加载新工具已有独立真实通过证据。

### 生命周期与后续任务接入

新表 `worker_authorities`、`worker_interactions` 是业务记录，后者关联 id/run/thread/turn/source/requestId。状态为 pending_main/pending_user/approved/denied/answered/cancelled/expired，waitingFor 由状态导出，deliveredAt 单独记录原通道回执。问题正文、操作详情、答复与授权理由不进入 events／诊断；主 Agent 通过显式 inspect 查看。新增主工具为 inspect_interaction/respond_interaction/escalate_interaction，Worker 为 ask_main。

Worker 等待时保持原进程、线程、轮次及请求，主队列只排入事件轮次，不等待该请求 Promise。答复前重新校验关联执行和宿主能力；停止先关计时器并使待答失效，之后中断／确认退出。重启在残留进程与 Run 对账后把无法恢复回调的待答或未送达决定置 expired，不自动重放动作或沿用批准。已送达决定仅保留历史。后续追加方式需复用这些失效规则，不能把旧待答或批准带入新 Run／新 turn。

普通最终文本中的提问仍不自动识别；必须使用 ask_main 或支持的原生请求。单消息／EOF 只剩用户待答时明示并停止，持续交互模式才能当场补答。用户日常 Terminal 保持运行原进程，构建产物已更新但不热更新；待 CTO 验收及空闲重启后加载，原 workspace/runtime/mainThread 不变。没有创建 Git、分支或提交。

## 提示词文件化与同线程更新（2026-10-16）

用户新增要求将维护中的默认提示词独立成文件，便于今后 AI 更新。本轮将主／Worker 规则及上述交互规则移到 `prompts/main.md`、`prompts/worker.md`，初始默认自主范围移到 `prompts/autonomy.md`，没有在 TypeScript 保留静默 fallback。`src/prompts.ts` 按模块位置读取并验证资源；Homer 每次启动取固定快照，所有 Worker 和授权快照复用该版本。普通 CLI 下一次启动生效；独立开发启动器沿用它已有的安全空闲换版机制，不新增一套热更新。

离线 HMR-PROMPTS-001 先复现缺少加载接口和 CLI 将资源缺失误报为协议错误，再实现并通过。检查涵盖固定／更新快照、缺失／空／不可读文件、从不同 cwd 运行编译模块、npm pack dry-run 资源包含、打包副本 CLI 明确报错并释放锁、原生 thread/resume 参数及 main/Worker 实际装配。包声明显式包含 dist 和 prompts；纯 Markdown 修改无需重新编译，分发不能只复制 dist。

本机 Codex 0.163.0 生成的 ThreadStartParams 和 ThreadResumeParams 均有 baseInstructions；引擎在两处传入当前内容。此字段与不能在线替换的 dynamicTools 分开：没有改变原五工具指纹，也没有用新线程绕过工具迁移。

显式真实 `scripts/real-prompt-reload.ts .codex/private/local-chatgpt.config.json` 在独立编译包副本、合成 workspace 和 private runtime 通过，未修改日常提示词、运行库、账号或 Terminal。环境为稳定 Codex **0.163.0 / gpt-6.1-sol / medium**，对本测试同一线程的三个实际 turn_context 核对全部匹配。

| 检查 | 实际结果 |
| --- | --- |
| 首次加载 | 副本 main.md 版本 A 生效，实际答复带随机 A 标识 |
| 运行中编辑 | 文件已改为 B，当前进程的下一轮仍带 A，不提前混用 |
| 关闭／重启 | 恢复同一 mainThread `01a143e5-702b-7ec1-b54e-41bf7ab3a19c` |
| 新指令与旧历史 | 正确回忆旧随机暗号，答复带 B 且不带 A，证明更新指令与历史同时生效 |
| 清理与记录 | 本测试锁已释放；报告不保存对话或回执，仅版本哈希、线程 ID、用量和布尔结果 |

元数据在 `.codex/scratch/worker-interactions/prompt-real-1792140471796/prompt-checks.json`，实际模型核验同目录 `model-contexts.json`。同一线程最终累计 totalTokens=38393，之前轮次用量已包含其中，不重复相加；金额未知。

文件迁移后的完整真实 CLI 复验也通过：`.codex/scratch/worker-interactions/real-1792140471801/interaction-checks.json`，同目录 model-contexts.json 核对主／两 Worker 均为 gpt-6.1-sol / medium。主线程 `01a143e5-702d-7263-b46f-d703caaac8c8` 从旧五工具线程原 ID 恢复；两个 Run 均 succeeded/delivered，ask_main 直接回答、升级用户、待答时无关聊天、原 pid/thread 继续及实际文件内容全部通过。累计主／Worker token 合计 635611，金额未知；原生审批没有重跑，仍明确 nativeVerification=not_run，前述 fixture／真实未触发边界不变。

最终 `npm run check` 构建、类型检查及 **86 项本地测试全部通过**（包含本任务 31 项交互、7 项提示词检查及同期其他任务的测试），记录 `.codex/scratch/worker-interactions/prompt-full-check.txt`。第一次全量检查恰逢并行 Web 测试已写而其源码尚未齐备，typecheck 失败记录保留在 prompt-full-check-incomplete-web.txt；未改该任务代码，文件齐备后重跑通过。两个真实测试自己的数据库 integrity=ok、lease=0、活跃 Run／待答=0、锁已释放，元数据为 prompt-runtime-hygiene.json；未中断日常运行实例。

本轮是提示词文件化与加载／恢复机制，**没有实现完整自进化**。主 Agent 收到规则内容但无项目提示词读写工具，Worker 仍只能操作绑定材料及本 Run 成果；编辑规则不能改变宿主能力。今后的受控修改、权限、验证及失败恢复需要独立实现。后续追加任务应直接维护上述 Markdown，不把长规则重新放回 src/prompts.ts 或工具模块；必须沿用本节启动快照与第 12 节的待答失效规则。


## 开发版自动升级与日常接管（2026-10-16）

已实现并实际运行稳定 Node 启动器，不要求开发时手工关闭重启。`npm run dev -- --config .codex/private/local-chatgpt.config.json` 监听受支持的源码／外置提示词／配置，构建隔离候选，等待主轮、Worker、审阅、待答和交付全部排空再交接。忙时旧版继续接待，交接输入留在稳定启动器；旧进程确认退出释放唯一锁后，新版恢复原 mainThread。候选失败继续旧版，启动失败恢复原构建，不重放不确定请求。范围、官方选型资料、启动方式与限制见 [开发版自动升级](09-development-upgrade.md)。

| 核验 | 实际观察与证据 |
| --- | --- |
| 红绿行为 | `.codex/scratch/dev-upgrade/red-service.txt` 先因缺少安全边界失败，再实现通过；`red-lock.txt` 先复现活 PID 身份不符会被误接管，再修复通过 |
| 全检查 | 最终 `npm run check` 构建、源码／测试／真实 TS 脚本类型检查及 **86 项离线检查通过**；`.codex/scratch/dev-upgrade/full-check.txt`。期间并发模块尚未写完时曾类型检查失败，未据此改动或删除他人测试；整合后重新全过 |
| 真实进程、离线模型 | `.codex/scratch/dev-upgrade/e2e-54a7UJ/verified-checks.json`；真正的独立 Homer、合成 App Server、SQLite 和锁。忙碌 Worker／主轮延后，旧 Worker 交付后换版；旧宿主退出、新引擎仍在恢复的空档发送 8 条输入，逐条恰好处理一次；原线程、既有请求和成果记录完整；坏构建／导入／启动回退、连续变更合并、第二所有者拒绝、依赖／工具／数据库阻断、生成目录排除、启动交接期间退出和 6 个引擎进程清理均通过 |
| 待答 | 服务交互测试在两个原 Worker 等用户、以及仅剩一个待答时均核验 upgradeStatus.safe=false；当场回复后原 Worker 完成交付，safe=true。未声称待答跨进程恢复 |
| 真实模型自动升级 | `.codex/scratch/dev-upgrade/real-vRGMjs/real-upgrade-checks.json`，固定官方 Codex 0.163.0、本机现有订阅、gpt-6.1-sol / medium；独立合成工作区和 private runtime。两轮真实请求，外置 main.md 变更自动换版 **97369188be97 → e4dc2e7f4324**，原 mainThread 相同且暗号回忆正确，退出无 CLI 锁、无引擎租约，integrity_check=ok。没有保存对话正文，金额未取得；此前旧提示词形态的独立两轮也通过，未无限重试模型 |
| 日常原 Terminal | 窗口 7325、/dev/ttys000。确认原 PID 98599、原锁、请求和任务均空闲，私密备份 SQLite 与配置后仅在原标签页输入 `/quit`，确认退出，再启动 dev。原 **9 条请求**逐行 hash 相同，事项与 Run 均仍为 0，原 mainThread 不变；没有给日常对话追加模型测试。`.codex/scratch/dev-upgrade/daily-terminal-checks.json` |
| 日常自动生效 | 同一个稳定启动器 PID 36170 不变，源码修正触发 **3f5975a99618 → 875ee5c0d54e** 自动生效；旧宿主 36188 与旧引擎 36196 已退出，新宿主 38708／引擎 38752 存活，Terminal 明示版本、6.1-sol / medium 和原对话恢复；原记录仍不变。`daily-automatic-handoff-checks.json`。这是已生效版本，非仅排队候选 |

接管核验另外暴露原锁的 locale 差异：旧 Terminal 保存中文 ps 日期，工具环境读到英文日期。新进程身份固定 C locale；活 PID 的锁或租约身份不符／未知时拒绝接管，不删除活锁、不终止未知进程。确认旧进程身份时使用其已观察的中文格式，随后让其正常退出。没有修改全局 locale、Codex/Cindy 配置、账号、代理或模型选择，没有创建 Git／提交／部署。

限制仍明确：只在空闲安全边界升级；运行中 Worker 不迁移，待答不重启；主引擎损坏时保守阻止自动换版，需明确恢复。启动器自身崩溃不保证内存待交接输入持久化；不确定请求不自动重派。依赖、已知数据库实现、工具契约或账号／runtime 边界变化阻断切换，未做通用迁移。未重复完整 OS 沙箱测试，不代表无限上下文或所有模型任务质量保证。轻量服务端版本发布只列未来待办，未实现、未部署；并发开发的其他入口不属于本 CLI 升级验收范围。

## 记忆系统候选（2026-10-16）

该自建记忆候选已经退役，其旧工具、管理入口和数据兼容不再提供。现采用 Codex 原生记忆，当前源码边界和原生接入历史证据见 [原生记忆说明](26-native-memory-feasibility.md)；旧 M0 验收不自动覆盖原生记忆效果。
