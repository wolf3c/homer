import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {MobileDevices} from '../src/mobile-devices.ts';
import {openMobileSession} from '../src/mobile-session.ts';
import {createMobileTurn} from '../src/mobile-turn.ts';

const flush=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
const payload=(n=1)=>({iceServers:[{urls:['turn:192.0.2.10:3478?transport=udp'],username:'2000000000:0123456789abcdef0123456789abcdef',credential:Buffer.alloc(20,n).toString('base64')}],expiresAt:2000000000,ttlSeconds:3600});
async function hostFixture(t,turn){
 const peers=[],links=[];
 class Peer{
  constructor(_name,config){this.config=config;this.closed=false;peers.push(this);}
  onLocalDescription(){} onLocalCandidate(){} onStateChange(fn){this.change=fn;}
  close(){this.closed=true;}
  createDataChannel(){
   return this.channel={closed:false,onClosed(fn){this.closedCallback=fn;},onError(){},onOpen(fn){this.open=fn;},close(){this.closed=true;},bufferedAmount:()=>0,isOpen:()=>true,onMessage(){},sendMessageBinary(){}};
  }
 }
 const rtcStub={PeerConnection:Peer,cleanup(){}};
 const signalStub=async(_address,_role,handle,closed)=>{const link={closed:false,call:async()=>({}),close(){this.closed=true;},emit:event=>handle(event),drop(){this.closed=true;closed();}};links.push(link);return link;};
 const source=(await build({entryPoints:['src/mobile-rtc.ts'],bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent',plugins:[{name:'transport-fixture',setup(b){
  b.onResolve({filter:/^node-datachannel$/},()=>({path:'rtc',namespace:'fake'}));
  b.onResolve({filter:/mobile-signaling\.js$/},()=>({path:'signal',namespace:'fake'}));
  b.onResolve({filter:/mobile-session\.js$/},()=>({path:'session',namespace:'fake'}));
  b.onLoad({filter:/.*/,namespace:'fake'},({path})=>({contents:path==='rtc'?'export default rtcStub':path==='signal'?'export const openMobileSignal=signalStub':'export const openMobileSession=()=>({authorized:true,close(){},event:async()=>{}})'}));
 }}]})).outputFiles[0].text;
 const module={exports:{}};Function('rtcStub','signalStub','module','exports',source)(rtcStub,signalStub,module,module.exports);
 const host=module.exports.startMobileRtc({signalOrigin:'http://127.0.0.1:1',route:{routeId:'a'.repeat(64),prove:()=>({})},devices:{},call:async()=>({}),iceServers:[],turn});
 t.after(()=>host.close());await host.ready;return {host,peers,links};
}
test('healthy direct PCs carrying TURN config survive refresh and signaling expiry; owner close removes all',async t=>{
 let count=0;t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
 t.mock.method(globalThis,'fetch',async()=>Response.json(payload(++count)));
 const turn=createMobileTurn({gatewayOrigin:'https://issuer.example',token:'synthetic-old-owner'});t.after(()=>turn.close());
 const f=await hostFixture(t,turn);await f.links[0].emit({type:'session',sessionId:'first'});f.peers[0].channel.open();
 const first=f.peers[0].config.iceServers[0];assert.equal(first.password,payload(1).iceServers[0].credential);
 await f.links[0].emit({type:'closed',sessionId:'first'});assert.equal(f.peers[0].closed,false);
 t.mock.timers.tick(2700000);await flush();assert.equal(count,2);assert.equal(f.peers[0].closed,false);
 await f.links[0].emit({type:'session',sessionId:'second'});assert.equal(f.peers[1].config.iceServers[0].password,payload(2).iceServers[0].credential);assert.equal(first.password,payload(1).iceServers[0].credential);
 f.links[0].drop();assert.equal(f.peers[0].closed,false);assert.equal(f.peers[1].closed,true,'unfinished negotiation is cleaned');
 t.mock.timers.tick(5000);await flush();assert.equal(f.links.length,2,'existing host registration retry is reused');
 turn.close();f.host.close();assert.ok(f.peers.every(peer=>peer.closed&&peer.channel.closed));
 const before=count;t.mock.timers.tick(7200000);await flush();assert.equal(count,before);assert.equal(f.links.length,2);
});
test('credential failure retains direct ICE and negotiation still has a bounded deadline',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
 t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:503}));
 const turn=createMobileTurn({gatewayOrigin:'https://issuer.example',token:'synthetic-only'});t.after(()=>turn.close());
 const f=await hostFixture(t,turn);await f.links[0].emit({type:'session',sessionId:'direct'});
 assert.deepEqual(f.peers[0].config.iceServers,[]);t.mock.timers.tick(30000);assert.equal(f.peers[0].closed,true);
});
test('late issuance cannot create a peer after disconnect, owner close or lost signaling',async t=>{
 for(const action of ['disconnect','close','signal'])await t.test(action,async t=>{
  let release;const f=await hostFixture(t,{get:()=>new Promise(resolve=>{release=resolve;}),networkChanged(){}});
  const pending=f.links[0].emit({type:'session',sessionId:'old'});
  if(action==='signal')f.links[0].drop();else f.host[action]();
  release([]);await pending;assert.equal(f.peers.length,0);
 });
});

