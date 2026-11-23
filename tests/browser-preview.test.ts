import {openTaskWorker} from './fixtures/open-task-worker.js';
import assert from'node:assert/strict';
import test from'node:test';
import{writeFileSync,mkdirSync,symlinkSync}from'node:fs';
import{join,dirname,resolve}from'node:path';
import{CodexEngine}from'../src/engine.js';
import{fixture as webFixture}from'./web-service-fixture.js';
import{htmlAttachmentFixture}from'./canvas-html-publication-fixture.js';
import{fixture,until}from'./fixtures/worker-chat-host.js';
import{mcpCall}from'./fixtures/host-mcp-call.js';
import{parseResourceReference,referenceKey,resourceReferenceText}from'../src/preview-reference.js';
import{hostMcpTools}from'../src/worker-interaction-mcp.js';
async function call(peer:any,name:string,args:unknown,id:string){
 const role=peer.options.role==='worker'?'worker':'main',argv=peer.options.interactionMcp.args,path=argv[argv.indexOf(role)-1];
 peer.emit('hostMcpToolStarted',{threadId:peer.threadId,turnId:peer.turnId,itemId:id,tool:name,arguments:args});
 return mcpCall(path,name,args,{callId:id,'x-codex-turn-metadata':{turn_id:peer.turnId}});
}
const note={id:'note',element:'Submit',elementPath:'#submit',comment:'检查提交后的结果',x:4,y:8};
test('browser captures keep original provenance and distinct navigated-page groups',()=>{
 const source={kind:'web' as const,messageId:'m',sourceId:'link-1',url:'https://example.com/',title:'Original'};
 const page={id:'page-00000000-0000-4000-8000-000000000000',url:'https://example.com/next',title:'Next'};
 const current=parseResourceReference({kind:'web',source,page,annotations:[note]});
 assert.equal(current.source.kind,'web');assert.match(resourceReferenceText(current),/Original/);assert.match(resourceReferenceText(current),/Next/);
 assert.notEqual(referenceKey(current),referenceKey({kind:'web',source}));
 assert.equal(referenceKey({...current,page:{...page,url:source.url}}),referenceKey({kind:'web',source}));
 assert.throws(()=>parseResourceReference({...current,page:{...page,url:'file:///etc/passwd'}}),/invalid_resource_reference/);
});
test('preview tools are only advertised with an attached desktop transport',()=>{
 assert(!hostMcpTools('main').some(t=>t.name==='preview_open'));
 for(const role of ['main','worker']as const)assert(hostMcpTools(role,false,false,false,true).some(t=>t.name==='preview_act'));
});
test('Main preview calls authenticate native identity, bind source and never replay a call ID',async()=>{
 const f=fixture(),requests:any[]=[];
 f.app.bindBrowserPreview(async(owner,action,input)=>{requests.push({owner,action,input});return{pageId:'synthetic-page',document:1};});
 try{
  f.setScript(async main=>{
   assert(main.options.interactionMcp!.args.includes('browser-preview'));
   const args={url:'https://example.com/report'};
   assert.equal((await call(main,'preview_open',args,'open')).error,undefined);
   assert.equal((await call(main,'preview_open',args,'open')).error,'host_call_already_dispatched');
   assert.equal((await call(main,'preview_open',{url:'file:///etc/passwd'},'invalid-url')).error,'preview_url_invalid');
   assert.equal((await call(main,'preview_act',{pageId:'p',document:1,action:'fill',selector:'aria-ref=e1'},'missing-value')).error,'preview_value_required');
   return{status:'completed',text:'Done'};
  });
  await f.app.start();await f.app.message('Work on the report','browser-source');
  assert.equal(requests.length,1);const req=requests[0];
  assert.equal(req.owner.threadId,f.app.store.meta('mainThread'));assert.match(req.owner.owner,/^main:/);
  assert.equal(req.input.source.requestId,'browser-source');assert.equal(req.input.source.url,'https://example.com/report');
 }finally{await f.close();}
});
test('two Worker MCP endpoints retain distinct page owners on one conversation',async()=>{
 const f=fixture(),requests:any[]=[];
 f.app.bindBrowserPreview(async(owner,action,input)=>{requests.push({owner,action,input});return{id:'page-'+requests.length,document:1};});
 try{
  f.setScript(async(main,text)=>{if(text==='Delegate browser work'){await openTaskWorker(main,'Read one page');await openTaskWorker(main,'Read another page');}return{status:'completed',text:'Delegated'};});
  await f.app.start();await f.app.message('Delegate browser work','worker-browser-source');
  await until(()=>f.engines.filter(e=>e.options.role==='worker'&&e.finish).length===2);
  const workers=f.engines.filter(e=>e.options.role==='worker');
  const responses=await Promise.all(workers.map((w,i)=>call(w,'preview_open',{url:'https://example.com/'+i},'open-worker-'+i)));
  assert(responses.every(r=>!r.error));assert.equal(requests.length,2);
  assert.notEqual(requests[0].owner.owner,requests[1].owner.owner);assert.equal(requests[0].owner.threadId,requests[1].owner.threadId);
  assert(requests.every(r=>r.input.source.requestId==='worker-browser-source'));
 }finally{await f.close();}
});
test('UI opens and sent references validate real message/request provenance without replacing original links',async()=>{
 const f=fixture();f.app.bindBrowserPreview(async(owner,action,input)=>({owner,action,input}));
 try{
  await f.app.start();await f.app.message('Synthetic source','known-request');
  const threadId=f.app.store.meta('mainThread')!,message=f.app.history.list(threadId).find(m=>m.role==='user')!;
  const source={kind:'browser' as const,messageId:message.id,url:'https://example.com/',title:'Selected link'};
  assert((await f.app.openBrowserPreview({threadId,source}))as object);
  await assert.rejects(f.app.openBrowserPreview({threadId:'other-thread',source}),/preview_unavailable/);
  await assert.rejects(f.app.openBrowserPreview({threadId,source:{...source,messageId:'forged-message'}}),/preview_source_mismatch/);
  await f.app.submitMessage({requestId:'annotated-source',text:'请按备注修改',resourceReference:{kind:'web',source,annotations:[note],page:{id:'page-00000000-0000-4000-8000-000000000000',url:'https://example.com/next',title:'Navigated'}}});
  await until(()=>f.inputs.some(text=>text.includes('Navigated')));
  assert(f.inputs.some(text=>text.includes('用户批注：检查提交后的结果')));
  await assert.rejects(async()=>f.app.submitMessage({requestId:'bad-reference',text:'x',resourceReference:{kind:'web',source:{kind:'browser',requestId:'missing-request',url:source.url,title:source.title},annotations:[note]}}),/preview_source_mismatch/);
 }finally{await f.close();}
});

