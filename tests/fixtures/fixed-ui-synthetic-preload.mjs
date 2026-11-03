// Test-only module interception: the pinned host and its SQLite owner stay unmodified.
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join,dirname} from 'node:path';
import {EventEmitter} from 'node:events';
import {existsSync} from 'node:fs';
const target=process.env.HOMER_PINNED_TEST_TARGET;
if(!target)throw Error('synthetic_pinned_target_required');
const executable=process.argv[1]?.endsWith('/dist/dev-host.js')?dirname(dirname(process.argv[1])):target;
const host=pathToFileURL(join(executable,'dist/dev-host.js')).href;
const data=source=>({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
registerHooks({resolve(specifier,context,next){
 if(context.parentURL===host){
  if(specifier==='./service.js')return data(`import {Homer as Base} from ${JSON.stringify(pathToFileURL(join(executable,'dist/service.js')).href)};
   import {factory} from ${JSON.stringify(import.meta.url)};
   export class Homer extends Base {constructor(config,sink){super(config,sink,factory);}}`);
  if(specifier==='./engine.js')return data(`export {engineError} from ${JSON.stringify(pathToFileURL(join(executable,'dist/engine.js')).href)};export const codexVersion=()=>"synthetic-pinned-engine";`);
  if(specifier==='./channels/wechat-homer.js')return data(`export class HomerWechat {management={canUpgrade:()=>true,close:async()=>{},state:async()=>({status:'disabled',bound:false,pending:0,uncertain:0})};async restore(){}async onMessage(){}}`);
  if(specifier==='./channels/telegram-homer-bridge.js')return data(`export class TelegramHomerBridge {channel={};async restore(){}async close(){}async handleMessage(){}}`);
  if(specifier==='./channels/telegram-management.js')return data(`export class TelegramManagement {canUpgrade(){return true;}async state(){return {status:'disabled'};}}`);
  if(specifier==='./channels/telegram-migration.js')return data('export async function prepareTelegramMigration(){}');
 }
 return next(specifier,context);
}});
if(process.argv[1]===join(executable,'dist/dev-host.js'))globalThis.fetch=()=>{throw Error('synthetic_external_network_denied');};
export const factory=options=>new Synthetic(options);
class Synthetic extends EventEmitter{
 resumable=true;turnId;closed=false;
 constructor(options){super();this.threadId=options.threadId??'synthetic-pinned-main';this.root=join(dirname(options.cwd),"runtime");}
 async start(){if(existsSync(join(this.root,'fail-start')))throw Error('synthetic_start_failed');return this.threadId;}
 async turn(_text,options){this.turnId='synthetic-turn';options?.onStarted?.(this.turnId);await new Promise(r=>{this.resolveTurn=r;this.timer=setTimeout(r,600000);});clearTimeout(this.timer);this.resolveTurn=undefined;return {status:this.interrupted?'interrupted':'completed',text:'Synthetic pinned reply'};}
 async interrupt(){this.interrupted=true;await new Promise(r=>setTimeout(r,800));this.resolveTurn?.();return true;}
 async close(){this.closed=true;this.resolveTurn?.();return true;}
}
