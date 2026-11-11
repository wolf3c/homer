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

读取原生 Installer 的 `SKILL.md`，用清单中的 repo、path、ref、dest 安装**完整目录**。目标已存在时先比较用户修改；该安装器没有 `--force`／`--update`，多条目安装也不是事务。

本地完整目录通过既有文件工具进入专属 `skills/<name>/`：先比较清单和 hash、备份，有冲突不覆盖。结构校验后原生强制重扫、读取实际文件并在任务中使用；不要求重启。移除或回退只处理本次拥有且未被后来修改的文件，不删共享依赖。

## MCP

按会话给出的固定 Codex 可执行文件和专属 `CODEX_HOME` 执行原生命令。用 `mcp add NAME --url URL` 接入 HTTP 服务，用 `mcp add NAME -- COMMAND ARGS` 接入本地服务。命令使用实际可执行文件地址。查询、移除和 OAuth 走 `mcp list/get/remove/login/logout`，细节以本版本帮助为准。高级配置沿 Codex 的 `config.toml`，凭据使用服务支持的原生方式。

## Plugin、采用和停止

按同一实例的原生市场和 `plugin list` 确认来源，再用 `plugin add NAME@MARKETPLACE` 或现有原生安装建议，卸载用 `plugin remove`。原生请求需要确认时沿当前待答处理。

安装结果以 Codex 实际发现及最小调用为准。已完成操作沿原生状态核对，结果未知时先查询再决定。配置更新随原生刷新和下一可用轮采用，执行中的会话保持原上下文。
