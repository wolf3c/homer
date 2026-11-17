# 定时任务展示：正式源码合成验收

本目录为本次实施的正式 Homer UI 渲染证据，全部使用本地合成消息及安排，不读取或操作真实计划。没有提交、安装或部署。仅Preview展示结构化安排；对话只有普通答复。

- [桌面中心](center-1440.png) · [390px中心](center-390.png) · [320px中心](center-320.png)
- [桌面详情](detail-1440.png) · [390px详情](detail-390.png) · [320px详情](detail-320.png)
- [桌面正文底部](detail-bottom-1440.png) · [320px正文底部](detail-bottom-320.png)
- [桌面chip](chip-1440.png) · [390px chip](chip-390.png) · [320px chip](chip-320.png)

[browser-result.json](browser-result.json)记录三种宽度的实际交互：与原文件标签共存、切回原文件、对话无卡片、长内容完全保留且任务内容末行、关闭按钮实际命中、Tab／Shift+Tab焦点约束、Escape返回原卡片且保留Preview、引用不打开详情或自动发送、移除／刷新恢复chip、完整ID在真实HTTP请求中仅拼接一次、原state触发刷新及失败不伪装空列表。Chrome正常退出code0、forced=false、watchdog=false，页面错误0。截图已逐项查看；临时构建、浏览器profile和合成数据在交付前回收，可按仓库测试入口重建。

[source-hashes.json](source-hashes.json)标识当时共享工作区中的有关源码；其中包含保留的并行改动，不代表本事项独占补丁或提交快照。组件来源：官方ScheduleCard的本地适配版、只修改导入路径的完整SpecSheet，以及原Homer attachment-dialog封装；详见[vendor说明](../../ui/vendor/assistant-ui/README.md#schedule-center-2026-11-17)。不新增业务实体或数据库schema。

定向离线106项及两端／完整类型检查、局部生成CSS一致性、独立Vite产品构建通过。通用Composer文件另57项通过，6项旧恢复fixture受沙箱只读目录限制未完成，提权重跑未获批准，不称该文件全绿。不代表真实模型、渠道实网撤权、安装版或实体手机验收。

方案与实现范围见[项目计划](../../docs/superpowers/plans/2026-11-17-scheduled-task-display.md#8-实施与验证2026-11-17)；复验命令见[testing](../../docs/testing.md#定时任务-preview-展示2026-11-17)。本目录保留供当前评审；评审结束后可由任务清理流程回收PNG和运行快照。

提交前复审：此前6项历史恢复已补验，Composer整文件63/63。仅叠加本事项补丁的独立候选161项合成回归及HTTP1项通过，产品与完整类型检查通过。详见方案第9节，原失败限制为历史记录。

本轮精确提交候选的最新截图： [桌面中心](review-center-1440.png) · [390px详情](review-detail-390.png) · [320px chip](review-chip-320.png)。[候选复验记录](review-verification.json)及[Chrome正常退出](review-browser-result.json)；1440／390／320px全部通过，退出0、forced=false、watchdog=false。仅本人补丁的候选类型与独立构建通过，无新增产品代码修正。
