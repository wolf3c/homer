// Explicit synthetic acceptance via the existing Homer owner and request queue.
// This is a probe, not a native-only memory cutover or a migration.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,statSync,openSync,readSync,closeSync,renameSync,unlinkSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {loadConfig} from '../dist/config.js';
import {CodexEngine} from '../dist/engine.js';
if(process.argv[2]!=='--run-existing-thread'||!process.argv[3])throw Error('explicit_existing_thread_mode_and_config_required');
const config=loadConfig(process.argv[3]),root=resolve('.codex/scratch/native-memory-adoption-20261018');
const preflight=JSON.parse(readFileSync(join(root,'native-tools-preflight-release.json'))),preview=JSON.parse(readFileSync(join(root,'backup-and-migration-preview.json')));
assert.equal(config.nativeMemoryTools,true);assert.equal(config.codexHome,config.nativeCodexHome);assert.equal(preview.restoreRehearsalPassed,true);
const file=join(root,'main-queue-native-lifecycle.json'),resume=process.argv[4]==='--continue-existing-remember';
const prior=existsSync(file)?JSON.parse(readFileSync(file)):undefined;if(prior&&!resume)throw Error('acceptance_already_started_do_not_replay');if(resume&&(!prior||prior.error!=='owner_external_activity'||prior.steps.length!==1||prior.steps[0].label!=='remember'))throw Error('specific_completed_remember_recovery_required');
const sha=x=>createHash('sha256').update(x).digest('hex');
const id=prior?prior.marker.toLowerCase():'homer-native-'+randomUUID(),marker=id.toUpperCase();
const priorFiles=prior?readdirSync(join(config.codexHome,'memories/extensions/ad_hoc/notes')).filter(n=>n.endsWith(id+'-remember.md')):[];if(prior&&priorFiles.length!==1)throw Error('exact_own_note_required');
const stamp=prior?priorFiles[0].split('-homer-native-')[0]:new Date().toISOString().slice(0,19).replaceAll(':','-');
const names=['remember','correct','forget'].map(n=>stamp+'-'+id+'-'+n+'.md');
const notes=[marker+': synthetic-only preference = teal.',marker+': correction. Earlier preference is obsolete. Effective synthetic-only preference = amber.',marker+': withdraw this synthetic-only preference. All earlier values are obsolete and must not be used or reconstructed. Effective preference = none.'];
const paths=names.map(n=>join(config.codexHome,'memories/extensions/ad_hoc/notes',n));
const nativeConfig=join(config.codexHome,'config.toml'),nativeBefore=readFileSync(nativeConfig);let nativeCurrentHash=sha(nativeBefore),changedConfig=false,control,activeRequest;
const receipt=prior??{at:new Date().toISOString(),thread:preflight.thread,version:preflight.version,fixedVersion:'0.163.0',model:config.model,marker,steps:[],status:'started',realModel:true,legacyBackendStillActive:true,hostCutoverPassed:false};
if(prior){writeFileSync(join(root,'main-queue-guard-failure.json'),JSON.stringify(prior,null,2)+'\n',{flag:'wx'});receipt.recoveredQueueGuardFailure=true;delete receipt.error;receipt.status='resuming';}
const save=()=>writeFileSync(file,JSON.stringify(receipt,null,2)+'\n');save();
const state=()=>fetch('http://127.0.0.1:4780/api/state').then(r=>r.json());
const terminal=['completed','failed','interrupted','cancelled','canceled','superseded'];
async function idle(){const s=await state();if(s.threadId!==receipt.thread||s.upgrade.version!==receipt.version||s.isRunning||s.activeMessageId||s.work.length||s.interactions.length||s.upgrade.transportPending.length||s.queue.some(x=>!terminal.includes(x.state)))throw Error('owner_busy_or_changed');return s;}
function lease(){const db=new DatabaseSync(join(config.runtime,'homer.sqlite'),{readOnly:true});try{return JSON.parse(db.prepare("SELECT value FROM meta WHERE key='lease:main'").get().value).pid;}finally{db.close();}}
const nativeDb=new DatabaseSync(join(config.codexHome,'state_5.sqlite'),{readOnly:true});
const rollout=nativeDb.prepare('SELECT rollout_path FROM threads WHERE id=?').get(receipt.thread).rollout_path;
receipt.nativeThreadCountBefore=nativeDb.prepare('SELECT count(*) n FROM threads').get().n;nativeDb.close();
function callsSince(offset){const n=statSync(rollout).size-offset;if(n<0||n>8*1024*1024)throw Error('own_rollout_segment_out_of_bounds');const b=Buffer.alloc(n),fd=openSync(rollout,'r');try{readSync(fd,b,0,n,offset);}finally{closeSync(fd);}
 const calls=[];for(const line of b.toString('utf8').split('\n').filter(Boolean)){let x;try{x=JSON.parse(line);}catch{continue;}if(x.type!=='response_item')continue;const p=x.payload;if(!['custom_tool_call','function_call'].includes(p.type))continue;const script=String(p.input??p.arguments??'');calls.push({name:p.name,nativeMemoryMethods:[...new Set([...script.matchAll(/memories__(add_ad_hoc_note|search|read|list)\b/g)].map(m=>m[1]))],turnId:p.internal_chat_message_metadata_passthrough?.turn_id});}return calls;}
