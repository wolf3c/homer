import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import React,{act} from 'react';
import {withDom} from './helpers/process-dom.mjs';

const require=createRequire(import.meta.url);
function load(){const out=buildSync({entryPoints:['ui/channel-settings.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['react'],logLevel:'silent'});const m={exports:{}};Function('require','module','exports',out.outputFiles[0].text)(require,m,m.exports);return m.exports;}
const tg={status:'offline',configured:true,enabled:false,bound:true,botId:'123',ownerId:'100',chatId:'100',bindingVersion:1,pending:0,uncertain:0,failed:0,heldInputs:0,uncertainInputs:0};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function session(run,fetcher){return withDom(async d=>{
 const oldFetch=globalThis.fetch,oldLocation=globalThis.location,oldStorage=globalThis.sessionStorage;
 const entries=new Map();globalThis.sessionStorage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};
 globalThis.location=new URL('http://127.0.0.1:12345/');
 const calls=[];globalThis.fetch=async(path,init)=>{calls.push({path,init});assert.equal(init?.credentials,'omit');return fetcher?fetcher(path,init):Response.json(tg);};
 let model;const {useChannelSettings,canStartChannel}=load();
 function Harness({active}){model=useChannelSettings('telegram',active);return React.createElement('div',null,model.error);}
 const render=(active,key=0)=>d.render(React.createElement(Harness,{active,key}));
 try{await render(true);await run({d,calls,render,get model(){return model;},canStartChannel});}
 finally{await d.render(null);globalThis.fetch=oldFetch;if(oldStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=oldStorage;if(oldLocation===undefined)delete globalThis.location;else globalThis.location=oldLocation;}
});}

test('opening, leaving and reopening only reads state; activation requires verified new-message recovery',()=>session(async f=>{
 assert.equal(f.model.state.configured,true);assert.equal(f.canStartChannel(f.model.state),false);
 assert.equal(f.canStartChannel({...tg,recovery:{mode:'new_messages_only',clockVerified:true,reviewRequired:false,heldLocal:8,heldRemote:0}}),true);
 assert.equal(f.canStartChannel({...tg,recovery:{mode:'new_messages_only',clockVerified:false,reviewRequired:false}}),false);
 assert.equal(f.canStartChannel({...tg,recovery:{mode:'new_messages_only',clockVerified:true,reviewRequired:true}}),false);
 assert.equal(f.canStartChannel({...tg,status:'review_required',recovery:{mode:'new_messages_only',clockVerified:true,reviewRequired:false}}),false);
 await f.render(false);await f.render(true);
 assert.ok(f.calls.length>=2);assert.ok(f.calls.every(c=>!c.init?.method));
}));
test('failed or malformed state stays unknown, never becomes unconfigured and never reflects private errors',async()=>{
 for(const response of [()=>Response.json({error:'web_method_denied',detail:'PRIVATE'},{status:409}),()=>Response.json({configured:false}),()=>Response.json({...tg,status:'__proto__'}),()=>{throw Error('PRIVATE');}])await session(async f=>{
  assert.equal(f.model.state,undefined);assert.ok(f.model.error);assert.doesNotMatch(f.model.error,/PRIVATE/);assert.ok(f.calls.every(c=>!c.init?.method));
 },response);
});
test('a late GET cannot overwrite a completed save; close does not unlock an in-flight mutation',async()=>{
 const read=deferred(),save=deferred();let reads=0;
 await session(async f=>{
  await act(async()=>{void f.model.refresh();});
  let request;await act(async()=>{request=f.model.run('/configure',{token:'123456:synthetic_settings_fixture_123456789'});});
  assert.equal(f.model.busy,true);await f.render(false);await f.render(true);
  await act(async()=>{void f.model.run('/configure',{token:'duplicate'});});
  assert.equal(f.calls.filter(c=>c.init?.method==='POST').length,1);
  await act(async()=>save.resolve(Response.json({...tg,configured:true,bound:false})));
  await request;assert.equal(f.model.state.bound,false);
  await act(async()=>read.resolve(Response.json({...tg,configured:false})));
  assert.equal(f.model.state.configured,true);assert.equal(f.model.state.bound,false);
 },(_path,init)=>init?.method==='POST'?save.promise:++reads===2?read.promise:Response.json({...tg,bound:false}));
});
test('unconfirmed save stays locked after reopening and configured:true reads cannot certify a token update',()=>session(async f=>{
 await act(async()=>{await f.model.run('/configure',{token:'123456:synthetic_settings_fixture_123456789'});});
 assert.equal(f.model.unconfirmed,true);await f.render(false);await f.render(true);
 await act(async()=>{await f.model.refresh();});assert.equal(f.model.state.configured,true);assert.equal(f.model.unconfirmed,true);
 await act(async()=>{await f.model.run('/configure',{token:'duplicate'});});
 assert.equal(f.calls.filter(c=>c.init?.method==='POST').length,1);
},(_path,init)=>init?.method==='POST'?Response.json({error:'web_receipt_unconfirmed'},{status:409}):Response.json(tg)));
test('configure deadline includes stalled response bodies and does not retry',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 await session(async f=>{
  let request;await act(async()=>{request=f.model.run('/configure',{token:'123456:synthetic_settings_fixture_123456789'});});
  await act(async()=>{t.mock.timers.tick(95000);await request;});
  assert.equal(f.model.busy,false);assert.equal(f.model.unconfirmed,true);
  assert.equal(f.calls.filter(c=>c.init?.method==='POST').length,1);
 },(_path,init)=>init?.method==='POST'?{ok:true,json:()=>new Promise(()=>{})}:Response.json(tg));
});

test('unconfirmed operation survives owner replacement and stores no secret',()=>session(async f=>{
 await act(async()=>{await f.model.run('/configure',{token:'123456:synthetic_settings_fixture_123456789'});});
 assert.equal(sessionStorage.getItem('homer.channel-operation.telegram'),'pending');
 await f.render(true,1);assert.equal(f.model.unconfirmed,true);
 await act(async()=>{await f.model.run('/configure',{token:'duplicate'});});
 assert.equal(f.calls.filter(c=>c.init?.method==='POST').length,1);
},(_path,init)=>init?.method==='POST'?Response.json({error:'web_receipt_unconfirmed'},{status:409}):Response.json(tg)));
test('pending operation stays locked if its owner disappears before the response',async()=>{
 const save=deferred();await session(async f=>{
  let request;await act(async()=>{request=f.model.run('/configure',{token:'synthetic'});});
  await f.render(true,1);assert.equal(f.model.unconfirmed,true);
  await act(async()=>{await f.model.run('/configure',{token:'duplicate'});});
  assert.equal(f.calls.filter(c=>c.init?.method==='POST').length,1);
  await act(async()=>save.resolve(Response.json({...tg,configured:true})));
  await request;assert.equal(sessionStorage.getItem('homer.channel-operation.telegram'),null);
  assert.equal(f.model.unconfirmed,true,'ordinary GET cannot certify an operation owned by a previous mount');
 },(_path,init)=>init?.method==='POST'?save.promise:Response.json(tg));
});
test('six-second reads are not perpetually superseded by five-second polling',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});let reads=0;
 await session(async f=>{
  assert.equal(f.model.state,undefined);
  await act(async()=>{t.mock.timers.tick(5000);});assert.equal(reads,1);
  await act(async()=>{t.mock.timers.tick(1000);});assert.equal(f.model.state.configured,true);
 },()=>{reads++;return new Promise(resolve=>setTimeout(()=>resolve(Response.json(tg)),6000));});
});

