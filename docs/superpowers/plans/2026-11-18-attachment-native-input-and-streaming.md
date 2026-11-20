# 附件原生输入与分块传输实施方案

> **For agentic workers:** 后续获得实施授权后，使用 `superpowers:executing-plans` 按任务逐步实施。下列复选框用于验收跟踪；本文不授权启动实施、提交、推送或部署。

**Goal:** 取消无依据的附件／图片数量门槛，将模型图片处理尽量交给固定 Codex；贯通有界分块传输后撤除对应整文件整包门槛，同时保留附件授权、完整名称、可理解错误和未知执行语义。

**Architecture:** 复用现有 Composer 附件集合、WebBridge、`media.upload/read/discard`、MediaStore、lease／pin 与 CodexEngine。第一阶段先独立设置解码队列容量，验证并接入原图和视频帧后再解除数量限制。第二阶段贯通分块上传、读取、导出和手机分享，再撤除相应整文件门槛。不新建附件业务系统、通用传输框架、第二套上传队列或模型能力白名单。

**Tech Stack:** TypeScript、React／assistant-ui、Node 22.22.0、SQLite、现有 HTTP／进程 IPC／WebRTC／移动 WebView；固定 Codex `0.171.0-alpha.7`。

**Spec:** [所属架构与最新方向](../../architecture/main-worker-chat-architecture.md#附件接收与错误反馈2026-11-18)。第一阶段已在源码实现，第二阶段待实施。

## 状态与全局约束

- 2026-11-18 文档核对基线：共享 `main` HEAD `11d976e8c0c201cfde815d3b46b4cdb3c54e9210`。工作区存在本事项及历史列表、渠道、Preview 等并行未提交内容；HEAD 会继续变化，实施前重新检查。
- 2026-11-20 已在 macOS 完成第一阶段的宿主、固定引擎回环及浏览器定向验证。[复验入口与边界](../../testing.md#附件原生输入第一阶段2026-11-20)。
- 只保留一个方案文档，架构正文／索引引用它；不复制另一套产品设计。产品改动、测试、安装与提交分别受后续当轮授权约束。
- 不把 20MiB、32 个、32MiB、150MiB、79MiB 或 1GiB 换成新的“统一 Codex 上限”。资源策略与协议／设备实际能力分别说明。
- 新功能沿已有身份及收据处理；不自动重跑未知的上传完成、模型请求或业务操作。请求已接受后的停止／恢复边界不变。
- 普通文件仍按获准工具处理；不增加格式猜测白名单，不把提取文本、缩略图或抽帧等同完整理解。
- 文件名只作显示数据，不作授权来源。显示名保留完整内容；安全路径、原件完整性和实际平台导出规则继续执行。
- 测试使用隔离 HOME／CODEX_HOME、合成资料和回环假服务，不读取日常账号或资料，不安装依赖，不调用付费模型。

## 现状、证据与前序候选归属

| 项目 | 实施前的源码 | 本方案如何处理 |
| --- | --- | --- |
| 上传整文件 20MiB | `WEB_UPLOAD_BYTES` 复用旧图片预算；UI、HTTP、IPC、手机分别检查 | 不是 Codex 上限。第二阶段贯通后删除相应整文件门槛；第一阶段不在全量缓冲路径上直接无界放行 |
| 32 个附件／图片 | `MEDIA_POLICY.maxItems` 同时控制 UI、存储、消息、工具、engine 和视频预算，并用于解码等待队列 | 第一阶段删除业务数量拒绝，队列容量独立保留，不随附件数量自动扩张 |
| 手机 32MiB 整包 | 16KiB 分帧后仍整包分配、JSON 解码；上传整文件先 Base64 | 第二阶段仅传有界块；整包保护只作用于单次报文，不再限制文件总长 |
| 解码图片合计 150MiB | 前序新增检查，复用原件合计常量 | 原图路径接通后删除此模型输入门槛；不是原生能力，也没有临界内存实证 |
| 图片必需衍生图 | `state()` 依赖衍生图，`reconcile()` 会把缺失衍生图标为失败 | 原件 ready 与预览可用性分开，预览失败不阻止原件送引擎 |
| 模型图片 | Homer 解码首帧 PNG，再全量 Base64 进入 `image.url` | 优先接入 `localImage.path`，由固定引擎处理；先验证权限、持久化与错误观察 |
| 原生回包 | engine有普通2MiB／总32MiB接收保护及目录／生成图例外 | 与手机32MiB是不同路径；原生探针检查用户输入回显与历史回包，不能因localImage请求小就宣称回包兼容 |
| 文件／视频 | 普通文件按需提取；视频本地取前 60 秒的 6 帧，再受全局图片预算抽选 | 文件工具路径保留；取消全局数量引起的二次丢帧，清楚说明视频覆盖范围 |
| 名称、空文件、错误 | 已有完整显示名、空普通文件、平台导出、脱敏的 RPC／终态原因候选 | 保留并定向复审，不整文件回滚，不恢复 120 字符或旧 8MiB／10 个拒绝 |

20／32 是前序工程选择，不是测出的必要边界。前序 161/161 验证覆盖该候选的接线一致性；32 张输入测试使用小图片／协议数组，不能证明高分辨率容量。手机同进程模拟两端大包测试报告最大 RSS 434880512 字节，端口 `buffered()` 恒为 0，不能代替真实 RTC、WebView 或低内存设备测量。详见[前序验证记录](../../testing.md#附件预算与错误原因定向验证2026-11-18)。

**前序候选处理方式：** 后续先取得当前差异，按片段区分“保留的名称／错误改进”“被替换的门槛／接线”“其他事项改动”。只修改本事项片段；代码重叠先协调，不使用整文件恢复、reset 或 clean。本文不授权回滚现有候选。

2026-11-20 前序候选已拆分。完整显示名、空普通文件和安全导出已提交于 `eb344eb8`。原生图片提交直接尝试，RPC 与终态错误只公开固定类别。后文的错误展示沿用这一公开边界。第一阶段已替换数量门槛和原生图片输入路径，首阶段保留单文件上传 8 MiB 和手机整包 16 MiB。20／32 MiB 为暂缓的整包预算调整，分块传输仍待实施。

## 固定引擎事实与决策边界

- 固定 [UserInput](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/app-server-protocol/schema/typescript/v2/UserInput.ts) 支持图片、音频及本地路径输入，未声明 32 项数量门槛，也没有普通 PDF／Office 文件的通用输入变体。数组类型不证明模型服务接受无限输入。
- 原生 [LocalImage 转换](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/protocol/src/models.rs#L2321) 会读取路径。它减少 Homer 的 PNG／Base64 中间物，不保证引擎内部不读取整文件或不做 Base64。
- [图片工具](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/utils/image/src/lib.rs) 与 [Sanitizer](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/utils/image/src/sanitizer.rs) 存在不同输入保护。不能把某个 feature 分支的值复制为所有附件上限，也不读取日常配置来假定当前分支。
- [图片准备](https://github.com/openai/codex/blob/rust-v0.171.0-alpha.7/codex-rs/core/src/image_preparation.rs#L360) 可能把失败图片替换为文本后继续请求。终态 completed、模型有文字回复、图片已提交均不能单独证明看见图片。
- 真实服务端大小、数量、上下文及格式限制，以实际原生结果为准。本方案的回环验收不证明真实服务容量。

## 文件与接口范围

下列均为现有生产文件；不为拆分任务而重构文件。只有原生离线专项可能增加一个必要测试文件。

| 任务 | 主要文件与接口 |
| --- | --- |
| 数量解耦 | `src/media-policy.ts`、`src/media-store.ts`、`src/web-history.ts`、`src/recursive-tools.ts`、`src/service.ts`、`src/engine.ts`、`ui/homer-attachment-adapter.ts`、`ui/homer-app.tsx`；队列调用点含 `src/media-video.ts` |
| 原图输入／状态 | `EngineImage`／`CodexEngine.turn()`，`Homer.mainTurn()`，`MediaStore.state/reconcile/readAttachment/pin/unpin/gc`，`src/media-decode.ts`、`ui/lazy-media.tsx`（仅预览回退所需片段） |
| 上传分块 | `WebUpload`／`webUpload()`、`WebBridge.media.upload()`、`Homer.uploadAttachment()`、`MediaStore.webIntent/ready`，`src/web-server.ts`、`src/web-chat.ts`、`src/dev-host.ts`、`scripts/dev.mjs`、上传 adapter、`ui/mobile-request.ts` |
| 下游与分享 | `MediaStore.readAttachment()`、`Homer.readAttachment()/workerFileTool()`、`Files.writeBinary/verify`、`RecursiveTasks.writeFile/readFileReceipt`、`WebBridge.media.read()`、`ui/file-download.ts`、`mobile/connection.mjs`、`mobile/App.tsx` |
| 兼容／反馈 | 既有 Web 协议与能力字段、手机会话、原生错误转换、主回复及 Worker 回传；不新增业务工具或独立错误存储 |

## 第一阶段：先打通模型图片输入，再放开数量

### 任务 1：独立设置视频解码队列容量

- [x] 在 `src/media-video.ts` 就地保留已提交版本的并发与等待容量，解除队列对附件数量配置的依赖。此步保留现有业务数量门槛。用队列繁忙及释放后的既有行为验证。

### 任务 2：先验证固定原生路径、权限与持久化

**接口：** 仅新增必要的 `tests/attachment-native-input.engine.test.ts`，登记到 `scripts/test.mjs` 的 engine 专项，命令／环境要求维护在 `docs/testing.md`；不进入默认 npm test。

- [x] 显式提供 `HOMER_TEST_CODEX_BIN` 并检查版本恰为 `0.171.0-alpha.7`；不猜测安装版版本或读取其 HOME。测试启动环境只允许必要变量，清空账号／服务商凭据；服务流量仅到本地假服务。
- [x] 用合成 JPG／PNG／动画／损坏文件／不支持图片、实际平台路径（空格、中文、长显示名）验证 `localImage` 进入引擎后如何处理；捕获假服务实际收到的内容与 hash／维度，而非只看 turn/start ACK。
- [x] 保持产品现有权限配置，验证宿主私有资产路径可读与不可读的精确行为；不能为通过测试开放整个 runtime／HOME，也不删除权限断言。失败时记录位置，停止受影响接线，另核单文件授权办法。
- [x] 核对线程历史、原生保存的图片表示及重启恢复：分别在原件保留与移走的隔离条件下恢复，确认何时仍依赖 Homer 路径；移走的只是自建合成文件。同时检查输入回显、thread/read与恢复回包是否触发现有2MiB／32MiB接收保护，不顺手扩大所有RPC额度。分别记录已覆盖的 feature 分支，不据源码推断默认分支或所有分支均已验。
- [x] 捕获图片失败是否有带精确 thread／turn／item 的稳定协议证据，包括只出现占位文本而终态成功的情况。不把 stderr 文案或模型措辞当成稳定成功／失败协议。
- [x] 权限及恢复验证通过后才切换图片输入。验证失败时保留现有输入路径和数量限制，记录具体失败条件。

### 任务 3：接入原图并修正预览、授权与留存

**接口：** `EngineImage` 在原有图片输入中支持宿主生成的 `{path:string}`（现有 `{url:string}` 仅留给仍需兼容的调用）；`turn()` 将路径映射为 `{type:'localImage',path}`。路径不进入客户端提交契约。

- [x] 按用户选择顺序遍历一次附件，同时生成原生图片输入及给 Main 的对应说明。用“视频 A、截图 B、普通文档 C”验证：A 的帧注明来源与时刻，B 对应自身的准确版本，C 沿用 `inspect_attachment` 按需读取。核对实际输入顺序和字节，避免先收集静态图、后追加视频帧造成错配。
- [x] `mainTurn()` 只根据当前获准 `assetId/revision` 取得固定原件路径。复用普通文件、软链／硬链、hash 和来源核验，校验前后确认原件未替换；为避免重新整文件分配，校验 hash 可在现有 reader 内增量计算，不另建路径授权服务。
- [x] 视频帧也复用现有衍生文件的受核验路径，按原件hash／revision／transform定位，不先把所有视频帧读成Buffer；同样由既有资产pin保护。否则取消全局数量门槛会放大Homer中间缓存。
- [x] 将原件提交成功作为 ready。预览／缩略图按既有 UI 路径生成或延迟读取，失败显示“预览不可用”；`state()`／`reconcile()` 不再因衍生图缺失阻塞原件发送。只有必要预览回退触及并行 UI 文件，冲突时先协调。
- [x] 复用 pin：准备提交前固定精确 revision；原生终态或确认退出前不释放，未知回执与未确认停止保留。取消／撤销后的迟到处理不得产生新读权限或覆盖新资产。GC／服务重启必须识别持久 pin，不只用内存 finally。撤销不能追回引擎已接收的内容；沿原停止机制核实状态，不删除原件来伪装已撤回执行。
- [x] 按任务 2 的证据决定释放点：原生历史确已自持图片内容时释放执行 pin，Homer 原件沿原留存规则；恢复仍依赖原件时复用消息 pin 保留依赖，并定义消息撤销／删除后的释放。不能在轮结束后一律删除，也不能无条件永久 pin。
- [x] Worker 仍只得到被明确转交的引用，沿现有 inspect／导出工具处理；不借本改动把用户所有图自动注入 Worker。手机／浏览器必须先上传到宿主，设备本地路径不作桌面路径使用。
- [x] 原图和视频帧路径、授权与恢复通过后，移除跨层独立数量拒绝、因数量引起的二次抽帧，以及旧 PNG／Base64 输入专用的解码合计门槛。同步更新 UI 文案和能力说明。现有消息封装、媒体存储及解码队列仍按各自预算运行。
- [x] 用 33 个小附件在其余预算内走通选择、发送和历史读回，核对顺序及版本。混合图片与视频核对实际送入引擎的顺序；重复引用、伪造修订和跨范围读取沿既有规则拒绝。
- [x] 错误展示沿现有分类与脱敏原因。能取得稳定省略证据时附上“图片未处理／已省略”，不误绑其他轮；若协议不提供可观察结果，界面只承诺“已提交，是否处理未确认”。不扫描全历史／原始日志拼凑新状态系统，也不宣称已解决全部图片省略提示。

第一阶段实测：固定引擎在移走合成原件后仍可恢复原线程图片；缺失或损坏的输入可被省略且轮次成功。当前协议没有可用于界面逐图确认“已看见”的稳定回执。已有收件保护覆盖执行中和回执未知的状态，通过重开数据库后的 GC 验证，沿用该保护，不增加第二套 pin。

第一阶段验收：完整显示名、空普通文件、现有授权／错误／未知语义保留；无独立数量上限；原图接线、预览失败隔离、恢复与 GC 证据齐全。**尚不宣称已取消所有附件大小策略，也不宣称手机大文件传输已经完成。**

## 第二阶段：同一上传身份下分块，贯通下游

### 任务 4：有界块上传与持久提交

**推荐最小接线：** 在现有 adapter 内顺序读取所选 File 的切片，经同一 `/api/uploads` 与 `media.upload` 发 `begin/chunk/finish`，桌面与手机复用；不先构造整文件 Base64。HTTP 每次只接收一个有界切片，IPC 若仍需 JSON，只对该块编码。复用当前小帧尺度，按封装开销确定单块表示，不引入新的文件总长上限。

| 阶段 | 输入／输出契约 |
| --- | --- |
| begin | 原 threadId／requestId／uploadId，加完整 filename 与声明 size；返回同一 assetId／revision、已确认 offset 或原完成回执 |
| chunk | 原身份、offset、有界 data；验证当前 scope／lease 和精确偏移，只追加这次块；返回确认偏移 |
| finish | 原身份、最终总长；宿主流式核验文件长度与 SHA256，原子提交并返回现有 ready MediaView |
| discard／查询重试 | 继续使用原移除入口；重试 begin 取得原状态，不换 uploadId，不把失败当不存在 |

- [ ] 先补协议测试：空普通文件、多块与尾块、偏移超前、缺块、越界、重叠、重复块、内容不同的同偏移、断线、未知 finish、撤销及迟到块。重复旧块须核对已落盘字节；冲突不能覆盖旧内容。
- [ ] 复用 assets／web_uploads、lease、私有 `.part` 和现有状态。未完成上传的临时字节也计入现有磁盘配额。同一 uploadId 的写者互斥；客户端顺序发送不代替宿主互斥，保持其他上传既有并发。只补必要互斥，不再创建一套业务队列。
- [ ] 处理现有 `webIntent()` 必须预先有完整 hash 的契约：不要求浏览器先把整文件读入做 digest。建议沿原表保留声明总长，未完成 hash 允许为空，提交后不可变；offset 从受保护 part 文件核验。需要修改表时做最小 schema 迁移及旧记录恢复验证，不塞假 hash 冒充完成，也不另建上传表。
- [ ] 对未知块回执，依据宿主已落盘偏移与内容核对续传；对未知 finish，先返回原完成收据或未确认状态。已完成 begin 只代表原上传已完成，不证明新选文件的内容相同；更换 File／内容必须新身份，不能重用原完成收据冒充消费了新文件。
- [ ] 写入时增量 hash；重启后按需流式重算 part 前缀，避免持久化另一套 hash 状态。finish 必须在最后一块确认后核对总长、身份、hash 和 lease，再原子 rename／更新 ready；崩溃窗口由原 reconcile 检查文件与记录，不根据 ACK 猜完成。
- [ ] 复用 adapter 唯一附件集合与上传身份，按 offset 显示进度／重试；只在 finish ready 后允许发送。换线程、移除、刷新与连接断开不得让旧块确认当前草稿。
- [ ] 不强行嗅探单块格式：完成后由原件头部与内容识别类型；图片走第一阶段，文件提取／音视频分析按需且可以不可用。检测、校验和取消不得重新构造完整 Base64。普通文件可在finish完成后立即确认收存；在既有inspect工具中按需调用extractDocument并记录sourceHash／coverage／limitations，本地提取的字符／页数／解压预算只限制分析覆盖，不能再阻塞原件ready或流式导出。

#### 2026-11-20 tus 上传选型结论

本轮结束 tus 产品接入尝试。正式上传继续使用已提交的单文件 8 MiB、手机整包 16 MiB 入口。上文的三步分块实现是未提交的候选。原型使用 Node 22.22.0、`tus-js-client@4.3.1`、`@tus/server@2.4.7` 和 `@tus/file-store@2.1.2`。网关运行一个处理器，独立子进程持有合成 SQLite 和 Homer 的 `MediaStore`。手机复用现有配对、DataChannel 分帧和背压，桌面使用同源 HTTP。

每次上传同一内容的 8 MiB 普通文件，读回原件逐字节核对，并断言该草稿只有一个资产。下表为各一次实测。请求数包含建立草稿归属和取得回执，内存为上传期间采样峰值。

| 客户端 | 上传方式 | 请求数 | 耗时 | 网关 / 宿主 RSS（MiB） |
| --- | --- | ---: | ---: | ---: |
| macOS Chrome | tus，256 KiB | 36 | 0.111 秒 | 104.8 / 94.6 |
| macOS Chrome | 当前候选，16 KiB | 514 | 0.856 秒 | 105.9 / 94.7 |
| Pixel 8 Pro Chrome | tus，256 KiB | 36 | 4.69 秒 | 116.6 / 75.3 |
| Pixel 8 Pro Chrome | 当前候选，16 KiB | 514 | 42.36 秒 | 115.3 / 93.8 |
| Pixel 8 Pro Chrome | tus，16 KiB 对照 | 516 | 40.98 秒 | 104.5 / 71.9 |

手机使用 Android 17。局域网直连未建立，实际选中的 ICE 候选为宿主直连候选和手机中继候选。中继仅在测试机运行，手机经 USB 端口映射连接中继。相同链路下改回 16 KiB 后，两种实现耗时接近。前两项手机测量中，测试页 JS 堆分别采到 2.5 / 8.1 MiB，Chrome 主进程 PSS 分别为 329.7 / 327.9 MiB。该 PSS 含浏览器共享开销。当前数据覆盖 Chrome 测试页，安装版 WebView、低内存机和公网中继性能仍待独立测量。

- **恢复与授权**。创建回执丢失、收齐后宿主重启、改名后事务中断、登记后未取得回执，均能按原身份获得同一份 `ready`。手机传完 512 KiB 后关闭 RTC，重新认证并重启宿主，下一次写入从 524288 开始。切换请求身份会被拒绝。撤权使原会话失去续传和登记能力，重新批准后仍能核实原附件尚未登记。
- **兼容与配额**。长显示名、空普通文件、旧入口、未完成文件预留空间和正常取消均已验证。另将手机、网关两端固定到已提交的 16 MiB 报文实现，真机用 tus 和旧整包入口各传一次 8 MiB，原件均一致；8 MiB 加一个字节在创建时被拒绝。现有适配器、移动会话、上传宿主和迁移定向回归 35/35 通过，包含历史原件读取及迟到回执保护。
- **未通过的采用条件**。让 tus 收齐 512 KiB，跳过 Homer 登记，再让草稿和上传记录过期。Homer GC 将资产标为 `deleted` 并释放配额，FileStore 的 `deleteExpired()` 返回 0，磁盘仍有全部 524288 字节。相同流程下，部分上传会被清除。显式 `remove(id)` 可以删除原件和元数据，但取消后若进程在调用它之前退出，仍需在重启后补做。把两个存储直接改到同一目录又会触发已有的孤儿文件清理：超过一天的 tus 元数据会被清掉，仍有效的部分文件无法再由 tus 查询进度。
- **维护成本**。tus 确实接管了传输偏移和按偏移写盘。为了维持 Homer 的草稿语义，还需维护限定方法和路径的手机适配、原身份重复创建保护、跨进程的完成回执，以及两个存储在过期和崩溃后的清理。保留现行入口即可避免引入这套协调。原型和私有测试库均未进入产品依赖或消息协议。

在独立临时包中可用下面的最小断言复验影响选型的 FileStore 行为。使用上列固定版本，在空的私有临时目录下执行，脚本会删除自己创建的数据。

```js
import assert from 'node:assert/strict';
import {mkdtemp, rm, stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {FileStore} from '@tus/file-store';

const directory = await mkdtemp('./fixture-');
try {
  const store = new FileStore({directory, expirationPeriodInMilliseconds: 1});
  for (const [id, size] of [['partial', 2], ['complete', 1]]) {
    await store.create({id, size, offset: 0, creation_date: new Date(0).toISOString()});
    await store.write(Readable.from([Buffer.from('x')]), id, 0);
  }
  assert.equal(await store.deleteExpired(), 1);
  assert.equal((await stat(directory + '/complete')).size, 1);
  await assert.rejects(stat(directory + '/partial'), {code: 'ENOENT'});
} finally {
  await rm(directory, {recursive: true, force: true});
}
```

### 任务 5：读取、导出、下载和手机分享

**接口：** 保留 `media.read` 和原附件 selector，增加受核验 offset／length 的读取模式；最终 hash 与总长来自资产。HTTP、手机与导出共用同一来源授权，不创建任意路径或永久公开下载 URL。

- [ ] 补失败用例：上传后大于旧 20MiB 的原件可完整读回／导出，hash 一致；不是“上传成功，下一步又被旧 50MiB 或整包 Base64 拒绝”。测试样例大小是回归样例，不作为新产品阈值。
- [ ] MediaStore 在已授权的文件句柄内按块读取，核对普通文件属性、revision、hash／长度与读取期间变化；新增路径读取不能绕过原 scope 校验。避免每读一小块又全文件 readFileSync，完整性可在开始／完成时流式核验并固定同一原件。
- [ ] `workerFileTool`／`Files`／`RecursiveTasks` 沿原独占创建、操作身份及收据流式复制原件。中断后的目标临时文件、原件 pin 和未知操作保留可核对性；原子完成后再形成原收据。不移除软链／硬链、已有目标与内容冲突断言。
- [ ] 桌面下载沿当前同源鉴权流式响应，浏览器使用原下载入口；避免先拿全量 Base64 再转 Blob。手机沿同一分块读取，不能把整个文件再拼成一个大 JSON 报文。
- [ ] 手机原生分享沿现有 WebView→App share-file 通道分块写缓存，完成校验后才调用现有分享 API；取消、错误、结束后回收本次临时文件。完整显示名作 dialogTitle，缓存／导出名遵守实际平台规则，失败说明原因，不统一截为120字符。
- [ ] 分别验手机传输与原生分享；只有两者都完成才能承诺新文件链可用。旧 App 保留的原生 Base64 分享实现不能因网页更新自动视为已升级。

### 任务 6：兼容、移除门槛与资源验收

- [ ] 沿既有 Web 协议／能力协商标识分块能力，必要时更新原协议版本；旧客户端不发送不认识的分块，也不在大文件失败后隐式回退全量 Base64。保留已确认草稿与可重新选择的本地文件，明确提示需要更新；不重放已接受消息。
- [ ] 保留旧已完成资产、历史引用、uploadId 和收据可读。升级必须处理旧未完成上传及 part 文件，未能核实的状态保持未确认，不重建线程或重发模型请求。
- [ ] 桌面／手机上下游均通过后，删除相关 UI、HTTP、IPC、手机、存储／导出等整文件拒绝；逐项登记仍保留的本地分析预算，不把它们冒充上传或模型能力。未覆盖的平台明确标未验，不以提高常量代替接线。
- [ ] 使用多种总长、同一块尺度测量上传／下载／导出的峰值内存、暂存占用、取消回收和并发；目标是传输缓冲随块及并发有界，不随整文件线性累积。原生引擎、文档解析和视频处理的内存单独测量，不能算入“传输恒定内存”承诺。
- [ ] 本地磁盘不足、文件系统最大文件／名称约束、连接关闭和原生资源错误准确展示。已有 1GiB 配额、150MiB 原件合计、96KiB 消息等同样是 Homer 策略，不宣称物理极限；对残留策略明确用途、作用点及未验证状态，不再复制成附件数量／文件总长门槛。

## Review Focus 与验收门槛

| 最容易误判的条件 | 所属任务与必须证明的结果 |
| --- | --- |
| 图片省略但 turn completed | 任务2／3：有明确协议证据才判省略；只有提交或文字回复不能标看见 |
| 线程重启／GC／撤销发生于原生读取前后 | 任务2／3：依赖原件的窗口有pin；未知执行不释放；旧路径不产生新授权 |
| 块写完或 finish 成功但回执丢失 | 任务4：原身份核对偏移／内容或原收据，无重复资产、覆盖和自动重发业务 |
| 上传已分块，下游或分享仍全量缓冲 | 任务5／6：完整读取、导出、分享均验；分别量测进程／设备，不用模拟端口RSS冒充真机 |
| 长名、多字节名、空文件与版本错配 | 任务3／4／5／6：显示名保留，平台导出正确，空普通文件不丢失；旧客户端明确失败且草稿保留 |

验收分层，逐层独立记录，不将全绿替换成“已支持所有平台”：

| 层次 | 验证与完成条件 |
| --- | --- |
| 合成协议／宿主 | 数量完整、scope、hash、偏移、收据、取消和恢复断言通过；注入引擎不代表原生验收 |
| 固定原生离线 | 使用明确选择的固定二进制和本地假服务，证明实际输入、权限、持久化、占位与原生终态；不触真实模型 |
| 本地媒体专项 | 明确选择已有解码器／合成文件，证明预览失败隔离与抽帧覆盖；缺工具或平台条件不足保持未验 |
| 桌面／移动实际链 | HTTP→IPC→宿主与真实RTC／WebView／原生分享、重连、背压、低内存及临时资源清理；模拟端口不替代 |
| 平台与安装版 | macOS、Windows／Linux及手机分别按本次承诺验证；源码、开发模式不代表安装版 |

## 最小验证命令与执行记录

实施时先确认 `node --version` 为 `v22.22.0`，逐任务先红后绿。以下为按改动选择的复验入口：

```sh
node --import ./tests/fixtures/synthetic-home.mjs --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/web-upload.test.ts tests/web-upload-host.test.ts tests/homer-attachment-adapter.test.ts tests/engine-rpc-lifecycle.test.ts tests/mobile-channel.test.ts tests/mobile-session.test.ts tests/media-retention.test.ts tests/delegation-attachment-input.test.ts tests/files.test.ts tests/user-message-attachment.test.ts
node --test mobile/connection.test.mjs
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p ui/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.check.json --noEmit
```

新增原生测试完成并登记专项后，单独运行以下入口，`HOMER_TEST_CODEX_BIN` 必须已显式设置为核对过版本的实际路径；未设置或不匹配应失败，不能跳过：

```sh
node --import ./tests/fixtures/synthetic-home.mjs --import tsx --test tests/attachment-native-input.engine.test.ts
```

用例通过标准是退出0、断言全部通过且明确列出未跑平台／feature。新增浏览器、RTC、原生分享或本地媒体专项按 `scripts/test.mjs` 登记并维护 `docs/testing.md` 的命令和环境；不将真实模型或设备依赖混入默认测试。并行导致的范围外失败如实记录并协调归属，不为了全绿修改他人断言。交付前按 work-cleanup 只清理本任务临时资源，保留未知操作和恢复依赖。

## 交付顺序与尚未确认项

1. 先解开队列容量与附件数量的绑定。原生权限、输入顺序和重启恢复通过，并接入原图与视频帧后，才放开业务数量限制。
2. 第二阶段先交有界分块与原子提交，再贯通读取／导出／下载／手机分享；最后撤除对应整包门槛并完成版本兼容验收。
3. 各任务更新架构正文、索引与测试状态；明确保留的前序候选片段。没有后续当轮授权不暂存、提交、部署或操作日常实例。

固定引擎结果仅覆盖 macOS arm64 的本轮配置。其他 feature、真实模型和平台仍需各自验收。上传表迁移、设备端背压与内存、手机原生分享属于第二阶段。
