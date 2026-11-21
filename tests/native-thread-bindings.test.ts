import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Store} from '../src/store.js';
import * as module from '../src/native-thread-bindings.js';
const logical='thread:main';
const root={nativeId:logical,provider:'openai' as const,parentNativeId:null};
const child={nativeId:'native:member',provider:'homer' as const,parentNativeId:logical};
const headKey=(id:string)=>'nativeThreadHead:v1:'+id;
const recordKey=(id:string)=>'nativeThreadBinding:v1:'+id;
const turnKey=(id:string,turn:string)=>'nativeThreadTurn:v1:'+JSON.stringify([id,turn]);
function fixture(t:TestContext){
 const store=new Store(':memory:');t.after(()=>store.close());
 return {store,bindings:new module.NativeThreadBindings(store)};
}
const snapshot=(store:Store)=>JSON.stringify(store.db.prepare('SELECT key,value FROM meta ORDER BY key').all());

test('legacy lookup is read-only and observed root registration is idempotent',t=>{
 const {store,bindings}=fixture(t);store.setMeta('mainThread',logical);const before=snapshot(store);
 assert.equal(bindings.current(logical),undefined);assert.equal(snapshot(store),before);
 bindings.publish(logical,logical,root,()=>true);
 assert.deepEqual(bindings.current(logical),{logicalId:logical,...root});
 const registered=snapshot(store);bindings.publish(logical,logical,root,()=>true);
 assert.equal(snapshot(store),registered);assert.equal(store.meta('mainThread'),logical);
});

test('fork publication retains immutable ancestry across both provider directions',t=>{
 const {store,bindings}=fixture(t);bindings.publish(logical,logical,root,()=>true);
 const original=store.meta(recordKey(logical));bindings.publish(logical,logical,child,()=>true);
 const prior=store.meta(recordKey(child.nativeId));
 bindings.publish(logical,child.nativeId,{nativeId:'native:return',provider:'openai',parentNativeId:child.nativeId},()=>true);
 assert.equal(bindings.current(logical)?.nativeId,'native:return');
 assert.equal(store.meta(recordKey(logical)),original);assert.equal(store.meta(recordKey(child.nativeId)),prior);
 assert.equal(new module.NativeThreadBindings(store).current(logical)?.provider,'openai');
});

test('segment lookup identifies retired and foreign owned roots while unknown native children stay unknown',t=>{
 const {store,bindings}=fixture(t);bindings.publish(logical,logical,root,()=>true);bindings.publish(logical,logical,child,()=>true);
 bindings.publish('thread:other','thread:other',{nativeId:'thread:other',provider:'openai',parentNativeId:null},()=>true);
 assert.deepEqual(bindings.segment(logical),{logicalId:logical,...root});
 assert.equal(bindings.segment('thread:other')?.logicalId,'thread:other');
 assert.equal(bindings.segment('native:real-child'),undefined);
 store.setMeta(recordKey(child.nativeId),'{');assert.throws(()=>bindings.segment(child.nativeId),/native_thread_binding_invalid/);
});

test('committed head is restored by a reopened Store without rewriting legacy facts',t=>{
 const parent=resolve('.codex/scratch/native-thread-bindings-unit');mkdirSync(parent,{recursive:true});
 const directory=mkdtempSync(join(parent,'case-')),path=join(directory,'state.sqlite');let store=new Store(path);
 t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
 store.setMeta('mainThread',logical);const bindings=new module.NativeThreadBindings(store);
 bindings.publish(logical,logical,root,()=>true);bindings.publish(logical,logical,child,()=>true);
 store.close();store=new Store(path);
 assert.deepEqual(new module.NativeThreadBindings(store).current(logical),{logicalId:logical,...child});
 assert.equal(store.meta('mainThread'),logical);
});

test('publication rejects stale head, revoked owner and a revocation during the transaction',t=>{
 const {store,bindings}=fixture(t);bindings.publish(logical,logical,root,()=>true);const before=snapshot(store);
 assert.throws(()=>bindings.publish(logical,'stale',child,()=>true),/native_thread_binding_conflict/);
 assert.throws(()=>bindings.publish(logical,logical,child,()=>false),/native_thread_owner_changed/);
 let checks=0;assert.throws(()=>bindings.publish(logical,logical,child,()=>++checks===1),/native_thread_owner_changed/);
 assert.ok(checks>=2);assert.equal(snapshot(store),before);
});

