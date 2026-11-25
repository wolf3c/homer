import test from'node:test';
import assert from'node:assert/strict';
import{mkdtemp,mkdir,writeFile,readFile,readdir,rm,truncate,realpath,utimes,chmod}from'node:fs/promises';
import{resolve,join}from'node:path';
import{pathToFileURL}from'node:url';
import{createRequire}from'node:module';
import{createServer}from'node:http';
import{execFileSync}from'node:child_process';
import{_electron}from'playwright-core';
import{fixture}from'./fixtures/worker-chat-host.ts';
const until=async(check)=>{const end=performance.now()+4000;while(!await check()){if(performance.now()>end)throw Error('preview_test_wait_timeout');await new Promise(resolve=>setTimeout(resolve,5));}};
import{mcpCall}from'./fixtures/host-mcp-call.ts';
import{homerWebBridge}from'../src/web-homer.ts';
import{createWebServer}from'../src/web-server.ts';
import{previewFileCanOpen}from'../src/browser-preview.ts';
const require=createRequire(import.meta.url);
const ui=process.env.HOMER_PREVIEW_UI,runtime=process.env.HOMER_PREVIEW_RUNTIME,evidence=process.env.HOMER_PREVIEW_EVIDENCE;
if(!ui||!runtime||!evidence)throw Error('preview_electron_requires_explicit_ui_runtime_evidence');
test('desktop Preview links enforce source authority and preserve foreground ownership', {timeout:60000},()=>runPreview(true));
test('native HTML modal annotation preserves its draft and uses the real Composer', {timeout:60000},()=>runPreview(false,true));
test('real Preview UI, service provenance, Worker MCP and native page content close the synthetic loop', {timeout:120000},()=>runPreview(false));
test('desktop Preview locates linked source lines in Markdown and plain text', {timeout:60000},()=>runPreview(false,false,true));
test('desktop Preview more actions follow the current document and real native viewport', {timeout:60000},()=>runPreview(false,false,false,true));
async function runPreview(linksOnly,modalOnly=false,linesOnly=false,moreOnly=false){
 const scratch=await mkdtemp('/private/tmp/homer-preview-product-'),out=resolve(evidence,linksOnly?'links':modalOnly?'modal':linesOnly?'lines':moreOnly?'more':'.');await mkdir(out,{recursive:true});
 const openFilesDirectory=join(scratch,'exports'),oldExport=join(openFilesDirectory,'snapshot-staled');
 if(moreOnly){await mkdir(oldExport,{recursive:true});await utimes(oldExport,1,1);}
 const f=fixture();let electron,web,site,electronClosed=false;const checks=[],errors=[];let claimed,claimRelease,watchdog,releaseSlowPage,captureError;
 const slowPage=new Promise(resolve=>{releaseSlowPage=resolve;});
 const record=(name,detail)=>{checks.push({name,detail});console.log('PASS',name);};
 async function call(peer,name,args,id){const role=peer.options.role==='worker'?'worker':'main',argv=peer.options.interactionMcp.args;peer.emit('hostMcpToolStarted',{threadId:peer.threadId,turnId:peer.turnId,itemId:id,tool:name,arguments:args});const response=await mcpCall(argv[argv.indexOf(role)-1],name,args,{callId:id,'x-codex-turn-metadata':{turn_id:peer.turnId}});if(response.error)throw Error(response.error);return response.result;}
 try{
  site=createServer(async(req,res)=>{
   if(req.url==='/start'||req.url==='/explicit-start')await slowPage;
   res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
   if(req.url==='/link-source'){
    res.end('<!doctype html><meta charset="utf-8"><title>链接来源页</title><a href="/link-target" target="_blank">打开新页</a> <a href="/link-target">当前页跳转</a>');
    return;
   }
   if(req.url==='/link-target'||req.url==='/script-popup'){
    res.end('<!doctype html><meta charset="utf-8"><title>'+(req.url==='/link-target'?'新页目标':'脚本新页')+'</title>');
    return;
   }
   res.end('<!doctype html><meta charset="utf-8"><title>合成业务页面</title><style>body{font:18px/1.7 system-ui;padding:40px;background:#faf9f6;color:#233044}article{margin:24px 0;padding:24px;border:1px solid #ddd;background:white}input,button{font:inherit}h1{font-size:32px}</style><h1 id="heading">网页内容操作</h1><p>隔离产品源码验收 · 无真实账号</p><label>任务输入 <input aria-label="任务输入"></label><article><h2 id="target">需要完善的结论</h2><p>请在这里标记、备注并回到原对话草稿。</p></article><select aria-label="任务选项"><option value="a">甲</option><option value="b">乙</option></select><button id="business" onclick="this.textContent=\'已完成点击\'">业务操作</button><p><a href="/next">下一页</a></p><div style="height:500px"></div><h2 id="lower">页面下方的建议</h2>');
  });await new Promise(r=>site.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+site.address().port;
  const preload=(await readFile('packaging/electron/preload.cjs','utf8')).match(/ contextBridge\.exposeInMainWorld\('homerBrowserPreview',\{[\s\S]*?\n \}\);/)[0];
  await writeFile(join(scratch,'preload.cjs'),"const{contextBridge,ipcRenderer}=require('electron');\n"+preload);
  await writeFile(join(scratch,'main.cjs'),`const{app,BrowserWindow,ipcMain,shell}=require('electron');app.setPath('userData',${JSON.stringify(join(scratch,'profile'))});
  globalThis.revealRequests=[];shell.showItemInFolder=path=>globalThis.revealRequests.push(path);
  globalThis.openRequests=[];globalThis.browserRequests=[];globalThis.failOpen=false;
  shell.openPath=async path=>{globalThis.openRequests.push(path);return globalThis.failOpen?'simulated system failure':'';};
  shell.openExternal=async url=>{globalThis.browserRequests.push(url);if(globalThis.failOpen)throw Error('simulated system failure');};
  (async()=>{const{registerPreviewScheme,createBrowserPreview}=await import(${JSON.stringify(pathToFileURL(resolve('packaging/electron/preview-pages.mjs')).href)});registerPreviewScheme();await app.whenReady();
  const window=new BrowserWindow({width:1280,height:900,useContentSize:true,webPreferences:{preload:${JSON.stringify(join(scratch,'preload.cjs'))},contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const access={'X-Homer-Desktop-Access':process.env.TEST_ACCESS};
  window.webContents.session.webRequest.onBeforeSendHeaders({urls:[process.env.TEST_ORIGIN+'/api/*']},(details,callback)=>callback({requestHeaders:{...details.requestHeaders,...access}}));
  const messageFile=(suffix,input)=>fetch(process.env.TEST_ORIGIN+'/api/preview/message-file'+suffix,{method:'POST',headers:{...access,Origin:process.env.TEST_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify(input)});
  globalThis.testWindow=window;globalThis.preview=createBrowserPreview({window:()=>window,runtimeDirectory:${JSON.stringify(resolve(runtime))},preload:${JSON.stringify(resolve('packaging/electron/preview-content-preload.cjs'))},ipcMain,uiCaller:event=>event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame,
    openFilesDirectory:${JSON.stringify(openFilesDirectory)},fileCanOpen:${previewFileCanOpen.toString()},
    actOnMessageFile:async(action,input)=>{const res=await messageFile('/'+action,input),result=await res.json();if(!res.ok)throw Error(result.error);return result;},
    fetchMessageFile:(threadId,{messageId,destination})=>messageFile('',{threadId,messageId,destination}),
    fetchAttachment:(s,resource)=>fetch(process.env.TEST_ORIGIN+'/api/media/'+[s.messageId,s.assetId,s.revision].map(encodeURIComponent).join('/')+(resource?'/resource/'+encodeURIComponent(resource):''),{headers:access})});
  await window.loadURL(process.env.TEST_ORIGIN);window.on('closed',()=>{globalThis.preview.close();app.quit();});})().catch(e=>{console.error(e.stack);app.exit(1)});`);
  f.app.bindBrowserPreview((actor,action,input)=>electron.evaluate((_,a)=>globalThis.preview.execute(a.actor,a.action,a.input),{actor,action,input}).catch(error=>{throw Error(error.message.match(/(?:preview|artifact|media|message_file)_[a-z_]+/)?.[0]??'preview_result_unconfirmed');}));
  const quoteText='合成原文用于核对跨栏批注。'.repeat(10);
  f.setScript(async(main,text)=>{
   if(text.includes('接续任务页')){const pageId=text.match(/page-[a-f0-9-]{36}/)?.[0];assert.ok(pageId);claimed=await call(main,'preview_open',{pageId},'claim-user-reference');await new Promise(resolve=>{claimRelease=resolve;});return{status:'completed',text:'已接续同一页面'};}
   if(text==='Delegate both pages'){for(const goal of ['Operate page A','Operate page B']){const {taskId}=await main.call('task_create',{title:goal,goal});await main.call('worker_open',{taskId});}return{status:'completed',text:'两个合成任务已创建'};}
   const final={itemId:'preview-final',phase:'final_answer',text:text.includes('核对本地 HTML 的标题')||text.includes('核对第二处本地文本')||text.includes('测试本地图片批注')?'收到本地批注':text==='Emit Quote'?`${quoteText}\n\n[打开引用验收网页](${url}/quote)`:text==='Emit ZIP'?`[打开交付压缩包](${pathToFileURL(join(f.app.config.workspace,'delivered.zip')).href})`:text==='Emit Linked HTML'?`[打开附件方案](${pathToFileURL(join(f.app.config.workspace,'preview-linked.html')).href})`:text==='Emit HTML'?`HTML 已交付 [preview.html](${pathToFileURL(join(f.app.config.workspace,'preview.html')).href})`:`[打开业务网页](${url}/start)`};
   main.emit('agentMessage',{threadId:main.threadId,turnId:main.turnId,...final,completed:true});
   return{status:'completed',text:final.text,messages:[final]};
  });await f.app.start();await f.app.message('打开合成网页并批注','preview-fixture-source');
  const localPath=join(scratch,'current.md');
  const demoPath=join(scratch,'demo.html');
  await writeFile(localPath,'# 合成本地原文');
  f.app.history.record('desktop-local-fixture',f.app.store.meta('mainThread'),`[打开本地文档](${pathToFileURL(localPath).href})`);
  if(linksOnly){
   await writeFile(demoPath,`<!doctype html><title>本地 Demo</title><h1>交互页面</h1><a href="${url}/link-source">打开外部网页</a>`);
   await writeFile(localPath,'# 合成本地原文\n\n[交互 Demo](demo.html)');
   f.app.history.record('desktop-local-linked',f.app.store.meta('mainThread'),`[打开附有 Demo 的方案](${pathToFileURL(localPath).href}) · [已交付 Demo](${pathToFileURL(demoPath).href})`);
   f.app.history.record('desktop-link-source',f.app.store.meta('mainThread'),`[打开链接来源页](${url}/link-source)`);
  }
  const localHtml=join(scratch,'local.html');
  await writeFile(localHtml,'<!doctype html><meta charset="utf-8"><title>本地批注</title><h1 id="local-heading">合成本地 HTML</h1>');
  f.app.history.record('desktop-html-fixture',f.app.store.meta('mainThread'),`[打开本地 HTML](${pathToFileURL(localHtml).href})`);
  const archivePath=join(await realpath(scratch),'test-build.zip');
  await writeFile(archivePath,Buffer.from([80,75,3,4]));await truncate(archivePath,412*1024*1024);
  f.app.history.record('desktop-archive-fixture',f.app.store.meta('mainThread'),`[打开测试安装包](${pathToFileURL(archivePath).href})`);
  const codeString='`first\nsecond ${1}`';
  const codeTarget='\t跨行 <>& 检查\r\n*/ const value = '+codeString+';';
  const wrappedLine='// '+'wrap '.repeat(60);
  const codeSource='// context\r\n'.repeat(136)+wrappedLine+'\r\n/* before\r'+codeTarget+'\r\n';
  const codeBytes=Buffer.from('\uFEFF'+codeSource);
  const denseSource=('1;'.repeat(50)+'\n').repeat(320)+'const dense = 1;';
  const largeSource='// '+'x'.repeat(300)+'\r\n';
  if(linesOnly){
   const documentPath=join(scratch,'source.md'),plainPath=join(scratch,'source.txt');
   const paragraphs=Array.from({length:16},(_,index)=>`第 ${index+1} 段上下文。\n\n`).join('');
   await writeFile(documentPath,'# 合成产品定义\n\n'+paragraphs+'7. 前一项\n\n'+
    '8. **工具能力、权限与协作机制对 LLM 透明。** 优先删除不必要的隐性业务限制。\n\n'+paragraphs);
   await writeFile(plainPath,'A\r\n'.repeat(2000)+'目标文本');
   const shapes=join(scratch,'shapes.md'),shapeLink=pathToFileURL(shapes).href;
   await writeFile(shapes,['- 父项','  - 子项甲','  - 子项乙','','| 题 |','| --- |','| 数据 |','','```js','const value = 1;','```','','折行 $x','+y$ 公式正文','','$$','x^2','$$','','- 父项正文','  ## 项内标题','  项内尾段','  - 子项'].join('\n'));
   const md=pathToFileURL(documentPath).href,html=pathToFileURL(localHtml).href;
   const codePath=join(scratch,'source.ts'),densePath=join(scratch,'dense.ts'),largePath=join(scratch,'large.js');
   await writeFile(codePath,codeBytes);await writeFile(densePath,denseSource);
   await writeFile(largePath,largeSource.repeat(120)+'const large = 1;');
   f.app.history.record('desktop-syntax-fixture',f.app.store.meta('mainThread'),
    `[打开源码行](${pathToFileURL(codePath).href}:139) · [打开源码范围](${pathToFileURL(codePath).href}:139-141) · [打开高密度源码](${pathToFileURL(densePath).href}:321) · [打开长源码](${pathToFileURL(largePath).href}:121)`);
   await writeFile(localHtml,'<!doctype html>\n<meta charset="utf-8">\n<title>源码定位测试</title>\n<h1>页面原样</h1>');
   f.app.history.record('desktop-line-fixture',f.app.store.meta('mainThread'),
    `[打开第 37 行](${md}:37:3) · [打开跨段范围](${md}:35-37) · [打开空行](${md}:36) · [打开文本末行](${pathToFileURL(plainPath).href}:2001) · [打开 HTML 源码](${html}:4) · [打开列表范围](${shapeLink}:1-2) · [打开表格与代码范围](${shapeLink}:7-10) · [打开公式段落](${shapeLink}:13-14) · [打开显示公式](${shapeLink}:17) · [打开项内范围](${shapeLink}:21-22) · [打开越界范围](${shapeLink}:9-30)`);
  }
  const desktopAccessToken='a'.repeat(64);
  web=await createWebServer({bridge:homerWebBridge(f.app),port:0,uiDirectory:resolve(ui),desktopAccessToken});
  const env={...process.env,TEST_ORIGIN:web.url,TEST_ACCESS:desktopAccessToken};delete env.ELECTRON_RUN_AS_NODE;
  electron=await _electron.launch({executablePath:require('electron'),args:[join(scratch,'main.cjs')],env,timeout:30000});
  watchdog=setTimeout(()=>electron.process()?.kill('SIGKILL'),110000);
  const host=await electron.firstWindow();host.on('pageerror',e=>errors.push(e.message));
  const electronExit=new Promise(resolve=>electron.process().once('exit',(code,signal)=>resolve({code,signal})));
  const waitPage=async target=>{let p;await until(()=>!!(p=electron.context().pages().find(p=>p.url()===target)));return p;};
  async function annotationMode(active){const button=host.getByRole('button',{name:'批注',exact:true});await button.click();await host.waitForFunction(active=>document.querySelector('.preview-annotation-button')?.getAttribute('aria-pressed')===String(active),active);await host.waitForFunction(()=>document.querySelector('.preview-annotation-button')?.getAttribute('aria-busy')==='false');}
  async function hoverMatch(target,selector){await target.locator(selector).hover();await target.waitForFunction(selector=>{const h=document.querySelector('[data-homer-annotation]')?.shadowRoot?.querySelector('.annotation-hover-outline'),e=document.querySelector(selector);if(!h||!e)return false;const a=h.getBoundingClientRect(),b=e.getBoundingClientRect();return Math.abs(a.x-b.x)<1&&Math.abs(a.y-b.y)<1&&Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1;},selector);}
  if(modalOnly){
   await host.getByRole('link',{name:'打开业务网页',exact:true}).click();releaseSlowPage();
   const page=await waitPage(url+'/start');page.on('pageerror',error=>errors.push(error.message));
   const editor=page.locator('[data-homer-annotation] .editor');
   const input=page.getByRole('textbox',{name:'网页元素批注'});
   const editorBounds=()=>editor.evaluate(element=>{
    const {left,top,right,bottom}=element.getBoundingClientRect();
    return {left,top,right,bottom,width:innerWidth,height:innerHeight};
   });
   async function fittingEditor(){
    await input.waitFor();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const bounds=await editorBounds();
    const {left,top,right,bottom,width,height}=bounds;
    assert.ok(left>=-1&&top>=-1&&right<=width+1&&bottom<=height+1,JSON.stringify(bounds));
    return bounds;
   }
   await annotationMode(true);
   await page.locator('#target').click();
   const small=await fittingEditor();
   assert.ok(Math.abs(small.top-(await page.locator('#target').evaluate(element=>element.getBoundingClientRect().bottom))-8)<2);
   await input.fill('普通网页对照');
   await input.press('Enter');
   await host.locator('.annotation-chip').filter({hasText:'普通网页对照'}).waitFor();
   const originalSize=await electron.evaluate(()=>globalThis.testWindow.getContentSize());
   await electron.evaluate(()=>globalThis.testWindow.setContentSize(1160,410));
   await page.waitForFunction(()=>innerHeight>=270&&innerHeight<=345);
   await page.evaluate(()=>{
    const target=document.createElement('article');
    target.id='long-target';target.textContent='用于验证裁切的高元素';
    target.style.cssText='position:absolute;top:160px;right:0;width:90px;height:900px;margin:0;padding:0';
    const end=document.createElement('div');
    end.style.height='1800px';
    document.body.append(target,end);scrollTo(0,0);
   });
   const longTarget=page.locator('#long-target');
   await longTarget.click({position:{x:40,y:24}});
   const anchor=await longTarget.evaluate(element=>{
    const {top,bottom}=element.getBoundingClientRect();
    return {top,bottom};
   });
   assert.deepEqual(anchor,{top:160,bottom:1062});
   const compact=await fittingEditor();
   await input.fill('边缘位置的草稿');
   if(process.platform==='darwin'){
    const id=await electron.evaluate(()=>globalThis.testWindow.getMediaSourceId().split(':')[1]);
    execFileSync('/usr/sbin/screencapture',['-x','-l',id,join(out,'web-editor-native-window.png')],{timeout:10000});
   }
   await input.press('Shift+Enter');
   await page.keyboard.insertText('滚动后仍可编辑');
   await page.evaluate(()=>scrollTo(0,1200));
   await page.waitForFunction(()=>document.querySelector('#long-target').getBoundingClientRect().bottom<0);
   const offscreen=await fittingEditor();
   assert.ok(offscreen.top<compact.top);
   assert.equal(await input.inputValue(),'边缘位置的草稿\n滚动后仍可编辑');
   assert.equal(await input.evaluate(element=>element.getRootNode().activeElement===element),true);
   await page.evaluate(()=>scrollTo(0,0));
   await until(async()=>Math.abs((await editorBounds()).top-compact.top)<2);
   const pageZoom=await electron.evaluate(({webContents},url)=>{
    const contents=webContents.getAllWebContents().find(contents=>contents.getURL()===url);
    contents.setZoomFactor(1.25);return contents.getZoomFactor();
   },page.url());
   assert.equal(pageZoom,1.25);
   await page.waitForFunction(height=>innerHeight<height,compact.height);
   const zoomed=await fittingEditor();
   const hostScale=await host.evaluate(()=>devicePixelRatio);
   await electron.evaluate(({webContents},url)=>{
    webContents.getAllWebContents().find(contents=>contents.getURL()===url).setZoomFactor(1);
    globalThis.testWindow.webContents.setZoomFactor(1.25);
   },page.url());
   await host.waitForFunction(scale=>Math.abs(devicePixelRatio-scale*1.25)<0.01,hostScale);
   await page.waitForFunction(height=>innerHeight>height,zoomed.height);
   const hostZoomed=await fittingEditor();
   await electron.evaluate(()=>globalThis.testWindow.setContentSize(1160,270));
   await page.waitForFunction(()=>innerHeight<190);
   const short=await fittingEditor();
   assert.equal(await input.inputValue(),'边缘位置的草稿\n滚动后仍可编辑');
   await input.press('Tab');
   const cancel=page.getByRole('button',{name:'取消',exact:true});
   assert.ok(await cancel.evaluate(element=>element.getRootNode().activeElement===element));
   assert.ok(await cancel.evaluate(element=>element.closest('form').scrollTop>0));
   await page.keyboard.press('Escape');
   await input.waitFor({state:'detached'});
   assert.equal(await host.locator('.annotation-chip').filter({hasText:'边缘位置的草稿'}).count(),0);
   await longTarget.evaluate(element=>{
    element.textContent='底边短目标';
    element.style.cssText='position:fixed;bottom:0;left:0;width:120px;height:26px;margin:0;padding:0';
   });
   await longTarget.click();
   const bottomEdge=await fittingEditor();
   await cancel.click();
   await input.waitFor({state:'detached'});
   await electron.evaluate((_,size)=>{
    globalThis.testWindow.webContents.setZoomFactor(1);globalThis.testWindow.setContentSize(...size);
   },originalSize);
   await page.waitForFunction(height=>innerHeight>height,compact.height);
   record('long and offscreen targets keep the real editor in the native viewport through scroll and zoom',{small,anchor,compact,offscreen,zoomed,hostZoomed,short,bottomEdge});
   await page.evaluate(()=>{
    const lower=document.createElement('dialog'),upper=document.createElement('dialog');
    lower.id='annotation-modal';upper.id='annotation-upper';
    lower.style.cssText='width:350px;max-height:70vh;transform:translateX(22px);overflow:hidden';
    lower.innerHTML='<div id="annotation-scroll" style="height:220px;overflow:auto"><p style="height:40px">网页模态</p><button id="modal-target">模态内的原始内容</button><div style="height:400px"></div></div>';
    upper.innerHTML='<button autofocus>上层网页模态</button>';
    document.body.append(lower,upper);lower.showModal();
   });
   await hoverMatch(page,'#modal-target');
   const modalHost=page.locator('#annotation-modal > [data-homer-annotation]:popover-open');
   await modalHost.waitFor({state:'attached',timeout:3000});
   assert.equal(await modalHost.locator('.annotation-marker').count(),0);
   await page.locator('#modal-target').click();
   const modalBounds=await fittingEditor();
   const modalAnchorBottom=await page.locator('#modal-target').evaluate(element=>element.getBoundingClientRect().bottom);
   assert.ok(Math.abs(modalBounds.top-modalAnchorBottom-8)<2,JSON.stringify({modalBounds,modalAnchorBottom}));
   const modalInput=modalHost.getByRole('textbox',{name:'网页元素批注'});
   await modalInput.click();await modalInput.fill('下层草稿不可丢失');
   await page.screenshot({path:join(out,'web-modal-editor.png')});
   await page.evaluate(()=>document.querySelector('#annotation-upper').showModal());
   assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'上层网页模态');
   assert.equal(await modalInput.inputValue(),'下层草稿不可丢失');
   assert.equal(await modalInput.evaluate(element=>{const rect=element.getBoundingClientRect();return document.elementFromPoint(rect.x+10,rect.y+10)===element.getRootNode().host;}),false);
   await page.evaluate(()=>{const lower=document.querySelector('#annotation-modal');lower.tabIndex=-1;document.querySelector('#annotation-upper').close();lower.focus();});
   assert.equal(await modalInput.inputValue(),'下层草稿不可丢失');
   assert.equal(await page.evaluate(()=>document.activeElement?.id),'annotation-modal');
   const popupTop=await modalInput.evaluate(element=>element.getBoundingClientRect().top);
   await page.evaluate(()=>{document.querySelector('#annotation-scroll').scrollTop=35;});
   await until(async()=>Math.abs(await modalInput.evaluate(element=>element.getBoundingClientRect().top)-popupTop+35)<2);
   await electron.evaluate(()=>{
    const contents=globalThis.testWindow.webContents,send=contents.send;
    contents.send=function(channel,...args){
     if(channel==='homer:preview:annotation'){
      contents.send=send;
      args[0]={...args[0],baseRevision:-1};
     }
     return send.call(contents,channel,...args);
    };
   });
   await modalHost.getByRole('button',{name:'保存',exact:true}).click();
   await modalHost.getByRole('alert').filter({hasText:'输入已保留'}).waitFor();
   assert.equal(await modalInput.inputValue(),'下层草稿不可丢失');
   assert.equal(await host.locator('.annotation-chip').filter({hasText:'下层草稿不可丢失'}).count(),0);
   await modalHost.getByRole('button',{name:'保存',exact:true}).click();
   await host.locator('.annotation-chip').filter({hasText:'下层草稿不可丢失'}).waitFor();
   await modalHost.getByRole('button',{name:'批注 2',exact:true}).click();await modalInput.fill('替换目标后仍保留草稿');
   await page.evaluate(()=>{const target=document.querySelector('#modal-target');const replacement=target.cloneNode(true);replacement.textContent='替换后的内容';target.replaceWith(replacement);});
   assert.equal(await modalInput.inputValue(),'替换目标后仍保留草稿');
   assert.equal(await modalHost.locator('blockquote').textContent(),'模态内的原始内容');
   await page.evaluate(()=>document.querySelector('#annotation-modal').close());
   const documentHost=page.locator('body > [data-homer-annotation]');
   await documentHost.getByRole('textbox',{name:'网页元素批注'}).waitFor();
   assert.equal(await documentHost.getByRole('textbox',{name:'网页元素批注'}).inputValue(),'替换目标后仍保留草稿');
   await documentHost.getByRole('button',{name:'取消',exact:true}).click();
   assert.equal(await host.locator('.annotation-chip').filter({hasText:'替换目标后仍保留草稿'}).count(),0);
   assert.equal(await documentHost.getByRole('button',{name:'批注 2',exact:true}).count(),0);
   await host.locator('.composer-area .annotation-chip').filter({hasText:'下层草稿不可丢失'}).locator('.annotation-chip-remove').click();
   await page.evaluate(()=>{document.querySelector('#annotation-modal').remove();document.querySelector('#annotation-upper').remove();});
   record('native dialog annotations keep lower drafts, anchor during scroll, and do not rebind removed targets',{modalBounds,modalAnchorBottom});
   await page.evaluate(()=>{
    const portal=document.createElement('div');
    portal.setAttribute('role','dialog');portal.style.cssText='position:fixed;inset:20% auto auto 20%;z-index:50;transform:translateX(10px);background:white;padding:20px';
    portal.innerHTML='<button id="portal-target">CSS 弹窗内容</button>';document.body.append(portal);
   });
   await hoverMatch(page,'#portal-target');
   await page.locator('#portal-target').click();
   await documentHost.getByRole('textbox',{name:'网页元素批注'}).fill('普通 CSS 弹窗对照');
   await documentHost.getByRole('button',{name:'取消',exact:true}).click();
   assert.equal(await documentHost.evaluate(element=>element.hasAttribute('popover')),false);
   record('CSS portal keeps the existing body annotation path');
   assert.deepEqual(errors,[]);
   const versions=await electron.evaluate(()=>({electron:process.versions.electron,chromium:process.versions.chrome}));
   await electron.close();const exit=await electronExit;assert.deepEqual(exit,{code:0,signal:null});
   clearTimeout(watchdog);electronClosed=true;
   await writeFile(join(out,'modal-report.json'),JSON.stringify({checks,versions,errors,exit,watchdog:false},null,2));
   return;
  }
  await host.getByRole('link',{name:'打开本地文档',exact:true}).click();
  await host.getByRole('heading',{name:'合成本地原文',exact:true}).waitFor();
  if(moreOnly){
   const more=host.getByRole('button',{name:'更多',exact:true});
   const item=name=>host.getByRole('menuitem',{name,exact:true});
   const menu=host.locator('[role="menu"].preview-more-menu');
   const closeTab=name=>host.getByRole('button',{name:'关闭'+name,exact:true}).click();
   const snapshot=await realpath(localPath);
   const dispatches=()=>electron.evaluate(()=>({files:globalThis.openRequests,urls:globalThis.browserRequests,reveal:globalThis.revealRequests}));
   await more.press('ArrowDown');
   await until(()=>item('在 Finder 中显示').evaluate(el=>el===document.activeElement));
   await item('在 Finder 中显示').press('End');
   await item('用默认应用打开').press('Enter');
   await host.getByText('已向系统发送打开请求。',{exact:true}).waitFor();
   assert.deepEqual((await dispatches()).files,[snapshot]);
   await more.click();
   await item('在 Finder 中显示').click();
   await host.getByText('已请求在系统中显示文件。',{exact:true}).waitFor();
   assert.deepEqual((await dispatches()).reveal,[snapshot]);
   await more.click();await menu.waitFor();
   await item('用默认应用打开').evaluate(el=>el.click());
   assert.equal((await dispatches()).files.length,1);
   await rm(localPath);
   await more.click();await item('用默认应用打开').click();
   await host.getByText('找不到本地原件。',{exact:true}).waitFor();
   assert.equal((await dispatches()).files.length,1);
   await closeTab('current.md');
   await host.getByRole('link',{name:'打开本地 HTML',exact:true}).click();
   await (await waitNative('/local/index.html')).getByRole('heading',{name:'合成本地 HTML'}).waitFor();
   await more.click();await item('用默认应用打开').click();
   await until(async()=>(await dispatches()).files.length===2);
   assert.equal((await dispatches()).files[1],await realpath(localHtml));
   await closeTab('本地批注');
   const disguised=join(scratch,'disguised.md');
   await writeFile(disguised,'#!synthetic\n');
   f.app.history.record('desktop-disguised-fixture',f.app.store.meta('mainThread'),`[打开伪装文件](${pathToFileURL(disguised).href})`);
   await host.getByRole('link',{name:'打开伪装文件',exact:true}).click();
   await more.click();await item('用默认应用打开').click();
   await host.getByText('此文件类型暂不支持用默认应用打开。',{exact:true}).waitFor();
   assert.equal((await dispatches()).files.length,2);
   await closeTab('disguised.md');
   const managedBinary=join(f.app.config.runtime,'managed-binary.md');
   await writeFile(managedBinary,Buffer.from([0,1,2,3]));
   f.app.history.record('desktop-managed-binary',f.app.store.meta('mainThread'),`[打开管理目录二进制](${pathToFileURL(managedBinary).href})`);
   await host.getByRole('link',{name:'打开管理目录二进制',exact:true}).click();
   const managedReveal=host.getByRole('button',{name:'在文件夹中显示',exact:true});
   await managedReveal.waitFor();
   await host.getByRole('button',{name:'用默认应用打开',exact:true}).click();
   await host.getByText('无法用默认应用打开此文件。',{exact:true}).waitFor();
   assert.equal((await dispatches()).files.length,2);
   await managedReveal.click();
   await host.getByText('已请求在系统中显示文件。',{exact:true}).waitFor();
   assert.equal((await dispatches()).reveal.at(-1),await realpath(managedBinary));
   await electron.evaluate(()=>{globalThis.revealRequests.pop();});
   await closeTab('managed-binary.md');
   const managed=join(f.app.config.runtime,'managed-preview.html');
   await writeFile(managed,'<meta charset="utf-8"><title>管理目录预览</title><h1>合成管理文件</h1>');
   const managedUrl=pathToFileURL(managed).href;
   const threadId=f.app.store.meta('mainThread');
   f.app.history.record('desktop-managed-html',threadId,`[打开管理文件](${managedUrl})`);
   await host.getByRole('link',{name:'打开管理文件',exact:true}).click();
   const managedPage=await waitNative('/local/index.html');
   await managedPage.getByRole('heading',{name:'合成管理文件'}).waitFor();
   const managedSource=(await host.evaluate(id=>window.homerBrowserPreview.list(id),threadId)).find(page=>page.source.destination===managedUrl);
   assert.ok(managedSource);
   const read=await electron.evaluate((_,page)=>globalThis.preview.execute({owner:page.owner,threadId:page.threadId},'read',{pageId:page.id,document:page.document}),managedSource);
   assert.match(read.content,/合成管理文件/);
   if(process.platform!=='win32'&&process.getuid?.()!==0){
    await chmod(managed,0);
    try{
     await host.getByRole('button',{name:'重新加载',exact:true}).click();
     await host.getByRole('alert').filter({hasText:'无法读取本地文件'}).waitFor();
     await host.screenshot({path:join(out,'managed-html-read-denied.png')});
     await host.getByRole('button',{name:'在文件夹中显示',exact:true}).click();
     await host.getByText('已请求在系统中显示文件。',{exact:true}).waitFor();
     assert.equal((await dispatches()).reveal.at(-1),await realpath(managed));
     await electron.evaluate(()=>{globalThis.revealRequests.pop();});
    }finally{await chmod(managed,0o600);}
   }
   await closeTab(process.platform!=='win32'&&process.getuid?.()!==0?'managed-preview.html':'管理目录预览');
   record('managed HTML supports Agent reads and falls back to reveal after OS read denial');
   record('trusted keyboard and pointer actions revalidate and dispatch the current original, including native local HTML');
   const zip=join(scratch,'资料.zip');
   await writeFile(zip,Buffer.from([80,75,3,4,0]));
   f.app.history.record('desktop-zip-fixture',f.app.store.meta('mainThread'),`[打开本地压缩包](${pathToFileURL(zip).href})`);
   await host.getByRole('link',{name:'打开本地压缩包',exact:true}).click();
   const reveal=host.getByRole('button',{name:'在文件夹中显示',exact:true});
   await reveal.waitFor();
   assert.equal(await more.count(),0);
   assert.equal(await host.locator('#canvas-panel .preview-toolbar').isVisible(),false);
   assert.equal(await host.getByRole('button',{name:'用默认应用打开'}).count(),0);
   await reveal.press('Enter');
   await host.getByText('已请求在系统中显示文件。',{exact:true}).waitFor();
   assert.deepEqual((await dispatches()).reveal,[snapshot,await realpath(zip)]);
   await host.screenshot({path:join(out,'file-fallback-1280.png')});
   await electron.evaluate(()=>globalThis.testWindow.setContentSize(390,760));
   await until(()=>host.evaluate(()=>innerWidth===390));
   assert.ok((await reveal.boundingBox()).height>=44);
   await host.screenshot({path:join(out,'file-fallback-390.png')});
   await electron.evaluate(()=>globalThis.testWindow.setContentSize(1280,900));
   await rm(zip);
   await reveal.click();
   await host.getByRole('alert').filter({hasText:'找不到本地文件'}).waitFor();
   assert.equal(await reveal.count(),0);
   assert.equal((await dispatches()).reveal.length,2);
   await writeFile(zip,Buffer.from([80,75,3,4,0]));
   await host.getByRole('button',{name:'重试读取',exact:true}).click();
   await reveal.waitFor();
   await rm(zip);
   await mkdir(zip);
   await reveal.click();
   await host.getByRole('alert').filter({hasText:'普通文件'}).waitFor();
   assert.equal(await reveal.count(),0);
   assert.equal((await dispatches()).reveal.length,2);
   await closeTab('资料.zip');
   record('local ZIP fallback exposes one trusted reveal action and clears it after deletion');

   const deliveredZip=join(f.app.config.workspace,'delivered.zip');
   const deliveredBytes=Buffer.from([80,75,3,4,1,2,3]);
   await writeFile(deliveredZip,deliveredBytes);
   await f.app.message('Emit ZIP','more-zip-fixture');
   await host.getByRole('link',{name:'打开交付压缩包',exact:true}).click();
   const downloadZip=host.getByRole('button',{name:'下载文件',exact:true});
   await downloadZip.waitFor();
   assert.equal(await more.count(),0);
   assert.equal(await host.locator('#canvas-panel [data-slot="file-download"]').count(),0);
   await writeFile(deliveredZip,'changed original');
   await electron.evaluate((_,path)=>globalThis.testWindow.webContents.session.once('will-download',(_event,download)=>download.setSavePath(path)),join(scratch,'downloaded.zip'));
   await downloadZip.click();
   await until(async()=>deliveredBytes.equals(await readFile(join(scratch,'downloaded.zip')).catch(()=>Buffer.alloc(0))));
   const zipReply=f.app.store.db.prepare("SELECT replyId FROM conversation_inputs WHERE requestId='more-zip-fixture'").get().replyId;
   f.app.history.revokeMessage(f.app.store.meta('mainThread'),zipReply);
   await downloadZip.click();
   await host.getByRole('alert').filter({hasText:'交付版本不可用'}).waitFor();
   assert.equal(await downloadZip.count(),0);
   await host.getByRole('button',{name:'关闭文件：delivered.zip',exact:true}).click();
   record('attachment ZIP offers one download and never substitutes changed original bytes or a revoked snapshot');



   const original=join(f.app.config.workspace,'preview-linked.html');
   const delivered='<meta charset="utf-8"><title>附件方案</title><a href="child.html">打开相邻 HTML</a>';
   await writeFile(original,delivered);
   await writeFile(join(f.app.config.workspace,'child.html'),'<meta charset="utf-8"><title>附件相邻页</title>');
   await f.app.message('Emit Linked HTML','more-html-fixture');
   await host.getByRole('link',{name:'打开附件方案',exact:true}).click();
   const attachment=await waitNative('/attachment/index.html');
   const siblingLink=await attachment.getByRole('link',{name:'打开相邻 HTML'}).boundingBox();
   await attachment.mouse.click(siblingLink.x+siblingLink.width/2,siblingLink.y+siblingLink.height/2);
   await host.getByRole('tab',{name:'附件相邻页',selected:true}).waitFor();
   assert.equal(await more.count(),0);
   await closeTab('附件相邻页');
   await attachment.evaluate(()=>history.pushState({},'','?state=retained'));
   await writeFile(original,'changed original');
   await more.click();await item('用默认应用打开').click();
   await until(async()=>(await dispatches()).files.length===3);
   const copy=(await dispatches()).files[2];
   assert.ok(copy.startsWith(openFilesDirectory+'/snapshot-')&&copy.endsWith('.html'));
   assert.equal(await readFile(copy,'utf8'),delivered);
   const retained=await readdir(openFilesDirectory);assert.equal(retained.length,1);
   await electron.evaluate((_,path)=>globalThis.testWindow.webContents.session.once('will-download',(_event,download)=>download.setSavePath(path)),join(scratch,'downloaded.html'));
   await more.click();await item('下载').press('Space');
   await until(async()=>await readFile(join(scratch,'downloaded.html'),'utf8').catch(()=>undefined)===delivered);
   await electron.evaluate(()=>{globalThis.failOpen=true;});
   await more.click();await item('用默认应用打开').click();
   await host.getByText('系统未能打开目标，请核对默认应用或浏览器设置。',{exact:true}).waitFor();
   assert.deepEqual(await readdir(openFilesDirectory),retained);
   await electron.evaluate(()=>{globalThis.failOpen=false;});
   const replyId=f.app.store.db.prepare("SELECT replyId FROM conversation_inputs WHERE requestId='more-html-fixture'").get().replyId;
   f.app.history.revokeMessage(f.app.store.meta('mainThread'),replyId);
   await more.click();await item('用默认应用打开').click();
   await host.getByText('此文件的交付版本不可用，请重新打开。',{exact:true}).waitFor();
   assert.equal((await dispatches()).files.length,4);
   await closeTab('附件方案');
   record('fixed HTML bytes survive original changes; real download, expiry, rejected handoff and sibling identity are verified');

   await host.getByRole('link',{name:'打开业务网页',exact:true}).click();releaseSlowPage();
   const native=await waitPage(url+'/start');
   const nativeState=()=>electron.evaluate((_,address)=>{
    const view=globalThis.testWindow.contentView.children.find(view=>view.webContents?.getURL()===address);
    return view&&{bounds:view.getBounds(),visible:view.getVisible()};
   },native.url());
   for(const width of [1280,390]){
    await electron.evaluate((_,width)=>globalThis.testWindow.setContentSize(width,840),width);
    await until(()=>host.evaluate(width=>innerWidth===width,width));
    const viewport=host.locator('.browser-preview-viewport');
    await until(async()=>Math.abs((await nativeState()).bounds.y-(await viewport.boundingBox()).y)<=1);
    const base=(await nativeState()).bounds;
    await more.press('ArrowDown');await menu.waitFor();
    await until(async()=>{
     const {visible,bounds}=await nativeState(),box=await menu.boundingBox();
     return visible&&bounds.y>=box.y+box.height-1&&bounds.y>base.y;
    });
    const box=await menu.boundingBox();
    assert.ok(box.x>=0&&box.x+box.width<=width);
    await host.screenshot({path:join(out,'web-menu-'+width+'.png')});
    await item('在默认浏览器中打开').press('Escape');
    await menu.waitFor({state:'hidden'});
    await until(async()=>await more.evaluate(el=>el===document.activeElement)&&(await nativeState()).bounds.y===base.y);
   }
   await more.click();await menu.waitFor();
   await item('在默认浏览器中打开').press('Tab');
   await menu.waitFor({state:'hidden'});
   await more.click();await menu.waitFor();
   await native.mouse.click(12,32);
   await menu.waitFor({state:'hidden',timeout:3000});
   const target=url+'/next?x=%2F&y=2#part';
   await more.click();await menu.waitFor();
   await native.evaluate(address=>history.pushState({},'',address),target);
   await menu.waitFor({state:'hidden'});
   await more.click();await item('在默认浏览器中打开').click();
   await until(async()=>(await dispatches()).urls.length===1);
   assert.deepEqual((await dispatches()).urls,[target]);
   await electron.evaluate(()=>globalThis.testWindow.setContentSize(1280,840));
   await more.click();await menu.waitFor();
   await host.getByRole('button',{name:'定时任务',exact:true}).click();
   await host.getByRole('tab',{name:'定时任务',selected:true}).waitFor();
   assert.equal(await more.count(),0);
   record('wide and narrow native views yield actual space, Escape restores focus, original URL survives navigation');
   assert.deepEqual(errors,[]);
   await electron.close();const exit=await electronExit;assert.deepEqual(exit,{code:0,signal:null});
   clearTimeout(watchdog);electronClosed=true;
   await writeFile(join(out,'more-report.json'),JSON.stringify({checks,errors,exit,watchdog:false},null,2));
   return;
  }
  async function waitNative(suffix){
   let view;await until(()=>!!(view=electron.context().pages().find(page=>page.url().endsWith(suffix))));return view;
  }
  if(linesOnly){
   const panel=host.locator('#canvas-panel'),body=panel.locator('[data-slot=canvas-split-body]');
   const target=body.locator('[data-preview-source-target]');
   async function located(text,tag,count=1){
    await host.waitForFunction(({text,tag,count})=>{
     const body=document.querySelector('#canvas-panel [data-slot=canvas-split-body]');
     const target=body?.querySelector('[data-preview-source-target]');
     if(!target||target.tagName!==tag||!target.textContent.includes(text))return false;
     const box=target.getBoundingClientRect(),view=body.getBoundingClientRect();
     return box.top>=view.top && box.top<view.bottom && body.querySelectorAll('[data-preview-source-target]').length===count;
    },{text,tag,count},{timeout:3500});
   }
   const open=host.getByRole('link',{name:'打开第 37 行',exact:true});
   await open.click();
   await panel.getByText('源文件第 37 行',{exact:true}).waitFor({timeout:3500});
   await located('工具能力、权限与协作机制','P');
   await host.screenshot({path:join(out,'markdown-wide.png')});
   const tabCount=await panel.getByRole('tab').count();
   await body.evaluate(node=>node.scrollTop=0);
   const reread=host.waitForResponse(response=>new URL(response.url()).pathname==='/api/preview/message-file');
   await open.focus();await open.press('Enter');
   assert.equal((await reread).status(),200);
   await located('工具能力、权限与协作机制','P');
   assert.equal(await panel.getByRole('tab').count(),tabCount);
   await electron.evaluate(()=>testWindow.setContentSize(760,800));
   await panel.getByRole('button',{name:'收起预览',exact:true}).click();
   await open.focus();await open.press('Enter');
   await located('工具能力、权限与协作机制','P');
   await host.screenshot({path:join(out,'markdown-narrow.png')});
   async function openOther(name){
    await panel.getByRole('button',{name:'收起预览',exact:true}).click();
    await host.getByRole('link',{name,exact:true}).click();
   }
   for(const [width,name,label] of [[1280,'打开源码行','139'],[760,'打开源码范围','139–141']]){
    await electron.evaluate((_,width)=>testWindow.setContentSize(width,800),width);
    await openOther(name);
    await panel.getByText(`源文件第 ${label} 行`,{exact:true}).waitFor();
    await located('跨行 <>& 检查','MARK');
    const source=body.locator('pre[data-preview-text]');
    assert.equal(await source.textContent(),codeSource);
    assert.equal(await target.textContent(),width===760?codeTarget:'\t跨行 <>& 检查');
    assert.equal(await target.locator('.hljs-comment').count(),1);
    assert.equal(await target.locator('.hljs-comment').textContent(),width===760?'\t跨行 <>& 检查\r\n*/':'\t跨行 <>& 检查');
    assert.equal(await source.locator('.hljs-keyword').textContent(),'const');
    assert.equal(await source.locator('.hljs-string').textContent(),codeString);
    assert.equal(await source.locator('.hljs-string .hljs-subst').textContent(),'${1}');
    assert.ok(await source.locator('.hljs-comment').filter({hasText:wrappedLine.trim()}).evaluate(element=>element.getClientRects().length>1));
    assert.equal(await source.evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);return range.toString();}),codeSource);
    assert.ok(await target.evaluate(mark=>{
     const luminance=color=>color.match(/\d+/g).slice(0,3).map(Number).map(value=>value/255)
      .map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4)
      .reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
     const background=luminance(getComputedStyle(mark).backgroundColor);
     return [...mark.querySelectorAll('span')].every(span=>(background+0.05)/(luminance(getComputedStyle(span).color)+0.05)>=4.5);
    }));
    await host.screenshot({path:join(out,`syntax-${width}.png`)});
   }
   const selectedCode='const value = '+codeString;
   assert.equal(await target.evaluate(mark=>{
    const range=document.createRange();
    const start=mark.querySelector('.hljs-keyword').firstChild,end=mark.querySelector('.hljs-string').lastChild;
    range.setStart(start,0);range.setEnd(end,end.length);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    return range.toString();
   }),selectedCode);
   await host.locator('[data-slot=selection-toolbar-quote]').click();
   await host.getByRole('textbox',{name:/文件批注/}).fill('保留跨语法标记的源码选区');
   await host.getByRole('button',{name:'保存',exact:true}).click();
   await host.locator('.composer-area .annotation-chip').filter({hasText:'保留跨语法标记的源码选区'}).waitFor();
   await host.waitForFunction(code=>[...CSS.highlights.values()].some(highlight=>[...highlight].some(range=>range.toString()===code)),selectedCode);
   const downloadedCode=join(scratch,'downloaded.ts');
   await electron.evaluate((_,path)=>testWindow.webContents.session.once('will-download',(_event,download)=>download.setSavePath(path)),downloadedCode);
   await panel.locator('[data-slot=file-download]').click();
   await until(async()=>codeBytes.equals(await readFile(downloadedCode).catch(()=>Buffer.alloc(0))));
   let opened=performance.now();
   await openOther('打开高密度源码');
   await located('const dense = 1;','MARK');
   const denseOpenMs=Math.round(performance.now()-opened);
   assert.equal(await body.locator('pre').textContent(),denseSource);
   assert.equal(await body.locator('pre span').count(),0);
   opened=performance.now();
   await openOther('打开长源码');
   await located('const large = 1;','MARK');
   const largeOpenMs=Math.round(performance.now()-opened);
   assert.equal(await body.locator('pre').textContent(),largeSource.repeat(120)+'const large = 1;');
   assert.equal(await body.locator('pre span').count(),0);
   record('TypeScript retains mixed line endings and cross-line tokens at 1280/760px, preserves annotation offsets, and falls back on dense and large files with their targets intact',{denseOpenMs,largeOpenMs});
   await openOther('打开跨段范围');
   await panel.getByText('源文件第 35–37 行',{exact:true}).waitFor({timeout:3500});
   await located('前一项','P',2);
   assert.match(await target.first().textContent(),/前一项/);
   assert.match(await target.last().textContent(),/工具能力/);
   await host.screenshot({path:join(out,'range-narrow.png')});
   await panel.getByRole('button',{name:'查看源码',exact:true}).click();
   await located('7. 前一项\n\n8. **工具能力','MARK');
   assert.match(await target.textContent(),/^7\. 前一项[\s\S]*隐性业务限制。$/);
   await openOther('打开列表范围');
   await located('父项','SPAN',2);
   assert.match(await target.last().textContent(),/子项甲/);
   assert.doesNotMatch(await target.allTextContents().then(values=>values.join(' ')),/子项乙/);
   await openOther('打开表格与代码范围');
   await located('数据','TR',2);
   assert.match(await target.last().textContent(),/const value = 1/);
   await openOther('打开公式段落');
   await located('公式正文','P');
   await openOther('打开显示公式');
   await located('x','SPAN');
   await openOther('打开项内范围');
   await located('项内标题','H2',2);
   assert.match(await target.last().textContent(),/项内尾段/);
   await openOther('打开越界范围');
   await panel.getByText('第 9–30 行超出范围（共 23 行）',{exact:true}).waitFor();
   assert.equal(await target.count(),0);
   await openOther('打开空行');
   await located('','MARK');
   await panel.getByText('源文件第 36 行',{exact:true}).waitFor({timeout:3500});
   assert.equal(await target.textContent(),'');
   await openOther('打开文本末行');
   await located('目标文本','MARK');
   assert.equal(await body.locator('pre').evaluate(node=>node.childElementCount),1);
   assert.equal(await body.locator('pre').textContent(),'A\r\n'.repeat(2000)+'目标文本');
   const fileRoute='**/api/preview/message-file';
   let release,entered;
   const hold=new Promise(resolve=>{release=resolve;});
   const seen=new Promise(resolve=>{entered=resolve;});
   const delay=async route=>{
    if(route.request().postDataJSON()?.destination?.endsWith(':2001')){entered();await hold;}
    await route.continue().catch(()=>{});
   };
   await host.route(fileRoute,delay);
   try{
    await openOther('打开文本末行');
    await seen;
    await panel.getByRole('tab',{name:'source.md:35-37',exact:true}).click();
    await located('前一项','P',2);
    release();await host.unroute(fileRoute,delay);
    await located('前一项','P',2);
   }finally{release();await host.unroute(fileRoute,delay);}
   await openOther('打开 HTML 源码');
   await located('<h1>页面原样</h1>','MARK');
   await panel.getByRole('button',{name:'查看页面',exact:true}).click();
   await until(()=>electron.context().pages().some(page=>page.url().startsWith('homer-preview:')));
   const page=electron.context().pages().find(page=>page.url().startsWith('homer-preview:'));
   await page.getByRole('heading',{name:'页面原样',exact:true}).waitFor();
   const htmlSource=panel.getByRole('tab',{name:'local.html:4',exact:true});
   await htmlSource.click();
   await located('<h1>页面原样</h1>','MARK');
   record('real link clicks locate Markdown, plain text and HTML at desktop and narrow widths, highlight ranges across blocks, repeat in the existing tab and preserve source text');
   assert.deepEqual(errors,[]);
   await electron.close();
   const exit=await electronExit;assert.deepEqual(exit,{code:0,signal:null});
   clearTimeout(watchdog);electronClosed=true;
   await writeFile(join(out,'line-report.json'),JSON.stringify({checks,errors,exit,watchdog:false},null,2));
   return;
  }
  if(linksOnly){
   await host.getByRole('link',{name:'交互 Demo',exact:true}).click();
   await host.getByText('这个文件未单独交付或链接，无法在预览中打开。',{exact:true}).waitFor();
   await host.getByRole('button',{name:'关闭current.md',exact:true}).click();
   await host.getByRole('link',{name:'打开附有 Demo 的方案',exact:true}).click();
   if(process.platform!=='win32'&&process.getuid?.()!==0){
    await chmod(demoPath,0);
    try{
     await host.getByRole('link',{name:'交互 Demo',exact:true}).click();
     await host.getByRole('alert').filter({hasText:'无法读取本地文件'}).waitFor();
     await host.getByRole('button',{name:'在文件夹中显示',exact:true}).click();
     await host.getByText('已请求在系统中显示文件。',{exact:true}).waitFor();
     assert.equal(await electron.evaluate(()=>globalThis.revealRequests.at(-1)),await realpath(demoPath));
     await host.getByRole('button',{name:'关闭demo.html',exact:true}).click();
    }finally{await chmod(demoPath,0o600);}
    record('an unreadable linked original enters the file fallback and remains locatable');
   }
   await host.getByRole('link',{name:'交互 Demo',exact:true}).click();
   await host.getByRole('tab',{name:'本地 Demo',exact:true,selected:true}).waitFor();
   let demoPage;await until(()=>!!(demoPage=electron.context().pages().find(page=>page.url().endsWith('/local/index.html'))));
   await demoPage.getByRole('heading',{name:'交互页面'}).waitFor();
   const websiteLink=await demoPage.getByRole('link',{name:'打开外部网页',exact:true}).boundingBox();
   await demoPage.mouse.click(websiteLink.x+websiteLink.width/2,websiteLink.y+websiteLink.height/2);
   await host.getByRole('tab',{name:'链接来源页',exact:true,selected:true}).waitFor();
   await host.getByRole('button',{name:'关闭链接来源页',exact:true}).click();
   await host.getByRole('tab',{name:'本地 Demo',exact:true,selected:true}).waitFor();
   await host.getByRole('button',{name:'关闭本地 Demo',exact:true}).click();
   await host.getByRole('tab',{name:'current.md',exact:true,selected:true}).waitFor();
   await host.getByRole('button',{name:'关闭current.md',exact:true}).click();
   record('an exact relative Markdown link opens the authorized demo and rejects unlisted siblings');
   await host.getByRole('link',{name:'打开链接来源页',exact:true}).click();
   const selected=(name)=>host.getByRole('tab',{name,exact:true,selected:true}).waitFor();
   const close=(name)=>host.getByRole('button',{name:'关闭'+name,exact:true}).click();
   await selected('链接来源页');
   let linkSource;await until(()=>!!(linkSource=electron.context().pages().find(page=>page.url()===url+'/link-source')));
   await linkSource.getByRole('link',{name:'打开新页',exact:true}).press('Enter');
   await selected('新页目标');
   await close('新页目标');await selected('链接来源页');
   await linkSource.getByRole('link',{name:'当前页跳转',exact:true}).click();
   await selected('新页目标');
   await host.getByRole('button',{name:'后退',exact:true}).click();
   await selected('链接来源页');
   await linkSource.evaluate(()=>{window.open('/script-popup');});
   await host.getByRole('tab',{name:'脚本新页',exact:true,selected:false}).waitFor();
   await selected('链接来源页');
   await close('脚本新页');
   const current=await host.evaluate(async threadId=>(await window.homerBrowserPreview.list(threadId)).find(page=>page.title==='链接来源页'),f.app.store.meta('mainThread'));
   const controlLink=action=>host.evaluate(({page,action})=>window.homerBrowserPreview.control({threadId:page.threadId,pageId:page.id,action}),{page:current,action});
   await controlLink('resume');
   await electron.evaluate((_,page)=>globalThis.preview.execute({threadId:page.threadId,owner:page.owner},'act',{pageId:page.id,document:page.document,action:'click',selector:'a[target="_blank"]'}),current);
   await host.getByRole('tab',{name:'新页目标',exact:true,selected:false}).waitFor();
   await selected('链接来源页');
   await controlLink('takeover');
   await close('新页目标');await close('链接来源页');
   await host.getByRole('link',{name:'打开附有 Demo 的方案',exact:true}).click();
   let requestSeen,continueRequest;
   const waiting=new Promise(resolve=>{requestSeen=resolve;}),continueLink=new Promise(resolve=>{continueRequest=resolve;});
   const holdLink=async route=>{requestSeen();await continueLink;await route.continue();};
   await host.route('**/api/preview/open',holdLink);
   try{
    await host.getByRole('link',{name:'交互 Demo',exact:true}).click();
    await waiting;
    await close('current.md');
    await host.getByRole('link',{name:'打开本地文档',exact:true}).click();
    continueRequest();
    await host.getByRole('tab',{name:'本地 Demo',exact:true,selected:false}).waitFor();
    await selected('current.md');
    await close('本地 Demo');await close('current.md');
   }finally{continueRequest();await host.unroute('**/api/preview/open',holdLink);}
   await writeFile(join(f.app.config.workspace,'preview-linked.html'),'<meta charset="utf-8"><title>附件方案</title><a href="子页%20%23.html">打开相邻 HTML</a>');
   await writeFile(join(f.app.config.workspace,'子页 #.html'),'<meta charset="utf-8"><title>附件相邻页</title><h1>读取匹配的相邻文件</h1>');
   await f.app.message('Emit Linked HTML','linked-html-fixture');
   await host.getByRole('link',{name:'打开附件方案',exact:true}).click();
   await selected('附件方案');
   let linkedAttachment;await until(()=>!!(linkedAttachment=electron.context().pages().find(page=>page.url().endsWith('/attachment/index.html'))));
   const siblingLink=await linkedAttachment.getByRole('link',{name:'打开相邻 HTML',exact:true}).boundingBox();
   await linkedAttachment.mouse.click(siblingLink.x+siblingLink.width/2,siblingLink.y+siblingLink.height/2);
   await selected('附件相邻页');
   let sibling;await until(()=>!!(sibling=electron.context().pages().find(page=>page.url().includes('%20%23.html'))));
   await sibling.getByRole('heading',{name:'读取匹配的相邻文件',exact:true}).waitFor();
   await close('附件相邻页');await selected('附件方案');
   await close('附件方案');
   record('native user link selects a Preview tab while script and Agent popups stay in background; Chromium keeps same-page history and late results stay in background');
   assert.deepEqual(errors,[]);
   await electron.close();
   assert.deepEqual(await electronExit,{code:0,signal:null});
   clearTimeout(watchdog);electronClosed=true;
   return;
  }
  await host.getByRole('button',{name:'关闭current.md',exact:true}).click();
  record('desktop local file link renders current bytes');
  const localImage=join(scratch,'local.png');
  const png=async(color)=>Buffer.from(await host.evaluate(color=>{
   const canvas=document.createElement('canvas');canvas.width=240;canvas.height=180;
   const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,240,180);
   return canvas.toDataURL('image/png').split(',')[1];
  },color),'base64');
  await writeFile(localImage,await png('blue'));
  f.app.history.record('desktop-image-fixture',f.app.store.meta('mainThread'),`[打开本地图片](${pathToFileURL(localImage).href})`);
  await host.getByRole('link',{name:'打开本地图片',exact:true}).click();
  async function noteLocalImage(note){
   await host.locator('.image-annotation-toggle').click();
   const box=await host.locator('.image-annotation img').boundingBox();
   await host.mouse.move(box.x+20,box.y+20);await host.mouse.down();
   await host.mouse.move(box.x+100,box.y+90,{steps:6});await host.mouse.up();
   await host.locator('.image-annotation textarea').fill(note);
   await host.locator('.image-annotation button[type="submit"]').click();
   await host.locator('.annotation-chip').filter({hasText:note}).waitFor();
  }
  await noteLocalImage('测试本地图片批注');
  await host.locator('.composer-area button[type="submit"]').click();
  await until(()=>f.inputs.some(text=>text.includes('测试本地图片批注')&&text.includes('批注时所见')));
  await host.getByRole('button',{name:'关闭local.png',exact:true}).click();
  const reopenImage=host.locator('.image-reference').filter({hasText:'测试本地图片批注'}).getByRole('button',{name:'打开批注 1',exact:true});
  await reopenImage.click();await host.locator('.image-region-number').waitFor();
  assert.equal(await host.locator('.image-annotation.is-annotating').count(),0);
  await host.getByRole('button',{name:'关闭local.png',exact:true}).click();
  await writeFile(localImage,await png('red'));
  await reopenImage.click();
  await host.getByText('当前预览无法准确定位这条批注，原摘录与备注已保留。').waitFor();
  assert.equal(await host.locator('.image-region-number').count(),0);
  await host.getByRole('button',{name:'关闭local.png',exact:true}).click();
  record('local PNG draws, sends and reopens without restoring the old box on a same-size replacement');
  await host.getByRole('link',{name:'打开本地图片',exact:true}).click();
  await noteLocalImage('测试本地图片批注只保留备注');
  await writeFile(localImage,await png('green'));
  await host.locator('.composer-area button[type="submit"]').click();
  await host.getByRole('button',{name:'只保留本地图片批注备注',exact:true}).click();
  await host.locator('.composer-area button[type="submit"]').click();
  await until(()=>f.inputs.includes('测试本地图片批注只保留备注'));
  await host.getByRole('button',{name:'关闭local.png',exact:true}).click();
  await truncate(localImage,8*1024*1024+1);
  await host.getByRole('link',{name:'打开本地图片',exact:true}).click();
  await host.getByText('图片超过草稿附件的 8 MiB 上限，可预览。',{exact:true}).waitFor();
  assert.equal(await host.locator('.image-annotation-toggle').count(),0);
  await host.getByRole('button',{name:'关闭local.png',exact:true}).click();
  record('local PNG replacement keeps the draft and can send only its note; oversized files still preview');
  await writeFile(localImage,await png('green'));
  await host.getByRole('link',{name:'打开本地图片',exact:true}).click();
  await noteLocalImage('从输入区删除本地图批注');
  const draftImage=host.locator('.context-attachment-item').filter({hasText:'local.png'});
  await draftImage.waitFor();
  await host.getByRole('button',{name:/删除 local\.png 的批注/}).click();
  await draftImage.waitFor({state:'detached'});
  await host.getByRole('button',{name:'关闭local.png',exact:true}).click();
  await host.getByRole('link',{name:'打开本地图片',exact:true}).click();
  await noteLocalImage('从 Preview 删除本地图批注');
  await host.getByRole('button',{name:/打开 local\.png 的批注 .*从 Preview 删除本地图批注/}).click();
  await host.getByRole('button',{name:'删除此批注',exact:true}).click();
  await draftImage.waitFor({state:'detached'});
  await host.getByRole('button',{name:'关闭local.png',exact:true}).click();
  record('deleting the final local image annotation removes its draft attachment from both entry points');

  await host.getByRole('link',{name:'打开本地 HTML',exact:true}).click();
  let localPage;
  await until(()=>!!(localPage=electron.context().pages().find(page=>page.url().endsWith('/local/index.html'))));
  await localPage.getByRole('heading',{name:'合成本地 HTML'}).waitFor();
  const localSessionIsSeparate=await electron.evaluate(({webContents,session})=>{
   const local=webContents.getAllWebContents().find(view=>view.getURL().endsWith('/local/index.html'));
   return local?.session===session.fromPartition('homer-local-preview')&&local.session!==session.fromPartition('persist:homer-preview');
  });
  assert.equal(localSessionIsSeparate,true);
  await host.getByRole('button',{name:'批注',exact:true}).click();
  await host.waitForFunction(()=>document.querySelector('.preview-annotation-button')?.getAttribute('aria-busy')==='false');
  await localPage.locator('#local-heading').evaluate(element=>element.click());
  assert.equal(await localPage.getByRole('textbox',{name:'网页元素批注'}).count(),0);
  await localPage.locator('#local-heading').click();
  await localPage.getByRole('textbox',{name:'网页元素批注'}).fill('核对本地 HTML 的标题');
  await localPage.getByRole('button',{name:'保存',exact:true}).click();
  const htmlDraft=host.locator('.annotation-chip').filter({hasText:'核对本地 HTML 的标题'});
  await htmlDraft.waitFor();
  await host.getByRole('button',{name:'关闭本地批注',exact:true}).click();
  await htmlDraft.locator('.annotation-chip-open').click();
  await until(()=>!!(localPage=electron.context().pages().find(page=>page.url().endsWith('/local/index.html'))));
  await localPage.locator('.annotation-outline').waitFor();
  await host.locator('.composer-area button[type="submit"]').click();
  await until(()=>f.inputs.some(input=>input.includes('核对本地 HTML 的标题')&&input.includes('desktop-html-fixture')));
  await host.getByRole('button',{name:'关闭本地批注',exact:true}).click();
  const htmlHistory=host.locator('.user-message-bubble .web-annotation-reference').filter({hasText:'核对本地 HTML 的标题'});
  assert.equal(await htmlHistory.locator('.web-annotation-title').textContent(),'本地批注');
  assert.equal(await htmlHistory.locator('.web-annotation-element').textContent(),'合成本地 HTML');
  await htmlHistory.getByText('核对本地 HTML 的标题',{exact:true}).waitFor();
  assert.equal(await htmlHistory.locator('button, a, summary, [tabindex]').count(),0);
  record('local HTML reopens from the draft and sends a native annotation displayed as read-only history');
  const noteBlock='第二处前文。'.repeat(8)+'重复文字。'+'第二处后文。'.repeat(8);
  await writeFile(localPath,'# 合成本地原文\n\n第一处重复文字。\n\n'+noteBlock);
  await host.getByRole('link',{name:'打开本地文档',exact:true}).click();
  await host.getByText(noteBlock,{exact:true}).evaluate(element=>{
   const value='重复文字。',at=element.textContent.indexOf(value),range=document.createRange();
   range.setStart(element.firstChild,at);range.setEnd(element.firstChild,at+value.length);
   getSelection().removeAllRanges();getSelection().addRange(range);
   document.dispatchEvent(new Event('selectionchange'));
  });
  await host.locator('[data-slot=selection-toolbar-quote]').click();
  await host.getByRole('textbox',{name:'文件批注 · current.md'}).fill('核对第二处本地文本');
  await host.getByRole('button',{name:'保存',exact:true}).click();
  await host.locator('.composer-area .annotation-chip').filter({hasText:'核对第二处本地文本'}).waitFor();
  await host.locator('.composer-area button[type="submit"]').click();
  await until(()=>f.inputs.some(input=>input.includes('核对第二处本地文本')&&input.includes('批注时所见')));
  await host.getByRole('button',{name:'关闭current.md',exact:true}).click();
  const historicalText=host.locator('.preview-reference').filter({hasText:'核对第二处本地文本'}).getByRole('button',{name:'打开批注 1',exact:true});
  await writeFile(localPath,'# 新增标题\n\n'+noteBlock);
  await historicalText.click();
  await host.waitForFunction(()=>[...CSS.highlights.values()].some(highlight=>[...highlight].some(range=>range.toString()==='重复文字。')));
  await host.getByRole('button',{name:'关闭current.md',exact:true}).click();
  await writeFile(localPath,noteBlock+'\n\n'+noteBlock);
  await historicalText.click();
  await host.getByText('原文暂无法准确定位；摘录与批注已保留。',{exact:true}).waitFor();
  await host.getByRole('button',{name:'关闭current.md',exact:true}).click();
  record('local Markdown restores a unique moved anchor and leaves duplicate anchors unresolved');


  const archiveRead=host.waitForResponse(response=>new URL(response.url()).pathname==='/api/preview/message-file');
  await host.getByRole('link',{name:'打开测试安装包',exact:true}).click();
  assert.deepEqual(await (await archiveRead).json(),{error:'file_type_or_size_denied'});
  await host.getByRole('heading',{name:'test-build.zip',exact:true}).waitFor();
  await host.getByText('本地文件 · 412.0 MiB',{exact:true}).waitFor();
  await host.getByText('文件超过 50 MiB 的预览上限。',{exact:true}).waitFor();
  assert.deepEqual(await electron.evaluate(()=>globalThis.revealRequests),[]);
  if(['darwin','win32','linux'].includes(process.platform)){
   await host.getByRole('button',{name:'在文件夹中显示',exact:true}).click();
   await host.getByText('已请求在系统中显示文件。',{exact:true}).waitFor();
   assert.deepEqual(await electron.evaluate(()=>globalThis.revealRequests),[archivePath]);
  }
  await host.getByRole('button',{name:'关闭test-build.zip',exact:true}).click();
  record('large local ZIP shows metadata and only trusted click dispatches native reveal');
  await host.getByRole('link',{name:'打开业务网页',exact:true}).click();
  try{
   await host.getByLabel('内置网页内容').waitFor({timeout:4000});
   await host.getByRole('link',{name:'打开业务网页',exact:true}).click();
   const pages=await host.evaluate(threadId=>window.homerBrowserPreview.list(threadId),f.app.store.meta('mainThread'));
   assert.equal(pages.length,1);assert.equal(pages[0].loading,true);
   const started=performance.now();
   const open={threadId:pages[0].threadId,source:pages[0].source,url:url+'/explicit-start'};
   const first=await f.app.openBrowserPreview(open),second=await f.app.openBrowserPreview(open);
   assert.equal(first.id,second.id);
   assert.equal(first.loading,true);
   await host.evaluate(({id,threadId})=>window.homerBrowserPreview.control({pageId:id,threadId,action:'close'}),first);
   record('slow-page-receipt', {explicitOpenAndReuseMs:performance.now()-started});
  }finally{releaseSlowPage();}
  const page=await waitPage(url+'/start');page.on('pageerror',e=>errors.push(e.message));

  await host.locator('.preview-toolbar-navigation').waitFor();assert.equal(await host.getByRole('button',{name:'交还 AI',exact:true}).count(),0);assert.equal(await host.locator('.preview-toolbar-navigation button').count(),3);assert.equal(await host.locator('.preview-toolbar-navigation button svg').count(),3);
  await annotationMode(true);await hoverMatch(page,'#heading');await hoverMatch(page,'#target');await page.screenshot({path:join(out,'web-hover.png')});await annotationMode(false);await page.locator('.annotation-hover-outline').waitFor({state:'detached'});await page.locator('#business').click();assert.equal(await page.locator('#business').innerText(),'已完成点击');await annotationMode(true);await page.locator('#target').click();
  assert.equal(await page.locator('.mode').count(),0);assert.equal(await host.getByRole('button',{name:'批注',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('textbox',{name:'网页元素批注'}).fill('补充可核对的数据和下一步行动。');await page.getByRole('button',{name:'保存',exact:true}).click();
  await host.locator('.annotation-chip').filter({hasText:'补充可核对的数据'}).waitFor();
  await page.locator('#heading').click();await page.getByRole('textbox',{name:'网页元素批注'}).fill('第二条备注');await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('button',{name:'批注 2',exact:true}).click();await page.getByRole('textbox',{name:'网页元素批注'}).fill('修改后的第二条');await page.getByRole('button',{name:'保存',exact:true}).click();await host.locator('.annotation-chip').filter({hasText:'修改后的第二条'}).waitFor();
  await page.getByRole('button',{name:'批注 2',exact:true}).click();await page.getByRole('button',{name:'删除此批注',exact:true}).click();await until(async()=>await host.locator('.composer-area .annotation-chip').count()===1);
  await page.evaluate(()=>scrollTo(0,500));await host.locator('.composer-area .annotation-chip-open').click();await until(async()=>await page.locator('#target').evaluate(e=>e.getBoundingClientRect().top)>=0&&await page.locator('#target').evaluate(e=>e.getBoundingClientRect().bottom)<await page.evaluate(()=>innerHeight));
  record('message link opens real WCV; React Grab and existing composer produce a saved chip');
  await page.getByRole('button',{name:'批注 1',exact:true}).click();await page.screenshot({path:join(out,'product-page-editor.png')});await page.getByRole('button',{name:'取消',exact:true}).click();
  if(process.platform==='darwin'){
   await electron.evaluate(()=>{globalThis.testWindow.show();globalThis.testWindow.focus();});
   await host.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const id=await electron.evaluate(()=>globalThis.testWindow.getMediaSourceId().split(':')[1]);
   try{
    execFileSync('/usr/sbin/screencapture',['-x','-l',id,join(out,'product-native-window.png')],{timeout:10000});
    record('native window screenshot includes real WebContentsView, without compositing renderers');
   }catch(error){
    const access=await electron.evaluate(({systemPreferences})=>systemPreferences.getMediaAccessStatus('screen'));
    captureError=Error('Native window capture failed (Electron screen access: '+access+')',{cause:error});
   }
  }
  await host.screenshot({path:join(out,'product-preview-host.png')});
  const input=host.locator('.composer-area [contenteditable=true]');await input.fill('请按网页批注处理');
  // Use the actual composer's submit button, then validate persisted source and prompt.
  await host.locator('.composer-area button[type="submit"]').click();
  await until(()=>f.inputs.some(text=>text.includes('用户批注：补充可核对的数据和下一步行动。')));
  const accepted=f.app.history.list(f.app.store.meta('mainThread')).find(m=>m.role==='user'&&m.text==='请按网页批注处理');
  assert(accepted);assert.equal(accepted.resourceReferences[0].source.kind,'browser');assert.equal(accepted.resourceReferences[0].page.url,url+'/start');record('actual composer submission passes real service provenance and reaches synthetic Main prompt');
  await f.app.message('Delegate both pages','delegate-browser-fixture');await until(()=>f.engines.filter(p=>p.options.role==='worker'&&p.finish).length===2);
  const workers=f.engines.filter(p=>p.options.role==='worker');
  const opened=await Promise.all(workers.map((w,i)=>call(w,'preview_open',{url:url+'/worker-'+i},'open-'+i)));
  const snapshots=await Promise.all(workers.map((w,i)=>call(w,'preview_read',{pageId:opened[i].id},'read-'+i)));
  await assert.rejects(electron.evaluate((_,input)=>globalThis.preview.execute(input.actor,'act',input.input),{actor:{owner:opened[0].owner,threadId:opened[0].threadId},input:{pageId:opened[0].id,document:snapshots[0].document,selector:'#does-not-exist',action:'click'}}),/preview_target_missing/);
  const perfStart=performance.now();for(let i=0;i<10;i++)await Promise.all(workers.map((w,j)=>call(w,'preview_read',{pageId:opened[j].id},'perf-'+i+'-'+j)));record('20 scoped reads across two hidden Worker pages', {elapsedMs:performance.now()-perfStart});
  await Promise.all(workers.map((w,i)=>call(w,'preview_act',{pageId:opened[i].id,document:snapshots[i].document,selector:'role=textbox[name="任务输入"]',action:'fill',value:'任务 '+i},'fill-'+i)));
  for(let i=0;i<2;i++){const p=await waitPage(url+'/worker-'+i);assert.equal(await p.getByLabel('任务输入').inputValue(),'任务 '+i);}
  await call(workers[0],'preview_act',{pageId:opened[0].id,document:snapshots[0].document,selector:'#business',action:'click'},'hidden-click');
  const hidden=await waitPage(url+'/worker-0');assert.match(await hidden.locator('#business').textContent(),/已完成点击/);
  record('two actual Worker MCP endpoints control distinct hidden WCVs using pinned injected engine');
  await assert.rejects(call(workers[0],'preview_read',{pageId:opened[1].id},'wrong-page'),/preview_scope_denied/);
  await call(workers[0],'preview_show',{pageId:opened[0].id},'show-task-page');
  await host.getByRole('button',{name:'用户接手',exact:true}).click();
  await assert.rejects(call(workers[0],'preview_act',{pageId:opened[0].id,document:snapshots[0].document,selector:'#business',action:'click'},'blocked-user-control'),/preview_user_control/);
  await host.getByRole('button',{name:'交还 AI',exact:true}).click();
  await call(workers[0],'preview_act',{pageId:opened[0].id,document:snapshots[0].document,selector:'#business',action:'click'},'click-business');
  const taskPage=await waitPage(url+'/worker-0');assert.equal(await taskPage.locator('#business').textContent(),'已完成点击');
  const aria=await call(workers[0],'preview_read',{pageId:opened[0].id},'snapshot-refs');assert.match(aria.content,/ref=/);
  const buttonRef=aria.content.split("\n").find(line=>line.includes('button "已完成点击"'))?.match(/\[ref=([^\]]+)\]/)?.[1];assert.ok(buttonRef,aria.content);await call(workers[0],'preview_act',{pageId:opened[0].id,document:aria.document,selector:'aria-ref='+buttonRef,action:'click'},'click-aria-reference');
  await call(workers[0],'preview_act',{pageId:opened[0].id,document:aria.document,selector:'role=combobox[name=\"任务选项\"]',action:'select',value:'b'},'select-option');assert.equal(await taskPage.getByLabel('任务选项').inputValue(),'b');
  await taskPage.screenshot({path:join(out,'product-worker-page.png')});record('user takeover/resume gates real MCP writes; trusted CDP click and ARIA targets work');
  await taskPage.evaluate(()=>history.pushState({},'', '/spa'));const spa=await call(workers[0],'preview_read',{pageId:opened[0].id},'read-spa');assert(spa.document>aria.document);await assert.rejects(call(workers[0],'preview_act',{pageId:opened[0].id,document:aria.document,selector:'#business',action:'click'},'stale-spa'),/preview_document_changed/);
  await call(workers[0],'preview_navigate',{pageId:opened[0].id,document:spa.document,url:url+'/next'},'navigate');
  await assert.rejects(call(workers[0],'preview_act',{pageId:opened[0].id,document:aria.document,selector:'#business',action:'click'},'stale-doc'),/preview_document_changed/);
  await call(workers[1],'preview_close',{pageId:opened[1].id},'close-page');
  await assert.rejects(call(workers[1],'preview_read',{pageId:opened[1].id},'read-closed'),/preview_page_unavailable/);record('navigation invalidates stale document; closed page cannot be read');
  await host.getByRole('button',{name:'批注',exact:true}).click();await taskPage.locator('#target').click();
  await taskPage.getByRole('textbox',{name:'网页元素批注'}).fill('接续这一个任务页面');await taskPage.getByRole('button',{name:'保存',exact:true}).click();await host.locator('.annotation-chip').filter({hasText:'接续这一个任务页面'}).waitFor();
  await input.fill('接续任务页');await host.locator('.composer-area button[type="submit"]').click();await until(()=>!!claimed);
  assert.equal(claimed.id,opened[0].id);assert.match(claimed.owner,/^main:/);await assert.rejects(call(workers[0],'preview_read',{pageId:opened[0].id},'old-owner-after-claim'),/preview_scope_denied/);await host.getByRole('button',{name:'用户接手',exact:true}).click();const main=f.engines.find(p=>p.options.role!=='worker');await call(main,'preview_open',{pageId:claimed.id},'reopen-same-request');await assert.rejects(call(main,'preview_act',{pageId:claimed.id,document:claimed.document,selector:'#business',action:'click'},'still-user-control'),/preview_user_control/);
  record('a real submitted annotation lets the new Main request claim the same DOM; former Worker loses access');
  await taskPage.evaluate(()=>{window.open(location.origin+'/popup');});let popup;await until(async()=>{const view=await call(main,'preview_read',{pageId:claimed.id},'find-popup-'+Date.now());popup=view.relatedPages.find(p=>p.url.endsWith('/popup'));return !!popup;});
  const popupPage=await call(main,'preview_read',{pageId:popup.pageId},'read-popup');assert.equal(popupPage.owner,claimed.owner);assert.equal(popupPage.agentAssigned,true);const popupContent=await waitPage(popupPage.url);assert.equal(await popupContent.evaluate(()=>window.opener.location.href),taskPage.url());const popupSecurity=await electron.evaluate(async({webContents},{url,parentUrl})=>{const child=webContents.getAllWebContents().find(c=>c.getURL()===url),parent=webContents.getAllWebContents().find(c=>c.getURL()===parentUrl),prefs=child.getLastWebPreferences();return{sandbox:prefs.sandbox,contextIsolation:prefs.contextIsolation,nodeIntegration:prefs.nodeIntegration,sameSession:child.session===parent.session,bridge:await child.executeJavaScriptInIsolatedWorld(999,[{code:"typeof globalThis.homerAnnotationBridge?.read==='function'"}])}},{url:popupPage.url,parentUrl:taskPage.url()});assert.deepEqual(popupSecurity,{sandbox:true,contextIsolation:true,nodeIntegration:false,sameSession:true,bridge:true});await assert.rejects(call(workers[0],'preview_read',{pageId:popup.pageId},'old-owner-popup'),/preview_scope_denied/);record('popup after claim inherits current owner and assignment, excluding former Worker');claimRelease();

  await writeFile(join(f.app.config.workspace,'preview.html'),'<html><head><meta charset="utf-8"><title>HTML 附件</title><link rel="stylesheet" href="./preview.css"></head><body><h1 id="html-title">HTML 附件内容</h1><p id="ready">等待资源</p><script src="./preview.js"></script></body></html>');
  await writeFile(join(f.app.config.workspace,'preview.css'),'body{background:rgb(13,21,34);color:white;padding:36px;font:20px system-ui}');
  await writeFile(join(f.app.config.workspace,'preview.js'),'document.getElementById("ready").textContent="资源脚本已加载";');
  await f.app.message('Emit HTML','html-fixture');
  const latestMessages=host.getByRole('button',{name:/最新消息/});
  if(await latestMessages.isVisible())await latestMessages.click();
  const htmlReplyId=f.app.store.db.prepare("SELECT replyId FROM conversation_inputs WHERE requestId='html-fixture'").get().replyId;
  await host.locator(`[data-conversation-message="${htmlReplyId}"]`).getByRole('link',{name:'preview.html',exact:true}).click();
  await host.waitForFunction(()=>Array.from(document.querySelectorAll('a')).filter(link=>link.textContent==='preview.html').length===1);
  let html;await until(()=>!!(html=electron.context().pages().find(p=>p.url().endsWith('/attachment/index.html'))));
  await html.getByText('资源脚本已加载',{exact:true}).waitFor();assert.equal(await html.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(13, 21, 34)');
  await annotationMode(true);assert.equal(await host.locator('.preview-toolbar:visible').count(),1);await hoverMatch(html,'#ready');await hoverMatch(html,'#html-title');await html.screenshot({path:join(out,'html-hover.png')});await annotationMode(false);await html.locator('.annotation-hover-outline').waitFor({state:'detached'});await annotationMode(true);await html.locator('#html-title').click();
  await html.getByRole('textbox',{name:'网页元素批注'}).fill('HTML 备注同时引用原始附件');await html.getByRole('button',{name:'保存',exact:true}).click();
  await host.locator('.annotation-chip').filter({hasText:'HTML 备注同时引用原始附件'}).waitFor();await html.screenshot({path:join(out,'product-html-attachment.png')});
  await input.fill('按 HTML 标记处理');await host.locator('.composer-area button[type="submit"]').click();
  await until(()=>f.inputs.some(text=>text.includes('用户批注：HTML 备注同时引用原始附件')));
  record('real HTML attachment, relative CSS/JS and annotation submission pass existing attachment/source authorization');
  record('web and HTML hover, exit and single native toolbar');
  host.setDefaultTimeout(5000);
  await f.app.message('Emit Quote','quote-fixture');
  const source=host.getByText(quoteText,{exact:true});
  const quote=host.getByRole('dialog',{name:'引用评论'});
  const nativeState=target=>electron.evaluate((_,target)=>{
   const view=testWindow.contentView.children.find(child=>child.webContents?.getURL()===target);
   return view&&{id:view.webContents.id,visible:view.getVisible()};
  },target);
  const quoteFits=()=>host.waitForFunction(()=>{
   const popup=document.querySelector('.message-quote-editor')?.getBoundingClientRect();
   const left=document.querySelector('.conversation-panel').getBoundingClientRect();
   return popup&&popup.left>=left.left&&popup.right<=left.right;
  });
  const selectionTool=host.locator('[data-slot=selection-toolbar-quote]');
  const statusTrigger=host.locator('#task-status-trigger');
  const statusAside=host.getByRole('complementary',{name:'工作状态卡片'});
  async function verifyStatus(target,screenshot){
   const before=await nativeState(target.url());
   assert.equal(before.visible,true);
   await statusAside.waitFor();
   assert.equal((await statusAside.boundingBox()).width,300);
   const archive=statusAside.getByRole('button',{name:'已归档',exact:true});
   await archive.focus();
   await host.keyboard.press('Enter');
   assert.equal(await archive.getAttribute('aria-expanded'),'true');
   assert.deepEqual(await nativeState(target.url()),before);
   if(screenshot&&process.platform==='darwin'){
    const id=await electron.evaluate(()=>testWindow.getMediaSourceId().split(':')[1]);
    execFileSync('/usr/sbin/screencapture',['-x','-l',id,join(out,screenshot)],{timeout:10000});
   }
   await host.keyboard.press('Enter');
   assert.equal(await archive.getAttribute('aria-expanded'),'false');
   await statusTrigger.focus();await host.keyboard.press('Enter');
   await statusAside.waitFor({state:'hidden'});
   assert.deepEqual(await nativeState(target.url()),before);
   await host.keyboard.press('Enter');await statusAside.waitFor();
  }
  async function verifyQuote(target,save){
   const before=await nativeState(target.url());
   assert.equal(before.visible,true);
   const latest=host.locator('.scroll-latest:enabled');
   if(await latest.isVisible())await latest.click();
   await source.scrollIntoViewIfNeeded();
   await source.evaluate(element=>{
    const range=document.createRange(),text=element.firstChild;
    let start=0,right=0;
    for(let index=0;index<text.length-8;index+=4){
     range.setStart(text,index);range.setEnd(text,index+8);
     const box=range.getBoundingClientRect();
     if(box.right>right){start=index;right=box.right;}
    }
    range.setStart(text,start);range.setEnd(text,start+8);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
   });
   await selectionTool.waitFor();
   await host.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.deepEqual(await nativeState(target.url()),before);
   await selectionTool.click();
   await quote.locator('textarea').fill('跨栏编辑期间保留原生页面');
   await host.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.deepEqual(await nativeState(target.url()),before);
   await quoteFits();
   if(save){
    await electron.evaluate(()=>{
     testWindow.setContentSize(840,900);
     testWindow.webContents.setZoomFactor(0.95);
    });
    await quoteFits();
    await host.locator('.thread-viewport').evaluate(node=>node.scrollTo(0,0));
    await quoteFits();
    assert.deepEqual(await nativeState(target.url()),before);
    if(process.platform==='darwin'){
     const id=await electron.evaluate(()=>testWindow.getMediaSourceId().split(':')[1]);
     execFileSync('/usr/sbin/screencapture',['-x','-l',id,join(out,'product-conversation-quote.png')],{timeout:10000});
    }
   }
   await quote.getByRole('button',{name:save?'保存':'取消',exact:true}).click();
   await quote.waitFor({state:'hidden'});
   assert.deepEqual(await nativeState(target.url()),before);
  }
  await host.getByRole('link',{name:'打开引用验收网页',exact:true}).click();
  const quotePage=await waitPage(url+'/quote');
  await until(async()=>!!(await nativeState(quotePage.url()))?.visible);
  await quotePage.getByLabel('任务输入').fill('保留网页输入');
  await verifyStatus(quotePage);
  await verifyQuote(quotePage,false);
  assert.equal(await quotePage.getByLabel('任务输入').inputValue(),'保留网页输入');
  await host.locator(`[data-conversation-message="${htmlReplyId}"]`).getByRole('link',{name:'preview.html',exact:true}).click();
  await until(async()=>!!(await nativeState(html.url()))?.visible);
  assert.equal((await nativeState(quotePage.url())).visible,false);
  const gutter=await host.locator('.preview-separator').boundingBox();
  const separatorX=gutter.x+gutter.width/2,separatorY=gutter.y+gutter.height/2;
  await host.mouse.move(separatorX,separatorY);
  await host.mouse.down();
  await host.mouse.move(separatorX-400,separatorY,{steps:8});
  await host.mouse.up();
  await host.waitForFunction(()=>document.querySelector('.conversation-panel').getBoundingClientRect().width<650);
  await verifyStatus(html);
  await html.evaluate(()=>{window.quoteProbe=42;});
  await verifyQuote(html,true);
  assert.equal(await html.evaluate(()=>window.quoteProbe),42);
  await host.getByRole('button',{name:'编辑引用 1'}).click();
  await quoteFits();
  await quote.getByRole('button',{name:'取消',exact:true}).click();
  await host.getByRole('button',{name:'设置',exact:true}).click();
  await until(async()=>!(await nativeState(html.url())).visible);
  await host.getByRole('button',{name:'关闭设置',exact:true}).click();
  await until(async()=>(await nativeState(html.url())).visible);
  await electron.evaluate(()=>{
   testWindow.webContents.setZoomFactor(1);
   testWindow.setContentSize(960,900);
  });
  await host.waitForFunction(()=>innerWidth===960);
  await verifyStatus(html,'product-task-status-three-columns.png');
  const beforeResize=await nativeState(html.url());
  await html.locator('#ready').evaluate(el=>el.addEventListener('click',()=>{window.narrowClick=true;}));
  for(const width of [700,699,700]){
   await electron.evaluate((_,width)=>testWindow.setContentSize(width,900),width);
   await host.waitForFunction(width=>innerWidth===width&&
     document.querySelector('#canvas-panel')?.getAttribute('role')===(width<700?'dialog':'complementary'),width);
   if(width===700){
    await statusAside.waitFor();
    assert.equal((await statusAside.boundingBox()).width,300);
    await until(async()=>{
     const viewport=await host.locator('.browser-preview-viewport').boundingBox();
     const bounds=await electron.evaluate((_,url)=>testWindow.contentView.children.find(child=>child.webContents?.getURL()===url)?.getBounds(),html.url());
     return viewport&&viewport.x>=499&&viewport.width>=179&&bounds&&
      Math.abs(bounds.x-viewport.x)<=1&&Math.abs(bounds.width-viewport.width)<=1;
    });
    assert.equal(await host.locator('.browser-preview .preview-toolbar').evaluate(toolbar=>{
     const rect=toolbar.getBoundingClientRect();
     return [...toolbar.querySelectorAll('button:not([hidden])')].filter(button=>button.getClientRects().length).every(button=>{
      const box=button.getBoundingClientRect();
      return box.left>=rect.left&&box.right<=rect.right&&box.bottom<=rect.bottom;
     });
    }),true);
    assert.equal(await host.locator('.composer-context .annotation-chip-remove').first().evaluate(button=>{
     const tile=button.closest('.composer-reference-strip').getBoundingClientRect();
     return button.getBoundingClientRect().right<=tile.right;
    }),true);
    await html.evaluate(()=>{window.narrowClick=false;});
    await html.locator('#ready').click();
    assert.equal(await html.evaluate(()=>window.narrowClick),true);
    if(process.platform==='darwin'){
     const id=await electron.evaluate(()=>testWindow.getMediaSourceId().split(':')[1]);
     execFileSync('/usr/sbin/screencapture',['-x','-l',id,join(out,'product-three-columns-700.png')],{timeout:10000});
    }
   }else await statusAside.waitFor({state:'hidden'});
   assert.deepEqual(await nativeState(html.url()),beforeResize);
   assert.equal(await html.evaluate(()=>window.quoteProbe),42);
  }
  record('fixed work status and same native view persist through 699 / 700, with matching bounds');
  record('conversation quote stays in its panel while the same web and HTML views remain visible');

  assert.deepEqual(errors,[]);
  if(captureError)throw captureError;
  const versions=await electron.evaluate(()=>({electron:process.versions.electron,chromium:process.versions.chrome}));
  await electron.close();
  const exit=await electronExit;assert.deepEqual(exit,{code:0,signal:null});
  clearTimeout(watchdog);electronClosed=true;
  await writeFile(join(out,'product-report.json'),JSON.stringify({status:'passed',checks,versions,errors,exit,boundary:'Actual source UI/service/MCP/native page modules with synthetic engines; test harness forwards browser transport through Electron inspector. Production stdio transport, installed app, real Codex/LLM, Windows, IME and real login remain separately verified or unverified.'},null,2));
 }catch(error){const pages=[];if(electron)for(const [i,page]of electron.context().pages().entries()){pages.push({url:page.url(),text:await page.locator('body').innerText().catch(()=>'' )});await page.screenshot({path:join(out,'failure-'+i+'.png')}).catch(()=>{});}await writeFile(join(out,'product-failure.json'),JSON.stringify({message:error.stack,checks,errors,pages},null,2));throw error;}
 finally{clearTimeout(watchdog);claimRelease?.();if(electron&&!electronClosed)await electron.close();if(web)await web.close();await f.close();if(site)await new Promise(r=>site.close(r));await rm(scratch,{recursive:true,force:true});}
}
