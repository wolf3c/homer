import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHomerAttachmentAdapter, type HomerAttachment} from '../ui/homer-attachment-adapter.js';

const asset={assetId:'confirmed',revision:3,filename:'合成.txt',size:3,mime:'text/plain',kind:'file',state:'ready',error:null} as const;
function setup(){
 let attachments:HomerAttachment[]=[],fail=false,enabled=true;
 const calls:{path:string;request?:RequestInit}[]=[],notices:string[]=[];
 const owner=createHomerAttachmentAdapter(()=>({threadId:'synthetic',requestId:'draft-original',enabled,attachments,notice:text=>notices.push(text)}),async(path,request)=>{
  calls.push({path:String(path),request});
  return new Response(JSON.stringify(fail?{error:'synthetic_unknown'}:path==='/api/uploads'?asset:{ok:true}),{status:fail?503:200});
 });
 async function add(file:File){for await(const value of owner.add({file})){const old=attachments.findIndex(a=>a.id===value.id);if(old<0)attachments.push(value);else attachments[old]=value;}return attachments.at(-1)!;}
 return {owner,calls,notices,add,get attachments(){return attachments;},fail(value:boolean){fail=value;},enable(value:boolean){enabled=value;}};
}
test('confirmed refresh restoration preserves asset/revision and request without uploading; explicit removal still discards',async()=>{
 const s=setup(),restored=await s.add(s.owner.restore(asset));
 assert.equal(s.calls.length,0);assert.deepEqual(restored.homer.asset,asset);assert.equal(restored.homer.requestId,'draft-original');
 await s.owner.remove(restored);assert.equal(s.calls.length,1);assert.deepEqual(JSON.parse(String(s.calls[0]!.request?.body)),{threadId:'synthetic',requestId:'draft-original',assetId:'confirmed',revision:3});
});
test('unknown upload retries the same upload identity and send does not upload again',async()=>{
 const s=setup(),file=new File(['abc'],'合成.txt',{type:'text/plain'});s.fail(true);
 const unknown=await s.add(file);assert.equal(unknown.status.type,'incomplete');s.fail(false);
 const ready=await s.add(file);assert.equal(ready.id,unknown.id);assert.equal(s.attachments.length,1);
 assert.equal(new Headers(s.calls[0]!.request?.headers).get('X-Homer-Upload'),new Headers(s.calls[1]!.request?.headers).get('X-Homer-Upload'));
 await s.owner.send(ready);assert.equal(s.calls.length,2);
});
test('removal failure rejects without losing identity; submitted cleanup never discards handed-off files',async()=>{
 const s=setup(),ready=await s.add(s.owner.restore(asset));s.fail(true);
 await assert.rejects(s.owner.remove(ready));assert.equal(s.attachments[0],ready);assert.ok(s.notices.some(n=>n.includes('移除未确认')));
 const decorated:HomerAttachment={...ready,homer:{...ready.homer}};
 s.owner.markSubmitted([ready]);await s.owner.remove(decorated);assert.equal(s.calls.length,1);
});
test('unknown removal addresses the original uploadId without manufacturing an asset reference',async()=>{
 const s=setup();s.fail(true);const unknown=await s.add(new File(['abc'],'合成.txt'));s.fail(false);
 await s.owner.remove(unknown);
 assert.deepEqual(JSON.parse(String(s.calls[1]!.request?.body)),{threadId:'synthetic',requestId:'draft-original',uploadId:unknown.id});
 assert.equal(unknown.status.type,'incomplete');assert.equal(unknown.homer.asset,undefined);
});
test('retry binds a decorated File back to original upload identity and reports confirmation without a composer snapshot',async()=>{
 const s=setup(),original=new File(['abc'],'合成.txt');s.fail(true);const unknown=await s.add(original);
 const decorated={...unknown,file:new File(['abc'],'合成.txt')};const retry=s.owner.retryFile(decorated);
 assert.equal(s.owner.uploadId(retry),unknown.id);assert.equal(s.owner.confirmed(retry),false);
 s.fail(false);const ready=await s.add(retry);
 assert.equal(ready.id,unknown.id);assert.equal(s.owner.confirmed(retry),true);
 assert.equal(new Headers(s.calls[0]!.request?.headers).get('X-Homer-Upload'),new Headers(s.calls[1]!.request?.headers).get('X-Homer-Upload'));
 assert.equal(unknown.status.type,'incomplete'); // A retained old runtime snapshot stays stale.
});

