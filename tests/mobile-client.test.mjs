import {test} from 'node:test';import assert from 'node:assert/strict';
import {buildSync,build as buildAsync} from 'esbuild';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRequire} from 'node:module';
const build=path=>buildSync({entryPoints:[path],bundle:true,write:false,format:'cjs',platform:'browser',logLevel:'silent'}).outputFiles[0].text;
test('mobile discovers public candidates through the relay endpoint without receiving TURN credentials',async()=>{
 const window=new EventTarget(),document=new EventTarget(),module={exports:{}};let config;
 class Peer{constructor(value){config=value;}close(){}}
 class Socket extends EventTarget{close(){this.dispatchEvent(new Event('close'));}}
 Function('window','document','RTCPeerConnection','WebSocket','module','exports',build('ui/mobile-connection.ts'))(window,document,Peer,Socket,module,module.exports);
 try{
  window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:{signalOrigin:'https://signal.example',routeId:'a'.repeat(64),invitation:'b'.repeat(43)}}));
  assert.deepEqual(config.iceServers,[{urls:['stun:120.27.120.125:3478','stun:stun.l.google.com:19302']}]);
 }finally{window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:null}));await new Promise(resolve=>setImmediate(resolve));}
});
test('mobile serializes fixed ICE fields even when WebKit toJSON omits usernameFragment',async()=>{
 const source=(await buildAsync({entryPoints:['ui/mobile-connection.ts'],bundle:true,write:false,format:'cjs',platform:'browser',logLevel:'silent',plugins:[{name:'candidate-transport',setup(build){
  build.onResolve({filter:/mobile-signaling\.js$/},()=>({path:'signal',namespace:'fake'}));
  build.onLoad({filter:/signal/,namespace:'fake'},()=>({contents:'export async function openMobileSignal(_base,_role,onEvent){return {call:async(op,input)=>{if(op==="connect")await onEvent({type:"session",sessionId:"s".repeat(22)});else sent.push(JSON.parse(JSON.stringify(input)));},close(){}}}'}));
 }}]})).outputFiles[0].text;
 const window=new EventTarget(),document=new EventTarget(),module={exports:{}},sent=[];let peer;
 class Peer{constructor(){peer=this;}close(){}}
 Function('window','document','RTCPeerConnection','sent','module','exports',source)(window,document,Peer,sent,module,module.exports);
 try{
  window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:{signalOrigin:'https://signal.example',routeId:'a'.repeat(64),invitation:'b'.repeat(43)}}));
  await new Promise(resolve=>setImmediate(resolve));
  for(const usernameFragment of [undefined,null,'synthetic-ufrag']){
   const candidate={candidate:'candidate:1 1 UDP 1 192.0.2.1 43210 typ host',sdpMid:'0',sdpMLineIndex:0,usernameFragment,extra:'not-on-wire',toJSON(){return {candidate:this.candidate,sdpMid:this.sdpMid,sdpMLineIndex:this.sdpMLineIndex};}};
   peer.onicecandidate({candidate});await new Promise(resolve=>setImmediate(resolve));
   assert.deepEqual(sent.at(-1),{sessionId:'s'.repeat(22),candidate:{candidate:candidate.candidate,sdpMid:'0',sdpMLineIndex:0,usernameFragment:usernameFragment??null}});
  }
  peer.onicecandidate({candidate:{candidate:'',sdpMid:null,sdpMLineIndex:null,usernameFragment:null,toJSON:()=>({candidate:''})}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(sent.at(-1).candidate,{candidate:'',sdpMid:null,sdpMLineIndex:null,usernameFragment:null});
  const count=sent.length;peer.onicecandidate({candidate:null});assert.equal(sent.length,count);
 }finally{window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:null}));}
});
test('desktop requests omit ambient cookies and reject foreign origins',async()=>{
 const code=build('ui/web-connection-client.ts'),module={exports:{}},calls=[];
 Function('document','location','globalThis','module','exports',code)({querySelector:()=>null},new URL('https://phone.example/'),{fetch:async(...args)=>{calls.push(args);return Response.json({});}},module,module.exports);
 await module.exports.connectionFetch('/api/history/state');assert.equal(calls[0][1].credentials,'omit');
 assert.throws(()=>module.exports.connectionFetch('https://foreign.example/api/history/state'),/web_connection_origin_denied/);assert.equal(calls.length,1);
});
test('mobile file sharing uses downloaded bytes without cookies, and refuses oversized bridge messages',async()=>{
 const module={exports:{}},messages=[];
 class Reader{readAsDataURL(blob){void blob.arrayBuffer().then(bytes=>{this.result='data:application/octet-stream;base64,'+Buffer.from(bytes).toString('base64');this.onload();});}}
 Function('document','window','FileReader','module','exports',build('ui/file-download.ts'))({querySelector:()=>({getAttribute:()=>'true'})},{ReactNativeWebView:{postMessage:value=>messages.push(JSON.parse(value))}},Reader,module,module.exports);
 await module.exports.saveBlob(new Blob(['合成文件']),'合成.txt');assert.deepEqual(messages.filter(value=>value.type==='share-file'),[{type:'share-file',filename:'合成.txt',base64:Buffer.from('合成文件').toString('base64')}]);
 await assert.rejects(module.exports.saveBlob(new Blob([new Uint8Array(8*1024*1024+1)]),'large.bin'),/mobile_file_size_limit/);assert.equal(messages.filter(value=>value.type==='share-file').length,1);
});
test('bundled page announces readiness after its connection listener is installed',()=>{
 const module={exports:{}},messages=[],window=new EventTarget(),document=new EventTarget();
 window.ReactNativeWebView={postMessage:data=>{const item=JSON.parse(data);messages.push(item);if(item.type==='ready')window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:null}));}};
 Function('window','document','module','exports',build('ui/mobile-connection.ts'))(window,document,module,module.exports);
 assert.deepEqual(messages.map(({type,code})=>({type,...(code?{code}:{})})),[{type:'ready'},{type:'connection-status',code:'scan'}]);
});
function nativeShell(overrides={}){
 const require=createRequire(import.meta.url),module={exports:{}},injected=[];let web;
 const container=({children})=>createElement(Fragment,null,children);
 const native={ActivityIndicator:container,Alert:{alert(){}},AppState:{},Image:container,Linking:{},Modal:()=>null,PermissionsAndroid:{},Platform:{OS:'ios'},Pressable:container,StatusBar:()=>null,StyleSheet:{create:value=>value},Text:container,View:container};
 const stubs={'react-native':native,'react-native-safe-area-context':{SafeAreaProvider:container,SafeAreaView:container},'expo-camera':{CameraView:()=>null,useCameraPermissions:()=>[{granted:true},()=>{}]},'expo-secure-store':{},'expo-crypto':{randomUUID:()=> 'synthetic-nonce'},'expo-device':{deviceName:null},'expo-application':{applicationId:'com.homer.mobile.qa'},'expo':{requireOptionalNativeModule:()=>null},'expo-file-system':{},'expo-sharing':{},'react-native-webview':{WebView:props=>{web=props;props.ref.current={injectJavaScript:value=>injected.push(value)};return null;}}};
 const code=buildSync({entryPoints:['mobile/App.tsx'],bundle:true,write:false,format:'cjs',platform:'browser',packages:'external',external:['./.generated/chat.mjs'],loader:{'.png':'dataurl'},jsx:'automatic',logLevel:'silent'}).outputFiles[0].text;
 Function('require','module','exports',code)(name=>name.endsWith('/chat.mjs')?{default:''}:overrides[name]??stubs[name]??require(name),module,module.exports);
 renderToStaticMarkup(createElement(module.exports.default));
 return {web,injected};
}
test('native shell does not connect before saved pairing has been restored',async()=>{
 const {web,injected}=nativeShell();
 await web.onMessage({nativeEvent:{url:'https://localhost/',data:JSON.stringify({type:'ready'})}});assert.equal(injected.length,0);
 web.onLoadEnd();assert.equal(injected.length,0);
 await web.onMessage({nativeEvent:{url:'https://foreign.example/',data:JSON.stringify({type:'ready'})}});assert.equal(injected.length,0);
 await web.onMessage({nativeEvent:{url:'https://localhost/',data:JSON.stringify({type:'ready'})}});
 assert.equal(injected.length,0,'page readiness must not bypass the saved-pairing gate');
});

