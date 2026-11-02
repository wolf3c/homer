# 源码构建与运行

本页面向检查源码的开发者。当前 [GitHub 仓库](https://github.com/wolf3c/homer)仅公开文档，源码将在验收修复与模型接入完成后另行上传。以下命令和文件路径是源码发布后的运行指引，目前无法在仅含文档的仓库中执行；正式桌面安装包也尚待发布。构建产物不等于经过签名、公证和用户任务验收的发行版。

## 环境前提

| 目的 | 前提 |
| --- | --- |
| 编译后端和 Web 资源 | Node.js 22.22.0、自带 npm、锁文件一致的源码、访问 npm 与依赖下载站点的网络。无需模型账号。 |
| 运行真实任务 | 额外准备项目固定的 Codex CLI 0.163.0、自己获准使用的模型连接及独立配置。模型接入资格和可用性须另行确认。 |
| 构建 macOS 桌面候选 | macOS Apple Silicon、Node.js 22.22.0、Xcode 命令行工具和 Swift；现有脚本的 Swift 目标为 macOS 27.0。还需要准确提交身份及打包依赖。 |

Node 版本记录于源码中的 `.nvmrc`（随源码发布）。不要用系统中另一个 Node 大版本替代后，仍把结果当作本页环境的验证。

依赖包含原生模块和 Electron。若安装阶段没有适合本机的预编译包，可能转入本机编译；本轮不保证不同操作系统、CPU、代理或工具链的安装都成功。安装失败应先保留包名、阶段和错误码，不能用 `--ignore-scripts` 的成功结果代替正常安装通过。

## 安装依赖并构建

取得正式公开仓库或发布源码后，在项目根目录运行：

```sh
node --version
npm --version
npm ci --no-audit --no-fund
npm run build
npm start -- --help
```

源码发布后，可从 [GitHub 仓库](https://github.com/wolf3c/homer)取得源码；当前下载仓库只会得到文档。若使用版本管理器，请先按 `.nvmrc` 切换到 Node.js 22.22.0。`--no-audit --no-fund` 只关闭安装时的审计请求和资助提示，不表示依赖已经通过安全审计。

构建生成后端 `dist/` 和前端 `dist/web/`，并复制所需的媒体读取脚本。构建还会重新生成 `ui/vendor/` 下的部分 CSS；因此构建后的 Git 差异可能含生成文件，应核对后处理。保留 `prompts/`、必要项目 Skill 及配置示例，不能只复制一个后端入口文件运行。不要提交依赖目录、构建目录或自己的认证和运行数据。

`npm start -- --help` 只显示帮助，不启动模型会话；本轮以此检查生成的 CLI 入口。不要把它当作聊天、交付或模型接入测试。

## 真实运行需要自己的配置

Homer 通过 Codex App Server 执行模型工作，固定版本记录于 `scripts/prepare-desktop-dependencies.mjs`（随源码发布）。`npm ci` 本身不安装可供真实任务使用的独立 Codex CLI。先准备与该版本相符、可合法使用的执行环境，再建立自己的专用配置。

如需自行准备 CLI，可参考 [OpenAI 官方安装说明](https://developers.openai.com/codex/cli/)的 npm 安装方式，在项目根目录安装到独立前缀，并固定本项目版本：

```sh
npm install --prefix .codex/private/codex-cli @openai/codex@0.163.0
.codex/private/codex-cli/node_modules/.bin/codex --version
```

将该可执行文件的绝对路径写入 `codexBin`。这一步不复制已有认证，也不代表登录或订阅接入已获准；本轮没有执行这项可选安装或真实模型任务。

配置结构将随源码提供于 `examples/homer.config.json`，配置读取逻辑位于 `src/config.ts`。示例中的模型名不代表你的账户一定有权使用该模型。

| 字段 | 用途 |
| --- | --- |
| `codexBin` | Codex 可执行文件的准确路径，或在当前 PATH 中可找到的名称。 |
| `workspace`、`runtime` | 材料／成果工作区与运行数据目录；两者不能相同或互相包含。相对路径基于配置文件目录。 |
| `appData`、`codexHome`、`nativeCodexHome` | 应用数据及原生认证、会话和工具配置目录。建议在专用配置中写绝对路径，避免采用其他应用或日常环境。 |
| `model`、`effort`、`fast` | 模型和执行参数，实际支持范围取决于执行环境与服务。 |
| `baseUrl`、`keyEnv`、`requiresOpenaiAuth` | 按获准的服务配置提供方；`keyEnv` 是存放密钥的环境变量名称，不是密钥值。字段存在不等于所有兼容接口都已验收。 |

确认配置、认证、费用和权限后，才运行：

```sh
npm start -- --config /absolute/path/to/your/homer.config.json
```

随后输入任务；输入 `/quit` 正常停止。不要从他人的配置、数据库、Codex Home 或聊天记录中复制认证来完成初始化。当前 ChatGPT 套餐接入的对外条件仍待确认，见[模型与费用](data-and-costs.md)。

## 本地开发 Web 入口

已具有上述专用配置的开发者可运行：

```sh
npm run web -- --config /absolute/path/to/your/homer.config.json --port 4780
```

打开启动提示的 `http://127.0.0.1:4780/`。开发入口免配对，适用于可信本机开发；不要直接转发到公网、局域网或不可信的本机程序环境。同一个 runtime 的旧实例应先正常退出，不能删除锁或强行接管。

桌面启动分支另有自动认证：凭据仅经私有启动通道传给 Electron，为可信主窗口的 API 请求附加；预览、其他窗口和外站不获得凭据。无需用户寻找连接文件或手工配对。

## 桌面构建与安装边界

现有维护入口为 `npm run desktop:make`，对应 `scripts/build-desktop.mjs`（随源码发布）。它要求显式 `--source-sha`、`--maintenance` 等输入，并校验准确提交、依赖和本机平台；不是在任意源码 ZIP 中运行一条命令就能得到正式发行版。

这一阶段只验证源码构建，不执行桌面打包。正式分发仍需核对许可与通知、完成签名及公证流程，并在目标设备上验证下载、首次启动、登录、任务交付、退出、更新与数据保留。不能通过停用系统安全机制来代替这些步骤。当前没有在本页提供可安装产品的下载承诺。

## 按功能准备本机工具

以下为源码当前查找的依赖，不是首包已包含能力或本轮安装验收结果。不需要这些格式时，无须先安装全部工具。

| 功能 | 当前依赖与边界 |
| --- | --- |
| UTF-8 文本、Markdown、CSV、JSON | 基础文本读取不需要额外 Python 环境；仍有内容与长度限制。 |
| PDF、DOCX、XLSX、PPTX 文本提取 | 项目根目录下 `.codex/private/media-tools/bin/python3`；读取脚本使用 `pypdf`、`python-docx`、`openpyxl`、`python-pptx`。扫描件 OCR、全部图片和版式不在文本提取承诺内。 |
| 图片解码 | 桌面随包 helper，或源码环境中的 FFmpeg；缺少解码器会明确失败。 |
| 音视频处理 | FFmpeg／ffprobe。源码目前查找 `/opt/homebrew/bin`、`/usr/local/bin` 等固定路径，不能假设任意 PATH 中的安装都被识别。 |
| 本地语音识别 | 对应路径中的 `whisper-cli`，以及 `.codex/private/media-tools/models/ggml-base.bin` 模型文件。不能仅凭文件上传成功宣称已转写。 |
| 本地语音合成 | 当前实现依赖 macOS `say` 与 FFmpeg，不表示其他系统已支持。 |
| Skill、MCP、插件及其他外部工具 | 按实际任务发现、安装和授权；其依赖、网络和数据发送范围需另行确认。 |

需要文档提取时，可在项目根目录准备独立 Python 环境：

```sh
python3 -m venv .codex/private/media-tools
.codex/private/media-tools/bin/python3 -m pip install pypdf python-docx openpyxl python-pptx
```

以上为按当前读取脚本整理的可选安装方式，本轮未安装或验证这些 Python 包及媒体工具版本；正式宣称相关格式可用前，还需单独验证解析结果。不要把它们当作 `npm run build` 的前置条件。

在已安装 Homebrew 的 macOS 上，[FFmpeg](https://formulae.brew.sh/formula/ffmpeg)和 [whisper.cpp](https://formulae.brew.sh/formula/whisper.cpp)提供以下安装入口：

```sh
brew install ffmpeg whisper.cpp
ffmpeg -version
ffprobe -version
whisper-cli --help
```

whisper.cpp 不自动下载语音模型。需要本地转写时，从[上游模型说明](https://github.com/ggml-org/whisper.cpp/tree/master/models)选择 `ggml-base.bin`，核对下载来源和文件完整性，放到项目根目录的 `.codex/private/media-tools/models/ggml-base.bin`。工具安装和版本输出仅说明程序存在，仍需验证 Homer 能找到它并正确处理合成样本；本轮未执行上述安装或下载。

## 检查与已知限制

认证专项可单独运行：

```sh
node --import tsx --test tests/web-desktop-access.test.ts tests/web-server.test.ts
node --test tests/desktop-gateway-access.test.mjs
npm run test:desktop:shell
```

`node tests/web-desktop-access.electron.mjs` 会启动独立 Electron 和合成服务，检查真实窗口中的隔离，不调用真实模型。`npm run typecheck`、`npm test` 是更广的检查；目前已有未解决失败，不能宣传为全量通过。`npm run test:real` 则涉及真实模型，应在专用配置、费用和数据范围确认后另行执行。

## 构建验证记录

2026-11-02，在 macOS 27.0 / arm64、Node.js 22.22.0、npm 10.9.4 上验证。使用单独源码目录、空依赖与 npm 缓存、隔离 HOME 和环境白名单，没有复用项目现有 `node_modules`、模型凭据或账户配置。

| 检查 | 实测结果 |
| --- | --- |
| `npm ci --no-audit --no-fund` | 通过；安装 579 个包，169.12 秒，保留正常安装脚本。 |
| `npm run build` | 通过；15.45 秒，生成后端和 Web 资源。 |
| `npm start -- --help` | 通过；0.25 秒，未发起模型会话。 |

验证输入为先前审查的桌面候选，加上桌面认证的有限改动，共 894 个文件。输入清单摘要（SHA-256）为 `0f832f9f1a7fde31c819574965084061397b1025f9b5dbe33f419c14de9473c8`；它标识本次构建输入，不是最终发行提交，也不包含本轮随后补齐的公开文档。该候选和逐文件清单尚未公开，外部读者目前不能据此复现。并行交付修复未纳入该候选，最终源码确定后须重新捕获和验证。

构建报告部分压缩后前端分块超过 500 kB；本轮仅记录，未调整代码。正常构建重新生成了两个现存 CSS 文件，原始输入与生成差异均已记录；生成结果不等于额外功能修改。

这证明本机隔离环境中的全新安装与源码构建通过；未在第二台机器验证，也未验证其他系统、完整测试套件、可选媒体工具、真实模型任务、桌面打包、签名、公证、安装或更新。候选仍不具备公开发行验收结论。
