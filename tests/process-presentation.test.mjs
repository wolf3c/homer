import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProcessNodeView,ProcessMessageContent} from './helpers/process-ui-loader.mjs';
import {withDom,React,visibleText} from './helpers/process-dom.mjs';
import {projectConversation} from '../src/conversation-projection.ts';
const h=React.createElement;
const node={id:'process-synthetic',threadId:'thread-synthetic',seq:1,revision:1,sourceKind:'user',sourceMessageIds:[],messageId:'body',state:'working',status:'running',turnIds:['turn-1'],items:[{id:'initial-progress',seq:1,revision:1,kind:'commentary',text:'公开进展'}],startedAtMs:1000,timingSource:'hostObserved',timingState:'running'};
const observation={connected:true,threadId:node.threadId,serviceRunning:true,observedAtMs:6000,generationTurnId:'turn-1',mainActivity:{processId:node.id,source:'user',turnId:'turn-1',stage:'native'}};
const tool=(id,patch={})=>({id,seq:1,revision:1,kind:'tool',category:'readFiles',turnId:'turn-1',threadId:node.threadId,label:'读取文件',status:'running',invocationCount:1,...patch});
const commentary=(id,text='公开说明')=>({id,seq:1,revision:1,kind:'commentary',phase:'commentary',text});
const worker={id:'worker-synthetic',seq:5,revision:1,kind:'worker',taskId:'task-private',version:1,taskRevision:2,runId:'run-synthetic',runRevision:1,runStatus:'running',resultState:null,epoch:0,state:'working',controlState:'normal',outcome:null,phase:'executing',stopRequested:false,label:'后台研究'};
const view=(n=node,o=observation)=>h(ProcessNodeView,{key:JSON.stringify([n.threadId,n.id]),node:n,observation:o,renderText:text=>h('p',null,text)});
const button=d=>d.find(n=>n.tagName==='BUTTON');
const groups=d=>d.all().filter(n=>'data-tool-group' in n.attrs);
const rows=d=>d.all().filter(n=>'data-tool-id' in n.attrs);
const done=n=>({...n,state:'worked',status:'completed',timingState:'terminal',durationMs:32000,endedAtMs:33000});

function conversation(history,nodes){return projectConversation(history,nodes,[]).messages;}
const historyMessage=(id,text='')=>({id,threadId:node.threadId,requestId:null,role:'assistant',text,status:'completed',createdAt:1});
function body(messages){return h(React.Fragment,null,messages.map(message=>h('article',{key:message.id,'data-message-id':message.id},h(ProcessMessageContent,{node:message.process,children:h('div',{'data-final-body':message.id},message.text)}))));}
test('real backend display projection -> production shell: multi final once, streaming ID correction, no raw final copy',async()=>withDom(async d=>{
 const raw={...node,final:{id:'f2',text:'SECOND FINAL'},items:[commentary('c','公开进度'),{...commentary('f1','FIRST FINAL'),phase:'final_answer',completed:true},{...commentary('f2','SECOND DRAFT'),phase:'final_answer',completed:false}]};
 const messages=conversation([historyMessage('body','OLD CONCATENATION')],[raw]);await d.render(body(messages));const article=d.find(n=>n.attrs['data-message-id']==='body');
 assert.equal(d.container.textContent.match(/FIRST FINAL/g).length,1);assert.equal(d.container.textContent.match(/SECOND DRAFT/g).length,1);assert.doesNotMatch(d.container.textContent,/OLD CONCATENATION|SECOND FINAL/);
 const corrected={...done(raw),items:raw.items.map(item=>item.id==='f2'?{...item,text:'SECOND FINAL',completed:true,revision:2}:item)};await d.render(body(conversation([historyMessage('body')],[corrected])));assert.equal(d.find(n=>n.attrs['data-message-id']==='body'),article);
 assert.equal(visibleText(d.container).match(/FIRST FINAL/g).length,1);assert.equal(visibleText(d.container).match(/SECOND FINAL/g).length,1);assert.doesNotMatch(d.container.textContent,/SECOND DRAFT/);
 assert.equal(d.container.textContent.match(/SECOND FINAL/g).length,1);
}));