test('native share waits for file bytes before presenting, then clears the temporary file',async()=>{
 let finishWrite,written=false,presented=0,deleted=0;
 class File{uri='file:///synthetic-cache/file.txt';exists=true;write(){return new Promise(resolve=>{finishWrite=()=>{written=true;resolve();};});}async delete(){deleted++;}}
 const {web}=nativeShell({'expo-file-system':{File,Paths:{cache:'file:///synthetic-cache/'}},'expo-sharing':{isAvailableAsync:async()=>true,shareAsync:async()=>{presented++;assert.equal(written,true);}}});
 web.onMessage({nativeEvent:{url:'https://localhost/',data:JSON.stringify({type:'share-file',filename:'synthetic.txt',base64:'eA==',nonce:'synthetic-nonce'})}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(typeof finishWrite,'function');assert.equal(presented,0,'sharing must wait for the asynchronous file write');assert.equal(deleted,0);
 finishWrite();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(presented,1);assert.equal(deleted,1);
});

test('expired or invalid invitation stops retrying and tells native shell to rescan',async()=>{
 const source=(await buildAsync({entryPoints:['ui/mobile-connection.ts'],bundle:true,write:false,format:'cjs',platform:'browser',logLevel:'silent',plugins:[{name:'fake-mobile-transport',setup(build){
  build.onResolve({filter:/mobile-channel\.js$/},()=>({path:'channel',namespace:'fake'}));
  build.onResolve({filter:/mobile-signaling\.js$/},()=>({path:'signal',namespace:'fake'}));
  build.onLoad({filter:/channel/,namespace:'fake'},()=>({contents:'export const mobileChannel=(_port,receive)=>({send:async packet=>queueMicrotask(()=>receive({id:packet.id,error:"mobile_invitation_expired"})),close(){}});'}));
  build.onLoad({filter:/signal/,namespace:'fake'},()=>({contents:'export async function openMobileSignal(){return {call:async()=>{},close(){}}}'}));
 }}]})).outputFiles[0].text;
 const messages=[],window=new EventTarget(),document=new EventTarget(),module={exports:{}};let peer,peerCount=0;
 class Peer{constructor(){peer=this;peerCount++;}close(){}}
 window.ReactNativeWebView={postMessage:value=>messages.push(JSON.parse(value))};
 Function('window','document','RTCPeerConnection','module','exports',source)(window,document,Peer,module,module.exports);
 window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:{signalOrigin:'https://signal.example',routeId:'a'.repeat(64),invitation:'b'.repeat(43)}}));
 const channel={close(){},send(){},bufferedAmount:0,readyState:'open'};peer.ondatachannel({channel});channel.onopen();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(messages.filter(item=>item.type==='connection-status').at(-1)?.code,'invitation-expired');
 assert.equal(messages.some(item=>item.code==='unavailable'),false);
 document.dispatchEvent(new Event('visibilitychange'));assert.equal(peerCount,1,'returning to the app must not retry a known invalid invitation');
});

