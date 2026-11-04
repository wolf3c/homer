const {contextBridge,ipcRenderer}=require('electron');

if(process.isMainFrame===true){
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
 contextBridge.exposeInMainWorld('homerDesktopSettings',{
  onOpen:callback=>{
   if(typeof callback!=='function')throw new TypeError('desktop_settings_callback');
   const listener=()=>callback();
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
