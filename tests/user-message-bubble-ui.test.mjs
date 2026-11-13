import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {buildSync} from 'esbuild';
import {referencesOf,referenceKey} from '../src/preview-reference.js';
import {renderToStaticMarkup} from 'react-dom/server';

// Exercise the production UserMessage boundary without starting a backend.
// Adjacent date, copy, quote and media components are boundary doubles;
// the separate queue's lifecycle is covered by message-history-recovery.
const require=createRequire(import.meta.url);
const flowModule={exports:{}};
const flowBuild=buildSync({stdin:{contents:'export {QuestionFlow} from "./question-flow";export {ApprovalCard} from "./approval-card";',resolveDir:new URL('../ui/vendor/assistant-ui/',import.meta.url).pathname,loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'}});
Function('require','module','exports',flowBuild.outputFiles[0].text)(require,flowModule,flowModule.exports);
const {QuestionFlow,ApprovalCard}=flowModule.exports;
const source=readFileSync(process.env.HOMER_BUBBLE_SOURCE??new URL('../ui/homer-app.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('homer-app.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='UserMessage');
const completed=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='CompletedInteractionCard');
const js='const Fragment = require("react").Fragment;\n'+ts.transpileModule((completed?'export '+completed.getText(ast)+'\n':'')+'export '+declaration.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;

function render(metadata){
 const calls={};
 const exports={};
 Function('require','exports','useAuiState','draftQuotes','MessagePrimitive','Markdown','MediaAttachments','MessageDetails','MessageDaySeparator','MessageTimestamp','InactiveInteractionNotes','QuoteSource','referencesOf','referenceKey','ResourceReferenceBlock','QuestionFlow','ApprovalCard',js)(
  require,exports,selector=>selector({message:{metadata:{custom:metadata},content:[{type:'text',text:metadata.original?.text??''}]}}),value=>value.quotes??(value.quote?[value.quote]:[]),
  {Root:props=>React.createElement('article',props),Parts:()=>React.createElement('p',null,metadata.original?.text)},()=>null,
  props=>{calls.media=props;return props.media.length?React.createElement('figure',null,props.media.map(m=>m.filename).join(', ')):null;},
  props=>{calls.details=props;return props.message.text?React.createElement('button',{'aria-label':'复制'},'复制'):null;},
  props=>{calls.day=props;return null;},props=>{calls.timestamp=props;return null;},
  props=>{calls.inactive=props;return null;},props=>{(calls.quotes??=[]).push(props);return React.createElement('blockquote',null,props.quote.text);},
  referencesOf,referenceKey,props=>{(calls.references??=[]).push(props.reference);return React.createElement('aside',null,props.reference.source.title);},QuestionFlow,ApprovalCard
 );
 return{html:renderToStaticMarkup(React.createElement(exports.UserMessage)),calls};
}

test('user content and its single copy action have separate surfaces while preserving source identity',()=>{
 const original={id:'synthetic-short',role:'user',text:'短句'};
 const {html,calls}=render({messageId:original.id,original,media:[]});
 assert.match(html,/aria-label="你的消息"/);
 assert.match(html,/data-conversation-message="synthetic-short"/);
 assert.match(html,/<div class="user-message-bubble"><div data-aui-quote-selectable="true"><p>短句<\/p><\/div><\/div><button aria-label="复制">/);
 assert.equal((html.match(/aria-label="复制"/g)??[]).length,1);
 assert.equal(calls.details.message,original);
});

test('the channel label sits above the original and only uses projected account data',()=>{
 const text='::message-source{source=telegram}\n\n原文';
 const original={id:'synthetic-channel',role:'user',text,channelSource:{source:'telegram',entryLabel:'homer_work_bot'}};
 const metadata={messageId:original.id,original,media:[]};
 const {html,calls}=render(metadata);
 assert.match(html,/<div class="user-message-bubble"><p class="message-source-label">Telegram@homer_work_bot<\/p><div data-aui-quote-selectable/);
 assert.match(render({...metadata,original:{...original,channelSource:{source:'wechat',entryLabel:'wx-demo'}}}).html,
   /<p class="message-source-label">微信@wx-demo<\/p>/);
 assert.equal(calls.details.message.text,text);
 assert.doesNotMatch(render({...metadata,original:{...original,channelSource:undefined}}).html,/class="message-source-label"/);
});

test('legacy quotes, annotations and media retain exact owners; formal user messages do not render queue controls',()=>{
 const queue={state:'queued',revision:4,input:{requestId:'synthetic-request',text:'补充说明'}};
 const media=[{assetId:'synthetic-asset',revision:2,filename:'合成附件.txt'}];
 const quotes=[{messageId:'source-a',text:'第一段引用',annotation:'第一段批注'},{messageId:'source-b',text:'第二段引用',annotation:'第二段批注'}];
 const {html,calls}=render({messageId:'synthetic-user',original:{text:'补充说明'},queue,media,quotes});
 for(const text of ['第一段引用','第一段批注','第二段引用','第二段批注','合成附件.txt','补充说明'])assert.ok(html.includes(text));
 assert.deepEqual(calls.quotes.map(props=>props.quote),quotes);
 assert.ok(!html.includes('synthetic queue state'),'the separate queue owns its controls');
 assert.equal(calls.media.media,media);
 assert.equal(calls.media.messageId,'synthetic-user');
 assert.ok(html.indexOf('合成附件.txt')<html.indexOf('<button aria-label="复制">'));
 assert.equal(calls.day.messageId,'synthetic-user');
});

test('pure attachments keep the existing copy availability and media identity',()=>{
 const original={id:'synthetic-attachment',text:''};
 const media=[{assetId:'synthetic-file',revision:1,filename:'合成记录.txt'}];
 const {html,calls}=render({messageId:original.id,original,media});
 assert.ok(html.includes('合成记录.txt'));
 assert.ok(!html.includes('<button'));
 assert.ok(!html.includes('data-aui-quote-selectable'),'empty Markdown must not reserve an extra content row');
 assert.equal(calls.details.message,original);
 assert.equal(calls.media.media,media);
});

test('formal message passes original references and inactive notes while uncertainty stays explicit',()=>{
 const reference={kind:'text',source:{kind:'artifact',id:'result-synthetic',sha256:'a'.repeat(64),title:'合成引用'}};
 const inactive=[{id:'synthetic-question',kind:'question',state:'expired',sourceRequestId:'request',messageId:'synthetic-user'}];
 const {html,calls}=render({messageId:'synthetic-user',original:{text:'问题'},resourceReferences:[reference],inactiveInteractions:inactive,inputState:'uncertain'});
 assert.equal(calls.references[0],reference);assert.equal(calls.inactive.items,inactive);
 assert.match(html,/接收或结束结果待核实，未自动重跑/);
});

for(const kind of ['authorization','question'])test('completed '+kind+' uses a single left card, original identity and no replay controls',()=>{
 const original={id:'synthetic-decision',role:'user',text:kind==='authorization'?'允许本次操作':'答案原文',interaction:{id:'exact',kind,title:'原请求 <script>原样</script>',description:'合成说明',scope:kind==='authorization'?'仅本次':undefined,answers:[{text:kind==='authorization'?'你已允许本次操作':'答案原文'}]}};
 const {html,calls}=render({messageId:original.id,original,media:[]});
 assert.match(html,/class="message interaction-message"/);assert.doesNotMatch(html,/user-message-bubble/);
 assert.match(html,/原请求 &lt;script&gt;原样&lt;\/script&gt;/);assert.match(html,kind==='authorization'?/你已允许本次操作/:/答案原文/);
 assert.doesNotMatch(html,/你的回答|决定已接收|查看完整|查看原问题|<details|<script>/);
 assert.equal((html.match(/aria-label="复制"/g)??[]).length,1);assert.equal(calls.details.message,original);assert.equal(calls.day.messageId,original.id);
});
test('multiple completed questions retain ordered pairing and plain multiline answers',()=>{
 const original={id:'multi',role:'user',text:'原始提交',interaction:{id:'exact',kind:'question',title:'',answers:[{question:'问题 B',text:'回答 B\n第二行'},{question:'问题 A',text:'回答 A'}]}};
 const {html}=render({messageId:original.id,original,media:[]});
 assert.ok(html.indexOf('问题 B')<html.indexOf('回答 B'));assert.ok(html.indexOf('回答 B')<html.indexOf('问题 A'));assert.match(html,/第二行/);
});

test('completed consultation retains original channel, quotes, media, references and uncertainty',()=>{
 const reference={kind:'text',source:{kind:'artifact',id:'result-synthetic',sha256:'a'.repeat(64),title:'合成引用'}};
 const quote={messageId:'source',text:'QUOTE_SENTINEL',annotation:'原注释'},media=[{assetId:'synthetic-file',revision:1,filename:'附件.txt'}];
 const original={id:'with-context',role:'user',text:'请结合附件',channelSource:{source:'telegram',entryLabel:'homer_work_bot'},interaction:{id:'exact',kind:'question',title:'请补充信息',answers:[{text:'请结合附件'}]}};
 const {html,calls}=render({messageId:original.id,original,media,quotes:[quote],resourceReferences:[reference],inputState:'uncertain'});
 for(const expected of ['Telegram@homer_work_bot','QUOTE_SENTINEL','原注释','附件.txt','合成引用','接收或结束结果待核实'])assert.ok(html.includes(expected),expected);
 assert.equal(calls.media.media,media);assert.equal(calls.quotes[0].quote,quote);assert.equal(calls.references[0],reference);
});

test('completed questions use the native read-only receipt, show every pair and have no navigation',()=>{
 const original={id:'receipt',role:'user',text:'原始答复',interaction:{id:'exact',kind:'question',title:'',answers:[{question:'问题 B',text:'回答 B\n第二行'},{question:'问题 A',text:'回答 A'}]}};
 const {html,calls}=render({messageId:original.id,original,media:[]});
 assert.match(html,/data-slot="question-flow"/);assert.match(html,/data-state="receipt"/);
 for(const text of ['问题 B','回答 B','第二行','问题 A','回答 A'])assert.ok(html.includes(text));
 assert.doesNotMatch(html,/completed-interaction-navigation|上一题|下一题|查看已回答的问题|\d\/\d/);
 assert.equal((html.match(/<button/g)??[]).length,1,'only original copy action remains');
 assert.equal(calls.details.message,original);
});

for(const text of ['你已允许本次操作','你已拒绝本次操作','你已取消本次请求'])test('approval receipt uses native card for '+text,()=>{
 const original={id:'approval-receipt',role:'user',text:'原始决定',interaction:{id:'exact',kind:'authorization',title:'具体操作',description:'说明\nnode /synthetic/检查.mjs',scope:'仅本次',answers:[{text}]}};
 const {html,calls}=render({messageId:original.id,original,media:[]});
 assert.match(html,/data-slot="approval-card"/);assert.match(html,/role="status"/);
 for(const value of ['具体操作','说明','node /synthetic/检查.mjs','仅本次',text])assert.ok(html.includes(value));
 assert.doesNotMatch(html,/Finished|Approved, running|Denied|completed-interaction-card|completed-interaction-answer|<details/);
 assert.equal((html.match(/<button/g)??[]).length,1,'only original copy action remains');
 assert.equal(calls.details.message,original);
});
test('unavailable approval retains its decision and explicit missing-request notice in native card',()=>{
 const original={id:'unavailable',role:'user',text:'允许本次操作',interaction:{id:'exact',kind:'authorization',title:'',unavailable:true,answers:[{text:'你已允许本次操作'}]}};
 const {html}=render({messageId:original.id,original,media:[]});
 assert.match(html,/data-slot="approval-card"/);assert.match(html,/原请求详情不可用。/);assert.match(html,/你已允许本次操作/);
});

test('unavailable consultation preserves its original title, answer and missing-request notice',()=>{
 const original={id:'unavailable-question',role:'user',text:'原始回答',interaction:{id:'exact',kind:'question',title:'原问题',unavailable:true,answers:[{text:'原始回答'}]}};
 const {html}=render({messageId:original.id,original,media:[]});
 for(const text of ['原问题','原始回答','原请求详情不可用。'])assert.ok(html.includes(text));
 assert.doesNotMatch(html,/data-slot="approval-card"|<details/);
});
