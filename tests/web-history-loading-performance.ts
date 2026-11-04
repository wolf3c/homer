import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {historyFixture,syntheticRoot} from './web-history-loading-fixture.js';
import {WebHistoryPages} from '../src/web-history-pages.js';
import {homerWebBridge} from '../src/web-homer.js';
import type {Homer} from '../src/service.js';
const records=[];
for(const total of [20,1000,10000])for(const limit of [20,40,80]){
 const f=historyFixture(total,160,true),reader=new WebHistoryPages(f.history,f.processes,f.inputs);let rows=0,queries=0,sqlBytes=0;const plans:unknown[]=[];
 const prepare=f.store.db.prepare.bind(f.store.db);
 f.store.db.prepare=sql=>{const statement=prepare(sql);for(const method of ['all','get'] as const){const original=statement[method].bind(statement);Reflect.set(statement,method,(...args:unknown[])=>{queries++;const result=Reflect.apply(original,statement,args);const list=Array.isArray(result)?result:result?[result]:[];rows+=list.length;sqlBytes+=Buffer.byteLength(JSON.stringify(result??null));return result;});}
  if((sql.startsWith('SELECT u.id,u.position')||sql.includes('feedbackValue FROM'))){const all=statement.all.bind(statement);statement.all=((...args:Parameters<typeof all>)=>{if(plans.length<2)plans.push(prepare('EXPLAIN QUERY PLAN '+sql).all(...args));return all(...args);}) as typeof statement.all;}return statement;};
 const samples=[],serializedSamples=[];let bytes=0,display=0;
 for(let i=0;i<30;i++){const start=performance.now();const page=reader.read('synthetic-history',{limit});samples.push(performance.now()-start);bytes=Buffer.byteLength(JSON.stringify(page));serializedSamples.push(performance.now()-start);display=page.messages.length;}
 samples.sort((a,b)=>a-b);serializedSamples.sort((a,b)=>a-b);records.push({total,limit,displayMessages:display,initialization:reader.initialization,queriesPerRead:queries/30,returnedRowsPerRead:rows/30,sqlReturnedBytesPerRead:sqlBytes/30,pageBytes:bytes,projectionMs:{median:(samples[14]!+samples[15]!)/2,p95:samples[28]},rawReadMs:samples,readAndSerializeMs:serializedSamples,plans});f.close();
}
const giant=[];
for(const bytes of [65536,1048576])for(const kind of ['body','process'] as const){
 const f=historyFixture(40);
 if(kind==='body'){f.store.db.prepare("UPDATE conversation_messages SET text=? WHERE id='node-39'").run('x'.repeat(bytes));const node=f.processes.exact('node-39')!;f.store.setMeta('publicMainNode:v1:node-39',JSON.stringify({...node,final:{id:'final-native',text:'x'.repeat(bytes)},completedItemIds:[],itemPhases:{}}));}
 if(kind==='process'){
  const node=f.processes.exact('node-39')!;node.items=[{id:'large',kind:'commentary',phase:'commentary',seq:1,revision:1,text:'x'.repeat(bytes)}];f.store.setMeta('publicMainNode:v1:node-39',JSON.stringify({...node,completedItemIds:[],itemPhases:{}}));
 }
 const reader=new WebHistoryPages(f.history,f.processes,f.inputs),samples=[];let pageBytes=0,parseMs=0;
 for(let i=0;i<30;i++){const start=performance.now(),page=reader.read('synthetic-history');const serialized=JSON.stringify(page);samples.push(performance.now()-start);pageBytes=Buffer.byteLength(serialized);const parse=performance.now();JSON.parse(serialized);parseMs+=performance.now()-parse;}
 samples.sort((a,b)=>a-b);const detailStart=performance.now(),detail=reader.process('node-39','synthetic-history');const detailMs=performance.now()-detailStart;
 if(kind==='process'){
  const item=detail.items.find(item=>item.id==='large');assert.ok(item?.kind==='commentary');
  assert.equal(item.text.length,bytes,'large public process must reach expanded detail');
 }
 giant.push({kind,singleBytes:bytes,total:40,initialization:reader.initialization,pageBytes,medianMs:(samples[14]!+samples[15]!)/2,p95Ms:samples[28],rawReadAndSerializeMs:samples,jsonParseMeanMs:parseMs/30,expandedDetailBytes:Buffer.byteLength(JSON.stringify(detail)),expandedDetailReadMs:detailMs});f.close();
}
const f=historyFixture(10000),reader=new WebHistoryPages(f.history,f.processes,f.inputs);
const host={...f,webReadEpoch:'synthetic-epoch',webHistoryPages:()=>reader,registerChannelCapabilities(){},onStateChange(){return()=>{};},media:{view(){throw Error('no_media');}},conversationControlState:()=>({isRunning:false,activeMessageId:null}),snapshot(){throw Error('full_snapshot_forbidden');},conversationState(){throw Error('full_conversation_forbidden');}};
const bridge=homerWebBridge(host as unknown as Homer);const states=[];
for(let i=0;i<30;i++){const start=performance.now(),state=await bridge.history!.state();states.push({ms:performance.now()-start,bytes:Buffer.byteLength(JSON.stringify(state)),messages:state.messages.length});}
f.close();
writeFileSync(syntheticRoot+'/candidate-server-performance.json',JSON.stringify({seed:20261021,node:process.version,samples:30,records,giant,newWebSnapshot:states},null,2)+'\n');
console.log(JSON.stringify({records:records.map(({plans,...r})=>r),giant,newWebSnapshot:states.slice(0,2)}));
