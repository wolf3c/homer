# Homer 原生 Token MVP：v1-r5-native-token-mvp

> 2026-11-04 未发布契约增量：会员角色配置新增必需 `context`（取代初稿的 `deepseek`），模型已改为无具体名单的字符串，并支持可选 capabilities；当前候选为 Terra high / 272000 / 244800，取代本文的四字段限制，见 [会员上下文配置下发](2026-11-04-membership-context-config.md)。本文其余内容保留为原合同记录。

2026-10-29。三方共同定义的唯一源文件；复制时逐字复制并校验 SHA-256。不使用旧 manifest/bundle 发布协议。本轮替代 r4 的独立账户、订单充值及内部接口；历史记录不删除。仅本地合成验证，禁止据此开启真实收费或调用。

## 1. 职责与秘密

AMH 使用未打补丁的 New API rc45，准备一个 Homer 专用普通用户（role=1）、足额 owner 钱包及其 PAT。PAT 只有 api_key:read、api_key:write、api_key:reveal；网站不请求需要 profile:read 的 /api/user/self，不使用 root 或管理员凭据。网站私有配置固定 origin、ownerUserId、ownerAccessToken、tokenQuota；PAT 只用于管理 API。Token 使用原生 default 分组、模型、渠道、计费及额度查询。每个网站 uid 对应一个有限原生 Token；subject 是网站 uid，不是独立 New API 用户。

网站复用原登录、/homer、本人确认、PKCE/state 和五分钟一次性 code。私有映射放入 Meteor.users.services.homerToken，不新建集合；Token ID/Key 不发布给网页，不进入日志/APM。Homer 只在本人一次性交换成功后接收模型 Key，并存入原本机秘密文件。网站不维护余额、不充值、不增加订单、退款或设备实体。人工停用/换 Key 使用 AMH 原生后台；网站复用 /help。

## 2. 网站与 Homer

授权请求及回调、POST /api/homer/v1/token 的五个字符串字段沿用 r3 的 PKCE/state 规则：grantType=authorization_code、clientId=homer-desktop、code、codeVerifier、redirectUri。拒绝额外和重复 JSON 字段。回调仅允许 http://127.0.0.1:<1..65535>/homer/oauth/callback。code 五分钟有效，先验证完整配置再原子消费；消费后崩溃、超时或响应丢失均不能重放，必须重新发起连接。

交换成功严格只有三个字段：{subject, modelToken, config}。删除 accountRef，不新增 tokenRef；原生 Token ID 只留网站私有存储。config 与独立 GET /api/homer/v1/config 相同，严格只有 main/worker，二者均为 {baseUrl, model, effort, fast}。正式值固定为 https://models.super-tree.com/v1、deepseek-flash、max、false；只在显式合成隔离配置下允许 http://127.0.0.1:<port>/v1。GET config 不依赖登录、数据库、购买或管理凭据。

普通 /homer 保持原整站初始化；带授权参数的文档保持 no-store、no-referrer、采集排除，离开时整页导航；复用原 Login 弹窗，不重构 client/main.js。授权页提供确认、取消、另开普通首页，不嵌支付。首页不承诺充值或展示已撤回商品。

错误为 {error:{code,retryable}}：400 INVALID_REQUEST；401 UNAUTHORIZED（本人 code/证明/会话）；403 FORBIDDEN（服务 PAT/权限）；403 ACCOUNT_UNAVAILABLE（已有 Token 停用、到期或不可用）；409 CONFLICT（创建未确定、匹配不唯一或配置归属冲突，需人工）；429 RATE_LIMITED；503 UNAVAILABLE。只有临时 429/503 可 retryable=true，绝不回传上游原始错误或秘密。FORBIDDEN 不提示用户反复登录。

Homer 可继续读取含旧 accountRef 的本机文件，下一次自然写回不再保存该字段；不删除既有 Key/历史。原生 Token 用量 GET /api/usage/token/ 只用 data.total_available/total_used；unlimited_quota 必须为 false，异常时显示未知，禁止读取 user_quota、推测或补零。界面称“个人 Token 额度/已用”，网站按钮称“打开网站”。

## 3. 原生 Token 管理与未知结果

所有管理请求使用 Authorization: Bearer <owner PAT>，不使用模型 Key 或 New-Api-User。timeout <=30秒，禁止跨 origin 重定向，响应有界。原生接口：

- POST /api/token/：name、remain_quota=显式正整数 tokenQuota、expired_time=-1、unlimited_quota=false、model_limits_enabled=false、model_limits=""、group="default"、allow_user_quota_query=false。成功只返回 success/message，不返回 ID/Key。无正式初始额度默认值，合成例为100000；该例不定义赠额政策。
- GET /api/token/search?keyword=<name>&p=1&page_size=100：data={page,page_size,total,items}。name="homer-"+sha256(uid)前40位（46字符）；服务端再次精确匹配 name、owner user_id。结果必须完整（page=1、total=items.length<=100）；部分结果、重复或不唯一均不采用。
- GET /api/token/:id：校验该 ID、owner、name、有限额度、allow_user_quota_query=false、group=default。status=1 正常；status=4 额度耗尽仍允许交付已有 Key（调用由原生额度限制）；status=2/3 或 expired_time 已到期拒绝交付。禁止把已禁用 Token 当作新用户重建。
- POST /api/token/:id/key：读取 data.key，仅交付给 Homer，不输出到命令、日志或报告。模型请求使用 sk- 前缀；若原生原始 key 未带前缀，网站添加一次。

映射最小字段为 origin、ownerUserId、name、id、key；先 CAS 持久化前三项意图，只有成功写入意图的请求能 POST 一次。后续请求只搜索并采用唯一原 Token，不再创建。先绑定 ID，再读取和绑定 Key；写回失败后仍使用原 ID 恢复。原生创建没有幂等键/name 唯一性，故未知结果绝不自动重新 POST：搜索零项/多项或崩溃在 POST 前，返回 CONFLICT，由人工核对。该保守限制避免多实例和崩溃静默发第二份额度，不增加租约、扫描任务或自制账本。

origin/owner 配置改变与既有映射冲突时拒绝，不静默挪用或替换。重连复用原 Token，不自动补额。停用、清除意图或替换 Key 需要后续单独授权；当前不提供网站管理后台。原生管理接口的403属于服务权限；不能借此删除映射。

## 4. 验证与交付边界

三方直接锁本文件 SHA、各自实际 HEAD 与未提交 diff；不编造 candidate commit。AMH 提供未打补丁 rc45 合成宿主及0600合成配置路径，不在消息交换秘密。网站使用新合成 Mongo、OS 外网/真实配置拒读探针、假登录输入；旧测试库不复用、不删除。测试包含创建一次、并发/响应丢失/ID和Key写回失败恢复、owner/name/status/有限额度/权限异常、原生用量及假上游扣费、本人隔离、一次性 code、真实 App 导航和桌面/手机。

移除网站旧内部 ensureAccount/creditQuota、Homer 商品支付/恢复任务及对应测试/文档入口；原支付宝、微信及旧商品路径保留。历史 HM 订单不能落入旧权益发放，保留最小拒绝边界，不扫描生产数据、不自动迁移或删除历史订单/授权/receipt。保留独立 RTC 等并行工作。

本地通过只代表合成候选；真实配置注入、初始额度/商业政策、真实验证、提交和部署另行授权。
