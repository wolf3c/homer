import {TurnExecution} from '../src/execution-limits.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {MainProcessHistory} from '../src/main-process.js';
import {CodexEngine} from '../src/engine.js';
import {syntheticHost} from '../scripts/recursive-synthetic-host.js';
import {Homer} from '../src/service.js';
import {fixture as chatFixture,until} from './fixtures/worker-chat-host.js';
import {homerWebBridge} from '../src/web-homer.js';

function fixture(){
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)');
  const history=new MainProcessHistory(db);
  const start=(id='node',kind:'user'|'worker'='user')=>history.start({id,threadId:'synthetic',sourceKind:kind,sourceMessageIds:['source:'+id],messageId:'reply:'+id},'turn:'+id);
  const message=(itemId:string,phase:string,text:string,id='node')=>history.agent(id,{turnId:'turn:'+id,itemId,phase,text,completed:true});
  return {db,history,start,message,node:()=>history.list('synthetic')[0]!};
}
const fact={taskId:'task-synthetic',version:1,taskRevision:2,runId:'run-synthetic',runRevision:3,runStatus:'running',resultState:null,epoch:0,state:'working',controlState:'normal',outcome:null,phase:'executing',stopRequested:false};

test('final source item remains stored; terminal confirms native final and never synthesizes a failure answer',()=>{
  const f=fixture();try{
    f.start();f.history.agent('node',{turnId:'turn:node',itemId:'f',phase:'final_answer',delta:'Hel',completed:false});
    const first=f.node().items[0];assert.equal(first?.kind,'commentary');assert.equal((first as any).text,'Hel');
    f.history.agent('node',{turnId:'turn:node',itemId:'f',delta:'lo',completed:false});
    assert.equal(f.node().items[0]?.id,first?.id);assert.equal((f.node().items[0] as any).text,'Hello');
    f.message('f','final_answer','Hello');assert.equal(f.node().final,undefined);
    f.history.finish('node','completed','terminal');assert.equal(f.node().final?.text,'Hello');assert.equal(f.node().items.length,1);
    f.start('unknown');f.history.agent('unknown',{turnId:'turn:unknown',itemId:'f',phase:'final_answer',delta:'unfinished',completed:false});
    f.history.finish('unknown','unknown');const unknown=f.history.list('synthetic')[1]!;
    assert.equal(unknown.state,'working');assert.equal(unknown.status,'unknown');assert.equal(unknown.final,undefined);assert.equal((unknown.items[0] as any).text,'unfinished');
    f.start('failed');f.history.finish('failed','failed','failed-terminal');const failed=f.history.list('synthetic')[2]!;
    assert.equal(failed.state,'worked');assert.equal(failed.status,'failed');assert.equal(failed.final,undefined);
  }finally{f.db.close();}
});

test('an explicit reply suppresses the native final for that process only',()=>{
  const f=fixture();try{
    f.start();f.message('progress','commentary','Public progress');f.message('answer','final_answer','Duplicate native answer');
    f.history.discardNativeFinal('node');
    new MainProcessHistory(f.db).reconcileUnknown('synthetic',true);
    assert.equal(f.node().status,'unknown');
    assert.equal(f.node().final,undefined);
    assert.deepEqual(f.node().items.map(item=>item.id),['turn:node:progress']);
    f.start('next');f.message('answer','final_answer','Independent native answer','next');
    f.history.finish('next','completed','terminal-next');
    assert.equal(f.history.list('synthetic')[1]?.final?.text,'Independent native answer');
  }finally{f.db.close();}
});

test('persisted lifecycle: real end, final once outside process, full commentary, duplicate replay and background worker',()=>{
  const f=fixture();try{
    f.start();f.history.agent('node',{turnId:'turn:node',itemId:'c',phase:'commentary',completed:false});
    f.history.agent('node',{turnId:'turn:node',itemId:'c',delta:'progress',completed:false});
    f.message('c','commentary','progress');f.history.tool('node',{id:'tool',label:'检查资料',phase:'start'});f.history.worker('node',fact);
    f.message('final','final_answer','answer');assert.equal(f.node().final,undefined);
    f.history.finish('node','completed','turn:node:completed');
    const revision=f.node().revision;
    f.start();f.message('c','commentary','STALE');f.message('final','final_answer','DUPLICATE');f.history.finish('node','completed','duplicate');
    assert.equal(f.node().revision,revision);assert.equal(f.node().final?.text,'answer');assert.equal(f.node().items.filter(i=>i.kind==='commentary').length,2);
    f.history.worker('node',{...fact,taskRevision:3,runRevision:4,runStatus:'awaiting_review',state:'reviewing',resultState:'offered',phase:'ended'});
    assert.equal(f.node().state,'worked');assert.equal(f.node().endEventId,'turn:node:completed');
    assert.equal(f.node().items.find(i=>i.kind==='tool')?.status,'blocked');
    const restored=new MainProcessHistory(f.db);assert.deepEqual(restored.list('synthetic'),f.history.list('synthetic'));
  }finally{f.db.close();}
});

