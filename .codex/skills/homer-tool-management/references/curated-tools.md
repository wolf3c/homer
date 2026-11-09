# 第 1 类：精选 Skill 与工具

核对日期：2026-10-19。参考 Cindy 实际公开插件／SkillHub 的分类和常用任务，优先选择可独立接入 Homer 的上游实现。每项给出用途、安装位置／命令及条件；“精选候选”表示来源与安装入口已核对，不表示已安装、已在 Homer 实测或效果排名。当前已暴露的搜索、图片等能力直接使用，不重复列作待安装工具。

| 任务类别 | 本文具体条目 |
| --- | --- |
| 自动化 | Playwright CLI／MCP、Chrome DevTools MCP、Cua Driver；Midscene 作为视觉自动化备选 |
| 创意与设计 | frontend-design、design-taste-frontend、web-design-guidelines、Figma MCP、shadcn/ui CLI + MCP、Inkscape CLI、ImageMagick CLI、ExifTool CLI、Canva MCP（已有工作区时按需）、Mermaid CLI、algorithmic-art、canvas-design、Draw.io 重建、Blender MCP |
| 视频剪辑 | FFmpeg + ffprobe、whisper.cpp、Remotion Skill + CLI、HyperFrames CLI + Skill、CapCut × Codex、火山引擎 AI MediaKit CLI + Skill、火山引擎 VeVOD MCP |
| 录音与会议后处理 | 复用 FFmpeg、whisper.cpp 和腾讯会议 CLI |
| 游戏开发 | Phaser 官方 Skills、Godot CLI、Aseprite CLI、抖音开发者工具 CLI + Skill、微信小游戏 `miniprogram-ci` |
| 开发与效率 | webapp-testing、writing-plans、react-best-practices、systematic-debugging、verification-before-completion、ast-grep、ShellCheck、actionlint；code-review 为条件候选 |
| 沟通与写作 | humanizer、internal-comms、Himalaya 邮件 CLI |
| 调研与方案 | Homer 调研与方案工作流、grill-me Skill、Pandoc CLI、DuckDB CLI、Crossref REST API、OpenAlex API、Zotero Web API、Firecrawl MCP |
| 数据处理与分析 | pandas、jq CLI、Plotly、Jupyter + nbconvert、GA4 MCP、PostHog MCP、Google Search Console API、Google Ads MCP、DBHub MCP（已有数据库时按需） |
| 集成与知识协作 | 飞书／Lark CLI、腾讯会议 CLI、企业微信 CLI、钉钉 MCP、腾讯文档 MCP、Obsidian CLI、语雀 MCP、Slack MCP、Atlassian Rovo MCP、GitLab CLI、Notion MCP、GitHub CLI／MCP、Context7、Google Workspace CLI、TapTap CLI |
| 运维与安全 | Wrangler、security-audit、Semgrep 规则、Sentry |
| 搜索与工具创建 | Brave／Tavily MCP（已有搜索不足时）；Anthropic skill-creator（原生 Creator 不足时） |
| 办公与文件 | PPT Master、大师 PPT（Dashi）、BrandDocs、Hermes 办公 Skill，Anthropic 四项技术参考；另列 OCRmyPDF、MarkItDown 等生成、转换和渲染工具 |
| 文件归档与交付 | rclone CLI、restic CLI |

从所需类别选一个合用方案；同类不整套安装。下面的 `REF`、`VERSION`、`PY` 等由 Agent 按 [执行方法](execution.md) 解析真实路径和精确版本。来源核对没有执行这些安装命令，也没有证明中国大陆各运营商可访问。

## 自动化：浏览器与电脑操作

