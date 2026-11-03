# Free software, optional services

**English** | [简体中文](data-and-costs.md)

Homer plans to offer the client for free, with model usage billed separately. The [repository](https://github.com/wolf3c/homer) contains a development preview. Official installers and public service pricing have not been released.

## Choose your model service

| Option | Costs and status |
| --- | --- |
| Homer model service | An optional pay-as-you-go service. Pricing, trials, payments, and refunds will follow the actual release terms. The membership label does not mean a subscription plan has launched. |
| Your ChatGPT plan | Planned integration through Codex. The integration method, eligibility, and availability remain to be confirmed. |

Tasks can involve multiple assistants, retries, and revisions. Cost depends on the model and usage. There is no fixed task price or verified global spending cap. Pay-as-you-go does not mean the service is resold at the provider's procurement cost. Credit amounts displayed in the homepage concept are illustrative, not a current sales offer.

## Where your materials go

Conversation history, runtime data, and delivered files are saved in the configured local directories. Tasks may send conversations, read materials, and tool results to the chosen model or tool service. Requests through Homer's model service also pass through that service. Remote retention follows the relevant service's policies.

Local execution can still make network requests. Obtain permission before using customer materials. Start with public or fictional examples. Before enabling Skills, MCP servers, or plugins, check file, account, and network access and any fees.

## Local data and removal

Source defaults use `~/Library/Application Support/Homer` on macOS and `~/.local/share/Homer` elsewhere. The desktop entry defaults to `~/Library/Application Support/Homer Desktop`. Actual locations depend on configuration and existing data-directory choices; workspace, runtime, and Codex Home can be set separately. Authentication may be stored in local files; it is not guaranteed to be fully encrypted by the system keychain.

Uninstalling does not necessarily remove history, credentials, or results. Quit normally and confirm directories and backups before cleaning up. Remote data follows each service's rules. See the [source guide](getting-started.en.md#local-web-and-desktop) for desktop authentication and development access boundaries.

## Feedback and licenses

Use [GitHub Issues](https://github.com/wolf3c/homer/issues) for questions or bug reports. Include the version, OS, fictional reproduction steps, and error code. Do not upload credentials, raw conversations, customer materials, databases, or full logs. Public issues are not a private reporting channel.

Homer's own code uses [Apache-2.0](../../LICENSE). [Third-party components](../../THIRD_PARTY_NOTICES.md) retain their own licenses. The additional Agentation permission inquiry remains unanswered; its original license and modification notes are preserved. Publishing source does not mean all third-party commercial-use conditions or distribution obligations have been cleared.
