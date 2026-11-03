// One explicit, resumable import through the existing owner and genuine native
// tools. Only aggregate receipts leave the private migration directory.
import {readFileSync,writeFileSync,existsSync,statSync,mkdirSync,unlinkSync,openSync,readSync,closeSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {loadConfig} from '../dist/config.js';
const parseJson=value=>{try{return JSON.parse(String(value));}catch{throw Error('migration_json_invalid');}};
const [mode,configPath]=process.argv.slice(2);if(!['--stage','--import','--verify'].includes(mode)||!configPath)throw Error('explicit_import_phase_and_config_required');
const config=loadConfig(configPath),root=resolve('.codex/scratch/native-memory-adoption-20261018');
const preview=parseJson(readFileSync(join(root,'native-note-migration-dry-run.json'))),privateRoot=resolve('.codex/private/native-memory-adoption-20261018');
if(!preview.privatePlan.startsWith(privateRoot+'/')||!readFileSync('.gitignore','utf8').split('\n').includes('.codex/private/'))throw Error('private_plan_required');
const sha=x=>createHash('sha256').update(x).digest('hex');
if(sha(readFileSync(preview.privatePlan))!==preview.privatePlanSha256||statSync(preview.privatePlan).mode&0o222)throw Error('immutable_plan_changed');
const plan=parseJson(readFileSync(preview.privatePlan));if(plan.blocked.length||plan.entries.length!==1||plan.nativeHome!==config.codexHome||config.codexHome!==config.nativeCodexHome)throw Error('reviewed_single_owner_import_required');
const entry=plan.entries[0],point=resolve(preview.privatePlan,'..'),receiptFile=join(point,'native-import-receipt.json'),publicFile=join(root,'native-note-import.json');
const id='homer-native-import-'+sha(entry.legacy.id+':'+entry.legacy.revision).slice(0,32),stageFile=join(config.runtime,'main-workspace',id+'.json');
const terminal=['completed','failed','interrupted','cancelled','canceled','superseded'];
const state=()=>fetch('http://127.0.0.1:4780/api/state').then(r=>r.json());
const receipt=existsSync(receiptFile)?parseJson(readFileSync(receiptFile)):{at:new Date().toISOString(),thread:plan.thread,requestId:id,status:'prepared',planSha256:preview.privatePlanSha256,sourceCount:1};
const save=()=>{const text=JSON.stringify(receipt,null,2)+'\n';writeFileSync(receiptFile,text,{mode:0o600});writeFileSync(publicFile,text);};
function sourceCurrent(){
 const db=new DatabaseSync(join(config.runtime,'homer.sqlite'),{readOnly:true});try{
  if(db.prepare('SELECT count(*) n FROM memory_entries').get().n!==1)throw Error('legacy_source_count_changed');
  const row=db.prepare('SELECT * FROM memory_entries WHERE id=?').get(entry.legacy.id),{sources,...legacy}=entry.legacy;
  if(sha(JSON.stringify(row))!==sha(JSON.stringify(legacy)))throw Error('legacy_source_changed');
  if(db.prepare("SELECT count(*) n FROM memory_suppressions").get().n)throw Error('suppression_requires_review');
 }finally{db.close();}
}
async function idle(){const s=await state();if(s.threadId!==plan.thread||s.isRunning||s.activeMessageId||s.work.length||s.interactions.length||s.upgrade.phase!=='running'||s.upgrade.transportPending.length||s.queue.some(x=>!terminal.includes(x.state)))throw Error('owner_not_idle');return s;}
function noteStatus(){if(!existsSync(entry.native.path))return false;if(sha(readFileSync(entry.native.path))!==entry.native.noteSha256)throw Error('native_target_conflict');return true;}
function ownerData(){const db=new DatabaseSync(join(config.runtime,'homer.sqlite'),{readOnly:true});try{return {pid:parseJson(db.prepare("SELECT value FROM meta WHERE key='lease:main'").get().value).pid,jobs:db.prepare('SELECT count(*) n FROM memory_jobs').get().n,operations:db.prepare('SELECT count(*) n FROM memory_operations').get().n};}finally{db.close();}}
function rollout(){const db=new DatabaseSync(join(config.codexHome,'state_5.sqlite'),{readOnly:true});try{return db.prepare('SELECT rollout_path FROM threads WHERE id=?').get(plan.thread).rollout_path;}finally{db.close();}}
function methodsSince(file,offset){const n=statSync(file).size-offset;if(n<0||n>8*1024*1024)throw Error('own_segment_bounds');const bytes=Buffer.alloc(n),fd=openSync(file,'r');try{readSync(fd,bytes,0,n,offset);}finally{closeSync(fd);}const methods=new Set();for(const line of bytes.toString().split('\n')){let row;try{row=parseJson(line);}catch{continue;}if(row.type!=='response_item'||!['custom_tool_call','function_call'].includes(row.payload?.type))continue;const script=String(row.payload.input??row.payload.arguments??'');for(const m of script.matchAll(/memories__(add_ad_hoc_note|search|read|list)\b/g))methods.add(m[1]);}return [...methods];}
if(mode==='--stage'){
 sourceCurrent();await idle();if(receipt.status!=='prepared')throw Error('import_already_started');
 const stage={filename:entry.native.filename,note:entry.native.note,path:'extensions/ad_hoc/notes/'+entry.native.filename};
 mkdirSync(join(config.runtime,'main-workspace'),{recursive:true,mode:0o700});
 if(existsSync(stageFile)){if(sha(readFileSync(stageFile))!==sha(JSON.stringify(stage)))throw Error('stage_conflict');}else writeFileSync(stageFile,JSON.stringify(stage),{flag:'wx',mode:0o600});
 receipt.staged=true;receipt.stageSha256=sha(readFileSync(stageFile));save();console.log(JSON.stringify({staged:true,sourceCount:1,modelCalled:false}));
}else{
 if(config.memoryBackend!=='native'||config.nativeMemoryBackground!=='native')throw Error('native_backend_must_be_adopted');
 const memory=await fetch('http://127.0.0.1:4780/api/memory').then(r=>r.json());if(memory.settings?.backend!=='native')throw Error('live_native_backend_required');
 sourceCurrent();const s=await idle();const requestId=id+(mode==='--verify'?'-verify':'');
 const existing=s.messages.find(m=>m.requestId===requestId&&m.role==='assistant');
 if(!existing&&receipt[mode==='--verify'?'verifySubmitted':'submitted'])throw Error('unknown_request_do_not_replay');
 const phase=mode==='--verify'?'verify':'import';
 const path=rollout(),before=receipt[phase+'Start']?.owner??ownerData(),offset=receipt[phase+'Start']?.offset??statSync(path).size;
 if(!existing){
  let text;
  if(mode==='--import'){
   if(!receipt.staged||!existsSync(stageFile)||sha(readFileSync(stageFile))!==receipt.stageSha256||statSync(stageFile).mode&0o077)throw Error('private_stage_required');
   if(noteStatus())throw Error('native_note_already_present_verify_instead');
   // The exec result is parsed inside code mode, not printed into model text.
   text='[已授权的 Homer 原生记忆迁移] 只迁移本机已有的 1 条已确认记忆，来源文件为 '+stageFile+'。在 functions.exec 内使用本轮实际 exec_command 工具读取该 JSON 并解析其 output；不要 text/打印/复述文件正文、note 或 exec 结果。将解析对象的 filename 和 note 原样交给 tools.memories__add_ad_hoc_note，随后 tools.memories__read 其 path 核对原生读取成功。只有这些操作已成功才输出 {"stored":true}。不得改写事实、读其他文件、创建 Worker、联网、调用历史 memory_*、安装或外发；结果未知只报告，不能换文件名重试。';
   receipt.submitted=true;
  }else{
   if(!['imported','passed'].includes(receipt.status)||!noteStatus())throw Error('import_not_verified');
   text='[Homer 原生迁移只读确认] 只用原生 search 搜索文件名 '+entry.native.filename+'，再用原生 read 读取 extensions/ad_hoc/notes/'+entry.native.filename+'。不得回显或复述正文；确认这条迁移记忆在当前原主 thread 的原生存储可读后只输出 {"stored":true}。不写记忆、不创建 Worker、不调用历史 memory_*、不读其他文件、不外发。';receipt.verifySubmitted=true;
  }
  receipt.version=s.upgrade.version;receipt[phase+'Start']={offset,owner:before};save();
  const response=await fetch('http://127.0.0.1:4780/api/messages',{method:'POST',headers:{Origin:'http://127.0.0.1:4780','Content-Type':'application/json'},body:JSON.stringify({requestId,text})});if(response.status!==202)throw Error('request_not_accepted');
 }
 const deadline=Date.now()+config.mainTimeoutMs+10000;let reply=existing;
 while(!reply||!terminal.includes(reply.status)){
  if(Date.now()>deadline)throw Error('own_request_pending_do_not_replay');await new Promise(r=>setTimeout(r,200));
  const current=await state();if(current.threadId!==plan.thread||current.upgrade.version!==s.upgrade.version||current.work.length||current.interactions.length||current.queue.some(x=>!terminal.includes(x.state)&&x.input?.requestId!==requestId))throw Error('owner_external_activity');reply=current.messages.find(m=>m.requestId===requestId&&m.role==='assistant');
 }
 if(reply.status!=='completed'||parseJson(reply.text.trim().replace(/^```json\s*|\s*```$/g,'')).stored!==true)throw Error('own_confirmation_not_completed');
 const methods=methodsSince(path,offset);
 for(const method of mode==='--import'?['add_ad_hoc_note','read']:['search','read'])if(!methods?.includes(method))throw Error('native_method_not_observed');
 if(!noteStatus())throw Error('native_note_missing');const after=ownerData();if(after.jobs!==before.jobs||after.operations!==before.operations)throw Error('legacy_backend_still_writing');
 receipt[mode==='--verify'?'verifyMethods':'importMethods']=methods;receipt[mode==='--verify'?'verifiedOwner':'importedOwner']=after;
 receipt.status=mode==='--verify'?'passed':'imported';receipt.noteSha256=entry.native.noteSha256;receipt.sourceContentSha256=entry.contentSha256;receipt.nativeHome=config.codexHome;receipt.legacyWritesStopped=true;receipt.noDatabaseRestore=true;receipt.finishedAt=new Date().toISOString();save();
 if(mode==='--verify'&&existsSync(stageFile)&&sha(readFileSync(stageFile))===receipt.stageSha256)unlinkSync(stageFile);
 console.log(JSON.stringify({status:receipt.status,sourceCount:1,thread:plan.thread,nativeHome:config.codexHome,legacyWritesStopped:true}));
}
