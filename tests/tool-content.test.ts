import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureToolValue,TOOL_CONTENT_LIMITS,nativeToolContent} from '../src/tool-content.js';

test('call snapshots preserve JSON values and distinguish absent, pending and hidden',()=>{
 for(const value of [false,0,null,'',{},[],{key:'document-key',keyboard:'kept',tokenCount:10}])assert.deepEqual(captureToolValue(value),{state:'recorded',value});
 assert.deepEqual(captureToolValue(undefined),{state:'not-recorded'});
 const circular:any={};circular.self=circular;
 let reads=0;const getter={get secret(){reads++;throw Error('never execute');}};
 const proxy=new Proxy({},{ownKeys(){reads++;throw Error('never execute');}});
 for(const value of [circular,getter,proxy,Array(3),1n,()=>{},NaN,new Date()])assert.equal(captureToolValue(value).state,'hidden');
 assert.equal(reads,0);
 assert.deepEqual(nativeToolContent({type:'dynamicToolCall',arguments:false},false)?.output,{state:'pending'});
 assert.deepEqual(nativeToolContent({type:'dynamicToolCall',arguments:0,contentItems:null},true)?.output,{state:'recorded',value:null});
});

test('credentials are removed before persistence without hiding ordinary object keys',()=>{
 const value=captureToolValue({authorization:'Bearer FICTIONAL_AUTH',cookie:'FICTIONAL_COOKIE',apiKey:'FICTIONAL_API',APIKey:'FICTIONAL_API_ALIAS',secretKey:'FICTIONAL_SECRET_KEY',encryption_key:'FICTIONAL_ENCRYPTION_KEY',publicKey:'public-value',password:'FICTIONAL_PASS',private_key:'FICTIONAL_KEY',env:{SERVICE_TOKEN:'FICTIONAL_ENV',DATABASE_URL:'postgres://FICTIONAL_USER:FICTIONAL_PASSWORD@db.invalid/example'},key:'ordinary-record',monkey:'kept',output:'secretKey=FICTIONAL_INLINE_SECRET token=FICTIONAL_INLINE Bearer FICTIONAL_BEARER sk-proj-FICTIONALSECRET1234567890'});
 const json=JSON.stringify(value);
 assert.doesNotMatch(json,/FICTIONAL/);assert.match(json,/ordinary-record/);assert.match(json,/kept/);assert.match(json,/public-value/);
 assert.equal(value.redacted,true);
 assert.deepEqual(captureToolValue('Bearer FICTIONAL_ONLY'),{state:'recorded',value:'Bearer [已遮蔽]',redacted:true});
});

test('large strings, wide and deep JSON are bounded with explicit omission markers',()=>{
 const huge=captureToolValue('中'.repeat(1_000_000));assert.equal(huge.state,'truncated');
 assert.ok(Buffer.byteLength(JSON.stringify(huge))<=TOOL_CONTENT_LIMITS.bytes+256);assert.match(JSON.stringify(huge),/已省略/);
 let deep:any='end';for(let i=0;i<100;i++)deep={nested:deep};assert.equal(captureToolValue(deep).state,'truncated');
 const wide=captureToolValue(Array.from({length:10_000},(_,i)=>({index:i,text:'a'.repeat(1000)})));
 assert.equal(wide.state,'truncated');assert.ok(Buffer.byteLength(JSON.stringify(wide))<=TOOL_CONTENT_LIMITS.bytes+256);
 const edge=captureToolValue(Object.fromEntries(Array.from({length:400},(_,i)=>['k'.repeat(200)+i,'x'.repeat(i%100)])));
 assert.equal(edge.state,'truncated');assert.ok(Buffer.byteLength(JSON.stringify(edge))<=TOOL_CONTENT_LIMITS.bytes+256);
});

test('native protocol fields map actual input, output and errors without guessing a business receipt',()=>{
 const command=nativeToolContent({type:'commandExecution',command:'echo synthetic',cwd:'/synthetic',aggregatedOutput:'synthetic output',exitCode:2},true)!;
 assert.deepEqual(command.input,{state:'recorded',value:{command:'echo synthetic',cwd:'/synthetic'}});
 assert.deepEqual(command.output,{state:'recorded',value:{output:'synthetic output',exitCode:2}});
 const mcp=nativeToolContent({type:'mcpToolCall',arguments:{query:'synthetic'},result:{content:[],structuredContent:false},error:{message:'synthetic error'}},true)!;
 assert.deepEqual(mcp.output,{state:'recorded',value:{result:{content:[],structuredContent:false},error:{message:'synthetic error'}}});
 assert.equal(nativeToolContent({type:'imageGeneration',result:'FICTIONAL_BINARY'},true)?.output.state,'hidden');
});
