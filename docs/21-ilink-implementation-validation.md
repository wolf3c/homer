# iLink 实施与阶段验收

更新：2026-10-17。**已验候选于22:12发布，日常版本 d3a575a64471，源码自动更新已恢复；完整 P0–P6 手机媒体验收尚未完成。** 当前上线范围、383项通过/2跳过、上传队列浏览器贯穿、全表迁移与回退证据统一见[已验候选发布](25-verified-candidate-release.md)。下文按实施时间保留原阶段及拒绝历史，旧“未发布/无授权/待完整check”不代表当前状态；未补齐的手机、真实模型证据仍保留。

官方核查固定 Tencent/openclaw-weixin `874637a0dbc24050f72d1385add4fc6170a2d726`、包 2.4.10。协议存在、宿主实现、模型实际理解、手机实际收发分别计证据。

## 当前阶段

P0/P1 已接入同一宿主数据库、原主线程及绑定：安全图文多图下载解密、附件状态/历史、队列准备与撤回、原生模型图片输入、同源附件读取。2026-10-17T06:41Z 已实际完成阶段维护更新，日常版本为 `9ab6864a6c45`，4780 正常接收，原 Terminal 驻留。该阶段覆盖下述媒体候选与四项界面/记忆修复；后续源码继续实施，尚未再次上线。最小本人手机双图验收等待用户动作，未新建真实测试线程或主动发送样本。

候选增加正式二进制 publication、文件成果检查、附件 scope Worker 工具、文本/PDF/DOCX/XLSX/PPTX 本地抽取、SILK 解码/本地 ASR/TTS、视频前60秒六帧/音轨分析、入站引用缓存/部分引用、getconfig/sendtyping/启停通知及附件配额/GC。图片 `mid_size` 与视频 `video_size` 使用 AES 密文长度；原生语音编码/时长在上传前校验。同事件文字和成果分片按顺序发送，未知文字发送阻挡后续成果；已持久旧事件身份保留。

已阶段上线的用户可见修复：完成消息无状态行，助手逐条头像及专用间距移除、页头 Logo 保留；单条引用输入与旧草稿无损恢复；记忆及自动保存统一常开、拒绝关闭，移除设置入口。旧配置恢复推进 epoch，保留条目与来源，不自动复活旧 Worker。

## 验证证据与局限

- 实际 SQLite/HTTP/stdio 合成宿主覆盖媒体准备/FIFO/撤回/下载失败、正式文件发布授权、上传 AES/枚举/非 CDN 拒绝、配额/GC/lease、引用 Unicode/MD5/隔离、文档实际格式抽取。
- 本地真实 TTS→SILK→PCM/WAV→Whisper ASR 能识别独有合成词语；它不证明微信手机已播放。
- 新上传前拒绝和密文长度用 RED→GREEN 复现。记忆常开迁移/拒关、旧来源保护及无关 Worker 不被误停通过专项测试。
- 605px/1470px 实际浏览器已验证双图加载、完成状态行0、助手头像0、页头Logo1、无横向溢出；单引用替换不覆盖说明，旧多引用草稿与批注完整恢复。后续阶段继续补充发送/停止/失败/断网恢复。
- 阶段冻结候选 `9ab6864a6c45` 的 `npm run check` 334/334、构建与类型检查通过。后续更改须重新检查；历史绿色不能代替新源码检查。

## 仍需完成

最新候选已写入出站引用、工具进度、图片/视频缩略图、组合交付产品入口与Web草稿上传，仍须宿主贯穿、视频解码专项、Memory实际文本来源贯穿、队列附件移除贯穿与故障恢复矩阵。局部契约证据见下文，不能将“已实现”换成“已上线/已手机验收”。音视频原生传输和模型理解分开验收。真实手机打开/播放、引用/缩略图服务端可用性尚未验证。无法完成的编码或服务端能力必须明确限制。

## 本地依赖

