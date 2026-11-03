// Deterministic synthetic data. No Homer constructor, config, account, engine or network.
import {Store} from '../src/store.js';
import {Files} from '../src/files.js';
import {WorkerInteractions} from '../src/worker-interactions.js';
import {RecursiveTasks} from '../src/recursive-tasks.js';
import {ConversationHistory} from '../src/web-history.js';
import {MainProcessHistory} from '../src/main-process.js';
import {MainInputs} from '../src/recursive-main-inputs.js';
import {resolve} from 'node:path';
export const syntheticRoot=process.env.HOMER_SYNTHETIC_ROOT??'.codex/scratch/web-history-loading-implementation';
export const syntheticSeed=20261021; // Versioned deterministic sequence; no random/production input.
export function historyFixture(total=20,bodyBytes=160,stableRecent=false,databasePath=':memory:'){
 const store=new Store(databasePath);const interactions=new WorkerInteractions(store.db);
 const history=new ConversationHistory(store.db),tasks=new RecursiveTasks(store,new Files(resolve(syntheticRoot+'/unused-workspace')));tasks.migrate();
 store.setMeta('mainThread','synthetic-history');
 const processes=new MainProcessHistory(store.db),inputs=new MainInputs(tasks,history);
 const db=store.db,insert=db.prepare('INSERT INTO conversation_messages VALUES(?,?,?,?,?,?,?,?)');
 const meta=db.prepare('INSERT INTO meta(key,value) VALUES(?,?)');
 db.exec('BEGIN');
 for(let position=0;position<total;position++){
  const n=stableRecent&&position>=total-40?10000-total+position:position;
  const requestId='request-'+n,replyId='reply-'+n,id='node-'+n;
  db.prepare('INSERT INTO conversation_inputs VALUES(?,?,?,?)').run(requestId,'synthetic-history','synthetic-hash',replyId);
  insert.run('user-'+n,'synthetic-history',requestId,'user','合成问题 '+n,'completed',null,1700000000000-n);
  insert.run(replyId,'synthetic-history',requestId,'assistant','合成接收回执 '+n,'completed',null,1700000000000-n);
  insert.run(id,'synthetic-history',null,'assistant','合成答复 '+n+' '+'.'.repeat(bodyBytes),'completed',null,1700000000000-n);
  meta.run('publicMainNode:v1:'+id,JSON.stringify({id,threadId:'synthetic-history',seq:n+1,revision:1,sourceKind:'user',sourceMessageIds:[],messageId:id,replyMessageId:replyId,state:'worked',status:'completed',turnIds:['turn-'+n],endEventId:'terminal-'+n,final:{id:'native-final-'+n,text:'合成答复 '+n+' '+'.'.repeat(bodyBytes)},items:[],completedItemIds:[],itemPhases:{}}));
 }
 db.exec('COMMIT');
 return {store,history,tasks,processes,inputs,interactions,close:()=>store.close()};
}
// Synthetic streaming updates follow the public native-final owner, not an unrelated host fallback.
export function updateSyntheticPublicText(f:ReturnType<typeof historyFixture>,id:string,text:string){return f.store.transaction(()=>{const changed=f.store.db.prepare('UPDATE conversation_messages SET text=? WHERE id=?').run(text,id);const key='publicMainNode:v1:'+id,raw=f.store.meta(key);if(raw){const node=JSON.parse(raw);node.final={id:node.final?.id??'native-final-'+id,text};f.store.setMeta(key,JSON.stringify(node));}return changed;});}
