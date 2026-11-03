import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {ConversationHistory,conversationInput,type ConversationInput} from '../src/web-history.js';
import {MainNativeApprovals} from '../src/main-native-approvals.js';
import {nativeResponse} from '../src/worker-interaction-protocol.js';
import {homerWebBridge} from '../src/web-homer.js';
import type {Homer} from '../src/service.js';
import {createWebServer} from '../src/web-server.js';
import type {WebBridge} from '../src/web-contract.js';

const cases:{name:string;questions:{id:string;question:string;options?:{label:string}[];isOther?:boolean}[];answers:Record<string,string[]>}[]=[
 {name:'single strict option',questions:[{id:'format',question:'使用什么格式？',options:[{label:'表格'},{label:'文字'}]}],answers:{format:['表格']}},
 {name:'multiple strict questions',questions:[{id:'format',question:'格式？',options:[{label:'表格'}]},{id:'audience',question:'受众？',options:[{label:'团队'}]}],answers:{format:['表格'],audience:['团队']}},
 {name:'single literal JSON free answer',questions:[{id:'notes',question:'补充说明',isOther:true}],answers:{notes:['{"原样":"保留"}\n第二行']}},
 {name:'mixed questions',questions:[{id:'format',question:'格式？',options:[{label:'文字'}]},{id:'notes',question:'补充说明',isOther:true}],answers:{format:['文字'],notes:['第一行\n第二行']}},
];
for(const c of cases)test('readable user answer reaches native callback: '+c.name,async()=>{
 const db=new DatabaseSync(':memory:'),interactions=new WorkerInteractions(db),history=new ConversationHistory(db),approvals=new MainNativeApprovals(interactions,history);
 try{
  const scope={threadId:'main',turnId:'turn',generationId:'generation',sourceRequestId:'source',userText:'合成请求',isCurrent:()=>true};
  const request={requestId:1,method:'item/tool/requestUserInput',threadId:'main',turnId:'turn',itemId:'question',kind:'question' as const,details:{questions:c.questions}};
  const opened=approvals.open(request,scope),input={requestId:'answer',text:'用户可读答复',questionAnswers:c.answers} as ConversationInput;
  const bridge=homerWebBridge({registerChannelCapabilities(){},submitMessage(value:ConversationInput){return approvals.respond(value.interactionId!,value);}} as unknown as Homer);
  await bridge.respond(opened.id,input);
  assert.deepEqual(interactions.inspect(opened.id).decision?.answers,c.answers);
  assert.deepEqual(nativeResponse(request,(await opened.response).decision!),{answers:Object.fromEntries(Object.entries(c.answers).map(([id,answers])=>[id,{answers}]))});
  assert.equal(history.list('main').find(m=>m.role==='user')?.text,input.text);
  assert.equal((await bridge.respond(opened.id,input) as {fresh:boolean}).fresh,false);
  await assert.rejects(()=>bridge.respond(opened.id,{...input,questionAnswers:{changed:['其他']}} as ConversationInput),/request_id_conflict/);
 }finally{db.close();}
});
test('new structured answers preserve legacy hashes and participate in new request identity',()=>{
 const db=new DatabaseSync(':memory:'),history=new ConversationHistory(db);
 try{
  const old={requestId:'old',text:'旧答案',interactionId:'interaction'};
  history.accept('main',old);
  const hash=createHash('sha256').update(JSON.stringify([old.text,null,old.interactionId])).digest('hex');
  assert.equal(db.prepare('SELECT hash FROM conversation_inputs WHERE requestId=?').get('old')!.hash,hash);
  const input={requestId:'new',text:'答案',interactionId:'interaction',questionAnswers:{q:['A']}} as ConversationInput;
  assert.deepEqual(conversationInput(input).questionAnswers,{q:['A']});
  history.accept('main',input);
  assert.throws(()=>history.accept('main',{...input,questionAnswers:{q:['B']}} as ConversationInput),/request_id_conflict/);
  assert.throws(()=>conversationInput({...input,questionAnswers:{q:[]}}),/interaction_answer_scope/);
 }finally{db.close();}
});
test('question fields never authorize an operation or release an invalid native answer',()=>{
 const db=new DatabaseSync(':memory:'),interactions=new WorkerInteractions(db),history=new ConversationHistory(db),approvals=new MainNativeApprovals(interactions,history);
 try{
  const scope={threadId:'main',turnId:'turn',generationId:'generation',sourceRequestId:'source',userText:'合成请求',isCurrent:()=>true};
  const native={requestId:1,method:'item/commandExecution/requestApproval',threadId:'main',turnId:'turn',itemId:'command',kind:'authorization' as const,details:{command:'synthetic command',availableDecisions:['accept','decline']}};
  const opened=approvals.open(native,scope);
  assert.throws(()=>approvals.respond(opened.id,{requestId:'fake-grant',text:'允许本次操作',questionAnswers:{q:['允许']}}),/interaction_response_kind/);
  assert.equal(interactions.inspect(opened.id).state,'pending_user');assert.equal(history.list('main').length,0);
  const question=approvals.open({...native,requestId:2,kind:'question',method:'item/tool/requestUserInput',details:{questions:cases[1]!.questions}},scope);
  for(const answers of [{format:['表格']},{format:['其他'],audience:['团队']},{format:['表格'],audience:['团队'],foreign:['A']}]){
   assert.throws(()=>approvals.respond(question.id,{requestId:'bad',text:'可读答复',questionAnswers:answers as Record<string,string[]>}),/interaction_answer_scope/);
   assert.equal(interactions.inspect(question.id).state,'pending_user');assert.equal(history.list('main').length,0);
  }
  approvals.end('generation');
 }finally{db.close();}
});
test('ordinary main turns discover bounded source-scoped Worker questions without deciding them',()=>{
 const db=new DatabaseSync(':memory:'),interactions=new WorkerInteractions(db),history=new ConversationHistory(db);
 try{
  history.accept('main',{requestId:'source',text:'原任务'});history.accept('other-main',{requestId:'foreign-source',text:'其他来源'});
  const open=(n:number,sourceRequestId='source')=>interactions.open({runId:'run-'+n,threadId:'worker-'+n,turnId:'turn',requestId:n,source:'ask_main',kind:'question',details:{question:'合成问题'},authority:{sourceRequestId,description:'合成授权',nativeApprovals:false}},()=>true);
  const ids=Array.from({length:18},(_,n)=>{const item=open(n);interactions.escalate(item.id,'用户需要补充的信息','信息缺失');return item.id;});
  const foreign=open(99,'foreign-source');interactions.escalate(foreign.id,'其他对话的问题','缺信息');
  const summary=interactions.pendingForMain('main');assert.equal(summary.total,18);assert.equal(summary.items.length,16);
  assert.ok(summary.items.every(item=>ids.includes(String(item.interactionId))));assert.equal(interactions.inspect(ids[0]!).state,'pending_user');
 }finally{db.close();}
});
test('pending Worker discovery excludes main-only, authorization, foreign and resolved facts and bounds question text',()=>{
 const db=new DatabaseSync(':memory:'),interactions=new WorkerInteractions(db),history=new ConversationHistory(db);
 try{
  history.accept('main',{requestId:'source',text:'Task'});history.accept('foreign',{requestId:'elsewhere',text:'Other task'});
  const open=(runId:string,sourceRequestId='source',kind:'question'|'authorization'='question')=>interactions.open({runId,threadId:'worker-'+runId,turnId:'turn',requestId:runId,source:kind==='question'?'ask_main':'native',kind,details:{question:'original'},authority:{sourceRequestId,description:'Task authority',nativeApprovals:false}},()=>true);
  const pending=open('worker-live');interactions.escalate(pending.id,'Q'.repeat(4000),'Need user input');
  open('only-main');
  for(const [run,source,kind] of [['main-native:turn','source','question'],['foreign','elsewhere','question'],['missing','unknown-source','question'],['approval','source','authorization'],['expired','source','question'],['cancelled','source','question'],['answered','source','question']] as const){
   const item=open(run,source,kind);interactions.escalate(item.id,'Scoped question','Need input');
   if(run==='expired')interactions.expire(item.id);if(run==='cancelled')interactions.cancelRun(run);
   if(run==='answered')interactions.respond(item.id,{action:'answer',answer:'Exact user answer',reason:'User replied'},{userMessageId:'reply',userText:'Exact user answer'});
  }
  const before=db.prepare('SELECT * FROM worker_interactions ORDER BY rowid').all();
  const summary=interactions.pendingForMain('main');assert.equal(summary.total,1);assert.equal(summary.items.length,1);
  assert.equal(summary.items[0]!.interactionId,pending.id);assert.equal(String(summary.items[0]!.question).length,300);assert.equal(summary.items[0]!.runId,'worker-live');
  assert.equal(interactions.pendingForMain('unknown-main').total,0);
  assert.deepEqual(db.prepare('SELECT * FROM worker_interactions ORDER BY rowid').all(),before,'discovery cannot resolve, bind answers or expand authority');
 }finally{db.close();}
});
test('actual HTTP response route preserves typed answers and binds the path identity',async()=>{
 let submitted:unknown;
 const bridge={state:async()=>({}),respond:async(id:string,input:unknown)=>{submitted={id,input};return {fresh:true,replyId:'receipt'};}} as unknown as WebBridge;
 const web=await createWebServer({port:0,bridge});try{
  const response=await fetch(web.url+'/api/interactions/exact',{method:'POST',headers:{Origin:web.url,'Content-Type':'application/json'},body:JSON.stringify({requestId:'http',text:'可读答复',interactionId:'wrong',questionAnswers:{q:['A']}})});
  assert.equal(response.status,202);assert.deepEqual(submitted,{id:'exact',input:{requestId:'http',text:'可读答复',questionAnswers:{q:['A']}}});
 }finally{await web.close();}
});