async function model(label,instruction,expected,required){
 await idle();const requestId=id+'-'+label,offset=statSync(rollout).size,entry={label,requestId,beforePid:lease(),startedAt:new Date().toISOString(),status:'submitting'};activeRequest=requestId;receipt.steps.push(entry);save();
 const text='[原生记忆验收] 本条是已授权的合成数据验收，不是真实用户偏好，也不要经宿主 memory_* 保存。只使用当前原生 memories 工具（functions.exec 中 tools.memories__add_ad_hoc_note/search/read），不调用宿主 MCP、Shell、网络、Worker、安装、授权、其他记忆或外发。唯一标记 '+marker+'。先用原生工具取得结果，再只输出要求的 JSON。'+instruction;
 const response=await fetch('http://127.0.0.1:4780/api/messages',{method:'POST',headers:{Origin:'http://127.0.0.1:4780','Content-Type':'application/json'},body:JSON.stringify({requestId,text})});entry.http=response.status;const ack=await response.json();entry.messageId=ack.messageId??ack.id;save();assert.equal(response.status,202,'own_request_not_accepted');
 const deadline=Date.now()+125000;while(Date.now()<deadline){const s=await state();if(s.threadId!==receipt.thread||s.upgrade.version!==receipt.version||s.work.length||s.interactions.length||s.queue.some(x=>!terminal.includes(x.state)&&x.input?.requestId!==requestId))throw Error('owner_external_activity');if(s.generation?.sourceRequestId===requestId)entry.generation={generationId:s.generation.generationId,turnId:s.generation.turnId};
 const reply=s.messages.find(m=>m.requestId===requestId&&m.role==='assistant');if(reply&&terminal.includes(reply.status)){entry.status=reply.status;entry.afterPid=lease();entry.usage=s.usage?.last;entry.finishedAt=new Date().toISOString();entry.calls=callsSince(offset);save();assert.equal(reply.status,'completed','own_request_not_completed');let result;try{result=JSON.parse(reply.text.trim().replace(/^```json\s*|\s*```$/g,''));}catch{throw Error('own_reply_not_json');}entry.effective=result.effective;assert.equal(result.effective,expected,'own_effective_value_mismatch');for(const method of required)assert.ok(entry.calls.some(c=>c.nativeMemoryMethods.includes(method)),'native_'+method+'_not_observed');save();activeRequest=undefined;return entry;}
 await new Promise(r=>setTimeout(r,200));}throw Error('own_request_timeout');
}
async function userLayer(){const result=await control.request('config/read',{includeLayers:true,cwd:join(config.runtime,'main-workspace')});const l=result.layers.find(l=>l.name?.type==='user'&&resolve(l.name.file)===nativeConfig);if(!l)throw Error('native_user_layer_missing');return l;}
async function triggerReconnect(){await idle();if(sha(readFileSync(nativeConfig))!==nativeCurrentHash)throw Error('native_config_CAS_conflict');const l=await userLayer();await control.request('config/batchWrite',{filePath:nativeConfig,expectedVersion:l.version,reloadUserConfig:true,edits:[{keyPath:'memories.dedicated_tools',value:true,mergeStrategy:'replace'}]});nativeCurrentHash=sha(readFileSync(nativeConfig));changedConfig=true;save();}
async function restoreConfig(){if(!changedConfig)return;await idle();if(sha(readFileSync(nativeConfig))!==nativeCurrentHash)throw Error('native_config_restore_CAS_conflict');const temp=nativeConfig+'.'+id+'.restore';writeFileSync(temp,nativeBefore,{flag:'wx',mode:0o600});renameSync(temp,nativeConfig);nativeCurrentHash=sha(nativeBefore);changedConfig=false;receipt.nativeConfigRestored=true;save();}
function syntheticInventory(){const matches=[];function walk(p){if(!existsSync(p))return;for(const n of readdirSync(p)){if(n==='.git')continue;const q=join(p,n),s=lstatSync(q);if(s.isSymbolicLink())continue;if(s.isDirectory())walk(q);else if(s.isFile()&&s.size<4*1024*1024&&readFileSync(q,'utf8').includes(marker))matches.push({path:q.slice(config.codexHome.length+1),sha256:sha(readFileSync(q)),sourceNote:paths.includes(q)});}}walk(join(config.codexHome,'memories'));return matches;}
try{
 await idle();receipt.originalPid=lease();assert.equal(preview.home,config.codexHome);
 control=new CodexEngine(config,{cwd:join(config.codexHome,'homer-control'),readRoots:[],instructions:'Synthetic native acceptance configuration control; no thread or model.',tools:[],nativeCapabilities:true,controlOnly:true},async()=>{throw Error('no_model_tools');});await control.start();
 const account=await control.request('account/read',{refreshToken:false});assert.equal(account.account?.type,'chatgpt');const models=await control.request('model/list',{includeHidden:true});assert.ok(models.data.some(m=>m.model===config.model||m.id===config.model));receipt.providerCompatible=true;save();
 if(!prior){await model('remember','调用原生 add_ad_hoc_note，filename='+JSON.stringify(names[0])+'，note 必须逐字为 '+JSON.stringify(notes[0])+'。之后 search 该唯一标记并 read 命中的 note，成功后输出 {"effective":"teal"}。','teal',['add_ad_hoc_note','search','read']);assert.equal(readFileSync(paths[0],'utf8'),notes[0]);}else{
 const s=await idle(),entry=receipt.steps[0],reply=s.messages.find(m=>m.requestId===entry.requestId&&m.role==='assistant');assert.equal(reply?.status,'completed');assert.equal(JSON.parse(reply.text).effective,'teal');const all=callsSince(0),own=all.find(c=>c.nativeMemoryMethods.includes('add_ad_hoc_note')&&c.turnId===all.at(-1)?.turnId);assert.ok(own,'own_native_save_not_observed');entry.calls=all.filter(c=>c.turnId===own.turnId);entry.status='completed';entry.afterPid=lease();entry.recoveredWithoutReplay=true;entry.effective='teal';assert.equal(readFileSync(paths[0],'utf8'),notes[0]);save();
 }
 await model('recall','用原生 search 该唯一标记，再 read 每个匹配 note，按实际最新数据回答 {"effective":当前值}。不要从聊天回声推断。','teal',['search','read']);
 await triggerReconnect();const restart=await model('reconnect-recall','用原生 search 该唯一标记，再 read 每个匹配 note，按存储中实际最新数据回答 {"effective":当前值}。不要从聊天回声推断。','teal',['search','read']);assert.notEqual(restart.beforePid,restart.afterPid,'automatic_child_reconnect_missing');receipt.sameThreadReconnectPassed=true;
 await model('correct','调用原生 add_ad_hoc_note，filename='+JSON.stringify(names[1])+'，note 必须逐字为 '+JSON.stringify(notes[1])+'。然后 search 此标记并 read 所有匹配，输出 {"effective":按最新纠正后的值}。','amber',['add_ad_hoc_note','search','read']);assert.equal(readFileSync(paths[1],'utf8'),notes[1]);
 await model('forget','调用原生 add_ad_hoc_note，filename='+JSON.stringify(names[2])+'，note 必须逐字为 '+JSON.stringify(notes[2])+'。然后 search 此标记并 read 所有匹配，按最新撤回输出 {"effective":null}。不得声称旧文件已删除。',null,['add_ad_hoc_note','search','read']);assert.equal(readFileSync(paths[2],'utf8'),notes[2]);
 await restoreConfig();const forgotten=await model('reconnect-forget','用原生 search 此唯一标记并 read 所有匹配，按实际最新数据输出 {"effective":当前值或已撤回时的null}。不要采用旧值。',null,['search','read']);assert.notEqual(forgotten.beforePid,forgotten.afterPid,'forget_reconnect_missing');receipt.logicalNoteLifecyclePassed=true;receipt.physicalForgetPassed=false;receipt.beforeCleanup=syntheticInventory();
 // Only exact self-created synthetic preference files may be removed. Native
 // withdrawal remains explicit so future consolidation cannot revive them.
 await idle();for(const i of [0,1]){assert.equal(readFileSync(paths[i],'utf8'),notes[i]);unlinkSync(paths[i]);}receipt.syntheticPreferenceNotesRemoved=true;receipt.withdrawalNoteRetained=true;
 await model('cleanup-recall','验收已结束。用原生 search 此唯一标记并 read 所有匹配，按最新撤回输出 {"effective":null}。不得重建已撤回偏好。',null,['search','read']);receipt.status='passed';
}catch(error){receipt.status='failed';receipt.error=/^[a-zA-Z_0-9:/-]{1,120}$/.test(error.message)?error.message:error.code??error.name;process.exitCode=1;}
finally{
 if(activeRequest){try{const s=await state();if(s.generation?.sourceRequestId===activeRequest&&s.activeMessageId){await fetch('http://127.0.0.1:4780/api/stop',{method:'POST',headers:{Origin:'http://127.0.0.1:4780','Content-Type':'application/json'},body:JSON.stringify({messageId:s.activeMessageId})});receipt.ownStopRequested=true;}}catch{receipt.ownStopUnverified=true;}}
 try{await restoreConfig();}catch{receipt.configRestoreRequiresReview=true;process.exitCode=1;}
 await control?.close();receipt.syntheticInventory=syntheticInventory();const db=new DatabaseSync(join(config.codexHome,'state_5.sqlite'),{readOnly:true});receipt.nativeThreadCountAfter=db.prepare('SELECT count(*) n FROM threads').get().n;db.close();receipt.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:receipt.status,steps:receipt.steps.map(x=>({label:x.label,status:x.status})),error:receipt.error,evidence:file,logicalNoteLifecyclePassed:receipt.logicalNoteLifecyclePassed,hostCutoverPassed:false,physicalForgetPassed:false,nativeConfigRestored:receipt.nativeConfigRestored,syntheticFiles:receipt.syntheticInventory.length}));
}