test('connection messages keep their original attempt identity',async()=>{
 const source=(await buildAsync({entryPoints:['ui/mobile-connection.ts'],bundle:true,write:false,format:'cjs',platform:'browser',logLevel:'silent',plugins:[{name:'fake-mobile-transport',setup(build){
  build.onResolve({filter:/mobile-channel\.js$/},()=>({path:'channel',namespace:'fake'}));
  build.onResolve({filter:/mobile-signaling\.js$/},()=>({path:'signal',namespace:'fake'}));
  build.onLoad({filter:/channel/,namespace:'fake'},()=>({contents:'export const mobileChannel=(_port,receive)=>({send:async packet=>queueMicrotask(()=>receive({id:packet.id,error:"mobile_invitation_expired"})),close(){}});'}));
  build.onLoad({filter:/signal/,namespace:'fake'},()=>({contents:'export async function openMobileSignal(){return {call:async()=>{},close(){}}}'}));
 }}]})).outputFiles[0].text;
 const messages=[],window=new EventTarget(),document=new EventTarget(),module={exports:{}};let peer;
 class Peer{constructor(){peer=this;}close(){}}
 window.__homerMobileNonce='old-attempt';window.ReactNativeWebView={postMessage:value=>messages.push(JSON.parse(value))};
 Function('window','document','RTCPeerConnection','module','exports',source)(window,document,Peer,module,module.exports);
 window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:{signalOrigin:'https://signal.example',routeId:'a'.repeat(64),invitation:'b'.repeat(43)}}));
 window.__homerMobileNonce='new-attempt';const channel={close(){},send(){},bufferedAmount:0,readyState:'open'};peer.ondatachannel({channel});channel.onopen();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(messages.find(item=>item.code==='invitation-expired')?.nonce,'old-attempt');
});

