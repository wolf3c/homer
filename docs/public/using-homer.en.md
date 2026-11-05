# Using Homer

**English** | [简体中文](using-homer.md)

Start with a clear goal. Homer coordinates assistants, reviews their work, and helps revise the results with your feedback. See the [README](../../README.md) for the product overview.

## Install and start

Desktop installers are being prepared. There are no verified public download links yet. Platform, CPU architecture, and installation steps will be added after the packages have passed download, installation, and startup checks. A source archive is not a desktop installer.

Developers willing to configure their environment can follow the [source setup guide](getting-started.en.md) to build and run the CLI or local Web interface. This remains a development preview, not a validated desktop installation experience.

## Before you start

- **Model connection:** you need an available model service you are authorized to use. Installing the client does not configure a model. Availability and eligibility for Homer's model service and ChatGPT plan integration will follow the actual release information.
- **Costs:** Homer's own code is free and open source; model service costs are separate. Tasks can involve multiple assistants, retries, and revisions. There is no fixed per-task price or verified global spending cap.
- **Materials and permissions:** start with public or fictional materials. Confirm the files, tools, and accounts needed for your task before granting access.

See [Costs and data](data-and-costs.en.md) for details.

## Select a desktop model source

In the desktop account page, choose **ChatGPT 套餐** (ChatGPT plan) or **荷马模型服务** (Homer model service), then complete the browser login. When switching sources, stop ongoing work and select **应用并重启** (Apply and restart); continue in the same conversation after restart. If the source is unavailable, check the displayed status and service eligibility. This account page is specific to the desktop app; CLI and development Web users configure their provider in the source guide.

## Give Homer a task

1. Describe the result you want and any constraints, such as a deadline or output format.
2. Provide the relevant materials and grant access to the files or tools needed for the task.
3. Answer questions in the same conversation. Keep CLI sessions open while work is in progress.
4. Open the delivered results and request changes in the conversation, or annotate them where supported.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No installer | Packages are still being prepared. Developers can use the source guide; avoid installers from unverified sources. |
| Model connection or authentication fails | Check the active configuration, service eligibility, and balance. Source users must check the dedicated Codex Home or key environment variable. Do not copy another application's credentials. |
| An attachment cannot be read | Check the file format and prepare the relevant document or media tools in the source guide. An upload alone does not prove successful parsing. |
| A task is waiting for input | Answer the question in the same session instead of repeatedly submitting the task. |
| Files are missing or incomplete | Name the missing files, observations, and acceptance criteria; ask Homer to complete the delivery. |
| Ending a CLI session | Enter `/quit`. Exiting stops execution; keep the interactive session open when you need to answer questions. |

For unresolved issues, use [GitHub Issues](https://github.com/wolf3c/homer/issues/new?template=bug_report.yml). Include the version or commit, OS and CPU architecture, launch method, fictional reproduction steps, expected and actual behavior, and an error code. The current issue form is in Chinese. Do not attach keys, credentials, customer materials, full logs, or raw conversations. Do not disclose private or security-sensitive information in a public issue.
