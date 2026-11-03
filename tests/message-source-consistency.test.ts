import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {MainProcessHistory} from '../src/main-process.js';
import {ConversationHistory,conversationInput} from '../src/web-history.js';
import {CodexEngine} from '../src/engine.js';
import {projectConversation} from '../src/conversation-projection.js';
import {prepareMessage,restoreComposerDraft} from '../ui/conversation-client.js';

function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)');
 const history=new ConversationHistory(db),processes=new MainProcessHistory(db);
 history.record('node','thread','');processes.start({id:'node',threadId:'thread',sourceKind:'user',sourceMessageIds:[],messageId:'node'},'turn');
 const agent=(itemId:string,phase:string|undefined,text:string,completed=true)=>processes.agent('node',{turnId:'turn',itemId,phase,text,completed});
 return {db,history,processes,agent,node:()=>processes.exact('node')!};
}
// Catches phase dropping, partial+full concatenation and terminal reclassification.
test('unknown phase, delta then full, late delta and persisted lifecycle retain exact sources',()=>{
 const f=fixture();try{
 f.agent('u','future_phase','first');f.agent('missing',undefined,'unknown');
 f.agent('a','final_answer','Hel',false);f.processes.agent('node',{turnId:'turn',itemId:'a',delta:'lo',completed:false});f.agent('a','final_answer','Hello');
 f.processes.agent('node',{turnId:'turn',itemId:'a',delta:'LATE',completed:false});f.agent('a','final_answer','DUPLICATE');
 assert.deepEqual(f.node().items.map((i:any)=>[i.itemId,i.phase,i.text,i.completed]),[['u','future_phase','first',true],['missing',null,'unknown',true],['a','final_answer','Hello',true]]);
 f.agent('b','final_answer','partial',false);f.processes.finish('node','interrupted','native:terminal');
 const msg=projectConversation(f.history.list('thread'),f.processes.headers(['node']),[]).messages[0]!;
 assert.equal(msg.status,'interrupted');assert.deepEqual(msg.process!.items.map(i=>i.id),['turn:u','turn:missing','turn:a','turn:b']);
 assert.equal((msg.process!.items.at(-1) as any).completed,false);
 assert.deepEqual(new MainProcessHistory(f.db).headers(['node'])[0]!.items,f.node().items);
 }finally{f.db.close();}
});

