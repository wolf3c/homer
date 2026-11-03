// Requirements-derived synthetic bytes, real isolated Files/task/publication contracts.
// Never constructs Homer, a model engine, a user channel, or production storage.
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Store} from '../src/store.js';
import {Files} from '../src/files.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {RecursiveTasks,type Actor} from '../src/recursive-tasks.js';
import {homerWebBridge} from '../src/web-homer.js';
import {Homer} from '../src/service.js';

export function publishedHtmlFixture(filename='正式预览.html',bytes=Buffer.from('<!doctype html><meta charset="utf-8"><h1>正式 HTML 成果</h1><button onclick="this.textContent=\'交互已运行\'">交互验收按钮</button><input aria-label="预览输入"><script>document.body.dataset.ran="yes";fetch("https://canvas-test.invalid/blocked").catch(()=>{});try{parent.document.body.dataset.escaped="yes"}catch{}</script>')) {
  const scratch=resolve('.codex/scratch/canvas-html-publication/runtime');mkdirSync(scratch,{recursive:true});
  const dir=mkdtempSync(join(scratch,'publication-')),store=new Store(join(dir,'synthetic.sqlite'));
  new WorkerInteractions(store.db);
  const files=new Files(join(dir,'workspace')),tasks=new RecursiveTasks(store,files);tasks.migrate();
  const main:Actor={agentId:'main:synthetic-html',sourceRequestId:'synthetic-html-request'};
  store.setMeta('mainAgentId',main.agentId);store.startRequest(main.sourceRequestId!,'synthetic-html-hash');
  const root=tasks.createRoot(main,{operationId:'html-root',title:'正式 HTML 验收',executorKind:'worker',contract:{goal:'Synthetic HTML preview acceptance',inputs:[],resultKind:'file',acceptance:{criteria:[]}},authority:{sourceRequestId:main.sourceRequestId!,description:'Synthetic HTML file only',materials:[],resultIds:[],collaborateTaskIds:[],maxActiveMs:10000}});
  const run=tasks.claim(root.runId!)!,actor:Actor={agentId:root.agentId,runId:run.id,epoch:run.epoch,threadId:'synthetic-html-worker',turnId:'synthetic-html-turn'};
  tasks.bind(run.id,run.epoch,actor.threadId!,actor.turnId!);
  const staged=tasks.writeFile(actor,{operationId:'stage-html',filename,bytes});
  const hidden=tasks.writeFile(actor,{operationId:'stage-private',filename:'未发布.html',bytes:Buffer.from('<h1>not published</h1>')});
  const done=tasks.endSegment(actor.runId!,actor.epoch!,{status:'completed',text:'Synthetic final result'},true)!;
  tasks.endSegment(run.id,run.epoch,{status:'completed',text:'Synthetic final result'},true);for(const resultId of tasks.inspect(main,{resultId:staged.resultId}).completionResultIds)tasks.inspect(main,{resultId});
  tasks.review(main,{operationId:'html-review',taskId:root.taskId,version:1,expectedTaskRevision:tasks.task(root.taskId).revision,resultId:done.resultId,accepted:true,outcome:'succeeded',reason:'Exact synthetic bytes inspected'});
  const app={store,files,tasks,onStateChange:(listener:()=>void)=>store.db.onChange(()=>listener()),registerChannelCapabilities(){},snapshot:()=>({runs:store.runs(),matters:store.matters(),interactions:[]}),conversationState:()=>({threadId:'synthetic-html-thread',messages:[],isRunning:false,activeMessageId:null})} as unknown as Homer;
  // Exercise the real publication/hash/MIME owner without constructing Homer.
  app.previewArtifact=Homer.prototype.previewArtifact.bind(app);
  const bridge=homerWebBridge(app,{draftUpload:false,nativeCapabilities:false});
  let deliveryId:string|undefined;
  return {dir,store,files,tasks,bridge,staged,hidden,run,bytes,filename,classifiedMime:files.resultBytes(files.prepareRun(run.matterId,run.id),staged.path).mime,
    publish(){const result=tasks.publish(main,{operationId:'html-publish',taskId:root.taskId,version:1,expectedTaskRevision:tasks.task(root.taskId).revision,resultId:done.resultId,publishedFileResultId:staged.resultId,text:'正式 HTML 验收文件'});deliveryId=result.deliveryId;return result;},
    revoke(){if(!deliveryId)throw Error('synthetic_publication_required');tasks.markDelivery(deliveryId,'revoked');},
    close(){store.close();rmSync(dir,{recursive:true,force:true});}
  };
}