test('a timed-out approval is shown as timeout and does not restart on app resume',async()=>{
 const source=(await buildAsync({entryPoints:['ui/mobile-connection.ts'],bundle:true,write:false,format:'cjs',platform:'browser',logLevel:'silent',plugins:[{name:'fake-mobile-transport',setup(build){
  build.onResolve({filter:/mobile-channel\.js$/},()=>({path:'channel',namespace:'fake'}));
  build.onResolve({filter:/mobile-signaling\.js$/},()=>({path:'signal',namespace:'fake'}));
  build.onLoad({filter:/channel/,namespace:'fake'},()=>({contents:'export const mobileChannel=(_port,receive)=>({send:async packet=>queueMicrotask(()=>receive({id:packet.id,result:packet.op==="pair"?{status:"pending",credential:"c".repeat(43),protocol:1}:{status:"expired",protocol:1}})),close(){}});'}));
  build.onLoad({filter:/signal/,namespace:'fake'},()=>({contents:'export async function openMobileSignal(){return {call:async()=>{},close(){}}}'}));
 }}]})).outputFiles[0].text;
 const messages=[],window=new EventTarget(),document=new EventTarget(),module={exports:{}};let peer,count=0;
 class Peer{constructor(){peer=this;count++;}close(){}}
 window.ReactNativeWebView={postMessage:value=>messages.push(JSON.parse(value))};
 const fakeSetTimeout=(fn,ms)=>setTimeout(fn,ms===1500?0:ms);
 Function('window','document','RTCPeerConnection','setTimeout','module','exports',source)(window,document,Peer,fakeSetTimeout,module,module.exports);
 window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:{signalOrigin:'https://signal.example',routeId:'a'.repeat(64),invitation:'b'.repeat(43)}}));
 const channel={close(){},send(){},bufferedAmount:0,readyState:'open'};peer.ondatachannel({channel});channel.onopen();
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.deepEqual(messages.filter(item=>item.type==='connection-status').map(item=>item.code),['connecting','pending','approval-timeout']);
 document.dispatchEvent(new Event('visibilitychange'));assert.equal(count,1);
});

test('a duplicate scan reports an existing request and does not retry on resume',async()=>{
 const source=(await buildAsync({entryPoints:['ui/mobile-connection.ts'],bundle:true,write:false,format:'cjs',platform:'browser',logLevel:'silent',plugins:[{name:'fake-mobile-transport',setup(build){
  build.onResolve({filter:/mobile-channel\.js$/},()=>({path:'channel',namespace:'fake'}));
  build.onResolve({filter:/mobile-signaling\.js$/},()=>({path:'signal',namespace:'fake'}));
  build.onLoad({filter:/channel/,namespace:'fake'},()=>({contents:'export const mobileChannel=(_port,receive)=>({send:async packet=>queueMicrotask(()=>receive({id:packet.id,error:"mobile_pairing_busy"})),close(){}});'}));
  build.onLoad({filter:/signal/,namespace:'fake'},()=>({contents:'export async function openMobileSignal(){return {call:async()=>{},close(){}}}'}));
 }}]})).outputFiles[0].text;
 const messages=[],window=new EventTarget(),document=new EventTarget(),module={exports:{}};let peer,count=0;
 class Peer{constructor(){peer=this;count++;}close(){}}
 window.ReactNativeWebView={postMessage:value=>messages.push(JSON.parse(value))};
 Function('window','document','RTCPeerConnection','module','exports',source)(window,document,Peer,module,module.exports);
 window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:{signalOrigin:'https://signal.example',routeId:'a'.repeat(64),invitation:'b'.repeat(43)}}));
 const channel={close(){},send(){},bufferedAmount:0,readyState:'open'};peer.ondatachannel({channel});channel.onopen();
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(messages.filter(item=>item.type==='connection-status').map(item=>item.code),['connecting','pairing-busy']);
 document.dispatchEvent(new Event('visibilitychange'));assert.equal(count,1);
});

