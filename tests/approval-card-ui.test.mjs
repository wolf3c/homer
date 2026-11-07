import test from 'node:test';
import assert from 'node:assert/strict';
import {React,withDom} from './helpers/process-dom.mjs';
import {interactionComponent} from './helpers/approval-ui-loader.mjs';
const h=React.createElement;
const item={id:'approval',runId:'main-native:generation',kind:'authorization',workTitle:'主对话',sourceRequestId:'source',question:'确认本次操作：\n/bin/echo "<script>合成命令</script>"\n工作目录：/synthetic/中文路径',reason:'仅授权当前请求；不授予永久权限或自动重试。'};
const props={item,threadId:'thread',messages:[{id:'original',role:'user',requestId:'source',text:'原始请求'}],acceptedRequestIds:[],verified:true,onError:()=>{},onNotLive:()=>{}};
const button=(d,label)=>d.find(n=>n.tagName==='BUTTON'&&n.textContent===label);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('main-native uses official card and current-request controls with exact source and safe full text',async()=>withDom(async d=>{
 const Card=interactionComponent(async()=>{});await d.render(h(Card,props));
 assert.ok(d.find(n=>n.attrs['data-slot']==='approval-card'));
 assert.equal(d.all().filter(n=>n.tagName==='BUTTON').length,2);
 assert.equal(d.all().some(n=>n.tagName==='SCRIPT'),false);
 assert.match(d.container.textContent,/<script>合成命令<\/script>/);
 assert.ok(d.find(n=>n.tagName==='A'&&n.attrs.href==='#message-original'));
 assert.doesNotMatch(d.container.textContent,/始终允许|Always allow|永久授权/);
}));
test('a Worker approval submits the same explicit decision without a free-text reply',async()=>withDom(async d=>{
 const calls=[],Card=interactionComponent(async(...args)=>{calls.push(args);});
 await d.render(h(Card,{...props,item:{...item,runId:'worker-run',workTitle:'合成事项'}}));
 const approve=button(d,'允许本次操作');assert.ok(approve);
 await d.click(approve);
 assert.equal(calls[0][0],'/api/interactions/approval');
 assert.equal(calls[0][1].text,'允许本次操作');
}));
for(const label of ['允许本次操作','拒绝本次操作'])test(label+' submits once even before React rerenders',async()=>withDom(async d=>{
 const pending=deferred(),calls=[];const Card=interactionComponent((...args)=>{calls.push(args);return pending.promise;});
 await d.render(h(Card,props));const b=button(d,label);
 await React.act(async()=>{for(let i=0;i<2;i++){const event={type:'click',target:b,button:0,bubbles:true,preventDefault(){},stopPropagation(){}};for(const listener of d.container.listeners.click??[])if(!listener.capture)listener.handler(event);}});
 assert.equal(calls.length,1);assert.equal(calls[0][0],'/api/interactions/approval');assert.equal(calls[0][1].text,label);assert.ok(calls[0][1].requestId);
 assert.ok('disabled' in button(d,label).attrs);assert.doesNotMatch(d.container.textContent,/命令成功|执行成功|Finished|Approved, running/);
 pending.resolve();await d.render(h(Card,props));
}));
test('unverified blocks decisions, unknown receipt retries exact payload across remount, accepted stays locked',async()=>withDom(async d=>{
 const calls=[];const Card=interactionComponent(async(...args)=>{calls.push(args);throw Error('synthetic_unknown');});
 await d.render(h(Card,{...props,verified:false}));assert.ok('disabled' in button(d,'允许本次操作').attrs);await d.click(button(d,'允许本次操作'));assert.equal(calls.length,0);
 await d.render(h(Card,props));await d.click(button(d,'允许本次操作'));assert.equal(calls.length,1);
 await d.remount();await d.render(h(Card,props));await d.click(button(d,'允许本次操作'));assert.deepEqual(calls[1],calls[0]);
 await d.render(h(Card,{...props,acceptedRequestIds:[calls[0][1].requestId]}));assert.ok('disabled' in button(d,'允许本次操作').attrs);
 assert.doesNotMatch(d.container.textContent,/Finished|执行成功|命令成功/);
}));
test('expired callback keeps exact target; an unmounted or changed owner ignores late failures',async()=>withDom(async d=>{
 const expired=[],errors=[];let response=deferred();const Card=interactionComponent(()=>response.promise);
 const p={...props,onNotLive:i=>expired.push(i.id),onError:e=>{if(e)errors.push(e);}};
 await d.render(h(Card,p));await d.click(button(d,'拒绝本次操作'));response.reject(Error('interaction_not_live'));await d.render(h(Card,p));assert.deepEqual(expired,['approval']);
 await d.remount();response=deferred();await d.render(h(Card,p));await d.click(button(d,'允许本次操作'));
 await d.render(h(Card,{...p,threadId:'other-thread',item:{...item,id:'other'}}));response.reject(Error('synthetic_late'));await d.render(h(Card,{...p,threadId:'other-thread',item:{...item,id:'other'}}));assert.deepEqual(errors,[]);
 await d.remount();response=deferred();await d.render(h(Card,p));await d.click(button(d,'允许本次操作'));await d.remount();response.reject(Error('interaction_not_live'));await d.render(h('div'));assert.deepEqual(expired,['approval']);
}));
test('late failure after verification is lost cannot overwrite the connection barrier',async()=>withDom(async d=>{
 const response=deferred(),errors=[],expired=[];const Card=interactionComponent(()=>response.promise);
 const p={...props,onError:e=>{if(e)errors.push(e);},onNotLive:i=>expired.push(i.id)};
 await d.render(h(Card,p));await d.click(button(d,'允许本次操作'));await d.render(h(Card,{...p,verified:false}));
 response.reject(Error('interaction_not_live'));await d.render(h(Card,{...p,verified:false}));assert.deepEqual(errors,[]);assert.deepEqual(expired,[]);
 await d.render(h(Card,p));assert.equal('disabled' in button(d,'允许本次操作').attrs,false,'reconnection permits exact explicit retry');
}));
test('an exact accepted receipt wins over a later lost POST response',async()=>withDom(async d=>{
 const response=deferred(),calls=[],errors=[],expired=[];const Card=interactionComponent((...args)=>{calls.push(args);return response.promise;});
 const p={...props,onError:e=>{if(e)errors.push(e);},onNotLive:i=>expired.push(i.id)};
 await d.render(h(Card,p));await d.click(button(d,'允许本次操作'));
 const accepted={...p,acceptedRequestIds:[calls[0][1].requestId]};await d.render(h(Card,accepted));
 response.reject(Error('synthetic_receipt_lost'));await d.render(h(Card,accepted));
 assert.deepEqual(errors,[]);assert.deepEqual(expired,[]);assert.ok('disabled' in button(d,'允许本次操作').attrs);assert.match(d.container.textContent,/决定已送达/);
}));
test('missing request identity cannot associate an unrelated message that also lacks identity',async()=>withDom(async d=>{
 const Card=interactionComponent(async()=>{});const p={...props,item:{...item,sourceRequestId:null,sourceMessageId:'exact-unloaded'},messages:[{id:'unrelated',role:'user',requestId:null,text:'不属于此审批'}]};
 await d.render(h(Card,p));assert.ok(d.find(n=>n.tagName==='A'&&n.attrs.href==='#message-exact-unloaded'));assert.doesNotMatch(d.container.textContent,/不属于此审批/);
}));

test('ordinary MCP offers single-request cancel with the same receipt and connection barrier',async()=>withDom(async d=>{
 const calls=[],pending=deferred(),Card=interactionComponent((...args)=>{calls.push(args);return pending.promise;}),p={...props,item:{...item,canCancel:true}};
 await d.render(h(Card,{...p,verified:false}));assert.ok(button(d,'取消本次请求'));assert.ok('disabled' in button(d,'取消本次请求').attrs);
 await d.render(h(Card,p));await d.click(button(d,'取消本次请求'));await d.click(button(d,'取消本次请求'));assert.equal(calls.length,1);assert.equal(calls[0][1].text,'取消本次请求');assert.ok(calls[0][1].requestId);assert.ok('disabled' in button(d,'允许本次操作').attrs);pending.resolve();await d.render(h(Card,p));assert.ok('disabled' in button(d,'取消本次请求').attrs);
}));