test('head write failure rolls back the new lineage record',t=>{
 const {store,bindings}=fixture(t);bindings.publish(logical,logical,root,()=>true);const before=snapshot(store),save=store.setMeta;
 store.setMeta=function(key,value){if(key===headKey(logical))throw Error('synthetic_head_write_failure');save.call(this,key,value);};
 assert.throws(()=>bindings.publish(logical,logical,child,()=>true),/synthetic_head_write_failure/);
 assert.equal(snapshot(store),before);assert.equal(bindings.current(logical)?.nativeId,logical);
});

test('legacy forks require observed root registration and cannot invent a parent provider',t=>{
 const {store,bindings}=fixture(t);const before=snapshot(store);
 assert.throws(()=>bindings.publish(logical,logical,child,()=>true),/native_thread_binding_invalid/);
 assert.equal(snapshot(store),before);
});

for(const next of [
 {nativeId:'foreign-root',provider:'openai',parentNativeId:null},
 {nativeId:logical,provider:'unknown',parentNativeId:null},
 {nativeId:'',provider:'openai',parentNativeId:null},
 {nativeId:logical,provider:'openai',parentNativeId:null,extra:true},
])test('publication refuses invalid root '+JSON.stringify(next),t=>{
 const {store,bindings}=fixture(t);const before=snapshot(store);
 assert.throws(()=>bindings.publish(logical,logical,next as any,()=>true),/native_thread_binding_invalid/);
 assert.equal(snapshot(store),before);
});

test('native IDs have one logical owner and prior ancestry cannot be promoted backwards',t=>{
 const {store,bindings}=fixture(t);bindings.publish(logical,logical,root,()=>true);
 bindings.publish('thread:other','thread:other',{nativeId:'thread:other',provider:'openai',parentNativeId:null},()=>true);
 const before=snapshot(store);
 assert.throws(()=>bindings.publish(logical,logical,{nativeId:'thread:other',provider:'homer',parentNativeId:logical},()=>true),/native_thread_binding_conflict/);
 assert.throws(()=>bindings.publish(logical,logical,{...root,provider:'homer'},()=>true),/native_thread_binding_conflict/);
 assert.equal(snapshot(store),before);
 bindings.publish(logical,logical,child,()=>true);const forked=snapshot(store);
 assert.throws(()=>bindings.publish(logical,child.nativeId,root,()=>true),/native_thread_binding_invalid/);
 assert.equal(snapshot(store),forked);
});

for(const fault of ['missing-record','missing-head','cycle','unknown-provider','unknown-field','malformed-json'])test('current refuses corrupted ancestry: '+fault,t=>{
 const {store,bindings}=fixture(t);bindings.publish(logical,logical,root,()=>true);bindings.publish(logical,logical,child,()=>true);
 if(fault==='missing-record')store.db.prepare('DELETE FROM meta WHERE key=?').run(recordKey(logical));
 else if(fault==='missing-head')store.db.prepare('DELETE FROM meta WHERE key=?').run(headKey(logical));
 else if(fault==='malformed-json')store.setMeta(recordKey(child.nativeId),'{');
 else store.setMeta(recordKey(child.nativeId),JSON.stringify({logicalId:logical,...child,...(fault==='cycle'?{parentNativeId:child.nativeId}:fault==='unknown-provider'?{provider:'unknown'}:{extra:true})}));
 assert.throws(()=>bindings.current(logical),/native_thread_binding_invalid/);
});