// Catches terminal-only items bypassing persistence, wrong thread acceptance,
// summary overwrites, replay concatenation and sorting by completion arrival.
test('real engine terminal full reconciles the same persistent entry in protocol order; summary is not full',async()=>{
 const f=fixture();try{
 const engine:any=new CodexEngine({workspace:process.cwd(),runtime:process.cwd(),model:'synthetic'} as any,{cwd:process.cwd(),readRoots:[],instructions:'',tools:[]},async()=>({}));
 engine.threadId='thread';engine.turnId='turn';engine.active={messages:[],earlyEvents:[],resolve:()=>{},reject:()=>{}};engine.refreshBackground=async()=>{};
 const rawDeltas:string[]=[];engine.on('textDelta',(e:any)=>rawDeltas.push(e.delta));
 engine.on('agentMessage',(e:any)=>f.processes.agent('node',e));
 engine.on('turnRetry',(e:any)=>{(f.processes as any).uncertain('node',e.turnId);});
 const receive=(method:string,p:any)=>engine.receive(JSON.stringify({method,params:{threadId:'thread',turnId:'turn',...p}}));
 await receive('item/started',{item:{id:'b',type:'agentMessage',phase:'final_answer',text:''}});
 await receive('item/agentMessage/delta',{itemId:'b',delta:'Hel'});
 await receive('error',{willRetry:true,error:{codexErrorInfo:'future_retry_code'}});
 await receive('item/agentMessage/delta',{itemId:'b',delta:'Hel'});
 await receive('item/started',{item:{id:'new',type:'agentMessage',phase:'future',text:''}});
 await receive('item/agentMessage/delta',{itemId:'new',delta:'REPLAY'});
 await receive('item/completed',{threadId:'other',item:{id:'forged',type:'agentMessage',phase:'final_answer',text:'FORGED'}});
 assert.equal((f.node().items[0] as any).text,'Hel');assert.equal((f.node().items[1] as any).text,'');assert.deepEqual(rawDeltas,['Hel']);
 const items=[{type:'agentMessage',id:'a',phase:'final_answer',text:'A'},{type:'agentMessage',id:'b',phase:'final_answer',text:'Hello'},{type:'agentMessage',id:'new',phase:'future',text:'N'}];
 await receive('turn/completed',{turn:{id:'turn',status:'completed',itemsView:'full',items}});
 assert.deepEqual(f.node().items.map((i:any)=>[i.itemId,i.text]),[['a','A'],['b','Hello'],['new','N']]);
 assert.ok(f.node().items.every((i:any)=>i.completed));
 const g=fixture();try{
 const peer:any=new CodexEngine({workspace:process.cwd(),runtime:process.cwd(),model:'synthetic'} as any,{cwd:process.cwd(),readRoots:[],instructions:'',tools:[]},async()=>({}));peer.threadId='thread';peer.turnId='turn';peer.active={messages:[],earlyEvents:[],resolve:()=>{}};peer.refreshBackground=async()=>{};
 peer.on('agentMessage',(e:any)=>g.processes.agent('node',e));g.agent('a','final_answer','Confirmed',false);
 await peer.receive(JSON.stringify({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed',itemsView:'summary',items:[{...items[0],text:'SUMMARY'}]}}}));
 g.processes.finish('node','completed','terminal');assert.equal((g.node().items[0] as any).text,'Confirmed');assert.equal((g.node().items[0] as any).completed,false);
 assert.equal(projectConversation(g.history.list('thread'),[g.node()],[]).messages[0]!.status,'completed');
 }finally{g.db.close();}
 }finally{f.db.close();}
});

// Catches summary-row authority, per-container Markdown parsing, invalid item
// membership/order and non-atomic quote acceptance. Literal expectations.
test('streaming and multi-item segmented Markdown quotes use persisted source IDs, atomically',()=>{
 const f=fixture();try{
 f.agent('a','final_answer','**open',false);f.agent('b','final_answer','close** [Label](https://hidden.example)',false);
 const quote={messageId:'node',text:'**open\n\nclose** Label',itemIds:['turn:a','turn:b']};
 const input={requestId:'new',text:'ask',quote};
 f.history.validateQuotes('thread',input);assert.equal(f.history.accept('thread',input).fresh,true);
 assert.deepEqual(f.history.list('thread').find(m=>m.requestId==='new'&&m.role==='user')!.quote,quote);
 for(const q of [{...quote,itemIds:['turn:b','turn:a']},{...quote,itemIds:['turn:other']},{...quote,text:'https://hidden.example'}]){
 assert.throws(()=>f.history.validateQuotes('thread',{requestId:'bad',text:'bad',quote:q}),/quote_source_mismatch/);
 assert.throws(()=>f.history.accept('thread',{requestId:'bad',text:'bad',quotes:[{...quote,annotation:''},{...q,annotation:''}]}),/quote_source_mismatch/);
 }
 assert.throws(()=>f.history.accept('other',{requestId:'bad',text:'bad',quote}),/quote_source_mismatch/);
 assert.equal(f.db.prepare('SELECT count(*) n FROM conversation_inputs').get()!.n,1);
 f.agent('a','final_answer','Changed');assert.equal(f.history.accept('thread',input).fresh,false,'accepted hash is checked before source changed');
 assert.throws(()=>f.history.accept('thread',{...input,requestId:'changed'}),/quote_source_mismatch/);
 }finally{f.db.close();}
});

test('item IDs survive single/collection parsing, pending/draft restoration and determine new hashes; legacy bytes stay stable',()=>{
 const f=fixture();try{
 f.agent('a','final_answer','A');f.agent('b','final_answer','A');
 const quote={messageId:'node',text:'A',itemIds:['turn:a']};
 assert.deepEqual(conversationInput({requestId:'q',text:'ask',quote}).quote,quote);
 assert.deepEqual(conversationInput({requestId:'qs',text:'ask',quotes:[{...quote,annotation:''}]}).quotes,[{...quote,annotation:''}]);
 const pending={requestId:'pending',text:'ask',quote};assert.deepEqual(prepareMessage('ask',quote,undefined,()=> 'pending'),pending);
 assert.equal(prepareMessage('ask',quote,pending,()=> 'different'),pending);
 assert.equal(prepareMessage('ask',{...quote,itemIds:['turn:b']},pending,()=> 'different').requestId,'different');
 assert.deepEqual(restoreComposerDraft(undefined,pending,false)!.quotes,[{...quote,annotation:''}]);
 f.history.accept('thread',pending);assert.throws(()=>f.history.accept('thread',{...pending,quote:{...quote,itemIds:['turn:b']}}),/request_id_conflict/);
 for(const id of [[],['turn:a','turn:a'],[null]])assert.throws(()=>conversationInput({requestId:'bad',text:'ask',quote:{...quote,itemIds:id}}),/invalid_quote/);
 const legacy={requestId:'legacy',text:'ask',quote:{messageId:'node',text:'A'}};
 f.history.accept('thread',legacy);
 assert.equal(f.db.prepare('SELECT hash FROM conversation_inputs WHERE requestId=?').get('legacy')!.hash,createHash('sha256').update(JSON.stringify(['ask',legacy.quote,null])).digest('hex'));
 }finally{f.db.close();}
});

// Adapter order must come from native items, while disclosure classification
// continues to put commentary in the existing activity slot.
test('adapter keeps interleaved source order and final classification without summary-created parts',async()=>{
 const {buildSync}=await import('esbuild');const {createRequire}=await import('node:module');
 const result=buildSync({entryPoints:['ui/process-message.tsx'],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime','@assistant-ui/react'],loader:{'.css':'empty'},logLevel:'silent'});
 const module={exports:{} as any};Function('require','module','exports',result.outputFiles[0]!.text)(createRequire(import.meta.url),module,module.exports);
 const f=fixture();try{f.agent('a','final_answer','A');f.agent('c','commentary','C');f.agent('b','final_answer','B');f.agent('u','future','U');
 const msg=projectConversation(f.history.list('thread'),[f.node()],[]).messages[0]!;
 const projected=module.exports.projectProcessMessage(msg);
 assert.deepEqual(projected.content.map((part:any)=>[part.id,part.text]),[['turn:a','A'],['turn:c','C'],['turn:b','B'],['turn:u','U']]);
 assert.equal(projected.presentation.entries['text:turn:a'].kind,'answer');assert.equal(projected.presentation.entries['text:turn:c'].kind,'commentary');
 const quote={messageId:'node',text:'A\n\nB',itemIds:['turn:a','turn:b']};
 f.history.validateQuotes('thread',{requestId:'cross',text:'ask',quote});
 const empty={...msg,text:'SUMMARY',process:{...f.node(),items:[],final:{id:'invented',text:'SUMMARY'}}};
 assert.deepEqual(module.exports.projectProcessMessage(empty).content,[]);
 assert.deepEqual(module.exports.projectProcessMessage({...empty,process:{...empty.process,final:undefined}}).content,[]);
 const host={...empty,text:'Host original',process:{...empty.process,final:{id:'node',text:'Host original'}}};
 assert.deepEqual(module.exports.projectProcessMessage(host).content,[{type:'text',id:'host:node',text:'Host original'}]);
 const {sourceMessageText,messageSourceParts}=await import('../src/message-quote.js');
 assert.equal(messageSourceParts(host),undefined);assert.equal(sourceMessageText(host),'Host original');
 const raw=JSON.parse(String(f.db.prepare('SELECT value FROM meta WHERE key=?').get('publicMainNode:v1:node')!.value));
 raw.items=[];raw.final={id:'node',text:'Host original'};
 f.db.prepare('UPDATE meta SET value=? WHERE key=?').run(JSON.stringify(raw),'publicMainNode:v1:node');
 f.db.prepare('UPDATE conversation_messages SET text=? WHERE id=?').run('Host original','node');
 f.history.validateQuotes('thread',{requestId:'host',text:'ask',quote:{messageId:'node',text:'Host original'}});
 for(const final of [undefined,{id:'missing',text:'Host original'}]){
 raw.final=final;f.db.prepare('UPDATE meta SET value=? WHERE key=?').run(JSON.stringify(raw),'publicMainNode:v1:node');
 assert.throws(()=>f.history.validateQuotes('thread',{requestId:'unknown',text:'ask',quote:{messageId:'node',text:'Host original'}}),/quote_source_mismatch/);
 }

 }finally{f.db.close();}
});

test('rejected input restores only the untouched cleared draft, including item IDs, attachments and original request ID',async()=>{
 const {restoreRejectedSourceDraft}=await import('../ui/conversation-client.js');
 const input={requestId:'original',text:'ask',quote:{messageId:'node',text:'A',itemIds:['turn:a']},attachments:[{assetId:'asset-original',revision:1}]};
 const draft={text:'',quotes:[],requestId:'cleared'};
 const result=restoreRejectedSourceDraft(draft,input,'cleared');
 assert.equal(result!.requestId,'original');assert.deepEqual(result!.quotes,[{...input.quote,annotation:''}]);assert.deepEqual(result!.attachments,input.attachments);
 assert.equal(restoreRejectedSourceDraft({...draft,text:'newer'},input,'cleared'),undefined);
 assert.equal(restoreRejectedSourceDraft({...draft,uploading:true},input,'cleared'),undefined);
 assert.equal(restoreRejectedSourceDraft({...draft,attachments:[{status:'uploading'}]},input,'cleared'),undefined);
 assert.equal(restoreRejectedSourceDraft({...draft,requestId:'newer-id'},input,'cleared'),undefined);
 assert.equal(restoreRejectedSourceDraft({...draft,quotes:[{messageId:'new',text:'new',annotation:''}]},input,'cleared'),undefined);
});

test('per-item quote mapping treats math as one source expression, preserving markdown operators inside TeX',async()=>{
 const {sourceQuoteText}=await import('../src/message-quote.js');
 assert.equal(sourceQuoteText([{id:'m',revision:1,text:'formula $**x**$ tail'}]),'formula $**x**$ tail');
});

test('whole-source quote truncation carries only the actual bounded item prefix',async()=>{
 const {sourceQuote}=await import('../src/message-quote.js');
 assert.deepEqual(sourceQuote([{id:'a',text:'abc',revision:1},{id:'b',text:'def',revision:1},{id:'c',text:'ghi',revision:1}],7),{text:'abc\n\nde',itemIds:['a','b']});
 assert.deepEqual(sourceQuote([{id:'a',text:'a',revision:1},{id:'b',text:'b',revision:1}],16000,1),{text:'a',itemIds:['a']});
});

// Legacy pending text remains verifiable without changing its original hash.
test('math selections and legacy no-item quotes verify against trusted deterministic mappings',()=>{
 const f=fixture();try{
 f.history.record('standalone','thread','$*x*$');f.agent('a','final_answer','$*x*$');
 for(const messageId of ['standalone','node'])for(const text of ['$x$','$*x*$'])
   f.history.validateQuotes('thread',{requestId:'math',text:'ask',quote:{messageId,text}});
 assert.throws(()=>f.history.validateQuotes('thread',{requestId:'math',text:'ask',quote:{messageId:'node',text:'$x$',itemIds:['turn:a']}}),/quote_source_mismatch/);
 f.history.record('legacy-reply','thread','SUMMARY ONLY');
 const stored=JSON.parse(String(f.db.prepare('SELECT value FROM meta WHERE key=?').get('publicMainNode:v1:node')!.value));stored.replyMessageId='legacy-reply';
 f.db.prepare('UPDATE meta SET value=? WHERE key=?').run(JSON.stringify(stored),'publicMainNode:v1:node');
 f.db.exec("CREATE TEMP TABLE web_process_ids(id TEXT,threadId TEXT,messageId TEXT,replyId TEXT);INSERT INTO web_process_ids VALUES('node','thread','node','legacy-reply')");
 f.history.validateQuotes('thread',{requestId:'indexed',text:'ask',quote:{messageId:'node',text:'$*x*$',itemIds:['turn:a']}});
 f.history.validateQuotes('thread',{requestId:'alias',text:'ask',quote:{messageId:'legacy-reply',text:'$x$'}});
 assert.throws(()=>f.history.validateQuotes('thread',{requestId:'alias',text:'ask',quote:{messageId:'legacy-reply',text:'SUMMARY ONLY'}}),/quote_source_mismatch/);
 }finally{f.db.close();}
});
