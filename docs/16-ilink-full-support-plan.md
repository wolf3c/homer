# Homer iLink 完整支持方案

日期：2026-10-16；实施更新：2026-10-17。状态：**实施中，P0/P1 已阶段上线，P2–P6 候选继续验证；未全量验收**。目标依据：用户要求完整实施并更新。最新阶段证据与未完成项见 [iLink 实施验收记录](21-ilink-implementation-validation.md)。下文“当前基线”是开工时记录，以实施验收记录区分候选与日常事实。

## 1. 完整支持的定义

目标是把公开客户端体现的接口、消息及媒体生命周期全部纳入兼容和验收清单，而不是只把图片放进文字提示词。验收分四层：协议编解码、Homer 宿主接合、实际模型处理、真实微信手机收发。四层分别记录，不能用单元测试代替真实手机证明。

按公开官方插件已经实现的能力提供可用产品路径；对只有类型定义、缺少成功客户端路径的能力安排专门验证，成功后启用。若受服务端或账号限制，保留协议实现、明确状态和验证证据，整项记为受阻，不能通过隐藏按钮宣称“完整支持”。

公开资料没有证实的群聊、历史导入、消息编辑/撤回、已读回执、任意联系人主动触达，列入边界登记，不虚构接口。服务端未公开的完整微信能力不属于可作保证的交付目标。当前只服务扫码绑定本人；多人、多账号和群聊需要另行授权与身份设计，不能借媒体接入扩张。

原生语音发送、带引用出站、缩略图上传均纳入兼容验证，不因官方常规发送器尚未实现就永久排除。视频和语音的协议传输与内容理解分别实现。收到未知编码仍可安全保留和交付原文件，但不能称已经理解。

## 2. 核查来源与现有基线

### 2.1 官方来源

核查的是 Tencent/openclaw-weixin 的 main；本次 package.json 为 2.4.10。main 是可变引用，正式实施开工需记录当时 commit、文件 SHA256、包版本与核查日期；与本文不同时更新兼容矩阵，不静默套用。仅使用公开文档及源码，不读取其他程序的账号或凭据。

