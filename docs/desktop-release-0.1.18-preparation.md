# Homer 桌面 0.1.18 发行记录

2026-11-18：0.1.18 / build 303 三平台构建及云端完整性校验通过，Release ID 449534863 保持草稿。ARM 实际安全退出出现“系统唤醒清理未确认”，隔离验收未通过，因此未公开、未切换 Latest、未安装。用户明确自行手动更新，禁止自动退出或替换日常应用。

- 已提交 main 基线 `11d976e8c0c201cfde815d3b46b4cdb3c54e9210`，远端 main `83967e8fe06dc48e6e5c0f2b0540dc25c498c2b5` 是其祖先，本地领先 29 提交，无分叉。上版标签 v0.1.17 的完整差异为 31 提交、286 文件（含两条发行记录提交）；发行版本字段另行提交。
- 上版及本机均为 0.1.17 / build 302；新标签 v0.1.18 未占用，已核对公开版本及可见草稿未发现更高 build。本轮仅修改发行版本字段，其他事项未提交修改不进入包。
- 范围 desktop / desktop-three；Mac ARM macOS 27+、Intel macOS 14+，Developer ID 签名、公证；Windows 11 x64 未签名 NSIS。仅 ARM 本机隔离验收，其他平台实际运行及完整原生自动升级保持未验证。
- 网站 `https://super-tree.com`，网关 `https://models.super-tree.com`，沿用工作流显式参数。工作流与模板一致，远端已注册 active，签名 Secrets 名称齐全。
- 主要源码变化：内嵌 Preview 浏览器及批注、图片缩放与 Markdown 图片路径、定时任务视图、长历史连续加载及虚拟显示、渠道绑定即时生效、消息呈现与任务状态简化、模型默认值及会员审批。
- 原 Latest v0.1.17 / Release ID 447249295，11 附件；缺少各启用平台实际原生升级及安全重启证据时保持原 Latest，不以手动安装代替。
- 构建、云端完整校验、ARM 隔离验收、本机安装、公开固定标签及分发核验分别记录实际结果。保护日常数据与在途执行；不强停，不发送真实测试消息。

## 源码同步及构建启动