// Real phone connection + channel + host device authorization; only RTC and signaling are simulated.
async function phoneFixture(t){
 const peers=[],links=[],calls=[],states=[],messages=[],hosts=[];
 const devices=new MobileDevices(':memory:');let release;
 const source=(await build({stdin:{contents:'export * from "./ui/mobile-connection.ts";export {ConnectionEvents} from "./ui/web-connection-client.ts";',resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'browser',logLevel:'silent',plugins:[{name:'local-signal',setup(b){
  b.onResolve({filter:/mobile-signaling\.js$/},()=>({path:'signal',namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:'export const openMobileSignal=signalStub'}));
 }}]})).outputFiles[0].text;
 const signalStub=async(_address,_role,handle,closed)=>{const link={closed:false,connects:0,call:async op=>{if(op==='connect')link.connects++;},close(){this.closed=true;},emit:event=>handle(event),drop(){closed();}};links.push(link);return link;};
 class Peer{constructor(){peers.push(this);}close(){this.closed=true;}}
 const window=new EventTarget(),document=new EventTarget(),module={exports:{}};document.querySelector=()=>({getAttribute:()=>'true'});
 window.ReactNativeWebView={postMessage:value=>messages.push(JSON.parse(value))};
 Function('window','document','location','RTCPeerConnection','signalStub','require','module','exports',source)(window,document,new URL('https://phone.example/'),Peer,signalStub,createRequire(import.meta.url),module,module.exports);
 const api=module.exports,events=new api.ConnectionEvents('/api/history/events');events.addEventListener('state',event=>states.push(JSON.parse(event.data)));
 function connect(){window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:{signalOrigin:'http://127.0.0.1:1',routeId:'a'.repeat(64),invitation:devices.invite('https://example.test').url.split('#')[1]}}));}
 function open(){
  const peer=peers.at(-1);let receive;const dc={readyState:'open',bufferedAmount:0,send:bytes=>queueMicrotask(()=>receive(new Uint8Array(bytes))),close(){if(this.readyState==='closed')return;this.readyState='closed';this.onclose?.();}};
  const host=openMobileSession({devices,port:{send:bytes=>{const copy=new Uint8Array(bytes);queueMicrotask(()=>{if(dc.readyState==='open')dc.onmessage({data:copy.buffer});});},receive:fn=>{receive=fn;},closed:()=>dc.readyState!=='open',buffered:()=>0,close:()=>dc.close()},call:async op=>{calls.push(op);if(op==='messages.submit')return new Promise(resolve=>{release=resolve;});return {revision:states.length+1};}});
  hosts.push(host);peer.ondatachannel({channel:dc});dc.onopen();return dc;
 }
 t.after(()=>{events.close();window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:null}));release?.({});for(const host of hosts)host.close();devices.close();});
 return {api,devices,peers,links,calls,states,messages,connect,open};
}
test('phone reconnect reauthenticates, reloads history and never replays an unconfirmed operation; revoke stays enforced',async t=>{
 const f=await phoneFixture(t);t.mock.timers.enable({apis:['setTimeout']});
 f.connect();await flush();const first=f.open();await flush();assert.equal(f.api.mobileConnected(),false);assert.deepEqual(f.calls,[]);
 f.devices.approve(f.devices.state().pending.id,'合成手机');t.mock.timers.tick(1500);await flush();assert.equal(f.api.mobileConnected(),true);assert.equal(f.states.length,1);
 const pending=f.api.mobileCall('messages.submit',{});const rejected=assert.rejects(pending,/web_receipt_unconfirmed/);await flush();
 f.links[0].emit({type:'closed',sessionId:'expired'});f.links[0].drop();await flush();assert.equal(f.api.mobileConnected(),true,'established data survives negotiation expiry');
 first.close();await rejected;t.mock.timers.tick(2999);assert.equal(f.peers.length,1);t.mock.timers.tick(1);await flush();assert.equal(f.peers.length,2);
 f.open();await flush();assert.equal(f.api.mobileConnected(),true);assert.equal(f.states.length,2);assert.equal(f.calls.filter(op=>op==='messages.submit').length,1);
 assert.ok(f.links.every(link=>link.connects===1));const id=f.devices.state().devices[0].id;f.devices.update(id,{enabled:false});await flush();assert.equal(f.api.mobileConnected(),false);
 t.mock.timers.tick(3000);await flush();f.open();await flush();assert.equal(f.api.mobileConnected(),false);assert.equal(f.messages.at(-1).code,'denied');assert.equal(f.states.length,2);
 f.devices.remove(id);assert.equal(f.devices.state().devices.length,0);
});
test('phone handshake loss and session expiry both reuse the existing reconnect timer',async t=>{
 const f=await phoneFixture(t);t.mock.timers.enable({apis:['setTimeout']});f.connect();await flush();
 await f.links[0].emit({type:'closed',sessionId:'expired'});assert.equal(f.peers[0].closed,true);t.mock.timers.tick(3000);await flush();assert.equal(f.peers.length,2);
 f.links[1].drop();t.mock.timers.tick(3000);await flush();assert.equal(f.peers.length,3);assert.deepEqual(f.calls,[]);
});
