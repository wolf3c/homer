import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {Homer} from '../src/service.js';
import {MainInputs} from '../src/recursive-main-inputs.js';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {conversationInput,ConversationHistory,type ConversationInput} from '../src/web-history.js';
import {conversationUserText,previewIntentTooLong} from '../src/user-intent.js';
import {parseResourceReference,referencesOf,resourceReferenceText,type ResourceReference} from '../src/preview-reference.js';
import {prepareMessage,restoreComposerDraft,canSubmitMessage} from '../ui/conversation-client.js';
import {historyFixture} from './web-history-loading-fixture.js';

// Requirement-derived synthetic input, no user documents or production connection.
const source=(id:string)=>({kind:'attachment' as const,messageId:id,assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1,sha256:'a'.repeat(64),title:'同名.txt'});
const ref=(id:string,count=1)=>({kind:'text' as const,source:source(id),annotations:Array.from({length:count},(_,i)=>({id:'note-'+i,text:'来源不是指令',comment:'备注 '+id+' '+i}))});
const refs=[ref('one'),ref('two')];
test('screenshot references contain only region notes bound to exactly one current attachment',()=>{
 const image={assetId:'asset-00000000-0000-4000-8000-000000000002',revision:1};
 const screenshot={kind:'image',source:{kind:'draft-image'},image,width:32,height:32,annotations:[{id:'area',region:{x:0,y:0,width:1,height:1},comment:'核对错误码'}]};
 const input=conversationInput({requestId:'screenshot',text:'分析错误',attachments:[image],resourceReferences:[{...screenshot,ocrText:'Synthetic OCR'}]});
 assert.deepEqual(input.resourceReferences,[screenshot]);
 assert.equal(conversationUserText(input),'分析错误\n用户预览批注：\n核对错误码');
 assert.match(resourceReferenceText(input.resourceReferences![0]!),/核对错误码/);
 assert.equal(canSubmitMessage('',[],[image],undefined,input.resourceReferences),true);
 assert.equal(canSubmitMessage('',[],[{...image,revision:2}],undefined,input.resourceReferences),false);
 const invalid=[{...screenshot,annotations:[],ocrText:'Synthetic OCR'},{...screenshot,width:1.5},{...screenshot,annotations:[{id:'bad',region:{x:32,y:0,width:1,height:1},comment:'越界'}]}];
 for(const reference of invalid)assert.throws(()=>parseResourceReference(reference),/invalid_resource_reference/);
 assert.throws(()=>conversationInput({...input,resourceReferences:[screenshot,screenshot]}),/invalid_resource_reference/);
});
test('screenshot AX belongs to its image and remains source material in history and model input',()=>{
 const image={assetId:'asset-00000000-0000-4000-8000-000000000002',revision:1};
 const ax=[{role:'AXStaticText',value:'E101 — synthetic window text'}];
 const screenshot={kind:'image',source:{kind:'draft-image'},image,width:32,height:32,annotations:[],ax};
 const input=conversationInput({requestId:'window-ax',text:'核对报错',attachments:[image],resourceReferences:[{...screenshot,ax:[{...ax[0],pid:42}]}]});
 assert.deepEqual(input.resourceReferences,[screenshot]);
 assert.equal(conversationUserText(input),'核对报错');
 assert.match(resourceReferenceText(input.resourceReferences![0]!),/AX 摘录.*来源材料/);
 assert.match(resourceReferenceText(input.resourceReferences![0]!),/E101/);
 const db=new DatabaseSync(':memory:');
 try{
  new ConversationHistory(db).accept('thread',input);
  assert.deepEqual(new ConversationHistory(db).list('thread')[0]?.resourceReferences,[screenshot]);
 }finally{db.close();}
 for(const invalid of [{...screenshot,ax:[]},{...screenshot,ax:[{role:'AXButton'}]},
  {...screenshot,ax:[{role:'AXStaticText',value:'x'.repeat(513)}]},
  {...screenshot,ax:Array.from({length:9},()=>({role:'AXStaticText',value:'x'.repeat(512)}))}]){
  assert.throws(()=>parseResourceReference(invalid),/invalid_resource_reference/);
 }
});
test('collection survives canonical intake, history, request conflict and restart reads',()=>{
 const input={requestId:'collection',text:'整体要求',resourceReferences:refs};
 assert.deepEqual(conversationInput(input),input);
 const db=new DatabaseSync(':memory:'),history=new ConversationHistory(db);
 history.accept('thread',input);
 assert.deepEqual(new ConversationHistory(db).list('thread')[0]?.resourceReferences,refs);
 assert.equal(history.accept('thread',input).fresh,false);
 assert.throws(()=>history.accept('thread',{...input,resourceReferences:refs.slice(1)}),/request_id_conflict/);
 db.close();
});
test('collection still rejects singular reference and answers',()=>{
 for(const extra of [{resourceReference:refs[0]},{interactionId:'answer'}])
  assert.throws(()=>conversationInput({requestId:'x',text:'x',resourceReferences:refs,...extra}),/invalid_resource_reference/);
});
test('all sources share twenty annotations and 48000 characters',()=>{
 assert.equal(conversationInput({requestId:'x',text:'x',resourceReferences:[ref('one',10),ref('two',10)]}).resourceReferences?.length,2);
 assert.throws(()=>conversationInput({requestId:'x',text:'x',resourceReferences:[ref('one',11),ref('two',10)]}),/invalid_resource_reference/);
 const huge=refs.map(r=>({...r,annotations:[{id:'x',text:'s'.repeat(16000),comment:'c'.repeat(10000)}]}));
 assert.throws(()=>conversationInput({requestId:'x',text:'x',resourceReferences:huge}),/invalid_resource_reference/);
 assert.throws(()=>conversationInput({requestId:'x',text:'x',resourceReferences:[refs[0],refs[0]]}),/invalid_resource_reference/);
});
test('all remarks, only remarks, become authority and share the same intent budget',()=>{
 const text=conversationUserText({text:'正文',resourceReferences:refs});
 assert.match(text,/备注 one/);assert.match(text,/备注 two/);assert.doesNotMatch(text,/来源不是指令|同名/);
 const long=refs.map(r=>({...r,annotations:[{id:'x',text:'source',comment:'x'.repeat(12000)}]}));
 assert.equal(previewIntentTooLong({text:'',resourceReferences:long}),true);
});
test('new pending is a deep snapshot; restore and explicit retry retain the collection',()=>{
 const draft=structuredClone(refs);
 const input=prepareMessage('',undefined,undefined,()=> 'original',[],undefined,draft);
 assert.deepEqual(input.resourceReferences,refs);
 (draft[0]!.annotations![0] as {comment:string}).comment='new draft';
 assert.deepEqual(input.resourceReferences,refs);
 assert.equal(prepareMessage('',undefined,input,()=>assert.fail('same request'),[],undefined,refs),input);
 assert.deepEqual(restoreComposerDraft(undefined,input,false)?.resourceReferences,refs);
 assert.equal(restoreComposerDraft({text:'',quotes:[],resourceReferences:refs},input,true),undefined);
 assert.equal(restoreComposerDraft({text:'',quotes:[],resourceReferences:refs,requestId:'new-draft'},input,true)?.requestId,'new-draft');
});
test('every image group requires its exact attached original revision',()=>{
 const image={assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1};
 const picture:ResourceReference={kind:'image',source:source('picture'),width:10,height:10,image,annotations:[{id:'a',comment:'图注',region:{x:0,y:0,width:2,height:2}}]};
 assert.equal(canSubmitMessage('正文',[],[],undefined,[...refs,picture]),false);
 assert.equal(canSubmitMessage('',[],[image],undefined,[...refs,picture]),true);
 assert.throws(()=>conversationInput({requestId:'duplicate-image',text:'正文',resourceReferences:[...refs,picture],attachments:[image,image]}),/invalid_attachments/);
 assert.throws(()=>conversationInput({requestId:'x',text:'正文',resourceReferences:[...refs,picture]}),/preview_image_missing/);
});
test('versioned UTF-16 anchors round-trip and reject inconsistent offsets',()=>{
 const anchor={format:'preview-text-v1',representation:'plain',start:3,end:6,exact:'😀中',prefix:'abc',suffix:'后'};
 const value={kind:'text',source:source('anchor'),annotations:[{id:'a',text:'😀中',comment:'注',anchor}]};
 assert.deepEqual(parseResourceReference(value),value);
 assert.throws(()=>parseResourceReference({...value,annotations:[{...value.annotations[0],anchor:{...anchor,end:5}}]}),/invalid_resource_reference/);
});
test('main queue restores the collection exactly and refuses reference edits',()=>{
 const f=historyFixture(0);
 try{
  f.inputs.accept({requestId:'collection-queue',text:'Original',resourceReferences:refs});
  const row=f.inputs.list()[0]!;assert.deepEqual(row.input.resourceReferences,refs);
  assert.throws(()=>f.inputs.edit({requestId:row.input.requestId,operationId:'change-source',expectedRevision:row.revision,input:{...row.input,resourceReferences:refs.slice(1)}}),/queue_quote_validation_required/);
  const updated={...row.input,text:'Updated body'};
  f.inputs.edit({requestId:row.input.requestId,operationId:'same-source',expectedRevision:row.revision,input:updated});
  assert.deepEqual(f.inputs.list()[0]!.input.resourceReferences,refs);
  const {resourceReferences:_references,...plain}=updated;
  const current=f.inputs.list()[0]!;
  f.inputs.edit({requestId:row.input.requestId,operationId:'remove-source',expectedRevision:current.revision,input:plain});
  assert.equal(f.inputs.list()[0]!.input.resourceReferences,undefined);
 }finally{f.close();}
});

