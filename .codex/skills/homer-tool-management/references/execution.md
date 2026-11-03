# 安装变量与执行方法

## 共同边界

清单提供按需候选，来源核对不等于安装、连接或 Homer 实测。只获取当前任务所需组件；Skill 保留完整 scripts／references／assets，已有合用工具直接使用，不因分类重复安装。

保留用户修改和禁用选择，不覆盖用户已有修改或换名绕过禁用；不复制其他应用的凭据、专有执行器或服务额度。已有有效授权不重复问；新程序、第三方连接、本人登录、系统权限、新费用和外发沿既有具体确认。超出现有授权时先确认具体操作。

## 路径及版本约定

本文档中的变量由 Agent 从实际 Homer 配置解析，再用实际绝对路径赋值；不是要求用户设置环境。不要将 CTO 当前 `$CODEX_HOME`、Cindy Home 或 `~/.codex` 当 Homer 的目录。

| 变量 | 含义 |
| --- | --- |
| `HOMER_CODEX_HOME` | 当前 Homer 绑定的专属 Codex Home |
| `HOMER_TOOLS` | Homer 应用数据目录下的工具前缀，例如与专属 `codex` 同级的 `tools`；只在任务需要时创建 |
| `SKILL_INSTALLER` | 原生发现的 `skills/.system/skill-installer/scripts/install-skill-from-github.py` 绝对路径 |
| `REF` | 已核对的仓库发行 tag 或 commit；由上游解析，不随意填写，也不把 main 当锁定版本 |
| `VERSION` | 从实际包源选定、与平台兼容的精确版本 |

先核已有 Python／Node，够用直接复用。以下是新建私有安装位置的示例，**按所需语言选择，不同时安装所有依赖**：

```sh
python3 -m venv "$HOMER_TOOLS/office/venv"
# PY 是这个环境中 python 可执行文件的绝对路径
PY="$HOMER_TOOLS/office/venv/bin/python"
# Node 包使用各条目自己的 --prefix，不做 npm -g 全局安装
```

表中 `pip install 包名` 展示准确包名；实际采用前查看上游版本，安装选定版本并保留现有 pip／npm 锁定信息。Python 可用 `python3 -m pip index versions 包名` 查看版本，npm 用 `npm view 包名 version engines bin --json` 查看版本、运行要求及入口。Node 安装使用 `--save-exact 包名@版本`。不存在可执行文件时不要凭包名猜路径，读取包的 `bin` 映射。

## Skill

读取原生 Installer 的 `SKILL.md`，用清单中的 repo、path、ref、dest 安装**完整目录**。目标已存在时先比较用户修改；该安装器没有 `--force`／`--update`，多条目安装也不是事务。纯入口 `skill_save` 不包含 references、scripts、assets，不能代替整目录发布。

本地完整目录通过既有文件工具进入专属 `skills/<name>/`：先比较清单和 hash、备份，有冲突不覆盖。结构校验后原生强制重扫、读取实际文件并在任务中使用；不要求重启。移除或回退只处理本次拥有且未被后来修改的文件，不删共享依赖。

## MCP

优先用 Homer 当前 `capabilities` 的 `mcp_save`、`mcp_toggle`、`mcp_remove`。先读取当前 schema 和配置版本；本版本允许 `command`、`args` 或 `url` 等字段，**本地 command 必须绝对路径**，command 与 url 二选一。启动 npm 包时使用已安装的绝对 Node 路径及包 `bin` 指向的脚本；Python 使用私有环境内真实可执行文件。不复制 Claude 的 `mcpServers` JSON 当 Codex 配置，也不把 npm 安装成功当 MCP 注册完成。

例如 Playwright MCP 安装后，由包的 bin 映射解析出绝对 CLI 文件，将服务器字段设为 `command=绝对Node路径`、`args=[绝对CLI路径]`。再由实际 `mcp_save` 请求提交，不手工伪造 expectedVersion、reviewHash 或本人审批回执。MCP HTTP 服务填写经过核验的 URL；OAuth、secret env 等当前 schema 未暴露的配置，先核原生支持通道，不把 Token 填进聊天、URL 或日志，也不伪造已连接。

需要 CLI 管理时，仅使用实际可用的固定 Codex，并显式绑定 Homer 专属 HOME；先核该版本 `mcp --help`，不要默默操作全局配置。

## Plugin、采用和停止

原生 `plugin_search` → `plugin_read`，核对发布者、版本、内容和依赖，再用该详情回执的精确 target、reviewHash、expectedVersion 提交 `plugin_install`，沿已有具体审批执行。不要从仓库路径拼 target，也不从搜索结果的 enabled 字段推断安装状态。市场入口见 [认可的工具库](trusted-sources.md#codex-原生插件市场)；配置市场、安装插件和连接账号分别检查。

Skill／MCP 变化沿 Homer 现有自动刷新和同请求、同 thread 续接。发现更新不代表当前模型轮已换工具 schema；新工具须最小调用，不能靠管理进程查询冒充主 Agent 使用。任意 Hooks 即时热加载未获全面保证，须按类型验收；不要自行杀进程、新建主对话或重放未知操作。

## 最小验收与报告

先验证工具对应的真实功能，再完成原任务。浏览器打开受控页、点击、截图并回收本次会话；电脑操作读应用／窗口并执行已授权的小动作；办公检查见 [办公工具](office-tools.md)。失败说明实际原因和必要下一步，不无限重试。

普通联网开发使用现有网络能力；管理接口仍须本人连接身份与真实授权，不能以可联网冒充用户审批。目录不是运行状态库，不复制第二份安装事实；取消后停止后续步骤，未知结果先核实际状态。