test('a native final can open its visible web link, while process-only and forged links stay out',async()=>{
 const f=fixture();f.app.bindBrowserPreview(async()=>({opened:true}));
 try{
  const url='https://example.com/final',internal='https://example.com/internal';
  f.setScript(async main=>{
   const final={itemId:'web-final',phase:'final_answer' as const,text:`[Report](${url})`};
   for(const message of [{itemId:'hidden',phase:'commentary',text:`[Internal](${internal})`},final])
    main.emit('agentMessage',{threadId:main.threadId,turnId:main.turnId,...message,completed:true});
   return {status:'completed',text:final.text,messages:[final]};
  });
  await f.app.start();await f.app.message('Link to the report','native-link');
  const threadId=f.app.store.meta('mainThread')!,node=f.app.processes.list(threadId).find(item=>item.sourceKind==='user')!;
  const source={kind:'browser',messageId:node.messageId,url,title:'Report'};
  assert.deepEqual(await f.app.openBrowserPreview({threadId,source}),{opened:true});
  for(const unlisted of [internal,'https://example.com/forged'])
   await assert.rejects(f.app.openBrowserPreview({threadId,source:{...source,url:unlisted}}),/preview_source_mismatch/);
  f.app.history.record('legacy-web-source',threadId,`[Report](${url})`);
  const legacy={kind:'web',messageId:'legacy-web-source',sourceId:'link-1',url,title:'Report'};
  assert.deepEqual(await f.app.openBrowserPreview({threadId,source:legacy}),{opened:true});
  f.app.history.revokeMessage(threadId,legacy.messageId);
  await assert.rejects(f.app.openBrowserPreview({threadId,source:legacy}),/preview_source_mismatch/);
 }finally{await f.close();}
});

