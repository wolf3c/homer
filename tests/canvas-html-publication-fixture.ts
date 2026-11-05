// Requirements-derived synthetic bytes, real isolated Files/task/publication contracts.
// Never constructs Homer, a model engine, a user channel, or production storage.
import {fixture,openWorker,running,complete,main} from './recursive-fixture.js';
import {homerWebBridge} from '../src/web-homer.js';
import {Homer} from '../src/service.js';

export function publishedHtmlFixture(filename='正式预览.html',bytes=Buffer.from('<!doctype html><meta charset="utf-8"><h1>正式 HTML 成果</h1><button onclick="this.textContent=\'交互已运行\'">交互验收按钮</button><input aria-label="预览输入"><script>document.body.dataset.ran="yes";fetch("https://canvas-test.invalid/blocked").catch(()=>{});try{parent.document.body.dataset.escaped="yes"}catch{}</script>')) {
  const f=fixture('.codex/scratch/canvas-html-publication/runtime'),{dir,store,files,tasks,task}=f;
  const opened=openWorker(f),actor=running(f,opened.runId),run=tasks.run(opened.runId);
  const written=tasks.writeFile(actor,{operationId:'stage-html',filename,bytes});
  const privateFile=tasks.writeFile(actor,{operationId:'stage-private',filename:'未发布.html',bytes:Buffer.from('<h1>not published</h1>')});
  complete(f,actor);
  const adopt=(file:typeof written,operationId:string)=>{
    const accepted=tasks.adoptResult(main,{operationId,taskId:task.taskId,version:1,runId:run.id,filePath:file.path});
    const checked=tasks.readResult(main,accepted.resultId).file!;
    return {...checked,resultId:accepted.resultId};
  };
  const staged=adopt(written,'adopt-html'),hidden=adopt(privateFile,'adopt-private');
  const app={store,files,tasks,onStateChange:(listener:()=>void)=>store.db.onChange(()=>listener()),registerChannelCapabilities(){},snapshot:()=>({runs:store.runs(),tasks:tasks.tasks(),interactions:[]}),conversationState:()=>({threadId:main.threadId,messages:[],isRunning:false,activeMessageId:null})} as unknown as Homer;
  // Exercise the real publication/hash/MIME owner without constructing Homer.
  app.previewArtifact=Homer.prototype.previewArtifact.bind(app);
  const bridge=homerWebBridge(app,{draftUpload:false,nativeCapabilities:false});
  let deliveryId:string|undefined;
  return {dir,store,files,tasks,bridge,staged,hidden,run,bytes,filename,classifiedMime:files.resultBytes(files.prepareRun(run.taskId,run.id),staged.path).mime,
    publish(){const result=tasks.publish(main,{operationId:'html-publish',taskId:task.taskId,version:1,resultIds:[staged.resultId],text:'正式 HTML 验收文件'});deliveryId=result.deliveryId;return result;},
    revoke(){if(!deliveryId)throw Error('synthetic_publication_required');tasks.markDelivery(deliveryId,'revoked');},
    close:f.close
  };
}
