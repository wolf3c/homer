import {createWebChat} from '../src/web-chat.js';
import type {WebBridge} from '../src/web-contract.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MobileDevices} from '../src/mobile-devices.js';
import {MOBILE_PACKET_BYTES,mobileChannel,type MobileChannelPort} from '../src/mobile-channel.js';
import {openMobileSession} from '../src/mobile-session.js';
import {WEB_PROTOCOL} from '../src/web-contract.js';
import {build} from 'esbuild';

function connection(devices:MobileDevices,calls:string[],handler?:(op:string,input:unknown)=>Promise<unknown>){
 let left!:(value:Uint8Array)=>void,right!:(value:Uint8Array)=>void,closed=false;
 const port:MobileChannelPort={send:value=>queueMicrotask(()=>right(value)),receive:fn=>{left=fn;},closed:()=>closed,buffered:()=>0,close:()=>{closed=true;}};
 const other:MobileChannelPort={...port,send:value=>queueMicrotask(()=>left(value)),receive:fn=>{right=fn;}};
 const host=openMobileSession({devices,port,call:async(op,input)=>{calls.push(op);return handler?handler(op,input):input;}});
 const replies=new Map<string,(value:any)=>void>();let sequence=0;
 const client=mobileChannel(other,(value:any)=>{const reply=replies.get(value.id);replies.delete(value.id);reply?.(value);});
 return {host,client,closed:()=>closed,call:(op:string,input:unknown={})=>new Promise<any>(resolve=>{const id=String(++sequence);replies.set(id,resolve);void client.send({id,op,input});})};
}
async function bind(devices:MobileDevices,c:ReturnType<typeof connection>){
 const invitation=devices.invite('https://example.test').url.split('#')[1];
 const paired=await c.call('pair',{invitation,protocol:WEB_PROTOCOL});
 assert.equal(paired.result.status,'pending');assert.equal(typeof paired.result.credential,'string');
 devices.approve(devices.state().pending!.id,'手机');
 const status=await c.call('status',{credential:paired.result.credential});
 assert.equal(status.result.status,'active');return paired.result.credential as string;
}
test('old mobile pairing reports a version mismatch without consuming the invitation',async()=>{
 const devices=new MobileDevices(':memory:'),calls:string[]=[],c=connection(devices,calls);
 try{
  const invitation=devices.invite('https://example.test').url.split('#')[1];
  for(const protocol of [undefined,1]){
   const old=await c.call('pair',{invitation,protocol});
   assert.equal(old.result.status,'incompatible');
   assert.equal(old.result.protocol,WEB_PROTOCOL);
   assert.notEqual(old.result.protocol,1);
   assert.equal(old.result.credential,undefined);
   assert.equal(devices.state().pending,null);
  }
  assert.equal((await c.call('history.state')).error,'mobile_device_denied');
  assert.equal((await c.call('pair',{invitation,protocol:WEB_PROTOCOL})).result.status,'pending');
  assert.deepEqual(calls,[]);
 }finally{c.host.close();c.client.close();devices.close();}
});
test('channel uses the existing pending approval and credential before allowing business',async()=>{
 const devices=new MobileDevices(':memory:'),calls:string[]=[],c=connection(devices,calls);
 try{
  assert.equal((await c.call('history.state')).error,'mobile_device_denied');
  const invitation=devices.invite('https://example.test').url.split('#')[1];
  const paired=await c.call('pair',{invitation,protocol:WEB_PROTOCOL});assert.equal(paired.result.status,'pending');
  const credential=paired.result.credential;
  assert.equal((await c.call('status',{credential})).result.status,'pending');
  assert.equal((await c.call('history.state')).error,'mobile_device_denied');assert.equal(calls.length,0);
  devices.approve(devices.state().pending!.id,'我的手机');
  const active=await c.call('status',{credential});assert.equal(active.result.status,'active');assert.equal(active.result.protocol,WEB_PROTOCOL);
  assert.deepEqual((await c.call('history.state',{synthetic:true})).result,{synthetic:true});
  const attachment={messageId:'message-one',assetId:'asset-00000000-0000-0000-0000-000000000000',revision:3};
  assert.deepEqual((await c.call('media.read',attachment)).result,attachment);
  assert.deepEqual(calls,['history.state','media.read']);
 }finally{c.host.close();c.client.close();devices.close();}
});
test('schedule detail respects approval and revocation on the paired channel',async()=>{
 const devices=new MobileDevices(':memory:'),calls:string[]=[];
 const input={readEpoch:'epoch',view:'detail',scheduleId:'schedule-00000000-0000-4000-8000-000000000001'} as const;
 const item={scheduleId:input.scheduleId,text:'Synthetic detail'};
 const chat=createWebChat({schedules:async query=>{assert.deepEqual(query,input);return {item,threadId:'synthetic',readEpoch:input.readEpoch,displayTimeZone:'UTC'};}} as WebBridge);
 const c=connection(devices,calls,chat),after=connection(devices,calls,chat);
 try{
  assert.equal((await c.call('schedules.read',input)).error,'mobile_device_denied');
  const credential=await bind(devices,c);
  assert.deepEqual((await c.call('schedules.read',input)).result.item,item);
  devices.update(devices.state().devices[0]!.id,{enabled:false});
  assert.equal(c.closed(),true);
  await after.call('status',{credential});
  assert.equal((await after.call('schedules.read',input)).error,'mobile_device_denied');
  assert.deepEqual(calls,['schedules.read']);
 }finally{c.host.close();c.client.close();after.host.close();after.client.close();devices.close();}
});
test('oversized attachment responses return an error and the same session can download normally',{timeout:3000},async()=>{
 const devices=new MobileDevices(':memory:'),calls:string[]=[];
 const normalBytes=Buffer.from([0,1,2,255]);
 const normal={filename:'正常.zip',mime:'application/zip',data:normalBytes.toString('base64'),sha256:'a'.repeat(64)};
 const large={...normal,filename:'boundary.zip',data:Buffer.alloc(12*1024*1024-3).toString('base64')};
 const unicode={...normal,filename:'文'.repeat(64)+'.zip',data:large.data.slice(0,MOBILE_PACKET_BYTES-256)};
 const c=connection(devices,calls,async(_op,input)=>input==='large'?large:input==='unicode'?unicode:normal);
 try{
  await bind(devices,c);
  const largePacket=JSON.stringify({id:'3',result:large}),unicodePacket=JSON.stringify({id:'4',result:unicode});
  assert.ok(large.data.length<MOBILE_PACKET_BYTES&&largePacket.length>MOBILE_PACKET_BYTES);
  assert.ok(unicodePacket.length<MOBILE_PACKET_BYTES&&Buffer.byteLength(unicodePacket)>MOBILE_PACKET_BYTES);
  assert.deepEqual(await c.call('media.read','large'),{id:'3',error:'mobile_packet_size_limit'});
  assert.deepEqual(await c.call('media.read','unicode'),{id:'4',error:'mobile_packet_size_limit'});
  const download=await c.call('media.read','normal');
  assert.deepEqual(download.result,normal);
  assert.deepEqual(Buffer.from(download.result.data,'base64'),normalBytes);
  assert.equal(c.closed(),false);
  assert.deepEqual(calls,['media.read','media.read','media.read']);
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

test('pending approval timeout reaches the phone without granting chat access',async()=>{
 let now=1000;const devices=new MobileDevices(':memory:',()=>now),calls:string[]=[],c=connection(devices,calls);
 try{
  const invitation=devices.invite('https://example.test').url.split('#')[1];
  const paired=await c.call('pair',{invitation,protocol:WEB_PROTOCOL});const credential=paired.result.credential;
  assert.equal((await c.call('status',{credential})).result.status,'pending');
  now+=300000;
  const expired=await c.call('status',{credential});assert.equal(expired.result.status,'expired');assert.equal(expired.result.protocol,WEB_PROTOCOL);
  assert.equal((await c.call('history.state')).error,'mobile_device_denied');assert.deepEqual(calls,[]);
 }finally{c.host.close();c.client.close();devices.close();}
});

test('a second scan reports an existing request without approving either device',async()=>{
 const devices=new MobileDevices(':memory:'),calls:string[]=[],first=connection(devices,calls),second=connection(devices,calls);
 try{
  const invitation=devices.invite('https://example.test').url.split('#')[1];
  const paired=await first.call('pair',{invitation,protocol:WEB_PROTOCOL});assert.equal(paired.result.status,'pending');
  const duplicate=await second.call('pair',{invitation,protocol:WEB_PROTOCOL});assert.equal(duplicate.error,'mobile_pairing_busy');
  assert.equal((await second.call('history.state')).error,'mobile_device_denied');
  assert.equal((await first.call('status',{credential:paired.result.credential})).result.status,'pending');
  assert.deepEqual(calls,[]);
 }finally{first.host.close();first.client.close();second.host.close();second.client.close();devices.close();}
});

test('only the matching candidate can cancel a pending request; cancellation is repeatable',async()=>{
 const devices=new MobileDevices(':memory:'),calls:string[]=[],first=connection(devices,calls),other=connection(devices,calls);
 try{
  const invitation=devices.invite('https://example.test').url.split('#')[1];
  const paired=await first.call('pair',{invitation,protocol:WEB_PROTOCOL});const credential=paired.result.credential;
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

test('phone name travels with the pending request without granting authorization',async()=>{
 const devices=new MobileDevices(':memory:'),calls:string[]=[],c=connection(devices,calls),other=connection(devices,calls);
 try{
  const invitation=devices.invite('https://example.test').url.split('#')[1];
  const paired=await c.call('pair',{invitation,protocol:WEB_PROTOCOL,deviceName:'  测试手机  '});
  const display=devices.state().pending!;
  assert.equal(display.name,'测试手机');assert.equal(paired.result.verificationCode,undefined);
  await c.call('pair',{invitation,protocol:WEB_PROTOCOL,credential:paired.result.credential,deviceName:'不同名称'});
  assert.equal(devices.state().pending?.name,'测试手机');
  assert.equal((await other.call('pair',{invitation,protocol:WEB_PROTOCOL})).error,'mobile_pairing_busy');
  assert.equal((await c.call('history.state')).error,'mobile_device_denied');
  devices.approve(display.id,display.name);
  assert.equal((await c.call('status',{credential:paired.result.credential})).result.status,'active');
  assert.equal(devices.state().devices[0]?.name,'测试手机');assert.deepEqual(calls,[]);
 }finally{c.host.close();c.client.close();other.host.close();other.client.close();devices.close();}
});

test('missing and unsafe device names fall back, while replacement and timeout clear the candidate',async()=>{
 let now=1000;const devices=new MobileDevices(':memory:',()=>now),calls:string[]=[],c=connection(devices,calls);
 try{
  const invite=()=>devices.invite('https://example.test').url.split('#')[1];
  for(const deviceName of [undefined,null,'   ','\u202e欺骗', 'a'.repeat(61),{name:'伪造'}]){
   const paired=await c.call('pair',{invitation:invite(),protocol:WEB_PROTOCOL,deviceName});
   assert.equal(devices.state().pending?.name,'未知设备');
   assert.equal(paired.result.status,'pending');
  }
  const first=await c.call('pair',{invitation:invite(),protocol:WEB_PROTOCOL,deviceName:'第一台'});
  devices.invite('https://example.test');assert.equal(devices.state().pending,null);
  assert.equal((await c.call('status',{credential:first.result.credential})).result.status,'denied');
  const second=await c.call('pair',{invitation:invite(),protocol:WEB_PROTOCOL,deviceName:'第二台'});
  assert.equal(devices.state().pending?.name,'第二台');now+=300000;
  assert.equal(devices.state().pending,null);
  assert.equal((await c.call('status',{credential:second.result.credential})).result.status,'expired');
 }finally{c.host.close();c.client.close();devices.close();}
});

test('paired mobile message operations reject oversized business JSON without closing the channel',async()=>{
 const devices=new MobileDevices(':memory:');let writes=0;const write=async()=>{writes++;return {};};
 const chat=createWebChat({submit:write,queue:{edit:write,interrupt:write}} as unknown as WebBridge),c=connection(devices,[],chat);
 try{
  await bind(devices,c);
  const input={requestId:'mobile-budget',text:'explain',quotes:[{messageId:'source',text:'中'.repeat(40000),annotation:''}]};
  for(const op of ['messages.submit','messages.edit','messages.interrupt']){
   const value=op==='messages.submit'?input:op==='messages.edit'?{requestId:input.requestId,operationId:'edit',expectedRevision:0,input}:{input,target:{messageId:'source',generationId:'generation'}};
   assert.equal((await c.call(op,value)).error,'request_too_large');assert.equal(writes,0);assert.equal(c.closed(),false);
  }
  const response=await c.call('messages.submit',{requestId:'next',text:'normal'});assert.equal(response.error,undefined);assert.equal(writes,1);
 }finally{c.host.close();devices.close();}
});
