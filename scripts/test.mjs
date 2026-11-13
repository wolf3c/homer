import {readdirSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Explicit ownership keeps optional environments out of the default core regression.
const candidates=readdirSync('tests').filter(file=>/\.test\.(ts|mjs)$/.test(file)).sort();
const suites={
 'power-macos':['macos-power-native.test.mjs'],
 'power-windows':['windows-power.windows.test.mjs'],
 'power-browser':['desktop-power-ui.browser.mjs'],
 'power-electron':['desktop-power.electron.test.mjs'],
 browser:["interaction-completion.browser.mjs", "artifact-file-list.browser.mjs", "run-activity-focus.browser.mjs", "run-activity-style.browser.mjs", "web-history-active-pages.browser.mjs", "web-history-artifact-origin.browser.mjs", "web-history-kerning-content.browser.mjs", "web-history-kerning.browser.mjs", "web-history-loading.browser.mjs", "web-history-media-anchor.browser.mjs", "web-history-native-zoom.browser.mjs", "web-working-publication-large.browser.mjs"],
 desktop:['desktop-service-startup.test.mjs','main-tools-resume-compatibility.test.mjs','macos-desktop-runtime.test.mjs','electron-desktop.test.mjs','native-main-tools-resume.test.mjs'],
 'cua-windows':['windows-cua-package.test.mjs'],
 'desktop-codesign':['desktop-update-codesign.test.mjs'],
 'prompt-resume':['native-main-tools-resume.test.mjs','native-main-prompt-resume.test.mjs'],
 'local-media':candidates.filter(file=>/\.local-media\.test\.(ts|mjs)$/.test(file)),
 engine:["native-protocol.engine.test.mjs","channel-native.engine.test.ts","scheduled-native.engine.test.ts","deepseek-continuation.test.ts","deepseek-pinned.test.ts","desktop-source-resume.test.mjs","homer-account-native.test.mjs","native-memory-defaults-offline.test.mjs"],
 account:["homer-account-gateway.test.mjs","homer-account-integration.test.mjs"],
 rtc:["mobile-webrtc-runtime.test.mjs"],
 development:["desktop-gateway-access.test.mjs","desktop-icon.test.mjs","desktop-source.test.mjs","dev-gateway.test.mjs","pinned-rollback.test.mjs","reception-gateway.test.mjs","reception-ipc.test.ts","release-css-snapshot.test.mjs","web-dev-host.test.mjs","mobile-runtime-packaging.test.mjs","mobile-ui-build.test.mjs","mobile-download-focus.development.test.mjs","ios-xcodebuild.development.test.mjs","deepseek-isolated.test.mjs","dev-fixture-wait.test.mjs","dev-upgrade.development.test.mjs","web-feedback-host.development.test.ts","electron-package.development.test.mjs","first-launch-distribution.development.test.mjs","prompts.development.test.ts"],
 vendor:["model-selector-upstream.test.mjs","agentation-preview-patch.test.mjs","approval-card-upstream.test.mjs","official-canvas-upstream.test.mjs","official-sources-upstream.test.mjs","official-tool-fallback-upstream.test.mjs","question-flow-upstream.test.mjs","run-activity-upstream.test.mjs","task-status-css.vendor.test.mjs"],
 'windows-capture':['windows-capture.electron.test.mjs'],
};
const requested=process.argv[2]?.slice(2);
const suite=process.argv[2]?.startsWith('--')&&Object.hasOwn(suites,requested)?requested:'core';
const desktop=suite==='desktop';
if(suite==='power-macos'&&process.platform!=='darwin')throw Error('power_macos_acceptance_requires_macos');
if(suite==='power-windows'&&process.platform!=='win32')throw Error('power_windows_acceptance_requires_windows');
if(suite==='power-electron'&&!['darwin','win32'].includes(process.platform))throw Error('power_electron_acceptance_requires_desktop');
if(suite==='browser')for(const name of ['HISTORY_FOLLOWUP_BUILD','HOMER_SYNTHETIC_ROOT','HOMER_BROWSER_EVIDENCE'])if(!process.env[name])throw Error('browser_acceptance_requires_explicit_path: '+name);
if(suite==='cua-windows'&&(process.platform!=='win32'||process.arch!=='x64'||!process.env.HOMER_TEST_WINDOWS_APP))throw Error('windows_cua_acceptance_requires_signed_app_on_windows_x64: HOMER_TEST_WINDOWS_APP');
if(desktop){
 for(const name of ['HOMER_TEST_ENGINE_MODULE','HOMER_TEST_SERVICE_MODULE']){
  const value=process.env[name];
  if(!value?.startsWith('file://')||!existsSync(fileURLToPath(value)))throw Error('desktop_acceptance_requires_explicit_file_url: '+name);
 }
 const app=process.env.HOMER_TEST_APP;
 if(!app||!existsSync(join(app,'Contents/MacOS/node'))||!existsSync(join(app,'Contents/Resources/desktop-manifest.json')))throw Error('desktop_acceptance_requires_built_app: HOMER_TEST_APP');
 if(!process.env.HOMER_TEST_CODEX_BIN?.startsWith('/')||!existsSync(process.env.HOMER_TEST_CODEX_BIN))throw Error('desktop_acceptance_requires_bundled_engine: HOMER_TEST_CODEX_BIN');
 await import('playwright-core');
}
if(suite==='windows-capture'&&(process.platform!=='win32'||process.arch!=='x64'||!process.env.HOMER_WINDOWS_TEST_APP))
 throw Error('windows_capture_acceptance_requires_windows_x64_and_candidate: HOMER_WINDOWS_TEST_APP');
const explicitFiles=new Set(Object.values(suites).flat());
const files=(['browser','power-browser'].includes(suite)?suites[suite]:candidates.filter(file=>suite==='core'?!explicitFiles.has(file):suites[suite].includes(file))).map(file=>join('tests',file));
if(!files.length)throw Error('test_suite_empty: '+suite);
if(suite==='core'){
 console.error('[homer-tests] Local media integration: not run / unverified. Run npm run test:local-media with the documented local tools.');
 console.error('[homer-tests] Other explicit suites not run / unverified: '+Object.keys(suites).filter(name=>name!=='local-media').map(name=>name.startsWith('power-')||['browser','cua-windows','desktop-codesign'].includes(name)?'node scripts/test.mjs --'+name:'npm run test:'+(name==='desktop'?'desktop:acceptance':name)).join(', '));
}else console.error('[homer-tests] Explicit '+suite+' suite: skipped or not-run checks remain unverified; exit 0 alone is not acceptance.');
const preload=suite==='core'?['--import',new URL('../tests/fixtures/core-system-proxy.mjs',import.meta.url).href]:[];
const env={...process.env};
if(suite==='core')for(const key of ['HOMER_MCP_ENGINE_MODULE','HOMER_MCP_SERVICE_MODULE','HOMER_RECEPTION_SOURCE'])delete env[key];
const child=spawn(process.execPath,[...preload,'--import','tsx','--test','--test-concurrency=1',...process.argv.slice(suite==='core'?2:3),...files],{stdio:'inherit',env});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',(code,signal)=>{
 if(suite!=='core'&&(signal||code!==0))console.error('[homer-tests] '+suite+' acceptance remains unverified: the run did not pass.');
 if(signal)process.kill(process.pid,signal);else process.exitCode=code??1;
});