使用现有 ffmpeg/ffprobe、whisper-cli 和 macOS `say`，音频编码依赖 `silk-wasm@3.7.1`。中文语音选本机 Tingting、英文 Samantha，不下载新声音。可选文档隔离 Python 依赖固定在 [media-requirements.txt](../scripts/media-requirements.txt)，不执行宏、公式或外部链接。PDF最多100页/文本64000字符，音视频仅分析前60秒。

Whisper base 模型仅本机推理，无新账号或推理费用；文件 SHA256 `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`，公开来源 ggerganov/whisper.cpp commit `80da2d8bfee42b0e836fc3a9890373e5defc00a6`。模型放 `.codex/private/media-tools/models/ggml-base.bin`，Python放 `.codex/private/media-tools/bin/python3`。安装需正常授权下载，不复制任何认证材料。

日常更新必须重新建立维护点，按当时运行版本准备匹配回退，保留原数据库/线程/绑定及六条 uncertain 完整行。未知发送不重试，上传成功不等于发送成功。产品完整更新机制 docs20 仍属未来要求。

## 2026-10-17 阶段维护结果

原07c服务空闲、无待发送/待答/网关pending后正常SIGTERM，锁/lease释放。新维护点备份业务与gateway数据库、workspace成果/材料及media；匹配实际07c构建的固定回退75文件验证通过。副本8个owner迁移与离线恢复通过后，原库同法迁移，48旧表旧事实/原metadata/主thread及六条uncertain完整行保持，integrity ok/FK0。原Terminal窗口恢复9ab服务，未复制凭据、未新建真实thread、未重放unknown。

实际605px页面验证：助手头像0、完成状态行0、记忆入口0、批注输入0、页头Logo1、无横向溢出。手机双图/语音/视频真实模型验收仍待动作。维护后出现新事实时保留当前库前向修复，不能套用旧备份盲回滚。

## 阶段上线后的未发布源码

新增 `MediaStore.retainRefs` 接合队列编辑事务，删除附件时撤销其lease；沙箱内存SQLite契约RED→GREEN通过。新增 `sendItems` 组合顺序/方向/引用uint64校验，仅协议路径，尚无正式产品组合发送入口。成果实际文本提取与Memory接合已写入候选，主检查缓存绑定文件hash，Worker提议和正式接受使用实际文本来源；其新宿主贯穿验收尚未完成。

这些源码未再次发布，日常保持 `9ab6864a6c45`。沙箱43项回归、服务构建与类型检查通过；新的完整宿主回归执行获提权拒绝（`Rejected("rejected by user")`），未执行，不能将334项旧冻结结果套用于新源码。新增附件移除宿主场景的执行也曾被拒绝，未重复该命令。后续需要恢复正常宿主验收后再做维护更新；同时继续尚缺的Web上传、缩略图/进度/正式引用等。

## 2026-10-17 续接候选增量（未发布）

