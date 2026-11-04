// Actual HTTP/SSE bytes and owner reads. No dev-host, production config or engine.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {historyFixture,syntheticRoot,updateSyntheticPublicText} from './web-history-loading-fixture.js';
import {WebHistoryPages} from '../src/web-history-pages.js';
import {homerWebBridge} from '../src/web-homer.js';
import {createWebServer} from '../src/web-server.js';
const records=[];
for(const total of [1000,10000]){
 const f=historyFixture(total,160,true),reader=new WebHistoryPages(f.history,f.processes,f.inputs);let queries=0,rows=0;
 const prepare=f.store.db.prepare.bind(f.store.db);
 f.store.db.prepare=sql=>{const statement=prepare(sql);for(const method of ['all','get']){const original=statement[method].bind(statement);statement[method]=(...args)=>{queries++;const value=original(...args);rows+=Array.isArray(value)?value.length:value?1:0;return value;};}return statement;};
 const host={...f,webReadEpoch:'synthetic-sse-epoch',webHistoryPages:()=>reader,registerChannelCapabilities(){},onStateChange(){return()=>{};},media:{view(){throw Error('no_media');}},conversationControlState:()=>({isRunning:false,activeMessageId:null}),snapshot(){throw Error('full_snapshot_forbidden');},conversationState(){throw Error('full_conversation_forbidden');}};
 const bridge=homerWebBridge(host),state=bridge.history.state,builds=[];
 bridge.history.state=async()=>{const q=queries,r=rows,start=performance.now(),value=await state();builds.push({ms:performance.now()-start,queries:queries-q,returnedRows:rows-r,jsonBytes:Buffer.byteLength(JSON.stringify(value)),messages:value.messages.length});return value;};
 const server=await createWebServer({bridge,port:0}),controller=new AbortController();
 try{
  assert.notEqual(new URL(server.url).port,'4780');
  const response=await fetch(server.url+'/api/history/events',{signal:controller.signal}),stream=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  async function next(){for(;;){const boundary=buffer.indexOf('\n\n');if(boundary>=0){const event=buffer.slice(0,boundary+2);buffer=buffer.slice(boundary+2);return {eventBytes:Buffer.byteLength(event),snapshotBytes:Buffer.byteLength(event.split('\ndata: ')[1].trim())};}const chunk=await stream.read();if(chunk.done)throw Error('synthetic_sse_ended');buffer+=decoder.decode(chunk.value,{stream:true});}}
  const initial=await next(),samples=[];
  for(let n=0;n<30;n++){
   const changed=updateSyntheticPublicText(f,'node-9999','Synthetic SSE change '+String(n).padStart(2,'0'));
   assert.equal(changed.changes,1,'SSE sample must update an existing published owner');
   assert.equal(reader.process('node-9999','synthetic-history').final?.text,'Synthetic SSE change '+String(n).padStart(2,'0'));
   const start=performance.now(),before=builds.length;for(let i=0;i<20;i++)server.publish();const event=await next();
   assert.equal(builds.length,before+1);samples.push({...event,notificationToEventMs:performance.now()-start,...builds.at(-1)});
  }
  records.push({total,initial,initialBuild:builds[0],samples,invalidationsPerSample:20,fullSnapshotCalls:0});
 }finally{controller.abort();await server.close();f.close();}
}
writeFileSync(syntheticRoot+'/continuous-sse-performance.json',JSON.stringify({seed:20261021,node:process.version,syntheticOnly:true,warmSamples:30,records},null,2)+'\n');
