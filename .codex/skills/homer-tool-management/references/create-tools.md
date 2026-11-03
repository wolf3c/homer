# 创建工具参考

来源核对：2026-10-19；下列安装／代码示例未经本轮真实安装执行。

需要自建时按入口的简短规则选择形式，本页仅提供 Creator、SDK 和包结构的具体配方；无需预先安装全部组件。

| 工具／形式 | 作用 | 安装来源／开始方法 |
| --- | --- | --- |
| **Codex 原生 skill-creator**／系统 Skill＋脚本 | 建立 Skill 目录、frontmatter、资源结构，校验结构 | 当前 Homer 原生 `.system/skill-creator`，优先复用；命令见下方，不另装同名工具 |
| **Codex 原生 skill-installer**／系统 Skill＋脚本 | 安装完整 GitHub Skill 目录，也可安装创建所需参考 Skill | 当前原生 `.system/skill-installer`；[GitHub 来源安装配方](external-sources.md) |
| **Python／Node + 文件与 Shell 工具** | 创建最小脚本、转换／整理文件、封装重复操作 | 复用已具备运行时；脚本及所需依赖放任务工作区或专属工具目录，不要求先建 MCP |
| **Python MCP SDK**／官方库 | 创建 stdio／HTTP MCP 服务 | [官方安装](https://py.sdk.modelcontextprotocol.io/get-started/installation/)；新建私有 venv 后 `python -m pip install 'mcp[cli]>=2,<3'`，按 v2 API 写服务 |
| **TypeScript MCP SDK**／官方库 | 用 TS 创建 MCP，定义工具输入输出 | [官方 v2 示例](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server)；项目内 `npm install '@modelcontextprotocol/server@^2' 'zod@^4' tsx`；Node ≥20 |
| **Codex Plugin manifest**／包结构 | 将 Skill、MCP 等组成一个原生插件 | 无需安装“Plugin 生成器”；创建下方固定版本兼容目录，按实际原生市场机制安装 |
| **Anthropic skill-creator**／可选第三方 Skill | 需要额外评估／迭代方法时参考 | [精选安装入口](curated-tools.md#创建与维护-skill原生方法不足时)；不替换原生 Creator，非创建 Skill 的必需依赖 |

## 创建 Skill：实际可执行命令

从原生发现结果读取 Creator 的实际 `SKILL.md`；固定 Homer 已有的脚本路径为：

```sh
CREATOR="$HOMER_CODEX_HOME/skills/.system/skill-creator/scripts"
python3 "$CREATOR/init_skill.py" "$SKILL_NAME"   --path "$HOMER_CODEX_HOME/skills" --resources scripts,references
python3 "$CREATOR/quick_validate.py" "$HOMER_CODEX_HOME/skills/$SKILL_NAME"
```

只需要正文时不加 `--resources`；有资源才生成对应目录。完成正文、脚本和最小真实用例后再校验，不能把模板 TODO 当成品。校验器需要 PyYAML，已有则复用，缺少时在专属 venv 内安装 `PyYAML` 后用该 Python 跑验证；不要改全局环境。名称使用小写字母、数字、连字符，最长 64 字符。结构通过后仍要原生发现、完整读取和行为检查。已有 Skill 直接修改，不重新初始化覆盖。来源：[系统 Creator](https://github.com/openai/skills/tree/main/skills/.system/skill-creator)。

## 创建 MCP：先固定 SDK 主版本

Python 当前 v2 需要 Python ≥3.11，使用 `MCPServer`；以下是官方 v2 的最小 stdio 例子：

```python
from mcp.server import MCPServer

mcp = MCPServer("local-tools")

@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b

if __name__ == "__main__":
    mcp.run()
```

将代码写入具体工具目录的 `server.py`，通过该目录 venv 的 Python 运行；为真实任务添加明确功能，不将示例加法工具当产品交付。Homer 注册为 `command=绝对venvPython路径`、`args=[绝对server.py路径]`，原生刷新后真实调用。stdout 只用于协议，日志写 stderr。参考：[Python 运行方法](https://py.sdk.modelcontextprotocol.io/run/)。

用户已有旧代码时才使用 v1 维护线：`mcp[cli]>=1.28,<2` 对应 `from mcp.server.fastmcp import FastMCP`，不是独立的 `fastmcp` 包。TS v2 使用 `@modelcontextprotocol/server` 和 `serveStdio`；旧 `@modelcontextprotocol/sdk@^1` 对应 v1 的 `McpServer`＋`StdioServerTransport`，不能把 v2 安装命令与旧导入混用。锁定实际选择的发行版本和依赖。旧官方 create-python-server／create-typescript-server 脚手架已归档，不作为默认生成入口。

## 创建 Plugin：固定 Codex 0.163 的兼容结构

```text
example-tools/
  .codex-plugin/plugin.json
  skills/example/SKILL.md
```

manifest 示例：

```json
{
  "name": "example-tools",
  "version": "1.0.0",
  "description": "Task-specific tools and workflows.",
  "author": {"name": "实际发布者"},
  "skills": "./skills/"
}
```

有 MCP 再按实际格式增加 `mcpServers` 及对应文件；不要生成不存在的 tool RPC 或 Hooks 事件。组件路径从插件根解析、不越界。当前新官网也介绍根目录 `plugin.json` 的 portable 格式，但这里不据此承诺固定 0.163 支持所有新增布局。参考：[官方包结构](https://developers.openai.com/plugins/build/plugins)、[兼容 manifest 字段](https://developers.openai.com/plugins/deploy/submission)。

完成后走实际原生安装入口，按 [执行方法](execution.md) 验证当前主请求采用并继续用户任务；不自建插件运行器、调度器或安装状态库。
