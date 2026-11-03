---
name: homer-local-browser
description: Operate websites in Homer's bundled local Chromium with Playwright for navigation, forms, page reading, downloads and screenshots.
---

Create a .cjs script in the authorized task directory. Run `"$HOMER_BUILTIN_ROOT/node/bin/node" script.cjs`. Use `const {chromium}=require(process.env.HOMER_BUILTIN_ROOT+'/node_modules/playwright');`. Set `process.env.PLAYWRIGHT_BROWSERS_PATH=process.env.HOMER_BUILTIN_ROOT+'/browsers'` before launch. Use `chromium.launch({channel:'chromium',headless:true})` for ordinary local tasks, close in finally, and store screenshots/downloads only in the task directory. Read locators/page text before clicking; verify the resulting state. Video recording is not included.

This browser is separate from the user's existing Chrome profile. Never read browser cookies or copy a profile. Login and external submissions follow the current task's account and action authorization; request本人 login when necessary. A website may block automation. The bundled browser needs neither a Browser Use cloud account nor Cindy tools. Model Shell network restrictions remain in force: the bundled browser is not a network authorization bypass. Report a blocked network path rather than requesting unrestricted shell network.
