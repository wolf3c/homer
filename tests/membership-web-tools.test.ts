import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EventEmitter,once} from 'node:events';
import {constants,copyFileSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {dirname,join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import type {Config} from '../src/config.js';
import type {EngineOptions,ToolCall,TurnResult} from '../src/engine.js';
import {Homer} from '../src/service.js';
import {MAIN_TOOLS} from '../src/tools.js';
import {RECURSIVE_TOOLS} from '../src/recursive-tools.js';
import type {AttachmentRef} from '../src/media-store.js';

async function withMcp<T>(options:EngineOptions,work:(rpc:(method:string,params?:unknown)=>Promise<any>)=>Promise<T>){
  const {command,args,cwd}=options.interactionMcp!;
  const child=spawn(command,args,{cwd,stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH}});
  const closed=once(child,'close');
  const lines=createInterface({input:child.stdout});
  let id=0;
  try{return await work(async(method,params)=>{
    const response=once(lines,'line',{signal:AbortSignal.timeout(5000)});
    child.stdin.write(JSON.stringify({id:++id,jsonrpc:'2.0',method,params})+'\n');
    const [line]=await response;
    const reply=JSON.parse(line);assert.equal(reply.id,id);assert.equal(reply.error,undefined);
    return reply.result;
  });}finally{child.stdin.end();child.kill();await closed;}
}

function syntheticDesktop(t:TestContext,root:string){
  const bundleRoot=join(root,'Synthetic.app');
  const executable=process.platform==='win32'?'resources/node.exe':'Contents/MacOS/node';
  const decoder=process.platform==='win32'?'resources/homer-image-decoder.mjs':'Contents/MacOS/homer-image-decoder';
  const resources=join(bundleRoot,process.platform==='win32'?'resources':'Contents/Resources');
  const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
  mkdirSync(join(bundleRoot,executable,'..'),{recursive:true});mkdirSync(resources,{recursive:true});
  copyFileSync(process.execPath,join(bundleRoot,executable),constants.COPYFILE_FICLONE);
  writeFileSync(join(bundleRoot,decoder),'synthetic decoder; never executed');
  if(process.platform==='win32')writeFileSync(join(bundleRoot,'Homer.exe'),'synthetic application');
  const file=(path:string)=>({path,sha256:hash(readFileSync(join(bundleRoot,path)))});
  const manifest=JSON.stringify({format:2,node:'22.22.0',codex:'0.163.0',
    codeFiles:(process.platform==='win32'?['Homer.exe']:[decoder,executable]).map(file),
    ...(process.platform==='win32'?{files:[file(executable),file(decoder)].map(f=>({...f,path:f.path.replace('resources/','')}))}:{})});
  writeFileSync(join(resources,'desktop-manifest.json'),manifest);
  const oldExecPath=process.execPath;
  Object.defineProperty(process,'execPath',{value:join(bundleRoot,executable)});
  t.after(()=>Object.defineProperty(process,'execPath',{value:oldExecPath}));
  return {bundleRoot,manifestSha256:hash(manifest)};
}

test('an existing main thread and its Worker use the same membership Token through the host MCP',async t=>{
  const token='sk-synthetic-membership-only';
  const query='"Example" site:example.invalid lang:en after:2026-01-01';
  const date='2026-05-02T12:34:56+00:00';
  const missingUrl='https://example.invalid/missing-page';
  const privateResult={title:'Private result',url:'http://127.0.0.1/private'};
  const requests:{path:string|undefined;method:string|undefined;auth:string|undefined;body:unknown}[]=[];
  const gateway=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString());
    requests.push({path:req.url,method:req.method,auth:req.headers.authorization,body});
    if(body.query==='denied'){res.writeHead(403);res.end(JSON.stringify({error:{code:'pre_consume_token_quota_failed',message:token}}));return;}
    if(body.query==='redirect'){res.writeHead(307,{location:'/unexpected'});res.end();return;}
    if(body.query==='lost'){req.socket.destroy();return;}
    if(body.query==='oversized'){res.end(JSON.stringify({results:[],padding:'x'.repeat(512*1024)}));return;}
    if(body.query==='empty'){res.end(JSON.stringify({results:[]}));return;}
    if(body.query==='filtered'){res.end(JSON.stringify({results:[privateResult]}));return;}
    if(body.url===missingUrl){res.writeHead(404).end('Synthetic gateway 404');return;}
    if(req.url==='/v1/tools/search')res.end(JSON.stringify({results:[
      privateResult,
      {title:'Example',url:'https://example.invalid/article',summary:'A source',date,extra:token},
      {title:'Unknown date',url:'https://example.invalid/unknown',summary:'Another source',date:null},
      {title:'Missing date',url:'https://example.invalid/missing',summary:'A third source'},
    ]}));
    else res.end(JSON.stringify({title:'Example',content:'# Article\n'+('x'.repeat(80_000)),extra:token}));
  });
  await new Promise<void>(resolve=>gateway.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise<void>(resolve=>gateway.close(()=>resolve())));
  const baseUrl=`http://127.0.0.1:${(gateway.address() as AddressInfo).port}/v1`;
  const role={baseUrl,model:'synthetic',effort:null,fast:false as const,context:{contextWindow:32768,autoCompactTokenLimit:29000,autoCompactTokenLimitScope:'total' as const}};
  const parent=resolve('.codex/scratch');mkdirSync(parent,{recursive:true});
  const root=mkdtempSync(join(parent,'membership-web-'));
  const config:Config={appData:root,workspace:join(root,'work'),runtime:join(root,'runtime'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100,
    desktopModelSource:'website',dailyDeepSeek:true,pauseOldDesktopWork:true,desktopResources:{bundleRoot:root,manifestSha256:'0'.repeat(64)},desktopConnection:{main:role,worker:role}};
  mkdirSync(config.runtime);
  const oldToken=process.env.HOMER_DEEPSEEK_TOKEN;
  process.env.HOMER_DEEPSEEK_TOKEN=token;
  t.after(()=>{if(oldToken===undefined)delete process.env.HOMER_DEEPSEEK_TOKEN;else process.env.HOMER_DEEPSEEK_TOKEN=oldToken;});
  const oldThread='synthetic-original-thread';
  const oldHash=createHash('sha256').update(JSON.stringify([...MAIN_TOOLS,...RECURSIVE_TOOLS])).digest('hex');
  const engineErrors:unknown[]=[];let mainOptions!:EngineOptions,workerChecked=false;
  class Engine extends EventEmitter{
    threadId:string;turnId?:string;
    constructor(readonly options:EngineOptions,readonly tool:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-worker';}
    async start(){return this.threadId;}
    async close(){return true;}
    async interrupt(){return true;}
    async turn(text:string,opts?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
      this.turnId=this.threadId+'-turn';opts?.onStarted?.(this.turnId);
      if(text.startsWith('[内部协作输入'))return {status:'completed',text:''};
      const worker=this.options.role==='worker';
      try{
        await withMcp(this.options,async rpc=>{
          const tools=(await rpc('tools/list')).tools as {name:string;description:string}[];
          const names=tools.map(tool=>tool.name);
          assert.deepEqual(names.filter(name=>['web_search','web_fetch','generate_image','generate_video'].includes(name)),['web_search','web_fetch','generate_image','generate_video']);
          const description=tools.find(tool=>tool.name==='web_search')!.description;
          for(const syntax of ['site:','-site:','lang:','after:','before:','double quotes'])assert.ok(description.includes(syntax),`Search description omits ${syntax}`);
          const call=(name:string,args:unknown)=>rpc('tools/call',{name,arguments:args});
          if(worker){
            const reply=await call('web_fetch',{url:'https://example.invalid/article'});
            assert.equal(reply.isError,false);const page=JSON.parse(reply.content[0].text);
            assert.ok(page.content.startsWith('# Article')&&page.content.length<=24_000&&page.truncated);
            assert.doesNotMatch(JSON.stringify(page),/synthetic-membership-only/);
            const missing=await call('web_fetch',{url:missingUrl});
            assert.equal(missing.isError,true);
            assert.equal(missing.content[0].text,'membership_web_fetch_unavailable');
            assert.match(missing.content[1].text,/未能取得网页正文.*搜索摘要.*其他来源/);
            assert.doesNotMatch(JSON.stringify(missing),/Synthetic gateway 404/);
            workerChecked=true;
          }else{
            const reply=await call('web_search',{query:` ${query} `});
            assert.equal(reply.isError,false);
            assert.deepEqual(JSON.parse(reply.content[0].text),{results:[
              {title:'Example',url:'https://example.invalid/article',summary:'A source',date},
              {title:'Unknown date',url:'https://example.invalid/unknown',summary:'Another source'},
              {title:'Missing date',url:'https://example.invalid/missing',summary:'A third source'},
            ]});
            assert.deepEqual(JSON.parse((await call('web_search',{query:'empty'})).content[0].text),{results:[]});
            const filtered=await call('web_search',{query:'filtered'});
            assert.equal(filtered.isError,false);
            const unavailable=JSON.parse(filtered.content[0].text);
            assert.deepEqual(unavailable.results,[]);
            assert.match(unavailable.note,/上游返回了结果.*没有可用来源.*不要自动重搜/);
            assert.doesNotMatch(filtered.content[0].text,/127\.0\.0\.1/);
            for(const [name,args] of [['web_fetch',{url:'file:///private'}],['web_fetch',{url:'https://user:pass@example.invalid'}],['web_fetch',{url:'http://2130706433/private'}],['web_fetch',{url:'http://192.168.0.8/private'}],['web_fetch',{url:'http://[::1]/private'}],['web_search',{query:'x'.repeat(129)}],['web_search',{query:'valid',baseUrl:'https://unexpected.invalid'}]] as const)
              assert.equal((await call(name,args)).content[0].text,'invalid_tool_arguments');
            assert.equal((await call('web_search',{query:'denied'})).content[0].text,'engine_quota_insufficient');
            for(const query of ['redirect','lost','oversized'])assert.equal((await call('web_search',{query})).content[0].text,'membership_web_result_unconfirmed');
          }
        });
        if(!worker){
          const call=(tool:string,args:unknown)=>this.tool({threadId:this.threadId,turnId:this.turnId!,callId:tool,tool,arguments:args});
          await call('worker_open',{message:'Fetch the example page'});
        }
      }catch(error){engineErrors.push(error);}
      return {status:'completed',text:'Synthetic turn completed.'};
    }
  }
  const app=new Homer(config,async()=>{},(options,tool)=>{if(!options.role)mainOptions=options;return new Engine(options,tool);});
  try{
    app.store.setMeta('mainThread',oldThread);app.store.setMeta('mainToolsHash',oldHash);
    await app.start();
    assert.equal(mainOptions.threadId,oldThread);
    await withMcp(mainOptions,async rpc=>assert.equal((await rpc('tools/call',{name:'web_search',arguments:{query:'idle'}})).content[0].text,'tool_scope_denied'));
    await app.submitMessage({requestId:'synthetic-user',text:'Search for and read the example page.'});
    await app.idle();
    assert.deepEqual(engineErrors,[]);
    assert.equal(workerChecked,true);
    assert.equal(app.store.meta('mainThread'),oldThread);assert.equal(app.store.meta('mainToolsHash'),oldHash);
    assert.deepEqual(requests,[
      ...[query,'empty','filtered','denied','redirect','lost','oversized'].map(query=>({path:'/v1/tools/search',method:'POST',auth:`Bearer ${token}`,body:{query,count:5,need_content:false}})),
      {path:'/v1/tools/fetch',method:'POST',auth:`Bearer ${token}`,body:{url:'https://example.invalid/article'}},
      {path:'/v1/tools/fetch',method:'POST',auth:`Bearer ${token}`,body:{url:missingUrl}},
    ]);
    await app.close();
    for(const source of ['codex','website'] as const){
      if(source==='website')delete process.env.HOMER_DEEPSEEK_TOKEN;
      const unavailable=new Homer({...config,desktopModelSource:source},async()=>{},(options,tool)=>{mainOptions=options;return new Engine(options,tool);});
      try{
        await unavailable.start();
        await withMcp(mainOptions,async rpc=>{
          assert.ok(!(await rpc('tools/list')).tools.some((tool:any)=>['web_search','web_fetch','generate_image','generate_video'].includes(tool.name)));
          assert.equal((await rpc('tools/call',{name:'web_search',arguments:{query:'idle'}})).content[0].text,'interaction_tool_denied');
        });
      }finally{await unavailable.close();}
    }
    assert.equal(requests.length,9);
  }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});

