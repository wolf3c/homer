import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {draftQuotes} from '../ui/conversation-client.ts';
import {previewQuoteText,messageSourceParts,sourceQuote,sourceMessageText} from '../src/message-quote.ts';
const require=createRequire(import.meta.url);
function component(file,name,bindings){
 const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const source=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 const js=ts.transpileModule(source.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
 return Function('require','exports',...Object.keys(bindings),js+';return '+name)(require,{},...Object.values(bindings));
}
const nodes=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];
function actions({allowed=true,disabled=false,message={id:'source',text:'**原文** [资料](https://example.com/hidden)'}}={}){
 const quotes=[],notices=[];let focused=0,cleared=0;
 const Component=component('ui/message-details.tsx','RuntimeMessageActions',{useContext:()=>({canQuote:()=>allowed,appendQuote:q=>quotes.push(q)}),PreviewActionsContext:{},useAuiState:fn=>fn({thread:{isDisabled:disabled}}),useComposerInputFocus:()=>()=>focused++,useActionBarCopy:()=>({copy(){},isCopied:false}),previewQuoteText,messageSourceParts,sourceQuote,sourceMessageText,MessageActions:'actions',MessageTimestamp:'time',window:{getSelection:()=>({removeAllRanges(){cleared++;}})}});
 const tree=Component({message,write:async()=>{},busy:false,notice:'',onNotice:n=>notices.push(n)});
 return {bar:nodes(tree).find(n=>n.type==='actions'),quotes,notices,get focused(){return focused;},get cleared(){return cleared;}};
}
test('message quote action preserves trusted item identity and offers visible text',()=>{
 const f=actions({message:{id:'native-source',text:'stale summary',process:{sourceKind:'user',items:[{kind:'commentary',phase:'final_answer',id:'native-item',text:'**实际正文** [资料](https://example.com/hidden)',revision:1}]}}});
 assert.equal(typeof f.bar.props.onQuote,'function');f.bar.props.onQuote();
 assert.deepEqual(f.quotes,[{messageId:'native-source',text:'实际正文 资料',itemIds:['native-item']}]);assert.equal(f.focused,1);assert.equal(f.cleared,1);
});
test('message quote action respects composer exclusion and existing prefix limit',()=>{
 const blocked=actions({allowed:false});assert.equal(typeof blocked.bar.props.onQuote,'function');blocked.bar.props.onQuote();assert.equal(blocked.quotes.length,0);
 const long=actions({message:{id:'long',text:'x'.repeat(16001)}});long.bar.props.onQuote();assert.equal(long.quotes[0].text.length,16000);assert.ok(long.notices.some(Boolean));
 assert.equal(actions({disabled:true}).bar.props.quoteDisabled,true);
});
test('the grey excerpt is the source link and exposes no internal identifiers',()=>{
 const quote={messageId:'internal-message-id',itemIds:['internal-item-id'],text:'保留的灰色原文',annotation:'备注'},navigations=[];
 const Component=component('ui/homer-app.tsx','QuoteSource',{useContext:()=>q=>navigations.push(q),QuoteNavigationContext:{},useState:()=>['',()=>{}],useRef:v=>({current:v}),useEffect(){},QuoteBlock:{Root:p=>React.createElement('div',p),Text:p=>React.createElement('p',p)},MessageCirclePlus:'svg',window:{getSelection:()=>null}});
 const tree=Component({quote,index:0}),html=renderToStaticMarkup(tree),link=nodes(tree).find(n=>n.type==='a');
 assert.ok(link,'excerpt itself is keyboard reachable');assert.match(html,/保留的灰色原文/);assert.doesNotMatch(html.replace(/href="[^"]*"/g,''),/internal-message-id|internal-item-id/);
 link.props.onClick({currentTarget:{},preventDefault(){},stopPropagation(){}});assert.deepEqual(navigations,[quote]);
});

test('quote text uses the vendor default without losing the source payload',()=>{
 const quote={messageId:'long-source',text:'长引用。'.repeat(1000),annotation:'保留批注'},navigations=[],Text='quote-text';
 const Component=component('ui/homer-app.tsx','QuoteSource',{useContext:()=>q=>navigations.push(q),QuoteNavigationContext:{},QuoteBlock:{Root:'quote-block',Text},MessageCirclePlus:'svg',window:{getSelection:()=>null}});
 const tree=Component({quote,index:1}),text=nodes(tree).find(n=>n.type===Text);
 assert.equal(text.props.children,quote.text);assert.equal(text.props.className,undefined);assert.equal(tree.props.href,'#message-long-source');
 tree.props.onClick({currentTarget:{},preventDefault(){},stopPropagation(){}});assert.deepEqual(navigations,[quote]);
});
test('user quotes keep each annotation directly after its source as ordinary body text',()=>{
 const QuoteSource='quote-source',Parts='message-parts';
 const render=metadata=>component('ui/homer-app.tsx','UserMessage',{Fragment:React.Fragment,useAuiState:fn=>fn({message:{metadata:{custom:metadata},content:[{type:'text',text:'普通正文'}]}}),draftQuotes,MessageDaySeparator:'day',MessagePrimitive:{Root:'article',Parts},QuoteSource,referencesOf:()=>[],ResourceReferenceBlock:'resource',MediaAttachments:'media',Markdown:'markdown',CompletedInteractionCard:'interaction',InactiveInteractionNotes:'inactive',MessageDetails:'details',MessageTimestamp:'time'})();
 const quotes=[{messageId:'a',text:'原文甲',annotation:'  第一段备注\n**用户原样输入**  '},{messageId:'b',text:'原文乙',annotation:'第二段备注'},{messageId:'c',text:'原文丙',annotation:''}];
 const metadata={messageId:'quoted',quotes},before=structuredClone(metadata),tree=render(metadata);
 const sequence=nodes(tree).filter(n=>n.type===QuoteSource||n.type==='p'||n.type===Parts);
 assert.deepEqual(sequence.map(n=>n.type===QuoteSource?n.props.quote:n.type==='p'?n.props.children:'普通正文'),[quotes[0],quotes[0].annotation,quotes[1],quotes[1].annotation,quotes[2],'普通正文']);
 for(const p of sequence.filter(n=>n.type==='p'))assert.deepEqual(p.props.style,{whiteSpace:'pre-wrap'});
 for(const div of nodes(tree).filter(n=>n.type==='div'&&n.props.children?.type==='p'))assert.equal(div.props.className,'markdown');
 assert.ok(!nodes(tree).some(n=>/message-quotes|message-quote$|quote-annotation/.test(n.props?.className??'')));
 assert.ok(!nodes(tree).some(n=>n.type==='span'));assert.deepEqual(metadata,before);
 const legacy=render({messageId:'legacy',quote:{messageId:'legacy-source',text:'旧单引用'}});assert.equal(nodes(legacy).filter(n=>n.type===QuoteSource).length,1);
 const plain=render({messageId:'plain'});assert.equal(nodes(plain).filter(n=>n.type===QuoteSource||n.type==='p').length,0);assert.equal(nodes(plain).filter(n=>n.type===Parts).length,1);
});
