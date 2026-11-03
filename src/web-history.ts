import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {parseResourceReference,parseResourceReferences,referencesOf,resourceHasComment,type ResourceReference} from './preview-reference.js';
import { messageQuoteText,previewQuoteText,sourceQuoteText } from './message-quote.js';
import type { AttachmentRef,MediaView } from './media-store.js';
import { messageLinks, type MessageSource } from './message-links.js';
export type MessageToolActivity = { id: string; label: string; status: 'running' | 'completed' | 'failed' | 'blocked' };

export type MessageQuote = { messageId: string; text: string; itemIds?:string[]; position?:import('./preview-reference.js').PreviewTextAnchor & {sourceHash:string} };
function quotePosition(value:unknown,text:string):MessageQuote['position']{
 if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_quote');
 const p=value as NonNullable<MessageQuote['position']>;
 if(p.format!=='preview-text-v1'||!['plain','markdown'].includes(p.representation)||!Number.isSafeInteger(p.start)||p.start<0||!Number.isSafeInteger(p.end)||p.end<=p.start||p.end-p.start!==text.length||p.exact!==text||typeof p.prefix!=='string'||p.prefix.length>64||typeof p.suffix!=='string'||p.suffix.length>64||typeof p.sourceHash!=='string'||! /^[a-f0-9]{64}$/.test(p.sourceHash))throw Error('invalid_quote');
 return {format:p.format,representation:p.representation,start:p.start,end:p.end,exact:p.exact,prefix:p.prefix,suffix:p.suffix,sourceHash:p.sourceHash};
}
export type AnnotatedQuote = MessageQuote & { annotation: string };
export type ConversationInput = { requestId: string; text: string; quote?: MessageQuote; quotes?: AnnotatedQuote[]; resourceReference?:ResourceReference; resourceReferences?:ResourceReference[]; interactionId?: string; questionAnswers?: Record<string,string[]>; attachments?: AttachmentRef[] };
export type ConversationMessage = {
  id: string; threadId: string; requestId: string | null;
  role: "user" | "assistant"; text: string;
  status: "queued" | "processing" | "cancelled" | "running" | "completed" | "interrupted" | "failed";
  quote?: MessageQuote; quotes?: AnnotatedQuote[]; resourceReference?:ResourceReference; resourceReferences?:ResourceReference[]; createdAt: number;
  attachments?: AttachmentRef[];
  media?:MediaView[];
  sources?: MessageSource[];
  toolActivities?: MessageToolActivity[];
  feedback?: 'up' | 'down' | null;
};
export type ConversationReceipt = { fresh: boolean; replyId: string };
export type ConversationAcceptance = { source: string; persist: (receipt: ConversationReceipt) => void };
type AcceptOptions = { source?: string; validateFresh?: () => void; persist?: ConversationAcceptance["persist"] };
type Row = Omit<ConversationMessage, "quote" | "quotes" | "resourceReference" | "resourceReferences"> & { quote: string | null };
// Preserve the legacy single-owner JSON bytes; only mixed inputs use both keys.
export function encodeConversationReferences(input: Pick<ConversationInput, 'quote' | 'quotes' | 'resourceReference' | 'resourceReferences'>): string | null {
  const resources = input.resourceReferences ? { resourceReferences: input.resourceReferences } : input.resourceReference ? { resourceReference: input.resourceReference } : undefined;
  const messages = input.quotes ? { quotes: input.quotes } : input.quote ? { quote: input.quote } : {};
  return resources ? JSON.stringify({ ...resources, ...messages }) : input.quotes ? JSON.stringify(input.quotes) : input.quote ? JSON.stringify(input.quote) : null;
}
function decodeConversationReferences(json: string | null): Pick<ConversationInput, 'quote' | 'quotes' | 'resourceReference' | 'resourceReferences'> {
  const value: unknown = json ? JSON.parse(json) : undefined;
  if (Array.isArray(value)) return { quotes: value as AnnotatedQuote[] };
  if (!value || typeof value !== 'object') return {};
  if ('resourceReferences' in value || 'resourceReference' in value) return {
    ...('resourceReferences' in value ? { resourceReferences: parseResourceReferences(value.resourceReferences) } : 'resourceReference' in value ? { resourceReference: parseResourceReference(value.resourceReference) } : {}),
    ...('quotes' in value ? { quotes: value.quotes as AnnotatedQuote[] } : 'quote' in value ? { quote: value.quote as MessageQuote } : {}),
  };
  return { quote: value as MessageQuote };
}
const parse = ({ quote, ...row }: Row): ConversationMessage => ({ ...row, ...decodeConversationReferences(quote) });
export function conversationInput(value: unknown): ConversationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_message");
  const input = value as ConversationInput;
  const validQuote = (quote: unknown): quote is MessageQuote => !!quote && typeof quote === "object" &&
    typeof (quote as MessageQuote).messageId === "string" && /^[\w:-]{1,100}$/.test((quote as MessageQuote).messageId) &&
    typeof (quote as MessageQuote).text === "string" && !!(quote as MessageQuote).text.trim() && (quote as MessageQuote).text.length <= 16000 &&
    ((quote as MessageQuote).itemIds===undefined||(Array.isArray((quote as MessageQuote).itemIds)&&!!(quote as MessageQuote).itemIds!.length&&(quote as MessageQuote).itemIds!.length<=200&&new Set((quote as MessageQuote).itemIds).size===(quote as MessageQuote).itemIds!.length&&(quote as MessageQuote).itemIds!.every(id=>typeof id==='string'&&id.length>0&&id.length<=512)));
  if (input.quote !== undefined && (input.quotes !== undefined || !validQuote(input.quote))) throw new Error("invalid_quote");
  if (input.quotes !== undefined && (!Array.isArray(input.quotes) || input.quotes.length > 20 ||
    input.quotes.some(quote => !validQuote(quote) || typeof quote.annotation !== "string" || quote.annotation.length > 16000) ||
    input.quotes.reduce((size, quote) => size + quote.text.length + quote.annotation.length, 0) > 48000)) throw new Error("invalid_quote");
  if(input.resourceReference!==undefined&&input.resourceReferences!==undefined)throw Error('invalid_resource_reference');
  if((input.resourceReference!==undefined||input.resourceReferences!==undefined)&&input.interactionId!==undefined)throw Error('invalid_resource_reference');
  const resourceReference=input.resourceReference===undefined?undefined:parseResourceReference(input.resourceReference);
  const resourceReferences=input.resourceReferences===undefined?undefined:parseResourceReferences(input.resourceReferences);
  const references=referencesOf({resourceReference,resourceReferences});
  const quotes = input.quotes?.map(({ messageId, text, annotation,itemIds,position }) => ({ messageId, text, annotation,...(itemIds?{itemIds:[...itemIds]}:{}),...(position!==undefined?{position:quotePosition(position,text)}:{}) }));
  if(input.attachments!==undefined&&(!Array.isArray(input.attachments)||input.attachments.length>10||input.attachments.some(ref=>!ref||!/^asset-[a-f0-9-]{36}$/.test(ref.assetId)||!Number.isSafeInteger(ref.revision)||ref.revision<1)))throw Error('invalid_attachments');
  const attachments=input.attachments?.map(({assetId,revision})=>({assetId,revision}));
  if(resourceReferences&&attachments&&new Set(attachments.map(ref=>JSON.stringify([ref.assetId,ref.revision]))).size!==attachments.length)throw Error('invalid_attachments');
  if(references.some(r=>r.kind==='image'&&!attachments?.some(ref=>ref.assetId===r.image.assetId&&ref.revision===r.image.revision)))throw Error('preview_image_missing');
  if (!/^[\w:-]{1,100}$/.test(input.requestId) || typeof input.text !== "string" || input.text.length > 16000 ||
    (!input.text.trim() && !quotes?.some(quote => quote.annotation.trim())&&!attachments?.length&&!references.some(resourceHasComment))) throw new Error("invalid_message");
  if (input.interactionId && (typeof input.interactionId !== "string" || !/^[\w-]{1,100}$/.test(input.interactionId))) throw new Error("invalid_interaction_id");
  let questionAnswers: ConversationInput['questionAnswers'];
  if(input.questionAnswers!==undefined){
    const answers=input.questionAnswers;
    if(!input.interactionId||!answers||typeof answers!=='object'||Array.isArray(answers)||!Object.keys(answers).length||Object.keys(answers).length>16||
      Object.entries(answers).some(([id,list])=>!id.trim()||id.length>200||!Array.isArray(list)||!list.length||list.length>16||list.some(value=>typeof value!=='string'||!value.trim()||value.length>16000))||JSON.stringify(answers).length>64000)throw Error('interaction_answer_scope');
    questionAnswers=Object.fromEntries(Object.entries(answers).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([id,list])=>[id,[...list]]));
  }
  return { requestId: input.requestId, text: input.text,...(resourceReference?{resourceReference}:{}),...(resourceReferences?{resourceReferences}:{}),
    ...(input.quote ? { quote: { messageId: input.quote.messageId, text: input.quote.text,...(input.quote.itemIds?{itemIds:[...input.quote.itemIds]}:{}),...(input.quote.position!==undefined?{position:quotePosition(input.quote.position,input.quote.text)}:{}) } } : {}),
    ...(quotes?.length ? { quotes } : {}), ...(attachments?.length?{attachments}:{}), ...(input.interactionId ? { interactionId: input.interactionId } : {}),...(questionAnswers?{questionAnswers}:{}) };
}

