const {contextBridge,ipcRenderer}=require('electron');

if(process.isMainFrame===true)contextBridge.exposeInMainWorld('homerCapturePanel',{
 read:()=>ipcRenderer.invoke('homer:capture-panel:read'),
 present:()=>ipcRenderer.invoke('homer:capture-panel:present'),
 close:()=>ipcRenderer.invoke('homer:capture-panel:close'),
 ...(process.platform==='win32'?{
  chooseSource:id=>ipcRenderer.invoke('homer:capture-panel:choose-source',id),
  acceptImage:(png,region)=>ipcRenderer.invoke('homer:capture-panel:accept-image',png,region),
 }:{}),
 finish:(notes,includeAX)=>ipcRenderer.invoke('homer:capture-panel:finish',notes,includeAX),
});