test('reusing the same preview File in the next message creates a fresh upload identity',async()=>{
 let requestId='preview-first';const calls:RequestInit[]=[];
 const owner=createHomerAttachmentAdapter(()=>({threadId:'synthetic',requestId,enabled:true,attachments:[],notice(){}}),async(_path:unknown,init?:RequestInit)=>{calls.push(init!);return new Response(JSON.stringify(asset));});
 const file=new File(['abc'],'Synthetic.png',{type:'image/png'});
 for await(const _item of owner.add({file})){}
 const first=owner.uploadId(file);assert.deepEqual(owner.asset(file),asset);
 requestId='preview-next';assert.equal(owner.asset(file),undefined);
 for await(const _item of owner.add({file})){}
 assert.notEqual(owner.uploadId(file),first);assert.equal(calls.length,2);
 assert.equal(new Headers(calls[1]!.headers).get('X-Homer-Request'),'preview-next');
});

test('removing then readding a preview image uploads it with a fresh identity',async()=>{
 const s=setup(),file=new File(['abc'],'Synthetic.png',{type:'image/png'});
 const first=await s.add(file);
 await s.owner.remove(first);
 assert.equal(s.owner.confirmed(file),false);
 const second=await s.add(file);
 assert.notEqual(second.id,first.id);
 assert.deepEqual(s.calls.map(call=>call.path),['/api/uploads','/api/uploads/discard','/api/uploads']);
});

test('failed removal retains the confirmed upload for retry',async()=>{
 const s=setup(),file=new File(['abc'],'Synthetic.png',{type:'image/png'});
 const first=await s.add(file);s.fail(true);
 await assert.rejects(s.owner.remove(first));
 assert.equal(s.owner.confirmed(file),true);
 assert.equal(s.owner.uploadId(file),first.id);
});

test('a late discard receipt does not invalidate a newer draft upload',async()=>{
 let requestId='first',confirmDiscard!:(response:Response)=>void;
 const owner=createHomerAttachmentAdapter(()=>({threadId:'synthetic',requestId,enabled:true,attachments:[],notice(){}}),async path=>
  path==='/api/uploads/discard'?new Promise<Response>(resolve=>{confirmDiscard=resolve;}):new Response(JSON.stringify(asset)));
 const file=new File(['abc'],'Synthetic.png',{type:'image/png'});
 let first!:HomerAttachment;
 for await(const item of owner.add({file}))first=item;
 const removing=owner.remove(first);
 requestId='next';
 for await(const _item of owner.add({file})){}
 const nextId=owner.uploadId(file);
 confirmDiscard(new Response(JSON.stringify({ok:true})));await removing;
 assert.equal(owner.uploadId(file),nextId);assert.equal(owner.confirmed(file),true);
});

test('a picked file deferred during reconnection survives locally until explicit same-identity retry',async()=>{
 const s=setup(),file=new File(['abc'],'合成.txt');s.enable(false);s.owner.defer(file);
 const paused=await s.add(file);
 assert.deepEqual(paused.status,{type:'incomplete',reason:'upload-paused'});
 assert.equal(s.calls.length,0);assert.equal(s.owner.confirmed(file),false);
 s.enable(true);assert.equal(s.calls.length,0);
 const ready=await s.add(s.owner.retryFile(paused));
 assert.equal(ready.id,paused.id);assert.equal(s.attachments.length,1);assert.equal(s.calls.length,1);assert.equal(s.owner.confirmed(file),true);
});
test('removing a locally deferred file never sends discard for an upload that did not start',async()=>{
 const s=setup(),file=new File(['abc'],'合成.txt');s.enable(false);s.owner.defer(file);
 const paused=await s.add(file);await s.owner.remove(paused);assert.equal(s.calls.length,0);
});
test('deferred uploads still reject empty and over-limit files and accept inclusive size boundaries',async()=>{
 for(const [bytes,valid] of [[0,false],[1,true],[8388608,true],[8388609,false]] as const){
  const s=setup(),file=new File([new Uint8Array(bytes)],'boundary.bin');s.enable(false);s.owner.defer(file);
  if(valid){const paused=await s.add(file);assert.equal(paused.status.type,'incomplete');}
  else await assert.rejects(s.add(file),/upload_invalid_file/);
  assert.equal(s.calls.length,0);
 }
});