- 排队编辑显示原附件文件名，可移除、取消恢复；纯附件可以保存，空文字且移除最后附件后不能保存。前端契约 RED→GREEN，605px 真实浏览器操作了移除与取消，双图加载且无横向溢出。演示旧宿主未重载，未提交修改，不算新后端贯穿验证。
- 图片正式 publication 发送接入本地长边320px、去元数据缩略图。上传携带官方 `thumb_rawsize` / `thumb_rawfilemd5` / `thumb_filesize` 和 `no_need_thumb:false`，消费 `thumb_upload_param`，同一受控AES key分别加密、分别校验CDN回执。缺许可、非法尺寸、缩略图503均明确失败，不触发 send。API契约 RED→GREEN，实际本机 ffmpeg 合成PNG解码/尺寸/不放大/取消验证通过；服务端和手机尚未验。
- 视频整项分析串行，等待最多10项，等待取消立即移出且不破坏FIFO，失败释放slot。视频只接受MP4，ffprobe/ffmpeg固定MOV解封装并禁止网络协议，尺寸须为正整数。取消音轨不被吞成“已分析”。解码子进程超时/取消须等实际退出后才释放slot或清理私有输入。队列 RED→GREEN 和真实本机子进程超限/超时/取消/环境隔离通过；新增实际MP4六帧专项 `tests/media-video.test.ts` 已准备，待具体本机执行许可，尚未运行。
- 开发宿主向能力视图提供实际完整buildHash/短版本；普通未版本化启动明确null。本轮实际原生图片提交数量和附件状态可读。移除设置后遗留的记忆回执/错误提示改为对话内查询纠正遗忘。异步成果检查/记忆接受增加当前主上下文身份校验；此项宿主贯穿待补。
- 输入中取消按原requestId匹配，旧请求terminal不取消其他请求；取消后迟到getconfig不重新开启。使用内存SQLite和Mock API复现 RED→GREEN，渠道/API/上传回归31/31通过。以上均不证明手机实际状态。
- 主Agent实际工具调用已接入11/12进度产品链路：固定中文阶段名，不带工具参数/正文；每请求最多3对且开始间隔5秒，开始/结束使用同一活动ID与持久part，未确认start阻挡end且不重发。主回复不等待网络；未确认工具结果以blocked结束而不冒称成功。CLI隐藏此内部事件、Telegram原展示保持。3个通知/进度内存SQLite+Mock场景通过，主工具→宿主→渠道贯穿与手机显示待验。若后续手机用例运行此新候选，需要重新明确额外11/12消息边界，不能沿用“仅1条识图文字”的最小许可。

此轮未重跑两次被拒的命令、未新建真实模型thread、未主动微信外发、未再迁移或重启日常。已向CTO回传可恢复的精确shell命令及操作范围；持久工具历史不保留原 `justification` 字段，不能编造原文。CTO正在协调具体测试权限，等待许可与继续开发分别记录。

## P2–P6 收口检查表

| 范围 | 已有实现/局部证据 | 仍需满足的完成条件 |
| --- | --- | --- |
| P2 发布与文件 | 二进制Files/publication三桥、真实文档格式抽取、hash/撤权契约 | Memory实际文本来源贯穿、文档加密/扫描/宏/压缩边界完整覆盖；本人手机文件实际打开 |
| P3 音频 | 协议转写、SILK/PCM/WAV、本机ASR/TTS独有合成词验证 | 无转写入站与失败链路宿主贯穿、原生语音手机实际播放；未知编码明确拒绝 |
| P4 视频与引用 | 时间戳六帧/音轨、入站ID/部分/媒体引用缓存、视频串行取消、当前入站消息出站引用入口 | 实际视频专项、长视频/异常/取消宿主；手机播放/引用显示；出站不支持任意历史ID选择 |
| P5 扩展 | getconfig/sendtyping/启停、图片/视频缩略图、11/12配对限频产品接入、正式publication组合交付opt-in | 主工具进度/出站选项MCP宿主贯穿；扩展服务端和手机可用性；组合当前仅短说明+一个成果 |
| P6 安全启用 | 日常9ab已有维护点/原thread和六unknown保留 | 新候选完整check、605/桌面操作与断网/重启、18项故障矩阵；新维护点与匹配9ab回退后更新 |

18场景ID仍以 docs16 为准；现有局部绿色不代表该场景所有分支均通过，尤其 `ILINK-ENGINE-001` 最小本人双图及音视频手机动作仍待验。未来完整产品更新机制 docs20 不在本次增量范围内。

续接只读日常观测：后端仍 `9ab6864a6c45`，running/accepting/原主thread/idle；兼容UI由既有watch独立构建发布，观察到 `uiVersion=b9f0528f01eac6cec32280c5efd113f5bcbf0146015d692a8835435d48811523`，并非仍固定阶段初始1af6。已打开页面不强刷。该事实不证明候选新后端的附件lease撤销、进度或缩略图已上线。

## 最新续接增量与证据（候选，尚未维护启用）

