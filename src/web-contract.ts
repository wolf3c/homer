export type WebProcessNode=import('./main-process.js').ProcessNode&{activityLinks?:Record<string,import('./activity-facts.js').ActivityLink>};
export const WEB_PROTOCOL = 2;
// One mapping for the existing chat callers and the two transports.
export const WEB_CHAT_POST:Readonly<Record<string,{op:string;status:number}>>={
  '/api/history/page':{op:'history.page',status:200},'/api/history/process':{op:'history.process',status:200},
  '/api/history/resolve':{op:'history.resolve',status:200},'/api/history/receipts':{op:'history.receipts',status:200},
  '/api/history/queue':{op:'history.queue',status:200},'/api/history/interactions':{op:'history.interactions',status:200},
  '/api/uploads/preview':{op:'media.preview',status:200},
  '/api/uploads/discard':{op:'media.discard',status:200},'/api/messages':{op:'messages.submit',status:202},
  '/api/messages/feedback':{op:'messages.feedback',status:200},'/api/messages/interrupt':{op:'messages.interrupt',status:202},
  '/api/messages/edit':{op:'messages.edit',status:200},'/api/messages/cancel':{op:'messages.cancel',status:200},
  '/api/messages/move':{op:'messages.move',status:200},'/api/stop':{op:'messages.stop',status:202},
};
export function webChatPost(path:string):{op:string;status:number;id?:string}|undefined{
  const fixed=WEB_CHAT_POST[path];if(fixed)return fixed;
  const match=path.match(/^\/api\/interactions\/([\w-]{1,100})$/);
  return match?{op:'interactions.respond',status:202,id:match[1]}:undefined;
}
// Live observation only; never persisted or used as an execution/stop target.
export type MainActivity={processId:string;source:'user'|'internal';turnId?:string;stage:'preparing'|'native'|'compacting'|'finishing'|'unknown';summary?:string;retryObserved?:true;connectionIssue?:true};
import type { ConversationInput } from "./web-history.js";
import type {QueuedInput,DispatchInput,MainDispatchInput,QueueChange,QueueMove,QueueOperationResult} from './recursive-main-inputs.js';
import type {MainGeneration} from './service.js';
import type {NativeTokenUsage} from './native-usage.js';

