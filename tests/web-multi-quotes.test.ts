import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {ConversationHistory, conversationInput} from "../src/web-history.js";
import {prepareMessage} from "../ui/conversation-client.js";

// Requirement-derived synthetic content only. No provider/account/production DB.
function fixture() {
  const db=new DatabaseSync(":memory:"), history=new ConversationHistory(db);
  const first=history.add("thread-a","第一条**合成原文**及[链接](https://example.com)。");
  const second=history.add("thread-a","另一条合成原文。\n\n| 项目 | 结果 |\n| --- | --- |\n| 核对 | 完成 |");
  const quotes=[{messageId:first,text:"第一条合成原文",annotation:"解释这一段"},{messageId:second,text:"项目\t结果\n核对\t完成",annotation:"改为列表"}];
  return {db,history,first,second,quotes};
}
test("multiple exact message sources and their annotations persist as one request and survive a new history owner",()=>{
  const f=fixture();try{
    const input={requestId:"multi",text:"整体要求",quotes:f.quotes};
    const receipt=f.history.accept("thread-a",input);
    const message=new ConversationHistory(f.db).list("thread-a").find(m=>m.role==="user");
    assert.deepEqual((message as unknown as {quotes:unknown}).quotes,f.quotes);
    assert.equal(f.history.accept("thread-a",input).fresh,false);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM conversation_inputs").get()!.n,1);
    assert.throws(()=>f.history.accept("thread-a",{...input,quotes:[{...f.quotes[0]!,annotation:"不同批注"},f.quotes[1]!]}),/request_id_conflict/);
    assert.ok(receipt.replyId);
  }finally{f.db.close();}
});
test("annotation-only requests are valid, while empty intent, ambiguous formats and invalid quote elements are rejected",()=>{
  const f=fixture();try{
    assert.equal(f.history.accept("thread-a",{requestId:"annotation-only",text:"",quotes:f.quotes}).fresh,true);
    assert.throws(()=>conversationInput({requestId:"empty",text:"",quotes:f.quotes.map(q=>({...q,annotation:""}))}),/invalid_message/);
    assert.throws(()=>conversationInput({requestId:"ambiguous",text:"要求",quote:f.quotes[0],quotes:f.quotes}),/invalid_quote/);
    assert.throws(()=>conversationInput({requestId:"bad",text:"要求",quotes:[null]}),/invalid_quote/);
    assert.throws(()=>conversationInput({requestId:"many",text:"要求",quotes:Array.from({length:21},()=>f.quotes[0])}),/invalid_quote/);
  }finally{f.db.close();}
});
test("each quoted source is checked in the original thread; any forged element rolls back the whole request before hook",()=>{
  const f=fixture();try{
    let persisted=0;
    for(const [id,quotes] of [
      ["forged", [f.quotes[0]!,{...f.quotes[1]!,text:"伪造原文"}]],
      ["wrong-message", [{...f.quotes[0]!,messageId:f.second}]],
      ["hidden-link", [{...f.quotes[0]!,text:"https://example.com"}]],
    ] as const)assert.throws(()=>f.history.accept("thread-a",{requestId:id,text:"整体要求",quotes:[...quotes]},{persist(){persisted++;}}),/quote_source_mismatch/);
    assert.throws(()=>f.history.accept("thread-b",{requestId:"wrong-thread",text:"整体要求",quotes:f.quotes}),/quote_source_mismatch/);
    assert.equal(persisted,0);assert.equal(f.db.prepare("SELECT count(*) AS n FROM conversation_inputs").get()!.n,0);
    assert.equal(f.history.list("thread-a").length,2);
  }finally{f.db.close();}
});
test("old quote rows and exact legacy input hashes remain readable and idempotent, including trusted source",()=>{
  const f=fixture();try{
    const quote={messageId:f.first,text:"合成原文"},input={requestId:"old",text:"旧要求",quote};
    const hash=createHash("sha256").update(JSON.stringify([input.text,quote,null,"synthetic_channel"])).digest("hex");
    f.db.prepare("INSERT INTO conversation_inputs VALUES(?,?,?,?)").run(input.requestId,"thread-a",hash,"message-old-reply");
    f.db.prepare("INSERT INTO conversation_messages VALUES(?,?,?,?,?,?,?,?)").run("message-old-user","thread-a",input.requestId,"user",input.text,"completed",JSON.stringify(quote),1);
    assert.deepEqual(f.history.list("thread-a").find(m=>m.id==='message-old-user')?.quote,quote);
    assert.equal(f.history.accept("thread-a",input,{source:"synthetic_channel"}).fresh,false);
    assert.throws(()=>f.history.accept("thread-a",input),/request_id_conflict/);
  }finally{f.db.close();}
});
test("multiple quotes and annotation edits determine pending request identity; legacy pending quote retains its original shape",()=>{
  const f=fixture();try{
    let n=0;const id=()=>"new-"+ ++n;
    const pending={requestId:"multi-pending",text:"",quotes:f.quotes};
    const prepare=prepareMessage as (text:string,quotes:unknown,pending:unknown,id:()=>string)=>{requestId:string;quotes?:unknown;quote?:unknown};
    assert.equal(prepare("",structuredClone(f.quotes),pending,id).requestId,pending.requestId);
    assert.equal(n,0);
    assert.equal(prepare("",[{...f.quotes[0]!,annotation:"编辑批注"},f.quotes[1]],pending,id).requestId,"new-1");
    assert.equal(prepare("",f.quotes.slice(1),pending,id).requestId,"new-2");
    const legacy={requestId:"legacy-pending",text:"旧草稿",quote:{messageId:f.first,text:"合成原文"}};
    assert.deepEqual(prepare(legacy.text,[{...legacy.quote,annotation:""}],legacy,id),legacy);
  }finally{f.db.close();}
});

