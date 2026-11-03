import {test} from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {resolve,join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {Homer} from "../src/service.js";
import type {Config} from "../src/config.js";
import type {EngineOptions,ToolCall,TurnResult} from "../src/engine.js";
import type {WechatChannel} from "../src/channels/wechat-channel.js";
import {HomerWechat} from '../src/channels/wechat-homer.js';
import {WechatApi,type WechatCredential,type WechatUpdates,type WechatItem} from "../src/channels/wechat-api.js";
import type {WechatSecrets} from "../src/channels/wechat-secrets.js";

async function until(check:()=>boolean){for(let i=0;i<500;i++){if(check())return;await delay(5);}assert.ok(check(),"synthetic_service_timeout");}
class SyntheticWechatApi extends WechatApi {
  constructor(){super(async()=>Response.json({ret:0}));}
  queue:WechatUpdates[]=[];
  sent:{context:string;item:WechatItem}[]=[];
  override async beginQr(){return {qrcode:"synthetic",qrcode_img_content:"https://ilinkai.weixin.qq.com/qr/synthetic"};}
  override async pollQr(){return {status:"confirmed",bot_token:"synthetic",ilink_bot_id:"bot",ilink_user_id:"owner",baseurl:"https://ilinkai.weixin.qq.com"};}
  override async updates(_c:WechatCredential,_cursor:string,signal?:AbortSignal){await delay(5,undefined,{signal});return this.queue.shift()??{msgs:[]};}
  override async send(_c:WechatCredential,_peer:string,context:string,_id:string,item:WechatItem){this.sent.push({context,item});}
  override async uploadMarkdown(_c:WechatCredential,filename:string,bytes:string|Uint8Array){
    assert.equal(filename,"answer.md");assert.match(Buffer.from(bytes).toString("utf8"),/合成成果/);
    return {type:4,file_item:{file_name:filename,len:String(Buffer.byteLength(bytes)),media:{encrypt_query_param:"synthetic",aes_key:"synthetic",encrypt_type:1}}};
  }
  receive(id:string,text:string){this.queue.push({msgs:[{message_id:id,from_user_id:"owner",to_user_id:"bot",message_type:1,message_state:2,context_token:"context-"+id,item_list:[{type:1,text_item:{text}}]}],get_updates_buf:"cursor-"+id});}
}

test("synthetic single service: WeChat, Web and CLI retain main thread; ambiguous answer clarifies, explicit IDs resume original Workers and deliver original files",async()=>{
  const scratch=resolve(".codex/scratch/wechat-integration");mkdirSync(scratch,{recursive:true});const root=mkdtempSync(scratch+"/service-");
  const config:Config={runtime:join(root,"runtime"),workspace:join(root,"workspace"),codexHome:root,codexBin:"/usr/bin/false",model:"synthetic-only",requiresOpenaiAuth:false,timeoutMs:10000,mainTimeoutMs:2000,stopGraceMs:50};
  mkdirSync(config.runtime,{recursive:true});mkdirSync(join(config.workspace,"materials"),{recursive:true});writeFileSync(join(config.workspace,"materials","input.md"),"# 合成材料\n格式待确认。");
  const api=new SyntheticWechatApi(),values=new Map<string,WechatCredential>(),resumed:string[]=[],engines:Fake[]=[];
  const secrets:WechatSecrets={async get(id){return values.get(id)!;},async set(id,c){values.set(id,c);},async delete(id){values.delete(id);}};
  let sequence=0,channel:WechatChannel|undefined,adapter:HomerWechat|undefined,app:Homer;
  class Fake extends EventEmitter {
    threadId:string;turnId?:string;worker:boolean;closed=false;
    constructor(readonly options:EngineOptions,private handler:(call:ToolCall)=>Promise<unknown>){super();this.threadId=options.threadId??"fixture-thread-"+(++sequence);this.worker=options.tools.some(t=>t.name==="ask_main");engines.push(this);}
    async start(){return this.threadId;}
    async call(tool:string,args:unknown){const callId="call-"+(++sequence);const result=await this.handler({threadId:this.threadId,turnId:this.turnId!,callId,tool,arguments:args});if(!this.closed)this.emit("toolResponse",callId);return result;}
    async turn(text:string,hooks?:{onStarted?:(id:string)=>void}):Promise<TurnResult>{
      this.turnId="fixture-turn-"+(++sequence);hooks?.onStarted?.(this.turnId);
      if(this.worker){
        const answer=await this.call("ask_main",{question:"合成问题：采用哪个格式？"}) as {status:string;answer?:string};
        if(this.closed||answer.status==="cancelled")return {status:"interrupted",text:"stopped"};
        resumed.push(this.threadId);await this.call("read_material",{});await this.call("write_markdown",{filename:"answer.md",content:"# 合成成果\n"+this.threadId+"\n"+answer.answer});
        return {status:"completed",text:"合成成果已写入"};
      }
      if(text==="dispatch two"){
        for(let i=0;i<2;i++)await this.call("dispatch_work",{title:"合成任务"+i,goal:"生成Markdown，必要时确认格式",material:"input.md",matterId:null});
      }else if(text.startsWith("[Worker待答]")){
        const id=text.match(/interactionId=([\w-]+)/)![1]!;await this.call("inspect_interaction",{interactionId:id});await this.call("escalate_interaction",{interactionId:id,question:"请选择格式",reason:"合成输入存在歧义"});
        return {status:"completed",text:"请选择原任务的格式。"};
      }else if(text.split('\n')[0]==="同意")return {status:"completed",text:"有两个待答，请指明待答编号。"};
      else if(text.startsWith("answer ")){
        const id=text.match(/^answer ([\w-]+)/)![1]!;await this.call("inspect_interaction",{interactionId:id});await this.call("respond_interaction",{interactionId:id,action:"answer",answer:"原Worker采用合成格式",reason:"用户明确指定原待答",answers:null,permissions:null});
      }else if(text.startsWith("[执行结果待审阅]")){
        const id=text.match(/runId=([\w-]+)/)![1]!;await this.call("inspect_run",{runId:id});await this.call("review_artifact",{runId:id,accepted:true,summary:"合成成果核验通过",reason:"符合合成目标"});
      }
      return {status:"completed",text:text.startsWith("[执行结果待交付]")?"主Agent已核验并交付合成成果。":"主Agent已处理合成输入。"};
    }
    async interrupt(){return false;}
    async close(){this.closed=true;return true;}
  }
  app=new Homer(config,async message=>{await adapter?.onMessage(message);},(options,handler)=>new Fake(options,handler));
  try{
    await app.start();const thread=app.store.meta("mainThread");
    adapter=new HomerWechat(app,api,secrets);channel=adapter.channel;
    assert.equal(channel.store.db,app.store.db);
    const login=await channel.beginLogin();await channel.pollLogin(login.id);api.receive("1","dispatch two");
    await until(()=>app.interactions.list().filter(i=>i.state==="pending_user").length===2);
    const pending=app.interactions.list(),originalWorkerThreads=pending.map(i=>i.threadId);
    assert.equal(app.upgradeStatus().safe,false);assert.equal(engines.filter(e=>!e.worker).length,1);assert.equal(engines.filter(e=>e.worker).length,2);
    await app.message("CLI synthetic followup","cli-fixture");app.submitMessage({requestId:"web-fixture",text:"Web synthetic followup"});await app.idle({returnOnUserWait:true});
    assert.equal(app.store.meta("mainThread"),thread);
    api.receive("2","同意");await until(()=>api.sent.some(m=>m.item.text_item?.text?.includes("有两个待答")));
    assert.equal(resumed.length,0);assert.ok(app.interactions.list().every(i=>i.state==="pending_user"));
    api.receive("3","answer "+pending[1]!.id);await until(()=>resumed.length===1);
    assert.equal(resumed[0],pending[1]!.threadId);assert.equal(app.interactions.inspect(pending[0]!.id).state,"pending_user");
    api.receive("4","answer "+pending[0]!.id);await until(()=>resumed.length===2);await app.idle();
    await until(()=>api.sent.filter(m=>m.item.type===4).length===2);
    assert.deepEqual(new Set(resumed),new Set(originalWorkerThreads));assert.equal(engines.filter(e=>e.worker).length,2);
    assert.ok(app.store.runs().every(run=>run.status==="succeeded"));assert.equal(app.store.meta("mainThread"),thread);
    assert.ok(api.sent.filter(m=>m.item.type===4).every(m=>m.context==="context-1"));
    const userMessages=app.conversationState().messages.filter(m=>m.role==="user");assert.equal(userMessages.length,6);assert.ok(userMessages.every(m=>m.threadId===thread));
  }finally{await channel?.close();await app.close();rmSync(root,{recursive:true,force:true});}
});
