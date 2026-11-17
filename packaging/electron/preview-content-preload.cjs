const{ipcRenderer}=require('electron');
if(process.isMainFrame)globalThis.homerAnnotationBridge={
 begin:()=>ipcRenderer.invoke('homer:preview:annotation-begin'),
 read:()=>ipcRenderer.invoke('homer:preview:annotation-read'),
 save:input=>ipcRenderer.invoke('homer:preview:annotation-save',input),
 subscribe:callback=>{const listener=(_,state)=>callback(state);ipcRenderer.on('homer:preview:annotation-state',listener);return()=>ipcRenderer.removeListener('homer:preview:annotation-state',listener);},
};
