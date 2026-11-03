# Pinned assistant-ui Run Activity

## Compact host header composition (2026-10-25)

The existing conversation header now sits inside the original resizable conversation Panel, alongside the preview toolbar at the same top boundary. Host CSS sets both rows to 44px on desktop and 52px at ≤800px or coarse pointer. This supersedes earlier consumer geometry statements: annotation controls remain 28px with 14px icons on desktop, and use 44px touch targets on mobile/coarse pointer. Local color-only transitions avoid interpolating touch dimensions during a breakpoint change. No vendor export, generated stylesheet, dependency or license changes.

The preceding duplicate-header-removal task owns the stable reader action Portal, fallback title and modal collapse. This change reuses them without modifying CanvasReader, image/HTML state, the single Dialog, manual Tabs behavior or TaskStatus's workspace observer/Portal. Tabbed desktop collapse remains the existing global preview toggle; no second desktop collapse action is added. Current composition, actual-product measurements and source-only release boundary: `docs/2026-10-25-compact-header.md`.

## Preview rail actions / duplicate header removal (2026-10-25)

The approved consumer composition stops rendering CanvasSplitHeader for file previews. Its pinned source, CanvasSplitDocument/Body, WebPreview and generated CSS remain unchanged. Base UI Tabs retains the file title and full accessible name. The existing reader projects its HTML/image actions through React Portal into a stable sibling of Tabs.List; original TooltipIconButton geometry, native annotation state and draft owner are retained. There is no second toolbar controller or native engine instance.

Tabbed desktop previews use the existing global collapse toggle. Narrow modal previews retain a PanelRight collapse action inside the same rail because the global toggle is in the inaccessible background. Controlled no-tab/empty previews retain a minimal labeled fallback with collapse. Initial focus targets the active Tab or fallback collapse; final focus keeps the existing source/global fallback. This supersedes earlier descriptions requiring the consumed file header, without changing the preserved vendor export. Verification: `docs/2026-10-25-preview-header-row-removal.md`; source-only, not installed.

## Homer reference / annotation icon composition (2026-10-25)

The user selected installed `lucide-react@0.468.0`'s `MessageCirclePlus` for Homer-owned quotation and annotation affordances. Homer composes SelectionToolbar.Root / Quote with custom children and QuoteBlock / ComposerQuotePreview Root / Text with a custom icon carrying the original icon slot and utility classes. The ordinary single-quote renderer uses the same Root / Text composition as other quotes, preserving the default two-line text. All primitive handlers, canQuote capture, selection clearing, composer focus and dismiss remain with their existing owners. `quote.tsx`, its exports and generated CSS remain unchanged; this icon is a consumer choice, not the upstream default.

The already adapted `message-actions.tsx` changes only its quotation icon from QuoteIcon to MessageCirclePlus. Homer-owned file selection and HTML/image preview actions use the same icon with their existing geometry, labels, pressed/busy and cancellation semantics. Active annotation is indicated by the existing state styling, without an alternate icon. Agentation's native toolbar/popup, marker numbering, chips and unrelated copy/chat/file icons remain unchanged. No new configuration prop, dependency, native vendor patch or data contract is introduced; source-only, not installed.

## File preview tabs (2026-10-25)

The approved file navigation uses the already installed `@base-ui/react@1.8.0` Tabs Root/List/Tab/Panel, MIT, from its existing package and license notices. These are Base UI primitives, not assistant-ui Canvas exports. No dependency, registry pin, generated component source or license is changed. Tabs owns ARIA associations and roving/manual keyboard activation; Homer adds only artifact-ID ordering, individual sibling close buttons and a native horizontal scroll rail.

One stable Base UI Dialog/Portal contains lightweight Panels. Explicit active children, rather than Panel transition timing, determine the lifetime of the sole private CanvasReader in `ui/canvas-panel.tsx`. Existing CanvasSplitDocument/Header/Body, HTML isolation, authorized file reading and original annotation engines remain the content owners. The source-only change supersedes the old single-target selector exclusion below; it does not reintroduce original-reply/Finder/HTML-source actions or arbitrary URL tabs.

The concurrently approved annotation synchronization supersedes older session-map/unified-import descriptions: saved notes project from the original annotationDraft, saving creates a composer chip and navigation cancels only temporary edits. The existing HTML revision/epoch/changeId ACK remains the sole save acknowledgment; this change adds no queue or second protocol. See `docs/2026-10-25-preview-tabs.md` for isolated product verification and release boundaries.


## HTML render-first boundary (2026-10-24)

The read-only CanvasSplitHeader has one optional `actions?: ReactNode` slot before its original close button. Document/Body implementations and official header geometry remain unchanged. HTML supplies the existing TooltipIconButton for a short Chinese annotation action, scoped through its existing attachment style surface. The 2026-10-25 approved removal eliminates the source/return controls and HTML source-mode state. Canvas-local CSS shares the image action's auto width, 28px height and nonshrinking 14px icon, overriding the attachment utilities without changing their defaults. HTML and image tooltips use their current Dialog action container. There is no generic toolbar framework or DOM insertion/hidden launcher click.

Agentation is the separately licensed PolyForm Shield 1.0.0 dependency, not an assistant-ui/MIT component. The approved 3.1.2 patch is retained in `../agentation-3.1.2/`, with original source/license, input hashes, exact diff, declaration mirror and MODIFIED-SOURCE.md. Normal build verifies the installed package and exact local outputs before bundling. Its original toolbar, popup, Add/Cancel, Send and sole active-state owner remain intact. The local extension initializes selection on explicit activation and reports true native activity; omitted props preserve upstream defaults. This is not an upstream API and does not establish a public-distribution exemption or commercial license.

HTML is static and opaque by default. Only a current artifact/hash/title action loads the isolated runtime; native exit/shortcut, loading cancellation, parent toggle and close revoke it. Original source validation, composer reference/queue/intent owners remain. Saved webpage notes use the current thread’s exact-artifact session map. HTML source selection has no remaining UI consumer; text/code/Markdown still use the existing text-note owner, and historical references are retained. Narrow HTML is enabled; this task leaves external web-source and PDF contracts unchanged. The parallel image owner documents its own contract separately. See `docs/2026-10-25-annotation-header-source-removal.md` for current checks and scope, and `docs/2026-10-24-html-render-first-integration.md` for the earlier integration. No app installation is implied.

## Canvas selection action boundary (2026-10-24)

