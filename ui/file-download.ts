import {mobileView} from './web-connection-client';
export const MOBILE_DOWNLOAD_LIMIT_NOTICE='文件超过手机保存上限（8 MiB），请在电脑端下载。';
export function mobileDownloadNotice(size?:number){
 return mobileView&&window.ReactNativeWebView&&size!==undefined&&size>8*1024*1024
  ?MOBILE_DOWNLOAD_LIMIT_NOTICE:'';
}
export async function saveBlob(blob:Blob,filename:string){
 if(mobileView&&window.ReactNativeWebView){
  // shortcut: transfer one existing 8 MiB file through the WebView bridge; stream only if larger files become a product requirement.
  if(mobileDownloadNotice(blob.size))throw Error('mobile_file_size_limit');
  const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]!);reader.onerror=()=>reject(Error('mobile_file_read_failed'));reader.readAsDataURL(blob);});
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'share-file',filename,base64,...(window.__homerMobileNonce?{nonce:window.__homerMobileNonce}:{})}));return;
 }
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
