// HOMER_YEZI2_ROOT=/path/to/yezi2 node_modules/.bin/tsx --test tests/mobile-rtc.integration.mjs
import {test} from 'node:test';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import rtc from 'node-datachannel';
import {MobileDevices} from '../src/mobile-devices.ts';
import {mobileChannel} from '../src/mobile-channel.ts';
import {openMobileSignal} from '../src/mobile-signaling.ts';
import {startMobileRtc} from '../src/mobile-rtc.ts';
import {WEB_PROTOCOL} from '../src/web-contract.ts';
const root=process.env.HOMER_YEZI2_ROOT;if(!root)throw Error('HOMER_YEZI2_ROOT_required');
const {startHomerRtcLab}=await import(pathToFileURL(resolve(root,'scripts/homer-rtc-lab.mjs')));

test('real RTC host registers, pairs with existing approval, delivers authorized events and revokes', {timeout:20000},async()=>{
 let now=Date.now();const lab=await startHomerRtcLab(),devices=new MobileDevices(':memory:',()=>now);
 const keys=generateKeyPairSync('ed25519'),der=keys.publicKey.export({type:'spki',format:'der'}),routeId=createHash('sha256').update(der).digest('hex');
 const route={routeId,prove:challenge=>({routeId,publicKey:der.toString('base64url'),signature:sign(null,Buffer.from(JSON.stringify(['homer-rtc-register-v1',challenge.connectionId,challenge.challenge,routeId])),keys.privateKey).toString('base64url')})};
 let host,signal,sessionId,client;const peer=new rtc.PeerConnection('synthetic-mobile',{iceServers:[]});
 let readyResolve,closeResolve,eventResolve;const ready=new Promise(resolve=>{readyResolve=resolve;}),closed=new Promise(resolve=>{closeResolve=resolve;}),event=new Promise(resolve=>{eventResolve=resolve;});
 const pending=new Map();let sequence=0;const calls=[];
 const call=(op,input={})=>new Promise(resolve=>{const id=String(++sequence);pending.set(id,resolve);void client.send({id,op,input});});
 try{
  const largeFile=Buffer.alloc(8*1024*1024,37).toString('base64');
  host=startMobileRtc({signalOrigin:new URL(lab.url).origin.replace(/^ws/,'http'),route,devices,iceServers:[],call:async(op,input)=>{calls.push(op);return op==='media.read'?{data:largeFile}:input;}});
  await host.ready;
  signal=await openMobileSignal(lab.url,'mobile',event=>{
   if(event.type==='signal'){sessionId=event.sessionId;if(event.description)peer.setRemoteDescription(event.description.sdp,event.description.type);else if(event.candidate?.candidate)peer.addRemoteCandidate(event.candidate.candidate,event.candidate.sdpMid??'0');}
  });
  peer.onLocalDescription((sdp,type)=>void signal.call('send',{sessionId,description:{type,sdp}}));
  peer.onLocalCandidate((candidate,sdpMid)=>void signal.call('send',{sessionId,candidate:{candidate:candidate.replace(/^a=/,''),sdpMid,sdpMLineIndex:0,usernameFragment:null}}));
  peer.onDataChannel(channel=>{
   channel.onClosed(closeResolve);
   channel.onOpen(()=>{
    client=mobileChannel({send:value=>{channel.sendMessageBinary(value);},buffered:()=>channel.bufferedAmount(),closed:()=>!channel.isOpen(),close:()=>channel.close(),receive:fn=>channel.onMessage(value=>{assert.notEqual(typeof value,'string');fn(new Uint8Array(value));})},value=>{
     if(value.event){eventResolve(value);return;}const resolve=pending.get(value.id);pending.delete(value.id);resolve?.(value);
    });readyResolve();
   });
  });
  await signal.call('connect',{routeId});await ready;
  assert.equal((await call('history.state')).error,'mobile_device_denied');assert.equal(calls.length,0);
  let invitation=devices.invite('https://example.test').url.split('#')[1];
  let pair=await call('pair',{invitation,protocol:WEB_PROTOCOL,deviceName:'待确认手机'});assert.equal(pair.result.status,'pending');
  assert.equal(devices.state().pending.name,'待确认手机');
  assert.equal((await call('pair',{invitation,protocol:WEB_PROTOCOL})).error,'mobile_pairing_busy');
  assert.equal((await call('pair.cancel',{credential:'x'.repeat(43)})).result.status,'absent');
  assert.ok(devices.state().pending);
  assert.equal((await call('pair.cancel',{credential:pair.result.credential})).result.status,'cancelled');
  assert.equal(devices.state().pending,null);
  invitation=devices.invite('https://example.test').url.split('#')[1];
  pair=await call('pair',{invitation,protocol:WEB_PROTOCOL});assert.equal(pair.result.status,'pending');
  now+=5*60*1000;
  assert.equal((await call('status',{credential:pair.result.credential})).result.status,'expired');
  assert.equal(devices.state().pending,null);
  invitation=devices.invite('https://example.test').url.split('#')[1];
  pair=await call('pair',{invitation,protocol:WEB_PROTOCOL});assert.equal(pair.result.status,'pending');
  devices.approve(devices.state().pending.id,'手机');
  assert.equal((await call('status',{credential:pair.result.credential})).result.status,'active');
  assert.deepEqual((await call('history.state',{synthetic:'chat'})).result,{synthetic:'chat'});
  await host.event('state',{synthetic:true});assert.deepEqual(await event,{event:'state',value:{synthetic:true}});
  // Exercise actual SCTP backpressure; a zero-buffer fake port cannot expose it.
  const downloaded=await Promise.race([call('media.read'),closed.then(()=>{throw Error('legal_file_download_closed_channel');})]);
  assert.equal(downloaded.result.data,largeFile);
  await signal.call('close',{sessionId});
  assert.equal((await call('history.state',{afterSignalingClose:true})).result.afterSignalingClose,true);
  devices.update(devices.state().devices[0].id,{enabled:false});await closed;
  assert.deepEqual(calls,['history.state','media.read','history.state']);
 }finally{client?.close();peer.close();signal?.close();host?.close();devices.close();await lab.close();rtc.cleanup();}
});