test('unknown phases/private collaboration/raw tool arguments never enter public projection; silent/no-final nodes remain honest',()=>{
  const f=fixture();try{
    f.start();f.message('unknown','analysis','SECRET_REASONING');f.message('missing','unknown','SECRET_UNKNOWN');
    f.history.tool('node',{id:'private',label:'raw SECRET_ARGUMENT',phase:'start'});
    f.history.worker('node',{...fact,body:'SECRET_WORKER',credentials:'SECRET_TOKEN'} as typeof fact);
    f.start('worker','worker');f.message('internal','commentary','SECRET_INTERNAL','worker');f.message('internal-final','final_answer','SECRET_FINAL','worker');
    f.history.finish('worker','completed','turn:worker:completed');
    f.start('silent','worker');f.history.finish('silent','completed','turn:silent:completed');
    f.history.reconcileUnknown('synthetic');assert.equal(f.node().state,'working');assert.equal(f.node().status,'unknown');
    const nodes=f.history.list('synthetic');assert.equal(nodes[1]?.items.length,0);assert.equal(nodes[1]?.final,undefined);assert.equal(nodes[2]?.items.length,0);
    assert.ok(!JSON.stringify(nodes).includes('SECRET'));assert.ok(!JSON.stringify(f.history.headers(nodes.map(node=>node.id))).includes('SECRET'));assert.ok(!JSON.stringify(f.history.headers(nodes.map(node=>node.id),true)).includes('SECRET'));for(const node of nodes)assert.ok(!JSON.stringify(f.history.exact(node.id)).includes('SECRET'));assert.deepEqual(f.history.list('other'),[]);
    assert.ok(String(f.db.prepare('SELECT value FROM meta WHERE key=?').get('publicMainNode:v1:node')!.value).includes('SECRET_REASONING'),'read filtering preserves original stored source');
  }finally{f.db.close();}
});

test('legacy stored text exposes only explicit public phases without rewriting source',()=>{
  const f=fixture();try{
    f.start();
    const key='publicMainNode:v1:node',row=f.db.prepare('SELECT value FROM meta WHERE key=?').get(key)!;
    const stored=JSON.parse(String(row.value));
    stored.items=[undefined,null,'analysis','future_phase','commentary','final_answer'].map((phase,index)=>({id:'legacy-'+index,seq:index+1,revision:1,kind:'commentary',text:'text-'+index,...(phase===undefined?{}:{phase})}));
    const source=JSON.stringify(stored);f.db.prepare('UPDATE meta SET value=? WHERE key=?').run(source,key);
    for(const node of [f.history.exact('node')!,...f.history.list('synthetic'),...f.history.headers(['node'],true)]){
      assert.deepEqual(node.items.map(item=>item.id),['legacy-4','legacy-5']);
    }
    assert.equal(f.db.prepare('SELECT value FROM meta WHERE key=?').get(key)!.value,source);
  }finally{f.db.close();}
});

test('authoritative item sequence and worker revision: completed item beats delta, terminal tool beats delayed start, stale facts ignored',()=>{
  const f=fixture();try{
    f.start();f.message('a','commentary','a');f.message('b','commentary','b');
    f.history.agent('node',{turnId:'turn:node',itemId:'a',delta:'late duplicate',completed:false});
    f.history.tool('node',{id:'tool',label:'核对成果',phase:'end',status:'completed'});f.history.tool('node',{id:'tool',label:'核对成果',phase:'start'});
    f.history.worker('node',{...fact,taskRevision:5,runRevision:8});const newer=f.node().revision;
    f.history.worker('node',fact);assert.equal(f.node().revision,newer);
    assert.deepEqual(f.node().items.map(i=>i.seq),[1,2,3,4]);assert.equal((f.node().items[0] as any).text,'a');assert.equal((f.node().items[2] as any).status,'completed');
  }finally{f.db.close();}
});

