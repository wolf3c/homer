import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';import React from 'react';import {Inbox} from 'lucide-react';import {withDom} from './helpers/process-dom.mjs';
const base=new URL('../ui/vendor/task-status/',import.meta.url),require=createRequire(new URL('../ui/package.json',import.meta.url)),postcss=require('postcss');
test('compiled component CSS cannot leak global reset or place pseudo-elements inside :is',()=>{
 const sheet=postcss.parse(readFileSync(new URL('components.css',base),'utf8'));let rules=0;
 sheet.walkRules(rule=>{let parent=rule.parent;while(parent){if(parent.type==='atrule'&&parent.name==='keyframes')return;parent=parent.parent;}
  assert.ok(rule.selector.includes('.homer-task-status')||rule.selector.includes('&'),rule.selector);assert.doesNotMatch(rule.selector,/:is\([^)]*::/,'pseudo-elements invalidate a selector group inside :is');rules++;
 });assert.ok(rules>100);
});
test('animation custom-property references resolve after keyframe namespacing',()=>{
 const sheet=postcss.parse(readFileSync(new URL('components.css',base),'utf8')),defined=new Map(),references=new Set(),keyframes=new Set();let reducedMotion=false;
 sheet.walkAtRules('keyframes',rule=>keyframes.add(rule.params));
 sheet.walkDecls(decl=>{if(decl.prop.startsWith('--animate-'))defined.set(decl.prop,decl.value);for(const match of decl.value.matchAll(/var\((--animate-[\w-]+)/g))references.add(match[1]);if(decl.prop==='animation'&&decl.value==='none'&&decl.parent.type==='atrule'&&decl.parent.params==='(prefers-reduced-motion: reduce)'&&decl.parent.parent.selector?.includes('.motion-reduce\\:animate-none'))reducedMotion=true;});
 assert.ok(references.has('--animate-spin'),'the working status icon needs its compiled animation');
 for(const reference of references){assert.ok(defined.has(reference),'Undefined animation variable: '+reference);const name=defined.get(reference).split(/\s+/)[0];assert.match(name,/^homer-task-status-/);assert.ok(keyframes.has(name),'Undefined animation keyframes: '+name);}
 assert.equal(reducedMotion,true,'working animation must respect reduced motion');
});

const bundle=buildSync({entryPoints:['ui/vendor/task-status/task-card.tsx'],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',packages:'external'}),module={exports:{}};
Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports);
const {TaskCard}=module.exports,h=React.createElement;
test('TaskCard renders the host semantic status through the original disclosure and retains default states',async()=>withDom(async d=>{
 await d.render(h(TaskCard,{state:'waiting',label:'合成事项',statusLabel:'当时：收到成果待核对',statusIcon:h(Inbox)},'原事件正文'));
 const button=d.find(n=>n.tagName==='BUTTON');assert.equal(button.attrs['aria-expanded'],'false');
 assert.equal(d.find(n=>n.attrs.class==='sr-only').textContent,'当时：收到成果待核对');
 assert.ok(d.find(n=>n.attrs.class?.includes('lucide-inbox')));assert.equal(d.find(n=>n.attrs['data-slot']==='task-card-transcript'),undefined);
 await d.click(button);assert.equal(button.attrs['aria-expanded'],'true');assert.equal(d.find(n=>n.attrs['data-slot']==='task-card-transcript').textContent,'原事件正文');
 await d.click(button);assert.equal(d.find(n=>n.attrs['data-slot']==='task-card-transcript'),undefined);
 await d.remount();await d.render(h(TaskCard,{state:'working',label:'默认执行状态'}));
 assert.equal(d.find(n=>n.attrs.class==='sr-only').textContent,'working');assert.ok(d.find(n=>n.attrs.class?.includes('animate-spin')));
}));
