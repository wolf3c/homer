# Telegram Bot 接入方案

更新／官方资料核查日期：2026-10-16。状态：**用户已授权实施；Telegram 渠道与同实例共享宿主已接合，相关合成回归、服务构建及类型检查通过；未连接真实 Bot**。第 14 节记录实施事实与交接契约，前文未标为已完成的内容仍是验收目标。

## 1. 推荐结论与完成边界

首版采用**用户自建单 Bot、单 owner、普通私聊、本机单一 Homer 常驻服务、官方云端 Bot API `getUpdates` 长轮询**。Telegram 与 CLI 共用该服务、同一产品主会话和原 Codex 主线程；主消息串行，独立 Worker 并行。手机交办后立即收到接收确认，随后收到回复、实际成果文件或待答请求；用户的回答回到原 Worker。

用户追加明确要求：**原生草稿流式（含思考中）、原生停止生成、表格／代码／公式／折叠富消息均为首版必须**，覆盖此前的少量通知／纯文本优先建议。Telegram 只直接承接主 Agent 的用户可见内容；Worker 的进度、成果、问题先由主 Agent 处理并表达，宿主仍以可信来源决定投递入口。**不做 Bot 间通信，不创建 Worker Bot，也不把它列为后续依赖**；内部 Worker 编排继续由 Homer 服务负责。

需求来源：CTO 转述用户原话「现在我们想要接入 telegram bot，请整理方案」，并给出跨入口持续对话、自己掌握历史和主 Agent 在既有自主范围内处理 Worker 问题的约束。单用户需求证据为 E1，不推断市场规模或使用频率。当前 CLI 是替代入口；本方案验证手机交办、收成果、协助原任务的价值，实际体验仍是待验证假设。

| 首版必须包含 | 后续另行安排 |
| --- | --- |
| 安全配对、稳定 owner ID 校验、文本收发、去重与断线重连 | 群聊／频道、私聊 topics、多 owner、统一官方多租户 Bot |
| 同一主对话、原入口回传、CLI 同服务、持久收发与可查询历史 | 语音转写、图片理解、用户上传附件作为材料、Mini App |
| 长回复、长任务回推、核验后上传现有 Markdown 成果 | 任意文件／电脑操作能力、公共下载站、Local Bot API Server |
| `sendMessageDraft`／`sendRichMessageDraft` 真实流式、思考中、最终正式发送并持久保存 | 流式图片／相册及任意媒体富消息 |
| 原生停止本次主回复生成；表格、代码、公式、可折叠内容 | 地图／相册等未要求的富媒体块 |
| Worker 授权／问题的按钮与自然语言往返、停止指定 Run | 云部署、自动开机启动、商业计费、无限上下文与任意工具断点续跑 |

最小完整验收：绑定本人 → 手机发文本 → 主 Agent 显示思考中及真实增量 → 原生按钮可停止该回复 → 同一主 Agent 可继续派发 → Worker 必要问题由主 Agent 转问 → 回答恢复原 Worker → 核验成果 → 原私聊收到正式持久富消息及可打开的 `.md` 文件；期间 CLI 能续聊、查询和停止指定 Run。四类富内容和原生停止必须分别验收，普通通知、纯文本降级或最终文本重播均不能替代。

## 2. 已有能力与本次设计的新增部分

本节按 2026-10-16 当前落盘源码更新；首轮调查时缺少的稳定宿主、可见增量及产品历史已由相关任务补入，不能继续把早期快照当当前事实。运行方式见 [运行说明](06-running-homer.md)，本任务实际验收边界见第 14 节。

| 当前事实与证据 | Telegram 对接边界 |
| --- | --- |
| [dev.mjs](../scripts/dev.mjs) 稳定 launcher 经 IPC 管理 [dev-host.ts](../src/dev-host.ts) 中唯一 Homer；既有 standalone [cli.ts](../src/cli.ts) 仍存在 | Telegram 挂到稳定宿主，不每条启动 CLI，不另建 daemon；不能让 standalone 与稳定宿主竞争同一 runtime |
| [service.ts](../src/service.ts) 有主串行队列、并行 Worker、submitMessage 原子接受及 main_start／delta／main_terminal | 可信来源接受回执与 inbox 同事务；只有真实用户主轮原生流式，后台审阅与 Worker 不冒充主轮 |
| [engine.ts](../src/engine.ts) 输出主 Agent 可见文本增量，核心提供精确 stopMain；[web-history.ts](../src/web-history.ts) 保存输入与可见回复 | 不用最终文本回放；内部推理、工具参数不出渠道；真实终态与停止请求 ACK 分开，未确认关闭不能伪装已结束 |
| [store.ts](../src/store.ts) 管理任务及原 mainThread；ConversationHistory 保存产品输入／回复 | 新 tg_ 表只保存渠道接收、路由、草稿、发件及交互账本；产品历史不另造一份，完整导出／上下文重建不在此任务宣称完成 |
| 原 mainThread 和主工具兼容仍归核心 | 不为 Telegram、重启或升级静默创建替代线程；工具迁移未完成时明确失败，不自动清空历史 |
| [worker-interactions.ts](../src/worker-interactions.ts) 的待答及主工具已经可接 | 本任务以真实业务类＋合成引擎验证原 Worker 往返；不将其视为真实模型／手机端已验收，也不扩展运行中追加能力 |
| [files.ts](../src/files.ts) 校验 Run 成果路径、普通文件、链接和大小，当前 `.md` 最大 128 KiB | 上传复核后的真实 bytes；Telegram 的较大文件上限不扩大 Worker 权限 |
| 固定 Codex 0.163.0、gpt-6.1-sol / medium、本机订阅 | 不改模型、账号、代理、Codex Home，不假定订阅适合多租户 |

无项目本地 AGENTS.md，沿用任务提供的全局规则；本地设置页遵循已阅读的 [ui/DESIGN.md](../ui/DESIGN.md) 与现有界面颜色／排版。本任务不修改品牌或 ui/，也未操作日常进程。

## 3. 会话、顺序与回复归属

```text
Telegram 私聊 → 身份校验／持久收件 ─┐
                                   ├→ 同一个 Homer 服务 → 同一主 Agent 串行队列
CLI 客户端 → 本地 IPC／持久输入 ────┘                     ├→ 多个独立 Worker
                                                        └→ 待答／成果／回复事件
                                  原入口路由 ← 持久发件箱 ←┘
```

| 标识 | 含义与使用规则 |
| --- | --- |
| Telegram `User.id` | owner 身份；校验 `message.from.id` 或 `callback_query.from.id`，不以用户名、昵称、转发来源认人 |
| Telegram `Chat.id` | 发送目标；绑定明确普通私聊，仍单独保存并校验，不能用来代替身份判断 |
| `botId` / `bindingVersion` | `getMe` 返回的 Bot 身份／本地配对代次；解绑或换 owner 后旧事件、按钮不得复活 |
| `update_id` / `message_id` | 前者对单 Bot 的收件去重；后者仅在 chat 内标识消息，引用需同时带 chat |
| `conversationId` | 渠道保存的 Homer 主会话引用；当前以既有 mainThread 锚定同一会话，不按 chat 创建新的模型线程 |
| `requestId` / Matter / Run | 输入请求／工作目标／一次独立执行；一条输入可产生多个 Run，沿用 sourceRequestId 路由 |
| `generationId` / Telegram `draft_id` | 新增主回复生成标识／非零草稿标识；不等于 Run 或正式 messageId。绑定 bot+chat+thread+bindingVersion+主 thread/turn，停止只指向这一生成 |
| Codex `threadId` / `turnId` | 引擎上下文与轮次；主线程和每个 Worker 各自独立，不等于 Telegram chat 或产品会话 |

