// Fixed backend + a narrowly reviewed UI patch. All business imports stay pinned.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,realpathSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sourceSnapshot,uiHash,backendHash,dependencyHash,schemaHash} from './dev-build.mjs';
import {pinnedInventory,verifyPinned} from './pinned-build.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const entryFiles=['dev.mjs','dev-build.mjs','trusted-build.mjs','dev-ingress.mjs','pinned-build.mjs','fixed-ui-launcher.mjs'];
function owned(path){
 path=realpathSync(resolve(path));
 const builds=realpathSync(resolve('.codex/scratch/dev-upgrade/builds'));
 if(!path.startsWith(builds+'/'))throw Error('fixed_build_location_denied');
 return path;
}
function sources(directory){return [...sourceSnapshot(directory).files].map(([path,bytes])=>({path,sha256:sha(bytes)}));}
function entryInventory(directory){
 const names=readdirSync(directory).sort();
 if(!equal(names,[...entryFiles].sort())||names.some(name=>!lstatSync(join(directory,name)).isFile()||lstatSync(join(directory,name)).isSymbolicLink()))throw Error('fixed_entry_inventory_invalid');
 return names.map(path=>({path,sha256:sha(readFileSync(join(directory,path)))}));
}
function uiIdentity(directory){return {directory:owned(directory),uiHash:uiHash(sourceSnapshot(directory)),source:sources(directory),files:pinnedInventory(directory)};}
function compatible(backend,baseline,patch){
 const a=sourceSnapshot(backend),b=sourceSnapshot(baseline),c=sourceSnapshot(patch);
 const gateway=s=>sha(Buffer.concat(['src/web-server.ts','src/web-contract.ts'].map(path=>s.files.get(path))));
 const protocol=s=>JSON.parse(s.files.get('ui/protocol.json')).version;
 if(![b,c].every(s=>dependencyHash(s)===dependencyHash(a)&&gateway(s)===gateway(a)&&protocol(s)===protocol(a)))throw Error('fixed_ui_contract_mismatch');
 const changed=[...new Set([...b.files.keys(),...c.files.keys()])].filter(path=>!equal(b.files.get(path)?.toString('base64'),c.files.get(path)?.toString('base64'))).sort();
 if(!equal(changed,['ui/homer-app.tsx','ui/homer-styles.css']))throw Error('fixed_ui_patch_scope_denied');
 return {gatewayHash:gateway(a),deps:dependencyHash(a),webProtocol:protocol(a)};
}
// Called only after normal shutdown, using a fresh pinned maintenance manifest.
export function prepareFixedUi({pinnedManifest,baseline,patch,entryDirectory,manifestPath,expectedVersion,expectedBaseUi,expectedPatchUi}){
 const pin=JSON.parse(readFileSync(pinnedManifest));
 verifyPinned(pinnedManifest,pin.configPath);
 const directory=owned(pin.directory),a=sourceSnapshot(directory,pin.configPath);
 if(a.hash.slice(0,12)!==expectedVersion)throw Error('fixed_backend_source_mismatch');
 const base=uiIdentity(baseline),next=uiIdentity(patch);
 if(base.uiHash!==expectedBaseUi||next.uiHash!==expectedPatchUi)throw Error('fixed_ui_source_mismatch');
 const contract=compatible(directory,base.directory,next.directory);
 const manifest={format:1,pinnedManifest:realpathSync(pinnedManifest),pinnedManifestHash:sha(readFileSync(pinnedManifest)),backendSource:sources(directory),backendHash:a.hash,backendOnlyHash:backendHash(a),schema:schemaHash(a),...contract,baseline:base,patch:next,entryDirectory:owned(entryDirectory),entry:entryInventory(entryDirectory)};
 writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 return manifest;
}
export function verifyFixedUi(manifestPath,configPath,{baseline=false}={}){
 const manifest=JSON.parse(readFileSync(manifestPath));
 if(manifest.format!==1||sha(readFileSync(manifest.pinnedManifest))!==manifest.pinnedManifestHash)throw Error('fixed_manifest_changed');
 const pin=verifyPinned(manifest.pinnedManifest,configPath);
 const directory=owned(pin.directory),entry=owned(manifest.entryDirectory);
 if(!equal(entryInventory(entry),manifest.entry)||realpathSync(dirname(fileURLToPath(import.meta.url)))!==entry)throw Error('fixed_entry_changed');
 const a=sourceSnapshot(directory,configPath);
 if(a.hash!==manifest.backendHash||backendHash(a)!==manifest.backendOnlyHash||schemaHash(a)!==manifest.schema||!equal(sources(directory),manifest.backendSource))throw Error('fixed_backend_source_changed');
 for(const ui of baseline?[manifest.baseline]:[manifest.baseline,manifest.patch])if(!equal(uiIdentity(ui.directory),ui))throw Error('fixed_ui_changed');
 const contract=baseline?(()=>{const s=sourceSnapshot(manifest.baseline.directory);return {gatewayHash:sha(Buffer.concat(['src/web-server.ts','src/web-contract.ts'].map(path=>s.files.get(path)))),deps:dependencyHash(s),webProtocol:JSON.parse(s.files.get('ui/protocol.json')).version};})():compatible(directory,manifest.baseline.directory,manifest.patch.directory);
 if(!equal(contract,{gatewayHash:manifest.gatewayHash,deps:manifest.deps,webProtocol:manifest.webProtocol}))throw Error('fixed_ui_contract_mismatch');
 return {manifest,pin,baseline};
}
export async function runFixedUi(manifestPath,configPath,webPort,baseline=false,json=false){
 const {manifest:m,pin}=verifyFixedUi(manifestPath,configPath,{baseline});
 const {loadConfig}=await import(pathToFileURL(join(pin.directory,'dist/config.js')).href);
 const {MAIN_TOOLS}=await import(pathToFileURL(join(pin.directory,'dist/tools.js')).href);
 const config=loadConfig(configPath),toolsHash=sha(JSON.stringify(MAIN_TOOLS));
 if(toolsHash!==pin.database.metadata.mainToolsHash)throw Error('main_tools_migration_required');
 const boundary=sha(JSON.stringify([config.runtime,config.workspace,config.codexBin,config.codexHome,config.baseUrl,config.keyEnv,config.requiresOpenaiAuth]));
 const build={directory:pin.directory,hash:m.backendHash,version:m.backendHash.slice(0,12),backendHash:m.backendOnlyHash,uiHash:uiHash(sourceSnapshot(pin.directory)),schema:m.schema,toolsHash,boundary,config,thread:pin.database.metadata.mainThread};
 const {runDev}=await import('./dev.mjs');
 return runDev({root:pin.cwd,configPath,webPort,json,fixedBuild:build,fixedUi:baseline?m.baseline:m.patch,fallbackUi:m.baseline});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,manifest,config,port,...flags]=process.argv.slice(2);
 try{
  if(mode!=='run'||!manifest||!config||!Number.isInteger(Number(port))||Number(port)<1||Number(port)>65535||flags.some(x=>!['--baseline-ui','--json'].includes(x)))throw Error('fixed_arguments_invalid');
  await runFixedUi(manifest,config,Number(port),flags.includes('--baseline-ui'),flags.includes('--json'));
 }catch(error){console.error(/^[a-z_]+$/.test(error.message)?error.message:'fixed_start_failed');process.exitCode=1;}
}
