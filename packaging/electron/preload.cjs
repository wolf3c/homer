const {contextBridge,ipcRenderer}=require('electron');

if(process.isMainFrame===true){
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
 contextBridge.exposeInMainWorld('homerDesktopPermissions',{
  check:(...args)=>invoke('homer:desktop-permissions:check',args),
  promptAccessibility:(...args)=>invoke('homer:desktop-permissions:prompt-accessibility',args),
  openSystemSettings:(...args)=>args.length===1&&args[0]==='screen'
   ?ipcRenderer.invoke('homer:desktop-permissions:open-system-settings','screen')
   :invoke('homer:desktop-permissions:open-system-settings',args),
 });
 contextBridge.exposeInMainWorld('homerDesktopAccount',{
  ...Object.fromEntries(['state','connect','cancel','reopen','refresh','openWebsite','disconnect','restart','nativeConnect','nativeCancel','nativeReopen','applyCodex','applyWebsite'].map(name=>[name,(...args)=>invoke('homer:account:'+name,args)])),
  onChange:callback=>{
   if(typeof callback!=='function')throw new TypeError('desktop_account_callback');
   const listener=()=>callback();ipcRenderer.on('homer:account:changed',listener);
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
  ['state','start','code','confirm','cancel','remove','undo','discard','apply']
   .map(action=>[action,input=>ipcRenderer.invoke('homer:chat-apps',action,input)]),
 ));
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
