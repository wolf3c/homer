# 固定旧构建的回退启动器

2026-10-17回退准备阶段记录。已实现维护工具，提供经离线进程验证的0254回退入口，不要求先找回驻留内存中的精确launcher源码；也不声称新工具就是原launcher。后续已获正式维护授权并启用新版，见[日常环境已更新](20-daily-environment-activation.md)；原0254回退清单已基于新维护点重新准备，固定旧入口没有在日常运行。以下“未切换”均描述准备阶段，恢复限制继续适用。

## 旧入口审阅

审阅45份备份/fixture的入口、配套dev-build/dev-inspect/dev-host、package/lock、创建/修改时间和已有历史manifest。完整hash及路径在`.codex/scratch/rollback-entry-review/old-launcher-provenance-review.json`，未读取账号或对话正文。

| 留存 | 实际结论 |
| --- | --- |
| memory-system/before | dev.mjs为feef1c8f9597，配套host源码与0254相同；该局部备份没有package/lock或dist。 |
| assistant-ui/web-dev-28Gvq7、wechat-integration/host-X3nqNN等 | 同一feef入口，host源码和package/lock与实际0254构建逐字节相同，配套build/inspect在盘。可作为协议与依赖来源证据。 |
| recursive shared-before | 入口1ae0e4cba50可追到memory历史manifest，host已不同于0254，且部分配套文件缺失。 |
| seamless-update/before | 入口45c442a47f0e可追到原293项冻结manifest，host已是后续版本。 |
| dev-upgrade/real-vRGMjs | 更早的入口7b5eb7490634，缺少完整Web/渠道IPC，host和依赖不同。 |

实际0254构建没有scripts。上述入口都调用buildCandidate/sourceSnapshot，会构建并观察源码，直接重启它们不能保证固定0254。文件出生/修改时间只是文件系统证据，不是进程当时载入内容的证明；没有启动时launcher hash，因此无法证明与驻留源码完全一致。该不确定性不再作为无限等待条件，采用下面明确的新回退入口。

## 固定构建契约

[pinned-rollback.mjs](../scripts/pinned-rollback.mjs)的`prepare`只读指定构建、原配置与明确的SQLite快照，生成0600审阅清单，不调用loadConfig、不构造Homer/引擎/渠道，也不复制auth或Keychain。清单记录Node版本、构建文件hash、实际安装的运行依赖及其递归文件指纹/lock版本、配置hash、原schema/关键meta、未知发送原行hash；不包含正文、密文、账号token或配置内容。

`run`核对同一清单和配置后，直接fork固定目录的`dist/dev-host.js`，不调用构建器、不监听源码、不发送prepare切版、不自动重启。原host继续独持SQLite、runtime锁、同一主thread和原引擎/渠道生命周期。Web静态资源、服务及API全部来自这一旧构建，不混用新UI；回退后的功能属于0254，不能宣称记忆/递归/队列新版仍可使用。此模式暂停自动更新，后续更新需另一次受控切换。

启动前严格拒绝：构建/运行依赖/配置/Node或工作目录不匹配、显式HOMER配置环境覆盖、原workspace/materials/outputs缺失或路径被换成symlink、runtime或gateway锁存在、主thread/关键meta/schema不符、原未知行被改、未处理租约/主请求/Worker/待答/待交付/在飞发送，以及gateway仍有pending传输。拒绝阶段不fork，不补建素材/成果目录，不删除锁、不清理租约或改业务事实。持久静止wechat uncertain原样保留；它不等于活跃发送。

prepare与run都明确检查已审记忆/递归schema版本1及对应owner是否随构建存在。0254不含这些owner，不能通过给迁移新库重新制作清单绕过拒绝；未来版本999也拒绝。实际已迁移的日常离线副本以0254 prepare时返回`pinned_schema_unsupported`，没有生成可运行清单。准备清单仍要求维护者审阅选定快照和构建，不是推断任意未知DDL兼容的工具。

清单不是数据库备份，也不证明当前库适合降级。迁移后的库必须按[维护点回退边界](18-daily-migration-preview.md)处理；本工具不覆盖数据库、不执行down migration、不重发未知记录。若新版已经采用输入、执行或产生发送副作用，禁止恢复旧快照盲回放。维护期间必须排除其他launcher/迁移者；原child的原子runtime锁仍是最终单owner门槛。

## 准备与维护启用

在项目根执行，清单父目录应为已核实的私有0700目录。以下参数均由维护者指定，不扫描账号、主线程存储或其他项目：

```sh
node --disable-warning=ExperimentalWarning scripts/pinned-rollback.mjs prepare \
  --build <明确旧构建目录> --config <原配置JSON> \
  --snapshot <明确维护点SQLite快照> --thread <原主thread> \
  --manifest <私有目录/旧构建清单.json>
```

