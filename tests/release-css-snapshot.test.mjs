import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {sourceSnapshot} from '../scripts/dev-build.mjs';

// Requirement-derived synthetic build contract. No config, account, database,
// service, model or network; reproduce the launcher's source-only boundary.
test('official CSS reproduces inside the launcher source-only snapshot', {timeout:30000}, () => {
  const root=resolve('.'),parent=join(root,'.codex/scratch/release-css-snapshot');
  mkdirSync(parent,{recursive:true});
  const snapshot=sourceSnapshot(root),directory=mkdtempSync(join(parent,'case-'));
  try {
    for(const [name,bytes]of snapshot.files){const target=join(directory,name);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);}
    symlinkSync(join(root,'node_modules'),join(directory,'node_modules'),'dir');
    const branches=['task-status',...[...snapshot.files.keys()].filter(name=>name.startsWith('ui/vendor/assistant-ui/')&&name.endsWith('.source.css')).map(name=>name.slice(name.lastIndexOf('/')+1,-'.source.css'.length)).sort()];
    for(const component of branches){
      const script=component==='task-status'?'build-task-status-css.mjs':'build-run-activity-css.mjs';
      const args=[join(directory,'scripts',script),...(['task-status','run-activity'].includes(component)?[]:['--'+component]),'--check'];
      const result=spawnSync(process.execPath,args,{cwd:directory,encoding:'utf8',timeout:15000});
      assert.equal(result.status,0,component+' must reproduce from committed inputs: '+(result.stderr??result.error?.message??''));
    }
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