test('turn bindings retain actual native identity after a fork and reject conflicting replay',t=>{
 const {store,bindings}=fixture(t);bindings.bindTurn(logical,logical,'turn:legacy',()=>true);
 assert.deepEqual(bindings.turn(logical,'turn:legacy'),{logicalId:logical,nativeId:logical,turnId:'turn:legacy'});
 bindings.publish(logical,logical,root,()=>true);bindings.publish(logical,logical,child,()=>true);
 bindings.bindTurn(logical,child.nativeId,'turn:member',()=>true);const before=snapshot(store);
 bindings.bindTurn(logical,child.nativeId,'turn:member',()=>true);assert.equal(snapshot(store),before);
 assert.equal(bindings.turn(logical,'turn:legacy')?.nativeId,logical);
 assert.throws(()=>bindings.bindTurn(logical,logical,'turn:late',()=>true),/native_thread_binding_conflict/);
 assert.throws(()=>bindings.bindTurn(logical,child.nativeId,'turn:legacy',()=>true),/native_thread_turn_conflict/);
 assert.throws(()=>bindings.bindTurn('thread:other',child.nativeId,'turn:cross',()=>true),/native_thread_binding_conflict/);
 assert.equal(snapshot(store),before);
});

test('turn binding checks current ownership before writing and before commit',t=>{
 const {store,bindings}=fixture(t);let checks=0;const before=snapshot(store);
 assert.throws(()=>bindings.bindTurn(logical,logical,'turn:revoked',()=>false),/native_thread_owner_changed/);
 assert.throws(()=>bindings.bindTurn(logical,logical,'turn:revoked',()=>++checks===1),/native_thread_owner_changed/);
 assert.equal(snapshot(store),before);
 store.setMeta(turnKey(logical,'turn:bad'),JSON.stringify({logicalId:'thread:other',nativeId:logical,turnId:'turn:bad'}));
 assert.throws(()=>bindings.turn(logical,'turn:bad'),/native_thread_turn_invalid/);
});

test('turn binding joins the receipt transaction and follows its commit or rollback',t=>{
 const {store,bindings}=fixture(t);
 store.transaction(()=>{store.setMeta('receipt','committed');bindings.bindTurn(logical,logical,'turn:committed',()=>true);assert.equal(store.db.isTransaction,true);});
 assert.equal(bindings.turn(logical,'turn:committed')?.nativeId,logical);
 const before=snapshot(store);
 assert.throws(()=>store.transaction(()=>{store.setMeta('receipt','uncommitted');bindings.bindTurn(logical,logical,'turn:rolled-back',()=>true);throw Error('synthetic_receipt_failure');}),/synthetic_receipt_failure/);
 assert.equal(snapshot(store),before);assert.equal(bindings.turn(logical,'turn:rolled-back'),undefined);
});

test('turn audit cannot treat a missing registered ancestor as a legacy unmapped root',t=>{
 const {store,bindings}=fixture(t);bindings.publish(logical,logical,root,()=>true);bindings.bindTurn(logical,logical,'turn:root',()=>true);
 bindings.publish(logical,logical,child,()=>true);store.db.prepare('DELETE FROM meta WHERE key=?').run(recordKey(logical));
 assert.throws(()=>bindings.turn(logical,'turn:root'),/native_thread_binding_invalid/);
});

const effectTurn='turn:effect',effectItem='native:item';
const effectRows=(store:Store)=>store.db.prepare("SELECT key,value FROM meta WHERE key GLOB 'nativeWorkerEffect:v1:*' ORDER BY key").all() as {key:string;value:string}[];
function effectFixture(t:TestContext){const f=fixture(t);f.bindings.publish(logical,logical,root,()=>true);f.bindings.bindTurn(logical,logical,effectTurn,()=>true);return f;}

test('Worker start without an actual terminal remains durable after its owner is gone',t=>{
 const {store,bindings}=effectFixture(t);bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'running',false,()=>true);
 assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),true);assert.equal(new module.NativeThreadBindings(store).hasUnconfirmedWorkerEffects(logical),true);
 const record=JSON.parse(effectRows(store)[0]!.value);assert.deepEqual(Object.keys(record).sort(),['itemId','logicalId','nativeId','status','turnId']);assert.equal(record.status,'pending');
});

for(const status of ['completed','failed','declined','interrupted'])test('only an actual matching Worker terminal resolves pending effect: '+status,t=>{
 const {bindings}=effectFixture(t);bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'running',false,()=>true);
 bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,status,false,()=>true);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),true);
 bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,status,true,()=>true);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),false);
});

