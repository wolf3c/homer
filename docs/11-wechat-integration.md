# 个人微信接入 Homer

更新／发送回执官方资料复核：2026-10-17。状态：**微信渠道、原子来源映射、统一宿主生命周期与本地管理／二维码 PNG 已接合并完成隔离验证，Web 扫码组件已接入并经合成浏览器交互验证；尚未完成真实手机扫码／私聊／文件打开验收。**

## 范围与当前运行方式

用户授权参考 Cindy 的「个人微信：扫码连接个人微信，在微信私聊中与 Cindy 工作」实现 Homer 接入。采用 Tencent iLink 的二维码登录与出站长轮询，运行于用户的 Mac。无需公网服务器、云端部署、微信模拟器或桌面点按；Mac 及 Homer 服务需要保持在线。官方插件中存在文本、图片、语音、视频与文件代码，不代表本项目已经支持全部能力，也不证明任意微信账号都具有相同服务权益。

Homer 首版只接入**扫码绑定的本人私聊文字**和**已核验 Markdown 成果文件交付**，沿用现有 Files 的 128 KiB 上限。没有群聊、全部微信历史导入、任意文件读取、原生流式、富卡按钮、图片理解或语音输入。长回复按 Unicode 字符边界分段，采用保守的每段 3500 UTF-8 字节预算；这个本地预算不是宣称服务端的正式长度上限。

三入口必须共同指向原 Homer 服务、SQLite、主 Agent 和 `meta.mainThread`。微信模块没有创建 Homer、Codex、Worker 或独立对话库的代码；Worker 仍先向主 Agent 反馈，由主 Agent 决定答复、授权或必要时问用户。渠道不能直接审批或恢复 Worker。多个待答请求的自然语言含混回复仍由现有主 Agent 澄清；不会按“最近一条待答”自动批准。

当前源码入口为 [WechatChannel](../src/channels/wechat-channel.ts)、同实例宿主适配器 [HomerWechat](../src/channels/wechat-homer.ts)和[本地管理器](../src/channels/wechat-management.ts)。`dev-host` 已在原 Homer sink、同一个数据库和既有 Web RPC 接上渠道，页面组件由界面 owner 接入。**目前没有完成用户可扫码页面和真实手机验收，不能把 `npm start` 当成该入口。** 本模块不另起第二 daemon，也不操作日常 Terminal。

统一 Web 启动方式为 `npm run web -- --config <原配置>`，本地地址由启动器输出，默认 `http://127.0.0.1:4780`。已有宿主运行时不要并行启动第二个服务。本次新增依赖与 schema 会触发现有升级阻断，需要按现有服务交接流程停止原宿主后重启，不能通过改 runtime 或新建主线程绕过阻断；本任务尚未重启用户日常宿主。页面关闭不停止任务或微信轮询。

## 官方协议依据

复核的是 Tencent 官方仓库 `main` 上的文档及实际客户端，包版本为 2.4.10；源码中的可选字段不是服务端完整契约。Homer 声明自己的 `Homer/0.1.0`，不冒称 OpenClaw 运行时。

