import {mobileView} from './web-connection-client';
export async function saveBlob(blob:Blob,filename:string){
 if(mobileView&&window.ReactNativeWebView){
  // shortcut: transfer one existing 8 MiB file through the WebView bridge; stream only if larger files become a product requirement.
  if(blob.size>8*1024*1024)throw Error('mobile_file_size_limit');
  const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]!);reader.onerror=()=>reject(Error('mobile_file_read_failed'));reader.readAsDataURL(blob);});
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'share-file',filename,base64,...(window.__homerMobileNonce?{nonce:window.__homerMobileNonce}:{})}));return;
 }
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
