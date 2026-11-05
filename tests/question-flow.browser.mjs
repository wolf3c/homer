// Actual product UI, synthetic HTTP/SSE and an isolated Chrome profile only.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {buildApprovalUI} from './helpers/build-approval-ui.mjs';
import {composerFixture} from './fixtures/composer-browser-server.mjs';
import {isolatedChrome} from './web-history-browser-cdp.mjs';
const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/question-flow-simplification-20261023');mkdirSync(destination,{recursive:true});
const webDir=process.env.HOMER_COMPONENT_BUILD??(process.argv.includes('--reuse-build')?join(destination,'web'):await buildApprovalUI(join(destination,'web')));
const browser=await isolatedChrome(destination),results=[];
const make=(id,questions)=>({id,runId:'main-native:'+id,kind:'question',workTitle:'主对话',question:'请补充本轮信息。',reason:'答复交给荷马继续处理，不授予操作权限。',questions});
const closed=make('closed',[{id:'format',question:'使用什么格式？',options:[{label:'Markdown'},{label:'表格'}],allowOther:false},{id:'audience',question:'面向谁？',options:[{label:'团队'},{label:'所有人'}],allowOther:false}]);
const mixed=make('mixed',[{id:'format',question:'使用什么格式？',options:[{label:'Markdown',description:'保留原有说明'}],allowOther:false},{id:'notes',question:'补充说明',options:[],allowOther:true}]);
const free={id:'worker-question',runId:'original-worker',kind:'question',question:'这项工作还需要哪些说明？',reason:'缺少实际用户信息。'};
try{for(const width of [1440,390,320]){
 let mode='success',held=[],f;const submissions=[];
 f=await composerFixture({webDir,branding:resolve('assets/branding/odysseus-20261030/homer-odysseus-64.png'),interaction({body,json}){
  submissions.push(body);if(mode==='hold'){held.push(()=>{f.accept(body);json({fresh:true,replyId:'synthetic-reply'});});return;}
  if(mode==='unknown')return json({error:'synthetic_unknown'},503);
  f.accept(body);json({fresh:true,replyId:'synthetic-reply'});
 }});
 const p=await browser.page(f.url,width),checks=[];
 const wait=async fn=>{try{await p.until('Boolean(('+String(fn)+')())',15000);}catch(error){throw Error('width='+width+' checks='+JSON.stringify(checks)+' submissions='+JSON.stringify(submissions)+' body='+await p.evaluate(()=>document.body.innerText.slice(-2200)),{cause:error});}};
 const loaded=()=>wait(()=>document.querySelector('[contenteditable=true]')&&document.querySelector('.interaction-question')&&!document.body.textContent.includes('正在恢复主对话'));
 const click=async label=>{await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button: '+JSON.stringify([...document.querySelectorAll('button')].map(b=>b.textContent.trim()))+' BODY '+document.body.innerText.slice(-1600));b.click();})()`);};
 const fill=async text=>{await p.evaluate(()=>{const e=document.querySelector('[contenteditable=true]');e.focus();const r=document.createRange();r.selectNodeContents(e);const s=getSelection();s.removeAllRanges();s.addRange(r);});await p.command('Input.insertText',{text});};
 const value=()=>p.evaluate(()=>document.querySelector('[contenteditable=true]').innerText.replace(/^\n$/,''));
 let visited=false;
 const scene=async item=>{mode='success';submissions.length=0;f.reset({threadId:'questions-'+width,features:{nativeQuestionAnswers:1,draftUpload:true},messages:[],interactions:[item]});if(visited)await p.command('Page.reload');else{await p.command('Page.navigate',{url:f.url});visited=true;}await loaded();};
 const geometry=async()=>{assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const sizes=await p.evaluate(()=>[...document.querySelectorAll('.interaction-question button,.composer-answer-target button')].map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height})));assert.ok(sizes.every(r=>r.width>0&&r.height>0));};
 try{
  await scene(closed);await p.evaluate(()=>[...document.querySelectorAll('[data-slot=question-flow] button')].find(b=>b.textContent.trim()==='Markdown').focus());await p.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await p.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});assert.equal(submissions.length,0);await wait(()=>document.querySelector('[data-slot=question-flow]')?.textContent.includes('面向谁'));
  await click('上一题');await click('Markdown');mode='unknown';await click('团队');await wait(()=>document.querySelector('.interaction-question')?.textContent.includes('核对并重试原答复'));
  assert.equal(submissions.length,1);assert.deepEqual(submissions[0].questionAnswers,{format:['Markdown'],audience:['团队']});assert.doesNotMatch(submissions[0].text,/^\{/);
  const original=submissions[0];await p.command('Page.reload');await loaded();await wait(()=>document.querySelector('.interaction-question')?.textContent.includes('核对并重试原答复'));
  mode='success';await click('核对并重试原答复');await wait(()=>document.querySelector('[data-slot=question-flow]')?.dataset.state==='receipt');assert.deepEqual(submissions[1],original);checks.push('closed choices, Back, immediate last submission, unknown receipt, refresh and exact retry');
  await geometry();await p.screenshot('closed-'+width+'.png');

  await p.evaluate(()=>{sessionStorage.clear();localStorage.clear();});await scene(mixed);
  await click('Markdown');await p.evaluate(()=>{const t=document.querySelector('[data-slot=elicitation-form] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'第一行\n第二行');t.dispatchEvent(new Event('input',{bubbles:true}));});
  await p.command('Page.reload');await loaded();await wait(()=>document.querySelector('textarea')?.value==='第一行\n第二行');
  assert.equal(await p.evaluate(()=>[...document.querySelectorAll('[data-slot=elicitation-form] button')].some(b=>b.textContent.includes('拒绝'))),false);
  await geometry();await p.screenshot('mixed-'+width+'.png');await click('提交答复');await wait(()=>document.querySelector('[data-slot=elicitation-form]')?.textContent.includes('已接收本轮输入'));
  assert.deepEqual(submissions[0].questionAnswers,{format:['Markdown'],notes:['第一行\n第二行']});checks.push('mixed fields, multiline draft refresh, no false decline and structured receipt');

  await p.evaluate(()=>{sessionStorage.clear();localStorage.clear();});await scene(free);
  await fill('原普通草稿');await p.evaluate(()=>{const e=document.querySelector('[contenteditable=true]'),d=new DataTransfer();d.items.add(new File(['synthetic'],'合成附件.txt',{type:'text/plain'}));e.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));});
  await wait(()=>document.querySelector('.aui-attachment-root'));await p.until("JSON.parse(sessionStorage.getItem('homer-draft:questions-"+width+"')||'{}').attachments?.length===1");await click('回答此问题');await wait(()=>document.querySelector('.composer-answer-target'));assert.equal(await value(),'');assert.equal(await p.evaluate(()=>Object.values(sessionStorage).some(v=>v.includes('answerItem')&&v.includes('合成附件.txt'))),true,'original draft retains attachment on entering answer');
  assert.equal(await p.evaluate(()=>!!document.querySelector('.composer-context')),false);
  await fill('用户补充的事实');await p.command('Input.imeSetComposition',{text:'补充',selectionStart:2,selectionEnd:2});await p.command('Input.insertText',{text:'补充'});
  assert.equal(submissions.length,0);await fill('用户补充的事实');await p.command('Page.reload');await loaded();await wait(()=>document.querySelector('.composer-answer-target'));assert.equal(await value(),'用户补充的事实');
  if(width<600){await p.command('Emulation.setDeviceMetricsOverride',{width,height:520,deviceScaleFactor:1,mobile:false});assert.ok(await p.evaluate(()=>document.querySelector('.send-button').getBoundingClientRect().bottom<=innerHeight+1));await p.command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});}await geometry();await p.screenshot('free-'+width+'.png');await p.evaluate(()=>document.querySelector('.send-button').click());await wait(()=>!document.querySelector('.composer-answer-target'));
  assert.equal(await value(),'原普通草稿');assert.equal(submissions[0].interactionId,free.id);assert.equal(submissions[0].questionAnswers,undefined);assert.equal(submissions[0].attachments,undefined);
  assert.ok(await p.evaluate(()=>!!document.querySelector('.aui-attachment-root')),'confirmed attachment survives targeted answer');assert.equal(f.received.discards.length,0);
  checks.push('targeted Composer, ordinary draft and attachment preservation, IME and refresh');

  f.update({interactions:[{...free,id:'expired'}]});await wait(()=>document.getElementById('task-interaction-expired'));await click('回答此问题');await wait(()=>document.querySelector('.composer-answer-target'));await fill('失效前写下的文字');f.update({interactions:[],inactiveInteractions:[{id:'expired',kind:'question',state:'expired',sourceRequestId:'synthetic'}]});
  await wait(()=>document.querySelector('.send-button')?.disabled);assert.equal(await value(),'失效前写下的文字');await click('退出答复');assert.equal(await value(),'原普通草稿');await wait(()=>document.body.textContent.includes('已保留的答复内容'));assert.ok(await p.evaluate(()=>document.body.textContent.includes('失效前写下的文字')));checks.push('expired target retains reachable text and never retargets');

  await p.evaluate(()=>{sessionStorage.clear();localStorage.clear();});await scene(make('late',[{id:'notes',question:'补充说明',options:[{label:'默认',description:'也可以填写其他内容'}],allowOther:true}]));assert.ok(await p.evaluate(()=>document.body.textContent.includes('也可以填写其他内容')));await click('回答此问题');await wait(()=>document.querySelector('.composer-answer-target'));await fill('{"literal":true}\n第二行');mode='hold';await p.evaluate(()=>document.querySelector('.send-button').click());await wait(()=>document.querySelector('.composer-answer-target'));
  for(let n=0;submissions.length===0&&n<150;n++)await new Promise(done=>setTimeout(done,20));assert.equal(submissions.length,1);await click('退出答复');await fill('之后写的新普通草稿');
  for(const release of held.splice(0))release();await new Promise(done=>setTimeout(done,120));assert.equal(await value(),'之后写的新普通草稿');assert.deepEqual(submissions[0].questionAnswers,{notes:['{"literal":true}\n第二行']});checks.push('literal JSON text, native free answer and late ACK preserves newer ordinary draft');
  await p.evaluate(()=>{sessionStorage.clear();localStorage.clear();});await scene(closed);f.update({features:{draftUpload:true}});await new Promise(done=>setTimeout(done,80));await click('Markdown');await click('团队');await wait(()=>document.querySelector('.interaction-question')?.textContent.includes('本轮输入已接收'));
  assert.equal(submissions[0].questionAnswers,undefined);assert.deepEqual(JSON.parse(submissions[0].text),{format:['Markdown'],audience:['团队']});checks.push('older service uses exact legacy JSON wire without dropping answers');
  await p.evaluate(()=>{sessionStorage.clear();localStorage.clear();});
  await p.evaluate(`localStorage.clear();localStorage.setItem('homer-interaction:questions-${width}:closed:questions',JSON.stringify({format:'表格',audience:'所有人',unknown:'保留旧文字'}));`);
  await scene(closed);assert.equal(submissions.length,0);assert.ok(await p.evaluate(()=>document.body.textContent.includes('保留旧文字')));await click('表格');await click('所有人');await wait(()=>document.querySelector('[data-slot=question-flow]')?.dataset.state==='receipt');
  assert.deepEqual(submissions[0].questionAnswers,{format:['表格'],audience:['所有人']});f.update({interactions:[]});await wait(()=>document.body.textContent.includes('已保留的答复内容'));assert.ok(await p.evaluate(()=>document.body.textContent.includes('保留旧文字')));checks.push('legacy choice draft imports without submission and unmapped old text stays reachable');
  assert.deepEqual(p.errors,[]);assert.deepEqual(p.blocked,[]);results.push({width,checks});
 }finally{for(const release of held.splice(0))release();await p.close();await f.close();}
}
}finally{await browser.close();}
writeFileSync(join(destination,'browser-results.json'),JSON.stringify({source:'synthetic',results},null,2));console.log(JSON.stringify(results,null,2));
