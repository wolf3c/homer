// Explicit fixed-native acceptance; synthetic providers and fresh HOME only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
const run=promisify(execFile),binary=process.env.HOMER_TEST_CODEX_BIN;
assert.ok(binary,'HOMER_TEST_CODEX_BIN must explicitly name the fixed Codex 0.163.0 executable');
const fixed=resolve(binary),root=resolve('.codex/scratch/native-protocol-suite');mkdirSync(root,{recursive:true});
for(const name of ['project-mcp-acceptance','project-mcp-runtime-acceptance','native-rpc-lifecycle-probe','native-system-skills-probe','native-plugin-acceptance','native-tool-acceptance']){
 test(name,{timeout:190000},async()=>{
  const home=mkdtempSync(join(root,name+'-'));mkdirSync(join(home,'tmp'));mkdirSync(join(home,'codex'));
  const env={PATH:process.env.PATH,HOME:home,CODEX_HOME:join(home,'codex'),TMPDIR:join(home,'tmp'),NO_PROXY:'127.0.0.1,localhost',CI:'1'};
  let passed=false;
  try{await run(process.execPath,['--import','tsx','scripts/'+name+'.ts',fixed],{env,timeout:180000,maxBuffer:1024*1024});passed=true;}
  finally{if(passed)rmSync(home,{recursive:true,force:true});}
 });
}