- 当前入站原生引用通过主Agent自有MCP `quote_current_message` 选择；仅原绑定本人当前输入、完整uint64和未过期引用缓存，无任意路径或消息ID参数。仅最终文字回复首片携带引用，状态通知不携带。内存SQLite契约通过；手机显示未验。
- 组合交付通过主自有MCP `prepare_combined_delivery` 按当前本人来源明确选择，不默认改写所有交付。正式publication短说明+一个成果共用有序item_list、一条持久outbox事实和稳定clientId。上传后重新校验publication和hash。旧分片/旧event:file保留，不合并历史发送；未知组合不重投。超长说明继续原分片路径。3项存储/Mock渠道契约通过；扩展服务端、手机显示及主MCP贯穿仍未验，不把Mock回执当真实服务成功。
- 视频正式成果已接入实际首帧缩略图，先核查尺寸/时长，再生成320边界PNG，复用独立缩略图上传许可。视频原文件与缩略图的收据分别核对。专项实际MP4测试已准备未执行。
- Web草稿上传已接入原MediaStore、原request/thread、历史与原生模型输入路径；同源二进制HTTP，单文件8MiB/每条10个，两个并发接收/解码、限定IPC载荷与超时。内容判型不信任文件名；同uploadId重试核对文件hash/名称/来源。草稿确认后才可发送；部分失败须重试或明确移除。已确认附件/请求身份刷新保留，未确认文件刷新后须重新选择。移除和迟到准备由原lease挡住，接受后不可追加/删改原载荷。上传本身不产生Memory采用来源。9项前端/内存SQLite契约通过；`tests/web-upload-host.test.ts` 已准备未跑。
- 新Web入口由当前后端features和稳定网关协议握手共同门控；旧网关启动的新child不会错误宣布支持。原日常只读再次确认9ab/running/accepting/原thread/idle，`draftUpload=false`。UI watch观察到 `6bb20b7f14f5d1d372c70c31f919a256fa4e0a1b0b61fc641a8d32bbf48100d5`，后续继续构建可能变化；没有强刷日常页面。
- 崩溃恢复审阅发现并修复候选：缺衍生文件重新准备，尝试耗尽明确失败；重试不能更换原文件hash；配额计入实际私有目录及崩溃孤儿/临时文件，并计算新旧文件共存峰值；仅清理老于24小时、无活动lease且不在元数据中的自有命名文件。`tests/media-lifecycle.test.ts` 新专项准备，尚未执行，不能记为已绿。
- 文档ZIP先拒绝加密标记和重复成员；新增加密PDF、扫描文本层空、宏、压缩比超限、路径穿越、重复成员样本，均为本地合成。边界测试已准备未运行。音频解码固定允许的解封装格式，并仅允许pipe协议；新增后须重跑音频贯穿。

实际执行的最新局部命令：`node --import tsx --test tests/wechat-store.test.ts tests/wechat-channel.test.ts tests/ilink-quotes.test.ts tests/web-upload.test.ts tests/web-client.test.ts`，40/40；随后工具目录/前端/附件scope专项11/11。二者有重叠，不相加报51项独立覆盖。原五MAIN_TOOLS hash仍为 `e6d674a05ae34945a5e234a2b1f55029f0d319e51371f448911845224062cf9a`。新回复选项仅主自有MCP，Worker目录继续拒绝这些工具；stdio inventory断言按新增的两项正式工具同步扩充并加强Worker拒绝检查，尚未执行该stdio测试。

完整check仍未执行。候选曾构建遇到微信UI空状态扩展字段缺失，已修复并重新build/typecheck通过；随后GC/文档边界新增后又通过build/typecheck。后续主成果Memory与Web能力修复通过typecheck，仍须最终构建与全量检查。任何旧334或局部绿色都不覆盖这些后续更改。

### 本机全套测试调用边界静态审阅

