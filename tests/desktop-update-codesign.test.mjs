import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';

test('desktop update uses a real codesign requirement',()=>{
 assert.equal(process.platform,'darwin');
 const bundle=process.env.HOMER_TEST_APP;
 assert.ok(bundle?.startsWith('/'),'HOMER_TEST_APP must be an absolute signed app path');
 const source=readFileSync(new URL('../packaging/electron/main.mjs',import.meta.url),'utf8');
 const setup=source.slice(source.indexOf('async function setupDesktopUpdate('),source.indexOf('async function verifyWindowsUpdate('));
 const call=setup.match(/execFileSync\('\/usr\/bin\/codesign',\['--verify','--strict','-R',[^\n]+/g);
 assert.equal(call?.length,1,'expected one update initialization codesign call');
 let command,args;
 runInNewContext(call[0],{bundle,execFileSync:(bin,argv)=>{command=bin;args=argv;}});
 const run=argv=>{const result=spawnSync(command,argv,{encoding:'utf8',timeout:30000});assert.ifError(result.error);return result.status;};
 assert.equal(run(args),0,'product requirement must accept the signed app');
 assert.ok(args[3].startsWith('='));
 assert.equal(run(args.map((value,i)=>i===3?value.slice(1):value)),1,'old requirement syntax must fail');
 assert.equal(run(args.map((value,i)=>i===3?value.replace('app.homer.desktop','app.homer.wrong'):value)),3,'wrong identifier must fail');
});
