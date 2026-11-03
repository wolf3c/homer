import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MobileDevices} from '../src/mobile-devices.js';
import {mobileChannel,type MobileChannelPort} from '../src/mobile-channel.js';
import {openMobileSession} from '../src/mobile-session.js';
import {build} from 'esbuild';

function connection(devices:MobileDevices,calls:string[]){
 let left!:(value:Uint8Array)=>void,right!:(value:Uint8Array)=>void,closed=false;
 const port:MobileChannelPort={send:value=>queueMicrotask(()=>right(value)),receive:fn=>{left=fn;},closed:()=>closed,buffered:()=>0,close:()=>{closed=true;}};
 const other:MobileChannelPort={...port,send:value=>queueMicrotask(()=>left(value)),receive:fn=>{right=fn;}};
 const host=openMobileSession({devices,port,call:async(op,input)=>{calls.push(op);return input;}});
 const replies=new Map<string,(value:any)=>void>();let sequence=0;
 const client=mobileChannel(other,(value:any)=>{const reply=replies.get(value.id);replies.delete(value.id);reply?.(value);});
 return {host,client,closed:()=>closed,call:(op:string,input:unknown={})=>new Promise<any>(resolve=>{const id=String(++sequence);replies.set(id,resolve);void client.send({id,op,input});})};
}
async function bind(devices:MobileDevices,c:ReturnType<typeof connection>){
 const invitation=devices.invite('https://example.test').url.split('#')[1];
 const paired=await c.call('pair',{invitation});
 assert.equal(paired.result.status,'pending');assert.equal(typeof paired.result.credential,'string');
 devices.approve(devices.state().pending!.id,'手机');
 const status=await c.call('status',{credential:paired.result.credential});
 assert.equal(status.result.status,'active');return paired.result.credential as string;
}
test('channel uses the existing pending approval and credential before allowing business',async()=>{
 const devices=new MobileDevices(':memory:'),calls:string[]=[],c=connection(devices,calls);
 try{
  assert.equal((await c.call('history.state')).error,'mobile_device_denied');
  const invitation=devices.invite('https://example.test').url.split('#')[1];
  const paired=await c.call('pair',{invitation});assert.equal(paired.result.status,'pending');
  const credential=paired.result.credential;
  assert.equal((await c.call('status',{credential})).result.status,'pending');
  assert.equal((await c.call('history.state')).error,'mobile_device_denied');assert.equal(calls.length,0);
  devices.approve(devices.state().pending!.id,'我的手机');
  const active=await c.call('status',{credential});assert.equal(active.result.status,'active');assert.equal(active.result.protocol,1);
  assert.deepEqual((await c.call('history.state',{synthetic:true})).result,{synthetic:true});assert.deepEqual(calls,['history.state']);
 }finally{c.host.close();c.client.close();devices.close();}
});
test('disable/delete close only that device and enable permits the same credential on a new channel',async()=>{
 const devices=new MobileDevices(':memory:'),calls:string[]=[],a=connection(devices,calls),b=connection(devices,calls);
 let resumed:ReturnType<typeof connection>|undefined;
 try{
  const credential=await bind(devices,a);await bind(devices,b);
  const [first,second]=devices.state().devices;
  devices.update(first!.id,{enabled:false});assert.equal(a.closed(),true);assert.equal(b.closed(),false);
  assert.equal((await b.call('history.state')).error,undefined);
  devices.update(first!.id,{enabled:true});resumed=connection(devices,calls);
  assert.equal((await resumed.call('status',{credential})).result.status,'active');
  devices.remove(second!.id);assert.equal(b.closed(),true);assert.equal(resumed.closed(),false);
  assert.equal((await resumed.call('history.state')).error,undefined);
 }finally{a.host.close();a.client.close();b.host.close();b.client.close();resumed?.host.close();resumed?.client.close();devices.close();}
});


test('device names are bounded display data, and legacy phones can be approved',async()=>{
 const devices=new MobileDevices(':memory:'),calls:string[]=[],c=connection(devices,calls);
 try{
  const invite=()=>devices.invite('https://example.test').url.split('#')[1];
  for(const deviceName of [undefined,null,' ','\u202e伪造','x'.repeat(61),{name:'X'}]){
   const paired=await c.call('pair',{invitation:invite(),deviceName});
   assert.equal(paired.result.status,'pending');assert.equal(devices.state().pending?.name,'未知设备');
  }
  const invitation=invite(),paired=await c.call('pair',{invitation,deviceName:' 测试手机 '});
  assert.equal(devices.state().pending?.name,'测试手机');
  await c.call('pair',{invitation,credential:paired.result.credential,deviceName:'其他'});
  assert.equal(devices.state().pending?.name,'测试手机');
  assert.equal((await c.call('history.state')).error,'mobile_device_denied');
  devices.approve(devices.state().pending!.id,'测试手机');
  assert.equal((await c.call('status',{credential:paired.result.credential})).result.status,'active');
  assert.deepEqual(calls,[]);
 }finally{c.host.close();c.client.close();devices.close();}
});


