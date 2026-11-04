import {useEffect,useState} from 'react';
import {Dialog} from '@base-ui/react/dialog';
import {ChevronRight,Settings} from 'lucide-react';

export function MobileSettings(){
 const [open,setOpen]=useState(false);
 useEffect(()=>{
  if(!open)return;
  const nonce=window.__homerMobileNonce;
  const connect=()=>{if(window.__homerMobileNonce!==nonce)setOpen(false);};
  window.addEventListener('homer-mobile-connect',connect);
  return()=>window.removeEventListener('homer-mobile-connect',connect);
 },[open]);
 const send=(type:'open-scanner'|'open-privacy')=>window.ReactNativeWebView?.postMessage(JSON.stringify({type,nonce:window.__homerMobileNonce}));
 return <Dialog.Root open={open} onOpenChange={setOpen}>
  <Dialog.Trigger aria-label="设置" title="设置"><Settings size={18}/></Dialog.Trigger>
  <Dialog.Portal><Dialog.Popup className="mobile-settings-page">
   <header className="mobile-settings-page-header"><Dialog.Title>设置</Dialog.Title><Dialog.Close>完成</Dialog.Close></header>
   <div className="mobile-settings-page-content">
    <section aria-labelledby="mobile-settings-connection"><h2 id="mobile-settings-connection">连接电脑</h2><button type="button" onClick={()=>send('open-scanner')}>重新扫码<ChevronRight size={18} aria-hidden="true"/></button></section>
    <section aria-labelledby="mobile-settings-about"><h2 id="mobile-settings-about">关于</h2><button type="button" onClick={()=>send('open-privacy')}>隐私政策<ChevronRight size={18} aria-hidden="true"/></button></section>
   </div>
  </Dialog.Popup></Dialog.Portal>
 </Dialog.Root>;
}
