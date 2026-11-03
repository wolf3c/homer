---
name: homer-local-desktop
description: Operate the local macOS desktop through Homer's bundled cliclick and system screenshot tool when the task requires native desktop interaction.
---

macOS arm64 only. Use `"$HOMER_BUILTIN_ROOT/desktop/cliclick" -h` for supported syntax. With本人 Accessibility permission and authorized target, `c:x,y` clicks, `t:text` types, `kp:return` presses Return. Screenshots use `/usr/sbin/screencapture -x <authorized-task-path.png>` and require本人 Screen Recording permission. Inspect the screenshot before choosing coordinates and again after an action. Do not operate another app or submit external actions without task authorization.

Permissions belong to the actual launching application/process. If absent, direct the person to System Settings → Privacy & Security → Accessibility / Screen & System Audio Recording for that launcher. Do not change TCC, run sudo, or repeatedly trigger permission prompts. An installed executable or `-h` check does not prove desktop operation permission. This method does not provide an accessibility tree, Windows/Linux support, or a cloud computer session.
