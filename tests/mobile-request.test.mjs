import {test} from 'node:test';import assert from 'node:assert/strict';
import {build} from 'esbuild';
const source=await build({entryPoints:['ui/mobile-request.ts'],bundle:true,write:false,format:'cjs',platform:'browser',plugins:[{name:'synthetic-channel',setup(build){build.onResolve({filter:/^\.\/mobile-connection\.js$/},()=>({path:'channel',namespace:'synthetic'}));build.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:'export const mobileCall=(op,input)=>globalThis.__call(op,input);'}));}}]});
function fixture(answer={}){const calls=[],module={exports:{}};Function('globalThis','module','exports',source.outputFiles[0].text)({__call:async(op,input)=>{calls.push({op,input});return typeof answer==='function'?answer():answer;}},module,module.exports);return {fetch:module.exports.mobileFetch,calls};}
test('mobile chat adapter preserves request identity and denies management paths before RTC',async()=>{
 const f=fixture({requestId:'same-request'}),response=await f.fetch(new Request('https://localhost/api/messages',{method:'POST',body:JSON.stringify({requestId:'same-request',text:'synthetic'})}));
 assert.equal(response.status,202);assert.deepEqual(f.calls,[{op:'messages.submit',input:{requestId:'same-request',text:'synthetic'}}]);
 for(const path of ['/api/update/approve','/api/mobile/state','/api/files/result-one/reveal','/api/channels/telegram'])assert.equal((await f.fetch(new Request('https://localhost'+path))).status,409);
 assert.equal(f.calls.length,1);
});
test('mobile reads decode the existing binary artifact bytes and revision selectors',async()=>{
 const f=fixture({filename:'synthetic.bin',mime:'application/octet-stream',data:Buffer.from([0,5,255,7]).toString('base64'),sha256:'synthetic'});
 const response=await f.fetch(new Request('https://localhost/api/media/message-one/asset-00000000-0000-0000-0000-000000000000/3'));
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([0,5,255,7]));
 assert.equal(response.headers.get('x-homer-artifact-hash'),'synthetic');
 assert.deepEqual(f.calls,[{op:'media.read',input:{messageId:'message-one',assetId:'asset-00000000-0000-0000-0000-000000000000',revision:3}}]);
});
test('aborted reads do not become successful or generic error responses',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();
 await assert.rejects(f.fetch(new Request('https://localhost/api/history/state',{signal:controller.signal})),{name:'AbortError'});
 assert.equal(f.calls.length,0);
});

test('aborting an in-flight read rejects promptly while the original operation is not replayed',async()=>{
 let complete;const f=fixture(()=>new Promise(resolve=>{complete=resolve;})),controller=new AbortController();
 const response=f.fetch(new Request('https://localhost/api/history/state',{signal:controller.signal}));controller.abort();
 await assert.rejects(response,{name:'AbortError'});assert.equal(f.calls.length,1);complete({});
});

test('restored draft images use the same scoped preview operation over RTC',async()=>{
 const f=fixture({mime:'image/png',data:Buffer.from([0,5,255,7]).toString('base64')});
 const scope={threadId:'thread',requestId:'draft',assetId:'asset-00000000-0000-0000-0000-000000000000',revision:1};
 const response=await f.fetch(new Request('https://localhost/api/uploads/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(scope)}));
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([0,5,255,7]));
 assert.deepEqual(f.calls,[{op:'media.preview',input:scope}]);
});
