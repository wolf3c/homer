import {test} from 'node:test';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {MobileDevices} from '../src/mobile-devices.ts';
import {openMobileSignal} from '../src/mobile-signaling.ts';
import {startMobileRtc} from '../src/mobile-rtc.ts';
const root=process.env.HOMER_YEZI2_ROOT;if(!root)throw Error('HOMER_YEZI2_ROOT_required');
const {startHomerRtcLab}=await import(pathToFileURL(resolve(root,'scripts/homer-rtc-lab.mjs')));
test('RTC waits for shared TURN credentials; shutdown cannot create a late peer',{timeout:10000},async()=>{
 const lab=await startHomerRtcLab(),devices=new MobileDevices(':memory:');
 const keys=generateKeyPairSync('ed25519'),der=keys.publicKey.export({type:'spki',format:'der'}),routeId=createHash('sha256').update(der).digest('hex');
 const route={routeId,prove:challenge=>({routeId,publicKey:der.toString('base64url'),signature:sign(null,Buffer.from(JSON.stringify(['homer-rtc-register-v1',challenge.connectionId,challenge.challenge,routeId])),keys.privateKey).toString('base64url')})};
 let release,requestedResolve,signal,offers=0;const requested=new Promise(resolve=>{requestedResolve=resolve});
 const turn={get:()=>{requestedResolve();return new Promise(resolve=>{release=resolve})},networkChanged(){}};
 const host=startMobileRtc({signalOrigin:new URL(lab.url).origin.replace(/^ws/,'http'),route,devices,iceServers:[],turn,call:async()=>null});
 try{await host.ready;signal=await openMobileSignal(lab.url,'mobile',event=>{if(event.description)offers++});await signal.call('connect',{routeId});
  await Promise.race([requested,new Promise((_,reject)=>setTimeout(()=>reject(Error('turn_not_requested')),1000))]);assert.equal(offers,0);
  host.disconnect();release([]);await new Promise(resolve=>setTimeout(resolve,50));assert.equal(offers,0);
 }finally{host.close();signal?.close();devices.close();await lab.close();}
});

