const {ipcRenderer}=require('electron');
// Lives in the preload's isolated world; no bridge is exposed to the site.
globalThis.annotationBridge={state:()=>ipcRenderer.invoke('annotation-state'),save:input=>ipcRenderer.invoke('annotation-save',input)};
