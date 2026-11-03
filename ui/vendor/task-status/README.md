# Official task status components

## Current compact status rows (2026-10-23)

The accepted inline Background Inbox Demo is implemented in `ui/task-status.tsx` as one private `TaskStatusRow`, using installed Base UI Collapsible 1.8.0. It adapts the row layout of [BackgroundInbox](https://github.com/assistant-ui/assistant-ui/blob/208cc81de222d85b8c3877445187828cff09feeb/packages/ui/src/components/react/assistant-ui/elements/background-inbox.tsx) (MIT) rather than claiming an unchanged official component. No full BackgroundInbox copy, new domain model, runtime or dependency is added.

Existing pinned `TaskStateIcon`, AgentPlan and TodoList implementations remain unchanged. Current compact rows use the host's `SemanticTaskIcon` for their business state; the host composes the row trigger, second-line business status, disclosure arrow, full title/status and indented body. Rows remain expandable while running and support all existing product states. The original business tree/counts/identity/read owners and Popover remain authoritative; the Demo three-state model, timestamps and header counts are not imported.

`TaskCard` is still consumed by `WorkerEventCard` and task-source cards in `ui/process-nodes.tsx`. Its only additional local inputs are optional `statusIcon` and `statusLabel`: the host supplies the factual event icon and accessible status text without changing the official disclosure, state, layout, or default icon/label. The upstream controlled `open`/`onOpenChange` contract is unchanged. `task-status-css.vendor.test.mjs` reverses precisely these semantic-input edits and local imports before checking the original `SOURCE-SHA256.json`; `task-status-css.test.mjs` renders both custom and default states through the real disclosure. The original hashes are not replacement hashes for adapted source.

The host stylesheet owns compact row geometry, focus outlines and natural-height indented content; current target sizing follows the official-size restoration in `ui/DESIGN.md`. The existing compiler scans the actual host utility strings and keeps the existing scoped Neutral theme. The original MIT notices and upstream source-hash checks remain in place. See `docs/2026-10-23-unified-taskcard-product.md` for the original compact-row adoption and product verification.

## Earlier full TaskCard adoption (historical)

TaskCard, AgentPlan, TodoList and supporting files from assistant-ui commit `cebe9ddefa8cccee674bcb40c06f485d5bbfe7b8`, MIT. Original source hashes in SOURCE-SHA256.json. Imports use local utils/support paths; TaskCard's later semantic-input adaptation is documented above. Official markup, default state icons, typography, spacing and disclosure behavior are unchanged.

Popover is from the shadcn new-york registry snapshot used in the approved Demo. Card was part of the 2026-10-22 adoption and is removed from runtime in the unified 2026-10-23 TaskCard implementation; card-registry.json remains historical provenance: https://ui.shadcn.com/r/styles/new-york/card.json and https://ui.shadcn.com/r/styles/new-york/popover.json . MIT notices preserved.

source.css mechanically maps the official Neutral theme snapshot. scripts/build-task-status-css.mjs compiles Tailwind 4.1.14 and scopes every rule to .homer-task-status, removes layer precedence and prefixes keyframe names. The existing fixed-light Homer header keeps the light palette; the floating component follows the official dark palette on dark OS preference. No global preflight or theme. Component adaptations are limited to the imports and semantic inputs described above. The original adoption added a host 44px minimum target; the later official-size restoration is documented in `ui/DESIGN.md`. components.css is generated, reproducible and committed with its source; animation checks require the actual working spinner and reduced-motion rule, not an obsolete count of emitted utilities.

Homer owns exact task/version/run/epoch/segment data, state semantics, counting, loading, public progress and approved exterior layout. No assistant runtime/provider or TaskTray completion semantics.
