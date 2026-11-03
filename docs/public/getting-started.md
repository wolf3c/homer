# 源码构建与运行

[English](getting-started.en.md) | **简体中文**

本页面向开发者。当前[仓库](https://github.com/wolf3c/homer)已公开开发预览源码；正式桌面安装包尚未发布。普通使用流程和示例任务见[使用指南](using-homer.md)，产品介绍见 [README](../../README.zh-CN.md)。

## 环境与构建

使用 Node.js **22.22.0**、npm 和仓库锁文件；版本记录于源码的 `.nvmrc`。在项目根目录运行：

```sh
git clone https://github.com/wolf3c/homer.git
cd homer
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

参考 `examples/homer.config.json` 建立专用配置：

- `codexBin`：建议填写上述可执行文件的绝对路径。
- `workspace`、`runtime`：分别保存材料／成果和运行数据，不能相同或互相包含；相对路径基于配置文件目录。
- `appData`、`codexHome`、`nativeCodexHome`：建议使用明确的绝对路径，避免误用其他应用或日常数据目录。
- 模型、提供方和认证：按自己获准使用的服务配置；`keyEnv` 填环境变量名称，不填密钥值。配置字段及模型名不代表相应接入已经可用。

### 建立专用配置

不要直接启动并复用日常数据目录。先在仓库根目录创建被 Git 忽略的 `.codex/private/`，将配置保存为 `.codex/private/homer.config.json`。以下是使用兼容提供方的模板（CLI 路径示例适用于 macOS／类 Unix 开发环境）；请替换可执行文件、目录、模型和服务地址占位符：

```json
{
  "codexBin": "/absolute/path/to/homer/.codex/private/codex-cli/node_modules/.bin/codex",
  "appData": "/absolute/path/to/homer/.codex/private/profile/app-data",
  "workspace": "./workspace",
  "runtime": "./runtime",
  "codexHome": "/absolute/path/to/homer/.codex/private/profile/codex",
  "nativeCodexHome": "/absolute/path/to/homer/.codex/private/profile/codex",
  "model": "YOUR_MODEL_ID",
  "baseUrl": "https://your-provider.example/v1",
  "keyEnv": "HOMER_MODEL_KEY",
  "requiresOpenaiAuth": false,
  "fast": false
}
```

`workspace` 和 `runtime` 将位于配置文件所在目录下，彼此独立。其他路径请填写实际绝对路径。选择支持 Codex 所需 Responses 协议和工具调用的提供方；仅声称兼容 Chat Completions 的接口不够。这个模板没有预置可用服务、模型或凭据。

在启动终端通过你自己的凭据管理方式设置 `HOMER_MODEL_KEY` 环境变量，不把真实密钥写进 JSON 或 Git。字段 `keyEnv` 保存的是变量名称。本模板使用环境变量密钥，不复用日常 Codex 登录态。不要复制日常 App 的认证文件。相关 `HOMER_*` 环境变量可以覆盖配置，运行前核对当前终端是否已有覆盖项。

确认配置、认证、权限与[费用](data-and-costs.md)后，在同一终端运行：

```sh
npm start -- --config .codex/private/homer.config.json
```

启动后使用[第一个任务](using-homer.md#第一个任务)检查交付并尝试修订；输入 `/quit` 正常退出。不要复制他人的认证、数据库或聊天记录来初始化。ChatGPT 套餐的对外接入条件仍待确认。

## 本地 Web 与桌面端

使用同一份专用配置启动开发 Web：

```sh
npm run web -- --config .codex/private/homer.config.json --port 4780
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

## 当前源码状态

本次源码基于 2026-11-03 的固定开发快照。隔离副本复用本机依赖完成以下检查；未执行全新依赖安装，也不代表正式发行验收。

| 检查 | 结果 |
| --- | --- |
| `npm run build` | 通过；前端仍有部分分块超过 500 kB 的提示。 |
| `npm start -- --help` | 通过，无真实模型调用。 |
| `npm run typecheck` | 未通过：121 条诊断，涉及测试引用、接口及导入等问题。 |
| 模型配置、历史桥及服务观察器的定向离线测试 | 83/84 通过；`tests/tool-service-observer.test.ts` 读取未定义对象的 `snapshot` 时失败，原因尚待确认。 |
| 移动端离线测试 | 19/19 通过。 |

当前按量模型服务仍有充值余额接线未对齐、恢复专项失败及超时的待解决项；不作为已全面验收的公开付费服务承诺。ChatGPT 套餐的对外接入条件仍待确认。

完整命令见[测试与移动端开发](testing.md)。`npm test` 验证 Homer 自身的调度、审批、交付、持久化和权限等职责；本轮未运行全量默认测试。真实引擎、媒体、浏览器／原生通信、第二台机器和正式安装包须分别验收，默认测试通过不能代替这些能力的验收。
