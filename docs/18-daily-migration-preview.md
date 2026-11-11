# 日常数据库迁移预演与未知发送边界

最新维护预演见[已验候选发布](25-verified-candidate-release.md)：迁移脚本现核全部已有用户表及原元数据，包含已有记忆；51个原非meta表保留，四表增量已审阅并上线。以下为此前预演阶段历史。

2026-10-17预演阶段记录。该阶段仅获只读诊断、SQLite一致性备份及离线副本迁移授权，当时未执行日常维护。后续用户明确授权更新已打开环境，已完成新的维护点备份、原库迁移及原Terminal启用，当前结果见[日常环境已更新](20-daily-environment-activation.md)。以下保留预演事实与恢复契约；没有重发、标送达或清空unknown。稳定执行层及忙碌Worker期间业务版本接管仍未实现。

## 实际日常副本结果

通过4780实际监听进程的业务子进程打开文件确认数据库，使用Node SQLite backup从readOnly/query_only连接生成一致性快照，包含已提交WAL；没有分别复制活动main/WAL/SHM来假装一致。原日常owner、库与账号配置不作写入。备份和预演位于Git忽略的`.codex/private/daily-migration-*/`，普通文档不含私人正文、原请求身份或六行明细。

对新建离线副本只调用数据owner：Store、WorkerInteractions、ConversationHistory、MemoryStore、RecursiveTasks.migrate、WechatStore、TelegramStore；没有构造Homer、Engine、渠道实例或Keychain实现，也没有启动轮询/账号恢复。Memory及递归schema版本到1，完整性ok，外键异常0。

原mainThread、全部既有meta值、history/quotes/request hash/source关联、Run/Matter原列、交互/渠道原列逐表hash均相同；6条wechat_outbox uncertain的身份hash及完整行hash逐条相同，没有清正文密文、改state或重发。新增tasks/deliveries/memory_entries/memory_jobs均0：预演没有从旧聊天自动提取记忆，也没有假造任务/交付。该结果不证明真实引擎resume或手机发送成功。

六行非正文关联核对：均为当前binding，均有原owner/inbox和非空context/payload密文；快照时sending0、pending0。其中5条为reply且都有微信、主历史、执行收据；1条为unsupported输入的类型说明，按原源码不创建主历史/执行收据，不能为凑齐六条去补造历史。全部仍为wechat_send_uncertain。快照只证明当时状态，不替代激活前对当前请求的再次核查。

副本目录0700、迁移前/候选/回退SQLite均0600。原日常SQLite为0644，但其runtime与`.codex/private`均0700；本轮只报告，不改变日常权限。离线回退副本与迁移前SQLite字节、旧schema和事实均一致。活动日常在预演后仍可产生新记录，因此这份副本只用于验证，不能拿来覆盖后续日常数据。

另用实际日常0254b6232c85构建的旧Store代码打开独立回退副本，原事实hash相同、仍为6条uncertain；未构造该旧版的Homer/引擎/渠道。此项证明旧数据owner可打开恢复副本，不表示整个旧launcher或真实线程恢复已经验收。

## 静止uncertain与活跃owner

当前源码WechatManagement.canUpgrade原先仅检查扫码状态，未显式检查发送/提交Promise；实际合成send挂起时返回true已RED复现。新增WechatChannel.canUpgrade要求无活跃发送、提交、登录/管理/发布job、secret保存或持久sending行，普通可abort长轮询留给close排空。management同时保留原二维码门槛。

已结束操作且持久为uncertain的outbox不代表活owner，不需要改成sent或删除才能跨受控升级。恢复只领取pending，uncertain原ID/密文/来源保留，后续同事件分片继续被前一个未知分片挡住。六行合成真实SQLite重开验证hash相同、发送调用0。Telegram已有类似的在飞/草稿/提交门槛，本轮不修改其实现。

这不放松RecursiveTasks.safeToUpgrade：未知执行进程、任务操作、递归收据、正式交付或stop关闭结果仍阻断。微信outbox传输未知与模型执行未知是不同事实；不能删除原保护来让升级通过。原日常仍运行旧业务及旧驻留launcher，本次源码修复未自动装入它。

CTO只读复核确认：日常0254的service.upgradeStatus与微信management原本都不检查outbox uncertain，后者只看扫码状态；先前“六条未知需协调”的要求不是自动guard。开发构建的schema边界仍会抛 `dev_schema_change_requires_review`，本轮不删除该保护。

## 预演入口与失败恢复

```sh
node --import tsx scripts/database-migration-preview.ts <明确SQLite快照路径> <新建的.codex/private目录>
```