test('production engine RPC notifications retain item phase/identity and reject stale turn events',async()=>{
  const engine:any=new CodexEngine({workspace:process.cwd(),runtime:process.cwd(),codexHome:'/synthetic/home',model:'synthetic'} as any,{cwd:process.cwd(),readRoots:[],instructions:'',tools:[]},async()=>({}));
  engine.threadId='synthetic';engine.turnId='turn';engine.active={execution:new TurnExecution({}),messages:[],earlyEvents:[]};
  const events:any[]=[];engine.on('agentMessage',(event:any)=>events.push(event));
  const receive=(method:string,params:any)=>engine.receive(JSON.stringify({method,params:{threadId:'synthetic',turnId:'turn',...params}}));
  await receive('item/started',{item:{id:'c',type:'agentMessage',phase:'commentary',text:''}});
  await receive('item/agentMessage/delta',{itemId:'c',delta:'progress'});
  await receive('item/completed',{item:{id:'c',type:'agentMessage',phase:'commentary',text:'progress'}});
  await receive('item/completed',{turnId:'stale',item:{id:'secret',type:'agentMessage',phase:'final_answer',text:'STALE'}});
  await receive('item/completed',{item:{id:'f',type:'agentMessage',phase:'final_answer',text:'final'}});
  assert.deepEqual(events.map(e=>[e.itemId,e.phase,e.completed]),[['c','commentary',false],['c',undefined,false],['c','commentary',true],['f','final_answer',true]]);
});

test('real host callbacks bind user and private worker nodes to native terminal evidence',async()=>{
 const f=syntheticHost();try{
  await f.app.start();const peer=f.engines[0]!,modelInputs:string[]=[];
  peer.turn=async(text,options)=>{
   modelInputs.push(text);peer.turnId='synthetic-projection-'+modelInputs.length;options?.onStarted?.(peer.turnId);
   peer.emit('agentMessage',{threadId:peer.threadId,turnId:peer.turnId,itemId:'c',phase:'commentary',text:'public progress',completed:true});
   peer.emit('agentMessage',{threadId:peer.threadId,turnId:peer.turnId,itemId:'f',phase:'final_answer',text:'public final',completed:true});
   return {status:'completed',text:'public progress\npublic final'};
  };
  await f.app.message('question','request');
  const user=f.app.processes.list(peer.threadId)[0]!;assert.equal(user.sourceKind,'user');assert.equal(user.messageId,user.id);assert.equal(user.state,'worked');assert.equal(user.final?.text,'public final');assert.match(user.endEventId!,/^turn:synthetic-projection-/);
  f.app.history.validateQuotes(peer.threadId,{requestId:'quoted',text:'quoted',quote:{messageId:user.messageId,text:'public final'}});
  assert.throws(()=>f.app.history.validateQuotes(peer.threadId,{requestId:'quoted-private',text:'quoted',quote:{messageId:user.messageId,text:'public progress'}}),/quote_source_mismatch/);
  await f.app['mainTurn']('PRIVATE_WORKER_BODY',{event:true,allowEmptyReply:true,inspected:new Set(),sourceMessageIds:['worker-message','worker-message-2']});
  const worker=f.app.processes.list(peer.threadId)[1]!;assert.equal(worker.sourceKind,'worker');assert.deepEqual(worker.sourceMessageIds,['worker-message','worker-message-2']);assert.equal(worker.state,'worked');assert.equal(worker.final,undefined);assert.notEqual(worker.id,user.id);assert.equal(modelInputs.length,2);
  const state=f.app.conversationState();assert.equal(state.messages.find(m=>m.id===user.id)?.text,'public final');assert.equal(state.messages.find(m=>m.id===user.id)?.process?.items.filter(i=>i.kind==='commentary'&&i.phase==='final_answer').length,1);assert.ok(!JSON.stringify(state.messages).includes('PRIVATE_WORKER_BODY'));
 }finally{await f.close();}
});