test('existing desktop device state exposes only a safe TURN recovery status',{timeout:10000},async()=>{
 const {createServer}=await import('node:http');const {mkdtempSync,rmSync}=await import('node:fs');
 const {createMobileGateway}=await import('../src/mobile-gateway.ts');
 const directory=mkdtempSync('.codex/scratch/turn-local-20261102/gateway-'),lab=await startHomerRtcLab();
 const issuer=createServer((_req,res)=>{res.writeHead(403,{'Content-Type':'application/json'});res.end('{"code":"turn_forbidden"}');});await new Promise(resolve=>issuer.listen(0,'127.0.0.1',resolve));
 let gateway;
 try{
  gateway=await createMobileGateway({bridge:{state:async()=>({upgrade:{phase:'running'}})},port:0,signalOrigin:new URL(lab.url).origin.replace(/^ws/,'http'),databasePath:':memory:',routeKeyPath:directory+'/route.pem',turnAccount:{gatewayOrigin:'http://127.0.0.1:'+issuer.address().port,token:'synthetic-private-model-token',allowSyntheticLoopback:true}});
  await gateway.ready;let state;
  for(let tries=0;tries<50;tries++){state=await (await fetch(gateway.url+'/api/mobile/state')).json();if(state.turnStatus)break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(state.turnStatus,'configuration_required');assert.deepEqual(state.devices,[]);assert.equal(state.configured,true);assert.doesNotMatch(JSON.stringify(state),/synthetic-private|Authorization|credential/);
 }finally{await gateway?.close();issuer.closeAllConnections();await new Promise(resolve=>issuer.close(resolve));await lab.close();rmSync(directory,{recursive:true,force:true});}
});

test('invalid TURN account origin is rejected before creating route or device storage',async()=>{
 const {mkdtempSync,rmSync,readdirSync}=await import('node:fs');const {createMobileGateway}=await import('../src/mobile-gateway.ts');
 const directory=mkdtempSync('.codex/scratch/turn-local-20261102/invalid-account-');
 try{
  await assert.rejects(createMobileGateway({bridge:{},port:0,signalOrigin:'http://127.0.0.1:1',databasePath:directory+'/devices.sqlite',routeKeyPath:directory+'/route.pem',turnAccount:{gatewayOrigin:'http://foreign.example',token:'synthetic'}}),/INVALID_REQUEST/);
  assert.deepEqual(readdirSync(directory),[]);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('native direct peer with TURN configuration closes with its owner and never signals credentials',{timeout:15000},async()=>{
 const wait=async(promise,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),4000);})]);}finally{clearTimeout(timer);}};
 const {default:rtc}=await import('node-datachannel'),{createMobileTurn}=await import('../src/mobile-turn.ts'),{mobileChannel}=await import('../src/mobile-channel.ts');
 const {createServer}=await import('node:http');
 const username='2000000000:0123456789abcdef0123456789abcdef',password=Buffer.alloc(20,17).toString('base64');
 // No coturn: the relay points at a closed loopback port; the native connection must be direct.
 const issuer=createServer((_req,res)=>res.end(JSON.stringify({iceServers:[{urls:['turn:127.0.0.1:9?transport=udp'],username,credential:password}],expiresAt:2000000000,ttlSeconds:3600})));
 await new Promise(resolve=>issuer.listen(0,'127.0.0.1',resolve));
 const lab=await startHomerRtcLab(),devices=new MobileDevices(':memory:');
 const keys=generateKeyPairSync('ed25519'),der=keys.publicKey.export({type:'spki',format:'der'}),routeId=createHash('sha256').update(der).digest('hex');
 const route={routeId,prove:challenge=>({routeId,publicKey:der.toString('base64url'),signature:sign(null,Buffer.from(JSON.stringify(['homer-rtc-register-v1',challenge.connectionId,challenge.challenge,routeId])),keys.privateKey).toString('base64url')})};
 const turn=createMobileTurn({gatewayOrigin:'http://127.0.0.1:'+issuer.address().port,token:'synthetic-native-turn-token',allowSyntheticLoopback:true});
 const peer=new rtc.PeerConnection('synthetic-direct-owner',{iceServers:[]});let host,signal,sessionId,client,readyResolve,closedResolve;
 const ready=new Promise(resolve=>{readyResolve=resolve;}),closed=new Promise(resolve=>{closedResolve=resolve;}),pending=new Map();let sequence=0;
 const call=(op,input={})=>wait(new Promise(resolve=>{const id=String(++sequence);pending.set(id,resolve);void client.send({id,op,input});}),'native_call_timeout');
 try{
  host=startMobileRtc({signalOrigin:new URL(lab.url).origin.replace(/^ws/,'http'),route,devices,iceServers:[],turn,call:async()=>({synthetic:true})});await wait(host.ready,'native_registration_timeout');
  signal=await openMobileSignal(lab.url,'mobile',event=>{
   assert.ok(!JSON.stringify(event).includes(username)&&!JSON.stringify(event).includes(password)&&!JSON.stringify(event).includes('synthetic-native-turn-token'),'TURN and model credentials must not enter signaling');
   sessionId=event.sessionId;if(event.description)peer.setRemoteDescription(event.description.sdp,event.description.type);else if(event.candidate?.candidate)peer.addRemoteCandidate(event.candidate.candidate,event.candidate.sdpMid??'0');
  });
  peer.onLocalDescription((sdp,type)=>void signal.call('send',{sessionId,description:{sdp,type}}).catch(()=>{}));
  peer.onLocalCandidate((candidate,sdpMid)=>void signal.call('send',{sessionId,candidate:{candidate:candidate.replace(/^a=/,''),sdpMid,sdpMLineIndex:0,usernameFragment:null}}).catch(()=>{}));
  peer.onDataChannel(channel=>{channel.onClosed(closedResolve);channel.onOpen(()=>{client=mobileChannel({send:bytes=>{channel.sendMessageBinary(bytes);},buffered:()=>channel.bufferedAmount(),closed:()=>!channel.isOpen(),close:()=>channel.close(),receive:fn=>channel.onMessage(bytes=>fn(new Uint8Array(bytes)))},value=>{pending.get(value.id)?.(value);pending.delete(value.id);});readyResolve();});});
  await wait(signal.call('connect',{routeId}),'native_connect_timeout');await wait(ready,'native_direct_ready_timeout');
  const selected=peer.getSelectedCandidatePair();assert.ok(selected);assert.equal(selected.local.type,'host');assert.equal(selected.remote.type,'host');
  const invitation=devices.invite('https://example.test').url.split('#')[1],paired=await call('pair',{invitation});devices.approve(devices.state().pending.id,'合成手机');
  assert.equal((await call('status',{credential:paired.result.credential})).result.status,'active');assert.deepEqual((await call('history.state')).result,{synthetic:true});
  // Observe per-peer removal before process-wide rtc.cleanup also tears down the synthetic phone.
  host.disconnect();await wait(closed,'native_owner_close_timeout');assert.equal(host.connected,false);
  turn.close();host.close();assert.equal(peer.state(),'closed');assert.deepEqual(await turn.get(),[]);
 }finally{client?.close();peer.close();signal?.close();turn.close();host?.close();devices.close();await lab.close();issuer.closeAllConnections();await new Promise(resolve=>issuer.close(resolve));rtc.cleanup();}
});

test('existing signaling owner expires negotiation and permits a fresh session without retaining the old one',async()=>{
 const {createHomerSignaling}=await import(pathToFileURL(resolve(root,'imports/api/homer/signaling.mjs')));
 let now=1000;const owner=createHomerSignaling({clock:()=>now}),hostEvents=[],phoneEvents=[];
 const stopHost=owner.open({connectionId:'synthetic-host',role:'host',push:event=>hostEvents.push(event)}),stopPhone=owner.open({connectionId:'synthetic-phone',role:'mobile',push:event=>phoneEvents.push(event)});
 try{
  const keys=generateKeyPairSync('ed25519'),der=keys.publicKey.export({type:'spki',format:'der'}),routeId=createHash('sha256').update(der).digest('hex');
  const challenge=owner.call('synthetic-host','homer.rtc.challenge',{routeId});
  owner.call('synthetic-host','homer.rtc.register',{routeId,publicKey:der.toString('base64url'),signature:sign(null,Buffer.from(JSON.stringify(['homer-rtc-register-v1',challenge.connectionId,challenge.challenge,routeId])),keys.privateKey).toString('base64url')});
  const first=owner.call('synthetic-phone','homer.rtc.connect',{routeId});now+=120000;owner.sweep();
  assert.deepEqual(phoneEvents,[{type:'closed',sessionId:first.sessionId,reason:'expired'}]);assert.equal(hostEvents.at(-1).reason,'expired');
  assert.throws(()=>owner.call('synthetic-phone','homer.rtc.close',{sessionId:first.sessionId}),{code:'SESSION_CLOSED'});
  const next=owner.call('synthetic-phone','homer.rtc.connect',{routeId});assert.notEqual(next.sessionId,first.sessionId);
 }finally{stopPhone();stopHost();}
});