// Private product history shares the service's existing SQLite connection.
// It is neither engine context nor a diagnostic log. No browser owns this data.
export class ConversationHistory {
  constructor(readonly db: DatabaseSync) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS conversation_inputs(requestId TEXT PRIMARY KEY,threadId TEXT NOT NULL,hash TEXT NOT NULL,replyId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversation_messages(id TEXT PRIMARY KEY,threadId TEXT NOT NULL,requestId TEXT,role TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,quote TEXT,createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS conversation_thread ON conversation_messages(threadId,createdAt);
      CREATE INDEX IF NOT EXISTS conversation_request_user ON conversation_messages(threadId,requestId,role,createdAt);
      CREATE TABLE IF NOT EXISTS conversation_attachments(requestId TEXT PRIMARY KEY REFERENCES conversation_inputs(requestId),refsJson TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversation_feedback(messageId TEXT PRIMARY KEY REFERENCES conversation_messages(id),value TEXT CHECK(value IN ('up','down')),updatedAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS conversation_tools(messageId TEXT NOT NULL REFERENCES conversation_messages(id),id TEXT NOT NULL,label TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(messageId,id));
      COMMIT;`);
  }
  // Execution reads raw user input only, never assistant links/tools/feedback.
  inputs(threadId: string, requestIds: readonly string[]): Map<string, ConversationMessage> {
    const result = new Map<string, ConversationMessage>();
    for (let offset = 0; offset < requestIds.length; offset += 500) {
      const ids = requestIds.slice(offset, offset + 500);
      const rows = this.db.prepare(`SELECT m.*,a.refsJson FROM conversation_messages m
        LEFT JOIN conversation_attachments a ON a.requestId=m.requestId
        WHERE m.threadId=? AND m.requestId IN (${ids.map(() => '?').join(',')}) AND m.role='user'
        ORDER BY m.createdAt,m.rowid`).all(threadId, ...ids) as unknown as (Row & {refsJson:string|null})[];
      for (const {refsJson, ...row} of rows) if (!result.has(row.requestId!))
        result.set(row.requestId!, {...parse(row), ...(refsJson ? {attachments:JSON.parse(refsJson)} : {})});
    }
    return result;
  }
  list(threadId: string): ConversationMessage[] {
    const rows = this.db.prepare(`SELECT m.*,a.refsJson,f.value AS feedbackValue FROM conversation_messages m
      LEFT JOIN conversation_attachments a ON a.requestId=m.requestId AND m.role='user'
      LEFT JOIN conversation_feedback f ON f.messageId=m.id
      WHERE m.threadId=? ORDER BY m.rowid`).all(threadId) as unknown as (Row & {refsJson:string|null;feedbackValue:'up'|'down'|null})[];
    const tools = new Map<string, MessageToolActivity[]>(), ids=rows.filter(row=>row.role==='assistant').map(row=>row.id);
    for(let offset=0;offset<ids.length;offset+=500){
      const batch=ids.slice(offset,offset+500);
      const activities=this.db.prepare(`SELECT messageId,id,label,status FROM conversation_tools WHERE messageId IN (${batch.map(()=>'?').join(',')}) ORDER BY rowid`).all(...batch) as (MessageToolActivity & {messageId:string})[];
      for(const {messageId,...activity} of activities){const group=tools.get(messageId)??[];group.push(activity);tools.set(messageId,group);}
    }
    return rows.map(({refsJson,feedbackValue,...row})=>({...parse(row),...(refsJson?{attachments:JSON.parse(refsJson)}:{}),...(row.role==='assistant'?{sources:messageLinks(row.text),toolActivities:tools.get(row.id)??[],feedback:feedbackValue??null}:{})}));
  }
  acceptedRequestIds(threadId: string): string[] {
    return this.db.prepare('SELECT requestId FROM conversation_inputs WHERE threadId=? ORDER BY rowid').all(threadId).map(row=>String(row.requestId));
  }
  // Exact scoped read; associations are fetched only for the requested identities.
  byIds(threadId:string, ids:readonly string[]):ConversationMessage[]{
    if(!ids.length)return [];
    if(ids.length>500)throw Error('history_ids_limit');
    const rows=this.db.prepare(`SELECT m.*,a.refsJson,f.value feedbackValue FROM json_each(?) wanted CROSS JOIN conversation_messages m ON m.id=wanted.value
      LEFT JOIN conversation_attachments a ON a.requestId=m.requestId AND m.role='user'
      LEFT JOIN conversation_feedback f ON f.messageId=m.id
      WHERE m.threadId=? ORDER BY m.rowid`).all(JSON.stringify([...new Set(ids)]),threadId) as unknown as (Row&{refsJson:string|null;feedbackValue:'up'|'down'|null})[];
    const tools=new Map<string,MessageToolActivity[]>();
    for(const {messageId,...tool} of this.db.prepare(`SELECT messageId,id,label,status FROM conversation_tools WHERE messageId IN (${ids.map(()=>'?').join(',')}) ORDER BY rowid`).all(...ids) as (MessageToolActivity&{messageId:string})[]){const list=tools.get(messageId)??[];list.push(tool);tools.set(messageId,list);}
    return rows.map(({refsJson,feedbackValue,...row})=>({...parse(row),...(refsJson?{attachments:JSON.parse(refsJson)}:{}),...(row.role==='assistant'?{sources:messageLinks(row.text),toolActivities:tools.get(row.id)??[],feedback:feedbackValue??null}:{})}));
  }
  // Internal exact identity lookup. Public callers must authorize a publication first.
  message(id: string): ConversationMessage | undefined {
    const row=this.db.prepare('SELECT * FROM conversation_messages WHERE id=?').get(id) as Row | undefined;
    return row ? parse(row) : undefined;
  }
  feedback(threadId: string, messageId: string, value: unknown) {
    if (value !== 'up' && value !== 'down' && value !== null) throw Error('invalid_feedback');
    const message = this.db.prepare("SELECT role FROM conversation_messages WHERE id=? AND threadId=?").get(messageId, threadId);
    if (message?.role !== 'assistant') throw Error('feedback_message_not_found');
    this.db.prepare('INSERT INTO conversation_feedback VALUES(?,?,?) ON CONFLICT(messageId) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt').run(messageId, value, Date.now());
    return { messageId, value };
  }
  tool(messageId: string, activity: {id:string;label:string;phase:'start'|'end';status?:'completed'|'failed'|'blocked'}) {
    if (!this.db.prepare('SELECT 1 FROM conversation_messages WHERE id=?').get(messageId)) return;
    this.db.prepare("INSERT INTO conversation_tools VALUES(?,?,?,?) ON CONFLICT(messageId,id) DO UPDATE SET label=excluded.label,status=excluded.status WHERE conversation_tools.status='running' AND excluded.status!='running'").run(messageId, activity.id, activity.label, activity.phase === 'start' ? 'running' : activity.status ?? 'blocked');
  }
  validateQuotes(threadId: string, input: ConversationInput) {
    const quotes=input.quotes??(input.quote?[input.quote]:[]);if(!quotes.length)return;
    const ids=[...new Set(quotes.map(quote=>quote.messageId))];
    const rows=this.db.prepare(`SELECT id,text FROM conversation_messages WHERE threadId=? AND id IN (${ids.map(()=>'?').join(',')})`).all(threadId,...ids);
    const sources=new Map(rows.map(row=>[String(row.id),String(row.text)]));
    // Reuse the current reader's identity index when present. Exact node IDs
    // are the fallback before a history reader is initialized (no N+1 reads).
    const indexed=!!this.db.prepare("SELECT 1 FROM sqlite_temp_master WHERE type='table' AND name='web_process_ids'").get();
    const hasMeta=!!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'").get();
    const nodes=hasMeta?this.db.prepare(indexed?`SELECT m.value FROM web_process_ids p JOIN meta m ON m.key='publicMainNode:v1:'||p.id WHERE p.threadId=? AND (p.messageId IN (${ids.map(()=>'?').join(',')}) OR p.replyId IN (${ids.map(()=>'?').join(',')}))`:
      `SELECT value FROM meta WHERE key GLOB 'publicMainNode:v1:*' AND json_extract(value,'$.threadId')=? AND (json_extract(value,'$.messageId') IN (${ids.map(()=>'?').join(',')}) OR json_extract(value,'$.replyMessageId') IN (${ids.map(()=>'?').join(',')}))`).all(threadId,...ids,...ids):[];
    const processes=new Map<string,import('./main-process.js').ProcessNode>();
    for(const row of nodes){const node=JSON.parse(String(row.value)) as import('./main-process.js').ProcessNode;processes.set(node.messageId,node);if(node.sourceKind==='user'&&node.replyMessageId)processes.set(node.replyMessageId,node);}
    const normalize=(text:string)=>text.replace(/\s+/gu,' ').trim();
    // Convert each unique item once in this validation batch, never once per
    // overlapping quote, and never cache provider text beside its persistent item.
    const visible=new Map<string,string>();
    for(const quote of quotes){
      if(!sources.has(quote.messageId))throw Error('quote_source_mismatch');
      const node=processes.get(quote.messageId);let text:string,legacy:string|undefined;
      if(node?.sourceKind==='user'&&!(node.messageId===quote.messageId&&node.final?.id===node.messageId&&!node.items.some(item=>item.kind==='commentary'&&item.phase==='final_answer'))){
        const parts=node.items.filter((item):item is Extract<import('./main-process.js').ProcessItem,{kind:'commentary'}>=>item.kind==='commentary');
        let selected=parts.filter(item=>item.phase==='final_answer');
        if(quote.itemIds){
          if(node.messageId!==quote.messageId)throw Error('quote_source_mismatch');
          const ordered=quote.itemIds.every(id=>parts.some(item=>item.id===id&&item.phase==='final_answer'))?selected:parts;
          const positions=quote.itemIds.map(id=>ordered.findIndex(item=>item.id===id));
          if(positions.some((position,index)=>position<0||index>0&&position!==positions[index-1]!+1))throw Error('quote_source_mismatch');
          selected=positions.map(position=>ordered[position]!);
          if(selected.some(item=>!item.turnId||!item.itemId||!node.turnIds.includes(item.turnId)))throw Error('quote_source_mismatch');
        }
        if(!quote.itemIds)legacy=selected.map(item=>messageQuoteText(item.text)).join('\n\n');
        text=selected.map(item=>{const key=JSON.stringify([quote.messageId,item.id,item.revision]);let value=visible.get(key);if(value===undefined){value=sourceQuoteText([item]);visible.set(key,value);}return value;}).join('\n\n');
      }else{
        if(quote.itemIds)throw Error('quote_source_mismatch');
        text=previewQuoteText(sources.get(quote.messageId)!);legacy=messageQuoteText(sources.get(quote.messageId)!);
      }
      if(!normalize(quote.text)||![text,...(legacy===undefined?[]:[legacy])].some(value=>normalize(value).includes(normalize(quote.text))))throw Error('quote_source_mismatch');
    }
  }
  record(id: string, threadId: string, text: string, status: ConversationMessage['status'] = 'completed', requestId: string | null = null) {
    const prior = this.db.prepare('SELECT text,threadId,requestId FROM conversation_messages WHERE id=?').get(id);
    if (prior) { if (prior.threadId !== threadId || prior.text !== text || prior.requestId !== requestId) throw Error('delivery_history_conflict'); return; }
    this.db.prepare("INSERT INTO conversation_messages VALUES(?,?,?,'assistant',?,?,NULL,?)").run(id, threadId, requestId, text, status, Date.now());
  }
  accept(threadId: string, value: ConversationInput, options: AcceptOptions = {}) {
    const input = conversationInput(value);
    if (options.source !== undefined && !/^[a-z][a-z0-9_:-]{1,100}$/.test(options.source)) throw new Error("invalid_input_source");
    const hash = createHash("sha256").update(JSON.stringify([input.text, input.quotes ? { quotes: input.quotes } : input.quote ?? null, input.interactionId ?? null, ...(options.source ? [options.source] : []),...(input.attachments? [{attachments:input.attachments}]:[]),...(input.questionAnswers?[{questionAnswers:input.questionAnswers}]:[]),...(input.resourceReference?[{resourceReference:input.resourceReference}]:[]),...(input.resourceReferences?[{resourceReferences:input.resourceReferences}]:[])])).digest("hex");
    const persist = (receipt: ConversationReceipt) => {
      const result: unknown = options.persist?.(receipt);
      if (result && typeof (result as PromiseLike<unknown>).then === "function") throw new Error("accept_hook_must_be_synchronous");
      return receipt;
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT * FROM conversation_inputs WHERE requestId=?").get(input.requestId) as { threadId: string; hash: string; replyId: string } | undefined;
      if (existing) {
        if (existing.threadId !== threadId || existing.hash !== hash) throw new Error("request_id_conflict");
        const receipt = persist({ fresh: false, replyId: existing.replyId });
        this.db.exec("COMMIT");
        return receipt;
      }
      options.validateFresh?.();
      this.validateQuotes(threadId,input);
      const replyId = "message-" + randomUUID(), now = Date.now();
      this.db.prepare("INSERT INTO conversation_inputs VALUES(?,?,?,?)").run(input.requestId, threadId, hash, replyId);
      if(input.attachments)this.db.prepare('INSERT INTO conversation_attachments VALUES(?,?)').run(input.requestId,JSON.stringify(input.attachments));
      const insert = this.db.prepare("INSERT INTO conversation_messages VALUES(?,?,?,?,?,?,?,?)");
      insert.run("message-" + randomUUID(), threadId, input.requestId, "user", input.text, "completed", encodeConversationReferences(input), now);
      insert.run(replyId, threadId, input.requestId, "assistant", "", "running", null, now);
      const receipt = persist({ fresh: true, replyId });
      this.db.exec("COMMIT");
      return receipt;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  append(id: string, delta: string) {
    this.db.prepare("UPDATE conversation_messages SET text=text || ? WHERE id=? AND status='running'").run(delta, id);
  }
  finish(id: string, text: string, status: ConversationMessage["status"]) {
    this.db.prepare("UPDATE conversation_messages SET text=?,status=? WHERE id=? AND status='running'").run(text, status, id);
  }
  add(threadId: string, text: string, status: ConversationMessage["status"] = "completed") {
    const id = "message-" + randomUUID();
    this.db.prepare("INSERT INTO conversation_messages VALUES(?,?,NULL,'assistant',?,?,NULL,?)").run(id, threadId, text, status, Date.now());
    return id;
  }
  reconcile() {
    this.db.prepare("UPDATE conversation_tools SET label=CASE WHEN label='创建任务' THEN '创建结果待核对' ELSE label END,status='blocked' WHERE status='running'").run();
    this.db.prepare("UPDATE conversation_messages SET status='interrupted' WHERE status='running'").run();
  }
}
