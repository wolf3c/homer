import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
const result=buildSync({entryPoints:['ui/message-source-selection.ts'],bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent'});
const m={exports:{}};Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),m,m.exports);
const {captureSourceQuote}=m.exports;
// Browser Range behavior needs separate DOM verification; this test exercises the
// real capture boundary with a tiny explicit Range double, not a DOM substitute.
function selection({ids=['a','b'],text='A B',cross=false,model=true}={}){
 const root={dataset:{conversationMessage:'node',messageSource:model?'model':'host'},querySelectorAll:selector=>selector==='[data-message-item-id]'?ids.map(id=>({dataset:{messageItemId:id},textContent:id})):[],getAttribute:()=>'',contains:()=>true,ownerDocument:{createRange(){return {selectNodeContents(){},setStart(){},setEnd(){}};}}};
 const endRoot=cross?{}:root;
 const node=owner=>({nodeType:1,closest:()=>owner});
 return {rangeCount:1,isCollapsed:false,toString:()=>text,getRangeAt:()=>({startContainer:node(root),endContainer:node(endRoot),intersectsNode:()=>true,cloneRange(){return {selectNodeContents(){},compareBoundaryPoints:()=>0,toString:()=>text};}})};
}
test('source capture records ordered item IDs before clearing selection, rejects cross-message and empty model sources',()=>{
 assert.deepEqual(captureSourceQuote(selection()),{messageId:'node',text:'A B',itemIds:['a','b']});
 assert.equal(captureSourceQuote(selection({cross:true})),undefined);
 assert.equal(captureSourceQuote(selection({ids:Array.from({length:201},(_,i)=>String(i))})),undefined);
 assert.equal(captureSourceQuote(selection({ids:[]})),undefined);
 assert.deepEqual(captureSourceQuote(selection({ids:[],model:false})),{messageId:'node',text:'A B'});
});

// Tiny logical-flow nodes exercise exact identity/hash/offset rules. They make no
// claim about native selection layout or scrolling.
test('logical positions distinguish repeated occurrences and refuse missing sources, context/hash drift and unloaded items',async()=>{
 const old={Node:globalThis.Node,Element:globalThis.Element,document:globalThis.document};
 class E{
  constructor(text='',id){this.nodeType=1;this.tagName='SPAN';this.childNodes=[{nodeType:3,textContent:text,parentElement:this}];this.dataset=id?{messageItemId:id}:{};this.isConnected=true;}
  matches(){return false;}hasAttribute(){return false;}
 }
 const first=new E('same ','first'),second=new E('same','second');const body=new E();body.tagName='DIV';body.childNodes=[first,second];
 const text='same same';let present=true,items=[first,second];
 class R{
  setStart(node,offset){this.startContainer=node;this.startOffset=offset;}
  setEnd(node,offset){this.endContainer=node;this.endOffset=offset;}
  cloneRange(){const r=new R();Object.assign(r,this);return r;}
  absolute(node,offset){return (node===second.childNodes[0]?5:0)+offset;}
  intersectsNode(item){const start=item===second?5:0,end=item===first?5:9;return this.absolute(this.startContainer,this.startOffset)<=end&&this.absolute(this.endContainer,this.endOffset)>=start;}
  selectNodeContents(item){this.setStart(item.childNodes[0],0);this.setEnd(item.childNodes[0],item.childNodes[0].textContent.length);}
  compareBoundaryPoints(mode,range){return this.absolute(mode===0?this.startContainer:this.endContainer,mode===0?this.startOffset:this.endOffset)-this.absolute(mode===0?range.startContainer:range.endContainer,mode===0?range.startOffset:range.endOffset);}
  toString(){return text.slice(this.absolute(this.startContainer,this.startOffset),this.absolute(this.endContainer,this.endOffset));}
 }
 const root={dataset:{conversationMessage:'source'},querySelectorAll:selector=>selector==='[data-message-item-id]'?items:[body],ownerDocument:{createRange:()=>new R()}};
 globalThis.Node={TEXT_NODE:3};globalThis.Element=E;globalThis.document={getElementById:()=>present?root:null,createRange:()=>new R()};
 try{
  const {completeSourceQuote,locateSourceQuote}=m.exports;
  const anchor={format:'preview-text-v1',representation:'markdown',start:5,end:9,exact:'same',prefix:'same ',suffix:''};
  const quote=await completeSourceQuote({quote:{messageId:'source',text:'same',itemIds:['second']},anchor,flowText:text});
  assert.match(quote.position.sourceHash,/^[a-f0-9]{64}$/);
  const range=await locateSourceQuote(quote);assert.ok(range);assert.equal(range.startContainer,second.childNodes[0]);assert.equal(range.startOffset,0);
  assert.equal(await locateSourceQuote({...quote,position:{...quote.position,sourceHash:'0'.repeat(64)}}),undefined);
  assert.equal(await locateSourceQuote({...quote,position:{...quote.position,prefix:'wrong'}}),undefined);
  items=[first];assert.equal(await locateSourceQuote(quote),undefined);items=[first,second];
  present=false;assert.equal(await locateSourceQuote(quote),undefined);present=true;
  assert.equal(await locateSourceQuote({messageId:'source',text:'same'}),undefined);
  second.childNodes[0].textContent='changed';assert.equal(await locateSourceQuote(quote),undefined);
 }finally{Object.assign(globalThis,old);}
});
