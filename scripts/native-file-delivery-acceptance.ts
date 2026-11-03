// Explicit local acceptance, never a production document generator or model call.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Homer} from '../src/service.js';
import {homerWebBridge} from '../src/web-homer.js';
import {createWebServer} from '../src/web-server.js';
import type {WebState,WebBridge} from '../src/web-contract.js';
import {extractDocument} from '../src/media-documents.js';
import {materializeNativeImage} from '../src/native-generated-files.js';
import {fixture,delegate,running,main,accept} from '../tests/recursive-fixture.js';
const python=process.argv[2];if(!python)throw Error('existing_python_path_required');
const scratch=resolve('.codex/scratch/native-file-delivery');mkdirSync(scratch,{recursive:true});
const directory=mkdtempSync(join(scratch,'accepted-')),sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
execFileSync(python,['-B',fileURLToPath(new URL('./fixtures/native-office-files.py',import.meta.url)),directory],{timeout:20000,env:{PATH:'/usr/bin:/bin',TMPDIR:directory},stdio:'pipe'});
const fixtures:ReturnType<typeof fixture>[]=[],downloads=new Map<string,ReturnType<typeof homerWebBridge>>(),results:{filename:string;bytes:number;sha256:string;runId:string;contentVerified:boolean}[]=[];
const state:WebState={threadId:'synthetic-file-acceptance',messages:[{id:'synthetic-result',requestId:'synthetic-request',threadId:'synthetic-file-acceptance',role:'assistant',text:'合成文件已按实际内容核对，经原验收和正式 publication 发布。此实例没有模型或真实账号。',status:'completed',createdAt:1}],isRunning:false,activeMessageId:null,work:[],interactions:[],upgrade:{phase:'running'}};
let web:Awaited<ReturnType<typeof createWebServer>>|undefined;
try{
 for(const ext of['docx','pptx','xlsx','pdf','png']){
  const f=fixture();fixtures.push(f);const child=delegate(f,'office-'+ext,undefined,undefined,'file'),actor=running(f,child.taskId),run=f.tasks.run(actor.runId!),dir=f.files.prepareRun(run.matterId,run.id),filename='synthetic-'+(ext==='png'?'image':'report')+'.'+ext,bytes=readFileSync(join(directory,filename));
  let path=filename;
  if(ext==='png')path=materializeNativeImage(dir,actor.threadId!,'synthetic-native-image',bytes.toString('base64')).filename;
  else copyFileSync(join(directory,filename),join(dir,path));
  f.tasks.markMaterialRead(actor);
  const host=Object.create(Homer.prototype) as Homer;
  Object.assign(host,{tasks:f.tasks,files:f.files,store:f.store,memory:{validateRun(){}},workerActor:()=>actor,closing:false,registerChannelCapabilities(){}});
  const staged=await (host as any).workerMediaTool({id:run.id,epoch:run.epoch},'stage_workspace_file',{operationId:'stage',path,filename});
  const bridge=homerWebBridge(host);await assert.rejects(()=>bridge.artifact(run.id),/artifact_not_authorized/);
  if(ext!=='png'){const content=await extractDocument(bytes,filename);for(const token of['Homer synthetic office acceptance','120','90','30'])assert.ok(content.text.includes(token),'actual_document_content_missing:'+ext+':'+token);}
  const task=f.tasks.task(child.taskId),result=f.tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Synthetic final result'},true)!;assert.equal(result.resultId,staged.resultId);
  f.tasks.endSegment(run.id,actor.epoch!,{status:'completed',text:'Synthetic final result'},true);accept(f,child.taskId,result.resultId!);await assert.rejects(()=>bridge.artifact(run.id),/artifact_not_authorized/);
  const root=f.tasks.task(f.root.taskId),final=({operationId:'root-seal',taskId:root.id,version:1,expectedTaskRevision:root.revision,outcome:'succeeded',evidence:{facts:true},children:[{childTaskId:task.id,childVersion:1,disposition:'included',resultId:result.resultId,reason:'Actual content checked'}],resultId:null,text:JSON.stringify({summary:'Synthetic acceptance'}),publishedFileResultId:null} satisfies Parameters<typeof f.tasks.publish>[1]);
  f.tasks.publish(main,{...final,operationId:'publish',taskId:root.id,version:1,expectedTaskRevision:f.tasks.task(root.id).revision,resultId:final.resultId,publishedFileResultId:result.resultId,text:'合成文件'});
  downloads.set(run.id,bridge);state.work.push({id:run.id,title:filename,status:'succeeded',summary:'合成验收文件',hasArtifact:true});results.push({filename,bytes:bytes.length,sha256:sha(bytes),runId:run.id,contentVerified:ext!=='png'});
 }
 const unavailable=async()=>{throw Error('synthetic_read_only');};const bridge:WebBridge={state:async()=>state,submit:unavailable,stop:unavailable,respond:unavailable,artifact:async id=>{const b=downloads.get(id);if(!b)throw Error('artifact_not_authorized');return b.artifact(id);}};
 web=await createWebServer({port:process.argv.includes('--serve')?4811:0,bridge,uiDirectory:resolve('dist/web'),logoPath:resolve('assets/branding/homer-hippo-cool-icon-256.png')});
 for(const result of results){const response:Response=await fetch(web.url+'/api/files/'+result.runId);assert.equal(response.status,200);assert.equal(sha(Buffer.from(await response.arrayBuffer())),result.sha256);assert.match(response.headers.get('content-disposition')! ,/attachment/);}
 assert.equal((await fetch(web.url+'/api/files/run-no-such-run')).status,409);
 const receipt={synthetic:true,noModelOrAccount:true,noNewDependencies:true,url:web.url,directory,results,exactDownloadBytes:true,publicationRequired:true};writeFileSync(join(directory,'verification-receipt.json'),JSON.stringify(receipt,null,2));writeFileSync(join(scratch,'latest-location.json'),JSON.stringify({directory,url:web.url,pid:process.pid}));console.log(JSON.stringify(receipt));
 if(process.argv.includes('--serve'))await new Promise<void>(done=>{process.once('SIGINT',done);process.once('SIGTERM',done);});
}finally{await web?.close();for(const f of fixtures)f.close();}