test('mobile connection forwards the name through the actual candidate session',async()=>{
 const source=(await build({entryPoints:['ui/mobile-connection.ts'],bundle:true,write:false,format:'cjs',platform:'browser',logLevel:'silent',plugins:[{name:'fake-signal',setup(build){
  build.onResolve({filter:/mobile-signaling\.js$/},()=>({path:'signal',namespace:'fake'}));
  build.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:'export async function openMobileSignal(){return {call:async()=>{},close(){}}}'}));
 }}]})).outputFiles[0]!.text;
 const devices=new MobileDevices(':memory:'),messages:any[]=[],window=new EventTarget() as EventTarget&{__homerMobileNonce:string;ReactNativeWebView:{postMessage:(value:string)=>void}},document=new EventTarget(),module={exports:{}};
 let peer:any,receiveHost:(value:Uint8Array)=>void=()=>{};
 const dc:any={readyState:'open',bufferedAmount:0,close(){},send(value:Uint8Array){queueMicrotask(()=>receiveHost(new Uint8Array(value)));}};
 const port:MobileChannelPort={send(value){const bytes=new Uint8Array(value);queueMicrotask(()=>dc.onmessage({data:bytes.buffer}));},receive(fn){receiveHost=fn;},closed:()=>false,buffered:()=>0,close(){}};
 const host=openMobileSession({devices,port,call:async()=>{throw Error('unexpected_business_call');}});
 class Peer{constructor(){peer=this;}close(){}}
 try{
  window.__homerMobileNonce='synthetic';window.ReactNativeWebView={postMessage:value=>messages.push(JSON.parse(value))};
  Function('window','document','RTCPeerConnection','module','exports',source)(window,document,Peer,module,module.exports);
  const invitation=devices.invite('https://example.test').url.split('#')[1];
  window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:{signalOrigin:'https://signal.example.invalid',routeId:'a'.repeat(64),invitation,deviceName:'测试手机'}}));
  peer.ondatachannel({channel:dc});dc.onopen();
  for(let i=0;i<30&&!messages.some(item=>item.code==='pending');i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(devices.state().pending?.name,'测试手机');assert.ok(messages.some(item=>item.code==='pending'));assert.equal(host.authorized,false);
 }finally{window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:null}));host.close();devices.close();}
});

test('pending approval timeout reaches the phone without granting chat access',async()=>{
 let now=1000;const devices=new MobileDevices(':memory:',()=>now),calls:string[]=[],c=connection(devices,calls);
 try{
  const invitation=devices.invite('https://example.test').url.split('#')[1];
  const paired=await c.call('pair',{invitation});const credential=paired.result.credential;
  assert.equal((await c.call('status',{credential})).result.status,'pending');
  now+=300000;
  const expired=await c.call('status',{credential});assert.equal(expired.result.status,'expired');assert.equal(expired.result.protocol,1);
  assert.equal((await c.call('history.state')).error,'mobile_device_denied');assert.deepEqual(calls,[]);
 }finally{c.host.close();c.client.close();devices.close();}
});

test('a second scan reports an existing request without approving either device',async()=>{
 const devices=new MobileDevices(':memory:'),calls:string[]=[],first=connection(devices,calls),second=connection(devices,calls);
 try{
  const invitation=devices.invite('https://example.test').url.split('#')[1];
  const paired=await first.call('pair',{invitation});assert.equal(paired.result.status,'pending');
  const duplicate=await second.call('pair',{invitation});assert.equal(duplicate.error,'mobile_pairing_busy');
  assert.equal((await second.call('history.state')).error,'mobile_device_denied');
  assert.equal((await first.call('status',{credential:paired.result.credential})).result.status,'pending');
  assert.deepEqual(calls,[]);
 }finally{first.host.close();first.client.close();second.host.close();second.client.close();devices.close();}
});

test('only the matching candidate can cancel a pending request; cancellation is repeatable',async()=>{
 const devices=new MobileDevices(':memory:'),calls:string[]=[],first=connection(devices,calls),other=connection(devices,calls);
 try{
  const invitation=devices.invite('https://example.test').url.split('#')[1];
  const paired=await first.call('pair',{invitation});const credential=paired.result.credential;
  assert.equal((await other.call('pair.cancel',{credential:'x'.repeat(43)})).result.status,'absent');
  assert.ok(devices.state().pending,'an unrelated credential cannot cancel another request');
  assert.equal((await other.call('pair.cancel',{})).error,'mobile_credential_invalid');
  assert.equal((await first.call('pair.cancel',{credential})).result.status,'cancelled');
  assert.equal(devices.state().pending,null);
  assert.equal((await first.call('pair.cancel',{credential})).result.status,'absent');
  assert.equal((await first.call('history.state')).error,'mobile_device_denied');
  assert.deepEqual(calls,[]);
 }finally{first.host.close();first.client.close();other.host.close();other.client.close();devices.close();}
});