test('membership video submits only after user approval and retrieves the original file after restart',async t=>{
  const token='sk-synthetic-video-membership-only';
  const box=(name:string,data:Buffer)=>{
    const head=Buffer.alloc(8);head.writeUInt32BE(8+data.length);head.write(name,4);
    return Buffer.concat([head,data]);
  };
  const track=(name:string)=>box('trak',box('mdia',box('hdlr',Buffer.concat([Buffer.alloc(8),Buffer.from(name)]))));
  const container=(tracks:Buffer)=>Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('moov',tracks),box('mdat',Buffer.from([1]))]);
  const mp4=container(Buffer.concat([track('vide'),track('soun')]));
  const posts:string[]=[],errors:unknown[]=[],results:Record<string,any>={};
  const gatewayId='task_'+'A'.repeat(32),workerId='task_'+'B'.repeat(32);
  const getCalls:string[]=[];
  let app!:Homer,mainMessageId:string,mode='complete',videoMessageId:string,pollClosed=false;
  const gateway=createServer(async(req,res)=>{
    try{
      assert.equal(req.headers.authorization,'Bearer '+token);
      if(req.method==='POST'){
        assert.equal(req.url,'/v1/videos');
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const body=JSON.parse(Buffer.concat(chunks).toString());
        assert.deepEqual(body,{model:'wan3.0-video',prompt:body.prompt,seconds:5,size:'1280x720',audio:true});
        posts.push(body.prompt);
        if(body.prompt==='lost'){req.socket.destroy();return;}
        if(body.prompt==='421'){res.writeHead(421).end();return;}
        if(body.prompt==='stop')await app.stopMain(mainMessageId);
        res.writeHead(202).end(JSON.stringify({id:body.prompt==='worker'?workerId:gatewayId,status:'queued'}));
        return;
      }
      getCalls.push(req.url!);
      assert.match(req.url!,new RegExp('^/v1/videos/(?:'+gatewayId+'|'+workerId+')(?:/content)?$'));
      if(!req.url!.endsWith('/content')){
        if(mode==='quota'){res.writeHead(401).end();return;}
        if(mode==='stop-poll'){res.on('close',()=>{pollClosed=true;});await app.stopMain(mainMessageId);return;}
        res.end(JSON.stringify({id:req.url!.split('/').at(-1),status:'completed',url:'https://example.invalid/private'}));return;
      }
      if(mode==='oversized'){
        const part=Buffer.alloc(1024*1024);
        for(let index=0;index<50;index++)res.write(part);
        res.end(Buffer.from([0]));return;
      }
      if(mode==='redirect'){res.writeHead(307,{Location:'/unexpected'}).end();return;}
      res.writeHead(200,{'Content-Type':'video/mp4'}).end(mode==='damaged'?mp4.subarray(0,-1):mode==='no-audio'?container(track('vide')):mp4);
    }catch(error){errors.push(error);res.writeHead(500).end();}
  });
  await new Promise<void>(resolve=>gateway.listen(0,'127.0.0.1',resolve));
  t.after(()=>{gateway.closeAllConnections();return new Promise<void>(resolve=>gateway.close(()=>resolve()));});
  const parent=resolve('.codex/scratch');mkdirSync(parent,{recursive:true});
  const root=mkdtempSync(join(parent,'membership-video-'));
  const baseUrl=`http://127.0.0.1:${(gateway.address() as AddressInfo).port}/v1`;
  const role={baseUrl,model:'synthetic',effort:null,fast:false as const,context:{contextWindow:32768,autoCompactTokenLimit:29000,autoCompactTokenLimitScope:'total' as const}};
  const config:Config={appData:root,workspace:join(root,'work'),runtime:join(root,'runtime'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:resolve('tests/fixtures/native-feature-app-server.mjs'),model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100,
    desktopModelSource:'website',dailyDeepSeek:true,pauseOldDesktopWork:true,desktopResources:syntheticDesktop(t,root),desktopConnection:{main:role,worker:role}};
  mkdirSync(config.runtime);
  const oldToken=process.env.HOMER_DEEPSEEK_TOKEN;process.env.HOMER_DEEPSEEK_TOKEN=token;
  t.after(()=>{if(oldToken===undefined)delete process.env.HOMER_DEEPSEEK_TOKEN;else process.env.HOMER_DEEPSEEK_TOKEN=oldToken;rmSync(root,{recursive:true,force:true});});
  const oldThread='synthetic-video-existing';
  class Engine extends EventEmitter{
    threadId:string;turnId?:string;turnActive=false;private turns=0;
    constructor(readonly options:EngineOptions,readonly tool:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-video-worker';}
    async start(){return this.threadId;}
    async close(){return true;}
    async interrupt(){return true;}
    async turn(text:string,opts?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
      const worker=this.options.role==='worker';
      const input=worker?null:JSON.parse(text.match(/^VIDEO_FIXTURE (\{[^\n]*\})/m)?.[1]??'null');
      this.turnId=this.threadId+'-'+ ++this.turns;this.turnActive=true;opts?.onStarted?.(this.turnId);
      const dynamic=(tool:string,args:unknown)=>this.tool({threadId:this.threadId,turnId:this.turnId!,callId:tool,tool,arguments:args}) as Promise<Record<string,string>>;
      const video=(key:string,args:unknown)=>withMcp(this.options,async rpc=>{
        const reply=await rpc('tools/call',{name:'generate_video',arguments:args});
        results[key]=reply.isError?{code:reply.content[0].text}:JSON.parse(reply.content[0].text);
      });
      try{
        if(worker){
          await video('worker-foreign',{receipt:results.resume.receipt});
          await video('worker',{prompt:'worker'});
        }
        else if(input?.worker)await dynamic('worker_open',{message:'Generate a synthetic video'});
        else if(input){
          await video(input.key,input.args);
          const path=results[input.key]?.path;
          if(input.publish&&path){
            const sent=await dynamic('send_user_message',{text:'Synthetic video is ready.',attachments:[{path}]});
            assert.ok(sent.messageId);
            videoMessageId=sent.messageId;
          }
        }
      }catch(error){errors.push(error);}
      finally{this.turnActive=false;}
      return {status:'completed',text:'Synthetic video turn completed.'};
    }
  }
  const start=async()=>{
    app=new Homer(config,async message=>{if(message.type==='main_start')mainMessageId=message.messageId;},(options,tool)=>new Engine(options,tool));
    if(!app.store.meta('mainThread')){
      app.store.setMeta('mainThread',oldThread);
      app.store.setMeta('mainToolsHash',createHash('sha256').update(JSON.stringify([...MAIN_TOOLS,...RECURSIVE_TOOLS])).digest('hex'));
    }
    await app.start();
  };
  let sequence=0;
  const turn=async(input:object,decision?:boolean)=>{
    const sourceRequestId='video-fixture-'+ ++sequence;
    app.submitMessage({requestId:sourceRequestId,text:'VIDEO_FIXTURE '+JSON.stringify(input)});
    if(decision!==undefined){
      const deadline=Date.now()+1500;let id:unknown;
      do{id=app.store.db.prepare("SELECT id FROM worker_interactions WHERE state='pending_user' AND json_extract(authority,'$.sourceRequestId')=?").get(sourceRequestId)?.id;if(!id)await delay(10);}while(!id&&Date.now()<deadline);
      if(typeof id!=='string')assert.fail('video approval did not reach the user');
      const before=posts.length;
      assert.throws(()=>app.interactions.respond(String(id),{action:'approve',reason:'Model replay'},{userMessageId:'forged'}),/main_native_user_decision_required/);
      assert.equal(posts.length,before);
      app.submitMessage({requestId:sourceRequestId+'-decision',interactionId:String(id),text:decision?'允许本次操作':'拒绝本次操作'});
    }
    await app.idle();assert.deepEqual(errors,[]);
  };
  try{
    await start();
    await turn({key:'bad',args:{prompt:'bad',receipt:'latest'}});assert.equal(results.bad.code,'invalid_tool_arguments');
    await turn({key:'denied',args:{prompt:'denied'}},false);assert.deepEqual(posts,[]);
    await turn({key:'stop',args:{prompt:'stop'}},true);assert.deepEqual(posts,['stop']);assert.deepEqual(getCalls,[]);
    await app.close();await start();
    await turn({key:'resume',args:{receipt:'latest'},publish:true});
    const message=app.history.message(videoMessageId!)!;
    assert.deepEqual(readFileSync(results.resume.path),mp4);
    assert.deepEqual(Buffer.from(app.readAttachment({messageId:message.id,...message.attachments![0]!}).data,'base64'),mp4);
    assert.doesNotMatch(JSON.stringify(results),/task_[AB]+|example.invalid|sk-synthetic/);
    const count=getCalls.length;
    await turn({key:'repeat',args:{receipt:results.resume.receipt}});assert.equal(results.repeat.path,results.resume.path);
    assert.ok(app.history.list(oldThread).some(message=>message.text.includes('取回编号 '+results.resume.receipt)));
    const otherCwd=join(config.workspace,'other');mkdirSync(otherCwd);
    const occupied=join(otherCwd,results.resume.filename);writeFileSync(occupied,'occupied');
    app.store.setMeta('mainWorkingDirectory',otherCwd);
    await turn({key:'local-copy',args:{receipt:results.resume.receipt}});
    assert.equal(dirname(results['local-copy'].path),otherCwd);
    assert.deepEqual(readFileSync(results['local-copy'].path),mp4);
    assert.equal(readFileSync(occupied,'utf8'),'occupied');
    app.store.setMeta('mainWorkingDirectory',config.workspace);
    await turn({key:'foreign',args:{receipt:workerId}});assert.equal(getCalls.length,count);
    await turn({worker:true},true);assert.deepEqual(readFileSync(results.worker.path),mp4);
    assert.equal(results['worker-foreign'].code,'membership_video_receipt_denied');
    const afterWorker=getCalls.length;
    await turn({key:'worker-receipt',args:{receipt:results.worker.receipt}});
    assert.deepEqual(readFileSync(results['worker-receipt'].path),mp4);assert.equal(getCalls.length,afterWorker);
    await turn({key:'lost',args:{prompt:'lost'}},true);
    await turn({key:'unconfirmed',args:{receipt:'latest'}});assert.equal(results.unconfirmed.state,'submission_unconfirmed');
    assert.equal(app.upgradeStatus().safe,true);
    await turn({key:'421',args:{prompt:'421'}},true);
    mode='stop-poll';await turn({key:'stop-poll',args:{prompt:'stop-poll'}},true);
    assert.equal(results['stop-poll'].state,'pending');
    for(let n=0;!pollClosed&&n<30;n++)await delay(10);
    assert.equal(pollClosed,true);
    mode='complete';await turn({key:'after-stop-poll',args:{receipt:results['stop-poll'].receipt}});
    assert.deepEqual(readFileSync(results['after-stop-poll'].path),mp4);
    for(const failure of ['oversized','damaged','no-audio','redirect','quota']){
      mode=failure;await turn({key:failure,args:{prompt:failure}},true);
      assert.equal(results[failure].path,undefined);assert.equal(typeof results[failure].receipt,'string');
    }
    assert.match(results.quota.note,/积分用尽.*原会员凭据/);
    await app.close();process.env.HOMER_DEEPSEEK_TOKEN='sk-synthetic-changed-token';await start();
    const beforeChangedToken=getCalls.length;
    await turn({key:'changed-token',args:{receipt:results.resume.receipt}});
    assert.equal(results['changed-token'].code,'membership_video_receipt_denied');assert.equal(getCalls.length,beforeChangedToken);
    assert.deepEqual(posts,['stop','worker','lost','421','stop-poll','oversized','damaged','no-audio','redirect','quota']);
  }finally{await app?.close();}
});