已对实际0254构建和原在线一致备份执行prepare：固定64份构建文件、88个运行依赖和6条未知行；私有清单0600/目录0700。对当前日常仅调用只读verify，按预期拒绝`pinned_runtime_lock_present`，没有调用run。这份在线预演清单用于审阅；正式切换应在已获维护授权、原进程正常关闭且锁释放后，基于新的维护点重新准备清单，不能覆盖后来新增的日常数据。

获得维护授权并完成docs18的当前owner/请求核对、正常退出、同维护点备份/副本预演后，选择以下显式入口；本轮未对日常执行：

```sh
node --disable-warning=ExperimentalWarning scripts/pinned-rollback.mjs run \
  --manifest <已审清单.json> --config <原配置JSON> --port <原Web端口>
```

CLI使用JSONL输入，例如`{"requestId":"明确稳定ID","text":"本条消息"}`。与Web提交同走旧host的`web/submit`，只在原history幂等持久接收后返回accepted；该回执不表示模型已采用。重复ID/相同内容返回fresh=false，冲突拒绝；超时或断连为未确认，不自动重试。调用者保留同一ID用于核对。启动未ready时拒绝输入，没有内存accepted或第二inbox。

正常SIGINT/SIGTERM发送原stop IPC，等待真实child退出再结束；不强杀或凭锁猜测关闭。CLI EOF等待已发接收RPC，再走原eof；Web模式不因stdin结束而停止。child失败只非零退出，不重建thread或重放请求。20秒未ready会报告`pinned_start_unconfirmed`并请求停止，但在旧owner退出未确认时仍等待，不把超时等同已释放。

## 验证与限制

0254的Homer构造器已有factory注入，但旧dev-host未传factory并会恢复渠道。测试专用`pinned-synthetic-preload.mjs`用Node加载钩子仅替换host的服务构造入口、版本探测及渠道桥：真实旧Homer/Store/锁/主输入/host IPC保留，注入合成EngineLike与空渠道；旧dist逐字节不改。codexBin=/usr/bin/false、独立空home，禁外部fetch，不读auth/Keychain，不创建真实Codex线程。产品CLI不提供测试替换参数。

实际0254 host和当前编译host均已通过5项进程用例：同thread、CLI/Web重复ID与冲突、重启后去重、原锁获取/关闭释放、固定HTTP资源、EOF行为、锁/schema/thread/config/构建拒绝、未知租约/gateway pending拒绝、合成启动失败非零退出、child SIGKILL后无自动重启且保留锁。所有合成child均已关闭。真实模型resume、账号恢复、手机收发和日常维护切换未执行；不能用合成注入宣称真实引擎已验。

微信message_id-only兼容与固定失败阶段诊断已在上一308项冻结实际完成，见[微信契约与证据](11-wechat-integration.md)，本项没有改回执修复、六条事实或数据owner。全量检查与本轮冻结指纹记录在`.codex/scratch/rollback-entry-review/`；旧293/301/305/308批次分别保留。

最终`npm run check`构建/类型检查及313/313通过，exit0、signal=null、检查期间源码无变化；相对此前308新增5项。实际不可变0254 host的同一5项亦通过，完整日志`actual-0254-frozen-green.tap`。之后只补本文实测结果，没有产品代码变更。313全量使用当前编译host，实际0254进程证据单独计数，不能混称313项都运行于旧0254。

固定0254会保留其原始回执判定，包含已知的缺省ret误判；它不包含新源码中的回执修复。新版修复须随受控新版启用才生效，回退旧代码也会恢复旧行为。回退入口提供可用性保障，不是旧六条unknown的自动修复，也不代表新版能力已上线。

## 本地开发免配对候选的入口变化

采用包含免配对修改的新完整版本后，pinned launcher 的 ready 回执仅提供原 url 等信息，不再提供 connectionFile；直接打开该 loopback 根地址。已有旧书签 `/connect#...` 只回根并清除 fragment，不再兑换凭据。只改变 Web 入口，不增加 pinned 原来没有的队列或能力功能，不修改 pin/数据库/thread/hash 预检。

回退到旧受保护版本时须连同原 launcher、gateway 和 UI 一起正常回退，保持同一 runtime/数据库/主线程，使用该旧入口本次生成的新连接文件。不得覆盖业务数据库、复用旧 token 或修改密封 manifest 来绕过回退预检。此处不重新确认日常部署状态；当前入口实现见[网关源码](../scripts/dev.mjs)（详细实施流水仅在本地保留）。

当前固定构建入口的 `--port` 需要宿主声明状态失效协议 1 和分页历史协议 3。缺少任一声明会在 Web 就绪前返回对应的 `state_invalidation_protocol_required` 或 `history_protocol_required`。旧构建需要 Web 时使用对应的历史启动器。无 `--port` 的 JSONL 入口仍按原有资料、线程和回执契约校验。

回退清单的资料格式指纹包含表、视图、触发器和唯一性约束。首次读取分页时建立的普通查询索引不改变该指纹。由旧版启动器生成的清单继续用对应启动器，当前入口用已核对的快照重新生成清单。