test('cancellation does not silently remove a device approved before cancellation',async()=>{
 const devices=new MobileDevices(':memory:'),calls:string[]=[],c=connection(devices,calls);
 try{
  const credential=await bind(devices,c);
  const result=await c.call('pair.cancel',{credential});
  assert.equal(result.result.status,'approved');
  assert.equal(devices.state().devices.length,1);
 }finally{c.host.close();c.client.close();devices.close();}
});

test('mobile connection cancels a pending request over the real device session',async()=>{
 const source=(await build({entryPoints:['ui/mobile-connection.ts'],bundle:true,write:false,format:'cjs',platform:'browser',logLevel:'silent',plugins:[{name:'fake-signal',setup(build){
  build.onResolve({filter:/mobile-signaling\.js$/},()=>({path:'signal',namespace:'fake'}));
  build.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:'export async function openMobileSignal(){return {call:async()=>{},close(){}}}'}));
 }}]})).outputFiles[0]!.text;
 const devices=new MobileDevices(':memory:'),calls:string[]=[],messages:any[]=[],window=new EventTarget() as EventTarget&{__homerMobileNonce:string;ReactNativeWebView:{postMessage:(value:string)=>void}},document=new EventTarget(),module={exports:{}};
 let peer:any,receiveHost:(value:Uint8Array)=>void=()=>{};
 const dc:any={readyState:'open',bufferedAmount:0,close(){},send(value:Uint8Array){queueMicrotask(()=>receiveHost(new Uint8Array(value)));}};
 const port:MobileChannelPort={send(value){const bytes=new Uint8Array(value);queueMicrotask(()=>dc.onmessage({data:bytes.buffer}));},receive(fn){receiveHost=fn;},closed:()=>false,buffered:()=>0,close(){}};
 const host=openMobileSession({devices,port,call:async op=>{calls.push(op);return {};}});
 class Peer{constructor(){peer=this;}close(){}}
 try{
  window.__homerMobileNonce='cancel-integration';window.ReactNativeWebView={postMessage:value=>messages.push(JSON.parse(value))};
  Function('window','document','RTCPeerConnection','module','exports',source)(window,document,Peer,module,module.exports);
  const invitation=devices.invite('https://example.test').url.split('#')[1];
  window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:{signalOrigin:'https://signal.example',routeId:'a'.repeat(64),invitation,deviceName:'测试手机'}}));
  peer.ondatachannel({channel:dc});dc.onopen();
  for(let i=0;i<20&&!devices.state().pending;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(devices.state().pending);
  for(let i=0;i<20&&!messages.some(item=>item.code==='pending');i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(devices.state().pending?.name,'测试手机');
  window.dispatchEvent(new CustomEvent('homer-mobile-cancel'));
  for(let i=0;i<20&&!messages.some(item=>item.type==='cancel-result');i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(messages.find(item=>item.type==='cancel-result')?.result,'cancelled');
  assert.equal(devices.state().pending,null);
  assert.deepEqual(calls,[]);
 }finally{window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:null}));host.close();devices.close();}
});

test('missing and unsafe device names fall back, while replacement and timeout clear the candidate',async()=>{
 let now=1000;const devices=new MobileDevices(':memory:',()=>now),calls:string[]=[],c=connection(devices,calls);
 try{
  const invite=()=>devices.invite('https://example.test').url.split('#')[1];
  for(const deviceName of [undefined,null,'   ','\u202e欺骗', 'a'.repeat(61),{name:'伪造'}]){
   const paired=await c.call('pair',{invitation:invite(),deviceName});
   assert.equal(devices.state().pending?.name,'未知设备');
   assert.equal(paired.result.status,'pending');
  }
  const first=await c.call('pair',{invitation:invite(),deviceName:'第一台'});
  devices.invite('https://example.test');assert.equal(devices.state().pending,null);
  assert.equal((await c.call('status',{credential:first.result.credential})).result.status,'denied');
  const second=await c.call('pair',{invitation:invite(),deviceName:'第二台'});
  assert.equal(devices.state().pending?.name,'第二台');now+=300000;
  assert.equal(devices.state().pending,null);
  assert.equal((await c.call('status',{credential:second.result.credential})).result.status,'expired');
 }finally{c.host.close();c.client.close();devices.close();}
});
