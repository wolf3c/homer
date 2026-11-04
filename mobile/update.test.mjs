import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareVersions,releaseEnabled,availableUpdate,fetchRelease} from './update.mjs';

const android={platform:'android',channel:'stable',applicationId:'com.homer.mobile',development:false,version:'1.0',build:'3',apiLevel:33,abis:['arm64-v8a']};
const ios={...android,platform:'ios',version:'1.2.9',osVersion:'17.0',storeEnvironment:'production',storefront:'CHN'};
const apk={status:'available',version:'1.3.0',versionCode:4,minApiLevel:29,supportedAbis:['arm64-v8a'],downloadUrl:'https://github.com/wolf3c/homer/releases/download/mobile-1/Homer.apk',sha256:'a'.repeat(64)};
const app={status:'available',version:'1.2.10',minOsVersion:'16.0',verifiedStorefronts:['CHN','USA'],storeUrl:'https://apps.apple.com/app/id6830019784'};
const data=(a=apk,i=app)=>({schemaVersion:1,releases:{stable:{android:a,ios:i}}});
test('numeric versions compare segments, zero tails and arbitrary precision; reject non-numbers',()=>{
 for(const [a,b,result] of [['1.2.10','1.2.9',1],['01.2.0','1.2',0],['1','1.0.1',-1],['9007199254740993','9007199254740992',1],['1.2-beta','1.1',null],['','1',null]])assert.equal(compareVersions(a,b),result);
});
test('only explicit stable production identity enables checks',()=>{
 assert.equal(releaseEnabled(android),true);assert.equal(releaseEnabled(ios),true);
 for(const change of [{channel:undefined},{channel:'qa'},{applicationId:'com.homer.mobile.qa'},{development:true},{platform:'web'},{version:null},{build:null}])assert.equal(releaseEnabled({...android,...change}),false);
 for(const storeEnvironment of ['sandbox','xcode',null,undefined])assert.equal(releaseEnabled({...ios,storeEnvironment}),false);
 for(const change of [{storefront:null},{osVersion:null}])assert.equal(releaseEnabled({...ios,...change}),false);
 for(const change of [{apiLevel:undefined},{abis:null},{build:'3.1'}])assert.equal(releaseEnabled({...android,...change}),false);
});
test('Android uses build, API, ABI and highest dismissed build independently of marketing version',()=>{
 assert.deepEqual(availableUpdate(data(),android,null),{version:'1.3.0',identifier:'4'});
 for(const build of ['4','5'])assert.equal(availableUpdate(data(),{...android,build},null),null);
 for(const local of [{apiLevel:28},{apiLevel:undefined},{abis:['x86']},{abis:null}])assert.equal(availableUpdate(data(),{...android,...local},null),null);
 for(const dismissed of ['4','5','invalid'])assert.equal(availableUpdate(data(),android,dismissed),null);
 assert.ok(availableUpdate(data(),android,'2'));
});
test('iOS uses marketing version, OS and actual verified storefront',()=>{
 assert.deepEqual(availableUpdate(data(),ios,null),{version:'1.2.10',identifier:'1.2.10'});
 for(const change of [{version:'1.2.10.0'},{version:'1.3'},{osVersion:'15.9'},{osVersion:null},{storefront:'CN'},{storefront:null},{storeEnvironment:'sandbox'}])assert.equal(availableUpdate(data(),{...ios,...change},null),null);
 for(const dismissed of ['1.2.10.0','1.3','bad'])assert.equal(availableUpdate(data(),ios,dismissed),null);
 assert.ok(availableUpdate(data(),ios,'1.2.9'));
 assert.ok(availableUpdate(data(apk,{...app,storeUrl:'https://apps.apple.com/cn/app/homer-ai/id6830019784'}),ios,null));
});
test('invalid records fail closed per platform, without remote URL execution',()=>{
 for(const patch of [{status:'coming_soon'},{version:'next'},{versionCode:4.5},{minApiLevel:0},{supportedAbis:[]},{supportedAbis:[null]},{sha256:'bad'},{downloadUrl:[apk.downloadUrl]},{downloadUrl:'https://evil.example/Homer.apk'},{downloadUrl:'https://github.com/wolf3c/homer/releases/latest/download/a.apk'}]){
  assert.equal(availableUpdate(data({...apk,...patch}),android,null),null);assert.ok(availableUpdate(data({...apk,...patch}),ios,null));
 }
 for(const patch of [{status:'coming_soon'},{version:'1.x'},{minOsVersion:'bad'},{verifiedStorefronts:['CN']},{storeUrl:'https://apps.apple.com/app/id999'},{storeUrl:'https://evil.example/app/id6830019784'}])assert.equal(availableUpdate(data(apk,{...app,...patch}),ios,null),null);
 for(const value of [null,{}, {...data(),schemaVersion:2}])assert.equal(availableUpdate(value,android,null),null);
 assert.equal(availableUpdate(data(),{...android,channel:'qa'},null),null);
});
test('release request is anonymous, requests no HTTP caching and bounds JSON parsing, including UTF-8 size',async()=>{
 const original=globalThis.fetch;let calls=[];
 try{
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(data()));};
  assert.deepEqual(await fetchRelease(),data());assert.equal(calls.length,1);assert.equal(calls[0].url,'https://super-tree.com/homer/mobile-releases.json');assert.equal(calls[0].options.credentials,'omit');
  assert.equal(new Headers(calls[0].options.headers).get('cache-control'),'no-cache, no-store');
  assert.equal(calls[0].options.cache,undefined);
  for(const response of [new Response('{}',{status:503}),new Response('bad'),new Response(' '.repeat(32769)),new Response(JSON.stringify({text:'中'.repeat(12000)})),new Response('{}',{headers:{'content-length':'32769'}})]){globalThis.fetch=async()=>response;assert.equal(await fetchRelease(),null);}
  globalThis.fetch=async()=>{throw Error('offline');};assert.equal(await fetchRelease(),null);
 }finally{globalThis.fetch=original;}
});
test('five-second deadline bounds both fetch and body reading even if transport ignores abort',async t=>{
 const original=globalThis.fetch;t.mock.timers.enable({apis:['setTimeout']});
 try{for(const phase of ['fetch','body']){
  let signal;globalThis.fetch=async(_,options)=>{signal=options.signal;return phase==='fetch'?new Promise(()=>{}):{ok:true,headers:new Headers(),body:{getReader:()=>({read:()=>new Promise(()=>{})})}};};
  const request=fetchRelease();await Promise.resolve();t.mock.timers.tick(4999);assert.equal(signal.aborted,false);t.mock.timers.tick(1);assert.equal(await request,null);assert.equal(signal.aborted,true);
 }}finally{globalThis.fetch=original;t.mock.timers.reset();}
});
test('stream stops at 32 KiB without a trustworthy length header and never reads the remaining body',async()=>{
 const original=globalThis.fetch;
 try{for(const length of [null,'1']){
  let reads=0,cancels=0;globalThis.fetch=async()=>({ok:true,headers:new Headers(length===null?{}:{'content-length':length}),body:{getReader:()=>({read:async()=>{reads++;return {done:false,value:new Uint8Array(reads===1?32768:1)};},cancel:async()=>{cancels++;}})}});
  assert.equal(await fetchRelease(),null);assert.equal(reads,2);assert.equal(cancels,1);
 }
  const prefix=JSON.stringify({text:'中'}),bytes=new TextEncoder().encode(prefix+' '.repeat(32768-new TextEncoder().encode(prefix).byteLength));
  globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,10));controller.enqueue(bytes.slice(10));controller.close();}}));
  assert.deepEqual(await fetchRelease(),{text:'中'});
 }finally{globalThis.fetch=original;}
});