- [官方 README](https://github.com/Tencent/openclaw-weixin)：扫码登录、长轮询与媒体能力入口。
- [中文协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md)：方法、鉴权、消息与 CDN 流程。
- [二维码实现](https://github.com/Tencent/openclaw-weixin/blob/main/src/auth/login-qr.ts)：固定授权基址、状态、重定向和手机验证码分支。
- [API 实现](https://github.com/Tencent/openclaw-weixin/blob/main/src/api/api.ts)与[字段类型](https://github.com/Tencent/openclaw-weixin/blob/main/src/api/types.ts)：应用头、Bot Bearer、base_info、收件游标、uint64 消息 ID。
- [媒体上传](https://github.com/Tencent/openclaw-weixin/blob/main/src/cdn/upload.ts)、[CDN 传输](https://github.com/Tencent/openclaw-weixin/blob/main/src/cdn/cdn-upload.ts)、[消息构造](https://github.com/Tencent/openclaw-weixin/blob/main/src/messaging/send.ts)：AES-128-ECB／PKCS#7、CDN 加密参数、文件项与密钥编码。

首次二维码请求是 `POST https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3`，JSON `local_token_list: []`，不复用 Cindy 或其他程序的 token。状态通过 `GET /ilink/bot/get_qrcode_status` 轮询，支持 wait／scaned／expired／confirmed、服务器重定向、手机显示的验证码及验证次数阻断。二维码在内存中最多保留五分钟；过期只能重新发起。`binded_redirect` 不含新凭据，不能凭这个状态冒称 Homer 已绑定；已有本地连接可明确重连。

登录确认须同时具备 bot token、Bot ID、扫码人 `ilink_user_id` 和合法 HTTPS base URL。Homer 把扫码人 ID 作为 owner，不接收陌生人首条消息认领。之后调用 `POST /ilink/bot/getupdates` 和 `POST /ilink/bot/sendmessage`，回复必须使用对应入站消息的 `context_token`。消息 ID 先无损解析为字符串，避免 uint64 浮点舍入导致误去重。

发送回执的[官方类型](https://github.com/Tencent/openclaw-weixin/blob/main/src/api/types.ts)将 `SendMessageResp.ret` 与 uint64 `message_id` 列为可选；[官方发送实现](https://github.com/Tencent/openclaw-weixin/blob/main/src/api/api.ts)只在非零 `ret` 时拒绝。Homer 接受明确的 `ret:0`，也接受省略 `ret`、但具有合法 uint64 服务端 `message_id` 的 HTTP 成功回执；不是只要 HTTP 200 就成功。非零 `ret/errcode` 仍拒绝；缺少成功证据、损坏状态或 ID 字段、畸形 JSON、读回执失败、网络中断及 HTTP 5xx 仍为未知。数值 ID 先无损转字符串，不把客户端 `client_id` 当成服务端确认。

发送失败只输出固定结构诊断：`event=wechat_send_failure`、阶段 `transport/http/response/api/receipt`、原稳定错误代码和 `uncertain`。不输出正文、ID、Token、URL、响应体或原异常；诊断写入失败不改变发送结果、不触发重试。数据库仍保存原错误代码，不把阶段拼进旧事实。此修复不改变既有 uncertain 行，不能据潜在误判推断原六条的真实送达或根因。

本机 Cindy 参考只读取 `/Applications/Cindy.app/Contents/Resources/app.asar` 内相关静态片段，核实了固定扫码基址、加密凭据、代次隔离与收件游标设计；未读取其用户数据／聊天／账号 token，未复制源码。与 Cindy 按微信建立新会话的做法不同，Homer 必须绑定现有主线程。

## 持久收发和安全边界

[WechatStore](../src/channels/wechat-store.ts) 接收现有 `Store.db`，以增量事务创建 `wechat_connection`、`wechat_inbox`、`wechat_outbox` 与仅存本连接清理引用的 `wechat_secret_refs`。不修改／复制原对话表。业务输入进入原服务并完成持久接收后，收件箱清空暂存正文，仅保留路由关联；最终产品历史由统一宿主保存。所有内容保存在私有 runtime，不是诊断日志。

- owner、目标 Bot、私聊、消息类型、完成态和上下文先核对，再存业务消息。陌生人、错误 Bot 和群消息不存正文，不交给模型。尚未接入的媒体会给已绑定本人一条明确文字回执。
- 同一事务保存合规收件和下一 cursor；写入失败回滚 cursor。重连／重复投递沿 Bot ID 与消息 ID 生成相同 requestId，不能重复交办。输入已被原服务处理中断时，不生成新 ID 重跑 Worker。
- 每条输入固定自己的 context_token，后台交付按 Run.sourceRequestId 回到原输入。不会取某私聊最新 token 来回复另一项任务，也不镜像 CLI／Web 的所有私密内容到微信。
- 最终主回复若已提交共同 history、进程却在渠道 sink 入发件箱之前中断，宿主恢复时只从可信来源映射关联的共同终态历史重建回执，使用同一 eventId 去重；不会再次运行主 Agent 或 Worker。Keychain 暂不可用则保留历史并显示错误，明确重连后再恢复排队。
- 发送前持久保存发件项和稳定 client_id。成功清除暂存 payload；结果不确定标记 uncertain，停止该事件的后续分段。重启把遗留 sending 对账为 uncertain，禁止自动重发不确定消息；独立事件仍可发送。客户端 ID 不被假定为服务端幂等保证。
- 明确业务拒绝为 failed；网络中断、未确认 HTTP、畸形成功响应或缺少明确发送成功证据归为 uncertain。不会让外部发送失败触发 Worker 重跑。
- 停用先保存 disabled 意图并递增连接代次，再取消轮询。任务继续，晚到成果可进入发件箱；重启仍停用。重连恢复当前绑定和 cursor；重新扫码建立新绑定时，不把旧绑定未送内容自动投递给新连接。
- 断开删除 Homer 本连接 Keychain 条目并使旧路由失效，保留产品任务和历史。owner 约束保留，另一个微信账号不能继承原主线程。任何停用／断开／失效后的旧扫码、旧轮询或旧保存回调都不能恢复连接。已经发出到网络的请求无法撤回，状态不确定会被保留。

[MacWechatSecrets](../src/channels/wechat-secrets.ts) 使用系统 Keychain 的专属 `Homer.Wechat.v1` 条目。token 与随机数据加密密钥仅在进程内和 Keychain，stdin 写入，不放在 argv、配置、SQLite、日志、模型上下文或浏览器持久存储。SQLite 的 context 和待发能力项再用 Keychain 数据密钥作 AES-256-GCM 加密。Keychain 不可用时明确失败，不回落到明文文件。条目写入前登记本 runtime 的专属引用；弃用条目删除失败保留引用，重启仅重试这些本连接登记的弃用条目，不遍历或删除用户其他 Keychain 数据。

服务器提供的 API／CDN／二维码 URL 只接受 HTTPS、微信域名、默认端口、无用户密码，HTTP 重定向禁止自动跟随；CDN 上传不携带 Bot Bearer。所有对外错误为稳定代码，不拼接响应体、凭据、URL 查询或原始消息。

## 成果文件

宿主根据 runId 和现有授权／状态调用 Files 核验成果，再返回 `{ filename, bytes }`；微信渠道没有任意本地路径读取接口。上传前再次确认 `.md` 文件名、非空内容和 128 KiB 边界。

传输计算明文大小／MD5，生成随机 16 字节 AES 密钥，先申请 media_type=3 的上传参数，再以 AES-128-ECB／PKCS#7 加密字节上传 CDN。只有 HTTP 200 且具有 `x-encrypted-param` 才构造正式 file_item；密钥以十六进制文本再 base64 的官方发送格式进入媒体引用，文件名和原文字节大小随文件项发送。没有把本地路径当作附件。附件上传或发送未确认时明确保留原成果，给本人发诚实的交付状态回执，不声称附件已送达、不重跑原任务。fixture 已独立解密核对原始中文／emoji 字节；**真实手机收文件与打开尚待扫码后验收**。

## 给统一宿主的接口

```ts
// app 是宿主已有的唯一 Homer。构造 sink 由宿主组合此回调；
// 目前 Homer 本身没有 onMessage 订阅 API。
const wechatHost = new HomerWechat(app);
await wechatHost.restore();
// 原 sink 内 await wechatHost.onMessage(message);
const wechat = wechatHost.channel;
```

`submit({requestId,text,origin})` 必须在原服务幂等持久接收后返回，复用单个主队列和原产品历史。origin 由渠道注入 `{channel:"wechat", bindingGeneration, botId, peerId, messageId}`，宿主必须在可信内部调用中持久关联；Web／CLI 公共输入不能自行传入这份可信来源。`wechat:` 请求前缀只辅助识别，不构成身份或授权证明。普通微信回复和带 interactionId 的自然语言回复都走主 Agent，渠道不自行解析“同意”并批准待答。

适配器在相同 `app.store.db` 增量创建 `wechat_homer_receipts`，只保存可信收件 requestId 与共同历史 replyId 的引用，不另存正文或任务完成事实。只有 origin 与当前绑定、owner、Bot、原消息 ID 及待提交正文全部相符，才调用 `app.submitMessage`；已被其他入口接收且没有微信回执映射的 ID 一律冲突。可见事件从此持久映射授权，通过 Run.sourceRequestId 路由；CLI／Web 前缀不会取得微信来源。成果接口先检查成功状态、原来源及原请求，再经 Files.verify 从已打开文件读取内容，返回已核验的实际字节，不凭模型给出的任意路径读取。

原子接收已采用 core owner 提供的 `app.submitMessage(input, {source:"wechat", persist(receipt)})`：source 进入共同输入幂等身份，persist 在共同 history 同一事务内同步登记引用，抛错整体回滚，提交成功后才排主轮；HTTP／模型不能传入此回调或任意 origin。重复接收必须已有同一绑定、owner、原消息 ID 和共同 replyId 的来源映射，没有映射时拒绝认领；Web／CLI／Telegram 使用同 ID 也不能取得这份来源。故障注入测试已证明登记失败时共同输入、两条历史消息和来源映射全部回滚，主 Agent 启动次数为零。

宿主把完成后的主 Agent 可见内容交给：

```ts
await wechat.publish({
  eventId, requestId, type, text,
  interactionId, artifactRunId,
});
```

eventId 必须由宿主持久稳定定义，重播不变；交付和待答由宿主先通过 Run.sourceRequestId 解析原来源。publish 先事务入发件箱再返回，不等待网络发送；未关联微信收件的 event 返回 false，不改投其他入口。type 限 reply／question／delivery／error；内部 Worker 工具流和模型思考不得直接转发。artifactRunId 只有已核验成功成果才能传入。

本地可信管理调用为 `beginLogin()`／`pollLogin(id, verifyCode?)`／`status()`／`disable()`／`reconnect()`／`disconnect()`。二维码及必要手机验证码只经既有同源管理接口临时往返，不进入模型工具或聊天历史。UI 按最近 [DESIGN.md](../ui/DESIGN.md) 由界面 owner 接入，不新增微信伙伴或第二主聊天。

管理接口复用现有 loopback HTTP server 的远端地址、Host、Origin、Sec-Fetch-Site 检查及 `Cache-Control: no-store`；POST 必须具有当前同源 Origin 和 JSON Content-Type。

| 方法和路径 | 输入／返回 |
| --- | --- |
| `GET /api/channels/wechat` | 状态 `{status,enabled,bound,generation,pending,uncertain,failed,error?,login?}`；不含 owner、token 或原二维码 URL |
| `POST /api/channels/wechat/login` | JSON `{}`；返回 `{id,status,expiresAt?,imagePath?,error?}` |
| `POST /api/channels/wechat/login/poll` | `{id,verifyCode?}`；返回同一登录视图，verifyCode 为手机显示的 4–12 位数字 |
| `GET /api/channels/wechat/login/{id}/qr.png` | 有效 wait／scaned 会话的 320px PNG；终态、过期、停用、换登录或宿主重启后旧入口失效 |
| `POST /api/channels/wechat/disable` | `{}`；停用但保留绑定及后台任务，返回状态 |
| `POST /api/channels/wechat/reconnect` | `{}`；明确重连已有绑定，返回状态；无凭据时报错 |
| `POST /api/channels/wechat/disconnect` | `{}`；清理 Homer 本连接凭据，保留 owner 约束和任务，返回状态 |

响应成功为 200；业务状态冲突为 409／稳定错误代码，跨源或错误 Host 为 403。前端应按 `imagePath` 显示本地 `<img>`，不要取远程 QR URL，也不要存入 localStorage。官方二维码轮询允许 35 秒等待，登录确认还需 Keychain 写入及读回，宿主将此管理 RPC 与普通快速 Web 请求分别限时；超时显示未确认并查询现有状态，不自动创建另一个登录。PNG 使用本机 [qrcode 1.5.4](https://github.com/soldair/node-qrcode/tree/v1.5.4) 编码，不调用外部二维码服务，不写磁盘或 public。Node 最低要求见其[包声明](https://github.com/soldair/node-qrcode/blob/v1.5.4/package.json)，本项目仍固定 Node 22.22.0。

服务关闭必须在 Store.db 关闭前 `await wechat.close()`，取消网络循环并等待旧回调完成；之后关闭原 Homer。关闭后主服务最后的可见结果仍可持久排队，但不恢复发送。浏览器关闭只断开页面，不能调用 close 或 disable。

开发快照递归包含 src 内渠道模块；schema 兼容指纹已经纳入 `src/channels/wechat-store.ts` 和 `src/channels/wechat-homer.ts`。扫码／验证码等待未终结时阻挡自动交接；原 Worker 待用户回答仍由核心安全边界阻挡。升级最终检查前先停止渠道收件，再次检查原队列是否安全，竞态中已接受新输入时恢复同一 Homer 的渠道而非另建 Homer。旧 Web RPC、stdout 回执、主线程可恢复检查、动态候选静态资源及未确认请求不重放规则继续保留。

## 已执行验证与剩余验收

2026-10-17发送回执顺序增量：先RED复现合法ID回执被误判、损坏状态字段处理及阶段诊断缺失，再GREEN；微信相关44/44通过，最终 `npm run check` 构建/类型检查及308/308通过，exit0。新增3项测试涵盖可选ret、无损uint64、空/损坏/溢出状态、明确拒绝、断网/HTTP失败、固定阶段诊断及诊断sink抛错不改变发送结果。独立真实Node子进程以fake fetch验证6种回执和默认stderr诊断，零真实网络/账号。六条既有uncertain只读逐行hash仍相同；未重发或标送达。证据在`.codex/scratch/wechat-send-receipt/`。这与下述历史批次分别计数，源码修复没有装入日常0254构建。

全部离线输入为需求推导／合成数据，不含真实微信私聊或真实凭据。2026-10-16，宿主适配器新增前的完整 `npm run check` 通过 build／typecheck 和 148/148 测试。此次宿主接合后 build 和全项目 typecheck 通过，一次相关回归为 54 项／53 通过；全部 38 项微信用例和开发／Web 宿主升级用例通过。当时唯一失败为 UI core owner 负责的 `tests/web-history.test.ts:48` 可见 Markdown 引用 `quote_source_mismatch`；**此旧 RED 已由 UI owner 修复，CTO 回告其相关 focused 11/11 通过**，微信任务没有修改该共享源码或重跑已过检查。之后补充“共同历史已提交、sink 未到达”的恢复回归，适配器与管理接口 6/6 focused 通过。上述分别为各阶段实际结果，不代表 Telegram 后续共享接合完成后的最终全检查；最终整合 owner 统一收口，真实手机验收仍未完成。

- `tests/wechat-api.test.ts`：固定二维码 POST、无 token 起步、鉴权、URL 边界、uint64 ID、发送不确定及失效。
- `tests/wechat-store.test.ts`：主人拒绝替换、陌生人不存、重复 update、原 context、cursor 事务回滚、旧代次、发件对账与长文本。
- `tests/wechat-channel.test.ts`：扫码过期、确认幂等、停用和 secret 保存竞态、延迟原路交付、失效／断线、停用重启、多个待答、关闭后排队。
- `tests/wechat-files.test.ts`：官方文件项、AES 解密字节核对、CDN 参数、无 Bearer 上传、Files 大小／类型边界和缺响应头失败。
- 本机 Keychain 使用新随机专属条目存合成内容，写入／读回成功并已删除该合成条目，没有查询既有用户凭据。
- `tests/wechat-service.test.ts`：合成引擎下同一个 Homer、同 SQLite、一个主线程和两个原 Worker；Web／CLI／微信续聊、模糊同意澄清、按真实 UUID 回原 Worker、成果回原 context。此项是服务接口 fixture，不是实际统一宿主或真实模型／手机证据。
- `tests/wechat-homer.test.ts`：实际适配器与原 Homer 的合成主引擎联通；持久来源跨渠道实例重建、原子登记失败回滚且零主轮、跨渠道冲突、拒绝伪造与 Web 请求冲突、不转发 CLI 前缀或内部流、Run 原来源交付、Files 实际字节与附件、稳定事件去重、断开旧绑定失效、共同终态历史恢复回执而不重跑主轮。未创建第二 Homer 或调用真实模型／外网微信收发。
- `tests/wechat-host.test.ts`：同源管理路由、真实 PNG 头／宽度、JSON 不含原 QR 载荷、过期／停用／新会话使旧图失效、跨源和查询参数拒绝。
- `tests/wechat-host-upgrade.test.mjs`：隔离 runtime 中真实 supervisor／宿主／SQLite 与合成 Codex／iLink；扫码等待不升级，停用后交接保留原主线程和唯一原输入；disabled 跨宿主恢复、旧图失效、原进程退出和锁释放，微信 schema 变更阻断。此项未进行真实扫码或访问实际私聊。
- 本机 iLink 公共基址 HTTPS 可达；实际通过 WechatApi 无鉴权创建二维码，返回合法 `liteapp.weixin.qq.com` 链接，二维码仅在进程内用后丢弃，没有扫码登录／保存 token。创建成功不等于用户手机收发已验收。

测试命令（Node 22.22.0）：

```sh
node node_modules/tsx/dist/cli.mjs --test tests/wechat-*.test.ts tests/wechat-*.test.mjs
```

最终须在宿主整合后执行项目相关全检查、原 mainThread 三入口连续性、原 Worker 待答恢复、页面关闭不断任务、升级保留等待状态，以及用户手机亲自扫码确认后的本人文字往返和 Markdown 文件打开。不能用合成 fixture 冒称手机已接通，也不向第三方发送测试消息。验证数量和最新结果在后续接通时更新。

## 递归候选的正式发布边界

后续递归候选已将正式交付与内部成果分开。渠道桥只接受有持久 delivery ID、原用户来源和匹配路由的根正式 publication；附件须为该发布明确纳入的文件，并重验实际 hash/路径。父验收子结果不授予下载或外发许可，内部进度/错误/结果不会自动进入用户聊天；无文件的结构化根成果可以只交付正文。已有 uncertain 不自动重发。候选联合证据与日常未升级限制见[递归验收](15-recursive-agent-validation.md)，不能据离线通过声称真实手机附件已验收。
