// No model, account login, user config, or real thread. Fixed local protocol only.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { seedBuiltinSkills, builtinEnvironment } from './builtin-bootstrap.mjs';
import { fileURLToPath } from 'node:url';

const [binaryArg,resourceArg]=process.argv.slice(2);
if(!binaryArg||!resourceArg)throw Error('builtin_native_acceptance_requires_fixed_binary_and_resource_root');
const binary=resolve(binaryArg),resources=resolve(resourceArg);
assert.match(execFileSync(binary,['--version'],{encoding:'utf8'}),/0\.163\.0/);
const base=resolve('.codex/scratch/builtin-capabilities-implementation/native');mkdirSync(base,{recursive:true});
const directory=mkdtempSync(join(base,'cold-')),home=join(directory,'Homer/codex'),workspace=join(directory,'Homer/workspace');mkdirSync(workspace,{recursive:true});
seedBuiltinSkills(resources,home);
const env=builtinEnvironment(resources,home);mkdirSync(env.HOME,{recursive:true});
const child=spawn(binary,['app-server','--stdio','-c','analytics.enabled=false','-c','feedback.enabled=false','-c','features.apps=false','-c','features.plugins=false','-c','features.memories=false','-c','cli_auth_credentials_store="file"'],{cwd:workspace,env,stdio:['pipe','pipe','ignore']});
let buffer='',counter=0;const pending=new Map();
child.stdout.on('data',bytes=>{buffer+=bytes;let i;while((i=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;const msg=JSON.parse(line),p=pending.get(msg.id);if(p){pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(Error('native_rpc_'+msg.error.code)):p.resolve(msg.result);}}});
function rpc(method,params){return new Promise((resolve,reject)=>{const id=++counter,timer=setTimeout(()=>{pending.delete(id);reject(Error('native_rpc_timeout'));},20000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
try{
 const init=await rpc('initialize',{clientInfo:{name:'homer_builtin_probe',version:'0.1.0'},capabilities:{experimentalApi:true}});assert.ok(init);
 child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
 const list=await rpc('skills/list',{cwds:[workspace],forceReload:true});
 const skills=(list.data??[]).flatMap(row=>row.skills??[]);
 for(const name of ['homer-local-office','homer-local-browser','homer-local-desktop','skill-creator','skill-installer'])assert.ok(skills.some(s=>s.name===name),'native_skill_missing:'+name);
 for(const name of ['skill-creator','skill-installer'])assert.ok(existsSync(join(home,'skills/.system',name,'SKILL.md')));
 const python=join(resources,'python/bin/python3'),creator=join(home,'skills/.system/skill-creator/scripts');
 const target=join(home,'skills');
 execFileSync(python,['-B',join(creator,'init_skill.py'),'homer-created-probe','--path',target],{env,cwd:workspace,stdio:'pipe'});
 writeFileSync(join(target,'homer-created-probe/SKILL.md'),'---\nname: homer-created-probe\ndescription: Sum the synthetic cold-install acceptance numbers using a local script.\n---\n\nRun scripts/sum.py with the bundled Python. This fixture has no network or credentials.\n');
 mkdirSync(join(target,'homer-created-probe/scripts'),{recursive:true});
 writeFileSync(join(target,'homer-created-probe/scripts/sum.py'),'import json\nprint(json.dumps({"sum":sum([12,30])}))\n');
 execFileSync(python,['-B',join(creator,'quick_validate.py'),join(target,'homer-created-probe')],{env,cwd:workspace,stdio:'pipe'});
 assert.equal(JSON.parse(execFileSync(python,['-B',join(target,'homer-created-probe/scripts/sum.py')],{env,cwd:workspace,encoding:'utf8'})).sum,42);
 mkdirSync(join(directory,'tmp'),{recursive:true});
 const installer=join(home,'skills/.system/skill-installer/scripts/install-skill-from-github.py');
 execFileSync(python,['-B',installer,'--help'],{env,cwd:workspace,stdio:'pipe'});
 execFileSync(python,['-B',fileURLToPath(new URL('./builtin-installer-acceptance.py',import.meta.url)),installer],{env:{...env,TMPDIR:join(directory,'tmp')},cwd:workspace,stdio:'pipe'});
 const refresh=await rpc('skills/list',{cwds:[workspace],forceReload:true});for(const name of ['homer-created-probe','homer-installed-probe'])assert.ok(refresh.data.flatMap(row=>row.skills??[]).some(s=>s.name===name));
 const receipt={passed:true,fixedCodex:'0.163.0',freshHome:true,nativeBuiltinAndSystemDiscovery:true,nativeCreatorRanAndValidated:true,createdSkillBehaviorVerified:true,createdSkillActuallyDiscovered:true,installerCliDependencyCheck:true,nativeInstallerSyntheticZipInstallAndScript:true,installerDuplicateRefusal:true,installedSkillActuallyDiscovered:true,installerRemoteDownload:false,model:false,account:false,thread:false};
 writeFileSync(join(directory,'native-verification.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{child.stdin.end();child.kill('SIGTERM');await new Promise(done=>{if(child.exitCode!==null)done();else child.once('exit',done);});}
