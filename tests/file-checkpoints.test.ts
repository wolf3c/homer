import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,unlinkSync,existsSync} from 'node:fs';import {join,resolve} from 'node:path';import {FileCheckpoints} from '../src/file-checkpoints.js';
test('non-Git edits/additions/deletions restore only recorded states and preserve concurrent user changes',()=>{
 const root=resolve('.codex/scratch/flexible-execution-review');mkdirSync(root,{recursive:true});const d=mkdtempSync(join(root,'restore-')),runtime=join(d,'private'),p=join(d,'project');mkdirSync(p);const c=new FileCheckpoints(runtime,[runtime]),a=join(p,'a.txt'),b=join(p,'b.txt'),added=join(p,'added.txt');writeFileSync(a,'before');writeFileSync(b,'deleted-before');
 const id=c.capture('task',[a,b,added]).id;writeFileSync(a,'agent-after');unlinkSync(b);writeFileSync(added,'agent-new');c.seal('task',id);
 writeFileSync(a,'concurrent-user');assert.deepEqual(c.restore('task',id).conflicts,[a]);assert.equal(readFileSync(a,'utf8'),'concurrent-user');assert.equal(existsSync(b),false);
 writeFileSync(a,'agent-after');assert.equal(c.restore('task',id).state,'restored');assert.equal(readFileSync(a,'utf8'),'before');assert.equal(readFileSync(b,'utf8'),'deleted-before');assert.equal(existsSync(added),false);
 const next=c.capture('task',[added]).id;writeFileSync(added,'agent-file');c.seal('task',next);writeFileSync(added,'user-new-content');assert.deepEqual(c.restore('task',next).conflicts,[added]);assert.equal(readFileSync(added,'utf8'),'user-new-content');assert.throws(()=>c.seal('other',next),/checkpoint_owner_denied/);
 assert.throws(()=>c.capture('task',[join(runtime,'secret')]),/checkpoint_protected_path/);
});
