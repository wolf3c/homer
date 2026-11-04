import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {referencesOf,referenceKey} from '../src/preview-reference.js';
import {renderToStaticMarkup} from 'react-dom/server';

// Exercise the production UserMessage boundary without starting a backend.
// Adjacent date, copy, quote and media components are boundary doubles;
// the separate queue's lifecycle is covered by message-history-recovery.
const require=createRequire(import.meta.url);
const source=readFileSync(process.env.HOMER_BUBBLE_SOURCE??new URL('../ui/homer-app.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('homer-app.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='UserMessage');
const js=ts.transpileModule('export '+declaration.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;

function render(metadata){
 const calls={};
 const exports={};
 Function('require','exports','useAuiState','draftQuotes','MessagePrimitive','Markdown','MediaAttachments','MessageDetails','MessageDaySeparator','MessageTimestamp','InactiveInteractionNotes','QuoteSource','referencesOf','referenceKey','ResourceReferenceBlock',js)(
  require,exports,selector=>selector({message:{metadata:{custom:metadata},content:[{type:'text',text:metadata.original?.text??''}]}}),value=>value.quotes??(value.quote?[value.quote]:[]),
  {Root:props=>React.createElement('article',props),Parts:()=>React.createElement('p',null,metadata.original?.text)},()=>null,
  props=>{calls.media=props;return props.media.length?React.createElement('figure',null,props.media.map(m=>m.filename).join(', ')):null;},
  props=>{calls.details=props;return props.message.text?React.createElement('button',{'aria-label':'复制'},'复制'):null;},
  props=>{calls.day=props;return null;},props=>{calls.timestamp=props;return null;},
  props=>{calls.inactive=props;return null;},props=>{(calls.quotes??=[]).push(props);return React.createElement('blockquote',null,props.quote.text);},
  referencesOf,referenceKey,props=>{(calls.references??=[]).push(props.reference);return React.createElement('aside',null,props.reference.source.title);}
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
