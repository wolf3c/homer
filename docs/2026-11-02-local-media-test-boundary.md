# 默认测试与本地媒体工具集成的边界

2026-11-02，Asia/Shanghai。本轮按用户确认范围拆分全部可选本地媒体工具测试；不安装工具、不访问真实模型，不操作日常 Homer。产品 `src/`、媒体能力判定、工具查找路径、数据和安装配置均未修改。

后续默认核心与其他专项已继续分开，当前入口以[测试边界](testing.md)为准。以下实测结果保留当时环境和范围，不因重新分类变成通过。

## 入口与结果含义

此前默认 `scripts/test.mjs` 收集所有顶层源码测试，导致本地 Whisper、FFmpeg 和 Python 文档读取集成与协议/宿主测试混在一起。Whisper 缺失是环境缺项，不应通过取消真实识别断言掩盖，也不应由默认测试的通过推导媒体验收成功。

| 入口 | 范围 | 结果含义 |
| --- | --- | --- |
| `npm test` | 默认核心回归，不收集媒体及其他显式专项，当前完整分类见测试边界 | 启动时明确输出本地媒体 `not run / unverified` 及独立命令；默认通过不证明媒体能力通过 |
| `npm run test:local-media` | 所有顶层 `*.local-media.test.ts/mjs`，实际调用本地工具并验证结果 | 工具缺失、识别不准确或其他断言失败都保持非零退出，并输出验收仍未验证；无自动安装、探测后跳过或成功替身 |
| `npm run test:desktop:acceptance` | 原有显式桌面包验收 | 原包路径、模块及引擎前提检查保持 |

`npm run check` 仍是构建、类型检查和默认测试，不能替代本地媒体专项。媒体拆分当时，默认测试还包含编译产物、固定引擎和浏览器要求；后续职责拆分已将这些实际环境验收移到显式专项，不能将当时前提当作当前默认要求。未运行或未通过的专项须分别记录；不能把两套结果合并成“全部验收通过”。

本地媒体专项的环境前提：FFmpeg/ffprobe，项目媒体 Python 环境及固定文档读取库，macOS `say` 和已有语音，`whisper-cli` 与 `ggml-base.bin`。具体位置沿用产品代码中的工具查找规则，专项范围与前提见[测试说明](testing.md)，没有额外引入一套工具配置。

## 用例归属及断言保留

| 独立文件（tests/ 下） | 数量 | 实际依赖与覆盖 |
| --- | ---: | --- |
| `media-audio.local-media.test.ts` | 2 | say→SILK→WAV→Whisper 真实识别；原始编码拒绝路径也先依赖 FFmpeg |
| `media-documents.local-media.test.ts` | 3 | Python 读取 UTF-16、PDF/Office；加密、扫描空正文、宏和压缩包限制 |
| `media-video.local-media.test.ts` | 1 | FFmpeg/ffprobe 解码、六帧和缩略图、覆盖范围、取消 |
| `media-thumbnail.local-media.test.ts` | 6 | 实际图片解码、尺寸、元数据、压缩扩张、动画首帧及拒绝边界 |
| `tool-image-budget.local-media.test.ts` | 2 | 实际解码后 MCP 图片大小、源像素、授权失效和取消 |
| `draft-image-preview.local-media.test.ts` | 1 | 实际图片上传、原草稿/来源预览授权 |
| `ilink-host.local-media.test.ts` | 3 | 微信图片 FIFO、保留附件执行及原始尺寸输入 |
| `web-upload-host.local-media.test.ts` | 1 | 实际上传图片、原始尺寸和候选成果检查 |
| `web-service.local-media.test.ts` | 3 | 图片区域、多区域及混合来源集合，原字节和授权核对 |
| `native-execution-recovery.local-media.test.ts` | 2 | 带图片恢复及取消恢复、原生输入身份 |

默认保留纯 UTF-8 读取、非法视频输入拒绝、微信撤销/下载失败、普通上传、协议、鉴权、持久化和恢复等不启动可选媒体工具的检查。原 collection 测试拆为默认 text/web 验证和专项真实图片验证，共用原校验逻辑；不能因没有 FFmpeg 就省掉图片分支。

受影响原文件中的 60 个案例拆为 62 个：24 个专项、38 个默认。两个新增案例来自 UTF-8/UTF-16 与 text/web/image 的明确拆分；原有 355 个 assert 调用表达式逐条 AST 核对均保留。新增 3 个明确 FFmpeg 前提断言，替换迁移图片案例原有的 skip、静默 return 或条件执行。Whisper 仍要求识别出 `purple` 和原数字模式，未改成仅检查文件或程序存在。

