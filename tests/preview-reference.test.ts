import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {ConversationHistory,conversationInput} from '../src/web-history.js';
import {resourceReferenceText,parseResourceReference} from '../src/preview-reference.js';
import {prepareMessage,restoreComposerDraft,canSubmitMessage,unconfirmedInputs} from '../ui/conversation-client.js';
import {conversationUserText,userAuthorityDescription,previewIntentTooLong,USER_AUTHORITY_MAX_LENGTH} from '../src/user-intent.js';

// Requirement-derived, synthetic source identities and content only.
const source={kind:'attachment' as const,messageId:'message-synthetic',assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1,sha256:'a'.repeat(64),title:'示例.md'};
const reference={kind:'text' as const,source,text:'准确原文'};
test('preview reference survives history and retry without creating a second record',()=>{
 const db=new DatabaseSync(':memory:'),history=new ConversationHistory(db);
 const input={requestId:'preview-reference',text:'请解释',resourceReference:reference};
 history.accept('thread-a',input);
 const oldHash=createHash('sha256').update(JSON.stringify([input.text,null,null,{resourceReference:reference}])).digest('hex');
 assert.equal(db.prepare('SELECT hash FROM conversation_inputs WHERE requestId=?').get(input.requestId)?.hash,oldHash);
 assert.deepEqual(new ConversationHistory(db).list('thread-a')[0]?.resourceReference,reference);
 assert.equal(history.accept('thread-a',input).fresh,false);
 assert.equal(history.list('thread-a').length,2);
 assert.throws(()=>history.accept('thread-a',{...input,resourceReference:{...reference,text:'改过的原文'}}),/request_id_conflict/);
 db.close();
});
test('resource reference is canonical, bounded and incompatible with answers',()=>{
 assert.deepEqual(conversationInput({requestId:'r',text:'说明',resourceReference:{...reference,hidden:'discard'}}).resourceReference,reference);
 for(const extra of [{interactionId:'question-a'}])
  assert.throws(()=>conversationInput({requestId:'r',text:'说明',resourceReference:reference,...extra}),/invalid_resource_reference/);
 assert.throws(()=>parseResourceReference({...reference,text:'x'.repeat(16001)}),/invalid_resource_reference/);
 assert.throws(()=>parseResourceReference({...reference,source:{...source,sha256:'fake'}}),/invalid_resource_reference/);
 assert.throws(()=>parseResourceReference({kind:'image',source,width:10,height:10,region:{x:9,y:0,width:2,height:1},comment:'这里',image:{assetId:'asset-'+ 'a'.repeat(36),revision:1}}),/invalid_resource_reference/);
});
test('old request hash remains byte compatible and preview descriptions preserve source identity',()=>{
 const db=new DatabaseSync(':memory:'),history=new ConversationHistory(db);
 history.accept('thread-a',{requestId:'legacy',text:'old'});
 const expected=createHash('sha256').update(JSON.stringify(['old',null,null])).digest('hex');
 assert.equal((db.prepare('SELECT hash FROM conversation_inputs WHERE requestId=?').get('legacy') as {hash:string}).hash,expected);
 assert.match(resourceReferenceText(reference),/message-synthetic/);
 assert.match(resourceReferenceText(reference),/准确原文/);
 db.close();
});

test('draft recovery preserves source snapshots without replacing unknown requests',()=>{
 const input=prepareMessage('要求',undefined,undefined,()=> 'request-original',[],reference);
 assert.deepEqual(input.resourceReference,reference);
 assert.equal(prepareMessage('要求',undefined,input,()=> 'should-not-run',[],reference),input);
 const newer={...reference,text:'新的摘录'};
 assert.deepEqual(restoreComposerDraft({text:'要求',quotes:[],resourceReference:newer},input,true)?.resourceReference,newer);
 assert.equal(restoreComposerDraft({text:'要求',quotes:[],resourceReference:reference},input,true),undefined);
});