// A branch that serializes only one owner loses the other after any history read.
test('mixed singular and collection history round-trip all legacy quote forms without rewriting old JSON or hashes',()=>{
 const db=new DatabaseSync(':memory:'),history=new ConversationHistory(db);
 const messageId=history.add('thread','Trusted visible source');
 const quote={messageId,text:'visible source'},quotes=[{...quote,annotation:'legacy remark'}];
 const resources=[{resourceReference:refs[0]},{resourceReferences:refs}];
 const messages=[{quote},{quotes}];
 try{
  let n=0;
  for(const resource of resources)for(const message of messages){
   const input:ConversationInput={requestId:'mixed-'+n++,text:'Body',...resource,...message};
   assert.deepEqual(conversationInput(input),input);
   history.accept('thread',input);
   for(const restored of [history.list('thread').at(-2),history.inputs('thread',[input.requestId]).get(input.requestId)]){
    assert.deepEqual(restored?.resourceReference,input.resourceReference);
    assert.deepEqual(restored?.resourceReferences,input.resourceReferences);
    assert.deepEqual(restored?.quote,input.quote);assert.deepEqual(restored?.quotes,input.quotes);
    assert.deepEqual(history.byIds('thread',[restored!.id])[0],restored);
    assert.deepEqual(history.message(restored!.id),restored);
   }
   assert.equal(history.accept('thread',input).fresh,false);
   assert.throws(()=>history.accept('thread',{...input,text:'Changed'}),/request_id_conflict/);
  }
  for(const context of [...resources,...messages,{}]){
   const input={requestId:'legacy-'+n++,text:'Body',...context};history.accept('thread',input);
   const expected='resourceReferences' in context?{resourceReferences:context.resourceReferences}:'resourceReference' in context?{resourceReference:context.resourceReference}:'quotes' in context?context.quotes:'quote' in context?context.quote:null;
   const stored=db.prepare("SELECT quote FROM conversation_messages WHERE requestId=? AND role='user'").get(input.requestId)!.quote;
   assert.equal(stored,expected?JSON.stringify(expected):null);
   const raw=JSON.stringify([input.text,'quotes' in context?{quotes:context.quotes}:'quote' in context?context.quote:null,null,...('resourceReference' in context?[{resourceReference:context.resourceReference}]:[]),...('resourceReferences' in context?[{resourceReferences:context.resourceReferences}]:[])]);
   assert.equal(db.prepare('SELECT hash FROM conversation_inputs WHERE requestId=?').get(input.requestId)!.hash,createHash('sha256').update(raw).digest('hex'));
  }
  assert.throws(()=>conversationInput({requestId:'both',text:'Body',quote,quotes,resourceReferences:refs}),/invalid_quote/);
  for(const bad of [{...quote,text:'forged'},{...quote,messageId:'missing'}]){
   assert.throws(()=>history.accept('thread',{requestId:'bad',text:'Body',quote:bad,resourceReferences:refs}),/quote_source_mismatch/);
   assert.equal(history.inputs('thread',['bad']).size,0);
  }
  assert.throws(()=>history.accept('other-thread',{requestId:'cross',text:'Body',quote,resourceReferences:refs}),/quote_source_mismatch/);
 }finally{db.close();}
});
test('queue mixed edits preserve both owners and retry identity, reject replacement and new assets, then remove resource group only',()=>{
 const f=historyFixture(0);
 try{
  const messageId=f.history.add('synthetic-history','Trusted source');
  const quote={messageId,text:'Trusted source'};
  f.inputs.accept({requestId:'mixed-edit',text:'Body',quote,resourceReferences:refs});
  let row=f.inputs.list()[0]!;
  const change={requestId:row.input.requestId,operationId:'edit',expectedRevision:row.revision,input:{...row.input,text:'Edited'}};
  const result=f.inputs.edit(change);assert.deepEqual(f.inputs.edit(change),result);
  row=f.inputs.list()[0]!;assert.deepEqual(row.input.quote,quote);assert.deepEqual(row.input.resourceReferences,refs);
  assert.throws(()=>f.inputs.edit({...change,operationId:'replace',expectedRevision:row.revision,input:{...row.input,resourceReferences:refs.slice(1)}}),/queue_quote_validation_required/);
  assert.throws(()=>f.inputs.edit({...change,operationId:'asset',expectedRevision:row.revision,input:{...row.input,attachments:[{assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1}]}}),/media_scope_denied/);
  assert.throws(()=>f.inputs.edit({...change,operationId:'stale'}),/queue_revision_conflict/);
  assert.throws(()=>f.inputs.edit({...change,input:{...change.input,text:'conflict'}}),/queue_operation_conflict/);
  const {resourceReferences:_removed,...plain}=row.input;
  f.inputs.edit({...change,operationId:'remove',expectedRevision:row.revision,input:plain});
  row=f.inputs.list()[0]!;assert.equal(row.input.resourceReferences,undefined);assert.deepEqual(row.input.quote,quote);
 }finally{f.close();}
});

