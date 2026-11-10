import {createHash, randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import type {Homer} from './service.js';
import type {TelegramContextMessage} from './telegram-context.js';
import {conversationInput} from './web-history.js';

export type ChannelAddress = {
  adapterId: string;
  accountKey: string;
  senderKey: string;
  conversationKey: string;
};
type ChannelInput = ChannelAddress & {eventId:string; text:string};
type TelegramGroupRoute = {chatId:number; changeId:number; messageId:number; topicId:number|null};
type TelegramBackground = () => Promise<readonly TelegramContextMessage[]>;
type ChannelEvent = Pick<ChannelInput,'senderKey'|'conversationKey'|'eventId'|'text'>;
type Binding = ChannelAddress & {id:string;createdAt:number};
type Request = {id:string; bindingId:string; inputHash:string; pendingText:string|null};
type Subscription = {id:string; bindingId:string; taskId:string; requests:string; baseline:string; revokedAt:number|null};
type Route = {bindingId:string; requestId:string} | {bindingId:string; subscriptionId:string};
type Outbox = {messageId:string; bindingId:string; requestId:string|null; subscriptionId:string|null;
  taskVersion:number|null; nextPart:number; receipts:string};
type Committed = NonNullable<ReturnType<Homer['readCommittedMessage']>>;
type Attachment = ReturnType<Homer['readAttachment']>;
type Part = {kind:'text'; text:string} | ({kind:'attachment'} & Attachment);
export type ChannelPacket = {address:ChannelAddress; messageId:string; attemptId:string; part:Part; telegramGroup?:TelegramGroupRoute; telegramReply?:false};
type TransportResult = {state:'sent'|'failed'|'unknown'; receipt?:string};
export type ChannelHealth='checking'|'ready'|'setup'|'offline'|'reauthorize';
export type ChannelStatus={adapterId:string;accountKey:string;label:string;state:ChannelHealth;failed:number;unknown:number};

export type ChannelAdapter = {
  id:string;
  connectionState?: (accountKey:string) => ChannelHealth;
  accountLabel?: (accountKey:string) => string | undefined;
  // Both operations must settle after stopping on abort. The adapter owns protocol recovery.
  send: (packet:ChannelPacket, signal:AbortSignal) => Promise<TransportResult>;
  connect?: (address:Readonly<ChannelAddress>, receive:(event:ChannelEvent)=>string, signal:AbortSignal, boundAt:number, bindingId?:string) => Promise<void>;
};
export type ChannelMessageSource = {source:string;entryLabel:string};

const subscriptionTool = {
  type:'function', name:'set_notification_destination',
  description:'Subscribe this verified chat to all future user-facing background messages and attachments for the task. Call only when the user explicitly asks to receive those messages here. Ordinary replies keep their original route.',
  inputSchema:{type:'object',properties:{taskId:{type:'string',minLength:1,maxLength:200}},required:['taskId'],additionalProperties:false},
} as const;

// Adapters submit verified private-conversation identities. Binding is a trusted
// management action, outside the model and the untrusted inbound event.
export class ChannelPlugin {
  private readonly db:DatabaseSync;
  private readonly adapters:Map<string,ChannelAdapter>;
  private readonly telegramSync=new Map<string,'ready'|'offline'>();
  private readonly telegramBackground=new Map<string,{bindingId:string;route:TelegramGroupRoute;load:TelegramBackground}>();
  private readonly abort = new AbortController();
  private readonly connections = new Map<string,{abort:AbortController;done:Promise<void>}>();
  private timer?:NodeJS.Timeout;
  private unsubscribe?:()=>void;
  private dirty=true;
  private running?:Promise<void>;
  private shutdown?:Promise<void>;
  lastSyncError: 'channel_sync_failed' | null = null;
  lastConnectionError: 'channel_connect_failed' | null = null;

  constructor(private readonly app:Homer, adapters:readonly ChannelAdapter[], private readonly wakeInputs:()=>void=()=>{}) {
    this.adapters=new Map(adapters.map(adapter=>[adapter.id,adapter]));
    if(this.adapters.size!==adapters.length||adapters.some(adapter=>!this.validKey(adapter.id)))
      throw Error('channel_adapter_invalid');
    this.db=new DatabaseSync(join(app.config.runtime,'channels.sqlite'));
    try {
      this.db.exec(`PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS channel_bindings (
          id TEXT PRIMARY KEY, adapterId TEXT NOT NULL, accountKey TEXT NOT NULL,
          senderKey TEXT NOT NULL, conversationKey TEXT NOT NULL, createdAt INTEGER NOT NULL, revokedAt INTEGER);
        CREATE UNIQUE INDEX IF NOT EXISTS channel_live_binding ON channel_bindings(adapterId,accountKey) WHERE revokedAt IS NULL;
        CREATE TABLE IF NOT EXISTS channel_requests (
          id TEXT PRIMARY KEY, bindingId TEXT NOT NULL REFERENCES channel_bindings(id),
          eventKey TEXT UNIQUE NOT NULL, inputHash TEXT NOT NULL, pendingText TEXT);
        CREATE TABLE IF NOT EXISTS telegram_group_routes (
          requestId TEXT PRIMARY KEY REFERENCES channel_requests(id), chatId INTEGER NOT NULL,
          changeId INTEGER NOT NULL, messageId INTEGER NOT NULL, topicId INTEGER);
        CREATE TABLE IF NOT EXISTS channel_subscriptions (
          id TEXT PRIMARY KEY, bindingId TEXT NOT NULL REFERENCES channel_bindings(id),
          taskId TEXT NOT NULL, requests TEXT NOT NULL, baseline TEXT NOT NULL, revokedAt INTEGER);
        CREATE UNIQUE INDEX IF NOT EXISTS channel_live_subscription ON channel_subscriptions(taskId) WHERE revokedAt IS NULL;
        CREATE TABLE IF NOT EXISTS channel_outbox (
          messageId TEXT PRIMARY KEY, bindingId TEXT NOT NULL REFERENCES channel_bindings(id),
          requestId TEXT REFERENCES channel_requests(id), subscriptionId TEXT REFERENCES channel_subscriptions(id),
          taskVersion INTEGER, state TEXT NOT NULL, attemptId TEXT, nextPart INTEGER NOT NULL DEFAULT 0,
          receipts TEXT NOT NULL DEFAULT '[]', CHECK((requestId IS NULL) <> (subscriptionId IS NULL)));`);
      this.db.exec(`UPDATE channel_outbox SET state='unknown',
        receipts=CASE WHEN json_extract(receipts,'$[#-1].attemptId')=attemptId
          AND json_extract(receipts,'$[#-1].state')='sending'
          THEN json_set(receipts,'$[#-1].state','unknown') ELSE receipts END
        WHERE state='sending'`);
      app.registerMainPluginTool({...subscriptionTool},(args,context)=>{
        const {taskId}=args as {taskId:string};
        this.requireOpen();
        context.authorizeTask(taskId);
        return this.subscribe(taskId,context.requestId);
      });
    } catch (error) { this.db.close(); throw error; }
  }

  private validKey(value:unknown):value is string {
    return typeof value==='string'&&value.length>0&&value.length<=256;
  }
  private requireOpen() { if(this.shutdown)throw Error('channel_plugin_closed'); }
  private accountKey({adapterId,accountKey}:Pick<ChannelAddress,'adapterId'|'accountKey'>) {
    return JSON.stringify([adapterId,accountKey]);
  }
  private binding(id:string) {
    return this.db.prepare('SELECT * FROM channel_bindings WHERE id=? AND revokedAt IS NULL').get(id) as Binding|undefined;
  }

  connectionStatus():ChannelStatus[]{
    this.requireOpen();
    const rows=this.db.prepare(`SELECT b.adapterId,b.accountKey,
      COALESCE(o.failed,0) AS failed,COALESCE(o.unknown,0) AS unknown
      FROM channel_bindings b LEFT JOIN (
        SELECT bindingId,COUNT(CASE WHEN state='failed' THEN 1 END) AS failed,
          COUNT(CASE WHEN state='unknown' THEN 1 END) AS unknown
        FROM channel_outbox WHERE state IN ('failed','unknown') GROUP BY bindingId
      ) o ON o.bindingId=b.id WHERE b.revokedAt IS NULL ORDER BY b.rowid`).all();
    return rows.map(row=>{
      const {adapterId,accountKey,failed,unknown}=row as Pick<ChannelStatus,'adapterId'|'accountKey'|'failed'|'unknown'>;
      const adapter=this.adapters.get(adapterId);
      return {adapterId,accountKey,label:adapter?.accountLabel?.(accountKey)??accountKey,
        state:adapter?.connectionState?.(accountKey)??'checking',failed,unknown};
    });
  }

  readMessageSources(requestIds:readonly string[],activeOnly:boolean):Map<string,ChannelMessageSource> {
    const sources=new Map<string,ChannelMessageSource>();
    if(this.shutdown||!requestIds.length)return sources;
    let rows:{
        requestId:string;bindingId:string;adapterId:string;accountKey:string;revokedAt:number|null;
      }[];
    try{
      rows=this.db.prepare(`SELECT r.id AS requestId,b.id AS bindingId,b.adapterId,b.accountKey,b.revokedAt
        FROM channel_requests r JOIN channel_bindings b ON b.id=r.bindingId
        WHERE r.id IN (${requestIds.map(()=>'?').join(',')})`).all(...requestIds) as typeof rows;
    }catch{
      // Source context is optional. Routing and authorization still check their own records.
      return sources;
    }
    for(const {requestId,bindingId,adapterId,accountKey,revokedAt} of rows){
      const adapter=this.adapters.get(adapterId);
      if((activeOnly&&(revokedAt!==null||!adapter))||!/^[-\w]+$/.test(adapterId))continue;
      const label=adapter?.accountLabel?.(accountKey);
      const entryLabel=label&&label.length<=128&&!/^@|[\p{Cc}\p{Cf}]/u.test(label)&&label.trim()===label?label:bindingId;
      sources.set(requestId,{source:adapterId,entryLabel});
    }
    return sources;
  }
  private subscription(id:string) {
    return this.db.prepare('SELECT * FROM channel_subscriptions WHERE id=? AND revokedAt IS NULL').get(id) as Subscription|undefined;
  }

  bind(address:ChannelAddress) {
    this.requireOpen();
    const {adapterId,accountKey,senderKey,conversationKey}=address;
    if(!this.adapters.has(adapterId)||![accountKey,senderKey,conversationKey].every(key=>this.validKey(key)))
      throw Error('channel_binding_invalid');
    const id=randomUUID(),createdAt=Date.now();
    this.db.prepare('INSERT INTO channel_bindings VALUES(?,?,?,?,?,?,NULL)')
      .run(id,adapterId,accountKey,senderKey,conversationKey,createdAt);
    if(this.unsubscribe)this.connect({id,adapterId,accountKey,senderKey,conversationKey,createdAt});
    return id;
  }

  // Trusted declarative configuration is applied before any connections start.
  configureBindings(adapterId:string, addresses:readonly ChannelAddress[]) {
    this.requireOpen();
    if(this.unsubscribe||!this.adapters.has(adapterId))throw Error('channel_configuration_unavailable');
    const next=new Map(addresses.map(address=>[address.accountKey,address]));
    if(next.size!==addresses.length||addresses.some(address=>address.adapterId!==adapterId))throw Error('channel_binding_invalid');
    const active=this.db.prepare('SELECT * FROM channel_bindings WHERE adapterId=? AND revokedAt IS NULL').all(adapterId) as Binding[];
    this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const binding of active){
        const desired=next.get(binding.accountKey);
        if(desired?.senderKey===binding.senderKey&&desired.conversationKey===binding.conversationKey)next.delete(binding.accountKey);
        else this.revokeBinding(binding.id);
      }
      for(const address of next.values())this.bind(address);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  revokeBinding(id:string) {
    this.requireOpen();
    const account=this.db.prepare('UPDATE channel_bindings SET revokedAt=? WHERE id=? AND revokedAt IS NULL RETURNING adapterId,accountKey')
      .get(Date.now(),id) as Pick<ChannelAddress,'adapterId'|'accountKey'>|undefined;
    if(!account)return;
    this.dirty=true;
    for(const [requestId,entry] of this.telegramBackground)if(entry.bindingId===id)this.telegramBackground.delete(requestId);
    this.telegramSync.delete(id);
    this.connections.get(this.accountKey(account))?.abort.abort();
    if(this.unsubscribe)this.wakeInputs();
  }

  private connect(binding:Binding) {
    const {adapterId,accountKey,senderKey,conversationKey}=binding;
    const adapter=this.adapters.get(adapterId),key=this.accountKey(binding);
    if(!adapter?.connect||this.connections.has(key))return;
    const abort=new AbortController();
    const signal=AbortSignal.any([this.abort.signal,abort.signal]);
    const address=Object.freeze({adapterId,accountKey,senderKey,conversationKey});
    const done=Promise.resolve().then(()=>{
      if(this.shutdown||signal.aborted)return;
      return adapter.connect!(address,event=>{
        if(signal.aborted||event.senderKey!==senderKey||event.conversationKey!==conversationKey)
          throw Error('channel_binding_denied');
        return this.receiveText({...address,eventId:event.eventId,text:event.text});
      },signal,binding.createdAt,binding.id);
    }).catch(()=>{
      if(!signal.aborted)this.lastConnectionError='channel_connect_failed';
    }).finally(()=>{
      this.connections.delete(key);
      const revoked=abort.signal.aborted;
      abort.abort();
      // A replacement may have been authorized while the old transport was stopping.
      if(this.shutdown||!revoked)return;
      const next=this.db.prepare(`SELECT * FROM channel_bindings WHERE adapterId=? AND accountKey=? AND revokedAt IS NULL`)
        .get(adapterId,accountKey) as Binding|undefined;
      if(next)this.connect(next);
    }).catch(()=>{this.lastConnectionError='channel_connect_failed';});
    this.connections.set(key,{abort,done});
  }

  telegramGroups() {
    this.requireOpen();
    this.db.exec(`CREATE TABLE IF NOT EXISTS telegram_group_sync (
      bindingId TEXT PRIMARY KEY REFERENCES channel_bindings(id), polledAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS telegram_groups (
        bindingId TEXT NOT NULL REFERENCES channel_bindings(id), chatId INTEGER NOT NULL,
        active INTEGER NOT NULL, changedAt INTEGER NOT NULL, changeId INTEGER NOT NULL,
        PRIMARY KEY(bindingId,chatId));`);
    const grant=this.db.prepare(`SELECT changeId FROM telegram_groups WHERE bindingId=? AND chatId=? AND active=1
      AND (changedAt,changeId)<(?,?)`);
    const lastPoll=this.db.prepare('SELECT polledAt FROM telegram_group_sync WHERE bindingId=?');
    const savePoll=this.db.prepare(`INSERT INTO telegram_group_sync VALUES(?,?)
      ON CONFLICT(bindingId) DO UPDATE SET polledAt=excluded.polledAt`);
    const expire=this.db.prepare('UPDATE telegram_groups SET active=0 WHERE bindingId=? AND active=1 AND changedAt<=?');
    const changeId=(bindingId:string,chatId:number,date:number,updateId:number)=>{
      const row=grant.get(bindingId,chatId,date,updateId);
      return row?Number(row.changeId):undefined;
    };
    return {
      changeId,
      polled: (bindingId:string,full=false) => {
        const cutoff=Date.now()-86_400_000;
        const prior=lastPoll.get(bindingId);
        // A grant made within the retained window can still be checked for later removal.
        const expired=!prior||Number(prior.polledAt)<=cutoff;
        if(full||expired||this.telegramSync.get(bindingId)==='offline')this.telegramSync.delete(bindingId);
        return expired&&!!expire.run(bindingId,Math.floor(cutoff/1000)).changes;
      },
      caughtUp: (bindingId:string,polledAt=Date.now()) => {
        // A response can contain a removal. Persist the watermark only after processing it.
        savePoll.run(bindingId,polledAt);
        if(this.telegramSync.get(bindingId)!=='ready'){
          this.telegramSync.set(bindingId,'ready');
          this.dirty=true;
          this.wakeInputs();
        }
      },
      disconnected: (bindingId:string) => {
        if(this.telegramSync.get(bindingId)==='offline')return;
        this.telegramSync.set(bindingId,'offline');
        this.wakeInputs();
      },
      membership: (bindingId:string,chatId:number,active:boolean,date:number,updateId:number) => {
        const prior=this.db.prepare('SELECT 1 FROM telegram_groups WHERE bindingId=? AND chatId=?').get(bindingId,chatId);
        if(!active&&!prior)return;
        const changed=!!this.db.prepare(`INSERT INTO telegram_groups(bindingId,chatId,active,changedAt,changeId) VALUES(?,?,?,?,?)
          ON CONFLICT(bindingId,chatId) DO UPDATE SET active=excluded.active,changedAt=excluded.changedAt,changeId=excluded.changeId
          WHERE (excluded.changedAt,excluded.changeId)>(telegram_groups.changedAt,telegram_groups.changeId)`)
          .run(bindingId,chatId,Number(active),date,updateId).changes;
        if(changed)for(const [id,entry] of this.telegramBackground){
          if(entry.bindingId===bindingId&&entry.route.chatId===chatId)this.telegramBackground.delete(id);
        }
        return changed;
      },
      submit: (bindingId:string,chatId:number,date:number,updateId:number,messageId:number,topicId:number|null,text:string,background?:TelegramBackground) => {
        const binding=this.binding(bindingId);
        if(binding?.adapterId!=='telegram')return;
        const generation=changeId(bindingId,chatId,date,updateId);
        if(generation!==undefined)this.receiveBound(binding,`group:${chatId}:${messageId}`,text,
          {chatId,changeId:generation,messageId,topicId},background);
      },
    };
  }

  telegramInputState(requestId:string){
    if(this.shutdown)return 'denied';
    const route=this.db.prepare(`SELECT r.bindingId,b.revokedAt,g.chatId,g.changeId FROM telegram_group_routes g
      JOIN channel_requests r ON r.id=g.requestId JOIN channel_bindings b ON b.id=r.bindingId WHERE g.requestId=?`)
      .get(requestId) as Pick<TelegramGroupRoute,'chatId'|'changeId'> & {bindingId:string;revokedAt:number|null} | undefined;
    if(!route)return;
    if(route.revokedAt!==null||!this.adapters.has('telegram')||!this.groupAllowed(route.bindingId,route))return 'denied';
    const sync=this.telegramSync.get(route.bindingId);
    return sync==='offline'?'denied':sync??'preparing';
  }

  discardTelegramBackground(requestId:string){this.telegramBackground.delete(requestId);}

  takeTelegramBackground(requestId:string){
    const entry=this.telegramBackground.get(requestId);
    if(!entry)return;
    this.discardTelegramBackground(requestId);
    const allowed=()=>this.telegramInputState(requestId)==='ready';
    if(!allowed())return;
    return entry.load().then(messages=>allowed()?messages:undefined,()=>undefined);
  }

  receiveText(input:ChannelInput) {
    this.requireOpen();
    if(!this.validKey(input.eventId)||'attachments' in input||'interactionId' in input)
      throw Error('channel_input_invalid');
    const binding=this.db.prepare(`SELECT id FROM channel_bindings WHERE adapterId=? AND accountKey=?
      AND senderKey=? AND conversationKey=? AND revokedAt IS NULL`)
      .get(input.adapterId,input.accountKey,input.senderKey,input.conversationKey);
    if(!binding||!this.adapters.has(input.adapterId))throw Error('channel_binding_denied');
    return this.receiveBound({...input,id:String(binding.id)},input.eventId,input.text);
  }

  private groupRoute(requestId:string) {
    return this.db.prepare('SELECT chatId,changeId,messageId,topicId FROM telegram_group_routes WHERE requestId=?')
      .get(requestId) as TelegramGroupRoute|undefined;
  }

  private groupAllowed(bindingId:string,route:Pick<TelegramGroupRoute,'chatId'|'changeId'>|undefined){
    return !route||!!this.db.prepare('SELECT 1 FROM telegram_groups WHERE bindingId=? AND chatId=? AND changeId=? AND active=1')
      .get(bindingId,route.chatId,route.changeId);
  }

  private receiveBound(binding:ChannelAddress & {id:string},eventId:string,body:string,group?:TelegramGroupRoute,background?:TelegramBackground){
    const eventKey=JSON.stringify([binding.adapterId,binding.accountKey,eventId]);
    const {requestId,text}=conversationInput({requestId:'channel-'+randomUUID(),text:body});
    const inputHash=createHash('sha256').update(text).digest('hex');
    const prior=this.db.prepare('SELECT * FROM channel_requests WHERE eventKey=?').get(eventKey) as Request|undefined;
    if(prior){
      if(prior.bindingId!==binding.id||prior.inputHash!==inputHash)throw Error('channel_event_conflict');
      if(prior.pendingText!==null)this.dirty=true;
      this.accept(prior);
      return prior.id;
    }
    const request={id:requestId,bindingId:String(binding.id),inputHash,pendingText:text};
    const insert=()=>this.db.prepare('INSERT INTO channel_requests VALUES(?,?,?,?,?)')
      .run(requestId,request.bindingId,eventKey,inputHash,text);
    if(group){
      this.db.exec('BEGIN IMMEDIATE');
      try{
        insert();
        this.db.prepare('INSERT INTO telegram_group_routes VALUES(?,?,?,?,?)')
          .run(requestId,group.chatId,group.changeId,group.messageId,group.topicId);
        this.db.exec('COMMIT');
      }catch(error){this.db.exec('ROLLBACK');throw error;}
    }else insert();
    if(group&&background)this.telegramBackground.set(requestId,{bindingId:binding.id,route:group,load:background});
    this.dirty=true;
    this.accept(request);
    return requestId;
  }

  private accept(request:Request) {
    if(request.pendingText===null)return;
    const binding=this.binding(request.bindingId);
    if(binding&&!this.adapters.has(binding.adapterId))return;
    const group=this.groupRoute(request.id);
    if(binding&&group&&this.telegramSync.get(binding.id)!=='ready')return;
    if(binding&&this.groupAllowed(binding.id,group))
      this.app.submitMessage({requestId:request.id,text:request.pendingText},{source:'channel_plugin',persist:()=>{}});
    else this.discardTelegramBackground(request.id);
    this.db.prepare('UPDATE channel_requests SET pendingText=NULL WHERE id=?').run(request.id);
  }

  private subscribe(taskId:string,requestId:string) {
    const request=this.db.prepare('SELECT * FROM channel_requests WHERE id=?').get(requestId) as Request|undefined;
    const binding=request&&this.binding(request.bindingId);
    if(!request||!binding||!this.adapters.has(binding.adapterId))throw Error('channel_binding_denied');
    const group=this.groupRoute(requestId);
    if(!this.groupAllowed(binding.id,group))throw Error('channel_binding_denied');
    const prior=this.db.prepare(`SELECT s.* FROM channel_subscriptions s,json_each(s.requests) r
      WHERE s.taskId=? AND r.value=?`).get(taskId,requestId) as Subscription|undefined;
    if(prior)return {taskId,subscriptionId:prior.id,state:prior.revokedAt===null?'active':'superseded'};
    const current=this.db.prepare('SELECT * FROM channel_subscriptions WHERE taskId=? AND revokedAt IS NULL').get(taskId) as Subscription|undefined;
    const currentGroup=current&&this.groupRoute(JSON.parse(current.requests)[0]);
    if(current?.bindingId===request.bindingId&&currentGroup?.chatId===group?.chatId&&
      currentGroup?.changeId===group?.changeId&&currentGroup?.topicId===group?.topicId){
      this.db.prepare("UPDATE channel_subscriptions SET requests=json_insert(requests,'$[#]',?) WHERE id=?").run(requestId,current.id);
      return {taskId,subscriptionId:current.id,state:'active'};
    }
    // Reading the baseline and activating the subscription are synchronous on
    // the one writer. A message can only commit before both or after both.
    const baseline:string[]=[];
    let after:number|null=0;
    do {
      const page=this.app.listCommittedMessages({taskId},after);
      baseline.push(...page.items.map(item=>item.messageId));
      after=page.after;
    } while(after!==null);
    const id=randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(current)this.db.prepare('UPDATE channel_subscriptions SET revokedAt=? WHERE id=?').run(Date.now(),current.id);
      this.db.prepare('INSERT INTO channel_subscriptions VALUES(?,?,?,?,?,NULL)')
        .run(id,request.bindingId,taskId,JSON.stringify([requestId]),JSON.stringify(baseline));
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK');throw error; }
    return {taskId,subscriptionId:id,state:'active'};
  }

  start() {
    this.requireOpen();
    if(this.unsubscribe)return;
    const bindings=this.db.prepare('SELECT * FROM channel_bindings WHERE revokedAt IS NULL ORDER BY rowid').all() as Binding[];
    const wake=()=>{
      if(!this.shutdown&&this.dirty&&!this.running)void this.synchronize().catch(()=>{this.lastSyncError='channel_sync_failed';});
    };
    const unwatch=this.app.onStateChange(()=>{this.dirty=true;});
    const unhook=this.app.hooks.on('message.committed',()=>{this.dirty=true;wake();});
    this.unsubscribe=()=>{unwatch();unhook();};
    this.dirty=true;
    this.timer=setInterval(wake,1000);
    this.timer.unref();
    for(const binding of bindings)this.connect(binding);
    wake();
  }
  synchronize() {
    this.requireOpen();
    if(this.running)return this.running;
    this.dirty=false;
    return this.running=Promise.resolve().then(()=>this.catchUp()).catch(error=>{
      this.dirty=true;
      throw error;
    }).finally(()=>{this.running=undefined;});
  }
  close() {
    return this.shutdown??=Promise.resolve().then(()=>this.stop());
  }
  private async stop() {
    this.unsubscribe?.();
    clearInterval(this.timer);
    this.abort.abort();
    this.telegramBackground.clear();
    await Promise.allSettled([this.running,...Array.from(this.connections.values(),connection=>connection.done)]);
    this.db.close();
  }

  private async catchUp() {
    if(this.shutdown)return;
    let acceptFailed=false;
    for(const request of this.db.prepare('SELECT * FROM channel_requests ORDER BY rowid').all() as Request[]){
      if(this.shutdown)return;
      try { this.accept(request); } catch { acceptFailed=true; }
      if(this.binding(request.bindingId))
        await this.scan({requestId:request.id},{requestId:request.id,bindingId:request.bindingId});
    }
    for(const subscription of this.db.prepare('SELECT * FROM channel_subscriptions WHERE revokedAt IS NULL').all() as Subscription[]){
      if(this.shutdown)return;
      await this.scan({taskId:subscription.taskId},{subscriptionId:subscription.id,bindingId:subscription.bindingId},
        new Set<string>(JSON.parse(subscription.baseline)));
    }
    if(this.shutdown)return;
    for(const row of this.db.prepare("SELECT messageId FROM channel_outbox WHERE state='queued' ORDER BY rowid").all()){
      if(this.shutdown)return;
      await this.send(String(row.messageId));
    }
    if(acceptFailed)this.dirty=true;
    this.lastSyncError=acceptFailed?'channel_sync_failed':null;
  }

  private async scan(scope:{requestId:string}|{taskId:string},route:Route,baseline?:Set<string>) {
    const add=this.db.prepare(`INSERT INTO channel_outbox(messageId,bindingId,requestId,subscriptionId,taskVersion,state)
      VALUES(?,?,?,?,?,'queued') ON CONFLICT(messageId) DO NOTHING`);
    let after:number|null=0;
    do {
      if(this.shutdown||!this.binding(route.bindingId)||'subscriptionId' in route&&!this.subscription(route.subscriptionId))return;
      const page=this.app.listCommittedMessages(scope,after);
      for(const message of page.items)if(!baseline?.has(message.messageId))
        add.run(message.messageId,route.bindingId,'requestId' in route?route.requestId:null,
          'subscriptionId' in route?route.subscriptionId:null,'taskVersion' in message?message.taskVersion??null:null);
      after=page.after;
      await yieldTurn();
    } while(after!==null);
  }

  private message(row:Outbox):Committed|undefined {
    if(row.requestId)return this.app.readCommittedMessage(row.messageId,{requestId:row.requestId});
    const subscription=row.subscriptionId&&this.subscription(row.subscriptionId);
    if(subscription&&subscription.bindingId===row.bindingId&&row.taskVersion!==null)
      return this.app.readCommittedMessage(row.messageId,{taskId:subscription.taskId,taskVersion:row.taskVersion});
  }
  private async send(messageId:string) {
    const next=this.db.prepare("SELECT * FROM channel_outbox WHERE messageId=? AND state='queued'");
    while(!this.shutdown){
      const row=next.get(messageId) as Outbox|undefined;
      if(!row)return;
      const binding=this.binding(row.bindingId),message=binding&&this.message(row);
      const adapter=binding&&this.adapters.get(binding.adapterId);
      const subscription=row.subscriptionId?this.subscription(row.subscriptionId):undefined;
      const origin=row.requestId??(subscription&&JSON.parse(subscription.requests)[0]);
      const group=origin?this.groupRoute(origin):undefined;
      if(binding&&group&&this.telegramSync.get(binding.id)!=='ready')return;
      if(!binding||!message||!this.groupAllowed(binding.id,group)){this.db.prepare("UPDATE channel_outbox SET state='revoked' WHERE messageId=?").run(messageId);return;}
      if(!adapter)return;
      const text='text' in message?message.text:message.status==='failed'?'Homer 未能完成本次请求。':'Homer 已中断本次回复。';
      const attachments='attachments' in message?message.attachments??[]:[];
      const offset=text?1:0,count=offset+attachments.length,ref=attachments[row.nextPart-offset];
      let part:Part;
      try{
        if(row.nextPart===0&&text)part={kind:'text',text};
        else if(ref)part={kind:'attachment',...this.app.readAttachment({messageId,...ref})};
        else throw Error('channel_message_empty');
      }catch{this.db.prepare("UPDATE channel_outbox SET state='failed' WHERE messageId=?").run(messageId);return;}
      const attemptId=randomUUID();
      const receipts=JSON.parse(row.receipts) as unknown[];
      const attempt={attemptId,part:row.nextPart,...(ref?{attachment:ref}:{})};
      receipts.push({...attempt,state:'sending'});
      this.db.prepare("UPDATE channel_outbox SET state='sending',attemptId=?,receipts=? WHERE messageId=?")
        .run(attemptId,JSON.stringify(receipts),messageId);
      const {adapterId,accountKey,senderKey,conversationKey}=binding;
      const result=await this.transport(adapter,{address:{adapterId,accountKey,senderKey,conversationKey},messageId,attemptId,part,...(group?{telegramGroup:group,...(!row.requestId?{telegramReply:false}:{})}:{})});
      receipts[receipts.length-1]={...attempt,state:result.state,
        ...(this.validKey(result.receipt)?{receipt:result.receipt}:{})};
      const step=row.nextPart+(result.state==='sent'?1:0);
      const state=result.state==='sent'&&step<count?'queued':result.state;
      this.db.prepare('UPDATE channel_outbox SET state=?,nextPart=?,receipts=? WHERE messageId=? AND attemptId=?')
        .run(state,step,JSON.stringify(receipts),messageId,attemptId);
    }
  }

  private async transport(adapter:ChannelAdapter,packet:ChannelPacket):Promise<TransportResult> {
    const signal=AbortSignal.any([this.abort.signal,AbortSignal.timeout(30_000)]);
    try {
      const result=await adapter.send(packet,signal);
      return ['sent','failed','unknown'].includes(result?.state)?result:{state:'unknown'};
    }catch{return {state:'unknown'};}
  }
}
