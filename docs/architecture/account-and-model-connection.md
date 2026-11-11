# Homer 账号与模型连接

更新：2026-11-11。荷马来源沿用普通 New API 用户及每位网站用户的有限额度原生 Token；ChatGPT 来源的本机角色配置见下节。

用户在系统浏览器登录 yezi2，Homer 自动接收本人模型 Token 和运行配置，正常重启后生效。主 Agent 和 Worker 直接访问网关，设置里展示个人 Token 额度。

2026-11-03：删除开发阶段手填 Token 的桌面实验入口和日常版默认模型分支。荷马来源仅采用网站授权交付的账号与配置，充值使用该网站账号原有的 Token 映射。仅含 Token 的测试文件不再作为有效连接，不查询其余额，也不迁移或删除；网站授权成功后才原子保存正式连接。授权取消或失败保留原文件，应用继续沿原安全停止与重启流程，不改变历史、主对话和 Codex 登录。本机原测试连接是否已完成网站授权须单独核验，源码通过不代表账号已对齐。

- yezi2：网站身份、网站用户与 Token 的私有映射、一次性授权码交付和运行配置。
- AMH：一个专用普通归属用户，复用原生 Token、模型、价格与计费；共享用户需有足够额度，每人的 Token 仍有限。
- Homer：本机秘密、subject 校验、角色配置、个人 Token 额度及原有历史数据保全。

暂不自动充值，不建设设备 grant、每人独立网关钱包、充值去重表或内部 Homer API。购买保持关闭。

详细边界见 [MVP 需求](../33-account-payment-model-gateway-requirements.md)；源码改动及验证见 [原生 Token MVP](../2026-10-29-homer-native-token-mvp.md)。三方接口只采用 yezi2 维护的 v1-r5 合同，旧合同和旧联调结果只作为历史。

