// Fixed native sandbox, synthetic HOME and loopback Responses only. No real
// account, external Skill download, model call or daily thread/config access.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,symlinkSync,chmodSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {CodexEngine} from '../src/engine.js';
assert.ok(process.argv[2],'pass the fixed 0.163.0 executable explicitly');
const bin=resolve(process.argv[2]!),root=resolve('.codex/scratch/native-system-skills-implementation');
mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'native-skill-writes-'));
const receipt:any={synthetic:true,realAccount:false,realModel:false,externalDownload:false,databaseEdits:false,roles:{},directory:dir};
let requests=0,unexpectedRequests=0;
const http=createServer(async(req,res)=>{
 if(req.url!=='/v1/responses'){unexpectedRequests++;res.writeHead(404);res.end();return;}
 for await(const _ of req){}requests++;
 const item={id:'msg-'+requests,type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic persistence receipt.',annotations:[]}]};
 const response={id:'resp-'+requests,object:'response',created_at:1,model:'gpt-6.1-sol',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
 res.setHeader('Content-Type','text/event-stream');
 for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');
 res.end();
});
await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
let engine:CodexEngine|undefined;
try{
 assert.equal((await import('node:child_process')).execFileSync(bin,['--version'],{encoding:'utf8'}).trim(),'codex-cli 0.163.0');
 receipt.binarySha256=createHash('sha256').update(readFileSync(bin)).digest('hex');
 for(const role of ['main','worker'] as const){
  const data=join(dir,role),home=join(data,'codex'),skills=join(home,'skills'),workspace=join(data,'workspace'),runtime=join(data,'runtime');
  for(const path of [home,workspace,runtime])mkdirSync(path,{recursive:true});
  const config={appData:data,codexHome:home,nativeCodexHome:home,codexBin:bin,workspace,runtime,model:'gpt-6.1-sol',requiresOpenaiAuth:false,timeoutMs:10000,mainTimeoutMs:10000,stopGraceMs:1000,baseUrl:'http://127.0.0.1:'+(http.address() as any).port+'/v1'};
  const make=(threadId?:string)=>new CodexEngine(config,{cwd:workspace,readRoots:[],instructions:'Synthetic local sandbox check.',tools:[],nativeCapabilities:true,nativeTools:role,threadId,permissionRequests:true},async()=>{throw Error('no_model_tools');});
  const proof:any={};receipt.roles[role]=proof;
  engine=make();await engine.start();receipt.version=engine.version;
  const run=(command:string[])=>engine!.request('command/exec',{command,cwd:workspace,permissionProfile:'homer',timeoutMs:10000,env:{CODEX_HOME:home,PYTHONDONTWRITEBYTECODE:'1',TMPDIR:workspace}});
  const py=async(code:string,...args:string[])=>run(['/usr/bin/python3','-B','-c',code,...args]);
  const system=join(skills,'.system'),creator=join(system,'skill-creator/scripts/init_skill.py'),installer=join(system,'skill-installer/scripts/install-skill-from-github.py');
  assert.ok(existsSync(creator)&&existsSync(installer));
  writeFileSync(join(home,'auth.json'),'synthetic-auth');writeFileSync(join(home,'protected-runtime.txt'),'synthetic-library');writeFileSync(join(runtime,'private.txt'),'synthetic-runtime');writeFileSync(join(system,'protected.txt'),'synthetic-system');
  const list=async()=>{const result=await engine!.request('skills/list',{cwds:[workspace],forceReload:true});return (result.data??[]).flatMap((d:any)=>d.skills??[]);};
  for(const mode of ['start','resume']){
   if(mode==='resume'){
    const id:string|undefined=engine.threadId;assert.ok(id);assert.equal((await engine.turn('Synthetic persistence receipt. Do not call tools.')).status,'completed');await engine.close();engine=make(id);await engine.start();assert.equal(engine.threadId,id);
   }
   const p:any={};proof[mode]=p;
   const createdName='synthetic-created-'+mode,created=join(skills,createdName);
   const create=await run(['/usr/bin/python3','-B',creator,createdName,'--path',skills,'--resources','scripts,references,assets','--examples']);
   p.creatorExit=create.exitCode;assert.equal(create.exitCode,0,'native_creator_full_directory');
   for(const child of ['SKILL.md','scripts','references','assets','agents/openai.yaml'])assert.ok(existsSync(join(created,child)),child);
   const update=await py('from pathlib import Path\nimport sys\np=Path(sys.argv[1])\nfor name in ["SKILL.md","scripts/run.py","references/guide.md","assets/template.txt","agents/openai.yaml"]:\n f=p/name\n f.parent.mkdir(parents=True,exist_ok=True)\n f.write_text(f.read_text()+"\\n# synthetic update\\n" if f.exists() else "# synthetic resource\\n")',created);
   p.multiFileUpdateExit=update.exitCode;assert.equal(update.exitCode,0);
   const source=join(workspace,'fixture-repo-'+mode),sourceSkill=join(source,'synthetic-installed-'+mode);
   mkdirSync(sourceSkill,{recursive:true});
   const content:Record<string,string>={'SKILL.md':'---\nname: synthetic-installed-'+mode+'\ndescription: Synthetic full package\n---\n\nLocal only.\n','scripts/run.py':'print("synthetic")\n','references/guide.md':'Synthetic guide.\n','references/nested/schema.json':'{"synthetic":true}\n','assets/template.txt':'Synthetic asset.\n','agents/openai.yaml':'interface:\n  display_name: "Synthetic fixture"\n'};
   for(const [child,text]of Object.entries(content)){const target=join(sourceSkill,child);mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,text);}
   chmodSync(join(sourceSkill,'scripts/run.py'),0o755);
   const binaryAsset=Buffer.from([0,255,128,1,10,0,42]);writeFileSync(join(sourceSkill,'assets/synthetic.bin'),binaryAsset);
   // Keep native source parsing, name/path validation, default destination,
   // copytree and conflict logic. Replace ONLY remote fetch with local fixture.
   const installCode='import importlib.util,sys\nfrom pathlib import Path\np=Path(sys.argv[1]);sys.path.insert(0,str(p.parent))\ns=importlib.util.spec_from_file_location("synthetic_installer",p);m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)\nm._prepare_repo=lambda *_:sys.argv[2]\nraise SystemExit(m.main(["--repo","synthetic/fixture","--path",sys.argv[3]]))';
   const installedName='synthetic-installed-'+mode;
   const install=await py(installCode,installer,source,installedName);p.installerExit=install.exitCode;assert.equal(install.exitCode,0,'native_installer_local_fixture');
   for(const [child,text]of Object.entries(content))assert.equal(readFileSync(join(skills,installedName,child),'utf8'),text);
   assert.deepEqual(readFileSync(join(skills,installedName,'assets/synthetic.bin')),binaryAsset);p.binaryAndNestedResourcesPreserved=true;
   assert.equal(statSync(join(skills,installedName,'scripts/run.py')).mode&0o777,0o755);p.executableModePreserved=true;
   assert.equal((await run(['/usr/bin/python3','-B',join(skills,installedName,'scripts/run.py')])).exitCode,0);p.installedScriptExecuted=true;
   assert.notEqual((await py(installCode,installer,source,installedName)).exitCode,0,'installer refuses overwrite');p.installerConflictRefused=true;
   const escapeName='synthetic-escape-'+mode,escapeSource=join(source,escapeName);mkdirSync(escapeSource);writeFileSync(join(escapeSource,'SKILL.md'),'---\nname: '+escapeName+'\ndescription: Synthetic\n---\n');symlinkSync(join(home,'auth.json'),join(escapeSource,'outside'));
   assert.notEqual((await py(installCode,installer,source,escapeName)).exitCode,0);assert.equal(existsSync(join(skills,escapeName)),false);p.installerEscapeRefused=true;
   const selected=join(skills,installedName,'SKILL.md');await engine.request('skills/config/write',{path:selected,enabled:false});
   assert.equal((await list()).find((s:any)=>s.path===selected)?.enabled,false);p.userDisabledPreserved=true;
   const targets=[join(home,'auth.json'),join(home,'config.toml'),join(home,'protected-runtime.txt'),join(runtime,'private.txt'),join(system,'protected.txt'),join(skills,'../auth.json'),join(home,'plugins/forbidden.txt')];
   if(existsSync(join(skills,'.SYSTEM/protected.txt')))targets.push(join(skills,'.SYSTEM/protected.txt'));
   for(const [n,target]of targets.entries()){
    const before=existsSync(target)?readFileSync(target,'utf8'):undefined;
    const write=await py('from pathlib import Path\nimport sys\np=Path(sys.argv[1]);p.parent.mkdir(parents=True,exist_ok=True);p.write_text("forbidden")',target);
    assert.notEqual(write.exitCode,0,'protected target '+n);assert.equal(existsSync(target)?readFileSync(target,'utf8'):undefined,before);
   }
   for(const [n,target]of [join(home,'auth.json'),join(system,'protected.txt'),join(runtime,'private.txt')].entries()){
    const alias=join(created,'alias-'+n);symlinkSync(target,alias);
    assert.notEqual((await py('from pathlib import Path\nimport sys\nPath(sys.argv[1]).write_text("forbidden")',alias)).exitCode,0);
   }
   for(const target of [system,skills,home])assert.notEqual((await py('import os,sys\nos.rename(sys.argv[1],sys.argv[1]+"-moved")',target)).exitCode,0,'protected ancestor rename');
   p.protectedWritesDenied=targets.length;p.protectedSymlinksDenied=3;p.protectedAncestorMovesDenied=3;p.completePackageVerified=true;
   if(mode==='resume')assert.equal((await list()).find((s:any)=>s.path===join(skills,'synthetic-installed-start/SKILL.md'))?.enabled,false);
  }
  await engine.close();engine=undefined;
 }
 assert.equal(unexpectedRequests,0);receipt.unexpectedLoopbackRequests=unexpectedRequests;receipt.loopbackRequests=requests;receipt.status='passed';
}catch(error){receipt.status='failed';receipt.assertion=error instanceof Error?error.message.split('\n')[0]:'probe_failed';process.exitCode=1;}
finally{await engine?.close();await new Promise<void>(r=>http.close(()=>r()));writeFileSync(join(root,'native-skill-writes-receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));}