test('native RPC call content flows through real service observers with credentials removed before persistence',async()=>{
 const f=fixture();try{
  const engine:any=new CodexEngine({workspace:process.cwd(),runtime:'/synthetic/runtime',codexHome:'/synthetic/home',model:'synthetic'} as any,{cwd:process.cwd(),readRoots:[],instructions:'',tools:[]},async()=>({}));
  engine.threadId='synthetic';engine.turnId='turn:node';engine.active={execution:new TurnExecution({}),messages:[],earlyEvents:[],resolve:()=>{}};
  const app:any=Object.create(Homer.prototype);
  Object.assign(app,{config:{workspace:process.cwd(),runtime:'/synthetic/runtime',codexHome:'/synthetic/home'},prompts:{main:''},interactionMcp:{path:'/synthetic/socket',directory:process.cwd()},factory:()=>engine,store:{db:f.db},processes:f.history});
  app.main=app.createMain(process.cwd());
  f.history.start({id:'node',threadId:'synthetic',sourceKind:'user',sourceMessageIds:[],messageId:'node'},'turn:node',{startedAtMs:100000,observedAtMs:100050});
  app.mainContext={processId:'node',nativeActivity:{turnId:'turn:node',compactions:new Map()}};
  const list=f.history.list;f.history.list=()=>{throw new Error('native observer must not enumerate process history');};
  const nodeRevision=()=>JSON.parse(String(f.db.prepare('SELECT value FROM meta WHERE key=?').get('publicMainNode:v1:node')!.value)).revision;
  const events:any[]=[];engine.on('nativeProcess',(event:any)=>events.push(event));
  const receive=(method:string,params:any)=>engine.receive(JSON.stringify({method,params:{threadId:'synthetic',turnId:engine.turnId,...params}}));
  const secret='FICTIONAL_TOKEN_CREDENTIAL',body='SYNTHETIC_TOOL_BODY';
  const command={id:'same',type:'commandExecution',command:'echo '+body+' token='+secret,cwd:'/synthetic/'+body,aggregatedOutput:body,arguments:secret,result:secret,reasoning:secret,commandActions:[{type:'read',path:secret,name:secret}],startedAtMs:100100};
  await receive('item/started',{item:command});
  await receive('item/commandExecution/outputDelta',{itemId:'same',delta:secret});
  await receive('item/started',{item:{id:'mcp',type:'mcpToolCall',arguments:secret,result:secret}});
  f.history.tool('node',{id:'host-mcp',label:'检查资料',phase:'start',turnId:engine.turnId});
  await receive('item/completed',{item:{...command,status:'completed',exitCode:2,completedAtMs:100500,durationMs:400}});
  const revision=nodeRevision();
  await receive('item/completed',{item:{...command,status:'completed',exitCode:0}});
  await receive('item/started',{item:command});assert.equal(nodeRevision(),revision);
  await receive('item/completed',{turnId:'stale-turn',item:{...command,status:'completed'}});
  const rejected={threadId:'synthetic',turnId:'stale-turn',itemId:'rejected',category:'command',status:'running',completed:false};
  engine.emit('nativeProcess',rejected);
  engine.emit('nativeProcess',{...rejected,threadId:'other-thread',turnId:'turn:node'});
  app.mainContext={};engine.emit('nativeProcess',{...rejected,turnId:'turn:node'});
  app.mainContext={processId:'node'};app.main={};engine.emit('nativeProcess',{...rejected,turnId:'turn:node'});app.main=engine;
  assert.equal(nodeRevision(),revision,'stale turn, foreign thread, absent context and replaced engine stay rejected without enumeration');
  const edit={id:'edit',type:'fileChange',changes:[{path:'/synthetic/a',diff:body+'\napi_key='+secret},{path:'/synthetic/a',diff:body},{path:'/synthetic/b',diff:body}],status:'inProgress',startedAtMs:null};
  await receive('item/started',{item:edit});
  await receive('item/completed',{item:{...edit,status:'declined',completedAtMs:null}});
  // A completed-before-start item is terminal in its first observed position.
  await receive('item/completed',{item:{id:'late',type:'commandExecution',status:'interrupted',command:body}});
  await receive('item/started',{item:{id:'late',type:'commandExecution',command:body}});
  await receive('turn/completed',{turn:{id:engine.turnId,status:'completed',startedAt:100,completedAt:101,durationMs:950}});
  f.history.finish('node','completed','native-terminal');
  f.history.list=list;
  const node=f.node(),tools=node.items.filter(item=>item.kind==='tool');
  assert.deepEqual(tools.map(item=>[item.category,item.status,item.invocationCount,item.fileCount]),[['readFiles','failed',1,undefined],['host','blocked',1,undefined],['fileChange','declined',1,2],['command','interrupted',1,undefined]]);
  assert.deepEqual(tools.map(item=>item.seq),[1,2,3,4]);assert.equal(tools[0]!.durationMs,400);assert.equal(tools[3]!.startedAtMs,undefined);
  assert.equal(node.startedAtMs,100000);assert.equal(node.endedAtMs,101000);assert.equal(node.durationMs,950);assert.equal(node.timingSource,'native');
  assert.ok(!JSON.stringify(events).includes(secret));assert.ok(!JSON.stringify(node).includes(secret));assert.ok(!JSON.stringify(f.db.prepare('SELECT value FROM meta').all()).includes(secret));
  assert.deepEqual(tools[0]!.content?.output,{state:'recorded',value:{output:body,exitCode:2}});
  assert.match(JSON.stringify(node),/SYNTHETIC_TOOL_BODY/);
  assert.deepEqual(new MainProcessHistory(f.db).list('synthetic'),f.history.list('synthetic'));
 }finally{f.db.close();}
});

