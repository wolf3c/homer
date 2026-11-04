// Fixed native protocol, isolated HOME and loopback fake Responses only.
// Never pass a daily HOME or credentials. No real model or database edits.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {CodexEngine} from '../src/engine.js';

assert.ok(process.argv[2], 'pass the fixed 0.163.0 executable explicitly');
const bin=resolve(process.argv[2]!);
const root=resolve('.codex/scratch/native-system-skills-implementation');
mkdirSync(root,{recursive:true});
const dir=mkdtempSync(join(root,'native-protocol-'));
type Skill={name:string;path:string;enabled:boolean;description:string};
const receipt:any={synthetic:true,realModel:false,realAccount:false,databaseEdits:false,roles:{}};
const prompts:string[]=[];
let unexpectedRequests=0;
const http=createServer(async(req,res)=>{
 if(req.url!=='/v1/responses'){unexpectedRequests++;res.writeHead(404);res.end();return;}
 let raw='';for await(const chunk of req)raw+=chunk;prompts.push(raw);
 // Only booleans derived from synthetic requests are written into the receipt.
 const item={id:'msg-skill-'+prompts.length,type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic protocol receipt.',annotations:[]}]};
 const response={id:'resp-skill-'+prompts.length,object:'response',created_at:1,model:'gpt-6.1-sol',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
 res.setHeader('Content-Type','text/event-stream');
 for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');
 res.end();
});
await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
const baseUrl='http://127.0.0.1:'+(http.address() as any).port+'/v1';
let engine:CodexEngine|undefined;
try{
 for(const role of ['main','worker'] as const){
  const appData=join(dir,role),home=join(appData,'codex'),cwd=join(appData,'workspace');
  mkdirSync(home,{recursive:true});mkdirSync(cwd,{recursive:true});
  const ordinary=join(home,'skills/synthetic-ordinary/SKILL.md');
  mkdirSync(join(home,'skills/synthetic-ordinary'),{recursive:true});
  writeFileSync(ordinary,'---\nname: synthetic-ordinary\ndescription: Synthetic ordinary discovery marker\n---\n\nSynthetic body.\n');
  const invalid=join(home,'skills/synthetic-invalid/SKILL.md');
  mkdirSync(join(home,'skills/synthetic-invalid'),{recursive:true});
  writeFileSync(invalid,'---\nname: synthetic-invalid\n---\n\nMissing description.\n');
  const config={appData,codexHome:home,nativeCodexHome:home,codexBin:bin,workspace:cwd,runtime:join(appData,'runtime'),baseUrl,model:'gpt-6.1-sol',requiresOpenaiAuth:false,timeoutMs:10000,mainTimeoutMs:10000,stopGraceMs:1000};
  const make=(threadId?:string,legacy=false)=>{
   const next=new CodexEngine(config,{cwd,readRoots:[],instructions:'Synthetic local protocol validation.',tools:[],nativeCapabilities:true,nativeTools:role,threadId},async()=>{throw Error('unexpected_model_tool');});
   if(legacy){
    const request=next.request.bind(next);
    next.request=async(method,params:any)=>{
     if(method==='thread/start'){
      const listed=await request('skills/list',{cwds:[cwd],forceReload:true});
      const disabled=(listed.data??[]).flatMap((d:any)=>d.skills??[]).filter((s:Skill)=>s.path.startsWith(join(home,'skills/.system')+'/')).map((s:Skill)=>({path:s.path,enabled:false}));
      params={...params,config:{...params.config,'skills.config':[...params.config['skills.config'],...disabled]}};
     }
     return request(method,params);
    };
   }
   return next;
  };
  const catalog=async()=>{
   const listed=await engine!.request('skills/list',{cwds:[cwd],forceReload:true});
   return {skills:(listed.data??[]).flatMap((d:any)=>d.skills??[]) as Skill[],errors:(listed.data??[]).flatMap((d:any)=>d.errors??[])};
  };
  const turn=async(selected?:Skill)=>{
   const before=prompts.length;
   assert.equal((await engine!.turn('Synthetic protocol check. Reply briefly; do not call tools.',selected?{skills:[{name:selected.name,path:selected.path}]}:undefined)).status,'completed');
   const requests=prompts.slice(before);
   assert.ok(requests.length>0);
   proof.turnRequestCounts??=[];proof.turnRequestCounts.push(requests.length);
   const primary=requests.find(raw=>JSON.parse(raw).model===config.model&&raw.includes('Synthetic protocol check. Reply briefly; do not call tools.'));
   assert.ok(primary,'native turn must reach only the loopback fixture');
   const strings=(value:any):string[]=>typeof value==='string'?[value]:value&&typeof value==='object'?Object.values(value).flatMap(strings):[];
   const decoded=strings(JSON.parse(primary));
   if(selected){
    const body=readFileSync(selected.path,'utf8').replace(/^---[\s\S]*?\n---\s*\n/,'').trim();
    assert.ok(decoded.some(text=>text.includes(body)));proof.enabledExplicitSystemBodyLoaded=true;
   }
   const catalogs=decoded.flatMap(value=>[...value.matchAll(/<skills_instructions>[\s\S]*?<\/skills_instructions>/g)].map(m=>m[0]));
   proof.catalogFragmentCounts??=[];proof.catalogFragmentCounts.push(catalogs.length);
   // Historical catalogs remain in context. Assert the newest native catalog.
   return catalogs.at(-1)??'';
  };
  const proof:any={};receipt.roles[role]=proof;
  engine=make();const thread=await engine.start();
  assert.equal(engine.version,'0.163.0');receipt.version=engine.version;
  let listed=await catalog();
  const system=listed.skills.filter(s=>s.path.startsWith(join(home,'skills/.system')+'/'));
  assert.ok(system.length>0);assert.ok(system.every(s=>s.enabled));
  assert.ok(listed.errors.some((e:any)=>e.path===invalid));
  assert.ok(listed.skills.some(s=>s.path===ordinary&&s.enabled));
  const implicit=system.filter(s=>{const policy=join(dirname(s.path),'agents/openai.yaml');return !existsSync(policy)||!/allow_implicit_invocation:\s*false/.test(readFileSync(policy,'utf8'));});
  proof.nativeSystemCount=system.length;proof.nativeImplicitSystemCount=implicit.length;proof.nativeParserRejectsInvalid=true;
  const initial=await turn();
  assert.ok(implicit.every(s=>initial.includes(s.description)));
  assert.ok(system.filter(s=>!implicit.includes(s)).every(s=>!initial.includes(s.description)));
  proof.nativeImplicitInvocationPolicyPreserved=true;
  proof.startAdvertisesNativeSystems=true;
  const explicitOnly=system.find(s=>!implicit.includes(s));assert.ok(explicitOnly);await turn(explicitOnly);
  assert.ok(await engine.close());engine=make(thread);assert.equal(await engine.start(),thread);
  const resumed=await turn();assert.ok(implicit.every(s=>resumed.includes(s.description)));
  proof.sameThreadResumeAdvertisesNativeSystems=true;
  const disabled=implicit[0]!;
  await engine.request('skills/config/write',{path:disabled.path,enabled:false});
  await engine.request('skills/config/write',{path:ordinary,enabled:false});
  listed=await catalog();assert.equal(listed.skills.find(s=>s.path===disabled.path)?.enabled,false);
  assert.equal(listed.skills.find(s=>s.path===ordinary)?.enabled,false);
  assert.ok(await engine.close());engine=make(thread);assert.equal(await engine.start(),thread);
  const afterDisable=await turn();assert.equal(afterDisable.includes(disabled.description),false);assert.equal(afterDisable.includes('Synthetic ordinary discovery marker'),false);
  assert.ok(implicit.filter(s=>s!==disabled).every(s=>afterDisable.includes(s.description)));
  proof.nativeUserDisableSurvivesResume=true;
  assert.ok(await engine.close());
  engine=make(undefined,true);const legacyThread=await engine.start();
  const legacyPrompt=await turn();assert.ok(implicit.every(s=>!legacyPrompt.includes(s.description)));
  proof.oldBlanketOverrideReproduced=true;
  assert.ok(await engine.close());engine=make(legacyThread);assert.equal(await engine.start(),legacyThread);
  const recovered=await turn();assert.equal(recovered.includes(disabled.description),false);assert.equal(recovered.includes('Synthetic ordinary discovery marker'),false);
  assert.ok(implicit.filter(s=>s!==disabled).every(s=>recovered.includes(s.description)));
  proof.oldBlanketRecoveredBySupportedColdResume=true;
  proof.genuineUserDisablesPreservedDuringRecovery=true;
  // A deliberate persistent disable cannot be attributed to Homer from its
  // value alone. Only a reviewed native user action should change that intent.
  await engine.request('skills/config/write',{path:disabled.path,enabled:true});
  assert.ok(await engine.close());engine=make(legacyThread);assert.equal(await engine.start(),legacyThread);
  assert.ok((await turn()).includes(disabled.description));
  assert.equal((await catalog()).skills.find(s=>s.path===ordinary)?.enabled,false);
  proof.supportedUserToggleRestoresOnlySelectedSystem=true;
  assert.ok(await engine.close());engine=undefined;
 }
 assert.equal(unexpectedRequests,0);
 receipt.mockResponses=prompts.length;receipt.unexpectedLoopbackRequests=unexpectedRequests;
 receipt.binarySha256=createHash('sha256').update(readFileSync(bin)).digest('hex');
 receipt.status='passed';
}catch(error){receipt.status='failed';receipt.failure=error instanceof Error?error.message:'probe_failed';process.exitCode=1;}
finally{
 await engine?.close();await new Promise<void>(r=>http.close(()=>r()));
 writeFileSync(join(root,'native-protocol-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt));
}
