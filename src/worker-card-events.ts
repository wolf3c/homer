import type {DatabaseSync} from 'node:sqlite';

export type WorkerEventKind = 'delegated' | 'reply_received' | 'start_failed';
export type WorkerBodySource = 'description' | 'reply' | 'missing' | 'error';
export type WorkerCardSnapshot = {
  schemaVersion:1;
  eventKind:WorkerEventKind;
  title:string;
  body:string;
  bodySource:WorkerBodySource;
  taskId:string|null;
  version:number|null;
  runId:string|null;
  sourceMessageId:string|null;
  operationKey:string|null;
  observedAtMs:number;
  failureStage:'dispatch'|'startup'|null;
  errorCode:string|null;
};
export type WorkerCardInput = Omit<WorkerCardSnapshot,'schemaVersion'|'failureStage'|'errorCode'> & {
  eventKey:string;
  failureStage?:WorkerCardSnapshot['failureStage'];
  errorCode?:string|null;
};
type Row = {eventKey:string;threadId:string;nodeId:string;itemId:string;snapshotJson:string};
function text(value:unknown,max:number){
  if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('worker_event_invalid');
  return value.trim();
}
function snapshot(input:WorkerCardInput):WorkerCardSnapshot{
  if(!['delegated','reply_received','start_failed'].includes(input.eventKind) ||
    !['description','reply','missing','error'].includes(input.bodySource) ||
    !Number.isFinite(input.observedAtMs)||input.observedAtMs<0 ||
    input.version!==null&&(!Number.isSafeInteger(input.version)||input.version<1) ||
    input.failureStage!=null&&!['dispatch','startup'].includes(input.failureStage) ||
    input.errorCode!=null&&!/^[a-z][a-z0-9_]{0,79}$/.test(input.errorCode))throw Error('worker_event_invalid');
  const nullable=(v:unknown)=>v===null?null:text(v,300);
  // Explicit allowlist: raw tool arguments and extra payload fields never persist here.
  return {schemaVersion:1,eventKind:input.eventKind,title:text(input.title,80),body:text(input.body,640),
    bodySource:input.bodySource,taskId:nullable(input.taskId),version:input.version,runId:nullable(input.runId),
    sourceMessageId:nullable(input.sourceMessageId),operationKey:nullable(input.operationKey),
    observedAtMs:input.observedAtMs,failureStage:input.failureStage??null,errorCode:input.errorCode??null};
}
// Sole persisted public body. Process items contain references, not another snapshot.
export class WorkerCardEvents{
  constructor(private db:DatabaseSync){
    db.exec(`CREATE TABLE IF NOT EXISTS worker_card_events(
      eventKey TEXT PRIMARY KEY,threadId TEXT NOT NULL,nodeId TEXT NOT NULL,itemId TEXT NOT NULL,snapshotJson TEXT NOT NULL);`);
  }
  record(threadId:string,nodeId:string,itemId:string,input:WorkerCardInput){
    const eventKey=text(input.eventKey,500),event=snapshot(input);
    const prior=this.db.prepare('SELECT * FROM worker_card_events WHERE eventKey=?').get(eventKey) as Row|undefined;
    if(prior){
      const previous=JSON.parse(prior.snapshotJson) as WorkerCardSnapshot;
      // Replay may have a new observation and notification ID. Keep the first witness and anchor.
      const {observedAtMs:_a,sourceMessageId:_sa,...a}=previous;
      const {observedAtMs:_b,sourceMessageId:_sb,...b}=event;
      if(prior.threadId!==threadId||JSON.stringify(a)!==JSON.stringify(b))throw Error('worker_event_conflict');
      return {created:false,nodeId:prior.nodeId,itemId:prior.itemId,event:previous};
    }
    this.db.prepare('INSERT INTO worker_card_events VALUES(?,?,?,?,?)').run(eventKey,threadId,nodeId,itemId,JSON.stringify(event));
    return {created:true,nodeId,itemId,event};
  }
  read(keys:readonly string[]){
    const out=new Map<string,WorkerCardSnapshot>();
    for(let at=0;at<keys.length;at+=200){
      const part=keys.slice(at,at+200);
      const rows=this.db.prepare(`SELECT eventKey,snapshotJson FROM worker_card_events WHERE eventKey IN (${part.map(()=>'?').join(',')})`).all(...part) as {eventKey:string;snapshotJson:string}[];
      for(const row of rows){
        const value=JSON.parse(row.snapshotJson) as WorkerCardSnapshot;
        if(value.schemaVersion===1)out.set(row.eventKey,value);
      }
    }
    return out;
  }
}
const startupErrors:Record<string,string>={
  engine_authentication_failed:'认证失败，Worker 未能启动。',
  engine_account_status_unconfirmed:'未能核实账号状态，Worker 未能启动。请检查连接与额度。',
  engine_quota_insufficient:'模型服务额度不足，Worker 未能启动。请检查可用额度。',
  engine_rate_limited:'模型服务请求受到限流，Worker 未能启动。请稍后手动重试。',
  engine_permission_failed:'权限不足，Worker 未能启动。',
  engine_model_unavailable:'所需模型不可用，Worker 未能启动。',
  output_setup_failed:'任务工作目录准备失败，Worker 未能启动。',
  task_authority_source_denied:'任务授权来源不可用，Worker 未能启动。',
};
export function startupErrorText(code:string){
  return Object.hasOwn(startupErrors,code)?startupErrors[code]!:'Worker 未能启动，未提供可展示的错误说明。';
}
export function publicStartupCode(code:string){
  return Object.hasOwn(startupErrors,code)?code:'worker_start_failed';
}