test('membership images generate and edit through MCP and publish the exact PNG',async t=>{
  const token='sk-synthetic-image-membership-only';
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOI6tkCRwzEcQCU8hmhmgeEcAAAAABJRU5ErkJggg==','base64');
  const models=['gpt-image-2.5-sunburst','gpt-image-2.5-flare'];
  const requests:{path:string|undefined;prompt:string;model:string;auth:string|undefined}[]=[];
  const webAuth:(string|undefined)[]=[];
  const errors:unknown[]=[];
  let app:Homer,mainMessageId:string|undefined,attachment:AttachmentRef,foreign:AttachmentRef,unselected:AttachmentRef,imageMessageId:string|undefined,finishNativeTurn:()=>void;
  const gateway=createServer(async(req,res)=>{
    try{
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      if(req.url==='/v1/tools/search'||req.url==='/v1/tools/fetch'){
        webAuth.push(req.headers.authorization);
        res.end(JSON.stringify(req.url.endsWith('search')?{results:[]}:{content:'Synthetic source'}));
        return;
      }
      const raw=Buffer.concat(chunks),editing=req.url==='/v1/images/edits';
      let body;
      if(editing){
        const form=await new Response(raw,{headers:{'Content-Type':req.headers['content-type']!}}).formData();
        const image=form.get('image');
        assert.ok(image instanceof File);assert.equal(image.type,'image/png');
        assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
        body=Object.fromEntries([...form].filter(([name])=>name!=='image'));
      }else body=JSON.parse(raw.toString());
      assert.deepEqual(Object.keys(body).sort(),['model','n','output_format','prompt']);
      assert.equal(Number(body.n),1);assert.equal(body.output_format,'png');
      requests.push({path:req.url,prompt:body.prompt,model:body.model,auth:req.headers.authorization});
      if(body.prompt==='lost'){req.socket.destroy();return;}
      if(body.prompt==='misdirected'){res.writeHead(421);res.end();return;}
      if(body.prompt==='redirect'){res.writeHead(307,{location:'/unexpected'});res.end();return;}
      if(body.prompt==='invalid response'){res.end(JSON.stringify({data:[{b64_json:png.subarray(0,33).toString('base64')}]}));return;}
      if(body.prompt==='denied'){res.writeHead(402);res.end();return;}
      if(body.prompt==='limited'){res.writeHead(429);res.end();return;}
      if(body.prompt==='rejected'){res.writeHead(400);res.end();return;}
      if(body.prompt==='stop')await app.stopMain(mainMessageId!);
      if(body.prompt==='terminal'||body.prompt==='worker terminal')finishNativeTurn();
      res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));
    }catch(error){errors.push(error);res.writeHead(500);res.end();}
  });
  await new Promise<void>(resolve=>gateway.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise<void>(resolve=>gateway.close(()=>resolve())));
  const baseUrl='http://127.0.0.1:'+(gateway.address() as AddressInfo).port+'/v1';
  const role={baseUrl,model:'synthetic',effort:null,fast:false as const,context:{contextWindow:32768,autoCompactTokenLimit:29000,autoCompactTokenLimitScope:'total' as const}};
  const parent=resolve('.codex/scratch');mkdirSync(parent,{recursive:true});
  const root=mkdtempSync(join(parent,'membership-image-'));
  const config:Config={appData:root,workspace:join(root,'work'),runtime:join(root,'runtime'),codexHome:join(root,'codex'),nativeCodexHome:join(root,'codex'),codexBin:resolve('tests/fixtures/native-feature-app-server.mjs'),model:'synthetic',requiresOpenaiAuth:false,stopGraceMs:100,
    desktopModelSource:'website',dailyDeepSeek:true,pauseOldDesktopWork:true,desktopResources:syntheticDesktop(t,root),desktopConnection:{main:role,worker:role}};
  mkdirSync(config.runtime);
  const oldToken=process.env.HOMER_DEEPSEEK_TOKEN;
  process.env.HOMER_DEEPSEEK_TOKEN=token;
  t.after(()=>{
    if(oldToken===undefined)delete process.env.HOMER_DEEPSEEK_TOKEN;else process.env.HOMER_DEEPSEEK_TOKEN=oldToken;
    rmSync(root,{recursive:true,force:true});
  });
  class Engine extends EventEmitter{
    threadId:string;turnId?:string;turnActive=false;private turns=0;
    constructor(readonly options:EngineOptions,readonly tool:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??'synthetic-image-worker';}
    async start(){return this.threadId;}
    async close(){return true;}
    async interrupt(){return true;}
    async imageCapability(){return true;}
    async turn(text:string,opts?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
      this.turnId=this.threadId+'-'+ ++this.turns;this.turnActive=true;opts?.onStarted?.(this.turnId);
      if(text.startsWith('[内部协作输入'))return {status:'completed',text:''};
      const worker=this.options.role==='worker',terminal=text.startsWith('Finish a synthetic');
      const interrupted=terminal?'terminal':text.startsWith('Stop a synthetic')?'stop':undefined;
      try{
        await withMcp(this.options,async rpc=>{
          const call=(args:unknown)=>rpc('tools/call',{name:'generate_image',arguments:args});
          finishNativeTurn=()=>{this.turnActive=false;this.emit('turnTerminal',{threadId:this.threadId,turnId:this.turnId});};
          assert.ok((await rpc('tools/list')).tools.some((tool:{name:string})=>tool.name==='generate_image'));
          if(interrupted){
            assert.equal((await call({prompt:interrupted})).content[0].text,'membership_image_result_unconfirmed');
            return;
          }
          const web=await rpc('tools/call',worker
            ? {name:'web_fetch',arguments:{url:'https://example.invalid/image'}}
            : {name:'web_search',arguments:{query:'Synthetic drawing reference'}});
          assert.equal(web.isError,false);
          const inspect=(ref:AttachmentRef)=>rpc('tools/call',{name:'inspect_attachment',arguments:ref});
          const allowed=await inspect(attachment);
          assert.equal(allowed.isError,false);
          assert.equal(JSON.parse(allowed.content[0].text).assetId,attachment.assetId);
          for(const image of [foreign,unselected,{...attachment,revision:2}]){
            const denied=await inspect(image);
            const edit=await call({prompt:'unauthorized',image});
            for(const reply of [denied,edit]){
              assert.equal(reply.isError,true);
              assert.equal(reply.content[0].text,'media_scope_denied');
            }
          }
          if(!worker){
            for(const [prompt,error] of [['lost','membership_image_result_unconfirmed'],['redirect','membership_image_result_unconfirmed'],['invalid response','membership_image_result_unconfirmed'],['denied','engine_quota_insufficient'],['limited','engine_rate_limited'],['rejected','membership_image_request_rejected']])
              assert.equal((await call({prompt})).content[0].text,error);
            for(const image of [undefined,attachment]){
              const rejected=await call({prompt:'misdirected',...(image?{image}:{})});
              assert.equal(rejected.content[0].text,'membership_image_request_rejected');
            }
            assert.equal((await call({prompt:'unexpected model',model:'gpt-image-2'})).content[0].text,'invalid_tool_arguments');
          }
          let generatedPath:string|undefined;
          for(const editing of [false,true]){
            const prompt=(worker?'worker':'main')+(editing?' edit':' generate');
            const model=(worker!==editing)?models[1]:models[0];
            const reply=await call({prompt,...(model===models[1]?{model}:{}),...(editing?{image:attachment}:{})});
            assert.equal(reply.isError,false,reply.content[0].text);
            const result=JSON.parse(reply.content[0].text);
            assert.equal(result.model,model);assert.equal(result.mime,'image/png');assert.equal(result.sha256,createHash('sha256').update(png).digest('hex'));
            assert.deepEqual(readFileSync(result.path),png);
            assert.ok(result.path.startsWith(worker?join(config.workspace,'outputs')+'/':config.workspace+'/'));
            generatedPath=result.path;
          }
          if(worker){
            const dir=dirname(generatedPath!),before=readdirSync(dir);
            assert.equal((await call({prompt:'worker terminal'})).content[0].text,'membership_image_result_unconfirmed');
            assert.deepEqual(readdirSync(dir),before);
          }else{
            const dynamic=(tool:string,args:unknown)=>this.tool({threadId:this.threadId,turnId:this.turnId!,callId:tool,tool,arguments:args}) as Promise<Record<string,string>>;
            imageMessageId=(await dynamic('send_user_message',{text:'Synthetic image is ready.',attachments:[{path:generatedPath}]})).messageId;
            await dynamic('worker_open',{message:'Generate and edit a synthetic image',attachments:[attachment]});
          }
        });
      }catch(error){errors.push(error);}
      return {status:'completed',text:'Synthetic image turn completed.'};
    }
  }
  app=new Homer(config,async message=>{if(message.type==='main_start')mainMessageId=message.messageId;},(options,tool)=>new Engine(options,tool));
  try{
    await app.start();
    const attach=(requestId:string)=>{
      const ref=app.media.intent(requestId,'web:'+app.store.meta('mainThread'),'image','fixture.png');
      app.media.ready(ref,app.media.claim(ref)!,png,'image/png');
      app.media.derivative(requestId,ref,{bytes:png,mime:'image/png',width:4,height:4,transform:'synthetic-png'});
      return ref;
    };
    attachment=attach('synthetic-image-user');foreign=attach('unrelated-user');
    app.submitMessage({requestId:'synthetic-image-user',text:'Generate and edit a synthetic image.',attachments:[attachment]});
    unselected=attach('synthetic-image-user');
    await app.idle();
    assert.deepEqual(errors,[]);
    const imageMessage=app.history.message(imageMessageId!)!;
    assert.deepEqual(Buffer.from(app.readAttachment({messageId:imageMessage.id,...imageMessage.attachments![0]!}).data,'base64'),png);
    const files=readdirSync(config.workspace);
    app.submitMessage({requestId:'synthetic-image-stop',text:'Stop a synthetic generation.'});
    await app.idle();
    app.submitMessage({requestId:'synthetic-image-terminal',text:'Finish a synthetic turn before the image returns.'});
    await app.idle();
    assert.deepEqual(errors,[]);
    assert.deepEqual(readdirSync(config.workspace),files);
    assert.deepEqual(requests.map(r=>r.prompt).sort(),['denied','invalid response','limited','lost','main edit','main generate','misdirected','misdirected','redirect','rejected','stop','terminal','worker edit','worker generate','worker terminal']);
    assert.ok(requests.every(r=>r.auth==='Bearer '+token));
    assert.deepEqual(requests.filter(r=>r.prompt==='misdirected').map(r=>r.path),['/v1/images/generations','/v1/images/edits']);
    assert.ok(requests.filter(r=>r.prompt.endsWith(' edit')||r.prompt.endsWith(' generate')).every(r=>r.path==='/v1/images/'+(r.prompt.endsWith(' edit')?'edits':'generations')));
    assert.deepEqual(webAuth,['Bearer '+token,'Bearer '+token]);
  }finally{await app.close();}
});