test('other authorization failures still use the existing reconnect path',async()=>{
 const source=(await buildAsync({entryPoints:['ui/mobile-connection.ts'],bundle:true,write:false,format:'cjs',platform:'browser',logLevel:'silent',plugins:[{name:'fake-mobile-transport',setup(build){
  build.onResolve({filter:/mobile-channel\.js$/},()=>({path:'channel',namespace:'fake'}));
  build.onResolve({filter:/mobile-signaling\.js$/},()=>({path:'signal',namespace:'fake'}));
  build.onLoad({filter:/channel/,namespace:'fake'},()=>({contents:'export const mobileChannel=(_port,receive)=>({send:async packet=>queueMicrotask(()=>receive({id:packet.id,error:"mobile_request_busy"})),close(){}});'}));
  build.onLoad({filter:/signal/,namespace:'fake'},()=>({contents:'export async function openMobileSignal(){return {call:async()=>{},close(){}}}'}));
 }}]})).outputFiles[0].text;
 const messages=[],window=new EventTarget(),document=new EventTarget(),module={exports:{}};let peer,retry;
 class Peer{constructor(){peer=this;}close(){}}
 window.ReactNativeWebView={postMessage:value=>messages.push(JSON.parse(value))};
 const schedule=(fn,ms)=>{const timer=setTimeout(fn,ms);if(ms===3000)retry=timer;return timer;};
 Function('window','document','RTCPeerConnection','setTimeout','module','exports',source)(window,document,Peer,schedule,module,module.exports);
 window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:{signalOrigin:'https://signal.example',routeId:'a'.repeat(64),invitation:'b'.repeat(43)}}));
 const channel={close(){},send(){},bufferedAmount:0,readyState:'open'};peer.ondatachannel({channel});channel.onopen();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(messages.filter(item=>item.type==='connection-status').at(-1)?.code,'unavailable');assert.ok(retry);clearTimeout(retry);
});

test('mobile cancellation uses the candidate credential and reports the desktop receipt',async()=>{
 const source=(await buildAsync({entryPoints:['ui/mobile-connection.ts'],bundle:true,write:false,format:'cjs',platform:'browser',logLevel:'silent',plugins:[{name:'fake-mobile-transport',setup(build){
  build.onResolve({filter:/mobile-channel\.js$/},()=>({path:'channel',namespace:'fake'}));
  build.onResolve({filter:/mobile-signaling\.js$/},()=>({path:'signal',namespace:'fake'}));
  build.onLoad({filter:/channel/,namespace:'fake'},()=>({contents:'export const mobileChannel=(_port,receive)=>({send:async packet=>{globalThis.__cancelPackets.push(packet);queueMicrotask(()=>receive({id:packet.id,result:packet.op==="pair"?{status:"pending",credential:"c".repeat(43),protocol:1}:{status:"cancelled",protocol:1}}))},close(){}});'}));
  build.onLoad({filter:/signal/,namespace:'fake'},()=>({contents:'export async function openMobileSignal(){return {call:async()=>{},close(){}}}'}));
 }}]})).outputFiles[0].text;
 const messages=[],window=new EventTarget(),document=new EventTarget(),module={exports:{}};let peer;
 class Peer{constructor(){peer=this;}close(){}}
 globalThis.__cancelPackets=[];
 try{
  window.__homerMobileNonce='attempt';window.ReactNativeWebView={postMessage:value=>messages.push(JSON.parse(value))};
  Function('window','document','RTCPeerConnection','module','exports',source)(window,document,Peer,module,module.exports);
  window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:{signalOrigin:'https://signal.example',routeId:'a'.repeat(64),invitation:'b'.repeat(43)}}));
  const channel={close(){},send(){},bufferedAmount:0,readyState:'open'};peer.ondatachannel({channel});channel.onopen();
  await new Promise(resolve=>setImmediate(resolve));
  window.dispatchEvent(new CustomEvent('homer-mobile-cancel'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(globalThis.__cancelPackets.at(-1).op,'pair.cancel');
  assert.equal(globalThis.__cancelPackets.at(-1).input.credential,'c'.repeat(43));
  assert.deepEqual(messages.filter(item=>item.type==='cancel-result').at(-1),{type:'cancel-result',result:'cancelled',nonce:'attempt'});
  window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail:null}));
 }finally{delete globalThis.__cancelPackets;}
});