test('unavailable session storage cannot dispatch a mutation without its restart guard',()=>session(async f=>{
 sessionStorage.setItem=()=>{throw Error('storage denied');};
 await act(async()=>{await f.model.run('/configure',{token:'synthetic'});});
 assert.equal(f.model.unconfirmed,true);assert.ok(f.calls.every(c=>!c.init?.method));
}));

test('closed settings and hidden documents issue no periodic state queries',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 await session(async f=>{
  const initial=f.calls.length;await f.render(false);
  await act(async()=>{t.mock.timers.tick(10000);});assert.equal(f.calls.length,initial);
  await f.render(true);const reopened=f.calls.length;Object.defineProperty(document,'hidden',{value:true,writable:true,configurable:true});
  await act(async()=>{t.mock.timers.tick(10000);});assert.equal(f.calls.length,reopened);
  document.hidden=false;await act(async()=>{t.mock.timers.tick(5000);});assert.equal(f.calls.length,reopened+1);
 });
});

test('a state-shaped response cannot certify a pairing-code operation',()=>session(async f=>{
 await act(async()=>{await f.model.run('/pair');});assert.equal(f.model.unconfirmed,true);
 await act(async()=>{await f.model.run('/pair');});assert.equal(f.calls.filter(c=>c.init?.method==='POST').length,1);
},()=>Response.json({...tg,recovery:{mode:'new_messages_only',clockVerified:true,reviewRequired:false}})));
