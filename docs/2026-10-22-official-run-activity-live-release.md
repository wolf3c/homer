# 官方 Run Activity 替换及实际上线记录

2026-10-22，Asia/Shanghai。**已完成替换、Web 验证并在原 4780 日常服务实际上线。** 11:18 正常停写并备份，11:19 通过原 Terminal 入口启动；11:22 确认原会话、队列及连接正常。本次未 Git commit/tag/remote，未打包、公证 App，未更改工具集合/描述、账号权限、业务状态机或数据语义。

实际完整 source 为 `6f996e5e405dc8d38680618b9d2597d5dece391540a042713e256e7bb83d6803`，不是 Git HEAD。实际 manifest 为 `ee7423c684a6008df7926222401bf1f7e6d487a42c82f85f0a8521dcd47923c1`（268项）；维护源243项完整输入与运行一致。已审补丁13路径，SHA `12c00931cc3d969265eebcce811581e7e79f1310b66c0fe1c463b3c82ee26e4d`；6个产品文件、5个测试、2份维护资料，只用准确hunk采用，没有复制工作区或按旧HEAD全量覆盖。发布后仅补充本报告、交付清单和截图SHA等文档，不改变产品源身份。

采用固定官方 commit `1f41f91643fdb56e5d8dbd14db65f742740738a1` 的 Run Activity 成品布局：[官方入口](https://www.assistant-ui.com/elements/run-activity)、[固定源码](https://github.com/assistant-ui/assistant-ui/tree/1f41f91643fdb56e5d8dbd14db65f742740738a1/packages/ui/src/components/react/assistant-ui/elements)。MIT原许可保留于 `ui/vendor/assistant-ui/LICENSE`；chevron沿官方Lucide几何，既有 `ui/public/composer-icons.LICENSE.txt` 保留ISC及Feather MIT。React、Radix原MIT许可保持。没有依赖安装、拷贝或锁文件变化；assistant-ui/runtime版本保持。

| 实际采用 | 官方依据及必要适配 |
| --- | --- |
| 受控单层 RunActivity、原ordered list、latest activity、empty status、live region、attention/final slots | 保留官方markup/utility表达；不叠加Tool Timeline，不使用Homer第二层工具折叠 |
| 字体14px/20px、图标14px、root/list间距12px | 最终三宽computed style核验；撤去原13px、44px整行标题和横线 |
| 触发器6px间距/圆角、4px纵向padding，列表1px细线、6px外距、14px内距、8px顶距 | component-scoped CSS精确等价，不初始化Tailwind/shadcn或全局主题 |
| 200ms展开及chevron旋转、原焦点环、reduced-motion | 保留已安装Radix1.2.1，按其measured-height/Presence映射官方collapsePanel；无forceMount/hidden覆盖 |
| muted/foreground/border/ring、字体家族 | 仅在组件内绑定既有Homer主题，继承主界面系统字体 |
| 原运行默认展开、终态只自动收起一次、用户重开与分页意图、真实计时与事实标签 | 属Homer必要生命周期/数据适配，不声称官方组件自动提供。官网演示的external-store接线、脚本时钟、ToolFallback内容/审批和示例正文没有照搬 |

Task/version/Run/事件身份与公开顺序保持，八条缺turn调用展开后逐条可读。返回只称调用已返回，不标检查通过；partial已验收仍是部分完成，无时间证据不造秒数，无final不造结论。失败/拒绝/受阻/未知和停止待确认在折叠外可见，独立Worker不延长主轮忙态或停止目标。最终答复、正式多文件成果、有效待答仍沿原位置和许可；分页、队列、附件、草稿、返工/终止、审批和成果归属合同保持。未混入Worker名称、成果卡片、任务列表或主Agent工具限制改版。

| Web实际渲染截图 | 默认 | 展开 | 异常 |
| --- | --- | --- | --- |
| 1440px | [打开](/Users/wolf3c/Project/homer/.codex/scratch/official-run-activity-20261022/candidate/.codex/scratch/run-activity/browser-final-screenshots/default-1440.png) | [打开](/Users/wolf3c/Project/homer/.codex/scratch/official-run-activity-20261022/candidate/.codex/scratch/run-activity/browser-final-screenshots/expanded-1440.png) | [打开](/Users/wolf3c/Project/homer/.codex/scratch/official-run-activity-20261022/candidate/.codex/scratch/run-activity/browser-final-screenshots/exceptions-1440.png) |
| 390px | [打开](/Users/wolf3c/Project/homer/.codex/scratch/official-run-activity-20261022/candidate/.codex/scratch/run-activity/browser-final-screenshots/default-390.png) | [打开](/Users/wolf3c/Project/homer/.codex/scratch/official-run-activity-20261022/candidate/.codex/scratch/run-activity/browser-final-screenshots/expanded-390.png) | [打开](/Users/wolf3c/Project/homer/.codex/scratch/official-run-activity-20261022/candidate/.codex/scratch/run-activity/browser-final-screenshots/exceptions-390.png) |
| 320px | [打开](/Users/wolf3c/Project/homer/.codex/scratch/official-run-activity-20261022/candidate/.codex/scratch/run-activity/browser-final-screenshots/default-320.png) | [打开](/Users/wolf3c/Project/homer/.codex/scratch/official-run-activity-20261022/candidate/.codex/scratch/run-activity/browser-final-screenshots/expanded-320.png) | [打开](/Users/wolf3c/Project/homer/.codex/scratch/official-run-activity-20261022/candidate/.codex/scratch/run-activity/browser-final-screenshots/exceptions-320.png) |

上述九张来自**与线上相同manifest的最终密封Web、隔离合成服务与实际Chrome156**，不是生成设计图，也不含真实聊天。三宽展开的八条调用全部处于可见视口内，均无横向溢出。官方实际网页参考：[运行默认](/Users/wolf3c/Project/homer/.codex/scratch/official-run-activity-20261022/candidate/.codex/scratch/run-activity/official-reference/official-live-running.png)、[完成默认](/Users/wolf3c/Project/homer/.codex/scratch/official-run-activity-20261022/candidate/.codex/scratch/run-activity/official-reference/official-live-complete.png)。官方实际computed root gap=12px、trigger=14px，类名与固定源码一致；Homer列表、间距、字体、图标和展开按该源码采用。官网额外展开参考在时限内未观察到预期状态，未取得该截图；不将此解释为组件故障。官网工具内容渲染器属于应用接线，不能作为Run Activity自带工具卡/执行能力。

| 验证 | 实测及范围 |
| --- | --- |
| 前像红灯 | 准确前像在1440/390/320均未满足本次单层官方呈现合同；截图和断言保留 |
| 定向行为 | 45/45，0失败/0跳过；真实身份、revision、计时、终态、异常、公开答复及历史合同 |
| Web连续阅读 | 三宽42项通过；八条无turn调用、两个内部段、同名不同task、不同version、partial已验收、无耗时/无final、公开进展/最终答复、有效待答、风险和独立后台Worker |
| 生命周期 | 三宽真实SSE断连/恢复、可信计时冻结/恢复、键盘重开、终态公开链接焦点归还及分页卸载/重挂的展开意图通过 |
| 正式成果 | 三宽正式多文件各归原答复，Canvas精确返回，1MiB正文复制及下载SHA相同；未调用真实模型/生产上传/外发 |
| 官方样式补测 | 最终生产构建三宽Space键、焦点环、200ms panel/icon曲线及reduced-motion通过；最终密封重取九张清晰截图 |
| 生产构建和UI类型 | Node22.22.0通过；Vite已有大chunk提示保留。87份后端编译文件与旧密封逐字节相同 |
| 全项目类型 | 未通过：18项错误与维护基线在根路径归一后逐行相同，涉及附件测试导入/类型、JSX配置与声明等；本批没有新增错误或顺手修复 |

早期合成DOM无法模拟移除焦点子树时浏览器如何更新activeElement，因此将该断言交给真实Chrome链接焦点路径；合成检查沿生产调用方的thread/process key验证身份隔离，最终没有跳过测试。行为测试复用相同TSX/业务字节；最终仅补全官方chevron缓动曲线，定向样式补测覆盖该变化，没有无理由重跑App或全套测试。上一轮3项抽取测试既有失败本次未重跑。真机中文IME、VoiceOver、WebKit和200%缩放未测；未取得已有Safari标签页资源身份，未强刷页面或清空草稿。

实际正常启动回执核实 `gpt-6.1-sol/high`、原主线程标记和存储线程SHA；运行工具指纹与原 `MAIN_TOOLS` 相同，没有 `main_tools_migration_required`。配置字节SHA保持，账号、专属原生home、模型/Fast设置和线程指针保持；未换线程、清锁、伪造停止或重放uncertain。

| 实际线上资源 | 浏览器内SHA-256 |
| --- | --- |
| `index-CdOI9_St.js` | `8a660a29336faa1f56f20deb83ea45ea9b7a818bb3f0d14fab5f09936f012053` |
| `index-BjA2PvUb.css` | `4913bee578b91c8d407504e203bc39a0d44428f6ffd018d1130f8705fb56b1ac` |

线上实际UI hash为 `58a5dc83c7871997041481859c3ba3e085aecdca2354f4502b331669ac2ad537`。真实Chrome加载原会话，仅GET，在浏览器内读取缓存资源并计算SHA，与实际密封字节逐项一致；官方14px字号、12px间距和无旧横线实际生效，输入和附件入口保留，无横向溢出。源码写回与构建本身没有代替此线上证据。验证浏览器没有真实业务输入、上传、审批或模型测试；仅允许空输入框裁图，没有真实聊天截图。

安全空闲门禁在停服前复核主轮/Worker/持久队列/审批/媒体租约/渠道发送/transport均0，原两条门禁未知回执哈希未变。只向准确原launcher发送一次正常SIGTERM，8个归属进程全部退出，锁和lease自然释放。0700/0600停写维护点包含446项文件和191项业务引用、两库及WAL/SHM、原配置入口、完整旧密封和准确源码前像；账号/home/依赖保留原路径不复制。对最终维护点实际构造旧→候选→旧数据库owner，60张业务表及3张网关表的全部schema、列、行、原线程、uncertain相同，integrity=ok、FK=0，无持久迁移。

上线后全部原表/列/行核验通过，仅新增当前owner lease与微信正常重连generation+1。3条业务uncertain、6条微信uncertain逐行相同，191项引用字节保持；队列/交互/主轮为空，微信connected、Telegram offline保持。原主线程SHA `bba235fe11eddb5c678fccb0ecb7b68479d4349bbc7ceb761e3f9a7d17ac9077`。工具链14,226项、89个运行依赖核字节一致，安装/复制0，无新缓存别名。

私有维护点相对候选：`.codex/private/official-run-activity-maintenance-20261022T031820Z`；`backup-index.json` SHA `8b843313895898e25a65d6b78bd45af6d41a3a8b782aaad70878fe01903c3c8b`。原旧密封、配置、准确源码前像及业务事实组合保留。实际采用后的13路径小副本完成反向还原每个前像、再正向还原每个后像，未线上回退。**若上线后新增业务或连接事实，禁止旧库覆盖，须保全新事实后前向修复；本批回退只限准确展示代码和对应兼容构建，不撤销他人改动。**

[准确产品/测试采用补丁](patches/2026-10-22-official-run-activity.patch)、[13路径前后SHA与回放](patches/2026-10-22-official-run-activity-bindings.json)、[完整Web证据与截图SHA](patches/2026-10-22-official-run-activity-verification.json)、[实际上线/资源/保全/回退清单](patches/2026-10-22-official-run-activity-live-verification.json)保留于维护源正常docs位置。最终交付的文档补充另有准确patch与前后SHA绑定，不改变已采用产品source；最初13路径binding中的verification后像代表采用时版本，最终文档后像以delivery绑定为准。临时截图/脚本位于已注册隔离工作区的.codex/scratch，不复制到docs/public；私有材料保持Git忽略。候选与备份为继续复核和回退而保留，不清理其他工作。

发布使用 [release-reviewed-local-agent-version Skill](</Users/wolf3c/Library/Application Support/CindyGlobal/owners/87403691aa9be3434bfd/bots/bot_1792116750356_mf01yl/skills/release-reviewed-local-agent-version/SKILL.md>)，授权范围已完成。
