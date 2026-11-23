// Real fixed desktop gateway, real loopback HTTP; synthetic IPC host, no engine.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {PassThrough,Writable} from 'node:stream';
import {pinnedInventory} from '../scripts/pinned-build.mjs';
import {runDev} from '../scripts/dev.mjs';

test('desktop gateway authenticates Preview and privately supplies a fresh key on each launch',{timeout:60000},async t=>{
 const parent=resolve(process.env.HOMER_SYNTHETIC_ROOT??'.codex/scratch/open-source-web-boundary-20261102/gateway');mkdirSync(parent,{recursive:true});
 const directory=mkdtempSync(join(parent,'synthetic-')),buildDir=join(directory,'build');
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 symlinkSync(resolve('node_modules'),join(directory,'node_modules'),'junction');
 mkdirSync(buildDir);execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.json','--outDir',join(buildDir,'dist')],{stdio:'pipe'});
 for(const name of ['prompts','assets','runtime','scripts'])mkdirSync(join(buildDir,name));
 copyFileSync('scripts/windows-security.mjs',join(buildDir,'scripts/windows-security.mjs'));
 writeFileSync(join(buildDir,'package.json'),'{"type":"module"}');writeFileSync(join(buildDir,'package-lock.json'),'{}');
 writeFileSync(join(buildDir,'dist/dev-host.js'),`
 let credentialPassedToHost=false;
 const state={threadId:'synthetic-gateway',messages:[],isRunning:false,activeMessageId:null,work:[],interactions:[],upgrade:{phase:'running'}};
 process.on('message',m=>{
  credentialPassedToHost ||= /desktopAccessToken|x-homer-desktop-access/i.test(JSON.stringify(m));
  if(m.kind==='init')process.send({kind:'ready',thread:state.threadId,stateInvalidationProtocol:1,webHistoryProtocol:3});
  if(m.kind==='web'){
   let value={...state,credentialPassedToHost};
   if(m.method==='preview.messageFile')value={filename:'预览.md',mime:'text/markdown',data:Buffer.from('# Preview').toString('base64')};
   if(m.method==='preview.messageFileInfo'||m.method==='preview.revealMessageFile')value={method:m.method,source:m.input};
   if(m.method==='preview.open')value={id:'synthetic-page',loading:true};
   if(m.method==='schedules.read')value={input:m.input,credentialPassedToHost};
   process.send({kind:'web_result',id:m.id,value});
  }
  if(m.kind==='desktop_account')process.send({kind:'web_result',id:m.id,value:{account:'none',connected:false,phase:m.method}});
  if(m.kind==='stop')process.send({kind:'desktop_stopped',confirmed:true},()=>process.disconnect());
 });
 `);
 const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const files=pinnedInventory(buildDir),hash=digest(files),manifest=digest(files);
 writeFileSync(join(buildDir,'build-manifest.json'),JSON.stringify({sourceHash:hash,manifest,files}));
 const build={directory:buildDir,hash,manifest,version:'synthetic',thread:'synthetic-gateway',uiHash:'c'.repeat(64),schema:'synthetic',toolsHash:'synthetic',boundary:'synthetic-gateway-access',config:{runtime:join(directory,'runtime'),appData:directory}};
 let previous;
 for(let i=0;i<2;i++){
  const input=new PassThrough();let text='',ready;
  const urlEvent=new Promise(r=>{ready=r;});
  const output=new Writable({write(chunk,_encoding,done){text+=String(chunk);done();}});
  let account;
  const done=runDev({root:buildDir,input,output,fixedBuild:build,webPort:0,desktop:{bindAccount:callback=>{account=callback;},onEvent:event=>{if(event.kind==='url')ready(event);}}});
  let timer;
  try{
   const event=await Promise.race([urlEvent,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('synthetic_desktop_gateway_timeout: '+text)),15000);})]);clearTimeout(timer);
   assert.equal(typeof event.desktopAccessToken==='string'&&/^[a-f0-9]{64}$/.test(event.desktopAccessToken),true,'private desktop credential format');assert.equal(event.url.includes(event.desktopAccessToken),false);
   const request=async key=>{const response=await fetch(event.url+'/api/history/state',{headers:{Connection:'close',...(key?{'X-Homer-Desktop-Access':key}:{})}});const value=await response.json();return {status:response.status,value};};
   assert.equal((await request()).status,401);
   if(previous){assert.equal(previous===event.desktopAccessToken,false,'desktop credential must change between launches');assert.equal((await request(previous)).status,401);}
   const authenticated=await request(event.desktopAccessToken);assert.equal(authenticated.status,200);assert.equal(authenticated.value.credentialPassedToHost,false);
   const post=path=>fetch(event.url+path,{method:'POST',headers:{Connection:'close',Origin:event.url,'Content-Type':'application/json','X-Homer-Desktop-Access':event.desktopAccessToken},body:'{}'});
   const file=await post('/api/preview/message-file');
   assert.equal(file.status,200);assert.equal(file.headers.get('Content-Type'),'text/markdown');assert.match(file.headers.get('Content-Disposition'),/%E9%A2%84%E8%A7%88\.md/);assert.equal(await file.text(),'# Preview');
   for(const operation of ['info','reveal']){
    const result=await post('/api/preview/message-file/'+operation);
    assert.equal(result.status,200);assert.deepEqual(await result.json(),{source:{},method:operation==='reveal'?'preview.revealMessageFile':'preview.messageFileInfo'});
   }
   const page=await post('/api/preview/open');
   assert.equal(page.status,200);assert.deepEqual(await page.json(),{id:'synthetic-page',loading:true});
   const schedule={view:'list',readEpoch:'fixture'};
   const readSchedules=key=>fetch(event.url+'/api/schedules/read',{method:'POST',headers:{Origin:event.url,'Content-Type':'application/json',...(key?{'X-Homer-Desktop-Access':key}:{})},body:JSON.stringify(schedule)});
   assert.equal((await readSchedules()).status,401);
   const schedules=await readSchedules(event.desktopAccessToken);
   assert.equal(schedules.status,200);assert.deepEqual(await schedules.json(),{input:schedule,credentialPassedToHost:false});
   for(const action of ['state','connect','cancel'])assert.deepEqual(await account(action),{account:'none',connected:false,phase:action});
   await assert.rejects(()=>account('logout'),/desktop_account_unavailable/);
   assert.equal(text.includes(event.desktopAccessToken),false);previous=event.desktopAccessToken;
  }finally{clearTimeout(timer);input.write('/quit\n');assert.equal((await done).stoppedConfirmed,true,text);input.destroy();output.destroy();}
 }
});