`npm run check` = build + typecheck + `tsx --test tests/*.test.ts tests/*.test.mjs`；未调用 `test:real` 或 `scripts/real-acceptance.ts`。本次枚举82个测试入口后新增目录契约测试，运行前仍须以当时实际树核对。

| 路径类别 | 调用边界与静态核查 |
| --- | --- |
| service/Memory/queue宿主 | 注入Fake/Peer/MemoryDemoEngine，`codexBin=/usr/bin/false`，临时runtime/workspace/独立codexHome；构造但不start的兼容性分支不会启动真实模型 |
| engine/流式协议 | `tests/fixtures/*app-server.mjs`、`tests/telegram-stream-peer.mjs`本地假协议子进程；不调用真实Codex |
| 微信/TG API与渠道 | 注入fetcher/Mock API和Map secrets；Keychain runner专项注入假runner。没有真实token、账号或外部联系人 |
| supervisor/gateway | 在scratch副本启动scripts/dev，临时config/空home、合成协议peer或注入Engine；HTTP仅动态loopback端口。微信升级fixture在副本API注入syntheticFetch |
| pinned rollback | 临时runtime/config/home，测试preload拦截Engine和渠道、拒绝外网；只发送fixture子进程SIGTERM，不动日常PID |
| 主/Worker MCP | scratch Unix socket+stdio子进程，假business handler，角色工具目录真实隔离；不执行真实模型 |
| 媒体 | 既有ffmpeg/ffprobe、Python文档库、say、SILK及whisper本机合成输入；不下载新模型/声音、不连接付费服务。部分任务需要写私有media-tools/jobs后清理 |
| 打包检查 | `npm pack --dry-run --ignore-scripts --json`，缓存位于fixture，未发布包 |

这份审阅只是具体权限范围说明，不是自动批准，也不替代执行结果。早期拒绝命令在获得具体续接指示前没有重跑。2026-10-17T11:40Z后CTO传达新的具体续接指示，部分专项按正常权限流程获准执行，详见下节；完整check的新申请再次被拒，未执行。

## 2026-10-17T11:40Z 后实际续接

- `ILINK-QUEUE-003` 此前未写入的宿主场景先检查去重，再用安全编辑工具加入；正常权限流程执行单项，退出码0，1/1通过。只移除第二张附件会撤销其lease，保留图仍沿原合成thread作为一张原生图片输入。
- 七个专项入口 `web-upload-host`、`main-progress-host`、`media-video`、`media-lifecycle`、`media-documents`、`media-audio`、`worker-interaction-mcp` 实际执行14项，首跑13过1失败。失败是新Web测试fixture未建runtime目录，未进入上传链路；补目录后该单项重跑1/1通过，没有改弱断言。
- 上述专项提供实际本机MP4六帧及缩略图、文档加密/扫描/宏/压缩边界、TTS→SILK→ASR、孤儿文件/配额/缺衍生恢复、主工具进度和stdio角色隔离证据。Web二进制上传→源文件正文→原合成主thread、原ID重试、来源/大小/接受后修改拒绝也已通过。它们都使用合成Engine/Mock API和临时数据库，不是手机或真实模型证据。
- 审阅修复主Agent `task_review` 接受文件后误用Worker `guard` 导致 `run_required`；现在以调用开始时的主上下文校验，在递归调用与实际提取的每个异步边界后重验。新隔离测试RED→GREEN 3/3，覆盖原scope可接受、提取期间换上下文拒绝、review期间换上下文拒绝。不启动宿主/数据库/模型。
- 修复能力诚实性：新child配旧网关时，Web上传能力视图与实际可调用桥接同时关闭；未启动Web时明确unavailable。能力视图读取相同网关协议门控，新隔离测试RED→GREEN 1/1。后续typecheck退出0；这些新增改动尚未再构建或上线。
- 完整检查新申请 `cmd=npm run check`、`workdir=/Users/wolf3c/Project/homer`、`sandbox_permissions=require_escalated` 返回 `CreateProcess { message: "Rejected(\"rejected by user\")" }`，无session_id/exit_code，未启动。新justification明确build/typecheck/合成测试与本地媒体工具，不执行test:real、不使用真实账号模型、不微信外发、不迁移重启日常。已精确回传CTO；不把拒绝推断为超时，不换包装或拆分重造全套。

