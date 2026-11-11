// Requirement-derived contracts for the approved return to the pinned compact UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import React from 'react';
import {withDom} from './helpers/process-dom.mjs';
const require=createRequire(import.meta.url);
function load(entry){const result=buildSync({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'}});const module={exports:{}};Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);return module.exports;}
const {HomerMessageQueue}=load('ui/homer-message-queue.tsx');
const {MessageDetails}=load('ui/message-details.tsx');
const h=React.createElement;
test('queue starts collapsed and offers cancel only for its editable queued user item',async()=>queueEnvironment(async d=>{
 const calls=[],active={...queueItem,messageId:'message-active',input:{requestId:'request-active',text:'合成处理中正文'},state:'processing',statusText:'主 Agent 处理中',editable:false,position:2};
 globalThis.fetch=async()=>({ok:true,json:async()=>({...queuePage,items:[{...queueItem,input:{requestId:'request-b',text:'合成待发送正文'}},active]})});
 await d.render(h(HomerMessageQueue,{state:queueState,connected:true,operations:{locked:false,run:async(...args)=>{calls.push(args);return {};}}}));await flush();
 const toggle=d.find(n=>n.attrs.class==='queue-toggle');assert.equal(toggle.attrs['aria-expanded'],'false');assert.match(toggle.textContent,/消息队列 · 已加载 2 条/);await d.click(toggle);assert.equal(toggle.attrs['aria-expanded'],'true');
 assert.equal(d.all().filter(n=>n.tagName==='LI').length,2);assert.equal(d.container.textContent.match(/合成待发送正文/g).length,1);assert.equal(d.container.textContent.match(/合成处理中正文/g).length,1);
 assert.equal(d.all().some(n=>/编辑第|拖动第|调整第/.test(n.attrs['aria-label']??'')),false);
 const cancel=d.find(n=>/取消发送/.test(n.attrs['aria-label']??''));assert.ok(cancel);assert.equal(d.all().filter(n=>/取消发送/.test(n.attrs['aria-label']??'')).length,1);
 const activeRow=d.find(n=>n.tagName==='LI'&&n.textContent.includes('合成处理中正文'));assert.ok(activeRow);assert.equal(activeRow.contains(cancel),false);assert.match(activeRow.textContent,/主 Agent 处理中/);
 await d.click(cancel);assert.equal(calls.length,1);assert.equal(calls[0][0],'cancel');assert.equal(calls[0][1].requestId,'request-b');assert.equal(calls[0][1].expectedRevision,7);assert.equal(calls[0][1].threadId,'test');assert.equal(calls[0][1].readEpoch,'epoch');
}));

test('Sources has one official link per safe source and no duplicate preview action',async()=>withDom(async d=>{
 const sources=[{id:'one',title:'合成来源',url:'https://example.invalid/one'},{id:'bad',title:'禁止',url:'https://user:pass@example.invalid'}];
 await d.render(h(MessageDetails,{message:{id:'reply',role:'assistant',text:'',sources}}));
 await d.click(d.find(n=>n.attrs['data-slot']==='collapsible-trigger'));
 assert.equal(d.all().filter(n=>n.attrs['data-slot']==='source-card').length,1);
 assert.equal(d.all().some(n=>n.tagName==='BUTTON'&&n.textContent.includes('预览：')),false);
 assert.match(d.container.textContent,/未经独立核验/);
}));

const {useQueueOperations}=load('ui/queue-operations.ts');
const flush=async()=>React.act(async()=>{await new Promise(r=>setImmediate(r));});
async function queueEnvironment(run){
 const old={fetch:globalThis.fetch,location:globalThis.location,matchMedia:globalThis.matchMedia};
 globalThis.location={href:'http://fixture.invalid/',origin:'http://fixture.invalid'};globalThis.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 try{await withDom(async d=>{globalThis.window.dispatchEvent=()=>true;await run(d);});}finally{Object.assign(globalThis,old);}
}
const queueItem={origin:'user',input:{requestId:'request-b',text:'kept row'},messageId:'message-b',state:'queued',editable:true,user:{media:[]},revision:7,position:1};
const queueState={threadId:'test',messages:[],features:{queueSources:1},history:{readEpoch:'epoch'},queueDispatch:{orderVersion:1,totalWaiting:1,unscoped:3}};
const queuePage={threadId:'test',readEpoch:'epoch',orderVersion:1,items:[queueItem],totalWaiting:1};
test('queue removes all local notices and empty shells while read failure keeps rows disabled',async()=>queueEnvironment(async d=>{
 let fail=false;globalThis.fetch=async()=>{if(fail)throw Error('offline');return {ok:true,json:async()=>queuePage};};
 const props={state:queueState,connected:true,operations:{locked:false,run:async()=>({})}};
 await d.render(h(HomerMessageQueue,props));await flush();assert.ok(d.find(n=>n.tagName==='LI'));
 assert.equal(d.all().some(n=>n.attrs.class==='queue-pages'||n.attrs.class==='queue-notice'||n.attrs.role==='status'),false);
 fail=true;await d.render(h(HomerMessageQueue,{...props,state:{...queueState,queueDispatch:{...queueState.queueDispatch,orderVersion:2}}}));await flush();
 assert.ok(d.find(n=>n.tagName==='LI'));assert.equal(d.find(n=>/取消发送/.test(n.attrs['aria-label']??'')).attrs.disabled!==undefined,true);
 assert.equal(d.container.textContent.includes('重新核对'),false);
 await d.remount();await d.render(h(HomerMessageQueue,{...props,state:{threadId:'test',messages:[],queue:[],queueDispatch:{unscoped:2}},operations:{pending:{},locked:true}}));assert.equal(d.container.textContent,'');assert.equal(d.find(n=>n.tagName==='SECTION'),undefined);
}));
test('automatic Worker queue removal restores only focus owned by that queue',async()=>queueEnvironment(async d=>{
 const worker={origin:'worker',messageId:'notice',state:'processing',text:'Worker 事项',movable:false};
 globalThis.fetch=async()=>({ok:true,json:async()=>({...queuePage,items:[worker],totalWaiting:0})});
 const started={id:'process',threadId:'test',role:'assistant',status:'running',text:'',process:{threadId:'test',sourceKind:'worker',turnIds:['turn'],sourceMessageIds:['notice']}};
 const render=messages=>d.render(h(React.Fragment,null,h('div',{'data-composer':true,contentEditable:true}),h('button',{'data-other':true},'其他操作'),h(HomerMessageQueue,{state:{...queueState,messages,queueDispatch:{orderVersion:1,totalWaiting:0}},connected:true,operations:{locked:false}})));
 d.doc.querySelector=selector=>selector==='[contenteditable="true"]'?d.find(n=>n.attrs['data-composer']):null;
 await render([]);await flush();const composer=d.find(n=>n.attrs['data-composer']),other=d.find(n=>n.attrs['data-other']);
 const toggle=d.find(n=>n.attrs.class==='queue-toggle');toggle.focus();await render([]);await flush();assert.ok(d.doc.activeElement===toggle,'background refresh retains queue focus');
 await render([started]);await flush();assert.ok(!d.find(n=>n.tagName==='SECTION'),'represented Worker leaves no empty queue');assert.ok(d.doc.activeElement===composer,'removed queue hands focus back to the composer');
 await render([]);await flush();other.focus();await render([started]);await flush();assert.ok(d.doc.activeElement===other,'unrelated focus is not stolen');
}));
test('queue retains actual next and home page buttons with exact cursor requests',async()=>queueEnvironment(async d=>{
 const requests=[];globalThis.fetch=async(_url,options)=>{const input=JSON.parse(options.body);requests.push(input);return {ok:true,json:async()=>({...queuePage,...(!input.cursor?{nextCursor:'next'}:{})})};};
 await d.render(h(HomerMessageQueue,{state:queueState,connected:true,operations:{locked:false}}));await flush();
 await d.click(d.find(n=>n.textContent==='查看下一页'&&n.tagName==='BUTTON'));await flush();assert.equal(requests.at(-1).cursor,'next');
 await d.click(d.find(n=>n.textContent==='返回待发送首页'&&n.tagName==='BUTTON'));await flush();assert.equal(requests.at(-1).cursor,undefined);
}));
test('unknown queue mutation stays locked until both operation and request identities match',async()=>queueEnvironment(async d=>{
 let api,mode='unknown';const writes=[];
 function Probe({state}){api=useQueueOperations(state,true);return null;}
 globalThis.fetch=async(path,options)=>{const body=JSON.parse(options.body);if(path==='/api/messages/cancel'){writes.push(body);throw Error('lost response');}assert.equal(path,'/api/history/receipts');assert.deepEqual(body.operations,[{requestId:'request-b',operationId:'op-one'}]);if(mode==='unknown')throw Error('read failed');return {ok:true,json:async()=>({operations:[{operationId:mode==='mismatch-operation'?'other':'op-one',...(mode==='missing-request'?{}:{requestId:mode==='mismatch-request'?'other-request':'request-b'}),committed:true,result:{}}]})};};
 await d.render(h(Probe,{state:queueState}));
 await React.act(async()=>{await api.run('cancel',{requestId:'request-b',operationId:'op-one',expectedRevision:7});});await flush();
 assert.equal(api.locked,true);assert.equal(api.busy,false);assert.equal(writes.length,1);assert.equal(JSON.parse(sessionStorage.getItem('homer-queue-operation:test')).payload.operationId,'op-one');
 let orderVersion=1;
 for(mode of ['mismatch-operation','missing-request','mismatch-request']){await d.render(h(Probe,{state:{...queueState,queueDispatch:{orderVersion:++orderVersion}}}));await flush();assert.equal(api.locked,true,mode);}
 mode='exact';await d.render(h(Probe,{state:{...queueState,queueDispatch:{orderVersion:++orderVersion}}}));await flush();assert.equal(api.locked,false);assert.equal(sessionStorage.getItem('homer-queue-operation:test'),null);assert.equal(writes.length,1);
}));

test('definitive queue rejection releases only that operation while uncertain failure retains it',async()=>queueEnvironment(async d=>{
 let api;function Probe(){api=useQueueOperations(queueState,true);return null;}
 globalThis.fetch=async(path)=>path==='/api/messages/cancel'?{ok:false,json:async()=>({error:'queue_revision_conflict'})}:{ok:true,json:async()=>({operations:[]})};
 await d.render(h(Probe));await React.act(async()=>{await api.run('cancel',{requestId:'request-b',operationId:'rejected',expectedRevision:6});});await flush();
 assert.equal(api.locked,false);assert.equal(sessionStorage.getItem('homer-queue-operation:test'),null);
}));
