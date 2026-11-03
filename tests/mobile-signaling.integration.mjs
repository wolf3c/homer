// HOMER_YEZI2_ROOT=/path/to/yezi2 node_modules/.bin/tsx --test tests/mobile-signaling.integration.mjs
import {test} from 'node:test';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';import {createServer} from 'node:http';import {once} from 'node:events';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';import {buildSync} from 'esbuild';
import {chromium} from 'playwright-core';import rtc from 'node-datachannel';
import {openMobileSignal} from '../src/mobile-signaling.ts';
import {execFileSync} from 'node:child_process';
import {networkInterfaces} from 'node:os';
import {BlockList,isIPv4} from 'node:net';
const root=process.env.HOMER_YEZI2_ROOT;if(!root)throw Error('HOMER_YEZI2_ROOT_required');
const {startHomerRtcLab}=await import(pathToFileURL(resolve(root,'scripts/homer-rtc-lab.mjs')));
const cdp=process.env.HOMER_MOBILE_CDP,serial=process.env.HOMER_ANDROID_SERIAL;
const stun=process.env.HOMER_MOBILE_STUN;
if(stun&&!/^stun:[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(stun))throw Error('stun_address_required_no_turn');
if(cdp&&(!serial||new URL(cdp).hostname!=='127.0.0.1'))throw Error('local_mobile_debug_target_required');
const adb=(...args)=>execFileSync('adb',['-s',serial,...args],{stdio:'pipe'});

test(`real Yezi2 signaling negotiates ${cdp?'Android App WebView':'browser'} ↔ Node direct text and small binary`, {timeout:45000},async()=>{
 const lab=await startHomerRtcLab(),reverse='tcp:'+new URL(lab.url).port;
 const peers=new Map();let browser,pageServer,signal,rejectFailure,wakeTimer,reversed=false;const failure=new Promise((_,reject)=>{rejectFailure=reject;});void failure.catch(()=>{});
 const hostCandidates=[],mobileCandidates=[];
 const wifiSubnet=new BlockList(),phoneAddresses=new Map();
 const candidateKind=value=>{const fields=value.replace(/^a=/,'').trim().split(/\s+/),address=fields[4]??'';const entry=Object.entries(networkInterfaces()).find(([,items])=>items?.some(item=>item.address===address));return {protocol:fields[2]?.toLowerCase(),kind:fields[7],addressKind:address.endsWith('.local')?'mdns':address.includes(':')?'ipv6':'ipv4',phoneWifiSubnet:cdp&&isIPv4(address)?wifiSubnet.check(address,'ipv4'):undefined,phoneInterface:phoneAddresses.get(address),hostInterface:entry?(entry[0].startsWith('en')?'lan':entry[0].startsWith('utun')?'vpn':entry[0].startsWith('lo')?'loopback':'other'):undefined};};
 const deadline=setTimeout(()=>rejectFailure(Error('mobile_direct_test_timeout:'+JSON.stringify([...peers.values()].map(peer=>({connection:peer.state(),ice:peer.iceState(),gathering:peer.gatheringState()}))))),35000);
 try{
  // Keep only the test phone awake during foreground QA; never alter its lock settings.
  if(cdp){adb('shell','input','keyevent','KEYCODE_WAKEUP');wakeTimer=setInterval(()=>{try{adb('shell','input','keyevent','KEYCODE_WAKEUP');}catch{rejectFailure(Error('mobile_device_unavailable'));}},5000);}
  if(cdp){let kind;for(const line of adb('shell','ip','-f','inet','addr').toString().split('\n')){const name=/^\d+: ([^:@]+)/.exec(line)?.[1];if(name)kind=name.startsWith('wlan')?'wifi':name.startsWith('tun')?'vpn':name.startsWith('rmnet')?'cellular':name==='lo'?'loopback':'other';const address=/\binet ([0-9.]+)\/(\d+)/.exec(line);if(address){phoneAddresses.set(address[1],kind);if(kind==='wifi')wifiSubnet.addSubnet(address[1],Number(address[2]),'ipv4');}}}
  browser=cdp?await chromium.connectOverCDP(cdp):await chromium.launch({channel:'chrome',headless:true});
  if(!cdp){pageServer=createServer((_,res)=>res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>RTC synthetic test</title>'));pageServer.listen(0,'127.0.0.1');await once(pageServer,'listening');}
  if(cdp){if(adb('reverse','--list').toString().split('\n').some(line=>line.split(/\s+/)[1]===reverse))throw Error('mobile_test_reverse_port_busy');adb('reverse',reverse,reverse);reversed=true;}
  signal=await openMobileSignal(lab.url,'host',event=>{
   if(event.type==='session'){
    const peer=new rtc.PeerConnection('direct-integration',{iceServers:stun?[stun]:[]});peers.set(event.sessionId,peer);
    peer.onLocalDescription((sdp,type)=>void signal.call('send',{sessionId:event.sessionId,description:{type,sdp}}).catch(rejectFailure));
    // node-datachannel emits an SDP attribute line; browsers send the candidate value.
    peer.onLocalCandidate((candidate,sdpMid)=>{hostCandidates.push(candidateKind(candidate));void signal.call('send',{sessionId:event.sessionId,candidate:{candidate:candidate.replace(/^a=/,''),sdpMid,sdpMLineIndex:0,usernameFragment:null}}).catch(rejectFailure);});
    const channel=peer.createDataChannel('homer');channel.onMessage(value=>{if(typeof value==='string')channel.sendMessage(value);else channel.sendMessageBinary(new Uint8Array(value));});
   }else if(event.type==='signal'){
    const peer=peers.get(event.sessionId);if(event.description)peer.setRemoteDescription(event.description.sdp,event.description.type);else if(event.candidate?.candidate){mobileCandidates.push(candidateKind(event.candidate.candidate));peer.addRemoteCandidate(event.candidate.candidate,event.candidate.sdpMid??'0');}
   }
  });
  const keys=generateKeyPairSync('ed25519'),der=keys.publicKey.export({type:'spki',format:'der'}),routeId=createHash('sha256').update(der).digest('hex');
  const challenge=await signal.call('challenge',{routeId});
  const signature=sign(null,Buffer.from(JSON.stringify(['homer-rtc-register-v1',challenge.connectionId,challenge.challenge,routeId])),keys.privateKey).toString('base64url');
  await signal.call('register',{routeId,publicKey:der.toString('base64url'),signature});
  const page=cdp?browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().startsWith('https://localhost/')):await browser.newPage();
  assert.ok(page,'App must already have loaded its local chat; the test does not navigate the WebView');
  if(pageServer)await page.goto('http://127.0.0.1:'+pageServer.address().port);
  if(cdp)await page.getByRole('textbox').first().waitFor({timeout:10000});
  if(cdp)assert.deepEqual(await page.evaluate(()=>({chat:!!document.getElementById('homer-root'),mobile:document.querySelector('meta[name=homer-mobile]')?.content==='true',secure:isSecureContext,rtc:typeof RTCPeerConnection,overflow:document.documentElement.scrollWidth>innerWidth})),{chat:true,mobile:true,secure:true,rtc:'function',overflow:false});
  await page.addScriptTag({content:buildSync({entryPoints:['src/mobile-signaling.ts'],bundle:true,write:false,format:'iife',globalName:'HomerSignal',platform:'browser'}).outputFiles[0].text});
  const result=await Promise.race([failure,page.evaluate(async({url,routeId,stun})=>{
   const pc=new RTCPeerConnection({iceServers:stun?[{urls:stun}]:[]});let sessionId,signal;const frames=[],eventErrors=[];let acceptedCandidates=0;
   let readyTimer;
   const ready=new Promise((resolve,reject)=>{
    readyTimer=setTimeout(()=>{void pc.getStats().then(stats=>{
     const counts={};for(const report of stats.values())if(report.type.endsWith('candidate')){const key=report.type+':'+report.candidateType;counts[key]=(counts[key]??0)+1;}
     reject(Error('mobile_peer_unavailable:'+JSON.stringify({connection:pc.connectionState,ice:pc.iceConnectionState,gathering:pc.iceGatheringState,frames:frames.length,candidates:counts,acceptedCandidates,eventErrors})));
    });},20000);
    pc.ondatachannel=({channel})=>{channel.binaryType='arraybuffer';channel.onopen=()=>{clearTimeout(readyTimer);resolve(channel);};};
   });
   void ready.catch(()=>{});
   signal=await HomerSignal.openMobileSignal(url,'mobile',async event=>{
    frames.push(event.type);
    try{if(event.type==='signal'){sessionId=event.sessionId;if(event.description){await pc.setRemoteDescription(event.description);await pc.setLocalDescription(await pc.createAnswer());await signal.call('send',{sessionId,description:pc.localDescription.toJSON()});}else if(event.candidate){await pc.addIceCandidate(event.candidate);acceptedCandidates++;}}}catch(error){eventErrors.push({name:error.name,remoteDescription:!!pc.remoteDescription,state:pc.signalingState});throw error;}
   });
   pc.onicecandidate=({candidate})=>{if(candidate)void signal.call('send',{sessionId,candidate:candidate.toJSON()});};
   try{
    await signal.call('connect',{routeId});const channel=await ready;
    const echo=value=>new Promise(resolve=>{channel.onmessage=event=>resolve(event.data);channel.send(value);});
    const text=await echo('synthetic-direct-chat'),bytes=new Uint8Array(16384).fill(37),received=new Uint8Array(await echo(bytes));
    const stats=await pc.getStats();let path;for(const s of stats.values())if(s.type==='transport'&&s.selectedCandidatePairId){const p=stats.get(s.selectedCandidatePairId),local=stats.get(p.localCandidateId),remote=stats.get(p.remoteCandidateId);path={local:local.candidateType,remote:remote.candidateType,protocol:local.protocol};}
    channel.close();return {text,binary:received.length===bytes.length&&received.every(v=>v===37),path,signalingOnly:frames.every(v=>['signal','session','closed'].includes(v))};
   }finally{clearTimeout(readyTimer);signal.close();pc.close();}
  },{url:lab.url,routeId,stun})]);
  const {path,...checks}=result;
  assert.deepEqual(checks,{text:'synthetic-direct-chat',binary:true,signalingOnly:true});
  assert.ok(path,'selected ICE pair must be observable');
  assert.ok(['host','srflx','prflx'].includes(path.local));assert.ok(['host','srflx','prflx'].includes(path.remote));assert.equal(path.protocol,'udp');
  console.log('Selected ICE path',JSON.stringify(path));
 }catch(error){console.log('ICE diagnosis',JSON.stringify({hostCandidates,mobileCandidates,hostStates:[...peers.values()].map(peer=>({connection:peer.state(),ice:peer.iceState()}))}));throw error;}
 finally{clearTimeout(deadline);clearInterval(wakeTimer);signal?.close();for(const peer of peers.values())peer.close();try{await browser?.close();}finally{await lab.close();if(pageServer?.listening)await new Promise(resolve=>pageServer.close(resolve));if(reversed)adb('reverse','--remove',reverse);rtc.cleanup();}}
});
