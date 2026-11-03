// Requirement-derived synthetic regression cases from the preview code review.
// Uses the real built UI and HTTP queue with no account or model execution.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fixture} from './web-history-followup-fixture.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
import {previewQuoteText} from '../src/message-quote.js';

const destination=resolve(process.env.HOMER_REVIEW_EVIDENCE_ROOT??'.codex/scratch/preview-reference-fixes-20261023/browser');
mkdirSync(destination,{recursive:true});
const formats=[
 {id:'result-review-markdown',title:'Review.md',mime:'text/markdown',text:'Cost is $$x_i^2$$ today.\n\n$$\n\\frac{a_b}{c_d}\n$$'},
 ...['A','B'].map(name=>({id:'result-review-'+name,title:name+'.html',mime:'text/html',text:'<!doctype html><h1>HTML '+name+'</h1><script>document.body.dataset.executed="'+name+'"</script>'})),
 {id:'result-review-mixed',title:'Mixed.md',mime:'text/markdown',text:'Before $x$ after.\n\n```txt\n$$literal$$\n```'},
 {id:'result-review-invalid-inline',title:'Invalid-inline.md',mime:'text/markdown',text:'Before $\\frac{$ after.'},
 {id:'result-review-invalid-display',title:'Invalid-display.md',mime:'text/markdown',text:'Before\n\n$$\n\\frac{\n$$\n\nAfter'},
 {id:'result-review-fenced-math',title:'Fenced-math.md',mime:'text/markdown',text:'Before $a$\n\n```math\nx^2 + y^2\n= z^2\n```\n\nAfter'},
 {id:'result-review-fenced-invalid',title:'Fenced-invalid.md',mime:'text/markdown',text:'Before\n\n```math\n\\frac{\n```\n\nAfter'},
].map(file=>({...file,sha256:createHash('sha256').update(file.text).digest('hex')}));
const f=await fixture(4,'after'),checks=[];let chrome;
const read=f.bridge.artifact.bind(f.bridge);
f.bridge.artifact=async id=>{
 const file=formats.find(file=>file.id===id);
 return file?{filename:file.title,mime:file.mime,data:Buffer.from(file.text).toString('base64'),sha256:file.sha256}:read(id);
};
for(const owner of [f.bridge,f.bridge.history]){
 const state=owner.state.bind(owner);
 owner.state=async()=>{const value=await state();return {...value,artifacts:[...(value.artifacts??[]),...formats.map(({id,title})=>({id,title,messageId:'node-3',workTitle:'Synthetic review'}))]};};
}
try{
 chrome=await isolatedChrome(destination);
 for(const width of [1440,390,320]){
  const p=await chrome.page(f.server.url,width),ev=code=>p.evaluate(code);
  const select=async id=>{
   if(width<=800&&await ev(()=>!!document.querySelector('#canvas-panel'))){await ev(()=>document.querySelector('.canvas-collapse, .conversation-header [aria-controls=canvas-panel][aria-expanded=true]:not([aria-hidden=true] *)').click());await p.until(()=>!document.querySelector('#canvas-panel'));}
   const title=formats.find(file=>file.id===id)?.title??'synthetic-preview.html';
   await p.until(`Array.from(document.querySelectorAll('.file-list-open')).some(b=>b.getAttribute('aria-label')===${JSON.stringify('预览 '+title)})`);
   await ev(`(()=>{const b=[...document.querySelectorAll('.file-list-open')].find(b=>b.getAttribute('aria-label')===${JSON.stringify('预览 '+title)});if(!b)throw Error('missing chat file');b.scrollIntoView({block:'center'});b.focus();b.click();})()`);
   await p.until(()=>!!document.querySelector('#canvas-panel'));
  };
  const open=select;
  try{
   await p.navigate();await p.until(()=>!!document.querySelector('.conversation-header [aria-controls="canvas-panel"]'));
   const selections=[
    [formats[0].id,'.canvas-markdown p','Cost is $x_i^2$ today.'],
    [formats[0].id,'.canvas-markdown .katex-html .mord','$x_i^2$'],
    [formats[0].id,'.canvas-markdown .katex-display','$$\n\\frac{a_b}{c_d}\n$$'],
    ['result-review-mixed','.canvas-markdown','Before $x$ after.\n\n$$literal$$'],
    ['result-review-invalid-inline','.canvas-markdown','Before $\\frac{$ after.'],
    ['result-review-invalid-display','.canvas-markdown','Before\n\n$$\n\\frac{\n$$\n\nAfter'],
    ['result-review-fenced-math','.canvas-markdown','Before $a$\n\nx^2 + y^2\n= z^2\n\nAfter'],
    ['result-review-fenced-math','.canvas-markdown .katex-display','x^2 + y^2\n= z^2'],
    ['result-review-fenced-math','.canvas-markdown .katex-display .mord','x^2 + y^2\n= z^2'],
    ['result-review-fenced-invalid','.canvas-markdown','Before\n\n\\frac{\n\nAfter'],
   ];
   const normalize=text=>text.replace(/\s+/g,' ').trim();
   for(const [fileId,selector,expected] of selections){
    const file=formats.find(file=>file.id===fileId);
    await open(fileId);await p.until(()=>!!document.querySelector('.canvas-markdown :is(.katex,.katex-error)'));
    if(fileId==='result-review-fenced-math'&&selector==='.canvas-markdown'){
     assert.equal(await ev(()=>document.querySelectorAll('.canvas-markdown .katex-display').length),1);
     await p.screenshot('fenced-math-'+width+'.png');
    }
    await ev(`(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector(${JSON.stringify(selector)}));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));})()`);
    await p.until(()=>!!document.querySelector('.preview-selection-positioner button:not(:disabled)'));
    await ev(()=>document.querySelector('.preview-selection-positioner button').click());
    await p.until(()=>!!document.querySelector('.text-annotation-editor textarea'));
    await p.command('Input.insertText',{text:'解释这处公式'});
    await ev(()=>document.querySelector('.text-annotation-editor button[type=submit]').click());
    await p.until(()=>!document.querySelector('.text-annotation-editor'));
    await ev(()=>document.querySelector('.text-annotation-actions>button').click());
    await p.until(()=>!!document.querySelector('.composer-area .preview-reference'));
    if(width<=800)await p.until(()=>!document.querySelector('#canvas-panel'));
    const reference=await ev(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')).resourceReference);
    assert.equal(normalize(reference.annotations.at(-1).text),normalize(expected));
    assert.ok(normalize(previewQuoteText(file.text)).includes(normalize(expected)));
    await ev(()=>document.querySelector('[contenteditable=true]').focus());await p.command('Input.insertText',{text:'Explain this formula'});
    const count=f.submitted.length;
    await ev(()=>document.querySelector('.send-button').click());
    for(let n=0;n<200&&f.submitted.length===count;n++)await new Promise(done=>setTimeout(done,20));
    assert.equal(f.submitted.length,count+1);
    assert.equal(normalize(f.inputs.list().find(item=>item.input.requestId===f.submitted.at(-1)).input.resourceReference.annotations.at(-1).text),normalize(expected));
    checks.push({width,label:'canonical math selection reaches queue',fileId,selector});
   }
   if(width>800){
    await open('result-review-A');await p.until(()=>document.querySelector('#canvas-panel iframe')?.srcdoc.includes('HTML A'));
    await p.command('Network.enable');await p.command('Network.setCacheDisabled',{cacheDisabled:true});
    await p.command('Network.emulateNetworkConditions',{offline:false,latency:10,downloadThroughput:85000,uploadThroughput:85000});
    await ev(()=>document.querySelector('.html-annotation-toggle').click());
    await select('result-review-B');await p.until(()=>document.querySelector('#canvas-panel iframe')?.srcdoc.includes('HTML B'),5000);
    await p.until(()=>performance.getEntriesByType('resource').some(entry=>/\/assets\/runtime-.*\.js/.test(entry.name)),15000);
    await p.command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await new Promise(done=>setTimeout(done,100));
    assert.equal(await ev(()=>document.querySelector('#canvas-panel iframe')?.getAttribute('sandbox')),'','late A callback must not execute B');
    assert.ok(await ev(()=>document.querySelector('#canvas-panel iframe')?.srcdoc.includes('HTML B')));
    await select('result-review-A');await p.until(()=>document.querySelector('#canvas-panel iframe')?.srcdoc.includes('HTML A'));
    assert.equal(await ev(()=>document.querySelector('#canvas-panel iframe')?.getAttribute('sandbox')),'','returning to A still requires an explicit run');
    await p.screenshot('late-annotation-remains-static.png');
    checks.push({width,label:'switching during annotation loading keeps both HTML files in static mode'});
   }
   const beforeLimit=f.submitted.length;
   await ev(()=>{
    sessionStorage.setItem('homer-draft:synthetic-history',JSON.stringify({text:'',quotes:[],requestId:'synthetic-limit-draft',resourceReference:{kind:'web',source:{kind:'web',messageId:'node-3',sourceId:'link-1',url:'https://example.com/',title:'Synthetic draft source'},annotations:[{id:'draft-note',element:'button',elementPath:'#target',comment:'x'.repeat(9000),x:0,y:0}]}}));
   });
   await p.navigate();await p.until(()=>!!document.querySelector('.composer-area .preview-reference'));
   await ev(()=>document.querySelector('[contenteditable=true]').focus());await p.command('Input.insertText',{text:'y'.repeat(16000)});
   await p.until(()=>document.querySelector('.draft-notice')?.textContent.includes('合计过长'));
   assert.equal(await ev(()=>document.querySelector('.send-button').disabled),true);
   await p.navigate();await p.until(()=>document.querySelector('.draft-notice')?.textContent.includes('合计过长'));
   assert.equal(await ev(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')).text.length),16000);
   await ev(()=>{
    const editor=document.querySelector('[contenteditable=true]');editor.focus();
    const range=document.createRange();range.selectNodeContents(editor);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
   });
   await p.until(()=>getSelection()?.toString().length===16000,5000);
   await p.command('Input.insertText',{text:'Short requirement'});
   await p.until(()=>!document.querySelector('.send-button').disabled,5000);
   assert.equal(await ev(()=>JSON.parse(sessionStorage.getItem('homer-draft:synthetic-history')).text),'Short requirement');
   assert.equal(f.submitted.length,beforeLimit);
   checks.push({width,label:'overlong intent keeps its draft and becomes sendable after shortening'});
   assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);
  }catch(error){await p.screenshot('failure-'+width+'.png');throw error;}finally{await p.close();}
 }
 writeFileSync(join(destination,'browser-results.json'),JSON.stringify({passed:true,checks,browser:chrome.version},null,2));
 console.log(JSON.stringify({passed:true,checks:checks.length}));
}finally{try{await chrome?.close();}finally{await f.close();}}
