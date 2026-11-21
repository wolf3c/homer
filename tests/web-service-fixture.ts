import {openTaskWorker} from './fixtures/open-task-worker.js';
import {callEngineMcp} from './fixtures/host-mcp-call.js';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Homer,type Message} from '../src/service.js';
import type {EngineLike,EngineImage,EngineOptions,ToolCall,TurnResult} from '../src/engine.js';
import type {PreviewSource} from '../src/preview-reference.js';

export function fixture(sink: (message: Message) => Promise<void> = async () => {}) {
  const parent = resolve(process.env.HOMER_SYNTHETIC_ROOT??".codex/scratch/assistant-ui"); mkdirSync(parent, { recursive: true });
  const base = mkdtempSync(join(parent, process.env.HOMER_SYNTHETIC_ROOT?"s-":"service-"));
  mkdirSync(join(base, "workspace/materials"), { recursive: true }); mkdirSync(join(base, "runtime"));
  writeFileSync(join(base, "workspace/materials/synthetic.md"), "合成材料");
  const inputs: string[] = [], engines: Fake[] = [], nativeImages:EngineImage[][]=[];
  const attachments = new Map<string, string>();
  let app: Homer;
  class Fake extends EventEmitter implements EngineLike {
    threadId: string; turnId?: string; pending?: (result: TurnResult) => void;
    interrupts = 0; closed = 0; resumable = true; confirmInterrupt = true; closeConfirmed = true;
    constructor(readonly options: EngineOptions, readonly tool: (call: ToolCall) => Promise<unknown>) {
      super(); this.threadId = options.threadId ?? (this.worker ? "synthetic-worker" : "synthetic-main"); engines.push(this);
    }
    steered:string[]=[];
    async steer(turnId:string,text:string){if(this.turnId!==turnId)throw Error('message_target_stale');this.steered.push(text);return {turnId};}
    get worker() { return this.options.role === "worker"; }
    async start() { return this.threadId; }
    call(tool: string, args: unknown) { return this.tool({ threadId: this.threadId, turnId: this.turnId!, callId: "synthetic-call-" + Math.random(), tool, arguments: args }); }
    async turn(text: string, options?: { onStarted?: (id: string) => void;images?:EngineImage[] }): Promise<TurnResult> {
      this.turnId = "synthetic-turn-" + Math.random(); options?.onStarted?.(this.turnId);
      if (this.worker) return new Promise(accept => { this.pending = accept; });
      inputs.push(text);
      nativeImages.push(options?.images??[]);
      if (text === "fail") throw new Error("synthetic_engine_failure");
      if (text === "dispatch") {
        await openTaskWorker(this,"合成后台任务","合成后台任务");
      }
      if (text === "stream") return new Promise(accept => {
        this.pending = accept;
        this.emit("textDelta", { threadId: this.threadId, turnId: this.turnId, delta: "合成部分回复" });
      });
      const interactionId = text.match(/interactionId=([\w-]+)/)?.[1];
      if (interactionId) {
        await callEngineMcp(this, "inspect_interaction", { interactionId });
        if (text.includes("[待答入口]")) await callEngineMcp(this, "escalate_interaction", { interactionId, question: "合成问题：采用哪种格式？", reason: "该偏好不在任务范围内" });
        else await callEngineMcp(this, "respond_interaction", { interactionId, action: "answer", answer: "用户指定表格", reason: "依据本条用户答复" });
      }
      const reply=attachments.get(text)??'准确的合成来源句子';
      const final={itemId:'synthetic-final',phase:'final_answer',text:reply};
      this.emit('agentMessage',{threadId:this.threadId,turnId:this.turnId,...final,completed:true});
      return {status:'completed',text:reply,messages:[final]};
    }
    async interrupt() { this.interrupts++; if (this.confirmInterrupt) { this.pending?.({ status: "interrupted", text: "合成部分回复" }); this.pending = undefined; } return true; }
    async close() { this.closed++; this.pending?.({ status: "interrupted", text: "" }); this.pending = undefined; return this.closeConfirmed; }
  }
  app = new Homer({ workspace: join(base, "workspace"), runtime: join(base, "runtime"), codexBin: "/usr/bin/false", codexHome: join(base, "home"), nativeCodexHome:join(base,"home"), model: "synthetic", effort: "medium", requiresOpenaiAuth: false, stopGraceMs: 100 }, sink, (options, tool) => new Fake(options, tool));
  async function attach(requestId:string,files:readonly {filename:string;content:string|Buffer}[]):Promise<Extract<PreviewSource,{kind:'attachment'}>[]>{
    const text='附上合成文件 '+requestId;
    const links=files.map(({filename,content})=>{
      const path=join(base,'workspace',filename);writeFileSync(path,content);
      return `[${filename}](<${pathToFileURL(path).href}>)`;
    });
    attachments.set(text,['已附上合成文件',...links].join('\n\n'));
    try{await app.message(text,requestId);await app.idle();}
    finally{attachments.delete(text);}
    const message=app.history.list('synthetic-main').find(m=>m.role==='assistant'&&m.requestId===requestId&&m.operationKey);
    if(!message?.attachments?.length)throw Error('synthetic_attachment_missing');
    return message.attachments.map(ref=>{const {hash,filename}=app.media.asset(ref);return {kind:'attachment',messageId:message.id,...ref,sha256:hash!,title:filename};});
  }
  return { app, inputs, engines, base, nativeImages, attach };
}