test('executable HTML reads only its own asset directory and preserves canonical-path checks',()=>{
 const f=htmlAttachmentFixture();try{
  const ref=f.send(),folder=dirname(f.original);mkdirSync(join(folder,'assets'));writeFileSync(join(folder,'assets/style.css'),'body{color:red}');writeFileSync(join(folder,'app.js'),'document.title="Loaded"');writeFileSync(join(folder,'data.txt'),'private text');writeFileSync(join(f.dir,'outside.js'),'outside');
  assert.equal(f.app.readAttachment({...ref,resource:'assets/style.css'}).mime,'text/css');assert.equal(f.app.readAttachment({...ref,resource:'app.js'}).mime,'application/javascript');
  assert.throws(()=>f.app.readAttachment({...ref,resource:'../outside.js'}),/artifact_path_denied/);assert.throws(()=>f.app.readAttachment({...ref,resource:'data.txt'}),/media_preview_unavailable/);
  symlinkSync(join(f.dir,'outside.js'),join(folder,'linked.js'));assert.throws(()=>f.app.readAttachment({...ref,resource:'linked.js'}),/artifact_path_denied/);
 }finally{f.close();}
});

test('queued revocation preserves the note and independent image in the actual turn/start payload',async()=>{
 const f=webFixture(),threadId='synthetic-main',requestId='queued-annotation';
 const wire=new CodexEngine({...f.app.config,codexBin:resolve('tests/fixtures/mock-app-server.mjs'),model:'image-input-check'},
  {cwd:f.app.config.workspace,readRoots:[],instructions:'Synthetic Preview dispatch',tools:[]},async()=>({}));
 const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=';
 try{
  await Promise.all([wire.start(),f.app.start()]);
  const [source]=await f.attach('preview-source',[{filename:'source.png',content:Buffer.from(data,'base64')}]);
  const upload=async(filename:string)=>{
   const {assetId,revision}=await f.app.uploadAttachment({threadId,requestId,uploadId:filename.replace('.', '-'),filename,data});
   return {assetId,revision};
  };
  const image=await upload('reference.png'),independent=await upload('independent.png');
  const engine=f.engines.find(candidate=>!candidate.worker)!;
  const hold=f.app.message('stream','hold-queue');
  await until(()=>!!engine.pending);
  f.app.submitMessage({requestId,text:'Apply the note',attachments:[image,independent],resourceReference:{
   kind:'image',source:source!,image,width:1,height:1,region:{x:0,y:0,width:1,height:1},comment:'Keep this user instruction',
  }});
  assert.equal(f.app.history.revokeMessage(threadId,source!.messageId),true);
  engine.pending!({status:'completed',text:'Held request complete'});
  await hold;await f.app.idle();
  const sent=f.inputs.at(-1)!;
  const images=f.nativeImages.at(-1)!;
  assert.equal(images.length,1);
  const actual=JSON.parse((await wire.turn(sent,{images})).text);
  assert.equal(actual[0].type,'text');
  assert.match(actual[0].text,/Keep this user instruction/);
  assert.match(actual[0].text,/来源不可用/);
  assert.doesNotMatch(actual[0].text,new RegExp(image.assetId+'|source\\.png'));
  assert.match(actual[0].text,new RegExp(independent.assetId));
  assert.ok('path' in images[0]!);
  assert.deepEqual(actual.slice(1),[{type:'localImage',path:images[0]!.path}]);
  const accepted=f.app.history.list(threadId).find(message=>message.role==='user'&&message.requestId===requestId);
  assert.deepEqual(accepted?.attachments,[image,independent]);
 }finally{await Promise.all([f.app.close(),wire.close()]);}
});
