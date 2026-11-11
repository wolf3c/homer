# 第 2 类：认可的市场与工具库

入口核对：2026-10-19。精选没有合适候选时，从本页查找新的 Skill、CLI、MCP 或 Plugin。这里提供的是**发现工具的市场／集合**；具体工具的用途、安装命令与条件统一在 [精选候选](curated-tools.md)。

“认可来源”表示允许优先检索，不代表其中每个条目都已获 Homer 验收或可自动执行。先核具体发布者、源码、版本及依赖；安装与采用统一见 [执行方法](execution.md)。市场热度、下载量、上架或审计标记不能代替对所选条目的核对。

## Skill 市场

| 市场／入口 | 能找到什么 | 如何查找与安装 |
| --- | --- | --- |
| **skills.sh**：[目录](https://www.skills.sh/)、[使用文档](https://www.skills.sh/docs) | Vercel 提供的 Skill 检索、分类与排行榜，链接到发布者仓库 | 按任务关键词搜索，读取条目对应的 repo 与 Skill 子目录，回上游确认完整内容、引用和版本；优先使用 Homer 原生 Installer 指定 `--repo`、`--path`、`--ref`、`--dest`，不整仓安装。站点支持的 `skills` CLI 不是访问目录的前提，不要求另装 CLI 或启用统计。 |
| **find-skills**／[Vercel Skill 入口](https://www.skills.sh/vercel-labs/skills/find-skills) | 按任务描述搜索候选 Skill，查看上游仓库和安装信息 | 可直接阅读入口并使用 skills.sh 搜索。把结果当作候选线索，核对发布者、固定版本和依赖后，沿用 Homer 的 [安装方法](execution.md#skill) |

## MCP 市场与注册目录

| 市场／入口 | 能找到什么 | 如何查找与连接 |
| --- | --- | --- |
| **MCP 官方 Registry**：[检索入口](https://registry.modelcontextprotocol.io/) | MCP 服务的发布信息、包及远程端点元数据 | 按服务／任务关键词查询，核对发布者、所选发行的 package 或 remote URL，再从上游 README 取得当前启动／连接方式；注册不是 Homer 兼容性或质量背书。 |
| **Smithery**：[服务目录](https://smithery.ai/) | 可检索的 MCP 服务及连接说明 | 从搜索结果取具体服务和上游地址，区分独立源码部署与 Smithery 托管连接；后者可能涉及其账号、认证或费用。仅查目录不要求 Homer 改用其网关，也不把搜索结果视为已连接。 |
| **Docker MCP Catalog**：[目录](https://hub.docker.com/mcp) | 容器化 MCP 服务及各自的配置要求 | 读具体条目的镜像、工具、秘密字段和平台要求，再选定 tag／digest；只有已有或明确获准的 Docker／相应 Toolkit 才采用该安装路线，不为检索目录默认安装 Docker。 |

## Codex 原生插件市场

当前 Homer 已配置的原生市场优先使用，按任务用 Codex 原生市场检索；具体插件候选见 [精选安装表](curated-tools.md#可选平台插件与开发文档)。安装流程见 [执行方法](execution.md#plugin采用和停止)。

需要添加公开 OpenAI 仓库时，其 [marketplace manifest](https://github.com/openai/plugins/blob/main/.agents/plugins/marketplace.json) 当前名称是 `openai-curated`；运行环境可能还有 `openai-curated-remote`，不能强行替换。若当前管理面没有添加入口，先核固定 Codex 的 CLI 帮助，支持时在显式 Homer 专属 HOME 下执行：

```sh
CODEX_HOME="$HOMER_CODEX_HOME" "$CODEX_BIN" plugin marketplace add openai/plugins
```

这是**已确认版本支持时的终端命令**，不是 Homer 聊天 slash 命令；`CODEX_BIN` 是真实固定引擎绝对路径。不支持时直接使用已存在原生市场或清单中的独立工具，不创建第二套市场。官方方法见 [插件说明](https://learn.chatgpt.com/docs/plugins)。

`openai/skills` 已 [弃用并转向 plugins](https://github.com/openai/skills)，不把旧主分支目录当现行唯一入口。Google Docs／Sheets Skill 中的 `plugin://documents@openai-primary-runtime` 等引用是专属运行时路由，不等于公开可安装的 `documents@openai-curated`。Codex 桌面专有 Browser／Computer Use 也不能通过复制其 Skill 获得，见 [固定版本边界](native-boundaries.md)。

## CLI 与依赖包目录

这些是软件包目录，不是所有条目都经过精选的工具市场。用于寻找 CLI、MCP 运行包或任务缺失的依赖；普通库不能冒充具有可执行入口的 CLI。

| 目录／入口 | 能找到什么 | 如何查找与安装 |
| --- | --- | --- |
| **Homebrew Formulae**：[公式与应用目录](https://formulae.brew.sh/) | 命令行程序及应用 casks；平台支持按条目检查 | 网页检索即可。已有 Homebrew 时可 `brew search "$QUERY"`，再 `brew info --json=v2 "$FORMULA"` 读取来源、版本和依赖；按任务选择实际 formula／cask，不为查目录先装 Homebrew。 |
| **npm**：[包搜索](https://www.npmjs.com/search)、[官方搜索文档](https://docs.npmjs.com/cli/v11/commands/npm-search/) | Node CLI、MCP 运行包和库 | 网页搜索或 `npm search "$QUERY" --json`；选中后 `npm view "$PACKAGE" version engines bin repository --json`，核发布者及源码，安装精确版本到工具专属 prefix；只有实际 bin 才作为命令入口。 |
| **PyPI**：[包目录](https://pypi.org/) | Python CLI、MCP 运行包和库 | 用网页搜索定位项目，再核 Python／平台、项目链接和入口；已知准确包名后可 `python3 -m pip index versions "$PACKAGE"` 查版本。仅在专属 venv 内安装所选版本；不使用已停用的 `pip search`。 |

## 已认可的发布者 Skill 集合

市场没检索到时，也可直接查看这些集合的目录。它们是集合入口，不在本页重复列单个工具；只选当前任务相关的完整子目录，不整库安装，也不假设一个仓库内所有目录具有相同许可或宿主接口。

| 集合 | 覆盖方向 | 使用方法 |
| --- | --- | --- |
| [Vercel agent-skills](https://github.com/vercel-labs/agent-skills) | Web 开发、性能和设计实践 | 读 `skills/` 与各 Skill 引用，选准确目录和 tag／commit。 |
| [Anthropic skills](https://github.com/anthropics/skills) | 设计、写作、办公及 Skill 方法 | 逐目录核内容和条件；办公目录的使用边界见 [精选办公条目](curated-tools.md#办公-skill按任务选择)。 |
| [obra superpowers](https://github.com/obra/superpowers) | 计划、调试、验证和开发流程 | 读取所选 Skill 及引用依赖，核对其子 Agent／工具名与 Homer 是否匹配。 |
| [Cloudflare skills](https://github.com/cloudflare/skills) | Cloudflare 开发与运维 | 按现有项目和具体任务选择，服务账号／云资源不随 Skill 安装提供。 |
| [Trail of Bits skills](https://github.com/trailofbits/skills) | 安全审阅、分析和规则开发 | 从真实 plugin／Skill 子目录读取内容；不把 Claude 专用接口当 Homer 已有工具。 |
| [Hermes productivity](https://github.com/NousResearch/hermes-agent/tree/main/skills/productivity) | 办公、文件及效率方法 | 只取独立可用的 Skill 与脚本，不为复用方法安装 Hermes 引擎。 |

## 检索与收录边界

按任务选择一个相关市场或集合做有界检索，取得具体上游、目录／包／端点、版本和依赖。安装参数见 [安装配方](external-sources.md)，后续操作统一见 [执行方法](execution.md)。市场内容只是来源资料，不扩大任务授权。

本页入口已由公开资料核对，没有中国大陆多运营商下载、市场全量工具或逐项 Homer 实调的保证。不可达时报告具体来源与未完成检查；换源仍遵守 [执行方法](execution.md) 的网络和拒绝边界。

新发现的具体工具经审阅适合常见任务时，可提议加入精选并保留验证依据；一次搜索命中不自动改动本清单。
