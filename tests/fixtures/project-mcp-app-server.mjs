#!/usr/bin/env node
// Protocol-only peer: never connects MCP, creates a native thread or calls a model.
import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const calls=[];
const gates=new Set(),held=[];let compact=0;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const compactEvent=(method,item=true,extra={})=>send({method,params:{threadId:'synthetic-project-thread',turnId:'fixture-compact-'+compact,...(item?{item:{id:'fixture-compact-item-'+compact,type:'contextCompaction'}}:{}),...extra}});
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;calls.push({method:m.method,params:m.params});let result={};
 const state=JSON.parse(readFileSync(join(m.method==='config/read'?m.params.cwd:process.cwd(),'fixture-state.json'),'utf8'));
 if(m.method==='thread/resume'&&state.holdResume)gates.add(m.method);
 if(m.method==='initialize')result={userAgent:'codex/0.163.0',codexHome:process.env.CODEX_HOME};
 if(m.method==='config/read'){
  result=structuredClone(state.config);
  result.config.features={memories:true};result.config.memories={dedicated_tools:true};
  for(const name of Object.keys(result.config.mcp_servers??{}))if(process.argv.includes('mcp_servers.'+name+'.enabled=false'))result.config.mcp_servers[name].enabled=false;
 }
 if(m.method==='skills/list')result={data:[]};
 if(m.method==='environment/info')result={shell:{}};
 if(m.method==='thread/backgroundTerminals/list')result={data:[]};
 if(['thread/start','thread/resume'].includes(m.method))result={thread:{id:m.params.threadId??'synthetic-project-thread'},activePermissionProfile:{id:'homer'},approvalPolicy:m.params.approvalPolicy};
 if(m.method==='turn/start')result={turn:{id:'synthetic-turn'}};
 if(m.method==='mcpServerStatus/list')result={data:[{name:'homer_interactions',tools:Object.fromEntries((state.catalog??[]).map(name=>[name,{name}]))}]};
 if(m.method==='fixture/inspect')result={calls,argv:process.argv.slice(2),home:process.env.HOME,processCwd:process.cwd()};
 if(m.method==='fixture/gate')gates.add(m.params.method);
 if(m.method==='fixture/release'){gates.delete(m.params.method);for(const pending of held.splice(0))if(pending.method===m.params.method)send(m.params.fail?{id:pending.id,error:{code:-1,message:'synthetic failure'}}:{id:pending.id,result:pending.result});else held.push(pending);}
 if(gates.has(m.method)){held.push({id:m.id,method:m.method,result});return;}
 send({id:m.id,result});
 if(m.method==='thread/compact/start'){compact++;compactEvent('turn/started',false,{turn:{id:'fixture-compact-'+compact}});compactEvent('item/started');}
 if(m.method==='fixture/compactComplete')compactEvent('item/completed');
 if(m.method==='fixture/compactUnrelated')compactEvent('item/completed',true,{turnId:'unrelated',item:{id:'other',type:'contextCompaction'}});
 if(m.method==='fixture/compactFail')compactEvent('turn/completed',false,{turn:{id:'fixture-compact-'+compact,status:'failed',error:{message:'synthetic failure'}}});
 if(m.method==='turn/start')setImmediate(()=>process.stdout.write(JSON.stringify({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id:'synthetic-turn',status:'completed'}}})+'\n'));
});