Telegram 的 User/Chat ID 可能超出 32 位，官方说明最多 52 个有效位；输入验证为安全整数，持久边界统一十进制字符串，禁止位运算截断。来源：[User](https://core.telegram.org/bots/api#user)、[Chat](https://core.telegram.org/bots/api#chat)，核查 2026-10-16。

- 普通回复回该输入的入口；进度、交付和待答沿 `Run.sourceRequestId → origin` 回最初委托入口。Telegram 用 `reply_parameters` 引用原消息，附事项名／短 Run 标识；原消息删除时可在已绑定私聊发送独立回执，不改投其他 chat。
- CLI 发起的任务默认仍回 CLI 持久收件；Telegram 发起的任务回 Telegram。用户在另一个入口询问可读取同一事实并在询问入口回答；不会自动转移原任务后续回传。首版不默认把全部 CLI 私密对话镜像到 Telegram。
- CLI 断开后结果保留，重连补取；原 Telegram 被屏蔽或解绑则保留未送达状态，可在 CLI 查询，不擅自广播或改投其他身份。
- 同一 Telegram 批次按 update_id 顺序入库；CLI 与 Telegram 按产品库的接收序号汇入一个主队列，不承诺跨设备按用户发出时间全局排序。Worker 完成顺序可以不同，始终按 Run 关联。

借鉴 Cindy 的显式会话绑定和每轮回复目标，但不采用其默认 `telegram_<bot>_<user>` 新会话规则：绑定事务必须指向 Homer 已有主会话和原 mainThread。每个输入／Run 固定自己的 sourceMessageId，不能从「该 chat 最近一条消息」取回复目标。后台完成通过核心事件唤起渠道交付，不要求用户再发消息；Worker 原始工具／后台事件不直接转发，仍由主 Agent 汇总为用户可见结果。实际依据及差异见第 12 节。

同一私聊只展示一个活跃主回复草稿；CLI 普通主轮和 Telegram 主轮仍共用串行队列。Worker 完成／提问先由主 Agent 的内部事件轮组织，再正式回传；当前原生草稿只用于真实用户主轮，内部审阅和 Worker 不产生 main_start／main_terminal，不给每个 Worker 启动一个流。宿主接收确认、停止状态及传输错误可用明确的系统回执；这些不冒称 Worker 发言或模型思考内容。

### 产品历史与模型上下文分别保存

建议把新增的最小产品历史列为首版基础工作：保存**从接入后开始**的 CLI／Telegram 用户正文、可见主回复、交付／待答记录、来源引用及时间，支持本地历史查询与导出；文本仅存一份，收发箱引用它。它是用户业务数据，不是诊断日志，不保存完整 Codex 内部推理、工具参数／结果或供应商响应。

流式草稿不逐帧写成聊天历史；规范最终正文或明确停止后保留的可见部分才写产品历史，generation／草稿表只保存关联与状态。Thinking 是状态展示，不是新增内部推理存储能力。

已有 SQLite 无法回填全部旧聊天；原 Codex 历史继续保留，不自动遍历导入。后续若要导入须单独界定授权与格式。恢复同一个 mainThread 是当前模型连续性的机制；本地历史存在不等于已实现模型上下文装配、跨引擎恢复或无限记忆。遇到历史缺失、线程不匹配或工具迁移未完成，保留指针并明确失败，由兼容迁移任务解决，不能新建空线程冒充延续。

这补充了 [原技术方案的数据归属](03-technical-design.md#3-核心数据归属)：新增的是用户可掌握的产品对话记录，原始引擎轨迹仍由 Codex 管理。历史保存在用户私有 runtime，沿用本地访问边界；实现时补备份／导出说明，不把正文复制到遥测、测试证据或仓库。

## 4. 部署与服务归属

| 方式 | 收益、代价与结论 |
| --- | --- |
| 本机常驻服务 + 出站长轮询 | 无需公网端口、域名或入站 TLS，适合当前本机单用户；Mac 必须开机且能访问 Telegram。**首版推荐** |
| 公网 webhook | 需要稳定 HTTPS 入口、请求真实性校验、重投去重及运维；更适合后续云端。当前不增加隧道或公网部署 |

官方 `getUpdates` 与 webhook 互斥，待收更新最多保留 24 小时；webhook 失败会重试但不是无限保留。来源：[Getting updates](https://core.telegram.org/bots/api#getting-updates)、[setWebhook](https://core.telegram.org/bots/api#setwebhook)，核查 2026-10-16。断网超过保留窗口可能丢失尚未入库消息，恢复时应提示空窗，不宣称历史自动补全。

复用 UI／稳定 launcher 任务正在整合的唯一服务宿主、渠道 bridge 和现有 runtime 锁／SQLite，Telegram 不增加 daemon 或自行启动 Homer。此前的 `homer serve` 与 Unix socket 是原方案的命名／传输建议，**不再另建一套**；CLI／Web／微信／Telegram 的具体本地通路沿宿主最终契约。发现活跃服务时连接它或明确报占用，不再 `new Homer`；没有服务时明确提示启动，不暗中另起实例。宿主须校验本地通路权限、所有者、协议和存活状态，不能只信 socket 文件或浏览器 URL。

一个 Bot 只部署一个更新消费者。现有 runtime 锁阻止同库重复宿主，渠道另有同进程 botId 占用检查；不同 runtime／设备没有可枚举所有 poller 的 Bot API，也没有跨进程全机 botId 锁，不能声称能提前发现全部冲突。连接先 `getMe`、`getWebhookInfo`：非空 webhook URL 只报告「已有 webhook」，不显示可能含秘密的完整 URL、不调用 deleteWebhook；需要迁移时另行明确授权。若轮询报消费者冲突（例如 409），停止该连接并要求定位原消费者，不循环争抢。停止旧设备再启动新设备，禁止同时运行。来源：[getMe](https://core.telegram.org/bots/api#getme)、[getWebhookInfo](https://core.telegram.org/bots/api#getwebhookinfo)、[getUpdates](https://core.telegram.org/bots/api#getupdates)，核查 2026-10-16；跨设备冲突表现还需真实验收。

本机 Homer 服务不同于自建 Local Bot API Server：首版仍调用 Telegram 官方云端 API，不调用 `logOut` 切换 API 服务。个人自建 Bot 与未来「Homer 官方统一 Bot」也分开；后者涉及账号隔离、会话分片、托管凭据与合规／计费，需重新设计，不能让每台客户端轮询同一官方 token。

只诊断既有网络是否可达，不代改系统代理或翻墙配置；Telegram 传输独立验证，Codex 已通不证明 Telegram 已通。先验证前台常驻，再考虑经用户授权的云迁移或自动启动；本次不创建启动任务。

## 5. 下一阶段用户设置与退出语义

以下是后续本人设置流程；已实现入口见第 14.4 节。本任务未索取 token、调用真实 Bot 或执行本流程。

1. 用户在官方 [@BotFather](https://t.me/BotFather) 使用 `/newbot` 创建自己的 Bot，得到 token；可关闭加入群聊，普通私聊 topics 不启用。创建与保密说明：[BotFather](https://core.telegram.org/bots/features#botfather)，核查 2026-10-16。
2. 在现有稳定宿主的可信本地 `/settings/telegram` 密码框输入 token，不使用命令行参数、聊天、截图或 shell 历史。Mac 首版使用系统 Keychain；配置／SQLite 只保存 secret reference 与 botId。若 secret store 不可用，连接失败并说明，不静默回落为明文文件。其他 OS 的 secret store 以后适配。
3. 服务从 secret store 在内存取值，`getMe` 核验 botId 后检查 webhook／本机消费者占用；错误只报稳定代码，清洗异常及包含 token 的 API URL。token 不能进入模型上下文、prompt、日志、诊断回执或仓库。配置引用与 token 更新分开。
4. 本地设置页生成短期、一次性 128 位随机配对码（10 分钟过期）；只在本地显示完整码，库里存摘要、有效期和候选数字 ID。用户打开刚核验的 Bot 私聊并发送 `/start <code>`。收到后要求普通 private、真实 from.id、非 Bot 用户；本地页显示候选数字 User.id／Chat.id 供核对，**本地明确批准后才完成绑定**。码用完作废；陌生人的第一条 `/start` 不能抢绑定，普通消息不触发自动认领。
5. 配对事务写入 ownerId、chatId、conversationId、bindingVersion、boundAt；绑定之前只处理配对，不把任何业务文本交给主 Agent。已有 owner 不得通过新 `/start` 覆盖。产品会话的 ownerRef 在解绑后仍保留，首版仅允许原 owner 重新绑定（可换其自建 Bot）；其他 User.id 必须拒绝，不能继承旧主线程或历史。未来更换主人须另建隔离身份／会话并单独授权迁移。绑定后由本人发送合成测试文本，核对可见回复，确认 owner 能收到；`getMe` 成功不算整个连接验收通过。

未绑定／陌生人消息默认静默拒绝，有限记录拒绝计数；不存陌生人正文，不泄露任务、配对码或身份名单。群聊即使由 owner 发出也不处理，可在设置中说明「仅私聊」，不能依赖 Telegram privacy mode 作为权限边界。

| 操作 | 推荐语义 |
| --- | --- |
| 关闭 CLI 客户端 | 断开显示连接，服务和 Worker 继续；这是新增连接模式，与旧 standalone `/quit` 区分 |
| 停用 Telegram 连接 | 先持久保存明确的 disabled 意图，再停止 poller／sender；保留绑定和 checkpoint；已接收任务继续，结果留在发件箱，CLI 可查；重启仍停用 |
| 停止服务／Mac 关机 | 按已有关闭流程停止任务；异常后对账并标 interrupted，不保证 Worker 跨重启续跑 |
| 重启服务 | 同 runtime 恢复主线程、绑定、收发箱，尊重已保存的 enabled／disabled 意图；secret store 读取错误时不联网、不当成首次配置；过期交互失效；输入按下节对账 |
| 本地解绑 | 停止连接并递增 bindingVersion；撤销旧按钮及未发送路由，删除 secret store 中本连接凭据，保留产品历史和任务，不删除 Bot、不自动撤销整个 Bot token |
| token 泄露／需撤销 | 用户在 BotFather 撤销／重建 token；Homer 隐藏输入更新并核对相同 botId，不把正常断开等同于调用 Bot API logOut |

解绑后的旧任务结果不会自动恢复发送；原 owner 重绑后需明确选择补取，活跃任务依旧可由本地 CLI 管理，若要同时停止须明确操作。旧私聊已发消息仍在 Telegram，不承诺解绑会删除远端历史。

借鉴 Cindy 的配置／账号代次隔离：连接设置、停用、解绑及换 Bot 使运行代次失效并中止旧 poll。每个异步操作捕获 botId／bindingVersion／运行代次，网络发送前、异步完成回写时及交互决策提交前再次核对；只在入队时校验不足以挡住旧连接结果。用户停用意图与瞬时 connecting／error 状态分别保存，不能因网络重试覆盖停用。若切换时已有请求在途，无法撤回 Telegram 已接收的发送，应记录 sent／uncertain，不声称远端撤销；但其回调不得改写新绑定。此规则不允许在服务端身份校验之外只靠取消 AbortController 保证隔离。

头像以后由用户通过 BotFather `/setuserpic`，或另授权受控设置；当前可选品牌素材见 `assets/branding/README.md`。官方当前确有 [setMyProfilePhoto](https://core.telegram.org/bots/api#setmyprofilephoto) 及指定输入类型，但不代表任意格式／路径都可直接设置，也不属于本轮或 MVP 自动步骤。[BotFather 资料设置](https://core.telegram.org/bots/features#edit-bots)，核查 2026-10-16；不改动并行品牌工作。

## 6. 收件、确认与崩溃恢复

显式设置 `allowed_updates=["message","callback_query","stopped_message_generation"]`，建议 `timeout=30` 秒、HTTP 超时略长；单 Bot 一个未完成 poll。官方 limit 范围 1–100；过滤设置不追溯已有更新，因此入口还需拒绝其他类型。群聊、频道、edited_message、business／guest／inline 模式和非文本附件不进入主队列；owner 的不支持附件可得到简短说明，不下载、不交给模型。原生停止走独立控制入口，不能拼成用户正文交给模型。来源：[getUpdates](https://core.telegram.org/bots/api#getupdates)、[Update](https://core.telegram.org/bots/api#update)，核查 2026-10-16。

**先持久接收，再向 Telegram 确认，不等待模型完成。**

1. 用已提交的 `nextOffset` 请求 getUpdates。官方确认发生在**下一次调用传入高于某 update_id 的 offset 时**，不是 HTTP 响应被读取时。
2. 按返回顺序校验 update 类型／身份／chat／当前 bindingVersion。每批在同一 SQLite 事务中插入收件记录（唯一键 botId + updateId）、可信消息历史／待处理输入，或不含陌生人正文的拒绝墓碑；最后把本批已持久处置最高 updateId + 1 保存为 nextOffset。中途写库失败整批回滚，不推进 checkpoint。业务入库与 checkpoint 不能分成两个独立提交。
3. 提交后可发「已收到，稍后回复」的发件事件，并用新 offset 继续收取。主 Agent 从持久输入依次领取；不在 SQLite 事务中等待模型／网络。Telegram 无新更新一周后 update_id 可能随机重置，不能要求标识连续或等待缺号。长空闲重新进入收取时先省略 offset 读取最早未确认项，避免先发旧高 offset 确认掉新随机区间；持续轮询也要在接近一周无更新前进入这一模式。首次返回批次照常事务持久化并重新建立 checkpoint，不用永久 `MAX(offset)`。此边界需要专门 fixture 与实际接口复核，不能把全生命周期递增当成保证。
4. Telegram 请求 ID 使用固定可验证编码，例如 `tg:<botId>:<updateId>`，符合当前 `message()` 的 100 字符限制；持久输入带全局接收序号。重复 update 只读已有状态，不再次调用核心、不再额外发送当前 CLI 式「历史回执」。重复 ID 内容冲突应报稳定安全错误，不输出正文。
5. 输入状态为 queued → processing → completed／interrupted。queued 且确认未交给引擎的记录可在重启后继续；processing 则按既有 requests／Run 对账，无法证明未执行时标 interrupted，提示用户查询后明确重试，不自动重放。核心请求开始记录与领取状态同事务提交；请求完成、最终回复及发件记录同事务提交，消除「请求 completed 但没有可补发回复」的宿主窗口。引擎执行本身不能和 SQLite 原子提交。
6. 原生停止也按 botId+updateId 去重，收件、generation 的条件状态更新及 checkpoint 同事务提交；提交后通知主轮控制器 interrupt。控制通知不排在被阻塞的 mainQueue 后面，恢复时重新核对原 turn 是否仍活跃，绝不停止当前恰好运行的另一个 turn。普通 User.id 校验不能套用到缺少 from 的停止对象，详见第 7 节。

| 崩溃位置 | 恢复结果 |
| --- | --- |
| 收件事务提交前 | Telegram 未获更大 offset；重投后重新处理 |
| 提交后、下次 poll 前 | 可能重投；唯一键命中，不重复入队／派发 |
| 已向 Telegram 确认、业务尚 queued | 依赖本地持久输入恢复；磁盘损坏不能靠 Telegram 重取已确认更新 |
| 主轮或 Worker 执行中 | 沿现有不盲重放原则，保存真实中断状态；原主线程指针保留 |
| 输出已本地保存、尚未发送 | 持久发件箱继续；发送中的不确定窗口见第 7 节 |

不使用负 offset 或 `drop_pending_updates=true` 清空积压。首次绑定忽略早于 boundAt 的业务消息；重连时建议对超过 1 小时的普通文本先保存为 stale，通知 owner 选择是否按原顺序提交，避免离线旧指令突然执行（1 小时是产品默认提案，不是 Telegram 限制）。待答按自身有效期处理，不借批量恢复续期。拒绝记录与 checkpoint 同事务；重新绑定后的旧事件不转给新身份。来源：[Update](https://core.telegram.org/bots/api#update)、[getUpdates](https://core.telegram.org/bots/api#getupdates)，核查 2026-10-16。

## 7. 回复、限流与成果上传

正式输出先持久化再由独立 sender 网络发送，网络断开不占用主队列。每条可见正式事件有固定 eventId，每个分片／文件有独立 outbox 行；同 chat 串行，保留 Telegram messageId、发送状态和下一次可尝试时间。临时草稿另有生命周期，不能按已交付正式消息记账。

### 原生草稿与真实增量（首版必须）

| 场景 | 原生 API 与必须保留的语义 |
| --- | --- |
| 普通文本生成 | [sendMessageDraft](https://core.telegram.org/bots/api#sendmessagedraft)：仅目标 private chat，draft_id 非零，同 ID 更新有动画；text 为解析后 0–4096 characters，空文本显示 Thinking 占位；完成后用完整 [sendMessage](https://core.telegram.org/bots/api#sendmessage) 正式发送 |
| 富消息生成 | [sendRichMessageDraft](https://core.telegram.org/bots/api#sendrichmessagedraft)：同为 private chat，提交完整的当前部分 rich_message；不支持草稿内直接上传新文件／显式 URL 上传；完成后用完整 [sendRichMessage](https://core.telegram.org/bots/api#sendrichmessage) 正式发送并取得 Message |
| 思考中 | 进入真实主轮、尚无可见文字时发送空文本草稿；富消息用 [InputRichBlockThinking](https://core.telegram.org/bots/api#inputrichblockthinking)／`<tg-thinking>`，该 block 仅草稿可用，最终文档必须移除；这里只表达状态，不发送模型内部推理 |
| 寿命／停止选项 | 两种草稿都是 **30 秒临时预览**，成功仅返回 True；`can_stop=true` 显示原生停止，`keep_on_stop=true` 只短暂保留，不会永久存储，Bot 新消息也会使其消失；要保留部分内容仍须正式发送 |

以上均为官方契约，核查 2026-10-16。两种最终发送方法均没有 draft_id 参数，不能声称会把草稿 messageId 原地转正；宿主自行关联 generationId → 最终 eventId → 返回的正式 messageId。正常生成结束时先关闭草稿入口、排空或中止在途草稿，再提交唯一最终事件；最终失败、停止、解绑后迟到增量都不能复活预览。

一轮开始固定 renderMode：默认 rich，明确的普通文本回复用 text；分别使用 rich 草稿／正式富消息或 text 草稿／正式文本，两条路径均须验收。不能依赖同一个 draft_id 跨方法切换的未验证呈现行为；传输降级另记能力失败，不能用于绕过原生流式验收。

输入尚在排队时只发接收回执；取得实际主 turnId 并提交 draft 映射后才显示带 can_stop 的 Thinking 草稿，避免对未启动或已换轮次的执行提供错误停止目标。

前置改造在引擎边界完成：为 EngineLike 增加带 threadId／turnId／itemId、递增序号、可见通道的真实主 Agent 文本增量／快照与终态事件，核对固定 Codex 版本协议后归一化；核心再附 generationId 和可信 origin。只允许主 Agent 面向用户的文字，过滤 reasoning、工具参数／结果、Worker 原始事件与过期 turn。适配器修正／重发事件不得重复拼接；最终规范文本为权威，若与预览不同明确以最终稿取代。**当前源码没有这条增量出口；等 turn 返回后逐字重播不能通过流式验收。**

建议合并增量、同 chat 单一草稿发送队列，初始至多每秒一个快照；活跃但暂时无新字时可约 10 秒刷新当前 Thinking／快照，实际频率可按限流调整，刷新是否持续保留占位须手机实测。官方未在已查方法／FAQ 中给出草稿独立 QPS，不能假设草稿免限流；429 按 retry_after 退避，正式最终发送优先，接收和停止控制不被发送队列阻塞。断网／超时丢弃过时快照，只在原生成仍活跃且绑定有效时补最新版本；不补播全部增量。超出 30 秒导致预览消失是可能的，不能假称离线也持续可见；最终结果仍通过 outbox 恢复。来源：[FAQ 限流](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this)、[ResponseParameters](https://core.telegram.org/bots/api#responseparameters)，核查 2026-10-16；1 秒／10 秒是初始产品策略，不是平台寿命保证。

超长文本草稿显示有标识的受限预览窗口，最终全文按序分片发送；不把草稿裁剪当成最终内容裁剪。正式状态消息可能打断草稿显示，同 chat 的后台通知先合并排队；已持久化的待答卡片／完成结果不得因草稿刷新而丢弃。禁止把长期运行的 Worker 等待伪装成一个无限 Thinking 主轮。

### 原生停止与任务取消分开（首版必须）

1. 订阅 `stopped_message_generation`。官方 [MessageGenerationStopped](https://core.telegram.org/bots/api#messagegenerationstopped) 只有 chat、可选 message_thread_id、draft_id，**没有 from、callback_query.id 或原文**，所以不调用 answerCallbackQuery，也不能虚构用户 ID。仅接受已绑定普通 private chat，精确查 `(botId, chatId, messageThreadId?, draftId)` 对应的原 bindingVersion／generation／主 turn；其中 messageThreadId 是 Telegram topic 标识，首版普通私聊预期为空，不等于 Codex threadId。绑定不匹配、未知、过期或重启已失活草稿一律不触发中断。核查 2026-10-16。
2. draftId 由宿主持久分配非零正整数、每个 Bot 不重复使用，重启／重绑不重置分配器；同 Bot 换设备须连同原 runtime 的计数和映射迁移，不在新空库从头编号。本地可选 32 位有符号正整数范围，耗尽明确失败、不回绕复用，这是分配策略而非额外平台限制。其与 owner／chat／generation 的映射在首次发草稿前入库。停止 update 没有 bindingVersion，必须查旧映射再验证当前绑定，不能给收到的旧事件直接盖上新代次。
3. 合法停止先条件更新 thinking／streaming → stop_requested，立即关闭草稿入口；提交后调用拟新增 `stopMainGeneration(generationId, expectedThreadId, expectedTurnId)` 独立控制入口，interrupt **该主 thread／turn**，等待引擎终态再记 stopped，未确认则 interrupted／stop_unconfirmed。控制器在核对和发中断期间持有该轮生命周期保护，终态结算前不启动下一主轮，避免当前无参数 interrupt 误停后来 turn。停止不是仅隐藏 UI，也不能排在正在生成的主队列后等待。正常中断须从当前 mainTurn 的 mainBroken 异常分支分离：保留原主线程；无法安全确认时明确暂停主轮，不静默新建线程。
4. 原生停止不调用 stopAll／close 整个 Homer，不取消已派发 Worker、不自动拒绝其 pending_user。标记停止后禁止该主轮继续新增派发／决策；在途工具已经形成的任务或决定要对账，不能承诺回滚。用户需要取消具体任务时，另行明确指定 Run 走现有停止流程。可回复「本次回复已停止；已派任务仍在运行」，待答卡片继续有效。
5. 停止与完成用 generation 条件状态竞争，重复 update 至多生效一次。停止先提交时不再发送普通完成稿，可将已见的安全部分正文＋停止标识作为独立正式事件持久保存；没有正文则只发状态。完成稿已在途／已发送时不能撤回，记录真实 sent／uncertain 并告知已完成或停止未赶上，不能改成已取消 Worker。重启只恢复记录及正式 outbox，不恢复旧 draft 或伪造引擎续跑。

### 富消息与成果（首版必须）

输出采用有限的宿主 RenderDocument，经校验映射为 `InputRichMessage.blocks`；每次只能选择 blocks／markdown／html 之一。段落、表格、代码、公式和折叠首版都支持，不把模型生成的任意 HTML／按钮／媒体直接作为可信结构执行。具体对应如下，官方来源及核查日期 2026-10-16：

| 内容 | 官方结构 | 宿主处理与手机验收 |
| --- | --- | --- |
| 表格 | [InputRichBlockTable](https://core.telegram.org/bots/api#inputrichblocktable) | 表头／单元格转 RichText，只支持允许的内联格式；超长按行分页保留表头，不切断单元格；手机检查横向可读性 |
| 代码 | [InputRichBlockPreformatted](https://core.telegram.org/bots/api#inputrichblockpreformatted) | 保留原代码和 language，仅显示不执行；必要时按完整行分块；核对复制内容、缩进与语言呈现 |
| 公式 | [InputRichBlockMathematicalExpression](https://core.telegram.org/bots/api#inputrichblockmathematicalexpression)、[RichTextMathematicalExpression](https://core.telegram.org/bots/api#richtextmathematicalexpression) | 分别支持块级／行内 LaTeX，原样作为显示源、不调用执行器；核对手机实际排版，失败保留可读 LaTeX |
| 折叠 | [InputRichBlockDetails](https://core.telegram.org/bots/api#inputrichblockdetails) | 显式 summary／内部 blocks，默认折叠、可展开再收起；内容只含用户可见正文，不用来隐藏内部推理或敏感工具数据 |

官方 [Rich Message Limits](https://core.telegram.org/bots/api#rich-message-limits) 为文本最多 **32768 UTF-8 characters**（含公式源及 custom emoji 替代文本）、最多 **500 blocks**（含嵌套／表行等）、**16 层**、表格最多 **20 列**、媒体最多 50 项；不把 4096 普通文本限制套到富消息，也不把这里的 characters 擅改称 bytes。实现可保守以全部文本节点／公式源合计不超过 32000 UTF-8 bytes 作为本地分片预算，同时计数 blocks／层级／列；该 bytes 预算是更严的产品策略。结构完整的增量快照才进入草稿，未闭合代码／公式／表格暂以安全段落显示，最终应正确转为原生结构。首版不带媒体 blocks；现有成果继续单独 sendDocument。

- 普通文本、系统回执和富消息失败的降级使用纯文本，不把 Markdown 原样当 Telegram MarkdownV2。`sendMessage.text` 是解析后 1–4096 characters，`MessageEntity.offset/length` 按 UTF-16 units；保守每片不超过 4000 UTF-16 units（含标识），按 grapheme／段落分割。来源：[sendMessage](https://core.telegram.org/bots/api#sendmessage)、[MessageEntity](https://core.telegram.org/bots/api#messageentity)，核查 2026-10-16。
- 明确的富格式拒绝可降级为可读纯文本／LaTeX＋经核验文件，并写 presentationState=degraded、稳定原因和可见降级提示；401 停止连接，429 只退避，网络发送结果不确定时不改发另一格式制造副本。不存在可依赖的通用客户端富消息能力协商，API 成功也不证明手机渲染通过；降级交付不算富消息验收成功。
- 完成发送摘要 + `sendDocument` 实际文件。宿主从 Run 记录取 artifact，复用 Files 校验并在上传前重验／读入可信字节，不信模型返回路径，不接受用户要求上传任意绝对路径。首版仅现有已验收 `.md`、不扩大 128 KiB 工作区限制，文件名使用安全 basename，不暴露本机目录。
- 官方云端 `sendDocument` 当前上限 50 MB，caption 为解析后 0–1024 characters；本机文件需 multipart/form-data 上传，`document` 字符串不是任意本地路径。首版不用 URL 拉取，尤其官方 URL 方式对 document 当前仅保证 PDF／ZIP；也不部署支持更大文件／本地路径的 Local Bot API Server。来源：[sendDocument](https://core.telegram.org/bots/api#senddocument)、[Sending files](https://core.telegram.org/bots/api#sending-files)、[Local Bot API Server](https://core.telegram.org/bots/api#using-a-local-bot-api-server)，核查 2026-10-16。
- 文件缺失、内容变化或不可上传时，报告「成果已生成／文件交付失败」及稳定原因，允许查询／明确补发；本地绝对路径只供 CLI 查询，不包装为手机可点的下载地址。超长回复可同时提供实际文本文件，不能伪造公网链接。未来接收附件再单独设计 `getFile`、下载大小／格式／存储授权；官方云端下载当前 20 MB，不能套用上传上限。来源：[getFile](https://core.telegram.org/bots/api#getfile)，核查 2026-10-16。

### 发送确认的可靠性边界

发件状态：pending → sending → sent／uncertain／failed，429 等明确未成功响应可进入有时间限制的重试等待。网络超时或进程在「Telegram 已发送、本地未记 messageId」间崩溃，会进入 **uncertain**；Bot API 没有适用于 sendMessage／sendRichMessage／sendDocument 的通用客户端幂等键，draft_id 也不是正式发送幂等键，不能据此声称 exactly-once。首版不自动重发 uncertain，CLI／后续状态查询显示待核实，owner 可明确选择补发，带原 eventId 标注可能重复。无法通过「查聊天历史」假定找回发送回执。

确认成功收到 Bot API Message 后保存 messageId；它代表 API 接受发送，不代表人已阅读或富内容已正确呈现。草稿的 True 不得推进 delivered；正式富／纯文本各片和文件分别记账，已 sent 不再重传；某片 uncertain 时暂停该事件余下片段，其他独立事件可以继续。必需正式正文和文件都确认后可记 delivered，另以 presentationState 表达 full／degraded／unverified，交付成功不能掩盖富消息验收缺口。用户同意补发是发送新副本，不重新执行 Worker。

当前 `scheduleDelivery()` 是 sink 成功即 `markDelivered()`，且等待 sink 会占主队列。接入时需在其拥有者处改为「生成一次交付 → 同事务插入 outbox 并将 Run delivery 从 pending 改为新增 queued → sender 确认全部必需片段后 delivered」。主队列只等待本地事务；查询能区分执行 succeeded 与交付 queued/uncertain/failed。不能把“成功入发件箱”静默算作旧 delivered，也不能让 pending 循环重复调用模型生成同一交付。旧 CLI delivered 仍仅代表原 stdout 写入获确认。

## 8. Worker 授权与问题往返

复用正在实现的 Worker interaction 对象及主 Agent 自主策略，不在 Telegram 另建审批引擎。主 Agent 先在用户事先授予的任务范围内判断和回答，仅缺少权限／信息时转为 pending_user；向手机展示的是主 Agent 组织的问题及宿主关联的交互，不是 Worker 直接发言。原 Worker 暂停自身等待，主 Agent 结束本轮继续接待，不能等手机回答而卡主队列。待答提示及可操作键盘必须正式发送并持久保存，不能只放进 30 秒草稿；原生停止主回复不等于回答／拒绝该待答。

1. 在现有 question／interactionId 事件上补足结构化类型、Run、可见问题／具体动作和选项；经原入口路由后发送 inline keyboard。操作按钮建议「允许这一次／拒绝」，问题按钮用真实选项；按钮点击不能给之后所有动作永久授权。
2. 官方 `callback_data` 只有 **1–64 bytes**。只放随机不透明短句柄，服务端映射 interactionId + action + botId + ownerId + chatId + bindingVersion + 绑定消息 ID + expiresAt；不放 token、命令、路径、正文或可自行改写的授权范围。[InlineKeyboardButton](https://core.telegram.org/bots/api#inlinekeyboardbutton)，核查 2026-10-16。
3. 收到 callback 后尽快调用 `answerCallbackQuery` 消除客户端等待，不等待模型或 Worker；可先表示「正在核对」，不能先回「已批准」。此 API 回执只表示处理了按钮，不是业务批准。随后对持久 interaction 做身份、消息、状态、过期、原 Worker 活性和动作范围校验；不认识的／不可访问消息、inline 模式 callback 拒绝。官方要求 callback 需要及时 answer：[CallbackQuery](https://core.telegram.org/bots/api#callbackquery)、[answerCallbackQuery](https://core.telegram.org/bots/api#answercallbackquery)，核查 2026-10-16。
4. 同一 interaction 的消费用事务条件更新，重复 callback ID、双击、批准／拒绝竞态最多形成一次有效决策。默认按钮有效 30 分钟或 Run 失活即过期（产品建议，不是官方 TTL）；到期执行超时／失效流程，提示重新询问，不默认为批准。目标 Run 取消、重启、解绑都使旧按钮不可再决定；仅停止主回复不在此列。编辑／移除键盘只是界面清理，服务端状态才是权威。
5. 自然语言同样需绑定待答项：优先精确回复那条待答消息，其次明确短 ID；只有一个候选且语义明确时才关联。多 pending 的「同意／就这样」必须澄清，不能由模型猜一个；普通问题的「是」不能被解释为操作授权。宿主把可信用户消息 ID 与已匹配的 interactionId 交给核心，不能允许模型从工具参数自造授权来源。
6. 按钮消费与 interaction 决策在同一事务保存，**提交后**再由 interaction 机制恢复同一 Run／thread／turn 的原等待请求；不能在事务未提交时先 resolve Worker。若决策已保存而回传原 Worker 的结果不确定，保留未确认状态并对账，不能重建进程重放动作。拒绝、过期和停止走该机制明确的终止／恢复分支。该事务边界须与交互任务负责人收口，不以直接包裹当前草稿方法代替。

Cindy 已核实的是「会话／轮次交互路由 → 手机卡片 → requestId 对应的活跃 Promise」机制，适合借鉴为原请求续办；其 Telegram callback 句柄和 pending Promise 在内存中，不能当成重启续跑保证。Homer 持久记录交互与按钮只为关联、防重和审计：重启后如原执行等待已丢失，旧按钮须失效，不能从账本重新执行被批准的动作。Worker → 主 Agent → Telegram → 原 Worker 全链仍须在 P4 验证，不能由 Cindy 的通用卡片代码推定已完成。

Telegram owner 资格只证明可代表该 Homer 用户操作产品；它不扩大当前任务、文件能力或其他网站账号的权限，附件和转发内容也不是新授权。CLI 与 Telegram 可回答同一 interaction，但只有在该绑定 owner 的同一产品会话内允许跨入口处理；旧入口按钮随后失效，决策来源可查。

## 9. 实施模块与数据提案

下列名称是最初拆分建议；实际已落地模块／表见第 14 节，未落地部分不能当现有能力；沿用 TypeScript、Node 22.22.0、SQLite，不建设插件平台。Bot API 传输建议用 Node 内置 fetch／FormData／AbortSignal，不新增 SDK；这些能力见 [Node 22.22.0 官方全局对象](https://nodejs.org/download/release/v22.22.0/docs/api/globals.html)，核查 2026-10-16。传输超时、响应验证、限流和秘密清洗集中在一处。富内容解析优先复用成熟解析器再映射有限结构，不自造完整 Markdown 引擎；选型在 P0-S 收口，须核对选定依赖的当时版本、许可证、Node ESM／TS 兼容及所需语法。若改用 Bot SDK 同样核对当前 Bot API 覆盖；本轮不安装或凭旧印象指定版本。

| 模块／入口提案 | 责任及复用点 |
| --- | --- |
| `src/serve.ts` + `src/local-transport.ts` | 唯一服务宿主、本地 socket、生命周期和可信 CLI 请求；沿用 Homer/runtime 锁，不新建第二份引擎服务 |
| `src/cli.ts` | 增连接／设置／历史查询入口，区分客户端断开与服务 shutdown；保留 standalone 明确互斥 |
| `src/channels/telegram-api.ts` | HTTPS 调用、JSON／multipart、超时、retry_after、脱敏；不能创建 Codex 线程 |
| `src/channels/telegram.ts` | 长轮询、配对、owner 校验、三类 update 归一化、回调快速 ack；原生停止交独立控制入口，只调用服务公开边界 |
| `src/engine.ts` + 核心主轮控制入口 | 新增真实可见文本增量和终态归一化；正常中断保留原主线程，主 turn 精确停止不进入 Worker stopAll；不把 Telegram 对象放进引擎 |
| `src/channels/telegram-render.ts` | 有限 RenderDocument → text／InputRichMessage blocks、结构分片、四类富内容校验与明确降级；按序快照与 native draft 的方法选择，不新增插件平台 |
| `src/channel-store.ts` | 收件／来源／对话／发件与 checkpoint；复用 Store 同一连接和事务，不新开独立业务库 |
| `src/channel-router.ts` | 主 Agent 可见 Message → generation／event／outbox；来源映射、草稿生命周期、正式交付及成果引用；Worker 内部事件先回主 Agent，不直接发 Telegram |
| `src/service.ts`、`src/store.ts` | 最小扩展入队／回复事务、主队列、交付 queued 状态；保持 Run／Codex 生命周期归核心 |
| Worker interaction 最终集成入口 | 由其原任务拥有者完成；本方案仅加渠道关联、有效期／按钮消费适配，不复制权限判断 |

建议入口信封至少有 `requestId, conversationId, channel, originRef, senderRef, receivedSeq, text, replyTo?, interactionRef?`；另有无正文的停止控制信封 `botId, updateId, chatRef, messageThreadId?, draftId, matchedGenerationId`，后者经宿主精确匹配，不交模型猜。输出扩展现有 Message，正式事件有 `eventId, conversationId, requestId?, runId?, interactionId?, artifactRefs?, documentRef?, presentationState`；主回复增量有 `generationId, threadId, turnId, itemId, seq, visibility=main_user, kind=start|text_delta|snapshot|terminal, renderMode`。引擎内部 item ID 只供宿主过滤关联，不在聊天或诊断泄露；不能把任意引擎事件标成 main_user。RenderDocument 为有限 paragraph／table／code／math／details 结构，正文只存一份规范内容，纯文本降级从中派生。Telegram 原生对象不进入核心，路由只能查数据库可信来源，不能由模型写目标 chatId。

| 新增存储／最小字段 | 约束与生命周期 |
| --- | --- |
| `conversations(id, ownerRef, createdAt)` | 首版仅一个产品主会话；现有 mainThread 继续是引擎恢复锚点，不复制另一可变指针 |
| `telegram_connections(botId, secretRef, desiredState, state, nextOffset, bindingVersion)`；`channel_bindings(id, botId, ownerId, chatId, conversationId, boundAt, version)` | desiredState 持久表达 enabled／disabled，state 表示运行状态；一个有效 Bot／owner／私聊绑定；token 不入库；更换 token 同 botId 保留 checkpoint，换 Bot 不混用 offset；连接运行代次仅内存管理 |
| `pairing_challenges(id, codeHash, expiresAt, attempts, candidateRef, state)` | 短期状态；本地批准才绑定；过期／用完清除配对码摘要和候选资料 |
| `inbound_updates(botId, updateId, bindingVersion, disposition, receivedAt, messageRef?)` | 联合主键；接受或拒绝都可推进事务 checkpoint；不存完整 Telegram 原始 JSON |
| `conversation_messages(id, conversationId, seq, role, kind, content, originRef?, requestId?, runId?, interactionId?, createdAt)` | 用户可见正文唯一归属；同 conversation seq 唯一；身份／来源使用稳定引用，查询／导出受本地权限保护 |
| `main_generations(id, sourceRequestId?, runId?, originRef, threadId, turnId?, renderMode, state, lastSeq, finalEventId?, stopUpdateRef?, createdAt, endedAt?)` | thinking／streaming → finalizing 或 stop_requested → finalized／stopped／interrupted；只有一个活跃主轮；finalEventId 唯一，finalized 指规范稿已保存／入 outbox，远端送达另记；不混用 Worker Run 状态 |
| `telegram_drafts(botId, chatId, messageThreadId?, draftId, generationId, bindingVersion, state, lastSentSeq, lastSentAt?)` + 每 Bot 持久 draft 分配计数 | 映射首次发送前提交；botId+draftId 唯一且不复用，保留失活墓碑拒绝旧停止；快照正文／token 仅内存，重启旧 draft 失效，不持久记录逐 token 推理 |
| `channel_inputs(requestId, messageRef, receivedSeq, state)` + `request_origins(requestId, channel, bindingVersion?, chatRef?, sourceMessageId?, clientRef?)` | requestId 唯一；inputs 负责待处理状态，requests 保持既有核心处理回执，状态变更需事务一致，不产生两份独立完成事实 |
| `channel_outbox(id, eventId, routeRef, partKey, messageRef?, artifactRef?, renderMode, rendererVersion, partSpec, presentationState, state, attempt, nextAttemptAt, platformMessageId?, errorCode?)` | eventId + routeRef + partKey 唯一；不可变正文／结构引用 messageRef，分片规格固定以便恢复；文件引用核验 artifact；草稿不进正式 outbox，sender 独占领取 |
| `interaction_routes(handleHash, interactionId, action, routeRef, bindingVersion, promptMessageId?, expiresAt, consumedBy?)` | 只保存按钮句柄摘要；引用原 interaction 为状态权威，不另存一份批准结果；消费与 interaction 决策原子提交 |

陌生人拒绝只保留必要去重标识与计数；临时收件／按钮表可清理已越过 checkpoint 且无待处理引用的记录，不清理 pending／uncertain 或影响重放判断的数据。历史导出与用户主动清理另给明示操作，解绑不当作清理历史。业务正文存储与窄诊断事件分离，诊断只允许稳定错误码、状态、耗时和必要内部关联，不记录 owner/chat 明文、内容、token、HTTP headers 或完整请求 URL。

所有 schema 采用有版本的增量迁移；实施前对停止后的数据库做私有备份，验证旧 requests／Run／mainThread 未变。迁移失败回滚事务，不自动删库重建；新增 delivery 状态会影响旧程序兼容，回退须停服务并恢复迁移前备份，不能让旧二进制同时打开新库。没有数据的全新测试库不能代替旧库迁移验收。

**工具兼容门槛：**渠道适配本身不应修改 MAIN_TOOLS；Worker 授权与三种追加可能改变主工具集。合并时先确认最终工具指纹／输入契约，并通过兼容迁移路径恢复用户原主线程。若仍触发 `main_tools_migration_required`，Telegram 首版不得以新 runtime 或新主线程绕过；可继续做离线适配测试，但不宣称日常会话接入完成。

## 10. 工作包与实施顺序

| 顺序 | 工作包及完成标准 | 前置依赖 |
| --- | --- | --- |
| P0 | 收口 Worker interaction 最终服务契约、确认原主工具兼容并验收同线程恢复；三种追加按实际状态排除 | 现有交互任务／会话兼容负责人；不能改写其共享源码 |
| P0-S | 核对固定引擎协议，提供主 Agent 真增量／可见性过滤／终态；精确停止主 turn、正常中断后原线程可继续；同时核定有限富内容解析契约／依赖 | 引擎与核心边界，Worker 不受牵连；不能把最终重播、仅停止草稿或 mainBroken 关闭当完成 |
| P1 | 单一服务宿主、CLI 连接模式、持久入口与产品可见历史；CLI 单独回归正常，关客户端不断任务 | 核心契约已明确；可与 P0 的非共享部分分步推进 |
| P2 | secret store、getMe／webhook 检测、本地配对、owner 校验、三类更新长轮询与事务 checkpoint；先用 fixture | P1，Bot API 传输边界 |
| P3-A | generation／draft 持久映射，sendMessageDraft 与 sendRichMessageDraft 真流式／Thinking／原生停止，控制更新不阻塞主队列 | P0-S/P1/P2，停止和终态竞态契约 |
| P3-B | 有限富消息渲染、表格／代码／公式／折叠、最终 sendMessage／sendRichMessage＋outbox／文件、uncertain／明确降级与重启；停止指定 Run 仍独立 | P3-A，delivery 状态迁移及来源路由 |
| P4 | 主 Agent 处理 Worker 事件后对外表达；正式待答按钮／自然语言、快速 ack、过期重放防护、原 Worker 恢复及跨入口竞争 | P0/P3-A/P3-B 全部闭合，不引入 Worker Bot |
| P5 | 用户创建专用 Bot、可信本地设置页输入 token；真实手机验收两条 native 草稿、Thinking／原生停止和四类富内容，再与 CLI／Worker 联合验收 | 离线契约通过，用户授权真实账号接入与安全测试；须记录客户端版本，不能用纯文本替代富呈现通过 |
| 后续 | 按试用结果增加附件／语音，必要时迁移云端；公共 Bot 另做身份与租户方案 | 首版本地可用且需求明确 |

实施顺序按依赖验收，不编造固定天数。实际实施已获授权；真实接入下一阶段需要：用户自己创建／选择专用 Bot、在可信本地设置页输入 token、核对本地配对身份、确保本机在线且网络可达；已有 webhook／其他消费者的迁移需单独明确操作。现在不索取这些材料。

## 11. 验收清单与证据边界

新增维护场景建议命名 `HMR-TELEGRAM-001` 等，来源先标 `requirements-derived`，fixture 标 `synthetic`；经授权脱敏的真实反馈再沿用问题 ID 补充，不保存原始私聊或 token。先以稳定行为契约的 red-green 测试验证再实现。离线 fixture 模拟 Bot API／引擎、临时 SQLite 与可控时间，不访问生产 Bot；真实验收使用专用 Bot、专用合成材料与明确获准的模型连接。

| 场景 | 必须观察的结果 | 验证方式 |
| --- | --- | --- |
| 首次设置／配对 | 错 token 不连接；getMe 的 botId 正确；无有效码、过期码和未本地批准均不绑定；重启不丢 owner | fixture + 专用真实 Bot |
| 陌生人／群聊 | 用户名相同、转发 owner 内容、群内 owner 都不能获得任务信息或批准权；不进入模型 | fixture；真实第二账号须用户另行参与授权 |
| 同 Bot 冲突 | 同 runtime 锁／同进程 bot 占用拒绝竞争；其他 runtime 竞争按 409 停止；已有 webhook 不被删除；另一 poller 冲突后停止争抢 | fixture + 获准受控冲突；未授权不动已有 webhook |
| 重复 update／顺序 | 同一 update 重投只产生一条输入；批次故障回滚 checkpoint；一周空闲随机 ID 与过滤前旧类型不丢不乱执行 | fixture |
| 崩溃窗口 | 收件提交前后、确认后 queued、processing、completed／发件交接各窗口按第 6 节恢复，不重复派发 | fixture／故障注入 |
| 断线／长离线 | 退避重连、已入库输入保留；stale 等明确处理；超过 Telegram 保留窗口明确可能缺失 | fixture + 短时真实断线；不假称验证了 24 小时 |
| 主动停用／配置竞态 | 停用后重启仍不联网；secret store 读取错误不自动连接；旧 getMe／poll／sender 完成不覆盖新绑定或复活连接 | fixture／可控延迟；真实只检查本人停用重启 |
| 同主会话 | CLI 告知合成标记→Telegram 能续问→重启后继续；产品 conversationId、原 mainThread 均相同 | fixture + 真实 Codex，单独记录上下文限制 |
| 产品历史 | 接入后两入口输入和可见回复可查询／导出；旧历史缺口明示；日志及验收证据无正文泄露 | 离线查询／导出检查 |
| CLI／Telegram 同时输入 | 只一个服务持锁；主轮无重叠，各自产生回复；两个 Worker 可并行、乱序完成不串路由 | fixture + 真实联合流程 |
| 长任务／多 Run | 快速接收确认不依赖模型完成；查询不中断 Worker；完成回原入口，关闭 CLI 不取消 | fixture + 真实联合流程 |
| 后台回推／迟到进度 | 无新输入仍收到完成；不泄露 Worker 原始工具事件；另一条新消息不抢回复目标；终态之后旧进度不能覆盖结果或取消状态 | fixture + 真实长任务；覆盖最终发送失败和在途进度竞态 |
| 真流式／Thinking／正式保存 | 主 turn 终态前已收到真实可见文本增量；text／rich 两条 native draft 路径、空文本／thinking block 可见；草稿 True 不记 delivered；正式完整稿返回 Message 并持久入库，思考块不进最终 | 引擎事件 fixture 验证增量先于完成、过滤 reasoning／工具内容；真实 Codex＋手机观察；最终文本重播明确不通过 |
| 草稿寿命／限流／断网 | 30 秒临时预览与刷新策略可观察；断网只保留最新活跃快照，429 遵守 retry_after，重启不补播旧 draft；最终 outbox 可恢复，不因预览消失丢全文 | fixture 可控时钟／故障注入；手机实测预览消退及正式消息保留，不制造真实限流 |
| 原生停止主回复 | can_stop 按钮产生正确停止更新；无 from 的对象按绑定 chat＋draft 映射校验；目标主轮确实中断且原线程可续聊，其他 Worker／待答项继续 | fixture + 真实手机；包含 Thinking 未出字、生成中、重复停止、旧 draft／旧绑定、停止与完成同到、引擎未确认和正式发送在途 |
| 四类原生富消息 | 表格／语言代码／行内与块公式／折叠展开收起在真实客户端可读；完整富消息正式保存，复制代码及文件内容一致 | 结构／转换 fixture＋真实手机，记录系统与 Telegram 版本；API 成功不代替呈现，桌面预览不能代替手机 |
| 富格式边界／降级 | 32768 字符、500 blocks／16 层／20 列及保守预算可控，结构分页不破坏代码／公式／表头；明确拒绝后可读降级并标 degraded，超时不盲换格式；降级不记富消息通过 | fixture；专用手机合成材料验收，不发送真实敏感数据 |
| 长文本／格式 | 4096 边界、中文／emoji／组合字符、伪 HTML／Markdown、不完整分片都可控；片段有序，无乱码 | fixture；手机检查可读性 |
| 429／输出超时 | 尊重 retry_after；已 sent 片段不重发，uncertain 可查且不盲补；Worker 不因此重跑 | fixture；不制造真实限流 |
| 文件 | 真 `.md` 下载打开、内容／哈希一致；缺失／越界／软链接／被改文件／过大拒绝；手机没有伪本地下载链接 | fixture + 真实手机文件验收 |
| 待答批准／拒绝／提问 | 主自主范围内先处理；必要时用户操作准确恢复原 Worker；拒绝不执行动作，问答不增加权限 | fixture + 获准低风险真实操作 |
| 主 Agent 唯一对外身份 | Worker 进度／成果／问题先经主 Agent 组织为正式表达，按原始可信来源路由；没有 Worker Bot、Bot 间发送或 raw Worker 事件直接投递；停止主回复不吞掉已保存待答卡片 | fixture 检查核心事件来源与 adapter 调用边界；真实并行 Worker 联合流程 |
| 多待答／重放／过期 | 模糊回复澄清；快速 ack；双击、旧绑定、错误 chat／owner、目标 Run 停止后按钮无效；两入口竞争最多一次决策，仅停止主回复不作拒绝 | fixture + 真实按钮往返 |
| 停止／取消／追加 | 仅目标 Run 停止；确认后 cancelled，未确认 interrupted；主对话保留，待答取消，其他 Worker 继续；三种追加未接入则明示不支持 | fixture + 真实安全停止 |
| 解绑／重启／回退 | 旧按钮及未发送旧路由失效；其他 User.id 不能重绑并接触旧上下文；旧线程和业务历史不丢；失败迁移不重建库，备份可恢复 | fixture／专用库，不在日常库制造失败 |

真实通过条件是手机可交办、真实原生流式及 Thinking、可停止当前主回复且不误停 Worker、四类富内容可呈现、能经主 Agent 协助原 Worker、可打开实际成果，且 CLI 跨入口上下文保持；任一新增首版能力仅降级可用都不能宣布全部通过。离线测试只证明对应契约，不代替账号／网络／Codex／手机端到端。记录实际引擎、模型、环境、客户端版本、检查时间、通过项和限制；调用用量可记元数据，未有账单不估算费用。

## 12. Cindy 本机设计对照

核查日期 2026-10-16；只读 `/Applications/Cindy.app/Contents/Resources/app.asar` 静态包，内置 package 版本 **0.1.109**、许可证标记 Apache-2.0。以下 `B@数字` 表示 archive 内 `.vite/build/bootstrap-electron-CcsSsbLn.js` 的**零起算 UTF-8 字节偏移**，不是行号或 archive 总偏移；该 member 共 23,523,581 bytes，SHA-256 `9efe0b25a0484b12ae9ad97d9be62c7956d45fc0128da0980f576853c95c372f`。定位只保留符号、版本、校验值及设计摘要，未提取／复制实现源码；安装包更新后应重新定位。

**证据分级：**表中「代码核实」仅指静态控制流；第 4–8 节 Telegram 官方规则属于「文档描述」，不能证明 Cindy 实际运行行为。本次未找到可替代下列实现检查的随包 Telegram 专项手册；未运行 Cindy 的 Bot 或测试账号。未追通或未实测部分明确标为「尚未核实」。

| Cindy 实际机制与证据级别 | 证据定位（均在 B） | Homer 采用／简化／暂缓及原因 |
| --- | --- | --- |
| **代码核实：**渠道 adapter／host 与统一 orchestrator 分层，持久 binding 可显式连接既有 session；Telegram 默认仍按渠道／Bot／用户生成独立 session | `BaseIM` @14776349；`SqliteBindingStore` @14770119；`createImSessionRepo` @20495196；`createImOrchestrator` @20640793；`buildTelegramAdapter` @20676083 | 采用 adapter／宿主／核心边界与显式绑定，简化为一个服务；绑定原主会话，禁用隐式新会话及 `/new` 语义。群聊、多渠道插件注册和多租户暂缓 |
| **代码核实：**getUpdates 50 秒、仅 message/callback_query，按 chat 排队；offset 带 botId 持久保存，并受 adapter 在途 update 最小值限制；下一 poll 的内存 offset 可先行推进 | `runPollLoop` @16891094；`readPersistedOffset` @16909421；`persistOffsetCapped` @16909799；`createMessageHandler` @20601772 | 采用所需类型过滤、Bot 隔离和顺序化。**尚未核实**持久唯一键 inbox／业务与 checkpoint 原子提交；不把 offset 当 exactly-once。Homer 保留第 6 节事务边界，不能照抄回调完成即持久确认 |
| **代码核实：**每轮捕获回复目标，消息标识含 chat；渠道输出可附着到已存在 session，按账号代次检查 | `claimTurnReplyTarget` @16900358；`createImOrchestrator` @20640793；`captureImAccountGeneration` @17058231 | 采用固定请求目标和异步代次复查；Homer 再以持久 sourceRequestId／Run 路由，避免并行 Worker 回给最近聊天。跨入口同主会话是 Homer 约束，非 Cindy 默认能力 |
| **代码核实：**无活跃输入时可收集 relayed／scheduled 主会话输出并完成转发；原始子代理／background 事件被过滤 | `createTurnRunner` 内事件过滤 @20562801、收集 `Pa` @20567118、最终 `ea` @20569410 | 采用事件驱动后台回推、主 Agent 组织可见结果；不直接暴露 Worker 工具流。**尚未核实**Telegram 持久 outbox 或崩溃后全量补发；Homer 仍实施独立 outbox |
| **代码核实：**交互路由带 session／turn／来源；卡片等待 requestId 对应内存 Promise，按钮动作解除原等待；callback 快速 ack、失效卡片提示；callback ref 也在内存 | `interactionRouteLease` @20547092；`registerPending` @17062757；`resolvePending` @17063398；`handleCallbackQuery` @16899155；`createCardActionHandler` @20612330；callback refs @16851246 | 采用原请求关联、快速 ack 和过期清理；Homer 保留事务防重、owner+chat+interaction 校验和多待答澄清，仅允许一次／拒绝。**尚未核实**其 Worker 经主 Agent 的完整权限链或跨重启恢复，不复制内存等待为可靠续跑承诺 |
| **代码核实：**最终交付开始关闭进度，记录分片已确认／不确定，禁止迟到进度；不确定异常明确警示不要重发 | `createTelegramMessageLifecycle` @16867953；`TelegramFinalUnconfirmedError` @16869331；`TelegramStreamingTextHandle.finalize` @16871707 | 采用终态与进度隔离及 uncertain 处置；将载体改为首版必须的原生 draft，仍不移植相册。内存生命周期不能替代 Homer 持久发件账本 |
| **代码核实：**已有 `sendRichFinal` 尝试 sendRichMessage(markdown)，4xx 时可回落，404 会关闭该运行期 rich 尝试；不是纯文本最终输出 | `sendRichFinal` @16903169；其调用在 streaming handle 的 sendFinal 分支 | 补全前轮调查；采用富消息正式发送思路，Homer 增加有限结构校验、四类呈现验收和显式 degraded。不能照搬对所有 4xx 均降级：401 及 429 按各自语义处理 |
| **检查范围内尚未核实：**两个主 bundle 精确检索均无 sendMessageDraft／sendRichMessageDraft／stopped_message_generation／keep_on_stop 字符串；已追到的流式路径使用普通消息／编辑，不是原生 draft | B 的 createStreamingHandle → sendRenderedChunk／editHtml；另查 `.vite/build/index-BtzGV_yA.js`（SHA-256 `29ad77b6cdc7885559f5aaa06288288fdddb34622c0fd4c91e9f5245c3ee0095`）；检索缺失不证明其他版本绝无实现 | 原生草稿、原生停止关联及四类富结构契约按 Homer 新增首版能力设计；不冒充 Cindy 已支持，也不因当前未见而暂缓用户明确需求 |
| **代码核实：**原生 fetch 处理 JSON／multipart、retry_after；文本先按 3000 源字符分块再转 HTML，可失败降纯文本；文件检查非空／50 MiB 后上传 | `createTelegramApiClient` @16849674；`SOURCE_CHUNK_LIMIT` @16850404；`sendFile` @16887420 | 采用集中传输、限流、真实上传；纯文本仅普通路径／明确降级，富消息按自身限制；继续更严 Files 校验与 128 KiB `.md` 范围，不扩展任意媒体 |
| **代码核实：**断网有退避、无效 token 停止；409 冲突会等待 30 秒继续重试；超过一小时的旧消息跳过 | `runPollLoop` @16891094 及相邻 `dispatchUpdate`／`processInboundMessage` | 采用退避与分类错误；Homer 对冲突停止争抢，旧可信文本留 stale 待选择，避免个人 Bot 多消费者互抢或旧指令静默丢弃；一小时是产品建议 |
| **代码核实：**可信桌面 IPC 显式设置 token+ownerUserId，先验 getMe；owner-scoped secret 使用 Electron safeStorage 加密文件；主动 offline 持久化，配置代次防止旧异步连接复活 | `telegramBot:set-config` @16880726；`scopedSecretPath` @3913218；`goOffline` @16878649、`goOnline` @16879478；`captureImAccountGeneration` @17058231 | 采用稳定 owner、可信本地设置、秘密读取失败不联网、持久停用与代次隔离；CLI 简化为系统 Keychain，不能把 Cindy 实现称作直接 Keychain。**尚未核实／未发现**配对码路径；Homer 的一次码＋本地批准是新增设计，不声称照搬 |

复核结论：充分借鉴其会话绑定、回复归属、交互续办、后台转发与最终交付生命周期；同时保留 Homer 单主会话、原入口和更明确的持久事务约束。静态证据不能替代 P0/P4 的原线程兼容及原 Worker 恢复验收，也不授权读取 Cindy 用户数据或操作任何现有连接。

## 13. 本方案的核查记录

- 已阅读 README、docs 索引、产品／需求／技术／决策／实施文档、当前运行说明与最新验收补充；已只读检查 CLI、核心消息队列、Store、Files、配置及正在新增的 Worker interaction 边界。
- 已在线核对 Telegram 官方 Bot API、BotFather／Features、FAQ；核查时官方页最新列 **Bot API 10.3（2026-08-24）**，见 [官方变更记录](https://core.telegram.org/bots/api#recent-changes)。按用户新增要求复查两种 Draft／对应正式发送、30 秒寿命、Thinking、原生停止字段、富结构和限制；本方案各 API／限制旁附直接来源及 2026-10-16 核查日期，上线前应重查。三项新增均属首版必须，Bot 间通信明确排除。
- 官方规则证明的是接口契约；checkpoint 事务、原入口路由、stale 阈值、配对／按钮 TTL、发送不确定处置均为 Homer 设计建议，不冒充 Telegram 平台保证。追加只读核查了本机 Cindy 相关静态控制流，见第 12 节；未复制实现、未扫描用户私聊／凭据／数据库，也未做跨产品扫描。
- 首轮调查只编写此方案及 docs 索引的一项链接；后续获准实施后的现状见第 14 节，不能把首轮「未实现」当当前状态。索引未重写。全过程未读取 Cindy 私密数据、连接真实 Bot、修改 webhook 或发送外部消息。


## 14. 实施收口与共享宿主交接（2026-10-16）

用户「继续推进」后已实施。CTO 先授权独立渠道模块，再顺序放行 dev-host／dev 脚本和必要 Web 管理分支。本任务未修改 service／engine／store／web-history／package／lock／ui，不新增依赖，不操作日常 Terminal、用户配置或业务库。服务构建已运行；测试只使用隔离合成环境，未使用真实 Bot、模型账号或系统 Keychain。

### 14.1 实际代码

| 模块 | 已实现内容 |
| --- | --- |
| [telegram-contract.ts](../src/channels/telegram-contract.ts)／[telegram-api.ts](../src/channels/telegram-api.ts) | 注入式宿主事件与可信 origin；内置 fetch／FormData，三类更新、两条 native draft／formal 路径、文件字节；Abort、受限响应体及脱敏分类错误。 |
| [telegram-store.ts](../src/channels/telegram-store.ts) | 原 app.store.db 上增量 tg_ schema；inbox＋cursor 原子提交、来源、接受回执、单调 draft ID、outbox、配对和待答；不新建对话库。 |
| [telegram-adapter.ts](../src/channels/telegram-adapter.ts)／[telegram-output.ts](../src/channels/telegram-output.ts) | 长轮询、冲突停收、独立控制路径、真实增量合并、Thinking、10 秒刷新、1 秒共用发送预算及 retry_after；终态先持久入 outbox，等待在途草稿结束后正式发送；断开期间成果仍持久保存。未知发送结果保持 uncertain，不盲重发。 |
| [telegram-render.ts](../src/channels/telegram-render.ts) | 有限确定性 Markdown 子集转 paragraph／table／pre／mathematical_expression／details；无媒体自动获取、无任意 HTML。识别管道表格、围栏代码、独立 $$ 公式、独立行 details／summary，其他语法保留可读文本。超预算明确降级，不声称通用 Markdown 或任意公式语法已支持。 |
| [telegram-secrets.ts](../src/channels/telegram-secrets.ts) | 独立 Homer.Telegram.v1 Keychain 随机引用、secret 走 stdin 而非 argv，写后回读核验；配置先 getMe／只读 webhook 检查；无明文降级。TTY 隐藏输入 helper 存在，目前用户入口是本地页。 |
| [telegram-homer-bridge.ts](../src/channels/telegram-homer-bridge.ts) | 唯一 Homer／原 mainThread；source=telegram 的同步事务回执；真实 main_start→delta→main_terminal；精确停止；主 Agent 处理原 Worker 待答与成果；Files 复核字节；崩溃后的正式历史补发去重。 |
| [telegram-channel.ts](../src/channels/telegram-channel.ts)／[telegram-management.ts](../src/channels/telegram-management.ts) | 可信本地配置、显式配对候选批准、连接／断开／恢复／解绑与状态计数；管理操作串行，关闭／升级等待在途操作，不作为 Agent 工具暴露。 |
| [telegram-settings-page.ts](../src/channels/telegram-settings-page.ts) | `/settings/telegram` 及同源独立 CSS／JS；密码框、候选数字 ID 批准、配对过期、断开和明确解绑；不在 URL／浏览器存储／页面回显 token，不加载外部资源。 |
| [telegram-migration.ts](../src/channels/telegram-migration.ts) | 首次挂载 tg_ schema 前一致 SQLite 备份（含已提交 WAL）、私有目录／文件权限、失败阻断和未知版本拒绝。 |

新增表为 tg_schema／tg_connections／tg_credentials／tg_pairs／tg_inbox／tg_routes／tg_acceptances／tg_outbox／tg_drafts／tg_interactions／tg_buttons／tg_answers。凭据表只存引用；tg_acceptances 只存可信来源、update、replyId 和 hash，输入正文在核心接受后清除；成功发件 payload 清除。lastUpdate 与 lastPoll 分开，一周无新更新时允许 Telegram 随机较小 ID 的恢复探测，保留原 inbox 去重。

### 14.2 已接合的共享契约与终态修正

- [dev-host.ts](../src/dev-host.ts) 在唯一 Homer 的同一 sink 接 WeChat、Telegram，再交稳定 launcher；Telegram 复用同一 store／mainThread。关闭顺序先渠道、后 app／数据库，升级先检查 app 与两渠道安全，再停收并复查，竞态忙则在原 app 上恢复渠道。
- [dev.mjs](../scripts/dev.mjs) 提供 Telegram 管理 RPC；[web-contract.ts](../src/web-contract.ts)／[web-server.ts](../src/web-server.ts) 只增加 Telegram 分支和本地设置资源，保留已有 Web／CLI／微信。沿既有 loopback、精确 Host／Origin、JSON POST、无 query、CSP、no-store 边界；不另起 listener。main_start／main_terminal 不进入人类 stdout，避免空白／重复打印或泄露 native thread／turn。
- `app.submitMessage(input,{source:"telegram",persist(receipt)})` 的 persist 在核心 history.accept 同事务同步执行；fresh 写可信接受映射并清正文，duplicate 必须精确核对既存 origin／message／replyId／hash，无映射不认领。失败全回滚，commit 后核心才 enqueue；跨渠道／本地同 ID 在 persist 前冲突。不做 async／网络／嵌套 BEGIN，不宣称 exactly-once 执行。
- 核心真实用户事件为 `main_start`、有序 delta、`main_terminal(status)`，含 generationId／threadId／turnId／messageId／sourceRequestId。bridge 核对全部标识；terminal 与后续 reply 只生成一次正式发送。内部审阅和 Worker 不产生原生主轮事件，推理／工具参数不进入草稿。
- **本次最后修正：**普通 reply、已写为 failed 的 history 和 stop RPC ACK 均不能替代真实 terminal。引擎 closeConfirmed=false 时保留活跃 generation 与停止未确认状态；同进程历史补发跳过该活跃请求。只有匹配 main_terminal 才解除停止等待、关闭草稿；迟到旧 draft／错误 turn 不影响新轮。重启后的历史恢复仅正式投递已保存正文，不补播旧草稿、不重跑主轮。
- Worker 待答先经主 Agent 的 inspect／respond 工具恢复原等待；bridge 验证原 Run、thread／turn、pending_user 及来源。成果通过 main 的 delivery 先持久入 outbox，再由核心标记事件已接收；Telegram 真正送达仍以正式 API 回执为准。崩溃重入同 Run 保留首次持久出件，不因重新措辞重发。主停止不调用 Worker stop。

### 14.3 实际验证与迁移回退

2026-10-16 观察到：

| 检查 | 结果／证明边界 |
| --- | --- |
| `npm run build:service` | 退出 0，现有 TypeScript 服务构建通过。 |
| `npm run typecheck` | 退出 0，全项目现有严格规则通过，未降低 tsconfig。 |
| `tsx --test tests/telegram-homer-bridge.test.ts tests/telegram-atomic-acceptance.test.ts tests/telegram-engine-stream.test.ts` | 10/10；最后 bug 新增用例先复现 closed≠active 失败，再修复通过。 |
| `tsx --test tests/telegram-*.test.ts tests/telegram-*.test.mjs tests/wechat-host-upgrade.test.mjs tests/web-dev-host.test.mjs` | 46/46；包括两渠道和 Web 稳定宿主回归。不是全量 npm run check。 |
| 本地设置页浏览器 | 合成 API／内存 secrets／隔离库，连接→配对码→候选 ID→明确批准；密码字段不保留、无 local/sessionStorage。390px 实际视口无横向溢出，桌面及手机宽度截图留 scratch；这不是 Telegram 手机客户端验收。 |

维护用例均为需求推导、合成 fixture，不含真实私聊或用户反馈：[原子接受](../tests/telegram-atomic-acceptance.test.ts) 覆盖事务后半段注入失败无半条映射／主轮、重复只派一次、跨来源冲突；[生命周期 bridge](../tests/telegram-homer-bridge.test.ts) 覆盖未确认终态和停止精确匹配；[引擎协议链路](../tests/telegram-engine-stream.test.ts) 使用真实 CodexEngine 子进程协议适配器＋合成协议对端，证明 Thinking／文本增量早于 terminal、停止后同线程继续、旧停止不影响新轮、四类富结构和一次正式发送。**没有新增真实模型调用**。

[协议测试](../tests/telegram-protocol.test.ts) 覆盖两条草稿路径、寿命刷新、429、长消息、真实 multipart 字节、陌生人／群聊、回放／按钮／自然语言关联及 uncertain；[原 Worker 往返](../tests/telegram-worker-roundtrip.test.ts) 使用真实 Homer／Store／WorkerInteractions＋合成引擎，完成主升级问题→手机侧合成答复→主 respond→原 Worker 续办→主审阅成果。[设置管理](../tests/telegram-management.test.ts)、[凭据](../tests/telegram-secrets.test.ts)、[离线生命周期](../tests/telegram-channel.test.ts)、[磁盘恢复](../tests/telegram-persistence.test.ts)、[迁移](../tests/telegram-migration.test.ts) 和 [稳定宿主换版](../tests/telegram-host-upgrade.test.mjs) 证明各自边界；不冒充真实账号端到端。

实际迁移是在唯一宿主启动引擎／收件前，用 SQLite backup API 保存既存库至原 runtime/backups/telegram-before-schema-*.sqlite（目录 0700、文件 0600），随后由渠道构造执行增量 schema。备份失败或未知版本阻断，不删库。schema 已完整则不重复备份；[dev-build.mjs](../scripts/dev-build.mjs) 把 Telegram store／secrets／migration 纳入 schema hash，变化阻断自动热切，需单 owner 审核迁移。隔离 WAL fixture 验证备份一致、权限、失败无迁移；稳定宿主 fixture 验证原线程／历史、一次备份及旧进程／锁释放。未对日常 runtime 试迁移。

回退由唯一 owner 停新宿主、保存当前库、恢复受保护的一致备份与匹配旧版；不并开旧／新进程，不让旧版本解析新 schema，不自动删库或回滚用户后续输入。Keychain 与 SQLite 无跨资源事务：先写随机新项再提交引用，失败清新项；凭据不可用须明确报告，不能回落明文。备份包含私有业务数据，不能放仓库、诊断或验收材料。

### 14.4 后续本人设置与剩余验收

由统一验收 owner 在既有稳定 launcher 上开启 Web 入口，沿原配置／runtime；不要同时再启动 standalone Homer。已提供 `/settings/telegram`（默认 Web 地址若未改端口为 `http://127.0.0.1:4780/settings/telegram`）。本任务未操作日常服务；主 UI 菜单入口可由 UI owner 接入。

本人在 BotFather 创建专用 Bot → 仅在此可信本地密码框保存 token → 连接 → 生成一次配对码 → 本人普通私聊发送显示的 `/start` → 本地核对并批准具体 user/chat ID → 用合成文本测试。已有 webhook／消费者冲突只报告，不擅自清除；不在聊天索取凭据。

断开会持久保存 disabled，任务继续、成果留原绑定出件；重新连接后发送。解绑删除本机凭据并递增绑定代次，旧按钮／未发送路由失效，历史和后台任务保留。停止原生生成只针对当前主回复，取消 Worker 须另对指定 Run 操作。

**仍未验收／尚有范围差距：**统一全量 check 与实际稳定服务启动交回单 owner；真实系统 Keychain、本人专用 Bot 网络、真实 Codex＋手机两条 native draft／Thinking／停止、四类富内容呈现、文件打开及 Worker 问答授权往返仍待本人设置后验证。设置页只有 stale／uncertain 计数，没有补发／释放旧指令管理 UI，不自动重放。当前解绑后重新配对靠可信本地批准，尚未实现第 5 节所提的跨解绑、跨 Bot 的原 owner 永久归属约束，不能把该额外保护写成已完成。完整历史导出／上下文重建和通用工具迁移也不由此视为完成。真实富消息失败可保持正文可读，但降级不算富消息验收通过。

共享文件完成本次接合与检查后冻结交回 CTO／UI 单 owner，全量验收期间不再并发写入；不新增功能、不重复模型调用、不连接真实账号。原生流式／停止／四类富内容仍为首版必须，Bot 间通信明确排除。

### 14.5 真实反馈缺陷：保存按钮像没有反应（2026-10-16）

场景 `HMR-TELEGRAM-SAVE-001` 来源为用户真实反馈「本地设置点击验证并安全保存没有反应」；以下复现输入、接口、凭据和断网均为合成，不能称作用户真实 token 的失败原因已查明。

只读核查日常页面：脚本 HTTP 200、JavaScript 类型正确、5088 bytes，语法可解析；新诊断标签页已实际加载并执行模块，状态初始化完成、保存按钮可用，安全分类未发现脚本异常。未读取输入值、请求体、凭据或原尝试的网络数据，未点击真实保存／重放 configure。因此**没有证据将本次真实后端失败归因于 Telegram 网络、无效 token 或 Keychain**。

可精确复现的界面根因：提交只禁用按钮，既无进度文案也无成功回执；失败提示位于页底且不聚焦／滚动；浏览器请求没有覆盖响应正文的独立截止时间。等待、不可见失败或挂起会表现成「没反应」。旧实现还会在 busy 时先清空输入再丢弃提交。新增真实 JS 执行测试先断言失败，再修正 [telegram-settings-page.ts](../src/channels/telegram-settings-page.ts)：

- 提交立即显示「正在验证 Bot 并安全保存」，按钮显示正在验证、表单 aria-busy；请求期间禁止重复提交，开始受理才清输入。成功明确显示已验证并安全保存。
- 错误移到保存表单旁，role=alert、可聚焦并滚动到可视区；对网络、钥匙串、凭据拒绝等只显示已知稳定代码与说明，未知响应／异常不反射原文。
- 浏览器配置请求 95 秒截止覆盖已有 90 秒 RPC 回执期限，状态请求 8 秒、其他管理请求 40 秒；同时约束 fetch 和响应正文，截止后 Abort 并提示「超时、结果未确认、勿重复提交」。不延长宿主／Telegram／Keychain 超时，不声称客户端取消等于后端回滚，也不自动重试真实保存。
- 周期状态请求的迟到响应不能覆盖正在保存的进度；移除初始 action 结束后多余的第二次 GET，busy 期间不丢弃用户新输入。

[页面行为测试](../tests/telegram-settings-page.test.ts) 执行实际输出 JS，注入完全离线 DOM／fetch／时间；覆盖提交一次、即时进度、成功、稳定失败可见／聚焦／滚动、fetch 与正文挂起截止、错误脱敏和迟到状态竞争。[原管理测试](../tests/telegram-management.test.ts) 与 [凭据测试](../tests/telegram-secrets.test.ts) 继续使用本地假传输，不允许假 token 联网 Telegram。实际编译后的同源页面也在独立假管理服务中经真实浏览器验证：延迟时进度可见、模拟钥匙串失败自动滚入视口、随后合成成功显示回执，未见脚本异常；截图仅保留合成错误区域，无任何输入字段。

本轮 `npm run build:service`、`npm run typecheck` 通过；页面／管理／凭据专项 9/9，通过页面与 Web／Telegram 宿主相关回归 12/12。没有重跑此前 184 项全检，也没有新真实模型／Bot 调用。脱敏 evidence 保存在 `.codex/scratch/telegram-plan/telegram-save-*`，业务库和日常配置未改。

**安全生效边界：**当前设置资源来自稳定 supervisor 首次 import 的 web-server；child host 空闲换版不会替换此模块。仅刷新浏览器或看到 host 新版本均不能证明新设置页生效。[宿主专项](../tests/telegram-host-upgrade.test.mjs) 在隔离 runtime 先复现旧页仍被服务，再验证：空闲 `/quit` → 等进程退出且原锁释放 → 同一原配置／端口启动 launcher → 新设置页可见，原主线程和既有用户历史保留，未重跑工作。此测试使用合成引擎，不操作日常 Terminal。

实际应用由唯一日常进程 owner 协调：先确认无活动主轮、Worker、待答、保存操作和未结清／排队输入；在原稳定 Terminal 输入 `/quit`，等优雅退出及锁释放，再用原有启动命令、原配置、原 runtime、原端口启动 Web launcher。不要强杀、删锁、清库或另开竞争 Homer；重启前后由 owner 在本地核对原 mainThread。重新打开设置页，看到新进度行为后才请本人自行再点保存，只反馈页面的稳定状态码，不分享 token、截图输入或请求内容。

本轮仅修改独占页面、相关 Telegram 测试及本文，未修改共享 host／service／launcher。**日常旧页面尚未由本任务重启替换；用户真实保存成功仍待本人操作确认。**若后续要求设置资源随 host 自动更新，应先协调共享 server／launcher owner，不能把这次源码修复冒充已自动发布。

## 递归候选的正式发布边界

后续递归候选已将正式交付与内部成果分开。渠道桥只接受有持久 delivery ID、原用户来源和匹配路由的根正式 publication；附件须为该发布明确纳入的文件，并重验实际 hash/路径。父验收子结果不授予下载或外发许可，内部进度/错误/结果不会自动进入用户聊天；无文件的结构化根成果可以只交付正文。已有 uncertain 不自动重发。候选联合证据与日常未升级限制见[递归验收](15-recursive-agent-validation.md)，不能据离线通过声称真实手机附件已验收。