test('unknown terminal status stays pending without storing its arbitrary input string',t=>{
 const {store,bindings}=effectFixture(t);bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'SYNTHETIC_PRIVATE_STATUS',true,()=>true);
 assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),true);assert.equal(effectRows(store)[0]!.value.includes('SYNTHETIC_PRIVATE_STATUS'),false);
});

test('first proven Worker terminal is immutable across duplicates, late starts and conflicting terminals',t=>{
 const {store,bindings}=effectFixture(t);bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'running',false,()=>true);bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'completed',true,()=>true);const before=snapshot(store);
 for(const [status,completed] of [['completed',true],['running',false],['unknown',true],['failed',true]] as const)bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,status,completed,()=>true);
 assert.equal(snapshot(store),before);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),false);
});

test('a reordered actual terminal can establish a tombstone before its late start',t=>{
 const {bindings}=effectFixture(t);bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'declined',true,()=>true);bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'running',false,()=>true);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),false);
});

test('late completion cannot mint a fact and cannot clear another item',t=>{
 const {store,bindings}=effectFixture(t);const before=snapshot(store);bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'completed',true,()=>true,false);assert.equal(snapshot(store),before);
 bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'running',false,()=>true);const pending=snapshot(store);
 bindings.recordWorkerEffect(logical,logical,effectTurn,'other-item','completed',true,()=>true,false);assert.equal(snapshot(store),pending);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),true);
 bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'completed',true,()=>true,false);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),false);
});

for(const [owner,native,turn] of [['thread:other',logical,effectTurn],[logical,'native:other',effectTurn],[logical,logical,'turn:other']])test('Worker effect cannot clear or create under a mismatched raw turn owner: '+[owner,native,turn].join('/'),t=>{
 const {store,bindings}=effectFixture(t);bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'running',false,()=>true);const before=snapshot(store);
 assert.throws(()=>bindings.recordWorkerEffect(owner!,native!,turn!,effectItem,'completed',true,()=>true,false),/native_worker_effect_turn_mismatch/);assert.equal(snapshot(store),before);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),true);
});

test('legacy raw native ID equals logical ID only with its matching persisted turn audit',t=>{
 const {store,bindings}=fixture(t);assert.throws(()=>bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'running',false,()=>true),/native_worker_effect_turn_mismatch/);
 bindings.bindTurn(logical,logical,effectTurn,()=>true);bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'running',false,()=>true);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),true);
 bindings.publish(logical,logical,root,()=>true);bindings.publish(logical,logical,child,()=>true);bindings.bindTurn(logical,child.nativeId,'turn:child',()=>true);const before=snapshot(store);
 assert.throws(()=>bindings.recordWorkerEffect(logical,logical,'turn:child','child-item','running',false,()=>true),/native_worker_effect_turn_mismatch/);assert.equal(snapshot(store),before);
 bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'completed',true,()=>true,false);assert.equal(bindings.current(logical)?.nativeId,child.nativeId);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),false);
});

test('Worker effect writes check ownership before mutation and before commit',t=>{
 const {store,bindings}=effectFixture(t);const before=snapshot(store);
 assert.throws(()=>bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'running',false,()=>false),/native_thread_owner_changed/);
 let checks=0;assert.throws(()=>bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'running',false,()=>++checks===1),/native_thread_owner_changed/);assert.equal(snapshot(store),before);
 bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'running',false,()=>true);const pending=snapshot(store);checks=0;
 assert.throws(()=>bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'completed',true,()=>++checks===1),/native_thread_owner_changed/);assert.equal(snapshot(store),pending);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),true);
});

test('Worker effect updates join the existing receipt transaction and follow rollback',t=>{
 const {store,bindings}=effectFixture(t);store.transaction(()=>{store.setMeta('effect-receipt','started');bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'running',false,()=>true);assert.equal(store.db.isTransaction,true);});const before=snapshot(store);
 assert.throws(()=>store.transaction(()=>{store.setMeta('effect-receipt','uncommitted');bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'completed',true,()=>true);throw Error('synthetic_effect_receipt_failure');}),/synthetic_effect_receipt_failure/);
 assert.equal(snapshot(store),before);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),true);
});

