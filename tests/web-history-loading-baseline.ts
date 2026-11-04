// Manual full-read control measured on current source; not a historical snapshot or a performance acceptance test.
import {writeFileSync} from 'node:fs';
import {historyFixture,syntheticRoot} from './web-history-loading-fixture.js';
import {projectConversation} from '../src/conversation-projection.js';
const records=[];
for(const total of [20,1000,10000]){
 const f=historyFixture(total,160,true);let rows=0,queries=0;const plans:unknown[]=[];
 const prepare=f.store.db.prepare.bind(f.store.db);
 f.store.db.prepare=sql=>{const s=prepare(sql);const all=s.all.bind(s);s.all=((...args:Parameters<typeof all>)=>{queries++;const r=all(...args);rows+=r.length;return r;}) as typeof s.all;
  if(sql.includes('SELECT value FROM meta WHERE key LIKE'))plans.push(prepare('EXPLAIN QUERY PLAN '+sql).all('publicMainNode:v1:%'));return s;};
 const samples=[],serializedSamples=[];let bytes=0,count=0;
 for(let n=0;n<30;n++){const start=performance.now();const history=f.history.list('synthetic-history'),nodes=f.processes.list('synthetic-history'),view=projectConversation(history,nodes,[]),acceptedRequestIds=f.history.acceptedRequestIds('synthetic-history');samples.push(performance.now()-start);bytes=Buffer.byteLength(JSON.stringify({...view,processNodes:nodes,acceptedRequestIds}));serializedSamples.push(performance.now()-start);count=view.messages.length;}
 samples.sort((a,b)=>a-b);serializedSamples.sort((a,b)=>a-b);records.push({total,formalUnits:total,displayMessages:count,queriesPerRead:queries/30,rowsReturnedPerRead:rows/30,bytes,projectionMs:{median:(samples[14]!+samples[15]!)/2,p95:samples[28]},rawReadMs:samples,readAndSerializeMs:serializedSamples,plans});f.close();
}
writeFileSync(syntheticRoot+'/baseline-server.json',JSON.stringify({seed:20261021,node:process.version,syntheticOnly:true,warmSamples:30,records},null,2)+'\n');console.log(JSON.stringify(records.map(({plans,...r})=>r)));
