// Synthetic protocol/user receipts only, no real permission or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Homer} from '../src/service.js';
import {CodexEngine} from '../src/engine.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {MainNativeApprovals} from '../src/main-native-approvals.js';
import {ConversationHistory} from '../src/web-history.js';
import {fixture,openWorker,running,main} from './recursive-fixture.js';
function setup(){
 const f=fixture('.codex/scratch/worker-native-subagent-convergence-implementation-20261024/native-owner'),worker=openWorker(f),actor=running(f,worker.runId),host:any=Object.create(Homer.prototype);
 const config={workspace:f.files.workspace,runtime:f.dir,codexHome:f.dir,nativeCodexHome:f.dir,codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100};
 const engine=new CodexEngine(config,{cwd:f.files.workspace,readRoots:[],instructions:'Synthetic',role:'worker',tools:[],onInteraction:r=>host.openInteraction({runId:actor.runId!,threadId:r.threadId,turnId:r.turnId,requestId:r.requestId,source:'native',kind:r.kind,details:{method:r.method,params:r.details}},r).response},async()=>{throw Error('dynamic_child_tool_must_not_run');});
 engine.threadId=actor.threadId;engine.turnId=actor.turnId;engine['active']={} as any;
 const sent:any[]=[],slot={id:actor.runId!,epoch:actor.epoch!,engine,requests:new Map()},workers=new Map([[slot.id,slot]]),history=new ConversationHistory(f.store.db);
 const interactions=new WorkerInteractions(f.store.db,{waiting:()=>host.syncInteractionWaiting(slot)}),approvals=new MainNativeApprovals(interactions,history);
 Object.assign(host,{config,store:f.store,tasks:f.tasks,files:f.files,workers,interactions,mainApprovals:approvals,protectedExecutionPaths:()=>[],invalidateState(){}});
 engine['send']=m=>{sent.push(m);};
 engine.on('interactionWaiting',()=>host.syncInteractionWaiting(slot));
 engine.on('interactionDelivered',id=>approvals.delivered('worker-native:'+slot.id+':'+JSON.stringify(id)));
 engine.on('interactionInvalidated',(id,code)=>approvals.invalidated('worker-native:'+slot.id+':'+JSON.stringify(id),code));
 const receive=(m:unknown)=>engine['receive'](JSON.stringify(m));
 const request=(id:number,threadId='native-child-'+id,turnId='child-turn-'+id)=>receive({id,method:'item/commandExecution/requestApproval',params:{threadId,turnId,itemId:'cmd-'+id,command:'node --version',cwd:f.dir,availableDecisions:['accept','decline']}});
 return {...f,actor,engine,sent,host,slot,interactions,approvals,request,receive};
}
test('same connection child approvals resolve allow/deny once; first-in last-out rpc wait',async()=>{
 const f=setup();try{
  const a=f.request(1),b=f.request(2);
  assert.equal(f.tasks.run(f.slot.id).phase,'rpc_wait');assert.equal(f.interactions.list().length,2);
  const [one,two]=f.interactions.list();assert.equal(one!.threadId,'native-child-1');
  assert.throws(()=>f.interactions.respond(one!.id,{action:'approve',reason:'forged'}),/main_native_user_decision_required|user_reply_required/);
  f.approvals.respond(one!.id,{requestId:'synthetic-user-allow',text:'允许本次操作'});await a;
  assert.equal(f.tasks.run(f.slot.id).phase,'rpc_wait');assert.deepEqual(f.sent,[{id:1,result:{decision:'accept'}}]);
  await f.receive({method:'serverRequest/resolved',params:{threadId:'native-child-1',requestId:1}});
  assert.ok(f.interactions.inspect(one!.id).deliveredAt);
  f.approvals.respond(two!.id,{requestId:'synthetic-user-deny',text:'拒绝本次操作'});await b;
  assert.equal(f.tasks.run(f.slot.id).phase,'executing');assert.deepEqual(f.sent[1],{id:2,result:{decision:'decline'}});
  await f.request(2);assert.equal(f.sent.length,2);
 }finally{f.engine['active']=undefined;await f.engine.close();f.close();}
});
test('child end invalidates its own callback, parent end fences all remaining callbacks',async()=>{
 const f=setup();try{
  const a=f.request(1),b=f.request(2);
  await f.receive({method:'turn/completed',params:{threadId:'native-child-1',turn:{id:'child-turn-1',status:'completed'}}});await a;
  assert.equal(f.interactions.list()[0]!.state,'expired');assert.equal(f.tasks.run(f.slot.id).phase,'rpc_wait');
  assert.throws(()=>f.approvals.respond(f.interactions.list()[0]!.id,{requestId:'late',text:'允许本次操作'}),/not_live/);
  f.engine['nativeRequests'].endTurn(f.actor.turnId!,f.actor.threadId!);await b;
  assert.equal(f.sent.length,0);assert.equal(f.tasks.run(f.slot.id).phase,'executing');
  assert.equal(f.interactions.list()[1]!.state,'expired');
 }finally{f.engine['active']=undefined;await f.engine.close();f.close();}
});
test('old Worker epoch refuses child callback; dynamic child tools remain parent thread/turn scoped',async()=>{
 const f=setup();try{
  await f.receive({id:90,method:'item/tool/call',params:{threadId:'native-child',turnId:'child-turn',callId:'forged',tool:'read_material',arguments:{}}});
  assert.equal(f.sent[0].result.success,false);
  f.tasks.workerStop(main,{operationId:'stop',workerId:f.tasks.run(f.actor.runId!).workerId,reason:'Synthetic stop'});
  await f.request(1);assert.equal(f.interactions.list().length,0);assert.ok(f.sent[1].error);
 }finally{f.engine['active']=undefined;await f.engine.close();f.close();}
});
test('child file approvals retain exact native item context across concurrent child threads',async()=>{
 const f=setup();try{
  const pending:Promise<void>[]=[];
  for(const id of [1,2]){
   const threadId='file-child-'+id,turnId='file-turn-'+id,path=f.dir+'/synthetic-'+id+'.txt';
   await f.receive({method:'item/started',params:{threadId,turnId,item:{type:'fileChange',id:'same-local-item',changes:[{path,kind:{type:'add'},diff:'+Synthetic'}]}}});
   pending.push(f.receive({id,method:'item/fileChange/requestApproval',params:{threadId,turnId,itemId:'same-local-item',reason:'Synthetic file change',availableDecisions:['accept','decline']}}));
  }
  const items=f.interactions.list();assert.equal(items.length,2);
  for(const [i,item] of items.entries()){
   const details=f.interactions.inspect(item.id).details as any;
   assert.equal(details.params.operation.changes[0].path,f.dir+'/synthetic-'+(i+1)+'.txt');
   f.approvals.respond(item.id,{requestId:'synthetic-file-'+i,text:i?'拒绝本次操作':'允许本次操作'});
  }
  await Promise.all(pending);assert.deepEqual(f.sent.map(m=>m.result.decision),['accept','decline']);
 }finally{f.engine['active']=undefined;await f.engine.close();f.close();}
});

