# Chat UI enhancements

> Historical plan and initial dispatch record. Later integration and acceptance outcomes are historical; current UI behavior is maintained in [UI design](../ui/DESIGN.md).

Status: blocked for further seven-item Worker dispatch: host returned
`task_budget_exhausted`. No further child was created. No deployment claim.
The separately authorized Lexical attempt was already running; wait for its
actual result without creating replacement roots or resetting consumed budget.

## Scope and baseline

User authorized seven additions: attachment input, attachment display, Tool UI,
artifact cards, sources, message actions, and LaTeX. A later user turn explicitly
approved assistant-ui + LexicalComposerInput. Preserve the existing Pele work.

Main reviewed current ui/homer-app.tsx, src/web-contract.ts and src/web-homer.ts.
Existing upload identity, draft persistence, queue editing, authenticated media
read and published-artifact download must remain authoritative.
The planning Worker timed out; its result is invalid and is not accepted.
Its suggestions are inputs only, checked against actual files before adoption.

## Implementation boundaries

1. Lexical worker owns ui/homer-composer-input.tsx, its CSS, ui/package.json and
   package-lock.json until its attempt ends. Integrator later connects uploadFiles,
   screenshot paste, drop, thumbnails, IME submission and restored draft text.
2. Presentation workers own distinct new files only. Resource cards consume actual
   WebWork/MediaView; sources consume explicit source records; tool cards consume
   actual activity records. No fake progress or invented citations.
3. Backend changes follow a focused inspection of event projection and message
   operations. Queue edits are not historical edits. Regeneration must preserve
   request identity and attachment authorization. Feedback needs persistent local
   storage. Missing upstream data must be reported, not fabricated.
4. One integrator owns homer-app.tsx and shared CSS. Dependency changes wait for
   the Lexical owner. LaTeX uses locally packaged math rendering and must retain
   code highlighting, quotes and Pele.

## Acceptance

- Paste screenshot and drop files into a draft; preview/remove/retry; preserve
  text, quote, request identity and upload limits, including pure-image messages.
- Existing authorized media previews/downloads and published artifacts work;
  unpublished artifacts remain inaccessible. No arbitrary HTML execution.
- Tools and sources are bound to real message/activity/source data and survive
  the supported reconnect/persistence path. Empty data renders no invented UI.
- Copy and speech report failures; edit/regenerate/feedback have honest backend
  semantics, no inert controls. Chinese IME Enter does not accidentally submit.
- Inline/block LaTeX, malformed/streaming input, ordinary Markdown and Pele work.
- Run relevant typecheck/build and targeted tests, then isolated browser checks.
  Record unverified cases and distinguish source changes from online activation.

Do not read runtime credentials/databases, change accounts/channels, restart the
live service, send external messages or create a Git repository. Use bounded
Worker batches and submit formal results before the host timeout.