原日常仍按最后实际观测的 `9ab6864a6c45` 记录，本轮没有迁移、重启、真实微信发送或新建真实模型thread。完整候选不能部署。手机双图、音视频播放、服务端引用/缩略图/进度/组合显示，以及新候选605/桌面实际交互仍未验。

### 后续独立修复与停止图标核查

- 经CTO新的明确指示，再次正常申请同一个 `npm run check`，仍于启动前返回 `Rejected("rejected by user")`，无session_id/exit_code。已停止该动作并回传精确调用，未将其拆分绕过；新完整check仍未运行。
- 成果正文来源审阅发现语音检查能返回实际ASR，但Worker候选/接受的共用来源助手仍仅尝试文档读取，导致语音来源缺失。现与检查入口一致，音频先本地解码/ASR，保留原SILK hash，并在提取后重查源文件hash。新增 `tests/result-text-source.test.ts` 先RED，再修复后2/2通过，实际合成语音独有词被识别；文本来源及提取期间换hash拒绝也通过。此证据不等于Worker完整宿主或手机播放。后续typecheck退出0。
- 用户新要求停止按钮只显示实心方形图标。`ui/homer-app.tsx` 移除所有可见停止文字，保留独立发送箭头，aria-label/title均为“停止回复”；等待确认时保持图标，使用disabled和aria-busy。专用CSS统一44×44点击区域，DESIGN同步。只改此UI与专用CSS，无后端/DB状态改动。
- Web工作区构建通过。独立4793内存WebBridge夹具使用实际构建UI，无Homer实例/数据库/Engine/账号。真实浏览器605px与1470px均核对：停止textContent为空、44×44、aria/title正确、发送箭头仍独立、无横向溢出。605px实际点击后图标保留、disabled=true/aria-busy=true；合成状态确认结束后按钮消失，发送箭头保留。夹具页和已核实PID的自有夹具已正常关闭；原4792演示及日常未动。
- 日常只读核查：后端 `9ab6864a6c45`、uiVersion `6bb20b7f14f5d1d372c70c31f919a256fa4e0a1b0b61fc641a8d32bbf48100d5`，入口当前实际提供的JS仍含旧可见停止文字，未含新title。因此停止图标修复**尚未在日常生效**；未强刷新日常页面、重启后端或绕过schema/deps保护。后续应核对兼容UI通道未采用原因，再按已授权安全更新流程处理。
- 原因静态定位：`buildUiCandidate` 先比较gateway fingerprint（`src/web-server.ts`＋`src/web-contract.ts`）。当前源码为 `c949f72d798d8128b6a5d3f15686c4b2c794db93d8a3741dd7ef9cd4c8ca4dd3`，日常9ab冻结副本为 `98a8d410b28ce10eeca8434238355a878cd983868294abcb07da46ca365c2b4a`，不匹配，按现有逻辑触发 `dev_gateway_changed_restart_required`，兼容UI发布条件不满足。这是源码/冻结副本的只读核对，不伪称已读到实时launcher错误日志；未用混合snapshot、改hash或替换网关来绕过。完整check和安全维护启用仍是后续前提。

### 关联记忆、递归与队列的真实业务待验

以下是现有事务的验收缺口，不重开已交付任务，不将旧测试线程恢复为入口。正式执行安排在当前候选完整本机检查与安全更新之后；当前尚未执行任何新真实模型动作。