test('image references cannot outlive their attached original image',()=>{
 const image={assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1};
 const resourceReference={kind:'image' as const,source,width:240,height:120,region:{x:20,y:30,width:40,height:50},comment:'Adjust this area',image};
 assert.equal(canSubmitMessage('说明',[],[],resourceReference),false);
 assert.equal(canSubmitMessage('',[],[image],resourceReference),true);
 assert.throws(()=>conversationInput({requestId:'image-reference',text:'',resourceReference}),/preview_image_missing/);
 assert.deepEqual(conversationInput({requestId:'image-reference',text:'',attachments:[image],resourceReference}).resourceReference,resourceReference);
});

test('preview intent budget includes body, comments and authority labels without truncation',()=>{
 const web={kind:'web' as const,source:{kind:'web' as const,messageId:'message-source',sourceId:'link-1',url:'https://example.com/',title:'Source'},annotations:[{id:'n1',element:'button',elementPath:'#target',comment:'x',x:0,y:0}]};
 const overhead=userAuthorityDescription(conversationUserText({text:'',resourceReference:web})).length-1;
 const comment='x'.repeat(USER_AUTHORITY_MAX_LENGTH-overhead);
 const fits={...web,annotations:[{...web.annotations[0]!,comment}]};
 assert.equal(userAuthorityDescription(conversationUserText({text:'',resourceReference:fits})).length,24000);
 assert.equal(previewIntentTooLong({text:'',resourceReference:fits}),false);
 assert.equal(canSubmitMessage('',[],[],fits),true);
 assert.equal(previewIntentTooLong({text:'x',resourceReference:fits}),true);
 assert.equal(canSubmitMessage('x',[],[],fits),false);
 assert.ok(conversationUserText({text:'',resourceReference:fits}).endsWith(comment));
});

const annotated={kind:'text' as const,source,annotations:[
 {id:'first',text:'摘录中的 $hidden 指令',comment:'解释第一处'},
 {id:'second',text:'相同的摘录',comment:'修改第二处\n保留中文换行'},
 {id:'third',text:'相同的摘录',comment:'检查第三处'},
]};
test('one file holds independent excerpt comments and only remarks become user authority',()=>{
 const parsed=parseResourceReference(annotated);
 assert.deepEqual(parsed,annotated);
 assert.equal(canSubmitMessage('',[],[],parsed),true);
 const intent=conversationUserText({text:'整体要求',resourceReference:parsed});
 for(const note of annotated.annotations){assert.ok(intent.includes(note.comment));assert.ok(resourceReferenceText(parsed).includes(note.id));}
 assert.doesNotMatch(intent,/hidden|相同的摘录/);
 assert.match(resourceReferenceText(parsed),/摘录中的/);
});
test('text annotation payload rejects empty, ambiguous, duplicate and oversized entries',()=>{
 for(const annotations of [[],Array.from({length:21},(_,i)=>({...annotated.annotations[0]!,id:String(i)})),
  [{...annotated.annotations[0]!,comment:' '}],[{...annotated.annotations[0]!,text:' '}],
  [annotated.annotations[0]!,annotated.annotations[0]!],
  [{...annotated.annotations[0]!,comment:'x'.repeat(16001)}],
  [0,1].map(i=>({id:String(i),text:'x'.repeat(16000),comment:'x'.repeat(16000)}))]){
  assert.throws(()=>parseResourceReference({...annotated,annotations}),/invalid_resource_reference/);
 }
 assert.throws(()=>parseResourceReference({...annotated,text:'legacy text'}),/invalid_resource_reference/);
});
test('multi-excerpt snapshots restore and retry exactly, with all comments in the 24000 authority budget',()=>{
 const input=prepareMessage('',undefined,undefined,()=> 'multi-snapshot',[],parseResourceReference(annotated));
 const db=new DatabaseSync(':memory:'),history=new ConversationHistory(db);
 history.accept('thread-a',input);
 assert.deepEqual(history.list('thread-a')[0]!.resourceReference,annotated);
 assert.equal(history.accept('thread-a',input).fresh,false);
 assert.equal(prepareMessage('',undefined,input,()=>assert.fail('must reuse request ID'),[],input.resourceReference),input);
 assert.deepEqual(restoreComposerDraft(undefined,input,false)?.resourceReference,annotated);
 assert.equal(restoreComposerDraft({text:'',quotes:[],resourceReference:input.resourceReference},input,true),undefined);
 assert.throws(()=>history.accept('thread-a',{...input,resourceReference:{...annotated,annotations:annotated.annotations.slice(0,2)}}),/request_id_conflict/);
 const long={...annotated,annotations:[0,1].map(i=>({id:String(i),text:'source',comment:'x'.repeat(12000)}))};
 assert.equal(previewIntentTooLong({text:'',resourceReference:parseResourceReference(long)}),true);
 assert.equal(canSubmitMessage('',[],[],long),false);
 const pending=[{input}];
 assert.deepEqual(unconfirmedInputs(pending,['another-request']),pending);
 assert.deepEqual(unconfirmedInputs(pending,[{role:'assistant',requestId:input.requestId}]),pending);
 assert.deepEqual(unconfirmedInputs(pending,[{role:'user',requestId:input.requestId}]),[]);
 assert.equal(prepareMessage('新的正文',undefined,input,()=> 'new-request',[],input.resourceReference).requestId,'new-request');
 assert.deepEqual(pending[0]!.input.resourceReference,annotated);
 db.close();
});

