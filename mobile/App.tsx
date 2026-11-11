import {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,AppState,Image,Linking,Modal,PermissionsAndroid,Platform,Pressable,StatusBar,StyleSheet,Text,View} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {CameraView,useCameraPermissions} from 'expo-camera';
import * as SecureStore from 'expo-secure-store';
import {randomUUID} from 'expo-crypto';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import {requireOptionalNativeModule} from 'expo';
import {availableUpdate,downloadPage,fetchRelease,releaseEnabled,type MobileUpdate,type ReleaseIdentity} from './update.mjs';
import chatHtml from './.generated/chat.mjs';
import {File,Paths} from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {WebView} from 'react-native-webview';
import {navigation,pairingAddress,savedPairing,downloadMessage,connectionScreen,LOCAL_ORIGIN,type Pairing,type ConnectionStatus} from './connection.mjs';
import {localNetworkAccess} from './local-network.mjs';

const storageKey='homer.mobile-pairing';
const cancelKey='homer.mobile-cancel';
const source={html:chatHtml,baseUrl:LOCAL_ORIGIN+'/'};
const updateKey=()=>`homer.mobile-update-dismissed.stable.${Platform.OS}`;
let startupUpdate:Promise<MobileUpdate|null>|undefined;
async function checkForUpdate():Promise<MobileUpdate|null>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const local:ReleaseIdentity={platform:Platform.OS,channel:process.env.EXPO_PUBLIC_HOMER_RELEASE_CHANNEL,development:__DEV__,applicationId:Application.applicationId,version:Application.nativeApplicationVersion,build:Application.nativeBuildVersion};
  if(local.channel!=='stable'||local.development||local.applicationId!=='com.homer.mobile'||!['android','ios'].includes(local.platform))return null;
  if(Platform.OS==='ios'){
   const metadata=await Promise.race([
    Promise.all([Application.getAppleStoreEnvironmentAsync(),requireOptionalNativeModule<{current:()=>Promise<string|null>}>('HomerStorefront')?.current()]),
    new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('storefront_timeout')),5000);}),
   ]);
   local.storeEnvironment=metadata[0];local.storefront=metadata[1];local.osVersion=String(Platform.Version);
  }else{local.apiLevel=Number(Platform.Version);local.abis=Device.supportedCpuArchitectures;}
  if(!releaseEnabled(local))return null;
  const dismissed=await SecureStore.getItemAsync(updateKey());
  return availableUpdate(await fetchRelease(),local,dismissed);
 }catch{return null;}finally{clearTimeout(timer);}
}
export default function App(){return <SafeAreaProvider><StatusBar barStyle="dark-content"/><Client/></SafeAreaProvider>;}
function Client(){
 const [uri]=useState(LOCAL_ORIGIN+'/'),[loading,setLoading]=useState(true),[webFailed,setWebFailed]=useState(false),[scanning,setScanning]=useState(false),[scanError,setScanError]=useState(false),[error,setError]=useState(''),[page,setPage]=useState(0);
 const [status,setStatus]=useState<ConnectionStatus>('restoring'),[wasConnected,setWasConnected]=useState(false),[canRestore,setCanRestore]=useState(false);
 const [update,setUpdate]=useState<MobileUpdate|null>(null),[openError,setOpenError]=useState(false),[updateBusy,setUpdateBusy]=useState(false),[pickerBusy,setPickerBusy]=useState(false);
 const [permission,requestPermission,getPermission]=useCameraPermissions();
 const requestingCamera=useRef(false);
 const isIOS=Platform.OS==='ios',cameraSettings=isIOS||permission?.canAskAgain===false;
 const web=useRef<WebView<object>>(null),scanLock=useRef(false),active=useRef(true),sharing=useRef(false),binding=useRef<Pairing|undefined>(undefined),savedBinding=useRef<Pairing|undefined>(undefined),replacing=useRef(false),saving=useRef(false),saveFailed=useRef(false),cancelRequested=useRef(false),cancelPreparing=useRef(false),cancelFinishing=useRef(false),cancelTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),initialSave=useRef<Promise<boolean>|undefined>(undefined),statusDuringSave=useRef<ConnectionStatus>('active'),bindingReady=useRef(false),loaded=useRef(false),nonce=useRef(randomUUID()),writes=useRef(Promise.resolve());
 const updateVisible=!!update&&!scanning&&!updateBusy&&!pickerBusy&&!['restoring','pending','saving','save-error','cancelling','cancel-error','cancel-approved','cancel-manual'].includes(status)&&!replacing.current;
 const updateSnapshot=updateVisible?{version:update!.version,openError}:null;
 const snapshot=useRef(updateSnapshot);snapshot.current=updateSnapshot;
 function syncUpdate(){if(loaded.current)web.current?.injectJavaScript('window.__homerMobileNonce='+JSON.stringify(nonce.current)+';window.__homerMobileUpdate='+JSON.stringify(snapshot.current)+';window.dispatchEvent(new Event("homer-mobile-update"));true;');}
 function connect(){if(!loaded.current||!bindingReady.current)return;web.current?.injectJavaScript('window.__homerMobileNonce='+JSON.stringify(nonce.current)+';window.dispatchEvent(new CustomEvent("homer-mobile-connect",{detail:'+JSON.stringify(binding.current?.invitation?{...binding.current,deviceName:Device.deviceName}:binding.current??null)+'}));true;');syncUpdate();}
 async function dismissUpdate(){
  if(!updateVisible||!update)return;const dismissed=update;setUpdate(null);startupUpdate=Promise.resolve(null);
  try{await SecureStore.setItemAsync(updateKey(),dismissed.identifier);}catch{/* This launch stays dismissed; a failed write cannot promise cross-launch deduplication. */}
 }
 async function openUpdate(){if(!updateVisible)return;try{await Linking.openURL(downloadPage);if(active.current)setOpenError(false);}catch{if(active.current)setOpenError(true);}}
 useEffect(()=>{syncUpdate();},[updateVisible,update?.version,openError]);
 function restorePrevious(){
  if(saving.current||!savedBinding.current)return;
  if(cancelTimer.current)clearTimeout(cancelTimer.current);cancelTimer.current=undefined;cancelRequested.current=false;
  binding.current=savedBinding.current;replacing.current=false;saveFailed.current=false;initialSave.current=undefined;setCanRestore(false);nonce.current=randomUUID();setError('');setStatus('connecting');connect();
 }
 async function finishCancellation(){
  if(cancelFinishing.current)return;cancelFinishing.current=true;const attempt=nonce.current;
  try{await SecureStore.deleteItemAsync(cancelKey);if(active.current&&attempt===nonce.current)restorePrevious();}
  catch{if(active.current&&attempt===nonce.current)setStatus('cancel-error');}
  finally{cancelFinishing.current=false;}
 }
 async function cancelReplacement(){
  if(saving.current||cancelPreparing.current||!savedBinding.current)return;
  if(['denied','invitation-expired','approval-timeout'].includes(status)){restorePrevious();return;}
  if(!binding.current?.credential){
   cancelRequested.current=true;setStatus('cancel-manual');return;
  }
  cancelRequested.current=true;setStatus('cancelling');
  const attempt=nonce.current;cancelPreparing.current=true;
  try{await SecureStore.setItemAsync(cancelKey,JSON.stringify(binding.current));}
  catch{if(active.current&&attempt===nonce.current)setStatus('cancel-error');return;}
  finally{cancelPreparing.current=false;}
  if(!active.current||attempt!==nonce.current||!cancelRequested.current)return;
  if(cancelTimer.current)clearTimeout(cancelTimer.current);
  cancelTimer.current=setTimeout(()=>{if(active.current&&attempt===nonce.current&&cancelRequested.current)setStatus('cancel-error');},18000);
  web.current?.injectJavaScript('window.dispatchEvent(new CustomEvent("homer-mobile-cancel"));true;');
 }
 async function saveApproved(retry=false){
  if(saving.current)return;
  const next=binding.current,attempt=nonce.current;if(!next?.credential){saveFailed.current=true;setStatus('save-error');return;}
  saving.current=true;setStatus('saving');
  try{
   if(!retry&&initialSave.current){if(!await initialSave.current)throw Error('save_failed');}
   else{const write=writes.current.then(()=>SecureStore.setItemAsync(storageKey,JSON.stringify(next)));writes.current=write.catch(()=>{});await write;}
   if(active.current&&attempt===nonce.current){savedBinding.current=next;replacing.current=false;saveFailed.current=false;initialSave.current=undefined;setCanRestore(false);setStatus(statusDuringSave.current);setWasConnected(true);}
  }catch{if(active.current&&attempt===nonce.current){saveFailed.current=true;setStatus('save-error');}}finally{saving.current=false;}
 }
 function openPrivacy(){void Linking.openURL('https://super-tree.com/homer/privacy').catch(()=>Alert.alert('无法打开隐私政策','请检查网络后重试。'));}
 async function openCameraSettings(){
  try{await Linking.openSettings();}
  catch{if(active.current)Alert.alert('无法打开设置','请在系统设置中找到 Homer，检查相机权限。');}
 }
 async function message(data:string,url:string){
  try{
   if(data.length>12*1024*1024||navigation(url,LOCAL_ORIGIN)!=='internal')return;
   const item=JSON.parse(data);
   // The local module can become ready after WKWebView's load-end event.
   if(item.type==='ready'){connect();return;}
   if(item.nonce!==nonce.current)return;
   if(item.type==='update-busy'&&typeof item.busy==='boolean'){setPickerBusy(item.busy);return;}
   if(item.type==='update-dismiss'){void dismissUpdate();return;}
   if(item.type==='update-open'){void openUpdate();return;}
   if(item.type==='open-scanner'&&connectionScreen(status,wasConnected)==='chat'){void beginScan();return;}
   if(item.type==='open-privacy'&&connectionScreen(status,wasConnected)==='chat'){openPrivacy();return;}
   if(item.type==='cancel-result'&&cancelRequested.current){
    if(cancelTimer.current)clearTimeout(cancelTimer.current);cancelTimer.current=undefined;
    if(item.result==='cancelled'||item.result==='absent')void finishCancellation();
    else if(item.result==='approved')setStatus('cancel-approved');
    else setStatus('cancel-error');
    return;
   }
   if(item.type==='credential'&&binding.current&&item.routeId===binding.current.routeId){
    const next=savedPairing(JSON.stringify({signalOrigin:binding.current.signalOrigin,routeId:item.routeId,credential:item.credential}));binding.current=next;
    if(!replacing.current){const attempt=nonce.current;const write=writes.current.then(async()=>{if(binding.current!==next)return false;await SecureStore.setItemAsync(storageKey,JSON.stringify(next));if(active.current&&attempt===nonce.current)savedBinding.current=next;return true;});initialSave.current=write.catch(()=>false);writes.current=initialSave.current.then(()=>{});await initialSave.current;}return;
   }
   if(item.type==='connection-status'){
    const codes:ConnectionStatus[]=['scan','connecting','pending','active','denied','version','unavailable','invitation-expired','approval-timeout','pairing-busy'];
    if(!bindingReady.current||!codes.includes(item.code))return;
    if(cancelRequested.current)return;
    if(saving.current||saveFailed.current){statusDuringSave.current=item.code;return;}
    if(item.code==='active'&&(replacing.current||savedBinding.current!==binding.current)){statusDuringSave.current='active';void saveApproved();return;}
    else{setStatus(item.code);if(item.code==='active')setWasConnected(true);}return;
   }
   if(item.type==='share-file')await share(data,url);
  }catch{setError('无法读取主端配对信息，请重新扫码。');}
 }
 async function restore(){
  try{const value=await SecureStore.getItemAsync(storageKey),cancel=await SecureStore.getItemAsync(cancelKey);if(!active.current)return;
   savedBinding.current=value?savedPairing(value):undefined;
   if(cancel){if(!savedBinding.current)throw Error('cancel_previous_missing');binding.current=savedPairing(cancel);replacing.current=true;cancelRequested.current=true;setCanRestore(true);setStatus('cancel-error');}
   else{binding.current=savedBinding.current;setStatus(value?'connecting':'scan');}
   bindingReady.current=true;connect();}
  catch{if(active.current)setStatus('restore-error');}
 }
 useEffect(()=>{
  active.current=true;
  startupUpdate??=checkForUpdate();void startupUpdate.then(value=>{if(active.current)setUpdate(value);});
  void (async()=>{
   if(!await localNetworkAccess(Platform,PermissionsAndroid)&&active.current)Alert.alert('需要本地网络权限','连接同一 Wi-Fi 下的电脑需要此权限。你可以在系统设置中允许 Homer 访问本地网络。',[{text:'稍后'},{text:'打开设置',onPress:()=>void Linking.openSettings()}]);
   await restore();
  })().catch(()=>{if(active.current)setStatus('restore-error');}).finally(()=>{if(active.current)setLoading(false);});
  const subscription=AppState.addEventListener('change',state=>{if(state==='active'){void getPermission().catch(()=>{});web.current?.injectJavaScript("document.dispatchEvent(new Event('visibilitychange'));true;");}});
  return()=>{active.current=false;if(cancelTimer.current)clearTimeout(cancelTimer.current);subscription.remove();};
 },[]);
 async function scanned(data:string){
  if(scanLock.current)return;scanLock.current=true;
  let address:Pairing;
  try{address=pairingAddress(data);}catch{setScanError(true);return;}
  binding.current=address;replacing.current=!!savedBinding.current;saveFailed.current=false;cancelRequested.current=false;initialSave.current=undefined;setCanRestore(replacing.current);nonce.current=randomUUID();
  setError('');setWasConnected(false);setStatus('connecting');setScanning(false);if(webFailed)setPage(value=>value+1);else connect();
 }
 async function share(data:string,url:string){
  if(sharing.current)return;sharing.current=true;setUpdateBusy(true);let file:File|undefined;
  try{
   const input=downloadMessage(data,LOCAL_ORIGIN,url);
   if(!await Sharing.isAvailableAsync())throw Error('sharing_unavailable');
   file=new File(Paths.cache,Date.now()+'-'+input.filename);await file.write(input.base64,{encoding:'base64'});
   await Sharing.shareAsync(file.uri,{dialogTitle:input.filename});
  }catch{Alert.alert('文件未能打开','请重新连接主端后重试。');}
  finally{try{if(file?.exists)await file.delete();}catch{/* Cache cleanup cannot block the next explicit download. */}sharing.current=false;if(active.current)setUpdateBusy(false);}
 }
 const button=(text:string,onPress:()=>void)=><Pressable accessibilityRole="button" onPress={onPress} style={styles.button}><Text style={styles.buttonText}>{text}</Text></Pressable>;
 const primary=(text:string,onPress:()=>void)=><Pressable accessibilityRole="button" onPress={onPress} style={styles.primary}><Text style={styles.primaryText}>{text}</Text></Pressable>;
 const beginScan=async()=>{
  if(isIOS){
   if(requestingCamera.current)return;
   requestingCamera.current=true;
   try{
    const current=await getPermission();
    if(!active.current)return;
    if(!current.granted&&current.canAskAgain)await requestPermission();
   }catch{
    if(active.current)Alert.alert('无法请求相机权限','请重试，或在系统设置中检查相机权限。');
    return;
   }finally{requestingCamera.current=false;}
   if(!active.current)return;
  }
  scanLock.current=false;setScanError(false);setScanning(true);
 };
 const failChatPage=()=>{loaded.current=false;setLoading(false);setWebFailed(true);setError('聊天页面加载失败，请重试。');};
 const privacyLink=<Pressable accessibilityRole="link" onPress={openPrivacy} style={styles.privacyLink}><Text style={styles.privacyText}>隐私政策</Text></Pressable>;
 const screen=connectionScreen(status,wasConnected);
 const chatNotice:Partial<Record<ConnectionStatus,string>>={connecting:'正在连接电脑…',pending:'请在电脑确认绑定这台设备。',denied:'设备未获批准或已停用，请在电脑检查设备状态。',version:'App 与电脑版本不匹配，请更新后重试。',unavailable:'暂时无法连接电脑，正在自动重试。','invitation-expired':'二维码已失效，请在电脑重新生成后扫码。','approval-timeout':'等待确认已超时，请在电脑重新生成二维码后扫码。','pairing-busy':'已有待确认请求，请在电脑处理后重新生成二维码并扫码。'};
 return <SafeAreaView style={styles.page} edges={['top','bottom','left','right']}>
  {(screen!=='chat'||webFailed)&&<View style={styles.toolbar}><View style={styles.brand}>{screen!=='chat'&&<Image source={require('../assets/branding/odysseus-20261030/homer-odysseus-64.png')} accessible={false} style={styles.brandImage}/>}<Text style={styles.title}>Homer</Text></View>{screen==='chat'&&<Pressable accessibilityRole="button" onPress={beginScan} style={({pressed})=>[styles.scanButton,pressed&&styles.scanButtonPressed]}><Text style={styles.scanButtonText}>重新扫码</Text></Pressable>}</View>}
  {(screen!=='chat'||webFailed)&&updateVisible&&<View style={styles.updateNotice}><View style={styles.updateRow}><Text style={styles.updateText}>有新版本 {update!.version}</Text><Pressable accessibilityRole="link" onPress={()=>void openUpdate()} style={styles.button}><Text style={styles.buttonText}>前往更新</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="关闭更新提示" onPress={()=>void dismissUpdate()} style={styles.updateClose}><Text style={styles.buttonText}>×</Text></Pressable></View>{openError&&<Text accessibilityLiveRegion="polite" style={styles.updateError}>未能打开下载页，请重试。</Text>}</View>}
  <View style={styles.web}>
   <View style={[styles.web,screen!=='chat'&&styles.hiddenWeb]} pointerEvents={screen==='chat'?'auto':'none'} accessibilityElementsHidden={screen!=='chat'} importantForAccessibility={screen==='chat'?'auto':'no-hide-descendants'}>
   <WebView<object> key={page} ref={web} source={source} style={styles.web} originWhitelist={['*']} incognito={false} cacheEnabled={false} thirdPartyCookiesEnabled={false} sharedCookiesEnabled={false} setSupportMultipleWindows={false}
    onShouldStartLoadWithRequest={request=>{const route=navigation(request.url,LOCAL_ORIGIN,request.isTopFrame!==false);if(route==='external')void Linking.openURL(request.url).catch(()=>setError('无法打开外部链接。'));return route==='internal';}}
    onMessage={({nativeEvent})=>void message(nativeEvent.data,nativeEvent.url)}
    onOpenWindow={({nativeEvent})=>{const route=navigation(nativeEvent.targetUrl,LOCAL_ORIGIN);if(route==='external')void Linking.openURL(nativeEvent.targetUrl).catch(()=>setError('无法打开外部链接。'));else if(route==='internal')web.current?.injectJavaScript('location.assign('+JSON.stringify(nativeEvent.targetUrl)+');true;');}}
    onLoadStart={()=>{loaded.current=false;setPickerBusy(false);setLoading(true);setWebFailed(false);}} onLoadEnd={()=>{loaded.current=true;setLoading(false);connect();}}
    onError={failChatPage} onContentProcessDidTerminate={failChatPage} onRenderProcessGone={failChatPage}
    onHttpError={event=>{if(event.nativeEvent.url===uri&&event.nativeEvent.statusCode>=400){setWebFailed(true);setError('主端暂不可用，请稍后重试。');}}}
   />
   {loading&&<ActivityIndicator style={styles.progress}/>}
   </View>
   {screen==='loading'&&<ActivityIndicator style={styles.center}/>}
   {screen==='welcome'&&<View style={styles.flow}><Text accessibilityRole="header" style={styles.heading}>连接你的电脑</Text><Text style={styles.description}>还没有绑定电脑，扫码连接后即可使用 Homer。</Text><View style={styles.bottomAction}>{primary('开始扫码',beginScan)}</View></View>}
   {screen==='connecting'&&<View style={styles.flow}><Text accessibilityRole="header" style={styles.heading}>正在连接电脑</Text><Text style={styles.description}>请保持电脑上的 Homer 运行。</Text><View style={styles.stateBox}><ActivityIndicator size="small" color="#30302e"/><Text style={styles.stateText}>正在连接</Text></View></View>}
   {screen==='pending'&&<View style={styles.flow}><Text style={styles.eyebrow}>已扫码 · 还差一步</Text><Text accessibilityRole="header" style={styles.heading}>请在电脑确认绑定</Text><Text style={styles.description}>请在电脑上查看设备名称并确认绑定。</Text><View style={styles.stateBox}><ActivityIndicator size="small" color="#30302e"/><Text style={styles.stateText}>正在等待电脑确认</Text></View>{button('重新扫码',beginScan)}</View>}
   {screen==='denied'&&<View style={styles.flow}><Text accessibilityRole="header" style={styles.heading}>设备未获批准或已停用</Text><Text style={styles.description}>请在电脑的「设置 → 移动设备」中检查设备状态，或重新生成二维码后扫码。</Text>{primary('重新扫码',beginScan)}</View>}
   {screen==='invitation-expired'&&<View style={styles.flow}><Text accessibilityRole="header" style={styles.heading}>二维码已失效</Text><Text style={styles.description}>请在电脑的「设置 → 移动设备」中重新生成二维码，然后扫码。</Text>{primary('重新扫码',beginScan)}</View>}
   {screen==='approval-timeout'&&<View style={styles.flow}><Text accessibilityRole="header" style={styles.heading}>等待确认已超时</Text><Text style={styles.description}>请在电脑的「设置 → 移动设备」中重新生成二维码，然后扫码。</Text>{primary('重新扫码',beginScan)}</View>}
   {screen==='pairing-busy'&&<View style={styles.flow}><Text accessibilityRole="header" style={styles.heading}>已有待确认请求</Text><Text style={styles.description}>请在电脑的「设置 → 移动设备」中处理已有请求，或重新生成二维码。要连接这台手机，请扫描新的二维码。</Text>{primary('重新扫码',beginScan)}</View>}
   {screen==='unavailable'&&<View style={styles.flow}><Text accessibilityRole="header" style={styles.heading}>暂时无法连接电脑</Text><Text style={styles.description}>请确认电脑上的 Homer 正在运行，并检查手机和电脑的网络。</Text><View style={styles.stateBox}><ActivityIndicator size="small" color="#30302e"/><Text style={styles.stateText}>正在自动重试</Text></View><View style={styles.bottomAction}><Pressable accessibilityRole="button" onPress={beginScan} style={styles.secondary}><Text style={styles.secondaryText}>重新扫码</Text></Pressable></View></View>}
   {screen==='version'&&<View style={styles.flow}><Text accessibilityRole="header" style={styles.heading}>版本不匹配</Text><Text style={styles.description}>App 与电脑上的 Homer 版本不匹配，请更新后重试。</Text>{button('重新扫码',beginScan)}</View>}
   {screen==='saving'&&<View style={styles.flow}><Text accessibilityRole="header" style={styles.heading}>正在保存连接</Text><Text style={styles.description}>电脑已确认，请稍候。</Text><ActivityIndicator size="small" color="#30302e"/></View>}
   {screen==='save-error'&&<View style={styles.flow}><Text accessibilityRole="header" style={styles.heading}>连接信息未能保存</Text><Text style={styles.description}>请重试保存，成功后即可继续。{canRestore?'也可以返回原连接。':''}</Text>{primary('重新保存',()=>void saveApproved(true))}</View>}
   {screen==='cancelling'&&<View style={styles.flow}><Text accessibilityRole="header" style={styles.heading}>正在取消绑定</Text><Text style={styles.description}>正在等待新电脑确认，请稍候。</Text><ActivityIndicator size="small" color="#30302e"/></View>}
   {screen==='cancel-error'&&<View style={styles.flow}><Text accessibilityRole="header" style={styles.heading}>未能确认取消</Text><Text style={styles.description}>请保持新电脑上的 Homer 运行并重试；也可以先在电脑的「移动设备」中拒绝请求或重新生成二维码。</Text>{primary('重试取消',()=>void cancelReplacement())}{button('我已在电脑处理，返回原连接',()=>void finishCancellation())}</View>}
   {screen==='cancel-approved'&&<View style={styles.flow}><Text accessibilityRole="header" style={styles.heading}>电脑已确认绑定</Text><Text style={styles.description}>请先在新电脑的「移动设备」中删除这次绑定，再重试取消。</Text>{primary('重试取消',()=>void cancelReplacement())}</View>}
   {screen==='cancel-manual'&&<View style={styles.flow}><Text accessibilityRole="header" style={styles.heading}>请先在电脑处理请求</Text><Text style={styles.description}>无法确认请求是否已提交。请在新电脑的「移动设备」中拒绝待确认请求或重新生成二维码。</Text>{primary('我已在电脑处理，返回原连接',()=>void finishCancellation())}</View>}
   {screen==='restore-error'&&<View style={styles.flow}><Text accessibilityRole="header" style={styles.heading}>无法读取连接信息</Text><Text style={styles.description}>请重试，或重新打开 App。</Text>{primary('重试',()=>{setStatus('restoring');void restore();})}</View>}
   {canRestore&&!['saving','cancelling','cancel-error','cancel-approved','cancel-manual'].includes(screen)&&button('返回原连接',()=>void cancelReplacement())}
  </View>
  {screen==='chat'&&!!chatNotice[status]&&<View style={styles.notice}><Text accessibilityRole="alert" style={styles.message}>{chatNotice[status]}</Text></View>}
  {!!error&&<View style={styles.notice}><Text accessibilityRole="alert" style={styles.message}>{error}</Text>{button('重试',()=>{loaded.current=false;setError('');setPage(value=>value+1);})}</View>}
  {(screen!=='chat'||webFailed)&&privacyLink}
  <Modal visible={scanning} animationType="slide" onRequestClose={()=>{if(uri)setScanning(false);}}>
   <SafeAreaProvider>
   <SafeAreaView style={styles.page}>
    <View style={styles.toolbar}><Text style={styles.title}>连接 Homer</Text>{button('取消',()=>setScanning(false))}</View>
    <Text style={styles.message}>在电脑打开「设置 → 移动设备」，点击「添加移动设备」，再扫描二维码。</Text>
    {scanError?<View style={styles.scanContent}><Text accessibilityRole="header" style={styles.scanHeading}>二维码无法识别</Text><Text style={styles.description}>请扫描电脑 Homer「移动设备」中生成的二维码。</Text>{primary('重新扫码',()=>{setScanError(false);scanLock.current=false;})}</View>:permission?.granted?<View style={styles.cameraContainer}><CameraView style={styles.camera} facing="back" barcodeScannerSettings={{barcodeTypes:['qr']}} onBarcodeScanned={({data})=>void scanned(data)}/><View pointerEvents="none" style={styles.cameraFrame}/></View>:<View style={styles.scanContent}>
     <Text accessibilityRole="header" style={styles.scanHeading}>{cameraSettings?'相机权限未开启':'开启相机，扫描二维码'}</Text>
     <Text style={styles.description}>{cameraSettings?'请在设置中开启相机权限，返回后即可扫码。':'需要使用相机扫描电脑上的二维码。'}</Text>
     {cameraSettings?primary('去设置开启',openCameraSettings):primary('允许使用相机',()=>void requestPermission())}
    </View>}
    {privacyLink}
   </SafeAreaView>
   </SafeAreaProvider>
  </Modal>
 </SafeAreaView>;
}
const styles=StyleSheet.create({
 privacyLink:{minHeight:44,paddingHorizontal:16,alignItems:'center',justifyContent:'center'},privacyText:{fontSize:13,color:'#67645f',textDecorationLine:'underline'},
 updateNotice:{backgroundColor:"#eeece8",borderBottomWidth:StyleSheet.hairlineWidth,borderColor:"#dedbd5"},updateRow:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",paddingLeft:16},updateText:{fontSize:14,color:"#292825",flexGrow:1,flexShrink:1},updateClose:{minWidth:44,minHeight:44,alignItems:"center",justifyContent:"center"},updateError:{fontSize:14,color:"#67645f",paddingHorizontal:16,paddingBottom:10},
 scanButton:{minHeight:44,paddingHorizontal:12,borderWidth:1,borderColor:'#cbc7bf',borderRadius:10,backgroundColor:'#fff',justifyContent:'center',alignItems:'center'},scanButtonPressed:{backgroundColor:'#eeece8'},scanButtonText:{fontSize:15,color:'#30302e'},
 page:{flex:1,backgroundColor:'#f6f5f2'},web:{flex:1,backgroundColor:'#f6f5f2'},hiddenWeb:{position:'absolute',width:'100%',height:'100%',opacity:0},toolbar:{minHeight:48,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#dedbd5'},title:{fontSize:18,fontWeight:'600',color:'#292825'},brand:{flexDirection:'row',alignItems:'center',gap:7},brandImage:{width:24,height:24,resizeMode:'contain'},button:{minHeight:44,paddingHorizontal:14,justifyContent:'center',alignItems:'center',alignSelf:'flex-start'},buttonText:{fontSize:16,color:'#30302e'},primary:{minHeight:50,borderRadius:12,backgroundColor:'#30302e',justifyContent:'center',alignItems:'center',paddingHorizontal:16},primaryText:{fontSize:16,fontWeight:'600',color:'#fff'},secondary:{minHeight:50,borderRadius:12,borderWidth:1,borderColor:'#cbc7bf',justifyContent:'center',alignItems:'center'},secondaryText:{fontSize:16,fontWeight:'600',color:'#30302e'},center:{flex:1,alignItems:'center',justifyContent:'center',padding:24},message:{fontSize:16,lineHeight:24,color:'#292825',padding:16},notice:{borderTopWidth:StyleSheet.hairlineWidth,borderColor:'#dedbd5'},progress:{position:'absolute',top:8,alignSelf:'center'},flow:{flex:1,paddingHorizontal:24,paddingTop:48,paddingBottom:24},heading:{fontSize:26,lineHeight:34,fontWeight:'700',color:'#292825',marginBottom:12},description:{fontSize:16,lineHeight:25,color:'#67645f',marginBottom:24},eyebrow:{fontSize:14,fontWeight:'600',color:'#30302e',marginBottom:14},bottomAction:{marginTop:'auto'},stateBox:{minHeight:54,borderRadius:12,backgroundColor:'#eeece8',paddingHorizontal:16,flexDirection:'row',alignItems:'center',gap:12,marginBottom:18},stateText:{fontSize:15,fontWeight:'600',color:'#292825'},scanContent:{paddingHorizontal:24,paddingTop:42},scanHeading:{fontSize:23,lineHeight:30,fontWeight:'700',color:'#292825',marginBottom:8},cameraContainer:{marginHorizontal:24,marginTop:28,height:300,borderRadius:18,overflow:'hidden',alignItems:'center',justifyContent:'center'},camera:{width:'100%',height:'100%'},cameraFrame:{position:'absolute',width:170,height:170,borderWidth:2,borderColor:'#fff',borderRadius:18}
});