| 关联范围 | 可复用证据 | 尚缺真实业务证据及边界 |
| --- | --- | --- |
| 记忆保存/召回/纠正/遗忘 | `memory-service.test.ts` 合成Homer自然语言与原thread重启，SQLite来源/CAS/遗忘抑制；当前四项UI与常开策略已阶段启用 | 原主thread通过主MCP完成明确标注合成偏好的四步，核对实际ID/正文/版本及最终遗忘，不将回声当召回；不创建探针thread |
| 成果来源采用 | 实际文档/语音正文与原文件hash局部验证、主异步scope拒绝；Worker候选storage已有 | 当前二进制结果从Worker提议→主实际检查→接受→matter范围Memory的完整宿主贯穿与文件变化故障；真实Worker如必要须先说明用途/最少数量 |
| 递归正式交付 | 既有合成Task/版本/消息等待/采用/验收/publication及停止竞态；历史真实协议观察单列 | 新版真实任务从原主thread协调到合法成果，内部接受不冒充正式交付；确需独立上下文先回报，不批量建探针，不实现暂缓的跨版本并行稳定层 |
| 连续发送队列 | `recursive-main-inputs` FIFO/CAS/撤回/interrupt/generation/reopen；附件移除合成宿主新增通过 | 新候选实际浏览器排队编辑/撤回/停止/刷新与断网恢复，真实主对话精准generation停止；保存旧payload/ID/hash与六unknown，不重放 |

上述来源文件已有各批次冻结证据，最新树仍须完整check；未在权限拒绝后拆分重造全套。原五MAIN_TOOLS定义与hash继续保持。所有真实微信动作另遵原绑定本人/明确方向和消息数边界；手机动作与模型理解分别计证据。

### docs16 的18场景逐项收口状态（当前矩阵）

| 场景 | 当前证据/仍缺 |
| --- | --- |
| ILINK-AUTH-001 | 既有QR/迟到代次/Mock凭据失败覆盖；全状态/重定向矩阵须随最终全套核对 |
| ILINK-API-001 | 固定官方9API、7item类型和uint64契约已有；新候选需完整回归，扩展真实服务端另验 |
| ILINK-MEDIA-001 | 本地AES/key/padding/MIME契约已有；坏编码全部分支需核对 |
| ILINK-MEDIA-002 | CDN来源/重定向/流式大小已有合成契约；实际手机新附件尚待动作 |
| ILINK-MEDIA-003 | 原游标/来源/意图事务已有；孤儿/缺衍生恢复专项通过，rename失败完整矩阵待补 |
| ILINK-QUEUE-001 | FIFO/多图部分失败旧宿主证据；新增附件编辑宿主单项通过，浏览器提交操作待验 |
| ILINK-QUEUE-002 | 旧ID/hash、CAS、generation已有；Web上传/重试/来源/接受后修改宿主通过，丢回执/刷新/移除新浏览器贯穿待验 |
| ILINK-ENGINE-001 | 原生图片适配及合成宿主已有；原主thread真实双图独有内容仍未手机/模型验收 |
| ILINK-FILE-001 | 四种文档格式及加密/扫描/宏/压缩边界实际本机通过；Memory真实来源贯穿和手机打开未验 |
| ILINK-VOICE-001 | 新解码白名单下本地TTS/SILK/ASR通过；无转写宿主/手机播放仍缺 |
| ILINK-VIDEO-001 | 真实MP4六帧与缩略图本机专项通过；长视频/异常音轨矩阵和手机播放未验 |
| ILINK-QUOTE-001 | 入站缓存/部分Unicode/隔离契约通过；当前入站出站引用契约绿，手机显示未验 |
| ILINK-SEND-001 | 正式发布/hash/上传与send分开；新组合未知不重投/撤权Mock通过，手机文件未验 |
| ILINK-SEND-002 | 旧uncertain保护和generation已有；新组合上传后二次publication拒发绿，实际停止请求边界再核对 |
| ILINK-NOTIFY-001 | typing迟到、进度配对/限频内存绿；主工具到Mock渠道宿主通过，手机进度/启停服务端未验 |
| ILINK-EXTRA-001 | 原生引用/双缩略图/组合产品路径已写，局部契约绿；扩展真实可用性与增量状态未证实 |
| ILINK-LIFE-001 | pin/保留GC与最新实际磁盘/孤儿/缺衍生专项通过；活动任务与晚到完整矩阵待复核 |
| ILINK-UPGRADE-001 | 9ab阶段已真实维护并保原thread/六unknown；新候选须全套、迁移副本、新维护点和匹配9ab回退后启用 |