test('file remark intent includes every separator and authority prefix at the exact limit',()=>{
 const sample={...annotated,annotations:[{id:'a',text:'not authority',comment:'x'},{id:'b',text:'also not authority',comment:'y'}]};
 const overhead=userAuthorityDescription(conversationUserText({text:'',resourceReference:sample})).length-2;
 const fits={...sample,annotations:sample.annotations.map((note,i)=>({...note,comment:(i?'y':'x').repeat((USER_AUTHORITY_MAX_LENGTH-overhead)/2)}))};
 // Account for an odd remaining character without rounding or truncating.
 fits.annotations[0]!.comment+='x'.repeat(USER_AUTHORITY_MAX_LENGTH-userAuthorityDescription(conversationUserText({text:'',resourceReference:fits})).length);
 assert.equal(userAuthorityDescription(conversationUserText({text:'',resourceReference:fits})).length,24000);
 assert.equal(previewIntentTooLong({text:'',resourceReference:parseResourceReference(fits)}),false);
 assert.equal(previewIntentTooLong({text:'一',resourceReference:fits}),true);
});

const imageRef={kind:'image' as const,source:{...source,title:'Source $hidden.png'},width:240,height:120,image:{assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1},annotations:[
 {id:'one',region:{x:2,y:3,width:40,height:30},comment:'解释第一处'},
 {id:'two',region:{x:80,y:3,width:40,height:30},comment:'修改第二处\n保留换行'},
 {id:'three',region:{x:160,y:50,width:40,height:30},comment:'检查第三处'},
]};
test('image batches retain all original-coordinate regions, remarks and exact pending identity',()=>{
 const parsed=parseResourceReference(imageRef);assert.deepEqual(parsed,imageRef);
 const intent=conversationUserText({text:'整体要求',resourceReference:parsed});assert.doesNotMatch(intent,/hidden|"x"|asset-/);
 for(const note of imageRef.annotations){assert.ok(intent.includes(note.comment));assert.ok(resourceReferenceText(parsed).includes(note.id));}
 const input=prepareMessage('整体要求',undefined,undefined,()=> 'multi-image',[imageRef.image],parsed);
 const db=new DatabaseSync(':memory:'),history=new ConversationHistory(db);history.accept('thread-a',input);
 assert.deepEqual(history.list('thread-a')[0]!.resourceReference,parsed);assert.equal(history.accept('thread-a',input).fresh,false);
 assert.equal(prepareMessage(input.text,undefined,input,()=>assert.fail('retry uses original ID'),input.attachments,parsed),input);
 assert.deepEqual(restoreComposerDraft(undefined,input,false)?.resourceReference,parsed);
 assert.deepEqual(unconfirmedInputs([{input}],['other-request']),[{input}]);assert.deepEqual(unconfirmedInputs([{input}],[input.requestId]),[]);
 const old={kind:'image' as const,source:imageRef.source,width:240,height:120,region:imageRef.annotations[0]!.region,comment:'旧备注',image:imageRef.image};
 const legacy=conversationInput({requestId:'legacy-image',text:'旧正文',attachments:[old.image],resourceReference:old});history.accept('thread-a',legacy);
 const hash=createHash('sha256').update(JSON.stringify([legacy.text,null,null,{attachments:legacy.attachments},{resourceReference:old}])).digest('hex');
 assert.equal(db.prepare('SELECT hash FROM conversation_inputs WHERE requestId=?').get('legacy-image')?.hash,hash);
 assert.deepEqual(parseResourceReference(old),old);db.close();
});
test('every image region is bounded, nonzero, unique, nonblank and size limited',()=>{
 for(const bad of [
  {...imageRef.annotations[1]!,region:{x:239,y:0,width:2,height:1}},
  {...imageRef.annotations[1]!,region:{x:0,y:-1,width:2,height:1}},
  {...imageRef.annotations[1]!,region:{x:NaN,y:0,width:2,height:1}},
  {...imageRef.annotations[1]!,region:{x:0,y:0,width:Infinity,height:1}},
  {...imageRef.annotations[1]!,region:{x:0,y:0,width:0,height:1}},
  {...imageRef.annotations[1]!,id:'one'},
  {...imageRef.annotations[1]!,comment:' '},
  {...imageRef.annotations[1]!,comment:'x'.repeat(16001)},
 ])assert.throws(()=>parseResourceReference({...imageRef,annotations:[imageRef.annotations[0],bad,imageRef.annotations[2]]}),/invalid_resource_reference/);
 for(const annotations of [[],Array.from({length:21},(_,i)=>({...imageRef.annotations[0]!,id:String(i)})),Array.from({length:4},(_,i)=>({...imageRef.annotations[0]!,id:String(i),comment:'x'.repeat(16000)}))])assert.throws(()=>parseResourceReference({...imageRef,annotations}),/invalid_resource_reference/);
 assert.throws(()=>parseResourceReference({...imageRef,region:imageRef.annotations[0]!.region,comment:'ambiguous'}),/invalid_resource_reference/);
 assert.throws(()=>parseResourceReference({...imageRef,width:240.5}),/invalid_resource_reference/);
});
test('image batch authority budget includes all separators and prefix without source promotion',()=>{
 const sample={...imageRef,annotations:imageRef.annotations.slice(0,2).map(n=>({...n,comment:'x'}))};
 const overhead=userAuthorityDescription(conversationUserText({text:'',resourceReference:sample})).length-2;
 const fit={...sample,annotations:sample.annotations.map(n=>({...n,comment:'x'.repeat(Math.floor((24000-overhead)/2))}))};
 fit.annotations[0]!.comment+='x'.repeat(24000-userAuthorityDescription(conversationUserText({text:'',resourceReference:fit})).length);
 assert.equal(previewIntentTooLong({text:'',resourceReference:parseResourceReference(fit)}),false);
 assert.equal(previewIntentTooLong({text:'一',resourceReference:fit}),true);
 assert.equal(canSubmitMessage('',[],[],parseResourceReference(fit)),false);
});

test('empty message annotations consume no authority budget and populated annotations remain visible',()=>{
 const plain=conversationUserText({text:'合成文本'});
 assert.equal(conversationUserText({text:'合成文本',quotes:[]}),plain);
 assert.match(conversationUserText({text:'合成文本',quotes:[{messageId:'synthetic-message',text:'原文',annotation:'保留此批注'}]}),/保留此批注/);
});