test('Worker effect pending and terminal facts survive reopening the actual Store',t=>{
 const parent=resolve('.codex/scratch/native-thread-bindings-unit');mkdirSync(parent,{recursive:true});const directory=mkdtempSync(join(parent,'effects-')),path=join(directory,'state.sqlite');let store=new Store(path),bindings=new module.NativeThreadBindings(store);
 t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});bindings.bindTurn(logical,logical,effectTurn,()=>true);bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'running',false,()=>true);store.close();
 store=new Store(path);bindings=new module.NativeThreadBindings(store);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),true);bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'completed',true,()=>true,false);store.close();
 store=new Store(path);assert.equal(new module.NativeThreadBindings(store).hasUnconfirmedWorkerEffects(logical),false);
});

test('Worker effect keys separate tuple boundaries and logical IDs containing query metacharacters',t=>{
 const {store,bindings}=fixture(t),id='thread:%_["🧪';bindings.bindTurn(id,id,'a:b',()=>true);bindings.bindTurn(id,id,'a',()=>true);
 bindings.recordWorkerEffect(id,id,'a:b','c','running',false,()=>true);bindings.recordWorkerEffect(id,id,'a','b:c','running',false,()=>true);assert.equal(effectRows(store).length,2);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),false);
 bindings.recordWorkerEffect(id,id,'a:b','c','completed',true,()=>true);assert.equal(bindings.hasUnconfirmedWorkerEffects(id),true);bindings.recordWorkerEffect(id,id,'a','b:c','completed',true,()=>true);assert.equal(bindings.hasUnconfirmedWorkerEffects(id),false);
});

for(const fault of ['malformed-json','unknown-field','wrong-key','wrong-logical','wrong-native','wrong-turn','wrong-item','unknown-status','missing-turn-audit'])test('corrupted Worker effect evidence fails closed on lookup and update: '+fault,t=>{
 const {store,bindings}=effectFixture(t);bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'running',false,()=>true);const row=effectRows(store)[0]!,record=JSON.parse(row.value);
 if(fault==='malformed-json')store.setMeta(row.key,'{');else if(fault==='missing-turn-audit')store.db.prepare('DELETE FROM meta WHERE key=?').run(turnKey(logical,effectTurn));else if(fault==='wrong-key'){store.db.prepare('DELETE FROM meta WHERE key=?').run(row.key);store.setMeta(row.key+'extra',row.value);}else{if(fault==='unknown-field')record.body='SYNTHETIC_FORBIDDEN_BODY';if(fault==='wrong-logical')record.logicalId='other';if(fault==='wrong-native')record.nativeId='other';if(fault==='wrong-turn')record.turnId='other';if(fault==='wrong-item')record.itemId='other';if(fault==='unknown-status')record.status='other';store.setMeta(row.key,JSON.stringify(record));}
 assert.throws(()=>bindings.hasUnconfirmedWorkerEffects(logical),/native_worker_effect_invalid/);
 if(fault!=='wrong-key')assert.throws(()=>bindings.recordWorkerEffect(logical,logical,effectTurn,effectItem,'completed',true,()=>true),/native_worker_effect_invalid|native_worker_effect_turn_mismatch/);
});

const nativeChild='native:subagent',nativeChildTurn='turn:subagent';
const effectOwner={nativeId:logical,turnId:effectTurn};

test('native child effect keeps actual child identity and resolves only with its audited owner',t=>{
 const {store,bindings}=effectFixture(t);
 bindings.recordWorkerEffect(logical,nativeChild,nativeChildTurn,effectItem,'running',false,()=>true,true,effectOwner);
 assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),true);assert.deepEqual(JSON.parse(effectRows(store)[0]!.value),{logicalId:logical,nativeId:nativeChild,turnId:nativeChildTurn,itemId:effectItem,status:'pending',ownerNativeId:logical,ownerTurnId:effectTurn});
 bindings.recordWorkerEffect(logical,nativeChild,nativeChildTurn,effectItem,'completed',true,()=>true,false,effectOwner);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),false);
 const before=snapshot(store);bindings.recordWorkerEffect(logical,nativeChild,nativeChildTurn,effectItem,'running',false,()=>true,true,effectOwner);assert.equal(snapshot(store),before);
});

