# Run Activity 代码审阅与提交边界

2026-10-22。审阅对象为上一轮已上线的准确13路径增量及后续文档绑定，未将HEAD的全部差异当作本批代码。此前17个最终绑定路径全部匹配。仓库原有123个tracked dirty路径、暂存区为空；本批5个产品路径和多项测试/支持实现此前尚未tracked。

发现并修复P2：`ui/vendor/assistant-ui/run-activity.tsx`在open=false之后仍由Radix Presence保留200ms退出动画，期间Tab可进入已折叠公开链接。真实Chrome390px在关闭后约40ms复现：aria-expanded=false、hidden=false，焦点仍进入A。修复由RunActivity组件owner立即设置inert/aria-hidden；保留动画，重开恢复焦点。不新增状态、依赖、计时循环或全局监听。新增`tests/run-activity-focus.browser.mjs`覆盖三宽Tab、程序focus、关闭DOM卸载及重开链接可聚焦。另删除本批样式测试的两个未使用变量，补充来源说明。

45项定向检查重新通过，UI类型及生产构建通过；新增焦点浏览器回归1440/390/320均通过。此前一次重跑30通过/15失败全部为临时目录EPERM，改用隔离合成目录及获准执行权限后45/45通过。没有通过改断言跳过真实故障。

性能核查使用2000条独立调用、准确替换前像与审阅候选各一份本地Chrome样本：默认折叠均未挂载调用行；候选展开就绪约258ms（含官方200ms动画），展开DOM后代6001个，收起后0个；前像展开就绪约82ms、展开后代6008个、收起后保留3个状态节点。前像内部还有第二层工具折叠，展示合同不同，不能由这组数字宣称整体提速。确认详情仍按需读、关闭后卸载、没有全历史常驻DOM或新网络/轮询。该本地单样本不是生产性能SLO；不为追求未测量收益增加虚拟化或缓存。现有投影分组的重复every扫描不属于本批新增，本次未扩大重构范围。

准确审阅修复仅4路径，补丁SHA `3c18b463fe307a3e3cf0f31b3f0381cfcbd85c138f2b95bcedd8ecb6db6e24da`，前后SHA和正反回放见`docs/patches/2026-10-22-official-run-activity-review-bindings.json`。维护源已采用准确hunk，完整source `bb57a1f16e5535c40ea57048c714421a142c2b64893d6a58b188f7f148719335`；线上仍为上一轮 `6f996e5e405dc8d38680618b9d2597d5dece391540a042713e256e7bb83d6803`，本次没有重启/重新部署，不把源码修复或Git提交当成已上线。

提交存在需要明确的边界：`ui/process-nodes.tsx/.css`及`ui/vendor/assistant-ui/run-activity.tsx/.css/README.md`在HEAD都不存在，其完整文件含前轮未入库基线；`ui/DESIGN.md`还叠有更早修改。直接git add这些路径会带入之前的实现，且只提交这几个完整文件会缺少同样未入Git的投影/测试/依赖等支持基线。不能构造只有本批几行、却无法使用的源文件，也不能默默把所有dirty工作纳入。

两个可审阅方案：仅提交本批精确补丁、来源与验证记录（Git中保留可回放代码增量，工作树原有修改保持）；或者先将当前必要公开源码/测试建立基线，再单独提交本批增量（明确将此前未入Git的相关工作纳入历史）。用户已明确选择“提交精确补丁记录”：本次只提交准确代码补丁、来源、审阅和验证资料，不纳入此前未提交的源文件基线，不将该commit冒充完整可构建产品源码快照。源文件与测试的实际修改保留在工作树中。

[原准确补丁](patches/2026-10-22-official-run-activity.patch)、[原逐路径SHA](patches/2026-10-22-official-run-activity-bindings.json)、[审阅修复](patches/2026-10-22-official-run-activity-review.patch)、[修复SHA/回归证据](patches/2026-10-22-official-run-activity-review-bindings.json)。原发布记录继续描述当时线上身份，不改写历史。
