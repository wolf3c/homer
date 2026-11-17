// Isolated production-connection investigation. Never launches the Homer profile.
import{spawn}from'node:child_process';
import{createRequire}from'node:module';
import{mkdtemp,mkdir,writeFile,readFile,rm}from'node:fs/promises';
import{resolve,join}from'node:path';
import{chromium}from'playwright-core';
import assert from'node:assert/strict';
const require=createRequire(import.meta.url),root=await mkdtemp('/private/tmp/homer-connection-probe-');
const native=process.argv.includes('--native');
const out=resolve('outputs/browser-content-demo-2026-11-17/'+(native?'native-engine-probe':'connection-probe')+'.json');
const {source}=require('../../node_modules/playwright-core/lib/generated/injectedScriptSource.js');
await writeFile(join(root,'engine.json'),JSON.stringify(source));
await mkdir(resolve('outputs/browser-content-demo-2026-11-17'),{recursive:true});
const main=join(root,'main.cjs');let child,browser;
await writeFile(main,`const{app,BrowserWindow,WebContentsView}=require('electron');
app.setPath('userData',${JSON.stringify(join(root,'profile'))});
app.whenReady().then(async()=>{
 const host=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,sandbox:true,contextIsolation:true}});
 await host.loadURL('data:text/html,<title>management-sentinel</title><p>management-only</p>');
 const views=[];for(const id of ['a','b']){const v=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});v.webContents.on('console-message',details=>console.error('RENDERER',details.message));views.push(v);host.contentView.addChildView(v);await v.webContents.loadURL('data:text/html,<title>content-'+id+'</title><input aria-label="task">');v.setVisible(false);}
 const d=views[0].webContents.debugger;d.attach('1.3');const commands={};
 for(const name of ['Browser.getVersion','Target.getTargets','Target.attachToBrowserTarget'])try{commands[name]={result:await Promise.race([d.sendCommand(name),new Promise((_,reject)=>setTimeout(()=>reject(Error('command_timeout')),3000))])};}catch(e){commands[name]={error:e.message};}
 d.detach();
 const nativeValues=[];for(const [i,v] of views.entries()){
 const source=JSON.parse(require('node:fs').readFileSync(${JSON.stringify(join(root,'engine.json'))},'utf8'));
 await v.webContents.executeJavaScriptInIsolatedWorld(999,[{code:'(()=>{const module={exports:{}};'+source+';globalThis.pw=new (module.exports.InjectedScript())(window,{isUnderTest:false,sdkLanguage:"javascript",testIdAttributeName:"data-testid",customEngines:[],stableRafCount:1,browserName:"chromium",isUtilityWorld:true});})()'}]);
 const prepared=await v.webContents.executeJavaScriptInIsolatedWorld(999,[{code:${JSON.stringify('globalThis.pw.fill(globalThis.pw.querySelector(globalThis.pw.parseSelector(\'internal:role=textbox[name="task"s]\'),document,true),"native-input")')}}]);
 const debug=v.webContents.debugger;debug.attach('1.3');await debug.sendCommand('Input.insertText',{text:'native-task-'+i});debug.detach();
 const snapshot=await v.webContents.executeJavaScriptInIsolatedWorld(999,[{code:'({value:document.querySelector("input").value,snapshot:globalThis.pw.ariaSnapshot(document.body,{mode:"default"})})'}]);nativeValues.push({prepared,...snapshot});
 }
 process.stdout.write(JSON.stringify({kind:'ready',commands,nativeValues})+'\\n');
 process.stdin.resume();process.stdin.on('data',()=>{for(const v of views)v.webContents.close();host.destroy();app.quit();});
}).catch(e=>{console.error(e.stack);app.exit(1)});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let evidence;
try{
 child=spawn(require('electron'),[...(native?[]:['--remote-debugging-port=0','--remote-debugging-address=127.0.0.1']),main],{env,stdio:['pipe','pipe','pipe']});
 child.stderr.on('data',chunk=>process.stderr.write(chunk));
 evidence=await new Promise((accept,reject)=>{let buffer='';const timer=setTimeout(()=>reject(Error('probe_start_timeout')),20000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('probe_early_exit_'+code));});child.stdout.on('data',chunk=>{buffer+=chunk;for(const line of buffer.split('\n'))try{const v=JSON.parse(line);if(v.kind==='ready'){clearTimeout(timer);accept(v);}}catch{}});});
 if(!native){const [port]=String(await readFile(join(root,'profile','DevToolsActivePort'))).split('\n');
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:10000});
 const pages=browser.contexts().flatMap(c=>c.pages());evidence.visibleTargets=await Promise.all(pages.map(async p=>({url:p.url(),title:await p.title()})));
 const manager=pages.find(p=>p.url().includes('management-sentinel'));assert(manager);
 evidence.managementReadable=await manager.locator('p').textContent();
 const a=pages.find(p=>p.url().includes('content-a')),b=pages.find(p=>p.url().includes('content-b'));assert(a&&b);
 await Promise.all([a.getByLabel('task').fill('task-a'),b.getByLabel('task').fill('task-b')]);
 evidence.backgroundValues=await Promise.all([a.getByLabel('task').inputValue(),b.getByLabel('task').inputValue()]);
 evidence.conclusion='Public CDP controls both content pages AND the management renderer. Not enabled in product.';
 }else{assert.deepEqual(evidence.nativeValues.map(v=>v.value),['native-task-0','native-task-1']);evidence.conclusion='Reused Playwright injected selector/fill/ARIA engine over private webContents debugger, no public CDP port.';}
 await writeFile(out,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{
 if(browser)await browser.close();
 try{if(child&&child.exitCode===null){child.stdin.write('quit\n');await new Promise((accept,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('probe_exit_timeout'));},10000);child.once('exit',code=>{clearTimeout(timer);code===0?accept():reject(Error('probe_exit_'+code));});});}
 }finally{await rm(root,{recursive:true,force:true});}
}