test("refresh preserves edited/deleted quote drafts instead of reviving an older pending request; accepted identical drafts clear",async()=>{
  const {restoreComposerDraft}=await import("../ui/conversation-client.js");
  const f=fixture();try{
    const pending={requestId:"draft-pending",text:"",quotes:f.quotes};
    const edited={text:"",quotes:[{...f.quotes[1]!,annotation:"刷新前已编辑"}]};
    assert.deepEqual(restoreComposerDraft(edited,pending,false),edited);
    const removed={text:"",quotes:[]};
    assert.deepEqual(restoreComposerDraft(removed,pending,false),removed);
    assert.deepEqual(restoreComposerDraft(undefined,pending,false),{text:"",quotes:f.quotes});
    assert.equal(restoreComposerDraft({text:"",quotes:f.quotes},pending,true),undefined);
    assert.deepEqual(restoreComposerDraft(edited,pending,true),edited);
    const legacy={requestId:"old-draft",text:"旧要求",quote:{messageId:f.first,text:"合成原文"}};
    assert.deepEqual(restoreComposerDraft(undefined,legacy,false),{text:legacy.text,quotes:[{...legacy.quote,annotation:""}]});
  }finally{f.db.close();}
});

const position={format:'preview-text-v1',representation:'markdown',start:0,end:7,exact:'第一条合成原文',prefix:'',suffix:'及链接。',sourceHash:'a'.repeat(64)} as const;
test('quote positions survive whitelist, JSON history and pending identity while local fields never travel',()=>{
 const f=fixture();try{
  const quote={...f.quotes[0]!,position,draftId:'local-only',range:{private:true}};
  const input=conversationInput({requestId:'position',text:'',quotes:[quote,{...quote,annotation:'第二条独立评论'}]});
  assert.deepEqual(input.quotes?.[0],{...f.quotes[0]!,position});
  f.history.accept('thread-a',input);
  assert.deepEqual(f.history.list('thread-a').find(m=>m.role==='user')?.quotes,input.quotes);
  assert.throws(()=>f.history.accept('thread-a',{...input,quotes:[{...input.quotes![0]!,position:{...position,sourceHash:'b'.repeat(64)}},input.quotes![1]!]}),/request_id_conflict/);
  const prepared=prepareMessage('',[quote],undefined,()=> 'prepared');
  assert.equal('draftId' in prepared.quotes![0]!,false);assert.equal('range' in prepared.quotes![0]!,false);
  assert.deepEqual(prepared.quotes![0]!.position,position);
 }finally{f.db.close();}
});
test('position validation rejects malformed metadata and never authenticates a forged quote',()=>{
 const f=fixture();try{
  for(const bad of [null,{}, {...position,start:-1},{...position,end:8},{...position,exact:'伪造'}, {...position,prefix:'x'.repeat(65)},{...position,sourceHash:'x'.repeat(64)}, {...position,representation:'html'}])
   assert.throws(()=>conversationInput({requestId:'bad-position',text:'要求',quotes:[{...f.quotes[0]!,position:bad}]}),/invalid_quote/);
  const text='伪造原文';assert.throws(()=>f.history.accept('thread-a',{requestId:'forged-position',text:'要求',quotes:[{...f.quotes[0]!,text,position:{...position,exact:text,end:text.length}}]}),/quote_source_mismatch/);
 }finally{f.db.close();}
});
test('structured drafts retain duplicate quotes and comments across reload without flattening into body',async()=>{
 const {singleComposerDraft}=await import('../ui/conversation-client.js');
 const draft={text:'保留正文',quotes:[{messageId:'a',text:'相同',annotation:'一',draftId:'one'},{messageId:'a',text:'相同',annotation:'二',draftId:'two'}]};
 assert.deepEqual(singleComposerDraft(draft),draft);
});