`ui/preview-selection-toolbar.tsx` reuses the pinned Quote toolbar/action utility strings and generated `quote.css` data slots for its compact **批注** action. It is not the official message SelectionToolbar runtime: installed `@assistant-ui/react@0.15.29` Root requires `getSelectionMessageId` and Quote writes a message quote. Canvas must retain artifact ID/hash and canonical TeX through the existing resource-reference owner. No synthetic message, thread or second runtime is created, and the existing message SelectionToolbar is unchanged.

The already installed Mantine `useTextSelection` runs only in this leaf. Base UI 1.8.0 `Popover.Root/Portal/Positioner/Popup` owns dismissal, focus policy, Range virtual-anchor positioning, scroll tracking and collision handling; its portal stays inside the Canvas Dialog. Local wiring validates the current text body, snapshots the native Range, preserves selection on mouse down, calls the shared preview normalizer at activation, saves file notes and invokes the original onReference only on unified import. The original Composer still owns input draft/focus. Since Base UI 1.8.0 Dialog and Popover use separate dismissal trees, the Dialog cancels its own Escape close and allows propagation while the selection popup exists. No new dependency, generated stylesheet, positioning engine or touch listener is added.

Primary references: https://www.assistant-ui.com/elements/quote and https://base-ui.com/react/components/popover (virtual `anchor`, `collisionAvoidance`, `initialFocus`/`finalFocus`). Actual behavior is checked against the installed sources and isolated production UI; Chrome touch emulation does not establish native iOS/WKWebView selection behavior.

## Existing official control geometry (2026-10-24)

The approved restoration supersedes historical 44px overrides and filename wrapping below for the existing Attachment, ApprovalCard, MessageActions, Quote, Sources, Image/File and TaskCard consumers. CodeHeader uses the existing local TooltipIconButton, 50% border/muted mapping and a 24px copy control; its clipboard lifecycle/error owner remains. FileName retains upstream truncate and full title. Generated CSS uses the existing compiler. This increment does not introduce the separate Canvas/annotation, question or queue implementations.


## Compact official restoration (2026-10-24)

The approved restoration supersedes historical 44px, wrapping filenames, duplicate source preview and queue edit/sort adaptations below. Component source utilities own control geometry again; handwritten CodeHeader mapping restores border/muted at 50%, 24px copy and the existing 12px root radius. It reuses the existing TooltipIconButton/Tooltip implementation, while retaining the stream-scoped clipboard Promise/error owner. No registry global theme or dependency is added.

Canvas/WebPreview, Approval, QuestionFlow/Elicitation, Sources, Quote dismiss, File download, Image close, Attachment close and historical TaskCard remove their extra minimum sizes. Attachment retains its official 56px tile and 20px remove surface, restoring the official -6px ::after inset (32px effective target) from the host -12px inset (44px target), and removing associated host padding. TaskStatusRow loses the independent minimum while its parallel aside/Popover owner remains. Native focus/accessible names, disabled states, exact approval/question payloads and host input controls remain. FileName consumers retain title and truncate. Sources keeps only official links plus the existing factual verification note; general Canvas readers are retained. CSS is regenerated from the existing source compiler, without a global reset.

## Official Canvas document structure / WebPreview (2026-10-23)

