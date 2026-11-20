// Old-format maintenance only. No Store construction, account, engine or install path.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {inspectMainReceiptEvidence} from './legacy-main-receipts-v8.ts';
import {unconfirmedNativeEffectsSql} from '../src/main-process.ts';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const meta=(db,key)=>db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;
const decode=value=>{try{const parsed=JSON.parse(String(value));if(!parsed||typeof parsed!=='object')throw Error();return parsed;}catch{throw Error('main_receipt_bridge_evidence_invalid');}};

export function previewLegacyMainReceipts(db){
 const sourceSchema=String(meta(db,'recursiveSchemaVersion')??'');
 if(!['6','7'].includes(sourceSchema))throw Error('main_receipt_bridge_schema_unsupported');
 const scope={mainAgentId:String(meta(db,'mainAgentId')??''),mainThreadId:String(meta(db,'mainThread')??'')};
 const evidence=inspectMainReceiptEvidence(db,scope),nodes=db.prepare("SELECT key,value FROM meta WHERE key GLOB 'publicMainNode:v1:*' ORDER BY key").all();
 const byId=new Map(nodes.map(row=>{const node=decode(row.value);return [node.id,node];}));
 const blocked=new Set(),rows=[];
 for(const row of evidence.rows){
  if(row.targetState==='invalid')blocked.add('evidence_invalid');
  if(['processed','rejected'].includes(row.sourceState))continue;
  const node=byId.get(row.processId);
  const closed=node?.state==='worked'&&typeof node.endEventId==='string'&&/^(turn:|host:.*engine_closed)/.test(node.endEventId);
  if(row.targetState==='received'&&closed)rows.push(row);
  else blocked.add('delivery_unconfirmed');
 }
 if(db.prepare(`SELECT 1 FROM meta p WHERE p.key GLOB 'publicMainNode:v1:*' AND ${unconfirmedNativeEffectsSql()} LIMIT 1`).get())blocked.add('native_effect_unconfirmed');
 const runs=db.prepare('SELECT id,status,phase,epoch,stateRevision,startedAt,checkpointJson FROM runs ORDER BY id').all();
 if(runs.some(run=>['queued','running'].includes(run.status)||run.phase==='uncertain'||run.startedAt!==null&&decode(run.checkpointJson??'{}').workerExitConfirmed!==1))blocked.add('worker_owner_unconfirmed');
 const leases=db.prepare("SELECT key,value FROM meta WHERE key LIKE 'lease:%' ORDER BY key").all();
 for(const lease of leases){
  if(!['lease:main','lease:native-control'].includes(lease.key)){blocked.add('worker_owner_unconfirmed');continue;}
  const owner=decode(lease.value);if(!Number.isSafeInteger(owner.pid)||owner.pid<=0||typeof owner.identity!=='string'||!owner.identity)blocked.add('main_owner_unconfirmed');
 }
 if([...byId.values()].some(node=>node.state==='working'))blocked.add('main_processing_active');
 const requests=db.prepare('SELECT id,state FROM requests ORDER BY id').all();
 if(requests.some(request=>request.state==='started'))blocked.add('request_unfinished');
 const operations=db.prepare("SELECT id,state,revision FROM operations WHERE state IN ('accepted','dispatching','uncertain') ORDER BY id").all();
 if(operations.length)blocked.add('operation_unconfirmed');
 const interactions=db.prepare('SELECT id,state,deliveredAt,updatedAt FROM worker_interactions ORDER BY id').all();
 if(interactions.some(item=>['pending_main','pending_user'].includes(item.state)||['approved','denied','answered'].includes(item.state)&&item.deliveredAt===null))blocked.add('interaction_unresolved');
 const result={format:1,sourceSchema,scope,rows,blocked:[...blocked].sort()};
 return {...result,fingerprint:digest({result,evidence:evidence.fingerprint,runs,leases,requests,operations,interactions})};
}

