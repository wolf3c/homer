import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const parent=fileURLToPath(new URL('../../.codex/scratch/test-user-homes/',import.meta.url));
mkdirSync(parent,{recursive:true});
const root=mkdtempSync(join(parent,'case-'));
for(const name of ['home','codex'])mkdirSync(join(root,name),{mode:0o700});
process.env.HOME=join(root,'home');
process.env.CODEX_HOME=join(root,'codex');
if(process.platform==='win32')process.env.USERPROFILE=process.env.HOME;
process.once('exit',()=>rmSync(root,{recursive:true,force:true}));
