const{ipcRenderer}=require('electron');
if(process.isMainFrame)globalThis.homerAnnotationBridge={
 begin:()=>ipcRenderer.invoke('homer:preview:annotation-begin'),
 read:()=>ipcRenderer.invoke('homer:preview:annotation-read'),
 capture:document=>ipcRenderer.invoke('homer:preview:annotation-capture',document),
 save:input=>ipcRenderer.invoke('homer:preview:annotation-save',input),
 subscribe:callback=>{const listener=(_,state)=>callback(state);ipcRenderer.on('homer:preview:annotation-state',listener);return()=>ipcRenderer.removeListener('homer:preview:annotation-state',listener);},
};
if(process.isMainFrame)addEventListener('click',event=>{
 if(!event.isTrusted||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 const link=event.target instanceof Element?event.target.closest('a[href]'):null;
 if(!link||link.hasAttribute('download'))return;
 const href=link.getAttribute('href');
 if(!href||href.startsWith('#'))return;
 if(location.protocol==='homer-preview:'){
  if((/^(?:https?:|file:|[a-z]:(?:[\\/]|%5c))/i.test(href)||!/^[a-z][a-z\d+.-]*:/i.test(href))&&ipcRenderer.sendSync('homer:preview:link',href))
   event.preventDefault();
 }else if(link.target.toLowerCase()==='_blank'&&/^https?:/i.test(link.href)){
  ipcRenderer.sendSync('homer:preview:popup-link',link.href);
 }
});
