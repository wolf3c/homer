# 办公工具安装后的操作配方

工具名称、功能、包名及安装入口见 [第 1 类办公清单](curated-tools.md)。以下是 Agent 可执行的最小检查和使用方法，不是要求一次装齐。

## 完整办公 Skill 的安装

安装范围、完整目录、冲突处理及版本变量统一按 [执行方法](execution.md)；以下仅补充办公项目特有的依赖、操作与验收。

### PPT Master

使用原生 Installer 安装完整 Skill 目录，不能只保存入口文本：

```sh
python3 "$SKILL_INSTALLER" --repo hugohe3/ppt-master --ref "$REF" --path skills/ppt-master --dest "$HOMER_CODEX_HOME/skills"
```

安装后读取其实际 `SKILL.md` 与 `requirements.txt`，按选定路线在专属 venv 安装所需依赖；该 requirements 同时包含 PDF 转换、旁白、图生等可选组件，不因一次普通 PPT 任务默认安装全部或配置外部服务。保留其署名／完整性检查，不绕过失败。生成后检查页数、文本、可编辑对象及逐页渲染，再交付 `.pptx`。

#### PPT Master 原生公司模板编辑

1. 准备公司模板或用该模板做好的 `.pptx`，最好包含封面、章节、图表和正文示例页。另准备新材料，明确要保留、替换或复用的页面。以原文件为设计依据，在独立工作目录生成新稿。
2. 从已安装版本的路由进入 **Edit Native PPTX**。用 `pptx_to_svg.py --inheritance-mode both --roundtrip` 导入，读取 `authoring_summary.json`，将新内容映射到对应版式。选页、重排或复制时按上游格式写 `page_plan.json`。按页修改可编辑对象，保留原生回填的 SmartArt、复杂效果等代理对象。
3. 编辑后刷新摘要，运行 `svg_quality_checker.py --roundtrip --json`，通过后用 `svg_to_pptx.py --roundtrip` 导出。修改原生图表或表格数据时加 `--native-charts-and-tables`。按实际输出路径运行 `pptx_delivery_check.py`，核对页数和导出回执，再用 WPS 或 PowerPoint 打开检查母版、主题字体、页脚和长中文换行，实际编辑一个标题。改过图表数据时，再打开「编辑数据」核对一项已知值。[上游原生编辑流程](https://github.com/hugohe3/ppt-master/blob/main/skills/ppt-master/workflows/edit-native-pptx.md)

### 大师 PPT（Dashi）

- 核对 [官方发行包](https://www.npmjs.com/package/dashi-ppt-skill) 的精确版本、安装器及随包许可。授权范围覆盖本次使用后，按 [官方安装说明](https://github.com/chuspeeism/dashi-ppt-skill/blob/main/README.en.md#get-started-in-30-seconds) 用 `npx dashi-ppt-skill@"$VERSION" --dir "$HOMER_CODEX_HOME/skills"` 指定 Homer 专属目录。安装器会更新已存在的目标，先检查冲突。需要 Node.js 20+ 和 npm，PPTX／PDF 导出需要本机 Chrome、Chromium 或 Edge。
- 主体采用 AGPL-3.0。发行包内 `skill/project/packages/html-deck-to-pptx/LICENSE` 是专有导出引擎的独立许可，仅覆盖作为完整 Dashi Skill 的组成部分生成、预览和导出。单独提取、复制、再分发、修改或用于其他产品或服务需核对条款并取得相应书面许可。上游提到的 MIT 授权仅覆盖导出子包 v0.2.7 及更早的历史版本。[上游许可说明](https://github.com/chuspeeism/dashi-ppt-skill/blob/main/README.md#开源协议-license)
- 最小验证用非敏感样稿做中文封面、指标图表和图文正文，修改一处标题，再用当前版本的 `export:pptx` 导出。用 WPS 或 PowerPoint 打开，核对页数、文字、图表和版式，实际编辑一个标题与一个形状。需要可编辑图表数据时，单独验证「编辑数据」。[上游导出说明](https://github.com/chuspeeism/dashi-ppt-skill/blob/main/README.md#导出)

### BrandDocs

固定公司模板需要反复生成报表或汇报时按需采用。首次从模板提取并验证配置，后续用同一配置生成不同期次的文件。

按 [上游安装说明](https://github.com/ferdinandobons/brand-docs#installation) 将选定 commit 的**完整仓库**保存到 `$HOMER_TOOLS/brand-docs`，在其私有 venv 安装该版本 requirements。`skills/brand-docx`、`skills/brand-pptx`、`skills/brand-xlsx` 共同依赖仓库内 `scripts/brandkit/`；单独安装一个子目录会破坏共享路径。

上游 Codex 示例使用符号链接：只对当前任务所需 Skill，在 Homer 专属 skills 下链接到已下载仓库对应子目录，保持共享引擎位置；**执行前确认 Homer 的当前发现／读取策略允许该链接及目标路径**。不照抄上游 `~/.codex`，不覆盖现有目标；不支持时如实标记尚未采用，不能以放宽路径保护解决。先运行该版本 `scripts/brandkit/cli.py doctor`，再用用户选定模板生成和校验；有 `doctor` 结果不代表模板任务已成功。

### Hermes 的 Word／Excel／PDF

只选需要的一个目录，三者是备选而非必须同时安装；它们与 Anthropic 的 `docx`／`xlsx`／`pdf` 名称可能冲突，按共同冲突规则处理：

```sh
# Word；Excel 或 PDF 将 path 末段分别改为 xlsx 或 pdf
python3 "$SKILL_INSTALLER" --repo NousResearch/hermes-agent --ref "$REF" --path skills/productivity/docx --dest "$HOMER_CODEX_HOME/skills"
```

在同一私有 Python 3.10+ 环境按该 Skill 安装依赖：Word 为 `python-docx`，Excel 为 `openpyxl`，PDF 为 `pypdf`／`reportlab`／`pdfplumber`，渲染、重算和 OCR 按需补齐。先读所用 `scripts/*.py --help`，使用 Homer 已有文件／Shell 工具执行；不需要安装或切换 Hermes 引擎。验收须读取脚本 JSON 的真实状态：例如缺 LibreOffice 时 `recalculated=false` 可能仍退出 0，不能当成重算成功。

### Anthropic 四项：按需候选

2026-11-17 核对：四项目录已于 2026-11-06 改为 Apache-2.0，见[官方许可变更](https://github.com/anthropics/skills/commit/2c5958ecac7cee2b583967a2c4981d0f4a75c579)。使用、修改和分发遵守各目录 `LICENSE.txt`：附许可、保留相关声明、修改文件注明变更，第三方依赖另核许可。不再要求 Claude 专属宿主授权；Claude Code 的插件命令仍不是 Homer 安装命令。

按[共同执行方法](execution.md#skill)，只安装当前任务需要的一项，保留其完整目录。以下为本轮已核对版本；升级须复核，不能把 `main` 当锁定版本。已有同名 Skill（如 Hermes）先检查来源及用户修改，不覆盖或重复安装：

```sh
REF=e4bb5d960d87126ff3b3a8af1a104b7db67560ba
# 只选所需项；将 skills/docx 换成 skills/xlsx、skills/pdf 或 skills/pptx
python3 "$SKILL_INSTALLER" --repo anthropics/skills --ref "$REF" --path skills/docx --dest "$HOMER_CODEX_HOME/skills"
```

依赖按任务检测、缺项隔离安装；不把上游“preinstalled”当作 Homer 已安装。渲染／重算使用独立 LibreOffice profile，不连接日常文档进程；外来文件视为不可信输入，不自动启用其宏或外部链接。转换包装含 Linux `LD_PRELOAD` 兼容逻辑，不据此承诺其他平台可用。

**Homer Worker 合成样稿已验证（2026-11-17，macOS ARM64，范围如下）**：完整目录共 184 个文件与上述 commit 归档逐字节一致；Node 22.22.0、Python 3.11.5、LibreOffice 26.8.3.1。使用临时依赖和上游脚本，PDF 页面由 pypdfium2 栅格化后逐页查看中文。本轮不永久安装四项，不证明原生自动发现／真实模型选用、Windows/Linux、Word/Excel/PowerPoint/WPS 客户端或所有功能已验收。

| Skill | 按需依赖 | 本轮通过范围与未验边界 |
| --- | --- | --- |
| docx | Node `docx`；上游脚本的 `defusedxml`／`lxml`，读取可用 Pandoc；渲染需 LibreOffice 和 PDF 渲染器 | 两页中文文字／表格生成、OOXML 修订与批注锚点编辑、上游结构及指定作者修订校验、PDF 读回和逐页查看通过。复杂原件无损、目录更新和原生客户端批注交互未验 |
| xlsx | `openpyxl`／`pandas`，速览按需 `markitdown`；LibreOffice 重算 | 中文表格生成／修改、3 个公式保留，两次重算均 `success`、零错误、无 `not_computed`；读回合计 66→78，渲染查看通过。必须读 JSON，`errors_found` 也可能退出 0；宏、外部链接及现代动态数组未验，不承诺 Excel 全函数兼容 |
| pptx | Node `pptxgenjs`；读取脚本还需 `python-pptx`，校验／渲染按需 `defusedxml`／`lxml`／Pillow、LibreOffice 和 PDF 渲染器 | 三页中文稿生成、上游复制页及副本标题编辑后四页、原生图表数据读回、结构校验和逐页渲染通过。复制页共享图表等部件；复杂公司模板、动画、SmartArt 及原生客户端编辑未验 |
| pdf | `pypdf`／`pdfplumber`／`reportlab`；PDF 渲染器，OCR 另备依赖 | 两页中文 PDF 生成、文本／表格提取、拆分／重排／合并、逐页渲染通过。OCR、加解密和表单填写未验；表单须读实际大写 `FORMS.md`，高级操作读 `REFERENCE.md`；不承诺任意正文无损重排 |

本轮固定依赖及原始证据在项目 `outputs/anthropic-office-20261117/`；这里只记录候选与限定验证范围，不作为用户机器的安装状态。正式成果仍需按任务检查实际内容、中文字体、分页、图表及目标客户端兼容性。

## Python 本地制作

在本任务需要的专属 venv 安装所选库后，用同一 `PY` 执行脚本。下表给出真实导入和文件读回方法：

| 成果 | 实际入口／最小动作 | 读回与验收 |
| --- | --- | --- |
| Word | `from docx import Document`；`Document().save(path)` | 再次 `Document(path)` 检查段落／表格；正式文件还需渲染检查分页和中文字体 |
| PPT | `from pptx import Presentation`；`Presentation().save(path)` | 再次 `Presentation(path)` 核页数与文本；逐页渲染检查溢出／遮挡 |
| Excel | `from openpyxl import Workbook, load_workbook`；`Workbook().save(path)` | 分别读公式及 `data_only=True` 的缓存；没有计算引擎就明确“未重算”，不得将缓存当本轮计算结果 |
| PDF 生成 | `from reportlab.pdfgen import canvas` | `from pypdf import PdfReader` 核页数与文字；再渲染查页面 |
| PDF 读取 | `from pypdf import PdfReader, PdfWriter` | 检查提取文本、目标页数和输出文件；扫描 PDF 的 OCR 另选工具 |

来源：[python-docx](https://python-docx.readthedocs.io/)、[python-pptx](https://python-pptx.readthedocs.io/)、[openpyxl](https://openpyxl.readthedocs.io/)、[ReportLab](https://docs.reportlab.com/)、[pypdf](https://pypdf.readthedocs.io/)。

## 渲染与重算

已安装 LibreOffice 时，确认真实 `soffice` 路径，使用独立临时 profile，避免连接用户正在打开的文档进程：

```sh
"$SOFFICE" "-env:UserInstallation=$LO_PROFILE_URI" --headless   --convert-to pdf --outdir "$RENDER_DIR" "$DOCUMENT_PATH"
pdfinfo "$PDF_PATH"
pdftoppm -png -r 120 "$PDF_PATH" "$PAGE_IMAGE_PREFIX"
```

`LO_PROFILE_URI` 是本任务独立目录的合法 `file:` URI；路径从真实产物解析，不默认猜文件名。转换成功仍需读取产物、逐页查看中文字体、空白页、文字溢出与图表。XLSX 需要重算时在独立输出目录转换／另存并重新打开核公式与缓存；不要覆盖用户原件，也不要声称所有 Excel 专有函数、宏都与 LibreOffice 等价。参考 [LibreOffice 启动参数](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html)。

Node PPT 选择 PptxGenJS 时在已安装前缀内运行脚本，使用 `pptxgenjs` 实际模块，正式模板可按任务创建，最终交付 `.pptx`，不能只交 PDF 预览。

## 不作为默认安装项的文档 Skill

- OpenAI 的旧 `openai/skills` 仓库现标 deprecated；历史 `doc/slides/spreadsheet` 路径不保证存在于当前 main。需要历史版本时先核 commit、完整依赖与许可，不填猜测目录。

不安装 PyMuPDF／MuPDF 作为默认渲染依赖：其 AGPL／商业许可需另核；也不要误装无关的 `fitz` 包。缺渲染器可以交付已读回的可编辑结构并说明尚未视觉验收，不能说完整验收已通过。