for(const mismatch of ['owner-native','owner-turn','other-audited-turn','owner-omitted'])test('a wrong native child owner cannot clear pending effects: '+mismatch,t=>{
 const {store,bindings}=effectFixture(t);bindings.bindTurn(logical,logical,'turn:other-owner',()=>true);bindings.recordWorkerEffect(logical,nativeChild,nativeChildTurn,effectItem,'running',false,()=>true,true,effectOwner);const before=snapshot(store);
 const owner=mismatch==='owner-native'?{...effectOwner,nativeId:'foreign-native'}:mismatch==='owner-turn'?{...effectOwner,turnId:'missing-turn'}:mismatch==='other-audited-turn'?{...effectOwner,turnId:'turn:other-owner'}:undefined;
 assert.throws(()=>bindings.recordWorkerEffect(logical,nativeChild,nativeChildTurn,effectItem,'completed',true,()=>true,false,owner),/native_worker_effect_turn_mismatch/);assert.equal(snapshot(store),before);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),true);
});

test('late native child terminals cannot mint new facts or clear another actual tuple',t=>{
 const {store,bindings}=effectFixture(t);const empty=snapshot(store);bindings.recordWorkerEffect(logical,nativeChild,nativeChildTurn,effectItem,'completed',true,()=>true,false,effectOwner);assert.equal(snapshot(store),empty);
 bindings.recordWorkerEffect(logical,nativeChild,nativeChildTurn,effectItem,'running',false,()=>true,true,effectOwner);const before=snapshot(store);
 for(const [native,turn,item] of [[nativeChild,'other-turn',effectItem],[nativeChild,nativeChildTurn,'other-item'],['other-child',nativeChildTurn,effectItem]] as const)bindings.recordWorkerEffect(logical,native,turn,item,'completed',true,()=>true,false,effectOwner);
 assert.equal(snapshot(store),before);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),true);
});

for(const actual of ['current','retired','foreign','owner'])test('registered Homer segments cannot be presented as native child effects: '+actual,t=>{
 const {store,bindings}=effectFixture(t);bindings.publish(logical,logical,child,()=>true);bindings.publish(logical,child.nativeId,{nativeId:'native:current',provider:'openai',parentNativeId:child.nativeId},()=>true);
 bindings.publish('thread:foreign','thread:foreign',{nativeId:'thread:foreign',provider:'openai',parentNativeId:null},()=>true);const before=snapshot(store);
 const native=actual==='current'?'native:current':actual==='retired'?child.nativeId:actual==='foreign'?'thread:foreign':logical;
 assert.throws(()=>bindings.recordWorkerEffect(logical,native,nativeChildTurn,effectItem,'running',false,()=>true,true,effectOwner),/native_worker_effect_turn_mismatch/);assert.equal(snapshot(store),before);
});

test('native child effect owner checks roll back both creation and terminal writes',t=>{
 const {store,bindings}=effectFixture(t),before=snapshot(store);let checks=0;
 assert.throws(()=>bindings.recordWorkerEffect(logical,nativeChild,nativeChildTurn,effectItem,'running',false,()=>++checks===1,true,effectOwner),/native_thread_owner_changed/);assert.equal(snapshot(store),before);
 bindings.recordWorkerEffect(logical,nativeChild,nativeChildTurn,effectItem,'running',false,()=>true,true,effectOwner);const pending=snapshot(store);checks=0;
 assert.throws(()=>store.transaction(()=>{store.setMeta('child-effect-receipt','uncommitted');bindings.recordWorkerEffect(logical,nativeChild,nativeChildTurn,effectItem,'completed',true,()=>++checks===1,false,effectOwner);}),/native_thread_owner_changed/);assert.equal(snapshot(store),pending);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),true);
});