入口始终readOnly打开输入，SQLite backup后只迁移新目录candidate，拒绝已存在目的目录及private/scratch之外的写入；标准输出只有结果/计数/分类。详细hash对照与副本保留在保护目录。此脚本不提供上线/覆盖原库选项。维护者必须明确授权来源库读取；脚本本身不是额外读取其他项目或私人资料的授权。

失败fixture注入memory metadata写入中断，候选失败而原快照不变；恢复原备份可回到原schema/事实。未来schema999拒绝且原库hash不变。当前迁移按各owner事务提交，不是整个启动链的一个大事务，因此失败候选可能已有前序owner的新增表/列；不能以失败为由直接用旧二进制继续写该候选。应保留失败副本并回到对应一致性备份。没有自动down migration。

## CTO核对后的具体切换顺序

1. 审阅源码/DDL、匹配旧业务构建与新候选的指纹，保留原配置和原mainThread/五工具指纹。单独核对日常当前主请求、队列、Worker、interaction、in-flight渠道及全部租约；静止六条unknown只原样携带，不当作送达或自动重试。仍有活跃或无法确认owner时继续日常，不执行以下步骤。
2. CTO取得维护授权后，先安全关闭原输入/渠道/engine，等待业务child和launcher正常退出、锁释放；不向未知进程发强制终止。该阶段尚未执行，本轮不提供自动重启按钮或持久任务。
3. 停止后重新制作该维护点的SQLite一致性备份、必要workspace成果与传输journal备份；保留匹配旧构建、配置及权限。在线预演副本不能替代此维护点。若凭据仍在Keychain，保留原引用，不复制/清理账号；六条密文留原库，不解密尝试重发。
4. 对维护点副本再次预演同一候选，核对原thread/history/hash/source/六行hash、完整性及权限，然后由CTO执行受控迁移及launcher启动。候选不得先对外接收/执行，再用旧库回滚。新主thread恢复失败或活锁未知时停在可诊断状态，不另建thread冒充恢复。
5. 新候选ready前且未产生新业务接收/执行/渠道副作用时，安全关闭候选并确认锁释放，可用同一维护点完整备份与匹配旧二进制回退。若新版本已采用任何输入、任务或发送，禁止恢复旧快照丢弃新事实；保留当前库、标明未知，按前向修复或经核对的数据恢复处理。

不能假定当前磁盘scripts/dev.mjs就是驻留旧launcher。2026-10-17已审阅45份历史入口，并实现、以实际0254 host加合成引擎验收[固定旧构建回退启动器](19-pinned-rollback-launcher.md)。尚不能证明哪份入口与原驻留源码完全相同，但不再以此作为无限等待门槛；可采用明确、经核验且不自动升级的新回退入口。实际日常仅准备私有清单和只读校验，活锁按预期拒绝，未调用run。维护点及真实切换仍由CTO核对授权后执行。

## 验证与限制

`tests/wechat-upgrade-boundary.test.ts`覆盖活跃发送阻断、静止未知保留、六行重开不重发及后续分片阻断；`tests/database-migration-preview.test.ts`覆盖原事实保持、受保护副本与离线回退、事务失败及未来schema拒绝。原测试断言不放宽。`npm run check`构建/类型检查及**305/305**全通过，exit0、signal=null、检查期间源码无变化；相对此前301项新增4项。完整检查日志与冻结收据位于`.codex/scratch/seamless-migration/`。

UI代码本轮未改；已用最新源码的合成候选在实际浏览器605/1280宽度复查记忆设置打开、页面发送成功、有草稿时发送按钮启用及无横向溢出，截图为`current-candidate-memory/composer-*.png`。跨更新流式/SSE故障恢复证据仍属于前一301项界面冻结批次。唯一保留合成入口为<http://127.0.0.1:4791/>，无模型/账号/外发，与日常库副本也不相连。未执行的日常切换、真实引擎resume与手机送达仍为未验，不以副本预演代替。

305项冻结后的回执兼容增量见[微信接入](11-wechat-integration.md)：接受省略ret但具有合法服务端message_id的成功回执，仍保留未知/拒绝边界并增加脱敏阶段诊断。最终全检查308/308；数据owner、迁移脚本、schema/依赖/五工具/UI/launcher未改，上述离线迁移和旧Store回退证据仍适用，没有重复操作日常迁移。只读复查六条原行hash与在线备份文件hash保持，日常进程身份相同；没有原服务端回执，不能断言六条就是此次潜在误判。4791演示保留305项冻结版，本次回执修复以当前源码、编译产物和fake fetch子进程验收；演示没有微信渠道，不能用其冒充手机回执验收。