| 工具／形式 | 功能与选用场景 | 安装链接／安装方法 | 前提及最小验证 |
| --- | --- | --- | --- |
| **Playwright CLI + Skill**（Microsoft） | 打开网页、填写、点击、截图、测试网页；有 Shell 的 Agent 优先考虑 | [仓库](https://github.com/microsoft/playwright-cli)；`npm install --prefix "$HOMER_TOOLS/playwright-cli" --save-exact "@playwright/cli@$VERSION"`；Skill 子目录 `skills/playwright-cli`，完整安装见下方 | Node ≥20；CLI、Skill、浏览器分别检查；用受控页真实操作，不需要 OpenAI Apps |
| **Playwright MCP**（Microsoft） | 需要结构化 MCP 工具时进行浏览器操作；与 CLI 二选一即可 | [仓库／Codex 配置](https://github.com/microsoft/playwright-mcp#codex)；`npm install --prefix "$HOMER_TOOLS/playwright-mcp" --save-exact "@playwright/mcp@$VERSION"`；解析真实 bin，以 stdio 注册 | Node ≥18；缺浏览器按该版本帮助和上游说明安装；不等于已获现有 Chrome 登录态 |
| **Chrome DevTools MCP** | 排查网页控制台错误、网络请求和性能瓶颈，录制性能轨迹 | 按 [官方仓库](https://github.com/ChromeDevTools/chrome-devtools-mcp) 将选定版本的 `chrome-devtools-mcp` 安装到 Homer 专属工具目录，以实际 bin 注册 stdio MCP，传入 `--isolated --no-usage-statistics --no-performance-crux` | 需要所选版本支持的 Node.js LTS 及 Chrome 或 Chrome for Testing。打开无登录的本地测试页，用 `list_console_messages` 核对预设日志，或检查已知网络请求 |
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

| 工具／许可或形式 | 功能与选用场景 | 安装或接入 | 条件与验证 |
| --- | --- | --- | --- |
| **frontend-design**／Anthropic，Apache2.0 | 制作前端界面、页面和视觉方案；Cindy 同名条目的独立上游 | [上游目录](https://github.com/anthropics/skills/tree/HEAD/skills/frontend-design)；`python3 "$SKILL_INSTALLER" --repo anthropics/skills --ref "$REF" --path skills/frontend-design --dest "$HOMER_CODEX_HOME/skills"` | 方法型 Skill；使用当前编码工具，渲染验收仍需浏览器 |
| **design-taste-frontend**／Leonxlnx，MIT | 提高前端视觉质量，配套方向选择、检查脚本和参考材料 | [上游目录](https://github.com/Leonxlnx/taste-skill/tree/HEAD/skills/taste-skill)；`python3 "$SKILL_INSTALLER" --repo Leonxlnx/taste-skill --ref "$REF" --path skills/taste-skill --dest "$HOMER_CODEX_HOME/skills"` | 目录名 taste-skill，frontmatter 名 design-taste-frontend；Node22+、Chrome／Edge／Chromium；素材检索需网络 |
| **web-design-guidelines**／Vercel，MIT | 审阅网页交互、可访问性和设计规范 | [上游目录](https://github.com/vercel-labs/agent-skills/tree/HEAD/skills/web-design-guidelines)；`python3 "$SKILL_INSTALLER" --repo vercel-labs/agent-skills --ref "$REF" --path skills/web-design-guidelines --dest "$HOMER_CODEX_HOME/skills"` | 需联网读取上游最新规则；安装 Skill 不自动提供浏览器 |
| **Figma MCP**／官方远程 MCP | 读取图层、组件和变量，为按稿实现和设计交付提供上下文 | 按 [官方接入指南](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) 确认当前客户端受支持后，在 Homer 专属实例注册 `https://mcp.figma.com/mcp`，由本人登录授权 | 需要 Figma 账号及目标文件权限，额度取决于套餐和席位。提供获授权的测试 Frame 链接，用 `get_design_context` 核对已知文字或布局。写入画布另按席位权限和任务授权处理 |
| **shadcn/ui CLI + MCP**／官方本地 MCP | 在采用 shadcn/ui 的 React 项目中查找、查看和添加组件或页面区块 | 按 [CLI 文档](https://ui.shadcn.com/docs/cli) 将 `shadcn` 锁定到选定版本，沿用项目锁文件或安装在 Homer 专属工具目录。需要 MCP 时，按 [官方 MCP 文档](https://ui.shadcn.com/docs/mcp) 在 Homer 专属实例以实际 CLI 入口和参数 `mcp` 注册 stdio，将工作目录指向目标项目 | 需要包声明的 Node.js 版本和可达的组件仓库。项目配置见 `components.json`，官方公共仓库无需凭据。先运行 `shadcn search @shadcn -q button`，启用 MCP 时再经 MCP 搜索同一组件，核对返回的 `button`。获准添加后再在测试项目里检查组件能否渲染 |
| **Inkscape CLI** | 将可编辑 SVG 海报、插画或标识导出为 PDF 和指定分辨率的 PNG | 优先复用本机 Inkscape，从 [官方发行入口](https://inkscape.org/release/) 选与系统和架构匹配的版本。定位实际 `inkscape` 可执行文件，按 [命令行指南](https://wiki.inkscape.org/wiki/Using_the_Command_Line) 核对导出参数 | 本地运行，需备齐母稿引用的字体和图片。用含中文标题的测试 SVG 分别执行 `inkscape poster.svg --export-filename=poster.pdf` 和 `inkscape poster.svg --export-dpi=300 --export-filename=poster.png`，核对 PDF 页面尺寸、PNG 像素尺寸、文字与裁切 |
| **ImageMagick CLI** | 批量缩放、裁切、压缩和转换图片，从一张海报派生方图、竖图等规格 | 复用本机 ImageMagick 7，缺少时从 [官方下载页](https://imagemagick.org/download/) 选与平台匹配的构建。检查 `magick -version` 和实际支持的目标格式 | 本地运行，格式支持和处理限制取决于构建及安全策略。用 `magick poster.png -resize "1080x1080^" -gravity center -extent 1080x1080 square.png` 导出方图，再按同样方法导出竖图。用 `magick identify` 核对格式和像素尺寸，并目视确认裁切，输出另存以保留母稿 |
| **ExifTool CLI** | 批量读取图片的拍摄时间、相机信息和 GPS，交付前按需清理副本中的位置标签 | 复用本机 `exiftool`，或按[上游说明](https://github.com/exiftool/exiftool)安装对应平台版本。用 `exiftool -ver` 确认入口 | 本地运行。用带已知 GPS 标签的测试 JPEG，在独立副本上清除位置元数据，用 `exiftool -a -G1 -s` 重新读取各组标签，核对目标标签已移除且原件哈希一致 |
| **Canva MCP**／官方远程 MCP，**已有 Canva 工作区时按需接入** | 从模板制作可编辑的海报、宣传单和社媒图，调整版式并导出 PNG 或 PDF | 按 [官方接入指南](https://www.canva.dev/docs/apps/quickstart/) 核对当前宿主支持的 Canva 连接。Homer 自有集成需在 Canva 开发者后台启用 MCP，配置 OAuth 应用及回调地址，连接 `https://api.canva.com/connect/v1/mcp`，由本人授权工作区 | 需要目标设计和素材权限，品牌模板与数据填充需 Pro 或以上。先用 `get-design` 读取获授权的测试设计并核对标题。获准写入后在副本替换标题并导出 PNG，检查文字和尺寸。 [工具与套餐](https://www.canva.dev/docs/apps/mcp/tools/) |

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

### Blender MCP

**Blender MCP**（Siddharth Ahuja 的社区项目 MCP for Blender，MIT）通过本机 Blender 插件读取场景，辅助 3D 建模、布置场景、编辑材质和检查视口。需要 Blender 3.0+、Python 3.10+ 和 `uv`。 [上游安装文档](https://github.com/ahujasid/mcp-for-blender#installation) · [PyPI](https://pypi.org/project/mcp-for-blender/)

1. 确认实际 Blender 插件安装位置和授权，再用 `"$UVX" "mcp-for-blender@$VERSION" install-addon` 安装同版本插件。`UVX` 是实际可执行文件的绝对路径。打开 Blender，在偏好设置中启用 **MCP for Blender**，并从 3D 视图侧栏确认服务已启动。
2. 按 [执行方法](execution.md#mcp) 只在 Homer 专属配置中注册本地 stdio MCP。使用 `CODEX_HOME="$HOMER_CODEX_HOME" "$CODEX_BIN" mcp add blender --env DISABLE_TELEMETRY=true -- "$UVX" "mcp-for-blender@$VERSION"`。插件的 socket 仅用于本机连接。
3. 从 Homer 调用 `get_scene_info`，确认返回测试场景中的已知对象。场景写入、Blender Python 执行和外部素材／模型生成服务按任务授权分别处理。

## 视频剪辑

| 工具／形式 | 功能与产出 | 安装或接入 | 条件与最小验证 |
| --- | --- | --- | --- |
| **FFmpeg + ffprobe**／CLI | 本地裁剪、拼接、转码、压缩、提取音轨，并检查媒体时长、流和编码参数 | 优先复用已有的两个可执行文件。缺少时从 [上游下载页](https://ffmpeg.org/download.html) 选与系统及架构匹配的构建，确认包含 `ffmpeg` 和 `ffprobe` | 无需账号。编解码器和滤镜取决于构建。用 `ffmpeg -i sample.mp4 -t 2 -vn -c:a pcm_s16le sample.wav` 从含音轨的测试片段提取音频，再用 `ffprobe -v error -show_streams -show_format sample.wav` 确认音轨与时长 |
| **whisper.cpp**／`whisper-cli` | 本地转写录音或视频音轨，生成文字稿和带时间戳的字幕 | 按 [上游指南](https://github.com/ggml-org/whisper.cpp#quick-start) 获取与平台匹配的 `whisper-cli`，或用 CMake 构建。另需下载兼容的 GGML 模型并检查磁盘和内存需求，中文使用多语言模型 | 模型准备好后可离线运行。先用 FFmpeg 将已知语句的短音频转为 16 kHz 单声道 PCM WAV，再用 `whisper-cli -m "$MODEL" -f sample.wav -l auto -osrt -of sample` 生成 `sample.srt`，核对文字和时间戳。`MODEL` 指向所选模型文件 |
| **Remotion Skill + CLI** | 用 React 模板制作产品演示、动效标题和数据视频，并按输入批量渲染 | 按 [官方 Skill 指南](https://www.remotion.dev/docs/ai/skills) 从 `remotion-dev/skills` 安装所需完整目录，例如 `skills/remotion-best-practices`。在任务项目内安装同版本的 `remotion` 和 `@remotion/cli`，沿用项目锁文件 | 需要兼容的 Node.js 和浏览器渲染环境。按实际版本和用途核对 [许可](https://www.remotion.dev/docs/license)。用 [渲染命令](https://www.remotion.dev/docs/cli/render) 将短测试合成导出为 MP4，检查能播放且标题与时长符合预期 |
| **HyperFrames CLI + Skill**／HeyGen | 用 HTML/CSS 制作字幕动画、标题卡和产品演示模板，本地渲染为 MP4 | 按 [CLI 指南](https://github.com/heygen-com/hyperframes/blob/main/packages/cli/README.md) 在任务项目或 Homer 专属工具目录锁定 `hyperframes` 包版本。按 [上游核心 Skill 清单](https://github.com/heygen-com/hyperframes#core-set) 核对与 CLI 对应发行版的引用，按 [Skill 安装方式](execution.md#skill) 安装 `hyperframes` 和任务所需的配套完整目录 | 本地渲染需要 Node.js 22+、FFmpeg／ffprobe 和兼容的 Chrome／Chromium，无需登录。设置 `HYPERFRAMES_NO_TELEMETRY=1`，用 `doctor` 检查渲染依赖。在独立测试目录用 `init` 的 `--skip-skills` 创建短标题合成，运行 `lint` 和 `render --output sample.mp4`，播放核对标题，再用 `ffprobe` 核对时长 |
| **CapCut × Codex**（官网称 CapCut × ChatGPT，官方插件含 MCP） | 根据提供的素材选镜头、裁剪、排序和加字幕，生成可在海外版 CapCut 继续编辑的草稿 | [官方插件入口](https://www.capcut.com/tools/capcut-x-codex)；上游安装说明面向 macOS／Windows 的 Codex 桌面端，Homer 接入前须确认插件与授权流程可在专属实例运行 | 需 CapCut 账号授权，上传素材前确认权限。先验证连接，再用获授权的短素材生成草稿并在 CapCut 打开检查时间线 |
| **火山引擎 AI MediaKit CLI + Skill** | 裁剪、拼接、变速、加字幕和混音，输出视频文件。支持的本地操作用 `--local` 调用 FFmpeg | 按 [CLI 指南](https://docs.volcengine.com/docs/intelligent-processing/ai-mediakit-cli-guide?lang=zh) 将 `@volcengine/mediakit-cli` 的选定版本装到 Homer 专属工具目录，按 [Skill 指南](https://docs.volcengine.com/docs/intelligent-processing/ai-mediakit-skill-guide?lang=zh) 从 [官方仓库](https://github.com/volcengine/mediakit-cli) 选取 `byted-mediakit-editing` 和依赖的 `byted-mediakit-shared` 完整目录 | 本地依赖相应的 FFmpeg 构建。用测试片段显式走 `--local`，检查输出能播放且时长符合预期。画质增强等云端功能另需 API Key，素材上传和费用按任务授权 |
| **火山引擎 VeVOD MCP**（官方 MCP） | 在火山引擎视频点播中截取、拼接、加转场和字幕，输出云端成片 | 按 [官方接入说明](https://github.com/volcengine/mcp-server/blob/main/server/mcp_server_vod/README_zh.md) 在 Homer 专属实例注册 `mcp-server-vod`，使用 `uvx` 本地启动或连接已授权的云端端点 | 需开通 VOD、创建空间并安全配置 AK／SK。即使 MCP 进程在本机运行，剪辑仍由云端执行。获授权后用测试素材检查任务终态和成片，存储、处理及流量按服务计费 |

### 录音与会议后处理

用本节 FFmpeg 提取音轨、按交付要求处理响度，用 whisper.cpp 生成带时间戳的转写。已有会议录制、转写或纪要时，可从[腾讯会议 CLI 条目](#腾讯会议企业微信钉钉与腾讯文档)获取获授权的会议材料。交付前试听一段并抽查时间戳、专名和行动项。

## 游戏开发

| 工具／形式 | 用途 | 安装或接入 | 条件与最小验证 |
| --- | --- | --- | --- |
| **Phaser 官方 Skills** | 指导 2D 网页游戏的场景、输入、碰撞、动画和图块地图开发 | 从 [Phaser 官方仓库](https://github.com/phaserjs/phaser#ai-assisted-game-development) 选定发行版，按 [Skill 安装方式](execution.md#skill) 安装所需完整目录，例如 `skills/input-keyboard-mouse-touch`。新项目按 [框架安装指南](https://docs.phaser.io/phaser/getting-started/installation) 配置依赖，已有项目沿用锁文件 | 当前官方 Skills 面向 Phaser 4。Phaser 3 项目使用对应版本文档，迁移时才使用官方迁移 Skill。启动本地测试游戏，用 Playwright 验证开始、输入响应、结算和重开 |
| **Godot CLI** | 运行场景、检查脚本、无界面导出游戏 | 从 [Godot 官方下载页](https://godotengine.org/download/) 获取与项目版本和平台匹配的编辑器，使用实际二进制路径。导出需安装匹配的导出模板并配置目标预设 | 按 [命令行指南](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html)，用 `godot --headless --path "$PROJECT" --export-debug "$PRESET" "$OUTPUT"` 导出测试项目。使用已配置的本机目标，确认产物存在并实际打开首场景 |
| **Aseprite CLI** | 批量导出像素动画、PNG 精灵图集和 JSON 帧数据 | 复用符合 [Aseprite 许可](https://www.aseprite.org/faq/) 的本机安装，定位实际可执行文件。批处理用 `-b`。 [官方 CLI 文档](https://www.aseprite.org/docs/cli/) | 在任务目录用 `aseprite -b sample.aseprite --sheet atlas.png --data atlas.json` 导出内容已知的多帧素材，确认 PNG 可读且 JSON 帧数、坐标和时长符合预期 |
| **抖音开发者工具 CLI + Skill** | 用 `douyinide` 打开和编译小游戏、调试模拟器、生成真机预览码或上传测试版本 | 按 [官方 Skill 指南](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/dev-tools/developer-instrument/ai/ide-skill) 安装抖音开发者工具 4.5.7+，从 `douyinide` 输出定位配套 Skill，或从 IDE 导出完整目录，再在 Homer 专属实例加载 | 需要有效的 `game.json`，首次连接由本人在 IDE 授权，打开项目及预览需本人登录。用 `--type microgame` 打开获授权的测试项目，执行 `simulator-compile` 并确认模拟器首屏。真机预览需扫码验证，上传测试版本另按任务授权 |
| **微信小游戏 `miniprogram-ci`** | 用微信官方 Node.js 工具编译小游戏并在 CI 中生成预览码或上传代码 | 按 [官方仓库](https://github.com/wechat-miniprogram/miniprogram-ci-dist) 在任务项目安装已核对版本的 `miniprogram-ci`，项目类型设为 `miniGame` | 需要有效 AppID、平台代码上传密钥和 IP 白名单。获授权后用测试 AppID 执行 `ci.preview`，检查编译结果并在微信真机扫码打开首场景。密钥通过受控文件或 CI 秘密提供，上传版本另按任务授权 |

## 开发与效率

默认复用本机 Git 和 `rg`。用 `rg` 找实现、调用方和测试，用 `git status`、`git diff` 和 `git diff --cached` 核对改动范围。按仓库文档和 CI 配置运行与改动相关的现有测试、类型检查或 lint。需要验证网页交互时，复用[现有 Playwright 条目](#自动化浏览器与电脑操作)。

| Skill／许可 | 功能与选用场景 | 来源与安装命令 | 条件与验证 |
| --- | --- | --- | --- |
| **webapp-testing**／Anthropic，Apache2.0 | 本地 Web 应用测试、交互验证和截图 | [上游目录](https://github.com/anthropics/skills/tree/HEAD/skills/webapp-testing)；`python3 "$SKILL_INSTALLER" --repo anthropics/skills --ref "$REF" --path skills/webapp-testing --dest "$HOMER_CODEX_HOME/skills"` | 含 with_server.py；依赖 Python Playwright 及浏览器，Node Playwright 包不代替它 |
| **writing-plans**／obra，MIT | 将任务整理为可执行、可验证的实施计划 | [上游目录](https://github.com/obra/superpowers/tree/HEAD/skills/writing-plans)；`python3 "$SKILL_INSTALLER" --repo obra/superpowers --ref "$REF" --path skills/writing-plans --dest "$HOMER_CODEX_HOME/skills"` | 纯计划可直接阅读；继续执行时按引用补充 executing-plans 等 Skill，不假设 superpowers 工具名在 Homer 存在 |
| **verification-before-completion（完成前验证）**／obra，MIT | 在报告修复或交付完成前，运行能证明本次结果的检查，并读取实际输出与退出状态 | 按[上游目录](https://github.com/obra/superpowers/tree/HEAD/skills/verification-before-completion)用原生 Installer 从固定版本的 `obra/superpowers` 安装完整 `skills/verification-before-completion` | 需要能运行仓库检查或操作实际入口。选一项本次改动的验收条件，运行对应测试或执行一次真实操作，核对结果后再报告结论 |
| **code-review**／mattpocock，MIT，条件候选 | 审阅改动、问题和需求；参考 Cindy 同名 Skill | [上游目录](https://github.com/mattpocock/skills/tree/HEAD/skills/engineering/code-review)；`python3 "$SKILL_INSTALLER" --repo mattpocock/skills --ref "$REF" --path skills/engineering/code-review --dest "$HOMER_CODEX_HOME/skills"` | 依赖 Git 比较基线、需求上下文及并行审阅接口；Homer Worker 不自动等于其子 Agent 工具，接口不满足时直接用已有审阅能力，不强装 |

webapp-testing 只有任务确需该配套脚本时，才在私有 Python 环境安装 `"$PY" -m pip install playwright`，再用同一个 Python 执行 `"$PY" -m playwright install chromium`。执行前锁定包版本并核浏览器下载；不要把 Skill 安装成功当测试已经运行。


### 代码搜索与静态检查

| 工具／形式 | 用途 | 安装或接入 | 条件与最小验证 |
| --- | --- | --- | --- |
| **ast-grep CLI** | 按语法结构查找调用、导入和表达式，适合 API 迁移和跨文件重构 | 复用本机 `ast-grep`，缺少时按[上游安装指南](https://ast-grep.github.io/guide/quick-start.html)获取对应平台版本 | 目标语言需受支持。用 `ast-grep run --lang ts --pattern 'oldApi($ARG)' sample.ts` 查找已知调用，确认同名字符串未被匹配。需要改写时先审查匹配范围 |
| **ShellCheck CLI** | 检查 Shell 脚本中的引用、变量展开和其他常见问题 | 复用本机 `shellcheck`，缺少时按[上游说明](https://github.com/koalaman/shellcheck#installing)安装对应平台版本 | 用声明了实际 Shell 的测试脚本运行 `shellcheck sample.sh`，确认能报告一处已知的未引用变量展开，再修正并重跑 |
| **actionlint CLI** | 检查 GitHub Actions 工作流的语法、表达式和配置 | 复用本机 `actionlint`，缺少时按[上游说明](https://github.com/rhysd/actionlint/blob/main/docs/usage.md)安装对应平台版本。需要额外检查 `run:` 中的 Shell 脚本时，确保 ShellCheck 可用 | 用含已知错误表达式的工作流副本运行 `actionlint sample.yml`，确认报错位置符合预期，再修正并重跑 |

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

## 调研与方案

### Homer 调研与方案工作流

适用于竞品调研、可行性分析和需要证据支撑的方案。直接复用已有搜索、文件读取和表格工具，按任务缺口从下表选工具。

1. 写清要支持的决策、比较对象、时间范围和统计口径。优先查原始资料，记录来源链接、日期及页码或章节。
2. 建证据表，将关键事实和数字关联到来源。保留计算公式或 SQL，遇到来源冲突、口径不一致或缺项时明确标记。
3. 交付选项、取舍、建议和待验证假设。用一份样例方案验收，逐项回查关键数字、复算一个主要汇总结果，并打开交付文档确认表格与引用可用。

| 工具／形式 | 用途 | 安装或接入 | 条件与最小验证 |
| --- | --- | --- | --- |
| **grill-me Skill**／Matt Pocock，MIT | 在需求或方案定稿前，按决策依赖分轮追问假设、范围和取舍 | 从 `mattpocock/skills` 固定同一版本，按 [Skill 安装方式](execution.md#skill) 安装 [入口 `skills/productivity/grill-me`](https://github.com/mattpocock/skills/blob/HEAD/skills/productivity/grill-me/SKILL.md) 和 [依赖 `skills/productivity/grilling`](https://github.com/mattpocock/skills/blob/HEAD/skills/productivity/grilling/SKILL.md) 的完整目录。宿主若无上游所称的 `Skill` 调用工具，在用户点名 `grill-me` 后直接读取已安装的 `grilling/SKILL.md` | 无需额外 CLI 或账号。用一份含待定目标受众和依赖该决定的交付方案试跑，检查首轮先问受众并给出建议，收到回答后再追问对应的交付方式 |
| **Pandoc CLI** | 将 Markdown 方案导出为可编辑的 Word，应用参考文档样式并生成引用和参考文献 | 复用已有 `pandoc`，或从 [官方安装页](https://pandoc.org/installing.html) 选择与平台及架构匹配的版本。准备 `reference.docx` 和所需的参考文献文件。 [官方手册](https://pandoc.org/MANUAL.html) | 本地导出 DOCX 无需账号。用 `pandoc sample.md --reference-doc=reference.docx --citeproc --bibliography=refs.bib -o sample.docx` 生成含中文标题、表格和引用的测试文档，打开检查样式和引用是否对应。PDF 导出另需匹配的渲染引擎及字体 |
| **DuckDB CLI** | 在本地用 SQL 读取、关联和汇总 CSV、Parquet，适合竞品价格对比与问卷统计 | 复用已有 `duckdb`，或从 [官方发行页](https://github.com/duckdb/duckdb/releases) 选择与平台及架构匹配的 CLI。用 `read_csv` 或 `read_parquet` 读取任务目录中的本地样表 | 本地查询无需账号。用两份结果已知的样表验证关联、去重与汇总，核对行数和总值，并保留 SQL 供复算 |
| **Crossref REST API** | 按 DOI 或题名核对论文标题、作者、年份及出版信息 | 按 [官方文档](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) 直接访问 `https://api.crossref.org/works/{doi}` 等公开只读接口 | 公开查询无需账号，遵守限流。查询一个已知 DOI，将标题、作者和日期与出版方页面核对。引用研究结论时回读原文 |
| **OpenAlex API** | 按主题、作者、机构或年份发现研究成果，追踪引用关系 | 按 [官方 API 文档](https://help.openalex.org/api/) 直接查询 `/works`。基础查询可无密钥使用，超出免费限额或使用特定能力时按 [认证说明](https://help.openalex.org/api/authentication/) 配置并安全传递 API Key | 需要访问 OpenAlex 的网络。按已知 DOI 或 OpenAlex ID 读取一条记录，核对标题、年份与原始出处。需要引用结论时查阅原文 |
| **Zotero Web API** | 从已有 Zotero 文献库读取收藏集和条目，复用论文元数据与引用资料 | 仅在任务需要现有 Zotero 文献库时，按 [官方 Web API v3 文档](https://www.zotero.org/support/dev/web_api/v3/basics) 访问指定用户或群组库。私有库使用限于所需库的只读密钥，经安全方式放入 `Zotero-API-Key` 请求头 | 公开库只读无需密钥，私有库须有访问授权。读取指定库的一条已知文献并核对标题和 DOI，写入文献库另按任务授权 |
| **Firecrawl MCP** | 提取或批量采集已知网站的公开页面，适合竞品定价页、产品文档等多页资料 | 已有 Tavily 或网页提取能力足够时直接复用。确有覆盖缺口时，按 [官方接入指南](https://docs.firecrawl.dev/mcp-server) 在 Homer 专属实例配置 Firecrawl MCP，可按需求选择免密钥试用、OAuth 或通过安全通道配置 API Key | 需要可达的公开目标和 Firecrawl 服务，批量抓取能力及额度按接入方式和套餐核对。先提取一页已知的公开测试资料，核对原始链接、标题和关键字段，再按授权扩大范围 |

## 数据处理与分析

复用原条目中的 [DuckDB CLI](#调研与方案) 做本地 SQL 关联和汇总，使用 [openpyxl 与 LibreOffice](#底层生成转换和渲染程序) 处理 Excel 文件的样式、公式和重算。

| 工具／形式 | 用途 | 安装或接入 | 条件与最小验证 |
| --- | --- | --- | --- |
| **pandas**／Python 库 | 清洗 Excel、CSV 和 JSON，处理类型、缺失值、去重、分组统计和透视表 | 按 [官方安装说明](https://pandas.pydata.org/docs/getting_started/install.html) 核对 Python 兼容性，在 Homer 私有 venv 中安装选定版本。读取 XLSX 时按所选版本要求安装兼容的 `openpyxl` | 本地处理无需账号。用含重复行、空值和文本编号 `001` 的样表，显式指定编号为字符串，核对行数、汇总值与前导零 |
| **jq CLI** | 筛选和重组嵌套 JSON、JSONL 和 API 响应，提取分析所需字段 | 复用已有 `jq`，或从 [官方下载页](https://jqlang.org/download/) 选择与平台匹配的构建，运行 `jq --version` | 本地运行。用 `jq -r '.[].id' sample.json` 读取内容已知的对象数组，核对记录数，并验证缺失字段和显式 `null` 是否按任务规则处理。 [官方手册](https://jqlang.org/manual/) |
| **Plotly**／Python 库 | 生成可悬停、缩放和切换图例的交互图表，也可导出静态图片 | 在兼容的 Homer 私有 Python 环境安装选定版本的 `plotly`。用 `fig.write_html("chart.html", include_plotlyjs=True)` 内嵌脚本。按 [静态导出文档](https://plotly.com/python/static-image-export/) 按需配置兼容的 Kaleido 和 Chrome 或 Chromium | [HTML 导出](https://plotly.com/python/interactive-html-export/) 无需云账号，成品内含图表数据。用已知样表出图，在浏览器断网打开 HTML，检查交互、数值、单位和日期范围 |
| **Jupyter + nbconvert** | 用 `.ipynb` 记录清洗、计算和图表步骤，供他人重新执行和复核 | 在 Homer 私有 Python 环境安装兼容版本的 `nbconvert`、`ipykernel` 和项目所需依赖，选用该环境的内核。 [官方命令指南](https://nbconvert.readthedocs.io/en/latest/usage.html) | 执行前审阅 Notebook 代码。用 `jupyter nbconvert --to notebook --execute sample.ipynb --output sample.executed` 从头运行样例，核对关键输出与报告一致，保留原文件 |
| **GA4 MCP**／Google 官方 MCP | 查询 Google Analytics 4 的流量、事件和转化报表 | 按 [Google 官方指南](https://developers.google.com/analytics/devguides/MCP) 使用兼容的 Python 和 `uvx` 或 `pipx`，在 Homer 专属实例注册选定版本的 `analytics-mcp`。Google Cloud 项目需启用 Analytics Admin API 和 Data API，并通过 ADC 提供获授权的凭据 | 使用对目标媒体资源具备 Viewer 权限的身份与只读 OAuth scope，保持默认只读模式。查询获授权的测试媒体资源在一段已结束日期内的一个汇总指标，用相同时区和筛选条件与 GA4 报表核对。 [官方仓库](https://github.com/googleanalytics/google-analytics-mcp) |
| **PostHog MCP**／官方远程 MCP | 查询事件、趋势、漏斗和留存，按项目范围做产品分析 | 按 [官方 Codex 接入说明](https://posthog.com/docs/model-context-protocol/codex) 在 Homer 专属实例配置远程 MCP，由本人 OAuth 登录。按 [配置说明](https://posthog.com/docs/model-context-protocol/faq) 用 `readonly=true` 限制工具，并通过 `project_id` 固定获授权项目 | 需目标项目的读取权限。查询该项目已知事件在一段已结束日期内的汇总计数，用相同时区和筛选条件与项目界面核对。保持分析连接只读 |
| **Google Search Console API**／官方 API，已有站点资源时按需接入 | 按搜索词、落地页或设备查看 Google 自然搜索的点击、展示和趋势，可与本表 GA4 的站内表现结合分析 | 在获授权的 Google Cloud 项目启用 Search Console API，按 [Search Analytics 文档](https://developers.google.com/webmaster-tools/v1/searchanalytics/query) 用 OAuth 和 `webmasters.readonly` scope 查询 | 需目标站点资源的读取权限。选一段已有数据的已结束日期，按页面查询点击和展示，用相同资源、日期、搜索类型和筛选条件与界面抽样核对。API 明细受返回范围限制 |
| **Google Ads MCP**／官方 MCP，已有广告账户时按需接入 | 查询广告系列的花费、点击和转化，用于投放复盘 | 按[上游指南](https://github.com/googleads/google-ads-mcp#setup-instructions)启用 Google Ads API，配置该版本所需凭据，用固定版本的 `google-ads-mcp` 注册本地 stdio。按上游工具配置关闭写入类别，并检查实际暴露的工具 | 需有目标广告账户的读取权限。对单个获授权账户查询一段已结束日期内的广告系列花费和点击，按同一时区、币种和日期与账户界面抽样核对 |
| **DBHub MCP**／Bytebase，已有数据库时按需接入 | 查询已有业务数据库，做订单汇总、库存核对或运营报表 | 按[上游指南](https://github.com/bytebase/dbhub)将选定版本的 `@bytebase/dbhub` 装到 Homer 专属工具目录，以实际 bin 注册 stdio。数据库需从本机可达。用最小权限的只读账号连接获授权的数据库，按[只读配置示例](https://github.com/bytebase/dbhub/blob/main/docs/mcpb.mdx)启用工具只读模式并限制返回行数 | 先在本地样例库或获授权的测试副本核对一个已知汇总，并验证写入请求被拒绝。连接凭据存放在私有配置中 |

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

### 腾讯会议、企业微信、钉钉与腾讯文档

| 工具／形式 | 用途 | 安装或接入 | 条件与最小验证 |
| --- | --- | --- | --- |
| **腾讯会议 CLI + Skill** | 查询、预约、改期和取消会议，读取录制、转写、纪要和参会报告 | 将选定版本的 `@tencentcloud/tmeet` 安装到 Homer 专属工具目录，从 [官方仓库](https://github.com/TencentCloud/tencentmeeting-cli) 安装 `skills/tmeet-skill`。用 `TMEET_CLI_CONFIG_DIR` 和 `TMEET_CLI_DATA_DIR` 隔离配置和数据，再由本人完成 `tmeet auth login` | 个人版和专业版已开放，商业版和企业版需申请。先用 `tmeet meeting list` 只读验证，预约、改期和取消前按上游要求二次确认。 [官方说明](https://cloud.tencent.com/document/product/1095/133827) |
| **企业微信 CLI + Skill** | 操作企微消息、邮件、文档、表格、待办、日程、会议和微盘 | 将选定版本的 `@wecom/cli` 安装到 Homer 专属工具目录，从 [官方仓库](https://github.com/WecomTeam/wecom-cli) 安装 `skills/wecomcli-shared` 和任务所需的 Skill。核对配置落点后，由本人用 `wecom-cli auth init` 扫码授权，Bot ID 和 Secret 是可选的手动配置方式 | 需企业微信账号和对应业务权限。先查授权状态，再只读查询本人指定日程或文档。发送、写入和权限变更按任务授权 |
| **钉钉 MCP** | 查询通讯录、管理待办和日程、通过机器人发送消息 | 在钉钉开发者后台创建应用并获取 Client ID 和 Secret。将选定版本的 `dingtalk-mcp` 安装到 Homer 专属工具目录，以实际 bin 注册 stdio MCP。凭据经安全方式注入，`ACTIVE_PROFILES` 仅启用任务所需分组。 [官方仓库](https://github.com/open-dingtalk/dingtalk-mcp) | 适用于已使用钉钉且可配置应用权限的组织。先授权所需的只读权限并查询指定日程，机器人发消息需相应权限和任务授权 |
| **腾讯文档 MCP** | 查询、创建和编辑在线文档、智能表格等内容 | 在 Homer 专属实例注册远程 MCP `https://docs.qq.com/openapi/mcp`，按 [官方指南](https://developer.cloud.tencent.com/mcp/server/11803) 从安全通道向 `Authorization` 请求头传入个人 Token | 个人 Token 是否向免费账号开放尚未验证，[空间 Token 文档](https://docs.qq.com/open/document/mcp/get-token/) 明确要求超级会员或超级会员 Plus。以本人账号实际资格为准，先读取本人指定的文档验证 |

### GitLab CLI：代码协作

**glab**／MIT：[GitLab 官方 CLI](https://gitlab.com/gitlab-org/cli)。管理 Issue、合并请求和流水线，支持 GitLab.com 及本人自建实例。已有 Homebrew：`brew install glab`；其他平台按 [官方安装](https://docs.gitlab.com/cli/)。

本人交互登录：`glab auth login --hostname "$GITLAB_HOST"`，随后 `glab auth status`、`glab mr list` 只读验证。优先系统安全存储；核该版本是否退回明文配置，不传 `--token` 到可记录参数或使用 insecure storage。安装和登录不授权创建 MR／推送代码。

### Notion MCP：用户已使用 Notion 时再连接

[Notion 官方接入](https://developers.notion.com/guides/mcp/get-started-with-mcp) 提供远程 `https://mcp.notion.com/mcp`。用原生 `mcp add --url` 注册 URL 后，沿其支持的原生 OAuth 登录；必要时在专属 HOME 下核固定 Codex 的 `mcp login notion` 帮助。需要 Notion 账号和相应网络，按服务条款使用；不是本地知识库或大陆用户基础能力的前提。先只读本人指定页面验证。

### 笔记、知识库与团队协作

| 工具／形式 | 用途 | 安装或接入 | 条件与最小验证 |
| --- | --- | --- | --- |
| **Obsidian CLI** | 搜索本地笔记库，查询反向链接、标签和任务 | 由本人在 Obsidian 桌面版的「设置 → 通用」启用并注册 CLI。 [官方指南](https://obsidian.md/help/cli) | 官方指南要求安装程序版本 1.12.7+。CLI 依赖桌面应用运行，首次调用可能启动应用。用 `obsidian vault="$VAULT" search query="$QUERY"` 在获授权的笔记库查找已知测试笔记 |
| **语雀 MCP** | 搜索和读取语雀知识库、文档与目录，按授权创建或更新内容 | 将选定版本的 `yuque-mcp` 安装到 Homer 专属工具目录，以实际 bin 注册 stdio MCP，通过安全方式注入 `YUQUE_TOKEN`。空间绑定的团队 Token 或私有部署另配 `YUQUE_HOST`。 [官方仓库](https://github.com/yuque/yuque-mcp-server) | 需要所选版本支持的 Node.js，以及具备目标内容访问权限的个人或团队 API Token。用 `yuque_get_doc` 只读检查一份指定测试文档的标题与正文 |
| **Slack MCP** | 搜索 Slack 消息和文件、读取频道历史与会话线程，并按授权发送消息 | 按 [官方接入指南](https://docs.slack.dev/ai/slack-mcp-server/connect-to-harnesses/) 在 Homer 专属实例注册 `https://mcp.slack.com/mcp`。确认当前客户端可使用已注册的 Slack 应用完成 OAuth，凭据走安全通道 | 需要工作区管理员批准集成，权限受用户身份和应用 scopes 限制。先用所需只读权限查询指定测试频道里的已知消息，发送消息另需 `chat:write` 和任务授权 |
| **Atlassian Rovo MCP** | 搜索和读取 Jira 工单、Confluence 页面等 Atlassian Cloud 内容，按授权创建或更新 | 按 [官方接入指南](https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/) 在 Homer 专属实例注册 `https://mcp.atlassian.com/v2/mcp`，由本人完成 OAuth 2.1 授权 | 需要目标 Atlassian Cloud 站点的账号权限，遵守组织策略，部分工具会消耗 Rovo credits。读取一张已知工单或一页指定文档，核对标题与内容 |

### GitHub CLI、GitHub MCP 与开发文档

| 工具／形式 | 功能 | 安装或配置 | 条件与验证 |
| --- | --- | --- | --- |
| **Context7**／Upstash，本地 MCP | 按库和版本查询开发文档与示例 | [官方仓库](https://github.com/upstash/context7)；`npm install --prefix "$HOMER_TOOLS/context7" --save-exact "@upstash/context7-mcp@$VERSION"`，按真实包 bin 以 stdio 注册；[各客户端配置](https://context7.com/docs/resources/all-clients) | 读取当前服务要求，可能需 API key／OAuth；不在公开参数或聊天放凭据；查询一个已知库文档验证 |
| **GitHub CLI**／`gh` | 查询仓库、Issue 和 PR，查看 Actions 运行与日志、下载构建产物和处理 Release | 优先复用已有 `gh`，缺少时按 [官方安装说明](https://github.com/cli/cli#installation) 选对应平台发行。将 `GH_CONFIG_DIR` 指向 Homer 专属配置目录，并由本人按 [登录说明](https://cli.github.com/manual/gh_auth_login) 授权 | 需要访问目标 GitHub 实例的网络与仓库权限。用 `gh auth status` 核对账号，再用 `gh repo view OWNER/REPO --json nameWithOwner` 只读验证指定仓库。提交、发布和其他写入按任务授权 |
| **GitHub MCP Server**／GitHub，HTTP MCP | 仓库、Issues、PR、Actions 等协作 | [官方 Codex 接入](https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-codex.md)；远程 URL `https://api.githubcopilot.com/mcp/`；原生 OAuth／安全 Token 环境配置按该版本实际支持路径接入 | 仓库权限由 GitHub 授予；凭据配置沿 Codex 原生支持，避免把 Token 填入 URL 或硬编码 args |
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

`BRAVE_API_KEY`／`TAVILY_API_KEY` 只能经支持的秘密通道注入。通过 Codex 原生支持的凭据引用配置，不能写进 URL、args、公开配置或聊天，不能把配置未完成写作可调用。两者均未做中国大陆网络／真实检索验收，不默认安装或产生费用。

## Word、PPT、Excel、PDF

### 办公 Skill：按任务选择

以下只收录名称、功能、官方地址与安装办法，不随 Homer 分发第三方 Skill 源码。用户按需选择；目录条目不代表已安装、已验收或已取得使用许可。Anthropic 四项为技术参考，**需先确认覆盖 Homer 独立宿主的使用授权，不进入默认自动安装路径**；让用户自行下载不改变原许可。

| Skill／来源 | 功能与选用场景 | 官方入口／安装方法 | 条件与验收 |
| --- | --- | --- | --- |
| **PPT Master**／hugohe3，MIT | 从材料制作可编辑 PPTX。已有公司 PPTX 时，走 Edit Native PPTX，沿用原母版和版式填充、复用或重排页面 | 用原生 Installer 从 `hugohe3/ppt-master` 安装完整 `skills/ppt-master`。已有模板时提供一份带典型示例页的公司 PPTX 和新材料，按 [公司模板编辑配方](office-tools.md#ppt-master-原生公司模板编辑) 操作。[完整 Skill](https://github.com/hugohe3/ppt-master/tree/main/skills/ppt-master) | Python 3.10+，按路线安装依赖。用模板副本改一个中文标题并复用一页，在 WPS 或 PowerPoint 核对页数、母版与版式，确认标题可编辑、中文无溢出。交付前用实际使用的演示软件和版本保存、重开一份代表性样稿，按本次需求确认编辑效果 |
| **大师 PPT（Dashi）**／chuspeeism，按需候选 | 用内置主题和版式制作中文经营汇报、调研、方案和路演，可在浏览器修改图文并导出 PPTX | 需要 Node.js 20+、npm，导出需要 Chrome／Chromium／Edge。核对固定版本的发行包与许可后，按 [Dashi 配方](office-tools.md#大师-pptdashi) 接入完整 Skill | 项目主体为 AGPL-3.0。PPTX 导出引擎为专有组件，许可限于作为完整 Dashi Skill 的组成部分使用。作为 Homer 自有组件或独立再分发需权利人书面许可。用非敏感中文样稿导出 PPTX，在目标客户端核对版式和对象可编辑性 |
| **docx**／Anthropic，source-available | 新建、读取、编辑 Word；修订、批注、目录和格式校验 | [官方目录](https://github.com/anthropics/skills/tree/main/skills/docx)；[官方 Claude Code 安装入口](https://github.com/anthropics/skills#try-in-claude-code-claudeai-and-the-api)；Homer 使用须先确认授权 | 非普通开源安装项；授权覆盖后才采用完整目录；依赖和校验见办公配方 |
| **xlsx**／Anthropic，source-available | 创建、修改和分析 Excel；公式、格式、财务模型、重算与错误检查 | [官方目录](https://github.com/anthropics/skills/tree/main/skills/xlsx)；官方安装入口同上；Homer 使用须先确认授权 | 重算依赖 LibreOffice，不能保证 Excel 全部函数、宏、外部链接；公式能计算不等于业务结果正确 |
| **pptx**／Anthropic，source-available | 制作 PPT，重点补充已有模板的分析、编辑、增删页和结构检查 | [官方目录](https://github.com/anthropics/skills/tree/main/skills/pptx)；官方安装入口同上；Homer 使用须先确认授权 | 模板复制可能共享图表／嵌入对象；结构及逐页渲染均需检查 |
| **pdf**／Anthropic，source-available | PDF 提取、合并、拆分、生成、OCR 和表单填写 | [官方目录](https://github.com/anthropics/skills/tree/main/skills/pdf)；官方安装入口同上；Homer 使用须先确认授权 | 读取实际小写 `forms.md`／`reference.md`；不是任意 PDF 正文的无损排版编辑器 |
| **BrandDocs**／ferdinandobons，MIT，**固定模板反复出报表时按需使用** | `brand-docx`／`brand-pptx`／`brand-xlsx` 复用同一公司模板，适合按期制作 Word 报告、PPT 汇报或保留公式的 Excel 报表 | 安装完整仓库和共享引擎，提取并验证可复用的模板配置。见 [BrandDocs 配方](office-tools.md#branddocs) 和 [上游安装说明](https://github.com/ferdinandobons/brand-docs#installation) | Alpha，Python 3.10–3.13。用同一模板生成两期样稿，核对内容随输入更新，品牌和结构符合模板。Excel 另查公式与重算结果 |
| **Hermes docx／xlsx／pdf**／Nous Research，Skill 声明 MIT | 配套 CLI 脚本完成生成、读取、编辑、模板、公式及 PDF 常见操作，作为工程化备选 | [Word](https://github.com/NousResearch/hermes-agent/tree/main/skills/productivity/docx)、[Excel](https://github.com/NousResearch/hermes-agent/tree/main/skills/productivity/xlsx)、[PDF](https://github.com/NousResearch/hermes-agent/tree/main/skills/productivity/pdf)；按所需目录用原生 Installer，命令见办公配方 | Python 3.10+；保留 scripts／references；将上游 terminal、read_file 等称呼映射到 Homer 当前工具，不安装 Hermes 引擎 |

新做 PPT 可评估 PPT Master 和 Dashi。沿用已有公司 PPTX 时，先选 PPT Master 的原生编辑流程。固定模板反复出报表时再评估 BrandDocs。常规读写可评估 Hermes，Anthropic 四项按各自授权采用。

### 底层生成、转换和渲染程序

以下为实际库／程序，不要求 Microsoft Office 或 OpenAI Apps。只安装当前成果需要的库；`PY` 是私有 venv 的绝对 Python 路径。

| 工具／形式 | 作用 | 安装方法与来源 | 关键条件 |
| --- | --- | --- | --- |
| **MarkItDown**／Microsoft CLI | 将 PDF、Word、PPT、Excel、HTML 等转成供 Agent 阅读的 Markdown，适合提取标题、正文和表格 | 上游当前要求 Python 3.10–3.14，安装时核对所选版本。在 Homer 私有 venv 中运行 `"$PY" -m pip install "markitdown[docx]==$VERSION"`，按输入格式增选 `pdf`、`pptx`、`xlsx` 等依赖。 [官方仓库](https://github.com/microsoft/markitdown) | 本地文档转换无需账号。用 `"$PY" -m markitdown sample.docx -o sample.md` 转换一份内容已知的测试文档，检查标题、正文和表格。扫描件需另做 OCR，Markdown 用于内容提取 |
| **python-docx**／Python 库 | 创建、读取、修改 `.docx` | `"$PY" -m pip install python-docx`；[官方包](https://pypi.org/project/python-docx/) | 导入 `docx`；MIT；排版验收另需渲染 |
| **python-pptx**／Python 库 | 创建、读取、编辑 `.pptx` | `"$PY" -m pip install python-pptx`；[官方包](https://pypi.org/project/python-pptx/) | 导入 `pptx`；MIT；不提供 PowerPoint 渲染 |
| **PptxGenJS**／Node 库 | 用 JS/TS 制作可编辑 PPTX、图表和图形 | `npm install --prefix "$HOMER_TOOLS/slides-js" --save-exact "pptxgenjs@$VERSION"`；[官方安装](https://gitbrent.github.io/PptxGenJS/docs/installation/) | MIT；与 python-pptx 按任务二选一 |
| **openpyxl**／Python 库 | 读写 XLSX、公式、样式、图表 | `"$PY" -m pip install openpyxl`；[官方包](https://pypi.org/project/openpyxl/) | MIT；不计算公式，图片功能另需 Pillow |
| **ReportLab Toolkit**／Python 库 | 生成 PDF、分页、表格和矢量图 | `"$PY" -m pip install reportlab`；[官方包](https://pypi.org/project/reportlab/) | BSD；指开源 Toolkit，中文需合法字体 |
| **pypdf**／Python 库 | PDF 文本提取、合并、拆分、旋转 | `"$PY" -m pip install pypdf`；[官方安装](https://pypdf.readthedocs.io/en/stable/user/installation.html) | BSD-3-Clause；不是页面栅格渲染器 |
| **LibreOffice**／系统应用与 CLI | Office 转 PDF、排版预览、转换和重算工作流 | [官方平台安装](https://www.libreoffice.org/installation-instructions/)；已有 Homebrew 的 macOS：`brew install --cask libreoffice` | MPL2；实际安装大程序，先核授权，不为此默认装 Homebrew |
| **Poppler**／CLI 集合 | `pdfinfo` 体检、`pdftoppm` 页面转图、文本提取 | [官方项目](https://poppler.freedesktop.org/)；已有 Homebrew 的 macOS：`brew install poppler` | GPL2／GPL3 发行许可；独立调用与嵌入／随包分发分开核对 |
| **OCRmyPDF CLI + Tesseract 中文语言包** | 为扫描合同、票据和纸质资料的 PDF 添加本地可搜索文本层 | 优先复用本机工具，按[上游安装指南](https://ocrmypdf.readthedocs.io/en/latest/installation.html)配置平台依赖和语言数据。用 `tesseract --list-langs` 确认 `chi_sim` 或 `chi_tra` 可用 | 用 `ocrmypdf -l chi_sim scan.pdf searchable.pdf` 处理一页已知内容的简体中文扫描样稿。在 PDF 阅读器中搜索并复制文字，抽查金额和日期 |

生成、渲染和公式验证的实际命令见 [办公操作配方](office-tools.md)。需要 Google Drive 等账号工具时查下方可选平台候选；本地文档制作不因此强制登录外部服务。


## 文件归档与交付

| 工具／形式 | 功能与选用场景 | 安装链接／安装方法 | 前提及最小验证 |
| --- | --- | --- | --- |
| **rclone CLI** | 把项目文件批量复制到网盘或对象存储，核对源与目标的文件内容 | 复用本机 `rclone`，或按[官方安装指南](https://rclone.org/install/)获取对应平台版本。按[目标后端文档](https://rclone.org/docs/)配置获授权的连接 | 需目标测试路径的读写权限。用 `rclone copy --dry-run` 预演，确认源和目标路径后复制少量样本到空测试目录，再用 `rclone check` 核对，后端缺少共同哈希时可按需用 `--download` 校验内容。镜像同步仅在任务明确需要时使用 |
| **restic CLI** | 对项目文件做加密快照，按需恢复旧版本。文件复制与交付仍可用本表 rclone | 复用本机 `restic`，或按[官方安装指南](https://restic.readthedocs.io/en/stable/020_installation.html)获取对应平台版本。需要备份仓库、仓库密码和目标存储权限，本地仓库无需云账号 | 在独立本地测试仓库用 `restic init` 初始化，备份两个测试文件，再用 `restic restore latest --target` 指向空目录，核对恢复文件的 SHA-256 |

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
| **OpenAI Developers**／OpenAI | OpenAI API、Agents SDK、Apps 开发和排障；含 Skill、MCP 和 App | [插件目录](https://github.com/openai/plugins/tree/main/plugins/openai-developers)；在原生市场核对精确插件，再使用 `plugin add` | 仅限确需 OpenAI 开发的任务；账号、地区和网络条件另核 |
| **Google Drive**／OpenAI 目录 | Drive 文件与 Docs、Sheets、Slides 工作流；Skill＋App connector | [插件目录](https://github.com/openai/plugins/tree/main/plugins/google-drive)；原生搜索 `google drive`，详情中的 manifest 名称为 `google-drive`，按实际 target 安装 | Google／原生 Apps 授权和可用网络；不作为大陆用户本地办公前提 |
| **Browser Use**／Browser Use Inc. | 云端浏览器 App；不是控制当前 Mac 的 Playwright 或官方 bundled Browser | [服务方](https://browser-use.com/)；原生搜索 `browser use`，读取当时发布者、版本与连接详情再安装 | 需要对应服务连接，可能收费；用户选择该云服务时才考虑，不默认要求 OpenAI Apps 登录 |

插件安装、审批及采用统一见 [执行方法](execution.md)；市场入口见 [认可的工具库](trusted-sources.md#codex-原生插件市场)。

### OpenAI Docs MCP

只在明确查询 OpenAI／Codex 开发文档时考虑 [官方 Docs MCP](https://developers.openai.com/learn/docs-mcp)，远程 URL `https://developers.openai.com/mcp`。这不代调用模型 API，也不提供额度。未验证中国大陆可达性，不作大陆用户默认精选；本机能访问不代表所有用户能访问。可先使用已有搜索／公开文档；只有该任务需要且实际网络允许时才经原生 MCP 管理配置。

## 更多来源

本页没有合适候选时，查 [认可的市场与工具库](trusted-sources.md)。需要复用 Cindy 特有实现时，再读 [25 项源码适配参考](official-catalog.md)；原包不能直接加载到 Homer，不因源码公开就默认启动适配开发。

长期记忆、持续学习及多 Agent 方法不默认覆盖 Homer 现有原生记忆与 Worker 机制。