- 发行提交 `ae293ea188feb071cba6ca538194c3b41d2d64db` 仅包含根 package/lock 三处版本字段和本记录。main 与不可变 v0.1.18 标签远端回读均为此完整 SHA；保留其他事项未提交内容，index 在提交前后为空。
- [运行 44238613748 / attempt 1](https://github.com/wolf3c/homer/actions/runs/44238613748/attempts/1)，2026-11-18T04:37:26Z，workflow_dispatch，操作者 wolf3c，desktop / desktop-three / build 303，草稿直传。只触发一次；plan 成功，后续结果待核实。
- 精确发行源码导出到本轮 Git 忽略 scratch，使用 Node 22.22.0；规划/草稿协议 29/29，桌面 profile、更新 runtime、Electron shell、Preview 权限、渠道及历史滚动离线检查 582/582，零跳过。初次受 scratch 沙箱写入限制，获准后重跑通过；不将权限失败归为产品失败。
- 宿主确认尚有其他在途工作；本机安装未开始，不退出日常实例。需要在包验收后重新核实全部执行、队列、未发送草稿与待生效配置。

## ARM 正式包检查及已证实的发行阻塞

- ARM ZIP 432,264,015 字节，SHA-256 `f3501a5681c0f0dd6621144eee97a4c03e3127b521c85705137567cf16de6f11`，与原始回执及平台清单一致。包内封存版本/build、完整 SHA、正式标记、网站/网关地址逐项与回执一致。codesign deep/strict、stapler、Gatekeeper 通过，Notarized Developer ID。
- 正式包 runtime 定向 9/9，零跳过：历史、附件、同线程保留及重启，owner/路径/网关安全拒绝和正常锁释放；没有运行其他扩展案例，不能将定向结果写成完整专项通过。
- 原 Electron 四场景首轮 1 通过、3 失败；可见首次功能导览遮挡发送。仅在隔离源码 harness 中加入正常关闭导览步骤，原断言及签名包不变。初次适配有显示时序问题，随后依据 pending 等待可见后关闭。最终复验四场景仍全部在等待退出确认时超时，因此整体不通过；合成消息正常完成、崩溃后原线程与精确附件恢复等中间断言已通过，不代替退出验收。
- 单独未登录合成窗口诊断记录真实原生对话顺序：`退出荷马？` → `系统唤醒清理未确认`，之后 close 超时（25 秒）。未接受第二个警告，未绕过安全门禁。仅确认本轮退出受此提示阻塞，系统唤醒清理失败的底层原因尚未定位，不推定新版本回归或无害环境问题。
- 因实际安全退出未通过，暂停公开和本机安装，保持草稿及原 Latest v0.1.17。用户日常账号、资料、电源配置/权限及在途执行未改动。云端构建和完整性校验继续独立跟踪；不以其成功覆盖此缺口。
- 用户后续明确正在使用 Homer，禁止自动退出、安装或替换日常应用，全部完成后自行手动更新；此指令覆盖 Skill 自动安装。本轮已核验的原 ZIP 保留在 `/Users/wolf3c/Project/homer/.codex/scratch/github-build/44238613748/1/Homer-mac-arm64.zip`，不为清理而删包或重复下载。
- 只读补充：退出前合成状态为无渠道、`protection=none`、`nextAt=null`，wake `supported=false / authorization=unavailable / status=idle`；系统 `app.homer.desktop.power` helper 正在运行。上版标签至本候选的 `scripts/macos-power.mjs`、`src/desktop-power.ts`、`PowerClient.swift`、`PowerShared.swift` 无差异。不能据此证明环境原因或消除缺口；最小后续诊断是在独立实例捕获原生 status/close 的具体错误码，再核对 helper 注册来源/版本与 XPC 验签。不得在失败时默认忽略 close 或自动接受警告；没有修改系统 helper、权限或日常电源配置。
- 本轮卡在原生模态的隔离进程经命令、启动时间及 profile/cwd 精确核验后回收，普通 SIGTERM 未能结束的本轮临时实例才使用获准 SIGKILL；它仅是测试资源收尾，不计为安全退出验收。回读本轮 Electron 实例为 0，日常和其他事项实例未操作。

## 最终云端校验与交付状态

- 同一 [run 44238613748 / attempt 1](https://github.com/wolf3c/homer/actions/runs/44238613748/attempts/1) 的 plan、两种 Mac、Windows、verify-draft 五个 job 均 success；没有重跑、覆盖附件或移动标签。
- 云端完整流式下载校验全部请求平台，上传合并清单和 SHA256SUMS，完整草稿 11 附件。三份原始小回执及合并清单的版本/build、SHA、正式标记、服务地址与本轮请求一致；GitHub 附件大小/digest 对应清单，ARM 本地完整 ZIP 及全部小清单摘要一致。Intel/Windows 大包未在本机重复下载。

| 安装包 | 字节数 | SHA-256 |
| --- | ---: | --- |
| Homer-mac-arm64.zip | 432264015 | `f3501a5681c0f0dd6621144eee97a4c03e3127b521c85705137567cf16de6f11` |
| Homer-mac-x64.zip | 401183424 | `9d895b7e29230f144d3f1821ab55da14c9d0fd155817f31bf346e5125b7889d0` |
| Homer-windows-x64.exe | 305369670 | `f78acaac5b92140ec95b9cd2700354ec5ccc72d6f36f3619458a46ceb95da142` |

- 两 Mac 回执为 Developer ID、公证/stapling；Windows 回执为未签名，原生实机未验收。只有 ARM 做了本地检查，签名/Gatekeeper 与 runtime 定向通过不代替 Electron 安全退出、完整安装/卸载、登录或跨平台原生升级验收。
- 双语草稿正文逐字回读一致，开头明确安全退出失败及暂不推荐作为已验收更新。草稿附件只能经授权仓库访问，固定标签公开下载尚不可用；不交付虚假的公开下载链接。
- 原 Latest v0.1.17 / ID 447249295 保持不变；认证 API 的全部 11 附件 ID/名称/大小/digest 与初始匿名基线一致。最终匿名 API 遇到 403 rate limit，不记为通过或不存在；匿名网页 HTTP 200 跳转至 v0.1.17，确认公开 Latest 页面仍旧版。
- 用户可自行使用上述本地原 ZIP；本轮没有退出或替换日常应用，没有停机备份或资料迁移，因此没有日常安装/资料保留验收可报告。
- work-cleanup 回收本轮无占用的解压 App、合成 profile 和精确源码测试副本，共 1,208,078,336 分配字节；非 APFS 可用空间精确增量。保留原 ZIP 供用户手动使用，小回执和 `diagnostic/electron-harness.patch` 供未完成发行和退出原因排查，待用户完成手动更新且相关排查结束后清理。共享依赖、并行改动、历史材料及日常资料未清理。
- 构建开始后主线新增其他事项提交，本轮候选仍固定 `ae293ea188feb071cba6ca538194c3b41d2d64db`；没有把后续提交补入包、移动既有标签或顺带推送后续 main。最终记录的提交/同步另受并行 Git 窗口约束。
