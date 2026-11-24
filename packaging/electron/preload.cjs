const {contextBridge,ipcRenderer}=require('electron');

if(process.isMainFrame===true){
 contextBridge.exposeInMainWorld('homerBrowserPreview',{
  ...Object.fromEntries(['list','present','control','annotations','reply'].map(name=>[name,input=>ipcRenderer.invoke('homer:preview:'+name,input)])),
  locationGrants:()=>ipcRenderer.invoke('homer:preview:location-grants'),
  revokeLocation:key=>ipcRenderer.invoke('homer:preview:revoke-location',key),
  onChanged:callback=>{const listener=()=>callback();ipcRenderer.on('homer:preview:changed',listener);return()=>ipcRenderer.removeListener('homer:preview:changed',listener);},
  onAnnotation:callback=>{const listener=(_,value)=>callback(value);ipcRenderer.on('homer:preview:annotation',listener);return()=>ipcRenderer.removeListener('homer:preview:annotation',listener);},
  onShow:callback=>{const listener=(_,page,origin)=>callback(page,origin);ipcRenderer.on('homer:preview:show',listener);return()=>ipcRenderer.removeListener('homer:preview:show',listener);},
  onLink:callback=>{const listener=(_,link)=>callback(link);ipcRenderer.on('homer:preview:link',listener);return()=>ipcRenderer.removeListener('homer:preview:link',listener);},
 });
 if(process.platform==='darwin'||process.platform==='win32')contextBridge.exposeInMainWorld('homerDesktopCapture',{
  ...(process.platform==='win32'?{platform:'win32'}:{}),
  setReady:(...args)=>ipcRenderer.invoke('homer:capture:ready',...args),
  acceptDraft:id=>ipcRenderer.invoke('homer:capture:accept-draft',id),
  getShortcut:(...args)=>ipcRenderer.invoke('homer:capture:shortcut-state',...args),
  setShortcut:(...args)=>ipcRenderer.invoke('homer:capture:shortcut-set',...args),
  onResult:callback=>{
   if(typeof callback!=='function')throw new TypeError('desktop_capture_callback');
   const listener=(_event,scope,result)=>callback(scope,result);
   ipcRenderer.on('homer:capture:result',listener);
   return ()=>ipcRenderer.removeListener('homer:capture:result',listener);
  },
 });
 const invoke=(channel,args)=>args.length
  ?Promise.reject(new Error('desktop_permissions_arguments'))
  :ipcRenderer.invoke(channel);
 contextBridge.exposeInMainWorld('homerDesktopPower',{
  state:(...args)=>invoke('homer:power:state',args),
  update:(...args)=>args.length===1?ipcRenderer.invoke('homer:power:update',args[0]):Promise.reject(new Error('desktop_power_arguments')),
  authorize:(...args)=>invoke('homer:power:authorize',args),
  onChanged:callback=>{
   if(typeof callback!=='function')throw new TypeError('desktop_power_callback');
   const listener=()=>callback();ipcRenderer.on('homer:power:changed',listener);
   return ()=>ipcRenderer.removeListener('homer:power:changed',listener);
  },
 });
 contextBridge.exposeInMainWorld('homerDesktopPermissions',{
  check:(...args)=>invoke('homer:desktop-permissions:check',args),
  promptAccessibility:(...args)=>invoke('homer:desktop-permissions:prompt-accessibility',args),
  openSystemSettings:(...args)=>args.length===1&&['screen','location'].includes(args[0])
   ?ipcRenderer.invoke('homer:desktop-permissions:open-system-settings',args[0])
   :invoke('homer:desktop-permissions:open-system-settings',args),
 });
 contextBridge.exposeInMainWorld('homerDesktopAccount',{
  ...Object.fromEntries(['state','connect','cancel','reopen','refresh','openWebsite','disconnect','restart','nativeConnect','nativeCancel','nativeReopen','nativeModels','memberModels','nativeUsage','applyWebsite'].map(name=>[name,(...args)=>invoke('homer:account:'+name,args)])),
  ...Object.fromEntries(['applyCodex','applyMemberModel'].map(name=>[name,(...args)=>args.length<=1?ipcRenderer.invoke('homer:account:'+name,...args):Promise.reject(new Error('desktop_permissions_arguments'))])),
  onChange:callback=>{
   if(typeof callback!=='function')throw new TypeError('desktop_account_callback');
   const listener=(_event,reason)=>callback(reason);ipcRenderer.on('homer:account:changed',listener);
   let active=true;return()=>{if(!active)return;active=false;ipcRenderer.removeListener('homer:account:changed',listener);};
  },
 });
 contextBridge.exposeInMainWorld('homerDesktopUpdate',{
  ...Object.fromEntries(['state','dismiss','restart'].map(name=>[name,(...args)=>invoke('homer:update:'+name,args)])),
  onChange:callback=>{
   if(typeof callback!=='function')throw new TypeError('desktop_update_callback');
   const listener=()=>callback();ipcRenderer.on('homer:update:changed',listener);
   let active=true;return()=>{if(!active)return;active=false;ipcRenderer.removeListener('homer:update:changed',listener);};
  },
 });
 contextBridge.exposeInMainWorld('homerDesktopFeatureTour',{
  pending:(...args)=>invoke('homer:feature-tour:pending',args),
  dismiss:(...args)=>invoke('homer:feature-tour:dismiss',args),
 });
 contextBridge.exposeInMainWorld('homerDesktopChatApps',Object.fromEntries(
  ['state','health','start','code','confirm','cancel','remove','apply']
   .map(action=>[action,input=>ipcRenderer.invoke('homer:chat-apps',action,input)]),
 ));
 contextBridge.exposeInMainWorld('homerDesktopNotifications',{
  preferences:()=>ipcRenderer.invoke('homer:notification','preferences'),
  set:(key,value)=>ipcRenderer.invoke('homer:notification','set',key,value),
  openSystemSettings:()=>ipcRenderer.invoke('homer:notification','system-settings'),
  ...(process.platform==='darwin'?{openFocusSettings:()=>ipcRenderer.invoke('homer:notification','focus-settings')}:{}),
  subscribe:(check,open)=>{
   const onCheck=(_event,id,notice)=>check(id,notice);
   const onOpen=(_event,notice)=>open(notice);
   ipcRenderer.on('homer:notification:check',onCheck);
   ipcRenderer.on('homer:notification:open',onOpen);
   void ipcRenderer.invoke('homer:notification','ready',true).catch(()=>{});
   return ()=>{
    ipcRenderer.removeListener('homer:notification:check',onCheck);
    ipcRenderer.removeListener('homer:notification:open',onOpen);
    void ipcRenderer.invoke('homer:notification','ready',false).catch(()=>{});
   };
  },
  visibility:(id,visible)=>ipcRenderer.invoke('homer:notification','visibility',id,visible),
 });
 contextBridge.exposeInMainWorld('homerDesktopSettings',{
  getVersion:(...args)=>invoke('homer:settings:version',args),
  openAboutLink:(...args)=>ipcRenderer.invoke('homer:settings:open-about-link',...args),
  onOpen:callback=>{
   if(typeof callback!=='function')throw new TypeError('desktop_settings_callback');
   const listener=(_event,target)=>target==='permissions'?callback('permissions'):callback();
   ipcRenderer.on('homer:settings:open',listener);
   void ipcRenderer.invoke('homer:settings:ready',true).catch(()=>{});
   let active=true;
   return ()=>{
    if(!active)return;
    active=false;
    ipcRenderer.removeListener('homer:settings:open',listener);
    void ipcRenderer.invoke('homer:settings:ready',false).catch(()=>{});
   };
  },
 });

}