export type ActiveReadVersion={threadId:string;readEpoch:string;revision:number};
export type ActiveReadResult<T>=ActiveReadVersion&{items:T[];after:number|null};
type QueueUser=import('./web-history.js').ConversationMessage&{media?:import('./media-store.js').MediaView[]};
export type DispatchQueuePage<S extends 'all'|undefined=undefined>=ActiveReadVersion&{view:'dispatch-v1';sources?:S;orderVersion:string;totalWaiting:number;items:(S extends 'all'?MainDispatchInput&{user?:QueueUser;statusText:string}:DispatchInput&{user:QueueUser;statusText:string})[];nextCursor:string|null};
export type QueueReceiptsRequest={requestIds:string[];threadId?:string;readEpoch?:string;operations?:({requestId:string;messageId?:never;operationId:string}|{messageId:string;requestId?:never;operationId:string})[]};
export type QueueReceipts={acceptedRequestIds:string[];statuses:{requestId:string;state:string;revision?:number;inputRevision?:number;editable?:boolean}[];operations?:{requestId?:string;messageId?:string;operationId:string;committed:boolean;result?:QueueOperationResult}[]};
export type MessageAttachment={messageId:string;assetId:string;revision:number};
export type WebArtifact=MessageAttachment&{id:string;title:string;sha256:string};
export type ArtifactOrigin={message:import('./web-history.js').ConversationMessage;files:WebArtifact[]};
export type WebWork={id:string;title:string;status:string;summary:string|null};
export type WebInteraction = { canCancel?:true; id: string; runId: string; workTitle?: string; sourceRequestId?: string; sourceMessageId?:string; kind: "question" | "authorization"; question: string; reason: string | null; questions?: import('./question-schema.js').WebQuestion[] };
export type InactiveInteraction = {code?:string;id:string;kind:"question"|"authorization";state:"expired"|"cancelled";sourceRequestId:string;messageId?:string;processId?:string};
export type WebState = {
  observedAtMs?:number;
  history?:{protocol:3;readEpoch:string;page:Omit<import('./web-history-pages.js').HistoryPage,'messages'|'queue'>;moreQueue:number|null;moreInteractions:number|null};
  inactiveInteractions?:InactiveInteraction[];
  orderWarning?:string;
  queueDispatch?:{orderVersion:string;totalWaiting:number;unscoped?:number;awaitingUser?:true};
  conversationView?:3; acceptedRequestIds?:string[];
  artifacts?:WebArtifact[];
  mainActivity?:MainActivity|null;
  // Current host observation only; never reconstruct it from legacy message text.
  modelFailure?:{messageId:string;code:'engine_quota_insufficient'|'engine_rate_limited'|'engine_authentication_failed'|'engine_account_status_unconfirmed'|'main_turn_failed';source?:'codex'|'website'};
  processNodes?: import('./main-process.js').ProcessNode[];
  features?:{draftUpload?:boolean;nativeCapabilities?:boolean;taskOverview?:boolean;workerExecution?:1;workerEventCards?:1;queueDispatch?:1;queueSources?:1;nativeQuestionAnswers?:1;previewReferences?:1;previewReferenceCollections?:1|2};
  threadId: string; messages: import('./conversation-projection.js').DisplayMessage[]; isRunning: boolean; activeMessageId: string | null;
  queue?: (QueuedInput & Partial<import('./conversation-projection.js').DisplayQueueInput>)[];generation?:MainGeneration|null;
  usage?:NativeTokenUsage|null;
  work: WebWork[]; interactions: WebInteraction[];
  upgrade: { reviewRequired?: boolean; phase: string; version?: string; uiVersion?: string; accepting?: boolean; transportPending?: string[]; transportRejected?: {requestId: string; error: string}[]; code?: string };
};
export type WebBridge = {
  history?:{
    state():Promise<WebState>;
    page(input:{readEpoch:string;request:import('./web-history-pages.js').HistoryPageRequest}):Promise<import('./web-history-pages.js').HistoryPage>;
    process(input:{readEpoch:string;id:string;itemId?:string}):Promise<WebProcessNode>;
    resolve(input:{readEpoch:string;id:string}):Promise<{messageId:string;sourceMessageId?:string}>;
    receipts(input:QueueReceiptsRequest):Promise<QueueReceipts>;
    queue(after:number,readEpoch?:string):Promise<ActiveReadResult<QueuedInput>>;
    dispatchQueue?<S extends 'all'|undefined=undefined>(input:{readEpoch:string;cursor?:string;sources?:S}):Promise<DispatchQueuePage<S>>;
    interactions(after:number,readEpoch?:string):Promise<ActiveReadResult<WebInteraction>>;
  };
  onStateChange?(listener:()=>void):()=>void;
  taskOverview?: {execution?(selector:import('./worker-execution.js').ExecutionSelector,before?:string):Promise<import('./worker-execution.js').WorkerExecutionPage>;call?(selector:import('./worker-execution.js').ExecutionSelector,callKey:string):Promise<import('./worker-execution.js').WorkerCallDetail>;progress?(id:string):Promise<import('./task-status.js').TaskProgress>;list():Promise<import('./task-overview.js').TaskOverview>;detail(id:string,query?:import('./task-overview.js').WorkerConversationQuery):Promise<import('./task-overview.js').TaskDetail>;summary?(id:string):Promise<import('./task-overview.js').TaskDetail>;origin?(id:string,messageId:string):Promise<ArtifactOrigin>};
  media?:{read(input:MessageAttachment&{preview?:'voice'}):Promise<{filename:string;mime:string;data:string;sha256?:string}>;origin?(input:MessageAttachment):Promise<ArtifactOrigin>;reveal?(input:MessageAttachment):Promise<{target:'source'|'snapshot';device:'homer-host'}>;upload?(input:import('./web-upload.js').WebUpload):Promise<import('./media-store.js').MediaView>;discard?(input:unknown):Promise<unknown>;previewDraft?(input:unknown):Promise<{mime:string;data:string}>};
  state(): Promise<WebState>;
  submit(input: ConversationInput): Promise<unknown>;
  queue?:{
    edit(input:QueueChange&{input:ConversationInput}):Promise<unknown>;
    cancel(input:QueueChange):Promise<unknown>;
    move?(input:QueueMove):Promise<unknown>;
    interrupt(input:ConversationInput,target:{messageId:string;generationId:string}):Promise<unknown>;
  };
  stop(messageId: string): Promise<unknown>;
  feedback?(messageId: string, value: 'up' | 'down' | null): Promise<unknown>;
  respond(id: string, input: Pick<ConversationInput,'requestId'|'text'|'questionAnswers'>): Promise<unknown>;
};