为保留混合文件中的默认检查，仅提取四个测试 fixture 模块；没有添加产品接口或测试运行时的条件注册。四个完全依赖工具的文件整体改名，其余逐案例迁移。测试分类由文件名明确表达，不以本机是否安装工具决定运行哪些案例。

## Review 和验证

独立只读 review 未发现 P1/P2：三类入口互斥、参数转发和退出码保持；空套件明确失败；保留默认的取消/下载失败/UTF-8/非法视频路径在可选工具执行前结束；共享 fixture 没有引入跨案例可变状态。类型检查发现的一个迁移后未使用 import 已删除。

| 验证 | 实际结果 |
| --- | --- |
| 新入口行为红绿检查 | 原脚本 3/3 失败；修改后 3/3 通过，验证实际子进程选取、失败传播、无 skip、空套件拒绝和原桌面前提 |
| 迁移的全部用例和相邻默认案例 | 62 项：61 通过、1 失败、0 跳过 |
| 默认相关案例，禁止启动本地媒体工具 | 38/38 通过，0 跳过 |
| 默认相关案例及入口测试，工具不可见且禁止启动 | 41/41 通过，0 跳过；隔离预加载仅用于验证，不写入产品 |
| 实际 `npm run test:local-media -- --test-reporter=tap` | **24 项：23 通过、1 失败、0 跳过，退出码 1**；唯一失败仍为 `ILINK-AUDIO-01 / media_asr_unavailable` |
| TypeScript、服务与 UI 构建 | 隔离副本通过，采用后主工作区 TypeScript 再次通过；无关的 task-status CSS 生成变化未采用 |

默认完整套件在相同的“可选媒体工具不可见、禁止启动”环境中尝试运行，因磁盘空间不足终止，**不能声明全量通过**。停止前记录到 1648 个顶层 TAP 结果：1630 通过、8 失败、10 个已有条件跳过，没有完整套件结尾。10 个跳过来自原有包/真实连接/固定引擎门槛，不是本轮媒体拆分新增的 skip。

8 个失败的后续证据：

- `desktop-source.test.mjs` 两个失败来自隔离副本遗漏 `.git/refs`，Git 误认外层仓库。修复隔离目录后通过；未改产品源码或断言。
- `web-feedback-host.test.ts`、`web-local-development.test.ts` 明确报 `ENOSPC`，`web-history-loading.test.ts`、`web-history-worker-headers.test.ts` 报数据库/磁盘已满；`web-history-maintenance-contract.test.ts` 同期报数据库未打开。清理本轮可重建的构建副本后，上述文件与 desktop-source 合计 **39/39 通过，0 跳过**，对应原失败中的 7 项均通过。
- `web-dev-host.test.mjs` 的 Web 热更新案例在 120 秒超时，辅助记录含 `dev_build_failed`；尚无足够证据把其根因确定为磁盘不足。因剩余磁盘空间不足以安全再运行大型构建，本轮未复跑，保留未验证状态；不为此修改或放宽超时、断言。

本轮保留迁移前后源码、逐案例映射和检查日志，清理仅限本轮隔离副本的可重建测试输出。没有重跑第二次全量，也未部署、重启或修改日常 Homer 的安装和数据。真实 ASR 仍未通过，本轮没有下载或安装 Whisper。以上是合成材料与本地工具检查，不是手机端、真实模型或桌面安装验收。

证据目录：`.codex/scratch/local-media-suite-20261102-vse6qtrt/`。`before/` 和 `work/` 保存本轮对照，`migration-manifest.json` 保存逐案例旧/新位置和断言计数；其余日志为 `suite-routing-*`、`media-migration-focused`、`media-default-forbidden`、`default-media-unavailable`、`explicit-local-media`、`boundary-typecheck-final`、`boundary-build` 、默认全量部分记录以及 `resource-followup-light` / `resource-followup-web`。采用前逐路径核对主工作区仍与本轮基线一致；30 个修改/新增/移除路径均与已 review 的隔离版本校验一致，未写入无关路径。已有无关 dirty-tree 工作不属于本轮修改。

提交范围说明：上述计数与检查记录来自当时完整工作区，不是单独提交的全量结果。本次提交只收录测试边界及隔离调整；其他未提交功能的新增测试、原生图片能力、打包修复和历史公共指南保持在工作区，待各自功能提交。原已提交用例的断言随归类保留，未重新进行真实工具或完整验收。
