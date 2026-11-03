// Normal isolated candidate build against a NEW synthetic application-data root.
// No process starts and no existing account/session/credential/log file is read.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,lstatSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {sourceSnapshot,buildCandidate} from './dev-build.mjs';
const project=resolve('.'),scratch=join(project,'.codex/scratch/native-capabilities-implementation');mkdirSync(scratch,{recursive:true});
const trial=mkdtempSync(join(scratch,'update-preservation-')),data=join(trial,'application-data');
const files=['codex/config.toml','codex/skills/synthetic/SKILL.md','codex/sessions/synthetic.jsonl','codex/state_5.sqlite','codex/models_cache.json','codex/logs_2.sqlite','codex/memories/memory_summary.md','codex/memories/MEMORY.md','codex/memories_1.sqlite','codex/memories_v2/memory_summary.md','codex/memories_v2/MEMORY.md','codex/memories_v2_1.sqlite','codex/memories_extensions/synthetic-note.md','runtime/homer.sqlite','workspace/materials/synthetic.txt'];
for(const name of files){const target=join(data,name);mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,'synthetic-preservation-marker:'+name+'\n');}
const fingerprint=()=>Object.fromEntries(files.map(name=>[name,createHash('sha256').update(readFileSync(join(data,name))).digest('hex')]));
const before=fingerprint(),configPath=join(trial,'homer-synthetic.config.json');
// /usr/bin/false is resolved only; buildCandidate never launches an engine.
writeFileSync(configPath,JSON.stringify({appData:data,codexBin:'/usr/bin/false',model:'synthetic',requiresOpenaiAuth:false}));
const snapshot=sourceSnapshot(project,configPath);
assert.ok([...snapshot.files.keys()].every(name=>!name.startsWith('.codex/')));
const candidate=await buildCandidate(project,configPath,snapshot);
assert.equal(candidate.config.appData,data);assert.equal(candidate.config.codexHome,join(data,'codex'));assert.equal(candidate.config.runtime,join(data,'runtime'));
assert.deepEqual(fingerprint(),before);
const forbidden=new Set(files.map(name=>name.split('/').at(-1)));
function ensureNoData(folder){for(const entry of readdirSync(folder)){if(entry==='node_modules')continue;const full=join(folder,entry),stat=lstatSync(full);assert.ok(!stat.isSymbolicLink());if(stat.isDirectory())ensureNoData(full);else assert.ok(!forbidden.has(entry),'candidate must not bundle user data: '+entry);}}
ensureNoData(candidate.directory);
const invalid={...snapshot,files:new Map(snapshot.files)};invalid.files.set('tsconfig.json',Buffer.from(JSON.stringify({extends:'unsupported',compilerOptions:{rootDir:'src',outDir:'dist'}})));
await assert.rejects(()=>buildCandidate(project,configPath,invalid),/dev_build_configuration_unsupported/);
assert.deepEqual(fingerprint(),before);
const result={syntheticOnly:true,noEngineOrAccount:true,normalBuildExit:0,failedBuildRejected:true,userDataUnchangedAfterBoth:true,userDataExcludedFromBuild:true,paths:files,candidate:candidate.directory,configHome:candidate.config.codexHome};
writeFileSync(join(scratch,'native-update-preservation-checks.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
