# 自由执行候选的最终审阅与维护采用

2026-10-19。本轮是对已完成隔离候选的独立审阅与采用准备；不实现主 Agent 工作循环需求，不创建 Git。原候选报告及其回执保留历史事实，本记录只补充此次审阅结论和维护边界。实际是否已采用、准确版本和现场观察以本轮 `.codex/scratch/final-adoption-review-20261019/` 的脱敏回执为准。

## 实质源码审阅

逐项检查原92项差异，追踪实际owner、caller和失败路径；清单见本轮 `source-review-ledger.json`。检查涵盖原生引擎权限、主/Worker审批归属、HTTP认证和浏览器草稿、可信构建和工具链、schema/cwd、原生指令/记忆、显式文件恢复、发布和回退。测试结果独立记录，不以测试代替审阅。

确认并修正两处阻塞：

- `src/engine.ts` 原来的原生root=write未保护用户可写的Node与Codex安装。沿现有profile将真实Node、Codex和实际平台包设为read；`src/service.ts` 的原生授权与file_checkpoint复用同一非write路径，防宿主文件恢复越过边界。未修改全局安装、真实执行文件、权限模式或宿主防护。在APFS隔离镜像，用真实Codex sandbox验证main/Worker原先能打开执行文件写入，修正后执行文件和包目录改名都被拒绝，普通项目写入仍成功；原文件哈希未变。
- `src/main-native-approvals.ts` 原先丢弃caller传入的historyThreadId，将Worker决定写入Worker历史；修正保存及读取，决定回调仍归真实Worker。行为测试先失败后通过。

另修能力页两段过时文字，使之对应当前原生文件/网络能力；不新增交互。执行文件真实路径检查使一份不存在路径的测试夹具失效，改用实际存在的惰性执行文件。三份Telegram夹具补齐临时父目录创建；独立空目录复现ENOENT后通过，未改生产超时或业务断言。

## 保留身份的兼容边界

日常固定Codex主thread确有历史Homer自定义base。固定源码的优先顺序是配置base、历史base、原生模板，当前没有受支持的同thread清空入口。继续原thread和历史时，新的developerInstructions与旧base并存，不能声称旧base已清空；不修改rollout或原生数据库，不另建thread冒充迁移。

现有主thread的原生memory_mode为disabled，来自旧host的显式覆盖。候选移除后续强制覆盖，但不会悄悄改历史thread元数据。既有note和记忆事实保留，不把generate默认值等同旧主thread提取已开启。这些限制要随准确版本一起交给真实用户确认；真实模型验收另外记录。

## 迁移与准确文件合并

维护源不是Git项目。只按本轮准确文件清单复制、删除，不能宣称Git merge。采用前重新核对维护源的并发编辑，保留prompts/main.md、prompts/worker.md的用户原则（只删旧记忆占位符）和docs/README.md已有内容。独立工作循环需求及其技术方案不在合并清单内；维护源中的并发更新原样保留，候选旧参考副本不覆盖维护源。

首次预演使用SQLite backup API，从只读活连接取得含WAL已提交事实的一致副本；备份仅置于权限受限且被忽略的`.codex/private`。副本schema1→2后，57表原列行全部一致，memory schema保持1，integrity_check通过且无外键错误。活库未据此自动迁移，维护窗口仍须重新快照。

## 启动、验收和恢复

实际日常入口是`scripts/dev.mjs --web`。旧dev watcher仍在时，不把可信代码复制到维护源，防准备期间意外采用。首次新gateway启动前，必须通过正常用户交互取得准确源码版本的真实审阅确认；旧gateway缺新审阅页不构成代点、写批准标记或先启动未审新host的理由。

维护时先确认主轮、Worker、输入、待答、审批和外发安全；六条历史已结束uncertain不得删除或当作活跃任务。只优雅停止核对过的日常launcher，保留原Terminal入口，不操作其他用户进程。新gateway用本机私有一次性connect-homer.html重新连接，使用原浏览器标签页保留sessionStorage草稿，不提取令牌，不复制账号或凭据。

真实模型验收计划复用合法本人连接及原主thread，在隔离源码副本由main派Worker完成一个可回退的提示词标记修改和聚焦测试，main检查并验收，等待安全空闲采用，再通过主Agent所属file_checkpoint恢复并核对版本。标记不进入最终维护源码。不把scripted Responses或合成闭环称为真实模型成功。若旧base或实际连接导致失败，保留真实失败，不替换身份掩盖。

精确合并只在旧维护watcher停下后进行；采用后核对正在服务的source/build清单、主thread、原有业务事实、后台派工、管理认证、浏览器草稿和原渠道。固定UI入口的两项测试缺sealed reference而跳过，此次不使用该入口，也不作为回退路径。

准备、编译或启动失败时恢复/保留原可用服务。schema2生效后禁止旧schema1二进制写库。若还没有新业务事实，须先证明这一点才可恢复一致旧快照；已有新事实或未知外部结果时保留新库，使用已核验且支持schema2的构建前向恢复和对账，绝不以旧库覆盖新历史。显式文件checkpoint只恢复其文件集，不逆转安装、外发、数据库或任意外部副作用。
