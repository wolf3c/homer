import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {loadPrompts} from '../src/prompts.js';import {NativeMemory} from '../src/native-memory.js';import {fixture} from './recursive-fixture.js';import {CodexEngine} from '../src/engine.js';
test('product prompts no longer require or inject a memory policy resource',()=>{
 const root=resolve('.codex/scratch/flexible-execution-review');mkdirSync(root,{recursive:true});const d=mkdtempSync(join(root,'prompts-'));for(const n of ['main','worker'])writeFileSync(join(d,n+'.md'),n);
 assert.equal(loadPrompts(pathToFileURL(d+'/')).worker,'worker');assert.doesNotMatch(loadPrompts().main,/记忆边界/);assert.equal(loadPrompts().main,loadPrompts().main);
});
test('native notes do not invalidate unrelated work or mutate existing legacy rows',()=>{
 const f=fixture();try{const home=join(f.dir,'native'),notes=join(home,'memories/notes');mkdirSync(notes,{recursive:true});
 // Compatibility adapter does not adopt, rewrite or inspect native fact bodies.
 const before=f.store.db.prepare('SELECT * FROM meta').all();const m=new NativeMemory(f.store,home);const snapshot=m.snapshot('');writeFileSync(join(notes,'note.md'),'synthetic fact');m.validateSnapshot(snapshot);assert.deepEqual(f.store.db.prepare('SELECT * FROM meta').all(),before);
 }finally{f.close();}
});
test('main and worker append product methods, enable native memory tools, and leave extraction defaults native',async()=>{
 const root=resolve('.codex/scratch/flexible-execution-review');const d=mkdtempSync(join(root,'engine-defaults-')),home=join(d,'codex');mkdirSync(home);
 for(const role of ['main','worker'] as const){const cwd=join(d,role);mkdirSync(cwd);const e=new CodexEngine({appData:d,codexHome:home,codexBin:resolve('tests/fixtures/native-feature-app-server.mjs'),runtime:join(d,'runtime'),workspace:cwd,model:'synthetic',requiresOpenaiAuth:false,timeoutMs:1000,mainTimeoutMs:1000,stopGraceMs:100},{cwd,readRoots:[],tools:[],instructions:'synthetic product methods',nativeCapabilities:true,nativeTools:role},async()=>({}));try{await e.start();const r=await e.request('synthetic/inspect',{});assert.equal(r.threadParams.baseInstructions,undefined);assert.equal(r.threadParams.developerInstructions,'synthetic product methods');assert.equal(r.argv.some((s:string)=>s.startsWith('memories.generate_memories=')),false);assert.equal(r.argv.some((s:string)=>s.startsWith('memories.extract_model=')),false);assert.equal(r.argv.includes('features.memories=true'),true);}finally{await e.close();}}
});
