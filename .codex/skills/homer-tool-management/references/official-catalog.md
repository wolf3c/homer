# Cindy 官方插件源码适配参考

核对日期：2026-10-19。[官方插件源码仓库](https://github.com/makecindy/cindy-official-plugins) 当前核到 25 个顶层 `ghost.json` 目录；以下逐项列出实际来源。源码目录数不是当前市场可安装数，有些仍定向／分阶段发布，不能用一次市场搜索的前 20 条当完整目录。

## 使用边界与源码获取

- 本页是源码参考，不是可直接安装的 Cindy 插件清单。有独立 CLI／MCP／Skill 可满足任务时，按 [精选安装表](curated-tools.md) 安装，无需适配原包；独立方案不承诺与原插件全部功能等价。
- 需要 Cindy 特有逻辑时，读取对应源码目录的 `ghost.json`、`main.js`、README、Node worker 和许可，选定 tag／commit `REF`。完整源码可由 `https://github.com/makecindy/cindy-official-plugins/archive/REF.zip` 获取，在本任务 scratch 解包检查；不用为下载创建项目 Git 仓库。
- `.cindy` 是 Cindy 包，`ghost.json`／Host 消息不是 Codex Plugin manifest 或 MCP 协议；不要交给 `plugin_install` 或 `mcp_save` 假装能直接运行。原 worker 的 `json-rpc-stdio` 也不自动等于 MCP。
- 适配只提取当前任务所需逻辑，替换 `cindy.fetch`／`cindy.fs`／`callId`、秘密注入或 UI 等依赖，做成独立脚本／CLI／MCP；若涉及新增宿主开发或扩大任务范围，先确认，再按 [执行方法](execution.md) 验证和采用。需要新增宿主开发时如实说明，不能声称“安装完成”。不为使用一个插件开发整个 Cindy 兼容层。

仓库整体标为 Apache-2.0；保留 LICENSE／NOTICE，复用前核具体目录、依赖与第三方材料许可。开源源码不授予 Cindy 托管服务、付费额度、品牌背书或他人 OAuth 凭据。独立方案的账号由本人授权；不复制其他应用的秘密。没有实测中国大陆全网可达性，Google／xAI 等仅供对应用户按需选择。

## 25 个插件：独立方案与原包适配

| Cindy 插件 | 作用 | 完整源码／获取位置 | 可用独立方案（见精选） | 复用原包所需开发／条件 |
| --- | --- | --- | --- | --- |
| **Mermaid** | 图源规范化／修复 | [`cindy-mermaid`](https://github.com/makecindy/cindy-official-plugins/tree/main/cindy-mermaid) | Mermaid CLI | 图源规范化／修复逻辑需提取为独立脚本。 |
| **GitHub** | 仓库／Issue／PR／Actions | [`cindy-github`](https://github.com/makecindy/cindy-official-plugins/tree/main/cindy-github) | GitHub MCP | 替换 Host fetch、PAT 注入、下载票据。 |
| **GitLab** | Issue／MR／流水线 | [`cindy-gitlab`](https://github.com/makecindy/cindy-official-plugins/tree/main/cindy-gitlab) | glab | 替换多实例 Token 和 Host 文件接口。 |
| **Notion** | 页面／数据库 | [`cindy-notion`](https://github.com/makecindy/cindy-official-plugins/tree/main/cindy-notion) | Notion MCP | 自行管理授权、fetch 与文件接口。 |
| **TapTap CLI** | 开发者业务 | [`taptap-cli`](https://github.com/makecindy/cindy-official-plugins/tree/main/taptap-cli) | TapTap CLI | 插件的 Node 会话桥需适配。 |
| **World Bank Open Data** | 国家／经济指标 | [`world-bank-open-data`](https://github.com/makecindy/cindy-official-plugins/tree/main/world-bank-open-data) | — | 提取 API 调用逻辑；公开数据无需 API key，核数据口径。 |
| **Gmail** | 邮件查询／处理 | [`google-gmail`](https://github.com/makecindy/cindy-official-plugins/tree/main/google-gmail) | gws | 替换 Host Google OAuth／Node worker。 |
| **Google Drive** | 云盘文件 | [`google-drive`](https://github.com/makecindy/cindy-official-plugins/tree/main/google-drive) | gws | 替换 Host 账号及文件桥。 |
| **Google Calendar** | 日程／会议 | [`google-calendar`](https://github.com/makecindy/cindy-official-plugins/tree/main/google-calendar) | gws | 替换 Host OAuth。 |
| **Google Sheets** | 在线表格 | [`google-sheets`](https://github.com/makecindy/cindy-official-plugins/tree/main/google-sheets) | gws；本地 XLSX 见办公工具 | 替换 Host OAuth。 |
| **163 Mail** | IMAP／SMTP 邮件 | [`163-mail`](https://github.com/makecindy/cindy-official-plugins/tree/main/163-mail) | Himalaya | 替换 Node JSON-RPC 桥与秘密注入。 |
| **QQ Mail** | IMAP／SMTP 邮件 | [`qq-mail`](https://github.com/makecindy/cindy-official-plugins/tree/main/qq-mail) | Himalaya | 替换 Host 授权码注入；原包不是公开 MCP。 |
| **iCloud Mail** | IMAP／SMTP 邮件 | [`icloud-mail`](https://github.com/makecindy/cindy-official-plugins/tree/main/icloud-mail) | Himalaya | 替换 Host 秘密注入；独立方案需本人应用专用密码。 |
| **Yahoo Mail** | IMAP／SMTP 邮件 | [`yahoo-mail`](https://github.com/makecindy/cindy-official-plugins/tree/main/yahoo-mail) | Himalaya | 替换 Host 秘密注入；独立方案需本人应用密码。 |
| **Outlook Mail** | Microsoft 邮件 | [`outlook-mail`](https://github.com/makecindy/cindy-official-plugins/tree/main/outlook-mail) | — | 原包依赖 Host OAuth／Graph；另核自有 OAuth 应用或独立客户端，通用 IMAP 不保证等价。 |
| **Art** | 图像／短视频生成 | [`cindy-art`](https://github.com/makecindy/cindy-official-plugins/tree/main/cindy-art) | 使用当前已暴露的图片生成能力 | 依赖 Cindy Core 媒体服务；另接有权使用的生成服务，不能借 Cindy 额度。 |
| **Web Search** | 网页检索 | [`cindy-web-search`](https://github.com/makecindy/cindy-official-plugins/tree/main/cindy-web-search) | 已有搜索不足时选 Brave／Tavily | Cindy AI 托管服务不随源码转移。 |
| **Cindy Chrome** | 浏览器集成 | [`my-browser`](https://github.com/makecindy/cindy-official-plugins/tree/main/my-browser) | Playwright | 替换常驻 Node、Host library／任务／确认；原 worker 不是通用 MCP。 |
| **OpenDesign** | HTML 设计预览 | [`opendesign-trial`](https://github.com/makecindy/cindy-official-plugins/tree/main/opendesign-trial) | — | 会话预览／标注 UI 和对话模型接口需宿主适配。 |
| **Contacts** | 联系人管理 | [`cindy-contacts`](https://github.com/makecindy/cindy-official-plugins/tree/main/cindy-contacts) | — | 核数据存储和授权接口；不能自动导入 Cindy 联系人。 |
| **TapTap Maker** | 项目同步／构建 | [`taptap-maker`](https://github.com/makecindy/cindy-official-plugins/tree/main/taptap-maker) | — | 另核官方 Maker Runtime、账户和服务条件；不借用 Cindy Runtime 登录态。 |
| **同程程心** | 同程程心服务集成 | [`tongcheng-chengxin`](https://github.com/makecindy/cindy-official-plugins/tree/main/tongcheng-chengxin) | — | manifest 为 Node mcp-stdio 候选；仍须核实际 worker、API key 注入和服务，不能凭协议认定开箱可用。 |
| **X Manager** | X 检索／发帖 | [`x-manager`](https://github.com/makecindy/cindy-official-plugins/tree/main/x-manager) | — | 检索依赖 xAI 服务，发帖走 X API；另核账号、费用和发送授权。 |
| **Baguette** | iOS 模拟器集成 | [`baguette-simulator`](https://github.com/makecindy/cindy-official-plugins/tree/main/baguette-simulator) | — | 替换 Node 会话和 Host 预览；核 macOS／Xcode／模拟器权限及运行时许可。 |
| **iOS Simulator** | iOS 模拟器工作流 | [`ios-simulator`](https://github.com/makecindy/cindy-official-plugins/tree/main/ios-simulator) | — | 替换 Host 嵌入／交接流程；复制配置不能获得执行器。 |

这些目录均已核到；对 GitHub、GitLab、Notion、Mermaid、QQ、163、Cindy Chrome、TapTap CLI、同程程心、Baguette、Gmail 另读了 manifest／实现边界，其余是明确的源码获取入口，实际适配前继续读该目录。未将旧缓存版本号写作最新版，没有安装或运行上述插件。
