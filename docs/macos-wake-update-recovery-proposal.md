# macOS 唤醒服务异常与桌面更新恢复

2026-11-24 · 方案待评审 · 已完成隔离决策验证，原生交接待验

**建议把更新的电源条件收敛为本实例能否安全停止安排唤醒并确认没有残留。** 对同路径、兼容的正式更新，先在独立 macOS 上验证能否保留共享服务登记。只有验证通过的发行路径才可免注销。两处一起成立，才能解除这次阻断。

## 事故和验证证据

- **原故障。** 11 月 24 日 09:14–09:18，0.1.23 / build 311 更新至 0.1.24 时，ServiceManagement 显示 `enabled`，BTM 日志有 `fullPath is nil` / `container null`，launchd 找不到 `app.homer.desktop.power`。对 `enabled`，旧预检还要求已认证的 XPC 实际响应，失败发生在 `update-stop` 之前。原故障的 OS build、查询域、登记路径和当时队列缺直接证据，登记异常的根因仍未知。Apple 的 `enabled` 表示已登记且有资格运行，服务实际可用要靠 XPC 回执判断。 [Electron 更新入口](../packaging/electron/main.mjs#L1015) · [Mac 客户端](../packaging/macos/PowerClient.swift#L39) · [Apple 登记状态](https://developer.apple.com/documentation/servicemanagement/smappservice/status-swift.enum/enabled?changes=_9&language=objc) · [Apple 的登记与 XPC 对照](https://developer.apple.com/documentation/ServiceManagement/updating-your-app-package-installer-to-use-the-new-service-management-api)
- **两道阻断。** `7f8fc801` 把检查提前，避免异常时先停业务，同时允许复用已确认的停止回执重试清理。0.1.24 保留这套逻辑。13 项隔离差分使用冻结主进程、真实 JS 适配器与原生回执替身。旧版发送零次停止请求。允许可信空队列进入停机后，仍卡在共享 helper 注销。假定原位交接已经验收后，完整方案才在安全停止、清理确认后调用一次模拟安装。另有 82 项适配器／协调器／停止协议和 8 项相关 Electron 用例通过。Swift 内存夹具验证了精确清理、坏记录与跨 UID／profile 归属。 [0.1.23 修复](https://github.com/wolf3c/homer/commit/7f8fc8018aab19dfe53d58d327b908417ec6d4b5) · [普通退出已有读回](https://github.com/wolf3c/homer/commit/a11b354427b343b7ba320e7719450e7fb1feec2e)
- **真实快照。** 后续在 macOS 27.2（26B123）验签确认安装包为 0.1.24 / build 312，包内仍有两道门禁。系统域找不到服务，BTM 只读查询因管理员授权检查未能取得登记记录。未提权 IOKit 读到 2 条系统事件、0 条 Homer 标记，`pmset -g sched` 一致。该快照证明本机能在 helper 缺席时读队列。早前事故的队列、当前是否有在途写入、IOKit **全局空表与读取失败的区别**均缺对应实测。
- **关闭竞态。** 真实协调器配合延迟 `authorize` 替身时，`close()` 可以先报告成功，已受理的授权随后才完成。这个实验没有触发原生登记。关闭证明必须涵盖已经受理的授权与唤醒操作。 [协调器授权与关闭](../src/desktop-power.ts#L83)

## 更新路径

1. **确认前判断能否完成交接。** 保留现有候选验签、草稿检查和用户确认。仅在 XPC 不可用或其他前置条件已明显不满足时查已有证据。可信空表、无已知未决写入，且候选满足原位交接条件时，唤醒不可用可降级。残留无法取消、身份或读回未知、已知需要注销但无法完成时，保留运行并提示下一步。可达 helper 上的已知事件由停机后清理。预查结果不能充当最终回执。
2. **安全停止并排空唤醒操作。** 用户确认后使用一次现有 `update-stop`，沿用宿主的忙态和 owner/lease 释放协议。停止证明须同时有 `update-stopped` 和同一 runtime 无信号退出 0。协调器开始关闭时拒绝新授权、唤醒写入和可建立新 lease 的状态刷新，排空已受理的原生操作，释放本实例防休眠保护，再读回系统事件。复用现有请求超时和回执，超时结束的是等待，原生效果仍可能未知。空队列不能结清结果未知的授权或唤醒写入。 [宿主停止协议](../scripts/desktop-runtime.mjs#L160) · [关闭与协调](../src/desktop-power.ts#L104) · [原生连接与授权](../packaging/macos/PowerClient.swift#L39)
3. **证明本实例干净。** Helper 可达时用原签名 XPC 和 lease 按原时间、类型和名称精确撤销。两条路径最终都复用 IOKit 读回，使用原 profile 的稳定实例身份和 UID。新 ID 或恢复哈希不能替代丢失的身份。匹配本实例的坏时间记录仍是残留，可疑的 Homer 记录无法归属时保留未确认。只有可判读的数组能证明没有本实例事件。Apple 的公开实现会丢弃底层查询返回码，连接、IPC 或解码失败均可能得到 `NULL`，在更新证明中按未知处理。未知事件写入需原生会话串行清理回执和可信队列读回共同结清。 [现有 IOKit 读回](../packaging/macos/PowerEvents.swift) · [Apple 队列实现](https://github.com/apple-oss-distributions/IOKitUser/blob/323ead896d04424f87184d8f6ff0cce811aab106/pwr_mgt.subproj/IOPMAutoWake.c#L614-L620) · [底层查询](https://github.com/apple-oss-distributions/IOKitUser/blob/323ead896d04424f87184d8f6ff0cce811aab106/pwr_mgt.subproj/IOPMAssertions.c#L3411-L3438)
4. **交给现有安装器。** 免注销只用于已通过签名包验收的升级。ShipIt 实际目标的规范路径与登记对应的可信执行路径须各自保持不变，签名要求、daemon label、`BundleProgram`、Mach 服务、XPC 和事件身份须兼容。实机证明其他实例的工作、lease 和事件不受影响。Mac 的就绪通知只报告版本，因此通过现有正式渠道发布门禁与固定包摘要校验，约束启用此路径的源版本可取得或已暂存的全部目标包。无法保证时沿用共享排空与注销。移动、卸载和不兼容迁移沿受控维护路径处理。当前尚无实机证明，免注销保持关闭。 [发行约束](desktop-app-update.md) · [共享排空](../packaging/macos/PowerHelper.swift#L35) · [注销及只读复核](../packaging/macos/PowerClient.swift#L98)

正常退出更新方案中的 Mac 注销要求是当前默认。只有通过上述放行条件的路径，普通退出安装与主动重启才共用替代清理条件。前者沿 ShipIt 的不重开暂存走 `app.quit()`，后者沿 `quitAndInstall()`。暂存状态或此前重开意图未知时保留原门禁。Windows 沿用 Task Scheduler、guardian、候选完整性复核及现有 NSIS 路径。两平台均以实际运行版本和资料复核确认安装。 [现行更新与停机规则](desktop-app-update.md#6-安全停止后才重启) · [Electron](https://www.electronjs.org/docs/latest/api/auto-updater) · [Squirrel 暂存与重开](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLUpdater.m#L965)

## 失败、恢复和 LLM 边界

- 停机前遇到可确认的阻断，窗口保留运行。停机超时先对账。迟到的 ACK 只计入同一 runtime 的原请求，仍需无信号退出 0。未确认时不重发停止，也不切换普通退出。已安全停止后清理失败，保留停止证明并显示实际状态。重复点击合并，短暂失联最多做一次限时只读复核。注销或安装交接未知时先核对，原动作明确未生效且可以重试时才接受新的确认。已暂存的 Mac 从恢复窗口选择「退出荷马」也可能触发安装，仍须通过同一门禁。
- 旧版用户先由设置复查实际 XPC。管理员只在明确待批准或拒绝时处理 Homer 的后台项目。显示启用却查不到服务时，由支持侧核对包路径、签名、BTM、系统域与事件；旧版的授权按钮在 `enabled` 时只复查。若无法恢复且旧版阻止安全退出，保留实例，另行协调停机。确认 owner 已停止、事件已清且无并发原生替换后，才可备份并按授权使用官方签名包过渡。0.1.24 仍会执行旧规则。 [Apple BTM 诊断](https://support.apple.com/zh-cn/guide/deployment/depdca572563/web)
- 更新确认、停机、事件归属、系统授权和安装交接由桌面主进程、宿主及原生回执决定。LLM 可以解释明示状态，不能代用户授权、凭日志推断成功、调用提权或安装，也不能补写回执。重开后宿主沿现有规则重查，一次安排补投一次，周期只补最近到期，按原稳定投递身份去重入箱。已领取且结果未知的操作查原回执，原始授权照常复核。复用现有协调器、IOKit、XPC、定时和更新组件即可，无需额外状态库、守护进程或后台重试流程。 [定时与恢复契约](architecture/scheduled-tasks-architecture.md)

## 最小验收与放行

| 层级 | 证据 |
| --- | --- |
| 离线 | 既有夹具逐项覆盖可信空表放行、真残留、坏记录／未知读回、未决写入、授权未排空、多个 UID／profile、忙碌及缺停止证明。成功路径只交接一次，未知路径零次。0.1.24 冻结复用 `tests/electron-shell.test.mjs` 的 VM 替身，补 Preview 的空 `expirePermissions` 供退出夹具运行。同一环境用 Node 22.22.0 执行 `node --import tsx --experimental-vm-modules --test tests/macos-power.test.mjs tests/desktop-power.test.ts tests/desktop-update-stop.test.mjs` |
| 独立签名 Mac | 独立机器或 VM，使用其 BTM 和系统域，准备管理员许可、隔离资料及临时 feed。验证未提权读回的空表、有事件及未知结果，覆盖健康登记、拒绝授权及 enabled／job 缺席。原生替换和失败回滚均核对应用路径、现有 helper 与其他实例的连续性，改名或路径变化拒绝免注销。替换后验证新 helper 冷启动、运行版本和原资料。未复现原故障时保留该场景缺证。两种退出意图及立即重开沿独立方案验收 |
| 业务与平台回归 | 分别验证一条真实唤醒事件可精确撤销、另一条实际唤醒后只入箱一次。授权拒绝时清醒定时和随后补投仍可用。Windows 在独立环境按原计划复验清理及 NSIS 交接 |

当前没有已获准且独立于日常系统登记的签名测试环境。原位保留登记的交接、真实故障根因和恢复仍待验证，合成安装调用次数不计入实机验收。

## 本轮实施范围

签名且隔离的 macOS 环境尚不可用。先落实三处可离线验证的收尾改动。协调器排空已受理的授权和唤醒操作，Mac 适配器保留授权回执未知；原生更新收尾以可判读的系统队列核对本实例；Mac 停机超时后只核对原请求，迟到的完整证明仍需用户重新确认。现有唤醒预检、共享排空和注销继续生效，当前故障的旧版交接仍可能被阻断。免注销路径在独立签名环境通过验收前保持关闭。

隔离源码候选使用 Node 22.22.0。Mac 原生编译、适配器、协调器和更新停止协议共 91 项通过，Electron Shell 更新、唤醒及退出定向 85 项通过，均零失败或跳过。类型检查通过。首次运行整个 Shell 文件时，4 项接管运行时夹具也在未修改的 `6bed64cc` 基线复现失败。独立代码复审复跑相关离线用例 77 项和新增竞态等定向用例 7 项，均通过。未执行签名包安装和真实系统替换。

在 `f083402c` 基线上隔离复验，91 项核心及原生用例、85 项 Electron Shell 用例和类型检查均通过。