test('ordinary MCP Worker child cancel preserves typed ids, actual user receipts and epoch ownership',async()=>{
 const f=setup();try{
  const method='mcpServer/elicitation/request',params={threadId:'native-child',turnId:'child-turn',serverName:'unregistered-server',mode:'form',message:'Review',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call',tool_params:{recipient:'alice',token:'SENSITIVE_SENTINEL'}}};
  const a=f.receive({id:1,method,params}),b=f.receive({id:'1',method,params});assert.equal(f.interactions.list().length,2);
  const [one,two]=f.interactions.list();assert.equal(one!.threadId,'native-child');assert.notEqual(one!.requestId,two!.requestId);
  f.approvals.respond(one!.id,{requestId:'actual-cancel',text:'取消本次请求'});await a;
  await f.receive({method:'serverRequest/resolved',params:{threadId:'native-child',requestId:1}});assert.ok(f.interactions.inspect(one!.id).deliveredAt);
  f.approvals.respond(two!.id,{requestId:'actual-deny',text:'拒绝本次操作'});await b;
  assert.deepEqual(f.sent,[{id:1,result:{action:'cancel',content:null,_meta:null}},{id:'1',result:{action:'decline',content:null,_meta:null}}]);
  assert.doesNotMatch(JSON.stringify(f.store.db.prepare('SELECT * FROM worker_interactions').all()),/SENSITIVE_SENTINEL|tool_params/);
  const c=f.receive({id:3,method,params});f.slot.epoch++;
  assert.throws(()=>f.approvals.respond(f.interactions.list().at(-1)!.id,{requestId:'stale-epoch',text:'允许本次操作'}),/interaction_not_live/);
  f.engine['nativeRequests'].close();await c;assert.equal(f.sent.length,2);
 }finally{f.engine['active']=undefined;await f.engine.close();f.close();}
});
test('MCP missing handler is a host failure, never a fabricated user denial',async()=>{
 const f=setup();try{
  f.engine.options.onInteraction=undefined;
  await f.receive({id:1,method:'mcpServer/elicitation/request',params:{threadId:'child',turnId:'turn',serverName:'any',mode:'form',message:'Review',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call'}}});
  assert.deepEqual(f.sent,[{id:1,error:{code:-32001,message:'interaction_handler_unavailable'}}]);assert.equal(f.engine.nativeInteractionPending,false);
 }finally{f.engine['active']=undefined;await f.engine.close();f.close();}
});

test('Worker ordinary MCP approve deny cancel remain request-scoped for two arbitrary servers',async()=>{
 const f=setup();try{
  let id=100;
  for(const serverName of ['arbitrary-alpha','任意服务乙'])for(const [text,want] of [['允许本次操作','accept'],['拒绝本次操作','decline'],['取消本次请求','cancel']]){
   const requestId=++id,threadId='child-'+id;
   const pending=f.receive({id:requestId,method:'mcpServer/elicitation/request',params:{threadId,turnId:'turn-'+id,serverName,mode:'form',message:'Review',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call',persist:true}}});
   const item=f.interactions.list().find(i=>i.state==='pending_user')!;
   f.approvals.respond(item.id,{requestId:'user-'+id,text:text!});await pending;
   assert.deepEqual(f.sent.at(-1),{id:requestId,result:{action:want,content:null,_meta:null}});
   await f.receive({method:'serverRequest/resolved',params:{threadId,requestId}});assert.ok(f.interactions.inspect(item.id).deliveredAt);
  }
 }finally{f.engine['active']=undefined;await f.engine.close();f.close();}
});