总体仍是实施中。最小手机双图许可仍为本人发1条含2张合成图、仅回1条识图文字；本候选含11/12进度，若测试会触发工具，须先向CTO重新明确额外消息数，不可沿用旧边界自动外发。

### 停止图标独立兼容补丁核查（2026-10-17，维护前历史记录）

后续用户已明确批准该最小维护继续执行。固定入口、验证及最新发布事实统一见 [停止图标维护记录](24-stop-icon-maintenance.md)；本节保留当时在线接入限制，不再作为当前缺少维护授权的判断。

为优先回应停止按钮仍有文字的问题，已从**日常当前 UI 的完整冻结源码** `ui-6bb20b7f14f5-07e01267-75c2-4274-840d-1789adfbfde8` 构建隔离小补丁。只有 `ui/homer-app.tsx` 按钮和必要 `ui/homer-styles.css` 两文件改变；不混入当前整树媒体、上传、能力设置或未验后端。正常 `buildUiCandidate` 比较依赖、协议、gateway 后完成 UI 类型检查与 Vite 构建，未修改 hash/guard。

- 原日常后端 `9ab6864a6c45`；基准 UI `6bb20b7f14f5d1d372c70c31f919a256fa4e0a1b0b61fc641a8d32bbf48100d5`。
- 独立补丁 UI `f91ad7a94848c89ee1909c3c7ed24860f3be23aaf5a2dcaf90c11ec2deda5fdc`；gateway `98a8d410b28ce10eeca8434238355a878cd983868294abcb07da46ca365c2b4a`；依赖 `6ec82c3861e35ea215327c670026ca067320f4f5602a70bc38b93e198ba8a712`；协议1，均来自真实冻结输入。
- 使用同一个日常冻结 `web-server.js` 与合成 WebBridge，在4796实际浏览器605/1470验收：无可见文字、44×44、title/aria“停止回复”、无横溢；实际点按只提交 `synthetic-assistant` 至既有 stop路径。等待时图标保留并disabled，无日常停止动作。
- 清单和可回退基准保留于 `.codex/scratch/native-capabilities-implementation/stop-icon-patch-manifest.json`；补丁构建/源码差异/PNG保留同目录。基准资产未变，回退目标仍为上述原UI。

**当前不能安全在线接入此已构建补丁。** 运行中的 launcher 只从整个当前源码树构建，持有内存中的 `uiCurrent` 和 `uiBuilds` Map；没有注册外部已验证 UI 清单的控制入口。新源码的 launcher 能力不能写入已运行进程。当前整树 gateway 与旧版不同，正常 watch仍拒绝它；在旧hash目录替换JS、改清单/hash或往当前树混入旧后端均不是合法发布。

可审阅的下一步是独立增补“指定冻结基准UI补丁”的 launcher 入口（检查完整清单、资源、依赖、协议、gateway和回退，不能只接受宣称的hash），在获准维护点激活具备此入口的 launcher后才切UI。当前约束禁止重启日常，因而本次没有可执行的无中断发布命令；不是必须等待全部MCP/iLink功能完成。也没有通过其他进程代理日常或接管端口来绕开单owner。原日常、未知发送、Worker与既有未发布候选保持原状。

当时的专用脚本曾核对固定基准 UI、gateway 和依赖，并在独立 scratch 重建该补丁，产物 UI hash 再次为 f91ad7a94848…；旧补丁现已不再需要，重建脚本已退役。
