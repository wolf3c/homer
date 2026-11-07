import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {resolve,join} from 'node:path';
import {createWebServer} from '../src/web-server.js';
test('public build license notices are served as plain text under the existing asset boundary',async()=>{
 const scratch=resolve('.codex/scratch/task-status-license');await mkdir(scratch,{recursive:true});const root=await mkdtemp(join(scratch,'synthetic-'));await mkdir(join(root,'assets'));await writeFile(join(root,'assets/task-status-NOTICES.txt'),'MIT License\nSynthetic test notice');
 const denied=async()=>{throw Error('business_call_forbidden');},server=await createWebServer({port:0,uiDirectory:root,bridge:{state:denied,submit:denied,stop:denied,respond:denied}});
 try{const response=await fetch(server.url+'/assets/task-status-NOTICES.txt');assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/^text\/plain/);assert.match(await response.text(),/MIT License/);
  assert.equal((await fetch(server.url+'/assets/task-status-NOTICES.txt',{headers:{Origin:'https://untrusted.example'}})).status,403);assert.equal((await fetch(server.url+'/assets/task-status-NOTICES.txt?path=private')).status,400);assert.equal((await fetch(server.url+'/private.txt')).status,404);
 }finally{await server.close();await rm(root,{recursive:true,force:true});}
});