| 来源 | 用途 |
| --- | --- |
| [官方包元数据](https://github.com/Tencent/openclaw-weixin/blob/main/package.json) | 版本与运行要求 |
| [中文协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md) | 接口总览与公开范围限制 |
| [API 实现](https://github.com/Tencent/openclaw-weixin/blob/main/src/api/api.ts) | 请求构造、响应及超时 |
| [字段类型](https://github.com/Tencent/openclaw-weixin/blob/main/src/api/types.ts) | 消息、引用、媒体与枚举 |
| [二维码登录](https://github.com/Tencent/openclaw-weixin/blob/main/src/auth/login-qr.ts) | 登录分支与重定向 |
| [入站处理](https://github.com/Tencent/openclaw-weixin/blob/main/src/messaging/process-message.ts) | 媒体选择与宿主提交 |
| [入站引用](https://github.com/Tencent/openclaw-weixin/blob/main/src/messaging/inbound.ts) | 文字、语音转写、引用上下文 |
| [媒体下载](https://github.com/Tencent/openclaw-weixin/blob/main/src/media/media-download.ts) | 下载、密钥与解密 |
| [上传实现](https://github.com/Tencent/openclaw-weixin/blob/main/src/cdn/upload.ts) | 上传意图、加密及响应 |
| [媒体发送分流](https://github.com/Tencent/openclaw-weixin/blob/main/src/messaging/send-media.ts) | 图片/视频/文件实际发送边界 |
| [出站消息构造](https://github.com/Tencent/openclaw-weixin/blob/main/src/messaging/send.ts) | 文本和媒体项及发送收据 |
| [工具进度](https://github.com/Tencent/openclaw-weixin/blob/main/src/messaging/reply-progress-sender.ts) | 开始/结束进度与合并 |
| [渠道定义](https://github.com/Tencent/openclaw-weixin/blob/main/src/channel.ts) | 输入中、启停和私聊能力 |
| [引用缓存说明](https://github.com/Tencent/openclaw-weixin/blob/main/docs/quote-cache_zh_CN.md) | 引用保留、容量和失效 |

官方明确：文档来自客户端类型和行为，不是完整服务端契约。字段可选不等于服务端允许省略；存在字段不等于功能可用。本文采用这个证据边界，不逐字复制官方实现。

### 2.2 Homer 当前实际代码

- [wechat-api.ts](../src/channels/wechat-api.ts)：已有扫码、轮询、文本发送与 uploadMarkdown；没有通用媒体下载、配置/输入中和启停通知。
- [wechat-store.ts](../src/channels/wechat-store.ts)：accept 仅在所有 item 都为 text_item 时接受内容；图片与配文会一起走 unsupported。原 owner、代次、游标原子提交及 outbox uncertain 保护必须保留。
- [wechat-channel.ts](../src/channels/wechat-channel.ts)：提交给宿主的是文字；缺少附件准备、恢复和引用解析。
- [wechat-homer.ts](../src/channels/wechat-homer.ts)：同一宿主和来源映射已接通；正式成果仍遵守递归 publication 授权。
- [engine.ts](../src/engine.ts)：EngineLike.turn 输入是 string，原生输入只有 text。模型能看图不代表此适配层已传入图片。
- [web-history.ts](../src/web-history.ts)、[web-contract.ts](../src/web-contract.ts)：历史及队列尚无通用附件输入契约。
- [files.ts](../src/files.ts)：Markdown 成果接口不等于通用上传、文档解析或二进制发布系统。

原有 16000 字输入、3500 UTF-8 字节出站分段、128 KiB Markdown 上限是 Homer 自身策略；不是腾讯统一上限。旧文本历史、quotes/quote、原 requestId/hash、主线程及未确认发件记录均须兼容。

当前记忆/递归已交出通过离线检查的候选，真实模型隔离鉴权和日常更新仍待验收。本文不能把这些候选状态写成已上线，也不启动新测试线程或修改日常服务。

## 3. 全量兼容与验收清单

### 3.1 API 与公共行为

所有路径相对已校验 API 基址。表中“保留”包含回归和补齐，不能认为旧实现不再需要验收。

| ID | 方法和路径 | 当前 | 目标行为与验收 |
| --- | --- | --- | --- |
| API-01 | POST /ilink/bot/get_bot_qrcode?bot_type=3 | 已有 | 保留登录、过期刷新及本地展示；Homer 无需上传其他应用的 token |
| API-02 | GET /ilink/bot/get_qrcode_status | 已有 | 验证码、重定向、绑定状态；只有完整成功凭据才提交绑定 |
| API-03 | POST /ilink/bot/getupdates | 已有文字 | 全消息项规范化、长轮询、游标与收件原子持久、取消/退避 |
| API-04 | POST /ilink/bot/sendmessage | 已有文字/MD | 7 类项的方向校验、稳定操作身份、对应上下文与持久发送事实 |
| API-05 | POST /ilink/bot/getuploadurl | 仅MD文件 | 图片/语音/文件/视频上传及缩略图验证路径 |
| API-06 | POST /ilink/bot/getconfig | 缺少 | 获取并限时缓存配置；按绑定隔离，失效不影响业务 |
| API-07 | POST /ilink/bot/sendtyping | 缺少 | 输入中与取消，绑定/上下文/票据正确，结束与停止清理 |
| API-08 | POST /ilink/bot/msg/notifystart | 缺少 | 当前渠道实例启动后尽力通知，不冒称消息已收 |
| API-09 | POST /ilink/bot/msg/notifystop | 缺少 | 正常停止尽力通知；崩溃不可能保证送达，不阻塞关闭 |

公共层保留请求鉴权、应用版本和 Homer 自己的 agent 标识；不冒充 OpenClaw。区分 HTTP 错误、业务错误、超时、取消、会话失效。-14 等失效码进入明确暂停/需恢复状态，不热循环；重试策略由操作是否可重复决定，不能给所有 POST 套同一自动重试器。

登录状态保留 wait/scaned/confirmed/expired/need_verifycode/verify_code_blocked/scaned_but_redirect/binded_redirect 全分支。重定向需检查来源、目的域、次数和凭据边界；binded_redirect 不提供完整新凭据时不能伪造绑定成功。

### 3.2 消息、媒体和扩展

| ID | 内容 | 当前 | 完整目标 |
| --- | --- | --- | --- |
| MSG-01 | type=1 文字 | 已有 | 收发、Unicode 分段、空值/超长和幂等 |
| MSG-02 | type=2 图片 | 无 | 原图/缩略图引用接收，安全下载，多图模型输入和图片发布 |
| MSG-03 | type=3 语音 | 无 | 原音频、转写、编码/时长信息；原生语音发送专测 |
| MSG-04 | type=4 文件 | 只发MD | 任意允许类型安全收存，已支持格式解析，正式二进制成果交付 |
| MSG-05 | type=5 视频 | 无 | 收发、预览信息、按实际模型能力分析并标明覆盖片段 |
| MSG-06 | type=11 工具开始 | 无 | 正确编码；只发送用户可理解的必要进度 |
| MSG-07 | type=12 工具结束 | 无 | 与开始配对、合并和限频，失败不影响最终成果 |
| EXT-01 | item_list 组合 | 仅纯文字 | 入站逐项保留顺序、附件和引用；不静默只取第一张图 |
| EXT-02 | ref_msg 引用 | 无 | 内联、ID、部分文字与媒体入站；出站引用专测 |
| EXT-03 | message_state 等状态 | 只取完成 | 识别状态，非完成项不提前采用；实际增量流式另验证 |
| EXT-04 | CDN 上传/下载 | 仅MD上传 | 完整资源状态、密钥编码、断点恢复、重试与权限 |
| EXT-05 | 缩略图字段 | 无 | 入站解析、可选预览；上传路径专测，不以原图冒充缩略图 |

消息类型与上传类型不同：建立显式双向映射，不直接复用整数。消息 ID、item ID、引用服务端 ID 保持字符串，兼容 wire uint64，无浮点转换。官方协议表与最新类型不一致时，按实际解析/类型及合成向量核查并登记差异。

群聊、撤回/编辑、已读、历史接口、任意主动联系人和服务端逐 token 流式没有已证实契约。兼容其已知字段不代表开放对应产品功能；未知字段忽略或安全保留最小信息，未知类型明确不支持，轮询仍可继续。

## 4. 总体架构与共享契约

沿用一个 Homer 服务、SQLite、主 Agent、递归 Task/Run、agent_messages/receipts 和主 FIFO。附件准备是 I/O 资源任务，不再创建第二个 Agent 或聊天库。

目标主路径：

```mermaid
flowchart LR
  A[微信更新] --> B[绑定校验与原子收件]
  B --> C[有序消息项与附件准备]
  C --> D[原历史与主队列]
  D --> E[主Agent与授权Worker]
  E --> F[验收与正式publication]
  F --> G[媒体上传与持久outbox]
  G --> H[微信手机]
```

拟增加 MediaStore/MediaTransfer 负责资源归属、文件落地和传输；WechatCodec 负责消息规范化；EngineInputResolver 负责将已授权输入变成引擎原生项。名称是职责建议，不为每种媒体复制一套状态机，也不添加只有转发作用的抽象层。

统一内部输入新增有序 parts，至少区分 text、attachment、quote，并给每项稳定 ID。历史仍是正文/附件关联的唯一来源；主队列只存其 requestId/revision/hash 与领取事实。旧 quotes/quote 保留原语义，新微信引用转换后仍带来源类型，不用网页 messageId 伪装远端 ID。

EngineLike.turn 从 text-only 扩为显式的文本与资源输入契约，调用方、fake engine、steer、恢复和测试同步升级。固定 Codex 版本需先核查原生 image/localImage 参数及支持格式，再通过隔离探针验证；不能为了可看图开放整个 runtime 或用户目录。CLI/TG 旧文本输入保持兼容，本方案不顺带开放它们的上传入口。

产品能力由当前运行版本、渠道实现、模型能力和启用配置合成，维护一份事实源。每项返回 available/limited/unavailable/verifying 及可理解原因，供主提示和 Web 读取；能力查询不依赖模型猜测。发布源更新后才更新用户承诺，不能用开发候选能力描述旧日常进程。

## 5. 数据模型、事务及资源生命周期

### 5.1 建议表与约束

复用现有 Store.db；以下为实施前须评审的建议结构，不在本轮执行 DDL。

| 表/扩展 | 主要内容 | 约束与归属 |
| --- | --- | --- |
| media_assets | id、owner/binding、kind、检测MIME、大小/hash、存储引用、资源revision、状态、保留期限 | ID 稳定；不把远程URL当文件路径 |
| media_sources | assetId、渠道消息ID、item序号、方向、加密传输材料引用 | UNIQUE(bindingId,messageId,itemIndex,direction)；敏感字段加密 |
| conversation_parts | history messageId、输入revision、顺序、类型、text/assetRef/quoteRef | 正文仍归history，队列不复制第二份 |
| media_jobs | source/asset、阶段、attempt、下次重试、lease、最后分类错误 | 同资源阶段唯一活动作业，领取CAS |
| quote_sources | binding、providerId、方向、hash、正文或assetRefs、期限 | 只查当前owner；本地已发消息在收到server ID后登记 |
| media_uploads | publication/fileResult、binding、上传阶段、媒体引用、操作hash | 与最终发送分别记录；材料加密存储 |
| outbox扩展 | kind、asset/upload引用、稳定part、clientId、结果及server ID | 同操作不同载荷拒绝，旧uncertain不改写 |

原始下载密钥、context_token、票据和带鉴权URL不进入普通历史、模型上下文或日志。资源摘要用于完整性，不作为跨账号共享命中的接口。存储敏感字段沿用现有私有数据保护机制；AES-ECB仅用于协议传输，不替代本地保护。

### 5.2 原子边界

1. 先做 owner/Bot/代次/方向校验；拒绝项不保存私人正文。收件记录、附件来源意图与游标同事务提交，此时即可确认“已收到”，不声称模型已看见。
2. 下载、解码、解析不占数据库写事务。私有临时文件有上限，校验后原子重命名，再以lease/revision CAS提交 ready；崩溃用意图核对，不能假设磁盘和SQLite同一事务。
3. 历史接收、渠道来源映射、队列accept保持现有同步回调事务。资源尚未齐备的队列项处于 preparing；claim必须在原事务中检查附件集合/revision、startRequest和memory.adopt，不能提交后再补授权。
4. 排队edit/cancel与附件授权、来源刷新/撤销同事务；已采用输入不允许原地改图。相同requestId/hash重试返回原收据，附件变化必须新revision/操作，不复活已撤回输入。
5. publication授权、文件hash、输入来源、Run epoch及记忆失效仍共同校验；下载与外发不能绕过内部验收。上传本身不能授予发布权。

### 5.3 状态和顺序

附件：received → downloading → ready；失败区分 retryable_failed、failed、expired、deleted。解析/转写是独立派生状态，不把“文件可下载”误写成“文字已提取”。下载重启可安全重试，lease到期只有确认旧任务失去写权后才能接管。

主队列：preparing → queued → processing → terminal。为保持默认FIFO，前项准备中时后项不悄悄超车；资源失败需形成明确失败/部分处理决定并解除阻塞。“打断并发送”须等新输入确实可被持久接收，再按准确generation协议停止，不在附件损坏时丢失原任务。

任一附件失败保留其在消息中的位置并展示错误；默认不把残缺图文当完整指令执行。允许用户明确选择“只处理已就绪部分”，该选择作为新revision/决定记录。不能无期限卡住收件轮询或自动补出不存在的图片说明。

取消后立即撤销任务读取授权，后台传输回包必须检查cancel/lease/revision；物理文件清理由引用与保留策略决定，不能因某项撤回删掉其他合法历史仍用的资源。

## 6. 媒体下载、上传与发送可靠性

### 6.1 下载与解密

按官方实现处理完整URL与加密参数回退，图片专有hex密钥优先，再处理媒体base64密钥的两种合法编码。AES-128-ECB/PKCS#7使用可验证合成向量，坏padding、缺密钥、长度异常立即分类失败。图片的合法无密钥明文分支必须用内容证实，不能把所有解密失败数据当明文接受。

下载限制覆盖字节流、重定向、解密后大小、像素和派生输出。预检Content-Length不能替代读取过程限额；忽略不可信扩展名。只允许经核查的官方API/CDN与必要重定向，拒绝localhost、私网、非HTTPS和凭据跨域；URL不得直接交模型获取。

接入单独的资源准备并发/磁盘配额，避免大视频饿死文字回复。重试有attempt上限、指数退避和抖动；会话失效不反复刷新账号，网络可重试错误与永久格式错误分开。

### 6.2 上传与发送

对正式文件验证内容hash和大小，再生成独立上传意图、随机key/filekey、明文MD5及填充后大小。申请地址、加密上传、验证成功响应与媒体参数，最后才构造sendmessage。引用[官方上传实现](https://github.com/Tencent/openclaw-weixin/blob/main/src/cdn/upload.ts)验证实际字段，不复制其所有重试策略。

上传阶段与消息发送阶段分离：upload_pending → uploading → uploaded；send_pending → sending → accepted 或 uncertain/failed。accepted只代表接口接受，不是对方已读。上传超时可在明确策略下重新上传，但最终发送超时不得自动重发；稳定client_id不是服务端幂等保证。

文字说明与媒体先沿已证实的独立请求发送，每part有稳定身份和顺序。前part结果不确定时阻挡同事件后part，显示部分完成；不声称图文跨请求原子发送。任意组合item_list出站须另测，成功前不能直接依赖数组类型推断支持。

取消/记忆失效/撤销发布发生在上传中，上传可清理，最终发送必须重查授权；真正请求已经发出不能伪称已撤回。发送未知保留原材料和审计事实，不自动换context重投；无查询接口时人工核对属于明确剩余工作。

### 6.3 缩略图与媒体扩展验证

先完整接收入站thumb_media，作为可选低成本预览；原图授权与来源不变。实施缩略图上传专测时核对raw/encrypted大小、MD5与返回参数，不能把原图参数塞进缩略图字段。没有成功服务端证据时保留“验证中”，不影响正常原图发送，但阻挡“全协议已验收”的结论。

## 7. 各媒体的模型与产品处理

### 7.1 图片

保留原图与可追溯缩放派生图，派生记录原hash、变换版本和尺寸。先支持PNG/JPEG等固定引擎已验证格式；其他合法图片可收存，转码后再处理，不能只更改文件后缀。多图顺序与配文对应保持，模型明确知道哪些图失败。源文件包含EXIF时，模型派生文件按需要去除非必要位置等元数据。

验收用图片独有的合成文字/图形，不能把答案写在配文中代替模型看图。超分辨率/像素限额明确提示；GIF等多帧媒体要说明取帧策略，未全帧分析不宣称看过全部。

### 7.2 文件

收存与理解分开。TXT/Markdown做编码与长度验证；PDF区分文本和扫描件；DOCX/XLSX/PPTX用受维护解析器提取结构并保留页/表/单元格来源。扫描件OCR、公式缓存、嵌入图表等按实际支持显示限制；密码保护文件要求用户提供可读版本，不尝试破解。

压缩包、可执行文件及未知格式可按政策保留原件，不能自动执行、无限解压或交给宏运行时。提取正文、页图、OCR是有版本派生资源并计入配额。读取器依赖开工时选型，检验许可、大小边界及是否会联网，不为每类文档自写格式解析器。

原二进制输出增加文件manifest，与既有正式result/publication关联；核验路径、hash、MIME、授权后才能发送。MD原接口保留，禁止让通用附件能力变成任意路径读取。

### 7.3 语音

入站有voice_item.text时保留“协议转写”来源而非用户键入；原音频可异步保存，不影响已明确可用的转写路径。没有转写时下载，按实际编码能力处理SILK等格式，无法解码时准确告知已收件但不能识别。

ASR/TTS采用可替换执行器：先探测当前合法模型/宿主可用能力；需要新服务、账号、付费或向新服务发送音频时，准备具体选项和数据流后再授权，不默默引入。默认未配置时返回不可用，不伪造转写。音频派生结果保留语言、置信限制、时间段和版本，不能承诺所有编码都可解。

原生语音出站单独验证上传类型4、voice_item字段、编码/采样率/时长及微信实际播放；普通音频文件作为文件发送是降级，不算原生语音回复验收。文本答复保持可用；TTS失败不能丢失已生成文字。

### 7.4 视频

完整实现资源收发，内容分析支持经验证的原生输入或有界抽帧/音轨转写。派生帧和音轨保留时间戳，回答说明实际覆盖时段。长视频先告知限制和分段策略，不静默仅看首帧。容器元数据及解码器都在受限进程执行，有超时/内存/输出帧上限，禁止任意命令拼接。

## 8. 引用、上下文及进度

### 8.1 引用

规范化ref_msg的内联内容、服务端ID、partial_text及媒体引用；多个引用按原item归属处理。优先使用同binding下可验证来源，partial_text的文本/索引/摘要按官方算法核查UTF-16、Unicode边界及可用hash，不能仅凭客户端给的title认定引用原文。未知ID明确显示“引用来源暂不可恢复”。

入站原消息与出站服务器返回ID建立有界缓存；引用过期不抓取全部微信历史。带媒体引用也走相同下载/授权路径。引用材料属于用户提供的数据，不能借旧Bot回复继承系统权限。出站ref_msg先做专测，失败可退为显式文字引用，但记录为降级，不能称原生引用已支持。

引用缓存期限与媒体缓存分开。官方已有独立引用缓存设计；Homer的具体容量/期限由本地配额政策管理，本文不把官方默认值变成服务器保证。

### 8.2 输入中与工具进度

getconfig票据按binding/context缓存，不跨账号复用；主轮真正开始或执行用户可见工作时才发typing，结束、停止、异常和断线时尽力取消。刷新频率遵守实际测得的有效期/频控，避免常驻循环冒称仍在线。

type11/12进度只映射产品摘要和稳定run/operation，不暴露推理、工具参数、文件正文或内部未验收结果。多个子任务可合并为根事项进展，不能每个工具调用都向手机刷屏。进度失败软降级，最终答复走原outbox；不得为重试临时进度堵住正式成果。

notifyStart/Stop对应渠道实例生命周期，不对应每个模型turn。启动失败、换代、暂停、退出的通知不改变本地真实连接状态；通知成功不能把bound标成connected。

## 9. 配额、隐私与记忆/递归边界

建议首版本地安全预算（待性能与账号实测校准，不是腾讯限额）：单图20MiB/40MP、单文件50MiB、单音视频100MiB、每条最多10个媒体、每条累计150MiB；派生资源和全局磁盘另限额，超过明确失败。媒体准备默认并发2，视频解码默认1，保持主线程响应。所有数值在一处policy定义，界面和后台读取同一事实源。

私有目录0700/文件0600；预览同源授权、no-store及正确Content-Type，SVG/HTML等主动内容以下载或受限渲染处理，不直接内嵌执行。附件文件不放public，不通过未授权静态URL暴露。

默认建议：原媒体保留30天、未引用临时文件24小时；由产品配置控制且告知用户。GC先标删除/撤销授权，再清理文件；活动turn、有效publication和显式保留引用要有pin/租约。配额不足拒绝新资源并提示管理，不静默删正在使用的资源。历史保留资源已过期说明，不冒称删除了微信端/供应商历史。

主Agent只能在实际claim/adopt后使用当前revision的附件来源；记忆候选须来自可追溯提取结果并经过原验收，不能默认将图片原文、音频和所有文件永久入库。纠正/忘记继续只影响实际读取旧事实的消费者，memoryEpoch与Run epoch不混用。

Worker获得有限assetId/revision与当前scope权限；委派子级显式继承子集，禁止全附件库/整目录读取。关闭、撤回、忘记导致授权失效时，fence晚到回包，按现有stopOwnedWorker结清交互和进程，不以DB终态当进程已停。

## 10. 代码改造点及实施顺序

| 阶段 | 主要改造 | 退出条件 |
| --- | --- | --- |
| P0 基线与契约 | 固定官方版本；完整类型/错误矩阵；能力视图；附件/引擎契约；迁移预览 | 全量需求有ID，旧文本兼容，权限与真实验收入口可用 |
| P1 图片与资源底座 | wechat-api/store/channel、MediaStore/Transfer、history/queue、engine原生图像 | 手机图文/多图→真实模型；断网/重复/重启不丢不重复；能力答复真实 |
| P2 发布与文件 | 通用二进制manifest、文件接收解析、图片/文件上传、publication/三桥校验 | 手机文件可打开；未发布拒发；上传/发送未知不重投 |
| P3 语音 | 原音频、协议转写、解码、ASR/TTS执行器、原生语音发送验证 | 有无转写各闭环，原生语音可播放；降级与外部服务授权明确 |
| P4 视频与引用 | 视频处理、引用缓存/部分引用/媒体引用、出站引用专测 | 可指出视频特定时段；引用不串来源，过期明确，原生引用实测 |
| P5 通知与扩展收口 | 配置/输入中/进度/启停、缩略图上传、组合出站/状态验证 | 9API、7消息类型和扩展逐项有最终证据，限流失败不阻业务 |
| P6 发布 | 迁移演练、完整回归、手机验收、维护窗口与回退 | 证据矩阵全部满足；未知能力仍标受阻，不虚称全部通过 |

先做安全发布和资源底座，再开放模型工具；不得先放开任意文件访问后补授权。媒体接收与正式输出可以在契约冻结后分工，但共享service/store/engine/history/MCP/UI仍单owner整合，不能重现并行写到中间态反复互相验收。

原MAIN_TOOLS五工具契约不为媒体随意变更。必要附件读取/状态工具走现有自有MCP角色目录，主/Worker权限分别配置。任何工具调用携带assetId与scope，经宿主解析，模型不能提交CDN密钥或任意绝对路径。

UI沿用[设计约定](../ui/DESIGN.md)：暖灰、头像、右上微信状态，不恢复任务列表。用户消息内展示图片缩略图/文件/语音/视频及准备/失败状态；已配置绿与在线状态分开。草稿及待处理编辑支持附件与多引用，刷新恢复；输入中发送箭头及独立停止继续有效。

## 11. 可执行验收矩阵

每条维护稳定scenario ID、合成夹具、操作、预期、实际环境/版本和证据路径。下列是新增要求，不是已执行结果。

| 场景ID | 必验内容 |
| --- | --- |
| ILINK-AUTH-001 | 全二维码状态、验证码、重定向拒绝、凭据保存失败、旧代次迟到回包 |
| ILINK-API-001 | 九接口头/体/业务码/取消；uint64边界及未知字段/类型 |
| ILINK-MEDIA-001 | 图片两种key编码、图片hex优先、坏padding、明文合法分支、截断/超限 |
| ILINK-MEDIA-002 | full_url/参数回退、重定向/SSRF、流式大小限额、MIME伪装 |
| ILINK-MEDIA-003 | 游标/来源/意图事务回滚、重复batch、临时写入/rename/ready各崩溃点 |
| ILINK-QUEUE-001 | preparing FIFO、图文顺序、多图部分失败、编辑撤回CAS、claim/adopt原子回滚 |
| ILINK-QUEUE-002 | 原ID原载荷重试、新revision替换附件、丢回执刷新、打断与停止准确generation |
| ILINK-ENGINE-001 | 原生图片实际进入固定引擎；文字模型拒绝；缩放可追溯；未授权Worker读不到 |
| ILINK-FILE-001 | 文本/PDF/Office解析、扫描件/加密件、宏/压缩炸弹、公式/图表限制 |
| ILINK-VOICE-001 | 有无转写、SILK及已支持编码、ASR失败、原生语音出站播放、普通音频文件降级 |
| ILINK-VIDEO-001 | 上传/播放、抽帧时间戳、音轨转写、长视频限额、解码超时与取消 |
| ILINK-QUOTE-001 | 内联/ID/部分/媒体引用，跨binding拒绝，Unicode边界，过期/缺失明确 |
| ILINK-SEND-001 | 文件变更hash、未publication拒发、上传成功发送失败/超时、稳定part部分成功 |
| ILINK-SEND-002 | 上传中撤销发布/停止、真实请求已发送不伪撤回、旧uncertain不自动清理 |
| ILINK-NOTIFY-001 | 输入中开始/取消/票据过期、限流、启停失败、工具进度不泄露且不阻业务 |
| ILINK-EXTRA-001 | 原生出站引用、缩略图上传、组合出站、实际增量状态分别专测 |
| ILINK-LIFE-001 | pin/保留期/GC、缺文件恢复、已adopt撤权/晚到回包、活动任务不误删 |
| ILINK-UPGRADE-001 | 新旧库迁移回退、旧文本/quotes/hash/mainThread保留，正在下载/发送/未确认阻挡切换 |

真实手机验收使用无私人材料的合成样本，逐项确认接收、模型理解、手机发送与实际打开。真实模型只在独立持久会话存储和合法鉴权已证明隔离的环境执行；不再向日常Codex库创建测试对话。无模型fixture和synthetic host单列，不能冒充模型通过。

需要真实发送或新服务授权时，先给出具体账号、样本、数量、费用/数据去向和操作范围；未授权不执行。性能用代表性样本测下载、准备、首响应与资源峰值，报告本机/网络条件，不编统一延迟保证。

## 12. 迁移、发布、回退及完成标准

数据库迁移先做旧库副本dry-run，检查关联/FK、旧request哈希与source、原mainThread和outbox状态不变；新增附件字段有明确默认值。媒体schema纳入原schema guard和构建指纹。旧进程不得把新输入降为纯文字；新库写入后回退必须匹配旧二进制和维护点库备份，不能简单启动旧版继续读。

切换前暂停新收件、等待/确认活跃下载、主轮、Worker和outbox；不能绕过原 uncertain 门槛。存在发送未知记录时先核对，仅有明确人工决定才能标记处置，保留原证据；不能自动重发、当作送达或清空来换版。备份包含DB与对应资源manifest，恢复后重新核对引用，不盲重放模型/发送。

完成标准：所有API/MSG/EXT行有实现与状态；支持的产品路径有真实手机与模型证据；服务端未证实项有专测结论，不以文字降级替代原生通过；版本能力说明与实际运行一致；旧文本/记忆/递归/三渠道授权回归通过；迁移/回退演练通过；用户日常更新另行授权并实际完成。

如原生语音、出站引用等受账号/服务端阻碍，交付应写“已完成已证实公开能力，其余列为受阻项”，而不能写“完整协议验收通过”。未知协议不是实现者自行编造的接口。

本轮文档交付完成后，下一步是批准按P0→P6实施并落实隔离鉴权验收入口。本文不预先改变账号、安装解码/识别服务、创建真实线程、迁移数据库或部署。

关联：[微信现有接入](11-wechat-integration.md)、[递归协作验收](15-recursive-agent-validation.md)、[原生记忆说明](26-native-memory-feasibility.md)、[开发升级](09-development-upgrade.md)。
