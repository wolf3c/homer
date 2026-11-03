export const LOCAL_ORIGIN='https://localhost';
export function connectionScreen(status,wasConnected){
 if(wasConnected)return 'chat';
 if(status==='restoring')return 'loading';
 if(status==='scan')return 'welcome';
 if(status==='active')return 'chat';
 return status;
}
function signalOrigin(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.origin!==value)throw Error('invalid_homer_address');
 return url.origin;
}
export function pairingAddress(value){
 const url=new URL(value),route=/^\/homer\/mobile\/([a-f0-9]{64})$/.exec(url.pathname);
 signalOrigin(url.origin);if(url.username||url.password||!route||url.search||!/^#[A-Za-z0-9_-]{43}$/.test(url.hash))throw Error('invalid_homer_qr');
 return {signalOrigin:url.origin,routeId:route[1],invitation:url.hash.slice(1)};
}
export function savedPairing(value){
 const config=JSON.parse(value);
 if(!config||typeof config.routeId!=='string'||typeof config.credential!=='string'||Object.keys(config).sort().join(',')!=='credential,routeId,signalOrigin'||! /^[a-f0-9]{64}$/.test(config.routeId)||! /^[A-Za-z0-9_-]{43}$/.test(config.credential))throw Error('invalid_homer_pairing');
 signalOrigin(config.signalOrigin);return config;
}
export function navigation(value,origin,topFrame=true){
 try{
  const url=new URL(value);
  if(url.protocol==='about:'&&((url.pathname==='blank'&&origin===LOCAL_ORIGIN)||!topFrame&&url.pathname==='srcdoc')&&!url.search)return 'internal';
  if(url.protocol==='blob:'&&url.origin===origin)return 'internal';
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return 'blocked';
  return !topFrame||url.origin===origin?'internal':'external';
 }catch{return 'blocked';}
}
export function downloadMessage(value,origin,url){
 if(navigation(url,origin)!=='internal'||value.length>12*1024*1024)throw Error('invalid_download');
 const item=JSON.parse(value);
 if(item?.type!=='share-file'||typeof item.filename!=='string'||!item.filename||item.filename.length>120||/[\x00-\x1f/\\]/.test(item.filename)||item.filename==='.'||item.filename==='..'||typeof item.base64!=='string'||item.base64.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(item.base64)||item.base64.length>Math.ceil(8*1024*1024/3)*4)throw Error('invalid_download');
 return {filename:item.filename,base64:item.base64};
}