网站向公开配置接口和 PKCE 兑换返回同一套经过校验的配置。主 Agent 与 Worker 各自声明运行参数。字段、取值和能力校验见[会员配置契约](../2026-11-04-membership-context-config.md#通用边界与能力)。

## ChatGPT 模型设置（2026-11-11）

「设置 → 账号 → ChatGPT 套餐」分别配置 Homer（内部 `main`）和 Worker。产品默认值集中在 `src/model-config.ts`：Homer 为 `gpt-6.1-terra / high / priority`，Worker 为 `gpt-6.1-terra / xhigh / null`。CLI 默认值、荷马服务的角色合同及首次登录欢迎页保持原职责。

现有私有 `desktop-profile.json` 增加可选 `chatgpt`，按 `main / worker` 保存完整的 `{model, effort, serviceTier}` 覆盖。等同产品默认的角色不保存，全部默认时移除该字段。切换来源保留另一来源的配置，不迁移资料、不新增文件或表。运行配置中的 `serviceTier: undefined` 沿用原 `fast` 语义，`null` 明确清除加速档，字符串采用原生档位 ID。

现有账号桥的 `nativeModels()` 返回保存值、产品默认值和权限过滤后的目录；`applyCodex(roles?)` 有参数时只接受完整两角色草稿，无参数保留原来源切换行为。它们沿 Electron、desktop runtime、dev-host、service 和原生 control 管道传递。宿主只允许可信主窗口、限定接口参数个数和字段，不提供任意 RPC。目录通过 `model/list` 读完分页并排除隐藏模型，合并 `configRequirements/read` 的速度限制，只投影模型 ID、名称、深度、默认深度及服务档；不向界面转发原始账号响应、邮箱或凭据。

速度须同时得到模型和账号许可。原生 `planType: promax` 对应 Pro $500；现有明确的企业按用量／自动化套餐标识还须管理员显式允许 Ultrafast。未知、旧式企业／教育标识不据名称推断资格。原生权限不能确认时目录读取失败或不开放该档，不增加套餐查询服务。

界面采用固定官方 standalone ModelSelector／ModelSelectorEffort，关闭搜索，外观及草稿交互见 [UI 约定](../../ui/DESIGN.md#2026-11-11-chatgpt-模型设置)。打开页面、原账号变更通知及手动重试时读取目录，不轮询。应用失败时单次重读目录；临时账号读取失败保留草稿并禁用操作，重新确认后继续原草稿。已保存模型、深度或服务档失效时禁止应用并要求用户处理。切换模型只保留兼容参数，其余采用目录默认深度和标准速度并提示核对；无可调深度时使用目录声明的默认值。

应用时宿主重新读取目录及权限并校验完整组合，将来源和角色参数放入原停止／重启意图。只有用户确认、旧进程安全退出且调用窗口仍可信时，才一次原子保存来源和两角色覆盖，然后重启。取消、确认失效、停止未确认或保存失败均清除意图，不提前写盘或部分保存。每次建立或恢复 ChatGPT 线程后，现有 `thread/settings/update` 显式设置模型、深度、服务档，逐轮继续传同一角色参数；标准档发送 `serviceTier: null`，不继承旧 Fast／Ultrafast。沿用同一线程 ID 和历史恢复，不重建 runtime 或 CODEX_HOME。

当前为维护源码实现：定向配置、账号、profile、Electron、UI 与离线协议回归通过；前后端类型检查、构建和默认核心回归通过。固定 Codex 0.163.0 的隔离模型替身验证三档速度及标准清除、跨来源原线程续聊。实际设置组件在内置浏览器验证桌面、390px、320px、键盘、Escape、焦点和弹层层级。复验命令及边界见[测试说明](../testing.md#chatgpt-模型设置)。未安装或发布，真实 Pro $500 资格与调用、打包后的平台验收仍待单独安排。

## 2026-11-05 授权结束与配置对齐

以 build 266 为支持基线，网站须交付 main、worker 的完整 `context`。本次只读检查发现线上网站 `6.1.36 / 6136` 的运行代码及 settings 仍为旧四字段配置，安装版真实校验器返回 `INVALID_REQUEST`；只补入本地现有 context 即接受。yezi2 当前源码已共用配置生成函数供公开配置与 Token 兑换使用，本次不增加服务端协议或客户端默认值。线上修复需要另行授权发布对应代码及 settings，之后重新发起授权，不能重放旧授权码。

本机 loopback 收到合法回调立即提示“授权请求已收到，请返回 Homer 查看连接结果。此页面可以关闭。”，最终连接状态以 Homer 为准，不增加网页结果同步。当前授权兑换及保存成功或失败后，账号状态更新再复用 `showWindow()` 显示并聚焦窗口；原正常重启生效规则保持不变。

开始退出时中止当前授权并通知账号状态，防止兑换中的迟到结果保存凭据；取消退出后需从 Homer 重新发起授权。已取消、已被新操作替代、退出中的结果不发布连接或抢焦点。PKCE、Host/state、单次消费、私有原子保存及失败保全规则不变。

本地定向检查：`node --import tsx --test tests/homer-account.test.ts` 58 项通过；`node --experimental-vm-modules --test tests/electron-shell.test.mjs` 289 项通过，含成功/兑换失败/保存失败聚焦，以及取消/替换/退出后的迟到成功及失败。两组在系统 Node 26.9.0 与安装版自带 Node 22.22.0 上均通过，后者直接执行源码测试，不启动日常账号。桌面入口 Node 22 语法检查与本次 `git diff --check` 通过；保留原实验 VM 警告。

未构建、安装、部署或执行真实账号/收费模型验收，未验证系统实际聚焦与 Safari 安装 PWA 关闭。该桌面改动需要后续安装版更新。网站端退出操作与完整验证记录见 yezi2 的 `docs/homer/2026-11-03-authorization-submission-local-validation.md`；两端使用合成数据的本地通过不表示线上或当前安装版已生效。
