import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import {React,withDom} from './helpers/process-dom.mjs';

const compiled=buildSync({entryPoints:[fileURLToPath(new URL('../ui/annotation-comment-form.tsx',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'}});
const module={exports:{}};Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const Form=module.exports.AnnotationCommentForm,h=React.createElement;

test('busy controlled form exposes its textarea ref and blocks cancel/delete until its owner completes',async()=>withDom(async d=>{
 const calls=[],ref=React.createRef(),props={ref,title:'合成备注',value:'原受控内容',onChange:()=>{},onSave:()=>calls.push('save'),onCancel:()=>calls.push('cancel'),onDelete:()=>calls.push('delete')};
 const button=text=>d.find(n=>n.tagName==='BUTTON'&&n.textContent===text);
 await d.render(h(Form,{...props,busy:true}));
 assert.equal(d.find(n=>n.tagName==='FORM').getAttribute('aria-busy'),'true');
 assert.equal(ref.current.tagName,'TEXTAREA');assert.ok('disabled' in ref.current.attrs);
 for(const text of ['删除','取消','保存'])assert.ok('disabled' in button(text).attrs);
 await d.click(button('删除'));await d.click(button('取消'));assert.deepEqual(calls,[]);
 await d.render(h(Form,props));assert.equal('disabled' in ref.current.attrs,false);
 await d.click(button('取消'));await d.click(button('删除'));assert.deepEqual(calls,['cancel','delete']);
}));

test('instances keep separate label/error identities and optional delete follows the owner',async()=>withDom(async d=>{
 const props={title:'同名备注',value:'内容',onChange:()=>{},onSave:()=>{},onCancel:()=>{},error:'合成错误'};
 await d.render(h(React.Fragment,null,h(Form,props),h(Form,{...props,onDelete:()=>{}})));
 const inputs=d.all().filter(n=>n.tagName==='TEXTAREA'),labels=d.all().filter(n=>n.tagName==='LABEL');
 assert.notEqual(inputs[0].getAttribute('id'),inputs[1].getAttribute('id'));
 for(let i=0;i<2;i++){
  assert.equal(labels[i].getAttribute('for'),inputs[i].getAttribute('id'));
  assert.equal(inputs[i].getAttribute('aria-invalid'),'true');
  assert.equal(d.find(n=>n.getAttribute('id')===inputs[i].getAttribute('aria-describedby')).textContent,'合成错误');
 }
 assert.equal(d.all().filter(n=>n.getAttribute('aria-label')==='删除此批注').length,1);
}));

test('Enter saves once, Shift+Enter stays multiline and IME Enter/Escape remain composition input',async()=>withDom(async d=>{
 let saved=0;await d.render(h(Form,{title:'引用评论',excerpt:'相同原文',value:'独立评论',onChange:()=>{},onSave:()=>{saved++;},onCancel:()=>{}}));
 const area=d.find(n=>n.tagName==='TEXTAREA'),form=d.find(n=>n.tagName==='FORM');
 // Invoke the reconciled production handlers; native browser defaults/layout
 // are outside this DOM harness and remain a separate browser acceptance gap.
 const props=node=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))];
 function dispatch(type,target,extra={}){
  const event={type,target,currentTarget:target,nativeEvent:extra,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};
  props(target).onKeyDown(event);if(!event.stopped)props(form).onKeyDown(event);return event;
 }
 area.form=form;form.requestSubmit=()=>props(form).onSubmit({preventDefault(){}});
 const enter=dispatch('keydown',area,{key:'Enter',keyCode:13});assert.equal(saved,1);assert.equal(enter.defaultPrevented,true);
 const newline=dispatch('keydown',area,{key:'Enter',keyCode:13,shiftKey:true});assert.equal(saved,1);assert.equal(newline.defaultPrevented,false);
 for(const key of ['Enter','Escape']){const ime=dispatch('keydown',area,{key,keyCode:229,isComposing:true});assert.equal(ime.stopped,true);assert.equal(ime.defaultPrevented,false);}
 assert.equal(saved,1);
}));
