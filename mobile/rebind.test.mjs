import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const require=createRequire(import.meta.url),React=require('react'),Renderer=require('react-test-renderer');
const {act}=React;
const cameraGranted={status:'granted',expires:'never',granted:true,canAskAgain:true};
const cameraUndetermined={status:'undetermined',expires:'never',granted:false,canAskAgain:true};
const cameraDenied={status:'denied',expires:'never',granted:false,canAskAgain:false};
const mocks={
 'react-native':`const React=require('react'); exports.View='View';exports.Text='Text';exports.Image='Image';exports.Pressable='Pressable';exports.ActivityIndicator='ActivityIndicator';exports.StatusBar='StatusBar';exports.Modal=({visible,children,...props})=>visible?React.createElement('NativeModal',props,children):null;exports.StyleSheet={create:v=>v,hairlineWidth:1};exports.Platform={get OS(){return globalThis.__rebindTest.platform??'ios'},get Version(){return globalThis.__rebindTest.platform==='android'?33:'17.0'}};exports.PermissionsAndroid={};exports.Linking={openURL:url=>globalThis.__rebindTest.openURL?.(url),openSettings:async()=>globalThis.__rebindTest.openSettings?.()};exports.Alert={alert:(...args)=>globalThis.__rebindTest.alerts?.push(args)};exports.AppState={addEventListener:(_,fn)=>{globalThis.__rebindTest.foreground=fn;return {remove(){}}}};`,
 'react-native-safe-area-context':`exports.SafeAreaProvider='SafeAreaProvider';exports.SafeAreaView='SafeAreaView';`,
 'expo-camera':`const {useState}=require('react');const granted=${JSON.stringify(cameraGranted)};
 exports.CameraView='CameraView';exports.useCameraPermissions=()=>{
  const camera=globalThis.__rebindTest.camera;
  const [permission,setPermission]=useState(camera?camera.initial:granted);
  const update=async result=>{const value=await result;setPermission(value);return value;};
  return [permission,()=>update(camera.request()),()=>update(camera?.get?.()??granted)];
 };`,
 'expo-secure-store':`exports.getItemAsync=key=>key.startsWith('homer.mobile-update-dismissed.')?(globalThis.__rebindTest.readUpdate?.(key)??Promise.resolve(null)):key==='homer.mobile-cancel'?Promise.resolve(globalThis.__rebindTest.cancel??null):globalThis.__rebindTest.read();exports.setItemAsync=(key,value)=>key.startsWith('homer.mobile-update-dismissed.')?(globalThis.__rebindTest.writeUpdate?.(key,value)??Promise.resolve()):key==='homer.mobile-cancel'?(globalThis.__rebindTest.storeCancel?globalThis.__rebindTest.storeCancel(value):(globalThis.__rebindTest.cancel=value,Promise.resolve())):globalThis.__rebindTest.write(value);exports.deleteItemAsync=key=>key==='homer.mobile-cancel'?(globalThis.__rebindTest.removeCancel?globalThis.__rebindTest.removeCancel():(globalThis.__rebindTest.cancel=null,Promise.resolve())):globalThis.__rebindTest.remove();`,
 'expo-application':`Object.defineProperties(exports,{applicationId:{get:()=>globalThis.__rebindTest.applicationId??'com.homer.mobile.qa'},nativeApplicationVersion:{get:()=> '0.1.1'},nativeBuildVersion:{get:()=> '3'}});exports.getAppleStoreEnvironmentAsync=async()=>('storeEnvironment' in globalThis.__rebindTest?globalThis.__rebindTest.storeEnvironment:'production');`,
 'expo':`exports.requireOptionalNativeModule=()=>globalThis.__rebindTest.storefrontMissing?null:({current:()=>globalThis.__rebindTest.readStorefront?.()??Promise.resolve('storefront' in globalThis.__rebindTest?globalThis.__rebindTest.storefront:'CHN')});`,
 'expo-device':`Object.defineProperties(exports,{deviceName:{get:()=>globalThis.__rebindDeviceName??null},supportedCpuArchitectures:{get:()=>globalThis.__rebindTest.abis??['arm64-v8a']}});`,
 'expo-crypto':`exports.randomUUID=()=>globalThis.__rebindTest.uuid();`,
 'expo-file-system':`exports.File=class{};exports.Paths={cache:'test'};`,
 'expo-sharing':`exports.isAvailableAsync=()=>globalThis.__rebindTest.sharingAvailable??Promise.resolve(false);exports.shareAsync=async()=>{};`,
 'react-native-webview':`const React=require('react');exports.WebView=React.forwardRef((props,ref)=>{React.useImperativeHandle(ref,()=>({injectJavaScript:script=>(script.includes('__homerMobileUpdate=')?(globalThis.__rebindTest.updates??=[]):globalThis.__rebindTest.injections).push(script)}));return React.createElement('WebView',props)});`,
};
const entry=fileURLToPath(new URL('./App.tsx',import.meta.url));
const code=(await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',loader:{'.png':'dataurl'},external:['react','react/jsx-runtime'],plugins:[{name:'native-fixtures',setup(b){
 b.onResolve({filter:/.*/},args=>{if(args.path in mocks)return {path:args.path,namespace:'mock'};if(args.path.endsWith('/.generated/chat.mjs'))return {path:'chat',namespace:'mock'};});
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='chat'?'export default "<html></html>"':mocks[args.path],loader:'js'}));
}}]})).outputFiles[0].text;
function createApp(){const module={exports:{}};Function('require','module','exports',code)(require,module,module.exports);return module.exports.default;}
const App=createApp();
const releaseFixture={schemaVersion:1,releases:{stable:{ios:{status:'available',version:'0.1.2',minOsVersion:'16.0',verifiedStorefronts:['CHN'],storeUrl:'https://apps.apple.com/app/id6830019784'}}}};
const old={signalOrigin:'https://old.example',routeId:'a'.repeat(64),credential:'c'.repeat(43)};
const next={signalOrigin:'https://new.example',routeId:'b'.repeat(64),credential:'e'.repeat(43)};
const qr='https://new.example/homer/mobile/'+'b'.repeat(64)+'#'+'d'.repeat(43);
const web=tree=>tree.root.findByType('WebView');
const text=tree=>tree.root.findAllByType('Text').map(t=>t.children.join('')).join('\n');
const press=(tree,label)=>{const target=tree.root.findAllByType('Pressable').find(node=>node.findAllByType('Text').some(t=>t.children.join('')===label));assert.ok(target,`missing action ${label}`);return target.props.onPress();};
const token=ctx=>JSON.parse(ctx.injections.findLast(script=>script.includes('__homerMobileNonce=')).match(/window\.__homerMobileNonce=("[^"]+")/)[1]);
const send=(tree,ctx,item,nonce=token(ctx))=>web(tree).props.onMessage({nativeEvent:{url:'https://localhost/',data:JSON.stringify({...item,nonce})}});
async function boot(ctx,Client=App){let tree;await act(async()=>{tree=Renderer.create(React.createElement(Client));await Promise.resolve();});await act(async()=>web(tree).props.onLoadEnd());await act(async()=>send(tree,ctx,{type:'connection-status',code:'active'}));return tree;}
async function scan(tree){await act(async()=>send(tree,globalThis.__rebindTest,{type:'open-scanner'}));await act(async()=>{tree.root.findByType('CameraView').props.onBarcodeScanned({data:qr});await Promise.resolve();});}
const credential=(tree,ctx)=>send(tree,ctx,{type:'credential',routeId:next.routeId,credential:next.credential});
async function cancelAndReturn(tree,ctx){const attempt=token(ctx);await act(async()=>press(tree,'返回原连接'));await act(async()=>send(tree,ctx,{type:'cancel-result',result:'absent'},attempt));}

test('update check runs once across foreground, ready, reconnect and WebView reload; native owns URL and dismissal',async()=>{
 const originalFetch=globalThis.fetch,channel=process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL;
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.__DEV__=false;process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL='stable';
 let count=0,serial=0,failOpen=true,written=[],opened=[];
 const ctx={applicationId:'com.homer.mobile',injections:[],uuid:()=>`update-${++serial}`,read:async()=>JSON.stringify(old),write:async()=>{},readUpdate:async()=>null,writeUpdate:async(key,value)=>{written.push([key,value]);throw Error('disk failed');},openURL:async url=>{opened.push(url);if(failOpen)throw Error('cannot open');}};
 globalThis.__rebindTest=ctx;globalThis.fetch=async()=>{count++;return new Response(JSON.stringify(releaseFixture));};
 const Client=createApp();let tree=await boot(ctx,Client);
 const snapshot=()=>JSON.parse(ctx.updates.at(-1).match(/window\.__homerMobileUpdate=([^;]+);/)[1]);
 try{
  assert.equal(count,1);assert.deepEqual(snapshot(),{version:'0.1.2',openError:false});
  await act(async()=>ctx.foreground('active'));
  await act(async()=>send(tree,ctx,{type:'ready'}));
  await act(async()=>send(tree,ctx,{type:'connection-status',code:'unavailable'}));
  await act(async()=>{web(tree).props.onLoadStart();web(tree).props.onLoadEnd();});
  assert.equal(count,1);assert.equal(snapshot().version,'0.1.2');
  await act(async()=>send(tree,ctx,{type:'update-open',url:'https://evil.example'},'stale'));assert.equal(opened.length,0);
  await act(async()=>web(tree).props.onMessage({nativeEvent:{url:'https://evil.example',data:JSON.stringify({type:'update-dismiss',nonce:token(ctx)})}}));assert.equal(snapshot().version,'0.1.2');
  await act(async()=>send(tree,ctx,{type:'update-open',url:'https://evil.example'}));assert.equal(snapshot().openError,true);
  assert.deepEqual(opened,['https://super-tree.com/homer/app']);
  failOpen=false;await act(async()=>send(tree,ctx,{type:'update-open'}));assert.equal(snapshot().openError,false);assert.equal(snapshot().version,'0.1.2');
  await act(async()=>send(tree,ctx,{type:'update-busy',busy:true},'stale'));assert.equal(snapshot().version,'0.1.2');
  await act(async()=>send(tree,ctx,{type:'update-busy',busy:true}));assert.equal(snapshot(),null);
  await act(async()=>send(tree,ctx,{type:'update-busy',busy:false}));assert.equal(snapshot().version,'0.1.2');
  let finishShare;ctx.sharingAvailable=new Promise(resolve=>{finishShare=resolve;});
  await act(async()=>send(tree,ctx,{type:'share-file',filename:'synthetic.txt',base64:'YQ=='}));assert.equal(snapshot(),null);
  await act(async()=>finishShare(false));assert.equal(snapshot().version,'0.1.2');
  await act(async()=>send(tree,ctx,{type:'open-scanner'}));assert.equal(snapshot(),null);
  await act(async()=>press(tree,'取消'));assert.equal(snapshot().version,'0.1.2');
  await scan(tree);assert.equal(snapshot(),null);await act(async()=>send(tree,ctx,{type:'connection-status',code:'pending'}));assert.equal(snapshot(),null);
  await cancelAndReturn(tree,ctx);assert.equal(snapshot().version,'0.1.2');assert.equal(count,1);
  await act(async()=>send(tree,ctx,{type:'update-dismiss',version:'999'}));assert.equal(snapshot(),null);
  assert.deepEqual(written,[['homer.mobile-update-dismissed.stable.ios','0.1.2']]);
  await act(async()=>send(tree,ctx,{type:'ready'}));assert.equal(snapshot(),null);
  await act(async()=>tree.unmount());tree=await boot(ctx,Client);assert.equal(snapshot(),null);assert.equal(count,1);
 }finally{await act(async()=>tree.unmount());globalThis.fetch=originalFetch;if(channel===undefined)delete process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL;else process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL=channel;delete globalThis.__DEV__;delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('unknown/QA/development/sandbox identity and unreadable dismissal skip without touching binding storage',async()=>{
 const originalFetch=globalThis.fetch,channel=process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL;
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;let requests=0;
 globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify(releaseFixture));};
 try{
  for(const config of [{applicationId:'com.homer.mobile.qa'},{channel:undefined},{channel:'qa'},{development:true},{storeEnvironment:'sandbox'},{storeEnvironment:null},{storefront:null},{storefrontMissing:true},{readUpdate:async()=>{throw Error('unreadable');}},{readUpdate:async()=> '0.1.2'},{storefront:'GBR'}]){
   globalThis.__DEV__=config.development??false;process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL=config.channel??'stable';if('channel' in config&&config.channel===undefined)delete process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL;
   let pairingReads=0;const ctx={applicationId:'com.homer.mobile',injections:[],uuid:()=> 'skip',read:async()=>{pairingReads++;return JSON.stringify(old);},write:async()=>{},...config};
   globalThis.__rebindTest=ctx;const before=requests,tree=await boot(ctx,createApp());
   assert.match(ctx.updates.at(-1),/__homerMobileUpdate=null/);assert.equal(pairingReads,1);
   if(config.storefront!=='GBR'&&!config.readUpdate)assert.equal(requests,before);
   await act(async()=>tree.unmount());
  }
 }finally{globalThis.fetch=originalFetch;if(channel===undefined)delete process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL;else process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL=channel;delete globalThis.__DEV__;delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('Android native metadata and connection-page notice share the platform-specific dismissal key',async()=>{
 const originalFetch=globalThis.fetch,channel=process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL;
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.__DEV__=false;process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL='stable';
 let stored=null,requests=0;
 const ctx={platform:'android',applicationId:'com.homer.mobile',injections:[],uuid:()=> 'android-update',read:async()=>null,readUpdate:async key=>{assert.equal(key,'homer.mobile-update-dismissed.stable.android');return stored;},writeUpdate:async(key,value)=>{assert.equal(key,'homer.mobile-update-dismissed.stable.android');stored=value;}};
 globalThis.__rebindTest=ctx;globalThis.fetch=async()=>{requests++;return Response.json({schemaVersion:1,releases:{stable:{android:{status:'available',version:'0.1.2',versionCode:4,minApiLevel:33,supportedAbis:['arm64-v8a'],downloadUrl:'https://github.com/wolf3c/homer/releases/download/mobile-0.1.2/Homer.apk',sha256:'a'.repeat(64)}}}});};
 let tree;
 try{
  await act(async()=>{tree=Renderer.create(React.createElement(createApp()));});
  assert.match(text(tree),/连接你的电脑/);assert.match(text(tree),/有新版本 0.1.2/);
  const close=tree.root.findAllByType('Pressable').find(node=>node.props.accessibilityLabel==='关闭更新提示');
  await act(async()=>close.props.onPress());assert.doesNotMatch(text(tree),/有新版本/);assert.equal(stored,'4');
  await act(async()=>tree.unmount());await act(async()=>{tree=Renderer.create(React.createElement(createApp()));});assert.doesNotMatch(text(tree),/有新版本/);assert.equal(requests,2);
 }finally{if(tree)await act(async()=>tree.unmount());globalThis.fetch=originalFetch;if(channel===undefined)delete process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL;else process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL=channel;delete globalThis.__DEV__;delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('a stalled storefront read ends after five seconds without a request or connection failure',async t=>{
 const originalFetch=globalThis.fetch,channel=process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL;
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.__DEV__=false;process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL='stable';t.mock.timers.enable({apis:['setTimeout']});
 let requests=0;globalThis.fetch=async()=>{requests++;return Response.json(releaseFixture);};
 const ctx={applicationId:'com.homer.mobile',injections:[],uuid:()=> 'storefront-timeout',read:async()=>JSON.stringify(old),readStorefront:()=>new Promise(()=>{})};globalThis.__rebindTest=ctx;
 let tree;
 try{tree=await boot(ctx,createApp());await act(async()=>t.mock.timers.tick(5000));assert.equal(requests,0);assert.match(ctx.updates.at(-1),/__homerMobileUpdate=null/);assert.doesNotMatch(text(tree),/无法读取|加载失败/);}
 finally{if(tree)await act(async()=>tree.unmount());t.mock.timers.reset();globalThis.fetch=originalFetch;if(channel===undefined)delete process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL;else process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL=channel;delete globalThis.__DEV__;delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('scanner has a modal safe area and can return to the existing chat',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let stored=JSON.stringify(old);
 const ctx={injections:[],uuid:()=> 'safe-area-test',read:async()=>stored,write:async value=>{stored=value;},remove:async()=>{stored=null;}};
 globalThis.__rebindTest=ctx;const tree=await boot(ctx);
 try{
  const injections=ctx.injections.length;
  await act(async()=>send(tree,ctx,{type:'open-scanner'}));
  const modal=tree.root.findByType('NativeModal');
  assert.equal(modal.findAllByType('SafeAreaProvider').length,1,'the native modal needs its own safe area provider');
  assert.ok(modal.findByType('SafeAreaProvider').findByType('SafeAreaView'));
  await act(async()=>press(tree,'取消'));
  assert.equal(tree.root.findAllByType('NativeModal').length,0);
  assert.equal(tree.root.findAllByType('View').find(node=>node.props.accessibilityElementsHidden===false)?.props.pointerEvents,'auto');
  await act(async()=>send(tree,ctx,{type:'open-scanner'}));
  await act(async()=>tree.root.findByType('NativeModal').props.onRequestClose());
  assert.equal(tree.root.findAllByType('NativeModal').length,0);
  assert.deepEqual(JSON.parse(stored),old);
  assert.equal(ctx.injections.length,injections,'opening and cancelling the scanner must not reconnect');
 }finally{await act(async()=>tree.unmount());delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('returning to the previous connection waits for the new computer to confirm cancellation',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let serial=0,stored=JSON.stringify(old);
 const ctx={injections:[],uuid:()=>`cancel-${++serial}`,read:async()=>stored,write:async value=>{stored=value;},remove:async()=>{stored=null;}};
 globalThis.__rebindTest=ctx;let tree;
 try{
  tree=await boot(ctx);await scan(tree);await act(async()=>credential(tree,ctx));await act(async()=>send(tree,ctx,{type:'connection-status',code:'pending'}));
  const attempt=token(ctx);
  await act(async()=>press(tree,'返回原连接'));
  assert.match(ctx.injections.at(-1),/homer-mobile-cancel/);
  assert.match(text(tree),/正在取消绑定/);
  assert.deepEqual(JSON.parse(stored),old);
  await act(async()=>send(tree,ctx,{type:'cancel-result',result:'unavailable'},attempt));
  assert.match(text(tree),/未能确认取消/);
  assert.doesNotMatch(ctx.injections.at(-1),/old\.example/);
  await act(async()=>press(tree,'重试取消'));
  await act(async()=>send(tree,ctx,{type:'cancel-result',result:'approved'},attempt));
  assert.match(text(tree),/电脑已确认绑定/);
  assert.doesNotMatch(ctx.injections.at(-1),/old\.example/);
  await act(async()=>press(tree,'重试取消'));
  await act(async()=>send(tree,ctx,{type:'cancel-result',result:'cancelled'},attempt));
  assert.match(ctx.injections.at(-1),/old\.example/);
  assert.deepEqual(JSON.parse(stored),old);
 }finally{if(tree)await act(async()=>tree.unmount());delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('an interrupted cancellation is recovered after restart without replacing the original binding',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let serial=0,stored=JSON.stringify(old);
 const ctx={injections:[],uuid:()=>`restart-${++serial}`,read:async()=>stored,write:async value=>{stored=value;},remove:async()=>{stored=null;}};
 globalThis.__rebindTest=ctx;let tree;
 try{
  tree=await boot(ctx);await scan(tree);await act(async()=>credential(tree,ctx));await act(async()=>send(tree,ctx,{type:'connection-status',code:'pending'}));
  await act(async()=>press(tree,'返回原连接'));
  assert.ok(ctx.cancel,'the unresolved cancellation must be stored before it is sent');
  assert.deepEqual(JSON.parse(stored),old);
  await act(async()=>tree.unmount());ctx.injections=[];
  await act(async()=>{tree=Renderer.create(React.createElement(App));await Promise.resolve();});
  await act(async()=>web(tree).props.onLoadEnd());
  assert.match(ctx.injections.at(-1),/new\.example/);
  assert.match(text(tree),/未能确认取消/);
  const attempt=token(ctx);
  await act(async()=>press(tree,'重试取消'));
  await act(async()=>send(tree,ctx,{type:'cancel-result',result:'absent'},attempt));
  assert.equal(ctx.cancel,null);
  assert.match(ctx.injections.at(-1),/old\.example/);
  assert.deepEqual(JSON.parse(stored),old);
 }finally{if(tree)await act(async()=>tree.unmount());delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('secure storage failures do not discard the original binding or claim cancellation completed',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let serial=0,stored=JSON.stringify(old),failWrite=true,failDelete=true;
 const ctx={injections:[],cancel:null,uuid:()=>`storage-${++serial}`,read:async()=>stored,write:async value=>{stored=value;},remove:async()=>{stored=null;},storeCancel:async value=>{if(failWrite)throw Error('storage failure');ctx.cancel=value;},removeCancel:async()=>{if(failDelete)throw Error('storage failure');ctx.cancel=null;}};
 globalThis.__rebindTest=ctx;let tree;
 try{
  tree=await boot(ctx);await scan(tree);await act(async()=>credential(tree,ctx));await act(async()=>send(tree,ctx,{type:'connection-status',code:'pending'}));
  const attempt=token(ctx),count=ctx.injections.length;
  await act(async()=>press(tree,'返回原连接'));
  assert.match(text(tree),/未能确认取消/);assert.equal(ctx.injections.length,count);
  assert.deepEqual(JSON.parse(stored),old);
  failWrite=false;await act(async()=>press(tree,'重试取消'));
  assert.ok(ctx.cancel);assert.match(ctx.injections.at(-1),/homer-mobile-cancel/);
  await act(async()=>send(tree,ctx,{type:'cancel-result',result:'cancelled'},attempt));
  assert.match(text(tree),/未能确认取消/);assert.ok(ctx.cancel);
  assert.deepEqual(JSON.parse(stored),old);
  failDelete=false;await act(async()=>press(tree,'重试取消'));
  await act(async()=>send(tree,ctx,{type:'cancel-result',result:'absent'},attempt));
  assert.equal(ctx.cancel,null);assert.match(ctx.injections.at(-1),/old\.example/);
 }finally{if(tree)await act(async()=>tree.unmount());delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('replacement preserves the previous binding until approval and successful storage',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let serial=0,stored,fail=false,delay=false,releaseWrite;
 const ctx={injections:[],uuid:()=>`test-${++serial}`,read:async()=>stored,write:async value=>{if(fail)throw Error('storage failure');if(delay)await new Promise(resolve=>{releaseWrite=resolve;});stored=value;},remove:async()=>{stored=null;}};
 globalThis.__rebindTest=ctx;
 const reset=()=>{stored=JSON.stringify(old);ctx.injections=[];fail=false;delay=false;releaseWrite=undefined;};
 try{
  reset();let tree=await boot(ctx),oldToken=token(ctx);let count=ctx.injections.length;
  await act(async()=>web(tree).props.onMessage({nativeEvent:{url:'https://foreign.example/',data:JSON.stringify({type:'ready'})}}));assert.equal(ctx.injections.length,count);
  await act(async()=>web(tree).props.onMessage({nativeEvent:{url:'https://localhost/',data:JSON.stringify({type:'ready'})}}));assert.equal(ctx.injections.length,count+1,'local readiness replays the restored connection');assert.match(ctx.injections.at(-1),/homer-mobile-connect/);
  await scan(tree);assert.notEqual(token(ctx),oldToken);assert.deepEqual(JSON.parse(stored),old);
  await act(async()=>credential(tree,ctx));await act(async()=>send(tree,ctx,{type:'connection-status',code:'pending'}));assert.deepEqual(JSON.parse(stored),old);
  await act(async()=>send(tree,ctx,{type:'connection-status',code:'active'},oldToken));assert.deepEqual(JSON.parse(stored),old,'stale status must not commit');
  await cancelAndReturn(tree,ctx);assert.match(ctx.injections.at(-1),/old\.example/);await act(async()=>tree.unmount());
  reset();tree=await boot(ctx);await scan(tree);await act(async()=>credential(tree,ctx));await act(async()=>send(tree,ctx,{type:'connection-status',code:'denied'}));assert.deepEqual(JSON.parse(stored),old);await act(async()=>press(tree,'返回原连接'));assert.match(ctx.injections.at(-1),/old\.example/);await act(async()=>tree.unmount());
  reset();tree=await boot(ctx);await scan(tree);await act(async()=>credential(tree,ctx));await act(async()=>send(tree,ctx,{type:'connection-status',code:'approval-timeout'}));assert.match(text(tree),/等待确认已超时/);assert.match(text(tree),/重新生成二维码/);assert.deepEqual(JSON.parse(stored),old);await act(async()=>press(tree,'返回原连接'));assert.match(ctx.injections.at(-1),/old\.example/);await act(async()=>tree.unmount());
  reset();tree=await boot(ctx);await scan(tree);await act(async()=>send(tree,ctx,{type:'connection-status',code:'pairing-busy'}));assert.match(text(tree),/已有待确认请求/);assert.match(text(tree),/重新生成二维码/);assert.deepEqual(JSON.parse(stored),old);await act(async()=>press(tree,'重新扫码'));assert.equal(tree.root.findAllByType('CameraView').length,1);await act(async()=>press(tree,'取消'));await act(async()=>press(tree,'返回原连接'));assert.match(text(tree),/请先在电脑处理请求/);await act(async()=>press(tree,'我已在电脑处理，返回原连接'));assert.match(ctx.injections.at(-1),/old\.example/);await act(async()=>tree.unmount());
  reset();tree=await boot(ctx);await scan(tree);await act(async()=>credential(tree,ctx));await act(async()=>send(tree,ctx,{type:'connection-status',code:'pending'}));await act(async()=>tree.unmount());ctx.injections=[];tree=await boot(ctx);assert.match(ctx.injections.at(-1),/old\.example/,'restart during approval must restore the previous binding');await act(async()=>tree.unmount());
  reset();tree=await boot(ctx);await scan(tree);await act(async()=>credential(tree,ctx));fail=true;await act(async()=>send(tree,ctx,{type:'connection-status',code:'active'}));assert.deepEqual(JSON.parse(stored),old);assert.match(text(tree),/连接信息未能保存/);await cancelAndReturn(tree,ctx);assert.match(ctx.injections.at(-1),/old\.example/);await act(async()=>tree.unmount());
  reset();tree=await boot(ctx);await scan(tree);await act(async()=>credential(tree,ctx));assert.deepEqual(JSON.parse(stored),old);await act(async()=>send(tree,ctx,{type:'connection-status',code:'active'}));assert.deepEqual(JSON.parse(stored),next);assert.doesNotMatch(text(tree),/返回原连接/);await act(async()=>tree.unmount());
  reset();tree=await boot(ctx);await scan(tree);await act(async()=>credential(tree,ctx));delay=true;await act(async()=>send(tree,ctx,{type:'connection-status',code:'active'}));assert.match(text(tree),/正在保存连接/);assert.doesNotMatch(text(tree),/返回原连接/);await act(async()=>send(tree,ctx,{type:'connection-status',code:'unavailable'}));await act(async()=>releaseWrite());assert.deepEqual(JSON.parse(stored),next);assert.match(text(tree),/正在自动重试/,'disconnect while saving must remain visible');await act(async()=>tree.unmount());
  reset();stored=null;await act(async()=>{tree=Renderer.create(React.createElement(App));await Promise.resolve();});await act(async()=>web(tree).props.onLoadEnd());await act(async()=>press(tree,'开始扫码'));await act(async()=>{tree.root.findByType('CameraView').props.onBarcodeScanned({data:qr});await Promise.resolve();});await act(async()=>send(tree,ctx,{type:'connection-status',code:'pairing-busy'}));assert.match(text(tree),/已有待确认请求/);assert.doesNotMatch(text(tree),/返回原连接/);await act(async()=>press(tree,'重新扫码'));assert.equal(tree.root.findAllByType('CameraView').length,1);await act(async()=>tree.unmount());
 }finally{delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('first binding waits for secure storage and can retry a failed save after approval',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let serial=0,stored=null,fail=true,releaseWrite;
 const ctx={injections:[],uuid:()=>`first-${++serial}`,read:async()=>stored,write:async value=>{if(fail)throw Error('storage failure');await new Promise(resolve=>{releaseWrite=resolve;});stored=value;},remove:async()=>{stored=null;}};
 globalThis.__rebindTest=ctx;
 let tree;
 try{
  await act(async()=>{tree=Renderer.create(React.createElement(App));await Promise.resolve();});
  await act(async()=>web(tree).props.onLoadEnd());
  await act(async()=>press(tree,'开始扫码'));
  await act(async()=>tree.root.findByType('CameraView').props.onBarcodeScanned({data:qr}));
  await act(async()=>credential(tree,ctx));
  await act(async()=>send(tree,ctx,{type:'connection-status',code:'pending'}));
  await act(async()=>send(tree,ctx,{type:'connection-status',code:'active'}));
  assert.equal(stored,null);
  assert.match(text(tree),/连接信息未能保存/);
  assert.equal(tree.root.findAllByType('View').find(node=>node.props.accessibilityElementsHidden===true)?.props.pointerEvents,'none','chat must stay hidden after a failed save');
  await act(async()=>send(tree,ctx,{type:'connection-status',code:'unavailable'}));
  assert.match(text(tree),/连接信息未能保存/,'a disconnect must not hide the recovery action');
  fail=false;
  await act(async()=>press(tree,'重新保存'));
  assert.equal(stored,null);
  assert.match(text(tree),/正在保存连接/);
  await act(async()=>releaseWrite());
  assert.deepEqual(JSON.parse(stored),next);
  assert.equal(tree.root.findAllByType('View').find(node=>node.props.accessibilityElementsHidden===false)?.props.pointerEvents,'auto','chat is available once the approved binding is saved');
  assert.match(text(tree),/正在自动重试/,'the latest disconnected state remains visible');
 }finally{if(tree)await act(async()=>tree.unmount());delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('approval arriving during the first secure write cannot expose chat early',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let serial=0,stored=null,releaseWrite;
 const ctx={injections:[],uuid:()=>`slow-${++serial}`,read:async()=>stored,write:async value=>{await new Promise(resolve=>{releaseWrite=resolve;});stored=value;},remove:async()=>{stored=null;}};
 globalThis.__rebindTest=ctx;
 let tree;
 try{
  await act(async()=>{tree=Renderer.create(React.createElement(App));await Promise.resolve();});
  await act(async()=>web(tree).props.onLoadEnd());
  await act(async()=>press(tree,'开始扫码'));
  await act(async()=>tree.root.findByType('CameraView').props.onBarcodeScanned({data:qr}));
  await act(async()=>credential(tree,ctx));
  await act(async()=>send(tree,ctx,{type:'connection-status',code:'pending'}));
  await act(async()=>send(tree,ctx,{type:'connection-status',code:'active'}));
  assert.equal(stored,null);
  assert.match(text(tree),/正在保存连接/);
  assert.equal(tree.root.findAllByType('View').find(node=>node.props.accessibilityElementsHidden===true)?.props.pointerEvents,'none');
  await act(async()=>releaseWrite());
  assert.deepEqual(JSON.parse(stored),next);
  assert.equal(tree.root.findAllByType('View').find(node=>node.props.accessibilityElementsHidden===false)?.props.pointerEvents,'auto');
  await act(async()=>tree.unmount());tree=undefined;ctx.injections=[];
  await act(async()=>{tree=Renderer.create(React.createElement(App));await Promise.resolve();});
  await act(async()=>web(tree).props.onLoadEnd());
  assert.match(ctx.injections.at(-1),/new\.example/,'restart must restore the saved binding');
 }finally{if(tree)await act(async()=>tree.unmount());delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('waiting requests computer confirmation without depending on a code',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let serial=0,stored=null;
 const ctx={injections:[],uuid:()=>`name-${++serial}`,read:async()=>stored,write:async value=>{stored=value;},remove:async()=>{stored=null;}};
 globalThis.__rebindTest=ctx;globalThis.__rebindDeviceName='测试手机';let tree;
 try{
  await act(async()=>{tree=Renderer.create(React.createElement(App));await Promise.resolve();});
  await act(async()=>web(tree).props.onLoadEnd());
  await act(async()=>press(tree,'开始扫码'));
  await act(async()=>tree.root.findByType('CameraView').props.onBarcodeScanned({data:qr}));
  assert.match(ctx.injections.at(-1),/测试手机/);
  await act(async()=>credential(tree,ctx));
  await act(async()=>send(tree,ctx,{type:'connection-status',code:'pending'}));
  assert.match(text(tree),/请在电脑确认绑定/);assert.doesNotMatch(text(tree),/核对码|未提供/);
 }finally{if(tree)await act(async()=>tree.unmount());delete globalThis.__rebindDeviceName;delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('iOS scanner requests system permission from the scan action before opening the scanner',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let reads=0,requests=0,resolvePermission,opening;
 const systemPrompt=new Promise(resolve=>{resolvePermission=resolve;});
 const ctx={injections:[],uuid:()=> 'ios-camera-request',read:async()=>null,camera:{initial:null,get:async()=>{reads++;return cameraUndetermined;},request:()=>{requests++;return systemPrompt;}}};
 globalThis.__rebindTest=ctx;let tree;
 try{
  await act(async()=>{tree=Renderer.create(React.createElement(App));});
  assert.equal(requests,0,'launch must not request camera access');
  await act(async()=>{opening=press(tree,'开始扫码');press(tree,'开始扫码');});
  assert.equal(reads,1,'rapid taps share a single native permission check');
  assert.equal(requests,1,'the scan action must trigger one native request');
  assert.equal(tree.root.findAllByType('NativeModal').length,0,'no app permission screen before the system decision');
  await act(async()=>{resolvePermission(cameraGranted);await opening;});
  assert.equal(tree.root.findAllByType('CameraView').length,1);
 }finally{if(tree)await act(async()=>tree.unmount());delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('iOS scanner can exit after denial or resume from Settings without requesting again',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let current=cameraUndetermined,requests=0,settingsAttempts=0,settingsUnavailable=true;
 const alerts=[];
 const ctx={injections:[],uuid:()=> 'ios-camera-denied',read:async()=>null,alerts,
  openSettings:async()=>{settingsAttempts++;if(settingsUnavailable)throw Error('Unable to open app settings');},
  camera:{initial:current,get:async()=>current,request:async()=>{requests++;return current=cameraDenied;}}};
 globalThis.__rebindTest=ctx;let tree;
 try{
  await act(async()=>{tree=Renderer.create(React.createElement(App));});
  await act(async()=>press(tree,'开始扫码'));
  assert.equal(requests,1);
  assert.equal(tree.root.findAllByType('CameraView').length,0);
  assert.doesNotMatch(text(tree),/允许使用相机/);
  assert.equal(settingsAttempts,0,'denial must not open Settings automatically');
  await act(async()=>press(tree,'去设置开启'));
  assert.match(alerts[0]?.[0]??'',/无法打开设置/);
  await act(async()=>press(tree,'取消'));
  assert.equal(tree.root.findAllByType('NativeModal').length,0);
  await act(async()=>press(tree,'开始扫码'));
  assert.equal(requests,1,'denied permission must not trigger another request');
  settingsUnavailable=false;
  await act(async()=>press(tree,'去设置开启'));
  assert.equal(settingsAttempts,2);
  await act(async()=>ctx.foreground('active'));
  assert.equal(tree.root.findAllByType('CameraView').length,0,'returning without granting must keep the camera closed');
  current=cameraGranted;
  await act(async()=>ctx.foreground('active'));
  assert.equal(tree.root.findAllByType('CameraView').length,1);
  assert.equal(requests,1);
 }finally{if(tree)await act(async()=>tree.unmount());delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('Android scanner still waits for its in-app permission action',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let requests=0;
 const ctx={platform:'android',injections:[],uuid:()=> 'android-camera',read:async()=>null,camera:{initial:cameraUndetermined,request:async()=>{requests++;return cameraGranted;}}};
 globalThis.__rebindTest=ctx;let tree;
 try{
  await act(async()=>{tree=Renderer.create(React.createElement(App));});
  await act(async()=>press(tree,'开始扫码'));
  assert.equal(requests,0);
  await act(async()=>press(tree,'允许使用相机'));
  assert.equal(requests,1);
  assert.equal(tree.root.findAllByType('CameraView').length,1);
 }finally{if(tree)await act(async()=>tree.unmount());delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('chat scanner bridge opens only for the current local page and preserves the binding on cancel',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let stored=JSON.stringify(old);
 const ctx={injections:[],uuid:()=> 'scan-bridge-test',read:async()=>stored,write:async value=>{stored=value;},remove:async()=>{stored=null;}};
 globalThis.__rebindTest=ctx;let tree;
 try{
  tree=await boot(ctx);
  assert.doesNotMatch(text(tree),/Homer\n重新扫码/,'chat should not have a second native toolbar');
  await act(async()=>web(tree).props.onMessage({nativeEvent:{url:'https://foreign.example/',data:JSON.stringify({type:'open-scanner',nonce:token(ctx)})}}));
  await act(async()=>send(tree,ctx,{type:'open-scanner'},'stale-nonce'));
  assert.equal(tree.root.findAllByType('NativeModal').length,0);
  await act(async()=>send(tree,ctx,{type:'open-scanner'}));
  assert.equal(tree.root.findAllByType('CameraView').length,1);
  await act(async()=>press(tree,'取消'));
  assert.equal(tree.root.findAllByType('NativeModal').length,0);
  assert.deepEqual(JSON.parse(stored),old);
 }finally{if(tree)await act(async()=>tree.unmount());delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('failed chat page retains the native scanner recovery action',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;let stored=JSON.stringify(old);
 const ctx={injections:[],uuid:()=> 'page-error-test',read:async()=>stored,write:async value=>{stored=value;},remove:async()=>{stored=null;}};
 globalThis.__rebindTest=ctx;let tree;
 try{tree=await boot(ctx);await act(async()=>web(tree).props.onError());assert.match(text(tree),/聊天页面加载失败/);await act(async()=>press(tree,'重新扫码'));assert.equal(tree.root.findAllByType('CameraView').length,1);await act(async()=>press(tree,'取消'));assert.deepEqual(JSON.parse(stored),old);}
 finally{if(tree)await act(async()=>tree.unmount());delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

for(const event of ['onContentProcessDidTerminate','onRenderProcessGone'])test(`chat recovers when ${event} is reported`,async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;let stored=JSON.stringify(old);
 const ctx={injections:[],uuid:()=> 'renderer-error-test',read:async()=>stored,write:async value=>{stored=value;},remove:async()=>{stored=null;}};
 globalThis.__rebindTest=ctx;let tree;
 try{
  tree=await boot(ctx);const previous=web(tree);
  await act(async()=>previous.props[event]({nativeEvent:{}}));
  assert.match(text(tree),/聊天页面加载失败/);
  await act(async()=>press(tree,'重新扫码'));assert.equal(tree.root.findAllByType('CameraView').length,1);
  await act(async()=>press(tree,'取消'));assert.deepEqual(JSON.parse(stored),old);
  await act(async()=>press(tree,'重试'));assert.notEqual(web(tree),previous);
  await act(async()=>web(tree).props.onLoadStart());await act(async()=>web(tree).props.onLoadEnd());
  assert.doesNotMatch(text(tree),/聊天页面加载失败|Homer\n重新扫码/);
 }finally{if(tree)await act(async()=>tree.unmount());delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

test('scanning after the chat process exits reloads the page before connecting the new binding',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;let stored=JSON.stringify(old);
 const ctx={injections:[],uuid:()=> 'scan-after-renderer-error',read:async()=>stored,write:async value=>{stored=value;},remove:async()=>{stored=null;}};
 globalThis.__rebindTest=ctx;let tree;
 try{
  tree=await boot(ctx);const previous=web(tree),injections=ctx.injections.length;
  await act(async()=>previous.props.onRenderProcessGone({nativeEvent:{}}));
  await act(async()=>press(tree,'重新扫码'));
  await act(async()=>tree.root.findByType('CameraView').props.onBarcodeScanned({data:qr}));
  assert.notEqual(web(tree),previous,'a terminated WebView must be recreated');
  assert.equal(ctx.injections.length,injections,'wait for the replacement page to load');
  await act(async()=>web(tree).props.onLoadStart());await act(async()=>web(tree).props.onLoadEnd());
  assert.match(ctx.injections.at(-1),new RegExp(next.routeId));
  assert.deepEqual(JSON.parse(stored),old,'the old binding remains until approval');
 }finally{if(tree)await act(async()=>tree.unmount());delete globalThis.__rebindTest;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});


test('privacy stays available before pairing, in scanner and after a chat page failure without changing binding',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.__DEV__=true;
 let serial=0,fail=false;const opened=[],alerts=[],writes=[];
 const ctx={injections:[],uuid:()=>`privacy-${++serial}`,read:async()=>null,write:async value=>writes.push(value),alerts,openURL:async url=>{opened.push(url);if(fail)throw Error('offline');}};
 globalThis.__rebindTest=ctx;let tree;
 try{
  await act(async()=>{tree=Renderer.create(React.createElement(createApp()));await Promise.resolve();});
  assert.match(text(tree),/连接你的电脑/);
  await act(async()=>web(tree).props.onLoadEnd());
  await act(async()=>send(tree,ctx,{type:'open-privacy'}));
  assert.equal(opened.length,0,'the chat bridge cannot open privacy before pairing');
  await act(async()=>press(tree,'隐私政策'));
  assert.deepEqual(opened,['https://super-tree.com/homer/privacy']);
  await act(async()=>press(tree,'开始扫码'));
  const modal=tree.root.findByType('NativeModal');
  const link=modal.findAllByType('Pressable').find(n=>n.props.accessibilityRole==='link');assert.ok(link);
  await act(async()=>link.props.onPress());
  assert.deepEqual(opened,['https://super-tree.com/homer/privacy','https://super-tree.com/homer/privacy']);
  await act(async()=>press(tree,'取消'));
  assert.equal(writes.length,0);
  fail=true;await act(async()=>press(tree,'隐私政策'));
  assert.equal(alerts.length,1);assert.match(alerts[0][0],/隐私政策/);
  assert.match(text(tree),/连接你的电脑/);assert.equal(writes.length,0);
  await act(async()=>tree.unmount());tree=undefined;
  ctx.read=async()=>JSON.stringify(old);fail=false;
  tree=await boot(ctx,createApp());
  assert.doesNotMatch(text(tree),/隐私政策/,'a working chat has no privacy footer');
  await act(async()=>send(tree,ctx,{type:'connection-status',code:'unavailable'}));
  assert.doesNotMatch(text(tree),/隐私政策/,'a previously connected chat keeps its footer hidden during reconnect');
  const before=opened.length;
  await act(async()=>send(tree,ctx,{type:'open-privacy'},'stale'));
  await act(async()=>web(tree).props.onMessage({nativeEvent:{url:'https://foreign.example/',data:JSON.stringify({type:'open-privacy',nonce:token(ctx)})}}));
  assert.equal(opened.length,before,'stale or foreign pages cannot open privacy');
  await act(async()=>send(tree,ctx,{type:'open-privacy',url:'https://foreign.example/'}));
  assert.equal(opened.length,before+1);assert.equal(opened.at(-1),'https://super-tree.com/homer/privacy');assert.equal(writes.length,0);
  fail=true;await act(async()=>send(tree,ctx,{type:'open-privacy'}));assert.equal(alerts.length,2);fail=false;
  await act(async()=>web(tree).props.onError());
  await act(async()=>press(tree,'隐私政策'));
  assert.equal(opened.at(-1),'https://super-tree.com/homer/privacy');assert.equal(writes.length,0);
  assert.equal(tree.root.findAllByType('WebView').length,1);
 }finally{if(tree)await act(async()=>tree.unmount());delete globalThis.__rebindTest;delete globalThis.__DEV__;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});
