# Using Homer

**English** | [简体中文](using-homer.md)

Start with a clear goal. Homer coordinates assistants, reviews their work, and helps revise the results with your feedback. See the [README](../../README.md) for the product overview.

## Install and start

Desktop installers are being prepared. There are no verified public download links yet. Platform, CPU architecture, and installation steps will be added after the packages have passed download, installation, and startup checks. A source archive is not a desktop installer.

Developers willing to configure their environment can follow the [source setup guide](getting-started.en.md) to build and run the CLI or local Web interface. This remains a development preview, not a validated desktop installation experience.

## Before you start

- **Model connection:** you need an available model service you are authorized to use. Installing the client does not configure a model. Availability and eligibility for Homer's model service and ChatGPT plan integration will follow the actual release information.
- **Costs:** the client is planned to be free; model usage is billed separately. Tasks can involve multiple assistants, retries, and revisions. There is no fixed per-task price or verified global spending cap.
- **Materials and permissions:** start with public or fictional materials. Confirm the files, tools, and accounts needed for your task before granting access.

See [Costs and data](data-and-costs.en.md) for details.

## Your first task

Use this planning task without downloading extra materials. Everything in the brief is fictional; paste it into your conversation with Homer:

```text
Organize assistants to prepare a launch plan for an English product page.
Review their work before delivering the results.

Brief: We are a two-person team building a project handoff tool for freelancers.
The only confirmed features are task lists, file attachments, and review comments.
We want to prepare an English product page within two weeks.
The target country, pricing, budget, and individual responsibilities are undecided.
This task is planning only; do not purchase anything or publish externally.

Deliver three Markdown files:
1. requirements.md: known requirements, scope, and acceptance criteria.
2. questions.md: missing information and decisions I need to make.
3. plan.md: a two-week plan using relative days, dependencies, and risks.

Mark missing information as "To confirm". Do not invent market data or feedback.
Ask me first if any question must be answered before proceeding.
When finished, tell me where the files are and summarize each one.
```

This is a sample request for getting started, not a completed real-model acceptance case. It carries no fixed time or cost promise.

## Answer questions, inspect results, and revise

Answer important questions in the same conversation. CLI users should keep the interactive session open so they can respond.

Open the actual delivered files and check:

- All three files exist, open correctly, and contain content.
- Requirements reflect the brief and unknowns are marked for confirmation.
- The plan identifies dependencies, sequence, and decisions you need to make.
- Claims, market data, or customer feedback have not been invented.

Then request a specific revision in the same conversation:

```text
Start with English-speaking users only. Assign copywriting to one person and
page production to the other. Finish the draft in week one, then review and
revise in week two. Keep the remaining unknowns marked for confirmation.
Check all three files for consistency and deliver the revised files.
```

Use annotations where the preview supports them, or name the file, section, and desired change in the conversation. Accept the delivered files based on their content. Review the final content and permissions before using it externally.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No installer | Packages are still being prepared. Developers can use the source guide; avoid installers from unverified sources. |
| Model connection or authentication fails | Check the active configuration, service eligibility, and balance. Source users must check the dedicated Codex Home or key environment variable. Do not copy another application's credentials. |
| An attachment cannot be read | Try the plain-text example first, then prepare the optional document or media tools in the source guide. An upload alone does not prove successful parsing. |
| A task is waiting for input | Answer the question in the same session instead of repeatedly submitting the task. |
| Files are missing or incomplete | Name the missing files, observations, and acceptance criteria; ask Homer to complete the delivery. |
| Ending a CLI session | Enter `/quit`. Exiting stops execution; keep the interactive session open when you need to answer questions. |

For unresolved issues, use [GitHub Issues](https://github.com/wolf3c/homer/issues/new?template=bug_report.yml). Include the version or commit, OS and CPU architecture, launch method, fictional reproduction steps, expected and actual behavior, and an error code. The current issue form is in Chinese. Do not attach keys, credentials, customer materials, full logs, or raw conversations. Do not disclose private or security-sensitive information in a public issue.