export function applyLegacyMainReceiptsInTransaction(db,preview,operationId){
 if(!db.isTransaction)throw Error('main_receipt_bridge_transaction_required');
 if(!['6','7'].includes(String(meta(db,'recursiveSchemaVersion'))))throw Error('main_receipt_bridge_schema_unsupported');
 if(typeof operationId!=='string'||!operationId||operationId.length>200)throw Error('main_receipt_bridge_operation_invalid');
 const key='mainReceiptBridge:'+operationId,prior=meta(db,key);
 if(prior){const saved=decode(prior);if(saved.fingerprint!==preview.fingerprint)throw Error('main_receipt_bridge_operation_conflict');return saved.result;}
 const current=previewLegacyMainReceipts(db);
 if(digest(current)!==digest(preview))throw Error('main_receipt_bridge_preview_stale');
 if(current.blocked.length)throw Error('main_receipt_bridge_blocked');
 const result={changed:current.rows.length,requiresRuntimeProbe:true};
 if(!current.rows.length)return result;
 for(const row of current.rows){
  const changed=db.prepare("UPDATE agent_receipts SET state='processed',revision=revision+1 WHERE messageId=? AND recipientAgentId=? AND state=? AND revision=?").run(row.messageId,row.recipientAgentId,row.sourceState,row.revision);
  if(changed.changes!==1)throw Error('main_receipt_bridge_preview_stale');
 }
 db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(key,JSON.stringify({sourceSchema:current.sourceSchema,fingerprint:current.fingerprint,rows:current.rows,result}));
 return result;
}

function privatePreviewPath(path,create=false){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),codexRoot=resolve(root,'.codex'),privateRoot=resolve(codexRoot,'private'),target=resolve(path),part=relative(privateRoot,target);
 if(!part||part.startsWith('..'+sep)||part==='..'||isAbsolute(part))throw Error('main_receipt_bridge_private_path_required');
 if(realpathSync(root)!==root||(lstatSync(root).mode&0o022)!==0)throw Error('main_receipt_bridge_private_permissions');
 const ignored=spawnSync('git',['-C',root,'check-ignore','-q','--',privateRoot]);
 if(ignored.status!==0)throw Error('main_receipt_bridge_private_path_required');
 let parent=root;
 for(const name of relative(root,dirname(target)).split(sep)){
  parent=resolve(parent,name);
  // Validate each ancestor before creating anything beneath it.
  if(create&&!existsSync(parent))mkdirSync(parent,{mode:0o700});
  const stat=lstatSync(parent);
  if(stat.isSymbolicLink()||!stat.isDirectory()||realpathSync(parent)!==parent||(stat.mode&(parent===codexRoot?0o022:0o077))!==0)throw Error('main_receipt_bridge_private_permissions');
 }
 if(!create){const stat=lstatSync(target);if(stat.isSymbolicLink()||!stat.isFile()||(stat.mode&0o077)!==0||stat.size>16*1024*1024)throw Error('main_receipt_bridge_preview_invalid');}
 return target;
}
function main(){
 const args=process.argv.slice(2),options=new Map();
 for(let index=0;index<args.length;index+=2){
  const key=args[index],value=args[index+1];
  if(!['--db','--preview-out','--apply','--operation-id'].includes(key)||!value||value.startsWith('--')||options.has(key))throw Error('main_receipt_bridge_arguments_invalid');
  options.set(key,value);
 }
 if(!options.has('--db')||options.has('--apply')!==options.has('--operation-id')||options.has('--apply')&&options.has('--preview-out'))throw Error('main_receipt_bridge_arguments_invalid');
 const path=resolve(options.get('--db'));
 if(!existsSync(path)||lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile()||realpathSync(path)!==path)throw Error('main_receipt_bridge_database_invalid');
 const applying=options.has('--apply');
 const reviewed=applying?decode(readFileSync(privatePreviewPath(options.get('--apply')),'utf8')):undefined;
 const db=new DatabaseSync(path,{readOnly:!applying});
 try{
  if(applying){
   db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=1000;BEGIN IMMEDIATE');
   let result;
   try{result=applyLegacyMainReceiptsInTransaction(db,reviewed,options.get('--operation-id'));db.exec('COMMIT');}
   catch(error){db.exec('ROLLBACK');throw error;}
   process.stdout.write(JSON.stringify({mode:'apply',...result})+'\n');
  }else{
   const preview=previewLegacyMainReceipts(db);
   if(options.has('--preview-out'))writeFileSync(privatePreviewPath(options.get('--preview-out'),true),JSON.stringify(preview),{flag:'wx',mode:0o600});
   process.stdout.write(JSON.stringify({mode:'preview',sourceSchema:preview.sourceSchema,candidates:preview.rows.length,blocked:preview.blocked})+'\n');
  }
 }finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch(error){process.stderr.write(JSON.stringify({error:/^main_receipt_[a-z_]+$/.test(error?.message)?error.message:'main_receipt_bridge_failed'})+'\n');process.exitCode=1;}
}