test('timing uses matching endpoints, continuous multi-turn intervals and no historical or unknown invention',()=>{
 const f=fixture();try{
  const start=(id:string,turn:string,timing?:any)=>f.history.start({id,threadId:'synthetic',sourceKind:'user',sourceMessageIds:[],messageId:id},turn,timing);
  start('multi','one',{startedAtMs:1000,observedAtMs:1010});
  f.history.turnTiming('multi','wrong',true,{endedAtMs:2000,observedAtMs:2050});assert.equal(f.node().endedAtMs,undefined);
  f.history.turnTiming('multi','one',true,{endedAtMs:2000,durationMs:777,observedAtMs:2050});
  const frozen=JSON.stringify(f.node());f.history.turnTiming('multi','one',true,{endedAtMs:99999,observedAtMs:99999});assert.equal(JSON.stringify(f.node()),frozen);
  start('multi','two',{startedAtMs:4000,observedAtMs:4100});assert.equal(f.node().endedAtMs,undefined);assert.equal(f.node().timingState,'running');
  f.history.turnTiming('multi','two',true,{endedAtMs:6000,durationMs:500,observedAtMs:6200});f.history.finish('multi','completed','two-terminal');
  assert.equal(f.node().durationMs,5000);assert.equal(f.node().timingSource,'native');
  // Same item ID in different turns is two calls; delayed completion stays at seq 1.
  start('calls','a',{observedAtMs:100});
  f.history.native('calls',{threadId:'synthetic',turnId:'a',itemId:'same',category:'command',status:'running',completed:false,observedAtMs:100});
  start('calls','b',{observedAtMs:300});
  f.history.native('calls',{threadId:'synthetic',turnId:'b',itemId:'same',category:'command',status:'completed',completed:true,observedAtMs:350});
  f.history.native('calls',{threadId:'synthetic',turnId:'a',itemId:'same',category:'command',status:'failed',completed:true,observedAtMs:400});
  const calls=f.history.list('synthetic')[1]!;assert.equal(new Set(calls.items.map(item=>item.id)).size,2);assert.deepEqual(calls.items.map(item=>item.kind==='tool'?[item.seq,item.turnId,item.status]:[]),[[1,'a','failed'],[2,'b','completed']]);
  start('mixed','a',{startedAtMs:1000,observedAtMs:1010});f.history.turnTiming('mixed','a',true,{endedAtMs:2000,observedAtMs:2050});start('mixed','b',{observedAtMs:3000});f.history.turnTiming('mixed','b',true,{endedAtMs:4000,observedAtMs:4100});f.history.finish('mixed','completed','terminal');
  const mixed=f.history.list('synthetic')[2]!;assert.equal(mixed.timingSource,'hostObserved');assert.equal(mixed.durationMs,3090);assert.equal(mixed.startedAtMs,1010);
  start('lost','lost',{startedAtMs:1000,observedAtMs:1050});f.history.finish('lost','unknown');const lost=f.history.list('synthetic')[3]!;assert.equal(lost.state,'working');assert.equal(lost.timingState,'unknown');assert.equal(lost.endedAtMs,undefined);assert.equal(lost.durationMs,undefined);
  start('old','old');f.history.finish('old','completed','historical-terminal');const old=f.history.list('synthetic')[4]!;assert.equal(old.startedAtMs,undefined);assert.equal(old.durationMs,undefined);
  start('rollback','rollback',{startedAtMs:-1,observedAtMs:500});f.history.turnTiming('rollback','rollback',true,{startedAtMs:NaN,endedAtMs:null as any,durationMs:-1,observedAtMs:400});f.history.finish('rollback','failed','terminal');assert.equal(f.history.list('synthetic')[5]!.durationMs,undefined);
 }finally{f.db.close();}
});