test('formal publications retain original IDs even after internal batch, same text different IDs survives, no-final creates no answer',async()=>withDom(async d=>{
 const internal={...done(node),sourceKind:'worker',deliveryMessageIds:['pub-1','pub-2'],final:undefined,items:[worker]};
 const messages=conversation([historyMessage('body'),historyMessage('pub-1','正式发布摘要'),historyMessage('pub-2','正式发布摘要')],[internal]);await d.render(body(messages));
 assert.deepEqual(d.all().filter(n=>'data-message-id' in n.attrs).map(n=>n.attrs['data-message-id']),['body','pub-1','pub-2']);assert.equal(visibleText(d.container).match(/正式发布摘要/g).length,2);
 assert.equal(d.find(n=>n.attrs['data-final-body']==='body').textContent,'');assert.doesNotMatch(d.container.textContent,/处理完毕|已读/);
}));

test('ordinary Worker reply stays once inside original process disclosure across live transport',async()=>withDom(async d=>{
 const event={id:'event',seq:1,revision:1,kind:'workerEvent',eventKey:'reply:one',event:{eventKind:'reply_received',bodySource:'reply',title:'后台研究',body:'保留一个待确认事项。'}};
 const live={...node,items:[...node.items,event]};await d.render(body(conversation([historyMessage('body')],[live])));
 assert.equal(button(d).attrs['aria-expanded'],'false');assert.doesNotMatch(visibleText(d.container),/保留一个待确认事项/);
 assert.ok(!d.find(n=>n.attrs['data-worker-event']==='reply:one'),'reply DOM is unmounted while the process is closed');
 await d.click(button(d));
 const messages=conversation([historyMessage('body')],[done(live)]);await d.render(body(messages));
 const card=d.find(n=>n.attrs['data-worker-event']==='reply:one'),cardButton=card.childNodes.find(n=>n.tagName==='BUTTON');
 assert.ok(d.find(n=>n.attrs.class==='process-node').contains(card));
 assert.equal(cardButton.attrs['aria-expanded'],'false');await d.click(cardButton);assert.equal(d.container.textContent.match(/保留一个待确认事项。/g).length,1);
 assert.equal(d.all().filter(n=>n.attrs['data-worker-event']).length,1);await d.render(body(messages,{...observation,connected:false}));
 assert.ok(d.find(n=>n.attrs['data-worker-event']==='reply:one')===card,'reply DOM identity stays stable across transport updates');assert.match(visibleText(d.container),/保留一个待确认事项。/);assert.equal(card.attrs['data-state'],'waiting');assert.match(card.textContent,/当时：收到回复/);assert.doesNotMatch(visibleText(d.container),/部分完成|上次状态/);
 assert.equal(d.all().filter(n=>n.tagName==='DIALOG').length,0);
}));

test('Worker missing-version title remains unknown; failure/interrupt/unknown keep final body and honest process status',async()=>withDom(async d=>{
 for(const status of ['failed','interrupted','unknown']){
  const raw={...done(node),status,state:status==='unknown'?'working':'worked',items:[{...commentary('f','保留真实 final'),phase:'final_answer',completed:true},{...worker,label:undefined}],final:{id:'f',text:'保留真实 final'}};
  const messages=conversation([historyMessage('body')],[raw]);await d.render(body(messages,{...observation,workerTitles:new Map([['run-synthetic','历史后台工作']])}));
  assert.equal(d.container.textContent.match(/保留真实 final/g).length,1);assert.equal(button(d),undefined,'empty official activity stays a status row');assert.match(visibleText(d.container),/旧后台工作记录（当时的事件内容未保留）/);assert.doesNotMatch(visibleText(d.container),/历史后台工作/);
  assert.equal(messages[0].status,status==='unknown'?'interrupted':status);
  assert.doesNotMatch(visibleText(d.container),/处理失败|状态待确认/);
 }
}));
