import test from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import {createRequire} from 'node:module';import {resolve} from 'node:path';import {React,withDom} from './helpers/process-dom.mjs';
const require=createRequire(import.meta.url),built=buildSync({entryPoints:[resolve('ui/task-execution-record.tsx')],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime','react-dom'],loader:{'.css':'empty'}}),mod={exports:{}};Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
const {TaskExecutionRecord,ExecutionObservationContext}=mod.exports,h=React.createElement;
const worker={id:'worker',taskId:'task',pendingUser:0,pendingMain:0,pendingUsers:[],run:{id:'run',taskId:'task',workerId:'worker',version:1,epoch:1,status:'running',phase:'executing',createdAt:1000,startedAt:2000,errorCode:null}};
const task={id:'task',headVersion:1,controlState:'normal',state:'open',workers:[worker],results:[],deliveries:[]};
test('execution record defaults collapsed, loads only on open, and preserves explicit collapse across revisions',async()=>withDom(async d=>{
 let calls=[];const read=async url=>{calls.push(url);return new Response(JSON.stringify(url.endsWith('/task')?{taskId:'task',runs:[{...worker.run,taskId:'task',activeMs:0,errorCode:'restart_unconfirmed'}]}:{selector:{taskId:'task',runId:'run'},version:1,storeGeneration:'generation',revision:1,availability:'available',coverage:'partial',retention:'memory',items:[],active:[],hasMore:false,omitted:false}),{status:200});};
 const render=(revision=0)=>d.render(h(ExecutionObservationContext.Provider,{value:{connected:true,enabled:true,revision,scope:'thread:epoch',read}},h(TaskExecutionRecord,{task,worker})));
 await render();assert.equal(calls.length,0);let toggle=d.find(n=>n.attrs['data-slot']==='collapsible-trigger');assert.equal(toggle.attrs['aria-expanded'],'false');
 await d.click(toggle);assert.equal(calls.length,2);assert.match(d.container.textContent,/restart_unconfirmed/);assert.match(d.container.textContent,/活跃.*0/);assert.match(d.container.textContent,/近期内存/);
 await d.click(toggle);await render(2);assert.equal(toggle.attrs['aria-expanded'],'false');assert.equal(calls.length,2);
}));
test('a retained failed call reads safe body only when explicitly expanded',async()=>withDom(async d=>{
 const key='a'.repeat(64),summary={callKey:key,seq:1,revision:1,scope:{taskId:'task',runId:'run',version:1,epoch:1,threadId:'worker',turnId:'turn'},category:'command',status:'failed',terminalObserved:true,firstObservedAtMs:1000,lastObservedAtMs:2000,exitCode:1,timingSource:'hostObserved',contentState:'available'};let bodies=0;
 const read=async url=>new Response(JSON.stringify(url.includes('/calls/')?(bodies++,{selector:{taskId:'task',runId:'run'},callKey:key,revision:1,summary,contentState:'available',content:{input:{state:'hidden'},output:{state:'recorded',value:{exitCode:1}}}}):url.endsWith('/task')?{taskId:'task',runs:[]}:{selector:{taskId:'task',runId:'run'},version:1,storeGeneration:'g',revision:1,availability:'available',items:[summary],active:[],hasMore:false,omitted:false}),{status:200});
 await d.render(h(ExecutionObservationContext.Provider,{value:{connected:true,enabled:true,revision:1,scope:'thread:epoch',read}},h(TaskExecutionRecord,{task,worker})));
 await d.click(d.find(n=>n.attrs['data-slot']==='collapsible-trigger'));assert.equal(bodies,0);assert.match(d.container.textContent,/调用失败/);assert.match(d.container.textContent,/退出码 1/);
 await d.click(d.find(n=>n.attrs['data-execution-call']===key));assert.equal(bodies,1);assert.match(d.container.textContent,/exitCode/);
}));
test('a response from an earlier connection cannot populate the new connection',async()=>withDom(async d=>{
 let release;const delayed=new Promise(resolve=>{release=resolve;});
 const read=async url=>url.endsWith('/task')?new Response(JSON.stringify({taskId:'task',runs:[]})):delayed;
 const render=scope=>d.render(h(ExecutionObservationContext.Provider,{value:{connected:true,enabled:true,revision:1,scope,read}},h(TaskExecutionRecord,{task,worker})));
 await render('old');await d.click(d.find(n=>n.attrs['data-slot']==='collapsible-trigger'));
 await render('new');
 await React.act(async()=>release(new Response(JSON.stringify({selector:{taskId:'task',runId:'run'},version:1,storeGeneration:'old-generation',revision:1,availability:'available',items:[],active:[],hasMore:false,omitted:false}))));
 assert.doesNotMatch(d.container.textContent,/近期内存记录/);
 assert.equal(d.find(n=>n.attrs['data-slot']==='collapsible-trigger').attrs['aria-expanded'],'false');
}));
test('successful step read cannot hide failed history read as empty history',async()=>withDom(async d=>{
 const read=async url=>url.endsWith('/task')?new Response(JSON.stringify({error:'synthetic_failure'}),{status:500}):new Response(JSON.stringify({selector:{taskId:'task',runId:'run'},version:1,storeGeneration:'g',revision:1,availability:'available',items:[],active:[],hasMore:false,omitted:false}));
 await d.render(h(ExecutionObservationContext.Provider,{value:{connected:true,enabled:true,revision:1,scope:'thread',read}},h(TaskExecutionRecord,{task,worker})));
 await d.click(d.find(n=>n.attrs['data-slot']==='collapsible-trigger'));
 await d.click(d.find(n=>n.tagName==='BUTTON'&&n.textContent==='其他版本与执行'));
 assert.match(d.container.textContent,/执行资料读取失败/);assert.doesNotMatch(d.container.textContent,/当前读取范围没有其他执行资料/);
}));
test('original conversation loads on demand, pages messages and appends long text without exposing another Worker',async()=>withDom(async d=>{
 const calls=[],message={id:'m1',seq:1,kind:'worker_reply',runId:'run',version:1,text:'原文第一段\n\n',offset:0,nextOffset:24000};
 const read=async url=>{calls.push(url);return Response.json(url.includes('/workers/')?{taskId:'task',runs:[],conversation:{taskId:'task',workerId:'worker',threadId:'wt',messages:url.includes('/messages/')?[{...message,text:'结尾 /safe/report.md',offset:24000,nextOffset:null}]:url.includes('/after/')?[{...message,id:'m2',seq:2,kind:'worker_input',text:'继续核对',nextOffset:null}]:[message],nextCursor:url.endsWith('/worker')?1:null}}:url.endsWith('/task')?{taskId:'task',runs:[]}:{selector:{taskId:'task',runId:'run'},version:1,storeGeneration:'g',revision:1,availability:'available',items:[],active:[],hasMore:false});};
 await d.render(h(ExecutionObservationContext.Provider,{value:{connected:true,enabled:true,revision:1,scope:'thread',read}},h(TaskExecutionRecord,{task,worker})));
 await d.click(d.find(n=>n.attrs['data-slot']==='collapsible-trigger'));assert.equal(calls.filter(u=>u.includes('/workers/')).length,0);
 await d.click(d.find(n=>n.tagName==='BUTTON'&&n.textContent==='会话原文'));assert.match(d.container.textContent,/原文第一段/);
 await d.click(d.find(n=>n.tagName==='BUTTON'&&n.textContent==='继续读取这条原文'));assert.match(d.container.textContent,/原文第一段\n\n结尾 \/safe\/report.md/);
 await d.click(d.find(n=>n.tagName==='BUTTON'&&n.textContent==='加载后续消息'));assert.match(d.container.textContent,/继续核对/);
 assert.deepEqual(calls.filter(u=>u.includes('/workers/')),['/api/tasks/task/workers/worker','/api/tasks/task/workers/worker/messages/m1/24000','/api/tasks/task/workers/worker/after/1']);
}));