Source: [Canvas](https://www.assistant-ui.com/elements/canvas-split) and [WebPreview](https://www.assistant-ui.com/elements/web-preview); pinned `assistant-ui/assistant-ui@1f41f91643fdb56e5d8dbd14db65f742740738a1`, MIT, existing LICENSE retained. These registry source components are not claimed npm Canvas exports or a complete file/sandbox engine.

| Upstream under packages/ui/src/components/react/assistant-ui/elements/ | Git blob | Original SHA-256 |
| --- | --- | --- |
| canvas-split.tsx | c5c112c1b778f11ba00eb1286cac8aa1f28de9a9 | 219b3cd94b2c54d0f89f984156fa0e76081808295f883a8e487cf6f5ba90ad6c |
| web-preview.tsx | 8d6747cd19e6f980f6b19e1775ff9b610ee2d03d | aa8e24257fe85d232b578799ef175adc563ebd12a2d2851fc3acd6fe5cc9cad9 |

`canvas-split.tsx` retains the consumed Document, Header and Body. Document/Body implementations are byte-identical extracts; Header keeps the upstream title/file icon, border, geometry and close button, removing version/saved/copy fields unsupported by read-only file facts. Add Chinese close label, full title attribute, and closeButtonProps for the host dialog owner's ID/ref. Unconsumed thread/demo text-line components are not copied. This is explicitly partial reuse, not the complete CanvasSplit family.

`web-preview.tsx` is the complete upstream component; changes only local cn/surfaces/ShimmerLabel imports, scoped stylesheet and Chinese labels. Reuse the existing official ShimmerLabel rather than duplicating it. Host passes the already validated URL and existing sandboxed iframe, reloads that iframe through its ref, and opens external with noopener/noreferrer. `loading={false}` deliberately means no loading cover; no cross-origin success is inferred. No second page-state owner, theme or dependencies.

`node scripts/build-run-activity-css.mjs --canvas-split` compiles actual utility strings and scopes them to Canvas document/WebPreview roots; `--check` checks reproducibility. Host additions cover focus, document containment, overscroll and available preview width. Long titles retain the upstream single-line ellipsis and full title attribute. The host Base UI dialog and resizable layout own desktop/mobile mode and focus; existing Markdown/image/PDF/HTML renderers, authorization, abort/URL cleanup and isolation remain. File selection stays in the conversation; custom Canvas selectors, original-reply/Finder controls and ordinary-file external actions are removed by the 2026-10-24 restoration. The custom header DOM/CSS and old outer content flex/spacing/scroll ownership are removed. Installed MarkdownTextPrimitive requires message-part context, so files do not create a shadow runtime just to reuse it.

Validation includes exact upstream extract/full-component hashes, actual 320/390/1440 product fixtures, existing old-reply/late-response/resource-lifecycle regression, and static/explicit interactive HTML with original CSP and opaque-origin separation. See `docs/2026-10-23-official-canvas-boundary.md`. No deployed version is asserted.

## Official standalone ApprovalCard (2026-10-23)

`approval-card.tsx` adopts the complete standalone component from [assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui/tree/1b5860dab94a221d1e0d31aad10c3e99593a0d0c/packages/ui/src/components/react/assistant-ui/elements), pinned to `1b5860dab94a221d1e0d31aad10c3e99593a0d0c`, MIT. These are copied sources, not exports claimed to exist in the installed npm package. Existing assistant-ui/core/react and all dependency versions remain unchanged.

| Upstream input | Git blob | Original SHA-256 |
| --- | --- | --- |
| `approval-card.tsx` | `f129b74f5b781f2f7da2ad01cb2ba3725603e2a2` | `a6b9797c48a965d629af628b8e8a9a4102ce9c6d7b2ca2f9ead75676223dcdef` |
| `receipt-focus.ts` | `083ada5e0312324d3362cd4c220a790087f87701` | `0be780a30c042bbb41b6c0621d76ef8506ebe92011ebf36cd5d9e77fb7fd6ec0` |
| `surfaces.tsx` | `2e88172482c5b870b7b74fec3008388f77da66aa` | `5d81fbb669e67ae20026cd30ed57efc51a5e3ee0f4f5d265e1723de75359b8fa` |
| repository `LICENSE` | `ce2aca011368ed3c3af6ffd8e1d333b5bef08589` | `eafb05991a572efa34097474b31fef45b14a8879ed1d1a8fd77de62e6fa7d275` |

Original LICENSE is byte-identical to the existing retained MIT LICENSE. Reuse the installed React/Lucide, existing `cn`, Tailwind compiler and licensed `tw-animate.css`. Append only the five consumed surface constants (`paper`, `field`, `ghostButton`, `inkButton`, `mono`) to the existing surfaces extract, retaining `collapsePanel` unchanged. Receipt focus retains upstream logic; its isomorphic layout-effect import resolves directly to React's layout effect in this client-only SPA. No new dependency, runtime, permission, wrapper or state owner.

Deliberate adaptations to the component: local imports and scoped CSS import; `subtitle` accepts ReactNode for the existing exact-source link; optional `disabled` reaches all official action buttons; `statusLabel` also renders a neutral request-state status span. Official root/group, header, command field, optional details, action order, icons, utility strings, four states and receipt behavior are preserved. `approval-card-upstream.test.mjs` reverses precisely those changes and checks the original file hash.

Homer uses `state="request"` throughout the live approval lifecycle. The original InteractionCard owner supplies verification, pending/accepted identity, same-payload retry, expiry and disconnect behavior. Submitted/accepted decisions never select upstream running/done/denied, because a receipt does not establish execution. `onAlwaysAllow` is never supplied; only Allow once and Deny render, with Chinese labels and their original exact payloads. The full original question (including command, cwd and reason) is passed as inert command text without parsing or summarization; existing scope explanation and source link remain readable.

`node scripts/build-run-activity-css.mjs --approval-card` compiles actual official class strings and scopes them to `[data-slot="approval-card"]`; `--approval-card --check` checks reproducibility. Host rules only cover full-text whitespace, narrow-screen containment, existing interaction-list separation, paragraph reset, focus. Already-scoped host selectors are not scoped twice. No global reset or theme initialization. Product build/dev regenerate this CSS. The replaced main-native form/buttons and `.native-approval-actions` styles are removed; other authorization/question forms keep their existing presentation and controller.

Implementation, isolated browser evidence, remaining repository check failures and rollback boundaries: `docs/2026-10-23-official-approval-card.md`. This is a source candidate, not evidence of deployment.

## Official Image / File compound parts (2026-10-23)

Official documentation inspected 2026-10-23: [Image](https://www.assistant-ui.com/elements/image), [File](https://www.assistant-ui.com/elements/file).
Source under `packages/ui/src/components/react/assistant-ui/elements/`, same fixed commit `1f41f91643fdb56e5d8dbd14db65f742740738a1`, MIT; existing LICENSE retained:

| Source | Git blob | Consumed exports |
| --- | --- | --- |
| image.tsx | d00be8f9d3996efb413b52884d61c10b764e1022 | ImageRoot, ImagePreview, ImageZoom |
| file.tsx | 7b14dc57309f3d03dd43c29e91ae325826d58c2d | FileRoot, FileIconDisplay, FileName, FileSize, FileDownload |

These are adapted extracts of the official public compound parts, not complete message-part renderers or newly installed package exports. Preview, error/loading states, zoom DOM/focus trap/scroll lock, MIME icon selection, size formatting and download link helpers retain upstream implementation and utility strings. Changes: local imports, Chinese labels, a close-button scope marker, and fixed Root defaults. Root uses the exact upstream default utility combination (outline/default) directly; unused cva variants, image generation/copy/regenerate/source UI and media-player dependency chain are not copied. No new dependency, runtime or part protocol.

`image-file.source.css` scans the actual consumed source and FileList utility strings. `node scripts/build-run-activity-css.mjs --image-file` compiles/scopes rules only to image roots/zoom overlays/file roots/file lists; `--image-file --check` verifies reproducibility. Theme roles use existing Homer variables. Host additions cover focus, containment, selected result and reduced motion. No global reset.

Homer passes authorized object URLs to Image; LazyMedia retains its transport, visibility/request budget, abort and URL lifecycle. A revision-keyed mount closes/revokes old previews. File.Download receives an absolute same-origin link, while its click still uses the existing connectionFetch download/error owner; no direct link navigation bypasses that owner. Nullable MIME is generic presentation only, never inferred executable content. Existing audio/video playback and silk limitations stay with their owner.

FileList retains only its necessary collection order, exact ID, selection/focus and Canvas callback. Its custom SVG and stylesheet are removed; filename-derived MIME selects a presentation icon only. Canvas renders already authorized image bytes through ImagePreview, keeping its existing reader, HTML isolation, old-reply authorization and origin navigation. Inline Markdown image safety remains unchanged. Rendering results/document rows never reads bodies; unavailable media does not gain a download.

## Official Attachment appearance (2026-10-23)

Source: [Attachment](https://www.assistant-ui.com/elements/attachment), inspected 2026-10-23; all copied source below is pinned to commit `1f41f91643fdb56e5d8dbd14db65f742740738a1` in assistant-ui/assistant-ui, MIT (existing LICENSE retained).

| Upstream path under packages/ui/src/ | Git blob | Retained |
| --- | --- | --- |
| components/react/assistant-ui/elements/attachment.aui.tsx | cd06d2b578bebb902186893feb3b539b69dcc54c | Live tile, Avatar, status overlays, remove, image preview |
| components/react/ui/base/avatar.tsx | 3ce91b0554dfbbc6afc7c23403981cf43cbfa29f | Avatar/Image/Fallback only |
| components/react/ui/base/tooltip.tsx | df96e24919caa9cc30e05d211519db55ae0bfa0d | Official tooltip composition/styles |
| components/react/ui/base/dialog.tsx | 9da85dfd3f3f7101c15771371bb11c9011b5bb97 | Used root/trigger/portal/overlay/content/title only |
| components/react/assistant-ui/elements/tooltip-icon-button.tsx | 81eeeb868d43b81413c7693c0ed86966dc97eded | Tooltip composition, native ghost icon button |

Preserve upstream 56px tile geometry, utility classes, 20px remove surface, lucide icons, loading/error overlays, transitions, preview and tooltip interactions. Adapt local imports, Chinese labels and scoped portal roots. Keep only consumed exports: the existing batch picker and authorized historical media path remain their owners. The two used button surfaces are native buttons with the consumed upstream styles; unused cva variants and a new button dependency are omitted. These files are deliberately adapted, not byte-identical upstream copies.

One necessary touch adaptation: the official tooltip is controlled through its own public open/onOpenChange props, and a touch release on a tile without an image preview opens it. Clicking that non-preview tile does not immediately dismiss it. Ordinary focus/hover, outside dismissal and image-dialog behavior stay with Base UI. No second tooltip, custom popup or attachment state is added.

`attachment.source.css` compiles the actual component class strings and the existing licensed tw-animate source with `node scripts/build-run-activity-css.mjs --attachment`; `--attachment --check` verifies reproducibility. Scope covers only attachment roots/list/portals, with existing Homer theme variables. Current host additions: focus and long-name containment. The official 20px remove button keeps its original -6px pseudo-element region; the extra -12px region, dialog-close minimum and list padding are removed. Reuses exact @base-ui/react@1.8.0 already installed in the shared workspace. The commit declares/locks this prerequisite and includes its license in build notices so clean installs are reproducible; this review installs or upgrades nothing. No new runtime, global reset or theme.

`homer-attachments.tsx` now supplies only the existing local image URL, status/size description and awaited remove callback. The upstream `use-attachment-src.ts` was inspected (blob `82b64ec34cfae7c29ae667671eb3b42454c4ff56`); its File-reference dependency is deliberately not copied, because this runtime can decorate File references and restored files have no bytes. The existing ID-keyed URL lifecycle remains. Installed Remove drops its Promise, so the caller prevents its default action and awaits removal with existing error handling. Runtime collection, adapter, original request/upload identity, discard failure retention, send-clear markers and authorization remain unchanged.

Replaced custom wide cards, expanded filenames, per-card styling and mobile card variants are removed. Full names/size/state are available in official focus/hover/touch tooltips and accessible names. Product code contains no test observer. Validation uses isolated synthetic HTTP/Chrome fixtures, including local image previews, failure retention, stable retries, refresh, send cleanup and URL release; it does not establish a deployed version.

## Official Quote (2026-10-23)

`quote.tsx` is the complete upstream `packages/ui/src/components/react/assistant-ui/elements/quote.aui.tsx` at `1f41f91643fdb56e5d8dbd14db65f742740738a1`, Git blob `08f953566d8fc5d978eff8376f8416ae310fb0fa`, MIT (existing LICENSE retained). Changes are limited to the existing local cn import, the stylesheet import, and Chinese Quote/Dismiss labels. All official exports, DOM, utility classes, memoized components and primitive bindings remain intact.

`quote.source.css` compiles those actual utility strings with the existing Tailwind compiler (`node scripts/build-run-activity-css.mjs --quote`). Rules are scoped to quote-block/composer-quote/selection-toolbar roots; theme roles map to existing Homer variables. SelectionToolbar keeps the upstream 28px button, 4px toolbar padding, 1px border and 14px type. Its local radius mapping follows the same pinned registry's `apps/registry/app/globals.css` (.625rem root, minus 2px button); border-border maps to Homer's existing line color. The global host focus decoration is reverted only on this action, retaining the native keyboard focus ring. Position and z-index remain owned by the official primitive. ComposerQuotePreview retains its official compact dismiss size and host focus adaptation; QuoteBlock is unchanged. The original RunActivity build is unchanged by default; use `--quote --check` to check Quote reproducibility. No new dependency or runtime is installed.

Homer's ordinary quote now remains in the existing runtime composer state. The custom expansion state, transient handoff, preview markup and corresponding CSS are removed. Existing draft persistence restores that state; retired queue editing keeps exact legacy references in its read-only saved session. The official compound preview adds only the existing focus handler to Dismiss. Historical multi-quotes/annotations retain full text through the public QuoteBlock.Text className override; normal quotes use the official two-line form. Source checks, original unknown receipts and attachment ownership remain unchanged.

The installed SelectionToolbar Quote primitive writes the quote and clears the DOM selection; it does not request focus. The installed Lexical FocusPlugin listens only to autofocus/runStart. Homer handles the Quote click's bubble on SelectionToolbar.Root, after the official primitive, and invokes the same thread-local focus callback as message-level Quote and preview Dismiss. HomerFocusPlugin registers the mounted editor's native `editor.focus()` with `SKIP_SCROLL_INTO_VIEW_TAG` and a discrete update, preserving text/caret and preventing caret scrolling. No global DOM query, quote-change observer, second quote state or deferred focus is used. Disabled editors do not focus; unmount removes the callback. Evidence and limitations: `docs/2026-10-23-quote-official-style-focus.md`.

## Markdown CodeHeader (2026-10-23)

`code-header.tsx` extracts `CodeHeader` from the official `packages/ui/src/components/react/assistant-ui/elements/markdown-text.tsx` at commit `1f41f91643fdb56e5d8dbd14db65f742740738a1`, Git blob `e1d670e1b5bdb2f46167ed3c896711e24aa28950`. The official clipboard hook inspected at that commit is `packages/ui/src/hooks/use-copy-to-clipboard.ts`, blob `d607b48359ce70e0d7033b417e421f797cbfb042`. MIT; existing LICENSE retained.

Preserve the upstream header/language structure, utility classes, Copy/Check icons and 150/200ms success transition. Scoped CSS maps those utilities to the existing Homer theme. Reuse the existing local TooltipIconButton with Chinese tooltip/accessible label and official 24px target; unlabelled blocks read “纯文本”. Copy starts in the user gesture, and retains the upstream three-second copied feedback and timer cleanup. Deliberate additions: pending/reentry guard, visible clipboard failure, and code-scoped cleanup so streamed changes cannot inherit an old Promise's copied state. No additional copy service or dependencies.

The consumer supplies this component to the installed MarkdownTextPrimitive's CodeHeader slot. Highlight, KaTeX, Mermaid and Canvas renderers are unchanged. CodeHeader receives and copies raw block source directly, including Mermaid source; inline code has no header. Header controls are non-selectable so their labels do not enter ordinary selected-text quotes. The separate message-level Copy/Quote actions keep their existing owner.

## Two-action MessageActions (2026-10-23)

`message-actions.tsx` adapts the standalone upstream `packages/ui/src/components/react/assistant-ui/elements/message-actions.tsx` at the same fixed commit `1f41f91643fdb56e5d8dbd14db65f742740738a1` (MIT; existing LICENSE retained). Original SHA-256: `000c9da991dd888234576521192579169a0b6c4913ad2b025ee387b29c6d5277`, Git blob `60974e194000d4a2408f93c8bfa988992faba607`.

The user explicitly selected Copy and Quote. Retain the upstream flex row, ghost button shape, lucide Copy/Check geometry and 200ms opacity/scale/blur swap. Remove reaction/regenerate/more props and controls, add Quote using lucide, localize labels, and provide copy-busy and quote-disabled inputs. Scoped CSS maps the used upstream utilities to Homer theme variables and retains official size-7 (28px) controls; reduced motion disables transitions. No runtime, dependency upgrade or global theme is added.

`MessageDetails` keeps the installed official copy hook and its synchronous custom writer, pending/error handling and streaming-copy behavior. Quote feeds the existing thread composer quote state with the exact persisted message ID. The shared `messageQuoteText` conversion is extracted unchanged from the server's source validator, excluding hidden Markdown link/image metadata. The existing 16000-character limit, source validation, drafts and send receipts remain owned by Homer.

Source: [assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui/tree/1f41f91643fdb56e5d8dbd14db65f742740738a1), commit `1f41f91643fdb56e5d8dbd14db65f742740738a1`. MIT, Copyright 2026 AgentbaseAI Inc.; original license retained in `LICENSE`.

Upstream files under `packages/ui/src/components/react/assistant-ui/elements/`:

| Input | Original SHA-256 | Bytes | Use |
| --- | --- | ---: | --- |
| run-activity.tsx | 1b838ae6054c2c45535701af231291436e77da1d6215a2c2a80a313de5aaeace | 3481 | Adapted here |
| collapsible-root.tsx | 6d3e6d9a776ac9db13448606627c2ef51e5605cacb2f805379ada9b58abe4565 | 691 | Unmodified official Base UI component |
| surfaces.tsx | 5d81fbb669e67ae20026cd30ed57efc51a5e3ee0f4f5d265e1723de75359b8fa | 4462 | Only original collapsePanel export retained |
| repository LICENSE | eafb05991a572efa34097474b31fef45b14a8879ed1d1a8fd77de62e6fa7d275 | 1073 | Unmodified |

Official component restored on 2026-10-23 after the user's scope clarification:

- `run-activity.tsx` matches the pinned upstream bytes except its `cn` import path. The existing `clsx`/`tailwind-merge` helper is reused. No extra props, wrapper classes, inline chevron, inert overrides or replacement folding runtime.
- `collapsible-root.tsx` is the unmodified upstream file (hash above), using authorized exact dependency `@base-ui/react@1.8.0`. Existing package versions stay unchanged. The only additional lock entries are Base UI React, Base UI utils, `reselect` and `use-sync-external-store`.
- `surfaces.ts` retains only the upstream `collapsePanel` constant, byte-identical to that export. No unused surfaces/components are copied. The existing Lucide package supplies `ChevronRightIcon` without an upgrade.
- `run-activity.source.css` scans those official class strings with the existing Tailwind toolchain. `node scripts/build-run-activity-css.mjs` generates `run-activity.css`; `--check` verifies reproducibility. Generated selectors are scoped to `[data-slot="run-activity"]`; theme color roles bind to existing Homer variables. Preflight stays in its base layer and excludes entry content, preserving approved card styles and native Markdown list markers. There are no handwritten replacements for official geometry or animation. UI build/dev regenerate; isolated dev builds check the generated file before compiling.
- Homer supplies original identity/revision/order, public activity facts, accurate timing, authorized history reads and actual exceptions through the official props. It initializes `open` to false and changes it only in response to the component; no automatic opening, completion folding or session storage. Empty content uses the original status-only row.
- The earlier exclusion of the per-item ActivityReader was superseded by the user's explicit cancellation on 2026-10-23. Homer now shows public activity facts inline, without activity detail buttons, legacy Worker links or the old task sidebar. Approved immutable Worker event cards, ordinary Canvas/original-answer access and authorized process lazy reads remain. The official Run Activity implementation, task/result ownership, model tools, persistence and permissions are unchanged by that removal. See `docs/2026-10-23-remove-activity-reader.md`.

Earlier integration also declared the existing `@assistant-ui/core@0.3.30` (MIT, public `@assistant-ui/core/react` copy hook), `@radix-ui/react-focus-scope@1.3.1` (MIT, WorkOS; formerly the task dialog focus loop, now only a transitive dependency of retained primitives). These two existing declarations required no new packages; the authorized Base UI additions are listed above. The copy hook uses a Homer writer for pending/error feedback and one synchronous clipboard initiation; it does not use the Copy primitive, whose installed API cannot supply this writer.

The installed Attachment primitives/adapter own the draft attachment collection. Homer retains the upload/discard transport, stable request/upload identity, confirmed asset metadata, batch validation, and running-send/IME form adapter. The official Attachment appearance above replaces the former `unstable_Thumb` wrapper; the small per-row object URL effect, keyed by the original attachment ID, supplies the local preview.

When updating, recheck the pinned source and license, Base UI transition/focus behavior, user-controlled disclosure, copy failures/user activation, and attachment send-clear versus explicit discard. Do not replace Homer business owners with a component runtime.

## Pinned standalone Message Queue (2026-10-22)

Same upstream commit `1f41f91643fdb56e5d8dbd14db65f742740738a1`, same unmodified MIT `LICENSE`.
Files were fetched as bytes and SHA-256 checked before adapting:

| Input under `packages/ui/src/components/react/assistant-ui/elements/` | Original SHA-256 | Bytes |
| --- | --- | ---: |
| `message-queue.tsx` | `5eb1cd94c8e5a2a927a1f7a41e7af69947e5b7821a77e47daefb1498a97e0e3b` | 2860 |
| `surfaces.tsx` | `5d81fbb669e67ae20026cd30ed57efc51a5e3ee0f4f5d265e1723de75359b8fa` | 4462 |

Upstream standalone API: required `running: string`, `queued: readonly {id: string; text: string}[]`, optional `onCancel(id)`, root `div` props. It does not edit, persist, reorder, paginate, reconcile receipts or lock individual rows. The runtime example on the documentation page is a different integration; Homer does not bind its queue to the assistant-ui runtime.

`message-queue.tsx` retains the official count, numbered single list, truncating 13.5px summary, arrow and 24px cancel geometry, with existing scoped theme mappings. No running row is rendered (there is no second running-state display), no row slots, expansion, edit or drag/sort DOM remain. Icons now reuse the existing Lucide library. Necessary props: authoritative total/loaded count, server position, per-row cancellability and shared disabled state. This is a thin adaptation, not byte-identical upstream code.

`homer-message-queue.tsx` reads the same persistent `dispatch-v1` page with `sources:all`, preserves raw order/message identity and uses only the original user cancellation CAS owner. Worker/processing/uncertain rows cannot cancel. Worker origin and nonqueued receipt facts fit in the same single summary; total comes from authoritative queue state, with existing next/home pagination. The host bounds tall lists to retain Composer access. No extra polling or queue runtime. `QueueOperations` continues automatically reconciling old edit/move/cancel operations with their exact original identity and unknown-write lock; manual reconciliation and retry controls are removed. Old editor session data remains unchanged in storage, with its viewing panel removed; ordinary draft, references, confirmed attachments and request identity restore through their original owner. Backend editing/reordering APIs remain for already accepted requests and other clients. No new edit/move can be initiated by this UI.

2026-11-02 receipt display: the component accepts `messages` with their original receipt state, rather than treating every row as `queued`. The host labels the collection “消息队列” and owns the authoritative pending count across pages. Processing and uncertain rows retain their identities and ordering barriers, including with zero pending inputs; only queued rows can expose existing permitted actions. As of 2026-11-03, rows omit the added state text labels. A backlog awaiting a new user message defaults to collapsed; a manual toggle survives background refreshes, and the continuation hint stays in the Composer placeholder.


2026-10-22 public activity facts candidate:

- No changes to `run-activity.tsx`, `run-activity.css`, `collapsible-root.tsx` or the license. The pinned official disclosure, list, typography, rule and metrics remain the presentation owner.
- Homer supplies whitelisted action/object/outcome facts as entry content, from existing business receipts and versioned public display metadata. This is Homer data adaptation, not automatic Run Activity summarization. A returned call does not prove business success; prepared delivery does not prove recorded publication.
- Scope clarified on 2026-10-23: per-item activity details/navigation belong to another task and remain intact; approved Worker event cards remain. Only the additional original-call aggregation/reader, header notes/counts and forced disclosure lifecycle are removed.
- The optional fact is stored only on the original process item. `MainProgress` channel events stay unchanged. Current navigation is not persisted: task/result/Run/version/thread and publication revocation are checked again by their owners. Historical Worker event cards remain immutable and have no buttons.

2026-10-22 customization simplification:

- Historical 2026-10-22 cleanup removed a local Radix re-export. Superseded on 2026-10-23 by the official Base UI file and original Run Activity source described above.

## Official standalone Sources and legacy tool history (2026-10-23)

The reply-link consumer is `MessageDetails`, used by the existing user/assistant message slots. New projected process messages already have empty `toolActivities`; only the existing historical branch is replaced. There is no change to extraction, history storage, message pagination, process lazy reads, FileList, Canvas or original-answer authorization.

Sources is the complete standalone `packages/ui/src/components/react/assistant-ui/elements/sources.tsx` at the same pinned commit `1f41f91643fdb56e5d8dbd14db65f742740738a1`, MIT (existing LICENSE retained), rather than `sources.aui.tsx` or a new runtime. Original SHA-256:

| Official input | Original SHA-256 |
| --- | --- |
| `elements/sources.tsx` | `c280153e36f1a110f1c3edded3b2f27ad42def391413aa055ede9ac886e354b8` |
| `utils/href.ts` | `3a8038d038b1918ae3f58a61dcd30933633131dda341eb5bea5b6a650b31a912` |
| `elements/surfaces.tsx` | `5d81fbb669e67ae20026cd30ed57efc51a5e3ee0f4f5d265e1723de75359b8fa` |

Preserve all standalone exports, list/grid DOM and utility classes, disclosure, badges/glyphs, title/domain layout, links and transitions. Adapt imports, Chinese labels and stylesheet import. Optional public source `id` keys the same official rows and supplies `data-source-id`, preserving Homer's identity rather than URL/index identity. The exact `fieldInteractive` constant is extracted into Sources itself; `collapsePanel`, `paper` and `mono` reuse existing excerpts. This deliberately avoids changing the shared surfaces or the current RunActivity CSS. `href.ts` is byte-identical upstream. `official-sources-upstream.test.mjs` checks the reconstructed original source and helper hashes.

Homer uses `layout="list"`, `locale="zh-CN"`, default-closed controlled disclosure keyed by the exact thread/message identity, and its original unverified-link explanation. `sources.source.css` compiles actual official utility strings through `node scripts/build-run-activity-css.mjs --sources` (or `--sources --check`); only Sources is scoped, with existing theme variables and focus outlines. Official 384px maximum width and title/domain truncation remain; full source titles stay accessible as link text. No favicon requests, page fetching, global theme/reset, dependency or runtime is added.

The official href helper also permits relative/mailto URLs and credentials. Homer keeps its stricter HTTP(S), absolute-URL and no-credentials filter at the consumer; invalid rows cannot crash domain rendering and an all-invalid collection creates no empty entity. This does not claim the official component enforces Homer's policy. The original server extractor still owns actual Markdown links, normalization, deduplication, first-seen order and 30-item limit. The display preserves supplied order/duplicates and exact URLs/IDs, rendering titles as safe React text. Result files and original answers remain with their existing authorized owners.

Legacy `toolActivities` now use the unchanged official RunActivity and its existing stylesheet. Exact tool IDs/order and original running/returned/failed/blocked wording remain. Unknown statuses and absent names are neutral; no tool body, clock, Worker event or business success is invented. The aggregate uses official `incomplete` with the existing “处理过程 · N 项” wording because this list supplies no reliable run lifecycle. It is default closed, replacing the old running-message auto-open rule; user choice survives receipt/status updates and resets only on a different message identity. No second detail reader, timeline or sidebar is introduced.

Verification, isolated preview commands, screenshots, the pre-existing RunActivity CSS reproducibility mismatch and rollback boundaries: `docs/2026-10-23-official-sources-legacy-activity.md`. These are local candidates, not a release.


## Official QuestionFlow / OptionList / ElicitationForm (2026-10-23)

Pinned standalone sources: assistant-ui/assistant-ui `24b84e51911a539b20c9f7000f64c09e6c9f253e`, MIT (existing LICENSE retained). These are registry source components, not npm exports. Existing package versions, runtime, provider and other component pins remain unchanged.

| Source under packages/ui/src/components/react/assistant-ui/elements | Original SHA-256 |
| --- | --- |
| question-flow.tsx | 57b4b8af15e4a444586e684910b89db819cc5021c60a39ea93918dc721a94489 |
| option-list.tsx | 5f1c156aac4ad56aedac93665bef44f84a1253f357127dd92c55bf6926d230dc |
| elicitation-form.tsx | 9d98ed74254ada76f5325f6d8cb333cf56bd3521763c3f6217c64e3ad8c2e621 |

Keep all official component exports, layout, utility strings, icons, single-pick advancement/final submission, Back, Promise/error and receipt behavior. Adapt cn/layout-effect imports, Chinese labels and scoped stylesheet import. OptionList uses the upstream clamp excerpt in range.ts (upstream range.ts SHA-256 3506d5f07865c042a4ef9b96904f687d19372a14e7dfccf946749860a3606182). Receipt focus and surface constants reuse existing identical extracts. ElicitationForm has exactly two additional host adaptations: its text input is a native textarea for existing multiline values; Decline is absent when no onDecline callback is supplied, because native questions have no denial response. Its accepted state means input receipt only. question-flow-upstream.test.mjs reverses the documented edits and verifies all three original source hashes.

`node scripts/build-run-activity-css.mjs --question-flow` compiles/scopes the actual sources to question-flow, option-list and elicitation-form roots; `--check` verifies reproducibility. Host rules add only theme mapping, text/narrow-screen containment, multiline input and focus. No global reset or second runtime. Product build/dev include this flag. Other components' generated CSS is not a deliverable of this change.

The existing InteractionCard owns exact request identity, source, pending payload, liveness, retries and durable receipts; Composer owns ordinary and targeted text drafts. Native answers have an explicit questionAnswers map separate from readable text, with an exact legacy JSON fallback for older services. Worker escalations stay natural main-Agent questions rather than projecting their raw native forms. The old custom QuestionFlow/CSS and final review are removed; no wrapper preserves the old flow. Full scope, verification and existing unrelated check failures: `docs/2026-10-23-question-flow-simplification-implementation.md`.


## Preview annotation integration (2026-10-23)

The pinned CanvasSplit, WebPreview, Image and QuoteBlock remain assistant-ui components. New packages are separate mature libraries, not assistant-ui products: react-resizable-panels 4.14.8 (MIT), @mantine/hooks 9.7.3 (MIT), @annotorious/react 3.9.5 (BSD-3-Clause), and agentation 3.1.2 (PolyForm Shield 1.0.0). Base UI Dialog 1.8.0 was already installed. All direct versions are exact in ui/package.json and the root lock.

Annotorious npm packages omit LICENSE; LICENSE-annotorious is the unmodified upstream file at npm gitHead f780879410ff4f2d4fd0b2cb1ae1bd596a40fe65, downloaded from https://raw.githubusercontent.com/annotorious/annotorious/f780879410ff4f2d4fd0b2cb1ae1bd596a40fe65/LICENSE. ui/vite.config.ts includes it and the installed package license texts in the existing notices output. Agentation is not MIT; local integration does not establish a separate commercial license.

Homer owns only verified source identity, selected text, original-image upload/rectangle metadata, and onSubmit-to-composer transport. Agentation executes in the sandboxed preview document, never the main application; no MCP, endpoint or webhook is configured. Its Storage writes use document-local memory where the opaque origin forbids localStorage. No arbitrary-site injection or same-origin exception is introduced. See docs/2026-10-23-preview-annotation-implementation.md.


## Text-file multi-annotations (2026-10-24)

The arbitrary-file selection action now says 批注. The existing Mantine leaf subscription and Base UI Popover virtual Range anchor, portal, collision and dismissal remain the owners. The popup switches from the pinned Quote toolbar appearance to a small Homer-owned textarea/form using existing theme roles and Base UI Button. This form is not an upstream AnnotationEditor, an Agentation instance, or a second assistant-ui runtime. No new dependency, copied unlicensed styling or cva package is introduced.

Saved file excerpts/comments use the original ResourceReference/quote JSON owner with an optional text annotations union. A single sticky summary in the preview provides edit/delete and explicit unified import; imported snapshots render every entry through the existing public QuoteBlock.Text className override with bounded scrolling. No vendor component source is changed. The source IDs, hash, ordinary composer/attachment/request identity, single reference rule and focus owner remain unchanged. Session notes are scoped to exact artifact/hash within the current thread and survive preview unmount, while refresh reconstructs only the imported composer snapshot. Existing image and web contracts are unchanged. See docs/2026-10-24-text-file-multi-annotations.md for boundaries and synthetic verification.


## Image-file multi-region annotations (2026-10-24)

The approved image Demo is connected through the existing CanvasSplitHeader actions slot, original Composer, attachment adapter and ResourceReferenceBlock. The image-only header uses the existing TooltipIconButton at the accepted 28px / 14px icon / 8px inline padding / 5px gap geometry. No additional assistant-ui runtime is introduced. TooltipContent and TooltipIconButton gain one optional portal-container prop; image controls pass the existing Dialog action container so mobile tooltips remain visible and hit-testable. Default behavior of all other consumers is retained. The original attachment CSS generator adds its scoped container utility after scanning the new prop, and its reproducibility check passes; no native-modal body-portal demo is copied.

Annotorious React/Annotorious 3.9.5 owns rectangles, selection, editing handles, native bodies/store and ImageAnnotationPopup positioning. A label-only adapter projects numbers; dormant per-thread source/hash snapshots move back into the store when reopened. The owner explicitly destroys the native instance on preview unmount. A local controlled editor preserves the previously approved Agentation 3.1.2 appearance, multiline/IME, Chinese cancel/save and busy behavior; it is not Agentation's native AnnotationPopupCSS editor. Its visual source is src/components/annotation-popup-css/styles.module.scss (installed dist SHA-256 1a4d069438c9f218d20eab31150e5c2b1c6ef05c526135bd10dd492950023b1e), Copyright (c) 2026 Benji Taylor, PolyForm Shield 1.0.0, not MIT. Original Agentation license and Annotorious BSD notices remain in the build. No second Agentation instance, DOM selection engine, library fork, dependency or new database is added.

The rectangle serializer reads native x/y/w/h (and rotation projection) because 3.9.5 handle updates can expose one-frame-old derived bounds. Saved annotations synchronize that derived box through the public update API; transport snapshots still contain only original-image pixel regions/comments. See docs/2026-10-24-image-file-multi-annotations.md for old/new contract compatibility and isolated product verification. Source integration does not imply an installed release.

## Shared text/image annotation comment form (2026-10-25)

`ui/annotation-comment-form.tsx/.css` now supplies the same controlled content to PreviewSelectionToolbar and RegionComment. This supersedes the separate theme-colored text form described above. The original Base UI Range/Portal and Annotorious 3.9.5 ImageAnnotationPopup still position their respective content. The shared form owns no source, annotation store, draft Map or Composer. RegionComment retains its transaction snapshot, ended guard and cancel/geometry rollback; transient composition input protection now belongs to the shared content. HTML continues using the pinned Agentation 3.1.2 native popup and its original English/Enter behavior; no vendor changes are part of this extraction.

The shared CSS moves the already approved image visual adaptation of Agentation's `src/components/annotation-popup-css/styles.module.scss`, Copyright (c) 2026 Benji Taylor, PolyForm Shield 1.0.0. Original input dist SHA-256 remains `1a4d069438c9f218d20eab31150e5c2b1c6ef05c526135bd10dd492950023b1e`. Label/placeholder contrast, primary-button text, optional excerpt, focus and narrow action wrapping are local adaptations, not an official Popup API or MIT styling. Existing Agentation license, Annotorious BSD license and generated third-party notices are unchanged. No dependency or second runtime is added. Verification and local-only limitations: `docs/2026-10-25-annotation-comment-form-unification.md`.



## Saved annotations share the original composer (2026-10-25)

This supersedes the earlier session-Map, batch-import, single-source and onSubmit transport policies. Explicit text/image/HTML saves enter the original composer draft immediately. Composer chips and preview markers project the same source groups; deleting from either side updates that owner. Only the actual composer Send submits. Text/image reuse the shared AnnotationCommentForm; Base UI and native Annotorious retain placement and geometry. Text uses verified UTF-16 logical anchors, CSS Highlights and accessible marker buttons without mutating Markdown/KaTeX markup. Quote actions now refuse an implicit replacement of saved preview context.

The pinned assistant-ui attachment component has one optional `removeLabel` prop, used as both the existing tooltip and button aria-label. Homer supplies “移除原图及 N 条批注” only for an associated original image; the adapter clears notes only after successful discard. Existing attachment behavior remains the default. No dependency or assistant-ui runtime is added. Agentation's separate, locally maintained authoritative draft controller and native error/busy acknowledgment are documented in `ui/vendor/agentation-3.1.2/MODIFIED-SOURCE.md`; its PolyForm Shield license and original notices remain unchanged. Source-only implementation, transport compatibility, exact patch identity and verification: `docs/2026-10-25-annotation-composer-sync.md`.

## Official ToolFallback in Run Activity (2026-10-25)

Source: assistant-ui/assistant-ui `1f41f91643fdb56e5d8dbd14db65f742740738a1`, MIT. Existing `LICENSE` and the build's identical assistant-ui notice remain unchanged. Installed React 0.15.29 / core 0.3.30 and Base UI 1.8.0 suffice; no dependency upgrade or cva package is added.

| Fixed upstream source | SHA-256 | Local consumer |
| --- | --- | --- |
| `packages/ui/src/components/react/assistant-ui/elements/tool-fallback.aui.tsx` | `2230ad6e2a812242aa5990e58bd9a716aee8916508b805adb4c039f2b1e281ad` | Complete source, all compound exports retained |
| `packages/ui/src/components/react/ui/base/button.tsx` | `de5e06ef482e702cc56abe8fbe0b1dfcfee9c30db4eafad24a38b5360188c42f` | `tool-button.tsx`: only consumed base/default/outline/sm class excerpts, existing Base UI Button and cn |
| `packages/ui/src/components/react/ui/base/textarea.tsx` | `abab274474743d7b6d30e67848e4341c2fbd491a8a300010e5da1176c7f9624f` | `tool-textarea.tsx`, import adaptation only |
| repository `LICENSE` | `eafb05991a572efa34097474b31fef45b14a8879ed1d1a8fd77de62e6fa7d275` | Existing unmodified notice |

ToolFallback changes only its three helper imports, an optional Trigger `label`, and Chinese Result/Error headings. `official-tool-fallback-upstream.test.mjs` reverses those edits and checks the original hash. Button excerpt classes have a separate fixed hash; unused variants are omitted to avoid a new cva dependency. Existing `collapsible-root.tsx`, task-status cn and Lucide are reused. RunActivity remains unchanged.

Homer supplies every process call through the original RunActivity entries, including failed, declined, interrupted, blocked and unknown calls. Args/Error/Result remain in the Worked disclosure; recovery and completion retain the same item identity and order. Homer no longer supplies attention content, aggregate problem counts or remembered outside positions. The optional upstream attention slot, running activity summary and independent business interactions remain unchanged.

`tool-fallback.source.css` scans the original utility strings. `node scripts/build-run-activity-css.mjs --tool-fallback` generates scoped `tool-fallback.css`; append `--check` to verify exact reproducibility. Only theme mapping, containment and focus are host rules. Product build/dev include generation; isolated development builds check the generated source. This supersedes only the older plain-p tool rendering policy above.

The production composition follows the fixed official demo: existing external-store message parts, ID-based classification and `MessagePrimitive.PartByIndex`. Homer supplies actual status, a Chinese label and missing/hidden/truncated notes to the official compound components. A returned call is not business acceptance. PublicActivity remains a separately labeled business receipt. The original InteractionCard remains the approval owner because its current-request authority and unknown-delivery protocol are not equivalent to the generic ToolFallback approval callbacks; no synthetic callbacks or additional approval buttons are connected. The complete official Approval export is retained for source integrity.

Only answer parts render in the existing formal bubble. Message actions use the original body, with process text excluded from selection quotation even when no formal answer exists. One message-level process-detail cache replaces the old local detail cache. See `docs/2026-10-25-official-tool-activity-integration.md` for content limits, exact owners, rollback and synthetic-only verification.


2026-10-25 drag wiring (supersedes the earlier no-drag/no-new-move description): one private QueueRow uses `@dnd-kit/react` 0.5.1 useSortable, binding the row and existing number handle. Segment-local index/group/type/accept and disabled flags keep user/Worker moves within the current page's contiguous queued/movable segment; all other rows are barriers. Homer owns one local Provider with default sensors and `@dnd-kit/abstract` 0.5.1 RestrictToVerticalAxis. A valid drop uses the source's final index and the global pending successor through the existing messageId move/CAS owner exactly once. Cancel, no-op and invalid scopes write nothing. Local remount/scroll/focus restoration resets the temporary DOM preview; service-confirmed order remains authoritative. Move and its automatic receipt reads alone have a 15-second waiting deadline; an unknown move retains its original operation identity/payload/lock and makes one extra internal receipt read after settlement, without replaying the write. The removed notices/manual controls/panels stay removed; persistent unknown results can remain locked without a visible recovery entry. Source wiring does not establish browser acceptance or deployment.
