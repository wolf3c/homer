# Live channel changes implementation plan

> For agentic workers: use superpowers:executing-plans task by task.

Goal: Confirmed additions, removals and renewals apply without stopping Homer, its main Agent or Workers.
Architecture: Move existing DesktopChannels into the runtime-lock-owning host. Drain and rebuild only the affected adapter; keep plugin, bindings and outbox.
Tech stack: TypeScript, Node 22, Electron, React, SQLite. No new dependencies.
Spec: User-approved design in task task-e1bc6e2d-f49e-4200-b930-99949cf53a73, 2026-11-13.

## Global constraints

- Current main workspace; preserve unrelated changes.
- No commit, install, deploy or real channel traffic before review.
- No new manager, framework, persistent operation table or enable/disable feature.
- Isolated synthetic protocols only.
- Stop old operations before reading, merging and atomically saving configuration.
- Unknown sends remain pinned; paused inputs and scheduling authority wait.

## Review focus

- Late WeChat whole-file writes.
- Multipart send drain and unconfirmed settlement.
- Save-before-bind failure and retry without another write.
- Lost acknowledgements correlated by operation ID.
- Sleep/startup/close races.

## Tasks

- [x] 1. RED/GREEN plugin lifecycle: reconfigure, generic input state, wake/close coordination, empty desktop adapters. Extend existing plugin/power tests.
- [x] 2. RED/GREEN controller and IPC: host-owned DesktopChannels, one flow/result, trusted action forwarding. Update existing desktop/channel/shell tests.
- [x] 3. RED/GREEN actual component: applying/error/retry UI, remove restart/staging. Synthetic rendered screenshots.
- [x] 4. Targeted tests/type checks, independent final review, architecture docs and task-only cleanup.

## Evidence

Historical implementation evidence follows. On 2026-11-17 the user explicitly requested renewed review and commit; this supersedes the earlier commit deferral. Current acceptance and remaining live validation are recorded below.

Task 1 initial evidence: new replacement, saved-failure and multipart tests observed RED then GREEN; plugin/power 17/17 pass. No commits. Controller test observed RED (missing host manage/close API).

Final evidence (2026-11-13):

- Channel/protocol/host/schedule/durable queue suite: 126/126, exit 0. Raw output: `.codex/scratch/live-channels-20261113/channel-queue-final.log`.
- Settings component/Electron/IPC/power/update suite: 105/105, exit 0. Raw output: `.codex/scratch/live-channels-20261113/desktop-final.log`.
- Service sources (`tsc -p tsconfig.json --noEmit`) and UI (`tsc -p ui/tsconfig.json --noEmit`): exit 0. Full source/test typecheck still fails at the concurrent `tests/web-history-window.test.ts(44,52)` null-to-string error. This task did not change that file.
- Earlier full core snapshot: 2,373 tests, 2,359 pass, 14 fail. Parallel changes were in progress; this is not an established baseline. Output is preserved in `core.log`; full core was not rerun on main Agent instruction. The later targeted power-host IPC test passed after its owning worker updated the fixture.
- Read-only review found three Important issues and no Critical: paused sends, lost WeChat start ACK UI, claimed-input preparation race. All three have regression coverage and fixes. That review preceded screenshot confirmation; no second full independent review or commit followed.
- Preparation races return only exact, empty, pre-native channel claims to the same durable queue, with no polling or new persistent entity. Revision/native/unknown fences, transactional rollback, saved failure retry, cancellation, revocation, restart and Telegram background retention passed.
- Real DesktopSettings rendering with a synthetic in-memory bridge passed five browser checks with no page/console errors. `browser-results.json` and `browser-lifecycle.json` record exitCode 0, signal null, watchdog false, closeError null, exitUnconfirmed false. PNGs: `channels-ready`, `channels-applying`, `channels-applied`, `channels-failure`, `channels-failure-mobile`.
- The isolated preview process was verified by exact command and stopped with SIGINT; its execution session returned exit 0. Review PNGs, logs and reproduction scripts remain in the task scratch directory.
- Real channel traffic, credentials, native model, installed app, hardware sleep/wake, Windows, install and deploy were not exercised. User screenshot confirmation remains pending.

Review for commit (2026-11-17): isolated current-main candidate passed 624/624 targeted synthetic tests (zero failures, cancellations or skips), full source/test typecheck and UI typecheck. Reviewed lifecycle, stop/drain, receipts, queue deferral, failures and authorization boundaries; no new blocking defect found and no additional product changes made. Existing 2026-11-13 synthetic component/browser records were checked (zero errors, exit 0, watchdog false); no new browser run or user screenshot acceptance is claimed. Real channel traffic, installed-app immediate application, Windows and hardware sleep remain unverified. Commit is authorized by the current request; task-only temporary verification copy will be removed after commit.
