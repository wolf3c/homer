import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { builtinEnvironment, seedBuiltinSkills } from './builtin-bootstrap.mjs';
import { verifyBuiltinResources } from './builtin-build.mjs';

const resources=resolve(process.argv[2]),fixedCodex=resolve(process.argv[3]);
const before=verifyBuiltinResources(resources);
const base=resolve('.codex/scratch/builtin-capabilities-implementation/cold-acceptance');mkdirSync(base,{recursive:true});
const directory=mkdtempSync(join(base,'installation-')),appData=join(directory,'Homer'),home=join(appData,'codex');
const env={...builtinEnvironment(resources,home),HOMER_BUILTIN_ACCEPTANCE:'1',TMPDIR:join(home,'tmp'),LANG:'en_US.UTF-8'};
for(const path of[env.HOME,env.TMPDIR,join(appData,'workspace')])mkdirSync(path,{recursive:true});
const node=join(resources,'node/bin/node'),python=join(resources,'python/bin/python3');
const run=(bin,args)=>execFileSync(bin,args,{env,cwd:directory,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024});
const seeded=seedBuiltinSkills(resources,home);assert.equal(seeded.created.length,3);
assert.equal(seedBuiltinSkills(resources,home).alreadySeeded,true);
const officeDirectory=join(appData,'workspace/office');
const office=JSON.parse(run(python,['-B',fileURLToPath(new URL('./builtin-office-acceptance.py',import.meta.url)),officeDirectory]).trim());assert.equal(office.coldHome,true);
run(python,['-B','-m','pip','check']);
const desktopHelp=run(join(resources,'desktop/cliclick'),['-h']);assert.match(desktopHelp,/Version 5\.1/);
const native=JSON.parse(run(node,[fileURLToPath(new URL('./builtin-native-acceptance.mjs',import.meta.url)),fixedCodex,resources]).trim());
const browser=JSON.parse(run(node,[fileURLToPath(new URL('./builtin-browser-acceptance.mjs',import.meta.url)),resources]).trim());
assert.ok(native.passed&&browser.passed);
const previews=join(appData,'workspace/previews');mkdirSync(previews);
const rendered=[];
for(const ext of['docx','pptx','xlsx','pdf']){
 const source=join(officeDirectory,'cold-install-report.'+ext),result=spawnSync('/usr/bin/qlmanage',['-t','-s','1200','-o',previews,source],{env,encoding:'utf8',timeout:30000});
 rendered.push({format:ext,exit:result.status,previewExists:existsSync(join(previews,'cold-install-report.'+ext+'.png'))});
}
const after=verifyBuiltinResources(resources);assert.equal(after.manifest.bytes,before.manifest.bytes);
const receipt={passed:true,platform:`${process.platform}-${process.arch}`,node:run(node,['--version']).trim(),python:office.python,bytes:before.manifest.bytes,sourceHomeCopied:false,globalDependenciesUsed:false,installedUserSkills:seeded.created,office,native,browser,systemPreviews:rendered,desktopHelpExit:0,desktopActionsTested:false,desktopConditions:['person grants Accessibility and Screen Recording to actual launcher'],searchAndImage:'existing native connection and model/usage conditions; no additional real call',realModel:false,realAccount:false,thread:false,resourceFilesUnmodified:true};
writeFileSync(join(directory,'cold-install-verification.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({directory,...receipt}));
