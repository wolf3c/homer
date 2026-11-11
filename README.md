<img src="assets/branding/odysseus-20261030/homer-odysseus-256.png" alt="Homer logo" width="80" />

# Homer

**English** | [简体中文](README.zh-CN.md)

![Artwork from the Homer homepage concept](assets/readme/home-hero.png)

Homer is an open-source AI work assistant. Talk to Homer and assign tasks whenever you like; it coordinates a team of AI assistants and reviews their work to keep your goals moving forward.

- **One conversation for all your work**: Instead of switching between agent sessions and managing their relationships, talk to Homer and let it coordinate the work.
- **Share ideas as they come**: Tell Homer what you want to do next while earlier work is still underway. It records and coordinates follow-up work without interrupting the current task or requiring a new session.
- **Coordination and review built in**: Homer handles assistants' questions, reviews their work, and sends it back for revision when needed. It asks you when it needs information or a decision.
- **Keep working away from your computer**: Pair your phone with the desktop app to check progress, add ideas, answer questions, and receive results. You can also connect a Telegram bot, personal WeChat, or a DingTalk bot to send tasks and follow-up questions in private chat, and subscribe there to task updates and attachments.

## How Homer works

![Animated illustration of Homer coordinating tasks, assistants, review, and delivery](assets/readme/homer-workflow.gif)

## Install and start

### Download Homer

Desktop release v0.1.7 (build 292) is available. Choose the installer for your computer:

- [macOS · Apple silicon](https://github.com/wolf3c/homer/releases/download/v0.1.7/Homer-mac-arm64.zip), requiring macOS 27 or later.
- [macOS · Intel](https://github.com/wolf3c/homer/releases/download/v0.1.7/Homer-mac-x64.zip), requiring macOS 14 or later.
- [Windows · x64](https://github.com/wolf3c/homer/releases/download/v0.1.7/Homer-windows-x64.exe), requiring Windows 11.

The Mac packages are signed and notarized. Unzip the download and move Homer to Applications. The Windows installer is unsigned and requires manual installation, with automatic updates disabled. A Linux desktop installer is not yet available.

Installation and runtime validation on Intel Macs and Windows x64 remains pending. See the [v0.1.7 Release](https://github.com/wolf3c/homer/releases/tag/v0.1.7) for release notes and checksums.

### Get started

1. Open Homer and follow the prompts to connect an available model service.
2. Tell Homer what you want to do and provide the relevant materials.
3. Add ideas, check progress, and receive results as work continues.

Model service eligibility, quotas, and fees depend on the release and service terms. See the [user guide](docs/public/using-homer.en.md).

### Continue on your phone

After installing the mobile app, pair it by scanning the code under Settings → Mobile Devices in the desktop app. The mobile app requires an available desktop host.

- Android: download link to be added
- iPhone / iPad: download link to come

Developers can also [build and run from source](docs/public/getting-started.en.md). This is a development preview with [known limitations](docs/public/getting-started.en.md#source-preview-status).

## Models and costs

Homer's own code is free and open source. The desktop code supports two model sources:

- **[Homer Membership Service](https://super-tree.com/homer#homer-pricing-title)**: Planned model credit purchases as needed, with charges based on actual usage.
- **Your ChatGPT plan**: Connect through Codex, subject to your plan's eligibility and usage limits.

Model usage may incur charges. Assistant collaboration, review, and revisions within a task all consume usage. Availability, eligibility, purchase flows, and billing rules for both options need to be confirmed before release. See [Costs and data](docs/public/data-and-costs.en.md).

## Links and license

- [Website](https://super-tree.com/homer)
- [User guide](docs/public/using-homer.en.md) · [Source setup](docs/public/getting-started.en.md)
- [Report a problem](https://github.com/wolf3c/homer/issues): exclude credentials and private materials.

Homer's own code uses [Apache-2.0](LICENSE). [Third-party licenses](THIRD_PARTY_NOTICES.md) apply separately; additional permission for Agentation has not been confirmed in the repository.
