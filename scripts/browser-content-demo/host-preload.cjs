const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('demoHost',{action:(action,id)=>ipcRenderer.invoke('host-action',action,id),onState:fn=>ipcRenderer.on('state',(_,state)=>fn(state))});
