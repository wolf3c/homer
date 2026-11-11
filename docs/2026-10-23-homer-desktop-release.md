# Homer 桌面整合与安装发布

2026-10-23。用户已明确授权必要的旧对话兼容修复、审阅提交main并安装打开，保留原账号、主thread、聊天、任务、成果与权限事实。

本记录创建时仍处于最终提交前：没有安装、没有改变原库/账号/真实绑定。准备基线3c5461180575aa90f9430f35152f444530185913，两个指定功能前置与近期提交均已核main可达，详见[审计表](2026-10-23-desktop-release-readiness.md)。旧桌面包装未在Git树，已形成独立整合闭包，未混入维护树其他未提交产品功能。

完整准备来源为[原桌面补丁](patches/2026-10-23-desktop-integration-candidate.patch)及[采用/兼容增量](patches/2026-10-23-desktop-adoption-candidate.patch)。沿现有Swift/AppKit/WKWebView、稳定bundle id app.homer.desktop.candidate、0.1.0 build4、固定Node22.22.0/Codex0.163.0及89生产JS包；没有新框架、依赖或发布平台。原五工具合同仅精确版本对兼容，保留原native定义/主thread/工具hash，未知合同拒绝。真实采用方案、路径和副本预演见[采用记录](2026-10-23-desktop-account-adoption.md)。

最终准备验证为22合同+6包内完整入口+1真实隔离原生协议，另复用字节相同UI的148浏览器检查及官方CSS。全项目137条既有诊断逐条与准确Git前像一致；原Web宿主401/409与旧T08问题的前像归因保持，不冒称全仓全绿。没有真实模型或Fast服务吞吐实测。

提交时仅暂存准确候选版本；维护main中service.ts和homer-app.tsx的其他未提交内容已做无冲突三方合并预演，按必要hunk保留，不纳入本次提交。其余dirty/staged/untracked不收编。提交后选完整准确SHA一次冻结，普通模式从Git archive重建；准备包不直接安装。

正式切换仍须新鲜核owner/原生操作/渠道/队列；当前只读观察原main无pending收件、2个uncertain用户输入保持，微信6个uncertain不重放、无待发送，所有Task已settled。确认维护点与私有备份后只CAS原网关必要binding，contract由原owner在无pending时正常采用，不删除请求行或改business binding。桌面只写机器私有采用描述，原账号和数据根保持原路径，不复制auth或native sessions。

正常安装目标为/Applications/Homer.app（此前未发现已安装实例，安装前复核）。用安装后的App核真实代码、Node/host/Codex路径、版本/完整SHA/sourceHash/manifest/UI、原账号就绪、原thread及历史/任务/成果/权限连续性。正常系统校验，沿现有本机ad-hoc签名路径，不声称新Developer ID/公证，不清quarantine或绕过Gatekeeper。成功后核引用并清理本次及旧无用安装包/构建目录，保留已安装App、数据、人工输入测试profile及最小一致恢复材料。

产生新业务事实后不以旧库覆盖回退；正式安装与验收结果、实际身份、时间、清理和恢复边界将在此续记。当前文档不是已安装证明。
