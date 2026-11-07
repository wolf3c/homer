// Requirement-derived regression: current product renderer and exact Electron
// window/menu/quit handlers, synthetic HTTP owners and stdio backend only.
// Run with node --import tsx; build UI into HOMER_TITLEBAR_BUILD first.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {deflateSync} from 'node:zlib';

const root=resolve(process.env.HOMER_TITLEBAR_ROOT??'.codex/scratch/native-titlebar-integration-20261025');
const require=createRequire(import.meta.url);
const {_electron}=require(require.resolve('playwright-core',{paths:[process.env.HOMER_PLAYWRIGHT_ROOT??resolve('.codex/scratch/electron-implementation-20261023'),process.cwd()]}));
const baseline=process.env.HOMER_TITLEBAR_BASELINE==='1';
const build=resolve(process.env.HOMER_TITLEBAR_BUILD??join(root,baseline?'baseline/web':'candidate/web'));
process.env.HISTORY_FOLLOWUP_BUILD=build;
mkdirSync(root,{recursive:true});
process.env.HOMER_SYNTHETIC_ROOT??=join(root,'synthetic');
const {fixture}=await import('./web-history-followup-fixture.mjs');
const checks=[],metrics=[],errors=[],requests=[];
const files=Array.from({length:10},(_,n)=>({id:'result-titlebar-'+n,title:(n===1?'合成网页.html':('长中文与continuous-ascii-name-'.repeat(n>1?10:1)+n+'.txt')),mime:n===1?'text/html':'text/plain',text:n===1?'<!doctype html><h1>合成原生窗口网页</h1><script>document.body.dataset.executions=String(Number(document.body.dataset.executions||0)+1)</script>':'第一处中文。第二处中文。\n'+'合成长正文阅读与批注\n'.repeat(160)}));
function syntheticPng(){
 const chunk=(type,bytes)=>{const data=Buffer.concat([Buffer.from(type),bytes]);let crc=0xffffffff;for(const byte of data){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(bytes.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,data,sum]);};
 const head=Buffer.alloc(13);head.writeUInt32BE(240);head.writeUInt32BE(120,4);head[8]=8;head[9]=2;
 const raw=Buffer.alloc(721*120,120);for(let y=0;y<120;y++)raw[y*721]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const png=syntheticPng();files[2]={...files[2],title:'合成区域.png',mime:'image/png',text:''};
const f=await fixture(100,'after');
f.attach('合成原生窗口文件',files.map(file=>({filename:file.title,mime:file.mime,content:file.mime==='image/png'?png:file.text})));
f.bridge.media.upload=async input=>({assetId:'asset-'+input.uploadId,revision:1,filename:input.filename,kind:'image',state:'ready',mime:'image/png',size:png.length,error:null});
for(const owner of [f.bridge,f.bridge.history]){const state=owner.state.bind(owner);owner.state=async()=>{const v=await state();return {...v,features:{...v.features,taskOverview:true,draftUpload:true}};};}

// The installed/package gate is tested by electron-shell.test.mjs. This harness
// substitutes only bootstrap/profile/codesign, retaining the exact createWindow,
// menu, navigation, permissions, close-hide and before-quit product source.
const sourcePath=baseline?join(root,'before/packaging/electron/main.mjs'):resolve('packaging/electron/main.mjs');
const source=readFileSync(sourcePath,'utf8');
const prefix=source.slice(0,source.indexOf("\ntry{\n if(!app.isPackaged"));
assert.ok(prefix.includes('function createWindow()'));
const protocol=source.slice(source.indexOf("  child=runtime;let buffer='';"),source.indexOf('  }).catch(startupFailed);'));
assert.ok(protocol.includes("runtime.on('close'"));
const mode=baseline?'baseline':'candidate',profile=join(root,mode+'-profile');mkdirSync(profile,{recursive:true});
const backend=join(root,mode+'-backend.cjs'),entry=join(root,mode+'-main.mjs');
writeFileSync(backend,`const fs=require('node:fs'),path=require('node:path');process.stdout.write(JSON.stringify({kind:'url',url:process.argv[2]})+'\\n');let b='';process.stdin.on('data',v=>{b+=v;let i;while((i=b.indexOf('\\n'))>=0){const v=JSON.parse(b.slice(0,i));b=b.slice(i+1);if(v.kind==='quit'){fs.appendFileSync(path.join(__dirname,'${mode}-backend-events.jsonl'),JSON.stringify(v)+'\\n');const m=fs.existsSync(path.join(__dirname,'${mode}-unknown'))?'unknown':'normal';if(m==='normal')process.stdout.write('{"kind":"stopped"}\\n');process.exit(m==='normal'?0:1);}}});`);
const setup=`\napp.setName('Homer Native Integration Synthetic');app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});\napp.whenReady().then(()=>{createWindow();const runtime=spawn(process.execPath,[${JSON.stringify(backend)},${JSON.stringify(f.server.url)}],{env:{ELECTRON_RUN_AS_NODE:'1',PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','ignore']});\n${protocol}\n});\n`;
writeFileSync(entry,prefix.replace(/^import \{prepareDesktopProfile,assertDesktopControlPaths\}.*\n/m,'')+setup);
writeFileSync(join(root,mode+'-input-identity.json'),JSON.stringify({source:sourcePath,sourceHash:createHash('sha256').update(source).digest('hex'),windowHandlersHash:createHash('sha256').update(prefix).digest('hex'),protocolHash:createHash('sha256').update(protocol).digest('hex'),build,profile,entry,bootstrapSubstitution:true},null,2));
const executable=resolve(process.env.HOMER_ELECTRON_EXECUTABLE??'.codex/scratch/electron-implementation-20261023/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
let electron,page;
const record=label=>{checks.push(label);console.log(label);};
async function native(fn,arg){return electron.evaluate(fn,arg);}
async function resize(width,height=780){await native(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setSize(width,height),{width,height});await page.waitForFunction(w=>innerWidth===w,width);await page.waitForTimeout(100);}
async function measure(label){
 const geometry=await native(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {bounds:w.getBounds(),content:w.getContentBounds(),buttonPosition:w.getWindowButtonPosition(),fullscreen:w.isFullScreen(),minimized:w.isMinimized(),visible:w.isVisible(),title:w.getTitle()};});
 const dom=await page.evaluate(()=>{const rect=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();return {width:innerWidth,height:innerHeight,capability:document.querySelector('.app-shell').hasAttribute('data-native-titlebar'),overlay:navigator.windowControlsOverlay?.visible,overlayRect:navigator.windowControlsOverlay?.getTitlebarAreaRect().toJSON(),header:rect('.conversation-header'),bar:rect('.canvas-tab-bar'),body:rect('[data-slot=canvas-split-body]'),workspace:rect('.conversation-workspace'),aside:rect('.status-aside-slot'),composer:rect('.composer-area'),panel:rect('#canvas-panel'),headerPadding:getComputedStyle(document.querySelector('.conversation-header')).paddingLeft,overflow:document.documentElement.scrollWidth-innerWidth,outerRange:document.documentElement.scrollHeight-innerHeight,scroll:document.querySelector('.thread-viewport').scrollTop};});
 const m={label,...geometry,...dom,nativeInset:geometry.content.y-geometry.bounds.y};metrics.push(m);return m;
}
async function open(n){await page.getByRole('button',{name:'预览 '+files[n].title,exact:true}).evaluate(e=>e.click());await page.locator(n===1?'.html-annotation-toggle':n===2?'.image-annotation-toggle':'[data-preview-text]').waitFor();}
async function quit(){
 if(!electron)return;
 await native(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
 const closed=electron.waitForEvent('close',{timeout:25000});await native(({Menu})=>Menu.getApplicationMenu().getMenuItemById('quit').click());await closed;electron=undefined;
}
try{
 electron=await _electron.launch({executablePath:executable,args:[entry],timeout:30000});page=await electron.firstWindow();
 page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>requests.push({method:r.method(),path:new URL(r.url()).pathname}));
 await page.waitForURL('http://127.0.0.1:*/**');await page.locator('[contenteditable=true]').waitFor();await page.locator('#task-status-trigger').waitFor();
 const runtime=await native(({app,screen,BrowserWindow})=>({pid:process.pid,versions:process.versions,platform:process.platform,arch:process.arch,executable:process.execPath,profile:app.getPath('userData'),display:screen.getPrimaryDisplay(),windowId:BrowserWindow.getAllWindows()[0].getNativeWindowHandle().toString('hex')}));
 writeFileSync(join(root,mode+'-runtime.json'),JSON.stringify(runtime,null,2));
 const first=await measure('startup-no-preview');assert.equal(first.capability,!baseline,'actual WCO startup must identify native layout');
 if(!baseline){assert.equal(first.headerPadding,'88px');await resize(1440);await page.waitForFunction(()=>document.querySelector('.status-aside-slot').childElementCount===1);const status=await measure('1440-status');assert.equal(status.header.height,44);assert.equal(status.aside.width,320);}
 await open(0);
 for(const width of [1440,1080,801,800,799,380]){
  await resize(width,width===380?420:780);const m=await measure('preview-'+width),h=width<=800?52:44;
  assert.equal(m.header.height,h);assert.equal(m.bar.height,h);assert.equal(m.body.top-m.panel.top,h);assert.equal(m.overflow,0);assert.equal(m.outerRange,0);
  assert.equal(m.nativeInset,baseline?32:0);
  if(!baseline){assert.equal(m.buttonPosition.y,width<=800?19:15);assert.equal(m.headerPadding,'88px');}
  await page.screenshot({path:join(root,mode+'-renderer-'+width+'.png')});
 }
 record('actual product 1440/1080/801/800/799/380×420 geometry and original 44/52px row');
 if(!baseline){
  await resize(801);await page.locator('.preview-separator').focus();await page.keyboard.press('Home');
  const min=await measure('native-left-min-801');assert.ok(min.header.width>=239.5&&min.header.width<=241);assert.equal(await page.locator('.header-name').evaluate(e=>getComputedStyle(e).display),'none');
  assert.equal(await page.locator('.header-actions button').evaluateAll(a=>a.every(e=>{const r=e.getBoundingClientRect();return r.width===44&&r.height===44&&r.x>=88&&r.right<=240;})),true);
  await resize(1440);await page.locator('.preview-separator').focus();await page.keyboard.press('Home');assert.ok((await measure('native-left-min-1440')).header.width>=359);
  await page.keyboard.press('End');assert.ok((await measure('native-right-min-1440')).panel.width>=359);
  record('native left 240px plus 25%, preview 25–75%, original separator keyboard interaction');
  await resize(1080);await open(1);assert.equal(await page.locator('iframe[title="隔离 HTML 成果"]').getAttribute('sandbox'),'');
  await page.locator('.html-annotation-toggle').click();await page.locator('.html-annotation-toggle[aria-pressed=true]').waitFor();
  const html=page.frames().find(x=>x.url()==='about:srcdoc');assert.ok(html);await html.waitForFunction(()=>document.body.dataset.executions==='1');
  await page.evaluate(()=>{window.__titlebarFrame=document.querySelector('iframe[title="隔离 HTML 成果"]');window.__titlebarActions=document.querySelector('.canvas-tab-actions');window.__titlebarTab=document.querySelector('[role=tab][aria-selected=true]');window.__titlebarComposer=document.querySelector('[contenteditable=true]');});
  for(const width of [801,800,799,380,1440]){
   await resize(width);assert.equal(await page.evaluate(()=>window.__titlebarFrame===document.querySelector('iframe[title="隔离 HTML 成果"]')&&window.__titlebarActions===document.querySelector('.canvas-tab-actions')&&window.__titlebarTab===document.querySelector('[role=tab][aria-selected=true]')&&window.__titlebarComposer===document.querySelector('[contenteditable=true]')),true);assert.equal(await html.evaluate(()=>document.body.dataset.executions),'1');
  }
  await native(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setFullScreen(true));await page.waitForFunction(()=>!navigator.windowControlsOverlay.visible);
  assert.equal(await page.evaluate(()=>window.__titlebarFrame===document.querySelector('iframe[title="隔离 HTML 成果"]')&&document.querySelector('.app-shell').hasAttribute('data-native-titlebar')),true);
  assert.equal(await html.evaluate(()=>document.body.dataset.executions),'1');
  await native(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setFullScreen(false));await page.waitForFunction(()=>navigator.windowControlsOverlay.visible);
  assert.equal(await page.evaluate(()=>window.__titlebarFrame===document.querySelector('iframe[title="隔离 HTML 成果"]')&&window.__titlebarActions===document.querySelector('.canvas-tab-actions')),true);
  record('HTML explicit script boundary, iframe/tab/actions/composer identities through 800px and real fullscreen, no duplicate script');
  await page.locator('.html-annotation-toggle').click();await page.waitForFunction(()=>document.querySelector('iframe[title="隔离 HTML 成果"]').getAttribute('sandbox')==='');
  for(let n=2;n<files.length;n++)await open(n);
  assert.equal(await html.evaluate(()=>document.body.dataset.executions).catch(()=>null),null,'switching file destroys old HTML context');
  assert.equal(await page.locator('.canvas-tab-rail').evaluate(e=>e.scrollWidth>e.clientWidth),true);
  const drag=await page.evaluate(()=>Object.fromEntries(['.conversation-header','.canvas-tab-bar','.header-actions','.canvas-tab-rail','.canvas-tab','.canvas-tab-close','.canvas-tab-actions','.preview-separator'].map(s=>[s,getComputedStyle(document.querySelector(s)).getPropertyValue('-webkit-app-region')])));
  assert.equal(drag['.conversation-header'],'drag');assert.equal(drag['.canvas-tab-bar'],'drag');
  for(const [selector,v]of Object.entries(drag))if(!['.conversation-header','.canvas-tab-bar','.canvas-tab','.canvas-tab-close'].includes(selector))assert.equal(v,'no-drag',selector);
  // The visible rail owns no-drag; offscreen children must not subtract native
  // drag regions from the conversation header after a long horizontal scroll.
  assert.equal(drag['.canvas-tab'],'none');assert.equal(drag['.canvas-tab-close'],'none');
  await page.locator('.canvas-tab-close').last().click();await page.waitForFunction(()=>document.activeElement===document.querySelector('[role=tab][aria-selected=true]'));
  record('long rail, adjacent close focus, explicit no-drag controls/rail/actions/separator; old frame destroyed on file switch');
  await resize(801);await page.locator('.preview-separator').focus();await page.keyboard.press('Home');
  const beforeControls=await measure('native-controls-before');
  await page.getByRole('button',{name:'微信连接设置',exact:true}).click();await page.locator('.channel-dialog[open]').waitFor();
  await page.getByRole('button',{name:'关闭微信连接',exact:true}).click();await page.locator('.channel-dialog[open]').waitFor({state:'hidden'});
  await page.locator('#task-status-trigger').click();await page.locator('#task-status-panel').waitFor();
  await page.keyboard.press('Escape');await page.locator('#task-status-panel').waitFor({state:'hidden'});
  const tabsBefore=await page.getByRole('tab').count(),activeBefore=await page.locator('[role=tab][aria-selected=true]').getAttribute('aria-label');
  const preview=page.getByRole('button',{name:'预览',exact:true});
  await preview.click();await page.locator('#canvas-panel').waitFor({state:'hidden'});
  await preview.click();await page.locator('#canvas-panel').waitFor();
  assert.equal(await page.getByRole('tab').count(),tabsBefore);assert.equal(await page.locator('[role=tab][aria-selected=true]').getAttribute('aria-label'),activeBefore);
  assert.deepEqual((await measure('native-controls-after')).bounds,beforeControls.bounds);
  await page.locator('.canvas-tab-rail').evaluate(e=>{e.scrollLeft=e.scrollWidth;});
  const lastTab=page.getByRole('tab').last();await lastTab.hover();
  assert.ok((await lastTab.getAttribute('title')).endsWith('.txt'));
  assert.equal(await lastTab.evaluate(e=>e.matches(':hover')&&getComputedStyle(e).getPropertyValue('-webkit-app-region')==='none'),true);
  await lastTab.focus();await page.keyboard.press('Home');await page.keyboard.press('End');await page.keyboard.press('Enter');
  assert.equal(await lastTab.getAttribute('aria-selected'),'true');
  record('browser input reaches all three global controls at native 240px minimum; preview restores tabs, long-rail title/hover and keyboard activation remain available (not HID)');
  await resize(1080);await open(2);await page.locator('.image-annotation-toggle').click();await page.locator('.a9s-annotationlayer').waitFor();
  const image=page.locator('.image-annotation img');await image.evaluate(e=>e.decode());const r=await image.boundingBox();
  await page.mouse.move(r.x+r.width*.1,r.y+r.height*.15);await page.mouse.down();await page.mouse.move(r.x+r.width*.4,r.y+r.height*.65,{steps:6});await page.mouse.up();
  const textarea=page.locator('.annotation-comment-form textarea');await textarea.waitFor();await textarea.fill('原生窗口临时批注');
  await page.evaluate(()=>{window.__nativeImage=document.querySelector('.image-annotation img');window.__nativeAnnotator=document.querySelector('.a9s-annotationlayer');window.__nativeEditor=document.querySelector('.annotation-comment-form textarea');});
  const sameImage=()=>page.evaluate(()=>window.__nativeImage===document.querySelector('.image-annotation img')&&window.__nativeAnnotator===document.querySelector('.a9s-annotationlayer')&&window.__nativeEditor===document.querySelector('.annotation-comment-form textarea'));
  for(const width of [801,800,799,380,1080]){await resize(width);assert.equal(await sameImage(),true);assert.equal(await textarea.inputValue(),'原生窗口临时批注');}
  await native(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setFullScreen(true));await page.waitForFunction(()=>!navigator.windowControlsOverlay.visible);assert.equal(await sameImage(),true);
  assert.equal(await page.locator('.conversation-header').evaluate(e=>getComputedStyle(e).paddingLeft),'8px');
  await native(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setFullScreen(false));await page.waitForFunction(()=>navigator.windowControlsOverlay.visible);assert.equal(await sameImage(),true);
  await textarea.evaluate(e=>{e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});assert.equal(await textarea.inputValue(),'原生窗口临时批注');
  await page.waitForTimeout(40);await textarea.press('Enter');await page.waitForFunction(()=>!document.querySelector('.annotation-comment-form'));
  assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')).resourceReferences.find(r=>r.kind==='image').annotations[0].comment),'原生窗口临时批注');
  await open(0);assert.equal(await page.evaluate(()=>window.__nativeImage.isConnected||window.__nativeAnnotator.isConnected),false);
  record('same native image/editor and unsaved input through 800px and real fullscreen; IME guard, Enter saves main draft, file switch destroys annotator');
  await native(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items.find(x=>x.label==='关闭窗口').click());assert.equal((await measure('cmd-w-hidden')).visible,false);
  await native(({app})=>app.emit('activate'));assert.equal((await measure('activate-shown')).visible,true);
  await native(({BrowserWindow})=>new Promise(done=>{const w=BrowserWindow.getAllWindows()[0];w.once('hide',done);w.close();}));assert.equal((await measure('red-close-contract-hidden')).visible,false);await native(({app})=>app.emit('activate'));
  await native(({dialog,Menu})=>{dialog.showMessageBox=async()=>({response:0});Menu.getApplicationMenu().getMenuItemById('quit').click();});await page.waitForTimeout(100);assert.equal(electron.process().exitCode,null);
  record('original close event and Cmd-W hide, activate restores same window, quit cancellation keeps process');
 }
 assert.deepEqual(errors,[]);assert.equal(requests.filter(x=>x.method==='POST'&&x.path==='/api/messages').length,0);assert.equal(f.fakeEngine.invocations,0);
 record('zero model calls and message submissions');
 writeFileSync(join(root,mode+'-results.json'),JSON.stringify({passed:true,baseline,checks,metrics,errors,modelCalls:f.fakeEngine.invocations},null,2));

}catch(error){if(page)await page.screenshot({path:join(root,mode+'-failure.png')}).catch(()=>{});writeFileSync(join(root,mode+'-failure.json'),JSON.stringify({error:String(error.stack),checks,metrics,errors},null,2));throw error;}
finally{await quit();await f.close();}
