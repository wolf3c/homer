---
name: homer-tool-management
description: 为 Homer 的实际任务选择并获取工具。缺少能力、依赖，或用户要求管理 Skill、CLI、MCP、Plugin 时使用；从具体工具清单选择，主动安装、配置、验证并继续原任务。
---

# Homer 工具清单与安装

按任务需要读取下列清单，选择适用的工具并主动完成安装、配置、验证和采用，继续交付原任务。

| 工具清单 | 内容 |
| --- | --- |
| 精选 Skill 与工具 | [按任务分类的安装表](references/curated-tools.md) |
| 认可的市场与工具库 | [Skill／MCP／CLI 市场与发布者集合](references/trusted-sources.md) |

需要复用 Cindy 特有实现时，再查 [源码适配参考](references/official-catalog.md)；其中原包不能直接安装到 Homer。

具体路径、版本、审批与自动采用见 [执行方法](references/execution.md)；安装格式与命令见 [安装配方](references/external-sources.md)。

## 自行创建工具

没有合适的现成工具，或用户明确要求自建时，选择最简单的实现：操作方法做成 Skill，具体功能优先用脚本或 CLI；需要标准工具接口时再做 MCP，需要组合分发时再做 Plugin。

优先复用原生 `skill-creator`、已有运行时和成熟 SDK。完成后实际验证、自动采用并继续原任务；有长期复用价值的方法保存为 Skill，已有同类则更新。具体配方见 [创建工具参考](references/create-tools.md)。

临时断网、缺少账号或权限，不直接成为重造工具的理由。

仅预装本 Skill 和 `homer-initialize`。清单条目的来源与安装入口经过核对，不代表已安装或已在 Homer 实测；使用边界统一见 [执行方法](references/execution.md)。
