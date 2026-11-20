import {build}from'vite';
import{_electron}from'playwright-core';
import{createRequire}from'node:module';
import{createServer}from'node:http';
import{mkdtemp,readFile,writeFile,rm}from'node:fs/promises';
import{join,resolve,dirname}from'node:path';
import{fileURLToPath}from'node:url';
import assert from'node:assert/strict';
import {createDemoOutput, scratchRoot} from './output.mjs';
const here=dirname(fileURLToPath(import.meta.url)),require=createRequire(import.meta.url);
const output=await createDemoOutput('browser-content-demo-');
console.log('OUTPUT',output);
const scratch=await mkdtemp(join(scratchRoot,'browser-demo-')),profile=join(scratch,'profile'),compiled=join(scratch,'build');
const results=[],errors=[];let application,server;
const pass=(name,detail)=>{results.push({name,detail});console.log('PASS',name,JSON.stringify(detail??''));};
async function bundle(entry){await build({configFile:false,root:here,resolve:{dedupe:['react','react-dom'],alias:{react:resolve('node_modules/react'),'react-dom':resolve('node_modules/react-dom')}},logLevel:'warn',define:{'process.env.NODE_ENV':'"production"'},build:{emptyOutDir:false,outDir:compiled,minify:false,lib:{entry:join(here,entry+'.tsx'),name:'Demo'+entry,formats:['iife'],fileName:()=>entry+'.js',cssFileName:entry},rolldownOptions:{onwarn(warning,forward){if(warning.code!=='MODULE_LEVEL_DIRECTIVE')forward(warning);}}}});}
try{
 await bundle('content');await bundle('host');
 server=createServer(async(req,res)=>{
  const path=req.url.split('?')[0];res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-src 'none'");
  if(path==='/host.js'){res.setHeader('Content-Type','application/javascript');res.end(await readFile(join(compiled,'host.js')));}
  else if(path==='/host')res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/host.css"><div id="app"></div><script src="/host.js"></script>');
  else if(path==='/host.css'){res.setHeader('Content-Type','text/css');res.end('body{margin:0;background:#f5f3ee;color:#23262a;font:14px system-ui}aside{box-sizing:border-box;width:310px;height:800px;padding:20px;overflow:auto}h1{font-size:23px;margin:0 0 8px}h2{font-size:15px;margin-top:24px}button{font:inherit;border:1px solid #ccc;background:white;border-radius:6px;margin:3px;padding:5px 8px;cursor:pointer}small{font-size:11px;overflow-wrap:anywhere;color:#6a6c70}.note{padding:10px;background:white;border-radius:8px;overflow-wrap:anywhere}pre{font:11px/1.5 monospace;white-space:pre-wrap;overflow-wrap:anywhere}');}
  else if(path==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end("window.businessClicks=0;window.ticks=0;setInterval(()=>{window.ticks++;document.getElementById('timer').textContent=window.ticks;},500);document.getElementById('business').onclick=()=>{window.businessClicks++;document.getElementById('result').textContent='业务点击 '+window.businessClicks;};document.getElementById('replace').onclick=()=>{const old=document.getElementById('item-two');old.replaceWith(old.cloneNode(true));};");}
  else if(path==='/page.css'){res.setHeader('Content-Type','text/css');res.end('body{font:16px/1.6 system-ui;color:#1e2938;background:#fcfbf8;margin:0;padding:42px 54px}h1{font-size:36px;margin:12px 0}small{color:#677c90}article{border:1px solid #d9e0e8;background:white;border-radius:12px;padding:22px;margin:24px 0}h2{margin:0 0 12px;font-size:24px}label{display:block;margin:18px 0}input{font:inherit;padding:8px;width:280px}button,a{font:inherit;padding:8px 14px;cursor:pointer}#spacer{height:400px}.tag{color:#005ec4}');}
  else if(path.startsWith('/page/')){const id=path.split('/')[2];res.end(`<!doctype html><meta charset="utf-8"><title>合成工作页 ${id.toUpperCase()}</title><link rel="stylesheet" href="/page.css"><small>HOMER BROWSER LAB · 仅合成数据</small><h1>页面 ${id.toUpperCase()} · 内容操作</h1><p>同一页面供用户和模拟任务接力，测试备注、输入和后台状态。</p><label>任务输入 <input id="task-input" aria-label="任务输入" placeholder="等待模拟任务"></label><article id="item-one"><h2 id="heading-one">季度报告摘要</h2><p>这是第一处可批注内容。点击后应打开现有 Homer 备注表单。</p></article><article id="item-two"><h2 id="heading-two">待完善的结论</h2><p>这是第二处内容。多条标记应跟随页面滚动和布局变化。</p></article><button id="business">业务按钮</button> <span id="result">未点击</span><p class="tag">页面定时器：<span id="timer">0</span></p><button id="replace">重建第二个卡片</button><p><a id="navigate" href="/page/${id}?next=1">同页导航</a></p><div id="spacer"></div><article><h2 id="heading-three">页面下方的建议</h2><p>用于验证滚动后选择与定位。</p></article><script src="/fixture.js"></script>`);}
  else{res.statusCode=404;res.end('Not found');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const env={...process.env,DEMO_PROFILE:profile,DEMO_BUILD:compiled,DEMO_ORIGIN:origin};delete env.ELECTRON_RUN_AS_NODE;
 application=await _electron.launch({executablePath:require('electron'),args:[join(here,'main.cjs')],env,timeout:30000});
 const main=async(method,...args)=>application.evaluate((_,{method,args})=>globalThis.demo[method](...args),{method,args});
 const wait=async(check)=>{const start=Date.now();while(Date.now()-start<15000){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw Error('demo_wait_timeout');};
 await wait(()=>main('state').then(s=>s.length===2&&s.every(p=>p.title)));
 await wait(()=>application.context().pages().length===3);
 const host=application.context().pages().find(p=>p.url()===origin+'/host');
 const pages=Object.fromEntries(['a','b'].map(id=>[id,application.context().pages().find(p=>p.url()===origin+'/page/'+id)]));
 assert(host&&pages.a&&pages.b,'WCV targets must be real Playwright pages');
 for(const p of [host,...Object.values(pages)])p.on('pageerror',e=>errors.push(e.message));
 await wait(()=>main('content','a','!!globalThis.annotationDemo'));
 pass('Playwright discovers two WebContentsView targets',await main('state'));
 async function task(id,fn,version){const state=(await main('state')).find(p=>p.id===id);await main('begin','task-'+id,id,version??state.version);try{return await fn(pages[id]);}finally{await main('finish',id);}}
 await main('show','none');
 await Promise.all(['a','b'].map(id=>task(id,async p=>{await p.getByLabel('任务输入').fill('来自 task-'+id);assert.equal(await p.getByLabel('任务输入').inputValue(),'来自 task-'+id);})));
 assert.equal(await main('selected'),'none');pass('two simulated tasks fill distinct hidden pages without selecting them');
 await assert.rejects(main('begin','task-b','a',1),/wrong_task/);pass('wrong task cannot acquire another page');
 await host.getByRole('button',{name:'annotate-a',exact:true}).click();
 async function note(target,text){await pages.a.locator(target).click();const input=pages.a.getByRole('textbox',{name:'网页元素批注'});await input.fill(text);await pages.a.getByRole('button',{name:'保存',exact:true}).click();await input.waitFor({state:'detached'});}
 await note('#heading-one','请把摘要改为可执行的下一步。');
 await pages.a.getByRole('button',{name:'批注 1',exact:true}).click();
 await pages.a.getByRole('textbox',{name:'网页元素批注'}).fill('请把摘要改为可执行的下一步。');
 await pages.a.screenshot({path:join(output,'page-editor.png')});
 assert.equal(await pages.a.getByRole('textbox',{name:'网页元素批注'}).evaluate(e=>getComputedStyle(e.closest('form')).backgroundColor),'rgb(26, 26, 26)');
 assert.equal(await pages.a.evaluate(()=>typeof globalThis.annotationBridge),'undefined');
 assert.equal(await pages.a.evaluate(()=>typeof require),'undefined');
 await pages.a.getByRole('button',{name:'取消',exact:true}).click();
 pass('strict CSP page renders isolated existing form CSS; site cannot see preload bridge or require');
 await note('#heading-two','补充这条结论的数据依据。');
 await pages.a.locator('#heading-three').scrollIntoViewIfNeeded();await note('#heading-three','说明建议的负责人和时间。');
 assert.equal((await main('content','a','globalThis.annotationDemo.state()')).notes.length,3);pass('React Grab selects three real DOM elements; existing form commits to existing draft');
 await pages.a.locator('#heading-one').scrollIntoViewIfNeeded();
 await pages.a.getByRole('button',{name:'批注 1',exact:true}).click();
 await pages.a.getByRole('textbox',{name:'网页元素批注'}).fill('已编辑：保留摘要并补充行动项。');
 await pages.a.getByRole('button',{name:'保存',exact:true}).click();
 await pages.a.getByRole('button',{name:'批注 1',exact:true}).click();
 await pages.a.getByRole('button',{name:'删除此批注'}).click();
 await wait(()=>main('content','a','globalThis.annotationDemo.state().notes.length===2'));
 pass('multiple markers support edit and delete');
 await pages.a.locator('#heading-one').click();
 const pendingInput=pages.a.getByRole('textbox',{name:'网页元素批注'});await pendingInput.fill('草稿确认失败时保留这段输入');
 await host.evaluate(()=>globalThis.demoBumpRevision());
 await pages.a.getByRole('button',{name:'保存',exact:true}).click();
 await pages.a.getByRole('alert').waitFor();assert.equal(await pendingInput.inputValue(),'草稿确认失败时保留这段输入');
 await pages.a.getByRole('button',{name:'取消',exact:true}).click();pass('stale draft confirmation fails without losing editor text');
 await note('#heading-one','长备注'.repeat(1500));
 assert.equal((await main('content','a','globalThis.annotationDemo.state()')).notes.at(-1).comment.length,4500);
 await pages.a.getByRole('button',{name:'批注 3',exact:true}).click();await pages.a.getByRole('button',{name:'删除此批注'}).click();
 pass('4500-character note crosses real isolated renderer/main/host IPC and draft round trip');
 await pages.a.locator('#business').click();await pages.a.getByRole('textbox',{name:'网页元素批注'}).waitFor();assert.equal(await pages.a.evaluate(()=>window.businessClicks),0);
 await pages.a.getByRole('button',{name:'取消',exact:true}).click();
 await main('userAction','browse','a');await pages.a.locator('#business').click();assert.equal(await pages.a.evaluate(()=>window.businessClicks),1);assert(await pages.a.evaluate(()=>window.ticks)>0);pass('annotation mode suppresses business click; browse mode restores it; timer runs');
 await assert.rejects(task('a',p=>p.getByLabel('任务输入').fill('禁止')),/user_control/);
 await main('userAction','resume','a');await task('a',p=>p.getByLabel('任务输入').fill('用户接手后继续'));pass('handoff rejects subsequent task writes; explicit resume works');
 await main('show','a');await pages.a.locator('#heading-two').scrollIntoViewIfNeeded();
 await pages.a.locator('#replace').click();
 await main('zoom','a',1.1);
 await wait(async()=>{const r=await pages.a.locator('#heading-two').boundingBox(),m=await pages.a.getByRole('button',{name:'批注 1',exact:true}).boundingBox();return r&&m&&Math.abs((m.y+14*1.1)-r.y)<3;});
 pass('marker follows replaced DOM node and zoomed/scrolled layout');await main('zoom','a',1);
 await pages.a.screenshot({path:join(output,'page-annotations.png')});
 await host.getByRole('button',{name:'发送为引用（Demo）'}).click();
 const sent=await host.getByTestId('sent-reference').textContent();assert.match(sent,/用户批注/);assert.match(sent,/http:\/\/127.0.0.1/);
 await host.screenshot({path:join(output,'host-draft-reference.png')});pass('draft produces existing resourceReferenceText',sent.slice(0,250));
 const before=(await main('state')).find(p=>p.id==='a').version;
 await task('a',p=>p.locator('#navigate').click());await wait(()=>main('state').then(s=>s.find(p=>p.id==='a').version>before));
 await wait(()=>main('content','a','!!globalThis.annotationDemo'));
 await assert.rejects(main('begin','task-a','a',before),/document_changed/);
 await main('userAction','annotate','a');await note('#heading-one','导航后的批注，来源为当前 URL。');pass('navigation reinstalls isolated runtime and rejects old document');
 await main('close','b');await assert.rejects(main('begin','task-b','b',1),/page_unavailable/);pass('closed target is unavailable');
 assert.deepEqual(errors,[]);pass('no renderer pageerrors');
 const versions=await application.evaluate(()=>({electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node}));
 await writeFile(join(output,'report.json'),JSON.stringify({status:'passed',versions,results,errors,scope:'Synthetic tasks/pages only; no real Worker/LLM, Homer service, installed app, login, IME OS composition or Windows verification.'},null,2));
 await rm(join(output,'failure.json'),{force:true});
 if(process.argv.includes('--interactive')){console.log('Interactive Demo open; close its window to finish.');await new Promise(r=>application.once('close',r));application=undefined;}
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({status:'failed',message:error.stack,results,errors},null,2));throw error;}
finally{if(application)await application.close();if(server)await new Promise(r=>server.close(r));await rm(scratch,{recursive:true,force:true});}
