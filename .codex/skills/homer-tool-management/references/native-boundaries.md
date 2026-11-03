# 原生浏览器与电脑组件的独立接入边界

2026-10-18 对固定 Codex 0.163.0 的核验：原生 Plugin/MCP 可承载工具，但未找到官方 bundled Browser／Computer Use 的独立宿主接入合同或明确再分发许可。官方 [Browser](https://learn.chatgpt.com/docs/browser) 文档明确该桌面功能不在 CLI／IDE 中提供，[Computer Use](https://learn.chatgpt.com/docs/computer-use) 描述桌面插件和本人系统权限路径。这不证明 app-server 的任意第三方浏览器插件都不可用。当前不能用开关开启、复制桌面资源或仅安装 Skill 代替执行器；也不能据此断言未来永不支持。

这项已有证据可直接作为本版本选用成熟替代方案的依据，不要求每个任务重新研究。版本或官方支持路径变化时再复核。第三方云端 Browser Use 与官方 bundled Browser 不同，也不具备本地桌面权限。独立 Computer Use API 的认证、计费与 driver 另行判断，不能假定复用 Codex 订阅。

浏览器和桌面分别验收。系统权限、第三方连接由本人完成；缺这些条件不等于需要自建控制引擎。旧 Playwright／cliclick 打包稿仅作开发候选，不作为默认已安装事实。
