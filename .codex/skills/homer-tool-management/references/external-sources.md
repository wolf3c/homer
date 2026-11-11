# 安装格式与命令配方

配方核对：2026-10-19。仅在需要具体安装参数时读取；工具候选和发现入口分别见 [精选](curated-tools.md) 与 [认可市场](trusted-sources.md)。本页是操作参考，不是独立来源层级。

先根据真实内容判断类型，不把所有链接都当 Skill。以下变量在执行时替换为实际值；GitHub `REF` 含斜杠时用独立参数，避免 tree URL 误解析。

| 来源类型 | 必需内容 | 安装方法 |
| --- | --- | --- |
| GitHub Skill 目录 | `SKILL.md` 及其引用的 scripts／references／assets | 使用下方原生 Installer；非根目录必须给准确 `--path` |
| 本地 Skill 文件夹／解压后的 Skill | 完整目录、frontmatter 与实际依赖 | 审阅后复制完整目录到专属 `skills/<name>`，见下方命令；仅上传一个入口且有缺引用时先补齐 |
| npm CLI／MCP 包 | 真实包名、所选版本、Node 要求及 bin | `npm install --prefix "$TOOL_PREFIX" --save-exact "$PACKAGE@$VERSION"`；CLI 直接执行真实 bin；MCP 另走原生注册 |
| PyPI CLI／MCP 包 | 真实包名、所选版本及 Python 要求 | `"$VENV_PYTHON" -m pip install "$PACKAGE==$VERSION"`；执行 venv 内真实入口；MCP 另注册 stdio |
| 远程 HTTP MCP | 发布者提供的真实 URL 与认证要求 | 使用原生 `mcp add`，URL 和 command 二选一；本人 OAuth 或安全秘密配置完成后再调用 |
| ZIP／GitLab／其他源码包 | 发布来源、版本／commit、校验信息、manifest／README | 下载到任务 scratch，检查归档路径穿越、符号链接和目录内容，再按其实际类型安装；不把任意 URL 传给只支持 GitHub 的 Installer |
| Codex Plugin 仓库／目录 | `.codex-plugin/plugin.json`、声明的 Skill／MCP／资源及对应市场 manifest | 读取该版本原生市场／本地源安装说明，用 Codex 原生 `plugin add` 安装；未提供兼容入口时不能复制到缓存冒充安装成功 |

### GitHub Skill 的直接安装

```sh
python3 "$SKILL_INSTALLER" --repo "$OWNER_REPO" --ref "$REF"   --path "$SKILL_SUBDIR" --dest "$HOMER_CODEX_HOME/skills"
```

例如精选清单中的界面 Skill：`OWNER_REPO=vercel-labs/agent-skills`，`SKILL_SUBDIR=skills/web-design-guidelines`；REF 从该仓库选定。Installer 的真实参数包含 `--repo`／`--url`、`--path`、`--ref`、`--dest`、单条目 `--name` 和 `--method auto|download|git`；不支持任意本地 ZIP、`--force` 或 `--update`。依据：[原生安装器](https://github.com/openai/skills/tree/main/skills/.system/skill-installer)。

### 已审阅本地 Skill 的复制

目标目录名来自有效 Skill 名称；确认源目录及引用不含越界路径、符号链接，目标无用户已有内容后：

```sh
DEST="$HOMER_CODEX_HOME/skills/$SKILL_NAME"
test -f "$SOURCE_SKILL/SKILL.md" && test ! -e "$DEST" && test ! -L "$DEST" &&   cp -R "$SOURCE_SKILL" "$DEST"
```

冲突处理、结构校验、刷新与采用统一见 [执行方法](execution.md)。
