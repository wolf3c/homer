# 第 1 类：精选 Skill 与工具

核对日期：2026-10-19。参考 Cindy 实际公开插件／SkillHub 的分类和常用任务，优先选择可独立接入 Homer 的上游实现。每项给出用途、安装位置／命令及条件；“精选候选”表示来源与安装入口已核对，不表示已安装、已在 Homer 实测或效果排名。当前已暴露的搜索、图片等能力直接使用，不重复列作待安装工具。

| 任务类别 | 本文具体条目 |
| --- | --- |
| 自动化 | Playwright CLI／MCP、Cua Driver；Midscene 作为视觉自动化备选 |
| 创意与设计 | frontend-design、design-taste-frontend、web-design-guidelines、Mermaid CLI、algorithmic-art、canvas-design、Draw.io 重建 |
| 开发与效率 | webapp-testing、writing-plans、react-best-practices、systematic-debugging；code-review 为条件候选 |
| 沟通与写作 | humanizer、internal-comms、Himalaya 邮件 CLI |
| 集成与知识协作 | 飞书／Lark CLI、GitLab CLI、Notion MCP、GitHub MCP、Context7、Google Workspace CLI、TapTap CLI |
| 运维与安全 | Wrangler、security-audit、Semgrep 规则、Sentry |
| 搜索与工具创建 | Brave／Tavily MCP（已有搜索不足时）；Anthropic skill-creator（原生 Creator 不足时） |
| 办公与文件 | PPT Master、BrandDocs、Hermes 办公 Skill，Anthropic 四项技术参考；另列底层生成、转换和渲染工具 |

从所需类别选一个合用方案；同类不整套安装。下面的 `REF`、`VERSION`、`PY` 等由 Agent 按 [执行方法](execution.md) 解析真实路径和精确版本。来源核对没有执行这些安装命令，也没有证明中国大陆各运营商可访问。

## 自动化：浏览器与电脑操作

