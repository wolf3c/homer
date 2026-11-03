# Build and run from source

**English** | [简体中文](getting-started.md)

This guide is for developers using the public source preview. Official desktop installers are being prepared. For first-use workflow and the sample task, read the [user guide](using-homer.en.md).

## Environment and build

Use Node.js **22.22.0**, npm, and the committed lockfile. The Node version is pinned in `.nvmrc`.

```sh
git clone https://github.com/wolf3c/homer.git
cd homer
node --version
npm --version
npm ci --no-audit --no-fund
npm run build
npm start -- --help
```

Installation downloads native modules and Electron and executes install scripts. Keep the package name and error code if it fails; `--ignore-scripts` does not replace a working installation. `--no-audit` does not certify dependency security.

Build output is written to `dist/` and `dist/web/`; some vendor CSS is regenerated. Keep prompts and required Skills with the source. The help command does not start a model session.

## Engine, configuration, and authentication

Homer uses Codex App Server. This source snapshot pins Codex CLI **0.163.0**; the root `npm ci` does not install the separate CLI. Following the [official CLI npm installation method](https://developers.openai.com/codex/cli/), install it into a project-specific directory:

```sh
npm install --prefix .codex/private/codex-cli @openai/codex@0.163.0
.codex/private/codex-cli/node_modules/.bin/codex --version
```

Create the Git-ignored `.codex/private/` directory and save a dedicated configuration as `.codex/private/homer.config.json`. Replace all executable, directory, provider, and model placeholders in this compatible-provider template. The executable path shown is for macOS / Unix-like development environments:

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

`workspace` and `runtime` resolve relative to the configuration file and must be separate, with neither containing the other. Use actual absolute paths for the other directories and executable. Choose a provider that supports the Responses protocol and tool calls required by Codex; Chat Completions compatibility alone is insufficient. The template does not supply a working service, model, or credential.

Use your own credential-management method to set `HOMER_MODEL_KEY` in the launch terminal. Do not put a real key in JSON or Git; `keyEnv` stores the environment variable's name. This template uses an environment-variable key and does not reuse your everyday Codex login. Do not copy another application's credentials. Existing `HOMER_*` environment variables can override configuration; check the active terminal before starting.

After checking configuration, authentication, permissions, and [costs](data-and-costs.en.md), run in the same terminal:

```sh
npm start -- --config .codex/private/homer.config.json
```

Keep the interactive session open to answer questions. Try the [first task](using-homer.en.md#your-first-task), inspect the files, and request a revision. Enter `/quit` to stop execution and exit. A ChatGPT subscription is not a promise of publicly available Homer integration; eligibility remains to be confirmed.

## Local Web and desktop

Use the same dedicated configuration:

```sh
npm run web -- --config .codex/private/homer.config.json --port 4780
```

Open the printed local address, normally `http://127.0.0.1:4780/`. The development entry requires no pairing and is for a trusted local machine; do not forward its port publicly. Quit an old instance normally before reusing the same runtime. Do not delete a running instance's lock to take over. The desktop entry uses automatic authentication without manual pairing.

This source snapshot's desktop build script targets macOS / Apple Silicon, Node.js 22.22.0, and a Swift deployment target of macOS 27.0, with Xcode command-line tools required. `npm run desktop:make` also requires explicit maintenance and source-identity arguments; see `scripts/build-desktop.mjs`. This is not a promise that other-platform installers are available. Signing, notarization, installation, and updates need separate acceptance.

## Optional tools

Plain-text tasks do not need extra Python packages. Prepare other tools only for tasks that need them:

| Capability | Dependencies and limits |
| --- | --- |
| PDF, DOCX, XLSX, and PPTX text extraction | A dedicated Python environment and the packages below; scanned-document OCR and full layout preservation are not promised. |
| Images, audio, and video | Desktop image helper or FFmpeg / ffprobe; source searches fixed locations such as `/opt/homebrew/bin` and `/usr/local/bin`. |
| Local speech recognition | `whisper-cli` and `.codex/private/media-tools/models/ggml-base.bin`. |
| Local speech synthesis | Currently uses macOS `say` and FFmpeg. |
| Skills, MCP, and plugins | Install and authorize for the specific task; check access and costs. |

From the repository root:

```sh
python3 -m venv .codex/private/media-tools
.codex/private/media-tools/bin/python3 -m pip install pypdf python-docx openpyxl python-pptx
```

On macOS with Homebrew already installed:

```sh
brew install ffmpeg whisper.cpp
ffmpeg -version
ffprobe -version
whisper-cli --help
```

Download speech models separately using the [upstream instructions](https://github.com/ggml-org/whisper.cpp/tree/master/models), verify their source and integrity, and place them at the path above. These optional tools have not been accepted as a complete set. Successful upload does not prove successful parsing.

## Source preview status

The published product code is a fixed snapshot from 2026-11-03. The following previously recorded checks used isolated directories and reused local dependencies; they do not establish a fresh installation or formal release acceptance.

| Check | Recorded result |
| --- | --- |
| `npm run build` | Passed; some frontend chunks still exceed 500 kB. |
| `npm start -- --help` | Passed without a real model call. |
| `npm run typecheck` | Failed with 121 diagnostics involving tests, interfaces, imports, and related references. |
| Selected model-configuration, history-bridge, and service-observer tests | 83/84 passed; `tests/tool-service-observer.test.ts` failed when reading `snapshot` from an undefined object. The cause remains unconfirmed. |
| Mobile offline tests | 19/19 passed. |

The model service still has recorded recharge-binding and recovery-check issues. It is not presented as a fully accepted public paid service. ChatGPT integration eligibility remains to be confirmed.

`npm test` covers Homer's own responsibilities. Full default tests were not run in that snapshot check. Real engines, media tools, browser/native communication, other machines, and official installers require separate validation. See [Tests and mobile development](testing.md) (Chinese) for the explicit suites. This documentation update does not rerun or supersede those product checks.