for(const fault of ['missing-native','missing-turn','wrong-native','wrong-turn','unknown-field','registered-child'])test('corrupted native child owner evidence fails closed: '+fault,t=>{
 const {store,bindings}=effectFixture(t);bindings.recordWorkerEffect(logical,nativeChild,nativeChildTurn,effectItem,'running',false,()=>true,true,effectOwner);const row=effectRows(store)[0]!,value=JSON.parse(row.value);
 if(fault==='registered-child')bindings.publish(nativeChild,nativeChild,{nativeId:nativeChild,provider:'openai',parentNativeId:null},()=>true);else{if(fault==='missing-native')delete value.ownerNativeId;if(fault==='missing-turn')delete value.ownerTurnId;if(fault==='wrong-native')value.ownerNativeId='other';if(fault==='wrong-turn')value.ownerTurnId='other';if(fault==='unknown-field')value.body='SYNTHETIC_FORBIDDEN_BODY';store.setMeta(row.key,JSON.stringify(value));}
 assert.throws(()=>bindings.hasUnconfirmedWorkerEffects(logical),/native_worker_effect_invalid/);
});

test('Worker effect audit has no lifetime item cap',t=>{
 const {store,bindings}=effectFixture(t);for(let i=0;i<257;i++)bindings.recordWorkerEffect(logical,logical,effectTurn,'item:'+i,'running',false,()=>true);assert.equal(effectRows(store).length,257);
 for(let i=0;i<257;i++)bindings.recordWorkerEffect(logical,logical,effectTurn,'item:'+i,'completed',true,()=>true);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),false);
});

test('failed effect guard rolls back its own write even when the outer receipt catches and commits',t=>{
 const {store,bindings}=effectFixture(t);bindings.recordWorkerEffect(logical,nativeChild,nativeChildTurn,effectItem,'running',false,()=>true,true,effectOwner);const before=effectRows(store);let checks=0;
 store.transaction(()=>{assert.throws(()=>bindings.recordWorkerEffect(logical,nativeChild,nativeChildTurn,effectItem,'completed',true,()=>++checks===1,false,effectOwner),/native_thread_owner_changed/);store.setMeta('outer-effect-receipt','committed');});
 assert.equal(store.meta('outer-effect-receipt'),'committed');assert.deepEqual(effectRows(store),before);assert.equal(bindings.hasUnconfirmedWorkerEffects(logical),true);
});

test('the fixed rollout format recovers only exact terminal evidence',async t=>{
 const parent=resolve('.codex/scratch/native-thread-bindings-unit');
 mkdirSync(parent,{recursive:true});
 const home=realpathSync(mkdtempSync(join(parent,'rollout-')));
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const sessions=join(home,'sessions'),path=join(sessions,'isolated.jsonl');
 mkdirSync(sessions);
 const pending={logicalId:logical,nativeId:logical,turnId:'turn:a',itemId:'exec-probe',status:'pending'};
 const header={ordinal:0,type:'session_meta',payload:{id:logical,history_mode:'paginated'}};
 const completed={ordinal:2,type:'event_msg',payload:{type:'item_completed',thread_id:logical,turn_id:pending.turnId,
  item:{type:'CommandExecution',id:pending.itemId,status:'failed',exit_code:-1}}};
 const turn={ordinal:1,type:'event_msg',payload:{type:'task_complete',turn_id:pending.turnId}};
 const write=(rows:unknown[],newline='\n')=>writeFileSync(path,rows.map(row=>JSON.stringify(row)).join('\n')+newline);
 write([header,turn,completed]);
 assert.deepEqual(await module.readWorkerTerminals(home,path,logical,[pending]),[{...pending,status:'failed'}]);
 write([header,turn,{...completed,payload:{...completed.payload,turn_id:'wrong'}}]);
 assert.deepEqual(await module.readWorkerTerminals(home,path,logical,[pending]),[]);
 write([header,turn]);assert.deepEqual(await module.readWorkerTerminals(home,path,logical,[pending]),[]);
 write([header,turn,completed],'');assert.deepEqual(await module.readWorkerTerminals(home,path,logical,[pending]),[]);
});