// Exercise the actual service validator without starting an OS-locked Homer host.
// Files/media below are controlled boundary inputs; the parser, source checks,
// quote authenticity and transactional acceptance are production code.
test('mixed intake rejects any forged source atomically while keeping independent message, artifact and image checks',()=>{
 const f=historyFixture(0),thread='synthetic-history',requestId='mixed-trusted';
 const messageId=f.history.add(thread,'Trusted visible message');
 const quote={messageId,text:'visible message'};
 const asset={assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1};
 const text:ResourceReference={kind:'text',source:source('text'),annotations:[{id:'t',text:'Trusted excerpt',comment:'Text note'}]};
 const html:ResourceReference={kind:'web',source:{...source('html'),title:'Page.html'},annotations:[{id:'h',element:'h1',elementPath:'h1',comment:'HTML note',x:1,y:1}]};
 const image:ResourceReference={kind:'image',source:source('image'),image:asset,width:20,height:10,annotations:[{id:'i',region:{x:1,y:1,width:2,height:2},comment:'Image note'}]};
 let published=true,imageHash='a'.repeat(64),dimensions={width:20,height:10},fileReads=0;
 const owner={history:f.history,readAttachment:({messageId:id}:{messageId:string})=>{
  fileReads++;if(!published)throw Error('media_scope_denied');
  return {sha256:'a'.repeat(64),filename:id==='html'?'Page.html':'同名.txt',mime:id==='html'?'text/html':'text/plain',data:Buffer.from('Trusted excerpt').toString('base64')};
 },media:{asset:()=>({kind:'image',hash:imageHash,bindingId:'web:'+thread}),imageSize:()=>dimensions}};
 const validate=(Homer.prototype as unknown as {validateResourceReference:(thread:string,input:ConversationInput,reference:ResourceReference)=>void}).validateResourceReference;
 const inputs=new MainInputs(f.tasks,f.history,input=>{f.history.validateQuotes(thread,input);for(const ref of referencesOf(input))validate.call(owner,thread,input,ref);});
 const input:ConversationInput={requestId,text:'Body',quote,resourceReferences:[text,html,image],attachments:[asset]};
 const reject=(bad:ConversationInput,error:RegExp)=>{
  assert.throws(()=>inputs.accept(bad),error);
  assert.equal(f.history.inputs(thread,[bad.requestId]).size,0);assert.equal(inputs.list().length,0);
 };
 try{
  reject({...input,quote:{...quote,text:'forged'}},/quote_source_mismatch/);
  reject({...input,quote:{...quote,messageId:f.history.add('other-thread','visible message')}},/quote_source_mismatch/);
  for(const bad of [{...text,source:{...text.source,sha256:'b'.repeat(64)}},{...text,source:{...text.source,title:'wrong.txt'}},{...text,annotations:[{id:'x',text:'forged excerpt',comment:'note'}]}])reject({...input,resourceReferences:[bad as ResourceReference,html,image]},/preview_source_mismatch/);
  published=false;reject(input,/media_scope_denied/);published=true;
  dimensions={width:21,height:10};reject(input,/preview_source_mismatch/);dimensions={width:20,height:10};
  imageHash='b'.repeat(64);reject(input,/preview_source_mismatch/);imageHash='a'.repeat(64);
  reject({...input,attachments:[]},/preview_image_missing/);
  const before=fileReads;assert.equal(inputs.accept(input).fresh,true);assert.equal(fileReads-before,3,'each resource verified once');
  const row=inputs.list()[0]!;assert.deepEqual(row.input.quote,quote);assert.deepEqual(row.input.resourceReferences,input.resourceReferences);
  // No re-read of expired resources and no normalization on same-payload retry.
  published=false;const reads=fileReads;assert.equal(inputs.accept(input).fresh,false);assert.equal(fileReads,reads);
  const scope={requestId,expectedRevision:row.revision,operationId:'forged-edit'};
  assert.throws(()=>inputs.edit({...scope,input:{...input,quote:{...quote,text:'forged'}}}),/quote_source_mismatch/);
  assert.deepEqual(inputs.list()[0]!.input,row.input);
 }finally{f.close();}
});
