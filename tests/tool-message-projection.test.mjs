import {test} from 'node:test';import assert from 'node:assert/strict';
import {projectProcessMessage} from './helpers/tool-ui-loader.mjs';
test('only exact final identities enter message parts, never tool bodies or process commentary',()=>{
 const final={id:'final',kind:'commentary',phase:'final_answer',turnId:'turn',itemId:'final',text:'正式正文',seq:3,revision:1};
 const message={id:'message',role:'assistant',text:'正式正文',process:{sourceKind:'user',items:[{id:'progress',kind:'commentary',phase:'commentary',text:'PRIVATE_PROGRESS',seq:1,revision:1},{id:'call',kind:'tool',status:'failed',seq:2,revision:1,content:{input:{value:'PRIVATE_INPUT'},output:{value:'PRIVATE_OUTPUT'}}},final,{...final,revision:2,text:'最新正式正文'}]}};
 const p=projectProcessMessage(message);assert.deepEqual(p.content,[{type:'text',id:'final',text:'最新正式正文'}]);assert.doesNotMatch(JSON.stringify(p),/PRIVATE/);assert.equal(p.presentation.entries['text:final'].source,'model');
 const empty=projectProcessMessage({...message,process:{sourceKind:'user',items:message.process.items.slice(0,2)}});assert.deepEqual(empty.content,[],'no fabricated host answer for a native process without a final');
 const host=projectProcessMessage({...message,process:undefined});assert.equal(host.content[0].text,'正式正文');
 const worker=projectProcessMessage({...message,process:{sourceKind:'worker',items:[]}});assert.equal(worker.content[0].text,'正式正文');
});
