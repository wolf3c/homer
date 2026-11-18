import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Homer} from '../src/service.js';
import type {EngineOptions,ToolCall,TurnResult} from '../src/engine.js';
import {callHostMcp} from './fixtures/host-mcp-call.js';

for(const kind of ['command','file','permissions','mcp'] as const)for(const action of ['approve','deny'] as const)test('model inspection deduplicates '+kind+' while preserving its exact operation and live '+action,{timeout:10000},async()=>{
 const parent=resolve('.codex/scratch/inspection-tests');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'case-')),cwd=join(root,'work');mkdirSync(cwd);
 mkdirSync(join(root,'runtime'));mkdirSync(join(root,'codex'));
 let app:Homer,sequence=0,inspected:any,persisted:any,original:any,delivered:any,earlyDecision:string|undefined;
 const command='printf "SYNTHETIC exact command with spaces"',workerPrompt='SYNTHETIC_PRIVATE_PROMPT_'+'x'.repeat(5000),checkpoint='SYNTHETIC_CHECKPOINT_'+'y'.repeat(12000);
 const fileOperation={type:'fileChange',id:'synthetic-file-operation',status:'inProgress',changes:[{path:join(cwd,'before.txt'),kind:{type:'update',move_path:join(cwd,'after.txt')},diff:'@@ synthetic @@\n-before\n+after\n'}]};
 const permissions={network:{enabled:true},fileSystem:{read:[cwd],write:null}};
 const methods={command:'item/commandExecution/requestApproval',file:'item/fileChange/requestApproval',permissions:'item/permissions/requestApproval',mcp:'mcpServer/elicitation/request'};
 const operationDetails={
  command:{command,cwd,availableDecisions:['accept','decline'],networkApprovalContext:{protocol:'https',host:'synthetic.invalid'},
   additionalPermissions:{network:{enabled:true},fileSystem:{entries:[{access:'deny',path:{type:'path',path:join(cwd,'private')}}]}}},
  file:{cwd,operation:fileOperation,grantRoot:action==='deny'?cwd:null,availableDecisions:['accept','decline']},
  permissions:{cwd,permissions,reason:'Synthetic current-turn permissions.'},
  mcp:{mode:'form',serverName:'synthetic_records',message:'Read one synthetic record.',requestedSchema:{type:'object',properties:{}},
   _meta:{codex_approval_kind:'mcp_tool_call',tool_name:'read_record',tool_params_display:[
    {name:'destination',display_name:'Target',value:'https://synthetic.invalid/record?view=local'},
    {name:'mode',display_name:'Mode',value:'read'},
   ]}},
 };
 class Peer extends EventEmitter{
  threadId:string;turnId='';resumable=true;
  constructor(readonly options:EngineOptions,readonly handle:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'inspection-thread-'+ ++sequence;}
  async start(){return this.threadId;}
  async close(){return true;}
  async interrupt(){return true;}
  async turn(text:string,hooks?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
   this.turnId='inspection-turn-'+ ++sequence;hooks?.onStarted?.(this.turnId);
   if(this.options.role==='worker'){
    const run=app.store.runs().find(run=>run.threadId===this.threadId)!;
    app.store.db.prepare('UPDATE runs SET checkpointJson=?,usage=? WHERE id=?').run(JSON.stringify({syntheticEvidence:checkpoint}),JSON.stringify({total:{inputTokens:999,cachedInputTokens:900,outputTokens:10,totalTokens:1009}}),run.id);
    const details={threadId:this.threadId,turnId:this.turnId,itemId:'exact-native-item',startedAtMs:1234567890000,...operationDetails[kind]};
    delivered=await this.options.onInteraction!({method:methods[kind],threadId:this.threadId,turnId:this.turnId,itemId:'exact-native-item',requestId:'exact-native-request',kind:'authorization',details});
    return {status:'completed',text:'Synthetic Worker finished after '+delivered.status};
   }
   if(text==='Inspect a bounded local operation; do not publish or use paid services.'){
    await this.handle({threadId:this.threadId,turnId:this.turnId,callId:'dispatch',tool:'worker_open',arguments:{title:"Synthetic task",message:workerPrompt,workingDirectory:cwd}});
   }else if(text.includes('[待答入口]')){
    const interactionId=text.match(/interactionId=([\w-]+)/)![1]!;
    const args={interactionId,action,reason:'Exact authorized local operation only.'};
    try{await callHostMcp(this.options,'respond_interaction',args);}catch(error){earlyDecision=(error as Error).message;}
    inspected=await callHostMcp(this.options,'inspect_interaction',{interactionId});
    original=app.interactions.inspect(interactionId);
    persisted=app.tasks.run(inspected.runId);
    await callHostMcp(this.options,'respond_interaction',{...args,...(kind==='permissions'&&action==='approve'?{permissions:inspected.details.params.permissions}:{})});
   }
   return {status:'completed',text:'Synthetic Main result.'};
  }
 }
 app=new Homer({workspace:cwd,runtime:join(root,'runtime'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,fast:false,stopGraceMs:100},async()=>{},(options,handle)=>new Peer(options,handle));
 try{
  await app.start();await app.message('Inspect a bounded local operation; do not publish or use paid services.','inspection-user');
  const deadline=Date.now()+3000;while(delivered===undefined){assert.ok(Date.now()<deadline,'original native approval must settle');await new Promise(done=>setTimeout(done,5));}
  await app.idle();
  assert.ok(inspected);assert.equal(earlyDecision,'interaction_inspection_required');
  assert.deepEqual(Object.keys(inspected).sort(),['authority','details','id','kind','run','runId','state','waitingFor']);
  assert.equal(inspected.state,'pending_main');assert.equal(inspected.waitingFor,'main');
  assert.equal(inspected.details.method,methods[kind]);
  for(const key of ['review','historyThreadId'])assert.equal(Object.hasOwn(inspected.details,key),false);
  for(const key of ['title','detailLabel'])assert.equal(Object.hasOwn(inspected.details.approval,key),false);
  assert.equal(inspected.details.approval.scope,original.details.approval.scope);
  assert.equal(inspected.details.reviewReason,original.details.reviewReason);
  if(kind==='file'||kind==='permissions'){
   for(const key of ['details','context'])assert.equal(Object.hasOwn(inspected.details.approval,key),false);
   assert.ok(original.details.approval.details,'the full host/UI copy must still exist');
   assert.deepEqual(kind==='file'?inspected.details.params.operation:inspected.details.params.permissions,kind==='file'?fileOperation:permissions);
   if(kind==='file'&&action==='deny'){
    assert.equal(inspected.details.params.grantRoot,cwd);assert.equal(inspected.details.approval.canApprove,false);
   }
  }else{
   assert.equal(inspected.details.approval.details,original.details.approval.details);
   assert.equal(inspected.details.approval.context,original.details.approval.context);
   assert.ok(inspected.details.approval.context.includes('synthetic.invalid'));
   if(kind==='command'){
    assert.ok(inspected.details.approval.details.includes(command));assert.ok(inspected.details.approval.details.includes(cwd));
    assert.ok(inspected.details.approval.details.includes(join(cwd,'private')),'deny entries must not disappear');
   }else{
    assert.ok(inspected.details.approval.context.includes('read_record'));
    assert.ok(inspected.details.approval.details.includes('https://synthetic.invalid/record?view=local'));
   }
  }
  if(inspected.details.params)for(const key of ['threadId','turnId','itemId','startedAtMs'])assert.equal(Object.hasOwn(inspected.details.params,key),false);
  assert.match(inspected.authority.description,/do not publish or use paid services/);assert.equal(inspected.authority.sourceRequestId,'inspection-user');
  assert.deepEqual(Object.keys(inspected.run).sort(),['phase','status','taskId','workerId','workingDirectory']);
  assert.equal(inspected.run.workingDirectory,cwd);
  assert.equal(JSON.stringify(inspected).includes(workerPrompt),false);assert.equal(JSON.stringify(inspected).includes(checkpoint),false);
  assert.equal(persisted.prompt,workerPrompt);assert.ok(persisted.checkpointJson.includes(checkpoint));assert.ok(persisted.usage.includes('cachedInputTokens'));
  assert.equal(delivered.status,action==='approve'?'approved':'denied');assert.equal(app.interactions.inspect(inspected.id).decision?.action,action);
  assert.deepEqual(app.interactions.inspect(inspected.id).details,original.details,'projection must not modify the full host record');
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
