# 官方 Run Activity 替换与 Web 发布计划

2026-10-22，Asia/Shanghai。用户明确授权实施、Web 验证和上线；不包含 Git commit/tag/remote、工具权限、业务数据语义及无关清理。

维护源 `/Users/wolf3c/Project/homer` 的243项输入与当前实际 source `f93e3a8e7c29987b06359d9b137009d4674e0fcb5bfb02e866a71cebcefea036` 一致，manifest `5d18546df90ee6d168587fa4fb1b0911a407866fb01ec36ad8e1b6c653b7c521` 的268项和线上 JS/CSS核验通过。HEAD不是产品身份。候选仅写 Cindy `create_project` 已登记的 `.codex/scratch/official-run-activity-20261022/candidate`，不覆盖维护源并行工作。

采用现有官方固定commit `1f41f91643fdb56e5d8dbd14db65f742740738a1`，MIT，来源为 https://www.assistant-ui.com/elements/run-activity 及 https://github.com/assistant-ui/assistant-ui/tree/1f41f91643fdb56e5d8dbd14db65f742740738a1/packages/ui/src/components/react/assistant-ui/elements 。沿用原官方组件源码和LICENSE；只取 Run Activity，不叠加 Tool Timeline。官网应用的external-store脚本、时钟、最终答复分类和演示文本不属于组件内置能力，不移植到业务状态。

当前差别是Homer用13px、44px整行触发器、横线和自绘列表/第二层工具折叠替换了官方呈现。本批修改 `ui/vendor/assistant-ui/run-activity.tsx/.css/README.md`、`ui/process-nodes.tsx/.css`、`ui/DESIGN.md`及对应定向测试。恢复官方完整markup/utility表达及 scoped CSS精确等价：12px节奏、14px字体/图标、6px触发器间距/圆角、列表1px细线、200ms展开。无需依赖、锁文件或共享runtime升级。

必要适配仅为原主题角色映射、现有Radix measured-height/Presence对官方Base UI collapsePanel的等价接入、原触发器/内容焦点ref及业务事实。原有默认运行展开/真实终态收起一次、真实计时、Task/version/Run/事件身份和原序保持；不推测结论。有效待答、正式答复/多文件与后台Worker保留在外；失败/拒绝/受阻/未知/停止待确认不随折叠消失。分页、队列、附件、草稿、返工/终止、审批、成果许可、MAIN_TOOLS及线程不变。

验收使用既有合成真实Web：八次无turn调用、两个内部段、同名不同task、同task不同version、partial已验收、无耗时无final、运行/异常/后台独立状态、待答与成果。1440/390/320px对照官方真实网页及前像截图；检查单层展开、官方计算样式、键盘、焦点、流式/断连/分页稳定、必要行为/类型/生产构建。只做一套Web，不重复App打包公证，不向真实服务提交模型/上传/审批/外发测试。

采用前生成准确hunk、逐路径前后SHA，重核维护输入未漂移。使用既有release-reviewed-local-agent-version流程，核schema/gateway/工具/依赖兼容，等待安全空闲；正常生命周期停写后做0700/0600一致维护点，保全两库/WAL/SHM、原配置/入口、旧密封、源码前像、uncertain及引用，并用实际数据库owner离线预演。正常Terminal原入口启动，核实际source/manifest/密封、真实Chrome所加载JS/CSS及原会话/配置/事实保全。原线程兼容失败不得换线程绕过。

回退只限本批准确展示代码和对应构建，核维护点身份并保留新事实；不旧库覆盖新增业务，不清锁、伪造停止或重放未知操作。完成报告保留补丁、逐路径SHA、依赖许可、实际三宽截图、验证结果、实际采用及保全/回退证据；阻塞必须如实列明。
