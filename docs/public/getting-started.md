# 源码构建与运行

本页面向开发者。当前[仓库](https://github.com/wolf3c/homer)仅公开文档，以下命令须等源码发布后才能执行；正式桌面安装包尚未发布。产品介绍见 [README](../../README.md)。

## 环境与构建

使用 Node.js **22.22.0**、npm 和仓库锁文件；版本记录于源码的 `.nvmrc`。在项目根目录运行：

```sh
node --version
npm --version
npm ci --no-audit --no-fund
npm run build
npm start -- --help
```

依赖安装会下载原生模块与 Electron，并执行安装脚本；失败时保留包名和错误码，不以 `--ignore-scripts` 代替正常安装。`--no-audit` 不表示依赖通过安全审计。

构建生成后端 `dist/` 和前端 `dist/web/`，也会重新生成部分 `ui/vendor/` CSS。运行还需要提示词、必要 Skill 等源码资源。帮助命令不启动模型会话。

## 运行自己的任务

Homer 使用 Codex App Server。当前固定 Codex CLI **0.163.0**，`npm ci` 不安装独立 CLI。可按 [OpenAI 官方 npm 安装方式](https://developers.openai.com/codex/cli/)安装到项目专用目录：

```sh
npm install --prefix .codex/private/codex-cli @openai/codex@0.163.0
.codex/private/codex-cli/node_modules/.bin/codex --version
```

源码发布后，参考 `examples/homer.config.json` 建立专用配置：

- `codexBin`：建议填写上述可执行文件的绝对路径。
- `workspace`、`runtime`：分别保存材料／成果和运行数据，不能相同或互相包含；相对路径基于配置文件目录。
- `appData`、`codexHome`、`nativeCodexHome`：建议使用明确的绝对路径，避免误用其他应用或日常数据目录。
- 模型、提供方和认证：按自己获准使用的服务配置；`keyEnv` 填环境变量名称，不填密钥值。配置字段及模型名不代表相应接入已经可用。

确认认证、权限与[费用](data-and-costs.md)后运行：

```sh
npm start -- --config /absolute/path/to/your/homer.config.json
```

输入任务开始工作，输入 `/quit` 正常退出。不要复制他人的认证、数据库或聊天记录来初始化。ChatGPT 套餐的对外接入条件仍待确认。

## 本地 Web 与桌面端

使用同一份专用配置启动开发 Web：

```sh
npm run web -- --config /absolute/path/to/your/homer.config.json --port 4780
```

打开启动提示的 `http://127.0.0.1:4780/`。开发入口免配对，仅用于可信本机；不要对外转发端口。同一 runtime 的旧实例须先正常退出，不要删除运行锁强行接管。桌面入口另有自动认证，无需手工配对。

当前桌面构建脚本限定 macOS / Apple Silicon、Node.js 22.22.0，Swift 目标为 macOS 27.0；需要 Xcode 命令行工具。维护入口 `npm run desktop:make` 还要求准确的 `--source-sha`、`--maintenance` 等参数，详见随源码提供的 `scripts/build-desktop.mjs`。正式安装、签名、公证和更新须单独验收，不以源码构建通过代替。

## 按需安装工具

基础文本读取不需要额外 Python 环境。文档提取、图片与音视频处理按任务需要准备工具：

| 功能 | 依赖与限制 |
| --- | --- |
| PDF、DOCX、XLSX、PPTX 文本提取 | 项目内专用 Python 及下列四个包；不承诺扫描件 OCR 或完整保留版式。 |
| 图片、音视频处理 | 桌面图片 helper 或 FFmpeg／ffprobe；源码查找 `/opt/homebrew/bin`、`/usr/local/bin` 等固定路径。 |
| 本地语音识别 | `whisper-cli` 与 `.codex/private/media-tools/models/ggml-base.bin`。 |
| 本地语音合成 | 当前依赖 macOS `say` 和 FFmpeg。 |
| Skill、MCP、插件 | 按实际任务安装与授权，另行核对文件、网络及账户访问范围。 |

文档提取工具可在项目根目录安装：

```sh
python3 -m venv .codex/private/media-tools
.codex/private/media-tools/bin/python3 -m pip install pypdf python-docx openpyxl python-pptx
```

已安装 Homebrew 的 macOS 可使用 [FFmpeg](https://formulae.brew.sh/formula/ffmpeg) 和 [whisper.cpp](https://formulae.brew.sh/formula/whisper.cpp)：

```sh
brew install ffmpeg whisper.cpp
ffmpeg -version
ffprobe -version
whisper-cli --help
```

语音模型需按[上游说明](https://github.com/ggml-org/whisper.cpp/tree/master/models)另行下载，核对来源与完整性后放入上述路径。这些是可选安装指引，尚未作为一组完成验收；程序存在、文件上传成功均不代表 Homer 已正确解析内容。

## 验证范围

2026-11-02 的内部候选在 macOS 27.0 / arm64、Node.js 22.22.0、npm 10.9.4 下，使用隔离目录和全新依赖安装完成以下检查：

| 检查 | 结果 |
| --- | --- |
| `npm ci --no-audit --no-fund` | 通过，安装 579 个包。 |
| `npm run build` | 通过，15.45 秒。 |
| `npm start -- --help` | 通过，无模型调用。 |

该候选尚未公开，结果不覆盖后续改动。第二台机器、其他系统、可选媒体工具、真实任务和正式安装包须分别验证；构建仍有部分前端分块超过 500 kB 的提示。

源码发布后，`npm test` 用于 Homer 自身的调度、审批、交付、持久化和权限等检查。真实引擎、媒体、浏览器／原生通信和开发发布验收须显式选择对应专项；默认测试通过不能代替这些能力的验收。