| 工具／形式 | 功能与选用场景 | 安装链接／安装方法 | 前提及最小验证 |
| --- | --- | --- | --- |
| **Playwright CLI + Skill**（Microsoft） | 打开网页、填写、点击、截图、测试网页；有 Shell 的 Agent 优先考虑 | [仓库](https://github.com/microsoft/playwright-cli)；`npm install --prefix "$HOMER_TOOLS/playwright-cli" --save-exact "@playwright/cli@$VERSION"`；Skill 子目录 `skills/playwright-cli`，完整安装见下方 | Node ≥20；CLI、Skill、浏览器分别检查；用受控页真实操作，不需要 OpenAI Apps |
| **Playwright MCP**（Microsoft） | 需要结构化 MCP 工具时进行浏览器操作；与 CLI 二选一即可 | [仓库／Codex 配置](https://github.com/microsoft/playwright-mcp#codex)；`npm install --prefix "$HOMER_TOOLS/playwright-mcp" --save-exact "@playwright/mcp@$VERSION"`；解析真实 bin，以 stdio 注册 | Node ≥18；缺浏览器按该版本帮助和上游说明安装；不等于已获现有 Chrome 登录态 |
| **Cua Driver**（独立桌面 CLI／MCP） | 读取本地应用／窗口和辅助功能树、截图、点击、输入；桌面任务候选 | [官方快速开始](https://cua.ai/docs/cua-driver/quickstart)、[PyPI](https://pypi.org/project/cua-driver/)；完整 macOS 路径见下方 | macOS 14+；Windows 交互桌面、Linux X11／AT-SPI 等按上游核对；屏幕录制和辅助功能由本人授权 |

### Playwright CLI 的配套 Skill

先选择 Microsoft 仓库 commit/tag，代入 `REF`：

```sh
python3 "$SKILL_INSTALLER" --repo microsoft/playwright-cli --ref "$REF"   --path skills/playwright-cli --dest "$HOMER_CODEX_HOME/skills"
```

CLI 自带 `playwright-cli install --skills` 也是[上游安装方式](https://playwright.dev/docs/getting-started-cli)，但运行前核对其实际目标；Homer 优先显式 dest 的原生 Installer，避免写进默认全局目录。选择该版本 CLI 的真实可执行入口后，先运行 `--help`；浏览器安装和启动按该版本说明完成。不要猜 `playwright-cli install chromium`，也不要为一个任务同时默认装 CLI 和 MCP。

### Cua Driver 的 macOS 安装

[Cua 官方连接指南](https://cua.ai/docs/cua-driver/guides/connect-your-agent) 使用独立 `CuaDriver.app` 和 Driver CLI。先将 `INSTALL_SCRIPT` 设为本任务 scratch 内的绝对文件路径，下载脚本、检查来源与内容，再在现有授权内执行，避免盲目 `curl | sh`：

```sh
curl --fail --location https://cua.ai/driver/install.sh --output "$INSTALL_SCRIPT"
# INSTALL_SCRIPT 是本任务 scratch 中的绝对路径；审阅后才执行
/bin/bash "$INSTALL_SCRIPT"
open -n -g -a CuaDriver --args serve
cua-driver permissions grant
cua-driver doctor
cua-driver call list_apps
cua-driver mcp-config --client codex
```

最后一项输出当前 CLI 的**绝对路径**和真实 Codex 注册方法；在 Homer 中优先转为既有 MCP 管理请求，不盲目执行会写全局配置的命令。本人在系统设置处理 Accessibility／Screen Recording。该安装器会安装桌面组件到上游约定位置，不能承诺全部文件进入 Homer 目录；先核实际影响。需要纯 Python 集成时，实际包为 `cua-driver`，私有 venv 内 `python -m pip install cua-driver`，CLI 为 `cua-driver mcp`；**pip 包安装成功不代替 macOS app／daemon／权限准备**。基础 Driver MIT；可选 perception 组件另有许可，不默认安装。

官方 Codex 桌面 bundled Browser／Computer Use 与这里的独立工具不同，已有证据见 [原生配套边界](native-boundaries.md)，不要求每个任务重新研究。


### Midscene：视觉浏览器自动化备选

**browser-automation**／web-infra-dev，MIT：通过截图和视觉模型操作网页。Cindy 同名 Skill 的上游在 [midscene-skills/skills/browser](https://github.com/web-infra-dev/midscene-skills/tree/main/skills/browser)。安装方法：

`python3 "$SKILL_INSTALLER" --repo web-infra-dev/midscene-skills --ref "$REF" --path skills/browser --dest "$HOMER_CODEX_HOME/skills"`

实际执行器为 `@midscene/web`，可 `npm install --prefix "$HOMER_TOOLS/midscene" --save-exact "@midscene/web@$VERSION"`，按真实 bin 运行该版本帮助。上游示例使用主版本 1；选定对应精确版本。需要另行配置其支持的视觉模型和 `MIDSCENE_MODEL_*`，可能产生额外费用；不是安装 Skill 就复用当前 Codex 的视觉额度。默认独立 Puppeteer 浏览器，接已有 Chrome 的 CDP／扩展另有条件。已有 Playwright 足够则不再安装。

## 创意与设计

| Skill／许可 | 功能与选用场景 | 来源与安装命令 | 条件与验证 |
| --- | --- | --- | --- |
| **frontend-design**／Anthropic，Apache2.0 | 制作前端界面、页面和视觉方案；Cindy 同名条目的独立上游 | [上游目录](https://github.com/anthropics/skills/tree/HEAD/skills/frontend-design)；`python3 "$SKILL_INSTALLER" --repo anthropics/skills --ref "$REF" --path skills/frontend-design --dest "$HOMER_CODEX_HOME/skills"` | 方法型 Skill；使用当前编码工具，渲染验收仍需浏览器 |
| **design-taste-frontend**／Leonxlnx，MIT | 提高前端视觉质量，配套方向选择、检查脚本和参考材料 | [上游目录](https://github.com/Leonxlnx/taste-skill/tree/HEAD/skills/taste-skill)；`python3 "$SKILL_INSTALLER" --repo Leonxlnx/taste-skill --ref "$REF" --path skills/taste-skill --dest "$HOMER_CODEX_HOME/skills"` | 目录名 taste-skill，frontmatter 名 design-taste-frontend；Node22+、Chrome／Edge／Chromium；素材检索需网络 |
| **web-design-guidelines**／Vercel，MIT | 审阅网页交互、可访问性和设计规范 | [上游目录](https://github.com/vercel-labs/agent-skills/tree/HEAD/skills/web-design-guidelines)；`python3 "$SKILL_INSTALLER" --repo vercel-labs/agent-skills --ref "$REF" --path skills/web-design-guidelines --dest "$HOMER_CODEX_HOME/skills"` | 需联网读取上游最新规则；安装 Skill 不自动提供浏览器 |

### Mermaid CLI：流程图与架构图文件

**Mermaid CLI**／MIT：[官方项目](https://github.com/mermaid-js/mermaid-cli)。将 Mermaid 源码导出 PNG、SVG 或 PDF；对应 Cindy Mermaid 的绘图场景，但不是复制其宿主插件。

```sh
npm install --prefix "$HOMER_TOOLS/mermaid" --save-exact "@mermaid-js/mermaid-cli@$VERSION"
# MMDC 为包 bin 解析出的绝对可执行路径
"$MMDC" -i diagram.mmd -o diagram.png
```

当前版本要求 Node≥22.13，Puppeteer 可能另行下载浏览器；本地绘图不要求 OpenAI 账号。最小验证检查实际图像及文字，不能只检查退出码。


### 艺术、平面设计与可编辑图

以下条目从 Cindy 公开 SkillHub 反查独立上游。

| Skill／许可 | 用途 | 源码与完整安装命令 | 运行条件 |
| --- | --- | --- | --- |
| **algorithmic-art**／Apache-2.0（目录许可） | 生成式艺术与交互视觉 | [具体目录](https://github.com/anthropics/skills/tree/HEAD/skills/algorithmic-art)；`python3 "$SKILL_INSTALLER" --repo anthropics/skills --ref "$REF" --path skills/algorithmic-art --dest "$HOMER_CODEX_HOME/skills"` | 保留模板；需 p5.js、浏览器和相应 CDN／字体；模板的 Anthropic 品牌不改称 Homer 官方作品。 |
| **canvas-design**／Apache-2.0（目录许可） | 海报、静态视觉与 PNG／PDF | [具体目录](https://github.com/anthropics/skills/tree/HEAD/skills/canvas-design)；`python3 "$SKILL_INSTALLER" --repo anthropics/skills --ref "$REF" --path skills/canvas-design --dest "$HOMER_CODEX_HOME/skills"` | 完整安装 canvas-fonts 等资源；按实际任务准备渲染工具并检查字体许可。 |
| **drawio-reconstruction**／MIT | 从图像重建可编辑 Draw.io 图 | [具体目录](https://github.com/sxy1499894281/drawio-reconstruction-skill/tree/HEAD/.)；`python3 "$SKILL_INSTALLER" --repo sxy1499894281/drawio-reconstruction-skill --ref "$REF" --path . --name drawio-reconstruction --dest "$HOMER_CODEX_HOME/skills"` | 需 Python／Draw.io 导出及视觉复核，流程要求独立制作者／审阅者；协作接口不足不能声称全流程可用。 |

Anthropic 这里两个艺术 Skill 的目录许可已单独核对，不推及其受限 Office Skill。SkillHub 的作者、搜索摘要或热度不是兼容性证明；若原文依赖宿主工具，按本列核验和映射，不把缺少执行器的 Skill 当可调用能力。

## 开发与效率

| Skill／许可 | 功能与选用场景 | 来源与安装命令 | 条件与验证 |
| --- | --- | --- | --- |
| **webapp-testing**／Anthropic，Apache2.0 | 本地 Web 应用测试、交互验证和截图 | [上游目录](https://github.com/anthropics/skills/tree/HEAD/skills/webapp-testing)；`python3 "$SKILL_INSTALLER" --repo anthropics/skills --ref "$REF" --path skills/webapp-testing --dest "$HOMER_CODEX_HOME/skills"` | 含 with_server.py；依赖 Python Playwright 及浏览器，Node Playwright 包不代替它 |
| **writing-plans**／obra，MIT | 将任务整理为可执行、可验证的实施计划 | [上游目录](https://github.com/obra/superpowers/tree/HEAD/skills/writing-plans)；`python3 "$SKILL_INSTALLER" --repo obra/superpowers --ref "$REF" --path skills/writing-plans --dest "$HOMER_CODEX_HOME/skills"` | 纯计划可直接阅读；继续执行时按引用补充 executing-plans 等 Skill，不假设 superpowers 工具名在 Homer 存在 |
| **code-review**／mattpocock，MIT，条件候选 | 审阅改动、问题和需求；参考 Cindy 同名 Skill | [上游目录](https://github.com/mattpocock/skills/tree/HEAD/skills/engineering/code-review)；`python3 "$SKILL_INSTALLER" --repo mattpocock/skills --ref "$REF" --path skills/engineering/code-review --dest "$HOMER_CODEX_HOME/skills"` | 依赖 Git 比较基线、需求上下文及并行审阅接口；Homer Worker 不自动等于其子 Agent 工具，接口不满足时直接用已有审阅能力，不强装 |

webapp-testing 只有任务确需该配套脚本时，才在私有 Python 环境安装 `"$PY" -m pip install playwright`，再用同一个 Python 执行 `"$PY" -m playwright install chromium`。执行前锁定包版本并核浏览器下载；不要把 Skill 安装成功当测试已经运行。


### React 实践与系统调试

| 工具／许可 | 功能和选用场景 | 来源与安装命令 |
| --- | --- | --- |
| **react-best-practices**／Vercel，MIT | React／Next.js 性能与代码实践 | [具体目录](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices)；`python3 "$SKILL_INSTALLER" --repo vercel-labs/agent-skills --ref "$REF" --path skills/react-best-practices --dest "$HOMER_CODEX_HOME/skills"` |

| Skill／许可 | 用途 | 源码与完整安装命令 | 运行条件 |
| --- | --- | --- | --- |
| **systematic-debugging**／MIT | 复现、定位和验证错误 | [具体目录](https://github.com/obra/superpowers/tree/HEAD/skills/systematic-debugging)；`python3 "$SKILL_INSTALLER" --repo obra/superpowers --ref "$REF" --path skills/systematic-debugging --dest "$HOMER_CODEX_HOME/skills"` | 完整流程还引用 test-driven-development、verification-before-completion；按需补引用，不假设子 Agent 接口存在。 |

调试 Skill 的完整引用与实际工具接口按表中条件补齐，不因来源入选就认定全流程可执行。

## 沟通与写作

| Skill／许可 | 功能与选用场景 | 来源与安装命令 | 条件与验证 |
| --- | --- | --- | --- |
| **humanizer**／blader，MIT | 改进文字表达，减少机械化写作痕迹 | [上游目录](https://github.com/blader/humanizer/tree/HEAD/.)；`python3 "$SKILL_INSTALLER" --repo blader/humanizer --ref "$REF" --path . --name humanizer --dest "$HOMER_CODEX_HOME/skills"` | Skill 位于仓库根，必须显式 --name；不能把润色当事实核验 |
| **internal-comms**／Anthropic，Apache2.0 | 撰写项目进展、内部通知、FAQ 等沟通文稿 | [上游目录](https://github.com/anthropics/skills/tree/HEAD/skills/internal-comms)；`python3 "$SKILL_INSTALLER" --repo anthropics/skills --ref "$REF" --path skills/internal-comms --dest "$HOMER_CODEX_HOME/skills"` | 完整保留 examples；写稿不等于获准发送 |

### Himalaya：通用邮箱访问

**Himalaya**／MIT OR Apache2.0：[官方 v2.2.1 说明](https://github.com/pimalaya/himalaya/tree/v2.2.1)。用 IMAP／SMTP 读取和处理邮件，覆盖 Cindy 邮箱类插件的部分场景，不复用其 OAuth 或密钥。

已有且获准使用 Homebrew 的 macOS：`brew install himalaya`；其他系统使用 [官方 Releases](https://github.com/pimalaya/himalaya/releases)。安装后读取当前 `himalaya --help`，配置本人邮箱，再用 `himalaya account check`、`himalaya mailbox list` 做只读验证。

v2 的安全凭据可通过已有密码管理器的 `password.command` 提供，不能把邮箱密码写入公开配置、Skill、聊天或命令参数。邮箱需本人开启 IMAP／SMTP 或取得服务方授权；163／QQ 的 IMAP ID／认证配置按对应版本核对，未做真实邮箱连接验收。仅为查邮件不擅自发送；Gmail／Outlook 的 OAuth 要求也不能靠换 CLI 消除。

## 集成与知识协作

### 飞书／Lark CLI 与文档、知识库 Skill

**Lark CLI**／LarkSuite，MIT：[官方仓库及安装](https://github.com/larksuite/cli)。用于文档、知识库、云盘、表格、日历等；Cindy 的 `lark-doc`、`lark-wiki` 可以从这个独立上游获取。不是把 Cindy 连接迁进 Homer。

```sh
# VERSION 为核对后的精确 npm 版本；先查看安装器帮助及实际目标
npx "@larksuite/cli@$VERSION" install
# 浏览器中的应用配置和账号登录由本人完成
lark-cli config init --new
lark-cli auth login --recommend
lark-cli auth status
```

此命令是上游安装器，可能写入默认程序／配置目录；核对落点后在授权内执行，不能宣称 npm 私有前缀就涵盖全部安装。`--recommend` 是上游推荐权限集合，任务只需少量权限时按帮助缩减。选择本人实际飞书／Lark 环境，无需 OpenAI Apps。Node/npm 必需；Go1.23+／Python 仅从源码构建需要。

仅安装任务对应 Skill 和明确依赖，不照抄上游全局安装整库的命令：

| Skill | 功能 | 完整目录安装 |
| --- | --- | --- |
| **lark-shared** | CLI 配置、身份、登录和权限；其他 Lark Skill 的公共依赖 | `python3 "$SKILL_INSTALLER" --repo larksuite/cli --ref "$REF" --path skills/lark-shared --dest "$HOMER_CODEX_HOME/skills"` |
| **lark-doc** | 创建、读取和修改飞书／Lark 文档 | `python3 "$SKILL_INSTALLER" --repo larksuite/cli --ref "$REF" --path skills/lark-doc --dest "$HOMER_CODEX_HOME/skills"` |
| **lark-wiki** | 知识空间、节点及知识库文档操作 | `python3 "$SKILL_INSTALLER" --repo larksuite/cli --ref "$REF" --path skills/lark-wiki --dest "$HOMER_CODEX_HOME/skills"` |

三条使用同一已核对 REF；lark-doc／wiki 是按任务二选或组合，涉及云盘、表格、白板时才补其引用依赖。先做本人指定范围的只读验证，写入／发送沿原任务授权。原生发现、CLI 登录、服务权限、实际动作分别确认；没有中国大陆下载连通性实测。

### GitLab CLI：代码协作

**glab**／MIT：[GitLab 官方 CLI](https://gitlab.com/gitlab-org/cli)。管理 Issue、合并请求和流水线，支持 GitLab.com 及本人自建实例。已有 Homebrew：`brew install glab`；其他平台按 [官方安装](https://docs.gitlab.com/cli/)。

本人交互登录：`glab auth login --hostname "$GITLAB_HOST"`，随后 `glab auth status`、`glab mr list` 只读验证。优先系统安全存储；核该版本是否退回明文配置，不传 `--token` 到可记录参数或使用 insecure storage。安装和登录不授权创建 MR／推送代码。

### Notion MCP：用户已使用 Notion 时再连接

[Notion 官方接入](https://developers.notion.com/guides/mcp/get-started-with-mcp) 提供远程 `https://mcp.notion.com/mcp`。用 Homer 原生 `mcp_save` 注册 URL 后，沿其支持的原生 OAuth 登录；必要时在专属 HOME 下核固定 Codex 的 `mcp login notion` 帮助。需要 Notion 账号和相应网络，按服务条款使用；不是本地知识库或大陆用户基础能力的前提。先只读本人指定页面验证。

### GitHub 与开发文档 MCP

| 工具／形式 | 功能 | 安装或配置 | 条件与验证 |
| --- | --- | --- | --- |
| **Context7**／Upstash，本地 MCP | 按库和版本查询开发文档与示例 | [官方仓库](https://github.com/upstash/context7)；`npm install --prefix "$HOMER_TOOLS/context7" --save-exact "@upstash/context7-mcp@$VERSION"`，按真实包 bin 以 stdio 注册；[各客户端配置](https://context7.com/docs/resources/all-clients) | 读取当前服务要求，可能需 API key／OAuth；不在公开参数或聊天放凭据；查询一个已知库文档验证 |
| **GitHub MCP Server**／GitHub，HTTP MCP | 仓库、Issues、PR、Actions 等协作 | [官方 Codex 接入](https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-codex.md)；远程 URL `https://api.githubcopilot.com/mcp/`；原生 OAuth／安全 Token 环境配置按该版本实际支持路径接入 | 仓库权限由 GitHub 授予；Homer 当前通用 mcp_save 未提供秘密字段时，不能把 Token 填入 URL 或硬编码 args |
| **GitHub MCP Server**／GitHub，本地 Docker MCP，备选 | 需要本地进程方式时连接同一 GitHub 工具集 | [官方仓库](https://github.com/github/github-mcp-server)；在已有且获准的 Docker 上选定镜像 tag／digest，`docker pull ghcr.io/github/github-mcp-server:TAG`；stdio 启动参数按该发行 README | 不为一次仓库读取默认安装 Docker；沿已有秘密管理提供 PAT；只读验证先于外部写入 |

Context7 也有真实 Codex Plugin：仓库 `upstash/context7`，marketplace `context7-marketplace`，目录 `plugins/codex/context7`。如用户选插件形式，先核固定 Codex 支持，在专属 HOME 下添加市场，再从原生详情安装 `context7@context7-marketplace`；不必同时安装 MCP 和 Plugin。来源：[实际 marketplace](https://github.com/upstash/context7/blob/master/.agents/plugins/marketplace.json)。


## 运维与安全

以下条目从 Cindy 公开 SkillHub 反查独立上游。

| Skill／许可 | 用途 | 源码与完整安装命令 | 运行条件 |
| --- | --- | --- | --- |
| **wrangler**／Apache-2.0 | 维护已有 Wrangler 项目 | [具体目录](https://github.com/cloudflare/skills/tree/HEAD/skills/wrangler)；`python3 "$SKILL_INSTALLER" --repo cloudflare/skills --ref "$REF" --path skills/wrangler --dest "$HOMER_CODEX_HOME/skills"` | 仅已有 Wrangler 项目或明确要求时用；上游新项目推荐 cf，不能默认部署或自动创建付费资源。 |
| **security-audit**／MIT | 源码安全审计 | [具体目录](https://github.com/cloudflare/security-audit-skill/tree/HEAD/skills/security-audit)；`python3 "$SKILL_INSTALLER" --repo cloudflare/security-audit-skill --ref "$REF" --path skills/security-audit --dest "$HOMER_CODEX_HOME/skills"` | 完整流程含脚本／独立验证；核 Worker 接口和工具，不能把安装 Skill 当审计已经完成。 |
| **semgrep-rule-creator**／CC-BY-SA-4.0 | 创建和测试 Semgrep 规则 | [具体目录](https://github.com/trailofbits/skills/tree/HEAD/plugins/semgrep-rule-creator/skills/semgrep-rule-creator)；`python3 "$SKILL_INSTALLER" --repo trailofbits/skills --ref "$REF" --path plugins/semgrep-rule-creator/skills/semgrep-rule-creator --dest "$HOMER_CODEX_HOME/skills"` | 需要 Semgrep CLI 及完整 references；allowed-tools 是 Claude 工具名，映射实际等价接口；改编遵守署名／相同方式共享要求。 |
| **sentry**／Apache-2.0（目录许可） | 读取 Sentry 错误和事件 | [具体目录](https://github.com/openai/plugins/tree/HEAD/plugins/sentry/skills/sentry)；`python3 "$SKILL_INSTALLER" --repo openai/plugins --ref "$REF" --path plugins/sentry/skills/sentry --dest "$HOMER_CODEX_HOME/skills"` | 此路径用 scripts/sentry_api.py 与本人只读 SENTRY_AUTH_TOKEN；不混用已弃用 openai/skills 分支的新 CLI 实现。 |

## Google Workspace CLI：Google 四类插件的独立候选

**gws**／`@googleworkspace/cli`，Apache-2.0：[项目及当前安装说明](https://github.com/googleworkspace/cli)。覆盖 Drive、Gmail、Calendar、Sheets 等 API；仓库明确不是 Google 官方支持产品。其 npm 包会获取发行二进制，不是只复制 JavaScript；检查目标平台和 GitHub Releases 下载条件。Google 账号和服务网络仍是前提，不作为大陆用户本地办公基础要求。

```sh
npm install --prefix "$HOMER_TOOLS/gws" --save-exact "@googleworkspace/cli@$VERSION"
# GWS 是已安装包 bin 映射解析出的绝对入口
# GWS_CONFIG 是 Homer 应用数据下本工具专属配置目录的绝对路径
GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$GWS_CONFIG" "$GWS" auth login -s drive,gmail,sheets
GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$GWS_CONFIG" "$GWS" drive files list --params '{"pageSize":5}'
```

先按上游创建／配置本工具的 OAuth 客户端；`auth setup` 的自动配置依赖 gcloud，已有客户端可走文档中的手动方案。登录和后续命令都使用同一 `GOOGLE_WORKSPACE_CLI_CONFIG_DIR`，不要默默读取全局 gws／Cindy 凭据。优先系统安全存储并核 fallback 行为；本人完成登录。示例 scope 只演示语法，实际仅申请当前任务需要的服务；先读 CLI 帮助和 API schema，写入或发送另沿原任务授权。

## TapTap CLI：不必先搬 Cindy 包

**`@taptap/cli`**，MIT：已核 npm 元数据 `bin.taptap-cli=scripts/run.js`、Node≥16；安装前再核当前版本的实际 engines／bin。[npm 包](https://www.npmjs.com/package/@taptap/cli)、[源码](https://github.com/taptap/cli)、[Cindy 适配源码](https://github.com/makecindy/cindy-official-plugins/tree/main/taptap-cli)。

`npm install --prefix "$HOMER_TOOLS/taptap-cli" --save-exact "@taptap/cli@$VERSION"`

从真实 bin 运行 `--help`，按该发行说明登录、配置并做只读验证；不复制 Cindy 会话上下文、令牌或账号。CLI 能力与 TapTap Maker Runtime 不等价，所需具体业务命令以 CLI 当时帮助为准。

## 独立联网搜索 MCP：已有搜索缺口时才选

Cindy Web Search 的代码可读，但其 Cindy AI 服务不随 Apache 源码提供。以下为独立候选，**不是默认把原生搜索重新安装一次**：

| MCP | 作用／来源 | 安装或连接 | 条件 |
| --- | --- | --- | --- |
| **Brave Search MCP**／MIT | 网页检索；[发布者仓库](https://github.com/brave/brave-search-mcp-server) | `npm install --prefix "$HOMER_TOOLS/brave-search" --save-exact "@brave/brave-search-mcp-server@$VERSION"`；当前 bin `brave-search-mcp-server` → `dist/index.js`，以绝对 Node／脚本及 `--transport stdio` 注册 | 本人 Brave API key 与套餐；最小检索核结果／来源 |
| **Tavily MCP**／MIT | 搜索／提取；[发布者仓库](https://github.com/tavily-ai/tavily-mcp) | `npm install --prefix "$HOMER_TOOLS/tavily" --save-exact "tavily-mcp@$VERSION"`；bin `tavily-mcp` → `build/index.js`，以绝对 Node／脚本注册；也可选远程 `https://mcp.tavily.com/mcp` 并核原生 OAuth 支持 | 本地模式需本人 TAVILY_API_KEY，远程 OAuth／套餐和网络另核 |

`BRAVE_API_KEY`／`TAVILY_API_KEY` 只能经支持的秘密通道注入。若当前 Homer `mcp_save` 未暴露 secret env，则先核可用原生通道；不能写进 URL、args、公开配置或聊天，不能把配置未完成写作可调用。两者均未做中国大陆网络／真实检索验收，不默认安装或产生费用。

## Word、PPT、Excel、PDF

### 办公 Skill：按任务选择

以下只收录名称、功能、官方地址与安装办法，不随 Homer 分发第三方 Skill 源码。用户按需选择；目录条目不代表已安装、已验收或已取得使用许可。Anthropic 四项为技术参考，**需先确认覆盖 Homer 独立宿主的使用授权，不进入默认自动安装路径**；让用户自行下载不改变原许可。

| Skill／来源 | 功能与选用场景 | 官方入口／安装方法 | 条件与验收 |
| --- | --- | --- | --- |
| **PPT Master**／hugohe3，MIT | 从主题或材料制作可编辑 PPTX，支持图表、模板、备注和动画 | [完整 Skill](https://github.com/hugohe3/ppt-master/tree/main/skills/ppt-master)；原生 Installer：repo=`hugohe3/ppt-master`、path=`skills/ppt-master`，命令见 [办公配方](office-tools.md) | Python 3.10+；保留 workflows、scripts、assets 等完整内容，按所选路线安装依赖；逐页查看并验证可编辑对象 |
| **docx**／Anthropic，source-available | 新建、读取、编辑 Word；修订、批注、目录和格式校验 | [官方目录](https://github.com/anthropics/skills/tree/main/skills/docx)；[官方 Claude Code 安装入口](https://github.com/anthropics/skills#try-in-claude-code-claudeai-and-the-api)；Homer 使用须先确认授权 | 非普通开源安装项；授权覆盖后才采用完整目录；依赖和校验见办公配方 |
| **xlsx**／Anthropic，source-available | 创建、修改和分析 Excel；公式、格式、财务模型、重算与错误检查 | [官方目录](https://github.com/anthropics/skills/tree/main/skills/xlsx)；官方安装入口同上；Homer 使用须先确认授权 | 重算依赖 LibreOffice，不能保证 Excel 全部函数、宏、外部链接；公式能计算不等于业务结果正确 |
| **pptx**／Anthropic，source-available | 制作 PPT，重点补充已有模板的分析、编辑、增删页和结构检查 | [官方目录](https://github.com/anthropics/skills/tree/main/skills/pptx)；官方安装入口同上；Homer 使用须先确认授权 | 模板复制可能共享图表／嵌入对象；结构及逐页渲染均需检查 |
| **pdf**／Anthropic，source-available | PDF 提取、合并、拆分、生成、OCR 和表单填写 | [官方目录](https://github.com/anthropics/skills/tree/main/skills/pdf)；官方安装入口同上；Homer 使用须先确认授权 | 读取实际小写 `forms.md`／`reference.md`；不是任意 PDF 正文的无损排版编辑器 |
| **BrandDocs**／ferdinandobons，MIT | `brand-docx`／`brand-pptx`／`brand-xlsx`：沿用用户公司模板，保留品牌、结构和公式 | [完整仓库与 Codex 安装](https://github.com/ferdinandobons/brand-docs#installation)；需整仓库和共享引擎，不能仅装 Skill 子目录；见办公配方 | Alpha；Python 3.10–3.13；模板型任务候选，实际输出仍需结构和视觉验收 |
| **Hermes docx／xlsx／pdf**／Nous Research，Skill 声明 MIT | 配套 CLI 脚本完成生成、读取、编辑、模板、公式及 PDF 常见操作，作为工程化备选 | [Word](https://github.com/NousResearch/hermes-agent/tree/main/skills/productivity/docx)、[Excel](https://github.com/NousResearch/hermes-agent/tree/main/skills/productivity/xlsx)、[PDF](https://github.com/NousResearch/hermes-agent/tree/main/skills/productivity/pdf)；按所需目录用原生 Installer，命令见办公配方 | Python 3.10+；保留 scripts／references；将上游 terminal、read_file 等称呼映射到 Homer 当前工具，不安装 Hermes 引擎 |

PPT 新建可优先评估 PPT Master；公司模板任务选 BrandDocs；常规读写可评估 Hermes；Anthropic 四项保留为需确认授权的技术候选。以上是源码审阅后的选型，不是同题实测排名。

### 底层生成、转换和渲染程序

以下为实际库／程序，不要求 Microsoft Office 或 OpenAI Apps。只安装当前成果需要的库；`PY` 是私有 venv 的绝对 Python 路径。

| 工具／形式 | 作用 | 安装方法与来源 | 关键条件 |
| --- | --- | --- | --- |
| **python-docx**／Python 库 | 创建、读取、修改 `.docx` | `"$PY" -m pip install python-docx`；[官方包](https://pypi.org/project/python-docx/) | 导入 `docx`；MIT；排版验收另需渲染 |
| **python-pptx**／Python 库 | 创建、读取、编辑 `.pptx` | `"$PY" -m pip install python-pptx`；[官方包](https://pypi.org/project/python-pptx/) | 导入 `pptx`；MIT；不提供 PowerPoint 渲染 |
| **PptxGenJS**／Node 库 | 用 JS/TS 制作可编辑 PPTX、图表和图形 | `npm install --prefix "$HOMER_TOOLS/slides-js" --save-exact "pptxgenjs@$VERSION"`；[官方安装](https://gitbrent.github.io/PptxGenJS/docs/installation/) | MIT；与 python-pptx 按任务二选一 |
| **openpyxl**／Python 库 | 读写 XLSX、公式、样式、图表 | `"$PY" -m pip install openpyxl`；[官方包](https://pypi.org/project/openpyxl/) | MIT；不计算公式，图片功能另需 Pillow |
| **ReportLab Toolkit**／Python 库 | 生成 PDF、分页、表格和矢量图 | `"$PY" -m pip install reportlab`；[官方包](https://pypi.org/project/reportlab/) | BSD；指开源 Toolkit，中文需合法字体 |
| **pypdf**／Python 库 | PDF 文本提取、合并、拆分、旋转 | `"$PY" -m pip install pypdf`；[官方安装](https://pypdf.readthedocs.io/en/stable/user/installation.html) | BSD-3-Clause；不是页面栅格渲染器 |
| **LibreOffice**／系统应用与 CLI | Office 转 PDF、排版预览、转换和重算工作流 | [官方平台安装](https://www.libreoffice.org/installation-instructions/)；已有 Homebrew 的 macOS：`brew install --cask libreoffice` | MPL2；实际安装大程序，先核授权，不为此默认装 Homebrew |
| **Poppler**／CLI 集合 | `pdfinfo` 体检、`pdftoppm` 页面转图、文本提取 | [官方项目](https://poppler.freedesktop.org/)；已有 Homebrew 的 macOS：`brew install poppler` | GPL2／GPL3 发行许可；独立调用与嵌入／随包分发分开核对 |

生成、渲染和公式验证的实际命令见 [办公操作配方](office-tools.md)。需要 Google Drive 等账号工具时查下方可选平台候选；本地文档制作不因此强制登录外部服务。


## 创建与维护 Skill：原生方法不足时

| 工具／许可 | 功能和选用场景 | 来源与安装命令 |
| --- | --- | --- |
| **skill-creator**／Anthropic，Apache2.0 | 创建、评估和迭代 Skill；原生 Creator 不足时再选 | [具体目录](https://github.com/anthropics/skills/tree/main/skills/skill-creator)；`python3 "$SKILL_INSTALLER" --repo anthropics/skills --ref "$REF" --path skills/skill-creator --name anthropic-skill-creator --dest "$HOMER_CODEX_HOME/skills"` |

skill-creator 目标目录改名仅避免覆盖原生 `.system/skill-creator`，不伪造其 frontmatter 名称；安装后检查原生发现的同名项和实际路径，按路径使用，不能猜已覆盖系统版。Anthropic 仓库逐目录许可不同，**不安装其受限文档 Skill 作为上述 Apache 条目的一部分**。

优先使用已有原生 Creator／Installer；创建、校验和采用见 [创建工具](create-tools.md)。

## 可选平台插件与开发文档

下面保留用户明确需要平台云服务时的入口；它们不是 Cindy 插件，也不是大陆用户的默认安装步骤。

| 插件／来源 | 功能与内容 | 安装链接／精确查找方式 | 使用条件 |
| --- | --- | --- | --- |
| **OpenAI Developers**／OpenAI | OpenAI API、Agents SDK、Apps 开发和排障；含 Skill、MCP 和 App | [插件目录](https://github.com/openai/plugins/tree/main/plugins/openai-developers)；原生 `plugin_search` 查 `openai developers`，再读实际详情并安装精确 target | 仅限确需 OpenAI 开发的任务；账号、地区和网络条件另核 |
| **Google Drive**／OpenAI 目录 | Drive 文件与 Docs、Sheets、Slides 工作流；Skill＋App connector | [插件目录](https://github.com/openai/plugins/tree/main/plugins/google-drive)；原生搜索 `google drive`，详情中的 manifest 名称为 `google-drive`，按实际 target 安装 | Google／原生 Apps 授权和可用网络；不作为大陆用户本地办公前提 |
| **Browser Use**／Browser Use Inc. | 云端浏览器 App；不是控制当前 Mac 的 Playwright 或官方 bundled Browser | [服务方](https://browser-use.com/)；原生搜索 `browser use`，读取当时发布者、版本与连接详情再安装 | 需要对应服务连接，可能收费；用户选择该云服务时才考虑，不默认要求 OpenAI Apps 登录 |

插件安装、审批及采用统一见 [执行方法](execution.md)；市场入口见 [认可的工具库](trusted-sources.md#codex-原生插件市场)。

### OpenAI Docs MCP

只在明确查询 OpenAI／Codex 开发文档时考虑 [官方 Docs MCP](https://developers.openai.com/learn/docs-mcp)，远程 URL `https://developers.openai.com/mcp`。这不代调用模型 API，也不提供额度。未验证中国大陆可达性，不作大陆用户默认精选；本机能访问不代表所有用户能访问。可先使用已有搜索／公开文档；只有该任务需要且实际网络允许时才经原生 MCP 管理配置。

## 更多来源

本页没有合适候选时，查 [认可的市场与工具库](trusted-sources.md)。需要复用 Cindy 特有实现时，再读 [25 项源码适配参考](official-catalog.md)；原包不能直接加载到 Homer，不因源码公开就默认启动适配开发。

长期记忆、持续学习及多 Agent 方法不默认覆盖 Homer 现有原生记忆与 Worker 机制。