test('early protocol notifications wait for actual ACK; native terminal freezes clock before background refresh',async()=>{
 const engine:any=new CodexEngine({workspace:process.cwd(),runtime:'/synthetic/runtime',codexHome:'/synthetic/home',model:'synthetic'} as any,{cwd:process.cwd(),readRoots:[],instructions:'',tools:[]},async()=>({}));
 engine.threadId='synthetic';const order:string[]=[],starts:any[]=[],ends:any[]=[],safe:any[]=[];let release!:()=>void;
 engine.on('nativeProcess',(event:any)=>{order.push('item');safe.push(event);});engine.on('turnTerminal',(event:any)=>{order.push('terminal');ends.push(event);});
 engine.refreshBackground=()=>new Promise<void>(resolve=>{release=resolve;});
 engine.request=async()=>{
  await engine.receive(JSON.stringify({method:'item/started',params:{threadId:'synthetic',turnId:'early',item:{type:'commandExecution',id:'cmd',command:'PRIVATE_EARLY',commandActions:[{type:'search',query:'PRIVATE_EARLY'}]}}}));
  await engine.receive(JSON.stringify({method:'turn/completed',params:{threadId:'synthetic',turn:{id:'early',status:'completed',startedAt:123,completedAt:125,durationMs:1800}}}));
  assert.deepEqual(order,[]);return {turn:{id:'early',startedAt:123}};
 };
 const work=engine.turn('synthetic',{onStarted:(_id:string,timing:any)=>{order.push('ack');starts.push(timing);}});
 try{
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(order,['ack','item','terminal']);assert.equal(starts[0].startedAtMs,123000);assert.equal(ends[0].endedAtMs,125000);assert.equal(ends[0].durationMs,1800);assert.equal(safe[0].category,'search');assert.equal(safe[0].content.input.value.command,'PRIVATE_EARLY');assert.equal(safe[0].content.input.value.commandActions,undefined);
 }finally{release?.();}
 assert.equal((await work).status,'completed');
});

test('real explicit send preserves the Worker reply and commits one attachment-backed user message',async()=>{
 const f=chatFixture();let taskId='',runId='',filePath='',messageId='';
 const raw='Synthetic final result',published='Explicit authorized reply';
 try{
  f.setScript(async(main,text)=>{
   if(text==='send test'){
    const run=await main.call('worker_open',{message:'Write public.md.'});
    taskId=run.taskId;runId=run.runId;
    return {status:'completed',text:'Started.'};
   }
   const args={taskId,attachments:[{path:filePath}],text:published};
   const first=await main.call('send_user_message',args,'send-once');
   const retry=await main.call('send_user_message',args,'send-once');
   assert.equal(retry.messageId,first.messageId);messageId=first.messageId;
   return {status:'completed',text:published,messages:[{itemId:'final',phase:'final_answer',text:published}]};
  });
  await f.app.start();await f.app.message('send test','send-source');
  await until(()=>f.engines.some(engine=>engine.options.role==='worker'&&engine.finish));
  const worker=f.engines.find(engine=>engine.options.role==='worker')!;
  filePath=join(f.app.config.workspace,'public.md');writeFileSync(filePath,'# Public');
  const bridge=homerWebBridge(f.app);
  assert.equal((await bridge.state()).artifacts?.length,0);
  worker.finish!({status:'completed',text:raw,messages:[{itemId:'worker-final',phase:'final_answer',text:raw}]});
  await f.app.idle();
  const state=await bridge.state(),sent=state.messages.filter(message=>message.id===messageId);
  assert.equal(sent.length,1);assert.equal(sent[0]?.text,published);assert.equal(sent[0]?.requestId,null);
  const replies=f.events.filter(item=>item.type==='reply'&&item.text===published);
  assert.equal(replies.length,1);assert.equal(replies[0]?.messageId,messageId);assert.equal(replies[0]?.requestId,undefined);
  const artifact=state.artifacts?.find(item=>item.messageId===messageId)!;
  const actual=await bridge.media!.read({messageId,assetId:artifact.assetId,revision:artifact.revision});
  assert.equal(Buffer.from(actual.data!,'base64').toString(),'# Public');
  const receipt=f.app.store.db.prepare("SELECT id,payloadJson FROM agent_messages WHERE kind='worker_reply' AND senderRunId=?").get(runId)!;
  assert.equal(JSON.parse(String(receipt.payloadJson)).text,raw);
  const process=state.processNodes?.find(node=>node.sourceMessageIds.includes(String(receipt.id)));
  assert.ok(process);assert.equal((process.items.find(item=>item.kind==='workerEvent') as any).event.body,raw);
  assert.ok(!JSON.stringify(state.processNodes).includes('# Public'));
 }finally{await f.close();}
});
